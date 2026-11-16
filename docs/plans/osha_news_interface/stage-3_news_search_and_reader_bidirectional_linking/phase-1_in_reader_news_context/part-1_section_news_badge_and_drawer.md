# Stage 3 · Phase 1 · Part 1: Reader Activity Button & Popover

## 1. Objectives
On a section or part page, show whether the Federal Register or OSHA enforcement has touched it, without slowing the page or adding clutter. Clicking the button opens a popover with the timeline (Part 2).

## 2. Placement (decision 3)
- A button in the page's **actions row (`.doc-actions`), immediately after the Pin button** (`pinButtonHtml()`). This applies both to the section page (`loadSection`) and the part page (`loadPart`).
- Rendered **hidden** with the rest of the row, then filled in after the page has painted:
  ```html
  <button type="button" class="btn" id="btn-news-activity" aria-haspopup="dialog" aria-expanded="false" hidden>
    <svg …news icon…></svg><span>3 rules &amp; citations</span>
  </button>
  ```
- The label is the count of items: "1 rule or citation" / "N rules & citations". There's no dot or pill, since the row's other buttons have none either.
- Only on **Title 29** pages (the only title with news while OSHA is the only agency). On other titles no request is made and the button stays hidden.
- It stays hidden when the count is 0, the request fails, or the news database is empty. The reader never shows a news error.

## 3. Loading
```javascript
const newsActivityCache = new Map();   // "29|1910.1030" or "29|part:1910" -> response; for the session

async function fillNewsActivity(kind, id, seq) {
  if (currentTitle !== 29) return;
  const key = `29|${kind === 'part' ? 'part:' : ''}${id}`;
  let data = newsActivityCache.get(key);
  if (!data) {
    try {
      data = await getJSON(kind === 'part'
        ? `/api/news/part/${encodeURIComponent(id)}?title=29`
        : `/api/news/section/${encodeURIComponent(id)}?title=29`);
    } catch (e) { return; }                   // silent: the reader works without news
    newsActivityCache.set(key, data);
  }
  if (seq !== routeSeq) return;               // the reader moved on
  const btn = document.getElementById('btn-news-activity');
  if (!btn || !data.count) return;
  btn.querySelector('span').textContent =
    data.count === 1 ? '1 rule or citation' : `${data.count} rules & citations`;
  btn.hidden = false;
}
```
- Called once per section load, **not** per clause. In unit view, stepping through clauses re-renders the unit but reuses the cache, so stepping makes no requests.
- Not awaited by the page loader, so it never delays the section text.

## 4. Popover
- Built like the Pin popover (`openPinMenu` / `closePinMenu`): `--pop` surface, `--shadow-pop`, anchored under the button, max-width 420px, max-height 60vh with internal scroll.
- It closes on Esc, an outside click or `hashchange`, and focus returns to the button.
- `role="dialog"` with `aria-label="Federal Register and OSHA activity for § 1910.1030"`; the button's `aria-expanded` follows it.
- Content: the timeline from Part 2, then a footer link **See all in News** → `#/news?section=1910.1030`, or `#/news?part=1910` from a part page.

## 5. Acceptance Criteria
- [ ] The button shows only on Title 29 section and part pages with at least one item, and never delays the section text.
- [ ] Section pages count exact-section citations plus part-level FR references. Part pages count everything in the part.
- [ ] Stepping clause to clause makes no extra requests.
- [ ] The popover is keyboard operable, closes on Esc and on navigation, and returns focus to the button.
- [ ] With the news database missing or a request failing, the reader looks exactly as it does today.
