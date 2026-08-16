const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataRoot =
  process.env.IINATAN_DATA_ROOT ||
  path.join(
    os.homedir(),
    "Library/Application Support/com.colliderli.iina/plugins/.data/com.afn478.iinatan",
  );
const binaryCandidates = [
  path.join(root, "bin/iina-hoshi-dicts"),
  path.join(dataRoot, "bin/iina-hoshi-dicts"),
];
const binary = binaryCandidates.find((candidate) => fs.existsSync(candidate));
if (!binary) {
  throw new Error(
    "Missing iina-hoshi-dicts. Build the native backend or install the development plugin first.",
  );
}

const dictionaryRoot = path.join(dataRoot, "dictionaries");
const preferredDictionaryPrefixes = [
  "Jitendex",
  "JMdict",
  "旺文社国語辞典 第十二版",
  "明鏡国語辞典 第三版",
  "大辞泉 第二版",
  "アクセント辞典",
  "Jiten",
  "BCCWJ",
  "JPDBv2㋕",
];
const installedDictionaryNames = fs.existsSync(dictionaryRoot)
  ? fs
      .readdirSync(dictionaryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];
const dictionaryPaths = preferredDictionaryPrefixes
  .map((prefix) =>
    installedDictionaryNames.find(
      (name) => name === prefix || name.startsWith(prefix),
    ),
  )
  .filter(Boolean)
  .map((name) => path.join(dictionaryRoot, name));
if (dictionaryPaths.length < 4) {
  throw new Error(
    `Expected installed Japanese dictionaries under ${dictionaryRoot}`,
  );
}

const fixtureDefinitions = [
  {
    id: "tekido",
    word: "適度",
    label: "適度 — structured POS chip",
    description:
      "A compact adjective and noun entry for checking structured content and metadata.",
  },
  {
    id: "kakeru",
    word: "掛ける",
    label: "掛ける — many senses",
    description:
      "A common polysemous verb for checking dense senses, examples, forms, metadata, and scrolling.",
  },
  {
    id: "kangaeru",
    word: "考える",
    label: "考える — rich verb entry",
    description:
      "A common verb with multiple monolingual explanations and structured dictionary content.",
  },
  {
    id: "honoo",
    word: "炎",
    label: "炎 — short headword",
    description:
      "A compact kanji entry useful for headword, reading, pitch, frequency, and multi-entry spacing.",
  },
];

function lookupFixture(definition) {
  const result = childProcess.spawnSync(
    binary,
    [
      "lookup",
      "--max-results",
      "3",
      "--max-glossaries",
      "4",
      ...dictionaryPaths,
      "--",
      definition.word,
    ],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Lookup failed for ${definition.word}: ${String(result.stderr || "")}`,
    );
  }
  const payload = JSON.parse(result.stdout);
  if (!payload.ok || !Array.isArray(payload.results) || !payload.results.length)
    throw new Error(`No preview results returned for ${definition.word}`);
  return Object.assign({}, definition, { payload });
}

function jitendexFixture() {
  const structuredContent = [
    {
      type: "structured-content",
      content: [
        {
          tag: "span",
          content: "ichidan verb",
          data: { content: "part-of-speech-info" },
        },
        {
          tag: "ul",
          data: { content: "glossary" },
          content: [
            { tag: "li", content: "to eat" },
            { tag: "li", content: "to live on or subsist on" },
          ],
        },
        {
          tag: "div",
          data: { class: "extra-box", content: "example-sentence" },
          content: [
            {
              tag: "div",
              data: { content: "example-sentence-a" },
              content: "朝ご飯を食べる。",
            },
            {
              tag: "div",
              data: { content: "example-sentence-b" },
              content: "I eat breakfast.",
            },
          ],
        },
        {
          tag: "div",
          data: { content: "forms" },
          content: [
            { tag: "span", data: { content: "forms-label" }, content: "Forms" },
            {
              tag: "ul",
              content: [
                { tag: "li", content: "食べる【たべる】" },
                { tag: "li", content: "喰べる【たべる】" },
              ],
            },
          ],
        },
        {
          tag: "details",
          data: { content: "details-entry-etymology" },
          content: [
            { tag: "summary", content: "Etymology" },
            {
              tag: "div",
              content: "From the classical verb 食ぶ (tabu).",
            },
          ],
        },
        {
          tag: "div",
          data: { content: "attribution" },
          content: [
            {
              tag: "a",
              href: "https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&sid=&q=1358280",
              content: "JMdict entry",
            },
          ],
        },
      ],
    },
  ];
  return {
    id: "jitendex-css",
    word: "食べる",
    label: "食べる: Jitendex CSS sample",
    description:
      "A small Jitendex-style entry with tags, glosses, an example, forms, and attribution for testing custom CSS.",
    payload: {
      ok: true,
      lookupString: "食べる",
      resultCount: 1,
      results: [
        {
          matched: "食べる",
          deinflected: "食べる",
          trace: [],
          term: {
            expression: "食べる",
            reading: "たべる",
            glossaries: [
              {
                dict: "Jitendex",
                glossary: JSON.stringify(structuredContent),
                definitionTags: "common; transitive",
                termTags: "priority form",
              },
              {
                dict: "wty-en-ja",
                glossary:
                  "A short secondary definition for testing dictionary spacing and source-family selectors.",
                definitionTags: "",
                termTags: "",
              },
            ],
            frequencies: [
              {
                dict: "Preview frequency",
                frequencies: [{ value: 612, displayValue: "612" }],
              },
            ],
            pitches: [
              { dict: "Preview pitch", positions: [2], transcriptions: [] },
            ],
          },
        },
      ],
    },
  };
}

const fixtures = fixtureDefinitions
  .map(lookupFixture)
  .concat(jitendexFixture());
const output = [
  "// Generated by scripts/generate_popup_preview_data.js; do not edit by hand.",
  "// The payloads are hardcoded so dev/popup-preview.html works without IINA.",
  "window.IINATAN_POPUP_PREVIEW_FIXTURES = Object.freeze(",
  `${JSON.stringify(fixtures, null, 2)},`,
  ");",
  "",
].join("\n");
fs.mkdirSync(path.join(root, "dev"), { recursive: true });
fs.writeFileSync(path.join(root, "dev/popup-preview-data.js"), output);
console.log(
  `Wrote ${fixtures.length} popup fixtures from ${dictionaryPaths.length} dictionaries.`,
);
