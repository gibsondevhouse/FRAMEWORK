"""Helpers for frontend contract tests over the multi-file sources.

Since Stage 5 the frontend sources live in reader/frontend/ (built by Vite into
the committed reader/static/dist/). The stylesheet is an ordered @import
manifest (frontend/src/styles/styles.css); `combined_css()` returns the full
cascade in manifest order so comment-header slice assertions keep working, and
`app_js()` / `index_html()` read the source entry points.
"""
from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
_IMPORT = re.compile(r'@import url\("([^"]+)"\);')


def combined_css() -> str:
    manifest_path = FRONTEND / "src" / "styles" / "styles.css"
    manifest = manifest_path.read_text(encoding="utf-8")
    paths = _IMPORT.findall(manifest)
    if not paths:  # not a manifest: the stylesheet itself
        return manifest
    return "\n".join((manifest_path.parent / p).read_text(encoding="utf-8") for p in paths)


def app_js() -> str:
    return (FRONTEND / "src" / "app.js").read_text(encoding="utf-8")


def index_html() -> str:
    return (FRONTEND / "index.html").read_text(encoding="utf-8")
