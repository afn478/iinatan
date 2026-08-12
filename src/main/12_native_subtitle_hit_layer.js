function nativeSubtitleJsonProperty(name, fallback) {
  try {
    if (mpv && typeof mpv.getNative === "function") {
      const value = mpv.getNative(name);
      if (value !== undefined && value !== null) return value;
    }
  } catch (_) {}
  try {
    const raw = mpv.getString(name);
    if (raw !== undefined && raw !== null && String(raw).trim()) {
      return JSON.parse(String(raw));
    }
  } catch (_) {}
  return fallback;
}

function normalizeNativeOsdDimensions(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const number = (key, fallback) => {
    const result = Number(value[key]);
    return Number.isFinite(result) ? result : fallback;
  };
  const osd = {
    w: number("w", 0),
    h: number("h", 0),
    ml: number("ml", 0),
    mr: number("mr", 0),
    mt: number("mt", 0),
    mb: number("mb", 0),
    par: number("par", 1),
  };
  if (osd.w < 64 || osd.h < 64) return null;
  if (
    osd.ml < 0 ||
    osd.mr < 0 ||
    osd.mt < 0 ||
    osd.mb < 0 ||
    osd.ml + osd.mr >= osd.w ||
    osd.mt + osd.mb >= osd.h
  )
    return null;
  if (osd.par < 0.1 || osd.par > 10) return null;
  return osd;
}

function normalizeNativeVideoDimensions(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const numeric = (key) => {
    const result = Number(value[key]);
    return Number.isFinite(result) ? result : 0;
  };
  const width = Math.round(numeric("w"));
  const height = Math.round(numeric("h"));
  const displayWidth = numeric("dw");
  const displayHeight = numeric("dh");
  let par = numeric("par");
  if (
    !(par >= 0.1 && par <= 10) &&
    displayWidth > 0 &&
    displayHeight > 0 &&
    width > 0 &&
    height > 0
  )
    par = (displayWidth * height) / (displayHeight * width);
  if (!(par >= 0.1 && par <= 10)) par = 1;
  if (
    width < 16 ||
    height < 16 ||
    width * height > 16000000 ||
    numeric("rotate") !== 0
  )
    return null;
  return { width, height, par };
}

function nativeSubtitleOptionSnapshot(surfaceName) {
  const secondary = surfaceName === "secondary";
  const align = (value, allowed, fallback) => {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (!normalized) return fallback;
    return allowed.indexOf(normalized) >= 0 ? normalized : "__unsupported__";
  };
  const runtimeFont = mpvStringProp(["sub-font"], "");
  const optionFont = mpvStringProp(["options/sub-font"], "");
  const effectiveFont = runtimeFont || optionFont || "sans-serif";
  const fontProvider = mpvStringProp(
    ["options/sub-font-provider", "sub-font-provider"],
    "auto",
  )
    .trim()
    .toLowerCase();
  return {
    font: effectiveFont,
    effectiveFont,
    runtimeFont,
    optionFont,
    fontProvider,
    fontSize: clampNumber(
      mpvNumberProp(["options/sub-font-size", "sub-font-size"], 55),
      1,
      240,
      55,
    ),
    scale: clampNumber(
      mpvNumberProp(
        secondary
          ? ["options/secondary-sub-scale", "secondary-sub-scale"]
          : ["options/sub-scale", "sub-scale"],
        1,
      ),
      0.1,
      10,
      1,
    ),
    scaleByWindow: mpvBoolProp(
      ["options/sub-scale-by-window", "sub-scale-by-window"],
      true,
    ),
    scaleWithWindow: mpvBoolProp(
      ["options/sub-scale-with-window", "sub-scale-with-window"],
      true,
    ),
    assScaleWithWindow: mpvBoolProp(
      ["options/sub-ass-scale-with-window", "sub-ass-scale-with-window"],
      false,
    ),
    assVsfilterAspectCompat: mpvBoolProp(
      [
        "options/sub-ass-vsfilter-aspect-compat",
        "sub-ass-vsfilter-aspect-compat",
      ],
      true,
    ),
    assVsfilterBlurCompat: mpvBoolProp(
      ["options/sub-ass-vsfilter-blur-compat", "sub-ass-vsfilter-blur-compat"],
      true,
    ),
    marginX: clampNumber(
      mpvNumberProp(["options/sub-margin-x", "sub-margin-x"], 20),
      0,
      720,
      20,
    ),
    marginY: clampNumber(
      mpvNumberProp(["options/sub-margin-y", "sub-margin-y"], 22),
      0,
      720,
      22,
    ),
    position: clampNumber(
      mpvNumberProp(
        secondary
          ? ["options/secondary-sub-pos", "secondary-sub-pos"]
          : ["options/sub-pos", "sub-pos"],
        secondary ? 0 : 100,
      ),
      0,
      150,
      secondary ? 0 : 100,
    ),
    alignX: align(
      mpvStringProp(["options/sub-align-x", "sub-align-x"], "center"),
      ["left", "center", "right"],
      "center",
    ),
    alignY: align(
      secondary
        ? "top"
        : mpvStringProp(["options/sub-align-y", "sub-align-y"], "bottom"),
      ["top", "center", "bottom"],
      "bottom",
    ),
    positionFromTop: secondary,
    justify: align(
      mpvStringProp(["options/sub-justify", "sub-justify"], "auto"),
      ["auto", "left", "center", "right"],
      "auto",
    ),
    spacing: clampNumber(
      mpvNumberProp(["options/sub-spacing", "sub-spacing"], 0),
      -20,
      100,
      0,
    ),
    lineSpacing: clampNumber(
      mpvNumberProp(
        [
          "options/sub-line-spacing",
          "sub-line-spacing",
          "options/sub-ass-line-spacing",
          "sub-ass-line-spacing",
        ],
        0,
      ),
      -100,
      200,
      0,
    ),
    forceMargins: mpvBoolProp(
      ["options/sub-ass-force-margins", "sub-ass-force-margins"],
      false,
    ),
    assJustify: mpvBoolProp(
      ["options/sub-ass-justify", "sub-ass-justify"],
      false,
    ),
    useMargins: mpvBoolProp(
      ["options/sub-use-margins", "sub-use-margins"],
      true,
    ),
    bold: mpvBoolProp(["options/sub-bold", "sub-bold"], true),
    italic: mpvBoolProp(["options/sub-italic", "sub-italic"], false),
  };
}

function nativeAssOverrideClassification(value) {
  const mode = String(value || "yes")
    .trim()
    .toLowerCase();
  if (mode === "no" || mode === "yes" || mode === "scale")
    return { mode, nativeGeometry: true };
  if (mode === "force" || mode === "strip")
    return { mode, nativeGeometry: false };
  return { mode, reason: "unsupported-ass-override" };
}

function nativeSubtitleFontCompatibility(font, text) {
  const primaryFamily = String(font || "")
    .split(",")[0]
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toLowerCase();
  const hasCjkText =
    /[\u1100-\u11ff\u2e80-\u312f\u3130-\u318f\u31a0-\u31bf\u31f0-\u31ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff66-\uff9f]/.test(
      String(text || ""),
    );
  if (
    hasCjkText &&
    /^(symbol|apple symbols|wingdings(?: [23])?|webdings|zapf dingbats)$/.test(
      primaryFamily,
    )
  )
    return { reason: "font-incompatible-with-script" };
  return { ok: true };
}

function nativeSubtitleFontMetricScale(metrics) {
  const value = metrics && typeof metrics === "object" ? metrics : {};
  const unitsPerEm = Number(value.unitsPerEm);
  const usWinAscent = Number(value.usWinAscent);
  const usWinDescent = Number(value.usWinDescent);
  const winHeight = usWinAscent + usWinDescent;
  if (
    !Number.isFinite(unitsPerEm) ||
    !Number.isFinite(usWinAscent) ||
    !Number.isFinite(usWinDescent) ||
    unitsPerEm <= 0 ||
    usWinAscent < 0 ||
    usWinDescent < 0 ||
    winHeight <= 0
  )
    return null;
  const scale = unitsPerEm / winHeight;
  return Number.isFinite(scale) && scale > 0.1 && scale <= 2 ? scale : null;
}

function nativeSubtitleFontCoverageSignature(text) {
  const codepoints = Object.create(null);
  Array.from(String(text || "")).forEach((character) => {
    const codepoint = character.codePointAt(0);
    if (
      codepoint <= 0x20 ||
      (codepoint >= 0x7f && codepoint <= 0xa0) ||
      codepoint === 0x1680 ||
      (codepoint >= 0x2000 && codepoint <= 0x200f) ||
      (codepoint >= 0x2028 && codepoint <= 0x202f) ||
      (codepoint >= 0x205f && codepoint <= 0x206f) ||
      codepoint === 0x3000 ||
      codepoint === 0xfeff ||
      (codepoint >= 0xfe00 && codepoint <= 0xfe0f) ||
      (codepoint >= 0xe0100 && codepoint <= 0xe01ef)
    )
      return;
    codepoints[codepoint.toString(16)] = codepoint;
  });
  return Object.keys(codepoints)
    .map((key) => codepoints[key])
    .sort((left, right) => left - right)
    .map((codepoint) => codepoint.toString(16))
    .join(",");
}

function nativeSubtitleFontMetricCacheKey(options, text) {
  const value = options && typeof options === "object" ? options : {};
  return JSON.stringify([
    String(value.effectiveFont || value.font || ""),
    value.bold !== false,
    value.italic === true,
    nativeSubtitleFontCoverageSignature(text),
  ]);
}

function normalizeNativeSubtitleFontMetricResult(result) {
  const value = result && typeof result === "object" ? result : {};
  const calculatedScale = nativeSubtitleFontMetricScale(value);
  const reportedScale = Number(value.fontMetricScale);
  const resolvedPostScriptName = String(
    value.resolvedPostScriptName || "",
  ).trim();
  const resolvedFamilyName = String(value.resolvedFamilyName || "").trim();
  const resolvedFullName = String(value.resolvedFullName || "").trim();
  const fontVersion = String(value.fontVersion || "").trim();
  const resolvedFontFormat = Number(value.resolvedFontFormat);
  if (
    value.ok !== true ||
    Number(value.metricResolverVersion) !== 2 ||
    String(value.metricSource || "") !== "coretext-libass-os2-win-v2" ||
    value.libassProviderVerified !== true ||
    !calculatedScale ||
    !Number.isFinite(reportedScale) ||
    Math.abs(reportedScale - calculatedScale) > 0.000001 ||
    !resolvedPostScriptName ||
    !resolvedFamilyName ||
    !resolvedFullName ||
    !fontVersion ||
    !Number.isInteger(resolvedFontFormat) ||
    resolvedFontFormat < 1 ||
    resolvedFontFormat > 5 ||
    typeof value.syntheticBold !== "boolean" ||
    typeof value.syntheticItalic !== "boolean" ||
    /[\u0000-\u001f;{}]/.test(resolvedPostScriptName) ||
    !value.cueCoverage ||
    value.cueCoverage.ok !== true
  )
    throw new Error("font-metrics-invalid-result");
  return {
    resolvedPostScriptName,
    resolvedFamilyName,
    resolvedFullName,
    fontVersion,
    unitsPerEm: Number(value.unitsPerEm),
    usWinAscent: Number(value.usWinAscent),
    usWinDescent: Number(value.usWinDescent),
    fontMetricScale: calculatedScale,
    fontMetricSource: "coretext-libass-os2-win-v2",
    fontMetricResolverVersion: 2,
    libassProviderVerified: true,
    resolvedFontFormat,
    resolvedBold: value.resolvedBold === true,
    resolvedItalic: value.resolvedItalic === true,
    syntheticBold: value.syntheticBold === true,
    syntheticItalic: value.syntheticItalic === true,
    weightTrait: Number.isFinite(Number(value.weightTrait))
      ? Number(value.weightTrait)
      : 0,
  };
}

function nativeSubtitlePrivateCueDirectory() {
  return String(dataRoot()).replace(/\/+$/, "") + "/private-font-metric-cues";
}

const NATIVE_SUBTITLE_FONT_METRIC_MAX_ATTEMPTS = 2;
const NATIVE_SUBTITLE_FONT_METRIC_RETRY_DELAY_MS = 500;
const NATIVE_SUBTITLE_DETERMINISTIC_FONT_METRIC_FAILURES = {
  "font-metrics-missing-font": true,
  "font-metrics-invalid-font-name": true,
  "font-metrics-font-not-found": true,
  "font-metrics-provider-unverified": true,
  "font-metrics-style-unavailable": true,
  "font-metrics-family-mismatch": true,
  "font-metrics-missing-name": true,
  "font-metrics-variable-font-unsupported": true,
  "font-metrics-missing-table": true,
  "font-metrics-invalid-table": true,
  "font-metrics-invalid-scale": true,
  "font-metrics-cue-not-covered": true,
};

function nativeSubtitleFontMetricFailure(code, retryable) {
  const error = new Error(String(code || "font-metrics-command-failed"));
  error.nativeSubtitleFontMetricCode = String(
    code || "font-metrics-command-failed",
  );
  error.nativeSubtitleFontMetricRetryable = retryable !== false;
  return error;
}

function nativeSubtitleFontMetricCommandFailure(result) {
  let code = "font-metrics-command-failed";
  try {
    const parsed = parseBackendJsonOutput(
      result && result.stdout,
      result && result.stderr,
    );
    if (parsed && parsed.error) code = String(parsed.error);
  } catch (_) {}
  if (!/^font-metrics-[a-z0-9-]+$/.test(code))
    code = "font-metrics-command-failed";
  return nativeSubtitleFontMetricFailure(
    code,
    !NATIVE_SUBTITLE_DETERMINISTIC_FONT_METRIC_FAILURES[code],
  );
}

function prepareNativeSubtitlePrivateCueDirectory() {
  if (nativeSubtitlePrivateCueDirectoryPromise)
    return nativeSubtitlePrivateCueDirectoryPromise;
  nativeSubtitlePrivateCueDirectoryPromise = ensureBundledBackendInstalled()
    .then(() => {
      if (file.exists(nativeSubtitlePrivateCueDirectory()))
        return { status: 0 };
      return utils.exec(
        "/bin/mkdir",
        ["-p", nativeSubtitlePrivateCueDirectory()],
        dataRoot(),
      );
    })
    .then((result) => {
      if (!result || Number(result.status) !== 0)
        throw new Error("font-metrics-private-directory-failed");
      return utils.exec(
        "/bin/chmod",
        ["700", nativeSubtitlePrivateCueDirectory()],
        dataRoot(),
      );
    })
    .then((result) => {
      if (!result || Number(result.status) !== 0)
        throw new Error("font-metrics-private-directory-failed");
      return clearDirFiles(nativeSubtitlePrivateCueDirectory());
    });
  return nativeSubtitlePrivateCueDirectoryPromise;
}

async function runNativeSubtitleFontMetricCommand(options, text) {
  await prepareNativeSubtitlePrivateCueDirectory();
  const value = options && typeof options === "object" ? options : {};
  nativeSubtitlePrivateCueSerial++;
  const cuePath =
    nativeSubtitlePrivateCueDirectory() +
    "/iinatan-font-metrics-cue-" +
    Date.now().toString(36) +
    "-" +
    nativeSubtitlePrivateCueSerial.toString(36) +
    "-" +
    Math.floor(Math.random() * 0x100000000).toString(16) +
    ".txt";
  const args = [
    "font-metrics",
    "--font",
    String(value.effectiveFont || value.font || ""),
    "--bold",
    value.bold === false ? "no" : "yes",
    "--italic",
    value.italic === true ? "yes" : "no",
    "--cue-file",
    cuePath,
  ];
  let timeoutId = null;
  try {
    file.write(cuePath, String(text || ""));
    const chmodResult = await utils.exec(
      "/bin/chmod",
      ["600", cuePath],
      dataRoot(),
    );
    if (!chmodResult || Number(chmodResult.status) !== 0)
      throw new Error("font-metrics-private-cue-permissions-failed");
    const result = await Promise.race([
      utils.exec(binPath(), args, dataRoot()),
      new Promise((_, reject) => {
        timeoutId = scheduleOneShot(
          () =>
            reject(
              nativeSubtitleFontMetricFailure("font-metrics-timeout", true),
            ),
          8000,
        );
      }),
    ]);
    if (!result || Number(result.status) !== 0)
      throw nativeSubtitleFontMetricCommandFailure(result);
    const parsed = parseBackendJsonOutput(result.stdout, result.stderr);
    return normalizeNativeSubtitleFontMetricResult(parsed);
  } finally {
    if (timeoutId !== null) cancelOneShot(timeoutId);
    safeDelete(cuePath);
  }
}

function advanceNativeSubtitleFontMetricGeneration() {
  nativeSubtitleFontMetricGeneration++;
  // A helper failure can be transient (for example, while IINA is resuming
  // after a lookup-owned pause). Keep verified face metrics, but do not let a
  // failed coverage probe poison later lifecycle generations until restart.
  Object.keys(nativeSubtitleFontMetricCache).forEach((key) => {
    if (
      nativeSubtitleFontMetricCache[key] &&
      nativeSubtitleFontMetricCache[key].status === "failed"
    )
      delete nativeSubtitleFontMetricCache[key];
  });
}

function notifyNativeSubtitleFontMetricResolution(key, generation) {
  if (generation !== nativeSubtitleFontMetricGeneration) return;
  if (typeof invalidateExperimentalNativeLayout === "function")
    invalidateExperimentalNativeLayout("font-metrics-resolved");
  if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
    scheduleExperimentalNativeLayoutRebuild();
}

const NATIVE_SUBTITLE_FONT_METRIC_CACHE_MAX_ENTRIES = 32;
const NATIVE_EXTERNAL_SRT_CACHE_MAX_ENTRIES = 4;

function pruneNativeSubtitleFontMetricCache() {
  const keys = Object.keys(nativeSubtitleFontMetricCache);
  while (keys.length > NATIVE_SUBTITLE_FONT_METRIC_CACHE_MAX_ENTRIES)
    delete nativeSubtitleFontMetricCache[keys.shift()];
}

function nativeSubtitleFontMetricSnapshot(options, text) {
  const key = nativeSubtitleFontMetricCacheKey(options, text);
  const cached = nativeSubtitleFontMetricCache[key];
  if (cached && cached.status === "ready")
    return { ok: true, metrics: cached.metrics };
  const failedAttempts =
    cached && cached.status === "failed"
      ? Math.max(1, Number(cached.attempts) || 1)
      : 0;
  if (
    failedAttempts &&
    (cached.retryable !== true ||
      failedAttempts >= NATIVE_SUBTITLE_FONT_METRIC_MAX_ATTEMPTS)
  )
    return { reason: "font-metrics-unavailable" };
  if (
    failedAttempts &&
    Date.now() < Number(cached.retryAt || Number.POSITIVE_INFINITY)
  )
    return { reason: "font-metrics-pending" };
  const generation = nativeSubtitleFontMetricGeneration;
  const inFlightKey = String(generation) + ":" + key;
  if (!nativeSubtitleFontMetricInFlight[inFlightKey]) {
    const request = runNativeSubtitleFontMetricCommand(options, text)
      .then((metrics) => {
        if (generation === nativeSubtitleFontMetricGeneration)
          nativeSubtitleFontMetricCache[key] = {
            status: "ready",
            metrics,
          };
        pruneNativeSubtitleFontMetricCache();
        return metrics;
      })
      .catch((error) => {
        if (generation === nativeSubtitleFontMetricGeneration) {
          const retryable =
            !error || error.nativeSubtitleFontMetricRetryable !== false;
          const attempts = failedAttempts + 1;
          const reportedCode = String(
            (error && error.nativeSubtitleFontMetricCode) ||
              (error && error.message) ||
              "font-metrics-command-failed",
          );
          const code = /^font-metrics-[a-z0-9-]+$/.test(reportedCode)
            ? reportedCode
            : "font-metrics-command-failed";
          nativeSubtitleFontMetricCache[key] = {
            status: "failed",
            attempts,
            retryable,
            retryAt:
              retryable && attempts < NATIVE_SUBTITLE_FONT_METRIC_MAX_ATTEMPTS
                ? Date.now() + NATIVE_SUBTITLE_FONT_METRIC_RETRY_DELAY_MS
                : 0,
          };
          pruneNativeSubtitleFontMetricCache();
          // The cache key and cue are intentionally omitted: diagnostics may
          // identify the failure class, but must never include subtitle text.
          debugWarn(
            "native subtitle font metrics failed code=" +
              code +
              " retryable=" +
              String(retryable) +
              " attempt=" +
              attempts +
              "/" +
              NATIVE_SUBTITLE_FONT_METRIC_MAX_ATTEMPTS,
          );
        }
        return null;
      })
      .then((metrics) => {
        delete nativeSubtitleFontMetricInFlight[inFlightKey];
        notifyNativeSubtitleFontMetricResolution(key, generation);
        return metrics;
      });
    nativeSubtitleFontMetricInFlight[inFlightKey] = request;
  }
  return { reason: "font-metrics-pending" };
}

function normalizeNativeTrack(track) {
  const value = track && typeof track === "object" ? track : {};
  const externalFilename = String(
    value["external-filename"] || value.externalFilename || "",
  );
  const reportedCodec = String(value.codec || "")
    .trim()
    .toLowerCase();
  const codecDescription = String(value["codec-desc"] || "")
    .trim()
    .toLowerCase();
  let codec = reportedCodec || codecDescription;
  const hasConcreteReportedCodec = !!reportedCodec && reportedCodec !== "null";
  const onlineMediaSubtitle = value.external
    ? iinaOnlineMediaSubtitleEdlSource(externalFilename)
    : null;
  if (
    !hasConcreteReportedCodec &&
    onlineMediaSubtitle &&
    onlineMediaSubtitle.format === "srt"
  )
    codec = "srt";
  return {
    id: Number(value.id),
    selected: !!value.selected,
    mainSelection: Number(
      value["main-selection"] !== undefined
        ? value["main-selection"]
        : value.mainSelection,
    ),
    codec,
    ffIndex: Number(
      value["ff-index"] !== undefined ? value["ff-index"] : value.ffIndex,
    ),
    external: !!value.external,
    externalFilename,
    onlineMediaSubtitle,
    language: String(value.lang || value.language || ""),
    title: String(value.title || ""),
  };
}

function nativeSelectedSubtitleTracks(tracks, sid, secondarySid) {
  const list = Array.isArray(tracks) ? tracks : [];
  const selectedId = Number(sid);
  const selectedSecondaryId = Number(secondarySid);
  let primaryPreferred = null;
  let primarySelectedFallback = null;
  let primaryIdFallback = null;
  let secondaryPreferred = null;
  let secondarySelectedFallback = null;
  let secondaryIdFallback = null;
  for (const track of list) {
    if (!track || String(track.type || "").toLowerCase() !== "sub") continue;
    const id = Number(track.id);
    const mainSelection = Number(
      track["main-selection"] !== undefined
        ? track["main-selection"]
        : track.mainSelection,
    );
    if (
      !primaryPreferred &&
      track.selected &&
      (mainSelection === 0 || id === selectedId)
    )
      primaryPreferred = track;
    if (!primarySelectedFallback && track.selected && mainSelection !== 1)
      primarySelectedFallback = track;
    if (!primaryIdFallback && id === selectedId) primaryIdFallback = track;
    if (
      !secondaryPreferred &&
      track.selected &&
      (mainSelection === 1 || id === selectedSecondaryId)
    )
      secondaryPreferred = track;
    if (!secondaryIdFallback && id === selectedSecondaryId)
      secondaryIdFallback = track;
    if (!secondarySelectedFallback && track.selected && mainSelection === 1)
      secondarySelectedFallback = track;
  }
  return {
    primary:
      primaryPreferred || primarySelectedFallback || primaryIdFallback || null,
    secondary:
      secondaryPreferred ||
      secondaryIdFallback ||
      secondarySelectedFallback ||
      null,
  };
}

function nativeSelectedSubtitleTrack(tracks, sid, secondarySid, surfaceName) {
  const selected = nativeSelectedSubtitleTracks(tracks, sid, secondarySid);
  return surfaceName === "secondary" ? selected.secondary : selected.primary;
}

function nativeSubtitleEligibilityForTrack(rawTrack, surfaceName) {
  const surface = surfaceName === "secondary" ? "secondary" : "primary";
  if (!rawTrack)
    return {
      reason:
        surface === "secondary"
          ? "subtitle-track-unavailable"
          : "unsupported-codec",
    };
  const track = normalizeNativeTrack(rawTrack);
  if (/pgs|hdmv|dvd|vobsub|dvb|bitmap/.test(track.codec))
    return { reason: "bitmap-subtitle", track, surface };
  if (/(^|[^a-z])(subrip|srt)([^a-z]|$)/.test(track.codec))
    return { kind: "srt", track, surface };
  if (/(^|[^a-z])(ass|ssa)([^a-z]|$)/.test(track.codec))
    return { kind: "ass", track, surface };
  return { reason: "unsupported-codec", track, surface };
}

function nativeSubtitleTrackEligibility(
  tracks,
  sid,
  secondarySid,
  surfaceName,
) {
  const surface = surfaceName === "secondary" ? "secondary" : "primary";
  return nativeSubtitleEligibilityForTrack(
    nativeSelectedSubtitleTrack(tracks, sid, secondarySid, surface),
    surface,
  );
}

const NATIVE_BITMAP_OCR_NOTICE_VERSION = 1;
const NATIVE_BITMAP_OCR_MOUSE_INTENT_WINDOW_MS = 4000;
const NATIVE_BITMAP_OCR_MOUSE_GESTURE_GAP_MS = 650;
const NATIVE_BITMAP_OCR_MOUSE_LAYOUT_THROTTLE_MS = 200;
const NATIVE_BITMAP_OCR_LANGUAGE_IDS = {
  ja: ["ja-JP"],
  en: ["en-US"],
  de: ["de-DE"],
  fr: ["fr-FR"],
  ko: ["ko-KR"],
  zh: ["zh-Hans", "zh-Hant"],
};

function nativeBitmapSelectedTrack(surfaceName) {
  const eligibility = nativeSubtitleTrackEligibility(
    nativeSubtitleJsonProperty("track-list", []),
    mpvNumberProp(["sid", "options/sid"], 0),
    mpvStringProp(["secondary-sid", "options/secondary-sid"], "no"),
    surfaceName,
  );
  return eligibility && eligibility.reason === "bitmap-subtitle"
    ? eligibility.track
    : null;
}

function bitmapSubtitleOcrMode() {
  if (!prefBool("bitmapSubtitleOcrEnabled", true)) return false;
  const tracks = nativeSubtitleJsonProperty("track-list", []);
  const sid = mpvNumberProp(["sid", "options/sid"], 0);
  const secondarySid = mpvStringProp(
    ["secondary-sid", "options/secondary-sid"],
    "no",
  );
  const selected = nativeSelectedSubtitleTracks(tracks, sid, secondarySid);
  return [
    nativeSubtitleEligibilityForTrack(selected.primary, "primary"),
    nativeSubtitleEligibilityForTrack(selected.secondary, "secondary"),
  ].some((eligibility) => eligibility.reason === "bitmap-subtitle");
}

function triggerNativeBitmapOcrFromMouseMovement(source) {
  if (!enabled || !bitmapSubtitleOcrMode()) return false;
  if (!nativeBitmapOcrMouseIntentSeen) {
    nativeBitmapOcrMouseIntentSeen = true;
    debugLog(
      "bitmap OCR mouse intent accepted source=" + String(source || "mpv"),
    );
  }
  const now = Date.now();
  if (
    !Number.isFinite(nativeBitmapOcrIntentAt) ||
    now - nativeBitmapOcrIntentAt > NATIVE_BITMAP_OCR_MOUSE_GESTURE_GAP_MS
  )
    nativeBitmapOcrMouseIntentSerial++;
  nativeBitmapOcrIntentAt = now;
  if (
    now - nativeBitmapOcrMouseLayoutAt >=
    NATIVE_BITMAP_OCR_MOUSE_LAYOUT_THROTTLE_MS
  ) {
    nativeBitmapOcrMouseLayoutAt = now;
    if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
      scheduleExperimentalNativeLayoutRebuild();
  }
  debugVerbose("bitmap subtitle OCR requested by player mouse movement");
  return true;
}

function handleNativeBitmapOcrMouseInput() {
  if (!nativeBitmapOcrMouseActivitySeen) {
    nativeBitmapOcrMouseActivitySeen = true;
    debugLog(
      "bitmap OCR native mouse activity active bitmapMode=" +
        String(bitmapSubtitleOcrMode()),
    );
  }
  return triggerNativeBitmapOcrFromMouseMovement("native");
}

function observeNativeBitmapOcrMouseActivity(bitmapMode) {
  const active =
    typeof bitmapMode === "boolean" ? bitmapMode : bitmapSubtitleOcrMode();
  if (!enabled || !nativeBitmapOcrWindowMain || !active) {
    nativeBitmapOcrMouseActivityCounter = null;
    return false;
  }
  let ready = null;
  try {
    ready = activeWorkerReady || readWorkerReady();
  } catch (_) {}
  if (
    !ready ||
    !ready.mouseIntent ||
    ready.mouseIntent.protocol !== 1 ||
    !file.exists(workerMouseActivityPath())
  )
    return false;
  try {
    const activity = JSON.parse(file.read(workerMouseActivityPath()));
    const counter = Number(activity && activity.counter);
    if (
      !activity ||
      activity.protocol !== 1 ||
      !Number.isFinite(counter) ||
      counter < 0
    )
      return false;
    const previous = nativeBitmapOcrMouseActivityCounter;
    nativeBitmapOcrMouseActivityCounter = counter;
    if (previous === null || previous === counter) return false;
    return handleNativeBitmapOcrMouseInput();
  } catch (_) {
    return false;
  }
}

function observeNativeBitmapOcrPauseState() {
  const paused = mpvBoolProp(["pause"], false);
  if (paused !== nativeBitmapOcrPauseObserved) {
    nativeBitmapOcrPauseObserved = paused;
    if (paused) nativeBitmapOcrPauseIntentSerial++;
  }
  return paused;
}

function nativeBitmapOcrTrigger(pausedState) {
  const paused =
    typeof pausedState === "boolean"
      ? pausedState
      : observeNativeBitmapOcrPauseState();
  if (prefBool("bitmapSubtitleOcrPrefetchEnabled", false)) return "prefetch";
  if (paused) return "pause";
  if (
    Number.isFinite(nativeBitmapOcrIntentAt) &&
    Date.now() - nativeBitmapOcrIntentAt <=
      NATIVE_BITMAP_OCR_MOUSE_INTENT_WINDOW_MS
  )
    return "mouse";
  return "";
}

function nativeBitmapOcrIntentToken(trigger) {
  return [
    String(trigger || "intent"),
    "mouse=" + nativeBitmapOcrMouseIntentSerial,
    "pause=" + nativeBitmapOcrPauseIntentSerial,
    "prefetch=" +
      String(prefBool("bitmapSubtitleOcrPrefetchEnabled", false) ? 1 : 0),
  ].join(";");
}

function nativeBitmapOcrCapability() {
  let ready = null;
  try {
    ready = activeWorkerReady || readWorkerReady();
  } catch (_) {}
  const capability = ready && ready.bitmapOcr;
  return capability && capability.protocol === 1 ? capability : null;
}

function nativeBitmapOcrLanguages(capability) {
  const language = selectedLanguageModule();
  const requested = NATIVE_BITMAP_OCR_LANGUAGE_IDS[language.id] || [];
  const supported =
    capability && Array.isArray(capability.languages)
      ? capability.languages.map(String)
      : null;
  return supported
    ? requested.filter((value) => supported.indexOf(value) >= 0)
    : requested.slice();
}

function nativeBitmapOcrRenderer() {
  const osd = normalizeNativeOsdDimensions(
    nativeSubtitleJsonProperty("osd-dimensions", null),
  );
  const video = normalizeNativeVideoDimensions(
    nativeSubtitleJsonProperty("video-params", null),
  );
  if (!osd || !video) return null;
  return {
    osd,
    video,
    request: {
      width: osd.w,
      height: osd.h,
      storageWidth: video.width,
      storageHeight: video.height,
      marginLeft: osd.ml,
      marginRight: osd.mr,
      marginTop: osd.mt,
      marginBottom: osd.mb,
    },
  };
}

function nativeBitmapOcrSource(track) {
  const selected = track || {};
  const descriptor = selected.external
    ? mediaSourceDescriptor(selected.externalFilename, "subtitle-track")
    : currentMediaSourceSnapshot().primary;
  const ffIndex =
    Number.isInteger(selected.ffIndex) && selected.ffIndex >= 0
      ? selected.ffIndex
      : -1;
  return {
    descriptor,
    request:
      descriptor.nativeAssReadable && ffIndex >= 0
        ? {
            path: descriptor.locator,
            ffIndex,
            external: !!selected.external,
          }
        : null,
  };
}

function nativeBitmapOcrDirectGeometrySupported(surfaceName) {
  const options = nativeSubtitleOptionSnapshot(surfaceName);
  if (Math.abs(Number(options.scale) - 1) > 0.0001) return false;
  if (
    Math.abs(
      Number(options.position) - (surfaceName === "secondary" ? 0 : 100),
    ) > 0.0001
  )
    return false;
  if (
    mpvBoolProp(
      ["options/image-subs-video-resolution", "image-subs-video-resolution"],
      false,
    )
  )
    return false;
  if (
    mpvBoolProp(
      ["options/stretch-image-subs-to-screen", "stretch-image-subs-to-screen"],
      false,
    )
  )
    return false;
  return true;
}

function normalizeNativeBitmapOcrResponse(response, request) {
  if (
    !response ||
    response.ok !== true ||
    response.protocol !== 1 ||
    typeof response.text !== "string" ||
    !response.text ||
    response.text.length > 64 * 1024 ||
    !Array.isArray(response.units) ||
    !response.units.length ||
    response.units.length > 512 ||
    response.rendererWidth !== request.renderer.width ||
    response.rendererHeight !== request.renderer.height
  )
    return {
      reason: (response && response.reason) || "invalid-bitmap-ocr-response",
    };
  const displayText = cleanNativeDisplayText(response.text);
  const lookupText = normalizeExperimentalSubtitleText(displayText);
  const mapping = nativeLookupMapping(displayText, lookupText, {
    flattenLineBreaks: prefBool("flattenSubtitleLineBreaks", false),
    languageId: selectedLanguageModule().id,
  });
  if (!mapping.ok) return { reason: mapping.reason };
  const sourceUnits = [];
  response.units.forEach((unit) => {
    const start = Number(unit && unit.displayStartUtf16);
    const end = Number(unit && unit.displayEndUtf16);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > displayText.length ||
      !Array.isArray(unit.rects) ||
      !unit.rects.length ||
      unit.rects.length > 8
    )
      return;
    const rects = unit.rects
      .map((rect) => ({
        x: Number(rect && rect.x),
        y: Number(rect && rect.y),
        w: Number(rect && rect.w),
        h: Number(rect && rect.h),
      }))
      .filter(
        (rect) =>
          [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) &&
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.w > 0 &&
          rect.h > 0 &&
          rect.x + rect.w <= request.renderer.width + 0.5 &&
          rect.y + rect.h <= request.renderer.height + 0.5,
      );
    if (rects.length) sourceUnits.push({ start, end, rects });
  });
  if (!sourceUnits.length) return { reason: "invalid-bitmap-ocr-response" };
  const desired = nativeAssGeometryUnits(
    mapping,
    lookupText,
    selectedLanguageModule(),
  );
  const units = [];
  desired.forEach((unit) => {
    const matches = sourceUnits.filter(
      (source) =>
        source.start < unit.displayEndUtf16 &&
        source.end > unit.displayStartUtf16,
    );
    const rects = [];
    matches.forEach((match) =>
      match.rects.forEach((rect) => {
        if (
          !rects.some(
            (existing) =>
              Math.abs(existing.x - rect.x) < 0.01 &&
              Math.abs(existing.y - rect.y) < 0.01 &&
              Math.abs(existing.w - rect.w) < 0.01 &&
              Math.abs(existing.h - rect.h) < 0.01,
          )
        )
          rects.push(rect);
      }),
    );
    if (rects.length) units.push({ position: unit.position, rects });
  });
  if (!units.length) return { reason: "text-index-map-failed" };
  return {
    ok: true,
    displayText,
    lookupText,
    lookupSpans: mapping.lookupSpans,
    units,
    confidence: Number(response.confidence) || 0,
    mode: String(response.mode || ""),
    cueStartMs: Number(response.cueStartMs),
    cueEndMs: Number(response.cueEndMs),
  };
}

function nativeBitmapOcrCacheKey(request, track, surfaceName) {
  return JSON.stringify({
    generation: nativeBitmapOcrGeneration,
    surface: surfaceName,
    trackId: track && track.id,
    language: request.languages,
    source: request.source || null,
    cueStartMs: request.cueStartMs,
    cueEndMs: request.cueEndMs,
    renderer: request.renderer,
  });
}

function pruneNativeBitmapOcrCache() {
  [
    nativeBitmapOcrCache,
    nativeBitmapOcrFailures,
    nativeBitmapOcrIntents,
  ].forEach((cache) => {
    const keys = Object.keys(cache);
    while (keys.length > 16) delete cache[keys.shift()];
  });
}

async function prepareNativeBitmapCacheExcerpt(request) {
  const source = request && request.source;
  if (!source || source.external) return null;
  const descriptor = mediaSourceDescriptor(source.path, "bitmap-ocr");
  if (descriptor.kind === "local-file") return null;
  await prepareNativeSubtitlePrivateCueDirectory();
  nativeSubtitlePrivateCueSerial++;
  const excerptPath =
    nativeSubtitlePrivateCueDirectory() +
    "/iinatan-bitmap-cache-" +
    Date.now().toString(36) +
    "-" +
    nativeSubtitlePrivateCueSerial.toString(36) +
    ".media";
  const start = Math.max(0, Number(request.timeMs) / 1000 - 8);
  const end = Math.max(start + 1, Number(request.timeMs) / 1000 + 2);
  try {
    mpv.command("dump-cache", [
      String(start.toFixed(3)),
      String(end.toFixed(3)),
      excerptPath,
    ]);
    if (!file.exists(excerptPath)) {
      safeDelete(excerptPath);
      return null;
    }
    return {
      path: excerptPath,
      request: Object.assign({}, request, {
        source: {
          path: excerptPath,
          ffIndex: source.ffIndex,
          external: false,
          autoBitmapStream: true,
          cacheExcerpt: true,
        },
      }),
    };
  } catch (error) {
    safeDelete(excerptPath);
    debugVerbose(
      "bitmap subtitle cache excerpt unavailable: " + compactError(error),
    );
    return null;
  }
}

function nativeBitmapScreenshotFallbackAllowed(surfaceName) {
  if (surfaceName === "secondary") return false;
  const secondarySid = mpvStringProp(
    ["secondary-sid", "options/secondary-sid"],
    "no",
  )
    .trim()
    .toLowerCase();
  return (
    (secondarySid === "" || secondarySid === "no") &&
    mpvBoolProp(["pause"], false)
  );
}

async function runNativeBitmapScreenshotRequest(request, surfaceName) {
  if (!nativeBitmapScreenshotFallbackAllowed(surfaceName))
    return { ok: false, reason: "screenshot-diff-ambiguous" };
  await prepareNativeSubtitlePrivateCueDirectory();
  nativeSubtitlePrivateCueSerial++;
  const prefix =
    nativeSubtitlePrivateCueDirectory() +
    "/iinatan-bitmap-shot-" +
    Date.now().toString(36) +
    "-" +
    nativeSubtitlePrivateCueSerial.toString(36);
  const videoPath = prefix + "-video.png";
  const subtitlePath = prefix + "-subtitles.png";
  let previousCompression = null;
  let previousSoftwareCapture = null;
  try {
    try {
      previousCompression = mpv.getString("screenshot-png-compression");
      previousSoftwareCapture = mpv.getFlag("screenshot-sw");
      mpv.set("screenshot-png-compression", 0);
      mpv.set("screenshot-sw", true);
    } catch (_) {}
    mpv.command("screenshot-to-file", [videoPath, "video"]);
    mpv.command("screenshot-to-file", [subtitlePath, "subtitles"]);
    if (!file.exists(videoPath) || !file.exists(subtitlePath))
      return { ok: false, reason: "screenshot-capture-unavailable" };
    return await runWorkerQueueRequestDirect(
      {
        type: "bitmap-subtitle-ocr",
        protocol: 1,
        mode: "screenshot-diff",
        languages: request.languages,
        renderer: request.renderer,
        images: { video: videoPath, subtitles: subtitlePath },
      },
      selectedLanguageModule(),
      Math.max(1000, prefNumber("backendTimeoutMs", 30000)),
    );
  } catch (error) {
    debugLog(
      "bitmap subtitle OCR screenshot capture failed: " + compactError(error),
    );
    return { ok: false, reason: "screenshot-capture-unavailable" };
  } finally {
    try {
      if (previousCompression !== null)
        mpv.set("screenshot-png-compression", previousCompression);
      if (previousSoftwareCapture !== null)
        mpv.set("screenshot-sw", previousSoftwareCapture);
    } catch (_) {}
    safeDelete(videoPath);
    safeDelete(subtitlePath);
  }
}

async function runNativeBitmapOcrRequest(request, surfaceName) {
  let directFailure = null;
  if (request.source && nativeBitmapOcrDirectGeometrySupported(surfaceName)) {
    try {
      const response = await runWorkerQueueRequestDirect(
        request,
        selectedLanguageModule(),
        Math.max(1000, prefNumber("backendTimeoutMs", 30000)),
      );
      if (response && response.ok === true) return response;
      directFailure = response;
      debugLog(
        "bitmap subtitle OCR direct source unavailable reason=" +
          String((response && response.reason) || "unknown"),
      );
    } catch (error) {
      directFailure = {
        reason: String((error && error.message) || "bitmap-direct-failed"),
      };
    }
  }
  if (
    directFailure &&
    (directFailure.reason === "unsupported-recognition-language" ||
      directFailure.reason === "bitmap-ocr-superseded")
  )
    return directFailure;
  if (!prefBool("bitmapSubtitleOcrScreenshotFallbackEnabled", false))
    return directFailure
      ? {
          ok: false,
          reason: String(directFailure.reason || "bitmap-direct-failed"),
        }
      : { ok: false, reason: "bitmap-direct-unavailable" };
  if (!mpvBoolProp(["pause"], false))
    return { ok: false, reason: "screenshot-fallback-waits-for-pause" };
  if (request.source && nativeBitmapOcrDirectGeometrySupported(surfaceName)) {
    const excerpt = await prepareNativeBitmapCacheExcerpt(request);
    if (excerpt) {
      try {
        const response = await runWorkerQueueRequestDirect(
          excerpt.request,
          selectedLanguageModule(),
          Math.max(1000, prefNumber("backendTimeoutMs", 30000)),
        );
        if (response && response.ok === true) return response;
        debugLog(
          "bitmap subtitle OCR cache excerpt unavailable reason=" +
            String((response && response.reason) || "unknown"),
        );
      } catch (_) {
      } finally {
        safeDelete(excerpt.path);
      }
    }
  }
  return runNativeBitmapScreenshotRequest(request, surfaceName);
}

function showNativeBitmapOcrNotice() {
  if (nativeBitmapOcrNoticeShown) return;
  nativeBitmapOcrNoticeShown = true;
  if (
    prefNumber("bitmapSubtitleOcrNoticeVersion", 0) >=
    NATIVE_BITMAP_OCR_NOTICE_VERSION
  )
    return;
  notify(
    "Bitmap subtitle OCR is active. Recognition is on-device and may contain mistakes.",
    "info",
    7000,
  );
  try {
    preferences.set(
      "bitmapSubtitleOcrNoticeVersion",
      NATIVE_BITMAP_OCR_NOTICE_VERSION,
    );
    if (preferences.sync) preferences.sync();
  } catch (_) {}
}

const NATIVE_BITMAP_OCR_RETRY_DELAYS_MS = [750, 2500];

function rememberNativeBitmapOcrFailure(key, reason) {
  const rawReason = String(reason || "bitmap-ocr-failed");
  const normalizedReason = /^[a-z0-9-]+$/.test(rawReason)
    ? rawReason
    : "bitmap-ocr-failed";
  const deterministic =
    normalizedReason === "unsupported-recognition-language" ||
    normalizedReason === "bitmap-cue-unavailable" ||
    normalizedReason === "media-seek-failed" ||
    normalizedReason === "screenshot-fallback-disabled" ||
    normalizedReason === "screenshot-fallback-waits-for-pause" ||
    normalizedReason.indexOf("screenshot-") === 0;
  const previous = nativeBitmapOcrFailures[key];
  const attempts = Number((previous && previous.attempts) || 0) + 1;
  const retryDelay = NATIVE_BITMAP_OCR_RETRY_DELAYS_MS[attempts - 1];
  const retryScheduled = !deterministic && Number.isFinite(retryDelay);
  nativeBitmapOcrFailures[key] = {
    reason: normalizedReason,
    attempts,
    intentToken: String(
      (nativeBitmapOcrIntents[key] && nativeBitmapOcrIntents[key].token) || "",
    ),
    retryAt: retryScheduled ? Date.now() + retryDelay : Number.MAX_SAFE_INTEGER,
  };
  debugLog(
    "bitmap subtitle OCR request failed reason=" +
      normalizedReason +
      " attempt=" +
      attempts +
      " retryScheduled=" +
      String(retryScheduled),
  );
}

function nativeBitmapSubtitleCueSnapshot(track, surfaceOptions) {
  const surface =
    surfaceOptions && surfaceOptions.surface === "secondary"
      ? "secondary"
      : "primary";
  if (!prefBool("bitmapSubtitleOcrEnabled", true))
    return { reason: "bitmap-ocr-disabled", surface, trackId: track.id };
  const paused = observeNativeBitmapOcrPauseState();
  const renderer = nativeBitmapOcrRenderer();
  if (!renderer)
    return { reason: "missing-osd-dimensions", surface, trackId: track.id };
  const capability = nativeBitmapOcrCapability();
  const languages = nativeBitmapOcrLanguages(capability);
  if (capability && (!capability.available || !languages.length))
    return {
      reason: "unsupported-recognition-language",
      surface,
      trackId: track.id,
    };
  if (!languages.length)
    return {
      reason: "unsupported-recognition-language",
      surface,
      trackId: track.id,
    };
  let playbackTimeMs = Math.round(
    mpvNumberProp(["time-pos", "playback-time"], -1) * 1000,
  );
  const delayName =
    surface === "secondary" ? "secondary-sub-delay" : "sub-delay";
  const delayMs = Math.round(
    mpvNumberProp(["options/" + delayName, delayName], 0) * 1000,
  );
  playbackTimeMs -= delayMs;
  const timingPrefix = surface === "secondary" ? "secondary-" : "";
  const cueStartMs = Math.round(
    mpvNumberProp([timingPrefix + "sub-start"], NaN) * 1000,
  );
  const cueEndMs = Math.round(
    mpvNumberProp([timingPrefix + "sub-end"], NaN) * 1000,
  );
  if (!Number.isFinite(playbackTimeMs) || playbackTimeMs < 0)
    return { reason: "cue-timing-unavailable", surface, trackId: track.id };
  if (
    !Number.isFinite(cueStartMs) ||
    !Number.isFinite(cueEndMs) ||
    cueStartMs < 0 ||
    cueEndMs <= cueStartMs ||
    playbackTimeMs < cueStartMs - 100 ||
    playbackTimeMs >= cueEndMs + 100
  )
    return { reason: "empty-subtitle", surface, trackId: track.id };
  const timeMs = Math.min(
    cueEndMs - 1,
    cueStartMs + Math.min(500, Math.max(1, (cueEndMs - cueStartMs) / 2)),
  );
  const source = nativeBitmapOcrSource(track);
  const request = {
    type: "bitmap-subtitle-ocr",
    protocol: 1,
    mode: "decoded-subtitle",
    languages,
    timeMs,
    cueStartMs,
    cueEndMs,
    renderer: renderer.request,
    ...(source.request ? { source: source.request } : {}),
  };
  const key = nativeBitmapOcrCacheKey(request, track, surface);
  const cached = nativeBitmapOcrCache[key];
  if (cached) {
    const offset = Number((surfaceOptions && surfaceOptions.lookupStart) || 0);
    return {
      kind: "bitmap-ocr",
      surface,
      trackId: track.id,
      displayText: cached.displayText,
      lookupText: cached.lookupText,
      lookupSpans: cached.lookupSpans,
      layout: {
        osd: renderer.osd,
        directRects: cached.units.map((unit) => ({
          position: unit.position + offset,
          rects: unit.rects,
        })),
        geometryProtocol: "bitmap-ocr-1",
        recognitionConfidence: cached.confidence,
        recognitionMode: cached.mode,
        hidpiScale: mpvNumberProp(["display-hidpi-scale"], 0),
      },
    };
  }
  const trigger = nativeBitmapOcrTrigger(paused);
  const incomingIntentToken = trigger
    ? nativeBitmapOcrIntentToken(trigger)
    : "";
  let intent = nativeBitmapOcrIntents[key] || null;
  let failed = nativeBitmapOcrFailures[key] || null;
  if (incomingIntentToken) {
    if (
      failed &&
      failed.retryAt === Number.MAX_SAFE_INTEGER &&
      failed.intentToken !== incomingIntentToken
    ) {
      delete nativeBitmapOcrFailures[key];
      failed = null;
      intent = null;
    }
    if (!intent) {
      intent = { token: incomingIntentToken, trigger };
      nativeBitmapOcrIntents[key] = intent;
    } else if (intent.token !== incomingIntentToken) {
      intent.token = incomingIntentToken;
      intent.trigger = trigger;
      if (failed && failed.retryAt < Number.MAX_SAFE_INTEGER)
        failed.intentToken = incomingIntentToken;
    }
  }
  if (!intent)
    return {
      reason: "bitmap-ocr-awaiting-intent",
      surface,
      trackId: track.id,
    };
  if (
    failed &&
    failed.reason === "screenshot-fallback-waits-for-pause" &&
    mpvBoolProp(["pause"], false)
  )
    delete nativeBitmapOcrFailures[key];
  const activeFailure = nativeBitmapOcrFailures[key];
  if (activeFailure && Date.now() < activeFailure.retryAt)
    return {
      reason:
        activeFailure.retryAt < Number.MAX_SAFE_INTEGER
          ? "bitmap-ocr-pending"
          : activeFailure.reason,
      failureReason: activeFailure.reason,
      retryScheduled: activeFailure.retryAt < Number.MAX_SAFE_INTEGER,
      surface,
      trackId: track.id,
    };
  const generation = nativeBitmapOcrGeneration;
  if (!nativeBitmapOcrInFlight[key]) {
    const inFlight = Promise.resolve()
      .then(() => runNativeBitmapOcrRequest(request, surface))
      .then((response) => {
        if (generation !== nativeBitmapOcrGeneration) return;
        const normalized = normalizeNativeBitmapOcrResponse(response, request);
        if (normalized.reason === "bitmap-ocr-superseded") {
          delete nativeBitmapOcrFailures[key];
          delete nativeBitmapOcrIntents[key];
        } else if (normalized.ok) {
          nativeBitmapOcrCache[key] = normalized;
          delete nativeBitmapOcrFailures[key];
          delete nativeBitmapOcrIntents[key];
          showNativeBitmapOcrNotice();
        } else {
          rememberNativeBitmapOcrFailure(key, normalized.reason);
        }
        pruneNativeBitmapOcrCache();
      })
      .catch((error) => {
        if (generation !== nativeBitmapOcrGeneration) return;
        rememberNativeBitmapOcrFailure(key, "bitmap-ocr-failed");
        debugWarn("bitmap subtitle OCR failed: " + compactError(error));
      })
      .finally(() => {
        if (nativeBitmapOcrInFlight[key] === inFlight)
          delete nativeBitmapOcrInFlight[key];
        if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
          scheduleExperimentalNativeLayoutRebuild();
      });
    nativeBitmapOcrInFlight[key] = inFlight;
  }
  return {
    reason: "bitmap-ocr-pending",
    retryScheduled: true,
    surface,
    trackId: track.id,
  };
}

function advanceNativeBitmapOcrGeneration() {
  nativeBitmapOcrGeneration++;
  nativeBitmapOcrCache = Object.create(null);
  nativeBitmapOcrFailures = Object.create(null);
  nativeBitmapOcrIntents = Object.create(null);
  nativeBitmapOcrIntentAt = Number.NEGATIVE_INFINITY;
  nativeBitmapOcrMouseIntentSerial = 0;
  nativeBitmapOcrPauseIntentSerial = 0;
  nativeBitmapOcrPauseObserved = false;
  nativeBitmapOcrMouseLayoutAt = Number.NEGATIVE_INFINITY;
}

function parseSimpleNativeAssCue(raw, assOverride) {
  const text = String(raw || "");
  const override = String(assOverride || "")
    .trim()
    .toLowerCase();
  if (override !== "strip" && override !== "force")
    return { reason: "ambiguous-ass-event" };
  // In mpv 0.38 a literal newline joins active event Text fields. Authored
  // line breaks are represented by \N, so a literal newline is ambiguous.
  if (/\r|\n/.test(text)) return { reason: "ambiguous-ass-event" };
  // We do not render ASS. Any override block, including b/i, is rejected unless
  // and until its style run can be mirrored without changing normal shaping.
  if (/[{}]/.test(text)) return { reason: "complex-ass-tags" };
  if (/\\(?![Nn])/i.test(text)) return { reason: "complex-ass-tags" };
  return {
    displayText: text.replace(/\\N/g, "\n").replace(/\\n/g, "\n"),
    styleRuns: [],
  };
}

function nativeGraphemeBreakFallback(text) {
  const source = String(text || "");
  const clusters = [];
  let offset = 0;
  const codePoints = Array.from(source);
  const isMark = (cp) =>
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
    (cp >= 0xe0100 && cp <= 0xe01ef);
  const isRegional = (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
  for (let i = 0; i < codePoints.length; i++) {
    const start = offset;
    let value = codePoints[i];
    offset += value.length;
    let regionalCount = isRegional(value.codePointAt(0)) ? 1 : 0;
    while (i + 1 < codePoints.length) {
      const next = codePoints[i + 1];
      const cp = next.codePointAt(0);
      const join =
        isMark(cp) ||
        cp === 0x200d ||
        value.codePointAt(value.length - 1) === 0x200d ||
        (regionalCount === 1 && isRegional(cp));
      if (!join) break;
      i++;
      value += next;
      offset += next.length;
      if (isRegional(cp)) regionalCount++;
    }
    clusters.push({ text: value, startUtf16: start, endUtf16: offset });
  }
  return clusters;
}

function nativeGraphemeSegments(text, segmenter) {
  const source = String(text || "");
  try {
    const activeSegmenter =
      segmenter ||
      (typeof Intl !== "undefined" && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null);
    if (activeSegmenter) {
      return Array.from(activeSegmenter.segment(source), (item) => ({
        text: item.segment,
        startUtf16: item.index,
        endUtf16: item.index + item.segment.length,
      }));
    }
  } catch (_) {}
  return nativeGraphemeBreakFallback(source);
}

function nativeLookupMapping(displayText, lookupText, options) {
  const opts = options || {};
  let tokens = nativeGraphemeSegments(displayText, opts.segmenter);
  const isHorizontal = (value) => /^[ \t\f\v]+$/.test(value);
  const isNewline = (value) => value === "\n";
  const collapsed = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (isHorizontal(token.text)) {
      let end = index;
      let endUtf16 = token.endUtf16;
      while (end + 1 < tokens.length && isHorizontal(tokens[end + 1].text)) {
        end++;
        endUtf16 = tokens[end].endUtf16;
      }
      if (
        (collapsed.length && isNewline(collapsed[collapsed.length - 1].text)) ||
        (tokens[end + 1] && isNewline(tokens[end + 1].text))
      ) {
        index = end;
        continue;
      }
      collapsed.push({
        text: " ",
        startUtf16: token.startUtf16,
        endUtf16,
      });
      index = end;
      continue;
    }
    if (opts.flattenLineBreaks && isNewline(token.text)) {
      let end = index;
      let endUtf16 = token.endUtf16;
      while (tokens[end + 1] && isNewline(tokens[end + 1].text)) {
        end++;
        endUtf16 = tokens[end].endUtf16;
      }
      collapsed.push({
        text: " ",
        startUtf16: token.startUtf16,
        endUtf16,
      });
      index = end;
      continue;
    }
    collapsed.push(token);
  }
  while (collapsed.length && /^\s+$/.test(collapsed[0].text)) collapsed.shift();
  while (collapsed.length && /^\s+$/.test(collapsed[collapsed.length - 1].text))
    collapsed.pop();
  tokens = collapsed;

  if (opts.languageId === "ja") {
    const filtered = [];
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index].text !== "（") {
        filtered.push(tokens[index]);
        continue;
      }
      let close = index + 1;
      while (close < tokens.length && tokens[close].text !== "）") close++;
      if (close >= tokens.length) {
        filtered.push(tokens[index]);
        continue;
      }
      const reading = tokens
        .slice(index + 1, close)
        .map((token) => token.text)
        .join("");
      if (
        reading &&
        /^[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f\s]+$/.test(reading)
      ) {
        index = close;
        continue;
      }
      filtered.push(tokens[index]);
    }
    tokens = filtered;
  }

  tokens = tokens.map((token) => {
    let normalized = token.text;
    try {
      normalized = IINATAN_LANGUAGE_COMMON.normalizeBasic(token.text);
    } catch (_) {
      try {
        normalized = token.text.normalize("NFKC");
      } catch (_) {}
    }
    return {
      text: normalized,
      startUtf16: token.startUtf16,
      endUtf16: token.endUtf16,
    };
  });

  const produced = tokens.map((token) => token.text).join("");
  if (produced !== String(lookupText || ""))
    return { ok: false, reason: "text-index-map-failed" };
  const lookupSpans = [];
  tokens.forEach((token) => {
    Array.from(token.text).forEach(() => {
      lookupSpans.push({
        startUtf16: token.startUtf16,
        endUtf16: token.endUtf16,
      });
    });
  });
  return {
    ok: true,
    displayText: String(displayText || ""),
    lookupText: produced,
    lookupSpans,
  };
}

function nativeAssDisplayText(raw) {
  const text = String(raw || "");
  if (!text) return { reason: "empty-subtitle" };
  const displayText = text.replace(/\{\\i[01]\}/gi, "");
  if (/[\r{}]/.test(displayText)) return { reason: "complex-ass-tags" };
  if (/\\(?![Nn])/i.test(displayText)) return { reason: "complex-ass-tags" };
  return {
    displayText: displayText.replace(/\\N/g, "\n").replace(/\\n/g, "\n"),
  };
}

function nativeAssGeometryUnits(mapping, lookupText, language) {
  const spans =
    mapping && Array.isArray(mapping.lookupSpans) ? mapping.lookupSpans : [];
  const characters = Array.from(String(lookupText || ""));
  if (spans.length !== characters.length) return [];
  const module = language || selectedLanguageModule();
  const policy = module && module.lookupCharacterPolicy;
  const isLookupable = (character) => {
    try {
      return IINATAN_LOOKUP_CHARACTER_POLICY.matches(policy, character);
    } catch (_) {
      return false;
    }
  };
  const units = [];
  for (let position = 0; position < characters.length; position++) {
    if (!isLookupable(characters[position])) continue;
    let end = position + 1;
    if (module.lookupUnit === "word") {
      while (end < characters.length && isLookupable(characters[end])) end++;
    }
    const first = spans[position];
    const last = spans[end - 1];
    if (
      !first ||
      !last ||
      !Number.isInteger(first.startUtf16) ||
      !Number.isInteger(last.endUtf16) ||
      last.endUtf16 <= first.startUtf16
    )
      return [];
    units.push({
      position,
      displayStartUtf16: first.startUtf16,
      displayEndUtf16: last.endUtf16,
    });
    position = end - 1;
  }
  return units;
}

function nativeAssSourceSnapshot(track, hasAssObservation) {
  const selected = track || {};
  const source = selected.external
    ? mediaSourceDescriptor(selected.externalFilename, "subtitle-track")
    : currentMediaSourceSnapshot().primary;
  if (
    !source.nativeAssReadable &&
    !(hasAssObservation && source.raw && source.kind !== "local-file")
  )
    return { reason: "unsafe-media-path" };
  const streamIndex =
    Number.isInteger(selected.ffIndex) && selected.ffIndex >= 0
      ? selected.ffIndex
      : hasAssObservation && Number.isInteger(selected.id) && selected.id >= 0
        ? selected.id
        : -1;
  if (streamIndex < 0) return { reason: "ambiguous-stream-map" };
  return {
    path: source.locator,
    ffIndex: streamIndex,
    external: !!selected.external,
  };
}

function nativeSrtTimestampMs(value) {
  const match = String(value || "").match(
    /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/,
  );
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (
    ![hours, minutes, seconds, milliseconds].every(Number.isFinite) ||
    minutes > 59 ||
    seconds > 59
  )
    return -1;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function parseNativeSrtCues(raw) {
  const source = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  if (!source || source.length > 8 * 1024 * 1024)
    return { reason: "srt-file-limit-exceeded" };
  const lines = source.split("\n");
  const cues = [];
  const maxEndMs = [];
  let ordered = true;
  let line = 0;
  while (line < lines.length) {
    while (line < lines.length && !lines[line].trim()) line++;
    if (line >= lines.length) break;
    if (/^\d+$/.test(lines[line].trim())) line++;
    if (line >= lines.length) return { reason: "invalid-srt-timing" };
    const timing = lines[line].match(
      /^\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/,
    );
    if (!timing) return { reason: "invalid-srt-timing" };
    const startMs = nativeSrtTimestampMs(timing[1]);
    const endMs = nativeSrtTimestampMs(timing[2]);
    if (startMs < 0 || endMs <= startMs)
      return { reason: "invalid-srt-timing" };
    line++;
    // libavformat accepts blank separator lines between a timing line and the
    // first authored text row. Ignore those leading separators while keeping
    // blank lines inside a cue significant.
    while (line < lines.length && !lines[line].trim()) line++;
    const nextLineIsCueTiming =
      line + 1 < lines.length &&
      /^\d+$/.test(lines[line].trim()) &&
      /^\s*\d{1,3}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*/.test(lines[line + 1]);
    if (nextLineIsCueTiming) continue;
    const text = [];
    while (line < lines.length && lines[line].trim()) {
      text.push(lines[line]);
      line++;
    }
    if (text.length) {
      if (cues.length && startMs < cues[cues.length - 1].startMs)
        ordered = false;
      cues.push({ startMs, endMs, text: text.join("\n") });
      maxEndMs.push(
        Math.max(endMs, maxEndMs.length ? maxEndMs[maxEndMs.length - 1] : 0),
      );
      if (cues.length > 100000) return { reason: "srt-cue-limit-exceeded" };
    }
  }
  return cues.length
    ? { cues, maxEndMs, ordered }
    : { reason: "empty-subtitle" };
}

function nativeExternalSubtitleDescriptor(track) {
  const selected = track || {};
  const filename = String(
    selected.externalFilename || selected["external-filename"] || "",
  );
  const onlineMediaSubtitle =
    selected.onlineMediaSubtitle || iinaOnlineMediaSubtitleEdlSource(filename);
  return {
    source: onlineMediaSubtitle
      ? onlineMediaSubtitle.source
      : mediaSourceDescriptor(filename, "subtitle-track"),
    playerDeferred: !!onlineMediaSubtitle,
  };
}

function nativeExternalSubtitleSource(track) {
  return nativeExternalSubtitleDescriptor(track).source;
}

function nativeExternalSrtCues(track) {
  const selected = track || {};
  const descriptor = nativeExternalSubtitleDescriptor(selected);
  const source = descriptor.source;
  const path = source.locator;
  if (!selected.external || !path)
    return { reason: "srt-event-boundaries-unavailable" };
  if (descriptor.playerDeferred) return { reason: "srt-player-deferred" };
  if (nativeExternalSrtCache[path]) return nativeExternalSrtCache[path];
  if (source.kind === "http-url") {
    if (!nativeExternalSrtInFlight[path]) {
      const generation = nativeExternalSrtGeneration;
      const request = Promise.resolve()
        .then(() =>
          utils.exec(
            "/usr/bin/curl",
            [
              "--silent",
              "--show-error",
              "--location",
              "--proto",
              "=http,https",
              "--proto-redir",
              "=http,https",
              "--max-filesize",
              String(8 * 1024 * 1024),
              "--max-time",
              "8",
              path,
            ],
            dataRoot(),
          ),
        )
        .then((result) => {
          if (generation !== nativeExternalSrtGeneration) return;
          const parsed =
            result && result.status === 0
              ? parseNativeSrtCues(String(result.stdout || ""))
              : { reason: "srt-read-failed" };
          putBoundedCache(
            nativeExternalSrtCache,
            path,
            parsed,
            NATIVE_EXTERNAL_SRT_CACHE_MAX_ENTRIES,
          );
        })
        .catch(() => {
          if (generation !== nativeExternalSrtGeneration) return;
          putBoundedCache(
            nativeExternalSrtCache,
            path,
            { reason: "srt-read-failed" },
            NATIVE_EXTERNAL_SRT_CACHE_MAX_ENTRIES,
          );
        })
        .finally(() => {
          if (nativeExternalSrtInFlight[path] === request)
            delete nativeExternalSrtInFlight[path];
          if (
            generation === nativeExternalSrtGeneration &&
            typeof scheduleExperimentalNativeLayoutRebuild === "function"
          )
            scheduleExperimentalNativeLayoutRebuild();
        });
      nativeExternalSrtInFlight[path] = request;
    }
    return { reason: "srt-read-pending" };
  }
  if (source.kind !== "local-file")
    return { reason: "srt-event-boundaries-unavailable" };
  let parsed = null;
  try {
    parsed = parseNativeSrtCues(String(file.read(path) || ""));
  } catch (_) {
    parsed = { reason: "srt-read-failed" };
  }
  putBoundedCache(
    nativeExternalSrtCache,
    path,
    parsed,
    NATIVE_EXTERNAL_SRT_CACHE_MAX_ENTRIES,
  );
  return parsed;
}

function nativeActiveSrtCues(parsed, timeMs) {
  const value = parsed && typeof parsed === "object" ? parsed : {};
  const cues = Array.isArray(value.cues) ? value.cues : [];
  const maxEndMs = Array.isArray(value.maxEndMs) ? value.maxEndMs : [];
  if (!value.ordered || maxEndMs.length !== cues.length)
    return cues.filter((cue) => cue.startMs <= timeMs && cue.endMs > timeMs);
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cues[middle].startMs <= timeMs) low = middle + 1;
    else high = middle;
  }
  const active = [];
  for (let index = low - 1; index >= 0; index--) {
    if (maxEndMs[index] <= timeMs) break;
    if (cues[index].endMs > timeMs) active.push(cues[index]);
  }
  return active.reverse();
}

function nativeSrtEventBlocksFromCues(
  active,
  displayText,
  lookupText,
  lookupStart,
) {
  if (active.length <= 1) return { eventBlocks: [] };
  if (active.length > 32) return { reason: "srt-active-cue-limit-exceeded" };
  const displays = active.map((cue) => cleanNativeDisplayText(cue.text));
  if (displays.join("\n") !== String(displayText || ""))
    return { reason: "cue-text-mismatch" };
  const lookups = displays.map((text) =>
    normalizeExperimentalSubtitleText(text),
  );
  const lookupSeparator = prefBool("flattenSubtitleLineBreaks", false)
    ? " "
    : "\n";
  if (lookups.join(lookupSeparator) !== String(lookupText || ""))
    return { reason: "text-index-map-failed" };
  const eventBlocks = [];
  let position = Number(lookupStart) || 0;
  for (let index = 0; index < active.length; index++) {
    const mapping = nativeLookupMapping(displays[index], lookups[index], {
      flattenLineBreaks: prefBool("flattenSubtitleLineBreaks", false),
      languageId: selectedLanguageModule().id,
    });
    if (!mapping.ok) return { reason: mapping.reason };
    eventBlocks.push({
      displayText: displays[index],
      lookupText: lookups[index],
      lookupStart: position,
      lookupLength: Array.from(lookups[index]).length,
      lookupSpans: mapping.lookupSpans,
      stackIndex: index,
      startMs: active[index].startMs,
      endMs: active[index].endMs,
    });
    position +=
      Array.from(lookups[index]).length + Array.from(lookupSeparator).length;
  }
  return { eventBlocks };
}

function nativeObservedSrtEventBlocks(
  observedAss,
  displayText,
  lookupText,
  lookupStart,
) {
  const observed = String(observedAss || "").replace(/\r/g, "");
  if (!observed || observed.indexOf("\n") < 0) return { eventBlocks: [] };
  const events = observed.split("\n");
  if (events.length > 32) return { reason: "srt-active-cue-limit-exceeded" };
  const active = events.map((text) => ({
    text: text
      .replace(/\{[^{}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " "),
  }));
  const blocks = nativeSrtEventBlocksFromCues(
    active,
    displayText,
    lookupText,
    lookupStart,
  );
  return blocks.reason ? { reason: "srt-observation-ambiguous" } : blocks;
}

function nativeExternalSrtEventBlocks(
  track,
  surface,
  displayText,
  lookupText,
  lookupStart,
  observedAss,
) {
  const descriptor = nativeExternalSubtitleDescriptor(track);
  if (descriptor.playerDeferred) {
    const observed = nativeObservedSrtEventBlocks(
      observedAss,
      displayText,
      lookupText,
      lookupStart,
    );
    if (!observed.reason) return observed;
    // Online Media intentionally marks these captions !delay_open so they do
    // not compete with initial playback. Ambiguous live observations retain a
    // safe single-block hit layer instead of downloading the full URL again.
    return { eventBlocks: [] };
  }
  const parsed = nativeExternalSrtCues(track);
  if (parsed.reason) return { reason: parsed.reason };
  let timeMs = Math.round(
    mpvNumberProp(["time-pos", "playback-time"], -1) * 1000,
  );
  const delayNames =
    surface === "secondary"
      ? ["options/secondary-sub-delay", "secondary-sub-delay"]
      : ["options/sub-delay", "sub-delay"];
  timeMs -= Math.round(mpvNumberProp(delayNames, 0) * 1000);
  if (!Number.isFinite(timeMs) || timeMs < 0)
    return { reason: "cue-timing-unavailable" };
  return nativeSrtEventBlocksFromCues(
    nativeActiveSrtCues(parsed, timeMs),
    displayText,
    lookupText,
    lookupStart,
  );
}

function normalizeNativeAssGeometryResponse(response, request) {
  if (
    !response ||
    response.ok !== true ||
    response.protocol !== 1 ||
    !Array.isArray(response.units) ||
    response.rendererWidth !== request.renderer.width ||
    response.rendererHeight !== request.renderer.height ||
    response.units.length !== request.units.length
  )
    return {
      reason: (response && response.reason) || "invalid-ass-geometry-response",
    };
  const expected = Object.create(null);
  request.units.forEach((unit) => {
    expected[String(unit.position)] = true;
  });
  const units = [];
  for (let index = 0; index < response.units.length; index++) {
    const unit = response.units[index];
    if (
      !unit ||
      !Number.isInteger(unit.position) ||
      !expected[String(unit.position)] ||
      !Array.isArray(unit.rects) ||
      !unit.rects.length ||
      unit.rects.length > 16
    )
      return { reason: "invalid-ass-geometry-response" };
    delete expected[String(unit.position)];
    const rects = [];
    for (let rectIndex = 0; rectIndex < unit.rects.length; rectIndex++) {
      const rect = unit.rects[rectIndex];
      const x = Number(rect && rect.x);
      const y = Number(rect && rect.y);
      const w = Number(rect && rect.w);
      const h = Number(rect && rect.h);
      if (
        ![x, y, w, h].every(Number.isFinite) ||
        w <= 0 ||
        h <= 0 ||
        x < 0 ||
        y < 0 ||
        x + w > request.renderer.width ||
        y + h > request.renderer.height
      )
        return { reason: "invalid-ass-geometry-response" };
      rects.push({ x, y, w, h });
    }
    units.push({ position: unit.position, rects });
  }
  if (Object.keys(expected).length)
    return { reason: "invalid-ass-geometry-response" };
  let alphaMask = null;
  if (response.alphaMask !== undefined) {
    const mask = response.alphaMask;
    if (
      !mask ||
      mask.encoding !== "rle-u8-base64" ||
      !Number.isInteger(mask.x) ||
      !Number.isInteger(mask.y) ||
      !Number.isInteger(mask.w) ||
      !Number.isInteger(mask.h) ||
      mask.x < 0 ||
      mask.y < 0 ||
      mask.w <= 0 ||
      mask.h <= 0 ||
      mask.x + mask.w > request.renderer.width ||
      mask.y + mask.h > request.renderer.height ||
      mask.w * mask.h > 262144 ||
      typeof mask.data !== "string" ||
      mask.data.length > 750000
    )
      return { reason: "invalid-ass-geometry-response" };
    alphaMask = {
      x: mask.x,
      y: mask.y,
      w: mask.w,
      h: mask.h,
      encoding: mask.encoding,
      data: mask.data,
    };
  }
  return {
    ok: true,
    units,
    alphaMask,
    diagnostics:
      response.diagnostics && typeof response.diagnostics === "object"
        ? response.diagnostics
        : null,
  };
}

function pruneNativeAssGeometryCache() {
  const cacheKeys = Object.keys(nativeAssGeometryCache);
  while (cacheKeys.length > 16)
    delete nativeAssGeometryCache[cacheKeys.shift()];
  const failureKeys = Object.keys(nativeAssGeometryFailures);
  while (failureKeys.length > 16)
    delete nativeAssGeometryFailures[failureKeys.shift()];
}

function nativeAssGeometryStatistics() {
  if (typeof nativeAssGeometryStats !== "undefined")
    return nativeAssGeometryStats;
  if (!globalThis.__iinatanNativeAssGeometryStats)
    globalThis.__iinatanNativeAssGeometryStats = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      completions: 0,
      failures: 0,
      maxOutstanding: 0,
    };
  return globalThis.__iinatanNativeAssGeometryStats;
}

function nativeAssGeometryCacheKey(request) {
  const cue = Object.assign({}, request && request.cue);
  delete cue.timeMs;
  return JSON.stringify(
    Object.assign({}, request, {
      cue,
    }),
  );
}

const NATIVE_ASS_GEOMETRY_RETRY_DELAYS_MS = [120, 300, 750, 1500];

async function prepareNativeAssCacheExcerpt(request) {
  const source = request && request.source;
  const cue = request && request.cue;
  const descriptor = mediaSourceDescriptor(
    source && source.path,
    "ass-geometry",
  );
  if (
    !source ||
    source.external ||
    descriptor.kind !== "http-url" ||
    !cue ||
    cue.assFull
  )
    return null;
  await prepareNativeSubtitlePrivateCueDirectory();
  nativeSubtitlePrivateCueSerial++;
  const excerptPath =
    nativeSubtitlePrivateCueDirectory() +
    "/iinatan-ass-cache-" +
    Date.now().toString(36) +
    "-" +
    nativeSubtitlePrivateCueSerial.toString(36) +
    ".mkv";
  const start = Math.max(0, Number(cue.startMs) / 1000 - 0.1);
  const end = Math.max(start + 0.25, Number(cue.endMs) / 1000 + 0.1);
  try {
    mpv.command("dump-cache", [
      String(start.toFixed(3)),
      String(end.toFixed(3)),
      excerptPath,
    ]);
    if (!file.exists(excerptPath)) {
      safeDelete(excerptPath);
      return null;
    }
    return {
      path: excerptPath,
      request: Object.assign({}, request, {
        source: {
          path: excerptPath,
          ffIndex: -1,
          external: false,
          autoAssStream: true,
          cacheExcerpt: true,
        },
      }),
    };
  } catch (error) {
    safeDelete(excerptPath);
    debugVerbose(
      "native ASS cache excerpt unavailable: " + compactError(error),
    );
    return null;
  }
}

async function runNativeAssGeometryRequest(request, language, timeoutMs) {
  const excerpt = await prepareNativeAssCacheExcerpt(request);
  try {
    if (excerpt) {
      try {
        const response = await runWorkerQueueRequestDirect(
          excerpt.request,
          language,
          timeoutMs,
        );
        if (response && response.ok === true) return response;
      } catch (_) {}
    }
    return await runWorkerQueueRequestDirect(request, language, timeoutMs);
  } finally {
    if (excerpt) safeDelete(excerpt.path);
  }
}

function nativeAssGeometryFailureResult(key) {
  const failure = nativeAssGeometryFailures[key];
  if (!failure) return null;
  const retryScheduled =
    failure.attempts < NATIVE_ASS_GEOMETRY_RETRY_DELAYS_MS.length;
  if (retryScheduled && Date.now() >= failure.retryAt) return null;
  return {
    reason: failure.reason,
    retryScheduled,
  };
}

function rememberNativeAssGeometryFailure(key, reason) {
  const previous = nativeAssGeometryFailures[key];
  const message = String(reason || "ass-geometry-failed");
  const attempts = Math.min(
    (previous && previous.attempts ? previous.attempts : 0) + 1,
    NATIVE_ASS_GEOMETRY_RETRY_DELAYS_MS.length,
  );
  nativeAssGeometryFailures[key] = {
    attempts,
    reason: /^[a-z0-9-]+$/.test(message) ? message : "ass-geometry-failed",
    retryAt: Date.now() + NATIVE_ASS_GEOMETRY_RETRY_DELAYS_MS[attempts - 1],
  };
  pruneNativeAssGeometryCache();
  return nativeAssGeometryFailureResult(key);
}

function nativeAssGeometrySnapshot(request) {
  const statistics = nativeAssGeometryStatistics();
  const key = nativeAssGeometryCacheKey(request);
  const cached = nativeAssGeometryCache[key];
  if (cached) {
    statistics.cacheHits++;
    return cached;
  }
  const failed = nativeAssGeometryFailureResult(key);
  if (failed) return failed;
  statistics.cacheMisses++;
  const generation = nativeAssGeometryGeneration;
  if (!nativeAssGeometryInFlight[key]) {
    statistics.requests++;
    const liveRequest = request;
    const startedAt = Date.now();
    const inFlight = Promise.resolve()
      .then(() =>
        runNativeAssGeometryRequest(
          liveRequest,
          selectedLanguageModule(),
          Math.max(1000, prefNumber("backendTimeoutMs", 30000)),
        ),
      )
      .then((response) => {
        if (generation !== nativeAssGeometryGeneration) return;
        const normalized = normalizeNativeAssGeometryResponse(
          response,
          liveRequest,
        );
        statistics.completions++;
        if (normalized.ok) {
          nativeAssGeometryCache[key] = normalized;
          delete nativeAssGeometryFailures[key];
          if (typeof nativeGeometrySessionReady !== "undefined")
            nativeGeometrySessionReady = true;
        } else {
          statistics.failures++;
          rememberNativeAssGeometryFailure(key, normalized.reason);
        }
        if (normalized.diagnostics) {
          const nativeTotalMs =
            Number(normalized.diagnostics.totalUs || 0) / 1000;
          debugVerbose(
            "native geometry profile " +
              JSON.stringify({
                elapsedMs: Date.now() - startedAt,
                ipcAndSchedulingMs: Math.max(
                  0,
                  Date.now() - startedAt - nativeTotalMs,
                ),
                cacheHits: statistics.cacheHits,
                cacheMisses: statistics.cacheMisses,
                requests: statistics.requests,
                outstanding: Object.keys(nativeAssGeometryInFlight).length,
                native: normalized.diagnostics,
              }),
          );
        }
        pruneNativeAssGeometryCache();
        if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
          scheduleExperimentalNativeLayoutRebuild();
      })
      .catch((error) => {
        if (generation !== nativeAssGeometryGeneration) return;
        statistics.failures++;
        if (typeof markBackendWorkerUnavailable === "function")
          markBackendWorkerUnavailable(error);
        const message = String(
          (error && (error.reason || error.message)) || "ass-geometry-failed",
        );
        rememberNativeAssGeometryFailure(
          key,
          /^[a-z0-9-]+$/.test(message) ? message : "ass-geometry-failed",
        );
        debugWarn("native ASS geometry failed: " + compactError(error));
        if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
          scheduleExperimentalNativeLayoutRebuild();
      })
      .finally(() => {
        if (nativeAssGeometryInFlight[key] === inFlight)
          delete nativeAssGeometryInFlight[key];
      });
    nativeAssGeometryInFlight[key] = inFlight;
    statistics.maxOutstanding = Math.max(
      statistics.maxOutstanding,
      Object.keys(nativeAssGeometryInFlight).length,
    );
  }
  return { reason: "ass-geometry-pending", retryScheduled: true };
}

function advanceNativeAssGeometryGeneration() {
  nativeAssGeometryGeneration++;
  nativeAssGeometryCache = Object.create(null);
  nativeAssGeometryInFlight = Object.create(null);
  nativeAssGeometryFailures = Object.create(null);
}

function nativeSubtitleCueSnapshot(normalizedText, surfaceOptions) {
  const snapshotOptions =
    surfaceOptions && typeof surfaceOptions === "object" ? surfaceOptions : {};
  const surface =
    snapshotOptions.surface === "secondary" ? "secondary" : "primary";
  const eligibility = snapshotOptions.eligibility
    ? snapshotOptions.eligibility
    : nativeSubtitleTrackEligibility(
        nativeSubtitleJsonProperty("track-list", []),
        mpvNumberProp(["sid", "options/sid"], 0),
        mpvStringProp(["secondary-sid", "options/secondary-sid"], "no"),
        surface,
      );
  if (eligibility.reason === "bitmap-subtitle")
    return nativeBitmapSubtitleCueSnapshot(eligibility.track, {
      surface,
      lookupStart: Number(snapshotOptions.lookupStart || 0),
    });
  if (eligibility.reason) return { reason: eligibility.reason };
  let plain = "";
  let ass = "";
  let assFull = "";
  let assExtradata = "";
  if (Object.prototype.hasOwnProperty.call(snapshotOptions, "plain"))
    plain = String(snapshotOptions.plain || "");
  else {
    try {
      plain = String(
        mpv.getString(
          surface === "secondary" ? "secondary-sub-text" : "sub-text",
        ) || "",
      );
    } catch (_) {}
  }
  const onlineMediaSrt =
    eligibility.kind === "srt" &&
    eligibility.track.external &&
    !!eligibility.track.onlineMediaSubtitle;
  if (
    eligibility.kind === "ass" ||
    (surface === "primary" && onlineMediaSrt && /[\r\n]/.test(plain))
  )
    try {
      ass = String(
        mpv.getString(
          surface === "secondary" ? "secondary-sub-text" : "sub-text-ass",
        ) || "",
      );
    } catch (_) {}
  if (eligibility.kind === "ass" && surface === "primary")
    try {
      assFull = String(mpv.getString("sub-text/ass-full") || "");
      assExtradata = String(mpv.getString("sub-ass-extradata") || "");
    } catch (_) {}
  let displayText = "";
  if (eligibility.kind === "srt") {
    displayText = cleanNativeDisplayText(plain);
  } else {
    const assOverride = nativeAssOverrideClassification(
      surface === "secondary"
        ? mpvStringProp(
            [
              "options/secondary-sub-ass-override",
              "secondary-sub-ass-override",
            ],
            "yes",
          )
        : mpvStringProp(
            ["options/sub-ass-override", "sub-ass-override"],
            "yes",
          ),
    );
    if (assOverride.reason) return { reason: assOverride.reason };
    if (surface === "secondary" && assOverride.mode === "force")
      return { reason: "unsupported-ass-override" };
    const parsed =
      surface === "secondary"
        ? { displayText: cleanNativeDisplayText(plain), styleRuns: [] }
        : !assOverride.nativeGeometry
          ? parseSimpleNativeAssCue(ass, assOverride.mode)
          : nativeAssDisplayText(ass);
    if (parsed.reason) return { reason: parsed.reason };
    displayText = parsed.displayText;
  }
  const lookupText = String(normalizedText || "");
  if (!displayText || !lookupText)
    return { reason: "empty-subtitle", displayText };
  let srtEventBlocks = [];
  if (
    eligibility.kind === "srt" &&
    eligibility.track.external &&
    displayText.indexOf("\n") >= 0
  ) {
    const segmented = nativeExternalSrtEventBlocks(
      eligibility.track,
      surface,
      displayText,
      lookupText,
      Number(snapshotOptions.lookupStart || 0),
      ass,
    );
    if (segmented.reason) return { reason: segmented.reason, displayText };
    srtEventBlocks = segmented.eventBlocks;
  }
  const options = nativeSubtitleOptionSnapshot(surface);
  let mapping = null;
  let osd = null;
  if (eligibility.kind === "ass") {
    mapping = nativeLookupMapping(displayText, lookupText, {
      flattenLineBreaks: prefBool("flattenSubtitleLineBreaks", false),
      languageId: selectedLanguageModule().id,
    });
    if (!mapping.ok) return { reason: mapping.reason };
    osd = normalizeNativeOsdDimensions(
      nativeSubtitleJsonProperty("osd-dimensions", null),
    );
    if (!osd) return { reason: "missing-osd-dimensions" };
    const video = normalizeNativeVideoDimensions(
      nativeSubtitleJsonProperty("video-params", null),
    );
    if (!video) return { reason: "missing-video-dimensions" };
    const assOverride = nativeAssOverrideClassification(
      surface === "secondary"
        ? mpvStringProp(
            [
              "options/secondary-sub-ass-override",
              "secondary-sub-ass-override",
            ],
            "yes",
          )
        : mpvStringProp(
            ["options/sub-ass-override", "sub-ass-override"],
            "yes",
          ),
    );
    if (assOverride.reason) return { reason: assOverride.reason };
    if (assOverride.nativeGeometry) {
      if (
        options.assJustify ||
        ["", "auto", "autodetect"].indexOf(options.fontProvider) < 0
      )
        return { reason: "unsupported-renderer-option" };
      const unsupportedRendererProperties = [
        ["options/sub-ass-styles", "sub-ass-styles"],
        ["options/sub-fonts-dir", "sub-fonts-dir"],
        ["options/sub-ass-force-style", "sub-ass-force-style"],
        ["options/sub-ass-style-overrides", "sub-ass-style-overrides"],
      ];
      for (const names of unsupportedRendererProperties) {
        const value = mpvStringProp(names, "").trim();
        if (value && value !== "[]" && value !== "no")
          return { reason: "unsupported-renderer-option" };
      }
      const source = nativeAssSourceSnapshot(
        eligibility.track,
        !!(assFull && assExtradata),
      );
      if (source.reason) return source;
      const units = nativeAssGeometryUnits(
        mapping,
        lookupText,
        selectedLanguageModule(),
      ).map((unit) =>
        Object.assign({}, unit, {
          position:
            Number(unit.position) + Number(snapshotOptions.lookupStart || 0),
        }),
      );
      if (!units.length) return { reason: "text-index-map-failed" };
      let timeMs = Math.round(
        mpvNumberProp(["time-pos", "playback-time"], -1) * 1000,
      );
      const timingPrefix = surface === "secondary" ? "secondary-" : "";
      let startMs = Math.round(
        mpvNumberProp([timingPrefix + "sub-start"], -1) * 1000,
      );
      let endMs = Math.round(
        mpvNumberProp([timingPrefix + "sub-end"], -1) * 1000,
      );
      if (surface === "secondary") {
        const delayMs = Math.round(
          mpvNumberProp(
            ["options/secondary-sub-delay", "secondary-sub-delay"],
            0,
          ) * 1000,
        );
        timeMs -= delayMs;
      }
      if (
        ![timeMs, startMs, endMs].every(Number.isFinite) ||
        timeMs < 0 ||
        startMs < 0 ||
        endMs <= startMs
      )
        return { reason: "cue-timing-unavailable" };
      const appliesSubtitleOptions = assOverride.mode !== "no";
      let fontScale = appliesSubtitleOptions ? options.scale : 1;
      if (options.assScaleWithWindow) {
        const videoAreaHeight = Math.max(1, osd.h - osd.mt - osd.mb);
        fontScale *= osd.h / videoAreaHeight;
      }
      const request = {
        type: "ass-geometry",
        protocol: 1,
        diagnostics:
          typeof verboseLogEnabled === "function" && verboseLogEnabled(),
        validateInstrumentation: prefBool(
          "experimentalNativeSubtitleValidation",
          false,
        ),
        requestAlphaMask:
          prefNumber("experimentalNativeSubtitleTextOpacity", 0) > 0,
        source,
        cue: {
          timeMs,
          startMs,
          endMs,
          ...(assFull && assExtradata ? { assFull, assExtradata } : {}),
          ...(surface === "secondary"
            ? { observedFormat: "plain", observedPlain: plain }
            : { observedAss: ass }),
        },
        units,
        renderer: {
          width: osd.w,
          height: osd.h,
          storageWidth: video.width,
          storageHeight: video.height,
          marginLeft: osd.ml,
          marginRight: osd.mr,
          marginTop: osd.mt,
          marginBottom: osd.mb,
          pixelAspect:
            osd.par *
            (assOverride.mode === "no" || options.assVsfilterAspectCompat
              ? video.par
              : 1),
          fontScale,
          lineSpacing: appliesSubtitleOptions ? options.lineSpacing : 0,
          forceMargins: options.forceMargins,
          embeddedFonts: mpvBoolProp(
            ["options/embeddedfonts", "embeddedfonts"],
            true,
          ),
          overrideMode: assOverride.mode,
          useStorageSize:
            assOverride.mode === "no" || options.assVsfilterBlurCompat,
          defaultFamily: options.effectiveFont,
          fontProvider: options.fontProvider,
          assJustify: options.assJustify,
          linePosition: appliesSubtitleOptions
            ? 100 -
              (surface === "secondary"
                ? clampNumber(
                    mpvNumberProp(
                      ["options/secondary-sub-pos", "secondary-sub-pos"],
                      0,
                    ),
                    0,
                    150,
                    0,
                  )
                : options.position)
            : 0,
          hinting: appliesSubtitleOptions
            ? mpvStringProp(
                ["options/sub-ass-hinting", "sub-ass-hinting"],
                "none",
              )
            : "none",
          shaper: mpvStringProp(
            ["options/sub-ass-shaper", "sub-ass-shaper"],
            "complex",
          ),
        },
      };
      const geometry = nativeAssGeometrySnapshot(request);
      if (!geometry.ok)
        return {
          reason: geometry.reason || "ass-geometry-failed",
          retryScheduled: geometry.retryScheduled === true,
          trackId: eligibility.track.id,
          displayText,
        };
      return {
        kind: "ass-native",
        surface,
        trackId: eligibility.track.id,
        displayText,
        lookupSpans: mapping.lookupSpans,
        layout: {
          osd,
          directRects: geometry.units,
          alphaMask: geometry.alphaMask,
          geometryProtocol: 1,
          hidpiScale: mpvNumberProp(["display-hidpi-scale"], 0),
        },
      };
    }
  }
  const fontCompatibility = nativeSubtitleFontCompatibility(
    options.effectiveFont,
    displayText,
  );
  if (fontCompatibility.reason)
    return {
      reason: fontCompatibility.reason,
      displayText,
      layout: { options },
    };
  const fontMetrics = nativeSubtitleFontMetricSnapshot(options, displayText);
  if (fontMetrics.reason)
    return {
      reason: fontMetrics.reason,
      displayText,
      layout: { options },
    };
  Object.assign(options, fontMetrics.metrics);
  if (!mapping) {
    mapping = nativeLookupMapping(displayText, lookupText, {
      flattenLineBreaks: prefBool("flattenSubtitleLineBreaks", false),
      languageId: selectedLanguageModule().id,
    });
    if (!mapping.ok) return { reason: mapping.reason };
  }
  if (!osd) {
    osd = normalizeNativeOsdDimensions(
      nativeSubtitleJsonProperty("osd-dimensions", null),
    );
    if (!osd) return { reason: "missing-osd-dimensions" };
  }
  return {
    kind: eligibility.kind,
    surface,
    trackId: eligibility.track.id,
    displayText,
    lookupSpans: mapping.lookupSpans,
    layout: {
      osd,
      options,
      eventBlocks: srtEventBlocks,
      hidpiScale: mpvNumberProp(["display-hidpi-scale"], 0),
    },
  };
}

function nativeSubtitleVisibilityTarget(state) {
  const value = state || {};
  if (!value.enabled) return value.original;
  if (value.experimental || value.bitmapOcr) return true;
  if (value.hideNative && value.backendReady) return false;
  return value.original;
}

function currentSubtitleCueIdentity(snapshot, prefetchedTimingIdentity) {
  const timingIdentity =
    arguments.length > 1
      ? String(prefetchedTimingIdentity || "")
      : JSON.stringify({
          start: mpvStringProp(["sub-start"], ""),
          end: mpvStringProp(["sub-end"], ""),
          secondaryStart: mpvStringProp(["secondary-sub-start"], ""),
          secondaryEnd: mpvStringProp(["secondary-sub-end"], ""),
          secondaryDelay: mpvStringProp(
            ["options/secondary-sub-delay", "secondary-sub-delay"],
            "",
          ),
        });
  return JSON.stringify({
    trackId: snapshot && snapshot.trackId,
    timingIdentity,
    displayText: snapshot && snapshot.displayText,
    surfaces:
      snapshot && Array.isArray(snapshot.surfaces)
        ? snapshot.surfaces.map((surface) => ({
            surface: surface.surface,
            trackId: surface.trackId,
            displayText: surface.displayText,
          }))
        : [],
    reason: snapshot && snapshot.reason,
  });
}

function nativeSubtitleCombinedCueSnapshot(prefetchedText) {
  const prefetched =
    prefetchedText && typeof prefetchedText === "object" ? prefetchedText : {};
  const tracks = nativeSubtitleJsonProperty("track-list", []);
  const sid = Object.prototype.hasOwnProperty.call(prefetched, "sid")
    ? Number(prefetched.sid)
    : mpvNumberProp(["sid", "options/sid"], 0);
  const secondarySid = Object.prototype.hasOwnProperty.call(
    prefetched,
    "secondarySid",
  )
    ? String(prefetched.secondarySid || "no")
    : mpvStringProp(["secondary-sid", "options/secondary-sid"], "no");
  const selectedTracks = nativeSelectedSubtitleTracks(
    tracks,
    sid,
    secondarySid,
  );
  const definitions = [
    {
      surface: "primary",
      textProperty: "sub-text",
      prefetchedProperty: "primary",
      eligibility: nativeSubtitleEligibilityForTrack(
        selectedTracks.primary,
        "primary",
      ),
    },
    {
      surface: "secondary",
      textProperty: "secondary-sub-text",
      prefetchedProperty: "secondary",
      eligibility: nativeSubtitleEligibilityForTrack(
        selectedTracks.secondary,
        "secondary",
      ),
    },
  ];
  observeNativeBitmapOcrMouseActivity(
    definitions.some(
      (definition) => definition.eligibility.reason === "bitmap-subtitle",
    ),
  );
  const surfaces = [];
  let nextLookupStart = 0;
  for (const definition of definitions) {
    if (
      definition.surface === "secondary" &&
      !mpvBoolProp(
        ["options/secondary-sub-visibility", "secondary-sub-visibility"],
        true,
      )
    )
      continue;
    const bitmapTrack =
      definition.eligibility.reason === "bitmap-subtitle"
        ? definition.eligibility.track
        : null;
    if (
      Object.prototype.hasOwnProperty.call(
        prefetched,
        definition.prefetchedProperty,
      )
    )
      definition.plain = String(
        prefetched[definition.prefetchedProperty] || "",
      );
    else
      try {
        definition.plain = String(mpv.getString(definition.textProperty) || "");
      } catch (_) {
        definition.plain = "";
      }
    let lookupText = bitmapTrack
      ? ""
      : normalizeExperimentalSubtitleText(definition.plain);
    if (!lookupText && !bitmapTrack) continue;
    definition.lookupStart = nextLookupStart;
    const snapshot = nativeSubtitleCueSnapshot(lookupText, definition);
    if (!snapshot || snapshot.reason) {
      surfaces.push({
        kind: bitmapTrack ? "bitmap-ocr" : (snapshot && snapshot.kind) || "",
        surface: definition.surface,
        lookupText,
        lookupStart: definition.lookupStart,
        lookupLength: Array.from(lookupText).length,
        displayText: bitmapTrack
          ? ""
          : cleanNativeDisplayText(definition.plain),
        lookupSpans: [],
        reason: (snapshot && snapshot.reason) || "unsupported-codec",
        retryScheduled: snapshot && snapshot.retryScheduled === true,
      });
      if (lookupText) nextLookupStart += Array.from(lookupText).length + 1;
      continue;
    }
    lookupText = String(snapshot.lookupText || lookupText || "");
    snapshot.lookupText = lookupText;
    snapshot.lookupStart = definition.lookupStart;
    snapshot.lookupLength = Array.from(lookupText).length;
    surfaces.push(snapshot);
    nextLookupStart += Array.from(lookupText).length + 1;
  }
  if (!surfaces.length)
    return {
      reason: "empty-subtitle",
      lookupText: "",
      surfaces: [],
    };

  surfaces.forEach((surface) => {
    if (surface.layout && Array.isArray(surface.layout.directRects))
      surface.layout.directRects.forEach((unit) => {
        unit.surface = surface.surface;
      });
  });
  const successful = surfaces.filter(
    (surface) => !surface.reason && surface.layout,
  );
  const bitmapSurfaces = surfaces.filter(
    (surface) =>
      surface.kind === "bitmap-ocr" &&
      surface.reason !== "empty-subtitle" &&
      surface.reason !== "bitmap-ocr-disabled",
  );
  let bitmapOcrStatus = null;
  if (bitmapSurfaces.length) {
    const pending = bitmapSurfaces.find(
      (surface) => surface.reason === "bitmap-ocr-pending",
    );
    const waiting = bitmapSurfaces.find(
      (surface) => surface.reason === "screenshot-fallback-waits-for-pause",
    );
    const idle = bitmapSurfaces.find(
      (surface) => surface.reason === "bitmap-ocr-awaiting-intent",
    );
    const ready = bitmapSurfaces.find(
      (surface) => !surface.reason && surface.layout,
    );
    const failed = bitmapSurfaces.find((surface) => surface.reason);
    bitmapOcrStatus = {
      state: pending
        ? "pending"
        : waiting
          ? "waiting-for-pause"
          : idle
            ? "idle"
            : ready
              ? "ready"
              : "failed",
      reason: String((pending || waiting || failed || {}).reason || ""),
      fallbackEnabled: prefBool(
        "bitmapSubtitleOcrScreenshotFallbackEnabled",
        false,
      ),
    };
  }
  return {
    kind: "multi-surface",
    trackId: successful[0] && successful[0].trackId,
    lookupText: surfaces
      .map((surface) => surface.lookupText)
      .filter(Boolean)
      .join("\n"),
    displayText: surfaces
      .map((surface) => surface.displayText)
      .filter(Boolean)
      .join("\n"),
    surfaces,
    bitmapOcrStatus,
    lookupSpans: [],
    layout: null,
    reason: successful.length
      ? ""
      : surfaces.map((surface) => surface.reason).filter(Boolean)[0] ||
        "empty-subtitle",
  };
}

function reportNativeAssReadiness(snapshot) {
  const surfaces =
    snapshot && Array.isArray(snapshot.surfaces)
      ? snapshot.surfaces
      : [snapshot || {}];
  const rejected = surfaces.find((surface) => surface && surface.reason);
  if (!rejected) {
    lastNativeAssReadinessDiagnosticKey = "";
    return;
  }
  if (rejected.reason === "empty-subtitle") {
    lastNativeAssReadinessDiagnosticKey = "";
    return;
  }
  const surface = rejected.surface === "secondary" ? "secondary" : "primary";
  const tracks = nativeSubtitleJsonProperty("track-list", []);
  const sid = mpvNumberProp(["sid", "options/sid"], -1);
  const secondarySid = mpvStringProp(
    ["secondary-sid", "options/secondary-sid"],
    "no",
  );
  const eligibility = nativeSubtitleTrackEligibility(
    tracks,
    sid,
    secondarySid,
    surface,
  );
  const track = eligibility.track || null;
  const selectedId = surface === "secondary" ? Number(secondarySid) : sid;
  if (track && track.codec !== "ass") {
    lastNativeAssReadinessDiagnosticKey = "";
    return;
  }
  const assObserved = mpvStringProp(
    [surface === "secondary" ? "secondary-sub-text" : "sub-text-ass"],
    "",
  );
  if (!track && !assObserved) {
    lastNativeAssReadinessDiagnosticKey = "";
    return;
  }

  const media = currentMediaSourceSnapshot();
  const source =
    track && track.external
      ? nativeExternalSubtitleSource(track)
      : media.primary;
  const retryableReadinessReasons = {
    "ambiguous-stream-map": true,
    "ass-geometry-pending": true,
    "cue-timing-unavailable": true,
    "missing-osd-dimensions": true,
    "missing-video-dimensions": true,
    "subtitle-track-unavailable": true,
    "unsupported-codec": true,
    "unsafe-media-path": true,
  };
  const rawReason = String(rejected.reason || "unsupported");
  const reason = /^[a-z0-9-]+$/.test(rawReason)
    ? rawReason
    : "ass-geometry-failed";
  const diagnostic = {
    event: "ass-readiness",
    mediaGeneration: nativeAssGeometryGeneration,
    sourceClass: mediaSourceDiagnosticClass(source),
    pathPresent: !!media.original.raw,
    streamOpenFilenamePresent: !!media.effective.raw,
    selectedTrackId: track ? track.id : selectedId >= 0 ? selectedId : null,
    ffIndex:
      track && Number.isInteger(track.ffIndex) && track.ffIndex >= 0
        ? track.ffIndex
        : null,
    lifecycleTrigger:
      typeof nativeSubtitleLayoutTrigger === "string"
        ? nativeSubtitleLayoutTrigger
        : "poll",
    reason,
    retryScheduled:
      rejected.retryScheduled === true || !!retryableReadinessReasons[reason],
  };
  const key = JSON.stringify(diagnostic);
  if (key === lastNativeAssReadinessDiagnosticKey) return;
  lastNativeAssReadinessDiagnosticKey = key;
  debugLog("native ASS readiness " + key);
}
