# Changelog

## Unreleased

### Added

- Added profile-level AnkiConnect export with popup add/open actions, note type field mapping, duplicate detection, JPEG screenshots, configurable image quality, and configurable-bitrate subtitle sentence audio.

### Fixed

- Fixed Anki glossary fields so structured dictionary content is rendered as card-ready HTML instead of raw JSON, while keeping glossary-plain as extracted plaintext.
- Fixed duplicate Anki book actions so they open the detected note in Anki instead of falling through to add, clear stale note IDs after deleted duplicates, and avoid first-click bridge warm-up stalls.
- Removed SelectionText and SelectedText from Lapis Anki autofill defaults while keeping the looked-up text marker available for manual field mappings.

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
