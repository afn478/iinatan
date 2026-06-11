# iinatan

iinatan is an IINA plugin that shows popup Japanese dictionary entries while you hover subtitle text. It uses Manhhao/hoshidicts locally with Yomitan-format dictionaries such as Jitendex.

## Setup

1. Install or link the plugin in IINA.
2. Run **Plugins -> iinatan -> Backend -> Build/Update HoshiDicts Backend**.
3. Run **Plugins -> iinatan -> Dictionaries -> Get Recommended Dictionaries** to download and import Jitendex, or import another Yomitan dictionary ZIP.
4. Toggle the overlay with **Shift+H**.

## How it works

The plugin does not use Yomitan's live browser-extension API and does not launch a local HTTP server. IINA renders the subtitle overlay, the overlay reports the hovered character position, and the plugin sends a short right-context lookup to a persistent native `iina-hoshi-dicts` worker. The worker keeps HoshiDicts dictionary objects in memory so hover lookups do not reload dictionaries.

## Development

The package root contains IINA runtime files (`Info.json`, `main.js`, `global.js`, `overlay.html`, `preferences.html`) plus source modules under `src/`.

Regenerate runtime files after source edits:

```bash
python3 scripts/build_plugin.py
```

Create an installable package:

```bash
python3 scripts/build_plugin.py --package dist/iinatan.iinaplgz
```

Link the working tree into IINA for local testing:

```bash
/Applications/IINA.app/Contents/MacOS/iina-plugin link .
```

## Diagnostics

The plugin writes JavaScript-side diagnostics to `Plugin Data Folder/debug.log`. The native worker writes to `Plugin Data Folder/worker/worker.log`.

A successful hover lookup should report these stages in the popup:

1. `Plugin received hover request.`
2. `Worker ready; running native lookup client...`
3. `Native lookup returned; rendering...`

## Changelog

### v1.6.0

- Renamed the plugin to `iinatan` with identifier `com.afn478.iinatan`.
- Added an Apple Silicon GitHub Actions build for generated plugin files, packaging, and native backend compilation.
- Improved plugin descriptions and setup/development documentation.
- Keeps the v1.5.x lookup model: serialized hover lookups through a persistent HoshiDicts worker, direct worker IPC by default, and pause-only popup behavior.
- Adds and stabilizes the task/progress panel for backend builds and dictionary imports.
- Improves popup placement, height limits, subtitle avoidance, scroll handling, and structured Jitendex rendering.
