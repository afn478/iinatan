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
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
    replayActiveOverlayTask();
    if (enabled) pollSubtitle();
  });
  overlay.onMessage("lookup-at", payload => { handleLookupAt(payload); });
  overlay.onMessage("lookup-at-lite", payload => { handleLookupAt(payload); });
  overlay.onMessage("lookup-popup-visibility", payload => { handleLookupPopupVisibility(payload); });
  overlay.onMessage("lookup-popup-visible", payload => { handleLookupPopupVisibility(payload); });
}
function startPolling() {
  debugLog("startPolling subtitlePollMs=" + Math.max(80, prefNumber("subtitlePollMs", 120)));
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = setInterval(pollSubtitle, Math.max(80, prefNumber("subtitlePollMs", 120)));
  pollSubtitle();
}
function stopPolling() {
  debugLog("stopPolling");
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  lastSubtitle = null;
  lookupInFlight = Object.create(null);
}
function setEnabled(next) {
  debugLog("setEnabled requested next=" + String(!!next) + " previous=" + String(enabled));
  enabled = !!next;
  initializeOverlay();
  overlay.setClickable(enabled);
  postToOverlay("enabled", { enabled });
  postToOverlay("config", overlayConfig());
  rebuildMenu();
  if (enabled) {
    try {
      nativeSubVisibilityBeforeEnable = mpv.getFlag("sub-visibility");
      if (prefBool("hideNativeSubtitles", true)) mpv.set("sub-visibility", false);
    } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
    overlay.show();
    startPolling();
    showOSD("iinatan: On");
    if (!backendInstalled()) setOverlayStatus("HoshiDicts backend not installed. Use Plugin menu → Build/Update HoshiDicts Backend.", "error", 9000);
    else if (!activeDictionaryPaths().length) setOverlayStatus("No dictionaries installed. Use Plugin menu → Get Recommended Dictionaries.", "error", 9000);
    else ensureBackendWorker(activeDictionaryPaths()).catch(error => setOverlayStatus("HoshiDicts worker could not start: " + compactError(error), "error", 12000));
  } else {
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
