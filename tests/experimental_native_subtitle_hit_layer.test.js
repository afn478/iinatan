const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

const root = path.resolve(__dirname, "..");
const TEST_FONT_METRICS = {
  resolvedPostScriptName: "Helvetica",
  resolvedFamilyName: "Helvetica",
  resolvedFullName: "Helvetica",
  fontVersion: "test",
  unitsPerEm: 1000,
  usWinAscent: 1015,
  usWinDescent: 242,
  fontMetricScale: 1000 / 1257,
  fontMetricSource: "coretext-libass-os2-win-v2",
  fontMetricResolverVersion: 2,
  libassProviderVerified: true,
  resolvedFontFormat: 1,
  resolvedBold: false,
  resolvedItalic: false,
  syntheticBold: false,
  syntheticItalic: false,
  weightTrait: 0,
};

function backendFontMetricResult(
  resolvedPostScriptName,
  usWinAscent,
  usWinDescent,
) {
  return {
    ok: true,
    metricResolverVersion: 2,
    metricSource: "coretext-libass-os2-win-v2",
    libassProviderVerified: true,
    resolvedFontFormat: 1,
    resolvedPostScriptName,
    resolvedFamilyName:
      resolvedPostScriptName === "YuMin-Medium"
        ? "YuMincho"
        : resolvedPostScriptName,
    resolvedFullName: resolvedPostScriptName,
    fontVersion: "test-native",
    unitsPerEm: 1000,
    usWinAscent,
    usWinDescent,
    fontMetricScale: 1000 / (usWinAscent + usWinDescent),
    resolvedBold: false,
    resolvedItalic: false,
    syntheticBold: false,
    syntheticItalic: false,
    weightTrait: 0.23,
    cueCoverage: { ok: true, utf16Units: 2, glyphCount: 2 },
  };
}

function assertEqual(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    message +
      "\nactual=" +
      JSON.stringify(actual) +
      "\nexpected=" +
      JSON.stringify(expected),
  );
}

function loadMainNativeHelpers(properties) {
  const values = Object.assign({}, properties || {});
  const fontMetricEvents = [];
  const privateFiles = Object.assign(
    Object.create(null),
    values.__privateFiles || {},
  );
  const execEvents = [];
  const fontMetricExec =
    values.__fontMetricExec ||
    (async () => {
      throw new Error("unexpected native font metric exec");
    });
  const context = {
    console,
    JSON,
    Object,
    String,
    Number,
    Math,
    Array,
    Intl,
    Promise,
    setTimeout,
    clearTimeout,
    nativeSubtitleFontMetricCache: Object.create(null),
    nativeSubtitleFontMetricInFlight: Object.create(null),
    nativeSubtitleFontMetricGeneration: 0,
    nativeSubtitleFontMetricActiveKey: "",
    nativeSubtitlePrivateCueSerial: 0,
    nativeSubtitlePrivateCueDirectoryPromise: null,
    __testUseActualFontMetrics: !!values.__useActualFontMetricResolver,
    __testDefaultFontMetrics: TEST_FONT_METRICS,
    __fontMetricEvents: fontMetricEvents,
    __testPrivateFiles: privateFiles,
    __testExecEvents: execEvents,
    async ensureBundledBackendInstalled() {},
    utils: {
      async exec(command, args, cwd) {
        execEvents.push({ command, args: Array.from(args || []), cwd });
        if (command === "/bin/mkdir" || command === "/bin/chmod")
          return { status: 0, stdout: "", stderr: "" };
        return fontMetricExec(command, args, cwd);
      },
    },
    binPath() {
      return "/test/iina-hoshi-dicts";
    },
    dataRoot() {
      return "/test";
    },
    file: {
      write(filePath, contents) {
        privateFiles[filePath] = String(contents);
      },
      exists(filePath) {
        return Object.prototype.hasOwnProperty.call(privateFiles, filePath);
      },
      delete(filePath) {
        delete privateFiles[filePath];
      },
    },
    safeDelete(filePath) {
      delete privateFiles[filePath];
    },
    clearDirFiles() {
      Object.keys(privateFiles).forEach((filePath) => {
        delete privateFiles[filePath];
      });
    },
    parseBackendJsonOutput(stdout) {
      return JSON.parse(String(stdout || ""));
    },
    invalidateExperimentalNativeLayout(reason) {
      fontMetricEvents.push("invalidate:" + reason);
    },
    scheduleExperimentalNativeLayoutRebuild() {
      fontMetricEvents.push("schedule");
    },
    mpv: {
      getNative(name) {
        return values[name];
      },
      getString(name) {
        const value = values[name];
        return value === undefined || value === null
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
      },
    },
    mpvStringProp(names, fallback) {
      for (const name of names) {
        const value = values[name];
        if (value !== undefined && value !== null && String(value).trim())
          return String(value).trim();
      }
      return fallback;
    },
    mpvNumberProp(names, fallback) {
      for (const name of names) {
        const value = Number(values[name]);
        if (Number.isFinite(value)) return value;
      }
      return fallback;
    },
    mpvBoolProp(names, fallback) {
      for (const name of names) {
        const value = values[name];
        if (value === undefined) continue;
        return /^(yes|true|1|on)$/i.test(String(value));
      }
      return fallback;
    },
    clampNumber(value, min, max, fallback) {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.max(min, Math.min(max, number))
        : fallback;
    },
    cleanNativeDisplayText(text) {
      return String(text || "").replace(/\r/g, "");
    },
    prefBool(name, fallback) {
      return values["pref:" + name] === undefined
        ? fallback
        : !!values["pref:" + name];
    },
    selectedLanguageModule() {
      return { id: values.languageId || "en" };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "src/main/12_native_subtitle_hit_layer.js"),
      "utf8",
    ) +
      `
if (!globalThis.__testUseActualFontMetrics) {
  nativeSubtitleFontMetricSnapshot = function (options) {
    return {
      ok: true,
      metrics: Object.assign({}, globalThis.__testDefaultFontMetrics, {
        resolvedPostScriptName: String(
          (options && (options.effectiveFont || options.font)) || "Helvetica"
        ),
        resolvedFamilyName: String(
          (options && (options.effectiveFont || options.font)) || "Helvetica"
        ),
        resolvedFullName: String(
          (options && (options.effectiveFont || options.font)) || "Helvetica"
        )
      })
    };
  };
}
globalThis.nativeHelpers = {
  normalizeNativeOsdDimensions,
  nativeSubtitleOptionSnapshot,
  nativeSubtitleFontCompatibility,
  nativeSubtitleFontMetricScale,
  nativeSubtitleFontCoverageSignature,
  nativeSubtitleFontMetricCacheKey,
  normalizeNativeSubtitleFontMetricResult,
  runNativeSubtitleFontMetricCommand,
  nativeSubtitleFontMetricSnapshot,
  advanceNativeSubtitleFontMetricGeneration,
  normalizeNativeTrackList,
  nativeSubtitleTrackEligibility,
  parseSimpleNativeAssCue,
  nativeGraphemeBreakFallback,
  nativeGraphemeSegments,
  nativeLookupMapping,
  nativeSubtitleCueSnapshot,
  nativeSubtitleVisibilityTarget,
  testFontMetricEvents: globalThis.__fontMetricEvents,
  testPrivateFiles: globalThis.__testPrivateFiles,
  testExecEvents: globalThis.__testExecEvents
};`,
    context,
  );
  return context.nativeHelpers;
}

function loadGeometryHelpers() {
  const context = { console, JSON, Object, String, Number, Math, Array };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "src/overlay/native_subtitle_hit_layer.js"),
      "utf8",
    ) + ";globalThis.geometryHelpers=IINATAN_NATIVE_SUBTITLE_HIT_LAYER;",
    context,
  );
  return context.geometryHelpers;
}

function waitForLayout() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

(async () => {
  const helpers = loadMainNativeHelpers();
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      [
        {
          type: "sub",
          id: 2,
          selected: true,
          "main-selection": 0,
          codec: "subrip",
        },
      ],
      2,
    ).kind,
    "srt",
    "selected SubRip track is accepted by codec metadata",
  );
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      [
        {
          type: "sub",
          id: 2,
          selected: true,
          "main-selection": 0,
          codec: "hdmv_pgs_subtitle",
        },
      ],
      2,
    ).reason,
    "bitmap-subtitle",
    "bitmap subtitle codecs fail closed",
  );
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      [
        {
          type: "sub",
          id: 2,
          selected: true,
          "main-selection": 0,
          codec: "subrip",
        },
        {
          type: "sub",
          id: 3,
          selected: true,
          "main-selection": 1,
          codec: "subrip",
        },
      ],
      2,
    ).reason,
    "secondary-subtitle-active",
    "an active secondary subtitle rejects the cue",
  );
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      [
        {
          type: "sub",
          id: 2,
          selected: true,
          "main-selection": 0,
          codec: "subrip",
        },
      ],
      2,
      3,
    ).reason,
    "secondary-subtitle-active",
    "the explicit secondary-sid property also rejects the cue",
  );
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      [
        {
          type: "sub",
          id: 2,
          selected: true,
          "main-selection": 0,
          codec: "mystery",
        },
      ],
      2,
    ).reason,
    "unsupported-codec",
    "unknown text codecs are not inferred from filenames",
  );

  assertEqual(
    helpers.parseSimpleNativeAssCue("first\\Nsecond", "strip").displayText,
    "first\nsecond",
    "plain authored ASS breaks are mirrored",
  );
  [
    "\\pos(1,2)",
    "\\move(1,2,3,4)",
    "\\org(1,2)",
    "\\an8",
    "\\q2",
    "\\clip(1,2,3,4)",
    "\\t(1,2,\\fs40)",
    "\\fad(100,100)",
    "\\p1",
    "\\k20",
    "\\frz20",
    "\\fscx120",
    "\\fnArial",
    "\\fs40",
    "\\fsp4",
    "\\rDefault",
    "\\b1",
    "\\i1",
  ].forEach((tag) => {
    assertEqual(
      helpers.parseSimpleNativeAssCue("{" + tag + "}text", "force").reason,
      "complex-ass-tags",
      "ASS override is rejected: " + tag,
    );
  });
  assertEqual(
    helpers.parseSimpleNativeAssCue("plain", "yes").reason,
    "ambiguous-ass-event",
    "normal ASS styling remains ambiguous on mpv 0.38",
  );
  assertEqual(
    helpers.parseSimpleNativeAssCue("one\ntwo", "strip").reason,
    "ambiguous-ass-event",
    "multiple active ASS events are rejected",
  );

  let mapping = helpers.nativeLookupMapping(" A  B\nC ", "A B\nC", {
    languageId: "en",
    flattenLineBreaks: false,
  });
  assert(mapping.ok, "authored newlines and repeated spaces map safely");
  assertEqual(mapping.lookupSpans.length, 5, "each canonical code point maps");
  assertEqual(
    mapping.lookupSpans[2],
    { startUtf16: 4, endUtf16: 5 },
    "canonical B maps to its display UTF-16 range",
  );
  mapping = helpers.nativeLookupMapping("A\n\nB", "A B", {
    languageId: "en",
    flattenLineBreaks: true,
  });
  assert(mapping.ok, "flattened lookup newlines retain display geometry spans");
  assertEqual(
    mapping.lookupSpans[1],
    { startUtf16: 1, endUtf16: 3 },
    "flattened newline maps to the complete authored break",
  );
  mapping = helpers.nativeLookupMapping("伺（うか）う", "伺う", {
    languageId: "ja",
  });
  assert(mapping.ok, "Japanese packed furigana deletion remains mappable");
  assertEqual(
    mapping.lookupSpans[1],
    { startUtf16: 5, endUtf16: 6 },
    "post-furigana canonical position maps to the visible glyph",
  );
  mapping = helpers.nativeLookupMapping("😀e\u0301", "😀é", {
    languageId: "en",
  });
  assert(mapping.ok, "surrogates and combining sequences map safely");
  assertEqual(
    mapping.lookupSpans[1],
    { startUtf16: 2, endUtf16: 4 },
    "normalized combining grapheme maps to its complete UTF-16 span",
  );
  mapping = helpers.nativeLookupMapping("Cafe\u0301 noir", "Café noir", {
    languageId: "fr",
  });
  assert(mapping.ok, "NFKC lookup normalization remains mappable");
  assertEqual(
    mapping.lookupSpans[5],
    { startUtf16: 6, endUtf16: 7 },
    "normalized noir starts at canonical position 5 and display UTF-16 offset 6",
  );
  const zwj = "👩‍❤️‍💋‍👨";
  mapping = helpers.nativeLookupMapping(zwj, zwj, { languageId: "en" });
  assert(mapping.ok, "ZWJ grapheme mapping is supported");
  assert(
    mapping.lookupSpans.every(
      (span) => span.startUtf16 === 0 && span.endUtf16 === zwj.length,
    ),
    "every ZWJ code point maps to the complete grapheme",
  );
  assertEqual(
    helpers.nativeGraphemeBreakFallback(zwj).length,
    1,
    "the fallback segmenter keeps a ZWJ sequence together",
  );
  assertEqual(
    helpers.nativeGraphemeBreakFallback("葛\u{E0100}").length,
    1,
    "the fallback segmenter keeps variation selectors attached",
  );
  assert(
    helpers.nativeLookupMapping("Ａ", "A", { languageId: "en" }).ok,
    "authoritative NFKC normalization keeps fullwidth forms mappable",
  );

  const snapshotHelpers = loadMainNativeHelpers({
    "track-list": [
      {
        type: "sub",
        id: 4,
        selected: true,
        "main-selection": 0,
        codec: "subrip",
      },
    ],
    sid: 4,
    "sub-text": "Hello",
    "osd-dimensions": {
      w: 1920,
      h: 1080,
      ml: 0,
      mr: 0,
      mt: 0,
      mb: 0,
      par: 1,
    },
    "options/sub-font": "Helvetica",
    "options/sub-font-size": 48,
    "options/sub-scale": 1.25,
    "options/sub-pos": 140,
    "options/sub-align-x": "center",
    "options/sub-align-y": "bottom",
    "options/sub-spacing": 1,
    "options/sub-line-spacing": 2,
  });
  const snapshot = snapshotHelpers.nativeSubtitleCueSnapshot("Hello");
  assertEqual(snapshot.kind, "srt", "full SRT snapshot is eligible");
  assertEqual(snapshot.layout.osd.w, 1920, "OSD dimensions are captured");
  assertEqual(
    {
      font: snapshot.layout.options.font,
      effectiveFont: snapshot.layout.options.effectiveFont,
      runtimeFont: snapshot.layout.options.runtimeFont,
      optionFont: snapshot.layout.options.optionFont,
    },
    {
      font: "Helvetica",
      effectiveFont: "Helvetica",
      runtimeFont: "",
      optionFont: "Helvetica",
    },
    "the configured font is retained as the option-only fallback",
  );
  assertEqual(snapshot.layout.options.fontSize, 48, "font size is captured");
  assertEqual(
    snapshot.layout.options.scale,
    1.25,
    "subtitle scale is captured",
  );
  assertEqual(snapshot.layout.options.position, 140, "sub-pos supports 0–150");
  assertEqual(
    snapshot.layout.options.spacing,
    1,
    "character spacing is captured",
  );
  assertEqual(
    snapshot.layout.options.lineSpacing,
    2,
    "line spacing is captured",
  );

  const liveFontOptions = loadMainNativeHelpers({
    "sub-font": "Symbol",
    "options/sub-font": "YuMin-Medium",
  }).nativeSubtitleOptionSnapshot();
  assertEqual(
    {
      font: liveFontOptions.font,
      effectiveFont: liveFontOptions.effectiveFont,
      runtimeFont: liveFontOptions.runtimeFont,
      optionFont: liveFontOptions.optionFont,
    },
    {
      font: "Symbol",
      effectiveFont: "Symbol",
      runtimeFont: "Symbol",
      optionFont: "YuMin-Medium",
    },
    "the nonempty live sub-font is authoritative while the option font remains diagnostic",
  );
  assertEqual(
    helpers.nativeSubtitleFontCompatibility("Symbol", "日本").reason,
    "font-incompatible-with-script",
    "Symbol fails closed for Japanese cues",
  );
  assert(
    helpers.nativeSubtitleFontCompatibility("Symbol", "Latin").ok,
    "Symbol is not rejected solely by name for Latin cues",
  );
  ["YuMin-Medium", "YuKyo-Medium", "HiraginoSans-W4"].forEach((font) => {
    assert(
      helpers.nativeSubtitleFontCompatibility(font, "日本語").ok,
      font + " remains compatible with Japanese cues",
    );
  });
  const incompatibleFontSnapshot = loadMainNativeHelpers({
    "track-list": [
      {
        type: "sub",
        id: 4,
        selected: true,
        "main-selection": 0,
        codec: "subrip",
      },
    ],
    sid: 4,
    "sub-text": "日本",
    "sub-font": "Symbol",
    "options/sub-font": "YuMin-Medium",
    languageId: "ja",
  }).nativeSubtitleCueSnapshot("日本");
  assertEqual(
    incompatibleFontSnapshot.reason,
    "font-incompatible-with-script",
    "a live Symbol/Japanese cue is rejected before fallback geometry is exposed",
  );
  assertEqual(
    incompatibleFontSnapshot.layout.options.runtimeFont,
    "Symbol",
    "incompatible-font diagnostics retain the effective live font",
  );

  let resolveYuMinMetrics;
  let yuMinMetricExecCount = 0;
  const asyncMetricHelpers = loadMainNativeHelpers({
    __useActualFontMetricResolver: true,
    __privateFiles: {
      "/test/private-font-metric-cues/iinatan-font-metrics-cue-stale.txt":
        "STALE PRIVATE CUE",
    },
    __fontMetricExec() {
      yuMinMetricExecCount++;
      return new Promise((resolve) => {
        resolveYuMinMetrics = resolve;
      });
    },
    "track-list": [
      {
        type: "sub",
        id: 4,
        selected: true,
        "main-selection": 0,
        codec: "subrip",
      },
    ],
    sid: 4,
    "sub-text": "日本",
    "sub-font": "YuMin-Medium",
    "options/sub-font": "YuMin-Medium",
    "options/sub-bold": "no",
    "osd-dimensions": {
      w: 1920,
      h: 1080,
      ml: 0,
      mr: 0,
      mt: 0,
      mb: 0,
      par: 1,
    },
    languageId: "ja",
  });
  assertEqual(
    asyncMetricHelpers.nativeSubtitleCueSnapshot("日本").reason,
    "font-metrics-pending",
    "a metric cache miss exposes no geometry while the helper is pending",
  );
  assertEqual(
    asyncMetricHelpers.nativeSubtitleCueSnapshot("日本").reason,
    "font-metrics-pending",
    "an unchanged pending cue remains fail closed",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    yuMinMetricExecCount,
    1,
    "identical in-flight font metric requests are deduplicated",
  );
  const privateMetricExec = asyncMetricHelpers.testExecEvents.find(
    (entry) => entry.command === "/test/iina-hoshi-dicts",
  );
  assert(privateMetricExec, "font metrics invoke the bundled native helper");
  assert(
    !privateMetricExec.args.join(" ").includes("日本") &&
      privateMetricExec.args.includes("--cue-file") &&
      !privateMetricExec.args.includes("--"),
    "the loggable command arguments contain a private path but no cue text",
  );
  const privateCuePath =
    privateMetricExec.args[privateMetricExec.args.indexOf("--cue-file") + 1];
  assert(
    /\/private-font-metric-cues\/iinatan-font-metrics-cue-[a-z0-9-]+\.txt$/i.test(
      privateCuePath,
    ) &&
      asyncMetricHelpers.testPrivateFiles[privateCuePath] === "日本" &&
      !Object.prototype.hasOwnProperty.call(
        asyncMetricHelpers.testPrivateFiles,
        "/test/private-font-metric-cues/iinatan-font-metrics-cue-stale.txt",
      ),
    "the cue is staged under an unpredictable dedicated private filename",
  );
  const permissionEvents = asyncMetricHelpers.testExecEvents.filter(
    (entry) => entry.command === "/bin/chmod",
  );
  assert(
    permissionEvents.some(
      (entry) =>
        entry.args[0] === "700" &&
        entry.args[1] === "/test/private-font-metric-cues",
    ) &&
      permissionEvents.some(
        (entry) => entry.args[0] === "600" && entry.args[1] === privateCuePath,
      ),
    "the dedicated directory and cue payload receive private permissions before exec",
  );
  resolveYuMinMetrics({
    status: 0,
    stdout: JSON.stringify(backendFontMetricResult("YuMin-Medium", 1295, 367)),
    stderr: "",
  });
  await waitForLayout();
  assert(
    !Object.prototype.hasOwnProperty.call(
      asyncMetricHelpers.testPrivateFiles,
      privateCuePath,
    ),
    "the JavaScript finally path deletes a completed private cue payload",
  );
  assertEqual(
    asyncMetricHelpers.testFontMetricEvents,
    ["invalidate:font-metrics-resolved", "schedule"],
    "helper completion invalidates and republishes an unchanged cue",
  );
  const resolvedYuMinSnapshot =
    asyncMetricHelpers.nativeSubtitleCueSnapshot("日本");
  assertEqual(
    resolvedYuMinSnapshot.layout.options.resolvedPostScriptName,
    "YuMin-Medium",
    "an exact YuMin request uses the helper's verified PostScript face",
  );
  assert(
    Math.abs(
      resolvedYuMinSnapshot.layout.options.fontMetricScale - 1000 / 1662,
    ) < 1e-12,
    "the normalized snapshot retains the exact per-face metric scale",
  );

  const staleMetricLoads = [];
  const staleMetricHelpers = loadMainNativeHelpers({
    __useActualFontMetricResolver: true,
    __fontMetricExec() {
      return new Promise((resolve) => staleMetricLoads.push(resolve));
    },
  });
  const yuKyoOptions = {
    font: "YuKyo-Medium",
    effectiveFont: "YuKyo-Medium",
    bold: false,
    italic: false,
  };
  assertEqual(
    staleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "日本")
      .reason,
    "font-metrics-pending",
    "the first font generation starts pending",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  staleMetricHelpers.advanceNativeSubtitleFontMetricGeneration();
  assertEqual(
    staleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "日本")
      .reason,
    "font-metrics-pending",
    "a new A-to-B-to-A generation starts a fresh helper request",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    staleMetricLoads.length,
    2,
    "different generations do not share stale in-flight resolution",
  );
  staleMetricLoads[0]({
    status: 0,
    stdout: JSON.stringify(backendFontMetricResult("YuKyo-Medium", 1085, 376)),
    stderr: "",
  });
  await waitForLayout();
  assertEqual(
    staleMetricHelpers.testFontMetricEvents,
    [],
    "a stale helper completion cannot invalidate the current generation",
  );
  staleMetricLoads[1]({
    status: 0,
    stdout: JSON.stringify(backendFontMetricResult("YuKyo-Medium", 1085, 376)),
    stderr: "",
  });
  await waitForLayout();
  assertEqual(
    staleMetricHelpers.testFontMetricEvents,
    ["invalidate:font-metrics-resolved", "schedule"],
    "only the current helper generation triggers republish",
  );
  assert(
    staleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "日本")
      .ok,
    "the current helper result is cached for the matching coverage set",
  );

  let failedMetricExecCount = 0;
  const failedMetricHelpers = loadMainNativeHelpers({
    __useActualFontMetricResolver: true,
    async __fontMetricExec() {
      failedMetricExecCount++;
      return {
        status: 1,
        stdout: '{"ok":false,"error":"font-metrics-cue-not-covered"}',
        stderr: "",
      };
    },
  });
  assertEqual(
    failedMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "日本")
      .reason,
    "font-metrics-pending",
    "a first failed coverage request begins pending",
  );
  await waitForLayout();
  assertEqual(
    failedMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "日本")
      .reason,
    "font-metrics-unavailable",
    "a failed face/coverage result is cached fail closed",
  );
  assertEqual(
    failedMetricExecCount,
    1,
    "the same failed face/coverage request is not repeated",
  );
  assertEqual(
    failedMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "漢字")
      .reason,
    "font-metrics-pending",
    "a different cue coverage set receives its own narrow cache entry",
  );
  await waitForLayout();
  assertEqual(
    failedMetricExecCount,
    2,
    "failure caching does not poison a different coverage set",
  );

  let invalidMetricRejected = false;
  try {
    helpers.normalizeNativeSubtitleFontMetricResult(
      backendFontMetricResult("YuMin-Medium", 0, 0),
    );
  } catch (_) {
    invalidMetricRejected = true;
  }
  assert(invalidMetricRejected, "zero native Win metrics fail closed");

  assertEqual(
    helpers.nativeSubtitleVisibilityTarget({
      enabled: true,
      experimental: true,
      hideNative: true,
      backendReady: true,
      original: false,
    }),
    true,
    "experimental mode always keeps native subtitles visible",
  );
  assertEqual(
    helpers.nativeSubtitleVisibilityTarget({
      enabled: true,
      experimental: false,
      hideNative: true,
      backendReady: true,
      original: true,
    }),
    false,
    "legacy mode retains native hiding after backend readiness",
  );
  assertEqual(
    helpers.nativeSubtitleVisibilityTarget({
      enabled: false,
      experimental: true,
      hideNative: true,
      backendReady: true,
      original: false,
    }),
    false,
    "disabling iinatan restores captured native visibility",
  );

  const subtitleStyleSource = fs.readFileSync(
    path.join(root, "src/main/10_subtitle_text_style.js"),
    "utf8",
  );
  const lifecycleSource = fs.readFileSync(
    path.join(root, "src/main/60_overlay_lifecycle_toggle.js"),
    "utf8",
  );
  assert(
    /function prepareRuntimeAfterProfileChange\(\)\s*\{\s*advanceNativeSubtitleFontMetricGeneration\(\)/.test(
      lifecycleSource,
    ),
    "profile changes advance the asynchronous font metric generation",
  );
  const readSubtitleSource = subtitleStyleSource.slice(
    subtitleStyleSource.indexOf("function readCurrentSubtitle"),
    subtitleStyleSource.indexOf("function cleanNativeDisplayText"),
  );
  const readSubtitleContext = {
    mpv: {
      getString() {
        return "Cafe\u0301 Ａ";
      },
    },
    cleanSubtitleText(text) {
      return String(text || "");
    },
    prefBool(_name, fallback) {
      return fallback;
    },
    selectedLanguageModule() {
      return {
        id: "fr",
        normalizeText(text) {
          return String(text || "").normalize("NFKC");
        },
      };
    },
    IINATAN_LANGUAGE_COMMON: {
      normalizeBasic(text) {
        return String(text || "").normalize("NFKC");
      },
    },
  };
  vm.createContext(readSubtitleContext);
  vm.runInContext(
    readSubtitleSource +
      ";globalThis.readSubtitleApi={readCurrentSubtitle,readExperimentalLookupSubtitle};",
    readSubtitleContext,
  );
  assertEqual(
    readSubtitleContext.readSubtitleApi.readCurrentSubtitle(),
    "Cafe\u0301 Ａ",
    "experiment-off subtitle extraction preserves legacy decomposed and fullwidth text",
  );
  assertEqual(
    readSubtitleContext.readSubtitleApi.readExperimentalLookupSubtitle(),
    "Café A",
    "experimental lookup uses a separate authoritative canonical representation",
  );
  const visibilitySource = subtitleStyleSource.slice(
    subtitleStyleSource.indexOf(
      "function acquireNativeSubtitleVisibilityOwnership",
    ),
    subtitleStyleSource.indexOf("function pollSubtitle"),
  );
  const visibilityWrites = [];
  const visibilityPreferences = {
    experimentalNativeSubtitleHitLayer: true,
    hideNativeSubtitles: true,
  };
  const visibilityContext = {
    console,
    enabled: true,
    nativeSubtitlePlaybackActive: true,
    nativeSubtitleVisibilityOwned: false,
    nativeSubVisibilityBeforeEnable: null,
    mpv: {
      getFlag() {
        return false;
      },
      set(name, value) {
        visibilityWrites.push({ name, value });
      },
    },
    experimentalNativeSubtitleMode() {
      return visibilityPreferences.experimentalNativeSubtitleHitLayer;
    },
    prefBool(name, fallback) {
      return name in visibilityPreferences
        ? visibilityPreferences[name]
        : fallback;
    },
    canHideNativeSubtitlesForCurrentLanguage() {
      return true;
    },
    nativeSubtitleVisibilityTarget: helpers.nativeSubtitleVisibilityTarget,
    compactError(error) {
      return String(error);
    },
  };
  vm.createContext(visibilityContext);
  vm.runInContext(
    visibilitySource +
      ";globalThis.visibilityApi={acquireNativeSubtitleVisibilityOwnership,syncNativeSubtitleVisibility,restoreNativeSubtitleVisibility};",
    visibilityContext,
  );
  visibilityContext.visibilityApi.acquireNativeSubtitleVisibilityOwnership();
  visibilityContext.visibilityApi.syncNativeSubtitleVisibility();
  assertEqual(
    visibilityWrites[visibilityWrites.length - 1],
    { name: "sub-visibility", value: true },
    "the real visibility policy forces native subtitles in experimental mode",
  );
  assertEqual(
    visibilityPreferences.hideNativeSubtitles,
    true,
    "forcing visibility does not mutate the stored hide preference",
  );
  visibilityContext.visibilityApi.restoreNativeSubtitleVisibility();
  assertEqual(
    visibilityWrites[visibilityWrites.length - 1],
    { name: "sub-visibility", value: false },
    "the real visibility lease restores the pre-enable value",
  );

  const pollSource = subtitleStyleSource.slice(
    subtitleStyleSource.indexOf("function pollSubtitle"),
    subtitleStyleSource.indexOf("function charsOf"),
  );
  const published = [];
  const pollContext = {
    console,
    JSON,
    enabled: true,
    lastSubtitle: null,
    lastSubtitleCueIdentity: null,
    lastNativeLayoutFingerprint: "",
    nativeLayoutStablePolls: 0,
    refreshPollingInterval() {},
    syncNativeSubtitleVisibility() {},
    readCurrentSubtitle() {
      return "Cafe\u0301 Ａ";
    },
    readExperimentalLookupSubtitle() {
      return "Café A";
    },
    experimentalNativeSubtitleMode() {
      return true;
    },
    nativeSubtitleCueSnapshot() {
      return {
        kind: "srt",
        trackId: 2,
        displayText: "Cafe\u0301 Ａ",
        lookupSpans: [],
        layout: {
          osd: {
            w: 1280,
            h: 720,
            ml: 0,
            mr: 0,
            mt: 0,
            mb: 0,
            par: 1,
          },
          options: { fontSize: 55 },
        },
      };
    },
    currentSubtitleCueIdentity(snapshotValue) {
      return JSON.stringify(snapshotValue);
    },
    publishSubtitle(text, cue) {
      published.push({ text, cue });
    },
  };
  vm.createContext(pollContext);
  vm.runInContext(
    pollSource +
      ";globalThis.pollApi={pollSubtitle,getLastSubtitle:()=>lastSubtitle};",
    pollContext,
  );
  pollContext.pollApi.pollSubtitle();
  pollContext.pollApi.pollSubtitle();
  assertEqual(
    pollContext.pollApi.getLastSubtitle(),
    "Cafe\u0301 Ａ",
    "experimental polling leaves legacy lastSubtitle and Anki context unchanged",
  );
  assert(
    !pollContext.pollApi.getLastSubtitle().includes("\u0000"),
    "canonical subtitle text never contains identity delimiters",
  );
  assertEqual(
    published[published.length - 1].text,
    "Cafe\u0301 Ａ",
    "stable layout publication still passes the exact legacy subtitle argument",
  );
  assertEqual(
    published[published.length - 1].cue.lookupText,
    "Café A",
    "the experimental cue carries its separate exact backend lookup string",
  );

  const managerSource = fs.readFileSync(
    path.join(root, "src/dictionary-manager/dictionary-manager.html"),
    "utf8",
  );
  const updateBusySource = managerSource.slice(
    managerSource.indexOf("    function updateBusyState()"),
    managerSource.indexOf("    function dictionaryMeta"),
  );
  const syncControlsStart = managerSource.indexOf(
    "    function syncExperimentalNativeSubtitleControls()",
  );
  const syncControlsSource = managerSource.slice(
    syncControlsStart,
    managerSource.indexOf("    function renderRecommended", syncControlsStart),
  );
  const masterControl = { checked: false, disabled: false };
  const boxesControl = { checked: true, disabled: false };
  const opacityControl = { value: "0.65", disabled: false };
  const hideNativeControl = { checked: true, disabled: false, title: "" };
  const preferenceControls = [
    masterControl,
    boxesControl,
    opacityControl,
    hideNativeControl,
  ];
  const managerElements = {
    experimentalNativeSubtitleHitLayer: masterControl,
    experimentalNativeSubtitleHitBoxes: boxesControl,
    experimentalNativeSubtitleTextOpacity: opacityControl,
    hideNativeSubtitles: hideNativeControl,
  };
  const button = () => ({ disabled: false });
  const managerContext = {
    state: {
      busy: false,
      recommendedDictionaries: [{}],
      profiles: [{ id: "default" }],
    },
    els: {
      importZip: button(),
      refresh: button(),
      newProfile: button(),
      renameProfile: button(),
      addAudioSource: button(),
      openRecommended: button(),
      ankiRefresh: button(),
      profileSelect: button(),
      deleteProfile: button(),
      dictionaryList: { querySelectorAll: () => [] },
      audioSourceList: { querySelectorAll: () => [] },
    },
    document: {
      getElementById(id) {
        return managerElements[id] || null;
      },
      querySelectorAll(selector) {
        if (selector === "[data-profile-pref], [data-global-setting]")
          return preferenceControls;
        return [];
      },
    },
    activeProfile() {
      return { locked: false };
    },
  };
  vm.createContext(managerContext);
  vm.runInContext(
    updateBusySource +
      syncControlsSource +
      ";globalThis.controlsApi={updateBusyState};",
    managerContext,
  );
  managerContext.controlsApi.updateBusyState();
  assert(
    boxesControl.disabled && opacityControl.disabled,
    "debug controls remain disabled while the master is off",
  );
  assert(
    boxesControl.checked && opacityControl.value === "0.65",
    "disabled debug controls retain their stored values",
  );
  assert(
    !hideNativeControl.disabled,
    "legacy native visibility control remains enabled with master off",
  );
  masterControl.checked = true;
  managerContext.controlsApi.updateBusyState();
  assert(
    !boxesControl.disabled && !opacityControl.disabled,
    "debug controls enable immediately with the master",
  );
  assert(
    hideNativeControl.disabled,
    "native hiding is disabled while experimental mode owns visibility",
  );
  managerContext.state.busy = true;
  managerContext.controlsApi.updateBusyState();
  assert(
    boxesControl.disabled &&
      opacityControl.disabled &&
      hideNativeControl.disabled,
    "busy-state refresh preserves all experimental dependencies",
  );

  const geometry = loadGeometryHelpers();
  [
    [1015, 242, 0.7955449482895784, "HiraginoSans-W4"],
    [1295, 367, 0.6016847172081829, "YuMin-Medium"],
    [1085, 376, 0.6844626967830253, "YuKyo-Medium"],
  ].forEach(([ascent, descent, expected, font]) => {
    const actual = geometry.fontMetricScaleFromWinMetrics({
      unitsPerEm: 1000,
      usWinAscent: ascent,
      usWinDescent: descent,
    });
    assert(
      Math.abs(actual - expected) < 1e-12,
      font + " derives its exact OS/2 Win-height-to-em scale",
    );
  });
  [
    { unitsPerEm: 0, usWinAscent: 1015, usWinDescent: 242 },
    { unitsPerEm: 1000, usWinAscent: 0, usWinDescent: 0 },
    { unitsPerEm: 1000, usWinAscent: -1, usWinDescent: 242 },
  ].forEach((metrics) => {
    assertEqual(
      geometry.fontMetricScaleFromWinMetrics(metrics),
      null,
      "invalid or zero font metrics fail closed",
    );
  });
  assert(
    geometry.balancedTextWrapSupported(
      {
        supports(property, value) {
          return property === "text-wrap" && value === "balance";
        },
      },
      {},
    ),
    "balanced wrapping support is feature-detected",
  );
  assert(
    !geometry.balancedTextWrapSupported({ supports: () => false }, {}),
    "unsupported balanced wrapping is reported",
  );
  assert(
    geometry.rectanglesSpanMultipleLines([{ top: 10 }, { top: 42 }]) &&
      !geometry.rectanglesSpanMultipleLines([{ top: 10 }, { top: 10.8 }]),
    "automatic wrapping is distinguished from same-row fragments",
  );
  [
    [1280, 720],
    [1920, 1080],
    [3840, 2160],
  ].forEach(([width, height]) => {
    const point = geometry.osdPointToCss(
      { w: 1920, h: 1080, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      { width, height },
      960,
      540,
    );
    assertEqual(
      point,
      { x: width / 2, y: height / 2 },
      "OSD ratio transform at " + width + "x" + height,
    );
  });
  assertEqual(
    geometry.validateGeometry(
      { w: 0, h: 0, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      { width: 1280, height: 720 },
    ).reason,
    "missing-osd-dimensions",
    "zero OSD dimensions fail closed",
  );
  assertEqual(
    geometry.validateGeometry(
      { w: 1920, h: 1080, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      { width: 1200, height: 900 },
    ).reason,
    "non-coextensive-overlay",
    "anisotropic/non-coextensive viewports fail closed",
  );
  const validated = geometry.validateGeometry(
    { w: 1920, h: 1080, ml: 240, mr: 240, mt: 0, mb: 0, par: 1 },
    { width: 1280, height: 720 },
  );
  const calculated = geometry.calculatePlainTextLayout(validated, {
    ...TEST_FONT_METRICS,
    font: "Helvetica",
    fontSize: 48,
    scale: 1,
    scaleByWindow: true,
    scaleWithWindow: true,
    marginX: 20,
    marginY: 22,
    position: 100,
    alignX: "center",
    alignY: "bottom",
    justify: "center",
    spacing: 0,
    lineSpacing: 0,
    useMargins: true,
    bold: true,
    italic: false,
  });
  assert(calculated.ok, "pillarbox margins produce a valid layout");
  assert(
    calculated.left > 600 && calculated.maxWidth > 1200,
    "sub-use-margins permits placement across pillarbox space",
  );
  const noMarginPlacement = geometry.calculatePlainTextLayout(validated, {
    ...TEST_FONT_METRICS,
    font: "Helvetica",
    fontSize: 48,
    scale: 1,
    scaleByWindow: true,
    scaleWithWindow: true,
    marginX: 20,
    marginY: 22,
    position: 100,
    alignX: "center",
    alignY: "bottom",
    justify: "center",
    spacing: 0,
    lineSpacing: 0,
    useMargins: false,
    bold: true,
    italic: false,
  });
  assert(
    noMarginPlacement.left > 600 && noMarginPlacement.maxWidth < 960,
    "disabling sub-use-margins keeps text inside the video rectangle",
  );
  const alignmentBase = {
    ...TEST_FONT_METRICS,
    font: "Helvetica",
    fontSize: 55,
    scale: 1,
    marginX: 0,
    marginY: 0,
    position: 100,
    alignX: "center",
    alignY: "bottom",
    justify: "center",
    spacing: 0,
    lineSpacing: 0,
    useMargins: true,
    bold: true,
    italic: false,
  };
  [
    ["top", "top", 22],
    ["center", "top", 360],
    ["bottom", "bottom", 22],
  ].forEach(([alignY, property, expected]) => {
    const placement = geometry.calculatePlainTextLayout(
      geometry.validateGeometry(
        { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
        { width: 1280, height: 720 },
      ),
      Object.assign({}, alignmentBase, {
        alignY,
        position: 100,
        marginY: 22,
        scaleByWindow: true,
        scaleWithWindow: true,
      }),
    );
    assert(
      Math.abs(placement[property] - expected) < 0.001,
      "sub-pos=100 retains the natural " + alignY + " placement",
    );
  });
  [
    ["top", "top", 22],
    ["center", "top", 360],
    ["bottom", "bottom", 382],
  ].forEach(([alignY, property, expected]) => {
    const placement = geometry.calculatePlainTextLayout(
      geometry.validateGeometry(
        { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
        { width: 1280, height: 720 },
      ),
      Object.assign({}, alignmentBase, {
        alignY,
        position: 50,
        marginY: 22,
        scaleByWindow: true,
        scaleWithWindow: true,
      }),
    );
    assert(
      Math.abs(placement[property] - expected) < 0.001,
      "sub-pos=50 affects only the bottom-aligned line position: " + alignY,
    );
  });
  const independentHorizontal = geometry.calculatePlainTextLayout(
    geometry.validateGeometry(
      { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      { width: 1280, height: 720 },
    ),
    Object.assign({}, alignmentBase, {
      alignX: "right",
      justify: "left",
      marginX: 20,
      scaleByWindow: true,
      scaleWithWindow: true,
    }),
  );
  assertEqual(
    independentHorizontal.left,
    undefined,
    "right block alignment does not borrow text justification",
  );
  assertEqual(
    independentHorizontal.right,
    20,
    "sub-align-x controls block placement",
  );
  assertEqual(
    independentHorizontal.textAlign,
    "left",
    "sub-justify independently controls text inside the block",
  );
  assertEqual(
    geometry.calculatePlainTextLayout(
      geometry.validateGeometry(
        { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
        { width: 1280, height: 720 },
      ),
      Object.assign({}, alignmentBase, { alignY: "__unsupported__" }),
    ).reason,
    "unsupported-writing-mode",
    "unmirrored alignment semantics fail closed",
  );

  const scaleGeometry = geometry.validateGeometry(
    { w: 1920, h: 1080, ml: 0, mr: 0, mt: 180, mb: 180, par: 1 },
    { width: 1920, height: 1080 },
  );
  const scaleBase = {
    ...TEST_FONT_METRICS,
    font: "Helvetica",
    fontSize: 55,
    scale: 1,
    marginX: 0,
    marginY: 0,
    position: 100,
    alignX: "center",
    alignY: "bottom",
    justify: "center",
    spacing: 0,
    lineSpacing: 0,
    useMargins: true,
    bold: true,
    italic: false,
  };
  [
    [true, true, 82.5 * TEST_FONT_METRICS.fontMetricScale],
    [true, false, 55 * TEST_FONT_METRICS.fontMetricScale],
    [false, true, 55 * TEST_FONT_METRICS.fontMetricScale],
    [false, false, 55 * (720 / 1080) * TEST_FONT_METRICS.fontMetricScale],
  ].forEach(([scaleByWindow, scaleWithWindow, expected]) => {
    const result = geometry.calculatePlainTextLayout(
      scaleGeometry,
      Object.assign({}, scaleBase, {
        scaleByWindow,
        scaleWithWindow,
        marginX: 20,
        marginY: 22,
        alignX: "right",
      }),
    );
    assert(
      Math.abs(result.fontSize - expected) < 0.001,
      "mpv scale combination " +
        scaleByWindow +
        "/" +
        scaleWithWindow +
        " should produce " +
        expected,
    );
    assert(
      Math.abs(result.right - 20) < 0.001 &&
        Math.abs(result.bottom - 22) < 0.001,
      "720-reference margins stay at 20/22 fitted-video units across " +
        scaleByWindow +
        "/" +
        scaleWithWindow,
    );
  });
  [
    ["HiraginoSans-W4", 1015, 242],
    ["YuMin-Medium", 1295, 367],
    ["YuKyo-Medium", 1085, 376],
  ].forEach(([font, ascent, descent]) => {
    const metricScale = 1000 / (ascent + descent);
    const perFaceLayout = geometry.calculatePlainTextLayout(
      geometry.validateGeometry(
        { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
        { width: 1280, height: 720 },
      ),
      Object.assign({}, scaleBase, {
        resolvedPostScriptName: font,
        resolvedFamilyName: font,
        resolvedFullName: font,
        unitsPerEm: 1000,
        usWinAscent: ascent,
        usWinDescent: descent,
        fontMetricScale: metricScale,
        fontSize: 100,
        lineSpacing: 2,
        spacing: 10,
        scaleByWindow: true,
        scaleWithWindow: true,
      }),
    );
    assert(
      Math.abs(perFaceLayout.fontSize - 100 * metricScale) < 1e-9,
      font + " applies its own per-face glyph scale",
    );
    assertEqual(
      perFaceLayout.lineHeight,
      102,
      font + " keeps nominal libass line advance",
    );
    assertEqual(
      perFaceLayout.letterSpacing,
      10,
      font + " keeps post-shaping spacing outside the font coefficient",
    );
    assertEqual(
      perFaceLayout.fontFamily,
      font,
      font + " passes its resolved PostScript name to WebKit",
    );
  });
  assertEqual(
    geometry.calculatePlainTextLayout(
      geometry.validateGeometry(
        { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
        { width: 1280, height: 720 },
      ),
      Object.assign({}, scaleBase, {
        unitsPerEm: 0,
        fontMetricScale: 0,
      }),
    ).reason,
    "font-metrics-unavailable",
    "layout fails closed when resolved font tables are absent",
  );
  [
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
  ].forEach(([cssWidth, cssHeight]) => {
    const layouts = [1, 2].map((backingScale) =>
      geometry.calculatePlainTextLayout(
        geometry.validateGeometry(
          {
            w: cssWidth * backingScale,
            h: cssHeight * backingScale,
            ml: 0,
            mr: 0,
            mt: 0,
            mb: 0,
            par: 1,
          },
          { width: cssWidth, height: cssHeight },
        ),
        Object.assign({}, scaleBase, {
          scaleByWindow: true,
          scaleWithWindow: true,
          marginX: 20,
          marginY: 22,
          spacing: 1.5,
          lineSpacing: 2,
        }),
      ),
    );
    const expectedFontSize =
      55 * (cssHeight / 720) * TEST_FONT_METRICS.fontMetricScale;
    const expectedLineHeight = 57 * (cssHeight / 720);
    const expectedLetterSpacing = 1.5 * (cssHeight / 720);
    layouts.forEach((layout) => {
      assert(
        Math.abs(layout.fontSize - expectedFontSize) < 0.001,
        cssHeight + "p uses calibrated font advances",
      );
      assert(
        Math.abs(layout.lineHeight - expectedLineHeight) < 0.001,
        cssHeight + "p uses nominal font size plus configured line spacing",
      );
      assert(
        layout.lineHeight > layout.fontSize,
        cssHeight +
          "p keeps nominal baseline advance larger than calibrated glyphs",
      );
      assert(
        Math.abs(layout.letterSpacing - expectedLetterSpacing) < 0.001,
        cssHeight + "p keeps post-shaping character spacing unscaled",
      );
      assertEqual(layout.left, cssWidth / 2, cssHeight + "p remains centered");
      assertEqual(
        layout.width,
        "max-content",
        cssHeight + "p keeps shrink-wrapped shaping",
      );
      assert(
        Math.abs(layout.bottom - 22 * (cssHeight / 720)) < 0.001,
        cssHeight + "p keeps the bottom anchor unchanged",
      );
      const bottomBaseline = cssHeight - layout.bottom;
      const baselineSlots = (lineCount) =>
        Array.from(
          { length: lineCount },
          (_unused, index) =>
            bottomBaseline - (lineCount - 1 - index) * layout.lineHeight,
        );
      const oneLine = baselineSlots(1);
      const twoLines = baselineSlots(2);
      const threeLines = baselineSlots(3);
      assertEqual(
        twoLines[1],
        oneLine[0],
        cssHeight + "p keeps the bottom row fixed for two lines",
      );
      assertEqual(
        threeLines[2],
        oneLine[0],
        cssHeight + "p keeps the bottom row fixed for three lines",
      );
      assert(
        Math.abs(twoLines[1] - twoLines[0] - expectedLineHeight) < 0.001 &&
          Math.abs(threeLines[1] - threeLines[0] - expectedLineHeight) <
            0.001 &&
          Math.abs(threeLines[2] - threeLines[1] - expectedLineHeight) < 0.001,
        cssHeight +
          "p uses nominal libass baseline advance for one/two/three lines",
      );
      assert(
        threeLines[0] < twoLines[0] && twoLines[0] < oneLine[0],
        cssHeight + "p expands upper rows upward from the stable bottom anchor",
      );
    });
    const zeroLineSpacing = geometry.calculatePlainTextLayout(
      geometry.validateGeometry(
        {
          w: cssWidth,
          h: cssHeight,
          ml: 0,
          mr: 0,
          mt: 0,
          mb: 0,
          par: 1,
        },
        { width: cssWidth, height: cssHeight },
      ),
      Object.assign({}, scaleBase, {
        scaleByWindow: true,
        scaleWithWindow: true,
        marginX: 20,
        marginY: 22,
        spacing: 1.5,
        lineSpacing: 0,
      }),
    );
    assert(
      Math.abs(
        layouts[0].lineHeight -
          zeroLineSpacing.lineHeight -
          2 * (cssHeight / 720),
      ) < 0.001,
      cssHeight + "p adds configured line spacing explicitly",
    );
    assert(
      Math.abs(layouts[0].fontSize - zeroLineSpacing.fontSize) < 0.001 &&
        Math.abs(layouts[0].letterSpacing - zeroLineSpacing.letterSpacing) <
          0.001 &&
        Math.abs(layouts[0].left - zeroLineSpacing.left) < 0.001 &&
        Math.abs(layouts[0].bottom - zeroLineSpacing.bottom) < 0.001,
      cssHeight +
        "p line spacing does not alter horizontal metrics or placement",
    );
    assert(
      Math.abs(layouts[0].fontSize - layouts[1].fontSize) < 0.001 &&
        Math.abs(layouts[0].lineHeight - layouts[1].lineHeight) < 0.001 &&
        Math.abs(layouts[0].letterSpacing - layouts[1].letterSpacing) < 0.001 &&
        Math.abs(layouts[0].left - layouts[1].left) < 0.001 &&
        Math.abs(layouts[0].maxWidth - layouts[1].maxWidth) < 0.001,
      cssHeight + "p applies no extra 2x DPR/HiDPI multiplier",
    );
  });

  const bootstrapRegistrations = [];
  const bootstrapHandlers = Object.create(null);
  const scheduledRebuilds = [];
  const propertyChangeOrder = [];
  let bootstrapFontMetricGeneration = 0;
  const bootstrapContext = {
    console,
    JSON,
    enabled: true,
    lastSubtitle: null,
    lastSubtitleCueIdentity: null,
    lastNativeLayoutFingerprint: "",
    nativeLayoutStablePolls: 0,
    nativeSubtitlePropertyRebuildTimer: null,
    nativeSubtitlePlaybackActive: false,
    nativeSubVisibilityBeforeEnable: null,
    nativeSubtitleVisibilityOwned: false,
    registerShortcut() {},
    rebuildMenu() {},
    scheduleIINAAppearanceHintRefresh() {},
    prepareNativeSubtitlePrivateCueDirectory() {
      return Promise.resolve();
    },
    advanceNativeSubtitleFontMetricGeneration() {
      bootstrapFontMetricGeneration++;
    },
    debugWarn() {},
    postToOverlay(name) {
      if (name === "native-layout-invalidate")
        propertyChangeOrder.push("invalidate");
    },
    experimentalNativeSubtitleMode() {
      return true;
    },
    pollSubtitle() {
      propertyChangeOrder.push("poll");
    },
    setTimeout(callback) {
      scheduledRebuilds.push(callback);
      return scheduledRebuilds.length;
    },
    clearTimeout() {},
    mpv: {},
    event: {
      on(name, callback) {
        bootstrapRegistrations.push(name);
        bootstrapHandlers[name] = callback;
      },
    },
    core: { window: { loaded: false } },
    prefBool(_name, fallback) {
      return fallback;
    },
  };
  vm.createContext(bootstrapContext);
  vm.runInContext(
    fs.readFileSync(path.join(root, "src/main/99_bootstrap.js"), "utf8"),
    bootstrapContext,
  );
  assert(
    bootstrapRegistrations.includes("iina.window-fs.changed"),
    "actual IINA fullscreen event is registered",
  );
  assert(
    bootstrapRegistrations.includes("iina.window-screen.changed"),
    "actual IINA display-change event is registered",
  );
  [
    "sub-text",
    "sub-text-ass",
    "sub-start",
    "sub-end",
    "osd-dimensions",
    "track-list",
    "sid",
    "secondary-sid",
    "options/sub-font-size",
    "options/sub-font",
    "sub-font",
    "options/sub-pos",
  ].forEach((property) => {
    assert(
      typeof bootstrapHandlers["mpv." + property + ".changed"] === "function",
      "IINA mpv property-change events are registered: " + property,
    );
  });
  bootstrapHandlers["mpv.sub-text.changed"]();
  assertEqual(
    propertyChangeOrder,
    ["invalidate"],
    "property changes clear stale geometry before the scheduled poll",
  );
  scheduledRebuilds.shift()();
  assertEqual(
    propertyChangeOrder,
    ["invalidate", "poll"],
    "property changes rebuild after immediate invalidation",
  );
  propertyChangeOrder.length = 0;
  bootstrapHandlers["mpv.sub-start.changed"]();
  assertEqual(
    propertyChangeOrder,
    ["invalidate"],
    "a repeated-text cue boundary clears prior targets immediately",
  );
  scheduledRebuilds.shift()();
  assertEqual(
    propertyChangeOrder,
    ["invalidate", "poll"],
    "cue-boundary changes rebuild after their immediate clear",
  );
  propertyChangeOrder.length = 0;
  bootstrapHandlers["mpv.sub-font.changed"]();
  assertEqual(
    bootstrapFontMetricGeneration,
    1,
    "live font changes advance the async metric generation",
  );
  assertEqual(
    propertyChangeOrder,
    ["invalidate"],
    "font changes clear stale geometry before metric resolution",
  );
  scheduledRebuilds.shift()();
  propertyChangeOrder.length = 0;
  bootstrapHandlers["mpv.sub-font-size.changed"]();
  assertEqual(
    bootstrapFontMetricGeneration,
    2,
    "font-size changes also guard pending metric completions",
  );
  scheduledRebuilds.shift()();

  const rectCalls = [];
  const loaded = loadOverlayForTest(
    [
      "state",
      "renderSubtitle",
      "invalidateNativeSubtitleHitLayer",
      "renderNativeSubtitleHitLayer",
    ],
    {
      devicePixelRatio: 2,
      rangeRects(start, end) {
        rectCalls.push({ start, end });
        return [
          {
            left: 200,
            top: 520,
            right: 240,
            bottom: 548,
            width: 40,
            height: 28,
          },
          {
            left: 180,
            top: 552,
            right: 220,
            bottom: 580,
            width: 40,
            height: 28,
          },
        ];
      },
    },
  );
  assertEqual(
    loaded.context.document.getElementById("native-subtitle-layer-host"),
    null,
    "legacy startup creates no experimental DOM",
  );
  loaded.context.document.body.style.opacity = "0.83";
  loaded.context.document.documentElement.style.color = "red";
  loaded.context.__elements.popup.style.opacity = "0.77";
  loaded.context.__elements.popup.style.transform = "translateX(3px)";
  const popupStyleBeforeNativeLayer = JSON.stringify(
    loaded.context.__elements.popup.style,
  );
  loaded.context.__handlers.enabled({ enabled: true });
  const nativeLayerPayload = {
    text: "hello",
    displayText: "hello",
    lineId: 7,
    nativeLookupSpans: [
      { startUtf16: 0, endUtf16: 1 },
      { startUtf16: 1, endUtf16: 2 },
      { startUtf16: 2, endUtf16: 3 },
      { startUtf16: 3, endUtf16: 4 },
      { startUtf16: 4, endUtf16: 5 },
    ],
    nativeLayout: {
      osd: {
        w: 1920,
        h: 1080,
        ml: 0,
        mr: 0,
        mt: 0,
        mb: 0,
        par: 1,
      },
      options: {
        ...TEST_FONT_METRICS,
        font: "Helvetica",
        effectiveFont: "Helvetica",
        runtimeFont: "Helvetica",
        optionFont: "YuMin-Medium",
        fontSize: 48,
        scale: 1,
        scaleByWindow: true,
        scaleWithWindow: true,
        marginX: 20,
        marginY: 22,
        position: 100,
        alignX: "center",
        alignY: "bottom",
        justify: "center",
        spacing: 0,
        lineSpacing: 0,
        useMargins: true,
        bold: true,
        italic: false,
      },
    },
    config: {
      experimentalNativeSubtitleHitLayer: true,
      experimentalNativeSubtitleHitBoxes: true,
      experimentalNativeSubtitleTextOpacity: 0.4,
      debugLogEnabled: true,
      language: {
        id: "en",
        lookupUnit: "word",
        wordMode: "latin-word",
      },
    },
  };
  loaded.context.__handlers.subtitle(nativeLayerPayload);
  await waitForLayout();
  const hitRoot = loaded.context.document.getElementById(
    "native-subtitle-hit-boxes",
  );
  const host = loaded.context.document.getElementById(
    "native-subtitle-layer-host",
  );
  assert(host, "experimental mode dynamically creates its isolated DOM");
  assert(
    host.shadowRoot,
    "copied measurement text uses an attached shadow root",
  );
  const copy = host.shadowRoot.getElementById("native-subtitle-copy");
  assert(copy, "the continuous copied-text flow lives inside Shadow DOM");
  assertEqual(
    loaded.context.document.getElementById("native-subtitle-copy"),
    null,
    "global document selectors cannot reach the shadow copied-text flow",
  );
  assertEqual(
    loaded.context.document.body.style.opacity,
    "0.83",
    "experimental mode does not mutate unrelated body styles",
  );
  assertEqual(
    loaded.context.document.documentElement.style.color,
    "red",
    "experimental mode does not mutate unrelated root styles",
  );
  assert(
    host.parentNode === loaded.context.document.body,
    "the isolated host shares the popup body stacking context",
  );
  assertEqual(
    copy.style.width,
    "max-content",
    "copied flow shrink-wraps independently of text justification",
  );
  assertEqual(
    copy.style["max-width"],
    "1240px",
    "copied flow retains the bounded subtitle wrapping width",
  );
  assertEqual(
    copy.style["writing-mode"],
    "horizontal-tb",
    "copied flow locks horizontal writing mode",
  );
  assertEqual(
    {
      textWrap: copy.style["text-wrap"],
      textWrapStyle: copy.style["text-wrap-style"],
    },
    { textWrap: "balance", textWrapStyle: "balance" },
    "copied subtitle flow requests balanced wrapping when WebKit supports it",
  );
  assertEqual(
    copy.style["box-sizing"],
    "content-box",
    "copied flow locks box sizing",
  );
  assertEqual(host.style.transform, "none", "layer host cannot be transformed");
  assertEqual(copy.style.opacity, "0.4", "debug opacity affects copied text");
  assertEqual(
    JSON.stringify(loaded.context.__elements.popup.style),
    popupStyleBeforeNativeLayer,
    "experimental geometry isolation does not mutate popup inline styles",
  );
  assertEqual(
    hitRoot.style.opacity,
    "1",
    "debug opacity does not affect the hit-box layer",
  );
  const acceptedLayoutDiagnostics = loaded.context.__posted.filter(
    (message) =>
      message.name === "native-layout-diagnostic" &&
      message.payload.reason === "accepted-layout",
  );
  assertEqual(
    acceptedLayoutDiagnostics.length,
    1,
    "accepted layout diagnostics are emitted when diagnostics are enabled",
  );
  const acceptedLayoutDiagnostic = acceptedLayoutDiagnostics[0].payload;
  assert(
    Math.abs(
      acceptedLayoutDiagnostic.layoutMetrics.fontSize -
        48 * TEST_FONT_METRICS.fontMetricScale,
    ) < 0.001 &&
      Math.abs(acceptedLayoutDiagnostic.layoutMetrics.lineHeight - 48) < 0.001,
    "accepted diagnostics separate calibrated glyph size from nominal line advance",
  );
  assertEqual(
    acceptedLayoutDiagnostic.layoutMetrics.fontFamily,
    "Helvetica",
    "accepted diagnostics include the measured font family",
  );
  assertEqual(
    acceptedLayoutDiagnostic.fontState,
    {
      effectiveFont: "Helvetica",
      runtimeFont: "Helvetica",
      optionFont: "YuMin-Medium",
      resolvedPostScriptName: "Helvetica",
      resolvedFamilyName: "Helvetica",
      resolvedFullName: "Helvetica",
      fontVersion: "test",
      fontMetricScale: TEST_FONT_METRICS.fontMetricScale,
      fontMetricSource: "coretext-libass-os2-win-v2",
      fontMetricResolverVersion: 2,
      libassProviderVerified: true,
      resolvedFontFormat: 1,
      resolvedBold: false,
      resolvedItalic: false,
      syntheticBold: false,
      syntheticItalic: false,
    },
    "accepted diagnostics distinguish effective, runtime, and option fonts",
  );
  assertEqual(
    acceptedLayoutDiagnostic.ratios,
    { scaleX: 2 / 3, scaleY: 2 / 3 },
    "accepted diagnostics include OSD-to-viewport ratios",
  );
  assertEqual(
    {
      dpr: acceptedLayoutDiagnostic.dpr,
      hidpiScale: acceptedLayoutDiagnostic.hidpiScale,
    },
    { dpr: 2, hidpiScale: 0 },
    "DPR and HiDPI are diagnostic-only values",
  );
  assert(
    !Object.prototype.hasOwnProperty.call(acceptedLayoutDiagnostic, "text") &&
      !Object.prototype.hasOwnProperty.call(
        acceptedLayoutDiagnostic,
        "displayText",
      ) &&
      !Object.prototype.hasOwnProperty.call(
        acceptedLayoutDiagnostic,
        "lookupText",
      ),
    "accepted diagnostics do not expose caption text",
  );
  loaded.context.__handlers.subtitle(nativeLayerPayload);
  await waitForLayout();
  assertEqual(
    loaded.context.__posted.filter(
      (message) =>
        message.name === "native-layout-diagnostic" &&
        message.payload.reason === "accepted-layout",
    ).length,
    1,
    "identical accepted layout diagnostics are deduplicated",
  );
  assertEqual(
    hitRoot.children.length,
    2,
    "one wrapped lookup unit yields two boxes",
  );
  hitRoot.children.forEach((box) => {
    assertEqual(
      box.getAttribute("data-clickable"),
      "true",
      "the actual measured rectangle is clickable",
    );
    assertEqual(
      box.dataset.pos,
      "0",
      "wrapped boxes keep canonical lookup position",
    );
    assertEqual(
      box.style.all,
      "initial",
      "actual clickable rectangles reset hostile inherited flow styles",
    );
    assertEqual(
      box.style["pointer-events"],
      "auto",
      "the topmost measured rectangle remains pointer-active",
    );
    assertEqual(
      box.children.length,
      0,
      "light-DOM hit rectangles contain no decorative children",
    );
    assertEqual(
      box.textContent,
      "",
      "light-DOM hit rectangles contain no text",
    );
  });
  assert(
    loaded.context.document.elementFromPoint(205, 525) === hitRoot.children[0],
    "elementFromPoint resolves directly to the empty clickable rectangle",
  );
  assertEqual(
    rectCalls[0],
    { start: 0, end: 5 },
    "DOM Range receives UTF-16 bounds",
  );
  hitRoot.children[1].listeners.mouseenter({
    currentTarget: hitRoot.children[1],
  });
  assert(
    !loaded.context.__elements.popup.classList.contains("hidden"),
    "hovering a synthetic rectangle uses existing popup behavior",
  );
  assert(
    loaded.overlay.state.currentAnchor === hitRoot.children[1],
    "popup anchors to the selected wrapped rectangle",
  );
  loaded.context.__elements.popup._rect = {
    left: 198,
    top: 518,
    right: 260,
    bottom: 560,
    width: 62,
    height: 42,
  };
  assert(
    loaded.context.document.elementFromPoint(205, 525) ===
      loaded.context.__elements.popup,
    "popup stacking wins elementFromPoint when it overlaps a hit rectangle",
  );
  loaded.context.__handlers["native-layout-invalidate"]({ reason: "seek" });
  assert(
    loaded.context.__elements.popup.classList.contains("hidden"),
    "geometry invalidation immediately hides a stale popup",
  );
  assertEqual(
    loaded.overlay.state.currentAnchor,
    null,
    "stale anchor is cleared",
  );
  assertEqual(hitRoot.children.length, 0, "stale hit boxes are removed");
  loaded.context.__handlers.enabled({ enabled: false });
  assertEqual(
    loaded.context.document.getElementById("native-subtitle-layer-host"),
    null,
    "disabling the mode destroys all experimental DOM",
  );
  assertEqual(
    loaded.context.document.getElementById("native-subtitle-hit-boxes"),
    null,
    "disabling the mode also destroys the separate light-DOM hit layer",
  );
  assertEqual(
    loaded.context.document.body.style.opacity,
    "0.83",
    "destroying the layer leaves body inline styles untouched",
  );
  assertEqual(
    loaded.context.document.documentElement.style.color,
    "red",
    "destroying the layer leaves root inline styles untouched",
  );

  const postScriptFonts = [
    "YuMin-Medium",
    "YuKyo-Medium",
    "HiraginoSans-W4",
    "YuMin-Medium",
  ];
  const postScriptOverlay = loadOverlayForTest(["state"], {
    localFonts: postScriptFonts,
    fontDetect: false,
  });
  postScriptOverlay.context.__handlers.enabled({ enabled: true });
  const postScriptMetricTables = {
    "YuMin-Medium": [1295, 367],
    "YuKyo-Medium": [1085, 376],
    "HiraginoSans-W4": [1015, 242],
  };
  const japaneseFontPayload = (font) => {
    const [usWinAscent, usWinDescent] = postScriptMetricTables[font];
    return {
      text: "日本語",
      displayText: "日本語",
      lineId: 31,
      nativeLookupSpans: [
        { startUtf16: 0, endUtf16: 1 },
        { startUtf16: 1, endUtf16: 2 },
        { startUtf16: 2, endUtf16: 3 },
      ],
      nativeLayout: {
        osd: { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
        options: Object.assign({}, nativeLayerPayload.nativeLayout.options, {
          font,
          effectiveFont: font,
          runtimeFont: font,
          optionFont: "YuMin-Medium",
          resolvedPostScriptName: font,
          resolvedFamilyName: font,
          resolvedFullName: font,
          fontVersion: "test-" + font,
          unitsPerEm: 1000,
          usWinAscent,
          usWinDescent,
          fontMetricScale: 1000 / (usWinAscent + usWinDescent),
        }),
      },
      config: Object.assign({}, nativeLayerPayload.config, {
        language: {
          id: "ja",
          lookupUnit: "character",
          wordMode: "rightward-prefix",
        },
      }),
    };
  };
  const postScriptCopyNodes = [];
  for (const font of postScriptFonts) {
    postScriptOverlay.context.__handlers.subtitle(japaneseFontPayload(font));
    await waitForLayout();
    const fontHost = postScriptOverlay.context.document.getElementById(
      "native-subtitle-layer-host",
    );
    const fontCopy = fontHost.shadowRoot.getElementById("native-subtitle-copy");
    postScriptCopyNodes.push(fontCopy);
    assert(
      /^"iinatan-native-subtitle-font-\d+"$/.test(
        fontCopy.style["font-family"],
      ),
      font + " is measured through a loaded local PostScript-font alias",
    );
    const [ascent, descent] = postScriptMetricTables[font];
    assert(
      Math.abs(
        Number.parseFloat(fontCopy.style["font-size"]) -
          48 * (1000 / (ascent + descent)),
      ) < 0.001,
      font + " applies its resolved per-face CSS font size",
    );
    assertEqual(
      fontCopy.style["line-height"],
      "48px",
      font + " keeps the nominal libass line height",
    );
    assert(
      postScriptOverlay.context.document.getElementById(
        "native-subtitle-hit-boxes",
      ).children.length > 0,
      font + " produces Japanese lookup boxes instead of a fallback failure",
    );
  }
  for (let index = 1; index < postScriptCopyNodes.length; index++) {
    assert(
      postScriptCopyNodes[index] !== postScriptCopyNodes[index - 1],
      "each live font transition recreates the copied measurement node",
    );
  }
  assert(
    postScriptCopyNodes[0] !==
      postScriptCopyNodes[postScriptCopyNodes.length - 1],
    "an unchanged cue still receives a fresh node after A-to-B-to-A font changes",
  );

  const pendingLocalFontLoads = [];
  const staleLocalFonts = loadOverlayForTest(["state"], {
    localFonts: ["YuMin-Medium", "YuKyo-Medium"],
    localFontLoad(family, face) {
      if (pendingLocalFontLoads.length < 2)
        return new Promise((resolve) => {
          pendingLocalFontLoads.push({
            family,
            resolve: () => resolve(face),
          });
        });
      return Promise.resolve(face);
    },
  });
  staleLocalFonts.context.__handlers.enabled({ enabled: true });
  staleLocalFonts.context.__handlers.subtitle(
    japaneseFontPayload("YuMin-Medium"),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const staleFontHost = staleLocalFonts.context.document.getElementById(
    "native-subtitle-layer-host",
  );
  const staleFontCopyA = staleFontHost.shadowRoot.getElementById(
    "native-subtitle-copy",
  );
  staleLocalFonts.context.__handlers.subtitle(
    japaneseFontPayload("YuKyo-Medium"),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const staleFontCopyB = staleFontHost.shadowRoot.getElementById(
    "native-subtitle-copy",
  );
  staleLocalFonts.context.__handlers.subtitle(
    japaneseFontPayload("YuMin-Medium"),
  );
  await waitForLayout();
  const currentLocalFontCopy = staleFontHost.shadowRoot.getElementById(
    "native-subtitle-copy",
  );
  const currentLocalFontHits = staleLocalFonts.context.document.getElementById(
    "native-subtitle-hit-boxes",
  );
  assert(
    staleFontCopyA !== staleFontCopyB &&
      staleFontCopyB !== currentLocalFontCopy &&
      staleFontCopyA !== currentLocalFontCopy,
    "pending A-to-B-to-A font generations use distinct measurement nodes",
  );
  assert(
    currentLocalFontHits.children.length > 0,
    "the current A generation measures before stale font loads finish",
  );
  pendingLocalFontLoads.forEach((load) => load.resolve());
  await waitForLayout();
  assert(
    staleFontHost.shadowRoot.getElementById("native-subtitle-copy") ===
      currentLocalFontCopy,
    "stale A and B font completions cannot replace the current A node",
  );
  assertEqual(
    currentLocalFontCopy.textContent,
    "日本語",
    "stale font completions cannot restore prior copied content",
  );
  assert(
    currentLocalFontHits.children.length > 0,
    "stale font completions cannot clear current Japanese hit boxes",
  );

  const balancedWrap = loadOverlayForTest(["state"], {
    balanceWrapSupported: true,
    rangeRects(start, end) {
      if (end - start > 5)
        return [
          {
            left: 180,
            top: 430,
            right: 350,
            bottom: 470,
            width: 170,
            height: 40,
          },
          {
            left: 210,
            top: 475,
            right: 340,
            bottom: 515,
            width: 130,
            height: 40,
          },
        ];
      return [
        {
          left: 180 + start * 5,
          top: 380,
          right: 220 + end * 5,
          bottom: 420,
          width: 40,
          height: 40,
        },
      ];
    },
  });
  balancedWrap.context.__handlers.enabled({ enabled: true });
  const size120Text = "alpha\nabcdefghijklm";
  const size120Payload = {
    text: size120Text,
    displayText: size120Text,
    lineId: 32,
    nativeLookupSpans: Array.from(size120Text, (_character, index) => ({
      startUtf16: index,
      endUtf16: index + 1,
    })),
    nativeLayout: {
      osd: { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      options: Object.assign({}, nativeLayerPayload.nativeLayout.options, {
        font: "Helvetica",
        effectiveFont: "Helvetica",
        runtimeFont: "Helvetica",
        optionFont: "Helvetica",
        resolvedPostScriptName: "Helvetica",
        resolvedFamilyName: "Helvetica",
        resolvedFullName: "Helvetica",
        fontSize: 120,
      }),
    },
    config: Object.assign({}, nativeLayerPayload.config),
  };
  balancedWrap.context.__handlers.subtitle(size120Payload);
  await waitForLayout();
  const size120Host = balancedWrap.context.document.getElementById(
    "native-subtitle-layer-host",
  );
  const size120Copy = size120Host.shadowRoot.getElementById(
    "native-subtitle-copy",
  );
  assertEqual(
    size120Copy.textContent,
    size120Text,
    "balanced wrapping preserves authored hard line breaks",
  );
  assertEqual(
    size120Copy.style["text-wrap"],
    "balance",
    "font-size 120 cues use the balanced-wrap contract",
  );
  assert(
    balancedWrap.context.document.getElementById("native-subtitle-hit-boxes")
      .children.length > 0,
    "balanced automatic wrapping at font-size 120 still produces hit boxes",
  );

  const unsupportedWrap = loadOverlayForTest(["state"], {
    balanceWrapSupported: false,
    rangeRects() {
      return [
        {
          left: 100,
          top: 400,
          right: 300,
          bottom: 440,
          width: 200,
          height: 40,
        },
        {
          left: 100,
          top: 450,
          right: 260,
          bottom: 490,
          width: 160,
          height: 40,
        },
      ];
    },
  });
  unsupportedWrap.context.__handlers.enabled({ enabled: true });
  unsupportedWrap.context.__handlers.subtitle(
    Object.assign({}, size120Payload, {
      text: "automatically wrapped",
      displayText: "automatically wrapped",
      lineId: 33,
      nativeLookupSpans: Array.from(
        "automatically wrapped",
        (_character, index) => ({
          startUtf16: index,
          endUtf16: index + 1,
        }),
      ),
    }),
  );
  await waitForLayout();
  assertEqual(
    unsupportedWrap.context.document.getElementById("native-subtitle-hit-boxes")
      .children.length,
    0,
    "automatic wrapping fails closed when balanced wrapping is unavailable",
  );
  const unsupportedWrapDiagnostic = unsupportedWrap.context.__posted.find(
    (message) =>
      message.name === "native-layout-diagnostic" &&
      message.payload.reason === "unsupported-writing-mode",
  );
  assert(
    unsupportedWrapDiagnostic,
    "unsupported automatic wrapping emits a fail-closed diagnostic",
  );
  assertEqual(
    unsupportedWrapDiagnostic.payload.fontState,
    {
      effectiveFont: "Helvetica",
      runtimeFont: "Helvetica",
      optionFont: "Helvetica",
      resolvedPostScriptName: "Helvetica",
      resolvedFamilyName: "Helvetica",
      resolvedFullName: "Helvetica",
      fontVersion: "test",
      fontMetricScale: TEST_FONT_METRICS.fontMetricScale,
      fontMetricSource: "coretext-libass-os2-win-v2",
      fontMetricResolverVersion: 2,
      libassProviderVerified: true,
      resolvedFontFormat: 1,
      resolvedBold: false,
      resolvedItalic: false,
      syntheticBold: false,
      syntheticItalic: false,
    },
    "failure diagnostics retain font state without caption text",
  );
  assert(
    !Object.prototype.hasOwnProperty.call(
      unsupportedWrapDiagnostic.payload,
      "text",
    ) &&
      !Object.prototype.hasOwnProperty.call(
        unsupportedWrapDiagnostic.payload,
        "displayText",
      ),
    "failure diagnostics do not expose caption text",
  );

  const overlayCssSource = fs.readFileSync(
    path.join(root, "src/overlay/overlay.css"),
    "utf8",
  );
  assert(
    overlayCssSource.includes(".native-subtitle-hit-box::before") &&
      overlayCssSource.includes(".native-subtitle-hit-box::after") &&
      overlayCssSource.includes(".native-subtitle-hit-box::first-letter") &&
      overlayCssSource.includes(".native-subtitle-hit-box::first-line"),
    "hit-box pseudo-elements are suppressed from topmost hit testing",
  );
  assert(
    /#root\s*\{[^}]*z-index:\s*10;/s.test(overlayCssSource) &&
      /#popup\s*\{[^}]*z-index:\s*20;/s.test(overlayCssSource) &&
      host.style["z-index"] === "2",
    "the popup stacking order remains above the body-level hit-layer host",
  );

  const hostileGeometryCases = [
    {
      label: "body transform",
      apply(context) {
        context.document.body.style.transform = "scale(.5)";
      },
    },
    {
      label: "root containment",
      apply(context) {
        context.document.documentElement.style.contain = "layout";
      },
    },
    {
      label: "root direction",
      apply(context) {
        context.document.documentElement.style.direction = "rtl";
      },
    },
    {
      label: "unsafe popup stacking",
      apply(context) {
        context.document.getElementById("root").style.zIndex = "1";
      },
    },
    {
      label: "missing computed-style API",
      apply(context) {
        delete context.window.getComputedStyle;
      },
    },
  ];
  for (const hostileCase of hostileGeometryCases) {
    const hostile = loadOverlayForTest(["state"]);
    hostile.context.__handlers.config(nativeLayerPayload.config);
    hostileCase.apply(hostile.context);
    const bodyStyleBefore = JSON.stringify(hostile.context.document.body.style);
    const rootStyleBefore = JSON.stringify(
      hostile.context.document.documentElement.style,
    );
    const overlayRootStyleBefore = JSON.stringify(
      hostile.context.document.getElementById("root").style,
    );
    hostile.context.__handlers.enabled({ enabled: true });
    hostile.context.__handlers.subtitle(
      Object.assign({}, nativeLayerPayload, { config: null }),
    );
    await waitForLayout();
    assertEqual(
      hostile.context.document.getElementById("native-subtitle-layer-host"),
      null,
      hostileCase.label + " fails closed before creating targets",
    );
    assertEqual(
      JSON.stringify(hostile.context.document.body.style),
      bodyStyleBefore,
      hostileCase.label + " does not mutate body styles",
    );
    assertEqual(
      JSON.stringify(hostile.context.document.documentElement.style),
      rootStyleBefore,
      hostileCase.label + " does not mutate root styles",
    );
    assertEqual(
      JSON.stringify(hostile.context.document.getElementById("root").style),
      overlayRootStyleBefore,
      hostileCase.label + " does not mutate overlay-root styles",
    );
    assert(
      hostile.context.__posted.some(
        (message) =>
          message.name === "native-layout-diagnostic" &&
          message.payload.reason === "non-coextensive-overlay",
      ),
      hostileCase.label + " reports non-coextensive-overlay",
    );
  }

  const missingFont = loadOverlayForTest(["state"], {
    fontCheck: true,
    fontDetect: false,
  });
  missingFont.context.__handlers.enabled({ enabled: true });
  missingFont.context.__handlers.subtitle({
    text: "test",
    displayText: "test",
    lineId: 9,
    nativeLookupSpans: [
      { startUtf16: 0, endUtf16: 1 },
      { startUtf16: 1, endUtf16: 2 },
      { startUtf16: 2, endUtf16: 3 },
      { startUtf16: 3, endUtf16: 4 },
    ],
    nativeLayout: {
      osd: { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      options: Object.assign({}, scaleBase, {
        font: "Definitely Missing Font",
        effectiveFont: "Definitely Missing Font",
        resolvedPostScriptName: "DefinitelyMissingFont",
        resolvedFamilyName: "Definitely Missing Font",
        resolvedFullName: "Definitely Missing Font",
        fontSize: 55,
        videoHeight: 720,
      }),
    },
    config: {
      experimentalNativeSubtitleHitLayer: true,
      language: { id: "en", lookupUnit: "word", wordMode: "latin-word" },
    },
  });
  await waitForLayout();
  assertEqual(
    missingFont.context.document.getElementById("native-subtitle-hit-boxes")
      .children.length,
    0,
    "font fallback lookalikes fail closed even when FontFaceSet.check succeeds",
  );

  const noFontFaceSet = loadOverlayForTest(["state"], {
    fontsUnavailable: true,
  });
  noFontFaceSet.context.__handlers.enabled({ enabled: true });
  noFontFaceSet.context.__handlers.subtitle({
    text: "test",
    displayText: "test",
    lineId: 10,
    nativeLookupSpans: [
      { startUtf16: 0, endUtf16: 1 },
      { startUtf16: 1, endUtf16: 2 },
      { startUtf16: 2, endUtf16: 3 },
      { startUtf16: 3, endUtf16: 4 },
    ],
    nativeLayout: {
      osd: { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      options: Object.assign({}, scaleBase, {
        font: "Helvetica",
        fontSize: 55,
      }),
    },
    config: {
      experimentalNativeSubtitleHitLayer: true,
      language: { id: "en", lookupUnit: "word", wordMode: "latin-word" },
    },
  });
  await waitForLayout();
  assertEqual(
    noFontFaceSet.context.document.getElementById("native-subtitle-hit-boxes")
      .children.length,
    0,
    "missing FontFaceSet support fails closed",
  );
  assert(
    noFontFaceSet.context.__posted.some(
      (message) =>
        message.name === "native-layout-diagnostic" &&
        message.payload.reason === "font-unavailable",
    ),
    "missing FontFaceSet reports font-unavailable",
  );

  let rejectFirstFontLoad;
  let fontLoadCount = 0;
  const staleFontFailure = loadOverlayForTest(["state"], {
    fontLoad() {
      fontLoadCount++;
      if (fontLoadCount === 1)
        return new Promise((_resolve, reject) => {
          rejectFirstFontLoad = reject;
        });
      return Promise.resolve([{}]);
    },
  });
  const fontCuePayload = (text, lineId) => ({
    text,
    displayText: text,
    lineId,
    nativeLookupSpans: Array.from(text, (_character, index) => ({
      startUtf16: index,
      endUtf16: index + 1,
    })),
    nativeLayout: {
      osd: { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      options: Object.assign({}, scaleBase, {
        font: "Helvetica",
        fontSize: 55,
      }),
    },
    config: {
      experimentalNativeSubtitleHitLayer: true,
      language: { id: "en", lookupUnit: "word", wordMode: "latin-word" },
    },
  });
  staleFontFailure.context.__handlers.enabled({ enabled: true });
  staleFontFailure.context.__handlers.subtitle(fontCuePayload("first", 21));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(
    typeof rejectFirstFontLoad === "function",
    "cue A reaches its asynchronous font load",
  );
  staleFontFailure.context.__handlers.subtitle(fontCuePayload("second", 22));
  await waitForLayout();
  const currentFontHost = staleFontFailure.context.document.getElementById(
    "native-subtitle-layer-host",
  );
  const currentFontHits = staleFontFailure.context.document.getElementById(
    "native-subtitle-hit-boxes",
  );
  assertEqual(
    currentFontHost.shadowRoot.getElementById("native-subtitle-copy")
      .textContent,
    "second",
    "cue B replaces cue A in the shadow measurement flow",
  );
  assertEqual(
    currentFontHits.children.length,
    1,
    "cue B creates its current hit target before cue A fails",
  );
  const fontFailureDiagnosticsBefore = staleFontFailure.context.__posted.filter(
    (message) =>
      message.name === "native-layout-diagnostic" &&
      message.payload.reason === "font-unavailable",
  ).length;
  rejectFirstFontLoad(new Error("stale cue A font failure"));
  await waitForLayout();
  assertEqual(
    staleFontFailure.overlay.state.lineId,
    22,
    "stale cue A font failure leaves cue B current",
  );
  assertEqual(
    currentFontHits.children.length,
    1,
    "stale cue A font failure cannot clear cue B targets",
  );
  assert(
    !staleFontFailure.context.__posted.some(
      (message) =>
        message.name === "native-layout-diagnostic" &&
        message.payload.reason === "accepted-layout",
    ),
    "accepted layout diagnostics stay off when diagnostics are disabled",
  );
  assertEqual(
    staleFontFailure.context.__posted.filter(
      (message) =>
        message.name === "native-layout-diagnostic" &&
        message.payload.reason === "font-unavailable",
    ).length,
    fontFailureDiagnosticsBefore,
    "stale cue A font failure emits no current-cue diagnostic",
  );

  let releaseFonts;
  const delayedFonts = new Promise((resolve) => {
    releaseFonts = resolve;
  });
  const stale = loadOverlayForTest(["state"], {
    fontsReady: delayedFonts,
  });
  stale.context.__handlers.enabled({ enabled: true });
  stale.context.__handlers.subtitle({
    text: "猫",
    displayText: "猫",
    lineId: 1,
    nativeLookupSpans: [{ startUtf16: 0, endUtf16: 1 }],
    nativeLayout: {
      osd: { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
      options: {
        ...TEST_FONT_METRICS,
        font: "Helvetica",
        fontSize: 55,
        scale: 1,
        scaleByWindow: true,
        scaleWithWindow: true,
        marginX: 20,
        marginY: 22,
        position: 100,
        alignX: "center",
        alignY: "bottom",
        justify: "center",
        spacing: 0,
        lineSpacing: 0,
        useMargins: true,
        bold: true,
        italic: false,
      },
    },
    config: {
      experimentalNativeSubtitleHitLayer: true,
      language: {
        id: "ja",
        lookupUnit: "character",
        wordMode: "rightward-prefix",
      },
    },
  });
  stale.context.__handlers["native-layout-invalidate"]({ reason: "seek" });
  releaseFonts();
  await waitForLayout();
  assertEqual(
    stale.context.document.getElementById("native-subtitle-hit-boxes").children
      .length,
    0,
    "stale async font/layout completion cannot repopulate boxes",
  );

  console.log("experimental native subtitle hit layer tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
