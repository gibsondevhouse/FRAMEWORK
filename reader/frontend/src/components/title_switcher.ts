import { CorpusSummary, state } from '../state';
import { on } from '../core/events';
import { closeAllPopovers, registerPopoverCloser } from './popover';
import {
  corpusHashFor, deskLabel, refTierForCorpus, syncCorporaState, TIER_META, TIER_ORDER,
} from './corpora';
import { clearTreeSelection, switchTitle } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon } from '../dom';
import { dom } from '../state_init';

// --- Tiered Corpus & Jurisdiction Switcher (top bar) ---
let switcherDeskFilter = 'all';

export function searchPlaceholderFor(on: boolean): string {
  if (!on) return 'Download a title to search';
  if (window.matchMedia('(max-width: 600px)').matches) return 'Search…';
  return `Search Title ${state.currentTitle} or jump to a section…`;
}

export function setReaderEnabled(on: boolean): void {
  dom.search.disabled = !on;
  dom.search.placeholder = searchPlaceholderFor(on);
  dom.chatToggle.disabled = !on;
  if (!on) {
    dom.edition.textContent = '';
    dom.tree.innerHTML = '<div class="side-empty">No titles installed yet. <a href="#/">Pick a profile</a> or open the <a href="#/library">library</a>.</div>';
  }
}

window.matchMedia('(max-width: 600px)').addEventListener?.('change', () => {
  if (dom.search) dom.search.placeholder = searchPlaceholderFor(!state.noTitles);
});

on('title:switched', () => {
  fillTitleSelect();
  if (dom.search) dom.search.placeholder = searchPlaceholderFor(true);
});

on('titles:refreshed', ({ hadNone, list }) => {
  fillTitleSelect();
  if (hadNone && list.length) setReaderEnabled(true);
});

function switcherGroupsHtml(query = '', desk = switcherDeskFilter): string {
  const corpora = syncCorporaState();
  const q = query.trim().toLowerCase();
  const filtered = corpora.filter(c => {
    if (desk !== 'all' && c.desk !== desk) return false;
    if (!q) return true;
    const hay = `${c.code} ${c.name} ${c.jurisdiction_label || ''} ${(c.agencies || []).join(' ')} ${deskLabel(c.desk || 'ehs')}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    return '<div class="tm-empty">No matching frameworks installed.</div>';
  }

  return TIER_ORDER.map(tier => {
    const items = filtered.filter(c => c.tier === tier);
    if (!items.length) return '';
    const meta = TIER_META[tier];
    return `
      <div class="tm-group" data-ref-tier="${meta.refTier}">
        <div class="tm-group-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(meta.label)}</span><span class="tm-group-count">${items.length}</span></div>
        ${items.map(c => {
          const isCurrent = c.tier === 'federal-reg' ? c.title_num === state.currentTitle : c.corpus_id === state.activeCorpusId;
          const numText = c.tier === 'federal-reg' ? `${c.code} CFR` : c.code;
          const tag = c.partial ? 'Partial' : (c.jurisdiction !== 'US' ? (c.jurisdiction_label || c.jurisdiction) : (c.agencies?.[0] || ''));
          return `<button type="button" class="tm-item${isCurrent ? ' is-current' : ''}" role="menuitemradio" aria-checked="${isCurrent}" data-ref-tier="${meta.refTier}" ${c.tier === 'federal-reg' ? `data-title="${c.title_num}"` : `data-corpus-hash="${escapeHtml(corpusHashFor(c))}"`} tabindex="-1">
            <span class="tier-pip" aria-hidden="true"></span>
            <span class="tm-num">${escapeHtml(numText)}</span><span class="tm-name">${escapeHtml(c.name)}</span>
            ${tag ? `<span class="tm-meta">${escapeHtml(tag)}</span>` : ''}
            ${isCurrent ? icon('check', 'tm-check') : '<span class="tm-check" aria-hidden="true"></span>'}
          </button>`;
        }).join('')}
      </div>
    `;
  }).join('');
}

export function fillTitleSelect(): void {
  if (!dom.titleSelect) return;
  const corpora = syncCorporaState();
  const cur = state.installedTitles.find(t => t.title === state.currentTitle);
  const name = state.noTitles ? '' : cur ? cur.name : (state.metaInfo.name || '');
  const numEl = document.getElementById('title-select-num');
  if (numEl) numEl.textContent = state.noTitles ? 'No titles' : `${state.currentTitle} CFR`;
  const nameEl = document.getElementById('title-select-name');
  if (nameEl) nameEl.textContent = name;
  dom.titleSelect.dataset.refTier = state.noTitles ? 'uninstalled' : 'cfr';
  dom.titleSelect.title = state.noTitles
    ? 'Nothing installed yet. Download titles'
    : `Title ${state.currentTitle}${name ? ': ' + name : ''}. Switch framework or jurisdiction`;

  const desks = [...new Set(corpora.map(c => c.desk).filter((d): d is NonNullable<typeof d> => Boolean(d)))];
  const showDesks = corpora.length > 6 || desks.length > 1;
  const showSearch = corpora.length >= 3;
  const deskPillsHtml = showDesks ? `
    <div class="tm-desks" role="group" aria-label="Filter frameworks by desk">
      <button type="button" class="tm-desk-pill${switcherDeskFilter === 'all' ? ' is-on' : ''}" data-tm-desk="all">All</button>
      ${desks.map(d => `<button type="button" class="tm-desk-pill${switcherDeskFilter === d ? ' is-on' : ''}" data-tm-desk="${escapeHtml(d)}">${escapeHtml(deskLabel(d).split(' ')[0])}</button>`).join('')}
    </div>` : '';

  dom.titlePop.innerHTML = `
    <div class="tm-head">
      ${showSearch ? '<input type="search" class="tm-search" id="title-pop-q" placeholder="Filter frameworks, states, or U.S.C.…" aria-label="Filter installed frameworks" autocomplete="off" spellcheck="false">' : ''}
      ${deskPillsHtml}
    </div>
    <div id="tm-groups">${switcherGroupsHtml()}</div>
    <div class="tm-sep" role="separator"></div>
    <a class="tm-item tm-download" role="menuitem" href="#/library" tabindex="-1">${icon('download')}<span class="tm-name">Browse Catalog &amp; Downloads…</span></a>`;
}

export const titleMenuItems = (): HTMLElement[] => [...dom.titlePop.querySelectorAll<HTMLElement>('.tm-item')];

export function openTitleMenu(focusWhich: 'first' | 'last' | 'current' = 'current'): void {
  if (!dom.titlePop.hidden) return;
  closeAllPopovers(closeTitleMenu, false);
  fillTitleSelect();
  dom.titlePop.hidden = false;
  dom.titleSelect.setAttribute('aria-expanded', 'true');
  const searchEl = document.getElementById('title-pop-q');
  const items = titleMenuItems();
  const target = focusWhich === 'first' ? items[0]
    : focusWhich === 'last' ? items[items.length - 1]
    : searchEl || dom.titlePop.querySelector<HTMLElement>('.is-current') || items[0];
  target?.focus({ preventScroll: true });
  document.addEventListener('pointerdown', onTitleMenuOutside, true);
}

export function closeTitleMenu(returnFocus = false): void {
  if (dom.titlePop.hidden) return;
  dom.titlePop.hidden = true;
  dom.titleSelect.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onTitleMenuOutside, true);
  if (returnFocus) dom.titleSelect.focus();
}

registerPopoverCloser(closeTitleMenu);

export function onTitleMenuOutside(e: Event): void {
  const menu = document.getElementById('title-menu');
  if (menu && !menu.contains(e.target as Node | null)) closeTitleMenu(false);
}

dom.titleSelect.addEventListener('click', () => {
  if (dom.titlePop.hidden) openTitleMenu();
  else closeTitleMenu(false);
});

dom.titleSelect.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    openTitleMenu(e.key === 'ArrowUp' ? 'last' : 'current');
  }
});

dom.titlePop.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement | null;
  if (!target || target.id !== 'title-pop-q') return;
  const groups = document.getElementById('tm-groups');
  if (groups) groups.innerHTML = switcherGroupsHtml(target.value, switcherDeskFilter);
});

dom.titlePop.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.id === 'title-pop-q') {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      titleMenuItems()[0]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeTitleMenu(true);
    }
    return;
  }
  const items = titleMenuItems();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') {
    if (i <= 0) {
      const qEl = document.getElementById('title-pop-q');
      if (qEl) { e.preventDefault(); qEl.focus(); return; }
    }
    go(i - 1);
  } else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTitleMenu(true); }
  else if (e.key === 'Tab') closeTitleMenu(false);
});

dom.titlePop.addEventListener('click', async (e) => {
  const t = e.target as Element | null;
  const deskBtn = t?.closest<HTMLElement>('[data-tm-desk]');
  if (deskBtn) {
    switcherDeskFilter = deskBtn.dataset.tmDesk || 'all';
    dom.titlePop.querySelectorAll('[data-tm-desk]').forEach(b => b.classList.toggle('is-on', b === deskBtn));
    const qVal = (document.getElementById('title-pop-q') as HTMLInputElement | null)?.value || '';
    const groups = document.getElementById('tm-groups');
    if (groups) groups.innerHTML = switcherGroupsHtml(qVal, switcherDeskFilter);
    return;
  }
  const item = t?.closest<HTMLElement>('.tm-item');
  if (!item) return;
  closeTitleMenu(false);
  if (item.classList.contains('tm-download')) return;
  if (item.dataset.corpusHash) {
    window.location.hash = item.dataset.corpusHash;
    return;
  }
  const newTitle = parseInt(item.dataset.title || '', 10);
  if (newTitle && newTitle !== state.currentTitle) {
    await switchTitle(newTitle);
    window.location.hash = `#/title/${newTitle}/`;
  } else {
    dom.titleSelect.focus();
  }
});

export function renderCorpusStaging(corpus: CorpusSummary): void {
  const meta = TIER_META[corpus.tier] || TIER_META['state'];
  const refTier = refTierForCorpus(corpus);
  document.title = `${corpus.code} · ${corpus.jurisdiction_label || corpus.jurisdiction} · FRAMEWORK`;
  dom.view.innerHTML = `
    <div class="resolver-card has-tier-bar" data-ref-tier="${refTier}">
      <div class="doc-kicker"><span class="ref-badge">${escapeHtml(meta.tag)}</span> <span class="sep" aria-hidden="true">·</span> ${escapeHtml(corpus.jurisdiction_label || corpus.jurisdiction)}</div>
      <h1 class="doc-title">${escapeHtml(corpus.code)} — ${escapeHtml(corpus.name)}</h1>
      <p class="resolver-msg">${escapeHtml(corpus.summary || `This ${meta.label.toLowerCase()} corpus is pre-wired in FRAMEWORK’s multi-jurisdiction UI router and awaiting its backend ingestion pack.`)}</p>
      <div class="resolver-acts">
        <a class="btn btn-accent" href="#/library">Browse Catalog</a>
        <a class="btn" href="#/title/${state.currentTitle}/">Back to ${state.currentTitle} CFR</a>
      </div>
    </div>
  `;
  enterView();
}

export function renderNotFound(): void {
  clearTreeSelection();
  document.title = 'Not found · FRAMEWORK';
  setViewHead('');
  dom.view.innerHTML = `
    <div class="empty-state">
      <h2>Page not found</h2>
      <p>That section or part isn’t in Title ${state.currentTitle}.</p>
      <a href="#/title/${state.currentTitle}/" class="btn">Back to Title ${state.currentTitle}</a>
    </div>
  `;
  enterView();
}
