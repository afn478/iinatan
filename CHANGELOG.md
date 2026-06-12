# Changelog

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
