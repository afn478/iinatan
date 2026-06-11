# Deinflection Notes

## Yomitan Baseline

Inspected Yomitan `ext/js/language/language-transformer.js`, `language-transforms.js`, and the French/German language descriptors before touching Rougo. The plugin now follows the same core shape in `src/languages/deinflection.js`: language modules define ordered transform rules, generate multiple candidates, preserve deinflection trace/reason metadata, and pass all plausible candidates to the lookup layer instead of committing to one sanitized form too early.

The implementation intentionally ports the architecture, not Yomitan's full rule tables. French and German use compact starter descriptors that cover the subtitle cases this plugin can safely handle today, while leaving room for larger rule tables later.

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
