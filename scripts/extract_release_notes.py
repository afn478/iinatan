#!/usr/bin/env python3
from pathlib import Path
import argparse
import re
import sys
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]


def normalize_version(release_tag: str) -> str:
    version = release_tag.strip()
    if version.startswith("refs/tags/"):
        version = version.rsplit("/", 1)[1]
    if version.startswith("v"):
        version = version[1:]
    return version


def heading_version(line: str) -> Optional[str]:
    match = re.match(r"^##\s+\[?v?([^\]\s]+)\]?(?:\s|$)", line)
    if not match:
        return None
    return match.group(1)


def extract_release_notes(changelog_text: str, release_tag: str) -> str:
    version = normalize_version(release_tag)
    lines = changelog_text.splitlines()

    start = None
    for index, line in enumerate(lines):
        if heading_version(line) == version:
            start = index + 1
            break

    if start is None:
        raise ValueError(
            f"No CHANGELOG.md section found for release tag {release_tag!r} "
            f"(looked for version {version!r})."
        )

    end = len(lines)
    for index in range(start, len(lines)):
        if lines[index].startswith("## "):
            end = index
            break

    notes = "\n".join(lines[start:end]).strip()
    if not notes:
        raise ValueError(f"CHANGELOG.md section for release tag {release_tag!r} is empty.")
    return notes + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract release notes from CHANGELOG.md.")
    parser.add_argument("release_tag", help="Release tag, such as v1.9.0.")
    parser.add_argument(
        "--changelog",
        type=Path,
        default=ROOT / "CHANGELOG.md",
        help="Path to the changelog file.",
    )
    args = parser.parse_args()

    try:
        notes = extract_release_notes(args.changelog.read_text(), args.release_tag)
    except OSError as error:
        print(f"Failed to read changelog: {error}", file=sys.stderr)
        return 1
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1

    sys.stdout.write(notes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
