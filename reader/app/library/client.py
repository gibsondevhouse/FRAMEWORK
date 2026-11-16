"""Upstream eCFR API client and catalog caches."""
from __future__ import annotations

import threading
import time

import httpx

from .. import build
from .. import config  # noqa: F401  (kept for parity with the old module surface)
from .. import library as lib

CATALOG_TTL = 30 * 60  # seconds; eCFR's title list changes at most daily

_cache_lock = threading.Lock()
_catalog: tuple[float, list[dict]] | None = None
_structures: dict[tuple[int, str], dict] = {}

def _client() -> httpx.Client:
    return httpx.Client(headers=build.HEADERS, timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True)


def ecfr_titles(refresh: bool = False) -> list[dict]:
    """eCFR's list of all 50 titles (number, name, up_to_date_as_of, reserved), cached."""
    global _catalog
    with _cache_lock:
        if _catalog and not refresh and time.time() - _catalog[0] < CATALOG_TTL:
            return _catalog[1]
    with _client() as c:
        titles = build.fetch_json(c, f"{config.ECFR_API}/titles.json").get("titles", [])
    with _cache_lock:
        _catalog = (time.time(), titles)
    return titles


def catalog_checked_at() -> float | None:
    """When eCFR's title list was last fetched (epoch seconds), or None if never."""
    with _cache_lock:
        return _catalog[0] if _catalog else None


def ecfr_title(title: int) -> dict:
    info = next((t for t in lib.ecfr_titles() if t["number"] == title), None)
    if not info:
        raise LookupError(f"Title {title} is not on eCFR")
    return info


def structure(title: int) -> dict:
    """The latest edition's contents tree for a title, trimmed and nested like tree.json."""
    edition = lib.ecfr_title(title)["up_to_date_as_of"]
    key = (title, edition)
    with _cache_lock:
        if key in _structures:
            return _structures[key]
    with _client() as c:
        raw = build.fetch_json(c, f"{config.ECFR_API}/structure/{edition}/title-{title}.json")
    tree = build.nest_loose_sections(build.trim_tree(raw))
    with _cache_lock:
        # Keep a handful; a structure is a few MB for the largest titles.
        if len(_structures) >= 8:
            _structures.pop(next(iter(_structures)))
        _structures[key] = tree
    return tree


def catalog() -> list[dict]:
    """Every eCFR title with its editorial summary and desk, recency and install state."""
    blurbs = lib._BLURBS.get("titles", {})
    rows = []
    for t in sorted(lib.ecfr_titles(), key=lambda t: t["number"]):
        n = t["number"]
        inst = lib.installed(n)
        b = blurbs.get(str(n), {})
        rows.append({
            "title": n,
            "name": t.get("name") or f"Title {n}",
            "latest": t.get("up_to_date_as_of"),
            "amended": t.get("latest_amended_on"),  # when the title's text last changed
            "reserved": bool(t.get("reserved")),
            "summary": b.get("summary", ""),
            "desk": b.get("desk", lib.OTHER_DESK),
            "featured": bool(b.get("featured")),
            "agencies": list(b.get("agencies", [])),
            "size_mb": b.get("size_mb"),    # estimate: eCFR's full-text size of the title
            "sections": b.get("sections"),  # estimate: sections and appendices with text
            "installed": lib._install_summary(inst, n),
        })
    return rows
