
registerShortcut();
rebuildMenu();
ensureBundledBackendInstalled().catch(error => {
  debugWarn("lookup engine install check failed: " + compactError(error));
});

event.on("iina.window-loaded", () => {
  initializeOverlay();
  setEnabled(prefBool("enabledByDefault", false));
});
event.on("mpv.file-loaded", () => {
  lastSubtitle = null;
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  if (enabled) pollSubtitle();
});
event.on("mpv.end-file", () => { resetLookupPopupPause(); publishSubtitle(""); });
try {
  if (core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", false));
  }
} catch (_) {}
