#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/vendor/hoshidicts"
WRAPPER_DIR="${TMPDIR:-/tmp}/iinatan-native-cmake"
BUILD_DIR="$ROOT/build/native-backend"
BIN_DIR="$ROOT/bin"
GEOMETRY_STAGE="$ROOT/build/native-geometry-deps/stage"
WITH_ASS_GEOMETRY=0
export MACOSX_DEPLOYMENT_TARGET=11.0

if [[ "${1:-}" == "--with-ass-geometry" ]]; then
  WITH_ASS_GEOMETRY=1
  "$ROOT/scripts/build_native_geometry_dependencies.sh"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--with-ass-geometry]" >&2
  exit 2
fi

if [[ ! -f "$SRC_DIR/CMakeLists.txt" ]]; then
  echo "vendor/hoshidicts is missing or incomplete." >&2
  exit 2
fi

if git -C "$SRC_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$SRC_DIR" submodule update --init --recursive --depth 1
fi
for required in glaze zstd unordered_dense libdeflate utf8proc; do
  if [[ ! -f "$SRC_DIR/external/$required/CMakeLists.txt" ]]; then
    echo "vendor/hoshidicts dependency is missing: external/$required" >&2
    exit 2
  fi
done
mkdir -p "$BIN_DIR" "$WRAPPER_DIR"

cat > "$WRAPPER_DIR/CMakeLists.txt" <<CMAKEEOF
cmake_minimum_required(VERSION 3.22.1)
project(iinatan_backend LANGUAGES C CXX OBJCXX)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "" FORCE)

add_subdirectory("$SRC_DIR" hoshidicts-build)
add_executable(
  iina-hoshi-dicts
  "$ROOT/src/native/iina_hoshi.cpp"
  "$ROOT/src/native/worker_protocol.cpp"
  "$ROOT/src/native/controller_hid.cpp"
  "$ROOT/src/native/media_demux.cpp"
  "$ROOT/src/native/ass_geometry.cpp"
  "$ROOT/src/native/bitmap_subtitle.cpp"
  "$ROOT/src/native/vision_ocr.mm"
)
target_include_directories(iina-hoshi-dicts PRIVATE "$ROOT/src/native")
set_property(TARGET iina-hoshi-dicts PROPERTY CXX_STANDARD 23)
set_property(TARGET iina-hoshi-dicts PROPERTY CXX_STANDARD_REQUIRED ON)
find_library(CORETEXT_FRAMEWORK CoreText REQUIRED)
find_library(COREFOUNDATION_FRAMEWORK CoreFoundation REQUIRED)
find_library(FOUNDATION_FRAMEWORK Foundation REQUIRED)
find_library(VISION_FRAMEWORK Vision REQUIRED)
find_library(COREGRAPHICS_FRAMEWORK CoreGraphics REQUIRED)
find_library(IMAGEIO_FRAMEWORK ImageIO REQUIRED)
find_library(IOKIT_FRAMEWORK IOKit REQUIRED)
set_source_files_properties(
  "$ROOT/src/native/vision_ocr.mm"
  PROPERTIES COMPILE_FLAGS "-fobjc-arc"
)
target_link_libraries(
  iina-hoshi-dicts
  PRIVATE
  hoshidicts
  "\${CORETEXT_FRAMEWORK}"
  "\${COREFOUNDATION_FRAMEWORK}"
  "\${FOUNDATION_FRAMEWORK}"
  "\${VISION_FRAMEWORK}"
  "\${COREGRAPHICS_FRAMEWORK}"
  "\${IMAGEIO_FRAMEWORK}"
  "\${IOKIT_FRAMEWORK}"
)
CMAKEEOF

if [[ "$WITH_ASS_GEOMETRY" == "1" ]]; then
  cat >> "$WRAPPER_DIR/CMakeLists.txt" <<CMAKEEOF
target_compile_definitions(iina-hoshi-dicts PRIVATE IINATAN_ASS_GEOMETRY=1)
target_include_directories(
  iina-hoshi-dicts
  PRIVATE
  "$GEOMETRY_STAGE/include"
  "$GEOMETRY_STAGE/include/freetype2"
)
target_link_libraries(
  iina-hoshi-dicts
  PRIVATE
  "$GEOMETRY_STAGE/lib/libass.a"
  "$GEOMETRY_STAGE/lib/libharfbuzz.a"
  "$GEOMETRY_STAGE/lib/libfribidi.a"
  "$GEOMETRY_STAGE/lib/libunibreak.a"
  "$GEOMETRY_STAGE/lib/libfreetype.a"
  "$GEOMETRY_STAGE/lib/libavformat.a"
  "$GEOMETRY_STAGE/lib/libavcodec.a"
  "$GEOMETRY_STAGE/lib/libavutil.a"
  "$GEOMETRY_STAGE/lib/libz.a"
  "\${COREGRAPHICS_FRAMEWORK}"
  "-framework CoreServices"
  "-framework Security"
  "-liconv"
  "-lbz2"
)
CMAKEEOF
fi

cmake -S "$WRAPPER_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
cmake --build "$BUILD_DIR" --target iina-hoshi-dicts --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cmake -E remove_directory "$BUILD_DIR/iina-hoshi-dicts.dSYM"
xcrun dsymutil "$BUILD_DIR/iina-hoshi-dicts" -o "$BUILD_DIR/iina-hoshi-dicts.dSYM"
cp "$BUILD_DIR/iina-hoshi-dicts" "$BIN_DIR/iina-hoshi-dicts"
strip -S -x "$BIN_DIR/iina-hoshi-dicts"
chmod 755 "$BIN_DIR/iina-hoshi-dicts"
"$BIN_DIR/iina-hoshi-dicts" version
if ! vtool -show-build "$BIN_DIR/iina-hoshi-dicts" |
  grep -Eq '^[[:space:]]+minos 11\.0$'; then
  echo "Native helper does not declare macOS 11.0 as its minimum OS." >&2
  vtool -show-build "$BIN_DIR/iina-hoshi-dicts" >&2
  exit 2
fi
if [[ "$WITH_ASS_GEOMETRY" == "1" ]]; then
  if ! "$BIN_DIR/iina-hoshi-dicts" version | grep -q '"available":true'; then
    echo "ASS geometry capability was not enabled in the finished helper." >&2
    exit 2
  fi
  if ! "$BIN_DIR/iina-hoshi-dicts" version | /usr/bin/python3 -c '
import json, sys
version = json.load(sys.stdin)
value = version.get("bitmapOcr", {})
required = {"pgs", "dvdsub", "dvbsub", "xsub"}
if value.get("protocol") != 1 or value.get("available") is not True:
    raise SystemExit(1)
if value.get("screenshotDiff") is not True or not required.issubset(value.get("decoders", [])):
    raise SystemExit(1)
mouse = version.get("mouseIntent", {})
if mouse.get("protocol") != 1 or mouse.get("source") != "coregraphics-counter":
    raise SystemExit(1)
controller = version.get("controller", {})
if controller.get("protocol") != 1 or controller.get("source") != "native-hid":
    raise SystemExit(1)
if "dualsense" not in controller.get("products", []):
    raise SystemExit(1)
'; then
    echo "Bitmap subtitle OCR, mouse-intent, or controller capability was not enabled in the finished helper." >&2
    exit 2
  fi
  non_system="$(otool -L "$BIN_DIR/iina-hoshi-dicts" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' || true)"
  if [[ -n "$non_system" ]]; then
    echo "Native helper has non-system dynamic dependencies:" >&2
    echo "$non_system" >&2
    exit 2
  fi
fi
