# iinatan

iinatan brings hover-to-lookup dictionary popups to subtitles in IINA on macOS. It is vibecoded, still not production ready, and best treated as experimental, though most core functionality should basically work.

The goal is a compact dictionary popup that feels native to a video player: quick enough for subtitles, structured enough for serious reading, and quiet enough to stay out of the movie's way.

## Screenshots

![Japanese popup over paused subtitles](docs/screenshots/japanese-popup.png)

| English lookup and language menu | Dictionary settings |
| --- | --- |
| ![English lookup with language menu](docs/screenshots/english-popup-language-menu.png) | ![Dictionary settings](docs/screenshots/dictionary-settings.png) |

## Feature Highlights

- Hover subtitle text to show dictionary entries without leaving IINA.
- Pause-only popup behavior keeps lookups from interrupting normal playback.
- Japanese lookup uses HoshiDicts with Yomitan-compatible dictionary data, including deinflection support.
- Jitendex is the recommended Japanese dictionary and can be installed from the plugin settings.
- English, French, German, Chinese, and Korean lookup modes are available for compatible dictionaries.
- Japanese entries can show frequency and pitch-accent metadata when the dictionary provides it.
- Dictionary popups support structured entries, compact tags, collapsed long sections, source links, and custom CSS.
- Settings profiles make it possible to keep separate language, popup, playback, and dictionary setups.

## Installation

### Install From GitHub

1. Open IINA's plugin manager.
2. Choose **Install from GitHub**.
3. Enter `afn478/iinatan`.
4. Enable the plugin.
5. Open **Plugins -> iinatan -> Settings...** and install the recommended dictionary or import a Yomitan-compatible dictionary ZIP.
6. Toggle iinatan with **Shift+H**.

### Install a Release Package

Release builds provide an `.iinaplgz` package. Install that file through IINA's plugin manager if you prefer a packaged plugin artifact.

## Basic Japanese Setup

1. Open **Plugins -> iinatan -> Settings...**.
2. Set the lookup language to **Japanese**.
3. Install the recommended dictionary, Jitendex, from the dictionary panel.
4. Make sure Jitendex is enabled.
5. Open a video with Japanese subtitles.
6. Pause playback, move the pointer over subtitle text, and wait for the popup.
7. If the popup does not appear, press **Shift+H** to toggle iinatan on.

## Dictionaries

Open **Plugins -> iinatan -> Settings...** to install the recommended Japanese dictionary, import local Yomitan-compatible dictionary ZIP files, enable or disable dictionaries, and reorder lookup priority.

Installed dictionary state is stored in the plugin data folder. The active profile controls dictionary order, lookup language, popup appearance, playback behavior, import settings, and lookup settings.

Language modes behave differently:

- Japanese uses HoshiDicts text processing and deinflection.
- English looks up whole words after lowercasing the hovered text.
- French and German use Yomitan-style candidate and deinflection rules.
- Chinese uses longest rightward-prefix lookup.
- Korean performs exact contiguous-Hangul lookup.

Compatibility metadata is advisory. A dictionary may still import even when iinatan cannot confidently identify its language.

## Settings

Use **Plugins -> iinatan -> Settings...** to create profiles, switch profiles, choose the lookup language, tune subtitle and popup appearance, manage playback behavior, adjust lookup/import timeouts, and manage installed dictionaries.

The top plugin menu also exposes **Settings...** and direct profile switching.

## Development / Contributing

Development notes, build commands, test commands, packaging details, and release steps live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

iinatan is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See `LICENSE` for the full license text.

## Common Troubleshooting

- If the plugin stalls, try restarting IINA first.
