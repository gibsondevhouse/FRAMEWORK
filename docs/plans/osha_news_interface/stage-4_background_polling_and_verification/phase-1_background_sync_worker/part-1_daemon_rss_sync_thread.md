# Stage 4 · Phase 1 · Part 1: Schedule-Gated Sync Worker

## 1. Objectives
- `reader/app/news_schedule.py`: **pure functions** (no I/O, `now` always passed in) that decide when each source is stale, when it is due, and how far back to fetch.
- `reader/app/news_worker.py`: a daemon thread that wakes every 30 minutes and syncs only the sources that are due. It can be asked to sync now, stops cleanly on shutdown, and never runs under test.

This replaces the first draft's fixed 6-hour loop (decision 6). The evidence is in [REFETCH_CADENCE_RESEARCH.md](../../REFETCH_CADENCE_RESEARCH.md), including its §4 review notes, which are adopted here.

## 2. When each source changes (verified 2026-11-16)
| Source | Publishes | Stale after (ET, Mon–Fri) |
| :--- | :--- | :--- |
| `federal_register` | Daily issue by 06:00 ET on business days | **06:15** |
| `federal_register_pi` | Regular filings 08:45; special filings 11:15 and 16:15 ET | **09:00, 11:30, 16:30** |
| `dol_osha` | Daily (`R/P1D`); hour not published | **24 hours** after the last success, any day |

- Times are `America/New_York` via `zoneinfo`, so daylight saving is handled.
- **Weekends are skipped. Federal holidays are not** (review note 2): polling on a holiday costs one small request, while a wrong holiday table would skip real publications.
- No conditional requests and no "anything new?" probes. Neither API sends `ETag` / `Last-Modified`, DOL's catalog `updated_at` is not data freshness, and the real fetches are already small: filtered PI is ~5 KB, the DOL sync is two requests (review note 3).

## 3. `news_schedule.py`
```python
from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
WINDOWS = {                                   # ET wall-clock times, Mon–Fri
    "federal_register": (time(6, 15),),
    "federal_register_pi": (time(9, 0), time(11, 30), time(16, 30)),
}
DAILY_SOURCES = {"dol_osha": timedelta(hours=24)}
BACKOFF = (timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1), timedelta(hours=6))


def latest_window(source: str, now: datetime) -> datetime | None:
    """The most recent window at or before `now` (aware), walking back over weekends."""
    local = now.astimezone(ET)
    for back in range(0, 8):
        day = (local - timedelta(days=back)).date()
        if day.weekday() >= 5:
            continue
        for t in sorted(WINDOWS[source], reverse=True):
            w = datetime.combine(day, t, ET)
            if w <= local:
                return w
    return None


def next_window(source: str, after: datetime) -> datetime:
    """The first window strictly after `after` (for status display)."""


def is_stale(source: str, last_ok_at: datetime | None, now: datetime) -> bool:
    if last_ok_at is None:
        return True
    if source in DAILY_SOURCES:
        return now - last_ok_at >= DAILY_SOURCES[source]
    w = latest_window(source, now)
    return w is not None and last_ok_at < w


def retry_after(fail_count: int, last_error_at: datetime | None) -> datetime | None:
    """End of the backoff after `fail_count` consecutive failures: 5m, 15m, 1h, then 6h."""
    if not fail_count or last_error_at is None:
        return None
    return last_error_at + BACKOFF[min(fail_count, len(BACKOFF)) - 1]


def is_due(source: str, row: dict, now: datetime) -> bool:
    """Stale and not inside a backoff. `row` is the source's sync_status row (parsed datetimes)."""
    until = retry_after(row.get("fail_count") or 0, row.get("last_error_at"))
    return is_stale(source, row.get("last_ok_at"), now) and not (until and now < until)


def fr_since(last_ok_at: datetime | None, now: datetime, retention_days: int) -> str:
    """FR publication_date lower bound: the gap since the last success (−3 days of overlap),
    or the whole retention window on the first sync. ISO date."""
    if last_ok_at is None:
        return (now.astimezone(ET).date() - timedelta(days=retention_days)).isoformat()
    return (last_ok_at.astimezone(ET).date() - timedelta(days=3)).isoformat()


def dol_window(last_ok_at: datetime | None, now: datetime) -> tuple[int, int, int]:
    """(lookback_days, row_limit, max_inspections). Normal: 30 days / 1000 rows / 50 inspections.
    Catch-up when the last success is over 30 days old: 90 days / 5000 rows / 150 inspections.
    First sync uses the normal window."""
    if last_ok_at is not None and now - last_ok_at > timedelta(days=30):
        return 90, 5000, 150
    return 30, 1000, 50
```
Why the catch-up raises the inspection cap: keeping only the newest 50 inspections would fill entirely from the most recent days and make a wider window pointless.

## 4. Worker lifecycle
- **Start** in `main.py`'s `lifespan`, after the existing title build, only when `config.news_sync_enabled()`: `news_store.init_db(); news_worker.start()`.
- **Stop** after `yield`: `news_worker.stop()` sets the stop event and joins with a 5s timeout. The thread is a daemon, so a stuck request can't hold up shutdown past that.
- **Tests never start it.** `TestClient(app)` without a `with` block does not run `lifespan`, and that is how every current test builds its client. Any test that does use `with TestClient(app)` sets `NEWS_SYNC=0` (patch `os.environ`). A guard test asserts no thread named `news-worker` is alive.
- **`--reload`** runs the app in one child process, so there is one worker. FRAMEWORK doesn't run multiple uvicorn workers. If it ever does, the sync needs a file lock; note it, don't build it.
- **Windows:** `zoneinfo` needs the IANA database, which Windows Python lacks. Add `tzdata` to the venv install line in `CLAUDE.md` and the READMEs (it is harmless on macOS/Linux).

## 5. Worker sketch (`news_worker.py`)
```python
import threading
from contextlib import closing
from datetime import datetime, timezone

from . import build, config, news, news_schedule as sched, news_store

CHECK_INTERVAL_SEC = 30 * 60
FIRST_CHECK_DELAY_SEC = 10

_thread: threading.Thread | None = None
_stop = threading.Event()
_wake = threading.Event()
_running = threading.Lock()                  # held while any sync runs
_forced: set[str] = set()                    # sources a manual refresh asked for (bypass staleness + backoff)
_forced_lock = threading.Lock()


def enabled_sources() -> list[str]:
    return ["federal_register", "federal_register_pi"] + (["dol_osha"] if config.dol_api_key() else [])


def start() -> None: ...                     # as before: daemon thread named "news-worker"
def stop() -> None: ...                      # _stop.set(); _wake.set(); join(5)


def is_syncing() -> bool:
    return _running.locked()


def due_sources(now: datetime | None = None) -> list[str]:
    now = now or datetime.now(timezone.utc)
    rows = news_store.sync_rows()            # {source: row}, datetimes parsed
    return [s for s in enabled_sources() if sched.is_due(s, rows.get(s, {}), now)]


def request_sync(force: bool) -> list[str]:
    """Called by POST /api/news/refresh. Returns the sources that will sync ([] = nothing to do).
    force=True: every enabled source, ignoring staleness and backoff (Refresh/Retry buttons).
    force=False: only due sources (refresh-on-open)."""
    sources = enabled_sources() if force else due_sources()
    if sources:
        if force:
            with _forced_lock:
                _forced.update(sources)
        _wake.set()
    return sources


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
    """Each source is fetched, stored and recorded independently: one failing never blocks another."""
    now = now or datetime.now(timezone.utc)
    rows = news_store.sync_rows()
    results: dict[str, int | str] = {}
    agency = config.news_agencies()[0]       # OSHA only (decision 1)
    with news.client() as c:
        for s in sources:
            last_ok = rows.get(s, {}).get("last_ok_at")
            if s == "federal_register":
                fetch = lambda: news.fetch_federal_register_documents(
                    c, agency, since=sched.fr_since(last_ok, now, news_store.retention_days()))
            elif s == "federal_register_pi":
                fetch = lambda: news.fetch_public_inspection(c, agency)
            else:
                days, limit, cap = sched.dol_window(last_ok, now)
                fetch = lambda: news.fetch_enforcement(c, config.dol_api_key(), days=days, limit=limit,
                                                       max_inspections=cap)
            results[s] = _run(s, fetch)
    with closing(news_store.connect()) as con:
        news_store.prune(con)
        con.commit()
    return results
```
`_run(source, fetch)` is unchanged from the first draft:
- it enriches each item (citations and takeaways);
- on success it upserts all items and calls `record_ok` in one transaction;
- on `SourceUnavailable` it calls `record_error`.

`record_ok` resets `fail_count` to 0, and `record_error` increments it (Stage 1 · Phase 1 · Part 2 §5). That is what makes the backoff survive a restart (review note 4).

## 6. Refresh-on-open (review notes 1 and 5)
- **GET requests never trigger a sync.** `GET /api/news/status` reports per-source `stale`, `retry_after` and `next_due_at`, plus a top-level `due` that is true when any enabled source is due now (Stage 1 · Phase 1 · Part 3).
- When `#/news` opens and `status.due` is true and `status.syncing` is false, the page calls `POST /api/news/refresh` with `{"force": false}`. It then watches status until the sync finishes and quietly revalidates (Stage 4 · Phase 1 · Part 2).
- **This is needed alongside the 30-minute wake.** `Event.wait` runs on the monotonic clock, which on macOS stops while the machine sleeps. After a night asleep, the worker's next check can be up to 30 minutes late, and opening News covers that gap.
- The **Refresh** and **Retry** buttons and the "Refresh news" command send `{"force": true}`. That syncs every enabled source immediately and ignores backoff.

## 7. Acceptance Criteria
- [ ] On a fresh install with network, FR documents (the full retention window) and PI filings sync within ~10s of startup, with no keys.
- [ ] After that, a wake with nothing due makes **zero** HTTP requests.
- [ ] FR syncs once per business-day window, PI up to three times per business day, and DOL once per 24h. Nothing is fetched on weekends except DOL.
- [ ] A failing source backs off 5m → 15m → 1h → 6h, other sources keep syncing, and the backoff survives a restart.
- [ ] `{"force": true}` bypasses staleness and backoff, and `{"force": false}` syncs only due sources. Both return at once; the sync runs on the worker thread.
- [ ] Shutdown is prompt. No test starts the worker or touches the network.
