# Stage 2: Contested Reductions & Failure-to-Abate (FTA) Analytics

## Goal
Turn OSHA's penalty reduction history, contested settlement events, and Failure-to-Abate (`fta_*`) enforcement signals into structured UI affordances inside **Inspection Case Files** (`#/news/inspection/{activity_nr}`), the **Enforcement Briefing Strip** (`#/news?cat=enforcement`), and **Title 29 Section/Part Reader Context** without inflating noisy badges.

---

## Verified DOL Fields Available (`HTTP 200 OK`)

1. **From `OSHA/violation`**:
   - `initial_penalty`, `current_penalty`
   - `contest_date`, `final_order_date`
   - `abate_date`, `abate_complete`
   - `fta_insp_nr`, `fta_issuance_date`, `fta_penalty`, `fta_contest_date`, `fta_final_order_date`
2. **From `OSHA/violation_event`**:
   - `activity_nr`, `citation_id`, `pen_fta`
   - `hist_event`, `hist_date`, `hist_penalty`, `hist_abate_date`, `hist_vtype`, `hist_insp_nr`

> [!NOTE]
> Per `CLAUDE.md` design rules, `statPill()` is reserved exclusively for sync/download status (`synced` / `stale` / `busy` / `partial` / `uninstalled`). Penalty changes, FTA flags, and contested markers must render as plain hairline tags or tabular typographic indicators (e.g., `.ins-viol-pill`), never status dots.

---

## Implementation Plan

### 1. Case-Level Reduction & FTA Computation (`reader/app/news.py`)
1. Expand `build_enforcement_article()` and `fetch_inspection_case()` field selection (already fetching `fta_*` and `violation_event`) to compute a normalized per-inspection summary:
   - `initial_total`, `current_total`, `reduction_usd`, `reduction_pct`
   - `contested_count`, `fta_count`, `fta_total_usd`
   - Normalized `events` entries paired back to `citation_id` so citations show inline revision context (`Amended from Serious to Other-than-Serious` / `-$4,900`).
2. Add `fta_issuance_date`, `fta_penalty`, and `fta_insp_nr` into `violations_list` JSON stored in `enforcement_cases`.

### 2. SQLite Aggregates & Per-Section Enforcement Stats (`reader/app/news_store.py`)
1. Extend `enforcement_summary(con)` to compute from cached cases:
   - `fta_cases`, `fta_total_usd`
   - `contested_cases`, `total_initial_usd`, `total_current_usd`, `avg_reduction_pct`
   - Top FTA / contested filter presets.
2. Add `section_enforcement_stats(con, section_id)` and `part_enforcement_stats(con, part)` aggregating citation count, average penalty, high-gravity ratio, and FTA occurrences for a Title 29 section/part.

### 3. API Extensions (`reader/app/routers/news.py`)
1. Extend `GET /api/news/enforcement/summary` response with optional additive keys (`total_initial_usd`, `total_current_usd`, `contested_cases`, `fta_cases`, `fta_total_usd`) — ensure backward compatibility for existing consumers.
2. Extend `GET /api/news/section/{section_id:path}` and `GET /api/news/part/{part}` with a lightweight `"stats"` object (`case_count`, `avg_penalty`, `fta_count`) read from `enforcement_cases` / `articles`.

### 4. Frontend Rendering (`views/news.js`, `components/news_activity.js`, `10_news.css`)
1. **Case File (`renderInspectionCase`)**:
   - Under `CURRENT PENALTY`, display net reduction delta when `initial_total > current_total` (e.g., `Initial $63,700 · -$18,900 (-30%) settled`).
   - Add hairline `Contested` / `FTA +$X` tags in `.ins-table` rows with tooltips/event drilldown; link `fta_insp_nr` to `#/news/inspection/{fta_insp_nr}`.
2. **Enforcement Briefing Strip (`enforcementSummaryHtml`)**:
   - Surface contested reduction & FTA summary figures inside the existing `4`-card metric grid sublines or subtle secondary toggle without bloating vertical height.
3. **Reader Activity Popover (`newsTimelineHtml`)**:
   - Show a compact header line when enforcement stats exist (`Avg penalty $X · N FTA`), keeping rows scannable.

---

## Exit Gate
- Unit tests verify reduction %, FTA aggregation, and `pen_fta` event pairing with zero division-by-zero on `$0` initial penalties.
- Snapshot tests pass (`test_api_snapshots.py`).
- `test_news_frontend.py` passes (zero `#hex` colors, zero forbidden glyphs, zero misused `statPill()`).
- Full browser + Python suite (`REQUIRE_BROWSER=1 pytest tests -q`) passes after rebuild.
