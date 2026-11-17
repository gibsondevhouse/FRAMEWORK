# Stage 2 · Phase 2 · Part 2: Citation Chips & Source Byline

## 1. Objectives
Chips that take the reader from a news card into the regulation (`29 CFR Part 42`, `§ 1910.1030`), and a one-line byline saying when the item happened and where it came from.

## 2. Chips (`newsChipsHtml(a)`)
- Part chips from `cfr_parts` first ("29 CFR Part 42"), then section chips from `sections` ("§ 1910.1030"). Show at most 6, then a "+N" chip that expands the row in place.
- Hrefs come from `partHref` / `sectionHref` (Stage 1 · Phase 2 · Part 1): the reader when the title is installed, otherwise `#/library/{t}` with a tooltip "Title {t} isn't installed. Open the library", and the chip gets `is-dim`.
- A chip for a section the reader has visited (the existing per-title `visited` set) gets no special style. The user has rejected per-row badges and ticks elsewhere.

## 3. Byline (`newsBylineHtml(a)`)
`Aug 31, 2026 · Federal Register`, `Nov 16, 2026 · Federal Register Public Inspection`, `Nov 12, 2026 · DOL enforcement data`. Use `shortDate`. For enforcement, the date is the citation issuance date (`published_at`).

## 4. CSS
```css
.news-byline { font-size: 12px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.news-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.citation-chip {
  display: inline-flex; align-items: center; height: 22px; padding: 0 8px;
  border-radius: var(--r-4); border: 1px solid var(--line); background: var(--panel);
  color: var(--accent); font: var(--w-medium) 12px/1 var(--sans); font-variant-numeric: tabular-nums;
  text-decoration: none;
  transition: background-color var(--t-quick) var(--ease), border-color var(--t-quick) var(--ease), color var(--t-quick) var(--ease);
}
.citation-chip:hover, .citation-chip:focus-visible { background: var(--active); border-color: var(--line-strong); color: var(--fg-strong); }
.citation-chip.is-dim { color: var(--fg-3); }
```
No `translateY` lift: chips sit in dense rows, and the app's other dense controls don't move on hover.

## 5. Acceptance Criteria
- [ ] Part chips go to `#/title/{t}/part/{p}` and section chips to `#/title/29/section/{id}`, or to the library when the title isn't installed.
- [ ] Chip text (`--accent` and `--fg-3` on `--panel`) meets WCAG AA in both themes. Measure it, don't assume it. (`--fg-4` is known to fail and must not be used.)
- [ ] Chips are reachable by Tab and show a focus ring.
