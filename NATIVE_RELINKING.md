# Native helper rebuilding and relinking

The corresponding-source archive is self-contained for the native helper. It
contains the iinatan native sources, HoshiDicts and its populated source
dependencies under `vendor/hoshidicts`, the private libass patch, verified
upstream dependency archives, and the scripts used for the release build.

On an Apple Silicon Mac with Xcode command-line tools and CMake installed:

```sh
tar -xzf iina-hoshi-dicts-native-source.tar.gz
cd iinatan-native-source
IINATAN_NATIVE_ARCHIVE_DIR="$PWD/upstream" \
  scripts/build_native_backend.sh --with-ass-geometry
```

The result is `bin/iina-hoshi-dicts`. The build enforces an arm64 macOS 11.0
deployment target, links only system Apple frameworks for CoreText and Vision,
verifies the ASS geometry and bitmap-subtitle OCR capabilities, and rejects
non-system dynamic library dependencies. The pinned static FFmpeg build enables
only the demuxers and decoders needed for ASS plus PGS, DVD/VobSub, DVB, and
XSUB subtitle handling. To relink modified application or LGPL
dependency sources, edit the included sources or replace a verified upstream
archive and update `native-dependencies.lock.json`, then rerun the same command.

The release build itself uses the unmodified archives listed in the lock,
except for libass 0.17.2, to which the included, hash-locked iinatan unit-ID
patch is applied.
