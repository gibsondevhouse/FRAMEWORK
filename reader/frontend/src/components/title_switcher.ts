import { CorpusSummary, state } from '../state';
import { on } from '../core/events';
import { closeAllPopovers, registerPopoverCloser } from './popover';
import {
  allSystemFrameworks, authorityForCorpus, corpusHashFor, deskLabel, refTierForCorpus, syncCorporaState, TIER_META, TIER_ORDER,
} from './corpora';
import { clearTreeSelection, switchTitle } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, safeHttpUrl } from '../dom';
import { dom } from '../state_init';

// --- Federal Framework Switcher (top bar) ---
let switcherDeskFilter = 'all';

function activeRouteKind(): 'cfr' | 'usc' | 'fr' | 'corpus' | 'platform' {
  const p = (state.activeRoute || '/').split('?')[0] || '/';
  if (p.startsWith('/news')) return 'fr';
  if (/^\/usc\/\d+(?:\/|$)/.test(p)) return 'usc';
  if (p.startsWith('/corpus/')) {
    return state.activeCorpus?.tier === 'federal-register' ? 'fr' : 'corpus';
  }
  if (/^\/(?:title\/\d+(?:\/|$)|part\/|section\/)/.test(p)) return 'cfr';
  return 'platform';
}

export function searchPlaceholderFor(on: boolean): string {
  if (!on) return 'Install a federal code or browse Federal Register…';
  if (window.matchMedia('(max-width: 600px)').matches) return 'Search…';
  const kind = activeRouteKind();
  if (kind === 'cfr') return `Search ${state.currentTitle} CFR or jump to a section…`;
  if (kind === 'usc' && state.currentUscTitle) return `Search ${state.currentUscTitle} U.S.C. or federal codes…`;
  if (kind === 'fr') return 'Search federal codes, § sections, or > commands…';
  return 'Search federal codes, § sections, or > commands…';
}

export function setReaderEnabled(on: boolean): void {
  dom.search.disabled = !on;
  dom.search.placeholder = searchPlaceholderFor(on);
  dom.chatToggle.disabled = !on;
  if (!on) {
    dom.edition.textContent = '';
    dom.tree.innerHTML = '<div class="side-empty">No federal codes installed yet. <a href="#/">Pick a profile</a> or open the <a href="#/library">library</a>.</div>';
  }
}

window.matchMedia('(max-width: 600px)').addEventListener?.('change', () => {
  if (dom.search) dom.search.placeholder = searchPlaceholderFor(!state.noTitles);
});

on('title:switched', () => {
  fillTitleSelect();
  if (dom.search) dom.search.placeholder = searchPlaceholderFor(true);
});

on('route:changed', () => {
  fillTitleSelect();
  if (dom.search) dom.search.placeholder = searchPlaceholderFor(!state.noTitles);
});

on('titles:refreshed', ({ hadNone, list }) => {
  fillTitleSelect();
  if (hadNone && list.length) setReaderEnabled(true);
});

function switcherGroupsHtml(query = '', desk = switcherDeskFilter): string {
  syncCorporaState();
  const corpora = allSystemFrameworks();
  const q = query.trim().toLowerCase();
  const filtered = corpora.filter(c => {
    if (desk !== 'all' && c.desk !== desk && c.desk !== 'all') return false;
    if (!q) return true;
    const hay = `${c.code} ${c.name} ${(c.agencies || []).join(' ')} ${deskLabel(c.desk || 'ehs')}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    return '<div class="tm-empty">No matching federal frameworks found.</div>';
  }

  const kind = activeRouteKind();
  return TIER_ORDER.map(tier => {
    const items = filtered.filter(c => c.tier === tier);
    if (!items.length) return '';
    const meta = TIER_META[tier];
    if (!meta) return '';
    return `
      <div class="tm-group" data-ref-tier="${meta.refTier}">
        <div class="tm-group-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(meta.label)}</span><span class="tm-group-count">${items.length}</span></div>
        ${items.map(c => {
          const isCurrent = c.tier === 'federal-reg'
            ? (kind === 'cfr' && c.title_num === state.currentTitle)
            : c.tier === 'federal-register'
              ? (kind === 'fr')
              : c.tier === 'federal-statute' && kind === 'usc'
                ? (c.title_num === state.currentUscTitle)
                : (kind === 'corpus' && state.activeCorpus?.corpus_id === c.corpus_id);
          const numText = c.tier === 'federal-reg' ? `${c.code} CFR` : c.code;
          const tag = c.partial ? 'Partial' : (c.status_label || (c.agencies?.[0] || ''));
          return `<button type="button" class="tm-item${isCurrent ? ' is-current' : ''}" role="menuitemradio" aria-checked="${isCurrent}" data-ref-tier="${meta.refTier}" ${c.tier === 'federal-reg' ? `data-title="${c.title_num}"` : `data-corpus-hash="${escapeHtml(corpusHashFor(c))}"`} tabindex="-1">
            <span class="tier-pip${c.installed === false ? ' is-hollow' : ''}" aria-hidden="true"></span>
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
  const kind = activeRouteKind();
  const numEl = document.getElementById('title-select-num');
  const nameEl = document.getElementById('title-select-name');

  if (kind === 'fr') {
    if (numEl) numEl.textContent = 'FR';
    if (nameEl) nameEl.textContent = 'Federal Register';
    dom.titleSelect.dataset.refTier = 'fr';
    dom.titleSelect.title = 'Federal Register · Switch federal framework';
    if (dom.edition) {
      const frDate = state.navNewsStatus?.sources?.federal_register?.last_ok_at?.slice(0, 10) || '';
      dom.edition.textContent = frDate ? `FR ${frDate}` : 'Federal Register';
      dom.edition.title = 'Federal Register feed';
    }
  } else if (kind === 'usc' && state.currentUscTitle) {
    const curUsc = state.installedUscTitles.find(u => u.title === state.currentUscTitle);
    const name = curUsc?.title_name || state.activeCorpus?.name || `Title ${state.currentUscTitle}`;
    if (numEl) numEl.textContent = `${state.currentUscTitle} U.S.C.`;
    if (nameEl) nameEl.textContent = name;
    dom.titleSelect.dataset.refTier = 'usc';
    dom.titleSelect.title = `${state.currentUscTitle} U.S.C.: ${name} · Switch federal framework`;
    if (dom.edition) {
      dom.edition.textContent = curUsc?.release_point ? `Release ${curUsc.release_point}` : 'U.S. Code';
      dom.edition.title = `${state.currentUscTitle} U.S.C. release point`;
    }
  } else if (kind === 'corpus' && state.activeCorpus) {
    const shortCode = state.activeCorpus.tier === 'federal-statute'
      ? state.activeCorpus.code.split('§§')[0].trim()
      : state.activeCorpus.code;
    if (numEl) numEl.textContent = shortCode;
    if (nameEl) nameEl.textContent = state.activeCorpus.name;
    dom.titleSelect.dataset.refTier = refTierForCorpus(state.activeCorpus);
    dom.titleSelect.title = `${state.activeCorpus.code}: ${state.activeCorpus.name} · Switch federal framework`;
    if (dom.edition) {
      dom.edition.textContent = state.activeCorpus.edition || (state.activeCorpus.tier === 'federal-statute' ? 'U.S. Code' : '');
      dom.edition.title = `${state.activeCorpus.code} edition`;
    }
  } else if (kind === 'cfr' && !state.noTitles) {
    const cur = state.installedTitles.find(t => t.title === state.currentTitle);
    const name = cur ? cur.name : (state.metaInfo.name || '');
    const ed = cur?.edition || state.metaInfo.edition || '';
    if (numEl) numEl.textContent = `${state.currentTitle} CFR`;
    if (nameEl) nameEl.textContent = name;
    dom.titleSelect.dataset.refTier = 'cfr';
    dom.titleSelect.title = `${state.currentTitle} CFR${name ? ': ' + name : ''} · Switch federal framework`;
    if (dom.edition) {
      dom.edition.textContent = ed ? `eCFR ${ed}` : '';
      dom.edition.title = 'eCFR edition loaded for this title';
    }
  } else {
    if (numEl) numEl.textContent = 'Federal';
    if (nameEl) nameEl.textContent = state.noTitles ? 'Frameworks' : 'All Frameworks';
    dom.titleSelect.dataset.refTier = 'local';
    dom.titleSelect.title = 'Switch federal framework (U.S.C., CFR, Federal Register)';
    if (dom.edition) {
      dom.edition.textContent = '';
      dom.edition.title = '';
    }
  }

  const desks = [...new Set(corpora.map(c => c.desk).filter((d): d is NonNullable<typeof d> => Boolean(d) && d !== 'all'))];
  const showDesks = corpora.length > 6 || desks.length > 1;
  const showSearch = corpora.length >= 3;
  const deskPillsHtml = showDesks ? `
    <div class="tm-desks" role="group" aria-label="Filter frameworks by topic">
      <button type="button" class="tm-desk-pill${switcherDeskFilter === 'all' ? ' is-on' : ''}" data-tm-desk="all">All</button>
      ${desks.map(d => `<button type="button" class="tm-desk-pill${switcherDeskFilter === d ? ' is-on' : ''}" data-tm-desk="${escapeHtml(d)}">${escapeHtml(deskLabel(d).split(' ')[0])}</button>`).join('')}
    </div>` : '';

  dom.titlePop.innerHTML = `
    <div class="tm-head">
      ${showSearch ? '<input type="search" class="tm-search" id="title-pop-q" placeholder="Filter federal frameworks (CFR, FR, U.S.C.)…" aria-label="Filter federal frameworks" autocomplete="off" spellcheck="false">' : ''}
      ${deskPillsHtml}
    </div>
    <div id="tm-groups">${switcherGroupsHtml()}</div>
    <div class="tm-sep" role="separator"></div>
    <a class="tm-item tm-download" role="menuitem" href="#/library" tabindex="-1">${icon('download')}<span class="tm-name">Browse Federal Library &amp; Downloads…</span></a>`;
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
  const meta = TIER_META[corpus.tier] || TIER_META['federal-statute'];
  const refTier = refTierForCorpus(corpus);
  const linked = (corpus.linked_titles || [])
    .map(n => state.installedTitles.find(t => t.title === n))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const extUrl = safeHttpUrl(corpus.external_url);
  const dolOn = Boolean(state.navNewsStatus?.dol_configured);
  const frQuick = corpus.tier === 'federal-register' ? `
    <div class="hm-title-parts" style="margin-top:16px">
      <a class="hm-part-chip" href="#/news?cat=rules"><span class="hm-part-num">Final Rules</span></a>
      <a class="hm-part-chip" href="#/news?cat=rulemaking"><span class="hm-part-num">Proposed Rules</span></a>
      <a class="hm-part-chip" href="#/news?cat=notices"><span class="hm-part-num">Notices</span></a>
      <a class="hm-part-chip" href="#/news?cat=public_inspection"><span class="hm-part-num">Public Inspection</span></a>
      ${dolOn ? '<a class="hm-part-chip" href="#/news?cat=enforcement"><span class="hm-part-num">Enforcement</span></a>' : ''}
    </div>` : '';
  const linkedChips = linked.length ? `
    <div class="hm-title-parts" style="margin-top:14px">
      ${linked.map(t => `<a class="citation-chip" data-ref-tier="cfr" href="#/title/${t.title}/">${t.title} CFR · ${escapeHtml(t.name)}</a>`).join('')}
    </div>` : '';

  const auth = authorityForCorpus(corpus);
  const authDetailHtml = auth ? `
    <div class="hm-usc-dossier" style="margin-top:18px">
      <div class="hm-usc-sec-lbl">Principal Enacted Acts</div>
      <div class="hm-usc-acts">
        ${auth.acts.map(a => `<span class="hm-usc-act">${escapeHtml(a)}</span>`).join('')}
      </div>
      <div class="hm-usc-sec-lbl" style="margin-top:14px">Key Enabling Provisions &amp; Implementing CFR Rules</div>
      <div class="hm-usc-provs">
        ${auth.provisions.map(p => {
          const isInst = state.installedTitles.some(x => x.title === p.cfrTitle);
          const cfrHref = isInst
            ? (p.cfrSection ? `#/title/${p.cfrTitle}/section/${encodeURIComponent(p.cfrSection)}` : `#/title/${p.cfrTitle}/part/${encodeURIComponent(p.cfrPart || '')}`)
            : `#/library/${p.cfrTitle}`;
          const cfrLabel = p.cfrSection ? `${p.cfrTitle} CFR § ${p.cfrSection}` : `${p.cfrTitle} CFR Part ${p.cfrPart}`;
          return `
            <div class="hm-usc-prov-row">
              <div class="hm-usc-prov-main">
                <span class="hm-usc-prov-cite">${escapeHtml(p.cite)}</span>
                <span class="hm-usc-prov-title">${escapeHtml(p.title)}</span>
              </div>
              <a class="citation-chip${isInst ? '' : ' is-dim'}" data-ref-tier="${isInst ? 'cfr' : 'uninstalled'}" href="${cfrHref}">${escapeHtml(cfrLabel)}</a>
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const jurText = corpus.jurisdiction_label || 'Federal';
  document.title = `${corpus.code} · ${corpus.name} · FRAMEWORK`;
  dom.view.innerHTML = `
    <div class="resolver-card has-tier-bar" data-ref-tier="${refTier}">
      <div class="doc-kicker"><span class="ref-badge">${escapeHtml(meta.tag)}</span> <span class="sep" aria-hidden="true">·</span> ${escapeHtml(jurText)}${corpus.status_label ? ` <span class="sep" aria-hidden="true">·</span> ${escapeHtml(corpus.status_label)}` : ''}</div>
      <h1 class="doc-title">${escapeHtml(corpus.code)} — ${escapeHtml(corpus.name)}</h1>
      <p class="resolver-msg">${escapeHtml(corpus.summary || `This ${meta.label.toLowerCase()} framework is integrated into FRAMEWORK’s federal navigation and authority chain.`)}</p>
      ${frQuick}
      ${linkedChips}
      ${authDetailHtml}
      <div class="resolver-acts">
        ${corpus.tier === 'federal-register' ? `<a class="btn btn-accent" href="#/news">Open Newsroom ${icon('chevronRight')}</a>` : ''}
        ${extUrl ? `<a class="btn btn-accent" href="${escapeHtml(extUrl)}" target="_blank" rel="noopener noreferrer">Open Official U.S.C. ${icon('external')}</a>` : ''}
        <a class="btn" href="#/library">Browse Library</a>
        <a class="btn" href="#/">Back to Home</a>
      </div>
    </div>
  `;
  enterView();
}

export function renderNotFound(): void {
  clearTreeSelection();
  document.title = 'Not found · FRAMEWORK';
  setViewHead('');
  const onTitleRoute = /^\/title\/\d+/.test(state.activeRoute || '');
  dom.view.innerHTML = `
    <div class="empty-state">
      <h2>Page not found</h2>
      <p>${onTitleRoute ? `That section or part isn’t in ${state.currentTitle} CFR.` : 'That federal framework or provision could not be found.'}</p>
      <a href="${onTitleRoute ? `#/title/${state.currentTitle}/` : '#/'}" class="btn">${onTitleRoute ? `Back to ${state.currentTitle} CFR` : 'Back to Home'}</a>
    </div>
  `;
  enterView();
}
