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
_wake = threading.Event()
_running = threading.Lock()                  # held while any sync runs
_forced: set[str] = set()                    # sources a manual refresh asked for
_forced_lock = threading.Lock()


def enabled_sources() -> list[str]:
    return ["federal_register", "federal_register_pi"] + (["dol_osha"] if config.dol_api_key() else [])


def start() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _wake.clear()
    _thread = threading.Thread(target=_loop, name="news-worker", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    _wake.set()
    if _thread is not None and _thread.is_alive():
        _thread.join(timeout=5)


def is_syncing() -> bool:
    return _running.locked()


def due_sources(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    rows = news_store.sync_rows()
    return [s for s in enabled_sources() if sched.is_due(s, rows.get(s, {}), now)]


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


def _loop() -> None:
    delay = FIRST_CHECK_DELAY_SEC
    while not _stop.is_set():
        _wake.wait(delay)
        _wake.clear()
        if _stop.is_set():
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
        delay = CHECK_INTERVAL_SEC


def sync_sources(sources: list[str], now: datetime | None = None) -> dict[str, int | str]:
    """Each source is fetched, stored and recorded independently: one failing never blocks
    another. Returns {source: stored count, or the error message}."""
    now = now or datetime.now(timezone.utc)
    rows = news_store.sync_rows()
    results: dict[str, int | str] = {}
    agency = config.news_agencies()[0]       # OSHA only (decision 1)
    with news.client() as c:
        for s in sources:
            last_ok = rows.get(s, {}).get("last_ok_at")
            if s == "federal_register":
                since = sched.fr_since(last_ok, now, news_store.retention_days())
                fetch = lambda: news.fetch_federal_register_documents(c, agency, since)
            elif s == "federal_register_pi":
                fetch = lambda: news.fetch_public_inspection(c, agency)
            else:
                days, limit, cap = sched.dol_window(last_ok, now)
                fetch = lambda: news.fetch_enforcement(c, config.dol_api_key(), days=days,
                                                       limit=limit, max_inspections=cap)
            results[s] = _run(s, fetch, now)
    with closing(news_store.connect()) as con:
        news_store.prune(con)
        con.commit()
    return results


def _run(source: str, fetch, now: datetime | None = None) -> int | str:
    """Fetch one source, enrich and upsert its items, and record the outcome."""
    try:
        items = fetch()
    except news.SourceUnavailable as e:
        detail = str(e).split(": ", 1)[-1] if ": " in str(e) else ""
        label = SOURCE_LABELS.get(source, source)
        message = f"{label} unavailable ({detail})" if detail else f"{label} unavailable"
        build.log(f"News sync: {source}: {e}")
        with closing(news_store.connect()) as con:
            news_store.record_error(con, source, message, now)
            con.commit()
        return message
    for item in items:
        news.enrich_item(item)
    with closing(news_store.connect()) as con:
        for item in items:
            news_store.upsert_article(con, item, now)
        news_store.record_ok(con, source, len(items), now)
        con.commit()
    return len(items)
