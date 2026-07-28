# Third-party notices

iinatan ships a single macOS arm64 native helper. The helper includes
statically linked open-source components in addition to HoshiDicts. Exact
versions, archive URLs, checksums, and the arm64 deployment target are recorded
in `native-dependencies.lock.json`.

| Component | Version | License |
| --- | ---: | --- |
| FFmpeg libraries | 7.0.1 | LGPL-2.1-or-later |
| libass | 0.17.2 | ISC |
| HarfBuzz | 8.5.0 | MIT |
| FreeType | 2.13.2 | FreeType License or GPL-2.0-or-later |
| FriBidi | 1.0.13 | LGPL-2.1-or-later |
| libunibreak | 6.1 | Zlib |
| zlib | 1.3.1 | Zlib |
| HoshiDicts | pinned Git submodule revision | GPL-3.0-only |
| glaze | HoshiDicts pinned source | MIT |
| kanji-processor | HoshiDicts pinned source | See bundled license |
| libdeflate | HoshiDicts pinned source | MIT |
| unordered_dense | HoshiDicts pinned source | MIT |
| utf8proc | HoshiDicts pinned source | MIT |
| utfcpp | HoshiDicts pinned source | BSL-1.0 |
| xxHash | HoshiDicts pinned source | BSD-2-Clause |
| zstd | HoshiDicts pinned source | BSD-3-Clause |

The helper uses FFmpeg only for local file demuxing and libass only for
subtitle rendering. The pinned libass source is modified by
`patches/libass-0.17.2-iinatan-unit-ids.patch`, whose checksum is recorded in
the dependency lock. It does not use IINA's private dynamic libraries.

The project license remains GPL-3.0-only. The full corresponding native source
bundle, including the exact verified upstream archives and the relink/build
scripts, is produced as `dist/iina-hoshi-dicts-native-source.tar.gz` by
`scripts/package_native_source.sh`. Upstream license files are preserved inside
those unmodified source archives. The same source bundle must be published
beside every release that contains the static helper.

The installable plugin package includes the complete applicable license texts
under `THIRD_PARTY_LICENSES/`.

No warranty is provided by the upstream authors or by iinatan. See each
component's license file in the corresponding-source bundle for the complete
terms.
