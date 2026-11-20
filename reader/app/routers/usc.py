"""The /api/usc router (installed U.S. Code titles) and the standalone `/usc/{t}/{s}` page.

Registered in main.py BEFORE the /api/{title} routers (like news and fr), or `/api/usc/...`
would be captured as a (non-integer) CFR title and 422.

Reads are local. Two endpoints reach the OLRC: `GET /api/usc/release` (the current
release point, cached 30 min) and the queued installs/updates. `/usc/{t}/{s}` is the
target of U.S.C. citation links once a title is installed: a plain, self-contained page
(the SPA has no U.S.C. reader yet), so a link opened from a CFR section works.
"""
from __future__ import annotations

from html import escape

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field

from .. import library, usc_build, usc_client, usc_store
from ..render import uslm_html

_SEC = r"^[0-9A-Za-z.~\-–]{1,40}$"


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


usc_router = APIRouter(prefix="/api/usc", dependencies=[Depends(_no_store)])
usc_page_router = APIRouter()


def installed_usc_title(title: int = Path(..., ge=1, le=150)) -> int:
    if title not in usc_store.installed_titles():
        raise HTTPException(404, f"U.S. Code Title {title} is not installed on this server.")
    return title


@usc_router.get("/titles")
def list_titles() -> dict:
    """Installed titles (local only; no network)."""
    rows = [s for s in (usc_store.title_summary(t) for t in usc_store.installed_titles()) if s]
    return {"titles": rows}


@usc_router.get("/catalog")
def title_catalog(appendix: bool = False) -> dict:
    """All 54 titles for the Library: static facts, install state, bytes, staleness against
    the release point this server last saw. Local only. `appendix=true` adds the appendix
    titles (5a, 11a, 18a, 28a, 50a as 105, 111, 118, 128, 150, with `label`)."""
    return usc_build.catalog(include_appendix=appendix)


@usc_router.get("/release")
def current_release(refresh: bool = False) -> dict:
    """The OLRC's current release point and which installed titles are behind it."""
    try:
        release = usc_client.current_release(force=refresh)
    except usc_client.SourceUnavailable as exc:
        raise HTTPException(503, f"The OLRC didn't answer: {exc}")
    st = usc_build.status(release)
    return {"release_point": release["release_point"], "current_through": release.get("current_through"),
            "available_titles": sorted(int(k) for k in release.get("titles", {})
                                       if int(k) not in usc_client.APPENDIX),
            "available_appendix_titles": sorted(int(k) for k in release.get("titles", {})
                                                if int(k) in usc_client.APPENDIX),
            "titles": st["titles"]}


@usc_router.get("/search")
def search(q: str = Query(..., max_length=200), title: int | None = Query(None, ge=1, le=150),
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


def _section_payload(title: int, section_id: str) -> dict:
    sid = usc_store.normalize_section_id(section_id)
    d = usc_store.get_section(title, sid)
    if d is None:
        raise HTTPException(404, f"{title} U.S.C. § {sid} is not in the installed copy.")
    notes = []
    for n in d.pop("notes"):
        notes.append({"category": n["category"], "topic": n["topic"], "heading": n["heading"],
                      "html": uslm_html.render_fragment(n["xml"]), "text": n["text"]})
    xml = d.pop("xml")
    return {**d, "title": title, "html": uslm_html.render_body(xml), "notes": notes,
            "citation": f"{title} U.S.C. {sid}"}


@usc_router.get("/{title}/section/{section_id:path}")
def get_section(title: int = Depends(installed_usc_title), section_id: str = "") -> dict:
    return _section_payload(title, section_id)


class DownloadRequest(BaseModel):
    title: int = Field(ge=1, le=150)


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


_PAGE_CSS = """
:root{color-scheme:dark;--bg:#070708;--fg:#E7E7EA;--fg-3:#8B8B93;--line:#232329;--accent:#E11D48}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Georgia,'Times New Roman',serif}
main{max-width:66ch;margin:0 auto;padding:32px 16px 64px}
.kicker{font:12px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--fg-3)}
h1{font-size:1.5rem;line-height:1.3;margin:.25em 0 1em}
a{color:#9DB7FF}
.usc-level{margin-left:1.25em}.usc-num{font-weight:600}
.usc-sourceCredit{color:var(--fg-3);font-size:.9em}
blockquote{border-left:2px solid var(--line);margin:1em 0;padding-left:1em}
.notes{border-top:1px solid var(--line);margin-top:2.5em;padding-top:1em}
.notes h2{font:600 13px/1.4 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3)}
table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:4px 8px}
.status{color:var(--accent)}
"""


@usc_page_router.get("/usc/{title}/{section_id:path}", include_in_schema=False)
def section_page(title: int = Path(..., ge=1, le=150), section_id: str = "") -> HTMLResponse:
    if title not in usc_store.installed_titles():
        raise HTTPException(404, f"U.S. Code Title {title} is not installed on this server.")
    d = _section_payload(title, section_id)
    status = f' <span class="status">[{escape(d["status"])}]</span>' if d.get("status") else ""
    crumbs = " › ".join(escape(f'{p["l"]} {p["d"]}'.strip()) for p in d["path"])
    notes_html = ""
    if d["notes"]:
        groups: dict[str, list[str]] = {}
        for n in d["notes"]:
            groups.setdefault(n["category"], []).append(n["html"])
        notes_html = "".join(
            f'<section class="notes"><h2>{escape(cat.capitalize())} notes</h2>{"".join(items)}</section>'
            for cat, items in groups.items())
    nav = []
    if d["prev"]:
        nav.append(f'<a href="/usc/{title}/{escape(d["prev"]["id"], quote=True)}">‹ {escape(d["prev"]["label"])}</a>')
    if d["next"]:
        nav.append(f'<a href="/usc/{title}/{escape(d["next"]["id"], quote=True)}">{escape(d["next"]["label"])} ›</a>')
    meta = usc_store.title_summary(title) or {}
    page = (
        f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{escape(d["citation"])}</title><style>{_PAGE_CSS}</style></head><body><main>'
        f'<div class="kicker">{title} U.S.C. · {crumbs} · release point {escape(meta.get("release_point") or "")}</div>'
        f'<h1>{escape(d["label"])} {escape(d["heading"])}{status}</h1>'
        f'<article class="usc-body">{d["html"]}</article>{notes_html}'
        f'<nav class="kicker" style="display:flex;justify-content:space-between;margin-top:2em">{"".join(nav)}</nav>'
        f'</main></body></html>'
    )
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})
