# Stage 2 · Phase 1 · Part 3: Route, Activity Rail & App-Shell Integration

## 1. Objectives
Make `#/news` a first-class page of the existing shell: router, activity rail, keyboard shortcuts, the commands list and drawer behaviour. Follow the patterns Projects and Library already use; the names below are the current ones in `static/app.js` and `static/index.html`.

## 2. Router (`handleRoute`)
- A branch beside Projects: `else if (!titleMatch && (checkPath === '/news' || checkPath === '/news/'))` → `await loadNews(params)`. (`parseHash()` already splits the query into `params`.) Like `#/projects`, News is cross-title and **never** takes a `#/title/{n}/` prefix. `#/title/29/news` falls through to `renderNotFound()`.
- `loadNews(params)` captures `routeSeq` and bails after every `await` if it changed. It calls `setViewHead('')`, `clearTreeSelection()` and `enterView()`, and sets `document.title = 'News · FRAMEWORK'`.
- Changing tabs, filters or the query rewrites the hash with `replaceState`. A tab change uses `location.hash =` so it gets its own history entry. Either way the page re-renders in place, without a full route transition.

## 3. Activity rail (`index.html`, "Navigation" in `app.js`)
- New item **between Projects and Library**, a **link** like Overview and Home (not a drawer-panel button):
  ```html
  <a class="ar-btn" data-target="news" href="#/news" aria-label="News" data-tip="News" data-keys="G N">
    <svg …>…</svg>   <!-- literal stroked 16px SVG, same as the other rail icons -->
  </a>
  ```
  Add a matching `news` path to `ICON_PATHS` (a folded newspaper, stroked, 16px grid) for use in the page.
- `NAV_TARGETS = ['overview', 'home', 'reader', 'projects', 'news', 'library', 'settings']`.
- `GO_KEYS` gains `n: 'news'`. The Alt/⌥ digit handler's regex becomes `/^Digit[1-7]$/`. Update the cheatsheet text (`'⌥ 1–7'` / `'Alt 1–7'`) and the comment above `NAV_TARGETS` ("Alt+1…7").
- `routeTarget()`: `if (rest.startsWith('/news')) return 'news';` before the `'reader'` fallback. The rail then lights News with `aria-current="page"` on `#/news`.
- `goTarget('news')` navigates to `#/news`. Re-clicking it while on `#/news` scrolls the page to the top and does nothing else (no Recent panel, unlike Overview and Home).
- Rail arrow-key navigation (↑↓ / ←→ as a bottom bar, Home/End) picks up the new item automatically from DOM order. Verify it does.
- No badge on the News icon (out of scope; see the master plan).

## 4. Drawer behaviour (`syncNavToRoute`)
- `#/news` behaves like Overview: a pinned drawer **retracts** for the page's width (`html.drawer-retracted`, not persisted), and an open Library or Projects panel is closed.
- Leaving `#/news` restores the drawer as Overview does today.

## 5. Commands list (`commandList`, `>` in the search box)
- `['Go to News', '#/news', 'G N']`
- `['Refresh news', 'cmd:news-refresh', '']`: POSTs `/api/news/refresh` with `{"force": true}` and toasts "Checking for news…". On a 409 it toasts "Already checking for news". On a 503 it toasts "News sync is off".

## 6. Settings panel
One read-only row under a "News" label:
- "Federal Register: on" (always);
- "DOL enforcement: on" or "off: add DOL_API_KEY to reader/.env";
- "Last update {relative time} · next check {relative time}" (`next_due_at`, the earliest among enabled sources). A source that is backing off shows its error and "retrying {relative retry_after}" instead.

Nothing here is editable from the UI. Keys stay in `.env`, the same as `ANTHROPIC_API_KEY`.

## 7. Existing tests that change
`tests/test_sidebar_rail.py` pins the rail order and which items are links. Update it:
- expected targets → `["overview", "home", "reader", "projects", "news", "library", "settings"]`;
- link items → `("overview", "home", "news")`. Button items stay `("reader", "projects", "library", "settings")`;
- `test_rail_items_have_labels_and_shortcuts` (line ~55) allows only `G [OHCPLS]`; it becomes `r'data-keys="G [OHCPNLS]"'`;
- add: `GO_KEYS` contains `n: 'news'`, and the Alt digit regex covers 1–7.

## 8. Acceptance Criteria
- [ ] `#/news` loads from the rail, from **G N**, from **Alt/⌥+5** and from the commands list.
- [ ] Exactly one rail item is lit on `#/news` (News), and the drawer retracts the way it does on Overview.
- [ ] `#/title/29/news` shows not-found.
- [ ] Navigating away mid-load never paints News over the next page.
- [ ] `test_sidebar_rail.py` passes with the updated expectations, and every other test passes unchanged.
