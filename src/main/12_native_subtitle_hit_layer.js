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
    .then(() =>
      utils.exec(
        "/bin/mkdir",
        ["-p", nativeSubtitlePrivateCueDirectory()],
        dataRoot(),
      ),
    )
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
        timeoutId = setTimeout(
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
    if (timeoutId !== null) clearTimeout(timeoutId);
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

function normalizeNativeTrackList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (track) => track && String(track.type || "").toLowerCase() === "sub",
    )
    .map((track) => ({
      id: Number(track.id),
      selected: !!track.selected,
      mainSelection: Number(
        track["main-selection"] !== undefined
          ? track["main-selection"]
          : track.mainSelection,
      ),
      codec: String(track.codec || track["codec-desc"] || "")
        .trim()
        .toLowerCase(),
      ffIndex: Number(
        track["ff-index"] !== undefined ? track["ff-index"] : track.ffIndex,
      ),
      external: !!track.external,
      externalFilename: String(
        track["external-filename"] || track.externalFilename || "",
      ),
      language: String(track.lang || track.language || ""),
      title: String(track.title || ""),
    }));
}

function nativeSubtitleTrackEligibility(
  tracks,
  sid,
  secondarySid,
  surfaceName,
) {
  const list = normalizeNativeTrackList(tracks);
  const surface = surfaceName === "secondary" ? "secondary" : "primary";
  const selectedId = Number(sid);
  const selectedSecondaryId = Number(secondarySid);
  if (surface === "secondary") {
    const secondary =
      list.find(
        (track) =>
          track.selected &&
          (track.mainSelection === 1 || track.id === selectedSecondaryId),
      ) ||
      list.find((track) => track.id === selectedSecondaryId) ||
      list.find((track) => track.selected && track.mainSelection === 1);
    if (!secondary) return { reason: "subtitle-track-unavailable" };
    if (/pgs|hdmv|dvd|vobsub|dvb|bitmap/.test(secondary.codec))
      return { reason: "bitmap-subtitle", track: secondary };
    if (/(^|[^a-z])(subrip|srt)([^a-z]|$)/.test(secondary.codec))
      return { kind: "srt", track: secondary, surface };
    if (/(^|[^a-z])(ass|ssa)([^a-z]|$)/.test(secondary.codec))
      return { kind: "ass", track: secondary, surface };
    return { reason: "unsupported-codec", track: secondary };
  }
  const primary =
    list.find(
      (track) =>
        track.selected &&
        (track.mainSelection === 0 || track.id === selectedId),
    ) ||
    list.find((track) => track.selected && track.mainSelection !== 1) ||
    list.find((track) => track.id === selectedId);
  if (!primary) return { reason: "unsupported-codec" };
  if (/pgs|hdmv|dvd|vobsub|dvb|bitmap/.test(primary.codec))
    return { reason: "bitmap-subtitle", track: primary };
  if (/(^|[^a-z])(subrip|srt)([^a-z]|$)/.test(primary.codec))
    return { kind: "srt", track: primary };
  if (/(^|[^a-z])(ass|ssa)([^a-z]|$)/.test(primary.codec))
    return { kind: "ass", track: primary };
  return { reason: "unsupported-codec", track: primary };
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
  if (/[\r{}]/.test(text)) return { reason: "complex-ass-tags" };
  if (/\\(?![Nn])/i.test(text)) return { reason: "complex-ass-tags" };
  return {
    displayText: text.replace(/\\N/g, "\n").replace(/\\n/g, "\n"),
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

function nativeAssSourceSnapshot(track) {
  const selected = track || {};
  const path = selected.external
    ? selected.externalFilename
    : mpvStringProp(["stream-open-filename", "path"], "");
  if (!path || path.charAt(0) !== "/") return { reason: "unsafe-media-path" };
  if (!Number.isInteger(selected.ffIndex) || selected.ffIndex < 0)
    return { reason: "ambiguous-stream-map" };
  return {
    path,
    ffIndex: selected.ffIndex,
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
      cues.push({ startMs, endMs, text: text.join("\n") });
      if (cues.length > 100000) return { reason: "srt-cue-limit-exceeded" };
    }
  }
  return cues.length ? { cues } : { reason: "empty-subtitle" };
}

function nativeExternalSrtCues(track) {
  const selected = track || {};
  const path = String(selected.externalFilename || "");
  if (!selected.external || !path || path.charAt(0) !== "/")
    return { reason: "srt-event-boundaries-unavailable" };
  if (nativeExternalSrtCache[path]) return nativeExternalSrtCache[path];
  let parsed = null;
  try {
    parsed = parseNativeSrtCues(String(file.read(path) || ""));
  } catch (_) {
    parsed = { reason: "srt-read-failed" };
  }
  nativeExternalSrtCache[path] = parsed;
  return parsed;
}

function nativeExternalSrtEventBlocks(
  track,
  surface,
  displayText,
  lookupText,
  lookupStart,
) {
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
  const active = parsed.cues.filter(
    (cue) => cue.startMs <= timeMs && cue.endMs > timeMs,
  );
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
  return { ok: true, units, alphaMask };
}

function pruneNativeAssGeometryCache() {
  const cacheKeys = Object.keys(nativeAssGeometryCache);
  while (cacheKeys.length > 16)
    delete nativeAssGeometryCache[cacheKeys.shift()];
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

function nativeAssGeometrySnapshot(request) {
  const key = nativeAssGeometryCacheKey(request);
  const cached = nativeAssGeometryCache[key];
  if (cached) return cached;
  const generation = nativeAssGeometryGeneration;
  if (!nativeAssGeometryInFlight[key]) {
    const liveRequest = request;
    const inFlight = Promise.resolve()
      .then(() =>
        runWorkerQueueRequestDirect(
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
        nativeAssGeometryCache[key] = normalized;
        pruneNativeAssGeometryCache();
        if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
          scheduleExperimentalNativeLayoutRebuild();
      })
      .catch((error) => {
        if (generation !== nativeAssGeometryGeneration) return;
        const message = String(
          (error && (error.reason || error.message)) || "ass-geometry-failed",
        );
        nativeAssGeometryCache[key] = {
          reason: /^[a-z0-9-]+$/.test(message)
            ? message
            : "ass-geometry-failed",
        };
        pruneNativeAssGeometryCache();
        debugWarn("native ASS geometry failed: " + compactError(error));
        if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
          scheduleExperimentalNativeLayoutRebuild();
      })
      .finally(() => {
        if (nativeAssGeometryInFlight[key] === inFlight)
          delete nativeAssGeometryInFlight[key];
      });
    nativeAssGeometryInFlight[key] = inFlight;
  }
  return { reason: "ass-geometry-pending" };
}

function advanceNativeAssGeometryGeneration() {
  nativeAssGeometryGeneration++;
  nativeAssGeometryCache = Object.create(null);
  nativeAssGeometryInFlight = Object.create(null);
}

function nativeSubtitleCueSnapshot(normalizedText, surfaceOptions) {
  const surface =
    surfaceOptions && surfaceOptions.surface === "secondary"
      ? "secondary"
      : "primary";
  const tracks = nativeSubtitleJsonProperty("track-list", []);
  const sid = mpvNumberProp(["sid", "options/sid"], 0);
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
  if (eligibility.reason) return { reason: eligibility.reason };
  let plain = "";
  let ass = "";
  try {
    plain = String(
      mpv.getString(
        surface === "secondary" ? "secondary-sub-text" : "sub-text",
      ) || "",
    );
  } catch (_) {}
  try {
    ass = String(
      mpv.getString(
        surface === "secondary" ? "secondary-sub-text" : "sub-text-ass",
      ) || "",
    );
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
  if (eligibility.kind === "srt" && eligibility.track.external) {
    const segmented = nativeExternalSrtEventBlocks(
      eligibility.track,
      surface,
      displayText,
      lookupText,
      Number((surfaceOptions && surfaceOptions.lookupStart) || 0),
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
      const source = nativeAssSourceSnapshot(eligibility.track);
      if (source.reason) return source;
      const units = nativeAssGeometryUnits(
        mapping,
        lookupText,
        selectedLanguageModule(),
      ).map((unit) =>
        Object.assign({}, unit, {
          position:
            Number(unit.position) +
            Number((surfaceOptions && surfaceOptions.lookupStart) || 0),
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
        source,
        cue: {
          timeMs,
          startMs,
          endMs,
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
  if (value.experimental) return true;
  if (value.hideNative && value.backendReady) return false;
  return value.original;
}

function currentSubtitleCueIdentity(snapshot) {
  return JSON.stringify({
    trackId: snapshot && snapshot.trackId,
    start: mpvStringProp(["sub-start"], ""),
    end: mpvStringProp(["sub-end"], ""),
    secondaryStart: mpvStringProp(["secondary-sub-start"], ""),
    secondaryEnd: mpvStringProp(["secondary-sub-end"], ""),
    secondaryDelay: mpvStringProp(
      ["options/secondary-sub-delay", "secondary-sub-delay"],
      "",
    ),
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

function nativeSubtitleCombinedCueSnapshot() {
  const definitions = [
    { surface: "primary", textProperty: "sub-text" },
    { surface: "secondary", textProperty: "secondary-sub-text" },
  ];
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
    const lookupText = readExperimentalLookupSubtitleProperty(
      definition.textProperty,
    );
    if (!lookupText) continue;
    definition.lookupStart = nextLookupStart;
    nextLookupStart += Array.from(lookupText).length + 1;
    const snapshot = nativeSubtitleCueSnapshot(lookupText, definition);
    if (!snapshot || snapshot.reason) {
      surfaces.push({
        surface: definition.surface,
        lookupText,
        lookupStart: definition.lookupStart,
        lookupLength: Array.from(lookupText).length,
        displayText: cleanNativeDisplayText(
          mpvStringProp([definition.textProperty], ""),
        ),
        lookupSpans: [],
        reason: (snapshot && snapshot.reason) || "unsupported-codec",
      });
      continue;
    }
    snapshot.lookupText = lookupText;
    snapshot.lookupStart = definition.lookupStart;
    snapshot.lookupLength = Array.from(lookupText).length;
    surfaces.push(snapshot);
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
  return {
    kind: "multi-surface",
    trackId: successful[0] && successful[0].trackId,
    lookupText: surfaces.map((surface) => surface.lookupText).join("\n"),
    displayText: surfaces.map((surface) => surface.displayText).join("\n"),
    surfaces,
    lookupSpans: [],
    layout: null,
    reason: successful.length
      ? ""
      : surfaces.map((surface) => surface.reason).filter(Boolean)[0] ||
        "empty-subtitle",
  };
}
