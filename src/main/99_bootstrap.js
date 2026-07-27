registerShortcut();
rebuildMenu();
scheduleIINAAppearanceHintRefresh(true);
prepareNativeSubtitlePrivateCueDirectory().catch((error) => {
  debugWarn("lookup engine install check failed: " + compactError(error));
});

event.on("iina.window-loaded", () => {
  initializeOverlay();
  setEnabled(prefBool("enabledByDefault", true));
});
event.on("mpv.file-loaded", () => {
  advanceNativeSubtitleFontMetricGeneration();
  nativeSubtitlePlaybackActive = true;
  lastSubtitle = null;
  lastSubtitleCueIdentity = null;
  lastNativeLayoutFingerprint = "";
  nativeLayoutStablePolls = 0;
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  if (enabled) {
    acquireNativeSubtitleVisibilityOwnership();
    startPolling();
  }
});
event.on("mpv.end-file", () => {
  advanceNativeSubtitleFontMetricGeneration();
  nativeSubtitlePlaybackActive = false;
  if (nativeSubtitlePropertyRebuildTimer !== null) {
    clearTimeout(nativeSubtitlePropertyRebuildTimer);
    nativeSubtitlePropertyRebuildTimer = null;
  }
  resetLookupPopupPause();
  stopPolling();
  publishSubtitle("");
  restoreNativeSubtitleVisibility();
});
event.on("iina.window-will-close", () => {
  nativeSubtitlePlaybackActive = false;
  if (nativeSubtitlePropertyRebuildTimer !== null) {
    clearTimeout(nativeSubtitlePropertyRebuildTimer);
    nativeSubtitlePropertyRebuildTimer = null;
  }
  resetLookupPopupPause();
  stopPolling();
  publishSubtitle("");
  restoreNativeSubtitleVisibility();
  requestBackendWorkerStop();
  stopBackendWorker().catch((error) => {
    debugWarn("lookup worker stop on close failed: " + compactError(error));
  });
  flushDebugLogBuffer();
});
function invalidateExperimentalNativeLayout(reason) {
  if (!experimentalNativeSubtitleMode()) return;
  lastSubtitleCueIdentity = null;
  lastNativeLayoutFingerprint = "";
  nativeLayoutStablePolls = 0;
  postToOverlay("native-layout-invalidate", {
    reason: String(reason || "stale-layout"),
  });
}
function scheduleExperimentalNativeLayoutRebuild() {
  if (nativeSubtitlePropertyRebuildTimer !== null) return;
  nativeSubtitlePropertyRebuildTimer = setTimeout(() => {
    nativeSubtitlePropertyRebuildTimer = null;
    if (enabled && experimentalNativeSubtitleMode()) pollSubtitle();
  }, 0);
}
[
  "sub-text",
  "sub-text-ass",
  "sub-start",
  "sub-end",
  "osd-dimensions",
  "track-list",
  "sid",
  "secondary-sid",
  "options/sub-font",
  "sub-font",
  "options/sub-font-size",
  "sub-font-size",
  "options/sub-scale",
  "sub-scale",
  "options/sub-scale-by-window",
  "sub-scale-by-window",
  "options/sub-scale-with-window",
  "sub-scale-with-window",
  "options/sub-margin-x",
  "sub-margin-x",
  "options/sub-margin-y",
  "sub-margin-y",
  "options/sub-pos",
  "sub-pos",
  "options/sub-align-x",
  "sub-align-x",
  "options/sub-align-y",
  "sub-align-y",
  "options/sub-justify",
  "sub-justify",
  "options/sub-spacing",
  "sub-spacing",
  "options/sub-line-spacing",
  "sub-line-spacing",
  "options/sub-ass-line-spacing",
  "sub-ass-line-spacing",
  "options/sub-use-margins",
  "sub-use-margins",
  "options/sub-bold",
  "sub-bold",
  "options/sub-italic",
  "sub-italic",
  "options/sub-ass-override",
  "sub-ass-override",
  "display-hidpi-scale",
].forEach((property) => {
  try {
    event.on("mpv." + property + ".changed", () => {
      if (
        [
          "options/sub-font",
          "sub-font",
          "options/sub-font-size",
          "sub-font-size",
          "options/sub-bold",
          "sub-bold",
          "options/sub-italic",
          "sub-italic",
        ].indexOf(property) >= 0
      )
        advanceNativeSubtitleFontMetricGeneration();
      invalidateExperimentalNativeLayout("property-change:" + property);
      scheduleExperimentalNativeLayoutRebuild();
    });
  } catch (_) {}
});
[
  ["mpv.seek", "seek"],
  ["mpv.video-reconfig", "video-reconfig"],
  ["mpv.tracks-changed", "subtitle-track-change"],
  ["iina.window-resized", "window-resize"],
  ["iina.window-size-adjusted", "window-size-adjusted"],
  ["iina.window-moved", "window-move"],
  ["iina.window-fs.changed", "fullscreen-change"],
  ["iina.window-screen.changed", "display-change"],
].forEach((registration) => {
  try {
    event.on(registration[0], () => {
      invalidateExperimentalNativeLayout(registration[1]);
      if (enabled) pollSubtitle();
    });
  } catch (_) {}
});
try {
  if (core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", true));
  }
} catch (_) {}
