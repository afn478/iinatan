const fs = require('fs');
const path = require('path');
const { assert, loadOverlayForTest, root } = require('./helpers/overlay_test_context');

const { context, overlay } = loadOverlayForTest([
  'state',
  'applyConfig',
  'renderGlossaryPayload',
  'renderStructuredNode',
  'renderPlainGlossaryText',
  'renderEntryMetadata',
  'displayHeaderForResult',
  'safeExternalUrl'
]);

overlay.applyConfig({
  debugLogVerbose: false,
  etymologyCollapseDefault: 'collapsed',
  wiktionaryEtymologyCollapseOverride: 'collapsed',
  customPopupCss: '#popup .gloss { font-size: 16px; }'
});
assert(context.__head.children.length === 1, 'Custom CSS should create a style element');
assert(/font-size: 16px/.test(context.__head.children[0].textContent), 'Custom CSS should be applied');

const header = overlay.displayHeaderForResult({
  text: 'I was juster',
  lookupStart: 6,
  lookupEnd: 12,
  lookupText: 'just',
  candidateUsed: { text: 'just', displayText: 'juster' }
}, {
  matched: 'just',
  deinflected: 'just',
  term: { expression: 'just', reading: '', glossaries: [] }
});
assert(header.heading === 'just', 'Dictionary headword should be the primary heading');
assert(header.secondary === 'looked up from: juster', 'Surface form should be secondary metadata');

const zhHeader = overlay.displayHeaderForResult({
  language: 'zh',
  text: '日本語の',
  lookupStart: 0,
  lookupEnd: 4,
  lookupText: '日本語の',
  candidateUsed: { text: '日本語の', displayText: '日' }
}, {
  matched: '日本語',
  deinflected: '日本語',
  term: { expression: '日本語', reading: '', glossaries: [] }
});
assert(zhHeader.heading === '日本語', 'Chinese prefix result should keep dictionary headword primary');
assert(zhHeader.secondary === '', 'Chinese prefix result should not show one-character looked-up metadata when matched term equals heading');

const structuredGlossary = JSON.stringify([{
  type: 'structured-content',
  content: [
    {
      tag: 'details',
      data: { content: 'details-entry-Grammar' },
      content: [{ tag: 'summary', content: 'Grammar' }, 'comparative form; adjective']
    },
    {
      tag: 'details',
      data: { content: 'details-entry-Etymology' },
      content: [
        { tag: 'summary', content: 'Etymology' },
        'From Middle English ',
        { tag: 'a', href: 'https://en.wiktionary.org/wiki/just', content: 'just' }
      ]
    },
    { tag: 'ul', data: { content: 'glosses' }, content: [{ tag: 'li', content: 'fair; morally right' }] },
    { tag: 'div', data: { content: 'backlink' }, content: [{ tag: 'a', href: 'https://kaikki.org/dictionary/English/meaning/j/ju/just.html', content: 'Kaikki' }] }
  ]
}]);

const structuredHtml = overlay.renderGlossaryPayload({
  dict: 'Kaikki English',
  glossary: structuredGlossary,
  definitionTags: 'priority form',
  termTags: 'adjective'
});
assert(/<b>Grammar<\/b>:/.test(structuredHtml), 'Grammar details should render as a labeled row');
assert(/comparative form; adjective/.test(structuredHtml), 'Grammar content should be preserved');
assert(/<details class="dict-details etymology-section">/.test(structuredHtml), 'Etymology should be a collapsed details section by default');
assert(!/<details class="dict-details etymology-section" open>/.test(structuredHtml), 'Wiktionary/Kaikki etymology should default collapsed');
assert(/href="https:\/\/en\.wiktionary\.org\/wiki\/just"/.test(structuredHtml), 'Wiktionary links should remain clickable');
assert(/data-external-url="https:\/\/kaikki\.org\/dictionary\/English\/meaning\/j\/ju\/just\.html"/.test(structuredHtml), 'Kaikki source links should be clickable');
assert(/class="tag-chip tag-priority"/.test(structuredHtml), 'Priority tag should render as a star chip');
assert(!/>priority form</.test(structuredHtml), 'Priority tag text should not be visible');
assert(/class="tag-chip tag-term">adjective</.test(structuredHtml), 'Term tags should render compact chips');
assert(!/nonlemma-row/.test(structuredHtml), 'Structured Wiktionary entries should not be flattened into non-lemma rows');

overlay.applyConfig({
  etymologyCollapseDefault: 'expanded',
  wiktionaryEtymologyCollapseOverride: 'inherit'
});
const expandedHtml = overlay.renderGlossaryPayload({ dict: 'Kaikki English', glossary: structuredGlossary });
assert(/<details class="dict-details etymology-section" open>/.test(expandedHtml), 'Global expanded etymology setting should apply when Wiktionary override inherits');

const plainHtml = overlay.renderGlossaryPayload({
  dict: 'Kaikki English',
  glossary: 'Grammar{"degree":"comparative"}EtymologyEtymology tree: from https://en.wiktionary.org/wiki/just'
});
assert(/<b>Grammar<\/b>: <span>\{&quot;degree&quot;:&quot;comparative&quot;\}<\/span>/.test(plainHtml), 'Flattened Grammar text should be separated');
assert(/<summary>Etymology<\/summary>/.test(plainHtml), 'Flattened Etymology text should be separated');
assert(/data-external-url="https:\/\/en\.wiktionary\.org\/wiki\/just"/.test(plainHtml), 'Plain source URLs should be linkified');

const nonLemmaHtml = overlay.renderGlossaryPayload({
  dict: 'Kaikki German',
  glossary: 'a/languages A to Lgenitive/dative/accusative singulara/languages A to Lnominative/genitive/dative/accusative plural definite'
});
assert(/<b>Inflection<\/b>: <span>genitive\/dative\/accusative singular<\/span>/.test(nonLemmaHtml), 'Non-lemma grammar should be split into an inflection row');
assert(/nominative\/genitive\/dative\/accusative plural definite/.test(nonLemmaHtml), 'Non-lemma plural inflection should be readable');
assert(!/a\/languages/.test(nonLemmaHtml), 'Wiktionary path fragments should not leak into non-lemma display');

const germanTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: 'wty-de-en',
  definitionTags: 'non-lemma',
  glossary: JSON.stringify([['keine', ['nominative singular masculine']], ['keine', ['nominative/accusative singular neuter']]])
});
assert(/class="nonlemma-list"/.test(germanTupleNonLemmaHtml), 'German Wiktionary tuple non-lemmas should use the targeted tuple renderer');
assert(/<span class="nonlemma-lemma">keine<\/span>/.test(germanTupleNonLemmaHtml), 'German Wiktionary tuple non-lemmas should show the lemma reference');
assert(/nominative singular masculine/.test(germanTupleNonLemmaHtml), 'German Wiktionary tuple grammar should be readable');
assert(!/keinenominative/.test(germanTupleNonLemmaHtml), 'German Wiktionary tuple non-lemmas should not be concatenated');

const englishTupleNonLemmaHtml = overlay.renderGlossaryPayload({
  dict: 'wty-en-en',
  definitionTags: 'non-lemma',
  glossary: JSON.stringify([['poison', ['past participle']]])
});
assert(!/class="nonlemma-list"/.test(englishTupleNonLemmaHtml), 'Tuple non-lemma cleanup should stay scoped to German Wiktionary dictionaries');

const wiktionaryExamples = JSON.stringify([{
  type: 'structured-content',
  content: [{
    tag: 'ol',
    data: { content: 'glosses' },
    content: [{
      tag: 'li',
      content: [{
        tag: 'div',
        content: [
          'The third-person singular neuter personal pronoun.',
          {
            tag: 'details',
            data: { content: 'details-entry-examples' },
            content: [
              { tag: 'summary', content: '2 examples' },
              {
                tag: 'div',
                data: { content: 'extra-info' },
                content: {
                  tag: 'div',
                  data: { content: 'example-sentence' },
                  content: [{
                    tag: 'div',
                    data: { content: 'example-sentence-a' },
                    content: ['Take ', { tag: 'span', data: { content: 'bold-text' }, content: 'it' }, ' home.']
                  }]
                }
              }
            ]
          }
        ]
      }]
    }]
  }]
}]);
const examplesHtml = overlay.renderGlossaryPayload({ dict: 'wty-en-en', glossary: wiktionaryExamples });
assert(/class="glossary-list glosses-list"/.test(examplesHtml), 'Structured Wiktionary definitions should stay ordered');
assert(/The third-person singular neuter personal pronoun/.test(examplesHtml), 'Structured Wiktionary definition text should remain visible');
assert(/<details class="dict-details example-section">/.test(examplesHtml), 'Wiktionary examples should render as collapsed sections');
assert(!/<details class="dict-details example-section" open>/.test(examplesHtml), 'Example sections should default collapsed');
assert(/<b>it<\/b>/.test(examplesHtml), 'Inline Wiktionary bold text should be preserved inside examples');

const wrappedJapaneseHtml = overlay.renderGlossaryPayload({
  dict: '明鏡国語辞典 第三版',
  glossary: JSON.stringify([{
    type: 'structured-content',
    content: [{
      tag: 'span',
      content: [{
        tag: 'div',
        content: [
          { tag: 'span', data: { 'entry-index': '' }, content: [{ tag: 'span', data: { a: '', href: '100' }, content: '待ちに待った' }, { tag: 'span', data: { a: '', href: '101' }, content: '待つうちが花' }] },
          { tag: 'div', data: { meaning: '', class: 'level1' }, content: [{ tag: 'span', data: { num: '' }, content: '①' }, '人が来ること。'] },
          { tag: 'details', content: [{ tag: 'summary', content: '例文２件' }, { tag: 'div', data: { example: '' }, content: '「駅で友人を待つ」' }] }
        ]
      }]
    }]
  }])
});
assert(/class="entry-index"/.test(wrappedJapaneseHtml), 'Monolingual entry-index related terms should be grouped');
assert(/entry-index-item/.test(wrappedJapaneseHtml), 'Monolingual entry-index items should not run together as raw text');
assert(/<details class="dict-details example-section">/.test(wrappedJapaneseHtml), 'Japanese example details should use example-section styling');

const jitendexForms = JSON.stringify([{
  type: 'structured-content',
  content: [{
    tag: 'ul',
    data: { content: 'sense-groups' },
    content: [
      {
        tag: 'li',
        data: { content: 'sense-group' },
        content: [
          { tag: 'span', data: { class: 'tag', content: 'part-of-speech-info' }, content: '5-dan' },
          { tag: 'span', title: 'male term or language', data: { class: 'tag', code: 'male', content: 'misc-info' }, content: 'masculine' },
          {
            tag: 'ol',
            content: [{
              tag: 'li',
              data: { content: 'sense' },
              style: { listStyleType: '"①"' },
              content: [
                { tag: 'ul', data: { content: 'glossary' }, content: [{ tag: 'li', content: 'to wait' }] },
                {
                  tag: 'div',
                  data: { content: 'extra-info' },
                  content: [{
                    tag: 'div',
                    data: { class: 'extra-box', content: 'sense-note' },
                    content: [
                      { tag: 'div', data: { class: 'extra-label', content: 'sense-note-label' }, content: 'Note' },
                      { tag: 'div', data: { class: 'extra-content', content: 'sense-note-content' }, content: 'rough or arrogant' }
                    ]
                  }]
                }
              ]
            }]
          }
        ]
      },
      {
        tag: 'li',
        data: { content: 'forms' },
        content: [
          { tag: 'span', title: 'spelling and reading variants', data: { class: 'tag', content: 'forms-label' }, content: 'forms' },
          {
            tag: 'table',
            content: [
              { tag: 'tr', data: { content: 'forms-header-row' }, content: [{ tag: 'th' }, { tag: 'th', content: '待つ' }, { tag: 'th', content: '俟つ' }, { tag: 'th', content: '待つ旧' }, { tag: 'th', content: '有効' }, { tag: 'th', content: '不可' }] },
              {
                tag: 'tr',
                content: [
                  { tag: 'th', content: 'まつ' },
                  { tag: 'td', data: { class: 'form-pri' }, content: { tag: 'span', title: 'high priority form' } },
                  { tag: 'td', data: { class: 'form-rare' }, content: { tag: 'span', title: 'rarely used form' } },
                  { tag: 'td', data: { class: 'form-out' }, content: { tag: 'span', title: 'archaic or obsolete reading' } },
                  { tag: 'td', data: { class: 'form-valid' }, content: { tag: 'span', title: 'valid form/reading combination' } },
                  { tag: 'td', data: { class: 'form-invalid' }, content: { tag: 'span', title: 'invalid form/reading combination' } }
                ]
              }
            ]
          }
        ]
      },
      {
        tag: 'div',
        data: { content: 'attribution' },
        content: [
          { tag: 'a', href: 'https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&q=123', content: 'JMdict' },
          ' | ',
          { tag: 'a', href: 'https://tatoeba.org/en/sentences/show/456', content: 'Tatoeba' }
        ]
      }
    ]
  }]
}]);
const formsHtml = overlay.renderGlossaryPayload({ dict: 'Jitendex.org [2026-06-06]', glossary: jitendexForms });
assert(/class="forms-table"/.test(formsHtml), 'Jitendex forms should render as a table');
assert(/class="form-marker form-pri"/.test(formsHtml) && /high priority form/.test(formsHtml), 'Priority form markers should preserve meaning');
assert(/class="form-marker form-rare"/.test(formsHtml) && /rarely used form/.test(formsHtml), 'Rare form markers should preserve meaning');
assert(/class="form-marker form-out"/.test(formsHtml) && /archaic or obsolete reading/.test(formsHtml), 'Obsolete form markers should preserve meaning');
assert(/class="form-marker form-valid"/.test(formsHtml) && /valid form\/reading combination/.test(formsHtml), 'Valid form markers should preserve meaning');
assert(/class="form-marker form-invalid"/.test(formsHtml) && /invalid form\/reading combination/.test(formsHtml), 'Invalid form markers should preserve meaning');
assert(/class="note-card"/.test(formsHtml) && /rough or arrogant/.test(formsHtml), 'Jitendex sense notes should render as note cards');
assert(/class="pos-pill misc-pill misc-male"/.test(formsHtml), 'Jitendex misc tags should render as compact pills');
assert(/class="attribution-row"/.test(formsHtml), 'Jitendex attribution links should render at the bottom');
assert(/data-external-url="https:\/\/www\.edrdg\.org\/jmwsgi\/entr\.py\?svc=jmdict&amp;q=123"/.test(formsHtml), 'JMdict attribution links should be clickable');
assert(/data-external-url="https:\/\/tatoeba\.org\/en\/sentences\/show\/456"/.test(formsHtml), 'Tatoeba attribution links should be clickable');
assert(/class="custom-marker"><span class="sense-number">①<\/span>/.test(formsHtml), 'Jitendex custom sense markers should be preserved');
assert(!/forms待つ俟つまつ/.test(formsHtml), 'Jitendex forms should not collapse into raw plaintext');

const jitendexPriorityHtml = overlay.renderGlossaryPayload({
  dict: 'Jitendex.org [2026-06-06]',
  glossary: 'to wait',
  definitionTags: '★ priority\u00a0form'
});
assert(/class="tag-chip tag-priority"/.test(jitendexPriorityHtml), 'Jitendex priority tags with a leading star should render as star-only chips');
assert(!/>★ priority/.test(jitendexPriorityHtml), 'Jitendex priority tag text should not remain visible');

const metadataHtml = overlay.renderEntryMetadata({
  expression: '待つ',
  reading: 'まつ',
  frequencies: [
    { dict: 'BCCWJ', frequencies: [{ value: 199266, displayValue: '199,266' }] },
    { dict: 'JPDBv2', frequencies: [{ value: 184, displayValue: '184' }, { value: 13390, displayValue: '13390' }] }
  ],
  pitches: [
    { dict: 'アクセント辞典', positions: [1], transcriptions: [] },
    { dict: 'NHK IPA', positions: [], transcriptions: ['toꜜkyo'] }
  ]
});
assert(/class="freq-chip"/.test(metadataHtml), 'Frequency metadata should render as compact chips');
assert(/BCCWJ/.test(metadataHtml) && /199,266/.test(metadataHtml), 'Frequency chip should include dictionary and value');
assert(/JPDBv2/.test(metadataHtml) && /184, 13390/.test(metadataHtml), 'Multiple frequency values should stay compact');
assert(/class="pitch-group"/.test(metadataHtml), 'Pitch metadata should render as a bound source/pattern group');
assert(/class="pitch-source-chip">アクセント辞典<\/span><span class="pitch-patterns">/.test(metadataHtml), 'Pitch source should be boxed separately from the pitch pattern');
assert(/class="pitch-pattern"/.test(metadataHtml), 'Pitch metadata should include a visual pitch pattern');
assert(/pitch-mora pitch-high pitch-drop/.test(metadataHtml), 'Accent position should create a drop marker over the kana');
assert(/アクセント辞典/.test(metadataHtml) && /ま/.test(metadataHtml) && /つ/.test(metadataHtml) && /\[1\]/.test(metadataHtml), 'Pitch chip should include source, kana, and accent number');

const unsafeHtml = overlay.renderStructuredNode({
  tag: 'a',
  href: 'javascript:alert(1)',
  content: 'bad'
}, { sourceKind: 'wiktionary' });
assert(!/<a\b/.test(unsafeHtml), 'Unsafe links should not render as anchors');
assert(unsafeHtml === '<span class="xref-link">bad</span>', 'Unsafe link text should remain visible');
assert(overlay.safeExternalUrl('ftp://example.test/file') === '', 'Unsafe URL schemes should be rejected');

const css = fs.readFileSync(path.join(root, 'src/overlay/overlay.css'), 'utf8');
assert(/\.dict-details \{[^}]*margin: 8px 0;[^}]*\}/.test(css), 'Collapsed details base style should remain present');
assert(/\.dict-details \{[^}]*padding-left: 8px;[^}]*\}/.test(css), 'Collapsed details should keep a marker gap from the popup edge');
assert(!/\.dict-details \{[^}]*border-left:/s.test(css), 'Collapsed details should not have a base left border');
assert(/\.dict-details\[open\] \{[^}]*border-left:/s.test(css), 'Expanded details should keep the left border');
assert(/\.dict-details summary \{[^}]*list-style-position: inside;[^}]*\}/.test(css), 'Collapsed details marker should be inset');
assert(/\.dict-term \{[^}]*font-size: 30px;[^}]*\}/.test(css), 'Secondary entry headwords should match the main popup headword size');
assert(/\.pitch-group \{[^}]*flex: 0 0 100%;[^}]*width: 100%;[^}]*\}/.test(css), 'Pitch accent group should start on a new metadata row');
assert(!/\.pitch-group \{[^}]*flex-direction: column;/s.test(css), 'Pitch source chip and accent pattern should stay side by side');
assert(/\.pitch-patterns \{[^}]*font-size: 15px;[^}]*\}/.test(css), 'Pitch accent pattern should be larger than the source chip');
assert(/\.pitch-number, \.pitch-more, \.pitch-text \{[^}]*font-size: 13px;[^}]*\}/.test(css), 'Pitch accent number/text should scale with the accent display');
assert(/\.pitch-source-chip \{[^}]*padding: 2px 7px;[^}]*\}/.test(css), 'Pitch source chip sizing should remain compact');

console.log('overlay dictionary formatting tests passed');
