async function testBackendLookup() {
  const result = await lookupAtPosition(
    "魔法をかけられるのは魔法使いだけだ",
    0,
  );
  const count = result && result.results ? result.results.length : 0;
  alert(
    "Lookup test returned " +
      count +
      " result(s). Top match: " +
      (count ? result.results[0].matched : "none"),
  );
}
async function restartBackendWorkerFromMenu() {
  const language = selectedLanguageModule();
  await stopBackendWorker();
  await ensureBackendWorker(activeDictionaryPaths(language), language);
  alert("Dictionary lookup restarted for " + language.label + ".");
}
async function stopBackendWorkerFromMenu() {
  await stopBackendWorker();
  alert("Dictionary lookup stopped.");
}
function showInstalledDictionaries() {
  const dicts = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  if (!dicts.length) {
    alert(
      "No dictionaries installed yet. Download recommended dictionaries or import a Yomitan dictionary ZIP.",
    );
    return;
  }
  alert(
    "Installed dictionaries:\n\n" +
      dicts
        .map((d) => (disabled[d.name] ? "[off] " : "[on] ") + d.name)
        .join("\n"),
  );
}
function emitDebugLogTestMessage() {
  debugLog(
    "DEBUG TEST: plugin main log path works; enabled=" +
      String(enabled) +
      " lineId=" +
      currentSubtitleLineId +
      " bridgePort=" +
      overlayBridgePort,
  );
  debugWarn("DEBUG TEST: warning level message");
  debugError("DEBUG TEST: error level message");
  flushDebugLogBuffer();
  alert(
    "Debug log test messages were emitted. Use Reveal Debug Log File to inspect debug.log.",
  );
}
function runtimeDiagnosticsSnapshot() {
  const manifest = readManifest();
  const language = selectedLanguageModule();
  return {
    version: VERSION,
    overlay: overlayLifecycleSnapshot(),
    activeProfile: manifest.activeProfileId || DEFAULT_PROFILE_ID,
    language: language ? language.id : "",
    worker: {
      ready: !!activeWorkerReady,
      generation: workerLifecycleGeneration,
      starts: workerProcessCreationCount,
      stops: workerProcessDestructionCount,
    },
    subtitleTracks: {
      primary: mpvStringProp(["sid"], ""),
      secondary: mpvStringProp(["secondary-sid"], ""),
    },
    queues: {
      lookups: Object.keys(lookupInFlight).length,
      fontMetrics: Object.keys(nativeSubtitleFontMetricInFlight).length,
      geometry: Object.keys(nativeAssGeometryInFlight).length,
      anki: ankiStatusQueuedCount,
    },
    caches: {
      lookups: Object.keys(lookupCache).length,
      fontMetrics: Object.keys(nativeSubtitleFontMetricCache).length,
      geometry: Object.keys(nativeAssGeometryCache).length,
      externalSrt: Object.keys(nativeExternalSrtCache).length,
      ankiModels: Object.keys(ankiModelFieldCache).length,
      ankiStatus: Object.keys(ankiStatusCache).length,
      geometryStats: Object.assign({}, nativeAssGeometryStats),
    },
    timers: {
      subtitlePoll: pollTimer !== null,
      popupPause: lookupPopupPauseResumeTimer !== null,
      logFlush: debugLogFlushTimer !== null,
    },
    bridgeConnections: Object.keys(overlayBridgeConnections).length,
  };
}
function emitRuntimeDiagnosticsSnapshot() {
  debugLog("runtime snapshot " + JSON.stringify(runtimeDiagnosticsSnapshot()));
  flushDebugLogBuffer();
  alert("Runtime diagnostics snapshot written to debug.log.");
}
function revealPathInFinder(path, label) {
  const p = String(path || "");
  if (!p) throw new Error("No path provided.");
  try {
    if (utils && typeof utils.open === "function" && utils.open(p)) {
      debugLog(
        "revealed " +
          String(label || "path") +
          " via utils.open path=" +
          JSON.stringify(p),
      );
      return;
    }
  } catch (error) {
    debugWarn(
      "utils.open failed for " +
        String(label || "path") +
        ": " +
        compactError(error),
    );
  }
  try {
    if (file && typeof file.showInFinder === "function") {
      const shown = file.showInFinder(p);
      if (shown !== false) {
        debugLog(
          "revealed " +
            String(label || "path") +
            " via file.showInFinder path=" +
            JSON.stringify(p),
        );
        return;
      }
    }
  } catch (error) {
    debugWarn(
      "file.showInFinder failed for " +
        String(label || "path") +
        ": " +
        compactError(error),
    );
  }
  throw new Error("Could not reveal " + String(label || "path") + ": " + p);
}
function revealDebugLogFile() {
  try {
    const p = dataPath("debug.log");
    flushDebugLogBuffer();
    if (!file.exists(p)) file.write(p, "");
    revealPathInFinder(p, "debug log file");
  } catch (error) {
    alert("Could not reveal debug.log: " + compactError(error));
  }
}
function revealPluginDataFolder() {
  try {
    revealPathInFinder(dataRoot(), "plugin data folder");
  } catch (error) {
    alert("Could not reveal plugin data folder: " + compactError(error));
  }
}

function reportMenuActionError(label, error) {
  const msg =
    String(label || "Menu action") + " failed: " + compactError(error);
  debugError(msg);
  alert(msg);
}
function runMenuAction(label, action) {
  return () => {
    const actionLabel = String(label || "Menu action");
    debugLog("menu action clicked: " + actionLabel);
    try {
      const result = action();
      if (isPromiseLike(result))
        result.catch((error) => reportMenuActionError(actionLabel, error));
    } catch (error) {
      reportMenuActionError(actionLabel, error);
    }
  };
}
function addMenuCommand(parent, title, action, options) {
  addSubMenuItemCompat(
    parent,
    menu.item(title, runMenuAction(title, action), options),
  );
}
function addDebugMenuItem(parent, title, action, options) {
  addMenuCommand(parent, title, action, options);
}

function rebuildMenu() {
  try {
    menu.removeAllItems();
  } catch (_) {}
  try {
    const rootMenu = menu.item("iinatan");
    addMenuCommand(rootMenu, "Settings...", () => {
      openDictionaryManager();
    });
    addSubMenuItemCompat(rootMenu, menu.separator());
    addSubMenuItemCompat(
      rootMenu,
      menu.item("Profiles", null, { enabled: false }),
    );
    const profiles = profileSummaries(readManifest());
    const inlineProfileLimit = 5;
    const addProfileMenuItem = (parent, profile) => {
      addMenuCommand(
        parent,
        profile.name,
        () => {
          setActiveDictionaryProfile(profile.id);
        },
        { selected: !!profile.active },
      );
    };
    profiles.slice(0, inlineProfileLimit).forEach((profile) => {
      addProfileMenuItem(rootMenu, profile);
    });
    if (profiles.length > inlineProfileLimit) {
      const moreMenu = menu.item("More");
      profiles.slice(inlineProfileLimit).forEach((profile) => {
        addProfileMenuItem(moreMenu, profile);
      });
      addSubMenuItemCompat(rootMenu, moreMenu);
    }

    addSubMenuItemCompat(rootMenu, menu.separator());
    const debugMenu = menu.item("Debug");
    addDebugMenuItem(debugMenu, "Test File Picker API", () =>
      testFilePickerApiFromMenu(),
    );
    addDebugMenuItem(debugMenu, "Test Dictionary Lookup", () =>
      testBackendLookup(),
    );
    addDebugMenuItem(debugMenu, "Restart Dictionary Lookup", () =>
      restartBackendWorkerFromMenu(),
    );
    addDebugMenuItem(debugMenu, "Stop Dictionary Lookup", () =>
      stopBackendWorkerFromMenu(),
    );
    addDebugMenuItem(debugMenu, "Emit Debug Log Test Message", () =>
      emitDebugLogTestMessage(),
    );
    addDebugMenuItem(debugMenu, "Log Runtime Diagnostics", () =>
      emitRuntimeDiagnosticsSnapshot(),
    );
    addDebugMenuItem(debugMenu, "Reveal Debug Log File", () =>
      revealDebugLogFile(),
    );
    addDebugMenuItem(debugMenu, "Reveal Plugin Data Folder", () =>
      revealPluginDataFolder(),
    );
    addSubMenuItemCompat(rootMenu, debugMenu);
    addMenuItemSafe(rootMenu);
  } catch (error) {
    console.error("Could not rebuild iinatan menu: " + compactError(error));
  }
}
