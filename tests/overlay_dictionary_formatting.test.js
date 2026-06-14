const fs = require("fs");
const path = require("path");
const {
  assert,
  loadOverlayForTest,
  root,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest([
  "state",
  "applyConfig",
  "renderGlossaryPayload",
  "renderStructuredNode",
  "renderPlainGlossaryText",
  "renderEntryMetadata",
  "displayHeaderForResult",
  "displayReadingForTerm",
  "segmentFurigana",
  "renderFuriganaHtml",
  "renderPopupHead",
  "safeExternalUrl",
  "placePopup",
]);

overlay.applyConfig({
  debugLogVerbose: false,
  etymologyCollapseDefault: "collapsed",
  wiktionaryEtymologyCollapseOverride: "collapsed",
  customPopupCss: "#popup .gloss { font-size: 16px; }",
});
assert(
  context.__head.children.length === 1,
  "Custom CSS should create a style element",
);
assert(
  /font-size: 16px/.test(context.__head.children[0].textContent),
  "Custom CSS should be applied",
);

overlay.applyConfig({ popupTheme: "light" });
assert(
  /\btheme-light\b/.test(context.document.documentElement.className),
  "Forced light mode should apply the light theme class",
);
assert(
  !/\btheme-inherit\b/.test(context.document.documentElement.className),
  "Forced light mode should not leave an inherit theme class",
);
overlay.applyConfig({ popupTheme: "dark" });
assert(
  /\btheme-dark\b/.test(context.document.documentElement.className),
  "Forced dark mode should apply the dark theme class",
);
overlay.applyConfig({ popupTheme: "inherit", popupThemeHint: "light" });
assert(
  /\btheme-light\b/.test(context.document.documentElement.className),
  "Inherited light hint should resolve to the concrete light theme",
);
assert(
  !/\btheme-inherit\b/.test(context.document.documentElement.className),
  "Inherited mode should resolve without its own theme class",
);
overlay.applyConfig({ popupTheme: "inherit", popupThemeHint: "dark" });
assert(
  /\btheme-dark\b/.test(context.document.documentElement.className),
  "Inherited dark hint should resolve to the concrete dark theme",
);

context.window.innerWidth = 2560;
context.window.innerHeight = 1440;
context.__elements.subtitle._rect = {
  left: 0,
  top: 1000,
  right: 2560,
  bottom: 1080,
  width: 2560,
  height: 80,
};
context.__elements.popup._rect = {
  left: 0,
  top: 0,
  right: 528,
  bottom: 360,
  width: 528,
  height: 360,
};
const scaledPlacementAnchor = context.document.createElement("span");
scaledPlacementAnchor._rect = {
  left: 1400,
  top: 1008,
  right: 1460,
  bottom: 1080,
  width: 60,
  height: 72,
};
overlay.applyConfig({
  popupScale: 1.2,
  popupMaxHeightVh: 34,
  popupSubtitleGapPx: 34,
});
overlay.placePopup(scaledPlacementAnchor);
const scaledPopupTop = Number.parseFloat(context.__elements.popup.style.top);
assert(
  scaledPopupTop + context.__elements.popup._rect.height <=
    context.__elements.subtitle._rect.top - 34 + 0.001,
  "Scaled popup should stay above the subtitle-safe region",
);
assert(
  context.document.documentElement.style["--popup-max-height"] === "407px",
  "Scaled popup max-height should reserve visual room after CSS transform",
);

const header = overlay.displayHeaderForResult(
  {
    text: "I was juster",
    lookupStart: 6,
    lookupEnd: 12,
    lookupText: "just",
    candidateUsed: { text: "just", displayText: "juster" },
  },
  {
    matched: "just",
    deinflected: "just",
    term: { expression: "just", reading: "", glossaries: [] },
  },
);
assert(
  header.heading === "just",
  "Dictionary headword should be the primary heading",
);
assert(
  header.secondary === "looked up from: juster",
  "Surface form should be secondary metadata",
);
assert(
  header.reading === "",
  "Expression-identical readings should not be shown as popup readings",
);

const japaneseHeader = overlay.displayHeaderForResult(
  {
    language: "ja",
    text: "情報",
    lookupStart: 0,
    lookupEnd: 2,
    lookupText: "情報",
  },
  {
    matched: "情報",
    deinflected: "情報",
    term: { expression: "情報", reading: "じょうほう", glossaries: [] },
  },
);
assert(
  japaneseHeader.reading === "じょうほう",
  "Distinct dictionary readings should remain visible",
);
assert(
  JSON.stringify(overlay.segmentFurigana("積む", "つむ")) ===
    JSON.stringify([
      ["積", "つ"],
      ["む", ""],
    ]),
  "Japanese okurigana should be removed from generated furigana",
);
assert(
  JSON.stringify(overlay.segmentFurigana("情報", "じょうほう")) ===
    JSON.stringify([["情報", "じょうほう"]]),
  "Kanji compounds should stay grouped so browser ruby can distribute the reading",
);
assert(
  JSON.stringify(overlay.segmentFurigana("駆け込む", "かけこむ")) ===
    JSON.stringify([
      ["駆", "か"],
      ["け", ""],
      ["込", "こ"],
      ["む", ""],
    ]),
  "Japanese furigana segmentation should handle kana between kanji groups",
);
assert(
  overlay.renderFuriganaHtml("積む", "つむ") === "<ruby>積<rt>つ</rt></ruby>む",
  "Japanese furigana HTML should annotate only the kanji-bearing segment",
);

const headerHtml = overlay.renderPopupHead(
  japaneseHeader.heading,
  japaneseHeader.reading,
  "",
  null,
);
assert(
  /class="headword-stack"/.test(headerHtml),
  "Popup readings and headwords should share one sizing stack",
);
assert(
  /<span class="term"><ruby>情報<rt>じょうほう<\/rt><\/ruby><\/span>/.test(
    headerHtml,
  ),
  "Japanese popup readings should render as ruby above the headword",
);
assert(
  !/class="reading">じょうほう/.test(headerHtml),
  "Japanese popup readings should not render as a separate plain reading row",
);

const duplicateReading = overlay.displayReadingForTerm(
  { expression: "witch", reading: "witch" },
  "witch",
);
assert(
  duplicateReading === "",
  "Latin expression-copied readings should be hidden generally",
);
const latinReadingHtml = overlay.renderPopupHead(
  "résumé",
  "REZ-oo-may",
  "",
  null,
);
assert(
  latinReadingHtml.indexOf('class="reading">REZ-oo-may</span>') <
    latinReadingHtml.indexOf('class="term">résumé</span>'),
  "Non-Japanese readings should still render above the headword as plain text",
);
const chineseReadingHtml = overlay.renderPopupHead(
  "情報",
  "qing bao",
  "",
  null,
);
assert(
  /<span class="term"><ruby>情報<rt>qing bao<\/rt><\/ruby><\/span>/.test(
    chineseReadingHtml,
  ),
  "Hanzi readings without kana should render as whole-headword ruby for spacing",
);
assert(
  !/class="reading">qing bao/.test(chineseReadingHtml),
  "Hanzi ruby readings should not render as a separate plain reading row",
);
const koreanReadingHtml = overlay.renderPopupHead("한국", "han-guk", "", null);
assert(
  koreanReadingHtml.indexOf('class="reading">han-guk</span>') <
    koreanReadingHtml.indexOf('class="term">한국</span>'),
  "Non-Hanzi readings should keep the plain reading row",
);

const zhHeader = overlay.displayHeaderForResult(
  {
    language: "zh",
    text: "日本語の",
    lookupStart: 0,
    lookupEnd: 4,
    lookupText: "日本語の",
    candidateUsed: { text: "日本語の", displayText: "日" },
  },
  {
    matched: "日本語",
    deinflected: "日本語",
    term: { expression: "日本語", reading: "", glossaries: [] },
  },
);
assert(
  zhHeader.heading === "日本語",
  "Chinese prefix result should keep dictionary headword primary",
);
assert(
  zhHeader.secondary === "",
  "Chinese prefix result should not show one-character looked-up metadata when matched term equals heading",
);

const structuredGlossary = JSON.stringify([
  {
    type: "structured-content",
    content: [
      {
        tag: "details",
        data: { content: "details-entry-Grammar" },
        content: [
          { tag: "summary", content: "Grammar" },
          "comparative form; adjective",
        ],
      },
      {
        tag: "details",
        data: { content: "details-entry-Etymology" },
        content: [
          { tag: "summary", content: "Etymology" },
          "From Middle English ",
          {
            tag: "a",
            href: "https://en.wiktionary.org/wiki/just",
            content: "just",
          },
        ],
      },
      {
        tag: "ul",
        data: { content: "glosses" },
        content: [{ tag: "li", content: "fair; morally right" }],
      },
      {
        tag: "div",
        data: { content: "backlink" },
        content: [
          {
            tag: "a",
            href: "https://kaikki.org/dictionary/English/meaning/j/ju/just.html",
            content: "Kaikki",
          },
        ],
      },
    ],
  },
]);

const structuredHtml = overlay.renderGlossaryPayload({
  dict: "Kaikki English",
  glossary: structuredGlossary,
  definitionTags: "priority form",
  termTags: "adjective",
});
assert(
  /<b>Grammar<\/b>:/.test(structuredHtml),
  "Grammar details should render as a labeled row",
);
assert(
  /comparative form; adjective/.test(structuredHtml),
  "Grammar content should be preserved",
);
assert(
  /<details class="dict-details etymology-section">/.test(structuredHtml),
  "Etymology should be a collapsed details section by default",
);
assert(
  !/<details class="dict-details etymology-section" open>/.test(structuredHtml),
  "Wiktionary/Kaikki etymology should default collapsed",
);
assert(
  /href="https:\/\/en\.wiktionary\.org\/wiki\/just"/.test(structuredHtml),
  "Wiktionary links should remain clickable",
);
assert(
  /data-external-url="https:\/\/kaikki\.org\/dictionary\/English\/meaning\/j\/ju\/just\.html"/.test(
    structuredHtml,
  ),
  "Kaikki source links should be clickable",
);
assert(
  /class="tag-chip tag-priority"/.test(structuredHtml),
  "Priority tag should render as a star chip",
);
assert(
  !/>priority form</.test(structuredHtml),
  "Priority tag text should not be visible",
);
assert(
  /class="tag-chip tag-term">adjective</.test(structuredHtml),
  "Term tags should render compact chips",
);
assert(
  !/nonlemma-row/.test(structuredHtml),
  "Structured Wiktionary entries should not be flattened into non-lemma rows",
);

overlay.applyConfig({
  etymologyCollapseDefault: "expanded",
  wiktionaryEtymologyCollapseOverride: "inherit",
});
const expandedHtml = overlay.renderGlossaryPayload({
  dict: "Kaikki English",
  glossary: structuredGlossary,
});
assert(
  /<details class="dict-details etymology-section" open>/.test(expandedHtml),
  "Global expanded etymology setting should apply when Wiktionary override inherits",
);

const plainHtml = overlay.renderGlossaryPayload({
  dict: "Kaikki English",
  glossary:
    'Grammar{"degree":"comparative"}EtymologyEtymology tree: from https://en.wiktionary.org/wiki/just',
});
assert(
  /<b>Grammar<\/b>: <span>\{&quot;degree&quot;:&quot;comparative&quot;\}<\/span>/.test(
    plainHtml,
  ),
  "Flattened Grammar text should be separated",
);
assert(
  /<summary>Etymology<\/summary>/.test(plainHtml),
  "Flattened Etymology text should be separated",
);
assert(
  /data-external-url="https:\/\/en\.wiktionary\.org\/wiki\/just"/.test(
    plainHtml,
  ),
  "Plain source URLs should be linkified",
);

const nonLemmaHtml = overlay.renderGlossaryPayload({
  dict: "Kaikki German",
  glossary:
    "a/languages A to Lgenitive/dative/accusative singulara/languages A to Lnominative/genitive/dative/accusative plural definite",
});
assert(
  /<b>Inflection<\/b>: <span>genitive\/dative\/accusative singular<\/span>/.test(
    nonLemmaHtml,
  ),
  "Non-lemma grammar should be split into an inflection row",
);
assert(
  /nominative\/genitive\/dative\/accusative plural definite/.test(nonLemmaHtml),
  "Non-lemma plural inflection should be readable",
);
assert(
  !/a\/languages/.test(nonLemmaHtml),
  "Wiktionary path fragments should not leak into non-lemma display",
);

const germanTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: "wty-de-en",
  definitionTags: "non-lemma",
  glossary: JSON.stringify([
    ["keine", ["nominative singular masculine"]],
    ["keine", ["nominative/accusative singular neuter"]],
  ]),
});
assert(
  /class="nonlemma-list"/.test(germanTupleNonLemmaHtml),
  "German Wiktionary tuple non-lemmas should use the targeted tuple renderer",
);
assert(
  /<span class="nonlemma-lemma">keine<\/span>/.test(germanTupleNonLemmaHtml),
  "German Wiktionary tuple non-lemmas should show the lemma reference",
);
assert(
  /nominative singular masculine/.test(germanTupleNonLemmaHtml),
  "German Wiktionary tuple grammar should be readable",
);
assert(
  !/keinenominative/.test(germanTupleNonLemmaHtml),
  "German Wiktionary tuple non-lemmas should not be concatenated",
);

const frenchGermanTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: "wty-fr-de",
  definitionTags: "non-lemma",
  glossary: JSON.stringify([
    [
      "attendre",
      [
        "2. Person Plural Imperativ Prasens Aktiv",
        "2. Person Plural Indikativ Prasens Aktiv",
      ],
    ],
  ]),
});
assert(
  /class="nonlemma-list"/.test(frenchGermanTupleNonLemmaHtml),
  "French-German Wiktionary tuple non-lemmas should use the targeted tuple renderer",
);
assert(
  /<span class="nonlemma-lemma">attendre<\/span>/.test(
    frenchGermanTupleNonLemmaHtml,
  ),
  "French-German Wiktionary tuple non-lemmas should show the lemma reference",
);
assert(
  /2\. Person Plural Imperativ Prasens Aktiv/.test(
    frenchGermanTupleNonLemmaHtml,
  ),
  "French-German Wiktionary tuple grammar should be readable",
);
assert(
  !/attendre2\. Person/.test(frenchGermanTupleNonLemmaHtml),
  "French-German Wiktionary tuple non-lemmas should not be concatenated",
);

const frenchEnglishTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: "wty-fr-en",
  definitionTags: "non-lemma",
  glossary: JSON.stringify([
    ["attendre", ["second-person plural imperative"]],
    ["attendre", ["second-person plural present indicative"]],
  ]),
});
assert(
  /class="nonlemma-list"/.test(frenchEnglishTupleNonLemmaHtml),
  "French-English Wiktionary tuple non-lemmas should use the tuple renderer",
);
assert(
  /<span class="nonlemma-lemma">attendre<\/span>/.test(
    frenchEnglishTupleNonLemmaHtml,
  ),
  "French-English Wiktionary tuple non-lemmas should show the lemma reference",
);
assert(
  /second-person plural present indicative/.test(
    frenchEnglishTupleNonLemmaHtml,
  ),
  "French-English Wiktionary tuple grammar should be readable",
);
assert(
  !/attendresecond-person/.test(frenchEnglishTupleNonLemmaHtml),
  "French-English Wiktionary tuple non-lemmas should not be concatenated",
);

const englishEnglishTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: "wty-en-en",
  definitionTags: "non-lemma",
  glossary: JSON.stringify([["poison", ["past participle"]]]),
});
assert(
  /class="nonlemma-list"/.test(englishEnglishTupleNonLemmaHtml),
  "English Wiktionary tuple non-lemmas should use the same tuple renderer",
);

const customTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: "Custom Dictionary",
  definitionTags: "non-lemma",
  glossary: JSON.stringify([["poison", ["past participle"]]]),
});
assert(
  !/class="nonlemma-list"/.test(customTupleNonLemmaHtml),
  "Tuple non-lemma cleanup should stay scoped to Wiktionary-like dictionaries",
);

const wiktionaryExamples = JSON.stringify([
  {
    type: "structured-content",
    content: [
      {
        tag: "ol",
        data: { content: "glosses" },
        content: [
          {
            tag: "li",
            content: [
              {
                tag: "div",
                content: [
                  "The third-person singular neuter personal pronoun.",
                  {
                    tag: "details",
                    data: { content: "details-entry-examples" },
                    content: [
                      { tag: "summary", content: "2 examples" },
                      {
                        tag: "div",
                        data: { content: "extra-info" },
                        content: {
                          tag: "div",
                          data: { content: "example-sentence" },
                          content: [
                            {
                              tag: "div",
                              data: { content: "example-sentence-a" },
                              content: [
                                "Take ",
                                {
                                  tag: "span",
                                  data: { content: "bold-text" },
                                  content: "it",
                                },
                                " home.",
                              ],
                            },
                          ],
                        },
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
]);
const examplesHtml = overlay.renderGlossaryPayload({
  dict: "wty-en-en",
  glossary: wiktionaryExamples,
});
assert(
  /class="glossary-list glosses-list"/.test(examplesHtml),
  "Structured Wiktionary definitions should stay ordered",
);
assert(
  /The third-person singular neuter personal pronoun/.test(examplesHtml),
  "Structured Wiktionary definition text should remain visible",
);
assert(
  /<details class="dict-details example-section">/.test(examplesHtml),
  "Wiktionary examples should render as collapsed sections",
);
assert(
  !/<details class="dict-details example-section" open>/.test(examplesHtml),
  "Example sections should default collapsed",
);
assert(
  /<b>it<\/b>/.test(examplesHtml),
  "Inline Wiktionary bold text should be preserved inside examples",
);

const wrappedJapaneseHtml = overlay.renderGlossaryPayload({
  dict: "明鏡国語辞典 第三版",
  glossary: JSON.stringify([
    {
      type: "structured-content",
      content: [
        {
          tag: "span",
          content: [
            {
              tag: "div",
              content: [
                {
                  tag: "span",
                  data: { "entry-index": "" },
                  content: [
                    {
                      tag: "span",
                      data: { a: "", href: "100" },
                      content: "待ちに待った",
                    },
                    {
                      tag: "span",
                      data: { a: "", href: "101" },
                      content: "待つうちが花",
                    },
                  ],
                },
                {
                  tag: "div",
                  data: { meaning: "", class: "level1" },
                  content: [
                    { tag: "span", data: { num: "" }, content: "①" },
                    "人が来ること。",
                  ],
                },
                {
                  tag: "details",
                  content: [
                    { tag: "summary", content: "例文２件" },
                    {
                      tag: "div",
                      data: { example: "" },
                      content: "「駅で友人を待つ」",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]),
});
assert(
  /class="entry-index"/.test(wrappedJapaneseHtml),
  "Monolingual entry-index related terms should be grouped",
);
assert(
  /entry-index-item/.test(wrappedJapaneseHtml),
  "Monolingual entry-index items should not run together as raw text",
);
assert(
  /<details class="dict-details example-section">/.test(wrappedJapaneseHtml),
  "Japanese example details should use example-section styling",
);

const jitendexForms = JSON.stringify([
  {
    type: "structured-content",
    content: [
      {
        tag: "ul",
        data: { content: "sense-groups" },
        content: [
          {
            tag: "li",
            data: { content: "sense-group" },
            content: [
              {
                tag: "span",
                data: { class: "tag", content: "part-of-speech-info" },
                content: "5-dan",
              },
              {
                tag: "span",
                title: "male term or language",
                data: { class: "tag", code: "male", content: "misc-info" },
                content: "masculine",
              },
              {
                tag: "ol",
                content: [
                  {
                    tag: "li",
                    data: { content: "sense" },
                    style: { listStyleType: '"①"' },
                    content: [
                      {
                        tag: "ul",
                        data: { content: "glossary" },
                        content: [{ tag: "li", content: "to wait" }],
                      },
                      {
                        tag: "div",
                        data: { content: "extra-info" },
                        content: [
                          {
                            tag: "div",
                            data: { class: "extra-box", content: "sense-note" },
                            content: [
                              {
                                tag: "div",
                                data: {
                                  class: "extra-label",
                                  content: "sense-note-label",
                                },
                                content: "Note",
                              },
                              {
                                tag: "div",
                                data: {
                                  class: "extra-content",
                                  content: "sense-note-content",
                                },
                                content: "rough or arrogant",
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
            tag: "li",
            data: { content: "forms" },
            content: [
              {
                tag: "span",
                title: "spelling and reading variants",
                data: { class: "tag", content: "forms-label" },
                content: "forms",
              },
              {
                tag: "table",
                content: [
                  {
                    tag: "tr",
                    data: { content: "forms-header-row" },
                    content: [
                      { tag: "th" },
                      { tag: "th", content: "待つ" },
                      { tag: "th", content: "俟つ" },
                      { tag: "th", content: "待つ旧" },
                      { tag: "th", content: "有効" },
                      { tag: "th", content: "不可" },
                    ],
                  },
                  {
                    tag: "tr",
                    content: [
                      { tag: "th", content: "まつ" },
                      {
                        tag: "td",
                        data: { class: "form-pri" },
                        content: { tag: "span", title: "high priority form" },
                      },
                      {
                        tag: "td",
                        data: { class: "form-rare" },
                        content: { tag: "span", title: "rarely used form" },
                      },
                      {
                        tag: "td",
                        data: { class: "form-out" },
                        content: {
                          tag: "span",
                          title: "archaic or obsolete reading",
                        },
                      },
                      {
                        tag: "td",
                        data: { class: "form-valid" },
                        content: {
                          tag: "span",
                          title: "valid form/reading combination",
                        },
                      },
                      {
                        tag: "td",
                        data: { class: "form-invalid" },
                        content: {
                          tag: "span",
                          title: "invalid form/reading combination",
                        },
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
                href: "https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&q=123",
                content: "JMdict",
              },
              " | ",
              {
                tag: "a",
                href: "https://tatoeba.org/en/sentences/show/456",
                content: "Tatoeba",
              },
            ],
          },
        ],
      },
    ],
  },
]);
const formsHtml = overlay.renderGlossaryPayload({
  dict: "Jitendex.org [2026-06-06]",
  glossary: jitendexForms,
});
assert(
  /class="forms-table"/.test(formsHtml),
  "Jitendex forms should render as a table",
);
assert(
  /class="form-marker form-pri"/.test(formsHtml) &&
    /high priority form/.test(formsHtml),
  "Priority form markers should preserve meaning",
);
assert(
  /class="form-marker form-rare"/.test(formsHtml) &&
    /rarely used form/.test(formsHtml),
  "Rare form markers should preserve meaning",
);
assert(
  /class="form-marker form-out"/.test(formsHtml) &&
    /archaic or obsolete reading/.test(formsHtml),
  "Obsolete form markers should preserve meaning",
);
assert(
  /class="form-marker form-valid"/.test(formsHtml) &&
    /valid form\/reading combination/.test(formsHtml),
  "Valid form markers should preserve meaning",
);
assert(
  /class="form-marker form-invalid"/.test(formsHtml) &&
    /invalid form\/reading combination/.test(formsHtml),
  "Invalid form markers should preserve meaning",
);
assert(
  /class="note-card"/.test(formsHtml) && /rough or arrogant/.test(formsHtml),
  "Jitendex sense notes should render as note cards",
);
assert(
  /class="pos-pill misc-pill misc-male"/.test(formsHtml),
  "Jitendex misc tags should render as compact pills",
);
assert(
  /class="attribution-row"/.test(formsHtml),
  "Jitendex attribution links should render at the bottom",
);
assert(
  /data-external-url="https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&amp;q=123"/.test(
    formsHtml,
  ),
  "JMdict attribution links should be clickable",
);
assert(
  /data-external-url="https:\/\/tatoeba\.org\/en\/sentences\/show\/456"/.test(
    formsHtml,
  ),
  "Tatoeba attribution links should be clickable",
);
assert(
  /class="custom-marker"><span class="sense-number">①<\/span>/.test(formsHtml),
  "Jitendex custom sense markers should be preserved",
);
assert(
  !/forms待つ俟つまつ/.test(formsHtml),
  "Jitendex forms should not collapse into raw plaintext",
);

const jitendexPriorityHtml = overlay.renderGlossaryPayload({
  dict: "Jitendex.org [2026-06-06]",
  glossary: "to wait",
  definitionTags: "★ priority\u00a0form",
});
assert(
  /class="tag-chip tag-priority"/.test(jitendexPriorityHtml),
  "Jitendex priority tags with a leading star should render as star-only chips",
);
assert(
  !/>★ priority/.test(jitendexPriorityHtml),
  "Jitendex priority tag text should not remain visible",
);

const metadataHtml = overlay.renderEntryMetadata({
  expression: "待つ",
  reading: "まつ",
  frequencies: [
    {
      dict: "BCCWJ",
      frequencies: [{ value: 199266, displayValue: "199,266" }],
    },
    {
      dict: "JPDBv2",
      frequencies: [
        { value: 184, displayValue: "184" },
        { value: 13390, displayValue: "13390" },
      ],
    },
  ],
  pitches: [
    { dict: "アクセント辞典", positions: [1], transcriptions: [] },
    { dict: "NHK IPA", positions: [], transcriptions: ["toꜜkyo"] },
  ],
});
assert(
  /class="freq-chip"/.test(metadataHtml),
  "Frequency metadata should render as compact chips",
);
assert(
  /BCCWJ/.test(metadataHtml) && /199,266/.test(metadataHtml),
  "Frequency chip should include dictionary and value",
);
assert(
  /JPDBv2/.test(metadataHtml) && /184, 13390/.test(metadataHtml),
  "Multiple frequency values should stay compact",
);
assert(
  /class="pitch-group"/.test(metadataHtml),
  "Pitch metadata should render as a bound source/pattern group",
);
assert(
  /class="pitch-source-chip">アクセント辞典<\/span><span class="pitch-patterns">/.test(
    metadataHtml,
  ),
  "Pitch source should be boxed separately from the pitch pattern",
);
assert(
  /class="pitch-pattern"/.test(metadataHtml),
  "Pitch metadata should include a visual pitch pattern",
);
assert(
  /pitch-mora pitch-high pitch-drop/.test(metadataHtml),
  "Accent position should create a drop marker over the kana",
);
assert(
  /アクセント辞典/.test(metadataHtml) &&
    /ま/.test(metadataHtml) &&
    /つ/.test(metadataHtml) &&
    /\[1\]/.test(metadataHtml),
  "Pitch chip should include source, kana, and accent number",
);

const unsafeHtml = overlay.renderStructuredNode(
  {
    tag: "a",
    href: "javascript:alert(1)",
    content: "bad",
  },
  { sourceKind: "wiktionary" },
);
assert(!/<a\b/.test(unsafeHtml), "Unsafe links should not render as anchors");
assert(
  unsafeHtml === '<span class="xref-link">bad</span>',
  "Unsafe link text should remain visible",
);
assert(
  overlay.safeExternalUrl("ftp://example.test/file") === "",
  "Unsafe URL schemes should be rejected",
);

const css = fs.readFileSync(path.join(root, "src/overlay/overlay.css"), "utf8");
assert(
  /:root\.theme-light/.test(css),
  "Popup CSS should define a concrete light theme",
);
assert(
  !/theme-inherit/.test(css),
  "Popup CSS should not define a separate inherit theme",
);
assert(
  /#popup \.head \{[^}]*padding: 14px 18px 12px;[^}]*\}/.test(css),
  "Popup header should keep its spacing",
);
assert(
  !/#popup \.head \{[^}]*border-bottom:/s.test(css),
  "Popup header should not draw a horizontal rule below the headword",
);
assert(
  /\.headword-stack \{[^}]*display: inline-block;[^}]*max-width: 100%;[^}]*\}/.test(
    css,
  ),
  "Popup readings and ruby headwords should share one inline stack",
);
assert(
  /#popup \.term rt \{[^}]*color: var\(--popup-reading\);[^}]*font-size: 0\.53em;[^}]*\}/.test(
    css,
  ),
  "Primary Japanese furigana should use compact reading styling",
);
assert(
  /#popup \.reading \{[^}]*display: block;[^}]*margin: 0 0 2px;[^}]*text-align: center;[^}]*\}/.test(
    css,
  ),
  "Popup readings should no longer render inline beside the headword",
);
assert(
  /\.entry \+ \.entry \{[^}]*border-top:/s.test(css),
  "Entry separators should remain between dictionary entries",
);
assert(
  /\.dict-details \{[^}]*margin: 8px 0;[^}]*\}/.test(css),
  "Collapsed details base style should remain present",
);
assert(
  /\.dict-details \{[^}]*padding-left: 8px;[^}]*\}/.test(css),
  "Collapsed details should keep a marker gap from the popup edge",
);
assert(
  !/\.dict-details \{[^}]*border-left:/s.test(css),
  "Collapsed details should not have a base left border",
);
assert(
  /\.dict-details\[open\] \{[^}]*border-left:/s.test(css),
  "Expanded details should keep the left border",
);
assert(
  /\.dict-details summary \{[^}]*list-style-position: inside;[^}]*\}/.test(css),
  "Collapsed details marker should be inset",
);
assert(
  /\.dict-term \{[^}]*font-size: 30px;[^}]*\}/.test(css),
  "Secondary entry headwords should match the main popup headword size",
);
assert(
  /\.dict-term \{[^}]*position: relative;[^}]*padding-right: 38px;[^}]*\}/.test(
    css,
  ),
  "Secondary entry headword rows should reserve space for the speaker button",
);
assert(
  /\.dict-term \.audio-button \{[^}]*position: absolute;[^}]*top: 1px;[^}]*right: 0;[^}]*\}/.test(
    css,
  ),
  "Secondary entry speaker buttons should be pinned to the row top-right",
);
assert(
  /\.dict-reading \{[^}]*display: block;[^}]*margin: 0 0 2px;[^}]*text-align: center;[^}]*\}/.test(
    css,
  ),
  "Secondary entry readings should render centered above their headwords",
);
assert(
  /\.dict-headword rt \{[^}]*color: var\(--popup-reading\);[^}]*font-size: 0\.53em;[^}]*\}/.test(
    css,
  ),
  "Secondary Japanese furigana should use compact reading styling",
);
assert(
  /\.pitch-group \{[^}]*flex: 0 0 100%;[^}]*width: 100%;[^}]*\}/.test(css),
  "Pitch accent group should start on a new metadata row",
);
assert(
  !/\.pitch-group \{[^}]*flex-direction: column;/s.test(css),
  "Pitch source chip and accent pattern should stay side by side",
);
assert(
  /\.pitch-patterns \{[^}]*font-size: 15px;[^}]*\}/.test(css),
  "Pitch accent pattern should be larger than the source chip",
);
assert(
  /\.pitch-number, \.pitch-more, \.pitch-text \{[^}]*font-size: 13px;[^}]*\}/.test(
    css,
  ),
  "Pitch accent number/text should scale with the accent display",
);
assert(
  /\.pitch-source-chip \{[^}]*padding: 2px 7px;[^}]*\}/.test(css),
  "Pitch source chip sizing should remain compact",
);

console.log("overlay dictionary formatting tests passed");
