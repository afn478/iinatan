function initializeOverlay() {
  ensureOverlayBridge();
  if (initialized) return;
  debugLog("initializeOverlay v" + VERSION + " initialized=" + initialized + " enabled=" + enabled);
  overlay.loadFile("overlay.html");
  overlay.setOpacity(1);
  overlay.setClickable(true);
  overlay.show();
  initialized = true;
  overlay.onMessage("ready", payload => {
    debugLog("overlay ready received payloadType=" + typeof payload);
    handleLookupPopupOverlayReady(payload);
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
    replayActiveOverlayTask();
    if (enabled) pollSubtitle();
  });
  overlay.onMessage("lookup-at", payload => { handleLookupAt(payload); });
	  overlay.onMessage("lookup-at-lite", payload => { handleLookupAt(payload); });
	  overlay.onMessage("lookup-popup-visibility", payload => { handleLookupPopupVisibility(payload); });
	  overlay.onMessage("lookup-popup-visible", payload => { handleLookupPopupVisibility(payload); });
	  overlay.onMessage("open-external-url", payload => { openExternalUrlFromOverlay(payload && payload.url !== undefined ? payload.url : payload); });
	  overlay.onMessage("anki-card-status", payload => { handleBridgeAnkiCardStatus(payload); });
	  overlay.onMessage("anki-card-add", payload => { handleBridgeAnkiCardAdd(payload); });
	  overlay.onMessage("anki-card-open", payload => { handleBridgeAnkiCardOpen(payload); });
	}
function prepareRuntimeAfterProfileChange() {
  lookupBackendReadyForNativeHide = false;
  lookupInFlight = Object.create(null);
  hoverLookupInFlight = false;
  pendingHoverLookup = null;
  hoverLookupActiveKey = "";
  lastSubtitle = null;
  resetLookupPopupPause();
}
function warmActiveProfileBackend() {
  if (!enabled) return;
  const language = selectedLanguageModule();
  const dicts = activeDictionaryPaths(language);
  prepareLookupBackendForEnabledOverlay(language, dicts).then(() => {
    if (!enabled) return;
    lookupBackendReadyForNativeHide = true;
    syncNativeSubtitleVisibility();
    setOverlayStatus("Dictionary lookup ready for " + language.label + ".", "info", 3500);
  }).catch(error => {
    lookupBackendReadyForNativeHide = false;
    debugError("Dictionary lookup startup failed after profile change language=" + language.id + ": " + compactError(error));
    setOverlayStatus(compactError(error), "error", 14000);
  });
}
function pushOverlayConfigForProfileChange() {
  prepareRuntimeAfterProfileChange();
  if (initialized) {
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
  }
  if (enabled) {
    refreshPollingInterval();
    pollSubtitle();
    syncNativeSubtitleVisibility();
    warmActiveProfileBackend();
  }
}
function videoWindowAvailableForOverlayLoad() {
  try { return !!(core && core.window && core.window.loaded); }
  catch (_) { return false; }
}
function reloadOverlayForProfileChange() {
  prepareRuntimeAfterProfileChange();
  if (!videoWindowAvailableForOverlayLoad()) {
    debugLog("deferring overlay reload for profile change until iina.window-loaded");
    return;
  }
  if (!initialized) {
    initializeOverlay();
  } else {
    try {
      debugLog("reloading overlay for active profile language=" + selectedLanguageModule().id);
      overlay.loadFile("overlay.html");
      overlay.setOpacity(1);
      overlay.setClickable(enabled);
      if (enabled) overlay.show();
    } catch (error) {
      debugWarn("overlay reload failed for profile change: " + compactError(error));
    }
  }
  setTimeout(() => {
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
    replayActiveOverlayTask();
    if (enabled) {
      startPolling();
      syncNativeSubtitleVisibility();
      warmActiveProfileBackend();
    } else {
      publishSubtitle("");
    }
  }, 80);
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
  lookupInFlight = Object.create(null);
}
async function prepareLookupBackendForEnabledOverlay(language, dicts) {
  const lang = language || selectedLanguageModule();
  const activeDicts = dicts || activeDictionaryPaths(lang);
  debugLog("prepare lookup backend language=" + lang.id + " label=" + lang.label + " activeDicts=" + activeDicts.length + " dicts=" + JSON.stringify(activeDicts.map(p => String(p).split("/").pop())));
  const setupMessage = dictionarySetupMessage(lang, activeDicts);
  if (setupMessage) throw new Error(setupMessage);
  const ready = await ensureBackendWorker(activeDicts, lang);
  debugLog("prepare lookup backend ready language=" + lang.id + " fingerprint=" + JSON.stringify((ready && ready.fingerprint) || ""));
  return ready;
}
function setEnabled(next) {
  debugLog("setEnabled requested next=" + String(!!next) + " previous=" + String(enabled));
  enabled = !!next;
  lookupBackendReadyForNativeHide = false;
  initializeOverlay();
  overlay.setClickable(enabled);
  postToOverlay("enabled", { enabled });
  postToOverlay("config", overlayConfig());
  rebuildMenu();
  if (enabled) {
    const language = selectedLanguageModule();
    const dicts = activeDictionaryPaths(language);
    try {
      nativeSubVisibilityBeforeEnable = mpv.getFlag("sub-visibility");
      syncNativeSubtitleVisibility();
    } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
    overlay.show();
    startPolling();
    showOSD("iinatan: On");
    prepareLookupBackendForEnabledOverlay(language, dicts).then(() => {
      if (!enabled) return;
      lookupBackendReadyForNativeHide = true;
      syncNativeSubtitleVisibility();
      setOverlayStatus("Dictionary lookup ready for " + language.label + ".", "info", 3500);
    }).catch(error => {
      lookupBackendReadyForNativeHide = false;
      debugError("Dictionary lookup startup failed language=" + language.id + ": " + compactError(error));
      try { if (nativeSubVisibilityBeforeEnable !== null) mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable); } catch (_) {}
      setOverlayStatus(compactError(error), "error", 14000);
    });
  } else {
    lookupBackendReadyForNativeHide = false;
    resetLookupPopupPause();
    stopPolling();
    publishSubtitle("");
    try { if (nativeSubVisibilityBeforeEnable !== null) mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable); } catch (_) {}
    showOSD("iinatan: Off");
  }
}
function toggleFromShortcut(data) {
  try {
    if (data && data.isRepeat) return true;
    const now = Date.now();
    if (now - lastShortcutToggleAt < 280) return true;
    lastShortcutToggleAt = now;
    debugLog("shortcut Shift+H toggle enabled=" + String(enabled) + " -> " + String(!enabled));
    setEnabled(!enabled);
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
