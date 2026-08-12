function overlayLifecycleSnapshot() {
  return {
    desiredEnabled: enabled,
    runtimeState: overlayRuntimeState,
    overlayReady: overlayDocumentReady,
    helperAlive: !!activeWorkerReady,
    sessionReady: nativeGeometrySessionReady,
    hitLayerReady: overlayHitLayerReady,
    generation: overlayLifecycleGeneration,
  };
}
function setOverlayRuntimeState(next, reason) {
  const state = String(next || "failed");
  if (state === overlayRuntimeState && !verboseLogEnabled()) return;
  const previous = overlayRuntimeState;
  overlayRuntimeState = state;
  if (state === "ready" && !overlayRuntimeReadyAt)
    overlayRuntimeReadyAt = Date.now();
  debugLog(
    "overlay lifecycle " +
      JSON.stringify({
        event: "state-transition",
        from: previous,
        to: state,
        reason: String(reason || ""),
        ...overlayLifecycleSnapshot(),
      }),
  );
}
function updateOverlayRuntimeState(reason) {
  if (!enabled) {
    setOverlayRuntimeState("disabled", reason);
    return;
  }
  if (!overlayDocumentReady) {
    setOverlayRuntimeState("enabling", reason);
    return;
  }
  if (!activeWorkerReady) {
    setOverlayRuntimeState("starting-helper", reason);
    return;
  }
  if (!mpvStringProp(["stream-open-filename", "path"], "")) {
    setOverlayRuntimeState("waiting-for-media", reason);
    return;
  }
  const subtitleText = mpvStringProp(["sub-text", "secondary-sub-text"], "");
  const bitmapSubtitleReady =
    !subtitleText &&
    typeof bitmapSubtitleOcrMode === "function" &&
    bitmapSubtitleOcrMode();
  if (!subtitleText && !bitmapSubtitleReady) {
    setOverlayRuntimeState("waiting-for-subtitle-track", reason);
    return;
  }
  setOverlayRuntimeState("ready", reason);
}
function handleOverlayDocumentReady(payload, source) {
  const wasReady = overlayDocumentReady;
  overlayDocumentReady = true;
  try {
    // IINA may ignore the pre-load clickable state until it observes a real
    // transition on the ready WebView. Reapply the desired state from false.
    overlay.setOpacity(1);
    overlay.setClickable(false);
    if (enabled) {
      overlay.setClickable(true);
      overlay.show();
    }
  } catch (error) {
    debugWarn(
      "could not synchronize ready overlay surface: " + compactError(error),
    );
  }
  debugLog(
    "overlay document ready source=" +
      String(source || "plugin-message") +
      " first=" +
      String(!wasReady) +
      " payloadType=" +
      typeof payload,
  );
  if (
    !wasReady ||
    (typeof lookupPopupSessionFromPayload === "function" &&
      lookupPopupSessionFromPayload(payload))
  )
    handleLookupPopupOverlayReady(payload);
  postToOverlay("config", overlayConfig());
  postToOverlay("enabled", { enabled });
  replayActiveOverlayTask();
  if (enabled) {
    nativeSubtitleLayoutTrigger =
      "overlay-ready:" + String(source || "message");
    lastSubtitleCueIdentity = null;
    pollSubtitle();
  }
  updateOverlayRuntimeState("overlay-ready:" + String(source || "message"));
}
function handleNativeLayoutDiagnostic(payload) {
  const diagnostic = payload && typeof payload === "object" ? payload : {};
  overlayHitLayerReady =
    diagnostic.accepted === true || diagnostic.reason === "accepted-layout";
  if (overlayHitLayerReady && !overlayFirstHitLayerAt) {
    overlayFirstHitLayerAt = Date.now();
    debugLog(
      "overlay lifecycle " +
        JSON.stringify({
          event: "first-hit-layer",
          startupToHitLayerMs: overlayEnableStartedAt
            ? overlayFirstHitLayerAt - overlayEnableStartedAt
            : 0,
          ...overlayLifecycleSnapshot(),
        }),
    );
  }
  if (!logEnabled()) return;
  const key = JSON.stringify([
    diagnostic.lineId,
    diagnostic.reason,
    diagnostic.osd,
    diagnostic.viewport,
    diagnostic.ratios,
    diagnostic.layoutMetrics,
    diagnostic.fontState,
  ]);
  if (key === lastNativeSubtitleDiagnosticKey) return;
  lastNativeSubtitleDiagnosticKey = key;
  debugLog(
    "experimental native subtitle hit layer: " +
      String(diagnostic.reason || "unsupported") +
      " geometry=" +
      JSON.stringify({
        osd: diagnostic.osd || null,
        viewport: diagnostic.viewport || null,
        dpr: diagnostic.dpr || 0,
        hidpiScale: diagnostic.hidpiScale || 0,
        ratios: diagnostic.ratios || null,
        layoutMetrics: diagnostic.layoutMetrics || null,
        fontState: diagnostic.fontState || null,
      }),
  );
}
function handleNativeLayoutPerformance(payload) {
  if (!verboseLogEnabled()) return;
  const diagnostic = payload && typeof payload === "object" ? payload : {};
  debugVerbose(
    "native overlay DOM profile " +
      JSON.stringify({
        mode: String(diagnostic.mode || ""),
        domUpdateMs: Number(diagnostic.domUpdateMs || 0),
        hitTargetCount: Number(diagnostic.hitTargetCount || 0),
      }),
  );
}
function initializeOverlay() {
  ensureOverlayBridge();
  if (initialized) return;
  debugLog(
    "initializeOverlay v" +
      VERSION +
      " initialized=" +
      initialized +
      " enabled=" +
      enabled,
  );
  overlay.onMessage("ready", (payload) => {
    handleOverlayDocumentReady(payload, "plugin-message");
  });
  overlay.onMessage("lookup-at", (payload) => {
    handleLookupAt(payload);
  });
  overlay.onMessage("lookup-at-lite", (payload) => {
    handleLookupAt(payload);
  });
  overlay.onMessage("lookup-popup-visibility", (payload) => {
    handleLookupPopupVisibility(payload);
  });
  overlay.onMessage("lookup-popup-visible", (payload) => {
    handleLookupPopupVisibility(payload);
  });
  overlay.onMessage("native-layout-invalidated", () => {
    overlayHitLayerReady = false;
    lastSubtitleCueIdentity = null;
    lastNativeLayoutFingerprint = "";
    nativeLayoutStablePolls = 0;
    lastNativePollInputIdentity = "";
    lastNativeSnapshotSettled = false;
    if (enabled) pollSubtitle();
  });
  overlay.onMessage("native-layout-diagnostic", handleNativeLayoutDiagnostic);
  overlay.onMessage("native-layout-performance", handleNativeLayoutPerformance);
  overlay.onMessage("open-external-url", (payload) => {
    openExternalUrlFromOverlay(
      payload && payload.url !== undefined ? payload.url : payload,
    );
  });
  overlay.onMessage("anki-card-status", (payload) => {
    handleBridgeAnkiCardStatus(payload);
  });
  overlay.onMessage("anki-card-add", (payload) => {
    handleBridgeAnkiCardAdd(payload);
  });
  overlay.onMessage("anki-card-open", (payload) => {
    handleBridgeAnkiCardOpen(payload);
  });
  initialized = true;
  overlayDocumentReady = false;
  overlay.loadFile("overlay.html");
  overlay.setOpacity(1);
  overlay.setClickable(true);
  overlay.show();
}
function normalizedProfileRuntimePlan(plan) {
  if (!plan || typeof plan !== "object")
    return {
      lookupCache: true,
      geometryCache: true,
      hitLayer: true,
      polling: true,
      nativeVisibility: true,
      backendRestart: true,
    };
  return {
    lookupCache: plan.lookupCache === true,
    geometryCache: plan.geometryCache === true,
    hitLayer: plan.hitLayer === true,
    polling: plan.polling === true,
    nativeVisibility: plan.nativeVisibility === true,
    backendRestart: plan.backendRestart === true,
  };
}
function prepareRuntimeAfterProfileChange(runtimePlan) {
  const plan = normalizedProfileRuntimePlan(runtimePlan);
  if (plan.backendRestart) {
    overlayLifecycleGeneration++;
    overlayHitLayerReady = false;
    nativeGeometrySessionReady = false;
    if (enabled)
      setOverlayRuntimeState("reconfiguring", "profile-settings-change");
  }
  if (plan.geometryCache) {
    advanceNativeSubtitleFontMetricGeneration();
    invalidateCurrentSubtitleLookupLine();
    if (typeof advanceNativeAssGeometryGeneration === "function")
      advanceNativeAssGeometryGeneration();
    if (typeof advanceNativeBitmapOcrGeneration === "function")
      advanceNativeBitmapOcrGeneration();
    lastSubtitle = null;
    lastSubtitleCueIdentity = null;
    lastNativeLayoutFingerprint = "";
    nativeLayoutStablePolls = 0;
    lastNativePollInputIdentity = "";
    lastNativeSnapshotSettled = false;
  } else if (plan.hitLayer) {
    invalidateCurrentSubtitleLookupLine();
    lastSubtitle = null;
    lastSubtitleCueIdentity = null;
    lastNativeLayoutFingerprint = "";
    nativeLayoutStablePolls = 0;
    lastNativePollInputIdentity = "";
    lastNativeSnapshotSettled = false;
  }
  if (plan.lookupCache) {
    lookupInFlight = Object.create(null);
    lookupBackendReadyForNativeHide = false;
  }
  resetLookupPopupPause();
  return plan;
}
function warmActiveProfileBackend() {
  if (!enabled) return;
  const generation = overlayLifecycleGeneration;
  if (
    activeProfileBackendWarm &&
    activeProfileBackendWarm.generation === generation
  )
    return activeProfileBackendWarm.promise;
  const startedAt = Date.now();
  setOverlayRuntimeState("starting-helper", "backend-warm");
  const language = selectedLanguageModule();
  const dicts = activeDictionaryPaths(language);
  const promise = prepareLookupBackendForEnabledOverlay(language, dicts)
    .then(() => {
      if (!enabled || generation !== overlayLifecycleGeneration) return;
      lookupBackendReadyForNativeHide = true;
      syncNativeSubtitleVisibility();
      setOverlayStatus(
        "Dictionary lookup ready for " + language.label + ".",
        "info",
        3500,
      );
      debugLog(
        "overlay lifecycle " +
          JSON.stringify({
            event: "helper-ready",
            elapsedMs: Date.now() - startedAt,
            settingsReconfigurationMs: profileReconfigurationStartedAt
              ? Date.now() - profileReconfigurationStartedAt
              : 0,
            ...overlayLifecycleSnapshot(),
          }),
      );
      profileReconfigurationStartedAt = 0;
      nativeSubtitleLayoutTrigger = "helper-ready";
      invalidateExperimentalNativeLayout("helper-ready");
      scheduleExperimentalNativeLayoutRebuild();
      updateOverlayRuntimeState("helper-ready");
    })
    .catch((error) => {
      if (!enabled || generation !== overlayLifecycleGeneration) return;
      lookupBackendReadyForNativeHide = false;
      setOverlayRuntimeState("failed", "backend-warm-failed");
      debugError(
        "Dictionary lookup startup failed after profile change language=" +
          language.id +
          ": " +
          compactError(error),
      );
      setOverlayStatus(compactError(error), "error", 14000);
    })
    .finally(() => {
      if (
        activeProfileBackendWarm &&
        activeProfileBackendWarm.promise === promise
      )
        activeProfileBackendWarm = null;
    });
  activeProfileBackendWarm = { generation, promise };
  return promise;
}
function pushOverlayConfigForProfileChange(runtimePlan) {
  const plan = prepareRuntimeAfterProfileChange(runtimePlan);
  if (initialized) {
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
  }
  if (enabled) {
    if (plan.polling) refreshPollingInterval();
    if (plan.geometryCache || plan.hitLayer) pollSubtitle();
    if (plan.nativeVisibility || plan.geometryCache)
      syncNativeSubtitleVisibility();
    if (plan.backendRestart || !activeWorkerReady) warmActiveProfileBackend();
  }
  if (!plan.backendRestart && profileReconfigurationStartedAt) {
    debugLog(
      "overlay lifecycle " +
        JSON.stringify({
          event: "settings-reconfigured",
          elapsedMs: Date.now() - profileReconfigurationStartedAt,
          ...overlayLifecycleSnapshot(),
        }),
    );
    profileReconfigurationStartedAt = 0;
  }
}
function startPolling() {
  const nextMs = configuredSubtitlePollMs();
  debugLog("startPolling subtitlePollMs=" + nextMs);
  if (pollTimer !== null) clearInterval(pollTimer);
  activeSubtitlePollMs = nextMs;
  pollTimer = setInterval(pollSubtitle, activeSubtitlePollMs);
  pollSubtitle();
}
function configuredSubtitlePollMs() {
  return Math.max(80, prefNumber("subtitlePollMs", 120));
}
function refreshPollingInterval() {
  if (pollTimer === null) return;
  const nextMs = configuredSubtitlePollMs();
  if (nextMs === activeSubtitlePollMs) return;
  debugLog("subtitlePollMs changed " + activeSubtitlePollMs + " -> " + nextMs);
  clearInterval(pollTimer);
  activeSubtitlePollMs = nextMs;
  pollTimer = setInterval(pollSubtitle, activeSubtitlePollMs);
}
function stopPolling() {
  debugLog("stopPolling");
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  activeSubtitlePollMs = 0;
  lastSubtitle = null;
  lastSubtitleCueIdentity = null;
  lastNativeLayoutFingerprint = "";
  nativeLayoutStablePolls = 0;
  lastNativePollInputIdentity = "";
  lastNativeSnapshotSettled = false;
  lookupInFlight = Object.create(null);
  invalidateCurrentSubtitleLookupLine();
}
async function prepareLookupBackendForEnabledOverlay(language, dicts) {
  const lang = language || selectedLanguageModule();
  const activeDicts = dicts || activeDictionaryPaths(lang);
  debugLog(
    "prepare lookup backend language=" +
      lang.id +
      " label=" +
      lang.label +
      " activeDicts=" +
      activeDicts.length +
      " dicts=" +
      JSON.stringify(activeDicts.map((p) => String(p).split("/").pop())),
  );
  const setupMessage = dictionarySetupMessage(lang, activeDicts);
  if (setupMessage) throw new Error(setupMessage);
  const ready = await ensureBackendWorker(activeDicts, lang);
  debugLog(
    "prepare lookup backend ready language=" +
      lang.id +
      " fingerprint=" +
      JSON.stringify((ready && ready.fingerprint) || ""),
  );
  return ready;
}
function persistOverlayDesiredState() {
  try {
    if (preferences && typeof preferences.set === "function")
      preferences.set("enabledByDefault", enabled);
    if (preferences && typeof preferences.sync === "function")
      preferences.sync();
  } catch (error) {
    debugWarn("could not persist overlay state: " + compactError(error));
  }
}
function setEnabled(next, options) {
  const wasEnabled = enabled;
  const requested = !!next;
  const trigger = String((options && options.trigger) || "runtime");
  nativeSubtitleLayoutTrigger = trigger;
  debugLog(
    "setEnabled requested next=" +
      String(!!next) +
      " previous=" +
      String(enabled),
  );
  if (requested === wasEnabled) {
    if (options && options.persist === true) persistOverlayDesiredState();
    initializeOverlay();
    overlay.setClickable(requested);
    postToOverlay("enabled", { enabled: requested });
    postToOverlay("config", overlayConfig());
    if (requested) {
      overlay.show();
      if (pollTimer === null) startPolling();
      else pollSubtitle();
      if (!activeWorkerReady && overlayRuntimeState !== "starting-helper")
        warmActiveProfileBackend();
    }
    return;
  }
  enabled = requested;
  if (options && options.persist === true) persistOverlayDesiredState();
  if (enabled !== wasEnabled) {
    overlayLifecycleGeneration++;
    overlayHitLayerReady = false;
    nativeGeometrySessionReady = false;
    overlayRuntimeReadyAt = 0;
    overlayFirstHitLayerAt = 0;
    if (enabled) overlayEnableStartedAt = Date.now();
    advanceNativeSubtitleFontMetricGeneration();
    invalidateCurrentSubtitleLookupLine();
    if (typeof advanceNativeAssGeometryGeneration === "function")
      advanceNativeAssGeometryGeneration();
  }
  lookupBackendReadyForNativeHide = false;
  if (enabled) setOverlayRuntimeState("enabling", trigger);
  initializeOverlay();
  overlay.setClickable(enabled);
  postToOverlay("enabled", { enabled });
  postToOverlay("config", overlayConfig());
  rebuildMenu();
  if (enabled) {
    try {
      nativeSubtitlePlaybackActive =
        nativeSubtitlePlaybackActive ||
        !!mpvStringProp(["stream-open-filename", "path"], "");
      if (nativeSubtitlePlaybackActive) {
        acquireNativeSubtitleVisibilityOwnership();
        syncNativeSubtitleVisibility();
      }
    } catch (error) {
      console.warn(
        "Could not update native subtitle visibility: " + compactError(error),
      );
    }
    overlay.show();
    startPolling();
    showOSD("iinatan: On");
    warmActiveProfileBackend();
  } else {
    lookupBackendReadyForNativeHide = false;
    resetLookupPopupPause();
    stopPolling();
    publishSubtitle("");
    restoreNativeSubtitleVisibility();
    setOverlayRuntimeState("disabled", trigger);
    showOSD("iinatan: Off");
  }
}
function toggleFromShortcut(data) {
  try {
    if (data && data.isRepeat) return true;
    const now = Date.now();
    if (now - lastShortcutToggleAt < 280) return true;
    lastShortcutToggleAt = now;
    debugLog(
      "shortcut Shift+H toggle enabled=" +
        String(enabled) +
        " -> " +
        String(!enabled),
    );
    setEnabled(!enabled, { persist: true, trigger: "shortcut" });
    return true;
  } catch (error) {
    console.error("Shift+H shortcut failed: " + compactError(error));
    return true;
  }
}
function registerShortcut() {
  if (shortcutRegistered) return;
  shortcutRegistered = true;
  try {
    // Prefer IINA's input module over menu keyBinding here. The menu shortcut could
    // turn the overlay on but then fail to turn it off while the overlay/webview was
    // active. We listen for mpv's uppercase H form, i.e. Shift+h.
    input.onKeyDown("H", toggleFromShortcut, input.PRIORITY_HIGH);
    debugLog("registered input shortcut H for Shift+H");
  } catch (error) {
    console.warn("Could not register H shortcut: " + compactError(error));
  }
  try {
    // Fallback for builds/configs that accept explicit modifier notation.
    input.onKeyDown("Shift+H", toggleFromShortcut, input.PRIORITY_HIGH);
    debugLog("registered input shortcut Shift+H fallback");
  } catch (error) {
    console.warn("Could not register Shift+H fallback: " + compactError(error));
  }
}
