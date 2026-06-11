# iinatan

iinatan is an IINA plugin that shows dictionary popups when you hover subtitle text. Japanese is the supported default path and uses a bundled HoshiDicts/Yomitan-compatible lookup engine; English and Korean are experimental exact-match paths for compatible dictionaries.

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

You can also use **Import Dictionary ZIP...** for Yomitan-compatible dictionary ZIP files. Japanese dictionaries use HoshiDicts Japanese text processing and deinflection. English and Korean are placeholders for compatible Yomitan term dictionaries and perform exact whole-word/run lookup without deinflection.

## Settings

Open the plugin preferences to choose the lookup language, tune subtitle/popup appearance, set import and lookup timeouts, and adjust advanced worker IPC options. See `SETTINGS_AUDIT.md` for every setting, its default, implementation path, live-update behavior, and caveats.

## Development

HoshiDicts is pinned as a git submodule under `vendor/hoshidicts`.

```bash
git submodule update --init --recursive
```

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

- **Run Language Unit Tests** checks the selected language registry assumptions, including Japanese rightward-prefix lookup and Latin whole-word lookup.
- **Run Settings Audit Checks** verifies that key settings are readable and propagated into overlay config.
- **Run Lookup Performance Benchmark** measures worker lookup latency with installed dictionaries.
- **Reveal Debug Log File** and **Reveal Plugin Data Folder** open troubleshooting files in Finder.

If lookups fail, first confirm that at least one dictionary is installed and enabled, then reveal `worker.log`. For development builds, run `scripts/build_native_backend.sh` if `bin/iina-hoshi-dicts` is missing.

## Changelog

### v1.6.0

- Renamed the plugin to `iinatan` with identifier `com.afn478.iinatan`.
- Pins HoshiDicts as a git submodule and builds the lookup engine from that pinned source.
- Bundles the compiled Apple Silicon lookup engine with the plugin package.
- Removes the in-app backend rebuild action.
- Improves plugin descriptions, menu labels, preferences, and status messages for end users.
