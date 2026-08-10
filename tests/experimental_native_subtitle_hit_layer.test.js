const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  assert,
  loadOverlayForTest,
  lookupCharacterPolicies,
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
const LATIN_LOOKUP_CHARACTER_POLICY = lookupCharacterPolicies.latinWord;
const JAPANESE_LOOKUP_CHARACTER_POLICY = lookupCharacterPolicies.japanese;
const CHINESE_LOOKUP_CHARACTER_POLICY = lookupCharacterPolicies.chinese;
const KOREAN_LOOKUP_CHARACTER_POLICY = lookupCharacterPolicies.korean;

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
  const fontMetricLogs = [];
  const privateFiles = Object.assign(
    Object.create(null),
    values.__privateFiles || {},
  );
  const execEvents = [];
  const geometryRequests = [];
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
    Date: values.__clock
      ? {
          now() {
            return Number(values.__clock.now) || 0;
          },
        }
      : Date,
    nativeSubtitleFontMetricCache: Object.create(null),
    nativeSubtitleFontMetricInFlight: Object.create(null),
    nativeSubtitleFontMetricGeneration: 0,
    nativeSubtitleFontMetricActiveKey: "",
    nativeAssGeometryCache: Object.create(null),
    nativeAssGeometryInFlight: Object.create(null),
    nativeAssGeometryFailures: Object.create(null),
    nativeAssGeometryGeneration: 0,
    nativeAssGeometryActiveKey: "",
    nativeBitmapOcrCache: Object.create(null),
    nativeBitmapOcrInFlight: Object.create(null),
    nativeBitmapOcrFailures: Object.create(null),
    nativeBitmapOcrIntents: Object.create(null),
    nativeBitmapOcrGeneration: 0,
    nativeBitmapOcrNoticeShown: false,
    nativeBitmapOcrIntentAt: Number.NEGATIVE_INFINITY,
    nativeBitmapOcrMouseIntentSerial: 0,
    nativeBitmapOcrPauseIntentSerial: 0,
    nativeBitmapOcrPauseObserved: false,
    nativeBitmapOcrMouseLayoutAt: Number.NEGATIVE_INFINITY,
    nativeBitmapOcrMouseActivitySeen: false,
    nativeBitmapOcrMouseIntentSeen: false,
    nativeBitmapOcrMouseActivityCounter: null,
    nativeBitmapOcrWindowMain: true,
    activeWorkerReady: values.__workerReady || null,
    nativeExternalSrtCache: Object.create(null),
    nativeExternalSrtInFlight: Object.create(null),
    nativeSubtitleLayoutTrigger: "test",
    lastNativeAssReadinessDiagnosticKey: "",
    nativeSubtitlePrivateCueSerial: 0,
    nativeSubtitlePrivateCueDirectoryPromise: null,
    __testUseActualFontMetrics: !!values.__useActualFontMetricResolver,
    __testDefaultFontMetrics: TEST_FONT_METRICS,
    __fontMetricEvents: fontMetricEvents,
    __fontMetricLogs: fontMetricLogs,
    __testPrivateFiles: privateFiles,
    __testExecEvents: execEvents,
    __testGeometryRequests: geometryRequests,
    __testValues: values,
    enabled: values.__enabled !== false,
    async ensureBundledBackendInstalled() {},
    notify() {},
    preferences: {
      set() {},
      sync() {},
    },
    async runWorkerQueueRequestDirect(request) {
      geometryRequests.push(request);
      if (typeof values.__geometryResponse === "function")
        return values.__geometryResponse(request);
      throw new Error("unexpected native ASS geometry request");
    },
    utils: {
      async exec(command, args, cwd) {
        execEvents.push({ command, args: Array.from(args || []), cwd });
        if (command === "/usr/bin/curl" && values.__curlResult)
          return values.__curlResult;
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
    workerMouseActivityPath() {
      return "/test/worker/state/mouse.json";
    },
    file: {
      write(filePath, contents) {
        privateFiles[filePath] = String(contents);
      },
      exists(filePath) {
        return Object.prototype.hasOwnProperty.call(privateFiles, filePath);
      },
      read(filePath) {
        return privateFiles[filePath] || "";
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
    debugWarn(message) {
      fontMetricLogs.push(String(message || ""));
    },
    debugLog(message) {
      fontMetricLogs.push(String(message || ""));
    },
    debugVerbose(message) {
      fontMetricLogs.push(String(message || ""));
    },
    mpv: {
      command(name, args) {
        if (typeof values.__mpvCommand === "function")
          return values.__mpvCommand(
            name,
            Array.from(args || []),
            privateFiles,
          );
        throw new Error("unexpected mpv command");
      },
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
      getFlag(name) {
        return /^(yes|true|1|on)$/i.test(String(values[name]));
      },
      set(name, value) {
        values[name] = value;
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
    normalizeExperimentalSubtitleText(text) {
      const normalized = String(text || "").replace(/\r/g, "");
      return values["pref:flattenSubtitleLineBreaks"]
        ? normalized.replace(/\n+/g, " ")
        : normalized;
    },
    readExperimentalLookupSubtitleProperty(name) {
      return String(values[name] || "").replace(/\r/g, "");
    },
    prefBool(name, fallback) {
      return values["pref:" + name] === undefined
        ? fallback
        : !!values["pref:" + name];
    },
    prefNumber(name, fallback) {
      const value = Number(values["pref:" + name]);
      return Number.isFinite(value) ? value : fallback;
    },
    IINATAN_LOOKUP_CHARACTER_POLICY: {
      matches(_policy, character) {
        return /[\p{L}\p{N}]/u.test(character);
      },
    },
    selectedLanguageModule() {
      return {
        id: values.languageId || "en",
        lookupCharacterPolicy: { ranges: [] },
      };
    },
    putBoundedCache(cache, key, value) {
      cache[key] = value;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, "src/main/05_media_source.js"), "utf8") +
      "\n" +
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
  iinaOnlineMediaSubtitleEdlSource,
  normalizeNativeOsdDimensions,
  normalizeNativeVideoDimensions,
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
  nativeBitmapSelectedTrack,
  bitmapSubtitleOcrMode,
  nativeBitmapOcrLanguages,
  nativeBitmapOcrCacheKey,
  nativeBitmapOcrTrigger,
  triggerNativeBitmapOcrFromMouseMovement,
  handleNativeBitmapOcrMouseInput,
  observeNativeBitmapOcrMouseActivity,
  runNativeBitmapOcrRequest,
  nativeBitmapSubtitleCueSnapshot,
  advanceNativeBitmapOcrGeneration,
  normalizeNativeBitmapOcrResponse,
  parseSimpleNativeAssCue,
  nativeAssDisplayText,
  nativeAssGeometryUnits,
  nativeAssSourceSnapshot,
  nativeSrtTimestampMs,
  parseNativeSrtCues,
  nativeExternalSubtitleSource,
  nativeExternalSrtCues,
  nativeExternalSrtEventBlocks,
  nativeGraphemeBreakFallback,
  nativeGraphemeSegments,
  nativeLookupMapping,
  nativeAssGeometryCacheKey,
  nativeAssGeometrySnapshot,
  advanceNativeAssGeometryGeneration,
  nativeSubtitleCueSnapshot,
  nativeSubtitleCombinedCueSnapshot,
  reportNativeAssReadiness,
  nativeSubtitleVisibilityTarget,
  testFontMetricEvents: globalThis.__fontMetricEvents,
  testFontMetricLogs: globalThis.__fontMetricLogs,
  testPrivateFiles: globalThis.__testPrivateFiles,
  testExecEvents: globalThis.__testExecEvents,
  testGeometryRequests: globalThis.__testGeometryRequests,
  testValues: globalThis.__testValues
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
      path.join(root, "src/languages/lookup_character_policy.js"),
      "utf8",
    ) +
      "\n" +
      fs.readFileSync(
        path.join(root, "src/overlay/native_subtitle_hit_layer.js"),
        "utf8",
      ) +
      ";globalThis.geometryHelpers=IINATAN_NATIVE_SUBTITLE_HIT_LAYER;",
    context,
  );
  return context.geometryHelpers;
}

function waitForLayout() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

(async () => {
  const bitmapStatusOverlay = loadOverlayForTest(["renderBitmapOcrStatus"]);
  bitmapStatusOverlay.context.__handlers.enabled({ enabled: true });
  bitmapStatusOverlay.overlay.renderBitmapOcrStatus({ state: "pending" });
  assertEqual(
    bitmapStatusOverlay.context.__elements["bitmap-ocr-status"].textContent,
    "OCR",
    "pending bitmap OCR uses the compact activity label",
  );
  bitmapStatusOverlay.overlay.renderBitmapOcrStatus({
    state: "failed",
    fallbackEnabled: false,
  });
  assert(
    bitmapStatusOverlay.context.__elements["bitmap-ocr-status"].textContent ===
      "" &&
      bitmapStatusOverlay.context.__elements["bitmap-ocr-status"].className ===
        "hidden",
    "the OCR activity indicator disappears after recognition finishes",
  );
  const policyOverlay = loadOverlayForTest(["applyConfig", "isLookupableChar"]);
  [
    ["ja", "猫", JAPANESE_LOOKUP_CHARACTER_POLICY],
    ["en", "w", LATIN_LOOKUP_CHARACTER_POLICY],
    ["fr", "œ", LATIN_LOOKUP_CHARACTER_POLICY],
    ["de", "ẞ", LATIN_LOOKUP_CHARACTER_POLICY],
    ["zh", "中", CHINESE_LOOKUP_CHARACTER_POLICY],
    ["ko", "한", KOREAN_LOOKUP_CHARACTER_POLICY],
  ].forEach(([id, character, lookupCharacterPolicy]) => {
    policyOverlay.overlay.applyConfig({
      language: { id, lookupCharacterPolicy },
    });
    assert(
      policyOverlay.overlay.isLookupableChar(character),
      id + " native hit-layer policy accepts its representative character",
    );
  });
  policyOverlay.overlay.applyConfig({
    language: {
      id: "en",
      lookupCharacterPolicy: {
        ranges: [{ start: -1, end: 10 }],
        additionalCharacters: "",
      },
    },
  });
  assert(
    !policyOverlay.overlay.isLookupableChar("w"),
    "invalid non-Japanese native hit-layer policies fail closed",
  );
  policyOverlay.overlay.applyConfig({ language: { id: "ja" } });
  assert(
    policyOverlay.overlay.isLookupableChar("猫"),
    "Japanese keeps its built-in compatibility policy when config omits it",
  );

  const helpers = loadMainNativeHelpers();
  assertEqual(
    helpers.nativeAssSourceSnapshot({
      ffIndex: 14,
      external: false,
    }),
    { reason: "unsafe-media-path" },
    "an absent ASS source still fails closed",
  );
  const opaqueSourceHelpers = loadMainNativeHelpers({
    "stream-open-filename": "memory://mpv-owned-stream",
  });
  assertEqual(
    opaqueSourceHelpers.nativeAssSourceSnapshot(
      {
        ffIndex: 14,
        external: false,
      },
      true,
    ),
    {
      path: "memory://mpv-owned-stream",
      ffIndex: 14,
      external: false,
    },
    "mpv-only sources are accepted only with a complete decoded ASS observation",
  );
  const remoteSourceHelpers = loadMainNativeHelpers({
    "stream-open-filename":
      "https://media.example.test/video.mkv?access_token=private",
  });
  assertEqual(
    remoteSourceHelpers.nativeAssSourceSnapshot({
      ffIndex: 14,
      external: false,
    }),
    {
      path: "https://media.example.test/video.mkv?access_token=private",
      ffIndex: 14,
      external: false,
    },
    "embedded ASS tracks retain an HTTP(S) playback source for native demuxing",
  );
  const overlappingSrtPath = "/tmp/overlapping.srt";
  const overlappingSrtText = [
    "202",
    "00:11:54,338 --> 00:11:56,173",
    "",
    "彼女の娘とは思えないな",
    "",
    "203",
    "00:11:54,338 --> 00:11:56,173",
    "できる子は",
    "この年齢で もっとできてる",
    "",
  ].join("\n");
  const overlappingSrtHelpers = loadMainNativeHelpers({
    __privateFiles: { [overlappingSrtPath]: overlappingSrtText },
    "time-pos": 714.5,
    "options/sub-delay": 0,
    languageId: "ja",
  });
  const parsedOverlappingSrt =
    overlappingSrtHelpers.parseNativeSrtCues(overlappingSrtText);
  assertEqual(
    parsedOverlappingSrt.cues.map((cue) => cue.text),
    ["彼女の娘とは思えないな", "できる子は\nこの年齢で もっとできてる"],
    "the SRT parser keeps authored lines inside their original cue",
  );
  const overlappingSrtDisplay =
    "彼女の娘とは思えないな\nできる子は\nこの年齢で もっとできてる";
  const overlappingSrtBlocks =
    overlappingSrtHelpers.nativeExternalSrtEventBlocks(
      {
        external: true,
        externalFilename: overlappingSrtPath,
      },
      "primary",
      overlappingSrtDisplay,
      overlappingSrtDisplay,
      7,
    );
  assertEqual(
    overlappingSrtBlocks.eventBlocks.map((block) => ({
      displayText: block.displayText,
      lookupStart: block.lookupStart,
      stackIndex: block.stackIndex,
    })),
    [
      {
        displayText: "彼女の娘とは思えないな",
        lookupStart: 7,
        stackIndex: 0,
      },
      {
        displayText: "できる子は\nこの年齢で もっとできてる",
        lookupStart: 19,
        stackIndex: 1,
      },
    ],
    "simultaneous SRT cues become independently stacked lookup blocks",
  );
  assertEqual(
    overlappingSrtHelpers.nativeExternalSrtEventBlocks(
      {
        external: true,
        externalFilename: overlappingSrtPath,
      },
      "primary",
      "wrong text",
      "wrong text",
      0,
    ).reason,
    "cue-text-mismatch",
    "SRT event boundaries fail closed when mpv text does not match the file",
  );
  const flattenedSrtHelpers = loadMainNativeHelpers({
    __privateFiles: { [overlappingSrtPath]: overlappingSrtText },
    "time-pos": 714.5,
    "options/sub-delay": 0,
    "pref:flattenSubtitleLineBreaks": true,
    languageId: "ja",
  });
  const flattenedSrtBlocks = flattenedSrtHelpers.nativeExternalSrtEventBlocks(
    {
      external: true,
      externalFilename: overlappingSrtPath,
    },
    "primary",
    overlappingSrtDisplay,
    "彼女の娘とは思えないな できる子は この年齢で もっとできてる",
    0,
  );
  assertEqual(
    flattenedSrtBlocks.eventBlocks.map((block) => block.lookupStart),
    [0, 12],
    "flattened subtitle line breaks preserve simultaneous SRT event offsets",
  );
  const streamedSrtUrl = "https://media.example.test/subtitles/ja.srt?sig=1";
  const streamedSrtHelpers = loadMainNativeHelpers({
    __curlResult: {
      status: 0,
      stdout: overlappingSrtText,
      stderr: "",
    },
  });
  assertEqual(
    streamedSrtHelpers.nativeExternalSrtCues({
      external: true,
      externalFilename: streamedSrtUrl,
    }).reason,
    "srt-read-pending",
    "URL-backed external SRT starts one bounded asynchronous read",
  );
  await waitForLayout();
  assertEqual(
    streamedSrtHelpers.nativeExternalSrtCues({
      external: true,
      externalFilename: streamedSrtUrl,
    }).cues.length,
    2,
    "URL-backed external SRT retains event boundaries after the read completes",
  );
  const streamedSrtRequest = streamedSrtHelpers.testExecEvents.find(
    (event) => event.command === "/usr/bin/curl",
  );
  assert(
    streamedSrtRequest &&
      streamedSrtRequest.args.includes("=http,https") &&
      streamedSrtRequest.args.includes(String(8 * 1024 * 1024)),
    "external SRT reads restrict protocols and response size",
  );
  const onlineMediaSrtUrl =
    "https://www.youtube.com/api/timedtext?v=test&lang=ja&fmt=srt&signature=private";
  const onlineMediaSrtEdl =
    "edl://!no_clip;!delay_open,media_type=sub;%" +
    onlineMediaSrtUrl.length +
    "%" +
    onlineMediaSrtUrl;
  const onlineMediaSrtTrack = {
    type: "sub",
    id: 7,
    selected: true,
    "main-selection": 0,
    codec: "null",
    "codec-desc": "Unknown",
    external: true,
    "external-filename": onlineMediaSrtEdl,
  };
  const onlineMediaSrtHelpers = loadMainNativeHelpers({
    __curlResult: {
      status: 0,
      stdout: overlappingSrtText,
      stderr: "",
    },
    sid: 7,
    "track-list": [onlineMediaSrtTrack],
    "time-pos": 714.5,
    "options/sub-delay": 0,
    "sub-text": overlappingSrtDisplay,
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
    languageId: "ja",
  });
  assertEqual(
    onlineMediaSrtHelpers.nativeSubtitleTrackEligibility(
      [onlineMediaSrtTrack],
      7,
    ).kind,
    "srt",
    "mpv's null-codec sentinel is accepted only when a validated Online Media EDL identifies SRT",
  );
  assertEqual(
    onlineMediaSrtHelpers.nativeSubtitleCueSnapshot(overlappingSrtDisplay)
      .reason,
    "srt-read-pending",
    "the validated Online Media EDL begins a bounded read of its inner SRT URL",
  );
  await waitForLayout();
  const onlineMediaSnapshot = onlineMediaSrtHelpers.nativeSubtitleCueSnapshot(
    overlappingSrtDisplay,
  );
  assertEqual(
    {
      kind: onlineMediaSnapshot.kind,
      eventBlocks: onlineMediaSnapshot.layout.eventBlocks.length,
    },
    { kind: "srt", eventBlocks: 2 },
    "the live Online Media track reaches normal SRT geometry with overlapping cues preserved",
  );
  const onlineMediaSrtRequest = onlineMediaSrtHelpers.testExecEvents.find(
    (event) => event.command === "/usr/bin/curl",
  );
  assert(
    onlineMediaSrtRequest &&
      onlineMediaSrtRequest.args.includes(onlineMediaSrtUrl) &&
      !onlineMediaSrtRequest.args.some((arg) =>
        String(arg).startsWith("edl://"),
      ),
    "the SRT reader receives only the validated inner URL, never the EDL wrapper",
  );
  assertEqual(
    onlineMediaSrtHelpers.nativeSubtitleTrackEligibility(
      [Object.assign({}, onlineMediaSrtTrack, { codec: "mystery" })],
      7,
    ).reason,
    "unsupported-codec",
    "an explicit unknown codec is not overridden by an inferred EDL format",
  );
  assertEqual(
    onlineMediaSrtHelpers.nativeSubtitleTrackEligibility(
      [
        Object.assign({}, onlineMediaSrtTrack, {
          "external-filename": onlineMediaSrtEdl.replace(
            "%" + onlineMediaSrtUrl.length + "%",
            "%" + (onlineMediaSrtUrl.length + 1) + "%",
          ),
        }),
      ],
      7,
    ).reason,
    "unsupported-codec",
    "a malformed length-delimited EDL cannot supply missing codec metadata",
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
    "bitmap subtitle codecs are identified for the OCR path",
  );
  const bitmapEnabled = loadMainNativeHelpers({
    pause: true,
    sid: 2,
    "pref:bitmapSubtitleOcrEnabled": true,
    "track-list": [
      {
        type: "sub",
        id: 2,
        selected: true,
        "main-selection": 0,
        codec: "hdmv_pgs_subtitle",
        "ff-index": 4,
      },
    ],
  });
  assert(
    bitmapEnabled.bitmapSubtitleOcrMode(),
    "the independent default-enabled OCR path activates for a selected bitmap track",
  );
  assertEqual(
    JSON.stringify(
      Array.from(
        bitmapEnabled.nativeBitmapOcrLanguages({
          languages: ["en-US", "ja-JP"],
        }),
      ),
    ),
    JSON.stringify(["en-US"]),
    "profile language compatibility is intersected with runtime Vision support",
  );
  const bitmapDisabled = loadMainNativeHelpers({
    sid: 2,
    "pref:bitmapSubtitleOcrEnabled": false,
    "track-list": [
      {
        type: "sub",
        id: 2,
        selected: true,
        codec: "hdmv_pgs_subtitle",
      },
    ],
  });
  assert(
    !bitmapDisabled.bitmapSubtitleOcrMode(),
    "an explicit bitmap OCR opt-out remains effective",
  );
  const prefetchedBitmap = loadMainNativeHelpers({
    pause: false,
    path: "/tmp/movie.mkv",
    "stream-open-filename": "/tmp/movie.mkv",
    sid: 2,
    "time-pos": 10.05,
    "sub-start": 10,
    "sub-end": 12,
    "pref:bitmapSubtitleOcrEnabled": true,
    "pref:bitmapSubtitleOcrScreenshotFallbackEnabled": false,
    "track-list": [
      {
        type: "sub",
        id: 2,
        selected: true,
        "main-selection": 0,
        codec: "hdmv_pgs_subtitle",
        "ff-index": 4,
      },
    ],
    "osd-dimensions": {
      w: 1280,
      h: 720,
      ml: 0,
      mr: 0,
      mt: 0,
      mb: 0,
      par: 1,
    },
    "video-params": { w: 1920, h: 1080, par: 1, rotate: 0 },
    __geometryResponse(request) {
      return {
        ok: true,
        protocol: 1,
        text: "Bonjour",
        confidence: 0.98,
        mode: "decoded-subtitle",
        cueStartMs: 10000,
        cueEndMs: 12000,
        rendererWidth: request.renderer.width,
        rendererHeight: request.renderer.height,
        units: [
          {
            displayStartUtf16: 0,
            displayEndUtf16: 7,
            rects: [{ x: 500, y: 620, w: 280, h: 46 }],
          },
        ],
      };
    },
  });
  const bitmapTrack = prefetchedBitmap.nativeBitmapSelectedTrack("primary");
  const pendingBitmap = prefetchedBitmap.nativeBitmapSubtitleCueSnapshot(
    bitmapTrack,
    { surface: "primary", lookupStart: 0 },
  );
  assertEqual(
    pendingBitmap.reason,
    "bitmap-ocr-awaiting-intent",
    "bitmap OCR waits for user intent during ordinary playback by default",
  );
  assertEqual(
    prefetchedBitmap.testGeometryRequests.length,
    0,
    "ordinary bitmap subtitle playback does not spend energy on OCR",
  );
  const nativeMouseFiles = {
    "/test/worker/state/mouse.json": JSON.stringify({
      protocol: 1,
      counter: 10,
    }),
  };
  const nativeMouse = loadMainNativeHelpers({
    ...prefetchedBitmap.testValues,
    __workerReady: { mouseIntent: { protocol: 1 } },
    __privateFiles: nativeMouseFiles,
  });
  assert(
    !nativeMouse.observeNativeBitmapOcrMouseActivity(),
    "the native mouse counter establishes a baseline without triggering OCR",
  );
  nativeMouse.testPrivateFiles["/test/worker/state/mouse.json"] =
    JSON.stringify({ protocol: 1, counter: 11 });
  assert(
    nativeMouse.observeNativeBitmapOcrMouseActivity(),
    "a changed native mouse counter triggers bitmap OCR intent",
  );
  assert(
    prefetchedBitmap.triggerNativeBitmapOcrFromMouseMovement(),
    "the first mouse movement anywhere in the player requests OCR immediately",
  );
  const mouseTriggeredBitmap = prefetchedBitmap.nativeBitmapSubtitleCueSnapshot(
    bitmapTrack,
    {
      surface: "primary",
      lookupStart: 0,
    },
  );
  assertEqual(
    mouseTriggeredBitmap.reason,
    "bitmap-ocr-pending",
    "mouse intent starts bitmap OCR without depending on a subtitle region",
  );
  await waitForLayout();
  const readyBitmap = prefetchedBitmap.nativeBitmapSubtitleCueSnapshot(
    bitmapTrack,
    { surface: "primary", lookupStart: 0 },
  );
  assertEqual(
    readyBitmap.lookupText,
    "Bonjour",
    "the prefetched bitmap cue becomes lookupable before pausing",
  );
  prefetchedBitmap.testValues.pause = true;
  prefetchedBitmap.testValues["time-pos"] = 11.2;
  const pausedBitmap = prefetchedBitmap.nativeBitmapSubtitleCueSnapshot(
    bitmapTrack,
    { surface: "primary", lookupStart: 0 },
  );
  assertEqual(
    pausedBitmap.lookupText,
    "Bonjour",
    "pause and playback-time changes reuse the stable per-cue OCR cache",
  );
  assertEqual(
    prefetchedBitmap.testGeometryRequests.length,
    1,
    "one active bitmap cue launches only one direct OCR request",
  );
  const supersedingResponses = [];
  const supersedingBitmap = loadMainNativeHelpers({
    ...prefetchedBitmap.testValues,
    pause: false,
    "time-pos": 20.1,
    "sub-start": 20,
    "sub-end": 22,
    __geometryResponse(request) {
      return new Promise((resolve) =>
        supersedingResponses.push({ request, resolve }),
      );
    },
  });
  const supersedingTrack =
    supersedingBitmap.nativeBitmapSelectedTrack("primary");
  supersedingBitmap.triggerNativeBitmapOcrFromMouseMovement();
  supersedingBitmap.nativeBitmapSubtitleCueSnapshot(supersedingTrack, {
    surface: "primary",
    lookupStart: 0,
  });
  await waitForLayout();
  supersedingBitmap.testValues["time-pos"] = 23.1;
  supersedingBitmap.testValues["sub-start"] = 23;
  supersedingBitmap.testValues["sub-end"] = 25;
  supersedingBitmap.nativeBitmapSubtitleCueSnapshot(supersedingTrack, {
    surface: "primary",
    lookupStart: 0,
  });
  await waitForLayout();
  assertEqual(
    supersedingResponses.length,
    2,
    "a newer cue reaches the native coalescing executor without waiting for stale OCR",
  );
  supersedingResponses[0].resolve({
    ok: false,
    reason: "bitmap-ocr-superseded",
  });
  supersedingResponses[1].resolve({
    ok: true,
    protocol: 1,
    text: "新しい字幕",
    confidence: 0.9,
    mode: "decoded-subtitle",
    cueStartMs: 23000,
    cueEndMs: 25000,
    rendererWidth: supersedingResponses[1].request.renderer.width,
    rendererHeight: supersedingResponses[1].request.renderer.height,
    units: [
      {
        displayStartUtf16: 0,
        displayEndUtf16: 5,
        rects: [{ x: 400, y: 620, w: 300, h: 48 }],
      },
    ],
  });
  await waitForLayout();
  assertEqual(
    supersedingBitmap.nativeBitmapSubtitleCueSnapshot(supersedingTrack, {
      surface: "primary",
      lookupStart: 0,
    }).lookupText,
    "新しい字幕",
    "a superseded result cannot replace the newer cue's recognized text",
  );
  prefetchedBitmap.advanceNativeBitmapOcrGeneration();
  prefetchedBitmap.testValues.pause = true;
  prefetchedBitmap.testValues["time-pos"] = 13.05;
  prefetchedBitmap.testValues["sub-start"] = 13;
  prefetchedBitmap.testValues["sub-end"] = 15;
  const pauseTriggeredBitmap = prefetchedBitmap.nativeBitmapSubtitleCueSnapshot(
    bitmapTrack,
    {
      surface: "primary",
      lookupStart: 0,
    },
  );
  assertEqual(
    pauseTriggeredBitmap.reason,
    "bitmap-ocr-pending",
    "pausing immediately starts OCR for the current bitmap cue",
  );
  await waitForLayout();
  prefetchedBitmap.advanceNativeBitmapOcrGeneration();
  prefetchedBitmap.testValues.pause = false;
  prefetchedBitmap.testValues["time-pos"] = 16.05;
  prefetchedBitmap.testValues["sub-start"] = 16;
  prefetchedBitmap.testValues["sub-end"] = 18;
  prefetchedBitmap.testValues["pref:bitmapSubtitleOcrPrefetchEnabled"] = true;
  const continuousBitmap = prefetchedBitmap.nativeBitmapSubtitleCueSnapshot(
    bitmapTrack,
    {
      surface: "primary",
      lookupStart: 0,
    },
  );
  assertEqual(
    continuousBitmap.reason,
    "bitmap-ocr-pending",
    "continuous bitmap OCR remains available as an explicit opt-in",
  );
  await waitForLayout();
  const transientDirectFailure = loadMainNativeHelpers({
    pause: false,
    "pref:bitmapSubtitleOcrScreenshotFallbackEnabled": false,
    __geometryResponse() {
      return { ok: false, reason: "bitmap-cue-unavailable" };
    },
  });
  const transientFailure =
    await transientDirectFailure.runNativeBitmapOcrRequest(
      {
        type: "bitmap-subtitle-ocr",
        protocol: 1,
        source: { path: "/tmp/movie.mkv", ffIndex: 4, external: false },
        renderer: {
          width: 1280,
          height: 720,
          storageWidth: 1920,
          storageHeight: 1080,
        },
      },
      "primary",
    );
  assertEqual(
    transientFailure.reason,
    "bitmap-cue-unavailable",
    "a disabled screenshot fallback does not turn a transient direct miss into a permanent fallback failure",
  );
  const supersededDirectRequest = loadMainNativeHelpers({
    pause: true,
    "pref:bitmapSubtitleOcrScreenshotFallbackEnabled": true,
    __geometryResponse() {
      return { ok: false, reason: "bitmap-ocr-superseded" };
    },
  });
  const supersededResult =
    await supersededDirectRequest.runNativeBitmapOcrRequest(
      {
        type: "bitmap-subtitle-ocr",
        protocol: 1,
        source: { path: "/tmp/movie.mkv", ffIndex: 4, external: false },
        renderer: {
          width: 1280,
          height: 720,
          storageWidth: 1920,
          storageHeight: 1080,
        },
      },
      "primary",
    );
  assertEqual(
    supersededResult.reason,
    "bitmap-ocr-superseded",
    "superseded direct work does not fall through to screenshot capture",
  );
  assertEqual(
    supersededDirectRequest.testExecEvents.length,
    0,
    "superseding a direct request does not invoke player-cache fallback work",
  );
  const unsettledDirectSource =
    await transientDirectFailure.runNativeBitmapOcrRequest(
      {
        type: "bitmap-subtitle-ocr",
        protocol: 1,
        renderer: {
          width: 1280,
          height: 720,
          storageWidth: 1920,
          storageHeight: 1080,
        },
      },
      "primary",
    );
  assertEqual(
    unsettledDirectSource.reason,
    "bitmap-direct-unavailable",
    "an unsettled first-cue source remains retryable when screenshot fallback is disabled",
  );
  const boundedRetryClock = { now: 1000 };
  let boundedRetryCalls = 0;
  const boundedRetryBitmap = loadMainNativeHelpers({
    ...prefetchedBitmap.testValues,
    pause: false,
    "time-pos": 10.05,
    "sub-start": 10,
    "sub-end": 12,
    "pref:bitmapSubtitleOcrPrefetchEnabled": false,
    __clock: boundedRetryClock,
    __geometryResponse() {
      boundedRetryCalls++;
      return { ok: false, reason: "bitmap-cue-unavailable" };
    },
  });
  const boundedRetryTrack =
    boundedRetryBitmap.nativeBitmapSelectedTrack("primary");
  boundedRetryBitmap.triggerNativeBitmapOcrFromMouseMovement();
  assertEqual(
    boundedRetryBitmap.nativeBitmapSubtitleCueSnapshot(boundedRetryTrack, {
      surface: "primary",
      lookupStart: 0,
    }).reason,
    "bitmap-ocr-pending",
    "one mouse gesture starts a bounded OCR attempt batch",
  );
  await waitForLayout();
  boundedRetryClock.now = 5000;
  const exhaustedMouseIntent =
    boundedRetryBitmap.nativeBitmapSubtitleCueSnapshot(boundedRetryTrack, {
      surface: "primary",
      lookupStart: 0,
    });
  assertEqual(
    exhaustedMouseIntent,
    {
      reason: "bitmap-cue-unavailable",
      failureReason: "bitmap-cue-unavailable",
      retryScheduled: false,
      surface: "primary",
      trackId: 2,
    },
    "a native near-seek plus broad-seek miss does not schedule another JavaScript retry",
  );
  boundedRetryClock.now = 60000;
  boundedRetryBitmap.nativeBitmapSubtitleCueSnapshot(boundedRetryTrack, {
    surface: "primary",
    lookupStart: 0,
  });
  assertEqual(
    boundedRetryCalls,
    1,
    "an exhausted mouse intent does not restart itself while polling",
  );
  boundedRetryBitmap.testValues.pause = true;
  assertEqual(
    boundedRetryBitmap.nativeBitmapSubtitleCueSnapshot(boundedRetryTrack, {
      surface: "primary",
      lookupStart: 0,
    }).reason,
    "bitmap-ocr-pending",
    "a later pause transition explicitly rearms the failed cue",
  );
  await waitForLayout();
  assertEqual(
    boundedRetryCalls,
    2,
    "a new pause intent can retry a cue after the previous native attempt finished",
  );
  const independentlySelectedTracks = [
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
  ];
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      independentlySelectedTracks,
      2,
      3,
      "primary",
    ).track.id,
    2,
    "the primary surface keeps its independently selected track",
  );
  assertEqual(
    helpers.nativeSubtitleTrackEligibility(
      independentlySelectedTracks,
      2,
      3,
      "secondary",
    ).track.id,
    3,
    "the secondary surface resolves its own selected track",
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
      "primary",
    ).reason,
    undefined,
    "an explicit secondary sid does not suppress the primary surface",
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
  const overlappingAss = helpers.nativeAssDisplayText("Top\nBottom\\Nline");
  assertEqual(
    overlappingAss.displayText,
    "Top\nBottom\nline",
    "native geometry accepts literal event separators and authored line breaks",
  );
  const inlineItalicAss = helpers.nativeAssDisplayText(
    "someone who's into you\\N is {\\i1}bound{\\i0} to turn up.",
  );
  assertEqual(
    inlineItalicAss.displayText,
    "someone who's into you\n is bound to turn up.",
    "native geometry maps text through bounded inline italic overrides",
  );
  assertEqual(
    helpers.nativeAssDisplayText("{\\b1}bold{\\b0}").reason,
    "complex-ass-tags",
    "unhandled inline overrides remain fail-closed",
  );
  const overlappingMapping = helpers.nativeLookupMapping(
    overlappingAss.displayText,
    overlappingAss.displayText,
    { languageId: "en", flattenLineBreaks: false },
  );
  assert(
    overlappingMapping.ok,
    "simultaneous native ASS event text remains globally mappable",
  );
  assertEqual(
    helpers.nativeAssGeometryUnits(
      overlappingMapping,
      overlappingAss.displayText,
      {
        id: "en",
        lookupUnit: "word",
        lookupCharacterPolicy: { ranges: [] },
      },
    ),
    [
      { position: 0, displayStartUtf16: 0, displayEndUtf16: 3 },
      { position: 4, displayStartUtf16: 4, displayEndUtf16: 10 },
      { position: 11, displayStartUtf16: 11, displayEndUtf16: 15 },
    ],
    "lookup spans retain global UTF-16 positions across event and authored breaks",
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
  const japaneseCueSequence = [
    {
      displayText: "マジかよ",
      lookupText: "マジかよ",
    },
    {
      displayText: "（下呂）マジかよ",
      lookupText: "(下呂)マジかよ",
    },
    {
      displayText: "（花巻）\nギュフフ… 油断してただろ",
      lookupText: "(花巻)\nギュフフ... 油断してただろ",
    },
    {
      displayText: "油断してただろ",
      lookupText: "油断してただろ",
    },
  ];
  const japaneseCueMappings = japaneseCueSequence.map((cue) =>
    helpers.nativeLookupMapping(cue.displayText, cue.lookupText, {
      languageId: "ja",
      flattenLineBreaks: false,
    }),
  );
  japaneseCueMappings.forEach((cueMapping, index) => {
    assert(
      cueMapping.ok,
      "Japanese playback cue " + (index + 1) + " retains a native text map",
    );
    assertEqual(
      cueMapping.lookupText,
      japaneseCueSequence[index].lookupText,
      "Japanese playback cue " + (index + 1) + " uses canonical lookup text",
    );
  });
  assertEqual(
    japaneseCueMappings[1].lookupSpans,
    [
      { startUtf16: 0, endUtf16: 1 },
      { startUtf16: 1, endUtf16: 2 },
      { startUtf16: 2, endUtf16: 3 },
      { startUtf16: 3, endUtf16: 4 },
      { startUtf16: 4, endUtf16: 5 },
      { startUtf16: 5, endUtf16: 6 },
      { startUtf16: 6, endUtf16: 7 },
      { startUtf16: 7, endUtf16: 8 },
    ],
    "a fullwidth speaker label maps canonical punctuation to display UTF-16 spans",
  );
  assertEqual(
    japaneseCueMappings[2].lookupSpans,
    [
      { startUtf16: 0, endUtf16: 1 },
      { startUtf16: 1, endUtf16: 2 },
      { startUtf16: 2, endUtf16: 3 },
      { startUtf16: 3, endUtf16: 4 },
      { startUtf16: 4, endUtf16: 5 },
      { startUtf16: 5, endUtf16: 6 },
      { startUtf16: 6, endUtf16: 7 },
      { startUtf16: 7, endUtf16: 8 },
      { startUtf16: 8, endUtf16: 9 },
      { startUtf16: 9, endUtf16: 10 },
      { startUtf16: 9, endUtf16: 10 },
      { startUtf16: 9, endUtf16: 10 },
      { startUtf16: 10, endUtf16: 11 },
      { startUtf16: 11, endUtf16: 12 },
      { startUtf16: 12, endUtf16: 13 },
      { startUtf16: 13, endUtf16: 14 },
      { startUtf16: 14, endUtf16: 15 },
      { startUtf16: 15, endUtf16: 16 },
      { startUtf16: 16, endUtf16: 17 },
      { startUtf16: 17, endUtf16: 18 },
    ],
    "the multiline cue maps three canonical dots to its single displayed ellipsis glyph",
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
    "sub-text": "Hello\nmonde",
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
    "options/sub-ass-force-margins": "yes",
  });
  const snapshot = snapshotHelpers.nativeSubtitleCueSnapshot("Hello\nmonde");
  assertEqual(snapshot.kind, "srt", "multiline SRT snapshots remain eligible");
  assertEqual(snapshot.layout.osd.w, 1920, "OSD dimensions are captured");
  assertEqual(
    snapshot.layout.options.forceMargins,
    true,
    "ASS force-margins is captured independently of plain-text margins",
  );
  assertEqual(
    snapshotHelpers.normalizeNativeVideoDimensions({
      w: 720,
      h: 480,
      dw: 864,
      dh: 480,
      rotate: 0,
    }),
    { width: 720, height: 480, par: 1.2 },
    "storage size and pixel aspect are derived from video parameters",
  );
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
  const authoredAssProperties = {
    __geometryResponse(request) {
      return {
        ok: true,
        protocol: 1,
        rendererWidth: request.renderer.width,
        rendererHeight: request.renderer.height,
        units: request.units.map((unit) => ({
          position: unit.position,
          rects: [{ x: 100, y: 600, w: 30, h: 40 }],
        })),
      };
    },
    "track-list": [
      {
        type: "sub",
        id: 8,
        selected: true,
        "main-selection": 0,
        codec: "ass",
        "ff-index": 2,
        external: true,
        "external-filename": "/tmp/test.ass",
      },
    ],
    sid: 8,
    "sub-text-ass": "Bonjour",
    "sub-text/ass-full":
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Bonjour",
    "sub-ass-extradata": "[Script Info]\nPlayResX: 1280\nPlayResY: 720\n",
    "time-pos": 1.5,
    "sub-start": 1,
    "sub-end": 2,
    "osd-dimensions": {
      w: 1280,
      h: 720,
      ml: 0,
      mr: 0,
      mt: 20,
      mb: 40,
      par: 1.1,
    },
    "video-params": { w: 1920, h: 1080, par: 1.2, rotate: 0 },
    "sub-font": "Helvetica",
    "options/sub-scale": 1.25,
    "options/sub-pos": 65,
    "options/sub-ass-scale-with-window": "yes",
    "options/sub-ass-vsfilter-blur-compat": "no",
  };
  const authoredAssHelpers = loadMainNativeHelpers(authoredAssProperties);
  assertEqual(
    authoredAssHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "ass-geometry-pending",
    "mpv's default authored-ASS yes mode starts native geometry",
  );
  await waitForLayout();
  const authoredAss = authoredAssHelpers.nativeSubtitleCueSnapshot("Bonjour");
  assertEqual(
    authoredAss.kind,
    "ass-native",
    "mpv's default authored-ASS yes mode accepts returned geometry",
  );
  const authoredRenderer = authoredAssHelpers.testGeometryRequests[0].renderer;
  assertEqual(
    {
      assFull: authoredAssHelpers.testGeometryRequests[0].cue.assFull,
      assExtradata: authoredAssHelpers.testGeometryRequests[0].cue.assExtradata,
    },
    {
      assFull: authoredAssProperties["sub-text/ass-full"],
      assExtradata: authoredAssProperties["sub-ass-extradata"],
    },
    "primary authored ASS sends mpv's already-decoded full event and track header",
  );
  assertEqual(
    {
      overrideMode: authoredRenderer.overrideMode,
      linePosition: authoredRenderer.linePosition,
      pixelAspect: authoredRenderer.pixelAspect,
      fontScale: authoredRenderer.fontScale,
      useStorageSize: authoredRenderer.useStorageSize,
      defaultFamily: authoredRenderer.defaultFamily,
      fontProvider: authoredRenderer.fontProvider,
      assJustify: authoredRenderer.assJustify,
    },
    {
      overrideMode: "yes",
      linePosition: 35,
      pixelAspect: 1.32,
      fontScale: 1.25 * (720 / 660),
      useStorageSize: false,
      defaultFamily: "Helvetica",
      fontProvider: "auto",
      assJustify: false,
    },
    "authored ASS renderer coordinates and compatibility options match mpv 0.38",
  );

  const readinessHelpers = loadMainNativeHelpers({
    ...authoredAssProperties,
    path: "ytdl://watch.example.invalid/page",
    "stream-open-filename": "",
    "track-list": [],
    "osd-dimensions": undefined,
    "video-params": undefined,
    "time-pos": undefined,
    "sub-start": undefined,
    "sub-end": undefined,
  });
  const readinessValues = readinessHelpers.testValues;
  assertEqual(
    readinessHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "unsupported-codec",
    "persisted startup waits for subtitle-track discovery",
  );
  readinessValues["track-list"] = [
    {
      ...authoredAssProperties["track-list"][0],
      external: false,
      "external-filename": "",
      "ff-index": undefined,
    },
  ];
  assertEqual(
    readinessHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "missing-osd-dimensions",
    "persisted startup waits for OSD dimensions",
  );
  readinessValues["osd-dimensions"] = authoredAssProperties["osd-dimensions"];
  assertEqual(
    readinessHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "missing-video-dimensions",
    "persisted startup waits for video dimensions",
  );
  readinessValues["video-params"] = authoredAssProperties["video-params"];
  assertEqual(
    readinessHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "cue-timing-unavailable",
    "mpv's decoded ASS observation makes an opaque source independent of FFmpeg track mapping",
  );
  readinessValues["time-pos"] = authoredAssProperties["time-pos"];
  readinessValues["sub-start"] = authoredAssProperties["sub-start"];
  readinessValues["sub-end"] = authoredAssProperties["sub-end"];
  assertEqual(
    readinessHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "ass-geometry-pending",
    "the same persisted-enabled state starts geometry when its final prerequisite arrives",
  );
  await waitForLayout();
  assertEqual(
    readinessHelpers.nativeSubtitleCueSnapshot("Bonjour").kind,
    "ass-native",
    "startup readiness recovery succeeds without calling the toggle path",
  );
  assertEqual(
    readinessHelpers.testGeometryRequests.length,
    1,
    "readiness rejections do not create premature or duplicate geometry requests",
  );

  const overlappingAssHelpers = loadMainNativeHelpers({
    ...authoredAssProperties,
    "sub-text-ass": "Top\nBottom\\Nline",
  });
  assertEqual(
    overlappingAssHelpers.nativeSubtitleCueSnapshot("Top\nBottom\nline").reason,
    "ass-geometry-pending",
    "simultaneous authored ASS events start native geometry",
  );
  await waitForLayout();
  const overlappingAssRequest = overlappingAssHelpers.testGeometryRequests[0];
  assertEqual(
    overlappingAssRequest.cue.observedAss,
    "Top\nBottom\\Nline",
    "native requests preserve literal event separators and authored breaks",
  );
  assert(
    overlappingAssRequest.units.some((unit) => unit.displayStartUtf16 === 4) &&
      overlappingAssRequest.units.some((unit) => unit.displayStartUtf16 === 11),
    "native requests use global display positions after both kinds of newline",
  );

  const dualSrtProperties = {
    "track-list": [
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
    sid: 2,
    "secondary-sid": 3,
    "sub-text": "Same 😀\nline",
    "secondary-sub-text": "Same 😀",
    "sub-start": 1,
    "sub-end": 3,
    "secondary-sub-start": 1,
    "secondary-sub-end": 3,
    "osd-dimensions": authoredAssProperties["osd-dimensions"],
    "video-params": authoredAssProperties["video-params"],
  };
  const dualSrtHelpers = loadMainNativeHelpers(dualSrtProperties);
  const dualSrt = dualSrtHelpers.nativeSubtitleCombinedCueSnapshot();
  assertEqual(
    dualSrt.lookupText,
    "Same 😀\nline\nSame 😀",
    "primary and secondary lookup text is combined with one separator",
  );
  assertEqual(dualSrt.surfaces.length, 2, "both SRT surfaces are retained");
  assertEqual(
    dualSrt.surfaces[1].lookupStart,
    Array.from("Same 😀\nline").length + 1,
    "secondary global offsets count code points rather than UTF-16 units",
  );
  assertEqual(
    dualSrt.surfaces[0].lookupSpans.length,
    Array.from("Same 😀\nline").length,
    "astral and multiline display spans remain local to the primary surface",
  );

  const hiddenSecondary = loadMainNativeHelpers({
    ...dualSrtProperties,
    "secondary-sub-visibility": "no",
  }).nativeSubtitleCombinedCueSnapshot();
  assertEqual(
    hiddenSecondary.surfaces.length,
    1,
    "a hidden secondary surface is omitted without suppressing primary",
  );

  const unsupportedPrimary = loadMainNativeHelpers({
    ...dualSrtProperties,
    "pref:bitmapSubtitleOcrEnabled": false,
    "track-list": [
      {
        type: "sub",
        id: 2,
        selected: true,
        "main-selection": 0,
        codec: "hdmv_pgs_subtitle",
      },
      dualSrtProperties["track-list"][1],
    ],
  }).nativeSubtitleCombinedCueSnapshot();
  assertEqual(
    unsupportedPrimary.lookupText,
    "Same 😀",
    "a disabled bitmap surface cannot reuse stale text-subtitle properties",
  );
  assertEqual(
    unsupportedPrimary.surfaces[0].reason,
    "bitmap-ocr-disabled",
    "the disabled bitmap OCR failure remains surface-local",
  );
  assertEqual(
    unsupportedPrimary.surfaces[1].surface,
    "secondary",
    "secondary-only lookup retains its surface identity",
  );

  const secondaryStripHelpers = loadMainNativeHelpers({
    ...dualSrtProperties,
    "track-list": [
      {
        type: "sub",
        id: 2,
        selected: true,
        "main-selection": 0,
        codec: "hdmv_pgs_subtitle",
      },
      {
        ...dualSrtProperties["track-list"][1],
        codec: "ass",
      },
    ],
    "secondary-sub-text": "Already plain\nsecondary",
    "secondary-sub-ass-override": "strip",
    "secondary-sub-pos": 50,
  });
  const secondaryStrip =
    secondaryStripHelpers.nativeSubtitleCombinedCueSnapshot();
  assertEqual(
    secondaryStrip.surfaces[1].displayText,
    "Already plain\nsecondary",
    "secondary strip measures mpv's multiline plain property without ASS parsing",
  );
  assertEqual(
    secondaryStripHelpers.testGeometryRequests.length,
    0,
    "secondary strip remains on the CSS measurement path",
  );
  assertEqual(
    secondaryStrip.surfaces[1].layout.options.alignY,
    "top",
    "secondary converted text retains mpv's independent top surface",
  );
  assertEqual(
    {
      position: secondaryStrip.surfaces[1].layout.options.position,
      positionFromTop:
        secondaryStrip.surfaces[1].layout.options.positionFromTop,
    },
    { position: 50, positionFromTop: true },
    "secondary converted text carries its independent top-relative position",
  );

  const dualAssHelpers = loadMainNativeHelpers({
    ...authoredAssProperties,
    "track-list": [
      authoredAssProperties["track-list"][0],
      {
        type: "sub",
        id: 3,
        selected: true,
        "main-selection": 1,
        codec: "ass",
        "ff-index": 1,
        external: true,
        "external-filename": "/tmp/secondary.ass",
      },
    ],
    "secondary-sid": 3,
    "sub-text": "Bonjour",
    "secondary-sub-text": "Olá",
    "secondary-sub-start": 10.25,
    "secondary-sub-end": 12.25,
    "secondary-sub-delay": 0.25,
    "secondary-sub-ass-override": "scale",
    __geometryResponse(request) {
      return {
        ok: true,
        protocol: 1,
        requestId: request.requestId,
        rendererWidth: request.renderer.width,
        rendererHeight: request.renderer.height,
        units: request.units.map((unit) => ({
          position: unit.position,
          rects: [{ x: 10 + unit.position, y: 20, w: 8, h: 12 }],
        })),
      };
    },
  });
  dualAssHelpers.nativeSubtitleCombinedCueSnapshot();
  await waitForLayout();
  dualAssHelpers.nativeSubtitleCombinedCueSnapshot();
  await waitForLayout();
  const dualAss = dualAssHelpers.nativeSubtitleCombinedCueSnapshot();
  assertEqual(
    dualAss.surfaces.length,
    2,
    "primary native ASS and secondary scale surfaces resolve independently",
  );
  const secondaryPlainRequest = dualAssHelpers.testGeometryRequests.find(
    (request) =>
      request.cue.observedPlain === "Olá" &&
      request.units[0] &&
      request.units[0].position === Array.from("Bonjour").length + 1,
  );
  assert(
    secondaryPlainRequest,
    "secondary ASS uses the observed-plain helper: " +
      JSON.stringify(dualAssHelpers.testGeometryRequests),
  );
  assertEqual(
    secondaryPlainRequest.cue.observedFormat,
    "plain",
    "secondary plain observations are explicitly typed",
  );
  assertEqual(
    secondaryPlainRequest.cue.timeMs,
    1250,
    "secondary delay is removed from source lookup time",
  );
  assertEqual(
    secondaryPlainRequest.cue.startMs,
    10250,
    "secondary event start remains in mpv's raw subtitle timing domain",
  );
  assertEqual(
    secondaryPlainRequest.cue.endMs,
    12250,
    "secondary event end remains in mpv's raw subtitle timing domain",
  );
  assertEqual(
    secondaryPlainRequest.units[0].position,
    Array.from("Bonjour").length + 1,
    "secondary helper requests carry global code-point positions",
  );

  [
    ["options/sub-ass-justify", "yes"],
    ["options/sub-font-provider", "fontconfig"],
  ].forEach(([property, value]) => {
    const unsupportedHelpers = loadMainNativeHelpers({
      ...authoredAssProperties,
      [property]: value,
    });
    assertEqual(
      unsupportedHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
      "unsupported-renderer-option",
      property + " fails closed before requesting mismatched ASS geometry",
    );
    assertEqual(
      unsupportedHelpers.testGeometryRequests.length,
      0,
      property + " launches no native geometry request",
    );
  });

  const geometryResponse = (request) => ({
    ok: true,
    protocol: 1,
    rendererWidth: request.renderer.width,
    rendererHeight: request.renderer.height,
    units: request.units.map((unit) => ({
      position: unit.position,
      rects: [{ x: 10, y: 20, w: 30, h: 40 }],
    })),
  });
  let resolveAdvancingGeometry;
  const advancingGeometryPromise = new Promise((resolve) => {
    resolveAdvancingGeometry = resolve;
  });
  let advancingCalls = 0;
  const advancingHelpers = loadMainNativeHelpers({
    __geometryResponse(request) {
      advancingCalls++;
      return advancingCalls === 1
        ? advancingGeometryPromise
        : geometryResponse(request);
    },
  });
  const geometryRequest = {
    type: "ass-geometry",
    protocol: 1,
    source: { path: "/tmp/test.ass", ffIndex: 0, external: true },
    cue: {
      timeMs: 1100,
      startMs: 1000,
      endMs: 2000,
      observedAss: "Bonjour",
    },
    units: [{ position: 0, displayStartUtf16: 0, displayEndUtf16: 7 }],
    renderer: { width: 1280, height: 720 },
  };
  const cacheDumpCommands = [];
  const cacheExcerptHelpers = loadMainNativeHelpers({
    __mpvCommand(name, args, privateFiles) {
      cacheDumpCommands.push({ name, args });
      privateFiles[args[2]] = "cached media excerpt";
    },
    __geometryResponse(request) {
      return geometryResponse(request);
    },
  });
  const streamedGeometryRequest = {
    ...geometryRequest,
    source: {
      path: "https://media.example.test/video.mkv?token=private",
      ffIndex: 14,
      external: false,
    },
  };
  assertEqual(
    cacheExcerptHelpers.nativeAssGeometrySnapshot(streamedGeometryRequest)
      .reason,
    "ass-geometry-pending",
    "an embedded ASS cue from HTTP starts geometry asynchronously",
  );
  await waitForLayout();
  assert(
    cacheExcerptHelpers.nativeAssGeometrySnapshot(streamedGeometryRequest).ok,
    "mpv's cached excerpt produces the streamed cue geometry",
  );
  assertEqual(
    {
      command: cacheDumpCommands[0].name,
      start: cacheDumpCommands[0].args[0],
      end: cacheDumpCommands[0].args[1],
      source: cacheExcerptHelpers.testGeometryRequests[0].source,
    },
    {
      command: "dump-cache",
      start: "0.900",
      end: "2.100",
      source: {
        path: cacheDumpCommands[0].args[2],
        ffIndex: -1,
        external: false,
        autoAssStream: true,
        cacheExcerpt: true,
      },
    },
    "mpv 0.38 geometry uses only the already-buffered cue instead of reopening HTTP",
  );
  assert(
    !Object.prototype.hasOwnProperty.call(
      cacheExcerptHelpers.testPrivateFiles,
      cacheDumpCommands[0].args[2],
    ),
    "the private cache excerpt is removed after native rendering",
  );

  const cacheFallbackHelpers = loadMainNativeHelpers({
    __mpvCommand(_name, args, privateFiles) {
      privateFiles[args[2]] = "unusable cached media excerpt";
    },
    __geometryResponse(request) {
      return request.source.cacheExcerpt
        ? { ok: false, protocol: 1, reason: "cue-not-found" }
        : geometryResponse(request);
    },
  });
  cacheFallbackHelpers.nativeAssGeometrySnapshot(streamedGeometryRequest);
  await waitForLayout();
  assert(
    cacheFallbackHelpers.nativeAssGeometrySnapshot(streamedGeometryRequest).ok,
    "a cache excerpt that cannot be demuxed falls back to the resolved HTTP source",
  );
  assertEqual(
    cacheFallbackHelpers.testGeometryRequests.map((request) => ({
      cacheExcerpt: !!request.source.cacheExcerpt,
      sourceKind: request.source.path.startsWith("https://") ? "http" : "local",
    })),
    [
      { cacheExcerpt: true, sourceKind: "local" },
      { cacheExcerpt: false, sourceKind: "http" },
    ],
    "the remote reopen is retained only as a narrow fallback",
  );

  assertEqual(
    advancingHelpers.nativeAssGeometrySnapshot(geometryRequest).reason,
    "ass-geometry-pending",
    "the first live cue time starts geometry",
  );
  assertEqual(
    advancingHelpers.nativeAssGeometrySnapshot({
      ...geometryRequest,
      cue: { ...geometryRequest.cue, timeMs: 1300 },
    }).reason,
    "ass-geometry-pending",
    "advancing playback reuses the same in-flight cue geometry",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    advancingHelpers.testGeometryRequests.map((request) => request.cue.timeMs),
    [1100],
    "the in-flight request retains its first live render time",
  );
  resolveAdvancingGeometry(
    geometryResponse(advancingHelpers.testGeometryRequests[0]),
  );
  await waitForLayout();
  assert(
    advancingHelpers.nativeAssGeometrySnapshot({
      ...geometryRequest,
      cue: { ...geometryRequest.cue, timeMs: 1600 },
    }).ok,
    "a completed same-cue response is reused at a later live time",
  );
  advancingHelpers.nativeAssGeometrySnapshot({
    ...geometryRequest,
    cue: { ...geometryRequest.cue, endMs: 2100, timeMs: 1700 },
  });
  advancingHelpers.nativeAssGeometrySnapshot({
    ...geometryRequest,
    renderer: { ...geometryRequest.renderer, width: 1279 },
  });
  await waitForLayout();
  assertEqual(
    advancingHelpers.testGeometryRequests.length,
    3,
    "cue boundaries and renderer changes each invalidate geometry identity",
  );

  const concurrentGeometryResolvers = Object.create(null);
  const concurrentGeometryHelpers = loadMainNativeHelpers({
    __geometryResponse(request) {
      return new Promise((resolve) => {
        concurrentGeometryResolvers[request.cue.observedAss] = () =>
          resolve(geometryResponse(request));
      });
    },
  });
  const concurrentGeometryA = {
    ...geometryRequest,
    cue: { ...geometryRequest.cue, observedAss: "primary" },
  };
  const concurrentGeometryB = {
    ...geometryRequest,
    cue: { ...geometryRequest.cue, observedAss: "secondary" },
  };
  concurrentGeometryHelpers.nativeAssGeometrySnapshot(concurrentGeometryA);
  concurrentGeometryHelpers.nativeAssGeometrySnapshot(concurrentGeometryB);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    Object.keys(concurrentGeometryResolvers).sort(),
    ["primary", "secondary"],
    "independent subtitle surfaces may hold two geometry requests in flight",
  );
  concurrentGeometryResolvers.secondary();
  await waitForLayout();
  assert(
    concurrentGeometryHelpers.nativeAssGeometrySnapshot(concurrentGeometryB).ok,
    "the second geometry key may complete before the first",
  );
  assertEqual(
    concurrentGeometryHelpers.nativeAssGeometrySnapshot(concurrentGeometryA)
      .reason,
    "ass-geometry-pending",
    "an out-of-order sibling completion does not cancel the first key",
  );
  concurrentGeometryResolvers.primary();
  await waitForLayout();
  assert(
    concurrentGeometryHelpers.nativeAssGeometrySnapshot(concurrentGeometryA).ok,
    "both out-of-order geometry keys remain independently cached",
  );

  let resolveStaleGeometry;
  let generationCalls = 0;
  const generationHelpers = loadMainNativeHelpers({
    __geometryResponse(request) {
      generationCalls++;
      if (generationCalls > 1) return geometryResponse(request);
      return new Promise((resolve) => {
        resolveStaleGeometry = resolve;
      });
    },
  });
  generationHelpers.nativeAssGeometrySnapshot(geometryRequest);
  await new Promise((resolve) => setTimeout(resolve, 0));
  generationHelpers.advanceNativeAssGeometryGeneration();
  resolveStaleGeometry(geometryResponse(geometryRequest));
  await waitForLayout();
  assertEqual(
    generationHelpers.nativeAssGeometrySnapshot(geometryRequest).reason,
    "ass-geometry-pending",
    "generation invalidation discards a deferred stale response",
  );
  await waitForLayout();
  assertEqual(
    generationHelpers.testGeometryRequests.length,
    2,
    "generation invalidation launches one fresh geometry request",
  );

  const retryClock = { now: 0 };
  let retryCalls = 0;
  const retryHelpers = loadMainNativeHelpers({
    __clock: retryClock,
    __geometryResponse(request) {
      retryCalls++;
      return retryCalls === 1
        ? { ok: false, protocol: 1, reason: "media-open-failed" }
        : geometryResponse(request);
    },
  });
  assertEqual(
    retryHelpers.nativeAssGeometrySnapshot(geometryRequest).reason,
    "ass-geometry-pending",
    "an initial URL reopen starts one geometry request",
  );
  await waitForLayout();
  assertEqual(
    retryHelpers.nativeAssGeometrySnapshot(geometryRequest),
    { reason: "media-open-failed", retryScheduled: true },
    "an early media-open failure is retained only as bounded retry state",
  );
  retryClock.now = 119;
  retryHelpers.nativeAssGeometrySnapshot(geometryRequest);
  await waitForLayout();
  assertEqual(
    retryHelpers.testGeometryRequests.length,
    1,
    "polling before the retry boundary does not duplicate geometry requests",
  );
  retryClock.now = 120;
  assertEqual(
    retryHelpers.nativeAssGeometrySnapshot(geometryRequest).reason,
    "ass-geometry-pending",
    "the bounded retry starts when the media source can be reopened",
  );
  await waitForLayout();
  assert(
    retryHelpers.nativeAssGeometrySnapshot(geometryRequest).ok,
    "a successful retry replaces failure state with reusable geometry",
  );
  assertEqual(
    retryHelpers.testGeometryRequests.length,
    2,
    "startup recovery needs no toggle-driven geometry generation",
  );

  const boundedClock = { now: 0 };
  const boundedRetryHelpers = loadMainNativeHelpers({
    __clock: boundedClock,
    __geometryResponse() {
      return { ok: false, protocol: 1, reason: "media-open-failed" };
    },
  });
  for (const retryAt of [0, 120, 420, 1170]) {
    boundedClock.now = retryAt;
    boundedRetryHelpers.nativeAssGeometrySnapshot(geometryRequest);
    await waitForLayout();
  }
  boundedClock.now = 10000;
  assertEqual(
    boundedRetryHelpers.nativeAssGeometrySnapshot(geometryRequest),
    { reason: "media-open-failed", retryScheduled: false },
    "a persistently unavailable stream stops after the bounded retry budget",
  );
  assertEqual(
    boundedRetryHelpers.testGeometryRequests.length,
    4,
    "normal subtitle polling cannot turn a persistent failure into an uncontrolled request loop",
  );

  let resolveWebpageGeometry;
  const resolvedSourceHelpers = loadMainNativeHelpers({
    ...authoredAssProperties,
    path: "https://watch.example.invalid/page",
    "stream-open-filename": "",
    "sub-text": "Bonjour",
    "track-list": [
      {
        ...authoredAssProperties["track-list"][0],
        external: false,
        "external-filename": "",
      },
    ],
    __geometryResponse(request) {
      if (request.source.path.includes("watch.example"))
        return new Promise((resolve) => {
          resolveWebpageGeometry = resolve;
        });
      return geometryResponse(request);
    },
  });
  assertEqual(
    resolvedSourceHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "ass-geometry-pending",
    "a webpage-like startup path publishes no premature geometry",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  resolvedSourceHelpers.testValues["stream-open-filename"] =
    "https://cdn.example.invalid/video.mkv?signature=resolved";
  resolvedSourceHelpers.advanceNativeAssGeometryGeneration();
  assertEqual(
    resolvedSourceHelpers.nativeSubtitleCueSnapshot("Bonjour").reason,
    "ass-geometry-pending",
    "resolved-source invalidation launches fresh geometry automatically",
  );
  await waitForLayout();
  assertEqual(
    resolvedSourceHelpers.nativeSubtitleCueSnapshot("Bonjour").kind,
    "ass-native",
    "the resolved media URL produces native geometry without a toggle",
  );
  resolveWebpageGeometry({
    ok: false,
    protocol: 1,
    reason: "unsupported-container",
  });
  await waitForLayout();
  assertEqual(
    resolvedSourceHelpers.nativeSubtitleCueSnapshot("Bonjour").kind,
    "ass-native",
    "a stale webpage response cannot replace resolved-stream geometry",
  );
  assertEqual(
    resolvedSourceHelpers.testGeometryRequests.map(
      (request) => request.source.path,
    ),
    [
      "https://watch.example.invalid/page",
      "https://cdn.example.invalid/video.mkv?signature=resolved",
    ],
    "the lifecycle switches from the original webpage candidate to mpv's resolved URL",
  );

  const privateUrl =
    "https://cdn.example.invalid/video.mkv?token=never-log-this";
  const diagnosticHelpers = loadMainNativeHelpers({
    ...authoredAssProperties,
    path: "https://watch.example.invalid/page?cookie=never-log-this",
    "stream-open-filename": privateUrl,
    "sub-text": "Bonjour",
    "track-list": [
      {
        ...authoredAssProperties["track-list"][0],
        external: false,
        "external-filename": "",
        "ff-index": undefined,
      },
    ],
    "time-pos": undefined,
    "sub-start": undefined,
    "sub-end": undefined,
  });
  const diagnosticSnapshot =
    diagnosticHelpers.nativeSubtitleCombinedCueSnapshot();
  diagnosticHelpers.reportNativeAssReadiness(diagnosticSnapshot);
  const readinessLog = diagnosticHelpers.testFontMetricLogs.find((line) =>
    line.includes("native ASS readiness"),
  );
  assert(
    readinessLog &&
      readinessLog.includes('"sourceClass":"resolved-url"') &&
      readinessLog.includes('"reason":"cue-timing-unavailable"') &&
      readinessLog.includes('"retryScheduled":true'),
    "structured readiness logs identify a resolved URL and retryable rejection",
  );
  assert(
    !readinessLog.includes("never-log-this") &&
      !readinessLog.includes("cdn.example") &&
      !readinessLog.includes("watch.example") &&
      !readinessLog.includes("Bonjour"),
    "native readiness diagnostics contain no URL, query, credential, or subtitle text",
  );

  let emptyMetricExecCount = 0;
  [
    { displayText: "", lookupText: "" },
    { displayText: "", lookupText: "lookup-only" },
    { displayText: "display-only", lookupText: "" },
  ].forEach((cue) => {
    const emptySnapshotHelpers = loadMainNativeHelpers({
      __useActualFontMetricResolver: true,
      __fontMetricExec() {
        emptyMetricExecCount++;
        throw new Error("empty cues must not launch native font metrics");
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
      "sub-text": cue.displayText,
      "sub-font": "YuMin-Medium",
      "options/sub-font": "YuMin-Medium",
      languageId: "ja",
    });
    assertEqual(
      emptySnapshotHelpers.nativeSubtitleCueSnapshot(cue.lookupText).reason,
      "empty-subtitle",
      "an empty display or lookup representation fails closed before measurement",
    );
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    emptyMetricExecCount,
    0,
    "empty cues launch zero native font metric helper processes",
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

  const concurrentMetricLoads = [];
  const concurrentMetricHelpers = loadMainNativeHelpers({
    __useActualFontMetricResolver: true,
    __fontMetricExec(_command, args) {
      return new Promise((resolve) =>
        concurrentMetricLoads.push({ args: Array.from(args), resolve }),
      );
    },
  });
  const concurrentMetricA = {
    font: "YuMin-Medium",
    effectiveFont: "YuMin-Medium",
    bold: false,
    italic: false,
  };
  const concurrentMetricB = {
    font: "Helvetica",
    effectiveFont: "Helvetica",
    bold: false,
    italic: false,
  };
  concurrentMetricHelpers.nativeSubtitleFontMetricSnapshot(
    concurrentMetricA,
    "日本",
  );
  concurrentMetricHelpers.nativeSubtitleFontMetricSnapshot(
    concurrentMetricB,
    "Latin",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    concurrentMetricLoads.length,
    2,
    "two subtitle surfaces may resolve distinct font metrics concurrently",
  );
  concurrentMetricLoads[1].resolve({
    status: 0,
    stdout: JSON.stringify(backendFontMetricResult("Helvetica", 950, 250)),
    stderr: "",
  });
  await waitForLayout();
  assert(
    concurrentMetricHelpers.nativeSubtitleFontMetricSnapshot(
      concurrentMetricB,
      "Latin",
    ).ok,
    "the second font metric key may complete first",
  );
  assertEqual(
    concurrentMetricHelpers.nativeSubtitleFontMetricSnapshot(
      concurrentMetricA,
      "日本",
    ).reason,
    "font-metrics-pending",
    "one font completion does not cancel its pending sibling",
  );
  concurrentMetricLoads[0].resolve({
    status: 0,
    stdout: JSON.stringify(backendFontMetricResult("YuMin-Medium", 1295, 367)),
    stderr: "",
  });
  await waitForLayout();
  assert(
    concurrentMetricHelpers.nativeSubtitleFontMetricSnapshot(
      concurrentMetricA,
      "日本",
    ).ok,
    "both out-of-order font metric keys remain cached",
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
  staleMetricHelpers.advanceNativeSubtitleFontMetricGeneration();
  assert(
    staleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "日本")
      .ok && staleMetricLoads.length === 2,
    "lifecycle generation changes preserve verified metric cache entries",
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
    "deterministic face/coverage failures remain cached and fail closed",
  );
  assertEqual(
    failedMetricExecCount,
    1,
    "deterministic face/coverage failures are not retried",
  );
  assert(
    failedMetricHelpers.testFontMetricLogs.some(
      (line) =>
        line.includes("code=font-metrics-cue-not-covered") &&
        line.includes("retryable=false") &&
        !line.includes("日本"),
    ),
    "font metric diagnostics identify deterministic failures without cue text",
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

  const transientClock = { now: 1000 };
  let transientMetricExecCount = 0;
  const transientMetricHelpers = loadMainNativeHelpers({
    __useActualFontMetricResolver: true,
    __clock: transientClock,
    async __fontMetricExec() {
      transientMetricExecCount++;
      if (transientMetricExecCount === 1)
        return { status: 1, stdout: "", stderr: "temporary exec failure" };
      return {
        status: 0,
        stdout: JSON.stringify(
          backendFontMetricResult("YuKyo-Medium", 1085, 376),
        ),
        stderr: "",
      };
    },
  });
  assertEqual(
    transientMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "次")
      .reason,
    "font-metrics-pending",
    "the next cue begins a transient metric request",
  );
  await waitForLayout();
  assertEqual(
    transientMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "次")
      .reason,
    "font-metrics-pending",
    "a transient failure remains pending during bounded backoff",
  );
  assertEqual(
    transientMetricExecCount,
    1,
    "the 120ms subtitle poll cannot hot-loop the native helper during backoff",
  );
  transientClock.now += 500;
  assertEqual(
    transientMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "次")
      .reason,
    "font-metrics-pending",
    "the transient request retries after its bounded backoff",
  );
  await waitForLayout();
  assert(
    transientMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "次")
      .ok,
    "the next cue recovers when its one transient retry succeeds",
  );
  assertEqual(
    transientMetricExecCount,
    2,
    "a recovered next cue uses exactly one retry",
  );
  assert(
    transientMetricHelpers.testFontMetricLogs.some(
      (line) =>
        line.includes("code=font-metrics-command-failed") &&
        line.includes("retryable=true") &&
        !line.includes("次"),
    ),
    "transient diagnostics preserve cue privacy",
  );

  const toggleClock = { now: 2000 };
  let toggleMetricExecCount = 0;
  const toggleMetricHelpers = loadMainNativeHelpers({
    __useActualFontMetricResolver: true,
    __clock: toggleClock,
    async __fontMetricExec() {
      toggleMetricExecCount++;
      return { status: 1, stdout: "", stderr: "temporary exec failure" };
    },
  });
  assertEqual(
    toggleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "復帰")
      .reason,
    "font-metrics-pending",
    "toggle recovery starts from a transient request",
  );
  await waitForLayout();
  toggleClock.now += 500;
  assertEqual(
    toggleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "復帰")
      .reason,
    "font-metrics-pending",
    "the transient request uses its bounded retry",
  );
  await waitForLayout();
  assertEqual(
    toggleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "復帰")
      .reason,
    "font-metrics-unavailable",
    "two transient failures stop retrying in the current generation",
  );
  toggleMetricHelpers.advanceNativeSubtitleFontMetricGeneration();
  assertEqual(
    toggleMetricHelpers.nativeSubtitleFontMetricSnapshot(yuKyoOptions, "復帰")
      .reason,
    "font-metrics-pending",
    "Shift+H's fresh lifecycle generation clears failed retry state",
  );
  await waitForLayout();
  assertEqual(
    toggleMetricExecCount,
    3,
    "toggle recovery starts one fresh metric request without touching verified caches",
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
  const nativeSubtitleSource = fs.readFileSync(
    path.join(root, "src/main/12_native_subtitle_hit_layer.js"),
    "utf8",
  );
  assert(
    /mpv\.command\("screenshot-to-file", \[videoPath, "video"\]\)/.test(
      nativeSubtitleSource,
    ) &&
      /mpv\.command\("screenshot-to-file", \[\s*subtitlePath,\s*"subtitles",?\s*\]\)/.test(
        nativeSubtitleSource,
      ),
    "bitmap OCR fallback uses screenshot-to-file flags supported by mpv 0.38",
  );
  assert(
    !/screenshot-to-file[\s\S]{0,120}(?:video|subtitles)\+scaled/.test(
      nativeSubtitleSource,
    ),
    "bitmap OCR fallback does not pass unsupported scaled combinations to screenshot-to-file",
  );
  const lifecycleSource = fs.readFileSync(
    path.join(root, "src/main/60_overlay_lifecycle_toggle.js"),
    "utf8",
  );
  assert(
    /function prepareRuntimeAfterProfileChange\(runtimePlan\)[\s\S]*?if \(plan\.geometryCache\) \{\s*advanceNativeSubtitleFontMetricGeneration\(\);\s*invalidateCurrentSubtitleLookupLine\(\)/.test(
      lifecycleSource,
    ),
    "profile changes advance font metrics and invalidate the prior lookup line",
  );
  assert(
    /function setEnabled\(next, options\)[\s\S]*?enabled = requested;[\s\S]*?if \(enabled !== wasEnabled\) \{[\s\S]*?advanceNativeSubtitleFontMetricGeneration\(\);\s*invalidateCurrentSubtitleLookupLine\(\)/.test(
      lifecycleSource,
    ),
    "Shift+H lifecycle transitions advance metrics and invalidate the prior lookup line",
  );
  assert(
    /function stopPolling\(\)[\s\S]*?lookupInFlight = Object\.create\(null\);\s*invalidateCurrentSubtitleLookupLine\(\)/.test(
      lifecycleSource,
    ),
    "stopping playback polling invalidates the prior lookup line",
  );
  const initializeOverlaySource = lifecycleSource.slice(
    0,
    lifecycleSource.indexOf("function prepareRuntimeAfterProfileChange"),
  );
  function loadInitializeOverlayHarness(enabledValue, synchronousReady) {
    const handlers = Object.create(null);
    const events = [];
    const acceptedPosts = [];
    const droppedPosts = [];
    let documentReady = false;
    let pollCalls = 0;
    const context = {
      console,
      JSON,
      VERSION: "test",
      enabled: enabledValue,
      initialized: false,
      overlayDocumentReady: false,
      overlayRuntimeState: enabledValue ? "enabling" : "disabled",
      overlayLifecycleGeneration: 1,
      overlayEnableStartedAt: 0,
      overlayRuntimeReadyAt: 0,
      overlayFirstHitLayerAt: 0,
      overlayHitLayerReady: false,
      nativeGeometrySessionReady: false,
      activeWorkerReady: enabledValue ? {} : null,
      lastSubtitleCueIdentity: "cached-cue",
      lastNativeLayoutFingerprint: "preserved-layout",
      nativeLayoutStablePolls: 7,
      ensureOverlayBridge() {},
      debugLog() {},
      verboseLogEnabled() {
        return false;
      },
      currentMediaSourceSnapshot() {
        return { primary: { raw: "/video.mkv" } };
      },
      mpvStringProp(names) {
        if (names.indexOf("path") >= 0) return "/video.mkv";
        if (names.indexOf("sub-text") >= 0) return "current cue";
        return "";
      },
      handleLookupPopupOverlayReady() {},
      overlayConfig() {
        return { test: true };
      },
      replayActiveOverlayTask() {
        events.push("replay");
      },
      postToOverlay(name, payload) {
        const target = documentReady ? acceptedPosts : droppedPosts;
        target.push({ name, payload });
      },
      pollSubtitle() {
        pollCalls++;
        if (context.lastSubtitleCueIdentity !== null) return;
        context.postToOverlay("subtitle", { text: "current cue" });
      },
      overlay: {
        onMessage(name, callback) {
          events.push("on:" + name);
          handlers[name] = callback;
        },
        loadFile() {
          events.push("load");
          if (synchronousReady) {
            documentReady = true;
            handlers.ready({ synchronous: true });
          }
        },
        setOpacity() {},
        setClickable() {},
        show() {},
      },
    };
    vm.createContext(context);
    vm.runInContext(
      initializeOverlaySource +
        ";globalThis.initializeOverlayApi={initializeOverlay};",
      context,
    );
    return {
      context,
      events,
      acceptedPosts,
      droppedPosts,
      handlers,
      initialize() {
        context.initializeOverlayApi.initializeOverlay();
      },
      fireReady() {
        documentReady = true;
        handlers.ready({ synchronous: false });
      },
      pollCalls() {
        return pollCalls;
      },
    };
  }

  const synchronousReady = loadInitializeOverlayHarness(true, true);
  synchronousReady.initialize();
  assert(
    synchronousReady.events.indexOf("on:ready") <
      synchronousReady.events.indexOf("load") &&
      synchronousReady.events.indexOf("on:anki-card-open") <
        synchronousReady.events.indexOf("load"),
    "all overlay message handlers are registered before a synchronous load",
  );
  assert(
    synchronousReady.acceptedPosts.some(
      (message) => message.name === "subtitle",
    ),
    "a synchronous ready event republishes the current subtitle",
  );
  synchronousReady.initialize();
  assertEqual(
    synchronousReady.events.filter((eventName) => eventName === "load").length,
    1,
    "repeated initialization remains idempotent after synchronous ready",
  );

  const asynchronousReady = loadInitializeOverlayHarness(true, false);
  asynchronousReady.initialize();
  asynchronousReady.context.postToOverlay("config", { premature: true });
  assertEqual(
    asynchronousReady.droppedPosts.length,
    1,
    "the harness drops messages sent before the overlay document is ready",
  );
  asynchronousReady.fireReady();
  assertEqual(
    asynchronousReady.acceptedPosts.map((message) => message.name),
    ["config", "enabled", "subtitle"],
    "ready publishes configuration, enabled state, and a fresh current cue",
  );
  assertEqual(
    {
      identity: asynchronousReady.context.lastSubtitleCueIdentity,
      fingerprint: asynchronousReady.context.lastNativeLayoutFingerprint,
      stablePolls: asynchronousReady.context.nativeLayoutStablePolls,
    },
    {
      identity: null,
      fingerprint: "preserved-layout",
      stablePolls: 7,
    },
    "ready clears only cached cue identity while preserving native layout state",
  );

  const disabledReady = loadInitializeOverlayHarness(false, false);
  disabledReady.initialize();
  disabledReady.fireReady();
  assertEqual(
    disabledReady.pollCalls(),
    0,
    "a disabled overlay ready event does not poll or publish a subtitle",
  );
  const readSubtitleSource = subtitleStyleSource.slice(
    subtitleStyleSource.indexOf("function readCurrentSubtitle"),
    subtitleStyleSource.indexOf("function cleanNativeDisplayText"),
  );
  let readSubtitleInput = "Cafe\u0301 Ａ";
  let readSubtitleLanguage = {
    id: "fr",
    normalizeText(text) {
      return String(text || "").normalize("NFKC");
    },
  };
  const readSubtitleContext = {
    mpv: {
      getString() {
        return readSubtitleInput;
      },
    },
    cleanSubtitleText(text) {
      return String(text || "");
    },
    prefBool(_name, fallback) {
      return fallback;
    },
    selectedLanguageModule() {
      return readSubtitleLanguage;
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
  readSubtitleLanguage = {
    id: "ja",
    normalizeSubtitleText(text) {
      return String(text || "");
    },
    normalizeText(text) {
      return String(text || "");
    },
  };
  japaneseCueSequence.forEach((cue, index) => {
    readSubtitleInput = cue.displayText;
    assertEqual(
      readSubtitleContext.readSubtitleApi.readCurrentSubtitle(),
      cue.displayText,
      "legacy Japanese cue " + (index + 1) + " remains byte-for-byte unchanged",
    );
    assertEqual(
      readSubtitleContext.readSubtitleApi.readExperimentalLookupSubtitle(),
      cue.lookupText,
      "experimental Japanese cue " +
        (index + 1) +
        " receives final common canonicalization",
    );
  });
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
    overlayHitLayerReady: false,
    nativeGeometrySessionReady: false,
    overlayLifecycleGeneration: 0,
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
    nativeSubtitleHitLayerMode() {
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

  const bridgePauseSource = fs.readFileSync(
    path.join(root, "src/main/50_overlay_bridge_pause.js"),
    "utf8",
  );
  const backendLookupSource = fs.readFileSync(
    path.join(root, "src/main/30_backend_import_worker_lookup.js"),
    "utf8",
  );
  const subtitleCleaningSource = subtitleStyleSource.slice(
    0,
    subtitleStyleSource.indexOf("function isJapaneseish"),
  );
  const lookupAtPositionSource = backendLookupSource.slice(
    backendLookupSource.indexOf("function canonicalSubtitleLookupInput"),
    backendLookupSource.indexOf("function parseLookupPayload"),
  );
  const publishHandoffSource = subtitleStyleSource.slice(
    subtitleStyleSource.indexOf(
      "function resetExperimentalSubtitleLookupBinding",
    ),
    subtitleStyleSource.indexOf(
      "function canHideNativeSubtitlesForCurrentLanguage",
    ),
  );
  const hoverLookupHandoffSource = bridgePauseSource.slice(
    bridgePauseSource.indexOf("function resetHoverLookupQueue"),
    bridgePauseSource.indexOf("function pauseState"),
  );
  const profileResetSource = lifecycleSource.slice(
    lifecycleSource.indexOf("function normalizedProfileRuntimePlan"),
    lifecycleSource.indexOf("function warmActiveProfileBackend"),
  );
  let experimentalBridgeMode = true;
  let bridgeLanguageNormalizationCalls = 0;
  const backendLookupRequests = [];
  const bridgePosts = [];
  const bridgeLanguage = {
    id: "ja",
    normalizeText(text) {
      bridgeLanguageNormalizationCalls++;
      return String(text || "");
    },
    lookupRequest(text, position) {
      backendLookupRequests.push({ text, position });
      return null;
    },
    hasLookupText(text) {
      return !!String(text || "");
    },
  };
  const bridgeContext = {
    console,
    JSON,
    Object,
    Array,
    Promise,
    Date,
    Math,
    Number,
    String,
    enabled: true,
    subtitleLineSerial: 40,
    currentSubtitleLineId: 0,
    experimentalSubtitleLookupBinding: null,
    lastSubtitle: null,
    requestSerial: 0,
    hoverLookupInFlight: false,
    pendingHoverLookup: null,
    hoverLookupSequence: 0,
    hoverLookupGeneration: 0,
    hoverLookupActiveKey: "",
    lookupBackendReadyForNativeHide: true,
    lookupInFlight: Object.create(null),
    lookupCache: Object.create(null),
    lastSubtitleCueIdentity: null,
    lastNativeLayoutFingerprint: "",
    nativeLayoutStablePolls: 0,
    overlayLifecycleGeneration: 1,
    overlayHitLayerReady: true,
    nativeGeometrySessionReady: true,
    experimentalNativeSubtitleMode() {
      return experimentalBridgeMode;
    },
    nativeSubtitleHitLayerMode() {
      return experimentalBridgeMode;
    },
    selectedLanguageModule() {
      return bridgeLanguage;
    },
    activeDictionaryPaths() {
      return [];
    },
    overlayConfig() {
      return {};
    },
    postToOverlay(name, payload) {
      bridgePosts.push({ name, payload });
    },
    debugVerbose() {},
    debugLog() {},
    setOverlayRuntimeState() {},
    compactError(error) {
      return String(error);
    },
    prefBool(_name, fallback) {
      return fallback;
    },
    prefNumber(_name, fallback) {
      return fallback;
    },
    charsOf(text) {
      return Array.from(String(text || ""));
    },
    advanceNativeSubtitleFontMetricGeneration() {},
    resetLookupPopupPause() {},
  };
  vm.createContext(bridgeContext);
  vm.runInContext(
    subtitleCleaningSource +
      lookupAtPositionSource +
      publishHandoffSource +
      hoverLookupHandoffSource +
      profileResetSource +
      ";globalThis.bridgeApi={" +
      "publishSubtitle,handleBridgeLookup,invalidateCurrentSubtitleLookupLine," +
      "prepareRuntimeAfterProfileChange," +
      "getCurrentLineId:()=>currentSubtitleLineId," +
      "getExperimentalBinding:()=>experimentalSubtitleLookupBinding};",
    bridgeContext,
  );
  const experimentalBridgeCases = [
    {
      requestId: "experimental-after-ellipsis",
      displayText: japaneseCueSequence[2].displayText,
      lookupText: japaneseCueSequence[2].lookupText,
      position: 13,
    },
    {
      requestId: "experimental-after-angle-tag",
      displayText: "＜漢字＞ 油",
      lookupText: "<漢字> 油",
      position: 5,
    },
    {
      requestId: "experimental-after-entity",
      displayText: "＆ａｍｐ；油",
      lookupText: "&amp;油",
      position: 5,
    },
    {
      requestId: "experimental-after-ass-break",
      displayText: "＼Ｎ油",
      lookupText: "\\N油",
      position: 2,
    },
  ];
  for (const cue of experimentalBridgeCases) {
    bridgeContext.lastSubtitle = cue.displayText;
    bridgeContext.bridgeApi.publishSubtitle(cue.displayText, {
      lookupText: cue.lookupText,
      displayText: cue.displayText,
      lookupSpans: [],
      layout: {},
    });
    const lineId = bridgeContext.bridgeApi.getCurrentLineId();
    bridgeContext.bridgeApi.handleBridgeLookup({
      requestId: cue.requestId,
      lineId,
      position: cue.position,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = backendLookupRequests[backendLookupRequests.length - 1];
    assertEqual(
      request,
      { text: cue.lookupText, position: cue.position },
      cue.requestId + " reaches lookupAtPosition without a second clean pass",
    );
    assertEqual(
      request.text.slice(request.position, request.position + 1),
      "油",
      cue.requestId + " retains the canonical target position",
    );
  }
  assertEqual(
    bridgeLanguageNormalizationCalls,
    0,
    "canonical experimental inputs bypass language normalization as well as presentation cleaning",
  );

  experimentalBridgeMode = false;
  const legacyBoundaryText = "＜漢字＞ 油";
  bridgeContext.lastSubtitle = legacyBoundaryText;
  bridgeContext.bridgeApi.publishSubtitle(legacyBoundaryText, null);
  const legacyBridgeLine = bridgeContext.bridgeApi.getCurrentLineId();
  bridgeContext.bridgeApi.handleBridgeLookup({
    requestId: "legacy-cleaning-path",
    lineId: legacyBridgeLine,
    position: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    backendLookupRequests[backendLookupRequests.length - 1],
    { text: legacyBoundaryText, position: 5 },
    "legacy bridge lookups continue through the existing presentation-cleaning path",
  );
  assertEqual(
    bridgeLanguageNormalizationCalls,
    1,
    "legacy bridge lookup still performs language normalization exactly once",
  );

  experimentalBridgeMode = true;
  bridgeContext.bridgeApi.invalidateCurrentSubtitleLookupLine();
  const missingBindingLine = bridgeContext.bridgeApi.getCurrentLineId();
  assertEqual(
    bridgeContext.bridgeApi.getExperimentalBinding(),
    null,
    "lifecycle invalidation clears the experimental line binding",
  );
  bridgeContext.bridgeApi.handleBridgeLookup({
    requestId: "missing-experimental-binding",
    lineId: missingBindingLine,
    position: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    backendLookupRequests.length,
    experimentalBridgeCases.length + 1,
    "a current experimental line without its canonical binding cannot fall back to lastSubtitle",
  );
  assert(
    bridgePosts.some(
      (message) =>
        message.name === "line-lookup-result" &&
        message.payload &&
        message.payload.lineId === missingBindingLine &&
        message.payload.ok === false &&
        /canonical subtitle lookup text/i.test(message.payload.error),
    ),
    "a missing canonical line binding fails closed at the bridge boundary",
  );

  let releaseOldOwnershipLookup;
  const oldOwnershipLookup = new Promise((resolve) => {
    releaseOldOwnershipLookup = resolve;
  });
  let activeOwnershipLookups = 0;
  let maxOwnershipLookupConcurrency = 0;
  const ownershipLookupCalls = [];
  bridgeContext.lookupAtPosition = async (input, position, requestId) => {
    activeOwnershipLookups++;
    maxOwnershipLookupConcurrency = Math.max(
      maxOwnershipLookupConcurrency,
      activeOwnershipLookups,
    );
    ownershipLookupCalls.push({
      text: input && typeof input === "object" ? input.text : input,
      position,
      requestId,
    });
    if (requestId === "old-profile-lookup") await oldOwnershipLookup;
    activeOwnershipLookups--;
    return { ok: true, position, results: [] };
  };
  bridgeContext.lastSubtitle = "旧";
  bridgeContext.bridgeApi.publishSubtitle("旧", {
    lookupText: "旧",
    displayText: "旧",
  });
  const oldOwnershipLine = bridgeContext.bridgeApi.getCurrentLineId();
  bridgeContext.bridgeApi.handleBridgeLookup({
    requestId: "old-profile-lookup",
    lineId: oldOwnershipLine,
    position: 0,
  });
  bridgeContext.bridgeApi.prepareRuntimeAfterProfileChange();
  bridgeContext.lastSubtitle = "新";
  bridgeContext.bridgeApi.publishSubtitle("新", {
    lookupText: "新",
    displayText: "新",
  });
  const newOwnershipLine = bridgeContext.bridgeApi.getCurrentLineId();
  bridgeContext.bridgeApi.handleBridgeLookup({
    requestId: "new-profile-lookup",
    lineId: newOwnershipLine,
    position: 0,
  });
  assertEqual(
    ownershipLookupCalls.length,
    1,
    "a new profile lookup waits while the old queue owner is still awaiting",
  );
  assertEqual(
    maxOwnershipLookupConcurrency,
    1,
    "profile reset never creates a second concurrent hover lookup owner",
  );
  releaseOldOwnershipLookup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEqual(
    ownershipLookupCalls,
    [
      { text: "旧", position: 0, requestId: "old-profile-lookup" },
      { text: "新", position: 0, requestId: "new-profile-lookup" },
    ],
    "the durable owner drains the new profile job after the old lookup settles",
  );
  assertEqual(
    maxOwnershipLookupConcurrency,
    1,
    "old and new profile backend lookups remain serialized",
  );
  const ownershipResults = bridgePosts.filter(
    (message) =>
      message.name === "line-lookup-result" &&
      message.payload &&
      message.payload.ok === true &&
      (message.payload.requestId === "old-profile-lookup" ||
        message.payload.requestId === "new-profile-lookup"),
  );
  assertEqual(
    ownershipResults.map((message) => message.payload.requestId),
    ["new-profile-lookup"],
    "only the current profile lookup result is posted after ownership handoff",
  );

  const managerSource = fs.readFileSync(
    path.join(root, "src/dictionary-manager/dictionary-manager.html"),
    "utf8",
  );
  const valueHelpersStart = managerSource.indexOf(
    "    function setControlValue(control, value)",
  );
  const valueHelpersSource = managerSource.slice(
    valueHelpersStart,
    managerSource.indexOf(
      "    function collectProfilePreferences()",
      valueHelpersStart,
    ),
  );
  const updateBusySource = managerSource.slice(
    managerSource.indexOf("    function updateBusyState()"),
    managerSource.indexOf("    function dictionaryMeta"),
  );
  const syncControlsStart = managerSource.indexOf(
    "    function syncNativeSubtitleControls()",
  );
  const syncControlsSource = managerSource.slice(
    syncControlsStart,
    managerSource.indexOf("    function renderRecommended", syncControlsStart),
  );
  const legacyModeControl = {
    checked: true,
    disabled: false,
    type: "checkbox",
    dataset: { profilePrefInvert: "true" },
  };
  const highlightControl = { checked: true, disabled: false };
  const boxesControl = { checked: true, disabled: false };
  const opacityControl = { value: "0.65", disabled: false };
  const hideNativeControl = { checked: true, disabled: false, title: "" };
  const preferenceControls = [
    legacyModeControl,
    highlightControl,
    boxesControl,
    opacityControl,
    hideNativeControl,
  ];
  const managerElements = {
    legacySubtitleMode: legacyModeControl,
    experimentalNativeSubtitleLookupHighlight: highlightControl,
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
    valueHelpersSource +
      updateBusySource +
      syncControlsSource +
      ";globalThis.controlsApi={updateBusyState,setControlValue,readControlValue};",
    managerContext,
  );
  managerContext.controlsApi.setControlValue(legacyModeControl, false);
  assert(
    legacyModeControl.checked &&
      managerContext.controlsApi.readControlValue(legacyModeControl) === false,
    "a disabled native layer is presented as enabled legacy mode",
  );
  managerContext.controlsApi.setControlValue(legacyModeControl, true);
  assert(
    !legacyModeControl.checked &&
      managerContext.controlsApi.readControlValue(legacyModeControl) === true,
    "an enabled native layer is presented as disabled legacy mode",
  );
  managerContext.controlsApi.setControlValue(legacyModeControl, false);
  managerContext.controlsApi.updateBusyState();
  assert(
    highlightControl.disabled &&
      boxesControl.disabled &&
      opacityControl.disabled,
    "native subtitle controls remain disabled in legacy mode",
  );
  assert(
    highlightControl.checked &&
      boxesControl.checked &&
      opacityControl.value === "0.65",
    "disabled native-layer controls retain their stored values",
  );
  assert(
    !hideNativeControl.disabled,
    "legacy native visibility control remains enabled in legacy mode",
  );
  legacyModeControl.checked = false;
  managerContext.controlsApi.updateBusyState();
  assert(
    !highlightControl.disabled &&
      !boxesControl.disabled &&
      !opacityControl.disabled,
    "dependent native subtitle controls enable immediately outside legacy mode",
  );
  assert(
    hideNativeControl.disabled,
    "native hiding is disabled while native subtitle lookup owns visibility",
  );
  managerContext.state.busy = true;
  managerContext.controlsApi.updateBusyState();
  assert(
    highlightControl.disabled &&
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
  const liveFrenchBoxes = geometry.resolveHitBoxOverlaps(
    [
      {
        left: 566,
        top: 894,
        right: 719,
        bottom: 939,
        width: 153,
        height: 45,
        position: 0,
      },
      {
        left: 738,
        top: 893,
        right: 804,
        bottom: 939,
        width: 66,
        height: 46,
        position: 1,
      },
      {
        left: 827,
        top: 893,
        right: 871,
        bottom: 939,
        width: 44,
        height: 46,
        position: 2,
      },
      {
        left: 891,
        top: 893,
        right: 1098,
        bottom: 939,
        width: 207,
        height: 46,
        position: 3,
      },
      {
        left: 1119,
        top: 893,
        right: 1354,
        bottom: 939,
        width: 235,
        height: 46,
        position: 4,
      },
      {
        left: 757,
        top: 966,
        right: 803,
        bottom: 1008,
        width: 46,
        height: 42,
        position: 5,
      },
      {
        left: 859,
        top: 966,
        right: 972,
        bottom: 1008,
        width: 113,
        height: 42,
        position: 6,
      },
      {
        left: 1044,
        top: 963,
        right: 1193,
        bottom: 1009,
        width: 149,
        height: 46,
        position: 7,
      },
    ],
    2,
  );
  assertEqual(
    liveFrenchBoxes,
    [
      { left: 564, top: 892, width: 157, height: 49, position: 0 },
      { left: 736, top: 891, width: 70, height: 50, position: 1 },
      { left: 825, top: 891, width: 48, height: 50, position: 2 },
      { left: 889, top: 891, width: 211, height: 50, position: 3 },
      { left: 1117, top: 891, width: 239, height: 50, position: 4 },
      { left: 755, top: 964, width: 50, height: 46, position: 5 },
      { left: 857, top: 964, width: 117, height: 46, position: 6 },
      { left: 1042, top: 961, width: 153, height: 50, position: 7 },
    ],
    "all eight live French word boxes survive deterministic row clustering",
  );
  assertEqual(
    geometry
      .resolveHitBoxOverlaps(
        [
          {
            left: 50,
            top: 46,
            right: 70,
            bottom: 58,
            width: 20,
            height: 12,
            position: 2,
          },
          {
            left: 30,
            top: 12,
            right: 50,
            bottom: 26,
            width: 20,
            height: 14,
            position: 1,
          },
          {
            left: 10,
            top: 10,
            right: 32,
            bottom: 24,
            width: 22,
            height: 14,
            position: 0,
          },
        ],
        0,
      )
      .map((box) => box.position),
    [0, 1, 2],
    "multiline boxes cluster by visual row before horizontal order",
  );
  const cjkBoxes = geometry.resolveHitBoxOverlaps(
    [
      {
        left: 10,
        top: 10,
        right: 22,
        bottom: 30,
        width: 12,
        height: 20,
        position: 0,
      },
      {
        left: 20,
        top: 10,
        right: 32,
        bottom: 30,
        width: 12,
        height: 20,
        position: 1,
      },
      {
        left: 40,
        top: 10,
        right: 70,
        bottom: 30,
        width: 30,
        height: 20,
        position: 2,
      },
      {
        left: 50,
        top: 10,
        right: 60,
        bottom: 30,
        width: 10,
        height: 20,
        position: 3,
      },
    ],
    0,
  );
  assert(
    cjkBoxes.length === 4 &&
      cjkBoxes.every((box) => box.width > 0 && box.height > 0),
    "CJK overlap and containment preserve every lookup position",
  );
  assertEqual(
    geometry
      .resolveHitBoxOverlaps(
        [
          {
            left: 70,
            top: 10,
            right: 90,
            bottom: 30,
            width: 20,
            height: 20,
            position: 0,
          },
          {
            left: 40,
            top: 10,
            right: 62,
            bottom: 30,
            width: 22,
            height: 20,
            position: 1,
          },
          {
            left: 10,
            top: 10,
            right: 32,
            bottom: 30,
            width: 22,
            height: 20,
            position: 2,
          },
        ],
        0,
      )
      .map((box) => box.position),
    [2, 1, 0],
    "RTL logical positions are preserved in deterministic visual x-order",
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
    [0, 22, "translateX(-50%)", 0],
    [50, 360, "translateX(-50%) translateY(-50%)", 0.5],
    [100, 698, "translateX(-50%) translateY(-100%)", 1],
    [150, 698, "translateX(-50%) translateY(-100%)", 1],
  ].forEach(
    ([position, expectedTop, expectedTransform, translatedHeightRatio]) => {
      const secondaryTopPlacement = geometry.calculatePlainTextLayout(
        geometry.validateGeometry(
          { w: 1280, h: 720, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
          { width: 1280, height: 720 },
        ),
        Object.assign({}, alignmentBase, {
          alignY: "top",
          position,
          positionFromTop: true,
          marginY: 22,
          scaleByWindow: true,
          scaleWithWindow: true,
        }),
      );
      assertEqual(
        secondaryTopPlacement.top,
        expectedTop,
        "secondary-sub-pos=" +
          position +
          " moves converted text down from the top margin",
      );
      assertEqual(
        secondaryTopPlacement.transform,
        expectedTransform,
        "secondary-sub-pos=" +
          position +
          " anchors the complete rendered subtitle block",
      );
      const renderedHeight = 40;
      const visualTop =
        secondaryTopPlacement.top - renderedHeight * translatedHeightRatio;
      const visualBottom = visualTop + renderedHeight;
      assert(
        visualTop >= 0 && visualBottom <= 720,
        "secondary-sub-pos=" +
          position +
          " keeps a known rendered block inside the viewport",
      );
    },
  );
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
  let bootstrapGeometryGeneration = 0;
  let bootstrapLookupLineInvalidations = 0;
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
    nativeSubtitleLayoutTrigger: "startup",
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
    advanceNativeAssGeometryGeneration() {
      bootstrapGeometryGeneration++;
    },
    invalidateCurrentSubtitleLookupLine() {
      bootstrapLookupLineInvalidations++;
    },
    acquireNativeSubtitleVisibilityOwnership() {},
    startPolling() {},
    updateOverlayRuntimeState() {},
    setOverlayRuntimeState() {},
    debugWarn() {},
    initializeOverlay() {},
    setEnabled(next, options) {
      this.enabled = !!next;
      propertyChangeOrder.push("enable:" + String(options && options.trigger));
    },
    postToOverlay(name) {
      if (name === "native-layout-invalidate")
        propertyChangeOrder.push("invalidate");
    },
    experimentalNativeSubtitleMode() {
      return true;
    },
    nativeSubtitleHitLayerMode() {
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
    "path",
    "stream-open-filename",
    "sub-text",
    "sub-text-ass",
    "sub-text/ass-full",
    "sub-ass-extradata",
    "sub-start",
    "sub-end",
    "osd-dimensions",
    "track-list",
    "sid",
    "secondary-sid",
    "secondary-sub-text",
    "secondary-sub-start",
    "secondary-sub-end",
    "secondary-sub-visibility",
    "options/secondary-sub-pos",
    "options/secondary-sub-scale",
    "options/secondary-sub-ass-override",
    "options/secondary-sub-delay",
    "options/sub-font-size",
    "options/sub-font",
    "sub-font",
    "options/sub-font-provider",
    "sub-font-provider",
    "options/sub-ass-justify",
    "sub-ass-justify",
    "options/sub-pos",
  ].forEach((property) => {
    assert(
      typeof bootstrapHandlers["mpv." + property + ".changed"] === "function",
      "IINA mpv property-change events are registered: " + property,
    );
  });
  bootstrapHandlers["mpv.file-loaded"]();
  assertEqual(
    bootstrapLookupLineInvalidations,
    1,
    "loading a new file invalidates the prior line-bound lookup text",
  );
  assertEqual(
    bootstrapContext.nativeSubtitleLayoutTrigger,
    "file-loaded",
    "file-loaded records the readiness trigger before rebuilding",
  );
  propertyChangeOrder.length = 0;
  bootstrapFontMetricGeneration = 0;
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
  bootstrapHandlers["mpv.options/secondary-sub-delay.changed"]();
  assertEqual(
    bootstrapGeometryGeneration > 0,
    true,
    "secondary timing and renderer property changes advance geometry generation",
  );
  assertEqual(
    propertyChangeOrder,
    ["invalidate"],
    "secondary property changes immediately clear stale surface geometry",
  );
  scheduledRebuilds.shift()();
  propertyChangeOrder.length = 0;
  const sourceGeneration = bootstrapGeometryGeneration;
  bootstrapHandlers["mpv.stream-open-filename.changed"]();
  bootstrapHandlers["mpv.stream-open-filename.changed"]();
  assertEqual(
    bootstrapGeometryGeneration,
    sourceGeneration + 2,
    "each resolved-source change invalidates stale in-flight geometry",
  );
  assertEqual(
    scheduledRebuilds.length,
    1,
    "repeated resolved-source readiness events share one scheduled rebuild",
  );
  scheduledRebuilds.shift()();
  assertEqual(
    propertyChangeOrder,
    ["invalidate", "invalidate", "poll"],
    "resolved URL readiness rebuilds automatically without a toggle",
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
        lookupCharacterPolicy: LATIN_LOOKUP_CHARACTER_POLICY,
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

  const stalledAnimationFrames = loadOverlayForTest(["state"], {
    requestAnimationFrame() {
      return 1;
    },
  });
  stalledAnimationFrames.context.__handlers.enabled({ enabled: true });
  stalledAnimationFrames.context.__handlers.subtitle(nativeLayerPayload);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert(
    stalledAnimationFrames.context.document.getElementById(
      "native-subtitle-hit-boxes",
    ).children.length > 0,
    "plain subtitle measurement does not depend on animation frames",
  );
  assert(
    stalledAnimationFrames.context.__posted.some(
      (message) =>
        message.name === "native-layout-diagnostic" &&
        message.payload.reason === "accepted-layout",
    ),
    "synchronous measurement still reports accepted layout readiness",
  );

  const directSurfaceLayout = (position, x, y) => ({
    osd: nativeLayerPayload.nativeLayout.osd,
    directRects: [
      {
        position,
        rects: [{ x, y, w: 80, h: 30 }],
      },
    ],
  });
  loaded.context.__handlers.subtitle({
    ...nativeLayerPayload,
    text: "one\ntwo",
    displayText: "one\ntwo",
    nativeLookupSpans: [],
    nativeLayout: null,
    nativeSurfaces: [
      {
        surface: "primary",
        lookupStart: 0,
        lookupText: "one",
        displayText: "one",
        lookupSpans: [
          { startUtf16: 0, endUtf16: 1 },
          { startUtf16: 1, endUtf16: 2 },
          { startUtf16: 2, endUtf16: 3 },
        ],
        layout: directSurfaceLayout(0, 100, 500),
      },
      {
        surface: "secondary",
        lookupStart: 4,
        lookupText: "two",
        displayText: "two",
        lookupSpans: [
          { startUtf16: 0, endUtf16: 1 },
          { startUtf16: 1, endUtf16: 2 },
          { startUtf16: 2, endUtf16: 3 },
        ],
        layout: directSurfaceLayout(4, 140, 500),
      },
    ],
    lineId: 8,
  });
  const surfaceHost = loaded.context.document.getElementById(
    "native-subtitle-layer-host",
  );
  assert(
    surfaceHost.shadowRoot.getElementById("native-subtitle-copy-primary"),
    "the primary surface owns a distinct Shadow DOM copy node",
  );
  assert(
    surfaceHost.shadowRoot.getElementById("native-subtitle-copy-secondary"),
    "the secondary surface owns a distinct Shadow DOM copy node",
  );
  const surfaceHits = Array.from(
    loaded.context.document.getElementById("native-subtitle-hit-boxes")
      .children,
  );
  assertEqual(
    surfaceHits.map((hit) => Number(hit.dataset.pos)).sort((a, b) => a - b),
    [0, 4],
    "merged hit boxes keep numeric global primary/secondary positions",
  );
  assertEqual(
    surfaceHits.map((hit) => hit.dataset.surface).sort(),
    ["primary", "secondary"],
    "surface identity remains available as an optional diagnostic",
  );
  const primarySurfaceRight =
    Number.parseFloat(surfaceHits[0].style.left) +
    Number.parseFloat(surfaceHits[0].style.width);
  const secondarySurfaceLeft = Number.parseFloat(surfaceHits[1].style.left);
  assert(
    primarySurfaceRight <= secondarySurfaceLeft,
    "overlaps are resolved once across all subtitle surfaces",
  );

  const stackedSrtOverlay = loadOverlayForTest(["state"], {
    rangeRects(start, end) {
      if (start === 0 && end === 5)
        return [
          {
            left: 300,
            top: 500,
            right: 350,
            bottom: 530,
            width: 50,
            height: 30,
          },
        ];
      return [
        {
          left: 300 + start * 10,
          top: 500,
          right: 300 + end * 10,
          bottom: 530,
          width: Math.max(1, (end - start) * 10),
          height: 30,
        },
      ];
    },
  });
  stackedSrtOverlay.context.__handlers.enabled({ enabled: true });
  const lookupSpansFor = (text) =>
    Array.from(text, (_character, index) => ({
      startUtf16: index,
      endUtf16: index + 1,
    }));
  stackedSrtOverlay.context.__handlers.subtitle({
    ...nativeLayerPayload,
    text: "first\nsecond\nline",
    displayText: "first\nsecond\nline",
    nativeLookupSpans: [],
    nativeLayout: null,
    nativeSurfaces: [
      {
        surface: "primary",
        lookupStart: 0,
        lookupText: "first\nsecond\nline",
        displayText: "first\nsecond\nline",
        lookupSpans: lookupSpansFor("first\nsecond\nline"),
        layout: {
          ...nativeLayerPayload.nativeLayout,
          eventBlocks: [
            {
              displayText: "first",
              lookupText: "first",
              lookupStart: 0,
              lookupSpans: lookupSpansFor("first"),
              stackIndex: 0,
            },
            {
              displayText: "second\nline",
              lookupText: "second\nline",
              lookupStart: 6,
              lookupSpans: lookupSpansFor("second\nline"),
              stackIndex: 1,
            },
          ],
        },
      },
    ],
    lineId: 9,
  });
  await waitForLayout();
  const stackedSrtHost = stackedSrtOverlay.context.document.getElementById(
    "native-subtitle-layer-host",
  );
  const lowerSrtCopy = stackedSrtHost.shadowRoot.getElementById(
    "native-subtitle-copy-primary-0",
  );
  const upperSrtCopy = stackedSrtHost.shadowRoot.getElementById(
    "native-subtitle-copy-primary-1",
  );
  assert(
    lowerSrtCopy && upperSrtCopy,
    "overlapping SRT cues bypass the single-primary fast path",
  );
  assertEqual(
    {
      lower: lowerSrtCopy.textContent,
      upper: upperSrtCopy.textContent,
    },
    { lower: "first", upper: "second\nline" },
    "each simultaneous SRT cue keeps its authored multiline text",
  );
  assertEqual(
    lowerSrtCopy.style.transform,
    "translateX(-50%)",
    "the earlier SRT event remains at the normal subtitle baseline",
  );
  assert(
    new RegExp(
      "translateY\\(-" +
        Number.parseFloat(lowerSrtCopy.style["line-height"]) +
        "px\\)",
    ).test(upperSrtCopy.style.transform),
    "the later SRT event is stacked one rendered row above the earlier event",
  );
  assertEqual(
    Array.from(
      stackedSrtOverlay.context.document.getElementById(
        "native-subtitle-hit-boxes",
      ).children,
    ).some((hit) => Number(hit.dataset.pos) === 6),
    true,
    "the upper SRT event produces globally indexed lookup hit boxes",
  );

  loaded.context.__handlers.subtitle({
    ...nativeLayerPayload,
    text: "one\nmissing",
    displayText: "one\nmissing",
    nativeLookupSpans: [],
    nativeLayout: null,
    nativeSurfaces: [
      {
        surface: "primary",
        lookupStart: 0,
        lookupText: "one",
        displayText: "one",
        lookupSpans: [
          { startUtf16: 0, endUtf16: 1 },
          { startUtf16: 1, endUtf16: 2 },
          { startUtf16: 2, endUtf16: 3 },
        ],
        layout: directSurfaceLayout(0, 100, 500),
      },
      {
        surface: "secondary",
        lookupStart: 4,
        lookupText: "missing",
        displayText: "missing",
        lookupSpans: [],
        reason: "ass-geometry-pending",
      },
    ],
    lineId: 9,
  });
  const survivingPrimaryHits = Array.from(
    loaded.context.document.getElementById("native-subtitle-hit-boxes")
      .children,
  );
  assertEqual(
    survivingPrimaryHits.map((hit) => Number(hit.dataset.pos)),
    [0],
    "a pending secondary surface does not invalidate successful primary hit boxes",
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
  const matchHighlights = host.shadowRoot.getElementById(
    "native-subtitle-match-highlights",
  );
  assert(
    matchHighlights && matchHighlights.children.length > 0,
    "native hover draws a grouped default-style lookup highlight",
  );
  assertEqual(
    {
      background: matchHighlights.children[0].style.background,
      border: matchHighlights.children[0].style.border,
    },
    {
      background: "rgba(255,255,255,0.22)",
      border: "1px solid rgba(255,255,255,0.36)",
    },
    "native lookup highlight uses the default overlay treatment",
  );
  assert(
    !loaded.context.__elements.popup.classList.contains("hidden"),
    "hovering a synthetic rectangle uses existing popup behavior",
  );
  assert(
    loaded.overlay.state.currentAnchor === hitRoot.children[1],
    "popup anchors to the selected wrapped rectangle",
  );
  loaded.context.__handlers.config({
    experimentalNativeSubtitleLookupHighlight: false,
  });
  assertEqual(
    matchHighlights.children.length,
    0,
    "disabling native lookup highlighting leaves only the popup visible",
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
      /\.lookup-popup\s*\{[^}]*z-index:\s*20;/s.test(overlayCssSource) &&
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
      language: {
        id: "en",
        lookupUnit: "word",
        wordMode: "latin-word",
        lookupCharacterPolicy: LATIN_LOOKUP_CHARACTER_POLICY,
      },
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
      language: {
        id: "en",
        lookupUnit: "word",
        wordMode: "latin-word",
        lookupCharacterPolicy: LATIN_LOOKUP_CHARACTER_POLICY,
      },
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
      language: {
        id: "en",
        lookupUnit: "word",
        wordMode: "latin-word",
        lookupCharacterPolicy: LATIN_LOOKUP_CHARACTER_POLICY,
      },
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

  let resolveStaleSurfaceFont;
  const staleSurface = loadOverlayForTest(["state"], {
    fontLoad() {
      return new Promise((resolve) => {
        resolveStaleSurfaceFont = resolve;
      });
    },
    rangeRects() {
      return [
        { left: 20, top: 20, right: 80, bottom: 50, width: 60, height: 30 },
      ];
    },
  });
  staleSurface.context.__handlers.enabled({ enabled: true });
  staleSurface.context.__handlers.subtitle({
    ...fontCuePayload("old", 31),
    nativeLayout: null,
    nativeSurfaces: [
      {
        surface: "secondary",
        lookupStart: 0,
        lookupText: "old",
        displayText: "old",
        lookupSpans: [
          { startUtf16: 0, endUtf16: 1 },
          { startUtf16: 1, endUtf16: 2 },
          { startUtf16: 2, endUtf16: 3 },
        ],
        layout: fontCuePayload("old", 31).nativeLayout,
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(
    typeof resolveStaleSurfaceFont === "function",
    "multi-surface measurement reaches its asynchronous font readiness",
  );
  staleSurface.context.__handlers.subtitle({
    ...fontCuePayload("new", 32),
    nativeLayout: null,
    nativeSurfaces: [
      {
        surface: "secondary",
        lookupStart: 0,
        lookupText: "new",
        displayText: "new",
        lookupSpans: [
          { startUtf16: 0, endUtf16: 1 },
          { startUtf16: 1, endUtf16: 2 },
          { startUtf16: 2, endUtf16: 3 },
        ],
        layout: {
          osd: fontCuePayload("new", 32).nativeLayout.osd,
          directRects: [
            { position: 0, rects: [{ x: 100, y: 100, w: 50, h: 25 }] },
          ],
        },
      },
    ],
  });
  const currentSurfaceHits = staleSurface.context.document.getElementById(
    "native-subtitle-hit-boxes",
  );
  assertEqual(
    currentSurfaceHits.children.length,
    1,
    "the replacement surface renders before stale font readiness resolves",
  );
  resolveStaleSurfaceFont([{}]);
  await waitForLayout();
  assertEqual(
    staleSurface.overlay.state.lineId,
    32,
    "stale multi-surface font completion leaves the replacement cue current",
  );
  assertEqual(
    Number(currentSurfaceHits.children[0].dataset.pos),
    0,
    "stale multi-surface measurement cannot overwrite current global targets",
  );
  assert(
    staleFontFailure.context.__posted.some(
      (message) =>
        message.name === "native-layout-diagnostic" &&
        message.payload.reason === "accepted-layout" &&
        message.payload.displayText === undefined &&
        message.payload.lookupText === undefined,
    ),
    "accepted-layout readiness remains available without leaking subtitle text when logging is disabled",
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
