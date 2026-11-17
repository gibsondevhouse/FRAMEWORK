# Stage 3 · Phase 2 · Part 1: News Full-Text Search

## 1. Objectives
Full-text search over news `title`, `description` and `company`, served by the `q` parameter of `GET /api/news` (Stage 1 · Phase 1 · Part 3) and used only by the filter box on `#/news` (decision 5).

**Not in scope:** the topbar search box, `#/search`, `/api/search?title=all`, and Claude's tools are unchanged. Folding news in there is a later decision.

## 2. Query building
- Reuse `store.fts_query(q)`. It quotes every token so user input can't inject FTS5 syntax, and it adds a prefix `*` to a final bare token of ≥ 5 characters. If it returns `None`, the result is empty.
- **Section-number queries.** If `store.normalize_id(q)` yields a section id (e.g. `§ 1910.1030`, `29 CFR 1910.1030(g)`), search `article_citations` for it instead of FTS, then order by date. This is what users type in practice, and FTS tokenises `1910.1030` badly.
- **FR citation queries.** `91 FR 55744` (matching `render._FR`) → `WHERE citation = ?`.

## 3. SQL (FTS branch)
```python
SNIPPET_OPEN, SNIPPET_CLOSE = "\x02", "\x03"   # the app's existing highlight sentinels

sql = f"""
  SELECT a.*, snippet(articles_fts, 2, ?, ?, '…', 24) AS snippet
  FROM articles_fts JOIN articles a ON a.guid = articles_fts.guid
  WHERE articles_fts MATCH ? {filters_sql}
  ORDER BY bm25(articles_fts, 0.0, 2.0, 1.0, 1.5), a.published_at DESC
  LIMIT ? OFFSET ?
"""
params = [SNIPPET_OPEN, SNIPPET_CLOSE, fts, *filter_params, limit, offset]
```
- Columns: `guid`(0, unindexed, weight 0), `title`(1, 2.0), `description`(2, 1.0), `company`(3, 1.5).
- The sentinels are bound as parameters, not spliced into the SQL text.
- `filters_sql` / `filter_params` are the same category, state, penalty, gravity and section filters the plain feed uses (Part 2), so search and filters combine.
- `total` comes from a `COUNT(*)` over the same `MATCH` and filters.

## 4. Frontend
The card shows the `snippet` in place of the first takeaway's text when present, escaped first and then `\x02` → `<mark>`, `\x03` → `</mark>`, exactly as `renderResultRow` does for regulation search.

## 5. Acceptance Criteria
- [ ] Queries containing FTS syntax (`"`, `*`, `NEAR`, `-`, `:`) never raise. They are searched literally.
- [ ] `§ 1910.1030` and `91 FR 55744` find their records by id and citation, not by FTS luck.
- [ ] Ranking weights title 2.0 and company 1.5 above description 1.0, with ties broken by newest.
- [ ] Search combines with the current tab and facets.
