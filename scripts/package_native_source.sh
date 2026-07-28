#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="$ROOT/native-dependencies.lock.json"
DOWNLOADS="$ROOT/build/native-geometry-deps/downloads"
OUTPUT="${1:-$ROOT/dist/iina-hoshi-dicts-native-source.tar.gz}"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

mkdir -p \
  "$STAGING/iinatan-native-source/upstream" \
  "$STAGING/iinatan-native-source/vendor" \
  "$STAGING/iinatan-native-source/scripts" \
  "$STAGING/iinatan-native-source/src" \
  "$(dirname "$OUTPUT")"
cp -R \
  "$ROOT/native-dependencies.lock.json" \
  "$ROOT/THIRD_PARTY_NOTICES.md" \
  "$ROOT/NATIVE_RELINKING.md" \
  "$ROOT/patches" \
  "$STAGING/iinatan-native-source/"
cp -R "$ROOT/src/native" "$STAGING/iinatan-native-source/src/"
cp \
  "$ROOT/scripts/build_native_backend.sh" \
  "$ROOT/scripts/build_native_geometry_dependencies.sh" \
  "$STAGING/iinatan-native-source/scripts/"
cp -R "$ROOT/vendor/hoshidicts" \
  "$STAGING/iinatan-native-source/vendor/hoshidicts"
find "$STAGING/iinatan-native-source/vendor/hoshidicts" \
  -name .git -o -name .build |
  while IFS= read -r path; do rm -rf "$path"; done

python3 - "$LOCK" "$DOWNLOADS" "$STAGING/iinatan-native-source/upstream" <<'PY'
import hashlib
import json
import pathlib
import shutil
import sys
import urllib.request

lock = json.loads(pathlib.Path(sys.argv[1]).read_text())
downloads = pathlib.Path(sys.argv[2])
output = pathlib.Path(sys.argv[3])
downloads.mkdir(parents=True, exist_ok=True)
for dependency in lock["dependencies"]:
    url = dependency["url"]
    source = downloads / url.rsplit("/", 1)[-1]
    if not source.is_file():
        with urllib.request.urlopen(url) as response, source.open("wb") as target:
            shutil.copyfileobj(response, target)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != dependency["sha256"]:
        raise SystemExit(
            f"SHA-256 mismatch for {dependency['name']}: "
            f"expected {dependency['sha256']}, got {digest}"
        )
    shutil.copy2(source, output / source.name)
PY

COPYFILE_DISABLE=1 tar \
  --exclude='.DS_Store' \
  --exclude='._*' \
  -czf "$OUTPUT" \
  -C "$STAGING" \
  iinatan-native-source
echo "Wrote $OUTPUT"
