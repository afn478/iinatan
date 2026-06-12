# iinatan

iinatan is an IINA plugin that shows dictionary popups when you hover subtitle text. Japanese is the supported default path and uses a bundled HoshiDicts/Yomitan-compatible lookup engine; English, French, German, Chinese, and Korean are experimental paths for compatible dictionaries.

## Install From GitHub

1. Open IINA's plugin manager.
2. Choose **Install from GitHub**.
3. Enter `afn478/iinatan`.
4. Enable the plugin, then open **Plugins -> iinatan -> Settings...** to download the recommended dictionary or import another Yomitan dictionary ZIP.
5. Toggle iinatan with **Shift+H**.

The repository root is installable because it exposes the runtime files IINA loads directly: `Info.json`, `main.js`, `global.js`, `overlay.html`, `dictionary-manager.html`, `preferences.html`, `README.md`, `package.json`, and the bundled Apple Silicon backend at `bin/iina-hoshi-dicts`.

## Release Package

Release builds also produce `dist/iinatan.iinaplgz`. Install that package through IINA's plugin manager if you prefer a release artifact instead of direct GitHub install.

The manual GitHub Actions workflow **macOS Apple Silicon build** regenerates runtime files, runs tests, compiles the bundled lookup engine, validates the installable root layout, packages `dist/iinatan.iinaplgz`, and uploads it as an artifact. Set `publish_release=true` and provide a `release_tag` such as `v1.6.0` to upload the package to a GitHub Release.

When cutting a release, update `Info.json` `version` and increment the integer `ghVersion`; IINA uses `ghRepo` and `ghVersion` for GitHub plugin update checks.

## Dictionaries

Jitendex is the current recommended Japanese dictionary. Add it from **Plugins -> iinatan -> Settings...**.

Open **Plugins -> iinatan -> Settings...** to enable, disable, and reorder installed dictionaries. Settings also imports one or more local Yomitan-compatible dictionary ZIP files through IINA's file picker and uses the same task panel as the recommended dictionary installer.

Installed dictionary state lives in the plugin data manifest. The Settings window writes the active profile's dictionary order, enable/disable choices, language, popup, playback, and lookup settings. The top plugin menu exposes **Settings...**, then the available profiles for direct switching.

Japanese dictionaries use HoshiDicts Japanese text processing and deinflection. English lowercases the queried word before exact lookup, so hovering `Running` queries `running`. French and German use a Yomitan-style candidate/deinflection layer before exact backend lookup: French imports Yomitan's French suffix transform table plus local apostrophe and participle patches, while German mirrors Yomitan's German transform families and keeps the local bounded separable-verb scan such as `stehe ... auf` plus `aufstehen`. Chinese uses longest rightward-prefix lookup without Japanese deinflection. Korean performs exact contiguous-Hangul lookup.

Japanese entries can also display compact frequency and pitch-accent metadata when imported Yomitan/HoshiDicts dictionaries provide frequency or pitch meta banks. Missing metadata is ignored.

Experimental Latin/Korean modes treat whole words/runs as one hover unit; Japanese and Chinese remain character-anchored rightward lookup modes. Changing the lookup language changes parser, candidate-generation, normalization, and deinflection behavior; it does not automatically enable or disable dictionaries. If no dictionaries are installed or enabled, iinatan keeps native subtitles visible and shows a setup message instead of starting a broken lookup worker. Compatibility metadata is advisory, and ambiguous dictionaries remain importable.

## Settings

Open **Plugins -> iinatan -> Settings...** to create profiles, switch profiles, choose the lookup language, tune subtitle/popup appearance, set import and lookup timeouts, adjust playback behavior, and manage installed dictionaries. Profile switches reload the overlay so language-specific parsing and deinflection refresh immediately. See `SETTINGS_AUDIT.md` for every setting, its default, implementation path, live-update behavior, and caveats.

## Development

HoshiDicts is pinned as a git submodule under `vendor/hoshidicts`. A fresh source clone must initialize it before building the native backend:

```bash
git clone --recurse-submodules https://github.com/afn478/iinatan.git
cd iinatan
git submodule update --init --recursive
```

If you cloned without `--recurse-submodules`, the `git submodule update --init --recursive` command is still enough to populate `vendor/hoshidicts`. `npm run validate` checks that the expected HoshiDicts source layout is present; release packages still exclude `vendor/` and include only the compiled `bin/iina-hoshi-dicts` runtime.

Build the native lookup engine:

```bash
scripts/build_native_backend.sh
```

Regenerate runtime files after source edits:

```bash
npm run build
```

Create an installable package:

```bash
npm run package
```

Validate generated runtime files and metadata:

```bash
npm test
npm run validate:release
```

Link the working tree into IINA for local testing:

```bash
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
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
- `package.json`
- `bin/iina-hoshi-dicts`

The source remains under `src/`, and `scripts/build_plugin.py` concatenates `src/languages/*.js`, `src/main/*.js`, `src/overlay/overlay.css`, and `src/overlay/overlay.js` into the root runtime files.

## Diagnostics

Diagnostic logs are available from **Plugins -> iinatan -> Debug**. The plugin writes JavaScript-side diagnostics to `Plugin Data Folder/debug.log`; the lookup process writes to `Plugin Data Folder/worker/worker.log`.

Useful debug actions:

- **Run Language Unit Tests** checks the selected language registry assumptions, including Japanese rightward-prefix lookup, Latin whole-word lookup, French elision candidates, and German split-verb candidates.
- **Run Settings Audit Checks** verifies that key settings are readable and propagated into overlay config.
- **Run Lookup Performance Benchmark** measures worker lookup latency with installed dictionaries.
- **Test File Picker API** opens the same picker used by manual dictionary import and reports success, cancellation, or API failure.
- **Reveal Debug Log File** and **Reveal Plugin Data Folder** open troubleshooting files in Finder.

If lookups fail, first confirm that at least one dictionary is installed and enabled, then reveal `worker.log`. For development builds, run `scripts/build_native_backend.sh` if `bin/iina-hoshi-dicts` is missing.

If dictionary import does nothing or cannot open the picker, run **Debug -> Test File Picker API** and check `debug.log`.

If an experimental language mode cannot confidently identify a compatible dictionary, it will warn but still try the dictionaries you explicitly enabled. Import or enable a Yomitan dictionary whose metadata/path identifies that language, such as an English-headword `en-*`, French-headword `fr-*`, German-headword `de-*`, Chinese-headword `zh-*`/CC-CEDICT, or Korean-headword `ko-*` dictionary. Japanese mode continues to use the existing Jitendex/HoshiDicts path.

For Wiktionary/Kaikki-style dictionaries, the popup separates grammar, inflection/non-lemma rows, etymology, source/backlink rows, tags, and core glossary text where the dictionary data exposes those sections. Etymology is collapsed by default, source links open in the default browser, and custom CSS is injected only when the setting is non-empty.

## Changelog

### v1.6.0

- Renamed the plugin to `iinatan` with identifier `com.afn478.iinatan`.
- Pins HoshiDicts as a git submodule and builds the lookup engine from that pinned source.
- Bundles the compiled Apple Silicon lookup engine with the plugin package.
- Removes the in-app backend rebuild action.
- Improves plugin descriptions, menu labels, preferences, and status messages for end users.
