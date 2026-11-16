# Stage 2 · Phase 3 · Part 2: Editorial Story Briefs Refactor

## 1. Objectives
Refactor `libStory` in `reader/static/app.js` into a structured, high-density editorial brief with pinned status, hover actions, agency tags, and crisp typography.

## 2. Technical Specification

### 2.1 Refactored `libStory` Implementation (`reader/static/app.js`)
```javascript
function libStory(t, { lead = false, first = false, dup = false, showDesk = false } = {}) {
  const isReserved = Boolean(t.reserved);
  const pillHtml = renderStatusPill(t);
  const actsHtml = titleActionButtons(t);

  const kicker = `Title ${t.title}${showDesk && t.desk ? `<span class="sep" aria-hidden="true">·</span>${escapeHtml(t.desk)}` : ''}`;
  const name = escapeHtml(t.name);
  const headline = isReserved ? name : `<a href="${libHref(t.title)}">${name}</a>`;
  
  // Dateline: Amended date + sections count
  const amendedStr = t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : '';
  const sectionsStr = t.installed ? fmtSections(t.installed.section_count) : '';
  const dateline = [amendedStr, sectionsStr].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>');

  const cards = lead ? ((HOME_CONTENT[t.title] || {}).cards || []).slice(0, 3) : [];
  const partsHtml = cards.length
    ? `<ul class="story-parts" aria-label="Key parts">${cards.map(c => `<li><a href="${libHref(t.title, c.part)}">${escapeHtml(c.title)}</a></li>`).join('')}</ul>`
    : '';

  const hay = `${t.title} title ${t.name} ${t.summary || ''} ${t.desk || ''}`.toLowerCase();
  const cls = ['lib-story', lead ? 'is-lead' : '', isReserved ? 'is-dim' : ''].filter(Boolean).join(' ');

  return `
    <article class="${cls}" data-hay="${escapeHtml(hay)}"${dup ? ' data-dup="1"' : ''}>
      <div class="story-top">
        <span class="story-kicker">${kicker}</span>
        ${pillHtml}
      </div>
      <h3 class="story-name">${headline}</h3>
      ${t.summary ? `<p class="story-dek">${escapeHtml(t.summary)}</p>` : ''}
      ${partsHtml}
      <div class="story-foot">
        <span class="story-date">${dateline}</span>
        ${actsHtml ? `<div class="story-actions">${actsHtml}</div>` : ''}
      </div>
    </article>`;
}
```

### 2.2 Story Top & Pinned Status CSS
```css
.story-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lib-story {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 14px 14px 12px;
  border-radius: var(--r-8);
  border: 1px solid var(--line-soft);
  background: var(--panel);
  transition: all var(--t-quick) var(--ease);
}

.lib-story:not(.is-dim):hover {
  background: var(--field);
  border-color: var(--line-strong);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}
```

## 3. Acceptance Criteria
- [ ] Story cards present a consistent card structure across all 50 titles.
- [ ] Click anywhere on headline navigates to title drilldown (`#/library/{t}`).
- [ ] Status pill remains strictly aligned in the top right.
