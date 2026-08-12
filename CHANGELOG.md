# Changelog

## Unreleased

### Improved

- Restored fast YouTube startup with native subtitle lookup by keeping Online Media caption URLs delayed until mpv needs them, reusing mpv's decoded SRT events instead of downloading captions twice, and avoiding repeated work for unselected tracks and unchanged cues.
- Reduced plugin-wide startup and interaction overhead by deduplicating cold-start filesystem/backend work, caching active dictionary discovery, indexing deinflection rules, avoiding repeated overlay lookup scans and debug formatting, streamlining subtitle hit-box layout and Anki card formatting, and preventing teardown events from restarting plugin work.
- Added a reproducible plugin-wide benchmark covering startup, six-language lookup, media/subtitle handling, native geometry, overlay rendering, Anki cards, and dictionary/profile settings, including comparisons against an untouched Git revision.

### Fixed

- Prevented rapid subtitle lookups, including Chinese lookup thrashing, from leaking IINA native timers or racing its WebSocket timer bookkeeping; direct worker responses retain their fast polling cadence through one shared active-lookup interval.
- Kept dictionary lookups responsive when opening overlapping player windows or loading subtitles manually by giving each player its own bridge and worker runtime, recovering rare bridge-port conflicts, and retaining a native-message fallback if the socket is unavailable.
- Prevented lookup-owned pauses from rebuilding text-subtitle hit targets under a stationary pointer, which could repeatedly reopen one word and rapidly alternate pause and resume; bitmap-subtitle OCR still rebuilds when pausing requires a fresh frame.

## 2.1.1 - 2026-08-10

### Changed

- Moved the Anki enable checkbox to the top of the Anki settings tab.
- Made native subtitle lookup the default for new profiles, presented the older renderer as legacy mode, refined its setting spacing, and moved detailed subtitle and OCR explanations behind help controls.

### Fixed

- Restored native-subtitle lookup for YouTube SRT captions loaded by IINA's Online Media plugin by validating and unwrapping its external subtitle EDL while keeping unrelated unknown codecs and unsafe sources rejected.

## 2.1.0 - 2026-08-07

### Added

- Added word lookup for image-based subtitles such as PGS, VobSub, DVB, and XSUB. Recognition runs on your Mac, with a privacy and accuracy notice shown before first use.
- Added clearer compatibility and recognition status messages, including a small OCR activity indicator while image subtitles are being read.

### Improved

- Image-subtitle lookup is faster and more reliable with paused and streaming video, while keeping subtitle positioning accurate and playback responsive.

### Fixed

- Long frequency labels, including JPDB rankings, now stay compact and readable instead of wrapping awkwardly.

## 2.0.3 - 2026-07-30

### Changed

- Increased the configurable maximum nested-popup depth from 5 to 99,999.

### Fixed

- Allowed clicks on a nested lookup's source word or empty parent-popup space to dismiss only that popup's descendants, while clicks on a different word still replace the direct child in both hover and click modes.
- Restored the context-sensitive popup cursor so empty space uses the regular arrow while selectable text retains the text cursor.
- Made release builds retry transient pinned-dependency download failures and switched FreeType to Savannah's working official mirror.

## 2.0.2 - 2026-07-30

### Added

- Added JSON backup and restore for all profiles and global dictionary-import settings. Missing dictionary references retain their order and enabled state and are reconciled when matching dictionaries are installed later.
- Added optional nested dictionary popups. You can look up words inside a definition by hovering or clicking without closing the original entry. Each profile can limit how many popups open in a chain.

### Fixed

- Fixed automated validation sometimes failing on Linux while checking AnkiConnect timeout recovery.
- Improved nested popup placement, kept matched text fully highlighted, and made furigana select its base word. Anki cards created from nested popups no longer include unrelated details or media from the current video.
- Fixed experimental native subtitle lookup stopping after you switched language profiles.
- Improved streamed-video support for experimental subtitle lookup and Anki sentence audio, especially for online videos with ASS or SRT subtitles. Lookup now handles sources and subtitle tracks that load late, reuses subtitles already loaded by the player when possible, and keeps stream URLs private. Local files continue to work as before.

## 2.0.1 - 2026-07-29

### Changed

- Added explicit runtime source manifests, a timed grouped test runner, automatic read-only push/PR validation, authoritative settings runtime-effect metadata, version consistency checks, and bounded lookup/audio/native-metric/SRT/Anki caches.
- Removed embedded parser/settings unit tests and the lookup benchmark from the shipped runtime; equivalent standalone coverage remains under `tests/`.
- Added a redacted Debug-menu runtime snapshot for lifecycle, worker, queue, cache, timer, subtitle-track, and bridge diagnostics.
- Reduced persistent native-worker idle queue scans with active-to-idle backoff while retaining the configured fast response interval.
- Added a repository-wide maintainability and performance audit with measured baselines, ownership mapping, cache policies, and deliberately deferred work.
- Reused native ASS demux/libass sessions across nearby cues, made full instrumentation validation and alpha-mask generation demand-driven diagnostics, added structured lifecycle/performance counters, and stripped release symbols while retaining local dSYM output.
- Added an optional default-style looked-up-text highlight to the experimental native-subtitle layer, with a profile toggle for popup-only invisible operation.
- Extended the experimental native-subtitle lookup layer to Japanese, English, German, French, Chinese, and Korean through shared language character policies.
- Added independent primary and selected-secondary subtitle lookup surfaces, with one stable primary-then-secondary lookup stream, faithful secondary ASS geometry through mpv's plain observation, and isolated fallback when either surface is unavailable.
- Extended appearance-preserving native ASS hit geometry to simultaneous independently positioned dialogue events, including authored line breaks, while rejecting ambiguous event matching and cross-event lookup spans.
- Added appearance-preserving ASS/SSA hit boxes to the experimental native-subtitle layer. The existing arm64 helper now uses a pinned static FFmpeg/libass stack and a narrowly patched libass unit-ID channel, follows mpv 0.38's authored-ASS `no`/`yes`/`scale` renderer settings, returns a bounded fill-alpha mask for copied-text diagnostics, verifies byte-identical character/outline/shadow alpha planes, and fails closed for ambiguous cues, unsupported styling, or shaping clusters that cross lookup-unit boundaries.
- Raised the native ASS helper's individual embedded-font allowance to 32 MiB for common Arial Unicode attachments and removed its separate 32-font cap while retaining the 64 MiB cumulative attachment and 128-stream safety limits.
- Made native ASS releases reproducible and relinkable: macOS CI now rebuilds the geometry-enabled helper at a macOS 11.0 deployment target, verifies a self-contained corresponding-source archive, publishes it beside the plugin, and packages complete third-party license texts.
- Added an opt-in experimental native-subtitle lookup layer for SubRip cues. It keeps mpv subtitles visible and uses a Shadow-DOM-isolated measurement flow with libass-calibrated WebKit glyph metrics and native nominal multiline advance for invisible hit boxes; simple ASS is best-effort only when mpv is already forcing or stripping styling. Complex/ambiguous ASS (including signs that mpv 0.38 cannot reliably identify), bitmap subtitles, OCR, image fallbacks, and geometry-distorting overlay ancestor CSS remain native-only. Advanced settings include hit-box and copied-text-opacity diagnostics.
- Preserved subtitle line breaks by default, added an opt-in profile setting to flatten them, and anchored popup spacing to the selected subtitle row.
- Split Anki card context and glossary formatting into a dedicated source module with focused test-suite coverage.
- Split Anki note-action helpers into a dedicated source module with focused test-suite coverage.

### Fixed

- Preserved and recovered corrupt dictionary manifests through verified staged commits, schema versions, last-known-good backups, and diagnostic corrupt-file copies instead of silently treating parse failures as empty state.
- Published JavaScript worker requests through complete body files plus commit markers, bounded native request bodies and IDs, and rejected response-path redirection through mismatched request IDs.
- Preserved an explicitly zero Anki sentence-audio padding value and made profile/global preference write failures propagate instead of being silently ignored.
- Restricted audio-source redirects to HTTP/HTTPS and limited resolver responses to 4 MiB.
- Made Apple Silicon release validation install its FFmpeg fixture tool and prevented headless CoreText font probes from hanging CI.
- Reapplied IINA overlay clickability through a false-to-enabled transition after the WebView reports ready, preventing cold starts from leaving valid subtitle targets invisible and non-interactive until Shift+H is toggled twice.
- Added native ASS hit geometry for dialogue containing bounded inline italic overrides, so an otherwise ordinary subtitle no longer loses all word targets when one word is italicized.
- Fixed persisted native-overlay startup and rapid settings reconfiguration by separating desired enablement from runtime/helper/session/hit-layer readiness, accepting overlay readiness and layout diagnostics through the reliable WebSocket bridge, measuring plain-subtitle targets synchronously after font loading when IINA suspends WebView callbacks, invalidating stale async generations, serializing exact-PID worker teardown/startup, and limiting settings changes to their required cache, DOM, polling, visibility, or helper effects.
- Fixed simultaneous external SubRip cues being collapsed into one copied multiline block by retaining their event boundaries, tolerating ffmpeg-accepted blank separators after timing lines, and stacking each cue independently in mpv display order.
- Fixed enabled-by-default startup when the overlay reports ready during document loading, and ensured a newly ready overlay receives the current subtitle even when its cue identity was already cached.
- Stabilized native ASS hit geometry while playback advances, rejected animated ASS Effect events, and preserved every visual-row hit box when padded boxes overlap.
- Recovered experimental native-subtitle hit boxes and their hover lookups after playback resumes or a Japanese fullwidth speaker-label cue appears by preserving one canonical representation across display-span mapping and the line-bound backend handoff, failing closed on missing line bindings, keeping hover lookup ownership serialized across lifecycle resets, skipping native metric probes for empty cues, retrying one transient native font-metric failure, and clearing only failed metric entries when Shift+H or another runtime lifecycle transition starts a fresh generation.
- Made the experimental native-subtitle layer follow the live mpv subtitle font, resolve and coverage-check installed macOS faces through CoreText without silent fallback, verify libass-compatible legacy family/full/PostScript selection (failing closed when CoreText and libass would choose different faces), derive each verified face's libass-to-WebKit size ratio from its OpenType Win metrics, keep cue text out of logged process arguments via short-lived private files, model synthetic bold/italic, reject known symbol/icon fonts for CJK cues, reset stale font generations, and require balanced WebKit wrapping when libass automatically wraps a cue.
- Added an invisible safety corridor between dictionary popups and their selected subtitle words so pointer travel into a popup does not trigger an intervening subtitle lookup while adjacent words remain available.
- Stripped kana-only fullwidth parenthetical furigana from Japanese subtitles before lookup so packed forms like `伺（うか）う` query as `伺う`.
- Made the successful Anki add confirmation use a light green status background.
- Fixed Anki structured glossary HTML so Jitendex metadata, example boxes, cross-reference boxes, and attribution links export closer to Yomitan while keeping dictionary-internal links non-clickable.
- Fixed Anki selected-glossary exports for Lapis so Japanese cards prefer Jitendex like Yomitan while falling back when it is absent, support `{single-glossary-jitendex}`, put one selected dictionary entry in `MainDefinition`, and keep the full dictionary list in `Glossary`.
- Made exported structured glossary wrappers match Yomitan's plain `data-sc-*` shape more closely so Lapis sees selected Jitendex definitions like Yomitan cards do.
- Stopped embedding dictionary `styles.css` in Anki glossary fields so nested Yomitan/Jitendex CSS cannot be malformed during export.
- Stopped exporting generated-content `summary::before` rules in Anki glossary fields so Lapis does not blank structured glossary sections.
- Stopped the detached HoshiDicts lookup worker when IINA closes and added an owner-process watchdog so orphaned workers exit instead of spinning in the background.

### Documentation

- Updated README screenshots and clarified Anki popup add-button setup.
- Removed the completed local goal-tracking document from the repository.

## 2.0.0 - 2026-06-15

### Added

- Added a Prettier JavaScript formatting workflow for project source and tests while leaving generated runtime files ignored.
- Added profile-level AnkiConnect export with popup add/open actions, note type field mapping, duplicate detection, JPEG screenshots, configurable image quality, and configurable-bitrate subtitle sentence audio.

### Fixed

- Fixed AnkiConnect dropouts so popup add/status requests probe the connection, retry three fresh bounded requests on missing responses, and use a configurable three-second default response timeout.
- Fixed Anki glossary fields so structured dictionary content is rendered as card-ready HTML instead of raw JSON, while keeping glossary-plain as extracted plaintext.
- Aligned Anki glossary and glossary-first HTML with Yomitan's default glossary-single rendering, including single glossary datapoints and structured-content wrappers.
- Fixed duplicate Anki book actions so they open the detected note in Anki instead of falling through to add, clear stale note IDs after deleted duplicates, and avoid first-click bridge warm-up stalls.
- Fixed Anki add actions to recheck duplicates immediately before adding, acknowledge received bridge requests, retry one dropped first click, and stop pending UI states from hanging forever.
- Fixed Anki duplicate add clicks so prevent-mode duplicates open the existing note by `nid`, and made duplicate checks tolerate case-only field-name differences.
- Fixed Anki reveal actions so opening Anki's browser is fire-and-forget and cannot stall later popup add/open actions.
- Fixed Anki bridge request IDs so recreated popup sessions can add more than one card per IINA session.
- Fixed Anki button clicks so dynamically swapped icons remain IINA-clickable and add/open requests use the documented webview message channel before WebSocket fallback.
- Fixed Anki popup traffic so passive duplicate checks are delayed, coalesced, cached, and bounded, preventing repeated hover/add cycles from exhausting IINA subprocess monitoring threads.
- Fixed secondary popup entries so each visible headword gets its own Anki add button with that entry's headword.
- Changed Anki media filenames to use a short document-name prefix plus a hex suffix for screenshot and audio captures.
- Changed the Anki popup selection marker to use text manually selected inside the dictionary popup, and restored Lapis SelectionText/SelectedText autofill defaults.

### Known Issues

- Anki duplicate checking is currently regressed after the passive status throttling change and may not reliably detect existing notes.

## 1.9.1 - 2026-06-14

### Changed

- Popup readings now render above dictionary headwords, with Japanese entries using segmented ruby that omits okurigana and Hanzi readings using whole-headword ruby for spacing.
- Moved recommended Japanese dictionary downloads into an in-window settings panel and expanded the list with JMnedict, BCCWJ, JPDB, and Jiten Global.
- Added term/frequency-only recommended downloads for English, German, French, Chinese, and Korean.
- Recommended dictionary panel contents now follow the active profile lookup language.
- Removed experimental labels from English, German, French, and Chinese; Korean remains marked experimental.
- Required packaged release builds to include `CHANGELOG.md`.
- GitHub release publishing now uses the matching `CHANGELOG.md` version section as the release notes.

### Fixed

- Dictionary popup readings that only duplicate the headword are now hidden.
- Recommended Japanese dictionary updates now replace older matching installed dictionaries instead of leaving duplicate dated installs behind.

### Documentation

- Linked the README release-package install path to the latest GitHub release.

## 1.9.0 - 2026-06-14

### Added

- Added profile-level word audio playback in dictionary popups, including configurable audio source URLs and optional autoplay.
- Added support for direct audio source endpoints that return playable audio without an intermediate JSON response.
- Added an audio source context menu so popup audio buttons can play from a selected configured source.

### Changed

- Kept scaled popups clear of the subtitle-safe region.
- Updated README coverage for the new audio-related workflow.

### Fixed

- Fixed word audio source resolution through the overlay bridge and added focused audio bridge coverage.
- Fixed adding word audio sources in settings and restored the default audio source after clearing the source list.
- Fixed audio source menu hover/click behavior so source selection remains stable and clickable inside the overlay.
- Fixed secondary audio button alignment in dictionary entries.
- Non-Japanese word lookups now keep the subtitle hover highlight on the original surface word after deinflection, so filtered suffix letters no longer draw separate mini highlight boxes.

### Tests

- Added and clarified overlay audio and bridge test fixtures for the word audio playback path.

## 1.8.1 - 2026-06-13

### Fixed

- Playback now resumes after a hover lookup popup disappears when popup pause is enabled, while preserving manually paused playback.
- Popup pause handling now ignores stale hide events and cancels pending resume when another popup appears.

## 1.8.0 - 2026-06-12

### Added

- Added a per-profile popup color mode setting with inherit, dark, and light options.
- Added a light popup theme while keeping the existing dark popup appearance available.

### Changed

- Popup colors now use shared theme variables across dictionary entries, metadata chips, forms tables, status messages, and import progress UI.
- In inherited color mode, the overlay follows IINA or system appearance hints when available.
- Included the changelog in packaged release builds.

### Fixed

- Theme selection now resolves to concrete light or dark overlay classes instead of leaving an inherit-only theme state.

### Documentation

- Expanded README acknowledgements for Yomitan, HoshiDicts, Chimahon, and Hoshi Reader Android.
