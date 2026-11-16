# Stage 2 · Phase 1 · Part 1: Breaking Banner & Lead Story Hero

## 1. Objectives
The top of `#/news` (`renderNews` in `app.js`): an optional breaking banner, a lead hero card, then the feed. It must also cover the states before any data exists.

## 2. What goes where (decided client-side from `/api/news` + `/api/news/status`)
- **Breaking banner**: at most one line, and only when something qualifies:
  1. the newest Public Inspection filing filed within the last 3 days, else
  2. the newest enforcement item with `penalty_usd >= 50000` issued within the last 14 days, else
  3. nothing. The banner is hidden. No filler.
- **Lead hero**: the newest Final Rule published within 30 days, else the newest item of any kind. It is excluded from the feed below so it doesn't appear twice. On a tab other than *All*, the hero is that tab's newest item.
- **Feed**: everything else on the current tab, as cards (Phase 2) in a grid. Paged with a "Load more" button (`offset`), not infinite scroll.

## 3. Wireframe
Icons are `icon()` SVGs (shown here as `[i:name]`). No emoji or Unicode arrows.
```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [i:activity] PUBLIC INSPECTION · Nov 16  NRTL: expansion of recognition, filed at OFR    [i:chevronRight] │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ FINAL RULE · 91 FR 55744                                                                    │
│ Rescission of Coordinated Enforcement Regulations                                          │
│ Aug 31, 2026 · Federal Register                                                             │
│                                                                                            │
│   Action      Final rule. Rescinds obsolete coordination procedures across WHD, OSHA, ETA. │
│   CFR         [29 CFR Part 42]                                                              │
│   Dates       Effective Sep 30, 2026 · Docket ETA-2025-0003                                 │
│                                                                                            │
│ [Federal Register [i:external]]  [PDF [i:external]]  [Open 29 CFR Part 42]  ← .btn-accent      │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```
The banner is a link: to the PI document on federalregister.gov, or to the card for an enforcement item (`#/news?cat=enforcement` with the card scrolled into view).

## 4. Empty, loading and error states
Driven by `/api/news/status`:
| State | What shows |
| :--- | :--- |
| First sync running, no rows | `statPill('busy', 'Fetching from the Federal Register…')` and a short note that this takes a few seconds. `watchNewsSync()` (Stage 4 · Phase 1 · Part 2) polls status until done. |
| Sync failed, no rows | The error text from `sources.*.last_error`, "Retrying {relative retry_after}", and a **Retry** button (`POST /api/news/refresh {"force": true}`). |
| `NEWS_SYNC` off | "News sync is off. Set `NEWS_SYNC=1` in `reader/.env` and restart." No Refresh/Retry buttons. |
| Has rows, a sync running (refresh-on-open or scheduled) | Normal page, and the header dateline reads `statPill('busy', 'Checking for news…')`. New items appear in place when it finishes. |
| Has rows, last sync failed | Normal page, plus a small note in the header: `statPill('stale', 'Last update failed · showing data from {date}')`. |
| Has rows, all good | Header dateline: `statPill('synced', 'Updated {relative time}')` and a **Refresh** button (`.btn .btn-sm`, `{"force": true}`). |

"Updated" uses the newest `last_ok_at` among enabled sources. Opening the page on stale data asks for a sync (`{"force": false}`) without the user doing anything (Stage 4 · Phase 1 · Part 2).

## 5. CSS (`reader/static/styles.css`, new "News" section)
Tokens only. The 36px banner uses `--danger` for the tag only; body text stays `--fg`.
```css
.news-front { container: news / inline-size; }

.news-breaking {
  display: flex; align-items: center; gap: 10px;
  height: 36px; padding: 0 12px; margin-bottom: 20px;
  background: color-mix(in srgb, var(--danger) 8%, var(--field));
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: var(--r-6);
  font-size: 13px; color: var(--fg); text-decoration: none;
}
.news-breaking-tag {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  font-size: 11px; font-weight: var(--w-semibold); letter-spacing: .06em; text-transform: uppercase;
  color: var(--danger);
}
.news-breaking-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.news-hero {
  display: flex; flex-direction: column; gap: 12px;
  padding: 22px 24px; margin-bottom: 28px;
  background: var(--card); border: 1px solid var(--line); border-radius: var(--r-8);
}
.news-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@container news (max-width: 800px) { .news-grid { grid-template-columns: minmax(0, 1fr); } }
```
Check that `--danger` text on the tinted banner meets AA in both themes. If it doesn't, use `--fg-strong` for the tag text and keep the red only in the icon.

## 6. Acceptance Criteria
- [ ] The banner appears only when an item qualifies (rules in §2), is one line, and truncates with an ellipsis.
- [ ] The hero is not repeated in the feed.
- [ ] All five states in §4 render, and none of them throws when `/api/news` returns nothing.
- [ ] Below 800px of panel width (container query, not viewport), the grid is one column.
