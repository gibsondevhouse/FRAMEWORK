# Stage 2 · Phase 2 · Part 1: Fixed Takeaway Bullets & Card Anatomy

## 1. Objectives
Every card and the hero carry **three fixed bullets**, built server-side from the record's own fields by `news.takeaways(item)` and stored in the `takeaways` column. No language model is involved (decision 2). The bullets are deterministic and unit-testable, and a missing field gives a plainly worded fallback, never an invented one.

## 2. Bullet rules (`news.takeaways(item) -> list[{"key", "label", "text"}]`)
Dates are formatted `Sep 30, 2026`. Money is `$14,000`. Each `text` is at most ~200 characters, cut at a word boundary with "…".

### Federal Register: rules, proposed rules, notices
| key | label | text |
| :- | :- | :- |
| `action` | Action | `action` ("Final rule.") + the first sentence of `abstract`. Falls back to the first sentence of `dates`, then to "See the document for details." |
| `cfr` | CFR | "29 CFR Part 42", "29 CFR Parts 1910, 1926", plus "§ 1910.1200" for prose sections (max 4, then "+N more"). Falls back to "No CFR parts listed". |
| `dates` | Dates | **Final rule:** "Effective {effective_on}". **Proposed rule:** "Comments close {comments_close_on}". **Notice:** "Published {published_at}". Append " · Docket {first docket id}" when present. Falls back to "Published {published_at}". |

### Federal Register: Public Inspection
| key | label | text |
| :- | :- | :- |
| `action` | Filing | "{doc_type} filed for public inspection {published_at}" |
| `cfr` | CFR | prose citations as above, else "CFR parts appear when it publishes" |
| `dates` | Publishes | "Scheduled for {scheduled_on}" |

### DOL enforcement
| key | label | text |
| :- | :- | :- |
| `incident` | Incident | "{insp_type label} at {company}, {city, ST} · NAICS {naics} · opened {opened_on}" (missing parts are omitted, not shown as "N/A") |
| `standards` | Standards | "§ 1910.1030, § 1926.501" (max 4 + "+N more"), then " · General Duty Clause ×{n}" and " · {n} state-plan standards" when non-zero. Falls back to "No standards listed". |
| `penalty` | Penalty | "{$total} current penalty · {n} Willful, {n} Serious … · issued {published_at}". Order: W, R, S, O, U. Without a penalty: "No penalty assessed · {counts} · issued {date}". |

## 3. Card markup (`newsCardHtml(item, {hero = false})` in `app.js`)
- Event delegation on `#view`; no inline handlers.
- New small helpers (none exist yet): `fmtMoney(n)` (`Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0})`), `safeHttpUrl(u)` (returns `u` only for `http:`/`https:`, else `''`), and `extLink(url, html)` (an `<a target="_blank" rel="noopener">` when the URL is safe, plain text otherwise).
- Every field goes through `escapeHtml`. `link` / `pdf_url` must pass `safeHttpUrl()` (http/https only), or the button is omitted.
- **Kicker** (top line, `--fg-3`, uppercase 11px): FR: `FINAL RULE · 91 FR 55744`. PI: `PUBLIC INSPECTION · PROPOSED RULE`. DOL: `ENFORCEMENT · TX`.
- **Top-right figure**: the penalty for enforcement (`$14,000`, tabular, `--fg-strong`); nothing for FR. It is **not** a `statPill`: pills mean sync state everywhere else in the app.
- **Headline**: links to the source (`target="_blank" rel="noopener"`).
- **Byline** (Part 2): date · source.
- **Takeaways**: a `<dl class="news-takeaways">`, label in `--fg-3`, text through `linkifyNewsText`.
- **Chips** (Part 2).
- **Actions**: `Federal Register` / `OSHA establishment search` (`.btn .btn-sm`, `icon('external')`), `PDF` when present, and `Open in reader` (`.btn .btn-sm .btn-accent`) pointing at the first section, else the first part (`sectionHref` / `partHref` from Stage 1 · Phase 2 · Part 1).

```javascript
function newsCardHtml(a, { hero = false } = {}) {
  const tag = hero ? 'section' : 'article';
  const kicker = newsKicker(a);                       // see above
  const figure = a.penalty_usd ? `<span class="news-figure">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : '';
  const rows = (a.takeaways || []).map(t =>
    `<dt>${escapeHtml(t.label)}</dt><dd>${linkifyNewsText(t.text)}</dd>`).join('');
  return `
    <${tag} class="news-card${hero ? ' news-hero' : ''}" data-guid="${escapeHtml(a.guid)}" data-cat="${escapeHtml(a.category)}">
      <div class="news-card-top"><span class="news-kicker">${escapeHtml(kicker)}</span>${figure}</div>
      <h3 class="news-card-title">${extLink(a.link, escapeHtml(a.title))}</h3>
      ${newsBylineHtml(a)}
      ${rows ? `<dl class="news-takeaways">${rows}</dl>` : ''}
      ${newsChipsHtml(a)}
      <div class="news-card-foot">${newsActionsHtml(a)}</div>
    </${tag}>`;
}
```

## 4. CSS
```css
.news-card { display: flex; flex-direction: column; gap: 10px; padding: 16px 18px;
  background: var(--card); border: 1px solid var(--line); border-radius: var(--r-8);
  transition: background-color var(--t-quick) var(--ease), border-color var(--t-quick) var(--ease); }
.news-card:hover { background: var(--card-hover); }
.news-card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.news-kicker { font-size: 11px; font-weight: var(--w-semibold); letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.news-figure { font-variant-numeric: tabular-nums; font-weight: var(--w-semibold); color: var(--fg-strong); }
.news-card-title { font-size: 15px; font-weight: var(--w-semibold); line-height: 1.35; margin: 0; }
.news-hero .news-card-title { font-size: 20px; }
.news-takeaways { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
.news-takeaways dt { color: var(--fg-3); }
.news-takeaways dd { margin: 0; color: var(--fg-2); }
.news-card-foot { display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; }
```

## 5. Acceptance Criteria
- [ ] `news.takeaways` returns exactly three bullets for every item kind, and each fallback in §2 is covered by a test.
- [ ] Rule cards show the FR citation, effective date or comment deadline, the PDF link, and part chips.
- [ ] Enforcement cards show the penalty in tabular numerals, the state, `§` chips, and General Duty / state-plan counts when present.
- [ ] A record with a non-http link renders without that button. Nothing in a record can inject markup.
