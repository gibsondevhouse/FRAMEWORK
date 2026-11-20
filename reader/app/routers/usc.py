"""The /api/usc router (installed U.S. Code titles) and the standalone `/usc/{t}/{s}` page.

Registered in main.py BEFORE the /api/{title} routers (like news and fr), or `/api/usc/...`
would be captured as a (non-integer) CFR title and 422.

Reads are local. Two endpoints reach the OLRC: `GET /api/usc/release` (the current
release point, cached 30 min) and the queued installs/updates. `/usc/{t}/{s}` is the
href of U.S.C. citation links once a title is installed: a self-contained fallback page
(inside the app, peek.ts opens the SPA reader at `#/usc/{t}/section/{s}` instead).
"""
from __future__ import annotations

from html import escape

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from .. import library, usc_build, usc_citations, usc_client, usc_store
from ..render import uslm_html
from ..render.units import UNIT_MODE_MIN_CHARS

_SEC = r"^[0-9A-Za-z.~\-–]{1,40}$"


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


usc_router = APIRouter(prefix="/api/usc", dependencies=[Depends(_no_store)])
usc_page_router = APIRouter()


def installed_usc_title(title: int = Path(..., ge=1, le=54)) -> int:
    if title not in usc_store.installed_titles():
        raise HTTPException(404, f"U.S. Code Title {title} is not installed on this server.")
    return title


@usc_router.get("/titles")
def list_titles() -> dict:
    """Installed titles (local only; no network)."""
    rows = [s for s in (usc_store.title_summary(t) for t in usc_store.installed_titles()) if s]
    return {"titles": rows}


@usc_router.get("/catalog")
def title_catalog() -> dict:
    """All 54 titles for the Library: static facts, install state, bytes, staleness against
    the release point this server last saw. Local only."""
    return usc_build.catalog()


@usc_router.get("/release")
def current_release(refresh: bool = False) -> dict:
    """The OLRC's current release point and which installed titles are behind it."""
    try:
        release = usc_client.current_release(force=refresh)
    except usc_client.SourceUnavailable as exc:
        raise HTTPException(503, f"The OLRC didn't answer: {exc}")
    st = usc_build.status(release)
    return {"release_point": release["release_point"], "current_through": release.get("current_through"),
            "available_titles": sorted(int(k) for k in release.get("titles", {})),
            "titles": st["titles"]}


@usc_router.get("/search")
def search(q: str = Query(..., max_length=200), title: int | None = Query(None, ge=1, le=54),
           limit: int = Query(20, ge=1, le=100), notes: bool = False) -> dict:
    if title is not None and title not in usc_store.installed_titles():
        raise HTTPException(404, f"U.S. Code Title {title} is not installed on this server.")
    if notes and title is not None:
        total, results = usc_store.search_title(title, q, limit=limit, include_notes=True)
        return {"installed": True, "total": total, "results": results}
    return usc_store.search(q, title=title, limit=limit)


@usc_router.get("/{title}/meta")
def title_meta(title: int = Depends(installed_usc_title)) -> dict:
    return usc_store.title_summary(title) or {}


@usc_router.get("/{title}/tree")
def title_tree(title: int = Depends(installed_usc_title)) -> FileResponse:
    p = usc_store.tree_path(title)
    if not p.exists():
        raise HTTPException(404, f"U.S. Code Title {title} has no contents tree.")
    return FileResponse(p, media_type="application/json", headers={"Cache-Control": "no-store"})


def _section_payload(title: int, section_id: str, unit: str | None = None) -> dict:
    """The section as JSON, shaped like the CFR's `GET /api/{title}/section/{id}`: `mode` is
    "units" for a long section (read one top-level subsection at a time) else "page";
    `outline` lists every unit; `?unit=KEY` (`?unit=` = first) on a units-mode section
    returns only that unit's `html` plus `unit`, `unit_prev`, `unit_next`."""
    sid = usc_store.normalize_section_id(section_id)
    d = usc_store.get_section(title, sid)
    if d is None:
        raise HTTPException(404, f"{title} U.S.C. § {sid} is not in the installed copy.")
    notes = []
    for n in d.pop("notes"):
        notes.append({"category": n["category"], "topic": n["topic"], "heading": n["heading"],
                      "html": uslm_html.render_fragment(n["xml"]), "text": n["text"]})
    units = uslm_html.render_units(d.pop("xml"))
    outline = [{k: u[k] for k in ("key", "label", "title", "kind", "chars")}
               | {"group": None, "group_label": None, "group_title": None} for u in units]
    total = sum(u["chars"] for u in units)
    mode = "units" if len(units) >= 2 and total > UNIT_MODE_MIN_CHARS else "page"
    out = {**d, "title": title, "notes": notes, "citation": f"{title} U.S.C. {sid}",
           "mode": mode, "outline": outline}
    if unit is not None and mode == "units":
        keys = [u["key"] for u in units]
        i = keys.index(unit) if unit in keys else (0 if unit == "" else -1)
        if i < 0:
            raise HTTPException(404, f"{title} U.S.C. § {sid} has no unit {unit!r}.")
        out.update(html=uslm_html.wrap_unit(units[i]), unit=keys[i],
                   unit_prev=outline[i - 1] if i > 0 else None,
                   unit_next=outline[i + 1] if i + 1 < len(units) else None)
    else:
        out["html"] = "".join(uslm_html.wrap_unit(u) for u in units)
    return out


@usc_router.get("/{title}/section/{section_id:path}")
def get_section(title: int = Depends(installed_usc_title), section_id: str = "",
                unit: str | None = Query(None, max_length=40)) -> dict:
    return _section_payload(title, section_id, unit)


@usc_router.get("/{title}/citations/{section_id:path}")
def get_citations(title: int = Depends(installed_usc_title), section_id: str = "") -> dict:
    """What in the local library cites this section: other U.S.C. sections, CFR sections, and
    CFR parts whose Authority line names it."""
    data = usc_citations.cited_by(title, section_id)
    if data is None:
        raise HTTPException(404, f"{title} U.S.C. § {section_id} is not in the installed copy.")
    return data


class DownloadRequest(BaseModel):
    title: int = Field(ge=1, le=54)


@usc_router.post("/download")
def download(req: DownloadRequest) -> dict:
    """Queue an install (or rebuild at the current release point) of one title."""
    try:
        return {"job": usc_build.submit(req.title, "usc-title")}
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@usc_router.post("/update-all")
def update_all() -> dict:
    try:
        return usc_build.update_all()
    except usc_client.SourceUnavailable as exc:
        raise HTTPException(503, f"The OLRC didn't answer: {exc}")


@usc_router.delete("/{title}")
def remove_title(title: int = Depends(installed_usc_title)) -> dict:
    if library.queue.busy_with(usc_build.job_key(title)):
        raise HTTPException(409, f"U.S. Code Title {title} has a download in progress.")
    usc_build.remove(title)
    return {"removed": title}


# The standalone page links the SPA's own stylesheet and reuses its markup (.doc-kicker,
# .doc-title, .reg-body/.reg-p, .usc-notes), so it shares the app's tokens, fonts and reader
# typography instead of carrying a design of its own. Only the page frame is set here.
_PAGE_CSS = """
body{min-height:100%;font-size:14px}
.usc-page{max-width:calc(66ch + 48px);margin:0 auto;padding:40px 24px 72px;font-size:var(--reader-size)}
.usc-page .doc-kicker{font-size:12px}
.usc-page-nav{display:flex;justify-content:space-between;gap:12px;margin-top:40px;padding-top:16px;border-top:1px solid var(--line-soft);font:var(--w-medium) 13px/1.4 var(--sans)}
.usc-page-nav a{color:var(--fg-3)}.usc-page-nav a:hover{color:var(--fg)}
.usc-page .sep{margin:0 6px;color:var(--fg-4)}
"""


def _page_notes_html(notes: list[dict]) -> str:
    if not notes:
        return ""
    groups: dict[str, list[str]] = {}
    for n in notes:
        groups.setdefault(n["category"] or "editorial", []).append(n["html"])
    blocks = "".join(
        f'<div class="usc-note-group"><h3 class="usc-note-cat">{escape(cat.capitalize())} notes</h3>'
        + "".join(f'<div class="usc-note-card">{h}</div>' for h in items) + "</div>"
        for cat, items in groups.items())
    return (f'<section class="usc-notes" aria-label="Statutory and editorial notes">'
            f'<h2 class="usc-notes-head">Notes <span class="usc-notes-count">{len(notes)}</span></h2>{blocks}</section>')


@usc_page_router.get("/usc/{title}/{section_id:path}", include_in_schema=False)
def section_page(title: int = Path(..., ge=1, le=54), section_id: str = "") -> HTMLResponse:
    if title not in usc_store.installed_titles():
        raise HTTPException(404, f"U.S. Code Title {title} is not installed on this server.")
    d = _section_payload(title, section_id)
    sep = '<span class="sep" aria-hidden="true">·</span>'
    crumbs = sep.join(escape(" — ".join(x for x in (p.get("l"), p.get("d")) if x).strip()) for p in d["path"])
    meta = usc_store.title_summary(title) or {}
    release = f'{sep}Release {escape(meta["release_point"])}' if meta.get("release_point") else ""
    status = (f'<div class="reserved-note">This section is {escape(d["status"].lower())}.</div>'
              if d.get("status") else "")
    nav = []
    if d["prev"]:
        nav.append(f'<a href="/usc/{title}/{escape(d["prev"]["id"], quote=True)}">‹ {escape(d["prev"]["label"])}</a>')
    else:
        nav.append("<span></span>")
    if d["next"]:
        nav.append(f'<a href="/usc/{title}/{escape(d["next"]["id"], quote=True)}">{escape(d["next"]["label"])} ›</a>')
    reader_href = f'/#/usc/{title}/section/{escape(d["id"], quote=True)}'
    label = escape(d["label"].rstrip(". "))
    page = (
        f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="color-scheme" content="dark">'
        f'<title>{escape(d["citation"])}</title>'
        f'<link rel="stylesheet" href="/static/dist/app.css"><style>{_PAGE_CSS}</style></head><body>'
        f'<main class="usc-page">'
        f'<div class="doc-kicker" data-ref-tier="usc"><span class="ref-badge">U.S. CODE</span>{sep}'
        f'{title} U.S.C.{sep if crumbs else ""}{crumbs}{release}{sep}<a href="{reader_href}">Open in FRAMEWORK</a></div>'
        f'<h1 class="doc-title">{label} {escape(d["heading"])}</h1>{status}'
        f'<article class="reg-body usc-body">{d["html"]}</article>{_page_notes_html(d["notes"])}'
        f'<nav class="usc-page-nav" aria-label="Neighbouring sections">{"".join(nav)}</nav>'
        f'</main></body></html>'
    )
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})
