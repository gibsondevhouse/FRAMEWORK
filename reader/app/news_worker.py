"""Schedule-gated background sync for OSHA news.

A single daemon thread ("news-worker") wakes every 30 minutes, asks `news_schedule`
which sources are due, and syncs only those — a wake with nothing due makes zero HTTP
requests. `POST /api/news/refresh` wakes it early: `force=False` syncs only due sources
(refresh-on-open), `force=True` syncs every enabled source, ignoring staleness and
backoff (the Refresh/Retry buttons).

Started from `main.py`'s lifespan only when `config.news_sync_enabled()`; never under
test (tests build TestClient(app) without a `with` block, so lifespan doesn't run).
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone

from . import build, config, news, news_schedule as sched, news_store

CHECK_INTERVAL_SEC = 30 * 60
FIRST_CHECK_DELAY_SEC = 10

SOURCE_LABELS = {
    "federal_register": "Federal Register",
    "federal_register_pi": "Federal Register public inspection",
    "dol_osha": "DOL enforcement data",
}

_thread: threading.Thread | None = None
_stop = threading.Event()
_lifecycle_lock = threading.Lock()
_wake = threading.Event()
_running = threading.Lock()                  # held while any sync runs
_forced: set[str] = set()                    # sources a manual refresh asked for
_forced_lock = threading.Lock()


# news source -> its entry in the source registry (`app/sources`)
REGISTRY_SOURCE = {"federal_register": "news", "federal_register_pi": "news", "dol_osha": "dol_enforcement"}


def _feed_scope() -> tuple[list[str] | None, list[int]]:
    """(agency slugs or None = every agency, CFR titles also followed) from the registry."""
    from .sources import selection
    return selection.news_agencies(), selection.news_follow_titles()


def enabled_sources() -> list[str]:
    """Sources the registry has switched on (and that can run: DOL needs its key). A
    switched-off source keeps its stored items; it just stops syncing."""
    from .sources import selection
    out: list[str] = []
    if selection.enabled("news"):
        agencies, follow = _feed_scope()
        if agencies is None or agencies or follow:
            out.append("federal_register")
        if selection.news_public_inspection() and (agencies is None or agencies):
            out.append("federal_register_pi")
    if selection.enabled("dol_enforcement") and config.dol_api_key():
        out.append("dol_osha")
    return out


def start() -> None:
    global _thread, _stop
    with _lifecycle_lock:
        if _thread is not None and _thread.is_alive() and not _stop.is_set():
            return
        stop_event = threading.Event()
        _stop = stop_event
        _wake.clear()
        _thread = threading.Thread(target=_loop, args=(stop_event,), name="news-worker", daemon=True)
        _thread.start()


def stop() -> None:
    global _thread
    with _lifecycle_lock:
        t = _thread
        _stop.set()
        _thread = None
    _wake.set()
    if t is not None and t.is_alive():
        t.join(timeout=5)


def is_syncing() -> bool:
    return _running.locked()


def due_sources(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    rows = news_store.sync_rows()
    from .sources import selection
    return [s for s in enabled_sources()
            if selection.schedule(REGISTRY_SOURCE[s]) != "manual" and sched.is_due(s, rows.get(s, {}), now)]


def request_sync(force: bool) -> list[str]:
    """Called by POST /api/news/refresh. Returns the sources that will sync ([] = nothing
    to do). Only reads state and sets the wake event; the sync runs on the worker thread."""
    sources = enabled_sources() if force else due_sources()
    if sources:
        if force:
            with _forced_lock:
                _forced.update(sources)
        _wake.set()
    return sources


def trigger_sync() -> None:
    _wake.set()


def _loop(stop_event: threading.Event | None = None) -> None:
    stop_flag = stop_event or _stop
    delay = FIRST_CHECK_DELAY_SEC
    while not stop_flag.is_set():
        _wake.wait(delay)
        _wake.clear()
        if stop_flag.is_set():
            break
        with _forced_lock:
            forced = set(_forced)
            _forced.clear()
        todo = sorted(set(due_sources()) | forced)
        if todo:
            with _running:
                try:
                    sync_sources(todo)
                except Exception as e:       # the thread must never die
                    build.log(f"News sync failed: {e}")
        try:                                 # FR corpus: queue a refresh once the issue is out
            from . import fr_build
            fr_build.maybe_queue_update()
        except Exception as e:
            build.log(f"FR corpus schedule check failed: {e}")
        try:                                 # U.S. Code: daily release-point check, installed titles only
            from . import usc_build
            usc_build.maybe_queue_updates()
        except Exception as e:
            build.log(f"U.S. Code release check failed: {e}")
        try:                                 # Constitution / Public Laws / Unified Agenda, when installed and due
            from .sources import schedule as corpus_schedule
            corpus_schedule.maybe_queue_corpus_updates()
        except Exception as e:
            build.log(f"Corpus refresh check failed: {e}")
        try:                                 # CFR: edition check on the registry's schedule (default: manual)
            from .library import jobs
            jobs.maybe_queue_cfr_updates()
        except Exception as e:
            build.log(f"CFR edition check failed: {e}")
        delay = CHECK_INTERVAL_SEC


def sync_sources(sources: list[str], now: datetime | None = None) -> dict[str, int | str]:
    """Each source is fetched, stored and recorded independently: one failing never blocks
    another. Returns {source: stored count, or the error message}."""
    now = now or datetime.now(timezone.utc)
    today_et = now.astimezone(sched.ET).date()
    rows = news_store.sync_rows()
    results: dict[str, int | str] = {}
    agencies, follow = _feed_scope()
    with news.client() as c:
        for s in sources:
            last_ok = rows.get(s, {}).get("last_ok_at")
            if s == "federal_register":
                if agencies is not None and not agencies and not follow:
                    results[s] = "No news agencies configured"
                    continue
                since = sched.fr_since(last_ok, now, news_store.retention_days())

                def _fetch_fr(ags=agencies, titles=follow, sc=since):
                    by_guid: dict[str, dict] = {}
                    if ags is None:              # every agency: one feed, titles add nothing
                        for it in news.fetch_federal_register_documents(c, None, sc):
                            by_guid.setdefault(it["guid"], it)
                        return list(by_guid.values())
                    for ag in ags:
                        for it in news.fetch_federal_register_documents(c, ag, sc):
                            by_guid.setdefault(it["guid"], it)
                    for t_num in titles:
                        if t_num == 29 and "occupational-safety-and-health-administration" in ags:
                            continue
                        for it in news.fetch_federal_register_by_cfr_title(c, t_num, sc):
                            by_guid.setdefault(it["guid"], it)
                    return list(by_guid.values())

                fetch = _fetch_fr
            elif s == "federal_register_pi":
                if agencies is not None and not agencies:
                    results[s] = "No news agencies configured"
                    continue

                def _fetch_pi(ags=agencies):
                    by_guid: dict[str, dict] = {}
                    for ag in (ags if ags is not None else [None]):
                        for it in news.fetch_public_inspection(c, ag):
                            by_guid.setdefault(it["guid"], it)
                    return list(by_guid.values())

                fetch = _fetch_pi
            else:
                key = config.dol_api_key()
                if not key:
                    results[s] = "DOL_API_KEY is not configured"
                    continue
                days, limit, cap = sched.dol_window(last_ok, now)
                fetch = lambda k=key, d=days, l=limit, cp=cap: news.fetch_enforcement(
                    c, k, days=d, limit=l, max_inspections=cp, today=today_et
                )
            results[s] = _run(s, fetch, now)
            if s == "dol_osha" and isinstance(results[s], int) and results[s] > 0:
                key = config.dol_api_key()
                if key and news.dol_cooldown_remaining() == 0:
                    enrich_priority_cases(c, key, max_cases=5, now=now)
    with closing(news_store.connect()) as con:
        news_store.prune(con, today=today_et)
        con.commit()
    return results


def enrich_priority_cases(
    c,
    key: str,
    *,
    max_cases: int = 5,
    now: datetime | None = None,
) -> int:
    """Rate-paced trickle enrichment for up to `max_cases` highest-signal un-enriched cases."""
    now = now or datetime.now(timezone.utc)
    with news_store.read_con() as con:
        if con is None:
            return 0
        try:
            rows = con.execute(
                """SELECT ec.activity_nr
                   FROM enforcement_cases ec
                   LEFT JOIN articles a ON a.guid = 'dol-insp:' || ec.activity_nr
                   WHERE ec.enriched_at IS NULL
                   ORDER BY
                     CASE WHEN json_extract(ec.details_json, '$.insp_type') IN ('A', 'M') THEN 0 ELSE 1 END,
                     CASE WHEN COALESCE(a.general_duty, 0) > 0 THEN 0 ELSE 1 END,
                     COALESCE(a.penalty_usd, 0) DESC,
                     ec.activity_nr DESC
                   LIMIT ?""",
                (max_cases,),
            ).fetchall()
        except sqlite3.Error:
            return 0
    done = 0
    for r in rows:
        if news.dol_cooldown_remaining() > 0:
            break
        act_nr = int(r["activity_nr"])
        try:
            fetched = news.fetch_inspection_case(c, key, act_nr)
        except news.SourceUnavailable as e:
            if "429" in str(e):
                break
            continue
        if not fetched:
            continue
        article = fetched["article"]
        with closing(news_store.connect()) as con:
            news_store.upsert_article(con, article, now)
            news_store.save_enforcement_case(
                con,
                act_nr,
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
        done += 1
    return done


def _run(source: str, fetch, now: datetime | None = None) -> int | str:
    """Fetch one source, enrich and upsert its items, and record the outcome."""
    try:
        items = fetch()
        for item in items:
            news.enrich_item(item)
    except news.SourceUnavailable as e:
        detail = str(e).split(": ", 1)[-1] if ": " in str(e) else ""
        label = SOURCE_LABELS.get(source, source)
        message = f"{label} unavailable ({detail})" if detail else f"{label} unavailable"
        build.log(f"News sync: {source}: {e}")
        with closing(news_store.connect()) as con:
            news_store.record_error(con, source, message, now)
            con.commit()
        return message
    except (KeyError, TypeError, ValueError) as e:
        label = SOURCE_LABELS.get(source, source)
        message = f"{label} unavailable (unexpected response)"
        build.log(f"News sync: {source}: malformed payload ({type(e).__name__}: {e})")
        with closing(news_store.connect()) as con:
            news_store.record_error(con, source, message, now)
            con.commit()
        return message
    with closing(news_store.connect()) as con:
        for item in items:
            news_store.upsert_article(con, item, now)
        news_store.record_ok(con, source, len(items), now)
        con.commit()
    return len(items)
