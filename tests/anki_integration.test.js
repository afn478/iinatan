const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/20_dictionary_manifest.js",
  "src/main/55_anki_integration.js",
];
const overlayMessages = [];
const filesByPath = Object.create(null);
let fastTimers = false;

const context = {
  console,
  Date,
  Math,
  setTimeout(callback, delay) {
    if (fastTimers && Number(delay) < 50000) return setTimeout(callback, 0);
    if (Number(delay) >= 50000) return { ignored: true };
    return setTimeout(callback, delay);
  },
  clearTimeout(timer) {
    if (timer && timer.ignored) return;
    clearTimeout(timer);
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

async function testAnkiConnectRetries() {
  const previousExec = context.utils.exec;
  const hungCalls = [];
  fastTimers = true;
  setActiveAnkiPrefs(makeConfiguredAnkiPrefs({ ankiConnectTimeoutSeconds: 1 }));
  context.utils.exec = async (cmd, args) => {
    if (cmd === "/usr/bin/curl") {
      hungCalls.push(args.slice());
      return new Promise(() => {});
    }
    if (cmd === "/bin/rm") return { status: 0, stdout: "", stderr: "" };
    return previousExec(cmd, args);
  };
  try {
    await realAnkiConnectInvoke("version", {}, {});
    assert(false, "Hung AnkiConnect should fail after retries");
  } catch (error) {
    assert(
      /after 3 attempts in [0-9.]+ seconds \(timeout 1 seconds per attempt\)/.test(
        String(error && error.message),
      ),
      "Hung AnkiConnect should report the retry count and timeout",
    );
  }
  assert(
    hungCalls.length === 3,
    "Hung AnkiConnect should be retried with three fresh curl requests",
  );
  fastTimers = false;

  const curlCalls = [];
  setActiveAnkiPrefs(makeConfiguredAnkiPrefs({ ankiConnectTimeoutSeconds: 3 }));
  context.utils.exec = async (cmd, args) => {
    if (cmd === "/usr/bin/curl") {
      curlCalls.push(args.slice());
      return { status: 7, stdout: "", stderr: "Failed to connect" };
    }
    if (cmd === "/bin/rm") return { status: 0, stdout: "", stderr: "" };
    return previousExec(cmd, args);
  };
  try {
    await realAnkiConnectInvoke(
      "version",
      {},
      { url: "http://127.0.0.1:8765", timeoutSeconds: 20 },
    );
    assert(false, "Missing AnkiConnect should fail after retries");
  } catch (error) {
    assert(
      /after 3 attempts in [0-9.]+ seconds \(timeout 3 seconds per attempt\)/.test(
        String(error && error.message),
      ),
      "Missing AnkiConnect should report the retry count and timeout",
    );
  }
  assert(
    curlCalls.length === 3,
    "Missing AnkiConnect should be retried with three fresh curl requests",
  );
  assert(
    curlCalls.every((args) => {
      const connectIndex = args.indexOf("--connect-timeout");
      const maxIndex = args.indexOf("--max-time");
      return (
        connectIndex >= 0 &&
        args[connectIndex + 1] === "3" &&
        maxIndex >= 0 &&
        args[maxIndex + 1] === "3"
      );
    }),
    "AnkiConnect retry attempts should use the configured response timeout",
  );

  const actionErrorCalls = [];
  context.utils.exec = async (cmd, args) => {
    if (cmd === "/usr/bin/curl") {
      actionErrorCalls.push(args.slice());
      return {
        status: 0,
        stdout: JSON.stringify({ error: "bad action", result: null }),
        stderr: "",
      };
    }
    if (cmd === "/bin/rm") return { status: 0, stdout: "", stderr: "" };
    return previousExec(cmd, args);
  };
  try {
    await realAnkiConnectInvoke("badAction", {}, {});
    assert(false, "AnkiConnect action errors should be surfaced");
  } catch (error) {
    assert(
      /bad action/.test(String(error && error.message)),
      "AnkiConnect action errors should keep the original message",
    );
  }
  assert(
    actionErrorCalls.length === 1,
    "AnkiConnect action errors should not be retried as connection failures",
  );
  context.utils.exec = previousExec;
}

async function testAnkiBridgeRecoversAfterConnectTimeout() {
  const previousExec = context.utils.exec;
  setActiveAnkiPrefs(
    makeConfiguredAnkiPrefs({
      ankiConnectTimeoutSeconds: 1,
      ankiDuplicateCheck: false,
    }),
  );
  context.__overlayMessages.length = 0;
  fastTimers = true;
  context.utils.exec = async (cmd, args) => {
    if (cmd === "/usr/bin/curl") {
      return new Promise(() => {});
    }
    if (cmd === "/bin/rm") return { status: 0, stdout: "", stderr: "" };
    return previousExec(cmd, args);
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
  context.utils.exec = async (cmd, args) => {
    if (cmd === "/bin/rm") return { status: 0, stdout: "", stderr: "" };
    if (cmd === "/usr/bin/curl") {
      const dataIndex = args.indexOf("--data-binary");
      const requestRef =
        dataIndex >= 0 ? String(args[dataIndex + 1] || "") : "";
      const requestPath =
        requestRef.charAt(0) === "@" ? requestRef.slice(1) : "";
      const body = JSON.parse(filesByPath[requestPath] || "{}");
      if (body.action === "version")
        return {
          status: 0,
          stdout: JSON.stringify({ result: 6, error: null }),
          stderr: "",
        };
      if (body.action === "addNote")
        return {
          status: 0,
          stdout: JSON.stringify({ result: 67890, error: null }),
          stderr: "",
        };
      return {
        status: 0,
        stdout: JSON.stringify({ result: null, error: null }),
        stderr: "",
      };
    }
    return previousExec(cmd, args);
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
  context.utils.exec = previousExec;
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

const entry = {
  matched: "猫",
  term: {
    expression: "猫",
    reading: "ねこ",
    glossaries: [{ dict: "Jitendex", glossary: "cat; feline" }],
    frequencies: [
      { dict: "JPDB", frequencies: [{ value: 120, displayValue: "120" }] },
    ],
    pitches: [{ positions: [1] }],
  },
};
const cardContext = context.ankiCardContextFromPayload({
  context: {
    sentence: "私は猫です。",
    position: 2,
    expression: "猫",
    reading: "ねこ",
    surface: "猫",
    entry,
    result: {
      text: "私は猫です。",
      lookupStart: 2,
      lookupEnd: 3,
      language: "ja",
    },
  },
});
assert(
  cardContext.documentTitle === "猫の映画",
  "Document title should come from mpv metadata when available",
);
assert(
  cardContext.sourcePath === "/Movies/neko.mkv",
  "Source path should come from mpv",
);
assert(
  cardContext.timestamp === "1:23",
  "Timestamp should be formatted from mpv time-pos",
);
assert(
  cardContext.clozePrefix === "私は",
  "Cloze prefix should follow the subtitle position",
);
assert(
  cardContext.clozeBody === "猫",
  "Cloze body should contain the looked-up surface",
);
assert(
  cardContext.clozeSuffix === "です。",
  "Cloze suffix should preserve the rest of the subtitle",
);

const rendered = context.renderAnkiFields(
  {
    Expression: "{expression}",
    SelectionText: "{popup-selection-text}",
    Sentence: "{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}",
    SentenceAudio: "{sentence-audio}",
    ExpressionAudio: "{audio}",
    Picture: "{screenshot}",
    Glossary: "{glossary-first}",
    Frequency: "{frequencies}",
    PitchPosition: "{pitch-accent-positions}",
    MiscInfo: "{document-title} {timestamp}",
  },
  cardContext,
  {
    sentenceAudio: "iinatan-audio.mp3",
    wordAudio: "iinatan-word.mp3",
    screenshot: "iinatan-shot.jpg",
  },
);
assert(
  rendered.Expression === "猫",
  "Expression marker should render the headword",
);
assert(
  rendered.SelectionText === "",
  "Popup selection marker should stay empty when no popup text was manually selected",
);
assert(
  rendered.Sentence === "私は<b>猫</b>です。",
  "Cloze markers should allow HTML around the looked-up word",
);
assert(
  rendered.SentenceAudio === "[sound:iinatan-audio.mp3]",
  "Sentence audio marker should render Anki sound syntax",
);
assert(
  rendered.ExpressionAudio === "[sound:iinatan-word.mp3]",
  "Word audio marker should render separate Anki sound syntax",
);
assert(
  rendered.Picture === '<img src="iinatan-shot.jpg">',
  "Screenshot marker should render an image tag",
);
assert(
  rendered.Glossary ===
    '<div style="text-align: left;" class="yomitan-glossary"><i>(Jitendex)</i> cat; feline</div>',
  "First glossary marker should render the first definition with Yomitan-style glossary HTML",
);
assert(
  rendered.Frequency === "JPDB 120",
  "Frequency marker should include dictionary and display value",
);
assert(
  rendered.PitchPosition === "1",
  "Pitch position marker should render pitch positions",
);
assert(
  rendered.MiscInfo === "猫の映画 1:23",
  "Document metadata markers should render together",
);

const popupSelectionContext = context.ankiCardContextFromPayload({
  context: {
    sentence: "私は猫です。",
    position: 2,
    expression: "猫",
    reading: "ねこ",
    surface: "猫",
    popupSelectionText: "cat; feline",
    entry,
    result: {
      text: "私は猫です。",
      lookupStart: 2,
      lookupEnd: 3,
      language: "ja",
    },
  },
});
const popupSelectionRendered = context.renderAnkiFields(
  { SelectionText: "{popup-selection-text}" },
  popupSelectionContext,
  {},
);
assert(
  popupSelectionRendered.SelectionText === "cat; feline",
  "Popup selection marker should render manually selected popup text",
);

const singleGlossaryDatapointEntry = {
  matched: "猫",
  term: {
    expression: "猫",
    reading: "ねこ",
    glossaries: [
      {
        dict: "JMdict",
        definitionTags: "n",
        glossary: JSON.stringify(["cat", "feline"]),
      },
    ],
  },
};
const singleGlossaryDatapointContext = context.ankiCardContextFromPayload({
  context: {
    sentence: "猫だった。",
    position: 0,
    expression: "猫",
    reading: "ねこ",
    surface: "猫",
    entry: singleGlossaryDatapointEntry,
    result: {
      text: "猫だった。",
      lookupStart: 0,
      lookupEnd: 1,
      language: "ja",
    },
  },
});
const singleGlossaryDatapointRendered = context.renderAnkiFields(
  {
    FirstGlossary: "{glossary-first}",
    SelectedGlossary: "{selected-glossary}",
    FullGlossary: "{glossary}",
  },
  singleGlossaryDatapointContext,
  {},
);
assert(
  singleGlossaryDatapointRendered.FirstGlossary ===
    singleGlossaryDatapointRendered.SelectedGlossary,
  "Selected glossary should share the same renderer as glossary-first",
);
assert(
  singleGlossaryDatapointRendered.FirstGlossary ===
    singleGlossaryDatapointRendered.FullGlossary,
  "Single glossary datapoints should use the same renderer as the full glossary marker",
);
assert(
  /<i>\(n, JMdict\)<\/i> <ul><li>cat<\/li><li>feline<\/li><\/ul>/.test(
    singleGlossaryDatapointRendered.FirstGlossary,
  ),
  "Single glossary datapoints should still render their internal glossary array as a Yomitan-style list",
);
assert(
  !/<ol>/.test(singleGlossaryDatapointRendered.FirstGlossary),
  "Single glossary datapoints should not get an extra grouped-entry ordered list wrapper",
);

const jitendexStructuredGlossary = JSON.stringify([
  {
    type: "structured-content",
    content: [
      {
        tag: "div",
        data: { content: "sense-group" },
        content: [
          {
            tag: "span",
            title: "noun (common) (futsuumeishi)",
            data: { class: "tag", code: "n", content: "part-of-speech-info" },
            content: "noun",
          },
          {
            tag: "div",
            data: { content: "sense" },
            content: [
              {
                tag: "ul",
                data: { content: "glossary" },
                content: [
                  { tag: "li", content: "first love" },
                  { tag: "li", content: "puppy love" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
const structuredEntry = {
  matched: "初恋",
  term: {
    expression: "初恋",
    reading: "はつこい",
    glossaries: [
      {
        dict: "Jitendex.org [2026-06-06]",
        definitionTags: "n",
        glossary: jitendexStructuredGlossary,
      },
    ],
  },
};
const structuredContext = context.ankiCardContextFromPayload({
  context: {
    sentence: "初恋だった。",
    position: 0,
    expression: "初恋",
    reading: "はつこい",
    surface: "初恋",
    entry: structuredEntry,
    result: {
      text: "初恋だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const structuredRendered = context.renderAnkiFields(
  {
    MainDefinition: "{selected-glossary}",
    FullGlossary: "{glossary}",
    PlainGlossary: "{glossary-plain}",
    FirstGlossary: "{glossary-first}",
  },
  structuredContext,
  {},
);
assert(
  /class="yomitan-glossary"/.test(structuredRendered.MainDefinition),
  "Selected glossary should render as formatted glossary HTML",
);
assert(
  /<i>\(n, Jitendex\.org \[2026-06-06\]\)<\/i>/.test(
    structuredRendered.MainDefinition,
  ),
  "Selected glossary should retain Yomitan-style dictionary metadata",
);
assert(
  !/data-dictionary=/.test(structuredRendered.MainDefinition),
  "Selected single glossary HTML should not get the grouped-entry data-dictionary wrapper",
);
assert(
  /class="structured-content"/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should use Yomitan structured-content wrappers",
);
assert(
  /class="gloss-sc-ul" data-sc-content="glossary"/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve Yomitan data-sc attributes",
);
assert(
  !/data-content="glossary"/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should not emit non-Yomitan data-content attributes",
);
assert(
  /<li class="gloss-sc-li">first love<\/li>/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve list items with Yomitan classes",
);
assert(
  !/\[\{"type":/.test(structuredRendered.MainDefinition),
  "Selected glossary should not leak raw structured-content JSON",
);
assert(
  !/\[\{"type":/.test(structuredRendered.FullGlossary),
  "Full glossary should not leak raw structured-content JSON",
);
assert(
  structuredRendered.PlainGlossary === "first love\npuppy love",
  "Plain glossary should extract only glossary text from structured content",
);
assert(
  !/nounfirst/.test(structuredRendered.PlainGlossary),
  "Plain glossary should separate structured tags from definitions",
);
assert(
  structuredRendered.FirstGlossary === structuredRendered.MainDefinition,
  "Glossary-first should use the same single glossary HTML renderer as selected glossary",
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

testAnkiConnectRetries()
  .then(testAnkiBridgeRecoversAfterConnectTimeout)
  .then(testAnkiBridgeActions)
  .then(testPassiveAnkiStatusCoalesces)
  .then(() => {
    console.log("anki integration tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
