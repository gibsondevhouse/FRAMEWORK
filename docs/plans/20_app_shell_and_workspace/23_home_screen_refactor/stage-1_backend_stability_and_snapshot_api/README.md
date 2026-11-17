# Stage 1: Backend Stability & Local Snapshot API

## Goal
Eliminate concurrency, cache-poisoning, read-only locking, and single-DB failure risks across `store.py`, `news_store.py`, `library/jobs.py`, and routers while introducing a local-only `GET /api/titles/snapshot` endpoint that supplies rich installed-title context to Home without making external network calls or breaking `GET /api/titles`.

---

## Concrete Fixes & Changes

### 1. SQLite Connection & Cache Safety (`reader/app/store.py`)
1. **Never cache transient errors in `known_ids(title)`**:
   - Currently `known_ids()` is decorated with `@lru_cache(maxsize=64)` and catches `except Exception: return frozenset()`, which permanently caches an empty set if a transient `sqlite3.OperationalError` or `FileNotFoundError` occurs during an install/update swap.
   - Fix: Implement an uncached guard/wrapper around a generation-scoped or inner `_load_known_ids(title)` that raises on `sqlite3.Error` / `OSError` before caching; on transient failure at query time, return `frozenset()` without populating the cache.
2. **Hardened connection pragmas in `db(title)`**:
   - Use `sqlite3.connect(path, timeout=5.0, check_same_thread=False)` and execute:
     - `PRAGMA busy_timeout = 5000`
     - `PRAGMA query_only = ON`
   - Guarantees reader threads ride out short OS lock windows without mutating title DBs or spawning `-wal`/`-shm` sidecars.
3. **Install/Swap isolation & cache race guard**:
   - Track active swap generation / lock per title so concurrent requests during `build._replace_with_retry()` do not repopulate `lru_cache` from an unswapped DB file between `before_install()` and `os.replace()`. Clear caches both before install and after replacement completes.
4. **Defensive unit lookup in `get_section()`**:
   - Guard `found = doc.find(unit)` for `None` before reading `found["key"]`.
5. **Safe per-title reader helper (`safe_meta(title)`)**:
   - Return `dict` metadata (plus parsed `scope` summary) or a structured error marker when a single title DB is unreadable, rather than letting one bad SQLite file fail multi-title endpoints.

### 2. Job Queue Lock Integrity (`reader/app/library/jobs.py`)
- In `Queue._run()`, move final `job["state"]` (`"done"`, `"cancelled"`, `"error"`) and `job["error"]` updates inside `with self._lock:` alongside `finished_at` and `_recent.append(job)`. Prevents `Queue.snapshot()` from copying a half-transitioned `self._current` dict.

### 3. Read-Only News Store Resilience (`reader/app/news_store.py` & `reader/app/routers/news.py`)
1. **Non-mutating read path `connect(readonly: bool = False)`**:
   - When `readonly=True` and `not db_path().exists()`, return `None` immediately (so GETs on Home or `/api/news` never create an empty `osha_news.sqlite3` on disk when `NEWS_SYNC=0`).
   - When `readonly=True` and the DB exists, connect via `f"{db_path().resolve().as_uri()}?mode=ro"` with `uri=True, timeout=5.0`, apply `PRAGMA busy_timeout = 5000` + `PRAGMA query_only = ON`, and skip `PRAGMA journal_mode=WAL` / schema DDL writes.
2. **Graceful error handling in `routers/news.py`**:
   - Handle `con is None` or transient `sqlite3.OperationalError` cleanly in read endpoints (`get_news`, `news_status`, `news_facets`, `_related`), returning empty well-formed JSON with `Cache-Control: no-store`.

### 4. Fault-Isolated `/api/titles` & New `/api/titles/snapshot` (`reader/app/routers/reader.py`)
1. **Harden `list_titles()` (`/api/titles`)**:
   - Preserve exact response schema pinned by `tests/snapshots/get_titles.json`.
   - Wrap each title’s `store.meta(t)` lookup in `try/except (sqlite3.Error, OSError, FileNotFoundError)` so a single unreadable DB degrades cleanly (`section_count: 0`, `name: f"Title {t}"`) instead of raising HTTP 500 across the whole app.
2. **Add `GET /api/titles/snapshot` on `titles_router`**:
   - Declared on `titles_router` (mounted before `/api/{title}` in `main.py`), `Cache-Control: no-store`.
   - Zero external HTTP requests. Returns `{ "titles": [...], "ai_configured": bool }` where each installed title row contains:
     - `title`, `name`, `edition`, `built_at`, `section_count`, `partial`, `unreadable` (bool)
     - `scope_parts`: `list[str] | None` (ordered part IDs from `meta.scope["parts"]` + distinct parts in `meta.scope["sections"]` when `partial` is true; `None` for whole titles)
     - `scope_sections_count`: `int` (count of individually scoped sections if `partial`)
     - `desk`, `agencies`, `summary` from `library._BLURBS["titles"]` (`title_blurbs.json`, covering all 50 titles)
     - `news`: `{ "count": int, "latest_title": str | None, "latest_date": str | None }` for Title 29 read safely from `news_store` (`readonly=True`), or `{ "count": 0, "latest_title": None, "latest_date": None }` when unavailable or for other titles.

---

## Exit Gate
- All existing Python tests pass unchanged (including `test_api_snapshots.py` after recording `get_titles_snapshot.json` and updating `route_inventory.json`).
- New unit tests verify:
  - `known_ids()` recovers after a simulated transient `sqlite3.OperationalError`.
  - `/api/titles` and `/api/titles/snapshot` return HTTP 200 when one installed DB is corrupt.
  - `news_store.connect(readonly=True)` creates no SQLite file when absent.
  - `Queue._run()` state transitions stay atomic under `self._lock`.
