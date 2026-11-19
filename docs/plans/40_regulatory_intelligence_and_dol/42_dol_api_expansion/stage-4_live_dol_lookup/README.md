# Stage 4: Live Archive Lookup (`⌘K` & `#/news`), Workspaces & Local Claude Tool

## Goal
Let users search **historical and national OSHA inspections beyond local synced rows** directly against `apiprod.dol.gov/v4`—with `sort_by`, date-range, minimum-penalty, `hazsub1`–`hazsub5` substance labels, and `offset` paging—while connecting saved DOL intelligence straight into **Workspaces** and **Claude** with zero extra live API calls.

---

## Hard Rate-Limit & Gateway Rules (Verified 2026-11-17)

1. **Never query DOL on keystroke (`input`):** Live lookup runs **only on explicit submit** (`Enter` or Search button click).
2. **Shared Pacer + TTL Cache + Cooldown:**
   - Cache normalized `(mode, query, state, naics, hazsub, standard, since, min_penalty, sort_by, offset)` payloads in memory (10-minute TTL, bounded LRU `maxsize=64`) and rely on `_dol_get()`'s shared `429` circuit breaker.
3. **2 KB Gateway URL Limit:** Keep `fields` compact, `limit=25`, and cross-join matching `activity_nr`s in batches `<= DOL_INSP_BATCH` (`50`).
4. **Auto-Save on Open:** Clicking any live result opens `#/news/inspection/{activity_nr}` and caches it locally in `enforcement_cases`.

---

## Implementation Plan

### 1. Live DOL Query Client & Substance Labels (`reader/app/news.py`)
1. Add `search_dol_inspections(c, key, *, estab_name=None, naics=None, state=None, since=None, sort_by="open_date", offset=0, limit=25)` against `OSHA/inspection` (verify exact `filter_object` string operator `like`/`eq` with 1 live test call before implementation).
2. Add `search_dol_violations(c, key, *, standard=None, hazsub=None, state=None, min_penalty=None, since=None, offset=0, limit=25)` against `OSHA/violation` (inverse prefix of `normalize_dol_standard`, e.g., `"1910.147"` → `"19100147"`, or `hazsub1`–`hazsub5` / `hazcat`), batch-joining `OSHA/inspection` rows.
3. Include a lean OSHA `HAZSUB_LABELS` map covering the top ~30–50 common OSHA substances (silica, lead, asbestos, formaldehyde, hexavalent chromium, etc.), falling back cleanly to raw codes when unmapped.

### 2. Search API Endpoint (`reader/app/routers/news.py`)
1. Add `GET /api/news/dol/search` on `news_router` (mounted before `title_router`):
   - Params: `q`, `mode` (`employer | naics | standard | hazsub`), `state`, `since`, `min_penalty`, `sort_by` (`open_date | penalty`), `offset` (`>= 0`), `limit` (`1..25`).
   - Returns `503` cleanly when `DOL_API_KEY` is missing or during `429` cooldown, and `"cached": true` on TTL hits.

### 3. `#/news` Live Archive & `⌘K` Integration (`views/news.ts`, `components/search_bar.ts`, `components/palette.ts`)
1. Add an explicit-submit **"Search full DOL archive"** bar on `#/news?cat=enforcement` with mode selector, state/date-range/min-penalty filters, and `"Load next 25"` pagination (`offset`).
2. Add `dol:` prefix + `> Search DOL Inspections...` in `⌘K` (`search_bar.ts` / `palette.ts`) showing a local instruction row while typing (**0 network calls per keystroke**) and executing on `Enter`.

### 4. Workspace Case Clipping & Local Claude Tool (`views/news_case.ts`, `core/projects_store.ts`, `app/chat.py`)
1. **Workspaces (`framework_projects_v1`):** Add a **"Clip Case to Workspace"** action on `#/news/inspection/{activity_nr}` saving the establishment, `activity_nr`, penalty delta, and cited `29 CFR` links into the selected Subject Workspace.
2. **Local-Only Claude Tool (`reader/app/chat.py`):** Add `search_enforcement` to `TOOLS` querying `osha_news.sqlite3` (`articles`, `enforcement_narratives_fts`, `paragraph_enforcement_stats`, `naics_summary`) — **never** touching `apiprod.dol.gov` — and explicitly label tool results and prompt rules as a **local cached sample** rather than nationwide OSHA rates.

---

## Exit Gate
- Typing `dol: amazon` in `⌘K` triggers **0** HTTP calls until `Enter` is pressed; repeating within TTL hits server cache (`0` upstream calls).
- Pagination (`offset=25`) and `hazsub1`–`hazsub5` queries behave deterministically under `FakeAPI`.
- Clipping an inspection case persists cleanly in `framework_projects_v1`; `chat.py` `search_enforcement` tests pass 100% offline.
- Update `reader/tests/snapshots/route_inventory.json` and `reader/API.md`; pass `REQUIRE_BROWSER=1 pytest tests -q`.
