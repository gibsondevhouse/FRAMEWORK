# Stage 3 · Phase 2 · Part 2: State, Penalty & Gravity Facets

## 1. Objectives
Let the reader narrow **enforcement** items by state, minimum penalty and violation gravity. Filtering is **server-side** through `/api/news` parameters (`state`, `min_penalty`, `gravity`), so it works across pages and combines with search.

## 2. When the facets show
- Only on the **Enforcement & Penalties** tab, and only when `status.dol_configured` is true. FR records have no state, penalty or gravity, so the facets would only confuse other tabs.
- They sit in a row under the tab bar. Active facets also show as removable chips ("Texas ×") so the filter state is visible when the row scrolls away.

## 3. Controls
Reuse the Library front page's order control styling for consistency. The options:
- **State**: built from `GET /api/news/facets` (the states actually present, with counts: "Texas (12)"), not a hard-coded list. "All states" first.
- **Penalty**: All · Over $25,000 · Over $100,000 · Over $250,000 → `min_penalty`.
- **Gravity**: All · Willful · Repeat · Serious → `gravity` (`W` / `R` / `S`). Other-than-Serious and Unclassified are not offered as filters; they still appear on cards.

Each change updates the URL (Stage 2 · Phase 1 · Part 2 §4) and reloads from offset 0.

## 4. Server
```python
filters, params = [], []
if state:       filters.append("a.state = ?");                         params.append(state.upper())
if min_penalty: filters.append("a.penalty_usd >= ?");                  params.append(float(min_penalty))
if gravity:     filters.append("EXISTS (SELECT 1 FROM json_each(a.violation_types) WHERE value = ?)")
                params.append(gravity)
if state or min_penalty or gravity:
    filters.append("a.category = 'enforcement'")
```
`state` must match `^[A-Za-z]{2}$` and `gravity` one of `W|R|S`; anything else gives a 422.

## 5. Acceptance Criteria
- [ ] The state list reflects the data and shows counts.
- [ ] Facets combine with each other, with `q`, and with paging. Totals are correct.
- [ ] The facets are hidden on every tab except Enforcement, and when no DOL key is configured.
- [ ] The URL fully restores the facet state on reload.
