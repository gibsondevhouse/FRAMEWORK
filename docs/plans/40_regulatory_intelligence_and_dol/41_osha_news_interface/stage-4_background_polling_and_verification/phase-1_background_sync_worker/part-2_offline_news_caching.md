# Stage 4 · Phase 1 · Part 2: Stale-While-Revalidate Client Cache

## 1. Objectives
`#/news` paints immediately from the last response this browser saw, then quietly replaces it with fresh data, without jumping the page under the reader.

## 2. Rules
- **What is cached:** only the *default* view of each tab (no `q`, no facets, no `section`/`part`, offset 0), plus the last `/api/news/status`. Searches and filtered views always go to the server. That keeps the number of keys bounded at seven.
- **Keys:** `newsCache:v1:{category}` and `newsCache:v1:status`, via `lsGet` / `lsSet` (already wrapped in try/catch). Each entry is `{t: Date.now(), data}`, with articles trimmed to the first 30 to stay well under storage quotas.
- **Always revalidate.** Unlike the first draft, there is no "fresh enough, skip the fetch" path: the request is cheap and local, and skipping it hides new items for up to an hour. The cache only removes the blank first paint.
- **Repaint only when something changed.** Compare the ordered `guid` lists (plus `status.sources.*.last_ok_at`). If they're equal, do nothing. If they differ, re-render the feed and keep the scroll position: record `scrollTop` and the first visible card's `data-guid`, then after rendering scroll that card back to the same offset.
- **`routeSeq` guard** after the fetch, as every loader has.
- **Refresh-on-open** (decision 6; Stage 4 · Phase 1 · Part 1 §6): after the fresh `status` arrives, if `status.sync_enabled && status.due && !status.syncing`, POST `/api/news/refresh` with `{"force": false}`. If anything was queued, or a sync was already running, call `watchNewsSync(seq)`. GETs never start a sync; this POST is the only way opening the page asks for one.
- **`watchNewsSync(seq)`**: poll `/api/news/status` every 3s while `syncing` is true. Stop on route change (`seq !== routeSeq`) or after 2 minutes. When it finishes, re-fetch the feed and repaint only if it changed (the rule above). It shows `statPill('busy', 'Checking for news…')` in the header while it runs. The first-sync empty state and the Refresh/Retry buttons (`{"force": true}`) use it too.
- **Offline / server down:** keep the cached paint, and show `statPill('stale', 'Offline · showing saved news from {date}')` in the header. Toast only when there was nothing cached to show (`showToast('Could not reach the news service')`).

## 3. Sketch
```javascript
async function loadNews(params) {
  const seq = routeSeq;
  const view = newsViewFromParams(params);              // {cat, q, state, min_penalty, gravity, section, part}
  const cacheable = isDefaultView(view);
  const cached = cacheable ? lsGetJSON(`newsCache:v1:${view.cat}`) : null;
  const cachedStatus = lsGetJSON('newsCache:v1:status');
  if (cached) renderNews(view, cached.data, cachedStatus?.data, { fromCache: true });
  else renderNewsSkeleton(view);

  let data, status;
  try {
    [data, status] = await Promise.all([getJSON(newsApiUrl(view)), getJSON('/api/news/status')]);
  } catch (e) {
    if (seq !== routeSeq) return;
    if (cached) markNewsOffline(cached.t); else { renderNewsUnavailable(); showToast('Could not reach the news service'); }
    return;
  }
  if (seq !== routeSeq) return;
  if (cacheable) { lsSetJSON(`newsCache:v1:${view.cat}`, trimForCache(data)); lsSetJSON('newsCache:v1:status', status); }
  if (!cached || newsChanged(cached.data, data, cachedStatus?.data, status)) {
    preservingScroll(() => renderNews(view, data, status, { fromCache: false }));
  }

  // Refresh-on-open: only a POST can start a sync, and only for due sources.
  let watch = status.syncing;
  if (status.sync_enabled && status.due && !status.syncing) {
    try {
      const r = await getJSON('/api/news/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: false }),
      });
      watch = (r.queued || []).length > 0;
    } catch (e) {
      // getJSON's errors carry no status. A 409 means the worker started meanwhile, so re-read status.
      try { watch = (await getJSON('/api/news/status')).syncing; } catch (e2) { watch = false; }
    }
    if (seq !== routeSeq) return;
  }
  if (watch) watchNewsSync(seq, view);
}
```
`lsGetJSON` / `lsSetJSON` are thin wrappers over the existing `lsGet` / `lsSet`. Add them if they don't exist.

## 4. Acceptance Criteria
- [ ] A second visit to `#/news` paints from cache before any network response.
- [ ] Revalidation that finds nothing new causes no repaint at all.
- [ ] Revalidation that finds new items keeps the reader's place.
- [ ] With storage blocked (private window), the page works normally, just without the instant paint.
- [ ] Filtered and search views are never cached.
- [ ] Opening `#/news` after the machine slept past a publication window starts a sync (one POST with `force: false`), and the new items appear without a reload.
- [ ] Opening it on fresh data makes no refresh POST at all.
