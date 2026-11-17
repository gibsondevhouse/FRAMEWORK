import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsGet, lsSet, skeletonHtml } from '../dom';
import { dom } from '../state_init';

// --- Search Page ---
state.searchState = null;


export function renderResultRow(r, showTitleInPart) {
  // The FTS snippet already carries its own ellipses; show exactly one at each cut end.
  let snippet = (r.snippet || '').replace(/^[\s.…]+|[\s.…]+$/g, '');
  snippet = escapeHtml(snippet).replace(/\x02/g, '<mark>').replace(/\x03/g, '</mark>');
  const rTitle = r.title || state.currentTitle;
  return `
    <div class="result">
      <a class="result-title" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
        <span class="result-num">${escapeHtml(r.label)}</span>
        <span class="result-name">${escapeHtml(r.title_label || r.title)}</span>
        <span class="result-part">${showTitleInPart ? `Title ${rTitle} · ` : ''}Part ${escapeHtml(r.part || '')}</span>
      </a>
      ${snippet ? `<div class="result-snippet">…${snippet}…</div>` : ''}
    </div>
  `;
}


export function renderSearchView() {
  if (!state.searchState) return;
  const { query, allTitles, data, view, filters, collapsed } = state.searchState;
  const rawResults = data.results || [];
  const total = Number(data.total || 0);

  let scopeHtml = '';
  if (state.installedTitles.length > 1) {
    const qEnc = encodeURIComponent(query);
    scopeHtml = `<span class="search-scope" role="group" aria-label="Search scope">
      <a class="${allTitles ? '' : 'scope-on'}" href="#/search?q=${qEnc}"${allTitles ? '' : ' aria-current="true"'}>Title ${state.currentTitle}</a>
      <a class="${allTitles ? 'scope-on' : ''}" href="#/search?q=${qEnc}&scope=all"${allTitles ? ' aria-current="true"' : ''}>All ${state.installedTitles.length} titles</a>
    </span>`;
  }

  const viewToggleHtml = rawResults.length ? `<span class="search-view-toggle" role="group" aria-label="Results layout">
    <button type="button" class="${view === 'compact' ? 'is-on' : ''}" data-sview="compact" aria-pressed="${view === 'compact'}">Compact</button>
    <button type="button" class="${view === 'grouped' ? 'is-on' : ''}" data-sview="grouped" aria-pressed="${view === 'grouped'}">Grouped</button>
  </span>` : '';

  // Apply client-side filters in Grouped mode
  const qText = filters.text.trim().toLowerCase();
  const applyFilters = (list, { ignoreTitle = false, ignorePart = false } = {}) => list.filter(r => {
    const rTitle = r.title || state.currentTitle;
    if (!ignoreTitle && filters.title !== null && rTitle !== filters.title) return false;
    if (!ignorePart && filters.part !== null && (r.part || '') !== filters.part) return false;
    if (filters.kind !== 'all' && (r.kind || 'section') !== filters.kind) return false;
    if (qText) {
      const hay = `${r.label || ''} ${r.title_label || ''} ${r.part || ''} ${r.snippet || ''} title ${rTitle}`.toLowerCase();
      if (!hay.includes(qText)) return false;
    }
    return true;
  });

  const filtered = view === 'grouped' ? applyFilters(rawResults) : rawResults;
  const hasActiveFilter = view === 'grouped' && (filters.title !== null || filters.part !== null || filters.kind !== 'all' || qText !== '');

  let filtersHtml = '';
  let bodyHtml = '';

  if (!rawResults.length) {
    bodyHtml = `<div class="empty-state"><h2>No results</h2><p>Nothing in ${allTitles ? 'the installed titles' : 'Title ' + state.currentTitle} matches “${escapeHtml(query)}”. Try fewer or different words.</p></div>`;
  } else if (view === 'compact') {
    bodyHtml = `<div class="results-list">${rawResults.map(r => renderResultRow(r, allTitles)).join('')}</div>`;
  } else {
    // Build filter facets ordered by count descending
    const titleCounts = new Map();
    for (const r of applyFilters(rawResults, { ignoreTitle: true, ignorePart: true })) {
      const t = r.title || state.currentTitle;
      titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
    }
    const sortedTitleFacets = [...titleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

    const partCounts = new Map();
    for (const r of applyFilters(rawResults, { ignorePart: true })) {
      const p = r.part || '';
      if (p) partCounts.set(p, (partCounts.get(p) || 0) + 1);
    }
    const sortedPartFacets = [...partCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));

    const hasAppendices = rawResults.some(r => r.kind === 'appendix');

    const titlePills = sortedTitleFacets.length > 1 ? `
      <div class="search-filter-row">
        <span class="search-filter-label">Titles</span>
        <div class="search-filter-pills">
          <button type="button" class="sf-pill${filters.title === null ? ' is-active' : ''}" data-ftitle="">All <span class="sf-pill-count">${rawResults.length}</span></button>
          ${sortedTitleFacets.map(([t, c]) => `<button type="button" class="sf-pill${filters.title === t ? ' is-active' : ''}" data-ftitle="${t}">Title ${t} <span class="sf-pill-count">${c}</span></button>`).join('')}
        </div>
      </div>` : '';

    const partPills = sortedPartFacets.length > 1 ? `
      <div class="search-filter-row">
        <span class="search-filter-label">Parts</span>
        <div class="search-filter-pills">
          <button type="button" class="sf-pill${filters.part === null ? ' is-active' : ''}" data-fpart="">All</button>
          ${sortedPartFacets.slice(0, 14).map(([p, c]) => `<button type="button" class="sf-pill${filters.part === p ? ' is-active' : ''}" data-fpart="${escapeHtml(p)}">Part ${escapeHtml(p)} <span class="sf-pill-count">${c}</span></button>`).join('')}
        </div>
      </div>` : '';

    const kindPills = hasAppendices ? `
      <div class="search-filter-pills">
        <button type="button" class="sf-pill${filters.kind === 'all' ? ' is-active' : ''}" data-fkind="all">All types</button>
        <button type="button" class="sf-pill${filters.kind === 'section' ? ' is-active' : ''}" data-fkind="section">Sections</button>
        <button type="button" class="sf-pill${filters.kind === 'appendix' ? ' is-active' : ''}" data-fkind="appendix">Appendices</button>
      </div>` : '';

    filtersHtml = `
      <div class="search-filters" role="region" aria-label="Filter search results">
        <div class="search-filter-row">
          <input type="search" id="sf-text" class="search-filter-input" value="${escapeHtml(filters.text)}" placeholder="Filter these results by section, part, or phrase…" autocomplete="off" spellcheck="false">
          ${kindPills}
          ${hasActiveFilter ? '<button type="button" class="sf-clear" id="sf-clear">Clear filters</button>' : ''}
        </div>
        ${titlePills}
        ${partPills}
      </div>
    `;

    if (!filtered.length) {
      bodyHtml = `<div class="empty-state"><h2>No matching results</h2><p>None of the loaded results match your current filters.</p></div>`;
    } else {
      // Group by Title (ordered by results per title descending) -> Part (ordered by results per part descending)
      const byTitle = new Map();
      for (const r of filtered) {
        const t = r.title || state.currentTitle;
        if (!byTitle.has(t)) byTitle.set(t, []);
        byTitle.get(t).push(r);
      }
      const sortedTitles = [...byTitle.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);

      bodyHtml = `<div class="search-groups">${sortedTitles.map(([t, tItems]) => {
        const tMeta = state.installedTitles.find(x => x.title === t);
        const tLabel = tMeta ? `Title ${t} — ${tMeta.name}` : `Title ${t}`;
        const isCollapsed = collapsed.has(t);

        const byPart = new Map();
        for (const r of tItems) {
          const p = r.part || '';
          if (!byPart.has(p)) byPart.set(p, []);
          byPart.get(p).push(r);
        }
        const sortedParts = [...byPart.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], undefined, { numeric: true }));

        const partsHtml = sortedParts.map(([p, pItems]) => `
          <div class="search-part-group">
            ${p ? `<div class="search-part-head">
              <a class="search-part-link" href="#/title/${t}/part/${encodeURIComponent(p)}">Part ${escapeHtml(p)}</a>
              <span class="search-part-count">${pItems.length} ${pItems.length === 1 ? 'result' : 'results'}</span>
            </div>` : ''}
            ${pItems.map(r => renderResultRow(r, false)).join('')}
          </div>
        `).join('');

        return `
          <section class="search-title-group${isCollapsed ? ' is-collapsed' : ''}" data-tgroup="${t}">
            <button type="button" class="search-title-head" aria-expanded="${!isCollapsed}">
              <span class="search-title-caret" aria-hidden="true">${icon('chevronDown')}</span>
              <span class="search-title-name">${escapeHtml(tLabel)}</span>
              <span class="search-title-count">${tItems.length} ${tItems.length === 1 ? 'result' : 'results'}</span>
            </button>
            <div class="search-title-body">${partsHtml}</div>
          </section>
        `;
      }).join('')}</div>`;
    }
  }

  const countText = hasActiveFilter
    ? `${filtered.length.toLocaleString()} of ${rawResults.length.toLocaleString()} shown (${total.toLocaleString()} total)`
    : `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`;

  const wasFilterFocused = document.activeElement?.id === 'sf-text';
  const selStart = wasFilterFocused ? document.activeElement.selectionStart : null;

  dom.view.innerHTML = `
    <div class="doc-kicker">Search</div>
    <h1 class="doc-title">${escapeHtml(query)}</h1>
    <div class="search-meta">
      <span>${countText} · ${data.ms} ms</span>
      <div class="search-controls">${viewToggleHtml}${scopeHtml}</div>
    </div>
    ${filtersHtml}
    ${bodyHtml}
  `;

  // Wire interactions
  dom.view.querySelectorAll('[data-sview]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.sview;
      if (next === state.searchState.view) return;
      state.searchState.view = next;
      lsSet('searchView', next);
      renderSearchView();
    });
  });

  const sfInput = document.getElementById('sf-text');
  if (sfInput) {
    if (wasFilterFocused) {
      sfInput.focus();
      if (selStart !== null) sfInput.setSelectionRange(selStart, selStart);
    }
    sfInput.addEventListener('input', () => {
      state.searchState.filters.text = sfInput.value;
      renderSearchView();
    });
  }

  dom.view.querySelectorAll('[data-ftitle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.ftitle === '' ? null : Number(btn.dataset.ftitle);
      state.searchState.filters.title = state.searchState.filters.title === val ? null : val;
      state.searchState.filters.part = null;
      renderSearchView();
    });
  });

  dom.view.querySelectorAll('[data-fpart]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.fpart === '' ? null : btn.dataset.fpart;
      state.searchState.filters.part = state.searchState.filters.part === val ? null : val;
      renderSearchView();
    });
  });

  dom.view.querySelectorAll('[data-fkind]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.searchState.filters.kind = btn.dataset.fkind;
      renderSearchView();
    });
  });

  const sfClear = document.getElementById('sf-clear');
  if (sfClear) {
    sfClear.addEventListener('click', () => {
      state.searchState.filters = { title: null, part: null, kind: 'all', text: '' };
      renderSearchView();
    });
  }

  dom.view.querySelectorAll('.search-title-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = Number(btn.closest('.search-title-group').dataset.tgroup);
      if (state.searchState.collapsed.has(t)) state.searchState.collapsed.delete(t);
      else state.searchState.collapsed.add(t);
      renderSearchView();
    });
  });
}


export async function loadSearchPage(query, scope) {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = 'Search · FRAMEWORK';
  setViewHead('');

  if (!query.trim()) {
    state.searchState = null;
    dom.view.innerHTML = '<div class="empty-state"><h2>Search</h2><p>Type a word, phrase or section number in the search box above.</p></div>';
    return;
  }

  const allTitles = scope === 'all' && state.installedTitles.length > 1;
  dom.view.innerHTML = skeletonHtml('list', `Searching for “${query}”…`);
  try {
    const url = allTitles
      ? `/api/search?q=${encodeURIComponent(query)}&title=all&limit=100`
      : `/api/${state.currentTitle}/search?q=${encodeURIComponent(query)}&limit=100`;
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    const res = await fetch(url, { signal });
    const data = await res.json();
    if (seq !== state.routeSeq) return;

    const savedView = lsGet('searchView') === 'grouped' ? 'grouped' : 'compact';
    state.searchState = {
      query,
      allTitles,
      data,
      view: savedView,
      filters: { title: null, part: null, kind: 'all', text: '' },
      collapsed: new Set(),
    };
    renderSearchView();
    enterView();
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    dom.view.innerHTML = `<div class="msg-error">Search failed: ${escapeHtml(err.message)}</div>`;
  }
}
