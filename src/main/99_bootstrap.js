registerShortcut();
rebuildMenu();
scheduleIINAAppearanceHintRefresh(true);
let pluginShuttingDown = false;
prepareNativeSubtitlePrivateCueDirectory().catch((error) => {
  debugWarn("lookup engine install check failed: " + compactError(error));
});

event.on("iina.window-loaded", () => {
  if (pluginShuttingDown) return;
  // Dictionary tasks can initialize the player overlay while IINA has no
  // video window. That load has no WebView to attach to and never sends the
  // ready message, so retry it when the actual player window becomes usable.
  initializeOverlay({
    reloadIfNotReady: true,
    reason: "window-loaded",
  });
  setEnabled(prefBool("enabledByDefault", true), {
    trigger: "persisted-startup",
  });
});
event.on("iina.window-main.changed", (status) => {
  nativeBitmapOcrWindowMain = !!status;
  nativeBitmapOcrMouseActivityCounter = null;
});
event.on("mpv.file-loaded", () => {
  if (pluginShuttingDown) return;
  if (typeof invalidateActiveDictionaryRuntimeCache === "function")
    invalidateActiveDictionaryRuntimeCache();
  advanceNativeSubtitleFontMetricGeneration();
  if (typeof advanceNativeAssGeometryGeneration === "function")
    advanceNativeAssGeometryGeneration();
  if (typeof advanceNativeBitmapOcrGeneration === "function")
    advanceNativeBitmapOcrGeneration();
  nativeExternalSrtGeneration++;
  nativeExternalSrtCache = Object.create(null);
  nativeExternalSrtInFlight = Object.create(null);
  invalidateCurrentSubtitleLookupLine();
  nativeSubtitlePlaybackActive = true;
  lastSubtitle = null;
  lastSubtitleCueIdentity = null;
  lastNativeLayoutFingerprint = "";
  nativeLayoutStablePolls = 0;
  lastNativePollInputIdentity = "";
  lastNativeSnapshotSettled = false;
  lookupCache = Object.create(null);
  invalidateExperimentalNativeLayout("file-loaded");
  lookupInFlight = Object.create(null);
  if (enabled) {
    acquireNativeSubtitleVisibilityOwnership();
    startPolling();
    updateOverlayRuntimeState("media-loaded");
  }
});
event.on("mpv.end-file", () => {
  if (pluginShuttingDown) return;
  advanceNativeSubtitleFontMetricGeneration();
  if (typeof advanceNativeAssGeometryGeneration === "function")
    advanceNativeAssGeometryGeneration();
  if (typeof advanceNativeBitmapOcrGeneration === "function")
    advanceNativeBitmapOcrGeneration();
  nativeExternalSrtGeneration++;
  nativeExternalSrtInFlight = Object.create(null);
  nativeSubtitlePlaybackActive = false;
  if (nativeSubtitlePropertyRebuildTimer !== null) {
    cancelOneShot(nativeSubtitlePropertyRebuildTimer);
    nativeSubtitlePropertyRebuildTimer = null;
  }
  resetLookupPopupPause();
  stopPolling();
  publishSubtitle("");
  restoreNativeSubtitleVisibility();
  if (enabled) {
    overlayHitLayerReady = false;
    nativeGeometrySessionReady = false;
    setOverlayRuntimeState("waiting-for-media", "media-ended");
  }
});
event.on("iina.window-will-close", () => {
  if (pluginShuttingDown) return;
  pluginShuttingDown = true;
  overlayLifecycleGeneration++;
  setOverlayRuntimeState("shutting-down", "window-will-close");
  nativeSubtitlePlaybackActive = false;
  if (nativeSubtitlePropertyRebuildTimer !== null) {
    cancelOneShot(nativeSubtitlePropertyRebuildTimer);
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
  if (!nativeSubtitleHitLayerMode()) return;
  nativeSubtitleLayoutTrigger = String(reason || "stale-layout");
  lastSubtitleCueIdentity = null;
  lastNativeLayoutFingerprint = "";
  nativeLayoutStablePolls = 0;
  lastNativePollInputIdentity = "";
  lastNativeSnapshotSettled = false;
  if (nativeSubtitleLayoutInvalidated) return;
  nativeSubtitleLayoutInvalidated = true;
  postToOverlay("native-layout-invalidate", {
    reason: String(reason || "stale-layout"),
  });
}
function scheduleExperimentalNativeLayoutRebuild() {
  if (pluginShuttingDown || nativeSubtitlePropertyRebuildTimer !== null) return;
  nativeSubtitlePropertyRebuildTimer = scheduleOneShot(() => {
    nativeSubtitlePropertyRebuildTimer = null;
    if (!pluginShuttingDown && enabled && nativeSubtitleHitLayerMode())
      pollSubtitle();
  }, 0);
}
[
  "path",
  "stream-open-filename",
  "sub-text",
  "sub-text-ass",
  "sub-text/ass-full",
  "sub-ass-extradata",
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
  "pause",
  "options/sub-delay",
  "sub-delay",
  "options/stretch-image-subs-to-screen",
  "stretch-image-subs-to-screen",
  "options/image-subs-video-resolution",
  "image-subs-video-resolution",
].forEach((property) => {
  try {
    event.on("mpv." + property + ".changed", () => {
      if (pluginShuttingDown) return;
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
          "path",
          "stream-open-filename",
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
      if (
        property === "path" ||
        property === "stream-open-filename" ||
        property === "sid" ||
        property === "secondary-sid" ||
        property === "track-list" ||
        property === "osd-dimensions" ||
        property === "video-params" ||
        property.indexOf("sub-delay") >= 0 ||
        property.indexOf("image-subs") >= 0 ||
        property.indexOf("stretch-image-subs") >= 0
      )
        if (typeof advanceNativeBitmapOcrGeneration === "function")
          advanceNativeBitmapOcrGeneration();
      if (property === "pause") {
        const paused = pauseState();
        const bitmapOcr =
          typeof bitmapSubtitleOcrMode === "function" &&
          bitmapSubtitleOcrMode();
        if (
          bitmapOcr &&
          (!paused || !lookupPopupPauseActive) &&
          typeof observeNativeBitmapOcrPauseState === "function"
        )
          observeNativeBitmapOcrPauseState();
        if (!bitmapOcr || !paused || lookupPopupPauseActive) return;
      }
      invalidateExperimentalNativeLayout("property-change:" + property);
      scheduleExperimentalNativeLayoutRebuild();
      if (
        enabled &&
        [
          "path",
          "stream-open-filename",
          "sub-text",
          "secondary-sub-text",
          "track-list",
          "sid",
          "secondary-sid",
        ].indexOf(property) >= 0
      )
        updateOverlayRuntimeState("property-change:" + property);
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
      if (pluginShuttingDown) return;
      if (typeof advanceNativeBitmapOcrGeneration === "function")
        advanceNativeBitmapOcrGeneration();
      invalidateExperimentalNativeLayout(registration[1]);
      if (enabled) scheduleExperimentalNativeLayoutRebuild();
      if (enabled && registration[1] === "subtitle-track-change")
        updateOverlayRuntimeState(registration[1]);
    });
  } catch (_) {}
});
try {
  if (!pluginShuttingDown && core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", true), {
      trigger: "persisted-startup",
    });
  }
} catch (_) {}
