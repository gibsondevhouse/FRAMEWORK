"""Reader routers: title discovery, global search, the title-scoped routes and the
legacy un-prefixed Title 29 aliases.

Split into four routers so main.py can keep the original registration order:
`titles_router` first, `search_router` after the library router, `title_router`
after the news router (or /api/news/... would be captured as a title), and
`legacy_router` last.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse

from .. import agenda, config, constitution, fr_store, library, news_store, plaw, profiles, store, usc_store
from ..citations import graph
from . import deps

titles_router = APIRouter()
search_router = APIRouter()
title_router = APIRouter(prefix="/api/{title}")
legacy_router = APIRouter()


def _safe_int(val, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _parse_scope(raw: str | None) -> tuple[list[str] | None, int]:
    if not raw:
        return None, 0
    try:
        scope = json.loads(raw)
    except (ValueError, TypeError):
        return [], 0
    if not isinstance(scope, dict):
        return [], 0
    parts: list[str] = []
    for p in scope.get("parts") or []:
        sp = str(p)
        if sp and sp not in parts:
            parts.append(sp)
    sections = scope.get("sections") or []
    for p in sorted({str(s.get("part")) for s in sections if isinstance(s, dict) and s.get("part")}):
        if p not in parts:
            parts.append(p)
    return parts, len(sections)


@titles_router.get("/api/titles")
def list_titles() -> list[dict]:
    """List all installed CFR titles and their metadata."""
    installed = config.installed_titles()
    ai_on = config.anthropic_key() is not None
    results = []
    for t in installed:
        m, _unreadable = store.safe_meta(t)
        results.append({
            "title": t,
            "name": m.get("title_name") or f"Title {t}",
            "edition": m.get("edition"),
            "built_at": m.get("built_at"),
            "section_count": _safe_int(m.get("section_count"), 0),
            "partial": bool(m.get("scope")),
            "ai_configured": ai_on,
        })
    return results


@titles_router.get("/api/titles/snapshot")
def titles_snapshot(response: Response) -> dict:
    """Offline-safe living snapshot of installed titles for the Home screen."""
    response.headers["Cache-Control"] = "no-store"
    blurbs = library._BLURBS.get("titles", {})
    ai_on = config.anthropic_key() is not None
    rows = []
    for t in config.installed_titles():
        m, unreadable = store.safe_meta(t)
        scope_parts, scope_sections_count = _parse_scope(m.get("scope"))
        b = blurbs.get(str(t), {})
        rows.append({
            "title": t,
            "name": m.get("title_name") or profiles.TITLE_NAMES.get(t) or f"Title {t}",
            "edition": m.get("edition"),
            "built_at": m.get("built_at"),
            "section_count": _safe_int(m.get("section_count"), 0),
            "partial": scope_parts is not None,
            "unreadable": unreadable,
            "scope_parts": scope_parts,
            "scope_sections_count": scope_sections_count,
            "desk": b.get("desk", library.OTHER_DESK),
            "agencies": list(b.get("agencies", [])),
            "summary": b.get("summary", ""),
            "news": news_store.summary_for_title(t),
        })
    return {"ai_configured": ai_on, "titles": rows}


@titles_router.get("/api/profiles")
def list_profiles() -> dict:
    """First-run profiles (curated titles and parts) and the names of all 50 CFR titles."""
    return {"profiles": profiles.PROFILES, "title_names": profiles.TITLE_NAMES}


_INCLUDE = "fr|usc|constitution|plaw|agenda"


@search_router.get("/api/search")
async def search_global(
    q: str = Query(..., max_length=200),
    title: str | None = None,
    part: str | None = Query(None, max_length=40),
    limit: int = Query(30, ge=1, le=100),
    include: str | None = Query(None, pattern=f"^({_INCLUDE})(,({_INCLUDE}))*$"),
) -> dict:
    """Search within a specific title, or across all installed titles if title='all' or omitted.
    `include` is a comma-separated list of `fr`, `usc`, `constitution`, `plaw` and `agenda`;
    each adds that corpus as its own block ({installed, total, results}), leaving the CFR
    result shape untouched."""
    target_title: int | str = title if title else config.DEFAULT_TITLE
    if target_title != "all":
        if not str(target_title).isdigit() or int(target_title) not in config.installed_titles():
            raise HTTPException(404, f"CFR Title {target_title} is not installed on this server.")
        target_title = int(target_title)
    res = await asyncio.to_thread(store.search, q, part=part, limit=limit, title=target_title)
    extra = set((include or "").split(",")) - {""}
    if "fr" in extra:
        res["fr"] = await asyncio.to_thread(_search_fr, q, min(limit, 20))
    if "usc" in extra:
        res["usc"] = await asyncio.to_thread(usc_store.search, q, None, min(limit, 20))
    if "constitution" in extra:
        res["constitution"] = await asyncio.to_thread(constitution.search, q, min(limit, 20))
    if "plaw" in extra:
        res["plaw"] = await asyncio.to_thread(plaw.search, q, min(limit, 20))
    if "agenda" in extra:
        res["agenda"] = await asyncio.to_thread(agenda.search, q, min(limit, 20))
    return res


def _search_fr(q: str, limit: int) -> dict:
    with fr_store.read_con() as con:
        if con is None:
            return {"installed": False, "total": 0, "results": []}
        return {"installed": True, **fr_store.search(con, q, limit=limit)}


@title_router.get("/meta")
def get_title_meta(title: int = Depends(deps.valid_installed_title)) -> dict:
    m, unreadable = store.safe_meta(title)
    if unreadable:
        raise HTTPException(503, f"Title {title} database is temporarily unavailable.")
    return {
        "title": title,
        "name": m.get("title_name") or f"Title {title}",
        "edition": m.get("edition"),
        "built_at": m.get("built_at"),
        "section_count": _safe_int(m.get("section_count"), 0),
        "ai_configured": config.anthropic_key() is not None,
    }


@title_router.get("/tree")
def get_title_tree(title: int = Depends(deps.valid_installed_title)) -> FileResponse:
    path = config.tree_path(title)
    if not path.exists():
        raise HTTPException(404, f"Tree not found for Title {title}")
    return FileResponse(path, media_type="application/json")


@title_router.get("/section/{section_id:path}")
def get_title_section(
    section_id: str,
    title: int = Depends(deps.valid_installed_title),
    unit: str | None = None,
) -> dict:
    """`?unit=KEY` (or `?unit=` for the first) returns just that unit of a long section."""
    try:
        sec = store.get_section(section_id, title=title, unit=unit)
    except FileNotFoundError:
        raise HTTPException(404, f"CFR Title {title} is not installed on this server.")
    except sqlite3.Error:
        raise HTTPException(503, f"Title {title} database is temporarily unavailable.")
    if not sec:
        raise HTTPException(404, f"No section {section_id!r} in Title {title}")
    return sec


@title_router.get("/part/{part}")
def get_title_part(part: str, title: int = Depends(deps.valid_installed_title)) -> dict:
    try:
        return store.get_part_front_matter(part, title=title)
    except FileNotFoundError:
        raise HTTPException(404, f"CFR Title {title} is not installed on this server.")
    except sqlite3.Error:
        raise HTTPException(503, f"Title {title} database is temporarily unavailable.")


@title_router.get("/part/{part}/full")
def get_title_part_full(part: str, title: int = Depends(deps.valid_installed_title)) -> dict:
    try:
        sections = store.part_full(part, title=title)
    except FileNotFoundError:
        raise HTTPException(404, f"CFR Title {title} is not installed on this server.")
    except sqlite3.Error:
        raise HTTPException(503, f"Title {title} database is temporarily unavailable.")
    if not sections:
        raise HTTPException(404, f"No sections in Part {part} of Title {title}")
    return {"title": title, "part": part, "sections": sections}


@title_router.get("/search")
async def search_title(
    q: str = Query(..., max_length=200),
    part: str | None = Query(None, max_length=40),
    limit: int = Query(30, ge=1, le=100),
    title: int = Depends(deps.valid_installed_title),
) -> dict:
    return await asyncio.to_thread(store.search, q, part=part, limit=limit, title=title)


@title_router.get("/references")
async def get_title_references(title: int = Depends(deps.valid_installed_title)) -> dict:
    return await asyncio.to_thread(graph.get_references, title)


@title_router.get("/citations/{section_id:path}")
async def get_section_citations(
    section_id: str,
    title: int = Depends(deps.valid_installed_title),
) -> dict:
    res = await asyncio.to_thread(graph.get_section_graph, title, section_id)
    if not res:
        raise HTTPException(404, f"No section {section_id!r} in Title {title}")
    return res


# --- Legacy un-prefixed aliases for Title 29 (backward compatibility) ---

def _default_title() -> int:
    """Title 29, if installed; 404 like the prefixed routes otherwise."""
    return deps.valid_installed_title(config.DEFAULT_TITLE)


@legacy_router.get("/api/meta")
def get_meta() -> dict:
    return get_title_meta(title=_default_title())


@legacy_router.get("/api/tree")
def get_tree() -> FileResponse:
    return get_title_tree(title=_default_title())


@legacy_router.get("/api/section/{section_id:path}")
def get_section(section_id: str, unit: str | None = None) -> dict:
    return get_title_section(section_id, title=_default_title(), unit=unit)


@legacy_router.get("/api/part/{part}")
def get_part(part: str) -> dict:
    return get_title_part(part, title=_default_title())


@legacy_router.get("/api/part/{part}/full")
def get_part_full(part: str) -> dict:
    return get_title_part_full(part, title=_default_title())
