#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { performance } = require("perf_hooks");
const { loadOverlayForTest } = require("../tests/helpers/overlay_test_context");

const root = path.resolve(__dirname, "..");
const jsonOutput = process.argv.includes("--json");
const sourceRef = String(process.env.IINATAN_PERF_SOURCE_REF || "").trim();
const filterArgument = process.argv.find((argument) =>
  argument.startsWith("--filter="),
);
const metricFilter = filterArgument
  ? new RegExp(filterArgument.slice("--filter=".length), "i")
  : null;
const scale = Math.max(
  0.01,
  Math.min(100, Number(process.env.IINATAN_PERF_SCALE) || 1),
);
const sampleCount = Math.max(1, Number(process.env.IINATAN_PERF_SAMPLES) || 7);
const metrics = [];
const sourceTextCache = new Map();
let sink = 0;
let compilationSequence = 0;

function read(relativePath) {
  if (sourceTextCache.has(relativePath))
    return sourceTextCache.get(relativePath);
  const source = sourceRef
    ? execFileSync("git", ["show", `${sourceRef}:${relativePath}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      })
    : fs.readFileSync(path.join(root, relativePath), "utf8");
  sourceTextCache.set(relativePath, source);
  return source;
}

function artifactSize(relativePath) {
  if (sourceRef)
    return Number(
      execFileSync("git", ["cat-file", "-s", `${sourceRef}:${relativePath}`], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
    );
  return fs.statSync(path.join(root, relativePath)).size;
}

function consume(value) {
  if (typeof value === "number") sink = (sink + value) | 0;
  else if (typeof value === "string") sink = (sink + value.length) | 0;
  else if (Array.isArray(value)) sink = (sink + value.length) | 0;
  else if (value && typeof value === "object")
    sink = (sink + Object.keys(value).length) | 0;
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function benchmark(category, name, baseIterations, operation) {
  if (metricFilter && !metricFilter.test(category + " " + name)) return;
  const iterations = Math.max(1, Math.round(baseIterations * scale));
  const run = () => {
    for (let index = 0; index < iterations; index++) consume(operation(index));
  };
  run();
  run();
  const elapsed = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    const started = performance.now();
    run();
    elapsed.push(performance.now() - started);
  }
  const medianMs = percentile(elapsed, 0.5);
  metrics.push({
    category,
    name,
    iterations,
    samples: sampleCount,
    medianMs,
    p95Ms: percentile(elapsed, 0.95),
    usPerOperation: (medianMs * 1000) / iterations,
    operationsPerSecond: (iterations * 1000) / medianMs,
  });
}

function loadLanguageRuntime() {
  const files = [
    "lookup_character_policy.js",
    "common.js",
    "deinflection.js",
    "japanese.js",
    "english_yomitan_rules.js",
    "english.js",
    "french_yomitan_rules.js",
    "french.js",
    "german_yomitan_rules.js",
    "german.js",
    "chinese.js",
    "korean.js",
    "registry.js",
  ];
  const context = { pref: (_key, fallback) => fallback };
  vm.createContext(context);
  vm.runInContext(
    files.map((file) => read("src/languages/" + file)).join("\n") +
      "\nglobalThis.api=IINATAN_LANGUAGE_REGISTRY;",
    context,
  );
  return context.api;
}

function loadLookupCharacterPolicyRuntime() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    read("src/languages/lookup_character_policy.js") +
      "\nglobalThis.api=IINATAN_LOOKUP_CHARACTER_POLICY;",
    context,
  );
  return context.api;
}

function loadNativeRuntime() {
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
    Date,
    nativeExternalSrtCache: Object.create(null),
    nativeExternalSrtInFlight: Object.create(null),
    nativeExternalSrtGeneration: 0,
    utils: { exec: async () => ({ status: 0, stdout: "", stderr: "" }) },
    dataRoot: () => "/tmp",
    putBoundedCache: (cache, key, value) => (cache[key] = value),
    file: { read: () => "" },
    scheduleExperimentalNativeLayoutRebuild() {},
    mpvNumberProp: () => 0,
    cleanNativeDisplayText: (value) => String(value || ""),
    normalizeExperimentalSubtitleText: (value) => String(value || ""),
    prefBool: (_name, fallback) => fallback,
    selectedLanguageModule: () => ({
      id: "ja",
      lookupCharacterPolicy: {
        ranges: [
          { start: 0x3040, end: 0x30ff },
          { start: 0x3400, end: 0x9fff },
        ],
        additionalCharacters: "々〆ヵヶー",
      },
    }),
  };
  vm.createContext(context);
  vm.runInContext(
    read("src/main/05_media_source.js") +
      read("src/languages/lookup_character_policy.js") +
      read("src/languages/common.js") +
      read("src/main/12_native_subtitle_hit_layer.js") +
      `
globalThis.api = {
  mediaSourceDescriptor,
  iinaOnlineMediaSubtitleEdlSource,
  nativeSubtitleTrackEligibility,
  parseNativeSrtCues,
  nativeActiveSrtCues,
  nativeLookupMapping,
};`,
    context,
  );
  return context.api;
}

function loadGeometryRuntime() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    read("src/overlay/native_subtitle_hit_layer.js") +
      "\nglobalThis.api=IINATAN_NATIVE_SUBTITLE_HIT_LAYER;",
    context,
  );
  return context.api;
}

function loadAnkiRuntime() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    read("src/main/52_anki_card_context.js") +
      read("src/main/52_anki_templates.js") +
      `
globalThis.api = {
  ankiBuildCardContext,
  renderAnkiFields,
  ankiStableJson: typeof ankiStableJson === "function" ? ankiStableJson : null,
};`,
    context,
  );
  return context.api;
}

function loadManifestRuntime() {
  const fixture = { manifestText: "", dictionaryNames: [] };
  const context = {
    fixture,
    file: {
      exists: () => true,
      read(value) {
        const filePath = String(value || "");
        if (filePath === "/manifest.json") return fixture.manifestText;
        const name = filePath.split("/").slice(-2, -1)[0] || "";
        return JSON.stringify({ title: name, language: "ja" });
      },
      list: () =>
        fixture.dictionaryNames.map((name) => ({
          filename: name,
          path: "/dictionaries/" + name,
          isDir: true,
        })),
      write() {},
    },
    manifestPath: () => "/manifest.json",
    dictRoot: () => "/dictionaries",
    pathJoin: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"),
    safeDelete() {},
    debugError() {},
    debugWarn() {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    read("src/main/15_profile_settings.js") +
      read("src/main/20_dictionary_manifest.js") +
      `
globalThis.api = {
  parseManifestText,
  orderedDictionaryDirs,
  profileSummaries,
  activeDictionaryPaths,
  setFixture(manifestText, dictionaryNames) {
    fixture.manifestText = manifestText;
    fixture.dictionaryNames = dictionaryNames;
  },
  resetActiveDictionaryCache() {
    if (typeof invalidateActiveDictionaryRuntimeCache === "function")
      invalidateActiveDictionaryRuntimeCache();
  },
};`,
    context,
  );
  return context.api;
}

function youtubeTrack(index, selected) {
  const url = `https://www.youtube.com/api/timedtext?v=fixture&lang=ja${index}&fmt=srt`;
  return {
    type: "sub",
    id: index + 1,
    selected,
    "main-selection": selected ? 0 : -1,
    codec: "null",
    "codec-desc": "Unknown",
    external: true,
    "external-filename": `edl://!no_clip;!delay_open,media_type=sub;%${url.length}%${url}`,
  };
}

function srtFixture(cueCount) {
  const timestamp = (milliseconds) => {
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const millis = milliseconds % 1000;
    return (
      [hours, minutes, seconds]
        .map((value) => String(value).padStart(2, "0"))
        .join(":") +
      "," +
      String(millis).padStart(3, "0")
    );
  };
  const out = [];
  for (let index = 0; index < cueCount; index++) {
    const start = index * 1250;
    out.push(
      String(index + 1),
      `${timestamp(start)} --> ${timestamp(start + 1800)}`,
      `字幕の性能測定 ${index}`,
      "",
    );
  }
  return out.join("\n");
}

function glossaryFixture() {
  return {
    dict: "Jitendex.org [performance]",
    definitionTags: ["common", "v1"],
    glossary: JSON.stringify({
      type: "structured-content",
      content: [
        {
          tag: "div",
          data: { content: "glossary" },
          content: [
            { tag: "span", content: "to build or create something" },
            {
              tag: "ul",
              content: Array.from({ length: 6 }, (_, index) => ({
                tag: "li",
                content: `example definition ${index}`,
              })),
            },
            {
              tag: "table",
              content: Array.from({ length: 4 }, (_, row) => ({
                tag: "tr",
                content: [
                  { tag: "th", content: `form ${row}` },
                  { tag: "td", content: `value ${row}` },
                ],
              })),
            },
          ],
        },
      ],
    }),
  };
}

function dictionaryEntryFixture() {
  const glossary = glossaryFixture();
  return {
    matched: "作る",
    deinflected: "作る",
    term: {
      expression: "作る",
      reading: "つくる",
      rules: "v1",
      glossaries: [
        glossary,
        { dict: "明鏡国語辞典 第三版", glossary: "物事を新しく生み出す。" },
        { dict: "大辞泉 第二版", glossary: "材料に手を加えて形ある物にする。" },
      ],
      frequencies: [
        { dict: "JPDB", frequencies: [{ value: 321, displayValue: "321" }] },
        { dict: "BCCWJ", frequencies: [{ value: 118, displayValue: "118" }] },
      ],
      pitches: [{ dict: "アクセント辞典", positions: [2] }],
    },
  };
}

function manifestFixture() {
  const dictionaries = {};
  const dictionaryOrder = [];
  for (let index = 0; index < 120; index++) {
    const name = `Dictionary ${index}`;
    dictionaries[name] = {
      name,
      path: `/dictionaries/${index}`,
      title: `Dictionary title ${index}`,
      language: index % 2 ? "ja" : "en",
    };
    dictionaryOrder.push(name);
  }
  const profiles = {};
  for (let index = 0; index < 20; index++) {
    profiles[`profile-${index}`] = {
      id: `profile-${index}`,
      name: `Profile ${index}`,
      dictionaryOrder: dictionaryOrder
        .slice(index)
        .concat(dictionaryOrder.slice(0, index)),
      disabled: { [`Dictionary ${index}`]: true },
      preferences: {
        lookupLanguage: index % 2 ? "ja" : "en",
        scanLength: 24,
        nestedPopupMode: "click",
      },
    };
  }
  return JSON.stringify({
    schemaVersion: 1,
    dictionaries,
    dictionaryOrder,
    disabled: {},
    activeProfileId: "profile-7",
    profiles,
  });
}

const mainSource = read("main.js");
const overlaySource =
  read("src/languages/lookup_character_policy.js") +
  read("src/overlay/native_subtitle_hit_layer.js") +
  read("src/overlay/overlay.js");
benchmark(
  "startup",
  "compile main runtime",
  20,
  () =>
    new vm.Script(mainSource, {
      filename: `iinatan-main-${compilationSequence++}.js`,
    }),
);
benchmark(
  "startup",
  "compile overlay runtime",
  30,
  () =>
    new vm.Script(overlaySource, {
      filename: `iinatan-overlay-${compilationSequence++}.js`,
    }),
);

const languages = loadLanguageRuntime();
const lookupCharacterPolicy = loadLookupCharacterPolicyRuntime();
const policyCharacters = ["日", "A", "é", "한", "中", "🙂", " ", "—"];
benchmark("language", "match lookup character policy", 100000, (index) =>
  lookupCharacterPolicy.matches(
    lookupCharacterPolicy.policies.latinWord,
    policyCharacters[index % policyCharacters.length],
  ),
);
const languageCases = [
  ["Japanese rightward lookup", "ja", "昨日（きのう）伺（うか）いました", 7],
  ["English deinflection", "en", "They were running quickly", 12],
  ["French deinflection", "fr", "Vous achèterais quelque chose", 9],
  ["German separable verb", "de", "Ich stehe morgen früh auf.", 5],
  ["Chinese prefix lookup", "zh", "我喜欢学习中文", 2],
  ["Korean word lookup", "ko", "한국어 공부를 합니다", 2],
];
for (const [name, languageId, text, position] of languageCases) {
  const language = languages.get(languageId);
  const iterations = {
    ja: 50000,
    en: 3000,
    fr: 50,
    de: 5000,
    zh: 50000,
    ko: 20000,
  }[languageId];
  benchmark("language", name, iterations, () =>
    language.lookupRequest(text, position, 24),
  );
}
benchmark("language", "serialize overlay language config", 100000, (index) =>
  languages.overlayConfig(languages.all[index % languages.all.length]),
);

const native = loadNativeRuntime();
const youtubeTracks = Array.from({ length: 81 }, (_, index) =>
  youtubeTrack(index, index === 0),
);
const selectedEdl = youtubeTracks[0]["external-filename"];
benchmark("media", "classify mixed media sources", 100000, (index) =>
  native.mediaSourceDescriptor(
    index % 3 === 0
      ? "/Movies/video.mkv"
      : index % 3 === 1
        ? "https://media.example/video.mkv?token=private"
        : selectedEdl,
    "benchmark",
  ),
);
benchmark("media", "parse cached Online Media subtitle EDL", 200000, () =>
  native.iinaOnlineMediaSubtitleEdlSource(selectedEdl),
);
benchmark("subtitle", "select from 81 subtitle tracks", 20000, () =>
  native.nativeSubtitleTrackEligibility(youtubeTracks, 1, "no", "primary"),
);
const srtText = srtFixture(5000);
benchmark("subtitle", "parse 5000-cue SRT", 20, () =>
  native.parseNativeSrtCues(srtText),
);
const parsedSrt = native.parseNativeSrtCues(srtText);
benchmark("subtitle", "find active cue in 5000-cue SRT", 250000, (index) =>
  native.nativeActiveSrtCues(parsedSrt, (index % 5000) * 1250 + 100),
);
const displayText = "昨日は Café で字幕の性能を測定しました。";
const lookupText = displayText.normalize("NFKC");
benchmark("subtitle", "map display text to lookup positions", 10000, () =>
  native.nativeLookupMapping(displayText, lookupText, {
    flattenLineBreaks: false,
    languageId: "ja",
  }),
);

const geometry = loadGeometryRuntime();
const rectangles = Array.from({ length: 180 }, (_, index) => ({
  left: 100 + (index % 45) * 18,
  right: 120 + (index % 45) * 18,
  top: 500 + Math.floor(index / 45) * 42,
  bottom: 532 + Math.floor(index / 45) * 42,
  width: 20,
  height: 32,
  position: index,
  surface: index % 2 ? "primary" : "secondary",
}));
benchmark("geometry", "resolve 180 subtitle hit boxes", 250, () =>
  geometry.resolveHitBoxOverlaps(rectangles, 2),
);
const validGeometry = geometry.validateGeometry(
  { w: 1920, h: 1080, ml: 0, mr: 0, mt: 0, mb: 0, par: 1 },
  { width: 1280, height: 720 },
);
const layoutOptions = {
  unitsPerEm: 1000,
  usWinAscent: 1015,
  usWinDescent: 242,
  fontMetricScale: 1000 / 1257,
  resolvedPostScriptName: "YuMin-Medium",
  fontMetricSource: "coretext-libass-os2-win-v3",
  fontMetricResolverVersion: 3,
  libassProviderVerified: true,
  resolvedFontFormat: 1,
  fontSize: 55,
  marginX: 20,
  marginY: 22,
  alignX: "center",
  alignY: "bottom",
  justify: "auto",
};
benchmark("geometry", "calculate native subtitle layout", 50000, () =>
  geometry.calculatePlainTextLayout(validGeometry, layoutOptions),
);

benchmark("overlay", "initialize overlay runtime", 100, () =>
  loadOverlayForTest(["state"], { readSource: read }),
);
const { context: overlayContext, overlay } = loadOverlayForTest(
  [
    "state",
    "applyConfig",
    "renderSubtitle",
    "lookupUnitForPosition",
    "renderGlossaryPayload",
    "renderEntryMetadata",
    "renderStoredLookup",
  ],
  { readSource: read },
);
overlay.applyConfig({
  experimentalNativeSubtitleHitLayer: false,
  debugLogVerbose: false,
  language: {
    id: "ja",
    label: "Japanese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
  },
});
overlay.state.enabled = true;
const subtitleText = "昨日はカフェで映画を見ながら日本語字幕を勉強しました。";
benchmark("overlay", "render legacy subtitle characters", 3000, (index) =>
  overlay.renderSubtitle(subtitleText, index + 1),
);
overlay.renderSubtitle(subtitleText, 1);
benchmark("overlay", "resolve subtitle lookup unit", 200000, (index) =>
  overlay.lookupUnitForPosition(index % overlay.state.chars.length),
);
overlay.applyConfig({
  language: {
    id: "fr",
    label: "French",
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupCharacterPolicy: lookupCharacterPolicy.policies.latinWord,
  },
});
overlay.renderSubtitle("Vous achèterais quelque chose", 2);
benchmark("overlay", "resolve Latin word lookup unit", 10000, (index) =>
  overlay.lookupUnitForPosition(index % 16),
);
overlay.applyConfig({
  language: {
    id: "ja",
    label: "Japanese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
  },
});
overlay.renderSubtitle(subtitleText, 3);
const glossary = glossaryFixture();
benchmark("overlay", "render structured glossary HTML", 5000, () =>
  overlay.renderGlossaryPayload(glossary),
);
const entry = dictionaryEntryFixture();
benchmark("overlay", "render entry metadata HTML", 20000, () =>
  overlay.renderEntryMetadata(entry.term),
);
const storedLookup = {
  ok: true,
  position: 0,
  result: {
    ok: true,
    text: subtitleText,
    language: "ja",
    lookupStart: 0,
    lookupEnd: 2,
    lookupText: "昨日",
    results: [
      entry,
      { ...entry, matched: "造る" },
      { ...entry, matched: "創る" },
    ],
  },
};
benchmark("overlay", "render three-entry lookup popup", 2000, () => {
  overlay.renderStoredLookup(storedLookup);
  return overlayContext.__elements.popup.innerHTML;
});

const anki = loadAnkiRuntime();
const ankiPayload = {
  requestId: "performance",
  context: {
    expression: "作る",
    reading: "つくる",
    sentence: subtitleText,
    surface: "作る",
    position: 8,
    entry,
    result: { text: subtitleText, language: "ja", lookupStart: 8 },
  },
};
const ankiHost = {
  lastSubtitle: subtitleText,
  documentTitle: "Performance fixture",
  sourcePath: "/Movies/performance.mkv",
  timePos: 83.4,
};
benchmark("anki", "build structured Anki card context", 1000, () =>
  anki.ankiBuildCardContext(ankiPayload, ankiHost),
);
const cardContext = anki.ankiBuildCardContext(ankiPayload, ankiHost);
const templates = Object.fromEntries(
  Array.from({ length: 24 }, (_, index) => [
    `Field ${index}`,
    "{expression} {reading} {sentence} {selected-glossary} {frequencies} {timestamp}",
  ]),
);
benchmark("anki", "render 24 Anki field templates", 3000, () =>
  anki.renderAnkiFields(templates, cardContext, {
    screenshot: "screenshot.jpg",
    wordAudio: "word.mp3",
  }),
);

const manifest = loadManifestRuntime();
const manifestText = manifestFixture();
benchmark("settings", "parse 20-profile 120-dictionary manifest", 200, () =>
  manifest.parseManifestText(manifestText, "benchmark"),
);
const parsedManifest = manifest.parseManifestText(manifestText, "benchmark");
const installedDictionaries = Object.values(parsedManifest.dictionaries);
manifest.setFixture(manifestText, Object.keys(parsedManifest.dictionaries));
benchmark("settings", "order 120 installed dictionaries", 500, () =>
  manifest.orderedDictionaryDirs(installedDictionaries, parsedManifest),
);
benchmark("settings", "summarize 20 profiles", 500, () =>
  manifest.profileSummaries(parsedManifest),
);
benchmark("settings", "cold-scan 120 active dictionary paths", 100, () => {
  manifest.resetActiveDictionaryCache();
  return manifest.activeDictionaryPaths();
});
manifest.activeDictionaryPaths();
benchmark("settings", "reuse active dictionary paths", 200, () =>
  manifest.activeDictionaryPaths(),
);

const report = {
  schemaVersion: 1,
  revision: (() => {
    if (!sourceRef) return "WORKTREE";
    try {
      return execFileSync("git", ["rev-parse", sourceRef], {
        cwd: root,
        encoding: "utf8",
      }).trim();
    } catch (_) {
      return "unknown";
    }
  })(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: (os.cpus()[0] && os.cpus()[0].model) || "unknown",
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    scale,
    samples: sampleCount,
    sourceRef: sourceRef || "working-tree",
  },
  artifacts: {
    mainBytes: Buffer.byteLength(mainSource),
    overlayRuntimeBytes: Buffer.byteLength(overlaySource),
    generatedOverlayBytes: artifactSize("overlay.html"),
    nativeBackendBytes: artifactSize("bin/iina-hoshi-dicts"),
  },
  metrics,
  checksum: sink,
};

if (jsonOutput) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  console.log(
    `Plugin-wide performance benchmark (${report.revision.slice(0, 12)})`,
  );
  console.table(
    metrics.map((metric) => ({
      category: metric.category,
      metric: metric.name,
      iterations: metric.iterations,
      "median ms": metric.medianMs.toFixed(3),
      "us/op": metric.usPerOperation.toFixed(3),
    })),
  );
  console.log(
    `Artifacts: main ${(report.artifacts.mainBytes / 1024).toFixed(1)} KiB, overlay ${(report.artifacts.generatedOverlayBytes / 1024).toFixed(1)} KiB, backend ${(report.artifacts.nativeBackendBytes / 1024 / 1024).toFixed(1)} MiB.`,
  );
}
