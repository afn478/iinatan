function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function cleanSubtitleText(text, flattenLineBreaks) {
  const clean = decodeEntities(String(text || ""))
    .replace(/\uFEFF/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n");
  return (flattenLineBreaks ? clean.replace(/\n+/g, " ") : clean)
    .replace(/[ \t\f\v]{2,}/g, " ")
    .trim();
}
function isJapaneseish(text) {
  return languageModuleById("ja").hasLookupText(text);
}
function mpvStringProp(names, fallback) {
  for (const name of names) {
    try {
      const value = mpv.getString(name);
      if (value !== undefined && value !== null && String(value).trim() !== "")
        return String(value).trim();
    } catch (_) {}
  }
  return fallback;
}
function sanitizeFontFamily(font) {
  const raw = String(font || "").trim();
  if (!raw)
    return '"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
  if (/[,"]/.test(raw)) return raw;
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(raw))
    return raw;
  return (
    '"' +
    raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
    '", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif'
  );
}
function mpvNumberProp(names, fallback) {
  for (const name of names) {
    try {
      const raw = mpv.getString(name);
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const value = Number(String(raw).trim());
        if (Number.isFinite(value)) return value;
      }
    } catch (_) {}
  }
  return fallback;
}
function mpvBoolProp(names, fallback) {
  for (const name of names) {
    try {
      const raw = mpv.getString(name);
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const s = String(raw).trim().toLowerCase();
        if (["yes", "true", "1", "on"].indexOf(s) >= 0) return true;
        if (["no", "false", "0", "off"].indexOf(s) >= 0) return false;
      }
    } catch (_) {}
  }
  return fallback;
}
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function cssColorFromMpv(raw, fallback) {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(value)) return value;
  const hex = value.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#" + hex;
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    // mpv style colors are commonly #AARRGGBB.
    const a = parseInt(hex.slice(0, 2), 16) / 255;
    const r = parseInt(hex.slice(2, 4), 16);
    const g = parseInt(hex.slice(4, 6), 16);
    const b = parseInt(hex.slice(6, 8), 16);
    return (
      "rgba(" + r + "," + g + "," + b + "," + Math.round(a * 1000) / 1000 + ")"
    );
  }
  return fallback;
}
function readMpvColor(names, fallback) {
  for (const name of names) {
    try {
      const raw = mpv.getString(name);
      const parsed = cssColorFromMpv(raw, "");
      if (parsed) return parsed;
    } catch (_) {}
  }
  return fallback;
}
function readSubtitleFontFamily() {
  // Best effort: this reads the IINA/mpv configured subtitle font. Embedded ASS
  // subtitle fonts are rendered by mpv/libass and are not exposed to this HTML
  // overlay, so external subtitle preference font is the reliable source here.
  const configured = mpvStringProp(["options/sub-font", "sub-font"], "");
  return sanitizeFontFamily(configured);
}
function readSubtitleStyleConfig() {
  const fontSize = clampNumber(
    mpvNumberProp(["options/sub-font-size", "sub-font-size"], 0),
    18,
    120,
    0,
  );
  const borderSize = clampNumber(
    mpvNumberProp(["options/sub-border-size", "sub-border-size"], 3),
    0,
    16,
    3,
  );
  const shadowOffset = clampNumber(
    mpvNumberProp(["options/sub-shadow-offset", "sub-shadow-offset"], 2),
    0,
    24,
    2,
  );
  const shadowBlur = clampNumber(
    mpvNumberProp(
      ["options/sub-shadow-blur", "sub-shadow-blur"],
      Math.max(2, shadowOffset * 1.6),
    ),
    0,
    32,
    Math.max(2, shadowOffset * 1.6),
  );
  const bold = mpvBoolProp(["options/sub-bold", "sub-bold"], true);
  const italic = mpvBoolProp(["options/sub-italic", "sub-italic"], false);
  return {
    subtitleFontFamily: readSubtitleFontFamily(),
    subtitleFontSize:
      fontSize > 0 ? String(fontSize) + "px" : "clamp(26px, 4.2vw, 64px)",
    subtitleFontWeight: bold ? "800" : "400",
    subtitleFontStyle: italic ? "italic" : "normal",
    subtitleColor: readMpvColor(["options/sub-color", "sub-color"], "#ffffff"),
    subtitleBorderColor: readMpvColor(
      ["options/sub-border-color", "sub-border-color"],
      "#000000",
    ),
    subtitleOutlineWidth: String(borderSize) + "px",
    subtitleShadowColor: readMpvColor(
      ["options/sub-shadow-color", "sub-shadow-color"],
      "rgba(0,0,0,0.9)",
    ),
    subtitleShadowOffset: String(shadowOffset) + "px",
    subtitleShadowBlur: String(shadowBlur) + "px",
  };
}
function normalizePopupThemePreference(value) {
  const theme = String(value || "")
    .trim()
    .toLowerCase();
  if (theme === "dark" || theme === "light" || theme === "inherit")
    return theme;
  return "inherit";
}
function normalizeAppearanceHint(value) {
  const theme = String(value || "")
    .trim()
    .toLowerCase();
  if (theme === "dark" || theme === "light") return theme;
  return "";
}
function appearanceHintFromThemeMaterial(value, systemHint) {
  const themeMaterial = Number(String(value || "").trim());
  if (themeMaterial === 0) return "dark";
  if (themeMaterial === 2) return "light";
  if (themeMaterial === 4) return normalizeAppearanceHint(systemHint);
  return "";
}
async function readMacOSAppearanceHint() {
  try {
    const result = await utils.exec(
      "/usr/bin/defaults",
      ["read", "-g", "AppleInterfaceStyle"],
      dataRoot(),
    );
    const text = String((result && result.stdout) || "")
      .trim()
      .toLowerCase();
    return text === "dark" ? "dark" : "light";
  } catch (_) {
    return "";
  }
}
async function readIINAAppearanceHint() {
  try {
    const result = await utils.exec(
      "/usr/bin/defaults",
      ["read", "com.colliderli.iina", "themeMaterial"],
      dataRoot(),
    );
    const raw = String((result && result.stdout) || "").trim();
    if (!raw) return "";
    const systemHint = Number(raw) === 4 ? await readMacOSAppearanceHint() : "";
    return appearanceHintFromThemeMaterial(raw, systemHint);
  } catch (_) {
    return "";
  }
}
function scheduleIINAAppearanceHintRefresh(force) {
  const now = Date.now();
  if (iinaAppearanceHintRefreshInFlight) return;
  if (!force && now - iinaAppearanceHintLastRefreshAt < 5000) return;
  iinaAppearanceHintRefreshInFlight = true;
  iinaAppearanceHintLastRefreshAt = now;
  readIINAAppearanceHint()
    .then((hint) => {
      const next = normalizeAppearanceHint(hint);
      if (next && next !== iinaAppearanceHint) {
        iinaAppearanceHint = next;
        if (typeof pushOverlayConfigForProfileChange === "function")
          pushOverlayConfigForProfileChange({});
      }
    })
    .catch((error) => {
      debugVerbose(
        "Could not read IINA appearance preference: " + compactError(error),
      );
    })
    .finally(() => {
      iinaAppearanceHintRefreshInFlight = false;
    });
}
function overlayConfig() {
  const language = selectedLanguageModule();
  scheduleIINAAppearanceHintRefresh(false);
  return {
    language: selectedLanguageOverlayConfig(),
    lookupLanguage: language.id,
    fontScale: prefNumber("fontScale", 1.0),
    popupScale: prefNumber("popupScale", 0.92),
    popupMaxWidth: Math.max(260, prefNumber("popupMaxWidth", 440)),
    popupMaxHeightVh: Math.max(20, prefNumber("popupMaxHeightVh", 34)),
    popupSubtitleGapPx: Math.max(12, prefNumber("popupSubtitleGapPx", 34)),
    nestedPopupMode: String(pref("nestedPopupMode", "off") || "off"),
    nestedPopupMaxDepth: Math.max(
      1,
      Math.min(5, Math.round(prefNumber("nestedPopupMaxDepth", 3))),
    ),
    flattenSubtitleLineBreaks: prefBool("flattenSubtitleLineBreaks", false),
    experimentalNativeSubtitleHitLayer: prefBool(
      "experimentalNativeSubtitleHitLayer",
      false,
    ),
    experimentalNativeSubtitleLookupHighlight:
      prefBool("experimentalNativeSubtitleHitLayer", false) &&
      prefBool("experimentalNativeSubtitleLookupHighlight", true),
    experimentalNativeSubtitleHitBoxes:
      prefBool("experimentalNativeSubtitleHitLayer", false) &&
      prefBool("experimentalNativeSubtitleHitBoxes", false),
    experimentalNativeSubtitleTextOpacity: prefBool(
      "experimentalNativeSubtitleHitLayer",
      false,
    )
      ? clampNumber(
          prefNumber("experimentalNativeSubtitleTextOpacity", 0),
          0,
          1,
          0,
        )
      : 0,
    popupTheme: normalizePopupThemePreference(pref("popupTheme", "inherit")),
    popupThemeHint: normalizeAppearanceHint(iinaAppearanceHint),
    ...readSubtitleStyleConfig(),
    maxEntries: Math.max(1, prefNumber("maxEntries", 3)),
    maxGlossesPerEntry: Math.max(1, prefNumber("maxGlossesPerEntry", 4)),
    scanLength: Math.max(1, prefNumber("scanLength", 24)),
    hoverRequestTimeoutMs: Math.max(
      1500,
      prefNumber("hoverRequestTimeoutMs", 15000),
    ),
    audioAutoPlay: prefBool("audioAutoPlay", false),
    audioSources: normalizeAudioSources(
      pref("audioSourcesJson", DEFAULT_AUDIO_SOURCES_JSON),
    ),
    anki:
      typeof overlayAnkiConfig === "function"
        ? overlayAnkiConfig()
        : { enabled: false, configured: false },
    etymologyCollapseDefault: String(
      pref("etymologyCollapseDefault", "collapsed") || "collapsed",
    ),
    wiktionaryEtymologyCollapseOverride: String(
      pref("wiktionaryEtymologyCollapseOverride", "collapsed") || "collapsed",
    ),
    customPopupCss: String(pref("customPopupCss", "") || ""),
    debugLogEnabled: prefBool("debugLogEnabled", true),
    debugLogVerbose: prefBool("debugLogVerbose", false),
    overlayBridgePort,
  };
}
function readCurrentSubtitle() {
  let sub = "";
  try {
    sub = mpv.getString("sub-text") || "";
  } catch (_) {
    sub = "";
  }
  const clean = cleanSubtitleText(
    sub,
    prefBool("flattenSubtitleLineBreaks", false),
  );
  const language = selectedLanguageModule();
  if (language && typeof language.normalizeSubtitleText === "function")
    return language.normalizeSubtitleText(clean);
  return clean;
}
function normalizeExperimentalSubtitleText(subtitle) {
  const clean = cleanSubtitleText(
    subtitle,
    prefBool("flattenSubtitleLineBreaks", false),
  );
  const language = selectedLanguageModule();
  const subtitleNormalized =
    language && typeof language.normalizeSubtitleText === "function"
      ? language.normalizeSubtitleText(clean)
      : clean;
  const languageNormalized =
    language && typeof language.normalizeText === "function"
      ? language.normalizeText(subtitleNormalized)
      : subtitleNormalized;
  return IINATAN_LANGUAGE_COMMON.normalizeBasic(languageNormalized);
}
function readExperimentalLookupSubtitleProperty(property) {
  let sub = "";
  try {
    sub = mpv.getString(property || "sub-text") || "";
  } catch (_) {
    sub = "";
  }
  return normalizeExperimentalSubtitleText(sub);
}
function readExperimentalLookupSubtitle() {
  return readExperimentalLookupSubtitleProperty("sub-text");
}
function cleanNativeDisplayText(text) {
  // This intentionally differs from lookup cleaning: it preserves authored
  // line breaks and repeated spaces for the continuous measurement flow.
  return decodeEntities(String(text || ""))
    .replace(/\uFEFF/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "");
}
function experimentalNativeSubtitleMode() {
  return prefBool("experimentalNativeSubtitleHitLayer", false);
}
function resetExperimentalSubtitleLookupBinding() {
  experimentalSubtitleLookupBinding = null;
}
function invalidateCurrentSubtitleLookupLine() {
  currentSubtitleLineId = ++subtitleLineSerial;
  resetExperimentalSubtitleLookupBinding();
  resetHoverLookupQueue();
}
function subtitleLookupInputForLine(lineId) {
  const binding = experimentalSubtitleLookupBinding;
  if (experimentalNativeSubtitleMode()) {
    if (binding && binding.lineId === Number(lineId)) return binding.input;
    return null;
  }
  return lastSubtitle || "";
}
function publishSubtitle(text, nativeCue) {
  const legacyText = text || "";
  const lookupText =
    nativeCue && typeof nativeCue.lookupText === "string"
      ? nativeCue.lookupText
      : legacyText;
  currentSubtitleLineId = ++subtitleLineSerial;
  resetHoverLookupQueue();
  resetExperimentalSubtitleLookupBinding();
  if (
    experimentalNativeSubtitleMode() &&
    nativeCue &&
    !nativeCue.reason &&
    typeof nativeCue.lookupText === "string"
  ) {
    experimentalSubtitleLookupBinding = {
      lineId: currentSubtitleLineId,
      input: canonicalSubtitleLookupInput(lookupText),
    };
  }
  const language = selectedLanguageModule();
  const dicts = activeDictionaryPaths(language);
  debugVerbose(
    "publishSubtitle lineId=" +
      currentSubtitleLineId +
      " language=" +
      language.id +
      " activeDicts=" +
      dicts.length +
      " len=" +
      String(lookupText || "").length,
  );
  postToOverlay("subtitle", {
    text: lookupText,
    displayText:
      nativeCue && nativeCue.displayText !== undefined
        ? nativeCue.displayText
        : text || "",
    nativeReason: (nativeCue && nativeCue.reason) || "",
    nativeLookupSpans: (nativeCue && nativeCue.lookupSpans) || [],
    nativeLayout: (nativeCue && nativeCue.layout) || null,
    nativeSurfaces: (nativeCue && nativeCue.surfaces) || [],
    renderingMode: experimentalNativeSubtitleMode()
      ? "experimental-native-hit"
      : "legacy",
    config: overlayConfig(),
    lineId: currentSubtitleLineId,
  });
  postToOverlay("line-lookup-reset", { lineId: currentSubtitleLineId });
  // v1.5.0: no full-line background precompute. Hover requests are looked up
  // directly and serialized so the hovered word is never blocked by a batch.
  if (lookupText && language.hasLookupText(lookupText) && dicts.length) {
    ensureBackendWorker(dicts, language).catch((error) => {
      debugLog(
        "background worker warmup failed lineId=" +
          currentSubtitleLineId +
          ": " +
          compactError(error),
      );
    });
  }
}
function canHideNativeSubtitlesForCurrentLanguage() {
  if (!lookupBackendReadyForNativeHide) return false;
  try {
    const language = selectedLanguageModule();
    const dicts = activeDictionaryPaths(language);
    if (dictionarySetupMessage(language, dicts)) return false;
    const ready = activeWorkerReady || readWorkerReady();
    return (
      !!ready &&
      activeWorkerFingerprint === workerFingerprint(dicts, language) &&
      ready.fingerprint === activeWorkerFingerprint
    );
  } catch (_) {
    return false;
  }
}
function acquireNativeSubtitleVisibilityOwnership() {
  if (nativeSubtitleVisibilityOwned) return;
  try {
    nativeSubVisibilityBeforeEnable = mpv.getFlag("sub-visibility");
    nativeSubtitleVisibilityOwned = true;
  } catch (_) {
    nativeSubVisibilityBeforeEnable = null;
    nativeSubtitleVisibilityOwned = false;
  }
}
function restoreNativeSubtitleVisibility() {
  if (!nativeSubtitleVisibilityOwned) return;
  try {
    if (nativeSubVisibilityBeforeEnable !== null)
      mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable);
  } catch (_) {}
  nativeSubtitleVisibilityOwned = false;
  nativeSubVisibilityBeforeEnable = null;
}
function syncNativeSubtitleVisibility() {
  if (!enabled || !nativeSubtitlePlaybackActive) return;
  acquireNativeSubtitleVisibilityOwnership();
  try {
    const target = nativeSubtitleVisibilityTarget({
      enabled,
      experimental: experimentalNativeSubtitleMode(),
      hideNative: prefBool("hideNativeSubtitles", true),
      backendReady: canHideNativeSubtitlesForCurrentLanguage(),
      original: nativeSubVisibilityBeforeEnable,
    });
    if (target !== null && target !== undefined)
      mpv.set("sub-visibility", target);
  } catch (error) {
    console.warn(
      "Could not update native subtitle visibility: " + compactError(error),
    );
  }
}
function pollSubtitle() {
  if (!enabled) return;
  refreshPollingInterval();
  syncNativeSubtitleVisibility();
  const sub = readCurrentSubtitle();
  lastSubtitle = sub;
  if (!experimentalNativeSubtitleMode()) {
    const identity = "legacy:" + sub;
    if (identity === lastSubtitleCueIdentity) return;
    lastSubtitleCueIdentity = identity;
    publishSubtitle(sub, null);
    return;
  }
  let nativeCue =
    typeof nativeSubtitleCombinedCueSnapshot === "function"
      ? nativeSubtitleCombinedCueSnapshot()
      : nativeSubtitleCueSnapshot(readExperimentalLookupSubtitle());
  if (
    nativeCue &&
    !nativeCue.reason &&
    typeof nativeCue.lookupText !== "string"
  )
    nativeCue.lookupText = readExperimentalLookupSubtitle();
  const experimentalLookupText = String(
    (nativeCue && nativeCue.lookupText) || "",
  );
  const layoutFingerprint = JSON.stringify(
    nativeCue && nativeCue.surfaces
      ? nativeCue.surfaces.map((surface) => surface.layout || surface.reason)
      : nativeCue && nativeCue.layout
        ? nativeCue.layout
        : nativeCue.reason || "",
  );
  if (layoutFingerprint !== lastNativeLayoutFingerprint) {
    lastNativeLayoutFingerprint = layoutFingerprint;
    nativeLayoutStablePolls = 0;
  } else {
    nativeLayoutStablePolls++;
  }
  if (
    nativeCue.surfaces &&
    nativeCue.surfaces.some((surface) => surface.layout) &&
    !nativeCue.reason &&
    nativeLayoutStablePolls < 1
  ) {
    nativeCue = {
      reason: "unstable-osd-dimensions",
      trackId: nativeCue.trackId,
    };
    if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
      scheduleExperimentalNativeLayoutRebuild();
  }
  if (typeof reportNativeAssReadiness === "function")
    reportNativeAssReadiness(nativeCue);
  const identity = JSON.stringify({
    subtitle: experimentalLookupText,
    cue: currentSubtitleCueIdentity(nativeCue),
    layoutFingerprint,
    stable: nativeLayoutStablePolls > 0,
  });
  if (identity === lastSubtitleCueIdentity) return;
  lastSubtitleCueIdentity = identity;
  publishSubtitle(sub, nativeCue);
}
function charsOf(text) {
  return Array.from(String(text || ""));
}
