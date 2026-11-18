import { SearchResultItem, SearchViewState, state } from '../state';
import { fetchSearchResults } from '../api/client';
import { onView } from '../core/view_dispatch';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsGet, lsSet, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { emptyStateHtml } from '../components/ui';
import { renderViewError } from './doc_utils';

state.searchState = null;

export function renderResultRow(r: SearchResultItem, showTitleInPart: boolean): string {
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

function buildFacetData(rawResults: SearchResultItem[], filters: SearchViewState['filters']) {
  const qText = filters.text.trim().toLowerCase();
  const applyFilters = (list: SearchResultItem[], { ignoreTitle = false, ignorePart = false } = {}) => list.filter(r => {
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

  const filtered = applyFilters(rawResults);
  const titleCounts = new Map<number, number>();
  for (const r of applyFilters(rawResults, { ignoreTitle: true, ignorePart: true })) {
    const t = r.title || state.currentTitle;
    titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
  }
  const partCounts = new Map<string, number>();
  for (const r of applyFilters(rawResults, { ignorePart: true })) {
    const p = r.part || '';
    if (p) partCounts.set(p, (partCounts.get(p) || 0) + 1);
  }
  return {
    filtered,
    hasActiveFilter: filters.title !== null || filters.part !== null || filters.kind !== 'all' || qText !== '',
    sortedTitleFacets: [...titleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
    sortedPartFacets: [...partCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true })),
    hasAppendices: rawResults.some(r => r.kind === 'appendix'),
  };
}

function renderGroupedResults(filtered: SearchResultItem[], collapsed: Set<number>): string {
  if (!filtered.length) {
    return emptyStateHtml({ title: 'No matching results', body: 'None of the loaded results match your current filters.' });
  }
  const byTitle = new Map<number, SearchResultItem[]>();
  for (const r of filtered) {
    const t = r.title || state.currentTitle;
    let bucket = byTitle.get(t);
    if (!bucket) { bucket = []; byTitle.set(t, bucket); }
    bucket.push(r);
  }
  const sortedTitles = [...byTitle.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);

  return `<div class="search-groups">${sortedTitles.map(([t, tItems]) => {
    const tMeta = state.installedTitles.find(x => x.title === t);
    const tLabel = tMeta ? `Title ${t} — ${tMeta.name}` : `Title ${t}`;
    const isCollapsed = collapsed.has(t);

    const byPart = new Map<string, SearchResultItem[]>();
    for (const r of tItems) {
      const p = r.part || '';
      let pBucket = byPart.get(p);
      if (!pBucket) { pBucket = []; byPart.set(p, pBucket); }
      pBucket.push(r);
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
      <section class="search-title-group has-tier-bar${isCollapsed ? ' is-collapsed' : ''}" data-ref-tier="cfr" data-tgroup="${t}">
        <button type="button" class="search-title-head" aria-expanded="${!isCollapsed}">
          <span class="search-title-caret" aria-hidden="true">${icon('chevronDown')}</span>
          <span class="tier-pip" aria-hidden="true"></span>
          <span class="search-title-name">${escapeHtml(tLabel)}</span>
          <span class="ref-badge">FEDERAL CFR</span>
          <span class="search-title-count">${tItems.length} ${tItems.length === 1 ? 'result' : 'results'}</span>
        </button>
        <div class="search-title-body">${partsHtml}</div>
      </section>
    `;
  }).join('')}</div>`;
}

function patchSearchDynamicSlots(): void {
  if (!state.searchState) return;
  const { query, allTitles, data, view, filters, collapsed } = state.searchState;
  const rawResults = data.results || [];
  const total = Number(data.total || 0);

  const countSlot = document.getElementById('search-count-slot');
  const facetsBar = document.getElementById('search-facets-slot');
  const kindSlot = document.getElementById('search-kind-slot');
  const clearSlot = document.getElementById('search-clear-slot');
  const filtersBox = document.getElementById('search-filters-box');
  const bodySlot = document.getElementById('search-results-slot');
  if (!bodySlot) return;

  for (const btn of dom.view.querySelectorAll<HTMLElement>('[data-sview]')) {
    const on = btn.dataset.sview === view;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  if (!rawResults.length) {
    if (filtersBox) filtersBox.hidden = true;
    if (countSlot) countSlot.textContent = `0 results · ${data.ms} ms`;
    bodySlot.innerHTML = emptyStateHtml({
      title: 'No results',
      body: `Nothing in ${allTitles ? 'the installed titles' : 'Title ' + state.currentTitle} matches “${escapeHtml(query)}”. Try fewer or different words.`,
    });
    return;
  }

  const { filtered, hasActiveFilter, sortedTitleFacets, sortedPartFacets, hasAppendices } = buildFacetData(rawResults, filters);
  const countText = (view === 'grouped' && hasActiveFilter)
    ? `${filtered.length.toLocaleString()} of ${rawResults.length.toLocaleString()} shown (${total.toLocaleString()} total)`
    : `${total.toLocaleString()} ${total === 1 ? 'result' : 'results'}`;
  if (countSlot) countSlot.textContent = `${countText} · ${data.ms} ms`;

  if (filtersBox) filtersBox.hidden = view !== 'grouped';
  if (view === 'grouped') {
    if (kindSlot) {
      kindSlot.innerHTML = hasAppendices ? `
        <button type="button" class="sf-pill${filters.kind === 'all' ? ' is-active' : ''}" data-fkind="all">All types</button>
        <button type="button" class="sf-pill${filters.kind === 'section' ? ' is-active' : ''}" data-fkind="section">Sections</button>
        <button type="button" class="sf-pill${filters.kind === 'appendix' ? ' is-active' : ''}" data-fkind="appendix">Appendices</button>
      ` : '';
    }
    if (clearSlot) {
      clearSlot.innerHTML = hasActiveFilter ? '<button type="button" class="sf-clear" id="sf-clear">Clear filters</button>' : '';
    }
    if (facetsBar) {
      const authPills = `
        <div class="search-filter-row">
          <span class="search-filter-label">Authority</span>
          <div class="search-filter-pills">
            <button type="button" class="sf-pill is-active" data-fauth="all">All <span class="sf-pill-count">${rawResults.length}</span></button>
            <button type="button" class="sf-pill" data-ref-tier="cfr" data-fauth="federal-reg"><span class="tier-pip" aria-hidden="true"></span>Federal CFR <span class="sf-pill-count">${rawResults.length}</span></button>
            <button type="button" class="sf-pill" data-ref-tier="usc" disabled title="U.S.C. corpus indexing slot"><span class="tier-pip is-hollow" aria-hidden="true"></span>U.S.C.</button>
            <button type="button" class="sf-pill" data-ref-tier="state" disabled title="State corpus indexing slot"><span class="tier-pip is-hollow" aria-hidden="true"></span>State</button>
            <button type="button" class="sf-pill" data-ref-tier="county" disabled title="County corpus indexing slot"><span class="tier-pip is-hollow" aria-hidden="true"></span>County</button>
          </div>
        </div>`;
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
      facetsBar.innerHTML = authPills + titlePills + partPills;
    }
    bodySlot.innerHTML = renderGroupedResults(filtered, collapsed);
  } else {
    bodySlot.innerHTML = `<div class="results-list">${rawResults.map(r => renderResultRow(r, allTitles)).join('')}</div>`;
  }
}

export function renderSearchView(): void {
  if (!state.searchState) return;
  const { query, allTitles, data, view, filters } = state.searchState;
  const rawResults = data.results || [];

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

  dom.view.innerHTML = `
    <div class="search-page">
      <div class="doc-kicker">Search</div>
      <h1 class="doc-title">${escapeHtml(query)}</h1>
      <div class="search-meta">
        <span id="search-count-slot" aria-live="polite"></span>
        <div class="search-controls">${viewToggleHtml}${scopeHtml}</div>
      </div>
      <div class="search-filters" id="search-filters-box" role="region" aria-label="Filter search results" hidden>
        <div class="search-filter-row">
          <input type="search" id="sf-text" class="search-filter-input" value="${escapeHtml(filters.text)}" placeholder="Filter these results by section, part, or phrase…" autocomplete="off" spellcheck="false">
          <div class="search-filter-pills" id="search-kind-slot"></div>
          <span id="search-clear-slot"></span>
        </div>
        <div id="search-facets-slot"></div>
      </div>
      <div id="search-results-slot"></div>
    </div>
  `;

  patchSearchDynamicSlots();
}

onView('input', (e) => {
  const input = e.target as HTMLInputElement | null;
  if (!input || input.id !== 'sf-text' || !state.searchState || !dom.view.querySelector('.search-page')) return;
  state.searchState.filters.text = input.value;
  patchSearchDynamicSlots();
});

onView('click', (e) => {
  if (!state.searchState || !dom.view.querySelector('.search-page')) return;
  const t = e.target as Element | null;
  if (!t) return;
  const viewBtn = t.closest<HTMLElement>('[data-sview]');
  if (viewBtn) {
    const next = viewBtn.dataset.sview === 'grouped' ? 'grouped' : 'compact';
    if (next !== state.searchState.view) {
      state.searchState.view = next;
      lsSet('searchView', next);
      patchSearchDynamicSlots();
    }
    return;
  }
  const titlePill = t.closest<HTMLElement>('[data-ftitle]');
  if (titlePill) {
    const val = titlePill.dataset.ftitle === '' ? null : Number(titlePill.dataset.ftitle);
    state.searchState.filters.title = state.searchState.filters.title === val ? null : val;
    state.searchState.filters.part = null;
    patchSearchDynamicSlots();
    return;
  }
  const partPill = t.closest<HTMLElement>('[data-fpart]');
  if (partPill) {
    const val = partPill.dataset.fpart === '' ? null : (partPill.dataset.fpart || null);
    state.searchState.filters.part = state.searchState.filters.part === val ? null : val;
    patchSearchDynamicSlots();
    return;
  }
  const kindPill = t.closest<HTMLElement>('[data-fkind]');
  if (kindPill) {
    const k = kindPill.dataset.fkind;
    if (k === 'all' || k === 'section' || k === 'appendix') {
      state.searchState.filters.kind = k;
      patchSearchDynamicSlots();
    }
    return;
  }
  if (t.closest('#sf-clear')) {
    state.searchState.filters = { title: null, part: null, kind: 'all', text: '' };
    const sfInput = document.getElementById('sf-text') as HTMLInputElement | null;
    if (sfInput) sfInput.value = '';
    patchSearchDynamicSlots();
    return;
  }
  const titleHead = t.closest('.search-title-head');
  if (titleHead) {
    const grp = titleHead.closest<HTMLElement>('.search-title-group');
    const tNum = Number(grp?.dataset.tgroup);
    if (!Number.isNaN(tNum)) {
      if (state.searchState.collapsed.has(tNum)) state.searchState.collapsed.delete(tNum);
      else state.searchState.collapsed.add(tNum);
      patchSearchDynamicSlots();
    }
  }
});

export async function loadSearchPage(query: string, scope?: string | null): Promise<void> {
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
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    const data = await fetchSearchResults(allTitles ? 'all' : state.currentTitle, query, 100, { signal });
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
    if (err instanceof Error && err.name === 'AbortError') return;
    renderViewError(dom.view, 'Search failed', (err instanceof Error ? err.message : '') || 'Unexpected error', {
      onRetry: () => loadSearchPage(query, scope),
    });
  }
}
