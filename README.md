# iinatan

iinatan is an IINA plugin that shows Japanese dictionary popups when you hover subtitle text.

## Setup

1. Install or link the plugin in IINA.
2. Run **Plugins -> iinatan -> Dictionaries -> Add Jitendex Dictionary**, or import another Yomitan dictionary ZIP.
3. Toggle iinatan with **Shift+H**.

The packaged plugin includes its Apple Silicon lookup engine. Users do not need to build anything inside IINA.

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

Diagnostic logs are available from **Plugins -> iinatan -> Debug**. The plugin writes JavaScript-side diagnostics to `Plugin Data Folder/debug.log`; the lookup process writes to `Plugin Data Folder/worker/worker.log`.

## Changelog

### v1.6.0

- Renamed the plugin to `iinatan` with identifier `com.afn478.iinatan`.
- Pins HoshiDicts as a git submodule and builds the lookup engine from that pinned source.
- Bundles the compiled Apple Silicon lookup engine with the plugin package.
- Removes the in-app backend rebuild action.
- Improves plugin descriptions, menu labels, preferences, and status messages for end users.
