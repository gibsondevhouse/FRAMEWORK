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


_SIDE_IMPORT = re.compile(r"^import '\./(.+?)';$", re.MULTILINE)


def _resolve(spec: str) -> Path:
    base = FRONTEND / "src" / spec
    for cand in (base, base.with_suffix(base.suffix + ".js"), base.with_suffix(base.suffix + ".ts")):
        if cand.is_file():
            return cand
    raise FileNotFoundError(spec)


def app_js() -> str:
    """The frontend source as one string: every module in main.js's side-effect
    import order (the original app.js source order), then any remaining src
    modules (sorted), then main.js itself, so slice-based contract assertions
    keep their relative positions."""
    main_path = FRONTEND / "src" / "main.js"
    main = main_path.read_text(encoding="utf-8")
    ordered = [_resolve(p) for p in _SIDE_IMPORT.findall(main)]
    seen = {main_path, *ordered}
    extras = sorted(p for p in (FRONTEND / "src").rglob("*")
                    if p.suffix in (".js", ".ts") and "styles" not in p.parts and p not in seen)
    parts = [p.read_text(encoding="utf-8") for p in ordered + extras]
    parts.append(main)
    return "\n".join(parts)


combined_js = app_js


def index_html() -> str:
    return (FRONTEND / "index.html").read_text(encoding="utf-8")
