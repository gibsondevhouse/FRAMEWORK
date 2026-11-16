# Stage 1 · Phase 1 · Part 3: News API Endpoints

## 1. Objectives
Define every `/api/news…` endpoint the frontend uses, in one router, registered so the title-scoped routes cannot capture it.

## 2. Route ordering: a hard requirement
`main.py` includes `title_router` (prefix `/api/{title}`) at line ~339. Starlette matches routes in registration order, and FastAPI does not fall through on a failed validation. So `/api/news/section/1910.1030` would be matched by `/api/{title}/section/{section_id:path}` and get a **422** (`news` is not an int), and `/api/news/search` would hit `/api/{title}/search` the same way.

So all news routes live on `news_router = APIRouter(prefix="/api/news")`, defined in a new `reader/app/news_api.py`, and `main.py` calls `app.include_router(news_router)` **before** `app.include_router(title_router)`. A test asserts it (Stage 4 · Phase 2 · Part 1).

All responses carry `NO_STORE` headers, like the library endpoints. An empty or missing database returns empty results, never a 500.

## 3. Endpoints

### `GET /api/news`
The feed, search and facets in one endpoint.

| Param | Meaning |
| :--- | :--- |
| `category` | `all` (default) · `rules` · `rulemaking` · `enforcement` · `public_inspection` · `notices` |
| `q` | Full-text query (Stage 3 · Phase 2 · Part 1). When present, results are ranked by relevance and carry `snippet`. |
| `section` | A section id (`1910.1030`, normalised by `store.normalize_id`). Returns articles citing that section or its part. Used by "See all in News" from the reader. |
| `part` | A Title 29 part (`1910`). Returns articles with any citation in that part. Used by "See all in News" from a part page. |
| `state` | Two-letter code (`site_state`). |
| `min_penalty` | Number; enforcement rows with `penalty_usd >= min_penalty`. |
| `gravity` | `W`, `R` or `S`; enforcement rows whose `violation_types` contains it. |
| `limit` / `offset` | Default 30, max 100. |

Response:
```json
{
  "articles": [ { "guid": "fr:2026-17726", "source": "federal_register", "category": "rules",
                  "doc_type": "Rule", "title": "…", "link": "…", "pdf_url": "…", "citation": "91 FR 55744",
                  "action": "Final rule.", "effective_on": "2026-09-30", "comments_close_on": null,
                  "scheduled_on": null, "published_at": "2026-08-31", "description": "…",
                  "docket_ids": ["…"], "company": null, "city": null, "state": null, "naics": null,
                  "penalty_usd": null, "violation_types": [], "general_duty": 0, "unmapped_standards": 0,
                  "cfr_parts": [{"title": 29, "part": "42"}], "sections": [],
                  "takeaways": [{"key": "action", "label": "Action", "text": "…"}],
                  "snippet": null } ],
  "total": 42,
  "offset": 0
}
```
`state`, `min_penalty` and `gravity` only match enforcement rows. Combined with `category=all`, they narrow the feed to enforcement. Unknown `category` / `gravity` values give a 422.

### `GET /api/news/status`
What the page needs before it renders anything. It is **read-only and never triggers a sync**: freshness is computed with `news_schedule` (Stage 4 · Phase 1 · Part 1) over `news_store.sync_rows()`.
```json
{
  "dol_configured": false,
  "sync_enabled": true,
  "agencies": ["occupational-safety-and-health-administration"],
  "syncing": false,
  "due": false,
  "sources": {
    "federal_register": {
      "enabled": true, "last_ok_at": "2026-11-16T11:20:00+00:00", "last_count": 4,
      "last_error": null, "last_error_at": null, "fail_count": 0,
      "stale": false, "retry_after": null, "next_due_at": "2026-11-17T06:15:00-05:00"
    },
    "federal_register_pi": { "enabled": true, "…": "same fields" },
    "dol_osha": { "enabled": false, "…": "same fields; all null/false while no key is set" }
  },
  "counts": {"all": 53, "rules": 9, "rulemaking": 4, "enforcement": 0, "public_inspection": 3, "notices": 37}
}
```
- `stale`: `news_schedule.is_stale` (a publication window passed since `last_ok_at`, or 24h for DOL).
- `retry_after`: the end of the current backoff, or `null`.
- `next_due_at`: when the source next becomes stale. That is the next window (FR/PI) or `last_ok_at + 24h` (DOL), or `retry_after` while backing off.
- `due` (top level): true when any **enabled** source is stale and not in backoff. The page uses it to decide whether to ask for a sync on open.

### `GET /api/news/facets`
States present among enforcement rows, with counts, for the state dropdown: `{"states": [{"code": "TX", "count": 12}, …]}`, sorted by code.

### `POST /api/news/refresh`
Body `{"force": false}` (the default) or `{"force": true}`. Calls `news_worker.request_sync(force)` and returns immediately; the sync runs on the worker thread.
- `force: false` is **refresh-on-open**: it queues only the sources that are due (stale and not in backoff). Returns `202 {"queued": ["federal_register_pi"]}`, or `200 {"queued": []}` when nothing is due.
- `force: true` is the **Refresh / Retry buttons and the "Refresh news" command**: it queues every enabled source, ignoring staleness and backoff. Returns `202 {"queued": [...]}`.
- `409` if a sync is already running, and `503` if `NEWS_SYNC` is off (no worker exists to wake).

### `GET /api/news/section/{section_id:path}` and `GET /api/news/part/{part}`
For the reader's activity button (Stage 3 · Phase 1). Both take `?title=29` (default 29; any other title returns an empty result while OSHA is the only agency). They return `{"section_id"|"part", "count", "articles": [...]}` with at most 15 articles, newest first, in the same article shape as above.
- A **section** matches citations of that exact section, plus part-level references to its part.
- A **part** matches any citation within the part.

## 4. Acceptance Criteria
- [ ] `news_router` is included before `title_router`, and `GET /api/news/section/1910.1030` returns 200.
- [ ] Every endpoint returns empty, well-formed results on a fresh install with no news database.
- [ ] JSON columns come back as arrays or objects, never strings.
- [ ] `status.dol_configured` reflects `config.dol_api_key()` at request time.
- [ ] `refresh` never runs a sync on the request thread.
- [ ] No GET endpoint ever queues or runs a sync.
- [ ] `refresh` with `force: false` queues nothing when every source is fresh or backing off.
