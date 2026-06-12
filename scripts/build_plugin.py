#!/usr/bin/env python3
from pathlib import Path
import argparse
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_PLUGIN_FILES = [
    "Info.json",
    "main.js",
    "global.js",
    "overlay.html",
    "preferences.html",
    "README.md",
    "package.json",
]
OPTIONAL_PACKAGE_FILES = [
    "ARCHITECTURE.md",
    "SETTINGS_AUDIT.md",
]
REQUIRED_PACKAGE_FILES = REQUIRED_PLUGIN_FILES + [
    "bin/iina-hoshi-dicts",
]
PACKAGE_FILE_ALLOWLIST = REQUIRED_PACKAGE_FILES + OPTIONAL_PACKAGE_FILES
LANGUAGE_PARTS = [
    "common.js",
    "deinflection.js",
    "japanese.js",
    "english.js",
    "french_yomitan_rules.js",
    "french.js",
    "german.js",
    "chinese.js",
    "korean.js",
    "registry.js",
]

def js_raw_template_literal(value: str) -> str:
    # Keep String.raw safe: escape template delimiters/interpolation.
    return value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

def build_files() -> None:
    main_dir = ROOT / "src" / "main"
    parts = []
    first = main_dir / "00_context_state_paths.js"
    parts.append(first.read_text())

    language_dir = ROOT / "src" / "languages"
    for name in LANGUAGE_PARTS:
        parts.append((language_dir / name).read_text())

    for path in sorted(main_dir.glob("[1-7][0-9]_*.js")):
        parts.append(path.read_text())

    parts.append((main_dir / "99_bootstrap.js").read_text())
    (ROOT / "main.js").write_text("\n".join(parts))

    overlay_dir = ROOT / "src" / "overlay"
    template = (overlay_dir / "overlay.template.html").read_text()
    html = template.replace("{{OVERLAY_CSS}}", (overlay_dir / "overlay.css").read_text())
    html = html.replace("{{OVERLAY_JS}}", (overlay_dir / "overlay.js").read_text())
    (ROOT / "overlay.html").write_text(html)

EXCLUDED_DIRS = {".git", ".github", "__pycache__", ".pytest_cache", "dist", "vendor", "build"}
EXCLUDED_FILES = {".DS_Store", ".gitignore", ".gitmodules"}
EXCLUDED_SUFFIXES = {".pyc", ".iinaplgz"}

def should_package(path: Path, output: Path) -> bool:
    if path == output:
        return False
    rel = path.relative_to(ROOT)
    if any(part in EXCLUDED_DIRS for part in rel.parts):
        return False
    if path.name in EXCLUDED_FILES:
        return False
    if path.suffix in EXCLUDED_SUFFIXES:
        return False
    return True

def package(output: Path) -> None:
    build_files()
    validate_root_layout(require_backend=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        for rel_name in PACKAGE_FILE_ALLOWLIST:
            path = ROOT / rel_name
            if path.is_file() and should_package(path, output):
                z.write(path, rel_name)
    validate_package(output)

def validate_root_layout(require_backend: bool = False) -> None:
    missing = [name for name in REQUIRED_PLUGIN_FILES if not (ROOT / name).is_file()]
    if require_backend and not (ROOT / "bin" / "iina-hoshi-dicts").is_file():
        missing.append("bin/iina-hoshi-dicts")
    if missing:
        raise SystemExit("Missing required plugin files: " + ", ".join(missing))
    validate_hoshidicts_submodule()

    info = json.loads((ROOT / "Info.json").read_text())
    required_info = {
        "name": str,
        "identifier": str,
        "version": str,
        "entry": str,
        "globalEntry": str,
        "preferencesPage": str,
        "ghRepo": str,
        "ghVersion": int,
    }
    bad = []
    for key, typ in required_info.items():
        if key not in info or not isinstance(info[key], typ):
            bad.append(key)
    if bad:
        raise SystemExit("Info.json is missing or has invalid fields: " + ", ".join(bad))
    if info["entry"] != "main.js":
        raise SystemExit("Info.json entry must be main.js")
    if info["globalEntry"] != "global.js":
        raise SystemExit("Info.json globalEntry must be global.js")
    if info["preferencesPage"] != "preferences.html":
        raise SystemExit("Info.json preferencesPage must be preferences.html")
    if "/" not in info["ghRepo"]:
        raise SystemExit("Info.json ghRepo must be in owner/repo form")

def validate_hoshidicts_submodule() -> None:
    gitmodules = ROOT / ".gitmodules"
    if not gitmodules.is_file():
        raise SystemExit("Missing .gitmodules; vendor/hoshidicts must be tracked as a submodule")
    text = gitmodules.read_text()
    if "path = vendor/hoshidicts" not in text or "github.com/Manhhao/hoshidicts" not in text:
        raise SystemExit(".gitmodules must configure vendor/hoshidicts from Manhhao/hoshidicts")
    required = [
        "vendor/hoshidicts/CMakeLists.txt",
        "vendor/hoshidicts/LICENSE",
        "vendor/hoshidicts/include/hoshidicts/query.hpp",
        "vendor/hoshidicts/include/hoshidicts/lookup.hpp",
        "vendor/hoshidicts/src/query.cpp",
        "vendor/hoshidicts/src/importer.cpp",
    ]
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit(
            "HoshiDicts submodule is missing or uninitialized: "
            + ", ".join(missing)
            + ". Run: git submodule update --init --recursive"
        )

def validate_package(path: Path) -> None:
    if not path.is_file():
        raise SystemExit("Package does not exist: " + str(path))
    with zipfile.ZipFile(path, "r") as z:
        names = set(z.namelist())
        missing = [name for name in REQUIRED_PACKAGE_FILES if name not in names]
        if missing:
            raise SystemExit("Package is missing required files: " + ", ".join(missing))
        forbidden_prefixes = (".git/", ".github/", "build/", "dist/", "vendor/", "src/")
        forbidden = sorted(name for name in names if name.startswith(forbidden_prefixes))
        if forbidden:
            raise SystemExit("Package contains non-runtime files: " + ", ".join(forbidden[:8]))
        info = json.loads(z.read("Info.json").decode("utf-8"))
        for field in ("entry", "globalEntry", "preferencesPage"):
            if info.get(field) not in names:
                raise SystemExit("Package Info.json references missing " + field + ": " + str(info.get(field)))

def main() -> None:
    parser = argparse.ArgumentParser(description="Build iinatan generated runtime files/package.")
    parser.add_argument("--package", type=Path, help="Optional .iinaplgz output path.")
    parser.add_argument("--validate", action="store_true", help="Validate root plugin metadata/layout after building.")
    parser.add_argument("--require-backend", action="store_true", help="Require bin/iina-hoshi-dicts during --validate.")
    parser.add_argument("--validate-package", type=Path, help="Validate an existing .iinaplgz package.")
    args = parser.parse_args()
    if args.package:
        package(args.package)
    else:
        build_files()
    if args.validate:
        validate_root_layout(require_backend=args.require_backend)
    if args.validate_package:
        validate_package(args.validate_package)

if __name__ == "__main__":
    main()
