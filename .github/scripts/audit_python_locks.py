#!/usr/bin/env python3
"""Audit every pin in the hashed Python lock files for known vulnerabilities.

    python .github/scripts/audit_python_locks.py reader/requirements.txt reader/requirements-dev.txt

The locks are universal: one file serves every platform and Python version, so some lines
carry an environment marker (`; sys_platform == 'win32'`) and a package can appear twice at
different versions (`; python_full_version < '3.11'`). `pip-audit` on its own audits only the
lines that apply to the machine it runs on, and refuses a file that names a package twice.

So each lock is rewritten into one or more marker-free files in which every package appears
once (the first pin of each package, then the second pins, and so on), and `pip-audit` runs on
each. Every pinned line is audited exactly once, whatever platform it is for. Nothing is
installed: `--disable-pip --require-hashes` reads the pins and their hashes as written.

Exits non-zero when any pin has a known vulnerability (or the audit could not run).
Needs `pip-audit` (install it from reader/requirements-audit.txt).
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

PIN = re.compile(r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==(?P<version>[^\s;\\]+)")
MARKER = re.compile(r"\s*;[^\\]*")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement_blocks(text: str) -> list[list[str]]:
    """A lock as blocks: each block is one pin line followed by its `--hash` lines."""
    blocks: list[list[str]] = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if PIN.match(line):
            blocks.append([line])
        elif blocks and line.startswith((" ", "\t")):
            blocks[-1].append(line)
        else:
            raise ValueError(f"not a pinned requirement: {line!r}")
    return blocks


def audit_groups(text: str) -> list[str]:
    """The lock as marker-free requirement files, each naming a package at most once."""
    groups: list[dict[str, list[str]]] = []
    for block in requirement_blocks(text):
        name = normalize(PIN.match(block[0]).group("name"))
        head = MARKER.sub(" ", block[0], count=1) if ";" in block[0] else block[0]
        for group in groups:
            if name not in group:
                break
        else:
            group = {}
            groups.append(group)
        group[name] = [head.rstrip() if len(block) == 1 else head, *block[1:]]
    return ["\n".join(line for block in group.values() for line in block) + "\n" for group in groups]


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print("usage: audit_python_locks.py LOCK [LOCK ...]", file=sys.stderr)
        return 2
    failed = False
    with tempfile.TemporaryDirectory() as tmp:
        for lock in argv:
            groups = audit_groups(Path(lock).read_text(encoding="utf-8"))
            pins = sum(len(requirement_blocks(g)) for g in groups)
            print(f"== {lock}: {pins} pins in {len(groups)} pass(es)", flush=True)
            for i, group in enumerate(groups, 1):
                path = Path(tmp) / f"{Path(lock).stem}-{i}.txt"
                path.write_text(group, encoding="utf-8")
                result = subprocess.run(
                    [sys.executable, "-m", "pip_audit", "--require-hashes", "--disable-pip",
                     "--progress-spinner", "off", "-r", str(path)])
                failed = failed or result.returncode != 0
    if failed:
        print("A pinned dependency has a known vulnerability (or the audit could not run). "
              "Raise the range in the matching .in file if needed, recompile the lock, and commit.", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
