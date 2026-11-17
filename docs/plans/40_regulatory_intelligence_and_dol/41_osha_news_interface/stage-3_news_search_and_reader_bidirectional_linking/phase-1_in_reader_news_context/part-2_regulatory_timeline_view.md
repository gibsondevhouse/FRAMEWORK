# Stage 3 · Phase 1 · Part 2: Rulemaking & Enforcement Timeline

## 1. Objectives
A compact vertical timeline inside the reader's activity popover (Part 1). It lists the Federal Register rulemaking and OSHA enforcement items that cite the section or part, newest first.

**Interpretations are not included** (decision 4). OSHA letters of interpretation are only published on osha.gov, which this plan does not scrape. If a sanctioned source for them appears later, it gets a new node kind; nothing here should assume it.

## 2. Data
The `articles` array from `GET /api/news/section/{id}` or `/api/news/part/{part}` (Stage 1 · Phase 1 · Part 3): at most 15 items, newest first, already sorted by the server.

## 3. Node kinds
| Kind (from `category`) | Dot colour | Line 1 | Line 2 |
| :--- | :--- | :--- | :--- |
| `rules` | `--accent` | date · "Final rule" · FR citation | title (link to source) |
| `rulemaking` | `--partial` | date · "Proposed rule" · "comments close {date}" when known | title |
| `notices` | `--fg-3` | date · "Notice" | title |
| `public_inspection` | `--fg-3` (hollow dot) | date · "Public inspection" · "publishes {date}" | title |
| `enforcement` | `--warn` | date · "Citation" · penalty | company, city/state |

Colours are tokens only, and they are a secondary cue: line 1 always names the kind in words.

## 4. Markup & CSS
```html
<ol class="reg-timeline">
  <li class="tl-node" data-kind="rules">
    <span class="tl-dot" aria-hidden="true"></span>
    <div class="tl-meta">Aug 31, 2026 · Final rule · 91 FR 55744</div>
    <a class="tl-title" href="…" target="_blank" rel="noopener">Rescission of Coordinated Enforcement Regulations</a>
  </li>
</ol>
```
```css
.reg-timeline { list-style: none; margin: 0; padding: 4px 0 4px 18px; border-left: 1px solid var(--line); }
.tl-node { position: relative; padding: 6px 0 10px; }
.tl-dot { position: absolute; left: -23px; top: 11px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--tl, var(--fg-3)); box-shadow: 0 0 0 2px var(--pop); }
.tl-node[data-kind="rules"]       { --tl: var(--accent); }
.tl-node[data-kind="rulemaking"]  { --tl: var(--partial); }
.tl-node[data-kind="enforcement"] { --tl: var(--warn); }
.tl-node[data-kind="public_inspection"] .tl-dot { background: transparent; border: 1px solid var(--fg-3); }
.tl-meta { font-size: 11px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.tl-title { display: block; font-size: 13px; color: var(--fg); margin-top: 2px; }
```

## 5. Acceptance Criteria
- [ ] Newest first, at most 15 nodes, and a "See all in News" footer when the server reports more.
- [ ] Each node names its kind in text. Colour is never the only cue.
- [ ] No interpretation nodes exist anywhere in the code or markup.
