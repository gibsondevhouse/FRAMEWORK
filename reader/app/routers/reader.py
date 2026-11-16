"""Reader routers: title discovery, global search, the title-scoped routes and the
legacy un-prefixed Title 29 aliases.

Split into four routers so main.py can keep the original registration order:
`titles_router` first, `search_router` after the library router, `title_router`
after the news router (or /api/news/... would be captured as a title), and
`legacy_router` last.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .. import config, store
from . import deps

titles_router = APIRouter()
search_router = APIRouter()
title_router = APIRouter(prefix="/api/{title}")
legacy_router = APIRouter()


@titles_router.get("/api/titles")
def list_titles() -> list[dict]:
    """List all installed CFR titles and their metadata."""
    installed = config.installed_titles()
    results = []
    for t in installed:
        m = store.meta(t)
        results.append({
            "title": t,
            "name": m.get("title_name") or f"Title {t}",
            "edition": m.get("edition"),
            "built_at": m.get("built_at"),
            "section_count": int(m.get("section_count", 0)),
            "partial": bool(m.get("scope")),
            "ai_configured": config.anthropic_key() is not None,
        })
    return results


@search_router.get("/api/search")
async def search_global(
    q: str,
    title: str | None = None,
    part: str | None = None,
    limit: int = 30,
) -> dict:
    """Search within a specific title, or across all installed titles if title='all' or omitted."""
    target_title = title if title else config.DEFAULT_TITLE
    return await asyncio.to_thread(store.search, q, part=part, limit=limit, title=target_title)


@title_router.get("/meta")
def get_title_meta(title: int = Depends(deps.valid_installed_title)) -> dict:
    m = store.meta(title)
    return {
        "title": title,
        "name": m.get("title_name") or f"Title {title}",
        "edition": m.get("edition"),
        "built_at": m.get("built_at"),
        "section_count": int(m.get("section_count", 0)),
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
    sec = store.get_section(section_id, title=title, unit=unit)
    if not sec:
        raise HTTPException(404, f"No section {section_id!r} in Title {title}")
    return sec


@title_router.get("/part/{part}")
def get_title_part(part: str, title: int = Depends(deps.valid_installed_title)) -> dict:
    return store.get_part_front_matter(part, title=title)


@title_router.get("/part/{part}/full")
def get_title_part_full(part: str, title: int = Depends(deps.valid_installed_title)) -> dict:
    sections = store.part_full(part, title=title)
    if not sections:
        raise HTTPException(404, f"No sections in Part {part} of Title {title}")
    return {"title": title, "part": part, "sections": sections}


@title_router.get("/search")
async def search_title(
    q: str,
    part: str | None = None,
    limit: int = 30,
    title: int = Depends(deps.valid_installed_title),
) -> dict:
    return await asyncio.to_thread(store.search, q, part=part, limit=limit, title=title)


# --- Legacy un-prefixed aliases for Title 29 (backward compatibility) ---

@legacy_router.get("/api/meta")
def get_meta() -> dict:
    return get_title_meta(title=config.DEFAULT_TITLE)


@legacy_router.get("/api/tree")
def get_tree() -> FileResponse:
    return get_title_tree(title=config.DEFAULT_TITLE)


@legacy_router.get("/api/section/{section_id:path}")
def get_section(section_id: str, unit: str | None = None) -> dict:
    return get_title_section(section_id, title=config.DEFAULT_TITLE, unit=unit)


@legacy_router.get("/api/part/{part}")
def get_part(part: str) -> dict:
    return get_title_part(part, title=config.DEFAULT_TITLE)


@legacy_router.get("/api/part/{part}/full")
def get_part_full(part: str) -> dict:
    return get_title_part_full(part, title=config.DEFAULT_TITLE)
