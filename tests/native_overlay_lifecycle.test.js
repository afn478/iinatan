const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function lifecycleContext(options) {
  const settings = options || {};
  const handlers = Object.create(null);
  const backend = deferred();
  const preferenceWrites = [];
  const clickableCalls = [];
  let backendCalls = 0;
  let intervalCalls = 0;
  const activeIntervals = new Set();
  let maxActiveIntervals = 0;
  let pollCalls = 0;
  let loadCalls = 0;
  const context = vm.createContext({
    VERSION: "test",
    enabled: false,
    initialized: false,
    overlayDocumentReady: false,
    overlayRuntimeState: "disabled",
    overlayLifecycleGeneration: 0,
    overlayEnableStartedAt: 0,
    overlayRuntimeReadyAt: 0,
    overlayFirstHitLayerAt: 0,
    overlayHitLayerReady: false,
    nativeGeometrySessionReady: false,
    profileReconfigurationStartedAt: 0,
    activeWorkerReady: null,
    workerStartInFlight: null,
    lookupBackendReadyForNativeHide: false,
    activeProfileBackendWarm: null,
    lastSubtitleCueIdentity: null,
    lastNativeLayoutFingerprint: "",
    nativeLayoutStablePolls: 0,
    lastNativePollInputIdentity: "",
    lastNativeSnapshotSettled: false,
    lastNativeSubtitleDiagnosticKey: "",
    pollTimer: null,
    activeSubtitlePollMs: 0,
    lastSubtitle: null,
    lookupInFlight: Object.create(null),
    nativeSubtitlePlaybackActive: false,
    nativeSubtitleLayoutTrigger: "startup",
    nativeSubtitleLayoutInvalidated: false,
    console: { log() {}, warn() {}, error() {} },
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Promise,
    setTimeout,
    clearTimeout,
    scheduleOneShot(callback, delay) {
      return setTimeout(callback, delay);
    },
    cancelOneShot(timer) {
      clearTimeout(timer);
    },
    setInterval(callback) {
      intervalCalls++;
      const timer = { callback, id: intervalCalls };
      activeIntervals.add(timer);
      maxActiveIntervals = Math.max(maxActiveIntervals, activeIntervals.size);
      return timer;
    },
    clearInterval(timer) {
      activeIntervals.delete(timer);
    },
    preferences: {
      set(key, value) {
        preferenceWrites.push([key, value]);
      },
      sync() {},
    },
    overlay: {
      onMessage(name, callback) {
        handlers[name] = callback;
      },
      loadFile() {
        loadCalls++;
      },
      setOpacity() {},
      setClickable(value) {
        clickableCalls.push(value);
      },
      show() {},
    },
    ensureOverlayBridge() {},
    debugLog() {},
    debugWarn() {},
    debugError() {},
    debugVerbose() {},
    logEnabled() {
      return true;
    },
    verboseLogEnabled() {
      return false;
    },
    compactError(error) {
      return String((error && error.message) || error);
    },
    handleLookupPopupOverlayReady() {},
    postToOverlay() {},
    overlayConfig() {
      return {};
    },
    replayActiveOverlayTask() {},
    pollSubtitle() {
      pollCalls++;
      if (typeof settings.pollSubtitle === "function")
        settings.pollSubtitle(context);
    },
    handleLookupAt() {},
    handleBridgeLookup() {},
    handleBridgeNestedLookup() {},
    handleBridgeAudioSource() {},
    handleLookupPopupVisibility() {},
    openExternalUrlFromOverlay() {},
    handleBridgeAnkiCardStatus() {},
    handleBridgeAnkiCardAdd() {},
    handleBridgeAnkiCardOpen() {},
    selectedLanguageModule() {
      return { id: "ja", label: "Japanese" };
    },
    activeDictionaryPaths() {
      return ["/dict"];
    },
    dictionarySetupMessage() {
      return "";
    },
    ensureBackendWorker() {
      backendCalls++;
      return backend.promise;
    },
    setOverlayStatus() {},
    syncNativeSubtitleVisibility() {},
    resetLookupPopupPause() {},
    advanceNativeSubtitleFontMetricGeneration() {},
    invalidateCurrentSubtitleLookupLine() {},
    invalidateExperimentalNativeLayout(reason) {
      context.nativeSubtitleLayoutTrigger = String(reason || "");
    },
    scheduleExperimentalNativeLayoutRebuild() {},
    advanceNativeAssGeometryGeneration() {},
    refreshPollingInterval() {},
    publishSubtitle() {},
    configuredSubtitlePollMs() {
      return 120;
    },
    prefNumber() {
      return 120;
    },
    prefBool(name, fallback) {
      if (
        settings.preferences &&
        Object.prototype.hasOwnProperty.call(settings.preferences, name)
      )
        return !!settings.preferences[name];
      return fallback;
    },
    rebuildMenu() {},
    acquireNativeSubtitleVisibilityOwnership() {},
    restoreNativeSubtitleVisibility() {},
    showOSD() {},
    currentMediaSourceSnapshot() {
      return { primary: { raw: "/video.mkv" } };
    },
    mpvStringProp(names) {
      if (names.indexOf("path") >= 0) return "/video.mkv";
      if (
        names.indexOf("sub-text") >= 0 ||
        names.indexOf("secondary-sub-text") >= 0
      )
        return "Subtitle";
      return "";
    },
  });
  const source = fs.readFileSync(
    path.join(root, "src/main/60_overlay_lifecycle_toggle.js"),
    "utf8",
  );
  vm.runInContext(
    source + "\nthis.lifecycleApi={setEnabled,overlayLifecycleSnapshot};",
    context,
  );
  return {
    context,
    handlers,
    backend,
    preferenceWrites,
    clickableCalls,
    get backendCalls() {
      return backendCalls;
    },
    get intervalCalls() {
      return intervalCalls;
    },
    get activeIntervals() {
      return activeIntervals.size;
    },
    get maxActiveIntervals() {
      return maxActiveIntervals;
    },
    get pollCalls() {
      return pollCalls;
    },
    get loadCalls() {
      return loadCalls;
    },
  };
}

async function testPersistedStartupAndIdempotence() {
  const harness = lifecycleContext();
  harness.context.lifecycleApi.setEnabled(true, {
    trigger: "persisted-startup",
  });
  assert.strictEqual(harness.context.enabled, true);
  assert.strictEqual(harness.context.overlayRuntimeState, "starting-helper");
  assert.strictEqual(harness.loadCalls, 1);
  assert.strictEqual(harness.backendCalls, 1);
  harness.context.setOverlayRuntimeState("enabling", "readiness-event");
  harness.context.lifecycleApi.setEnabled(true, {
    trigger: "duplicate-startup-event",
  });
  assert.strictEqual(harness.backendCalls, 1);
  assert.strictEqual(harness.intervalCalls, 1);
  harness.handlers.ready({});
  assert.strictEqual(harness.context.overlayDocumentReady, true);
  assert.strictEqual(harness.context.overlayRuntimeState, "starting-helper");
  assert.deepStrictEqual(harness.clickableCalls.slice(-2), [false, true]);
  harness.context.activeWorkerReady = { fingerprint: "ready" };
  harness.backend.resolve(harness.context.activeWorkerReady);
  await flushPromises();
  assert.strictEqual(harness.context.overlayRuntimeState, "ready");
  assert.strictEqual(harness.context.enabled, true);

  harness.context.lifecycleApi.setEnabled(true, { trigger: "repeat-enable" });
  assert.strictEqual(harness.backendCalls, 1);
  assert.strictEqual(harness.intervalCalls, 1);
  assert.strictEqual(harness.context.overlayRuntimeState, "ready");
}

async function testPersistedStartupReadinessOrdering() {
  const readiness = {
    file: false,
    track: false,
    source: false,
    timing: false,
    dimensions: false,
  };
  let geometryRequests = 0;
  const harness = lifecycleContext({
    preferences: {
      enabledByDefault: true,
      experimentalNativeSubtitleHitLayer: true,
    },
    pollSubtitle(context) {
      if (
        context.enabled &&
        context.overlayDocumentReady &&
        context.activeWorkerReady &&
        readiness.file &&
        readiness.track &&
        readiness.source &&
        readiness.timing &&
        readiness.dimensions &&
        geometryRequests === 0
      )
        geometryRequests++;
    },
  });
  const eventHandlers = Object.create(null);
  Object.assign(harness.context, {
    nativeSubtitlePropertyRebuildTimer: null,
    nativeExternalSrtCache: Object.create(null),
    nativeExternalSrtInFlight: Object.create(null),
    nativeExternalSrtGeneration: 0,
    lookupCache: Object.create(null),
    nativeSubVisibilityBeforeEnable: null,
    nativeSubtitleVisibilityOwned: false,
    registerShortcut() {},
    scheduleIINAAppearanceHintRefresh() {},
    prepareNativeSubtitlePrivateCueDirectory() {
      return Promise.resolve();
    },
    requestBackendWorkerStop() {},
    stopBackendWorker() {
      return Promise.resolve();
    },
    flushDebugLogBuffer() {},
    experimentalNativeSubtitleMode() {
      return true;
    },
    nativeSubtitleHitLayerMode() {
      return true;
    },
    event: {
      on(name, callback) {
        eventHandlers[name] = callback;
      },
    },
    core: { window: { loaded: false } },
  });
  vm.runInContext(
    fs.readFileSync(path.join(root, "src/main/99_bootstrap.js"), "utf8"),
    harness.context,
  );

  eventHandlers["iina.window-loaded"]();
  assert.strictEqual(harness.context.enabled, true);
  harness.handlers.ready({});
  readiness.file = true;
  eventHandlers["mpv.file-loaded"]();
  readiness.dimensions = true;
  eventHandlers["mpv.osd-dimensions.changed"]();
  readiness.timing = true;
  eventHandlers["mpv.sub-start.changed"]();
  readiness.track = true;
  eventHandlers["mpv.track-list.changed"]();
  harness.context.activeWorkerReady = { fingerprint: "ready" };
  harness.backend.resolve(harness.context.activeWorkerReady);
  await flushPromises();
  readiness.source = true;
  eventHandlers["mpv.stream-open-filename.changed"]();
  eventHandlers["mpv.stream-open-filename.changed"]();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(
    geometryRequests,
    1,
    "persisted startup rebuilds once all URL ASS prerequisites arrive",
  );
  assert.strictEqual(
    harness.backendCalls,
    1,
    "readiness events do not create duplicate native workers",
  );
  assert.strictEqual(
    harness.loadCalls,
    1,
    "readiness events do not create duplicate overlays",
  );
  assert.strictEqual(
    harness.maxActiveIntervals,
    1,
    "file-loaded replaces the startup poll interval instead of duplicating it",
  );
  assert.strictEqual(
    harness.preferenceWrites.length,
    0,
    "startup recovery never invokes or persists the toggle path",
  );

  const pollCallsBeforeClose = harness.pollCalls;
  eventHandlers["iina.window-will-close"]();
  eventHandlers["mpv.track-list.changed"]();
  eventHandlers["mpv.file-loaded"]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(harness.context.overlayRuntimeState, "shutting-down");
  assert.strictEqual(
    harness.pollCalls,
    pollCallsBeforeClose,
    "late mpv events must not restart polling during window teardown",
  );
}

function testPersistedDisabledStartup() {
  const harness = lifecycleContext();
  harness.context.lifecycleApi.setEnabled(false, {
    trigger: "persisted-startup",
  });
  assert.strictEqual(harness.context.enabled, false);
  assert.strictEqual(harness.context.overlayRuntimeState, "disabled");
  assert.strictEqual(harness.loadCalls, 1);
  assert.strictEqual(harness.backendCalls, 0);
  assert.strictEqual(harness.intervalCalls, 0);
  harness.context.lifecycleApi.setEnabled(false, {
    trigger: "duplicate-startup-event",
  });
  assert.strictEqual(harness.loadCalls, 1);
  assert.strictEqual(harness.backendCalls, 0);
  harness.handlers.ready({});
  assert.strictEqual(harness.context.overlayDocumentReady, true);
  assert.strictEqual(harness.context.overlayRuntimeState, "disabled");
  assert.strictEqual(harness.clickableCalls.at(-1), false);
}

async function testDisableInvalidatesPendingEnablement() {
  const harness = lifecycleContext();
  harness.context.lifecycleApi.setEnabled(true, { trigger: "startup" });
  harness.handlers.ready({});
  harness.context.lifecycleApi.setEnabled(false, {
    trigger: "shortcut",
    persist: true,
  });
  harness.context.activeWorkerReady = { fingerprint: "late" };
  harness.backend.resolve(harness.context.activeWorkerReady);
  await flushPromises();
  assert.strictEqual(harness.context.enabled, false);
  assert.strictEqual(harness.context.overlayRuntimeState, "disabled");
  assert.deepStrictEqual(harness.preferenceWrites, [
    ["enabledByDefault", false],
  ]);
}

async function testWorkerStopOwnsExactPid() {
  const files = new Map([
    ["/worker.pid", "101\n"],
    ["/ready", "{}"],
  ]);
  const dirsReady = deferred();
  const killed = [];
  const context = vm.createContext({
    workerStopInFlight: null,
    workerLifecycleGeneration: 0,
    workerProcessCreationCount: 0,
    workerProcessDestructionCount: 0,
    activeWorkerFingerprint: "old",
    activeWorkerReady: {},
    workerStartInFlight: null,
    nativeGeometrySessionReady: true,
    overlayHitLayerReady: true,
    enabled: true,
    file: {
      exists(name) {
        return files.has(name);
      },
      read(name) {
        return files.get(name);
      },
      write(name, value) {
        files.set(name, value);
      },
    },
    utils: {
      async exec(command, args) {
        killed.push([command, args]);
        return { status: 0 };
      },
    },
    workerPidPath() {
      return "/worker.pid";
    },
    workerStopPath() {
      return "/stop";
    },
    workerReadyPath() {
      return "/ready";
    },
    dataRoot() {
      return "/data";
    },
    ensureDataDirs() {
      return dirsReady.promise;
    },
    safeDelete(name) {
      files.delete(name);
    },
    sleep() {
      return Promise.resolve();
    },
    debugLog() {},
    debugWarn() {},
    invalidateExperimentalNativeLayout() {},
    setOverlayRuntimeState(next) {
      context.overlayRuntimeState = next;
    },
    compactError(error) {
      return String(error);
    },
  });
  const source = fs.readFileSync(
    path.join(root, "src/main/30_backend_import_worker_lookup.js"),
    "utf8",
  );
  vm.runInContext(
    source +
      "\nthis.workerApi={stopBackendWorker,markBackendWorkerUnavailable};",
    context,
  );
  const first = context.workerApi.stopBackendWorker();
  const second = context.workerApi.stopBackendWorker();
  assert.strictEqual(first, second);
  files.set("/worker.pid", "202\n");
  dirsReady.resolve();
  await first;
  assert.strictEqual(
    JSON.stringify(killed),
    JSON.stringify([["/bin/kill", ["-TERM", "101"]]]),
  );
  assert.strictEqual(files.get("/worker.pid"), "202\n");
  context.activeWorkerReady = {};
  context.activeWorkerFingerprint = "live";
  assert.strictEqual(
    context.workerApi.markBackendWorkerUnavailable(
      new Error("Native worker request timed out after 1000 ms"),
    ),
    true,
  );
  assert.strictEqual(context.activeWorkerReady, null);
  assert.strictEqual(context.nativeGeometrySessionReady, false);
  assert.strictEqual(context.overlayHitLayerReady, false);
  assert.strictEqual(context.overlayRuntimeState, "failed");
}

function testSettingsClassification() {
  const context = vm.createContext({
    debugLog() {},
  });
  const source =
    fs.readFileSync(
      path.join(root, "src/main/15_profile_settings.js"),
      "utf8",
    ) +
    "\n" +
    fs.readFileSync(
      path.join(root, "src/main/20_dictionary_manifest.js"),
      "utf8",
    );
  vm.runInContext(
    source +
      "\nthis.settingsApi={profileRuntimePlan,changedProfilePreferenceKeys};",
    context,
  );
  const popup = context.settingsApi.profileRuntimePlan(["popupScale"]);
  assert.strictEqual(popup.backendRestart, false);
  assert.strictEqual(popup.geometryCache, false);
  assert.strictEqual(popup.lookupCache, false);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(popup, "overlayReload"),
    false,
    "profile settings should hot-update the existing overlay document",
  );

  const validation = context.settingsApi.profileRuntimePlan([
    "experimentalNativeSubtitleValidation",
  ]);
  assert.strictEqual(validation.geometryCache, true);
  assert.strictEqual(validation.backendRestart, false);

  const hitBoxes = context.settingsApi.profileRuntimePlan([
    "experimentalNativeSubtitleHitBoxes",
  ]);
  assert.strictEqual(hitBoxes.hitLayer, true);
  assert.strictEqual(hitBoxes.geometryCache, false);
  assert.strictEqual(hitBoxes.backendRestart, false);

  const language = context.settingsApi.profileRuntimePlan(["lookupLanguage"]);
  assert.strictEqual(language.backendRestart, true);
  assert.strictEqual(language.lookupCache, true);
  assert.strictEqual(language.geometryCache, true);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(language, "overlayReload"),
    false,
    "language changes should not reload IINA's overlay WebView",
  );
}

function testBridgeHelloMarksOverlayReady() {
  let connectionHandler = null;
  let messageHandler = null;
  let stateHandler = null;
  const serverPorts = [];
  const overlayConfigs = [];
  const readiness = [];
  const layoutDiagnostics = [];
  const layoutPerformance = [];
  const warnings = [];
  const context = vm.createContext({
    overlayBridgeStarted: false,
    overlayBridgePort: 19741,
    overlayBridgeRecoveryCount: 0,
    overlayBridgeRecovering: false,
    overlayBridgeConnections: Object.create(null),
    overlayBridgeLastConnection: null,
    nextOverlayBridgePort(previousPort) {
      return previousPort + 1;
    },
    ws: {
      createServer(options) {
        serverPorts.push(options.port);
      },
      onStateUpdate(callback) {
        stateHandler = callback;
      },
      onNewConnection(callback) {
        connectionHandler = callback;
      },
      onConnectionStateUpdate() {},
      onMessage(callback) {
        messageHandler = callback;
      },
      startServer() {},
    },
    rememberOverlayBridgeConnection() {},
    forgetOverlayBridgeConnection() {},
    debugLog() {},
    debugVerbose() {},
    debugWarn(message) {
      warnings.push(message);
    },
    postToOverlay(name, payload) {
      if (name === "config") overlayConfigs.push(payload);
    },
    overlayConfig() {
      return { overlayBridgePort: context.overlayBridgePort };
    },
    compactError(error) {
      return String(error);
    },
    handleOverlayDocumentReady(payload, source) {
      readiness.push({ payload, source });
    },
    handleLookupPopupVisibility() {},
    handleBridgeLookup() {},
    handleBridgeAudioSource() {},
    handleBridgeAnkiCardStatus() {},
    handleBridgeAnkiCardAdd() {},
    handleBridgeAnkiCardOpen() {},
    openExternalUrlFromOverlay() {},
    handleNativeLayoutDiagnostic(payload) {
      layoutDiagnostics.push(payload);
    },
    handleNativeLayoutPerformance(payload) {
      layoutPerformance.push(payload);
    },
  });
  const source = fs.readFileSync(
    path.join(root, "src/main/50_overlay_bridge_pause.js"),
    "utf8",
  );
  vm.runInContext(source + "\nensureOverlayBridge();", context);
  assert.strictEqual(typeof connectionHandler, "function");
  assert.deepStrictEqual(serverPorts, [19741]);
  connectionHandler("connection", { path: "127.0.0.1:12345" });
  assert.strictEqual(readiness.length, 1);
  assert.strictEqual(readiness[0].source, "bridge-connection");
  assert.strictEqual(typeof messageHandler, "function");
  messageHandler("connection", {
    text() {
      return JSON.stringify({ type: "hello", source: "overlay" });
    },
  });
  assert.strictEqual(readiness.length, 2);
  assert.strictEqual(readiness[1].source, "bridge-hello");
  messageHandler("connection", {
    text() {
      return JSON.stringify({
        type: "native-layout-diagnostic",
        reason: "accepted-layout",
      });
    },
  });
  assert.strictEqual(layoutDiagnostics.length, 1);
  assert.strictEqual(layoutDiagnostics[0].reason, "accepted-layout");
  messageHandler("connection", {
    text() {
      return JSON.stringify({
        type: "native-layout-performance",
        hitTargetCount: 12,
      });
    },
  });
  assert.strictEqual(layoutPerformance.length, 1);
  assert.strictEqual(layoutPerformance[0].hitTargetCount, 12);
  messageHandler("connection", {
    text() {
      return JSON.stringify({ type: "future-message" });
    },
  });
  assert(
    warnings.some((message) => /future-message/.test(message)),
    "unknown overlay bridge messages should be reported",
  );
  stateHandler("failed", { message: "Address already in use" });
  assert.deepStrictEqual(
    serverPorts,
    [19741, 19742],
    "a failed listener should retry on a different port",
  );
  assert.strictEqual(overlayConfigs.at(-1).overlayBridgePort, 19742);
}

(async () => {
  await testPersistedStartupAndIdempotence();
  await testPersistedStartupReadinessOrdering();
  testPersistedDisabledStartup();
  await testDisableInvalidatesPendingEnablement();
  await testWorkerStopOwnsExactPid();
  testSettingsClassification();
  testBridgeHelloMarksOverlayReady();
  console.log("native overlay lifecycle tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
