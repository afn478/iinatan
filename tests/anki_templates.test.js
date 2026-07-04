const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sources = [
  "src/main/52_anki_card_context.js",
  "src/main/52_anki_templates.js",
]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const context = { console, Object, String };

vm.createContext(context);
vm.runInContext(
  sources +
    `
globalThis.__ankiTemplates = {
  ankiMarkerDefinitions,
  extractAnkiMarkersFromTemplates,
  ankiTemplatesNeedMedia,
  renderAnkiTemplate,
  renderAnkiFields
};`,
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, message + "\n" + actualJson);
}

const templates = context.__ankiTemplates;

assert(
  templates
    .ankiMarkerDefinitions("ja")
    .some((item) => item.marker === "{pitch-accent-positions}"),
  "Japanese marker definitions should include pitch accent markers",
);
assert(
  templates
    .ankiMarkerDefinitions("ja")
    .some((item) => item.marker === "{single-glossary-jitendex}"),
  "Japanese marker definitions should advertise the Yomitan-style Jitendex single-glossary marker",
);
assert(
  !templates
    .ankiMarkerDefinitions("en")
    .some((item) => item.marker === "{pitch-accent-positions}"),
  "Non-Japanese marker definitions should not advertise pitch accent markers",
);
assert(
  !templates
    .ankiMarkerDefinitions("en")
    .some((item) => item.marker === "{single-glossary-jitendex}"),
  "Non-Japanese marker definitions should not advertise the Jitendex single-glossary marker",
);

const markers = templates.extractAnkiMarkersFromTemplates({
  Front: " { Expression } {sentence-audio} ",
  Back: "{Glossary} {image}",
});
assert(markers.expression, "Marker extraction should normalize case");
assert(markers["sentence-audio"], "Marker extraction should trim marker names");
assert(markers.glossary, "Marker extraction should scan all fields");
assert(markers.image, "Marker extraction should include image aliases");

assertDeepEqual(
  templates.ankiTemplatesNeedMedia({
    Picture: "{image}",
    Audio: "{sentence-audio} {audio}",
  }),
  { screenshot: true, sentenceAudio: true, wordAudio: true },
  "Template media needs should distinguish screenshot, sentence audio, and word audio markers",
);
assertDeepEqual(
  templates.ankiTemplatesNeedMedia({ Front: "{expression}" }),
  { screenshot: false, sentenceAudio: false, wordAudio: false },
  "Template media needs should stay false when no media markers are mapped",
);

const fields = templates.renderAnkiFields(
  {
    Front: "{expression} {reading}",
    Sentence: "{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}",
    Picture: "{screenshot}",
    Audio: "{audio}",
    Unknown: "x{missing-marker}y",
  },
  {
    expression: "猫 & 犬",
    reading: "ねこ",
    clozePrefix: "私は",
    clozeBody: "猫",
    clozeSuffix: "です。",
  },
  {
    screenshot: "shot.jpg",
    wordAudio: "word.mp3",
  },
);
assert(
  fields.Front === "猫 &amp; 犬 ねこ",
  "Field rendering should escape text marker values",
);
assert(
  fields.Sentence === "私は<b>猫</b>です。",
  "Field rendering should allow template HTML around marker values",
);
assert(
  fields.Picture === '<img src="shot.jpg">',
  "Screenshot marker should render an Anki image tag",
);
assert(
  fields.Audio === "[sound:word.mp3]",
  "Audio marker should render sound syntax",
);
assert(
  fields.Unknown === "xy",
  "Unknown markers should render as empty strings",
);

const singleGlossaryFields = templates.renderAnkiFields(
  {
    Jitendex: "{single-glossary-jitendex}",
  },
  {
    entry: {
      term: {
        glossaries: [
          {
            dict: "旺文社国語辞典 第十二版",
            glossary: "Japanese dictionary definition",
          },
          { dict: "Jitendex.org [2026-06-06]", glossary: "branch family" },
          { dict: "Jitendex.org [2026-06-06]", glossary: "cadet family" },
        ],
      },
    },
  },
  {},
);
assert(
  /branch family/.test(singleGlossaryFields.Jitendex) &&
    !/cadet family/.test(singleGlossaryFields.Jitendex),
  "Yomitan-style single-glossary markers should include one matching dictionary entry",
);
assert(
  !/旺文社国語辞典/.test(singleGlossaryFields.Jitendex),
  "Yomitan-style single-glossary markers should exclude other dictionaries",
);

console.log("anki template tests passed");
