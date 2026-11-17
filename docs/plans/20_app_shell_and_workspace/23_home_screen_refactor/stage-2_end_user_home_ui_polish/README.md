# Stage 2: End-User Home Screen UI Polish (`#/`)

## Goal
Refactor `views/home.js` and `styles/05_home_overview_lib.css` into a calm, zero-jargon, 3-band Home screen designed for non-developer compliance users—elevating **Downloaded Titles** above the fold as a living local snapshot and removing redundant search/setup chrome.

---

## Layout & Component Architecture

### Removed Clutter & Developer Chrome
- **Delete `.hm-launch` card**: Removes the duplicate `#hm-jump-input` search box (topbar `#search` `⌘K`/`/` already serves global search), the `Commands` palette chip, the `Connections` chip, and the inline `Ask Claude` setup block (topbar `#chat-toggle` `⌘J` handles Claude).
- **Remove `"Import JSON"` & shortcut tip from Home**: Keep import/export inside `#/projects` and the drawer; Home’s Workspaces card presents plain user language (`"Organize program compliance"` + **`+ New workspace`**).
- **Remove `"DOL inspection sync is off · Add free DOL key"` footer**: Home shows only locally cached regulatory updates; DOL configuration remains inside `#/news` and `#/settings` / `#/help`.
- **Deduplicate `"Contents"` buttons**: Keep a clean single entry on title cards/actions without repeating `"Contents"` in multiple hero panels.

### 3-Band Layout Hierarchy

1. **Masthead (`.hm-head`) + Conditional Transfer Strip (`.hm-transfer`)**
   - `Home` heading + plain summary (`"3 titles ready offline · Edition Jan 2, 2026"`).
   - Two restrained actions: **`+ New workspace`** and **`Manage library`** (`#/library`).
   - `.hm-transfer` appears only while `state.jobs.current || state.jobs.queued.length` is active, linking directly to `#/library`.

2. **Band 1 — Active Work (`.hm-top`: 58% Continue Reading | 42% Workspaces)**
   - **Continue Reading (`.hm-resume`)**:
     - Shows title/part/clause context (`29 CFR · Part 1910 · Clause (b)`), bold section title (`§ 1910.1200 Hazard communication.`), one primary **`Resume reading`** CTA (plus optional Part link, and optional quiet `"Ask Claude"` button if user approves Open Question #3 and Claude is configured), and up to 2 recent-trail links + **`Full history`** (opens the Recent drawer).
     - When no reading history exists yet: shows a 3–4 item **"Start here"** strip of curated starting parts from `HOME_CONTENT` across installed titles (or `title_blurbs` fallback).
   - **Workspaces (`.hm-ws`)**:
     - Elevated into the top band beside Continue Reading.
     - Displays up to 3 most recently updated workspaces (`projDot`, title, section count, updated relative time, and up to 3 clickable pinned section pills) + **`All workspaces`** (`#/projects`).
     - Empty state: `"Organize program compliance"` + `"Pin sections and notes for an audit, safety program, or permit review."` + **`+ New workspace`**.

3. **Band 2 — Downloaded Titles Living Snapshot (`.hm-titles`, visible above the fold on `1280×800`)**
   - Renders immediately from `state.installedTitles` (and `HOME_CONTENT`), then hydrates cleanly from `GET /api/titles/snapshot` (`data-snapshot-loaded="1"`), keeping zero external network calls.
   - Each card (`.hm-title-card`, 1–3 column responsive grid) has 3 clean zones:
     - **Top**: `29 CFR` · agency badges (`OSHA · WHD · EBSA`) + calm freshness/coverage pill (`Jan 2`, `Partial · 2 parts`, `Update available` if `navLib.data` knows it is stale, or `Downloading`).
     - **Middle**: Title name (`Labor` → `#/title/29/`), 1-line scope summary from `title_blurbs`, and up to 3 clickable part chips:
       - Whole titles (with `HOME_CONTENT` entries): curated key parts (`1910 General Industry`, `1926 Construction`, `541 Overtime`).
       - Partial titles: actual downloaded `scope_parts` so users never click a part they haven't downloaded.
       - Other titles (1–50 without `HOME_CONTENT`): clean `"Browse contents"` action opening the Contents drawer for that title.
     - **Bottom (Living Signal)**: One contextual row from real local state—prioritizing last read section in that title (`Last read § 1910.1200 · 1h ago`), active workspace usage (`Used in HazCom Program`), or recent OSHA updates for Title 29 (`4 recent OSHA items`)—paired with a 2px hairline progress track (`read / section_count`).

4. **Band 3 — Regulatory Pulse (`.hm-news`, quiet digest below Downloaded Titles)**
   - Renders up to 3 compact rows from local `/api/news?limit=3` & `/api/news/status` (`data-news-loaded="1"`): category kicker, date, headline linking to `#/news?cat=...`, and clickable CFR chips (`§ 1910.7`) opening straight in the reader.
   - If no local news is cached yet: collapses to a quiet single-line bar (`"No local OSHA news cached yet"` + **`Open Newsroom`** → `#/news`).

---

## Files Modified
- `reader/frontend/src/views/home.js`
- `reader/frontend/src/styles/05_home_overview_lib.css`
- `reader/frontend/src/views/projects.js` (optional copy softening if approved)
- Rebuilt committed bundle: `reader/static/dist/{app.js,app.css,index.html,build-stamp.json}`

## Exit Gate
- `npm run build && npx tsc --noEmit` succeed with 0 errors.
- On `1280×800` dark and light themes, Band 1 and Band 2 render completely above the fold with zero horizontal overflow, zero clipped text, and tokens-only CSS.
- Container queries (`@container hm`) collapse cleanly at `860px` and `560px`.
