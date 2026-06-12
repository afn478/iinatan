# iinatan source layout

The package root still contains generated runtime files (`main.js`, `overlay.html`, `dictionary-manager.html`,
`global.js`, `preferences.html`, and `Info.json`) because that is the most conservative IINA plugin loading path.

The maintainable source is split under `src/`:

- `src/main/00_context_state_paths.js` — IINA API bindings, state, preferences, logging, paths.
- `src/main/10_subtitle_text_style.js` — subtitle cleanup, IINA/mpv subtitle style extraction, overlay config.
- `src/main/20_dictionary_manifest.js` — installed dictionary manifest and menu helper utilities.
- `src/main/30_backend_import_worker_lookup.js` — bundled lookup engine install, dictionary import, persistent lookup worker.
- `src/main/40_legacy_line_precompute.js` — legacy parser/precompute helpers kept while lookup flow is stabilized.
- `src/main/50_overlay_bridge_pause.js` — local WebSocket overlay bridge and pause/resume lifecycle.
- `src/main/60_overlay_lifecycle_toggle.js` — overlay initialization, polling, enable/disable, Shift+H.
- `src/main/70_tests_menu.js` — parser tests, dictionary lookup test action, plugin menu assembly.
- `src/main/99_bootstrap.js` — startup event registration.
- `src/native/iina_hoshi.cpp` — native HoshiDicts wrapper source.
- `scripts/build_native_backend.sh` — builds `bin/iina-hoshi-dicts` from the pinned `vendor/hoshidicts` submodule.
- `vendor/hoshidicts` — pinned HoshiDicts submodule.
- `src/overlay/overlay.css` — overlay styling.
- `src/overlay/overlay.js` — overlay interaction/rendering logic.
- `src/overlay/overlay.template.html` — generated overlay HTML template.

Run this from the plugin root after editing source modules:

```bash
python3 scripts/build_plugin.py
```

To create an installable package:

```bash
python3 scripts/build_plugin.py --package /tmp/iinatan.iinaplgz
```

Build the bundled Apple Silicon lookup engine before packaging a release:

```bash
git submodule update --init --recursive
scripts/build_native_backend.sh
```
