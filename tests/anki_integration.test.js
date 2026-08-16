const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/05_media_source.js",
  "src/main/10_subtitle_text_style.js",
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
  debugVerbose() {},
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

async function testOverlayBridgePromiseSemantics() {
  const sends = [];
  let resultForConnection = {
    connected: "success",
    stale: "no_connection",
  };
  const iinaConsole = { log() {}, info() {}, warn() {}, error() {} };
  const bridgeContext = vm.createContext({
    Date,
    JSON,
    Math,
    Object,
    Promise,
    String,
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
    iina: {
      core: {},
      mpv: {},
      event: {},
      overlay: {},
      menu: {},
      input: {},
      ws: {
        sendText(connection, message) {
          sends.push({ connection, message });
          const result = resultForConnection[String(connection)];
          return result instanceof Error
            ? Promise.reject(result)
            : Promise.resolve(result);
        },
      },
      preferences: {},
      console: iinaConsole,
      file: {},
      http: {},
      utils: {},
      standaloneWindow: {},
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "src/main/00_context_state_paths.js"),
      "utf8",
    ) +
      "\nthis.__bridgeTransport={rememberOverlayBridgeConnection,postToOverlayBridge,connections:()=>Object.keys(overlayBridgeConnections)};",
    bridgeContext,
  );
  const transport = bridgeContext.__bridgeTransport;
  transport.rememberOverlayBridgeConnection("connected");
  transport.rememberOverlayBridgeConnection("stale");
  const sent = await transport.postToOverlayBridge({ type: "anki-card-state" });
  assert(
    sent === true &&
      sends.length === 2 &&
      transport.connections().join(",") === "connected",
    "IINA WebSocket sends should count only resolved success values and forget no_connection results",
  );
  resultForConnection = { connected: new Error("socket closed") };
  const rejected = await transport.postToOverlayBridge({ type: "retry" });
  assert(
    rejected === false && transport.connections().length === 0,
    "Rejected IINA sendText promises should be observed and remove dead connections",
  );
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
    if (action === "findNotes") return Promise.resolve([23456, 12345]);
    if (action === "guiBrowse") return Promise.resolve(null);
    return Promise.resolve(null);
  };
  context.handleBridgeAnkiCardOpen({
    requestId: "open-known",
    noteIds: [12345, 23456],
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [] } },
    },
  });
  await flushAsyncWork();
  assert(
    openCalls.some(
      (call) =>
        call.action === "guiBrowse" && call.params.query === "nid:12345,23456",
    ),
    "Open requests should browse every known duplicate note ID",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.requestId === "open-known" &&
        message.payload.state === "opened",
    ),
    "Open requests should report opened after guiBrowse and foreground activation succeed",
  );

  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = (action) =>
    Promise.resolve(action === "findNotes" ? [] : null);
  context.handleBridgeAnkiCardOpen({
    requestId: "open-deleted",
    noteIds: [12345],
    context: {
      expression: "猫",
      entry: { term: { expression: "猫" } },
    },
  });
  await flushAsyncWork();
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.requestId === "open-deleted" &&
        message.payload.state === "error" &&
        message.payload.staleNoteIds === true,
    ),
    "Deleted reveal targets should be identified as stale note IDs",
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
  await flushAsyncWork();
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
    if (action === "guiBrowse") return Promise.resolve([70002]);
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

  setActiveAnkiPrefs(
    makeConfiguredAnkiPrefs({
      ankiConnectUrl: "http://127.0.0.1:18763",
    }),
  );
  const activeDeliveryCalls = [];
  let releaseActivePreflight = null;
  const activePreflight = new Promise((resolve) => {
    releaseActivePreflight = resolve;
  });
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = async (action, params, options) => {
    activeDeliveryCalls.push({ action, params, options });
    if (action === "modelFieldNames") return ["Front", "Back"];
    if (action === "multi") {
      await activePreflight;
      return [
        { result: [{ canAdd: true, error: null }], error: null },
        { result: [], error: null },
      ];
    }
    if (action === "addNote") return 49999;
    return null;
  };
  const activeDeliveryPayload = {
    type: "anki-card-add",
    requestId: "active-channel-delivery",
    popupSessionId: "popup-active",
    context: {
      expression: "犬",
      entry: { term: { expression: "犬", glossaries: [{ glossary: "dog" }] } },
    },
  };
  context.handleBridgeAnkiCardAdd(activeDeliveryPayload);
  await flushAsyncWork();
  context.handleBridgeAnkiCardAdd(
    Object.assign({}, activeDeliveryPayload, { bridgeTransport: "native" }),
  );
  await flushAsyncWork();
  releaseActivePreflight();
  await flushAsyncWork();
  assert(
    activeDeliveryCalls.filter((call) => call.action === "multi").length ===
      1 &&
      activeDeliveryCalls.filter((call) => call.action === "addNote").length ===
        1,
    "Duplicate channel delivery while a request is active should execute its preflight and addNote only once",
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
  context.__overlayMessages.length = 0;
  context.handleBridgeAnkiCardAdd({
    requestId: "anki-1",
    popupSessionId: "popup-a",
    context: reusedContext,
  });
  await flushAsyncWork();
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.popupSessionId === "popup-a" &&
        message.payload.state === "added" &&
        message.payload.ack !== true,
    ),
    "Completed duplicate deliveries should replay the final result rather than only acknowledging it",
  );
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

  setActiveAnkiPrefs(
    makeConfiguredAnkiPrefs({
      ankiConnectUrl: "http://127.0.0.1:18764",
      ankiDuplicateMode: "allow",
    }),
  );
  const allowPrimaryCalls = [];
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = async (action, params, options) => {
    allowPrimaryCalls.push({ action, params, options });
    if (action === "multi")
      return [
        {
          result: [
            {
              canAdd: false,
              error: "cannot create note because it is a duplicate",
            },
          ],
          error: null,
        },
        { result: [12345, 23456], error: null },
      ];
    if (action === "findNotes") return [23456, 12345];
    if (action === "guiBrowse") return null;
    if (action === "addNote")
      throw new Error("Allow-mode primary duplicate must not be added");
    return null;
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "allow-primary-error-state",
    popupSessionId: "popup-force",
    duplicateKnown: "",
    noteIds: [],
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  });
  await flushAsyncWork();
  assert(
    !allowPrimaryCalls.some((call) => call.action === "addNote") &&
      allowPrimaryCalls.some(
        (call) =>
          call.action === "guiBrowse" &&
          call.params.query === "nid:12345,23456",
      ) &&
      context.__overlayMessages.some(
        (message) =>
          message.payload &&
          message.payload.requestId === "allow-primary-error-state" &&
          message.payload.state === "opened",
      ),
    "An allow-mode primary click from an unknown/error state should authoritatively detect and reveal duplicates",
  );

  const forceAddCalls = [];
  let forcedNoteId = 56788;
  context.__overlayMessages.length = 0;
  context.ankiConnectInvoke = async (action, params, options) => {
    forceAddCalls.push({ action, params, options });
    if (action === "addNote") return ++forcedNoteId;
    return null;
  };
  context.handleBridgeAnkiCardAdd({
    requestId: "force-add",
    popupSessionId: "popup-force",
    forceDuplicate: true,
    duplicateKnown: "duplicate",
    noteIds: [12345, 23456],
    context: {
      expression: "猫",
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  });
  await flushAsyncWork();
  const forcedAdd = forceAddCalls.find((call) => call.action === "addNote");
  assert(
    forcedAdd && forcedAdd.params.note.options.allowDuplicate === true,
    "Force-add requests should submit addNote with duplicate allowance",
  );
  assert(
    !forceAddCalls.some(
      (call) =>
        call.action === "canAddNotesWithErrorDetail" ||
        call.action === "findNotes",
    ),
    "Force-add requests should bypass duplicate preflights",
  );
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.state === "added" &&
        message.payload.forceDuplicate === true &&
        message.payload.noteIds.join(",") === "12345,23456,56789",
    ),
    "Force-add responses should merge existing and newly added note IDs",
  );
  context.__overlayMessages.length = 0;
  context.handleBridgeAnkiCardAdd({
    requestId: "force-add-again",
    popupSessionId: "popup-force",
    forceDuplicate: true,
    duplicateKnown: "duplicate",
    noteIds: [12345, 23456, 56789],
    context: reusedContext,
  });
  await flushAsyncWork();
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.requestId === "force-add-again" &&
        message.payload.state === "added" &&
        message.payload.noteIds.join(",") === "12345,23456,56789,56790",
    ),
    "Repeated force-add requests should retain every known note ID",
  );
  context.__overlayMessages.length = 0;
  context.handleBridgeAnkiCardAdd({
    requestId: "force-add-unconfirmed",
    popupSessionId: "popup-force",
    forceDuplicate: true,
    duplicateKnown: "ready",
    noteIds: [12345],
    context: reusedContext,
  });
  await flushAsyncWork();
  assert(
    forceAddCalls.filter((call) => call.action === "addNote").length === 2 &&
      context.__overlayMessages.some(
        (message) =>
          message.payload &&
          message.payload.requestId === "force-add-unconfirmed" &&
          message.payload.ok === false &&
          /Confirm the existing Anki card/i.test(message.payload.message || ""),
      ),
    "Force-add should reject payloads that do not carry a confirmed duplicate state",
  );

  setActiveAnkiPrefs(makeConfiguredAnkiPrefs());
  context.__overlayMessages.length = 0;
  context.handleBridgeAnkiCardAdd({
    requestId: "force-add-disabled",
    forceDuplicate: true,
    context: reusedContext,
  });
  await flushAsyncWork();
  assert(
    context.__overlayMessages.some(
      (message) =>
        message.payload &&
        message.payload.requestId === "force-add-disabled" &&
        message.payload.ok === false &&
        /not enabled/i.test(message.payload.message || ""),
    ),
    "Force-add requests should be rejected unless allow mode is active",
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

async function testPassiveAnkiStatusDefersWithoutFalseReady() {
  setActiveAnkiPrefs(
    makeConfiguredAnkiPrefs({
      ankiConnectUrl: "http://127.0.0.1:18766",
      ankiDuplicateCheck: true,
    }),
  );
  vm.runInContext(
    "ankiStatusCache = Object.create(null); ankiStatusInFlight = Object.create(null); ankiStatusQueue = []; ankiStatusActiveCount = 0;",
    context,
  );
  const previousInvoke = context.ankiConnectInvoke;
  let releaseChecks = null;
  let duplicateRetry = false;
  const checksBlocked = new Promise((resolve) => {
    releaseChecks = resolve;
  });
  context.ankiConnectInvoke = async (action) => {
    if (action === "version") return 6;
    if (action === "canAddNotesWithErrorDetail") {
      if (!duplicateRetry) await checksBlocked;
      return [
        duplicateRetry
          ? {
              canAdd: false,
              error: "cannot create note because it is a duplicate",
            }
          : { canAdd: true, error: null },
      ];
    }
    if (action === "findNotes") return [88019];
    return null;
  };
  const statusPromises = [];
  for (let index = 0; index < 19; index++) {
    statusPromises.push(
      context.ankiCardStatusForContext({
        context: {
          expression: "queued-" + String(index),
          entry: {
            term: {
              expression: "queued-" + String(index),
              glossaries: [{ glossary: "queued" }],
            },
          },
        },
      }),
    );
  }
  const deferred = await statusPromises[18];
  assert(
    deferred.state === "deferred" && deferred.state !== "ready",
    "A saturated passive queue should defer instead of fabricating a ready result",
  );
  releaseChecks();
  await Promise.all(statusPromises.slice(0, 18));
  duplicateRetry = true;
  const retried = await context.ankiCardStatusForContext({
    context: {
      expression: "queued-18",
      entry: {
        term: {
          expression: "queued-18",
          glossaries: [{ glossary: "queued" }],
        },
      },
    },
  });
  assert(
    retried.state === "duplicate" && retried.noteIds[0] === 88019,
    "A deferred passive status should retry to the authoritative duplicate result",
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
        .length === 2 &&
        calls.filter((action) => action === "addNote").length === 1,
      "A prevent-mode add should authoritatively recheck a cached ready preflight",
    );
    setActiveAnkiPrefs(
      makeConfiguredAnkiPrefs({
        ankiConnectUrl: "http://127.0.0.1:28765",
        ankiDuplicateCheck: false,
      }),
    );
    const uncheckedStatus = await context.ankiCardStatusForContext({
      context: cardContext,
    });
    assert(
      uncheckedStatus.state === "ready" && !uncheckedStatus.duplicate,
      "Disabling duplicate checks should ignore previously cached duplicate hints",
    );

    setActiveAnkiPrefs(
      makeConfiguredAnkiPrefs({
        ankiConnectUrl: "http://127.0.0.1:28766",
        ankiDuplicateMode: "allow",
      }),
    );
    calls = [];
    let allowPrimaryOptions = null;
    context.ankiConnectInvoke = async (action, params) => {
      calls.push(action);
      if (action === "multi")
        return [
          { result: [{ canAdd: true, error: null }], error: null },
          { result: [], error: null },
        ];
      if (action === "addNote") {
        allowPrimaryOptions = params.note.options;
        return 60002;
      }
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
        calls.includes("multi") &&
        allowPrimaryOptions &&
        allowPrimaryOptions.allowDuplicate === false,
      "Allow-mode primary adds should preflight and keep Anki's duplicate protection enabled",
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
      if (action === "guiBrowse") return [70003];
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

async function testDirectWordAudioSourceExport() {
  const hadCandidateResolver = Object.prototype.hasOwnProperty.call(
    context,
    "fetchAudioSourceCandidates",
  );
  const previousCandidateResolver = context.fetchAudioSourceCandidates;
  const previousInvoke = context.ankiConnectInvoke;
  const storeRequests = [];
  context.fetchAudioSourceCandidates = async () => {
    const error = new Error("Audio source did not return JSON");
    error.audioSourceResponseNotJson = true;
    throw error;
  };
  context.ankiConnectInvoke = async (action, params) => {
    storeRequests.push({ action, params: Object.assign({}, params) });
    return params.filename;
  };
  try {
    const podPrefs = {
      ankiConnectUrl: "http://127.0.0.1:8765",
      lookupLanguage: "ja",
      audioSourcesJson: JSON.stringify([
        {
          url: "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={term}&kana={reading}",
        },
      ]),
    };
    const podFilename = await context.ankiStoreWordAudio(
      { expression: "猫", reading: "ねこ" },
      podPrefs,
    );
    assert(
      podFilename &&
        storeRequests[0].action === "storeMediaFile" &&
        storeRequests[0].params.url.includes(
          "kanji=%E7%8C%AB&kana=%E3%81%AD%E3%81%93",
        ) &&
        storeRequests[0].params.skipHash === "7e2c2f954ef6051373ba916f000168dc",
      "JapanesePod101 direct audio should export with its unavailable-placeholder hash",
    );

    context.ankiConnectInvoke = async () => null;
    const unavailableFilename = await context.ankiStoreWordAudio(
      { expression: "どうしよう", reading: "どうしよう" },
      podPrefs,
    );
    assert(
      unavailableFilename === "",
      "Rejected JapanesePod101 placeholder audio should not be referenced by the Anki card",
    );

    storeRequests.length = 0;
    context.ankiConnectInvoke = async (action, params) => {
      storeRequests.push({ action, params: Object.assign({}, params) });
      return params.skipHash ? null : params.filename;
    };
    const fallbackFilename = await context.ankiStoreWordAudio(
      { expression: "どうしよう", reading: "どうしよう" },
      Object.assign({}, podPrefs, {
        audioSourcesJson: JSON.stringify([
          JSON.parse(podPrefs.audioSourcesJson)[0],
          { url: "https://audio.invalid/backup/{term}.mp3" },
        ]),
      }),
    );
    assert(
      fallbackFilename &&
        storeRequests.length === 2 &&
        storeRequests[1].params.url.includes("audio.invalid/backup/"),
      "Rejected JapanesePod101 placeholder audio should fall through to the next export source",
    );

    storeRequests.length = 0;
    context.ankiConnectInvoke = async (action, params) => {
      storeRequests.push({ action, params: Object.assign({}, params) });
      return params.filename;
    };
    const genericFilename = await context.ankiStoreWordAudio(
      { expression: "chat", reading: "" },
      {
        ankiConnectUrl: "http://127.0.0.1:8765",
        lookupLanguage: "fr",
        audioSourcesJson: JSON.stringify([
          { url: "https://audio.invalid/pronounce?term={term}" },
        ]),
      },
    );
    assert(
      genericFilename &&
        storeRequests[0].params.url ===
          "https://audio.invalid/pronounce?term=chat" &&
        !Object.prototype.hasOwnProperty.call(
          storeRequests[0].params,
          "skipHash",
        ),
      "Generic direct audio endpoints should export without source-specific metadata",
    );

    const localSource = {
      url: "http://127.0.0.1:5050/?term={term}&reading={reading}",
    };
    const selectablePrefs = {
      ankiConnectUrl: "http://127.0.0.1:8765",
      lookupLanguage: "ja",
      audioSourcesJson: JSON.stringify([
        { url: "https://audio.invalid/default/{term}.mp3" },
        localSource,
      ]),
    };
    context.fetchAudioSourceCandidates = async (sourceUrl) => {
      assert(
        sourceUrl.includes("127.0.0.1:5050"),
        "A primary audio choice should resolve only its selected source",
      );
      return [
        { name: "Voice 1", url: "http://127.0.0.1:5050/voice-1.mp3" },
        { name: "Voice 2", url: "http://127.0.0.1:5050/voice-2.mp3" },
      ];
    };
    storeRequests.length = 0;
    const selectedFilename = await context.ankiStoreWordAudio(
      {
        expression: "読む",
        reading: "よむ",
        wordAudioSelection: {
          sourceIndex: 1,
          sourceUrl: localSource.url,
          candidateIndex: 1,
        },
      },
      selectablePrefs,
    );
    assert(
      selectedFilename &&
        storeRequests.length === 1 &&
        storeRequests[0].params.url === "http://127.0.0.1:5050/voice-2.mp3",
      "An exact primary clip should override the normal first-available export order",
    );

    storeRequests.length = 0;
    const selectedSourceFilename = await context.ankiStoreWordAudio(
      {
        expression: "読む",
        reading: "よむ",
        wordAudioSelection: {
          sourceIndex: 1,
          sourceUrl: localSource.url,
          candidateIndex: null,
        },
      },
      selectablePrefs,
    );
    assert(
      selectedSourceFilename &&
        storeRequests.length === 1 &&
        storeRequests[0].params.url === "http://127.0.0.1:5050/voice-1.mp3",
      "A source-level primary choice should export its first available clip",
    );

    storeRequests.length = 0;
    context.ankiConnectInvoke = async (action, params) => {
      storeRequests.push({ action, params: Object.assign({}, params) });
      return null;
    };
    const unavailableSelection = await context.ankiStoreWordAudio(
      {
        expression: "読む",
        reading: "よむ",
        wordAudioSelection: {
          sourceIndex: 1,
          sourceUrl: localSource.url,
          candidateIndex: 1,
        },
      },
      selectablePrefs,
    );
    assert(
      unavailableSelection === "" && storeRequests.length === 1,
      "An unavailable explicit clip should not silently export a different recording",
    );
  } finally {
    context.ankiConnectInvoke = previousInvoke;
    if (hadCandidateResolver)
      context.fetchAudioSourceCandidates = previousCandidateResolver;
    else delete context.fetchAudioSourceCandidates;
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
      "options/sub-delay": String(settings.subtitleDelay || 0),
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
    installCacheCommand({ cacheHit: false, subtitleDelay: 1.75 });

    context.currentMediaSourceSnapshot = () =>
      context.mediaSourceSnapshot({
        path: "/Volumes/Media/video.mkv",
        streamOpenFilename: "/Volumes/Media/video.mkv",
      });
    await context.ankiCaptureSentenceAudio(cardContext, prefs);
    const delayedDirectSeek =
      execCalls[0].args[execCalls[0].args.indexOf("-ss") + 1];
    assert(
      mpvCommands.some((item) => item.name === "dump-cache") &&
        execCalls[0].args.includes("/Volumes/Media/video.mkv") &&
        delayedDirectSeek === "11.750",
      "Local sentence audio applies mpv's subtitle delay before direct FFmpeg extraction",
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

testOverlayBridgePromiseSemantics()
  .then(testNestedCardSkipsCurrentMediaCapture)
  .then(testAnkiBridgeRecoversAfterConnectTimeout)
  .then(testAnkiBridgeActions)
  .then(testPassiveAnkiStatusCoalesces)
  .then(testPassiveAnkiStatusDefersWithoutFalseReady)
  .then(testExportFastPathsPreserveDuplicateHandling)
  .then(testAnkiMediaSetupCachesProcessWork)
  .then(testDirectWordAudioSourceExport)
  .then(testStreamingSentenceAudioSources)
  .then(() => {
    console.log("anki integration tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
