function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function cleanSubtitleText(text) {
  return decodeEntities(String(text || ""))
    .replace(/\uFEFF/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .trim();
}
function isJapaneseish(text) { return languageModuleById("ja").hasLookupText(text); }
function mpvStringProp(names, fallback) {
  for (const name of names) {
    try {
      const value = mpv.getString(name);
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    } catch (_) {}
  }
  return fallback;
}
function sanitizeFontFamily(font) {
  const raw = String(font || "").trim();
  if (!raw) return '"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
  if (/[,"]/.test(raw)) return raw;
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(raw)) return raw;
  return '"' + raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
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
    return "rgba(" + r + "," + g + "," + b + "," + Math.round(a * 1000) / 1000 + ")";
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
  const fontSize = clampNumber(mpvNumberProp(["options/sub-font-size", "sub-font-size"], 0), 18, 120, 0);
  const borderSize = clampNumber(mpvNumberProp(["options/sub-border-size", "sub-border-size"], 3), 0, 16, 3);
  const shadowOffset = clampNumber(mpvNumberProp(["options/sub-shadow-offset", "sub-shadow-offset"], 2), 0, 24, 2);
  const shadowBlur = clampNumber(mpvNumberProp(["options/sub-shadow-blur", "sub-shadow-blur"], Math.max(2, shadowOffset * 1.6)), 0, 32, Math.max(2, shadowOffset * 1.6));
  const bold = mpvBoolProp(["options/sub-bold", "sub-bold"], true);
  const italic = mpvBoolProp(["options/sub-italic", "sub-italic"], false);
  return {
    subtitleFontFamily: readSubtitleFontFamily(),
    subtitleFontSize: fontSize > 0 ? (String(fontSize) + "px") : "clamp(26px, 4.2vw, 64px)",
    subtitleFontWeight: bold ? "800" : "400",
    subtitleFontStyle: italic ? "italic" : "normal",
    subtitleColor: readMpvColor(["options/sub-color", "sub-color"], "#ffffff"),
    subtitleBorderColor: readMpvColor(["options/sub-border-color", "sub-border-color"], "#000000"),
    subtitleOutlineWidth: String(borderSize) + "px",
    subtitleShadowColor: readMpvColor(["options/sub-shadow-color", "sub-shadow-color"], "rgba(0,0,0,0.9)"),
    subtitleShadowOffset: String(shadowOffset) + "px",
    subtitleShadowBlur: String(shadowBlur) + "px"
  };
}
function overlayConfig() {
  const language = selectedLanguageModule();
  return {
    language: selectedLanguageOverlayConfig(),
    lookupLanguage: language.id,
    fontScale: prefNumber("fontScale", 1.0),
    popupScale: prefNumber("popupScale", 0.92),
    popupMaxWidth: Math.max(260, prefNumber("popupMaxWidth", 440)),
    popupMaxHeightVh: Math.max(20, prefNumber("popupMaxHeightVh", 34)),
    popupSubtitleGapPx: Math.max(12, prefNumber("popupSubtitleGapPx", 34)),
    ...readSubtitleStyleConfig(),
    maxEntries: Math.max(1, prefNumber("maxEntries", 3)),
    maxGlossesPerEntry: Math.max(1, prefNumber("maxGlossesPerEntry", 4)),
    scanLength: Math.max(1, prefNumber("scanLength", 24)),
    hoverRequestTimeoutMs: Math.max(1500, prefNumber("hoverRequestTimeoutMs", 15000)),
    debugLogEnabled: prefBool("debugLogEnabled", true),
    debugLogVerbose: prefBool("debugLogVerbose", false),
    overlayBridgePort
  };
}
function readCurrentSubtitle() {
  let sub = "";
  try { sub = mpv.getString("sub-text") || ""; } catch (_) { sub = ""; }
  return cleanSubtitleText(sub);
}
function publishSubtitle(text) {
  const normalized = text || "";
  currentSubtitleLineId = ++subtitleLineSerial;
  debugLog("publishSubtitle lineId=" + currentSubtitleLineId + " len=" + String(normalized || "").length + " text=" + JSON.stringify(String(normalized || "").slice(0, 80)));
  postToOverlay("subtitle", { text: normalized, config: overlayConfig(), lineId: currentSubtitleLineId });
  postToOverlay("line-lookup-reset", { lineId: currentSubtitleLineId });
  // v1.5.0: no full-line background precompute. Hover requests are looked up
  // directly and serialized so the hovered word is never blocked by a batch.
  const language = selectedLanguageModule();
  if (normalized && language.hasLookupText(normalized) && activeDictionaryPaths().length) {
    ensureBackendWorker(activeDictionaryPaths()).catch(error => {
      debugLog("background worker warmup failed lineId=" + currentSubtitleLineId + ": " + compactError(error));
    });
  }
}
function syncNativeSubtitleVisibility() {
  if (!enabled) return;
  try {
    if (prefBool("hideNativeSubtitles", true)) {
      mpv.set("sub-visibility", false);
    } else if (nativeSubVisibilityBeforeEnable !== null) {
      mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable);
    }
  } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
}
function pollSubtitle() {
  if (!enabled) return;
  refreshPollingInterval();
  syncNativeSubtitleVisibility();
  const sub = readCurrentSubtitle();
  if (sub === lastSubtitle) return;
  lastSubtitle = sub;
  publishSubtitle(sub);
}
function charsOf(text) { return Array.from(String(text || "")); }
