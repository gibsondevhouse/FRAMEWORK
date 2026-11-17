# Re-Fetch Cadence & Sync Architecture Research

**Status:** Researched & verified live on 2026-11-16 against `federalregister.gov/api/v1` and `apiprod.dol.gov/v4` with `User-Agent: FRAMEWORK-ComplianceReader/1.0 (local-reader)`.

**Adopted 2026-11-16 as decision 6**, with the §4 review notes applied. Where this document and the plan differ, the plan is authoritative ([Stage 4 · Phase 1 · Part 1](stage-4_background_polling_and_verification/phase-1_background_sync_worker/part-1_daemon_rss_sync_thread.md)). The differences:
- **No federal holiday table** (§3.1 note; review note 2).
- **Refresh-on-open is a POST from the page**, not a side effect of `GET /api/news/status` or `GET /api/news` (§3.3; review note 1).
- **No separate DOL `load_dt` probe** (§2.2; review note 3).
- **FR gap healing is by publication date**, not page size (§3.4, corrected).
- **A DOL catch-up run also raises the inspection cap** from 50 to 150.

---

## 1. Empirical Findings: When Sources Actually Change

| Source | Official Publication Schedule | Verified Observations (2026-11-16) |
| :--- | :--- | :--- |
| **Federal Register Published Documents** (`/api/v1/documents.json`) | Monday–Friday (excluding federal holidays), updated by **6:00 a.m. ET**. | Daily issue for `2026-11-16` was live with document `2026-23349` when probed at 12:40 ET. |
| **Federal Register Public Inspection** (`/api/v1/public-inspection-documents.json`) | Business days: **Regular filings at 8:45 a.m. ET**; **Special filings at 11:15 a.m. ET and 4:15 p.m. ET**. | `/public-inspection-documents/current.json` explicitly reported:<br>`regular_filings_updated_at: "2026-11-16T08:45:00.000-05:00"`<br>`special_filings_updated_at: "2026-11-16T11:15:00.000-05:00"` |
| **DOL Open Data API v4** (`OSHA/violation`, `OSHA/inspection`) | Catalog frequency: **Daily** (`R/P1D` in Data.gov metadata), populated via nightly OIS synchronization. | Exact wall-clock ETL hour is not exposed in catalog metadata. |

---

## 2. Empirical Findings: Cheap "Anything New?" Checks & Caching Headers

### 2.1 HTTP Conditional Requests (`ETag` / `If-Modified-Since`) Do Not Work
Probing all endpoints live on 2026-11-16 showed **zero conditional HTTP cache support**:
- **Federal Register JSON endpoints** return:
  ```http
  Cache-Control: no-store, no-cache, must-revalidate, private
  Age: 0
  ```
  with **no `ETag`** and **no `Last-Modified`**. Sending `If-None-Match` or `If-Modified-Since` cannot produce `304 Not Modified`.
- **DOL Open Data API v4** (`/v4/datasets/10334`, `/v4/datasets/10338`) returns **no `ETag`**, **no `Last-Modified`**, and **no `Cache-Control`**.

### 2.2 Payload-Level Quirks & Cheap Probes
1. **DOL catalog `updated_at` is NOT data freshness.**
   - Probing `/v4/datasets/10334` (`inspection`) and `/v4/datasets/10338` (`violation`) returned `published_at` / `updated_at` timestamps from `2026-06-03` (when the catalog metadata record was edited) and static `dataset_preview` rows from `2011`.
   - **Verdict:** Never poll `/v4/datasets/{id}` to check for new inspections/violations. If a cheap DOL probe is needed, query the data endpoint directly with `limit=1&sort=desc&sort_by=load_dt&fields=activity_nr,issuance_date,load_dt` (~150 bytes).
2. **Filtered Public Inspection JSON is smaller than `/current.json`.**
   - `/public-inspection-documents/current.json` includes `special_filings_updated_at` and `regular_filings_updated_at`, but weighs **159.5 KB** (`100` unfiltered filings across all agencies) and lacks `description`/agency-scoped filtering.
   - Meanwhile, `/public-inspection-documents.json?conditions[agencies][]=occupational-safety-and-health-administration` weighed **5.2 KB** (`3` OSHA filings).
   - **Verdict:** Fetching the filtered OSHA endpoint directly is ~30× cheaper than checking `/current.json`.
3. **Federal Register `per_page=1` falls back to 20.**
   - Probing `documents.json` with `per_page=1` returned **20 items** (the API minimum/default fallback), whereas `per_page=5` returned **5 items** (~1.7 KB with `fields[]=document_number`).
   - **Verdict:** Since `per_page=50` for OSHA is already a single small JSON response (~20–30 KB), schedule-gating by time window (skipping requests outside publication windows) saves more calls than a separate `per_page=5` probe.

---

## 3. Recommended Re-Fetch Architecture

Replace the blind 6-hour timer with a **Schedule-Gated Check Loop + Refresh-on-Open**:

### 3.1 Per-Source Staleness Windows (US/Eastern via `zoneinfo.ZoneInfo("America/New_York")`)

Instead of hardcoding fixed `sleep(6h)` intervals, the worker tracks `sync_status.last_ok_at` per source and asks *"has a new publication window occurred since `last_ok_at`?"*:

| Source | Freshness Window (ET, Mon–Fri excl. Federal Holidays) | Buffer | Behavior on Weekends / Federal Holidays |
| :--- | :--- | :--- | :--- |
| **`federal_register`** | Once per business day at **06:15 ET** | +15 min after 06:00 ET publish | Skip if `last_ok_at` is after the most recent business day's `06:15 ET`. |
| **`federal_register_pi`** | Three windows per business day: **09:00 ET**, **11:30 ET**, **16:30 ET** | +15 min after 8:45, 11:15, 16:15 ET | Skip if `last_ok_at` is after the most recent business day's `16:30 ET`. |
| **`dol_osha`** | Once every **24 hours** (or once per calendar day after **06:00 ET**) | Daily (`R/P1D`) | Check once per 24h (or skip weekends if preferred; OIS batch runs daily). |

*Note on Federal Holidays:* A lightweight hardcoded/computable US federal holiday table (New Year's, MLK, Presidents, Memorial, Juneteenth, Independence, Labor, Columbus, Veterans, Thanksgiving, Christmas — ~25 lines using standard `datetime`) avoids needing any third-party holiday library while preventing wasted holiday polls.

### 3.2 Error Backoff
Per-source backoff stored in memory (or derived from `sync_status.last_error_at` + consecutive failure count):
- Failure 1: retry after **5 min**
- Failure 2: retry after **15 min**
- Failure 3: retry after **1 hour**
- Failure 4+: cap at **6 hours**
- Manual `POST /api/news/refresh` clears/bypasses backoff immediately.

### 3.3 Refresh-on-Open + Wake-from-Sleep Recovery
- The daemon thread wakes every **30 minutes** (cheap local timestamp check; makes **0 HTTP requests** if all sources are fresh for the current window).
- When the user opens `#/news` (`GET /api/news/status` or `GET /api/news`), if any enabled source is **stale** (e.g., laptop was asleep overnight) and no sync is currently running:
  - Immediately return cached SQLite rows (`200 OK`) so UI render is instant.
  - Non-blockingly call `news_worker.trigger_sync()` in the background (`status.syncing` reports `true`, UI polls `/api/news/status` until fresh data arrives).

### 3.4 Backfill & Gap Healing
1. **First sync (empty `osha_news.sqlite3`)**:
   - **Federal Register**: OSHA published **147** FR documents in 2024 and **124** in 2025 (live `count` with `conditions[publication_date][year]`, checked 2026-11-16). So `per_page=100` covers ~8–9 months, not 1–2 years. To backfill the 365-day retention window, page through `next_page_url` with `conditions[publication_date][gte]={today − 365d}` rather than relying on one page size.
   - **Public Inspection**: Only current filings exist; a single call captures everything on file.
   - **DOL Enforcement**: Rolling `30-day` window (`issuance_date gt today - 30d`, `limit=1000`, keeping top `MAX_INSPECTIONS = 50`).
2. **Sleep gap (laptop offline for days/weeks)**:
   - A fixed `per_page=50` covers only ~4 months of OSHA FR activity (~10–12 documents/month). To heal any gap, query `conditions[publication_date][gte]={last_ok_at date − 3 days}` and follow `next_page_url` until done. That fetches exactly the gap, whatever its length.
   - Normal DOL sync (`30-day` rolling window) heals gaps up to ~3 weeks automatically. If `(today - last_ok_at) > 30 days`, widen the DOL lookback dynamically up to `90 days` (with `limit=5000`) for that catch-up run.

---

## 4. Review Notes (2026-11-16)

Re-checked live: the PI timestamps (`current.json`: 96 regular filings at 08:45, special filings at 11:15 and 16:15), FR's `no-store` headers with no `ETag` / `Last-Modified`, `per_page=1` → 20 items, and that `load_dt` is a column of DOL `violation` (dataset `10338` metadata). Corrected: OSHA's FR volume (§3.4). Suggested adjustments before this replaces the 6-hour loop:

1. **Keep GET requests free of side effects.** Rather than `GET /api/news/status` or `GET /api/news` triggering a sync, `status` reports `stale: true|false` per source, and the page calls `POST /api/news/refresh` when anything is stale. This keeps refresh-on-open explicit and keeps tests from ever queueing syncs through a read.
2. **Drop the federal holiday table.** Treating holidays as business days costs at most ~11 extra small requests a year. A holiday table needs observed-day rules (Saturday → Friday, Sunday → Monday), and getting it wrong would *skip* real publications. Weekend skips are enough.
3. **No separate DOL probe.** The DOL sync is one violation request plus one inspection request, once per 24h. A `load_dt` probe would save almost nothing. (`load_dt` remains a candidate sort key if `issuance_date` turns out to lag loads.)
4. **Backoff state needs a home.** Add `fail_count INTEGER NOT NULL DEFAULT 0` to `sync_status` (reset on success), so the backoff survives a restart.
5. **Sleep and the 30-minute wake.** `Event.wait` uses the monotonic clock, which on macOS does not advance while the machine sleeps. After a long sleep the next check can be up to 30 minutes late. Refresh-on-open (note 1) covers exactly that case, so keep both.
