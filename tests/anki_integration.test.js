const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/05_media_source.js",
  "src/main/15_profile_settings.js",
  "src/main/20_dictionary_manifest.js",
  "src/main/51_anki_connect.js",
  "src/main/52_anki_card_context.js",
  "src/main/52_anki_templates.js",
  "src/main/53_anki_duplicates.js",
  "src/main/54_anki_media_names.js",
  "src/main/54_anki_note_actions.js",
  "src/main/55_anki_integration.js",
];
const overlayMessages = [];
const filesByPath = Object.create(null);
let fastTimers = false;

const context = {
  console,
  putBoundedCache(cache, key, value) {
    cache[key] = value;
  },
  Date,
  Math,
  setTimeout(callback, delay) {
    if (fastTimers && Number(delay) < 50000)
      return { immediate: setImmediate(callback) };
    if (Number(delay) >= 50000) return { ignored: true };
    return setTimeout(callback, delay);
  },
  clearTimeout(timer) {
    if (timer && timer.ignored) return;
    if (timer && timer.immediate) {
      clearImmediate(timer.immediate);
      return;
    }
    clearTimeout(timer);
  },
  scheduleOneShot(callback, delay) {
    return context.setTimeout(callback, delay);
  },
  cancelOneShot(timer) {
    context.clearTimeout(timer);
  },
  lastSubtitle: "私は猫です。",
  __overlayMessages: overlayMessages,
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  readManifest() {
    return {
      activeProfileId: "default",
      profiles: {
        default: {
          id: "default",
          name: "Default",
          preferences: {},
        },
      },
    };
  },
  selectedLanguageModule() {
    return { id: "ja" };
  },
  dataRoot() {
    return "/data";
  },
  dataPath(...parts) {
    return ["/data"].concat(parts).join("/");
  },
  postToOverlay(name, payload) {
    overlayMessages.push({ name, payload });
  },
  postToDictionaryManager() {},
  debugWarn() {},
  http: {
    async post() {
      return { statusCode: 200, data: { result: null, error: null } };
    },
  },
  normalizePopupThemePreference(value) {
    return value;
  },
  preferences: {
    get() {
      return undefined;
    },
  },
  file: {
    write(path, value) {
      filesByPath[String(path || "")] = String(value || "");
    },
    exists() {
      return false;
    },
  },
  safeDelete() {},
  utils: {
    async exec() {
      return { status: 0, stdout: "{}", stderr: "" };
    },
  },
  mpv: {
    getString(name) {
      if (name === "media-title") return "猫の映画";
      if (name === "path") return "/Movies/neko.mkv";
      return "";
    },
    getNumber(name) {
      if (name === "time-pos") return 83.4;
      return 0;
    },
    set() {},
    command() {},
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

vm.createContext(context);
vm.runInContext(
  files
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n"),
  context,
);
const realAnkiConnectInvoke = context.ankiConnectInvoke;

function makeConfiguredAnkiPrefs(overrides) {
  return Object.assign(
    {
      ankiEnabled: true,
      ankiConnectUrl: "http://127.0.0.1:8765",
      ankiDeckName: "Mining",
      ankiModelName: "Basic",
      ankiFieldTemplatesJson: JSON.stringify({
        Front: "{expression}",
        Back: "{glossary-first}",
      }),
      ankiDuplicateCheck: true,
      ankiDuplicateMode: "prevent",
      ankiDuplicateScope: "deck",
    },
    overrides || {},
  );
}

function setActiveAnkiPrefs(prefs) {
  context.readManifest = function readManifestForAnkiTest() {
    return context.normalizeManifestShape({
      activeProfileId: "default",
      profiles: {
        default: {
          id: "default",
          name: "Default",
          preferences: prefs,
        },
      },
    });
  };
}

async function flushAsyncWork() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitForOverlayMessage(predicate) {
  for (let i = 0; i < 12; i++) {
    if (context.__overlayMessages.some(predicate)) return true;
    await flushAsyncWork();
  }
  return context.__overlayMessages.some(predicate);
}

async function testNestedCardSkipsCurrentMediaCapture() {
  const previousScreenshot = context.ankiCaptureScreenshot;
  const previousSentenceAudio = context.ankiCaptureSentenceAudio;
  const previousWordAudio = context.ankiStoreWordAudio;
  let screenshotCalls = 0;
  let sentenceAudioCalls = 0;
  let wordAudioCalls = 0;
  context.ankiCaptureScreenshot = async () => {
    screenshotCalls++;
    return "frame.jpg";
  };
  context.ankiCaptureSentenceAudio = async () => {
    sentenceAudioCalls++;
    return "sentence.mp3";
  };
  context.ankiStoreWordAudio = async () => {
    wordAudioCalls++;
    return "word.mp3";
  };
  try {
    const media = await context.ankiCaptureNeededMedia(
      { screenshot: true, sentenceAudio: true, wordAudio: true },
      { allowCurrentMedia: false, expression: "使う" },
      {},
    );
    assert(
      screenshotCalls === 0 &&
        sentenceAudioCalls === 0 &&
        wordAudioCalls === 1 &&
        media.screenshot === undefined &&
        media.sentenceAudio === undefined &&
        media.wordAudio === "word.mp3",
      "Nested Anki cards should skip current frames and sentence audio while retaining dictionary word audio",
    );
  } finally {
    context.ankiCaptureScreenshot = previousScreenshot;
    context.ankiCaptureSentenceAudio = previousSentenceAudio;
    context.ankiStoreWordAudio = previousWordAudio;
  }
}

async function testAnkiBridgeRecoversAfterConnectTimeout() {
  const previousPost = context.http.post;
  setActiveAnkiPrefs(
    makeConfiguredAnkiPrefs({
      ankiConnectTimeoutSeconds: 1,
      ankiDuplicateCheck: false,
    }),
  );
  context.__overlayMessages.length = 0;
  fastTimers = true;
  context.http.post = async () => {
    return new Promise(() => {});
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "recover-timeout",
    popupSessionId: "popup-recover",
    context: {
      expression: "鳥",
      entry: { term: { expression: "鳥", glossaries: [{ glossary: "bird" }] } },
    },
  });
  await flushAsyncWork();
  assert(
    await waitForOverlayMessage(
      (message) =>
        message.payload &&
        message.payload.requestId === "recover-timeout" &&
        message.payload.ok === false &&
        /did not respond|timed out/i.test(message.payload.message || ""),
    ),
    "Timed-out AnkiConnect add requests should report an error to the popup",
  );

  fastTimers = false;
  context.__overlayMessages.length = 0;
  context.http.post = async (_url, options) => {
    const body = options.data || {};
    return {
      statusCode: 200,
      data: {
        result:
          body.action === "version"
            ? 6
            : body.action === "addNote"
              ? 67890
              : null,
        error: null,
      },
    };
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "recover-success",
    popupSessionId: "popup-recover",
    context: {
      expression: "鳥",
      entry: { term: { expression: "鳥", glossaries: [{ glossary: "bird" }] } },
    },
  });
  await flushAsyncWork();
  assert(
    await waitForOverlayMessage(
      (message) =>
        message.payload &&
        message.payload.requestId === "recover-success" &&
        message.payload.state === "added" &&
        message.payload.noteId === 67890,
    ),
    "Anki add requests should recover after a previous AnkiConnect timeout",
  );
  context.http.post = previousPost;
}

async function testAnkiBridgeActions() {
  context.ankiConfiguredFieldNames = async () => ["Front", "Back"];

  setActiveAnkiPrefs(makeConfiguredAnkiPrefs());
  const openCalls = [];
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = (action, params, options) => {
    openCalls.push({ action, params, options });
    if (action === "version") return Promise.resolve(6);
    if (action === "guiBrowse") return new Promise(() => {});
    return Promise.resolve(null);
  };
  context.handleBridgeAnkiCardOpen({
    requestId: "open-known",
    noteIds: [12345],
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [] } },
    },
  });
  assert(
    openCalls.some(
      (call) =>
        call.action === "guiBrowse" && call.params.query === "nid:12345",
    ),
    "Open requests with known duplicate IDs should browse directly to that nid",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.requestId === "open-known" &&
        message.payload.state === "opened",
    ),
    "Open requests should report opened without waiting for guiBrowse",
  );

  const fallbackCalls = [];
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = (action, params, options) => {
    fallbackCalls.push({ action, params, options });
    if (action === "version") return Promise.resolve(6);
    return Promise.resolve([]);
  };
  context.handleBridgeAnkiCardOpen({
    requestId: "open-fallback",
    noteIds: [],
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  });
  assert(
    !fallbackCalls.some(
      (call) => call.action === "findNotes" || call.action === "guiBrowse",
    ),
    "Reveal actions without a known note ID should not run fallback Anki queries",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.requestId === "open-fallback" &&
        message.payload.ok === false &&
        /note ID/i.test(message.payload.message || ""),
    ),
    "Reveal actions without a known note ID should fail immediately",
  );

  const duplicateAddCalls = [];
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = (action, params, options) => {
    duplicateAddCalls.push({ action, params, options });
    if (action === "version") return Promise.resolve(6);
    if (action === "canAddNotesWithErrorDetail")
      return Promise.resolve([
        {
          canAdd: false,
          error: "cannot create note because it is a duplicate",
        },
      ]);
    if (action === "findNotes") return Promise.resolve([34567]);
    if (action === "guiBrowse") return new Promise(() => {});
    if (action === "addNote")
      throw new Error("addNote should not run for prevent-mode duplicates");
    return Promise.resolve(null);
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "add-duplicate",
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  });
  await flushAsyncWork();
  assert(
    duplicateAddCalls.some(
      (call) =>
        call.action === "guiBrowse" && call.params.query === "nid:34567",
    ),
    "Duplicate add clicks in prevent mode should open the existing note",
  );
  assert(
    !duplicateAddCalls.some((call) => call.action === "addNote"),
    "Duplicate add clicks in prevent mode should not fall through to addNote",
  );
  assert(
    context.__overlayMessages.some(
      (message) => message.payload && message.payload.state === "opened",
    ),
    "Duplicate add clicks should report an opened state",
  );

  const nullAddCalls = [];
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = async (action, params, options) => {
    nullAddCalls.push({ action, params, options });
    if (action === "version") return 6;
    if (action === "canAddNotesWithErrorDetail")
      return [{ canAdd: true, error: null }];
    if (action === "addNote") return null;
    return null;
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "add-null",
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  });
  await flushAsyncWork();
  assert(
    nullAddCalls.some((call) => call.action === "addNote"),
    "Non-duplicate add clicks should call addNote",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.ok === false &&
        /note ID/i.test(message.payload.message || ""),
    ),
    "addNote responses without a note ID should be reported as errors",
  );

  const successfulAddCalls = [];
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = async (action, params, options) => {
    successfulAddCalls.push({ action, params, options });
    if (action === "version") return 6;
    if (action === "canAddNotesWithErrorDetail")
      return [{ canAdd: true, error: null }];
    if (action === "addNote") return 45678;
    return null;
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "add-success",
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  });
  await flushAsyncWork();
  assert(
    successfulAddCalls.some((call) => call.action === "addNote"),
    "Non-duplicate add clicks should add the note",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.state === "added" &&
        message.payload.noteId === 45678 &&
        message.payload.noteIds[0] === 45678,
    ),
    "Successful add responses should preserve the new note ID for reveal",
  );

  const reusedRequestCalls = [];
  context.__overlayMessages.length = 0;
  let reusedNoteId = 50000;
  context.ankiConnectInvoke = async (action, params, options) => {
    reusedRequestCalls.push({ action, params, options });
    if (action === "version") return 6;
    if (action === "canAddNotesWithErrorDetail")
      return [{ canAdd: true, error: null }];
    if (action === "addNote") return ++reusedNoteId;
    return null;
  };
  const reusedContext = {
    expression: "犬",
    entry: { term: { expression: "犬", glossaries: [{ glossary: "dog" }] } },
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "anki-1",
    popupSessionId: "popup-a",
    context: reusedContext,
  });
  await flushAsyncWork();
  context.handleBridgeAnkiCardAdd({
    requestId: "anki-1",
    popupSessionId: "popup-a",
    context: reusedContext,
  });
  await flushAsyncWork();
  context.handleBridgeAnkiCardAdd({
    requestId: "anki-1",
    popupSessionId: "popup-b",
    context: reusedContext,
  });
  await flushAsyncWork();
  const reusedAddCount = reusedRequestCalls.filter(
    (call) => call.action === "addNote",
  ).length;
  assert(
    reusedAddCount === 2,
    "Same request IDs from different popup sessions should not be treated as completed retries",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.popupSessionId === "popup-a" &&
        message.payload.state === "added",
    ),
    "Anki responses should echo the originating popup session",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.popupSessionId === "popup-b" &&
        message.payload.state === "added",
    ),
    "A recreated popup session should receive its own add result",
  );
}

async function testPassiveAnkiStatusCoalesces() {
  setActiveAnkiPrefs(
    makeConfiguredAnkiPrefs({
      ankiConnectUrl: "http://127.0.0.1:18765",
      ankiDuplicateCheck: true,
    }),
  );
  const previousInvoke = context.ankiConnectInvoke;
  const calls = [];
  context.ankiConnectInvoke = async (action, params, options) => {
    calls.push({ action, params, options });
    if (action === "version") return 6;
    if (action === "modelFieldNames") return ["Front", "Back"];
    if (action === "canAddNotesWithErrorDetail") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [{ canAdd: true, error: null }];
    }
    return null;
  };
  const payload = {
    requestId: "status-coalesce-a",
    popupSessionId: "status-coalesce",
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  };
  const [first, second] = await Promise.all([
    context.ankiCardStatusForContext(payload),
    context.ankiCardStatusForContext(
      Object.assign({}, payload, { requestId: "status-coalesce-b" }),
    ),
  ]);
  assert(
    first.state === "ready" && second.state === "ready",
    "Coalesced passive Anki status checks should resolve normally",
  );
  assert(
    calls.filter((call) => call.action === "canAddNotesWithErrorDetail")
      .length === 1,
    "Identical passive Anki status checks should share one duplicate probe",
  );
  await context.ankiCardStatusForContext(
    Object.assign({}, payload, { requestId: "status-coalesce-c" }),
  );
  assert(
    calls.filter((call) => call.action === "canAddNotesWithErrorDetail")
      .length === 1,
    "Recent passive Anki status checks should be served from cache",
  );
  context.ankiConnectInvoke = previousInvoke;
}

async function testExportFastPathsPreserveDuplicateHandling() {
  const previousInvoke = context.ankiConnectInvoke;
  const cardContext = {
    expression: "速い",
    entry: { term: { expression: "速い", glossaries: [{ glossary: "fast" }] } },
  };
  try {
    setActiveAnkiPrefs(
      makeConfiguredAnkiPrefs({ ankiConnectUrl: "http://127.0.0.1:28765" }),
    );
    let calls = [];
    context.ankiConnectInvoke = async (action) => {
      calls.push(action);
      if (action === "version") return 6;
      if (action === "canAddNotesWithErrorDetail")
        return [{ canAdd: true, error: null }];
      if (action === "addNote") return 60001;
      return null;
    };
    await context.ankiCardStatusForContext({ context: cardContext });
    context.__overlayMessages.length = 0;
    context.handleBridgeAnkiCardAdd({
      requestId: "cached-ready-add",
      popupSessionId: "performance",
      context: cardContext,
    });
    await flushAsyncWork();
    assert(
      calls.filter((action) => action === "canAddNotesWithErrorDetail")
        .length === 1 &&
        calls.filter((action) => action === "addNote").length === 1,
      "A recent ready preflight should not repeat the same duplicate probe on add",
    );

    setActiveAnkiPrefs(
      makeConfiguredAnkiPrefs({
        ankiConnectUrl: "http://127.0.0.1:28766",
        ankiDuplicateMode: "allow",
      }),
    );
    calls = [];
    context.ankiConnectInvoke = async (action) => {
      calls.push(action);
      if (action === "addNote") return 60002;
      return null;
    };
    context.handleBridgeAnkiCardAdd({
      requestId: "allow-add",
      popupSessionId: "performance",
      context: cardContext,
    });
    await flushAsyncWork();
    assert(
      calls.includes("addNote") &&
        !calls.includes("canAddNotesWithErrorDetail") &&
        !calls.includes("findNotes"),
      "Allow-duplicate exports should go directly to Anki's authoritative addNote check",
    );

    setActiveAnkiPrefs(
      makeConfiguredAnkiPrefs({ ankiConnectUrl: "http://127.0.0.1:28767" }),
    );
    calls = [];
    let adding = false;
    context.ankiConnectInvoke = async (action) => {
      calls.push(action);
      if (action === "version") return 6;
      if (action === "canAddNotesWithErrorDetail")
        return [{ canAdd: true, error: null }];
      if (action === "addNote") {
        adding = true;
        throw new Error("cannot create note because it is a duplicate");
      }
      if (action === "findNotes" && adding) return [60003];
      if (action === "guiBrowse") return new Promise(() => {});
      return null;
    };
    await context.ankiCardStatusForContext({ context: cardContext });
    context.__overlayMessages.length = 0;
    context.handleBridgeAnkiCardAdd({
      requestId: "late-duplicate",
      popupSessionId: "performance",
      context: cardContext,
    });
    await flushAsyncWork();
    assert(
      calls.includes("findNotes") &&
        calls.includes("guiBrowse") &&
        context.__overlayMessages.some(
          (message) =>
            message.payload &&
            message.payload.requestId === "late-duplicate" &&
            message.payload.state === "opened" &&
            message.payload.noteIds[0] === 60003,
        ),
      "An addNote duplicate race should still find and reveal the newly created duplicate",
    );
  } finally {
    context.ankiConnectInvoke = previousInvoke;
  }
}

async function testAnkiMediaSetupCachesProcessWork() {
  const previousExec = context.utils.exec;
  const previousExists = context.file.exists;
  let mkdirCalls = 0;
  let md5Calls = 0;
  let ffmpegChecks = 0;
  let releaseMkdir = null;
  const mkdirPending = new Promise((resolve) => {
    releaseMkdir = resolve;
  });
  vm.runInContext(
    'ankiMediaRootReady = false; ankiMediaRootPromise = null; ankiFfmpegPathCache = "";',
    context,
  );
  context.file.exists = (filePath) => {
    if (filePath === "/opt/homebrew/bin/ffmpeg") {
      ffmpegChecks++;
      return true;
    }
    return false;
  };
  context.utils.exec = async (command) => {
    if (command === "/bin/mkdir") {
      mkdirCalls++;
      await mkdirPending;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "/sbin/md5") {
      md5Calls++;
      return { status: 0, stdout: "abcdef0123456789\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  try {
    const setupA = context.ensureAnkiMediaRoot();
    const setupB = context.ensureAnkiMediaRoot();
    await flushAsyncWork();
    assert(
      mkdirCalls === 1,
      "Concurrent media jobs should share one mkdir process",
    );
    releaseMkdir();
    await Promise.all([setupA, setupB]);
    await context.ensureAnkiMediaRoot();
    assert(
      mkdirCalls === 1,
      "The existing Anki media directory should remain cached",
    );
    assert(
      (await context.ankiFindFfmpegPath()) === "/opt/homebrew/bin/ffmpeg" &&
        (await context.ankiFindFfmpegPath()) === "/opt/homebrew/bin/ffmpeg" &&
        ffmpegChecks === 1,
      "FFmpeg discovery should be cached after its first successful lookup",
    );
    assert(
      (await context.ankiMediaFileHashHex("/fixture/frame.jpg")) ===
        "abcdef012345" && md5Calls === 1,
      "Media hashing should use macOS's native md5 utility once per file",
    );
  } finally {
    context.utils.exec = previousExec;
    context.file.exists = previousExists;
  }
}

async function testStreamingSentenceAudioSources() {
  const previous = {
    exec: context.utils.exec,
    exists: context.file.exists,
    safeDelete: context.safeDelete,
    command: context.mpv.command,
    getString: context.mpv.getString,
    set: context.mpv.set,
    currentMediaSourceSnapshot: context.currentMediaSourceSnapshot,
    ankiFindFfmpegPath: context.ankiFindFfmpegPath,
    ensureAnkiMediaRoot: context.ensureAnkiMediaRoot,
    ankiStoreMediaFile: context.ankiStoreMediaFile,
    ankiMediaFileHashHex: context.ankiMediaFileHashHex,
    ankiSubtitleBoundary: context.ankiSubtitleBoundary,
  };
  const prefs = {
    ankiAudioFormat: "mp3",
    ankiAudioBitrateKbps: 128,
    ankiSentenceAudioPaddingMs: 0,
  };
  const cardContext = { documentTitle: "Stream", timePos: 11 };
  let existing = new Set();
  let execCalls = [];
  let mpvCommands = [];
  let mpvProperties = {
    "ab-loop-a": "no",
    "ab-loop-b": "no",
  };
  function installCacheCommand(options) {
    const settings = options || {};
    mpvProperties = {
      "ab-loop-a": "no",
      "ab-loop-b": "no",
    };
    context.mpv.command = (name, args) => {
      mpvCommands.push({ name, args: Array.from(args || []) });
      if (name === "ab-loop-align-cache") {
        if (settings.alignmentError) throw new Error("alignment unavailable");
        mpvProperties["ab-loop-a"] = String(
          settings.alignedStart === undefined ? 5.314 : settings.alignedStart,
        );
        mpvProperties["ab-loop-b"] = String(
          settings.alignedEnd === undefined ? 12.5 : settings.alignedEnd,
        );
      }
      if (name === "dump-cache" && settings.cacheHit)
        existing.add(String(args[2] || ""));
    };
  }
  try {
    context.ankiFindFfmpegPath = async () => "/usr/local/bin/ffmpeg";
    context.ensureAnkiMediaRoot = async () => {};
    context.ankiStoreMediaFile = async (filename) => filename;
    context.ankiMediaFileHashHex = async () => "0123456789ab";
    context.ankiSubtitleBoundary = (name) => (name === "sub-start" ? 10 : 12);
    context.mpv.getString = (name) => {
      if (Object.prototype.hasOwnProperty.call(mpvProperties, name))
        return mpvProperties[name];
      return previous.getString.call(context.mpv, name);
    };
    context.mpv.set = (name, value) => {
      mpvProperties[name] = String(value);
    };
    context.file.exists = (filePath) => existing.has(String(filePath));
    context.safeDelete = (filePath) => existing.delete(String(filePath));
    context.utils.exec = async (command, args) => {
      execCalls.push({ command, args: Array.from(args || []) });
      existing.add(String(args[args.length - 1] || ""));
      return { status: 0, stdout: "", stderr: "" };
    };
    installCacheCommand({ cacheHit: false });

    context.currentMediaSourceSnapshot = () =>
      context.mediaSourceSnapshot({
        path: "/Volumes/Media/video.mkv",
        streamOpenFilename: "/Volumes/Media/video.mkv",
      });
    await context.ankiCaptureSentenceAudio(cardContext, prefs);
    assert(
      mpvCommands.some((item) => item.name === "dump-cache") &&
        execCalls[0].args.includes("/Volumes/Media/video.mkv"),
      "Local sentence audio falls back to direct FFmpeg extraction after a cache miss",
    );

    existing = new Set();
    execCalls = [];
    mpvCommands = [];
    installCacheCommand({ cacheHit: true });
    await context.ankiCaptureSentenceAudio(cardContext, prefs);
    const cachedInput = execCalls[0].args[execCalls[0].args.indexOf("-i") + 1];
    const encodedOutput = execCalls[0].args[execCalls[0].args.length - 1];
    const cachedSeek = execCalls[0].args[execCalls[0].args.indexOf("-ss") + 1];
    assert(
      mpvCommands.some((item) => item.name === "ab-loop-align-cache") &&
        mpvCommands.some((item) => item.name === "dump-cache") &&
        cachedSeek === "4.686" &&
        execCalls[0].args.some((value) => /\.mkv$/.test(value)) &&
        !execCalls[0].args.includes("/Volumes/Media/video.mkv") &&
        !existing.has(cachedInput) &&
        !existing.has(encodedOutput) &&
        mpvProperties["ab-loop-a"] === "no" &&
        mpvProperties["ab-loop-b"] === "no",
      "Local sentence audio should trim cache pre-roll and restore loop state before deleting temporary files",
    );

    existing = new Set();
    execCalls = [];
    mpvCommands = [];
    context.currentMediaSourceSnapshot = () =>
      context.mediaSourceSnapshot({
        path: "https://video.example/watch/123",
        streamOpenFilename: "https://cdn.example/master.m3u8?sig=resolved",
      });
    installCacheCommand({ cacheHit: true });
    await context.ankiCaptureSentenceAudio(cardContext, prefs);
    assert(
      mpvCommands.some((item) => item.name === "dump-cache") &&
        execCalls[0].args.some((value) => /\.mkv$/.test(value)) &&
        !execCalls[0].args.includes("https://video.example/watch/123"),
      "Resolved streams prefer a bounded mpv cache excerpt over reopening a webpage URL",
    );

    existing = new Set();
    execCalls = [];
    mpvCommands = [];
    context.currentMediaSourceSnapshot = () =>
      context.mediaSourceSnapshot({
        path: "https://video.example/watch/123",
        streamOpenFilename: "edl://resolved-by-mpv",
        trackList: [
          {
            type: "audio",
            selected: true,
            external: true,
            "external-filename":
              "https://audio.example/track.m4a?sig=resolved-audio",
          },
        ],
      });
    await context.ankiCaptureSentenceAudio(cardContext, prefs);
    assert(
      mpvCommands.length === 0 &&
        execCalls[0].args.includes(
          "https://audio.example/track.m4a?sig=resolved-audio",
        ),
      "Resolved separate audio tracks use their effective audio URL",
    );

    existing = new Set();
    execCalls = [];
    mpvCommands = [];
    context.currentMediaSourceSnapshot = () =>
      context.mediaSourceSnapshot({
        path: "https://video.example/watch/123",
        streamOpenFilename: "https://cdn.example/video.mp4?sig=resolved",
      });
    installCacheCommand({ cacheHit: false });
    await context.ankiCaptureSentenceAudio(cardContext, prefs);
    assert(
      mpvCommands.some((item) => item.name === "dump-cache") &&
        execCalls[0].args.includes(
          "https://cdn.example/video.mp4?sig=resolved",
        ) &&
        !execCalls[0].args.includes("https://video.example/watch/123"),
      "A cache miss falls back to mpv's resolved media URL, never the webpage URL",
    );

    existing = new Set();
    execCalls = [];
    context.currentMediaSourceSnapshot = () =>
      context.mediaSourceSnapshot({
        path: "/Volumes/Media/video.mkv",
        streamOpenFilename: "/Volumes/Media/video.mkv",
      });
    context.mpv.command = () => {};
    context.utils.exec = async (command, args) => {
      execCalls.push({ command, args: Array.from(args || []) });
      existing.add(String(args[args.length - 1] || ""));
      return { status: 1, stdout: "", stderr: "fixture failure" };
    };
    try {
      await context.ankiCaptureSentenceAudio(cardContext, prefs);
      assert(false, "A failed FFmpeg extraction should reject");
    } catch (error) {
      const failedOutput = execCalls[0].args[execCalls[0].args.length - 1];
      assert(
        /Sentence audio capture failed/.test(String(error && error.message)) &&
          !existing.has(failedOutput),
        "Failed sentence-audio extraction should delete its partial output",
      );
    }
  } finally {
    context.utils.exec = previous.exec;
    context.file.exists = previous.exists;
    context.safeDelete = previous.safeDelete;
    context.mpv.command = previous.command;
    context.mpv.getString = previous.getString;
    context.mpv.set = previous.set;
    context.currentMediaSourceSnapshot = previous.currentMediaSourceSnapshot;
    context.ankiFindFfmpegPath = previous.ankiFindFfmpegPath;
    context.ensureAnkiMediaRoot = previous.ensureAnkiMediaRoot;
    context.ankiStoreMediaFile = previous.ankiStoreMediaFile;
    context.ankiMediaFileHashHex = previous.ankiMediaFileHashHex;
    context.ankiSubtitleBoundary = previous.ankiSubtitleBoundary;
  }
}

const prefs = context.normalizeProfilePreferences({
  ankiConnectUrl: "ftp://example.invalid",
  ankiConnectTimeoutSeconds: 999,
  ankiAudioFormat: "opus",
  ankiAudioBitrateKbps: 999,
  ankiImageQuality: 999,
  ankiDuplicateMode: "allow",
  ankiDuplicateScope: "collection",
  ankiSentenceAudioPaddingMs: 99999,
  ankiFieldTemplatesJson:
    '{"Expression":"{expression}","SentenceAudio":"{sentence-audio}"}',
});
assert(
  prefs.ankiConnectUrl === "http://127.0.0.1:8765",
  "Invalid AnkiConnect URLs should fall back to localhost",
);
assert(
  prefs.ankiConnectTimeoutSeconds === 30,
  "AnkiConnect response timeout should be clamped",
);
assert(
  prefs.ankiAudioFormat === "opus",
  "Opus should be an accepted sentence audio format",
);
assert(
  prefs.ankiAudioBitrateKbps === 320,
  "Audio bitrate should be clamped to a reasonable maximum",
);
assert(
  prefs.ankiImageQuality === 100,
  "Image quality should be clamped to a valid percentage",
);
assert(
  prefs.ankiDuplicateMode === "allow",
  "Duplicate mode should preserve add-anyway",
);
assert(
  prefs.ankiDuplicateScope === "collection",
  "Duplicate scope should preserve collection mode",
);
assert(
  prefs.ankiSentenceAudioPaddingMs === 2000,
  "Sentence audio padding should be clamped",
);

const mediaNeeds = context.ankiTemplatesNeedMedia({
  Expression: "{expression}",
  SentenceAudio: "{sentence-audio}",
  Picture: "",
  Glossary: "{glossary}",
});
assert(
  mediaNeeds.sentenceAudio === true,
  "Sentence audio capture should be required only by audio markers",
);
assert(
  mediaNeeds.screenshot === false,
  "Screenshot capture should not run for empty picture fields",
);

const noMediaNeeds = context.ankiTemplatesNeedMedia({
  Expression: "{expression}",
  Sentence: "{sentence}",
  Glossary: "{glossary}",
});
assert(
  noMediaNeeds.sentenceAudio === false,
  "Sentence audio capture should be skipped when no audio marker is mapped",
);
assert(
  noMediaNeeds.screenshot === false,
  "Screenshot capture should be skipped when no screenshot marker is mapped",
);

const wordAudioNeeds = context.ankiTemplatesNeedMedia({
  ExpressionAudio: "{audio}",
});
assert(
  wordAudioNeeds.wordAudio === true,
  "Word audio should be requested by the audio marker",
);
assert(
  wordAudioNeeds.sentenceAudio === false,
  "The audio marker should not trigger subtitle audio extraction",
);

const mediaFilename = context.ankiMediaFilename(
  "Very Long Episode Name 01",
  "ABCDEF1234567890",
  "JPG",
);
const mediaFilenameSuffixIndex = mediaFilename.lastIndexOf("_");
assert(
  mediaFilename === "Very_Long_Epis_abcdef123456.jpg",
  "Anki media filenames should use a short document prefix, underscore, and hex suffix",
);
assert(
  mediaFilename.slice(0, mediaFilenameSuffixIndex).length < 15,
  "Anki media filename document prefixes should stay under 15 characters",
);
assert(
  /^[0-9a-f]{12}$/.test(context.ankiRandomHex(12)),
  "Random Anki media suffixes should be hex",
);

const wrapperContext = context.ankiCardContextFromPayload({
  context: {
    expression: "猫",
    entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    result: { lookupStart: 2, lookupEnd: 3 },
  },
});
assert(
  wrapperContext.sentence === "私は猫です。",
  "Anki card context wrapper should preserve the last subtitle fallback",
);
assert(
  wrapperContext.surface === "猫",
  "Anki card context wrapper should derive lookup surface from the subtitle fallback",
);
assert(
  wrapperContext.documentTitle === "猫の映画",
  "Anki card context wrapper should read the mpv document title",
);
assert(
  wrapperContext.sourcePath === "/Movies/neko.mkv",
  "Anki card context wrapper should read the mpv source path",
);
assert(
  wrapperContext.timestamp === "1:23",
  "Anki card context wrapper should format the mpv time position",
);
const nestedWrapperContext = context.ankiCardContextFromPayload({
  context: {
    allowCurrentMedia: false,
    sentence: "毎日使っている。",
    position: 2,
    expression: "使う",
    entry: {
      matched: "使って",
      term: { expression: "使う", glossaries: [{ glossary: "to use" }] },
    },
    result: { text: "毎日使っている。", lookupStart: 2, lookupEnd: 5 },
  },
});
assert(
  nestedWrapperContext.sentence === "毎日使っている。" &&
    nestedWrapperContext.documentTitle === "" &&
    nestedWrapperContext.sourcePath === "" &&
    nestedWrapperContext.timestamp === "",
  "Nested Anki contexts should keep popup text without inheriting current-media metadata",
);

const duplicateOptions = context.ankiDuplicateOptions({
  ankiDuplicateMode: "allow",
  ankiDuplicateScope: "collection",
  ankiDeckName: "Mining",
});
assert(
  duplicateOptions.allowDuplicate === true,
  "Duplicate options should allow add-anyway when configured",
);
assert(
  duplicateOptions.duplicateScope === "collection",
  "Duplicate options should support collection scope",
);

const caseInsensitiveDuplicateQuery = context.ankiDuplicateQuery(
  context.normalizeProfilePreferences({
    ankiDeckName: "Mining",
    ankiModelName: "Basic",
    ankiDuplicateScope: "deck",
  }),
  { front: "猫" },
  ["Front", "Back"],
);
assert(
  caseInsensitiveDuplicateQuery === '"deck:Mining" "front:猫"',
  "Duplicate queries should match Yomitan-style first-field lookups case-insensitively",
);

testNestedCardSkipsCurrentMediaCapture()
  .then(testAnkiBridgeRecoversAfterConnectTimeout)
  .then(testAnkiBridgeActions)
  .then(testPassiveAnkiStatusCoalesces)
  .then(testExportFastPathsPreserveDuplicateHandling)
  .then(testAnkiMediaSetupCachesProcessWork)
  .then(testStreamingSentenceAudioSources)
  .then(() => {
    console.log("anki integration tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
