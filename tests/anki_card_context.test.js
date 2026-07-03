const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/52_anki_card_context.js",
  "src/main/52_anki_templates.js",
];
const host = {
  lastSubtitle: "私は猫です。",
  documentTitle: "猫の映画",
  sourcePath: "/Movies/neko.mkv",
  timePos: 83.4,
};
const context = { console, Date, Math, Object, String };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

vm.createContext(context);
vm.runInContext(
  files
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n"),
  context,
);

function buildCardContext(payload, overrides) {
  return context.ankiBuildCardContext(
    payload,
    Object.assign({}, host, overrides || {}),
  );
}

assert(
  context.ankiEscapeHtml("&<>\"'") === "&amp;&lt;&gt;&quot;&#39;",
  "HTML escaping should cover ampersand, angle brackets, quotes, and apostrophes",
);
assert(
  context.ankiYomitanEscapeExpression("&<>\"'") === "&&lt;&gt;\"'",
  "Yomitan expression escaping should only escape angle brackets",
);

const fallbackContext = buildCardContext({
  context: {
    expression: "猫",
    entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    result: { lookupStart: 2, lookupEnd: 3 },
  },
});
assert(
  fallbackContext.sentence === host.lastSubtitle &&
    fallbackContext.surface === "猫",
  "Injected host subtitle should be used for sentence and lookup-surface fallback",
);

const entry = {
  matched: "猫",
  term: {
    expression: "猫",
    reading: "ねこ",
    glossaries: [{ dict: "Jitendex", glossary: "cat; feline" }],
    frequencies: [
      { dict: "JPDB", frequencies: [{ value: 120, displayValue: "120" }] },
    ],
    pitches: [{ positions: [1] }],
  },
};
const cardContext = buildCardContext({
  context: {
    sentence: "私は猫です。",
    position: 2,
    expression: "猫",
    reading: "ねこ",
    surface: "猫",
    entry,
    result: {
      text: "私は猫です。",
      lookupStart: 2,
      lookupEnd: 3,
      language: "ja",
    },
  },
});
assert(
  cardContext.documentTitle === "猫の映画",
  "Document title should come from the injected host metadata",
);
assert(
  cardContext.sourcePath === "/Movies/neko.mkv",
  "Source path should come from the injected host metadata",
);
assert(
  cardContext.timestamp === "1:23",
  "Timestamp should be formatted from the injected host time position",
);
assert(
  cardContext.clozePrefix === "私は",
  "Cloze prefix should follow the subtitle position",
);
assert(
  cardContext.clozeBody === "猫",
  "Cloze body should contain the looked-up surface",
);
assert(
  cardContext.clozeSuffix === "です。",
  "Cloze suffix should preserve the rest of the subtitle",
);

const rendered = context.renderAnkiFields(
  {
    Expression: "{expression}",
    SelectionText: "{popup-selection-text}",
    Sentence: "{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}",
    SentenceAudio: "{sentence-audio}",
    ExpressionAudio: "{audio}",
    Picture: "{screenshot}",
    Glossary: "{glossary-first}",
    Frequency: "{frequencies}",
    PitchPosition: "{pitch-accent-positions}",
    MiscInfo: "{document-title} {timestamp}",
  },
  cardContext,
  {
    sentenceAudio: "iinatan-audio.mp3",
    wordAudio: "iinatan-word.mp3",
    screenshot: "iinatan-shot.jpg",
  },
);
assert(
  rendered.Expression === "猫",
  "Expression marker should render the headword",
);
assert(
  rendered.SelectionText === "",
  "Popup selection marker should stay empty when no popup text was manually selected",
);
assert(
  rendered.Sentence === "私は<b>猫</b>です。",
  "Cloze markers should allow HTML around the looked-up word",
);
assert(
  rendered.SentenceAudio === "[sound:iinatan-audio.mp3]",
  "Sentence audio marker should render Anki sound syntax",
);
assert(
  rendered.ExpressionAudio === "[sound:iinatan-word.mp3]",
  "Word audio marker should render separate Anki sound syntax",
);
assert(
  rendered.Picture === '<img src="iinatan-shot.jpg">',
  "Screenshot marker should render an image tag",
);
assert(
  rendered.Glossary ===
    '<div style="text-align: left;" class="yomitan-glossary"><i>(Jitendex)</i> cat; feline</div>',
  "First glossary marker should render the first definition with Yomitan-style glossary HTML",
);
assert(
  rendered.Frequency === "JPDB 120",
  "Frequency marker should include dictionary and display value",
);
assert(
  rendered.PitchPosition === "1",
  "Pitch position marker should render pitch positions",
);
assert(
  rendered.MiscInfo === "猫の映画 1:23",
  "Document metadata markers should render together",
);

const popupSelectionContext = buildCardContext({
  context: {
    sentence: "私は猫です。",
    position: 2,
    expression: "猫",
    reading: "ねこ",
    surface: "猫",
    popupSelectionText: "cat; feline",
    entry,
    result: {
      text: "私は猫です。",
      lookupStart: 2,
      lookupEnd: 3,
      language: "ja",
    },
  },
});
const popupSelectionRendered = context.renderAnkiFields(
  { SelectionText: "{popup-selection-text}" },
  popupSelectionContext,
  {},
);
assert(
  popupSelectionRendered.SelectionText === "cat; feline",
  "Popup selection marker should render manually selected popup text",
);

const singleGlossaryDatapointEntry = {
  matched: "猫",
  term: {
    expression: "猫",
    reading: "ねこ",
    glossaries: [
      {
        dict: "JMdict",
        definitionTags: "n",
        glossary: JSON.stringify(["cat", "feline"]),
      },
    ],
  },
};
const singleGlossaryDatapointContext = buildCardContext({
  context: {
    sentence: "猫だった。",
    position: 0,
    expression: "猫",
    reading: "ねこ",
    surface: "猫",
    entry: singleGlossaryDatapointEntry,
    result: {
      text: "猫だった。",
      lookupStart: 0,
      lookupEnd: 1,
      language: "ja",
    },
  },
});
const singleGlossaryDatapointRendered = context.renderAnkiFields(
  {
    FirstGlossary: "{glossary-first}",
    SelectedGlossary: "{selected-glossary}",
    FullGlossary: "{glossary}",
  },
  singleGlossaryDatapointContext,
  {},
);
assert(
  singleGlossaryDatapointRendered.FirstGlossary ===
    singleGlossaryDatapointRendered.SelectedGlossary,
  "Selected glossary should share the same renderer as glossary-first",
);
assert(
  singleGlossaryDatapointRendered.FirstGlossary ===
    singleGlossaryDatapointRendered.FullGlossary,
  "Single glossary datapoints should use the same renderer as the full glossary marker",
);
assert(
  /<i>\(n, JMdict\)<\/i> <ul><li>cat<\/li><li>feline<\/li><\/ul>/.test(
    singleGlossaryDatapointRendered.FirstGlossary,
  ),
  "Single glossary datapoints should still render their internal glossary array as a Yomitan-style list",
);
assert(
  !/<ol>/.test(singleGlossaryDatapointRendered.FirstGlossary),
  "Single glossary datapoints should not get an extra grouped-entry ordered list wrapper",
);

const jitendexStructuredGlossary = JSON.stringify([
  {
    type: "structured-content",
    content: [
      {
        tag: "div",
        data: { content: "sense-group" },
        content: [
          {
            tag: "span",
            title: "noun (common) (futsuumeishi)",
            data: { class: "tag", code: "n", content: "part-of-speech-info" },
            content: "noun",
          },
          {
            tag: "div",
            data: { content: "sense" },
            content: [
              {
                tag: "ul",
                data: { content: "glossary" },
                content: [
                  { tag: "li", content: "first love" },
                  { tag: "li", content: "puppy love" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
const structuredEntry = {
  matched: "初恋",
  term: {
    expression: "初恋",
    reading: "はつこい",
    glossaries: [
      {
        dict: "Jitendex.org [2026-06-06]",
        definitionTags: "n",
        glossary: jitendexStructuredGlossary,
      },
    ],
  },
};
const structuredContext = buildCardContext({
  context: {
    sentence: "初恋だった。",
    position: 0,
    expression: "初恋",
    reading: "はつこい",
    surface: "初恋",
    entry: structuredEntry,
    result: {
      text: "初恋だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const structuredRendered = context.renderAnkiFields(
  {
    MainDefinition: "{selected-glossary}",
    FullGlossary: "{glossary}",
    PlainGlossary: "{glossary-plain}",
    FirstGlossary: "{glossary-first}",
  },
  structuredContext,
  {},
);
assert(
  /class="yomitan-glossary"/.test(structuredRendered.MainDefinition),
  "Selected glossary should render as formatted glossary HTML",
);
assert(
  /<i>\(n, Jitendex\.org \[2026-06-06\]\)<\/i>/.test(
    structuredRendered.MainDefinition,
  ),
  "Selected glossary should retain Yomitan-style dictionary metadata",
);
assert(
  !/data-dictionary=/.test(structuredRendered.MainDefinition),
  "Selected single glossary HTML should not get the grouped-entry data-dictionary wrapper",
);
assert(
  /class="structured-content"/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should use Yomitan structured-content wrappers",
);
assert(
  /class="gloss-sc-ul" data-sc-content="glossary"/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve Yomitan data-sc attributes",
);
assert(
  !/data-content="glossary"/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should not emit non-Yomitan data-content attributes",
);
assert(
  /<li class="gloss-sc-li">first love<\/li>/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve list items with Yomitan classes",
);
assert(
  !/\[\{"type":/.test(structuredRendered.MainDefinition),
  "Selected glossary should not leak raw structured-content JSON",
);
assert(
  !/\[\{"type":/.test(structuredRendered.FullGlossary),
  "Full glossary should not leak raw structured-content JSON",
);
assert(
  structuredRendered.PlainGlossary === "first love\npuppy love",
  "Plain glossary should extract only glossary text from structured content",
);
assert(
  !/nounfirst/.test(structuredRendered.PlainGlossary),
  "Plain glossary should separate structured tags from definitions",
);
assert(
  structuredRendered.FirstGlossary === structuredRendered.MainDefinition,
  "Glossary-first should use the same single glossary HTML renderer as selected glossary",
);

console.log("anki card context tests passed");
