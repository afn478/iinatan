#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH"
DATA_ROOT="$1"
if ! printenv HOME >/dev/null 2>&1 || [ -z "$(printenv HOME)" ]; then
  HOME_FROM_DATA="$(printf "%s\n" "$DATA_ROOT" | sed 's#/Library/Application Support/.*##')"
  if [ -n "$HOME_FROM_DATA" ] && [ "$HOME_FROM_DATA" != "$DATA_ROOT" ]; then
    export HOME="$HOME_FROM_DATA"
  else
    export HOME="$DATA_ROOT/home"
    mkdir -p "$HOME"
  fi
fi
export GIT_TERMINAL_PROMPT=0
SRC_DIR="$DATA_ROOT/vendor/hoshidicts"
BIN_DIR="$DATA_ROOT/bin"
WRAPPER_SRC="$DATA_ROOT/build/iina_hoshi.cpp"
mkdir -p "$DATA_ROOT/vendor" "$BIN_DIR"
if ! command -v git >/dev/null 2>&1; then echo "git is required" >&2; exit 10; fi
if ! command -v cmake >/dev/null 2>&1; then echo "cmake is required. Install it with Homebrew or another package manager." >&2; exit 11; fi
GIT_URL_FIX_1="url.https://github.com/.insteadOf=git@github.com:"
GIT_URL_FIX_2="url.https://github.com/.insteadOf=ssh://git@github.com/"
if [ -d "$SRC_DIR" ] && [ ! -d "$SRC_DIR/.git" ]; then rm -rf "$SRC_DIR"; fi
if [ ! -d "$SRC_DIR/.git" ]; then git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" clone --depth 1 https://github.com/Manhhao/hoshidicts.git "$SRC_DIR"; fi
git -C "$SRC_DIR" remote set-url origin https://github.com/Manhhao/hoshidicts.git
git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" -C "$SRC_DIR" fetch --depth 1 origin main
git -C "$SRC_DIR" checkout main
git -C "$SRC_DIR" reset --hard origin/main
git -C "$SRC_DIR" config -f .gitmodules submodule.external/utf8proc.url https://github.com/JuliaStrings/utf8proc.git
git -C "$SRC_DIR" config submodule.external/utf8proc.url https://github.com/JuliaStrings/utf8proc.git
git -C "$SRC_DIR" submodule sync --recursive
git -C "$SRC_DIR" submodule deinit -f external/utf8proc >/dev/null 2>&1 || true
rm -rf "$SRC_DIR/.git/modules/external/utf8proc" "$SRC_DIR/external/utf8proc"
git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" -C "$SRC_DIR" submodule update --init --recursive --depth 1
cp "$WRAPPER_SRC" "$SRC_DIR/cli/iina_hoshi.cpp"
if ! grep -q "iina-hoshi-dicts" "$SRC_DIR/CMakeLists.txt"; then
  cat >> "$SRC_DIR/CMakeLists.txt" <<'CMAKEEOF'

add_executable(iina-hoshi-dicts cli/iina_hoshi.cpp)
target_link_libraries(iina-hoshi-dicts PRIVATE hoshidicts)
CMAKEEOF
fi
cmake -S "$SRC_DIR" -B "$SRC_DIR/build-iina" -DCMAKE_BUILD_TYPE=Release
cmake --build "$SRC_DIR/build-iina" --target iina-hoshi-dicts --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cp "$SRC_DIR/build-iina/iina-hoshi-dicts" "$BIN_DIR/iina-hoshi-dicts"
chmod 755 "$BIN_DIR/iina-hoshi-dicts"
echo "installed $BIN_DIR/iina-hoshi-dicts"
