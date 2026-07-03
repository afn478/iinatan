# iinatan source layout

The package root still contains generated runtime files (`main.js`, `overlay.html`, `dictionary-manager.html`,
`global.js`, `preferences.html`, and `Info.json`) because that is the most conservative IINA plugin loading path.

The maintainable source is split under `src/`:

- `src/main/00_context_state_paths.js` — IINA API bindings, state, preferences, logging, paths.
- `src/main/10_subtitle_text_style.js` — subtitle cleanup, IINA/mpv subtitle style extraction, overlay config.
- `src/main/15_profile_settings.js` — profile/global setting defaults and pure preference normalization.
- `src/main/20_dictionary_manifest.js` — installed dictionary manifest and menu helper utilities.
- `src/main/30_backend_import_worker_lookup.js` — bundled lookup engine install, dictionary import, persistent lookup worker.
- `src/main/40_legacy_line_precompute.js` — legacy parser/precompute helpers kept while lookup flow is stabilized.
- `src/main/50_overlay_bridge_pause.js` — local WebSocket overlay bridge and pause/resume lifecycle.
- `src/main/52_anki_templates.js` — Anki marker definitions, template marker scanning, media needs, and field rendering.
- `src/main/53_anki_duplicates.js` — Anki duplicate query/check-note/options shaping.
- `src/main/60_overlay_lifecycle_toggle.js` — overlay initialization, polling, enable/disable, Shift+H.
- `src/main/70_tests_menu.js` — parser tests, dictionary lookup test action, plugin menu assembly.
- `src/main/99_bootstrap.js` — startup event registration.
- `src/native/iina_hoshi.cpp` — native HoshiDicts wrapper source.
- `scripts/build_native_backend.sh` — builds `bin/iina-hoshi-dicts` from the pinned `vendor/hoshidicts` submodule.
- `vendor/hoshidicts` — pinned HoshiDicts submodule.
- `src/overlay/overlay.css` — overlay styling.
- `src/overlay/overlay.js` — overlay interaction/rendering logic.
- `src/overlay/overlay.template.html` — generated overlay HTML template.

Generated `main.js` is assembled in numeric source order: IINA bindings and shared runtime state first, language modules next, then `src/main/[1-7][0-9]_*.js`, and finally `99_bootstrap.js`. Source modules therefore intentionally share globals in the generated runtime, but domain rules should still live in the narrowest source file that owns them.

## Main Runtime Flow

Startup enters through `99_bootstrap.js`, registers IINA events/menu items, applies the active dictionary profile, and delegates overlay lifecycle work to `60_overlay_lifecycle_toggle.js`. Subtitle polling reads and cleans the current subtitle in `10_subtitle_text_style.js`, sends subtitle/config messages to the HTML overlay, and warms the native lookup worker when dictionaries are available.

Hover lookup starts in `src/overlay/overlay.js`: the overlay turns pointer position into a language-aware lookup request and sends it across the local bridge owned by `50_overlay_bridge_pause.js`. Main-side lookup orchestration then selects active dictionaries from the manifest/profile state in `20_dictionary_manifest.js`, coordinates the HoshiDicts worker in `30_backend_import_worker_lookup.js`, and returns shaped dictionary payloads for overlay rendering.

Settings/profile state is split by responsibility. `15_profile_settings.js` owns the default values and coercion rules for profile preferences and global dictionary-import settings. `20_dictionary_manifest.js` owns manifest shape, active-profile selection, dictionary order/enablement, profile CRUD, and persistence. UI windows should consume normalized state rather than duplicating fallback behavior.

## Current Risk Map

- `src/overlay/overlay.js` remains the largest mixed-responsibility file: DOM event binding, popup placement, dictionary HTML rendering, audio controls, theme handling, and Anki button state all share one closure.
- `src/main/55_anki_integration.js` still mixes AnkiConnect transport, media capture, manager state, and overlay bridge handling.
- `src/main/00_context_state_paths.js` still owns broad module-level mutable state for lifecycle, lookup cache/in-flight requests, bridge connections, pause state, diagnostics, task overlay state, and cached paths.
- Boundary code has many intentionally best-effort `catch (_) {}` blocks around IINA/mpv/DOM APIs. These are useful for host compatibility, but future refactors should add context where failures affect user-visible behavior.
- String contracts are still scattered across the overlay, settings manager HTML, main bridge messages, and `Info.json`. New settings and message types should be added through named constants or narrowly tested helpers where practical.

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
