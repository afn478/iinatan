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
  if (typeof advanceNativeAssGeometryGeneration === "function")
    advanceNativeAssGeometryGeneration();
  invalidateCurrentSubtitleLookupLine();
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
  if (typeof advanceNativeAssGeometryGeneration === "function")
    advanceNativeAssGeometryGeneration();
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
  "secondary-sub-text",
  "secondary-sub-start",
  "secondary-sub-end",
  "secondary-sub-visibility",
  "osd-dimensions",
  "video-params",
  "track-list",
  "sid",
  "secondary-sid",
  "options/secondary-sub-visibility",
  "options/secondary-sub-pos",
  "secondary-sub-pos",
  "options/secondary-sub-scale",
  "secondary-sub-scale",
  "options/secondary-sub-ass-override",
  "secondary-sub-ass-override",
  "options/secondary-sub-delay",
  "secondary-sub-delay",
  "options/sub-font",
  "sub-font",
  "options/sub-font-provider",
  "sub-font-provider",
  "options/sub-font-size",
  "sub-font-size",
  "options/sub-scale",
  "sub-scale",
  "options/sub-scale-by-window",
  "sub-scale-by-window",
  "options/sub-scale-with-window",
  "sub-scale-with-window",
  "options/sub-ass-scale-with-window",
  "sub-ass-scale-with-window",
  "options/sub-ass-vsfilter-aspect-compat",
  "sub-ass-vsfilter-aspect-compat",
  "options/sub-ass-vsfilter-blur-compat",
  "sub-ass-vsfilter-blur-compat",
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
  "options/sub-ass-force-margins",
  "sub-ass-force-margins",
  "options/sub-ass-justify",
  "sub-ass-justify",
  "options/sub-use-margins",
  "sub-use-margins",
  "options/sub-ass-styles",
  "sub-ass-styles",
  "options/sub-fonts-dir",
  "sub-fonts-dir",
  "options/sub-ass-force-style",
  "sub-ass-force-style",
  "options/sub-ass-style-overrides",
  "sub-ass-style-overrides",
  "options/sub-bold",
  "sub-bold",
  "options/sub-italic",
  "sub-italic",
  "options/sub-ass-override",
  "sub-ass-override",
  "options/sub-ass-hinting",
  "sub-ass-hinting",
  "options/sub-ass-shaper",
  "sub-ass-shaper",
  "options/embeddedfonts",
  "embeddedfonts",
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
      if (
        property.indexOf("secondary-sub-") >= 0 ||
        [
          "sid",
          "secondary-sid",
          "secondary-sub-text",
          "secondary-sub-start",
          "secondary-sub-end",
          "secondary-sub-visibility",
          "secondary-sub-pos",
          "secondary-sub-scale",
          "secondary-sub-ass-override",
          "secondary-sub-delay",
          "sub-ass-override",
          "sub-ass-hinting",
          "sub-ass-shaper",
          "embeddedfonts",
          "osd-dimensions",
        ].indexOf(property) >= 0
      )
        if (typeof advanceNativeAssGeometryGeneration === "function")
          advanceNativeAssGeometryGeneration();
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
