"""Helpers for frontend contract tests over multi-file sources.

Since Stage 4 the stylesheet is an ordered @import manifest (static/styles.css)
over static/css/*.css. `combined_css()` returns the full cascade as one string,
in manifest order, so existing comment-header slice assertions keep working.
"""
from __future__ import annotations

import re
from pathlib import Path

STATIC = Path(__file__).resolve().parent.parent / "static"
_IMPORT = re.compile(r'@import url\("([^"]+)"\);')


def combined_css() -> str:
    manifest = (STATIC / "styles.css").read_text(encoding="utf-8")
    paths = _IMPORT.findall(manifest)
    if not paths:  # not a manifest: the stylesheet itself
        return manifest
    return "\n".join((STATIC / p).read_text(encoding="utf-8") for p in paths)
