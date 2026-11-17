# Stage 2 · Phase 1 · Part 2: Category Tabs & Filter Box

## 1. Objectives
A segmented tab bar for the six categories, and a filter box that runs the news full-text search. Both are reflected in the URL so Back, reload and shared links work.

## 2. Tabs
Labels are fixed (the master plan uses the same ones):

```javascript
const NEWS_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'rules', label: 'Final Rules' },
  { key: 'rulemaking', label: 'Proposed Rules' },
  { key: 'enforcement', label: 'Enforcement & Penalties' },
  { key: 'public_inspection', label: 'Public Inspection' },
  { key: 'notices', label: 'Notices' },
];
```
- Markup reuses the Library's segmented control (`.lib-seg`), with `role="tablist"` / `role="tab"`, `aria-selected`, and roving `tabindex`. ←/→ move between tabs and Home/End jump to the ends, as the rail does.
- Each tab shows its count from `status.counts` in `--fg-3` tabular numerals ("Final Rules 9").
- **Enforcement is never disabled.** Without a DOL key it opens normally, and the feed area shows a setup card instead of items:
  > **Enforcement data needs a free DOL API key.** Register at dataportal.dol.gov/registration, add `DOL_API_KEY=…` to `reader/.env`, and restart FRAMEWORK. Federal Register news works without it.

  (The registration URL is a real link; the env line is in `<code>`.)
- The tab bar scrolls horizontally inside itself on narrow panels. It never wraps into two rows.

## 3. Filter box
- One `<input type="search" id="news-q">` beside the tabs. Placeholder: "Search news: keyword, company, § 1910.1030, 91 FR 55744".
- Typing is debounced 250ms, then sets `q` in the URL with `history.replaceState` (no history entry per keystroke) and reloads the feed from `/api/news?q=…`. It searches the **current tab**.
- Search stays inside `#/news` (decision 5). The topbar search box and `#/search` are untouched.
- Esc clears the box. An empty result says "No news matches "{q}" in {tab}", with a button to search *All* when a tab is active.

## 4. URL contract
`#/news?cat=enforcement&q=lockout&state=TX&min_penalty=100000&gravity=W&section=1910.147`
Every parameter is optional; the defaults are `cat=all` and no filters. `section` (or `part`) comes from the reader's "See all in News" link, and shows as a removable filter chip ("Citing § 1910.147 ×" / "Citing Part 1910 ×") above the feed. The route never takes a `#/title/{n}/` prefix (see Part 3).

## 5. CSS
Reuse `.lib-seg` as is. New rules only for layout:
```css
.news-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.news-bar .lib-seg { flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.news-q { flex: 0 1 280px; height: 28px; }  /* same control height as the rest of the app */
@container news (max-width: 640px) { .news-bar { flex-direction: column; align-items: stretch; } .news-q { flex-basis: auto; } }
```

## 6. Acceptance Criteria
- [ ] Switching tabs updates the URL and the feed. Back returns to the previous tab.
- [ ] Without a DOL key, the Enforcement tab shows the setup card with a working registration link and no errors.
- [ ] The tabs are fully keyboard operable and announce as a tab list.
- [ ] Search requests are debounced, and a slow response never paints over a newer one (`routeSeq` plus a per-request token).
