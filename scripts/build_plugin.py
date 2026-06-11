#!/usr/bin/env python3
from pathlib import Path
import argparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def js_raw_template_literal(value: str) -> str:
    # Keep String.raw safe: escape template delimiters/interpolation.
    return value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

def build_files() -> None:
    main_dir = ROOT / "src" / "main"
    native_dir = ROOT / "src" / "native"

    parts = []
    for path in sorted(main_dir.glob("[0-7][0-9]_*.js")):
        parts.append(path.read_text())

    build_script = (native_dir / "build_hoshi_backend.sh").read_text()
    cpp_source = (native_dir / "iina_hoshi.cpp").read_text()
    parts.append("const BUILD_SCRIPT = String.raw`" + js_raw_template_literal(build_script) + "`;\n\n")
    parts.append("const HOSHI_WRAPPER_CPP = String.raw`" + js_raw_template_literal(cpp_source) + "`;\n")
    parts.append((main_dir / "99_bootstrap.js").read_text())
    (ROOT / "main.js").write_text("\n".join(parts))

    overlay_dir = ROOT / "src" / "overlay"
    template = (overlay_dir / "overlay.template.html").read_text()
    html = template.replace("{{OVERLAY_CSS}}", (overlay_dir / "overlay.css").read_text())
    html = html.replace("{{OVERLAY_JS}}", (overlay_dir / "overlay.js").read_text())
    (ROOT / "overlay.html").write_text(html)

EXCLUDED_DIRS = {".git", ".github", "__pycache__", ".pytest_cache", "dist"}
EXCLUDED_FILES = {".DS_Store", ".gitignore"}
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
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        for path in ROOT.rglob("*"):
            if path.is_file() and should_package(path, output):
                z.write(path, path.relative_to(ROOT))

def main() -> None:
    parser = argparse.ArgumentParser(description="Build iinatan generated runtime files/package.")
    parser.add_argument("--package", type=Path, help="Optional .iinaplgz output path.")
    args = parser.parse_args()
    if args.package:
        package(args.package)
    else:
        build_files()

if __name__ == "__main__":
    main()
