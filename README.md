# iinatan

iinatan is an IINA plugin that shows dictionary popups when you hover subtitle text. Japanese is the supported default path and uses a bundled HoshiDicts/Yomitan-compatible lookup engine; English, French, German, Chinese, and Korean are experimental paths for compatible dictionaries.

## Install From GitHub

1. Open IINA's plugin manager.
2. Choose **Install from GitHub**.
3. Enter `afn478/iinatan`.
4. Enable the plugin, then run **Plugins -> iinatan -> Dictionaries -> Add Jitendex Dictionary**, or import another Yomitan dictionary ZIP.
5. Toggle iinatan with **Shift+H**.

The repository root is installable because it exposes the runtime files IINA loads directly: `Info.json`, `main.js`, `global.js`, `overlay.html`, `preferences.html`, `README.md`, `package.json`, and the bundled Apple Silicon backend at `bin/iina-hoshi-dicts`.

## Release Package

Release builds also produce `dist/iinatan.iinaplgz`. Install that package through IINA's plugin manager if you prefer a release artifact instead of direct GitHub install.

The manual GitHub Actions workflow **macOS Apple Silicon build** regenerates runtime files, runs tests, compiles the bundled lookup engine, validates the installable root layout, packages `dist/iinatan.iinaplgz`, and uploads it as an artifact. Set `publish_release=true` and provide a `release_tag` such as `v1.6.0` to upload the package to a GitHub Release.

When cutting a release, update `Info.json` `version` and increment the integer `ghVersion`; IINA uses `ghRepo` and `ghVersion` for GitHub plugin update checks.

## Dictionaries

Jitendex is the recommended Japanese dictionary. Add it from **Plugins -> iinatan -> Dictionaries -> Add Jitendex Dictionary**.

You can also use **Import Yomitan Dictionary ZIP...** for local Yomitan-compatible dictionary ZIP files. The import action opens IINA's file picker, validates that the selected path exists and ends in `.zip`, then imports it with the same task panel used by the recommended dictionary installer.

If the file picker is unavailable in your IINA build, use **Reveal Manual Import Folder**, place one Yomitan `.zip` in that folder, then choose **Import ZIP from Manual Import Folder**. That fallback imports the local ZIP directly and does not require the recommended dictionary flow.

Installed dictionaries are enabled or disabled from the plugin preferences under **Dictionaries**. The top plugin menu keeps import and folder actions only, so large dictionary collections do not clutter IINA's menu. The preferences page writes the same manifest used by the lookup worker; if an IINA build does not expose file APIs to preferences, the page shows a limitation note and the manifest remains unchanged.

Japanese dictionaries use HoshiDicts Japanese text processing and deinflection. English lowercases the queried word before exact lookup, so hovering `Running` queries `running`. French and German use a Yomitan-style candidate/deinflection layer before exact backend lookup: French imports Yomitan's French suffix transform table plus local apostrophe and participle patches, while German mirrors Yomitan's German transform families and keeps the local bounded separable-verb scan such as `stehe ... auf` plus `aufstehen`. Chinese uses longest rightward-prefix lookup without Japanese deinflection. Korean performs exact contiguous-Hangul lookup.

Japanese entries can also display compact frequency and pitch-accent metadata when imported Yomitan/HoshiDicts dictionaries provide frequency or pitch meta banks. Missing metadata is ignored.

Experimental Latin/Korean modes treat whole words/runs as one hover unit; Japanese and Chinese remain character-anchored rightward lookup modes. Changing the lookup language changes parser, candidate-generation, normalization, and deinflection behavior; it does not automatically enable or disable dictionaries. If no dictionaries are installed or enabled, iinatan keeps native subtitles visible and shows a setup message instead of starting a broken lookup worker. Compatibility metadata is advisory, and ambiguous dictionaries remain importable.

## Settings

Open the plugin preferences to choose the lookup language, manage installed dictionaries, tune subtitle/popup appearance, set import and lookup timeouts, and adjust advanced worker IPC options. Popup settings include collapsed/expanded etymology behavior, a Wiktionary/Kaikki-specific etymology override, and an optional custom popup CSS textarea for advanced tweaks. See `SETTINGS_AUDIT.md` for every setting, its default, implementation path, live-update behavior, and caveats.

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

If manual dictionary import does nothing or cannot open the picker, run **Debug -> Test File Picker API** and check `debug.log`. You can always use **Dictionaries -> Reveal Manual Import Folder** followed by **Import ZIP from Manual Import Folder** to import a local Yomitan `.zip`.

If an experimental language mode cannot confidently identify a compatible dictionary, it will warn but still try the dictionaries you explicitly enabled. Import or enable a Yomitan dictionary whose metadata/path identifies that language, such as an English-headword `en-*`, French-headword `fr-*`, German-headword `de-*`, Chinese-headword `zh-*`/CC-CEDICT, or Korean-headword `ko-*` dictionary. Japanese mode continues to use the existing Jitendex/HoshiDicts path.

For Wiktionary/Kaikki-style dictionaries, the popup separates grammar, inflection/non-lemma rows, etymology, source/backlink rows, tags, and core glossary text where the dictionary data exposes those sections. Etymology is collapsed by default, source links open in the default browser, and custom CSS is injected only when the setting is non-empty.

## Changelog

### v1.6.0

- Renamed the plugin to `iinatan` with identifier `com.afn478.iinatan`.
- Pins HoshiDicts as a git submodule and builds the lookup engine from that pinned source.
- Bundles the compiled Apple Silicon lookup engine with the plugin package.
- Removes the in-app backend rebuild action.
- Improves plugin descriptions, menu labels, preferences, and status messages for end users.
