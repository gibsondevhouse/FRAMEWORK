# Stage 2: Contested Reductions, Abatement & Paragraph-Level Hotspots

## Goal
Turn OSHA's penalty reduction history, contested settlement events, Failure-to-Abate (`fta_*`) flags, open abatement deadlines (`abate_complete` / `abate_date`), and decoded paragraph citations (`parse_dol_standard()`) into structured insights inside **Inspection Case Files**, the **Enforcement Briefing Strip**, and **Title 29 Section/Part Reader Context**.

---

## Verified DOL Fields Available (`HTTP 200 OK`)

1. **From `OSHA/violation`**:
   - `initial_penalty`, `current_penalty`
   - `contest_date`, `final_order_date`
   - `abate_date`, `abate_complete`
   - `fta_insp_nr`, `fta_issuance_date`, `fta_penalty`, `fta_contest_date`, `fta_final_order_date`
   - `standard` (decoded by `parse_dol_standard()` into `(section_id, para)`, e.g., `1910.1030` + `(g)(2)(ii)(A)`)
2. **From `OSHA/violation_event`**:
   - `activity_nr`, `citation_id`, `pen_fta`
   - `hist_event`, `hist_date`, `hist_penalty`, `hist_abate_date`, `hist_vtype`, `hist_insp_nr`

> [!NOTE]
> Per `AGENTS.md` Rule 9, `statPill()` is reserved exclusively for sync/download status (`synced` / `stale` / `busy` / `partial` / `uninstalled`). Penalty deltas, FTA flags, open abatements, and paragraph hotspots render as plain hairline tags or tabular typographic cues, never status dots.

---

## Implementation Plan

### 1. Case-Level Reduction, Abatement & FTA Computation (`reader/app/news.py`)
1. Expand `build_enforcement_article()` and `fetch_inspection_case()` to compute normalized per-inspection metrics:
   - `initial_total`, `current_total`, `reduction_usd`, `reduction_pct` (safe on `$0` initial penalties)
   - `contested_count`, `fta_count`, `fta_total_usd`, `open_abate_count`, `overdue_abate_count`
   - `events` paired back to `citation_id` for inline revision context (`Amended from Serious to Other-than-Serious · -$4,900`).
2. Persist `fta_issuance_date`, `fta_penalty`, `fta_insp_nr`, `abate_date`, and `abate_complete` in `violations_list`.

### 2. SQLite Aggregates & Paragraph Citation Hotspots (`reader/app/news_store.py`)
1. Extend `enforcement_summary(con)` with additive fields:
   - `fta_cases`, `fta_total_usd`, `contested_cases`, `open_abate_cases`, `total_initial_usd`, `total_current_usd`, `avg_reduction_pct`.
2. Add `section_enforcement_stats(con, section_id)` and `part_enforcement_stats(con, part)` aggregating from `enforcement_cases` / `articles` (filtering Federal vs. State Plan cleanly via `state_flag`):
   - `case_count`, `citation_count`, `avg_penalty`, `high_gravity_pct`, `fta_count`, and **`top_paragraphs`** (grouped by decoded `para` from `parse_dol_standard()`, e.g., `[{"para": "(c)(1)", "count": 14, "share_pct": 48}]`).

### 3. API Extensions (`reader/app/routers/news.py`)
1. Extend `GET /api/news/enforcement/summary` with the additive contested/FTA/abatement aggregates.
2. Extend `GET /api/news/section/{section_id:path}` and `GET /api/news/part/{part}` with an additive `"stats"` object carrying `case_count`, `avg_penalty`, `fta_count`, and `top_paragraphs`.

### 4. Frontend Rendering (`views/news.ts`, `views/news_case.ts`, `components/news_activity.ts`, `10_news.css`)
1. **Case File (`renderInspectionCase`):** Show net reduction delta under `CURRENT PENALTY`, hairline `Contested` / `FTA +$X` / `Abatement Open` tags in `.ins-table` rows, and clickable `fta_insp_nr` links (`#/news/inspection/${fta_insp_nr}`).
2. **Enforcement Briefing Strip (`enforcementSummaryHtml`):** Surface contested reduction, FTA, and open-abatement figures cleanly inside the existing 4-card metric strip.
3. **Reader Activity Popover (`news_activity.ts`):** Display compact section enforcement stats and top-cited paragraph cues using **raw counts** by default (`4 recent citations · (g)(2)`), gating `%` share behind a `>= 10` citation threshold to avoid small-sample noise, and falling back cleanly to the section page when an IMIS paragraph doesn't match a DOM `#p...` anchor.

---

## Exit Gate
- Unit tests verify reduction %, FTA aggregation, `overdue_abate_count`, and `(section_id, para)` hotspot ranking with zero division-by-zero on `$0`.
- `test_api_snapshots.py` and `test_news_frontend.py` pass (zero `#hex`, zero forbidden glyphs, zero `statPill()` misuse).
- Full browser + Python suite (`REQUIRE_BROWSER=1 pytest tests -q`) passes after `npm run build`.
