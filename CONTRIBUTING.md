# Contributing

This guide covers source changes, local validation, package checks, and releases for iinatan.

iinatan is a Yomitan-style popup dictionary for IINA/mpv on macOS. It is implemented as an IINA JavaScript plugin, with HoshiDicts as the native/backend dictionary layer. Current lookup and display work spans Japanese, English, German, French, Korean, and Chinese.

## Repository Shape

Primary source files live under `src/`. Generated plugin entrypoints live at the repository root:

- `main.js`
- `global.js`
- `overlay.html`
- `dictionary-manager.html`
- `preferences.html`

When changing source that feeds generated files, run the build and include the regenerated output with the source change. Do not hand-edit generated files as the primary fix unless the build system itself is being repaired.

HoshiDicts is pinned as a git submodule under `vendor/hoshidicts`. Release packages exclude `vendor/` and include only the compiled runtime at `bin/iina-hoshi-dicts`.

## Before Changing Files

Start by checking the branch and worktree:

```bash
git status --short --branch
```

Keep unrelated local changes intact. Stage only the paths intentionally changed for the task.

Prefer narrow display and formatting changes when working on visual popup issues. Do not alter lookup correctness, parser/deinflection behavior, dictionary import, IPC, backend schema, or language routing unless the task specifically requires it.

Preserve these behaviors unless a task explicitly changes them:

- Japanese, English, German, French, Korean, and Chinese lookup.
- Dictionary import and HoshiDicts backend build.
- Target language selection.
- No-result termination behavior.
- Pause-only popup behavior.
- Direct worker IPC performance.
- Popup hover/click behavior.
- Clickable source links and custom CSS support.
- Installed dictionary settings management.

For Wiktionary/Kaikki formatting, prefer source/dictionary-scoped fixes when structures differ. For example, tuple-style non-lemma cleanup for `wty-en-de` and `wty-de-en` should not silently change unrelated Wiktionary dictionaries.

For Japanese dictionary display, keep each dictionary entry's headword prominent. Later entries should not look like minor metadata when Hoshi Reader/Yomitan-style layouts would show them as full entries.

## Setup

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/afn478/iinatan.git
cd iinatan
```

If the clone already exists or was created without `--recurse-submodules`, initialize the submodule:

```bash
git submodule update --init --recursive
```

Build the native lookup engine:

```bash
scripts/build_native_backend.sh
```

## Build And Validation

Regenerate runtime files after source edits:

```bash
npm run build
```

Format project JavaScript files:

```bash
npm run format:js
```

Run `npm run format:js` after JavaScript edits and before the final build/test pass. The formatter covers project source and test `.js` files while ignoring dependency, vendor, build, dist, binary output, and generated root runtime files.

Run the standard test suite:

```bash
npm test
```

Run the focused overlay dictionary formatting test:

```bash
node tests/overlay_dictionary_formatting.test.js
```

Validate release layout and required backend files:

```bash
npm run validate:release
```

Create an installable package:

```bash
npm run package
```

For overlay/display work, use this pre-commit verification:

```bash
npm run format:js && npm run build && node tests/overlay_dictionary_formatting.test.js && npm test
```

For backend, package, submodule, or layout-sensitive work, also run:

```bash
npm run validate:release
npm run package
```

Documentation-only changes usually do not need the full app test suite. Inspect the diff and report that tests were skipped because the change was documentation-only.

## Local IINA Testing

Link the working tree into IINA:

```bash
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

The equivalent npm script is:

```bash
npm run link
```

Pack with IINA's plugin tooling:

```bash
npm run pack
```

## Package Layout

`scripts/build_plugin.py --package dist/iinatan.iinaplgz` packages only runtime files, not the whole source tree. The package validator requires:

- `Info.json`
- `main.js`
- `global.js`
- `overlay.html`
- `dictionary-manager.html`
- `preferences.html`
- `README.md`
- `LICENSE`
- `package.json`
- `CHANGELOG.md`
- `bin/iina-hoshi-dicts`

Optional documentation files included in release packages:

- `ARCHITECTURE.md`
- `SETTINGS_AUDIT.md`

The build script concatenates `src/languages/*.js`, `src/main/*.js`, `src/overlay/overlay.css`, and `src/overlay/overlay.js` into the root runtime files.

## Diagnostics

Diagnostic logs are available from **Plugins -> iinatan -> Debug**:

- JavaScript diagnostics: `Plugin Data Folder/debug.log`
- Lookup process diagnostics: `Plugin Data Folder/worker/worker.log`

Useful debug actions:

- **Run Language Unit Tests** checks the selected language registry assumptions, including Japanese rightward-prefix lookup, Latin whole-word lookup, French elision candidates, and German split-verb candidates.
- **Run Settings Audit Checks** verifies that key settings are readable and propagated into overlay config.
- **Run Lookup Performance Benchmark** measures worker lookup latency with installed dictionaries.
- **Test File Picker API** opens the same picker used by manual dictionary import and reports success, cancellation, or API failure.
- **Reveal Debug Log File** and **Reveal Plugin Data Folder** open troubleshooting files in Finder.

If lookups fail, first confirm that at least one dictionary is installed and enabled, then reveal `worker.log`. For development builds, run `scripts/build_native_backend.sh` if `bin/iina-hoshi-dicts` is missing.

If dictionary import does nothing or cannot open the picker, run **Debug -> Test File Picker API** and check `debug.log`.

If an experimental language mode cannot confidently identify a compatible dictionary, it will warn but still try the dictionaries explicitly enabled. Import or enable a Yomitan dictionary whose metadata/path identifies that language, such as an English-headword `en-*`, French-headword `fr-*`, German-headword `de-*`, Chinese-headword `zh-*`/CC-CEDICT, or Korean-headword `ko-*` dictionary. Japanese mode continues to use the existing Jitendex/HoshiDicts path.

For Wiktionary/Kaikki-style dictionaries, the popup separates grammar, inflection/non-lemma rows, etymology, source/backlink rows, tags, and core glossary text where the dictionary data exposes those sections. Etymology is collapsed by default, source links open in the default browser, and custom CSS is injected only when the setting is non-empty.

## Release Workflow

Release builds produce `dist/iinatan.iinaplgz`.

The manual GitHub Actions workflow **macOS Apple Silicon build** regenerates runtime files, runs tests, compiles the bundled lookup engine, validates the installable root layout, packages `dist/iinatan.iinaplgz`, and uploads it as an artifact.

To publish a release package from the workflow, set `publish_release=true` and provide a `release_tag`, such as `v1.6.0`. The workflow extracts the matching version section from `CHANGELOG.md` and uses it as the GitHub Release notes. Missing or empty changelog sections fail the release job.

When cutting a release, update `Info.json`:

- `version`
- `ghVersion`

Also move the relevant `CHANGELOG.md` entries into the versioned section that matches the release tag without the leading `v`.

IINA uses `ghRepo` and `ghVersion` for GitHub plugin update checks.

## Regression Guidance

When adding regressions for UI bugs, prefer assertions that lock the intended behavior narrowly:

- Header divider removed while `.entry + .entry` separators remain.
- Pitch accent group starts on a new metadata row while the tag and accent display remain side by side.
- Pitch display sizing changes do not resize unrelated tags.
- Source links remain sanitized and clickable.
- Dictionary-specific formatting fixes remain scoped to the affected dictionaries.

## Version Control Checklist

Before committing, inspect the final diff:

```bash
git diff --stat
git diff -- <changed-files>
```

Stage explicit paths:

```bash
git add <file1> <file2> ...
```

Use a focused commit message that describes the user-visible change. Keep generated files in the same commit as the source change that produced them.

Push the current branch when requested or when continuing an already-pushed feature branch:

```bash
git push origin <branch-name>
```

Confirm the final state:

```bash
git status --short --branch
```

Final reports should include:

- Commit hash and commit message when a commit was made.
- Whether the branch was pushed.
- Files or areas changed.
- Test/build commands run and their result.
- Any skipped tests, with the reason.
