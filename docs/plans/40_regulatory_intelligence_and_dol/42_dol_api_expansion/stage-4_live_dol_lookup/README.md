# Stage 4: Live Employer / NAICS / Hazard Lookup (`⌘K` & `#/news`)

## Goal
Allow users to search **historical and national OSHA inspections beyond the 150 recently synced rows** directly against `apiprod.dol.gov/v4`—by employer name (`estab_name`), industry (`naics_code`), state (`site_state`), hazardous substance (`hazsub1`–`hazsub5`), or CFR standard (`standard`)—while strictly respecting DOL's burst `HTTP 429` limits.

---

## Hard Rate-Limit & Gateway Rules (Verified 2026-11-17)

1. **Never query DOL on keystroke (`input`)**: `apiprod.dol.gov/v4` throws `HTTP 429` on bursts. Live lookup runs **only on explicit submit** (`Enter` or Search button click).
2. **Short-lived Server Cache + Cooldown**:
   - Cache identical normalized `(kind, query, state, naics, hazsub, standard)` lookup payloads in memory (e.g., 10-minute TTL, bounded LRU `maxsize=64`) and honor a cooldown when DOL returns `429` (`Retry-After` or 60s backoff), returning a clear, graceful `503` / inline message rather than retrying aggressively.
3. **2 KB Gateway URL Limit**:
   - Use compact `fields` lists and limit results (`limit=25`), reusing `DOL_INSP_BATCH` if cross-joining inspections by `activity_nr`.
4. **Auto-Save on Open**:
   - Clicking any live lookup result routes to `#/news/inspection/{activity_nr}`, which saves the full enriched case into `enforcement_cases` in `osha_news.sqlite3` so repeat views are 100% local and instant.

---

## Implementation Plan

### 1. Live DOL Query Client (`reader/app/news.py`)
1. Add `search_dol_inspections(c, key, *, estab_name=None, naics=None, state=None, limit=25)`:
   - Queries `OSHA/inspection` with validated `filter_object` (`eq` for `site_state` / `naics_code`, supported string operator `like` or client-verified `eq`/prefix per DOL v4 API docs — verify exact string filter operator in live test with `1` call before implementation!).
   - Returns normalized preview rows (`activity_nr`, `estab_name`, `site_city`, `site_state`, `naics_code`, `open_date`, `insp_type`).
2. Add `search_dol_violations(c, key, *, standard=None, hazsub=None, state=None, limit=25)`:
   - Maps CFR inputs like `"1910.147"` to DOL's compact IMIS format (inverse prefix of `normalize_dol_standard`, e.g., `"19100147"` — verify exact `like`/prefix behavior against live DOL v4 before rollout) or queries `hazsub1`..`hazsub5` / `hazcat`.
   - Joins top matching `activity_nr`s via one batched `OSHA/inspection` call (`<= 50` IDs).

### 2. Search API Endpoint (`reader/app/routers/news.py`)
1. Add `GET /api/news/dol/search` on `news_router` (mounted cleanly before `title_router`):
   - Params: `q` (employer/keyword), `mode` (`employer | naics | standard | hazsub`), `state` (2-letter), `limit` (`1..25`).
   - Returns `503` cleanly when `DOL_API_KEY` is missing (`dol_configured: false`) or when rate-limited (`429` upstream surfaced safely without secrets).
   - Serves cached hits immediately with `"cached": true`.

### 3. `#/news` Live Search Panel (`reader/frontend/src/views/news.js` & `10_news.css`)
1. On `#/news?cat=enforcement` when a local search returns few hits or via an explicit **"Search full DOL archive"** action bar (with mode selector: *Employer*, *NAICS*, *Hazardous Substance*, *CFR Section* + *State* facet):
   - Requires explicit form submit (`data-dol-search`).
   - Renders compact preview cards linking straight to `#/news/inspection/{activity_nr}`.

### 4. Global Command Bar `⌘K` Integration (`components/search_bar.js` & `components/palette.js`)
1. Preserve fast instant CFR FTS search as default; add non-intrusive prefix **`dol:`** (plus `> Search DOL Inspections...` command in `commandItemsHtml()`):
   - While typing `dol: ...`, show a local instruction row (`Press Enter to search live OSHA inspections via DOL API`) — **zero network calls per keystroke**.
   - On `Enter`, navigate to `#/news?cat=enforcement&dol_q=...&dol_mode=...` (or fetch once into the dropdown if invoked cleanly), keeping topbar search latency `0ms` for regular CFR queries.

---

## Exit Gate
- Typing `dol: amazon` in `⌘K` triggers **zero** HTTP calls until `Enter` is pressed.
- Repeating the same query within TTL hits the server cache (`0` upstream calls in `FakeAPI` call counter test).
- Clicking a result opens `#/news/inspection/{activity_nr}` and caches it in `enforcement_cases`.
- Update `reader/tests/snapshots/route_inventory.json` and `reader/API.md`; pass `REQUIRE_BROWSER=1 pytest tests -q`.
