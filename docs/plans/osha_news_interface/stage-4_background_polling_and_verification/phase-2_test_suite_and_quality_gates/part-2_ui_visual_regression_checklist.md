# Stage 4 · Phase 2 · Part 2: UI Verification Checklist

## 1. Objectives
A manual pass in the running app (dark and light themes; panel widths ~1400, ~900 and ~600px; with and without `DOL_API_KEY`), run after Stages 2 and 3 land and before the docs are updated.

## 2. Checklist

### Shell
- [ ] The rail order is Overview · Home · Contents · Projects · **News** · Library · Settings. News is lit on `#/news` and nowhere else.
- [ ] **G N**, **Alt/⌥+5** and the commands list ("Go to News", "Refresh news") all work. The cheatsheet says 1–7.
- [ ] A pinned drawer retracts on `#/news` and comes back when you leave. Under 900px the rail is a bottom bar with News in it.
- [ ] `#/title/29/news` shows not-found.

### Newsroom
- [ ] The first run with an empty DB shows the busy state, then fills in without a reload.
- [ ] With the network off (or FR blocked): error text and **Retry**. With rows already present: the stale note.
- [ ] The breaking banner appears only when a qualifying item exists, is 36px and one line, and has an SVG icon (no emoji).
- [ ] The hero isn't repeated in the feed. Below 800px of panel width the grid is one column.
- [ ] Tabs: the labels match the plan, show counts, follow the URL, and work with ←/→ and Home/End.
- [ ] Without a key, Enforcement shows the setup card with a working dataportal.dol.gov/registration link.
- [ ] Search: debounced, highlights with `<mark>`, finds `§ 1910.1030` and `91 FR …`, and combines with tabs and facets.
- [ ] Facets appear only on Enforcement with a key. The state list matches the data.

### Cards
- [ ] Every card has exactly three bullets with sensible fallbacks (check a notice with no CFR refs and an inspection with no penalty).
- [ ] FR cards: the FR citation in the kicker, effective date or comment deadline, PDF button, part chips.
- [ ] Enforcement cards: a tabular `$` figure, state, `§` chips, General Duty / state-plan counts when present.
- [ ] A chip to Title 29 opens the reader at the right section or part. With Title 29 removed, chips go to the library.
- [ ] No `statPill` is used for penalties or citations.

### Reader
- [ ] § 1910.1030 (or any section with matches): "N rules & citations" appears after Pin, after the text has painted.
- [ ] Stepping clause by clause makes no new requests (check the Network tab).
- [ ] The popover opens and closes with mouse and keyboard (Esc returns focus) and closes on navigation. "See all in News" lands on a filtered view with the chip.
- [ ] Title 40 and 49 pages never show the button. A section with no matches shows nothing.
- [ ] With the news DB deleted, the reader looks exactly as before.

### Sync behaviour (watch the server log or the Network tab)
- [ ] Right after startup: one FR request (the full retention window) and one PI request; DOL only with a key.
- [ ] Opening `#/news` on fresh data sends no `POST /api/news/refresh`.
- [ ] After a publication window passes (or with `last_ok_at` edited back in the DB), opening `#/news` sends one POST with `force: false`. The header shows "Checking for news…", and new items appear without a reload.
- [ ] With FR blocked: the error shows, "retrying in …" counts up through 5m / 15m / 1h, and **Retry** (`force: true`) syncs at once despite the backoff.
- [ ] The Settings row shows the last update and the next check.
- [ ] Over a weekend, the server log shows no FR or PI requests.

### Quality gates
- [ ] A second visit paints from cache. Revalidating with no changes causes no flicker or scroll jump.
- [ ] Contrast meets AA for kicker, byline, chip and timeline text in both themes (measured).
- [ ] `prefers-reduced-motion`: no transitions or animations on News.
- [ ] `cd reader && ../.venv/bin/python -m pytest tests -q` passes 100%.
- [ ] `CLAUDE.md`, `README.md`, `reader/README.md`, `reader/API.md` and `reader/.env.example` describe what shipped.
