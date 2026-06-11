<!--
Primary tasks:

1. Make the GitHub repo installable through IINA’s “Install from GitHub” UI.

   Investigate IINA’s plugin repo/package expectations and organize the repository accordingly.

   Goals:
   - A user should be able to use IINA’s plugin UI and install directly from GitHub.
   - Ensure plugin metadata, package layout, release artifacts, and repo structure are correct for IINA.
   - The installable plugin root must still expose the runtime files IINA expects, including:
     - Info.json
     - main.js
     - global.js
     - overlay.html
     - preferences.html
     - README.md
     - package.json
   - Preserve the current source layout under src/ and the build script flow.
   - Add release/build instructions to README.
   - Add a clear “Install from GitHub” section.
   - If IINA requires tagged GitHub releases or .iinaplgz artifacts for direct install, set up the repo accordingly.
   - Add or update GitHub Actions if useful to build/package .iinaplgz. This action should only be run on demand.

   References:
   - IINA plugin system page: https://iina.io/plugins/
   - IINA main repo: https://github.com/iina/iina
   - Example IINA plugin repo/package flow: https://github.com/iina/plugin-online-media

2. Audit every plugin setting and verify that it actually does what it claims.

   For every setting in preferences.html / Info.json defaults / code paths:
   - Find where it is read.
   - Verify the default is sane.
   - Verify UI label, min/max, type, and behavior match the implementation.
   - Remove dead settings or wire them up properly.
   - Fix settings that only update after restart if they should update live.
   - Check that settings related to:
     - overlay enable/default enable
     - native subtitle hiding
     - subtitle styling
     - popup styling
     - scan length
     - max entries/glosses
     - backend timeout/import timeout
     - direct worker IPC
     - fallback client exec
     - direct IPC poll interval
     - worker idle sleep interval
     - pause-on-hover
     - debug logging / verbose logging
     - low-RAM import
     all behave as advertised.

   Add a concise SETTINGS_AUDIT.md documenting:
   - setting name
   - default
   - UI control
   - implementation location
   - verified behavior
   - any caveats such as “requires backend rebuild” or “applies on next subtitle line.”

3. Prepare the codebase for multi-language lookup support, while keeping Japanese working.

   Current behavior is Japanese-specific. Refactor toward a language-aware architecture.

   Add a language selector in plugin settings:
   - Japanese initially supported and selected by default.
   - Prepare the structure for additional languages without needing to rewrite the lookup pipeline.
   - Do not break current Japanese Jitendex/Yomitan dictionary import and lookup.

   Design goal:
   - Similar spirit to Yomitan, Chimahon, and Rougo.
   - Use Yomitan-compatible dictionaries where possible.
   - Language-specific deinflection/token-processing should be modular.
   - For Japanese, preserve Yomitan/HoshiDicts-style deinflection behavior.
   - For other languages, do not assume Japanese-style deinflection. Provide a clean interface for adding language-specific processors.

   Suggested architecture:
   - src/languages/
     - registry.js
     - japanese.js
     - english.js placeholder
     - korean.js placeholder if feasible
     - common.js
   - Each language module should define:
     - id
     - label
     - script/character detection
     - text normalization
     - lookup scan strategy
     - deinflection strategy or “none”
     - dictionary compatibility notes
   - Main lookup code should ask the selected language module how to:
     - determine hoverable characters
     - normalize subtitle text
     - generate lookup candidates / rightward lookup text
     - choose deinflector/backend mode
   - Keep current exact-position cache semantics.
   - For Latin / space-delimited languages, hovering any character inside a word should resolve and look up the whole word, not the partial rightward suffix from that character. For example, hovering “n” inside “running” should query “running”, not “nning”. Keep Japanese behavior unchanged: Japanese should continue using exact-position rightward-prefix lookup.
   - Inspect 1Selxo/rougo for its Kotlin-side fixes around word-boundary / whole-word lookup behavior and adapt the logic conceptually into this plugin’s JS/native pipeline without copying blindly.

   Important references:
   - Yomitan main repo: https://github.com/yomidevs/yomitan
   - Yomitan dictionary format docs: https://github.com/yomidevs/yomitan/blob/master/docs/making-yomitan-dictionaries.md
   - HoshiDicts: https://github.com/Manhhao/hoshidicts
   - Chimahon: https://github.com/sohilsayed/chimahon
   - Rougo: https://github.com/1Selxo/rougo

   Notes from reference behavior:
   - HoshiDicts says it implements a dictionary backend similar to Yomitan and that other languages may need their own deinflector or lookup-strategy adjustments.
   - Chimahon uses HoshiDicts as its native dictionary engine and credits Yomitan for language-processing inspiration.
   - Rougo should be inspected for how it wraps HoshiDicts and handles deinflection/language processing, especially its Kotlin-side fixes around whole-word lookup and word-boundary behavior.
   - Yomitan should be treated as the source of truth for language/deinflection logic where applicable.

4. Multi-language deinflection strategy.

   Investigate Yomitan’s current deinflection/language handling and extract the architecture/logic responsibly:
   - Identify where Yomitan stores language-specific deinflection rules.
   - Identify how Yomitan chooses deinflection rules per language.
   - Do not blindly paste large code blocks without checking license compatibility and attribution.
   - If copying/adapting code, preserve required license headers and add attribution.
   - Prefer a small, modular abstraction first, then port only what is needed.

   For Japanese:
   - Keep the current HoshiDicts Japanese deinflector path working.
   - Avoid duplicating Japanese deinflection in JS unless needed.
   - If adding language selector, “Japanese” should still map to the current backend behavior.

   For non-Japanese:
   - Add placeholders/interfaces and at least one minimal no-deinflection path.
   - Ensure lookup can be performed over Latin-script text without Japanese character detection blocking hover.
   - For Latin / space-delimited languages, implement whole-word lookup from hover position rather than rightward suffix lookup.
   - Add settings/UI copy that clearly marks which languages are experimental.

5. Add tests.

   Add lightweight tests or debug actions for:
   - settings audit assumptions
   - language registry selection
   - Japanese hoverability detection
   - Latin hoverability detection
   - lookup candidate generation from a cursor position
   - Latin whole-word extraction from hover position
   - Latin lookup does not query partial rightward suffixes from inside a word
   - exact-position cache correctness
   - packaging layout validation
   - generated main.js/overlay.html syntax checks

   Existing generated-runtime approach must continue:
   - Source files live under src/.
   - scripts/build_plugin.py regenerates root main.js and overlay.html.
   - The generated root files are what IINA loads.

Acceptance criteria:
- IINA can install the plugin from the GitHub repo or release path according to IINA’s expected workflow.
- The README clearly explains installation, building, packaging, backend setup, dictionary setup, and troubleshooting.
- The top-level plugin menu remains compact enough to avoid IINA’s “too many first-level menu items” warning.
- Every preference is either verified working or explicitly documented/fixed.
- Japanese lookup behavior remains as good as the current version.
- Language selector appears in settings.
- The codebase has a clean language-module abstraction.
- At least one non-Japanese placeholder/no-deinflection language path exists without breaking Japanese.
- Latin / space-delimited language lookup resolves whole words from hover position rather than partial suffixes.
- Syntax checks pass for generated main.js, global.js, and extracted overlay JS.
- Packaging produces a valid .iinaplgz with the expected root layout.
-->
