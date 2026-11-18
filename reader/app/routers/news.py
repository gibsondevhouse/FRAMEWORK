"""The /api/news router.

Registered in main.py BEFORE the title router: Starlette matches routes in registration
order and doesn't fall through on a failed validation, so without this ordering
`/api/news/section/1910.1030` would be captured by `/api/{title}/section/...` and 422.

Every response is `Cache-Control: no-store`. An empty or missing database returns empty,
well-formed results, never a 500. No GET endpoint ever queues or runs a sync.
"""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from .. import config, news, news_schedule as sched, news_store, news_worker
from .. import store as reg_store


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


news_router = APIRouter(prefix="/api/news", dependencies=[Depends(_no_store)])

_CATEGORY = "^(all|rules|rulemaking|notices|public_inspection|enforcement)$"


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@news_router.get("")
def get_news(
    category: str = Query("all", pattern=_CATEGORY),
    q: str | None = Query(None, max_length=200),
    section: str | None = Query(None, max_length=60),
    part: str | None = Query(None, max_length=40),
    state: str | None = Query(None, pattern="^[A-Za-z]{2}$"),
    min_penalty: float | None = Query(None, ge=0),
    gravity: str | None = Query(None, pattern="^[WRSOU]$"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """The feed, search and filters in one endpoint. `state`, `min_penalty` and `gravity`
    only match enforcement rows, so combined with category=all they narrow to enforcement."""
    if section:
        section = reg_store.normalize_id(section)
    with news_store.read_con() as con:
        if con is None:
            return {"articles": [], "total": 0, "offset": offset}
        try:
            return news_store.query_articles(
                con, category=category, q=q, section=section, part=part, state=state,
                min_penalty=min_penalty, gravity=gravity, limit=limit, offset=offset)
        except sqlite3.Error:
            return {"articles": [], "total": 0, "offset": offset}


@news_router.get("/status")
def news_status() -> dict:
    """Read-only: freshness is computed from sync_status with news_schedule; this never
    triggers a sync (refresh-on-open is an explicit POST from the page)."""
    now = datetime.now(timezone.utc)
    dol = config.dol_api_key() is not None
    rows = news_store.sync_rows()
    sources: dict[str, dict] = {}
    due_any = False
    for s in news_store.SOURCES:
        enabled = s != "dol_osha" or dol
        row = rows.get(s, {})
        last_ok = row.get("last_ok_at")
        base = {
            "enabled": enabled,
            "last_ok_at": _iso(last_ok),
            "last_count": row.get("last_count"),
            "last_error": row.get("last_error"),
            "last_error_at": _iso(row.get("last_error_at")),
            "fail_count": row.get("fail_count") or 0,
            "stale": False, "retry_after": None, "next_due_at": None,
        }
        if enabled:
            until = sched.retry_after(row.get("fail_count") or 0, row.get("last_error_at"))
            backing_off = bool(until and now < until)
            if backing_off:
                next_due = until
            elif s in sched.DAILY_SOURCES:
                next_due = (last_ok + sched.DAILY_SOURCES[s]) if last_ok else now
            else:
                next_due = sched.next_window(s, last_ok) if last_ok else now
            due = sched.is_due(s, row, now)
            due_any = due_any or due
            base.update({
                "stale": sched.is_stale(s, last_ok, now),
                "retry_after": _iso(until) if backing_off else None,
                "next_due_at": _iso(next_due),
            })
        sources[s] = base
    with news_store.read_con() as con:
        if con is None:
            counts = {"all": 0, **{c: 0 for c in news_store.CATEGORIES}}
        else:
            try:
                counts = news_store.category_counts(con)
            except sqlite3.Error:
                counts = {"all": 0, **{c: 0 for c in news_store.CATEGORIES}}
    return {
        "dol_configured": dol,
        "sync_enabled": config.news_sync_enabled(),
        "agencies": config.news_agencies(),
        "syncing": news_worker.is_syncing(),
        "due": due_any,
        "sources": sources,
        "counts": counts,
    }


@news_router.get("/facets")
def news_facets() -> dict:
    """States present among enforcement rows, with counts, for the state dropdown."""
    with news_store.read_con() as con:
        if con is None:
            return {"states": []}
        try:
            return {"states": news_store.state_facets(con)}
        except sqlite3.Error:
            return {"states": []}


class RefreshRequest(BaseModel):
    force: bool = False


@news_router.post("/refresh")
def news_refresh(req: RefreshRequest, response: Response) -> dict:
    """force=False (refresh-on-open) queues only the sources that are due. force=True
    (Refresh/Retry) queues every enabled source, ignoring staleness and backoff. Returns
    immediately: the sync runs on the worker thread."""
    if not config.news_sync_enabled():
        raise HTTPException(503, "News sync is off. Set NEWS_SYNC=1 in reader/.env and restart.")
    if news_worker.is_syncing():
        raise HTTPException(409, "A news sync is already running.")
    queued = news_worker.request_sync(req.force)
    response.status_code = 202 if queued else 200
    return {"queued": queued}


def _related(section: str | None, part: str | None, title: int) -> dict:
    if title != 29:
        # No other title has news while OSHA is the only agency.
        return {"count": 0, "articles": []}
    with news_store.read_con() as con:
        if con is None:
            return {"count": 0, "articles": []}
        try:
            res = news_store.query_articles(con, section=section, part=part, title=title, limit=15)
        except sqlite3.Error:
            return {"count": 0, "articles": []}
    return {"count": res["total"], "articles": res["articles"]}


@news_router.get("/section/{section_id:path}")
def news_for_section(section_id: str, title: int = Query(29, ge=1, le=50)) -> dict:
    """Articles citing the exact section, plus part-level references to its part."""
    sid = reg_store.normalize_id(section_id)
    return {"section_id": sid, **_related(sid, None, title)}


@news_router.get("/part/{part}")
def news_for_part(part: str, title: int = Query(29, ge=1, le=50)) -> dict:
    """Articles with any citation inside the part."""
    return {"part": part, **_related(None, part, title)}


@news_router.get("/enforcement/summary")
def enforcement_summary() -> dict:
    """Local enforcement analytics across cached DOL inspections."""
    with news_store.read_con() as con:
        if con is None:
            return {
                "total_cases": 0, "total_penalty_usd": 0.0, "avg_penalty_usd": 0.0, "max_penalty_usd": 0.0,
                "gravity_counts": {"W": 0, "R": 0, "S": 0, "O": 0},
                "top_sections": [], "top_states": [], "largest_case": None,
            }
        try:
            return news_store.enforcement_summary(con)
        except sqlite3.Error:
            return {
                "total_cases": 0, "total_penalty_usd": 0.0, "avg_penalty_usd": 0.0, "max_penalty_usd": 0.0,
                "gravity_counts": {"W": 0, "R": 0, "S": 0, "O": 0},
                "top_sections": [], "top_states": [], "largest_case": None,
            }


@news_router.get("/inspection/{activity_nr}")
def get_inspection_case(activity_nr: int) -> dict:
    """Return local inspection summary + cached violation rows for `activity_nr`."""
    dol = config.dol_api_key() is not None
    case = None
    with news_store.read_con() as con:
        if con is not None:
            try:
                case = news_store.get_enforcement_case(con, activity_nr)
            except sqlite3.Error:
                case = None
    if case is None:
        if not dol:
            raise HTTPException(404, f"Inspection {activity_nr} is not in local news cache.")
        return {
            "activity_nr": activity_nr,
            "article": None,
            "detail": None,
            "violations": [],
            "events": [],
            "gdc": [],
            "accidents": [],
            "enriched_at": None,
            "cached": False,
            "needs_enrichment": True,
            "dol_configured": dol,
        }
    return {
        **case,
        "cached": True,
        "needs_enrichment": not case.get("violations") or not case.get("enriched_at"),
        "dol_configured": dol,
    }


@news_router.post("/inspection/{activity_nr}/enrich")
def enrich_inspection_case(activity_nr: int) -> dict:
    """Fetch full case details, citations, GDC narratives, and accident abstracts from DOL v4."""
    key = config.dol_api_key()
    if not key:
        raise HTTPException(400, "DOL_API_KEY is not configured in reader/.env.")
    try:
        with news.client() as c:
            fetched = news.fetch_inspection_case(c, key, activity_nr)
    except news.SourceUnavailable as e:
        msg = str(e)
        if "HTTP 429" in msg:
            raise HTTPException(429, "DOL API rate limit reached. Try again in a moment.") from None
        raise HTTPException(503, f"Could not fetch inspection from DOL ({msg}).") from None
    if fetched is None:
        raise HTTPException(404, f"OSHA inspection {activity_nr} was not found in DOL records.")

    article = fetched["article"]
    now = datetime.now(timezone.utc)
    with closing(news_store.connect()) as con:
        news_store.upsert_article(con, article, now)
        news_store.save_enforcement_case(
            con,
            activity_nr,
            details=article["inspection_detail"],
            violations=article.get("violations_list") or [],
            events=fetched["events"],
            gdc=fetched["gdc"],
            accidents=fetched["accidents"],
            enriched_at=now.isoformat(),
            now=now,
        )
        con.commit()
    with news_store.read_con() as con:
        saved = news_store.get_enforcement_case(con, activity_nr) if con else None
    if saved is None:
        raise HTTPException(500, "Failed to persist inspection case.")
    return {
        **saved,
        "cached": True,
        "needs_enrichment": False,
        "dol_configured": True,
    }
