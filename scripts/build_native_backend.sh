#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/vendor/hoshidicts"
WRAPPER_DIR="${TMPDIR:-/tmp}/iinatan-native-cmake"
BUILD_DIR="$ROOT/build/native-backend"
BIN_DIR="$ROOT/bin"

if ! git -C "$SRC_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "vendor/hoshidicts is missing. Run: git submodule update --init --recursive" >&2
  exit 2
fi

git -C "$SRC_DIR" submodule update --init --recursive --depth 1
mkdir -p "$BIN_DIR" "$WRAPPER_DIR"

cat > "$WRAPPER_DIR/CMakeLists.txt" <<CMAKEEOF
cmake_minimum_required(VERSION 3.22.1)
project(iinatan_backend LANGUAGES C CXX)

add_subdirectory("$SRC_DIR" hoshidicts-build)
add_executable(iina-hoshi-dicts "$ROOT/src/native/iina_hoshi.cpp")
set_property(TARGET iina-hoshi-dicts PROPERTY CXX_STANDARD 23)
set_property(TARGET iina-hoshi-dicts PROPERTY CXX_STANDARD_REQUIRED ON)
target_link_libraries(iina-hoshi-dicts PRIVATE hoshidicts)
CMAKEEOF

cmake -S "$WRAPPER_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR" --target iina-hoshi-dicts --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cp "$BUILD_DIR/iina-hoshi-dicts" "$BIN_DIR/iina-hoshi-dicts"
chmod 755 "$BIN_DIR/iina-hoshi-dicts"
"$BIN_DIR/iina-hoshi-dicts" version
