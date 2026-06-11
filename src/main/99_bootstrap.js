
registerShortcut();
rebuildMenu();
ensureBundledBackendInstalled().catch(error => {
  debugWarn("lookup engine install check failed: " + compactError(error));
});

event.on("iina.window-loaded", () => {
  initializeOverlay();
  setEnabled(prefBool("enabledByDefault", true));
});
event.on("mpv.file-loaded", () => {
  lastSubtitle = null;
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  if (enabled) startPolling();
});
event.on("mpv.end-file", () => {
  resetLookupPopupPause();
  stopPolling();
  publishSubtitle("");
});
event.on("iina.window-will-close", () => {
  resetLookupPopupPause();
  stopPolling();
});
try {
  if (core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", true));
  }
} catch (_) {}
