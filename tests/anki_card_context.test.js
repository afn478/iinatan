const fs = require("fs");
const os = require("os");
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
const tempDictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-anki-"));
const jitendexStylesDir = path.join(tempDictRoot, "Jitendex.org [2026-06-06]");
fs.mkdirSync(jitendexStylesDir, { recursive: true });
fs.writeFileSync(
  path.join(jitendexStylesDir, "styles.css"),
  [
    '[data-sc-content="formsTable"] {',
    "  & table { border-collapse: collapse; }",
    "  & tr { border-block-end: 1px solid currentColor; }",
    "  & th, & td { padding: 0.25em; }",
    "  & span { white-space: nowrap; }",
    "}",
    ".popup-only-export-sentinel { color: red; }",
  ].join("\n"),
);
const meikyoStylesDir = path.join(tempDictRoot, "明鏡国語辞典 第三版");
fs.mkdirSync(meikyoStylesDir, { recursive: true });
fs.writeFileSync(
  path.join(meikyoStylesDir, "styles.css"),
  [
    "details summary { border-block-end: 1px dotted #33CCFF; cursor: pointer; }",
    'details summary::before { content: "\\25B6"; margin-inline-end: 0.25em; }',
    'details[open] summary::before { content: "\\25BC"; }',
  ].join("\n"),
);
const outsideDictRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "iinatan-outside-"),
);
fs.writeFileSync(
  path.join(outsideDictRoot, "styles.css"),
  ".leaked-style { color: red; }",
);
const context = {
  console,
  Date,
  Math,
  Object,
  String,
  file: {
    exists: fs.existsSync,
    read: (filePath) => fs.readFileSync(filePath, "utf8"),
  },
  dictRoot: () => tempDictRoot,
  pathJoin: (...parts) => path.join(...parts),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoBrokenNestedCss(html, label) {
  assert(
    !/\]\s*&\s*(?:table|tr|th|td|span|ul)/.test(html),
    label + " should not contain dictionary-scoped nested CSS selectors",
  );
  assert(
    !/\.yomitan-glossary\s+\[data-dictionary=[^\]]+\]\s*&/.test(html),
    label + " should not contain scope-plus-ampersand CSS selectors",
  );
  assert(
    !/&\s*(?:table|tr|th|td|span|ul)/.test(html),
    label + " should not contain raw CSS nesting ampersands",
  );
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

function extractDictionaryListItem(html, dictionary) {
  const startToken = '<li data-dictionary="' + dictionary + '"';
  const start = String(html || "").indexOf(startToken);
  if (start < 0) return "";
  const tagPattern = /<\/?li\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match = null;
  while ((match = tagPattern.exec(html))) {
    if (match[0].slice(0, 2) === "</") {
      depth -= 1;
      if (depth === 0) return html.slice(start, tagPattern.lastIndex);
    } else {
      depth += 1;
    }
  }
  return "";
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
  singleGlossaryDatapointRendered.SelectedGlossary ===
    singleGlossaryDatapointRendered.FullGlossary,
  "Selected glossary should share the same Yomitan-style grouped renderer as the full glossary",
);
assert(
  /<ol><li data-dictionary="JMdict"><i>\(n, JMdict\)<\/i> <ul><li>cat<\/li><li>feline<\/li><\/ul><\/li><\/ol>/.test(
    singleGlossaryDatapointRendered.SelectedGlossary,
  ),
  "Selected single-dictionary datapoints should use a Yomitan-style dictionary list item for Lapis",
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
            tag: "span",
            title: "noun or participle which takes the aux. verb suru",
            data: { class: "tag", code: "vs", content: "part-of-speech-info" },
            content: "suru",
          },
          {
            tag: "span",
            title: "intransitive verb",
            data: { class: "tag", code: "vi", content: "part-of-speech-info" },
            content: "intransitive",
          },
          {
            tag: "div",
            data: { content: "sense" },
            content: [
              {
                tag: "ul",
                data: { content: "glossary" },
                content: [
                  { tag: "li", content: "branch family" },
                  { tag: "li", content: "cadet family" },
                  { tag: "li", content: "establishing a branch family" },
                ],
              },
              {
                tag: "div",
                data: { content: "extra-info" },
                content: [
                  {
                    tag: "div",
                    content: [
                      {
                        tag: "div",
                        data: {
                          class: "extra-box",
                          content: "example-sentence",
                          sentenceKey: "分家",
                          source: "76293",
                        },
                        content: [
                          {
                            tag: "div",
                            data: { content: "example-sentence-a" },
                            content: [
                              {
                                tag: "span",
                                lang: "ja",
                                content: [
                                  "暇なら",
                                  {
                                    tag: "span",
                                    data: { content: "example-keyword" },
                                    content: "分家",
                                  },
                                  "の仕事を手伝って来い。",
                                ],
                              },
                            ],
                          },
                          {
                            tag: "div",
                            data: { content: "example-sentence-b" },
                            content: [
                              {
                                tag: "span",
                                lang: "en",
                                content:
                                  "If you've got the time help out with our relative's work.",
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    tag: "div",
                    content: [
                      {
                        tag: "div",
                        data: { class: "extra-box", content: "xref" },
                        content: [
                          {
                            tag: "div",
                            data: { content: "xref-content" },
                            content: [
                              {
                                tag: "span",
                                lang: "en",
                                data: { content: "reference-label" },
                                content: "See also",
                              },
                              {
                                tag: "a",
                                href: "?query=%E6%9C%AC%E5%AE%B6",
                                lang: "ja",
                                content: [
                                  {
                                    tag: "ruby",
                                    content: [
                                      "本",
                                      { tag: "rt", content: "ほん" },
                                    ],
                                  },
                                  {
                                    tag: "ruby",
                                    content: [
                                      "家",
                                      { tag: "rt", content: "け" },
                                    ],
                                  },
                                ],
                              },
                              " / ",
                              {
                                tag: "a",
                                href: "#",
                                content: "分家",
                              },
                            ],
                          },
                          {
                            tag: "div",
                            data: { content: "xref-glossary" },
                            content: "① head house; main family",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        tag: "div",
        data: { content: "attribution" },
        content: [
          {
            tag: "a",
            href: "https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&q=1503160",
            content: "JMdict",
          },
          " | ",
          {
            tag: "a",
            href: "https://tatoeba.org/en/sentences/show/76293",
            content: "Tatoeba",
          },
        ],
      },
    ],
  },
]);
const structuredEntry = {
  matched: "分家",
  term: {
    expression: "分家",
    reading: "ぶんけ",
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
    sentence: "分家だった。",
    position: 0,
    expression: "分家",
    reading: "ぶんけ",
    surface: "分家",
    entry: structuredEntry,
    result: {
      text: "分家だった。",
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
  /<ol><li data-dictionary="Jitendex\.org \[2026-06-06\]">/.test(
    structuredRendered.MainDefinition,
  ),
  "Selected single glossary HTML should use the Yomitan single-glossary dictionary wrapper for Lapis",
);
assert(
  /<i>\(n, Jitendex\.org \[2026-06-06\]\)<\/i> <span><div data-sc-content="sense-group">/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should use Yomitan-compatible plain structured-content wrappers",
);
assert(
  !/class="(?:structured-content|gloss-sc-(?:div|span|ul|li|ruby|rt|details|summary))"/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should not add non-Yomitan wrapper or element classes that can confuse Lapis",
);
assert(
  /<ul data-sc-content="glossary">/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should preserve Yomitan data-sc attributes",
);
assert(
  !/data-content="glossary"/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should not emit non-Yomitan data-content attributes",
);
assert(
  /<li>branch family<\/li>/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should preserve list items as Yomitan-style data-sc markup",
);
assert(
  />noun<\/span>\s+<span [^>]*>suru<\/span>\s+<span [^>]*>intransitive<\/span>/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should separate adjacent part-of-speech tags",
);
assert(
  !/nounsuru|suruintransitive/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should not concatenate adjacent part-of-speech tags",
);
assert(
  /data-sc-class="extra-box" data-sc-content="example-sentence"/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve Jitendex example boxes",
);
assert(
  /<span lang="ja">暇なら<span data-sc-content="example-keyword">分家<\/span>の仕事を手伝って来い。<\/span>/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve example keyword markup",
);
assert(
  /data-sc-class="extra-box" data-sc-content="xref"/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should preserve Jitendex xref boxes",
);
assert(
  />See also<\/span>\s+<span class="gloss-link"><span class="gloss-link-text"><ruby>本<rt>ほん<\/rt><\/ruby><ruby>家<rt>け<\/rt><\/ruby><\/span><\/span>/.test(
    structuredRendered.MainDefinition,
  ),
  "Structured glossary HTML should separate reference labels from stripped xref text",
);
assert(
  !/href="#"/.test(structuredRendered.MainDefinition),
  "Dictionary-internal structured links should not render as unusable Anki anchors",
);
assert(
  !/href="\?/.test(structuredRendered.MainDefinition),
  "Dictionary-internal query links should not render as unusable Anki anchors",
);
assert(
  /data-sc-content="attribution"/.test(structuredRendered.MainDefinition),
  "Structured glossary HTML should preserve attribution rows",
);
assert(
  /<a class="gloss-link" href="https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&amp;q=1503160">/.test(
    structuredRendered.MainDefinition,
  ),
  "JMdict attribution links should remain clickable in Anki glossary HTML",
);
assert(
  /<a class="gloss-link" href="https:\/\/tatoeba\.org\/en\/sentences\/show\/76293">/.test(
    structuredRendered.MainDefinition,
  ),
  "Tatoeba attribution links should remain clickable in Anki glossary HTML",
);
assert(
  /<style>[\s\S]*data-sc-content="example-sentence"[\s\S]*data-sc-content="xref"[\s\S]*data-sc-content="attribution"[\s\S]*<\/style>/.test(
    structuredRendered.MainDefinition,
  ),
  "Jitendex structured glossary HTML should include card-local styling",
);
assertNoBrokenNestedCss(
  structuredRendered.MainDefinition,
  "Selected Jitendex glossary HTML",
);
assert(
  !/popup-only-export-sentinel|formsTable/.test(
    structuredRendered.MainDefinition,
  ),
  "Selected Jitendex glossary HTML should not embed dictionary styles.css rules",
);
assert(
  /<ol><li data-dictionary="Jitendex\.org \[2026-06-06\]">[\s\S]*<\/li><style>[\s\S]*<\/style><\/ol><\/div>$/.test(
    structuredRendered.MainDefinition,
  ),
  "Selected glossary styles should stay inside the ordered list like Yomitan single-glossary output",
);
assert(
  /https:\/\/tatoeba\.org\/en\/sentences\/show\/76293/.test(
    structuredRendered.FullGlossary,
  ),
  "Full glossary HTML should preserve Jitendex attribution links",
);
assert(
  /<style>[\s\S]*data-sc-content="example-sentence"[\s\S]*<\/style>/.test(
    structuredRendered.FullGlossary,
  ),
  "Full glossary HTML should include Jitendex card-local styling",
);
assertNoBrokenNestedCss(
  structuredRendered.FullGlossary,
  "Full Jitendex glossary HTML",
);
assert(
  !/popup-only-export-sentinel|formsTable/.test(
    structuredRendered.FullGlossary,
  ),
  "Full Jitendex glossary HTML should not embed dictionary styles.css rules",
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
  structuredRendered.PlainGlossary ===
    "branch family\ncadet family\nestablishing a branch family",
  "Plain glossary should extract only glossary text from structured content",
);
assert(
  !/JMdict|Tatoeba|See also|暇なら|head house/.test(
    structuredRendered.PlainGlossary,
  ),
  "Plain glossary should not include examples, xrefs, or attribution",
);
assert(
  !/nounfirst/.test(structuredRendered.PlainGlossary),
  "Plain glossary should separate structured tags from definitions",
);
assert(
  structuredRendered.FirstGlossary !== structuredRendered.MainDefinition &&
    !/<ol><li data-dictionary=/.test(structuredRendered.FirstGlossary) &&
    /<ol><li data-dictionary=/.test(structuredRendered.MainDefinition),
  "Glossary-first should remain compact while selected glossary uses the Lapis-compatible dictionary wrapper",
);

const multiStructuredEntry = {
  matched: "分家",
  term: {
    expression: "分家",
    reading: "ぶんけ",
    glossaries: [
      structuredEntry.term.glossaries[0],
      {
        dict: "旺文社国語辞典 第十二版",
        glossary:
          "ぶんけ【分家】（名・自スル）家族の成員が分かれて別に一家を立てること。",
      },
    ],
  },
};
const multiStructuredContext = buildCardContext({
  context: {
    sentence: "分家だった。",
    position: 0,
    expression: "分家",
    reading: "ぶんけ",
    surface: "分家",
    entry: multiStructuredEntry,
    result: {
      text: "分家だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const multiStructuredRendered = context.renderAnkiFields(
  {
    MainDefinition: "{selected-glossary}",
    FullGlossary: "{glossary}",
    FirstGlossary: "{glossary-first}",
  },
  multiStructuredContext,
  {},
);
const selectedJitendexListItem = extractDictionaryListItem(
  multiStructuredRendered.MainDefinition,
  "Jitendex.org [2026-06-06]",
);
const fullJitendexListItem = extractDictionaryListItem(
  multiStructuredRendered.FullGlossary,
  "Jitendex.org [2026-06-06]",
);
assert(
  /<ol><li data-dictionary="Jitendex\.org \[2026-06-06\]">/.test(
    multiStructuredRendered.MainDefinition,
  ),
  "Selected glossary should mimic Yomitan single-glossary output for grouped entries",
);
assert(
  selectedJitendexListItem && selectedJitendexListItem === fullJitendexListItem,
  "Selected glossary list item should match the corresponding full glossary list item for Lapis filtering",
);
assert(
  (multiStructuredRendered.MainDefinition.match(/<li data-dictionary=/g) || [])
    .length === 1,
  "Selected grouped glossary should only include the selected dictionary list item",
);
assert(
  !/<ol><li data-dictionary=/.test(multiStructuredRendered.FirstGlossary),
  "Glossary-first should remain the ungrouped first-definition renderer",
);

const repeatedSelectedDictionaryEntry = {
  matched: "分家",
  term: {
    expression: "分家",
    reading: "ぶんけ",
    glossaries: [
      structuredEntry.term.glossaries[0],
      {
        dict: "Jitendex.org [2026-06-06]",
        glossary: "offshoot household",
      },
      {
        dict: "旺文社国語辞典 第十二版",
        glossary:
          "ぶんけ【分家】（名・自スル）家族の成員が分かれて別に一家を立てること。",
      },
    ],
  },
};
const repeatedSelectedDictionaryContext = buildCardContext({
  context: {
    sentence: "分家だった。",
    position: 0,
    expression: "分家",
    reading: "ぶんけ",
    surface: "分家",
    entry: repeatedSelectedDictionaryEntry,
    result: {
      text: "分家だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const repeatedSelectedDictionaryRendered = context.renderAnkiFields(
  {
    MainDefinition: "{selected-glossary}",
    FullGlossary: "{glossary}",
  },
  repeatedSelectedDictionaryContext,
  {},
);
const selectedJitendexCount = (
  repeatedSelectedDictionaryRendered.MainDefinition.match(
    /<li data-dictionary="Jitendex\.org \[2026-06-06\]">/g,
  ) || []
).length;
const fullJitendexCount = (
  repeatedSelectedDictionaryRendered.FullGlossary.match(
    /<li data-dictionary="Jitendex\.org \[2026-06-06\]">/g,
  ) || []
).length;
assert(
  selectedJitendexCount === 1 && fullJitendexCount === 2,
  "Selected glossary should include one selected dictionary entry while full glossary keeps every matching entry",
);
assert(
  !/offshoot household/.test(repeatedSelectedDictionaryRendered.MainDefinition),
  "Selected glossary should not absorb later entries from the same dictionary",
);
assert(
  !/旺文社国語辞典/.test(repeatedSelectedDictionaryRendered.MainDefinition),
  "Selected glossary should not include entries from other dictionaries",
);

const nonJitendexFirstEntry = {
  matched: "分家",
  term: {
    expression: "分家",
    reading: "ぶんけ",
    glossaries: [
      {
        dict: "旺文社国語辞典 第十二版",
        glossary:
          "ぶんけ【分家】（名・自スル）家族の成員が分かれて別に一家を立てること。",
      },
      structuredEntry.term.glossaries[0],
      {
        dict: "Jitendex.org [2026-06-06]",
        glossary: "offshoot household",
      },
    ],
  },
};
const nonJitendexFirstContext = buildCardContext({
  context: {
    sentence: "分家だった。",
    position: 0,
    expression: "分家",
    reading: "ぶんけ",
    surface: "分家",
    entry: nonJitendexFirstEntry,
    result: {
      text: "分家だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const nonJitendexFirstRendered = context.renderAnkiFields(
  {
    MainDefinition: "{selected-glossary}",
    JitendexDefinition: "{single-glossary-jitendex}",
    FirstGlossary: "{glossary-first}",
    FullGlossary: "{glossary}",
  },
  nonJitendexFirstContext,
  {},
);
assert(
  /家族の成員が分かれて別に一家を立てること/.test(
    nonJitendexFirstContext.glossaryFirst,
  ) && !/branch family/.test(nonJitendexFirstContext.glossaryFirst),
  "Plain glossary-first context should remain the literal first definition",
);
assert(
  /branch family/.test(nonJitendexFirstContext.selectedGlossary) &&
    !/家族の成員が分かれて別に一家を立てること/.test(
      nonJitendexFirstContext.selectedGlossary,
    ),
  "Plain selected glossary context should use Jitendex when available",
);
assert(
  /旺文社国語辞典 第十二版/.test(nonJitendexFirstRendered.FirstGlossary) &&
    !/Jitendex\.org/.test(nonJitendexFirstRendered.FirstGlossary),
  "Glossary-first should remain the literal first definition when it is not Jitendex",
);
assert(
  nonJitendexFirstRendered.MainDefinition ===
    nonJitendexFirstRendered.JitendexDefinition,
  "Selected glossary should match the explicit Yomitan-style Jitendex single-glossary marker",
);
assert(
  /branch family/.test(nonJitendexFirstRendered.MainDefinition) &&
    !/offshoot household/.test(nonJitendexFirstRendered.MainDefinition),
  "Selected glossary should include the first matching Jitendex entry even when Jitendex is not first",
);
assert(
  !/旺文社国語辞典/.test(nonJitendexFirstRendered.MainDefinition),
  "Selected glossary should not fall back to the first non-Jitendex definition",
);
assert(
  (
    nonJitendexFirstRendered.MainDefinition.match(
      /<li data-dictionary="Jitendex\.org \[2026-06-06\]">/g,
    ) || []
  ).length === 1,
  "Selected glossary should keep exactly one selected dictionary list item",
);

const noJitendexContext = buildCardContext({
  context: {
    sentence: "分家だった。",
    position: 0,
    expression: "分家",
    reading: "ぶんけ",
    surface: "分家",
    entry: {
      matched: "分家",
      term: {
        expression: "分家",
        reading: "ぶんけ",
        glossaries: [
          {
            dict: "旺文社国語辞典 第十二版",
            glossary:
              "ぶんけ【分家】（名・自スル）家族の成員が分かれて別に一家を立てること。",
          },
        ],
      },
    },
    result: {
      text: "分家だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const noJitendexRendered = context.renderAnkiFields(
  {
    SelectedGlossary: "{selected-glossary}",
    JitendexDefinition: "{single-glossary-jitendex}",
  },
  noJitendexContext,
  {},
);
assert(
  /旺文社国語辞典 第十二版/.test(noJitendexRendered.SelectedGlossary),
  "Selected glossary should still fall back to the available first dictionary when Jitendex is absent",
);
assert(
  noJitendexRendered.JitendexDefinition === "",
  "Explicit Yomitan-style Jitendex single-glossary markers should stay empty when Jitendex is absent",
);

const detailsGlossary = JSON.stringify([
  {
    type: "structured-content",
    content: [
      {
        tag: "details",
        data: { details: "" },
        content: [
          {
            tag: "summary",
            data: { summary: "" },
            content: [{ tag: "span", lang: "ja", content: "例文２件" }],
          },
          {
            tag: "div",
            data: { example: "", id: "55939-5001" },
            content: "「三男が分家する」",
          },
        ],
      },
    ],
  },
]);
const detailsContext = buildCardContext({
  context: {
    sentence: "分家だった。",
    position: 0,
    expression: "分家",
    reading: "ぶんけ",
    surface: "分家",
    entry: {
      matched: "分家",
      term: {
        expression: "分家",
        reading: "ぶんけ",
        glossaries: [
          {
            dict: "明鏡国語辞典 第三版",
            glossary: detailsGlossary,
          },
        ],
      },
    },
    result: {
      text: "分家だった。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const detailsRendered = context.renderAnkiFields(
  { Glossary: "{glossary}" },
  detailsContext,
  {},
);
assert(
  /<details data-sc-details="">/.test(detailsRendered.Glossary),
  "Structured details should render with Yomitan-style data-sc attributes",
);
assert(
  /<summary data-sc-summary="">/.test(detailsRendered.Glossary),
  "Structured summaries should render with Yomitan-style data-sc attributes",
);
assert(
  /\.yomitan-glossary summary\[data-sc-summary\][^{]*\{[^}]*display: list-item/.test(
    detailsRendered.Glossary,
  ),
  "Structured glossary HTML should keep native summary disclosure styling",
);
assert(
  !/summary\[data-sc-summary\](?:::[^{\s]+)?[^{]*\{[^}]*content:/.test(
    detailsRendered.Glossary,
  ) &&
    !/details\[data-sc-details\][^{]*summary\[data-sc-summary\]::before/.test(
      detailsRendered.Glossary,
    ),
  "Structured glossary HTML should not export generated-content summary pseudo-elements",
);
assert(
  !/#33CCFF|details summary::before/.test(detailsRendered.Glossary),
  "Dictionary styles.css should not be embedded in Anki field HTML",
);
assert(
  !/data-sc-dictionary="明鏡国語辞典 第三版"/.test(detailsRendered.Glossary),
  "Structured glossary HTML should not require extra non-Yomitan dictionary wrappers for scoped styles",
);

const unsafeStyleContext = buildCardContext({
  context: {
    sentence: "危ない。",
    position: 0,
    expression: "危険",
    reading: "きけん",
    surface: "危険",
    entry: {
      matched: "危険",
      term: {
        expression: "危険",
        reading: "きけん",
        glossaries: [
          {
            dict: path.relative(tempDictRoot, outsideDictRoot),
            glossary: detailsGlossary,
          },
        ],
      },
    },
    result: {
      text: "危ない。",
      lookupStart: 0,
      lookupEnd: 2,
      language: "ja",
    },
  },
});
const unsafeStyleRendered = context.renderAnkiFields(
  { Glossary: "{glossary}" },
  unsafeStyleContext,
  {},
);
assert(
  !/leaked-style/.test(unsafeStyleRendered.Glossary),
  "Dictionary style fallback should not read path-like dictionary labels outside the dictionary root",
);

console.log("anki card context tests passed");
