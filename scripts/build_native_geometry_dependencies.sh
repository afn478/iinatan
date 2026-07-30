#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="$ROOT/native-dependencies.lock.json"
WORK="$ROOT/build/native-geometry-deps"
DOWNLOADS="${IINATAN_NATIVE_ARCHIVE_DIR:-$WORK/downloads}"
SOURCES="$WORK/sources"
STAGE="$WORK/stage"
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "The pinned ASS geometry stack currently supports macOS arm64 only." >&2
  exit 2
fi
if [[ ! -f "$LOCK" ]]; then
  echo "Missing dependency lock: $LOCK" >&2
  exit 2
fi

mkdir -p "$DOWNLOADS" "$SOURCES" "$STAGE"
LOCK_SHA="$(shasum -a 256 "$LOCK" | awk '{print $1}')"
if [[ "${IINATAN_REBUILD_NATIVE_DEPS:-0}" != "1" ]] &&
  [[ -f "$STAGE/.dependency-lock-sha256" ]] &&
  [[ "$(cat "$STAGE/.dependency-lock-sha256")" == "$LOCK_SHA" ]] &&
  [[ -f "$STAGE/lib/libass.a" && -f "$STAGE/lib/libavformat.a" ]]; then
  echo "Pinned native ASS geometry dependencies are current at $STAGE"
  exit 0
fi
export MACOSX_DEPLOYMENT_TARGET=11.0
export CC="${CC:-clang}"
export CXX="${CXX:-clang++}"
export CFLAGS="-O2 -fvisibility=hidden ${CFLAGS:-}"
export CXXFLAGS="-O2 -fvisibility=hidden ${CXXFLAGS:-}"
export LDFLAGS="-Wl,-dead_strip ${LDFLAGS:-}"

lock_field() {
  python3 - "$LOCK" "$1" "$2" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
item = next(value for value in lock["dependencies"] if value["name"] == sys.argv[2])
print(item[sys.argv[3]])
PY
}

fetch() {
  local name="$1"
  local url sha archive partial actual
  url="$(python3 - "$LOCK" "$name" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
print(next(value for value in lock["dependencies"] if value["name"] == sys.argv[2])["url"])
PY
)"
  sha="$(python3 - "$LOCK" "$name" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
print(next(value for value in lock["dependencies"] if value["name"] == sys.argv[2])["sha256"])
PY
)"
  archive="$DOWNLOADS/${url##*/}"
  if [[ ! -f "$archive" ]]; then
    partial="$archive.part"
    rm -f "$partial"
    curl \
      --fail \
      --location \
      --proto '=https' \
      --tlsv1.2 \
      --retry 5 \
      --retry-delay 2 \
      --retry-max-time 120 \
      --connect-timeout 30 \
      "$url" \
      -o "$partial"
    mv "$partial" "$archive"
  fi
  actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
  if [[ "$actual" != "$sha" ]]; then
    echo "SHA-256 mismatch for $name: expected $sha, got $actual" >&2
    exit 2
  fi
  rm -rf "$SOURCES/$name"
  mkdir -p "$SOURCES/$name"
  tar -xf "$archive" -C "$SOURCES/$name" --strip-components=1
}

for dependency in pkgconf zlib FreeType FriBidi HarfBuzz libunibreak libass FFmpeg; do
  fetch "$dependency"
done

LIBASS_PATCH="$ROOT/patches/libass-0.17.2-iinatan-unit-ids.patch"
LIBASS_PATCH_SHA="$(python3 - "$LOCK" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
print(next(value for value in lock["patches"]
           if value["name"] == "libass-0.17.2-iinatan-unit-ids-v2")["sha256"])
PY
)"
if [[ ! -f "$LIBASS_PATCH" ]]; then
  echo "Missing pinned libass patch: $LIBASS_PATCH" >&2
  exit 2
fi
ACTUAL_LIBASS_PATCH_SHA="$(shasum -a 256 "$LIBASS_PATCH" | awk '{print $1}')"
if [[ "$ACTUAL_LIBASS_PATCH_SHA" != "$LIBASS_PATCH_SHA" ]]; then
  echo "SHA-256 mismatch for pinned libass patch: expected $LIBASS_PATCH_SHA, got $ACTUAL_LIBASS_PATCH_SHA" >&2
  exit 2
fi
patch -d "$SOURCES/libass" -p1 < "$LIBASS_PATCH"

rm -rf "$STAGE"
mkdir -p "$STAGE"

(
  cd "$SOURCES/pkgconf"
  ./configure --prefix="$WORK/tools" --disable-shared --enable-static
  make -j "$JOBS"
  make install
)
export PATH="$WORK/tools/bin:$PATH"
export PKG_CONFIG="$WORK/tools/bin/pkgconf"

cmake -S "$SOURCES/zlib" -B "$WORK/build-zlib" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$STAGE" \
  -DBUILD_SHARED_LIBS=OFF \
  -DZLIB_BUILD_EXAMPLES=OFF
cmake --build "$WORK/build-zlib" --config Release -j "$JOBS"
cmake --install "$WORK/build-zlib" --config Release
rm -f "$STAGE/lib/libz.dylib" "$STAGE/lib/libz."*.dylib

cmake -S "$SOURCES/FreeType" -B "$WORK/build-freetype" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$STAGE" \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_BZIP2=TRUE \
  -DFT_DISABLE_BROTLI=TRUE \
  -DFT_DISABLE_HARFBUZZ=TRUE \
  -DFT_DISABLE_PNG=TRUE \
  -DFT_DISABLE_ZLIB=FALSE \
  -DZLIB_ROOT="$STAGE"
cmake --build "$WORK/build-freetype" --config Release -j "$JOBS"
cmake --install "$WORK/build-freetype" --config Release

(
  cd "$SOURCES/FriBidi"
  ./configure \
    --prefix="$STAGE" \
    --disable-shared \
    --enable-static \
    --disable-deprecated \
    --disable-docs \
    --disable-debug
  make -j "$JOBS"
  make install
)

cmake -S "$SOURCES/HarfBuzz" -B "$WORK/build-harfbuzz" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$STAGE" \
  -DBUILD_SHARED_LIBS=OFF \
  -DHB_BUILD_UTILS=OFF \
  -DHB_BUILD_SUBSET=OFF \
  -DHB_BUILD_TESTS=OFF \
  -DHB_HAVE_FREETYPE=ON \
  -DFREETYPE_INCLUDE_DIRS="$STAGE/include/freetype2" \
  -DFREETYPE_LIBRARY="$STAGE/lib/libfreetype.a"
cmake --build "$WORK/build-harfbuzz" --config Release -j "$JOBS"
cmake --install "$WORK/build-harfbuzz" --config Release

(
  cd "$SOURCES/libunibreak"
  ./configure \
    --prefix="$STAGE" \
    --disable-shared \
    --enable-static
  make -j "$JOBS"
  make install
)

export PKG_CONFIG_PATH="$STAGE/lib/pkgconfig:$STAGE/share/pkgconfig"
export CPPFLAGS="-I$STAGE/include -I$STAGE/include/freetype2"
export LDFLAGS="-L$STAGE/lib -Wl,-dead_strip"
(
  cd "$SOURCES/libass"
  ./configure \
    --prefix="$STAGE" \
    --disable-shared \
    --enable-static \
    --disable-test \
    --disable-profile \
    --disable-fontconfig \
    --enable-coretext \
    --disable-directwrite \
    --enable-libunibreak \
    --disable-asm
  make -j "$JOBS"
  make install
)

(
  cd "$SOURCES/FFmpeg"
  ./configure \
    --prefix="$STAGE" \
    --cc="$CC" \
    --arch=arm64 \
    --target-os=darwin \
    --disable-shared \
    --enable-static \
    --disable-programs \
    --disable-doc \
    --disable-autodetect \
    --disable-everything \
    --enable-avutil \
    --enable-avcodec \
    --enable-avformat \
    --enable-protocol=file,http,https,tcp,tls \
    --enable-securetransport \
    --enable-demuxer=matroska,ass \
    --enable-zlib \
    --extra-cflags="-I$STAGE/include" \
    --extra-ldflags="-L$STAGE/lib" \
    --extra-libs="-lz"
  make -j "$JOBS"
  make install
)

for archive in \
  "$STAGE/lib/libass.a" \
  "$STAGE/lib/libavformat.a" \
  "$STAGE/lib/libavcodec.a" \
  "$STAGE/lib/libavutil.a" \
  "$STAGE/lib/libharfbuzz.a" \
  "$STAGE/lib/libfreetype.a" \
  "$STAGE/lib/libfribidi.a" \
  "$STAGE/lib/libunibreak.a" \
  "$STAGE/lib/libz.a"; do
  if [[ ! -f "$archive" ]]; then
    echo "Pinned dependency build did not produce $archive" >&2
    exit 2
  fi
done

echo "$LOCK_SHA" > "$STAGE/.dependency-lock-sha256"
echo "Pinned native ASS geometry dependencies built at $STAGE"
