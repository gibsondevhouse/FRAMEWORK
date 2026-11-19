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

from .. import config, news, news_schedule as sched, news_store, news_worker, render
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
    naics: str | None = Query(None, pattern="^[0-9]{2,6}$"),
    gdc: bool = Query(False),
    fatality: bool = Query(False),
    jurisdiction: str | None = Query(None, pattern="^(all|federal|state_plan)$"),
    emphasis: str | None = Query(None, max_length=24),
    cfr_title: int | None = Query(None, ge=1, le=50),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    """The feed, search and filters in one endpoint."""
    if section:
        section = reg_store.normalize_id(section)
    with news_store.read_con() as con:
        if con is None:
            return {"articles": [], "total": 0, "offset": offset}
        try:
            return news_store.query_articles(
                con, category=category, q=q, section=section, part=part, cfr_title=cfr_title,
                state=state, min_penalty=min_penalty, gravity=gravity, naics=naics, gdc=gdc,
                fatality=fatality, jurisdiction=jurisdiction, emphasis=emphasis,
                limit=limit, offset=offset)
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
    """States, top NAICS, and emphasis codes present among enforcement rows."""
    with news_store.read_con() as con:
        if con is None:
            return {"states": [], "top_naics": [], "emphasis_codes": []}
        try:
            return {
                "states": news_store.state_facets(con),
                "top_naics": news_store.naics_summary(con, limit=8),
                "emphasis_codes": news_store.emphasis_facets(con),
            }
        except sqlite3.Error:
            return {"states": [], "top_naics": [], "emphasis_codes": []}


@news_router.get("/enforcement/naics/{code}")
def enforcement_by_naics(code: str, federal_only: bool = Query(False)) -> dict:
    """Cached industry enforcement summary for a 2-6 digit NAICS code/prefix."""
    clean = code.strip()
    if not clean.isdigit() or not (2 <= len(clean) <= 6):
        raise HTTPException(422, "NAICS code must be 2 to 6 digits.")
    with news_store.read_con() as con:
        if con is None:
            return {
                "naics": clean, "case_count": 0, "total_penalty_usd": 0.0,
                "gdc_count": 0, "fatality_count": 0, "top_sections": [],
            }
        try:
            return news_store.naics_summary(con, clean, federal_only=federal_only)
        except sqlite3.Error:
            return {
                "naics": clean, "case_count": 0, "total_penalty_usd": 0.0,
                "gdc_count": 0, "fatality_count": 0, "top_sections": [],
            }


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
    empty_stats = {"case_count": 0, "citation_count": 0, "avg_penalty": 0.0, "fta_count": 0, "top_paragraphs": []}
    with news_store.read_con() as con:
        if con is None:
            return {"count": 0, "articles": [], "stats": empty_stats}
        try:
            res = news_store.query_articles(con, section=section, part=part, title=title, limit=15)
            if title == 29:
                stats = (
                    news_store.section_enforcement_stats(con, section)
                    if section
                    else news_store.part_enforcement_stats(con, str(part))
                )
            else:
                stats = empty_stats
        except sqlite3.Error:
            return {"count": 0, "articles": [], "stats": empty_stats}
    return {"count": res["total"], "articles": res["articles"], "stats": stats}


@news_router.get("/section/{section_id:path}")
def news_for_section(section_id: str, title: int = Query(29, ge=1, le=50)) -> dict:
    """Articles citing the exact section, plus part-level references to its part."""
    sid = reg_store.normalize_id(section_id)
    return {"section_id": sid, **_related(sid, None, title)}


@news_router.get("/part/{part}")
def news_for_part(part: str, title: int = Query(29, ge=1, le=50)) -> dict:
    """Articles with any citation inside the part."""
    return {"part": part, **_related(None, part, title)}


_EMPTY_ENFORCEMENT_SUMMARY = {
    "total_cases": 0, "total_penalty_usd": 0.0, "avg_penalty_usd": 0.0, "max_penalty_usd": 0.0,
    "total_initial_usd": 0.0, "total_current_usd": 0.0, "avg_reduction_pct": 0.0,
    "contested_cases": 0, "fta_cases": 0, "fta_total_usd": 0.0, "open_abate_cases": 0,
    "gravity_counts": {"W": 0, "R": 0, "S": 0, "O": 0},
    "top_sections": [], "top_states": [], "largest_case": None,
}


@news_router.get("/enforcement/summary")
def enforcement_summary() -> dict:
    """Local enforcement analytics across cached DOL inspections."""
    with news_store.read_con() as con:
        if con is None:
            return dict(_EMPTY_ENFORCEMENT_SUMMARY)
        try:
            return news_store.enforcement_summary(con)
        except sqlite3.Error:
            return dict(_EMPTY_ENFORCEMENT_SUMMARY)


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
            "related": [],
            "enrich_ver": 0,
            "enriched_mod_date": None,
            "enriched_at": None,
            "cached": False,
            "needs_enrichment": True,
            "dol_configured": dol,
        }
    return {
        **case,
        "cached": True,
        "needs_enrichment": (
            not case.get("violations")
            or not case.get("enriched_at")
            or int(case.get("enrich_ver") or 0) < 1
        ),
        "dol_configured": dol,
    }


@news_router.post("/inspection/{activity_nr}/enrich")
def enrich_inspection_case(activity_nr: int, force: bool = Query(False)) -> dict:
    """Fetch full case details, citations, GDC narratives, and accident abstracts from DOL v4."""
    key = config.dol_api_key()
    if not key:
        raise HTTPException(400, "DOL_API_KEY is not configured in reader/.env.")
    if not force:
        existing = None
        with news_store.read_con() as con:
            if con is not None:
                try:
                    existing = news_store.get_enforcement_case(con, activity_nr)
                except sqlite3.Error:
                    existing = None
        if existing and existing.get("enriched_at") and int(existing.get("enrich_ver") or 0) >= 1:
            detail_mod = (existing.get("detail") or {}).get("case_mod_date")
            if existing.get("enriched_mod_date") == detail_mod:
                return {
                    **existing,
                    "cached": True,
                    "needs_enrichment": False,
                    "dol_configured": True,
                }
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
            related=fetched.get("related") or [],
            enrich_ver=1,
            enriched_mod_date=(article["inspection_detail"] or {}).get("case_mod_date"),
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


@news_router.get("/dol/search")
def dol_live_search(
    q: str = Query(..., min_length=1, max_length=120),
    mode: str = Query("employer", pattern="^(employer|naics|standard|hazsub)$"),
    state: str | None = Query(None, pattern="^[A-Za-z]{2}$"),
    since: str | None = Query(None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
    min_penalty: float | None = Query(None, ge=0),
    sort_by: str = Query("open_date", pattern="^(open_date|penalty)$"),
    offset: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=25),
) -> dict:
    """Explicit-submit live search against DOL Open Data API v4 with 10m TTL cache."""
    key = config.dol_api_key()
    if not key:
        raise HTTPException(503, "DOL_API_KEY is not configured in reader/.env.")
    try:
        with news.client() as c:
            return news.live_dol_search(
                c, key, q=q, mode=mode, state=state, since=since,
                min_penalty=min_penalty, sort_by=sort_by, offset=offset, limit=limit,
            )
    except news.SourceUnavailable as e:
        msg = str(e)
        if "HTTP 429" in msg:
            raise HTTPException(429, "DOL API rate limit reached. Try again in a moment.") from None
        raise HTTPException(503, f"DOL search unavailable ({msg}).") from None


def _fr_linkifier():
    installed = set(config.installed_titles())

    def _known_by_title(t: int, sec: str) -> bool:
        if t not in installed:
            return False
        try:
            return sec in reg_store.known_ids(t)
        except Exception:
            return False

    return render.make_linkifier(
        known=lambda _s: False,
        title=0,
        known_by_title=_known_by_title,
        installed_titles=config.installed_titles,
    )


@news_router.get("/fr/{document_number}")
def get_fr_document(document_number: str) -> dict:
    """Return Federal Register article metadata and sanitized, CFR-linkified body HTML (cached on demand)."""
    doc_num = (document_number or "").strip()
    if not doc_num or not news._FR_DOC_NUM_RE.fullmatch(doc_num):
        raise HTTPException(422, "Invalid Federal Register document number.")
    article = None
    cached_body = None
    with news_store.read_con() as con:
        if con is not None:
            try:
                article = news_store.get_article_by_doc_num(con, doc_num)
                cached_body = news_store.get_fr_body(con, doc_num)
            except sqlite3.Error:
                pass
    if cached_body is not None:
        linkify = _fr_linkifier()
        return {
            "document_number": doc_num,
            "article": article,
            "body_html": linkify.without_self(cached_body["body_html"]),
            "fetched_at": cached_body["fetched_at"],
            "cached": True,
        }
    try:
        with news.client() as c:
            fetched = news.fetch_fr_body(c, doc_num)
    except news.SourceUnavailable as e:
        raise HTTPException(503, f"Federal Register unavailable ({e}).") from None
    if fetched is None:
        if article is None:
            raise HTTPException(404, f"Federal Register document {doc_num} was not found.")
        return {
            "document_number": doc_num,
            "article": article,
            "body_html": None,
            "fetched_at": None,
            "cached": False,
        }
    now = datetime.now(timezone.utc)
    with closing(news_store.connect()) as con:
        if article is None and fetched.get("doc"):
            item = news.enrich_item(news.fr_document_item(fetched["doc"], None))
            news_store.upsert_article(con, item, now)
            article = news_store.get_article_by_doc_num(con, doc_num)
        news_store.save_fr_body(con, doc_num, fetched["body_html"], now)
        con.commit()
    linkify = _fr_linkifier()
    return {
        "document_number": doc_num,
        "article": article,
        "body_html": linkify.without_self(fetched["body_html"]),
        "fetched_at": now.isoformat(),
        "cached": False,
    }
