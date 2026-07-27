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
  if (osd.par < 0.95 || osd.par > 1.05) return null;
  return osd;
}

function nativeSubtitleOptionSnapshot() {
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
  return {
    font: effectiveFont,
    effectiveFont,
    runtimeFont,
    optionFont,
    fontSize: clampNumber(
      mpvNumberProp(["options/sub-font-size", "sub-font-size"], 55),
      1,
      240,
      55,
    ),
    scale: clampNumber(
      mpvNumberProp(["options/sub-scale", "sub-scale"], 1),
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
      mpvNumberProp(["options/sub-pos", "sub-pos"], 100),
      0,
      150,
      100,
    ),
    alignX: align(
      mpvStringProp(["options/sub-align-x", "sub-align-x"], "center"),
      ["left", "center", "right"],
      "center",
    ),
    alignY: align(
      mpvStringProp(["options/sub-align-y", "sub-align-y"], "bottom"),
      ["top", "center", "bottom"],
      "bottom",
    ),
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
    useMargins: mpvBoolProp(
      ["options/sub-use-margins", "sub-use-margins"],
      true,
    ),
    bold: mpvBoolProp(["options/sub-bold", "sub-bold"], true),
    italic: mpvBoolProp(["options/sub-italic", "sub-italic"], false),
  };
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
          () => reject(new Error("font-metrics-timeout")),
          8000,
        );
      }),
    ]);
    if (!result || Number(result.status) !== 0)
      throw new Error("font-metrics-command-failed");
    const parsed = parseBackendJsonOutput(result.stdout, result.stderr);
    return normalizeNativeSubtitleFontMetricResult(parsed);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    safeDelete(cuePath);
  }
}

function advanceNativeSubtitleFontMetricGeneration() {
  nativeSubtitleFontMetricGeneration++;
  nativeSubtitleFontMetricActiveKey = "";
}

function notifyNativeSubtitleFontMetricResolution(key, generation) {
  if (
    generation !== nativeSubtitleFontMetricGeneration ||
    key !== nativeSubtitleFontMetricActiveKey
  )
    return;
  if (typeof invalidateExperimentalNativeLayout === "function")
    invalidateExperimentalNativeLayout("font-metrics-resolved");
  if (typeof scheduleExperimentalNativeLayoutRebuild === "function")
    scheduleExperimentalNativeLayoutRebuild();
}

function nativeSubtitleFontMetricSnapshot(options, text) {
  const key = nativeSubtitleFontMetricCacheKey(options, text);
  nativeSubtitleFontMetricActiveKey = key;
  const cached = nativeSubtitleFontMetricCache[key];
  if (cached && cached.status === "ready")
    return { ok: true, metrics: cached.metrics };
  if (cached && cached.status === "failed")
    return { reason: "font-metrics-unavailable" };
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
      .catch(() => {
        if (generation === nativeSubtitleFontMetricGeneration)
          nativeSubtitleFontMetricCache[key] = { status: "failed" };
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
    }));
}

function nativeSubtitleTrackEligibility(tracks, sid, secondarySid) {
  const list = normalizeNativeTrackList(tracks);
  const selectedId = Number(sid);
  const selectedSecondaryId = Number(secondarySid);
  if (Number.isFinite(selectedSecondaryId) && selectedSecondaryId > 0)
    return { reason: "secondary-subtitle-active" };
  const secondary = list.find(
    (track) => track.selected && track.mainSelection === 1,
  );
  if (secondary) return { reason: "secondary-subtitle-active" };
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

function nativeSubtitleCueSnapshot(normalizedText) {
  nativeSubtitleFontMetricActiveKey = "";
  const tracks = nativeSubtitleJsonProperty("track-list", []);
  const sid = mpvNumberProp(["sid", "options/sid"], 0);
  const secondarySid = mpvStringProp(
    ["secondary-sid", "options/secondary-sid"],
    "no",
  );
  const eligibility = nativeSubtitleTrackEligibility(tracks, sid, secondarySid);
  if (eligibility.reason) return { reason: eligibility.reason };
  let plain = "";
  let ass = "";
  try {
    plain = String(mpv.getString("sub-text") || "");
  } catch (_) {}
  try {
    ass = String(mpv.getString("sub-text-ass") || "");
  } catch (_) {}
  let displayText = "";
  if (eligibility.kind === "srt") {
    displayText = cleanNativeDisplayText(plain);
  } else {
    const parsed = parseSimpleNativeAssCue(
      ass,
      mpvStringProp(["options/sub-ass-override", "sub-ass-override"], ""),
    );
    if (parsed.reason) return { reason: parsed.reason };
    displayText = parsed.displayText;
  }
  const options = nativeSubtitleOptionSnapshot();
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
  const mapping = nativeLookupMapping(displayText, normalizedText, {
    flattenLineBreaks: prefBool("flattenSubtitleLineBreaks", false),
    languageId: selectedLanguageModule().id,
  });
  if (!mapping.ok) return { reason: mapping.reason };
  const osd = normalizeNativeOsdDimensions(
    nativeSubtitleJsonProperty("osd-dimensions", null),
  );
  if (!osd) return { reason: "missing-osd-dimensions" };
  return {
    kind: eligibility.kind,
    trackId: eligibility.track.id,
    displayText,
    lookupSpans: mapping.lookupSpans,
    layout: {
      osd,
      options,
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
    displayText: snapshot && snapshot.displayText,
    reason: snapshot && snapshot.reason,
  });
}
