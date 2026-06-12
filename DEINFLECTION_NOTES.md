# Deinflection Notes

## Yomitan Baseline

Inspected Yomitan `ext/js/language/language-transformer.js`, `language-transforms.js`, and the French/German language descriptors before touching Rougo. The plugin now follows the same core shape in `src/languages/deinflection.js`: language modules define ordered transform rules, generate multiple candidates, preserve deinflection trace/reason metadata, and pass all plausible candidates to the lookup layer instead of committing to one sanitized form too early.

English now imports the upstream Yomitan English transform families from `ext/js/language/en/english-transforms.js` into `src/languages/english_yomitan_rules.js`: plural/possessive nouns, regular and selected irregular past tense (`said` -> `say`, `paid` -> `pay`, `laid` -> `lay`), present participles, third-person singular present, adverbs, comparatives/superlatives, `-y`, `un-`, and `-able`. The local English module keeps iinatan's whole-word subtitle selection and emits the deinflected forms as lookup candidates after the exact surface form.

French now imports the upstream Yomitan French suffix transform table from `ext/js/language/fr/french-transforms.js` at commit `462253fd3fd2f2a733ef327bc5bceedf7b797d24` into `src/languages/french_yomitan_rules.js`. That generated file is derived from GPL-3.0-or-later Yomitan source and carries an attribution header. The local French module still owns iinatan-specific candidate ordering, apostrophe handling, candidate caps, and a few practical patches that upstream marks as TODO territory, such as feminine/plural past participles.

German now mirrors the upstream Yomitan German transform families from `ext/js/language/de/german-transforms.js` at the same commit: nominalization (`-ung`, `-lung`, `-rung`), `-bar`, negative `un-`, regular/separable participles, `zu` infinitives, and `-heit/-keit`. iinatan keeps its app-specific bounded right-context scan for separated verbs instead of copying Yomitan's full string-with-spaces transform model.

## Rougo Patch Layer

Inspected local `../rougo` history after the Yomitan pass. Relevant commits:

- `d07cf0b636577d1fff534cf71ec725a3ed63dbcf` added Rougo's multi-language deinflection registry and language-specific deinflectors.
- `47cde238946de60f68178371d31b68b27abafdbe` fixed French apostrophe prefixes and German split verbs with abbreviation-aware period scanning.
- `84cbecfe1f88b9a4365270dc69f67c7b7ff87ee9` added French past-participle fixes such as `motivé` -> `motiver`.

Adapted patches:

- French tries both full apostrophe forms and stripped tails only for known prefixes: `c`, `d`, `j`, `l`, `m`, `n`, `qu`, `s`, `t`.
- French normalizes common apostrophe variants but keeps the original full candidate in the ordered list.
- German scans only a bounded right context for separable prefixes, capped by characters and word count.
- German treats common abbreviations such as `z.B.`, `z.T.`, `bzw.`, `ca.`, `Dr.`, and `usw.` as non-terminal periods during that bounded scan.
- German finite verb handling includes a small irregular map plus conservative suffix heuristics for split-verb candidates such as `stehe ... auf` -> `aufstehen`.

Not copied:

- Rougo's Android/Kotlin UI, popup lifecycle, dictionary store integration, and broad app-specific lookup plumbing.
- Rougo's whole implementation as the base architecture. Rougo is used here only as an edge-case patch source on top of the Yomitan-style candidate/deinflection layer.
