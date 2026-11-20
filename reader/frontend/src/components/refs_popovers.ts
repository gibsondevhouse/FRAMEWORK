import { RefTier, SectionGraphData, state } from '../state';
import { emit } from '../core/events';
import { cleanInlineLabel, escapeHtml, icon, plural } from '../dom';
import { dom } from '../state_init';
import { flashElements, parseCfrHref } from '../views/doc_utils';
import { citePop } from './cfr_resolver';
import { openMainReaderTab } from './reader_tabs';

// Shared Cited-By and Outgoing References Ledger popovers for main reader and #split-pane.

interface LedgerGroupDef {
  tier: RefTier;
  label: string;
}

const LEDGER_GROUPS: LedgerGroupDef[] = [
  { tier: 'usc', label: 'Federal Statutes · U.S.C.' },
  { tier: 'cfr', label: 'Current Title CFR' },
  { tier: 'cross', label: 'Cross-Title CFR' },
  { tier: 'state', label: 'State Authorities' },
  { tier: 'county', label: 'County & Municipal' },
  { tier: 'ibr', label: 'IBR Standards' },
  { tier: 'fr', label: 'Federal Register' },
  { tier: 'uninstalled', label: 'Uninstalled Corpora' },
  { tier: 'local', label: 'Clauses, Tables & Figures' },
  { tier: 'web', label: 'External Portals' },
];

export interface CollectedReference {
  idx: number;
  tier: RefTier;
  code: string;
  sub: string;
  href: string;
  external: boolean;
  splitHref: string;
  splitTitle: number;
  el: HTMLElement;
}

let activeLedgerItems: CollectedReference[] = [];

function renderCitedByListHtml(graphData: SectionGraphData, targetTitle = state.currentTitle, filter = ''): string {
  const q = filter.trim().toLowerCase();
  const rows = (graphData.cited_by || []).filter(c => {
    if (!q) return true;
    return `${c.id} ${c.label} ${c.title} ${c.part}`.toLowerCase().includes(q);
  });
  if (!rows.length) return '<p class="peek-text is-empty">No matching citing sections.</p>';
  return `<div class="cited-list">${rows.slice(0, 50).map(c => {
    const href = `#/title/${targetTitle}/section/${encodeURIComponent(c.id)}`;
    return `
      <div class="cited-row">
        <a class="cited-link" href="${href}">
          <span class="cited-num">${escapeHtml(c.label)}</span>
          <span class="cited-title">${escapeHtml(c.title)}</span>
        </a>
        <button type="button" class="lib-act cited-split" data-cited-tab="${escapeHtml(c.id)}" data-cited-title="${targetTitle}" title="Open in reader tab">Tab</button>
        <button type="button" class="lib-act cited-split" data-cited-split="${escapeHtml(c.id)}" data-cited-title="${targetTitle}" title="Open side-by-side">Split</button>
      </div>`;
  }).join('')}</div>`;
}

export function openCitedByPopover(btn: Element | null, graphData: SectionGraphData, targetTitle = state.currentTitle): void {
  const total = graphData.cited_by_count || 0;
  const filterHtml = total >= 6
    ? `<input type="search" class="pop-filter" id="cited-pop-filter" placeholder="Filter ${total} citing sections…" aria-label="Filter citing sections" autocomplete="off">`
    : '';
  citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Cited by ${plural(total, 'section')} in Title ${targetTitle}</div>
      <span class="peek-badge">CITED BY</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close citing sections">${icon('close')}</button>
    </div>
    ${filterHtml}
    <div id="cited-pop-list">${renderCitedByListHtml(graphData, targetTitle)}</div>
  `, { interactive: true, returnFocus: btn, focusSelector: '#cited-pop-filter, .cited-link', refTier: 'cfr' });

  const filterEl = document.getElementById('cited-pop-filter') as HTMLInputElement | null;
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      const slot = document.getElementById('cited-pop-list');
      if (slot) slot.innerHTML = renderCitedByListHtml(graphData, targetTitle, filterEl.value);
      citePop.reposition(btn);
    });
  }
}

function classifyDomRef(el: Element): RefTier {
  if (el.classList.contains('xref-usc')) return 'usc';
  if (el.classList.contains('xref-fr')) return 'fr';
  if (el.classList.contains('xref-ibr')) return 'ibr';
  if (el.classList.contains('xref-state')) return 'state';
  if (el.classList.contains('xref-county')) return 'county';
  if (el.classList.contains('xref-external')) return 'uninstalled';
  if (el.classList.contains('xref-cross')) return 'cross';
  if (el.classList.contains('xref-local') || el.classList.contains('xref-anchor') || el.classList.contains('ftref')) return 'local';
  if (el.classList.contains('xref-web')) return 'web';
  return 'cfr';
}

export function collectSectionReferences(root: Element | null = dom.view, fallbackTitle = state.currentTitle): CollectedReference[] {
  const bodies = root ? [...root.querySelectorAll('.reg-body, .front-matter, .split-body')] : [];
  const scopes = bodies.length ? bodies : (root ? [root] : []);
  if (!scopes.length) return [];
  const seen = new Map<string, CollectedReference>();
  for (const scope of scopes) {
    const nodes = scope.querySelectorAll<HTMLElement>('a.xref, button.xref-anchor, button.xref-ibr, .ftref[data-anchor]');
    for (const el of nodes) {
      const tier = classifyDomRef(el);
      const label = cleanInlineLabel(el.textContent);
      if (!label) continue;
      // A local U.S. Code link (/usc/16/1533) opens the in-app U.S.C. reader from the ledger.
      const rawHref = el.getAttribute('href') || '';
      const uscLocal = /^\/usc\/(\d+)\/([^?#]+)$/.exec(rawHref);
      const href = uscLocal ? `#/usc/${uscLocal[1]}/section/${uscLocal[2]}` : rawHref;
      const anchor = el.dataset.anchor || '';
      const ibrCode = el.dataset.ibrCode || '';
      const localPara = el.dataset.localPara || '';
      const dedupKey = `${tier}|${href || anchor || ibrCode || localPara || label.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;

      let sub = '';
      if (tier === 'usc') sub = el.getAttribute('title')?.replace(/^View\s+|\s+at Cornell LII$/g, '') || 'United States Code';
      else if (tier === 'fr') sub = 'Federal Register';
      else if (tier === 'ibr') sub = el.getAttribute('title') || 'Incorporated consensus standard';
      else if (tier === 'uninstalled') sub = `Title ${el.dataset.cfrTitle || ''} CFR (click to download)`;
      else if (tier === 'local') sub = el.classList.contains('ftref') ? 'Footnote in section' : (localPara ? 'Clause in section' : 'Table / Figure / Appendix');
      else if (tier === 'web') sub = href.replace(/^https?:\/\//i, '').split('/')[0];
      else {
        const parsed = parseCfrHref(href, fallbackTitle);
        sub = parsed?.kind === 'section' ? `${parsed.title} CFR § ${parsed.section}${parsed.para || ''}`
          : parsed?.kind === 'part' ? `${parsed.title} CFR Part ${parsed.part}` : 'CFR Reference';
      }

      const parsed = href.startsWith('#') ? parseCfrHref(href, fallbackTitle) : null;
      const canSplit = Boolean(parsed?.kind === 'section' || parsed?.kind === 'part');
      seen.set(dedupKey, {
        idx: seen.size,
        tier,
        code: label,
        sub,
        href,
        external: el.getAttribute('target') === '_blank',
        splitHref: canSplit ? href : '',
        splitTitle: parsed?.title || fallbackTitle,
        el,
      });
    }
  }
  return [...seen.values()];
}

function renderRefsLedgerHtml(items: CollectedReference[], filter = ''): string {
  const q = filter.trim().toLowerCase();
  const filtered = q ? items.filter(x => `${x.code} ${x.sub} ${x.tier}`.toLowerCase().includes(q)) : items;
  if (!filtered.length) return '<p class="peek-text is-empty">No matching references in this section.</p>';
  const byTier = new Map<RefTier, CollectedReference[]>();
  for (const item of filtered) {
    let bucket = byTier.get(item.tier);
    if (!bucket) {
      bucket = [];
      byTier.set(item.tier, bucket);
    }
    bucket.push(item);
  }
  return `<div class="refs-ledger-wrap">${LEDGER_GROUPS.filter(g => byTier.has(g.tier)).map(g => {
    const groupItems = byTier.get(g.tier) || [];
    return `
      <div class="refs-ledger-group" data-ref-tier="${g.tier}">
        <div class="refs-ledger-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(g.label)}</span><span class="refs-ledger-count">${groupItems.length}</span></div>
        ${groupItems.slice(0, 25).map(item => `
          <div class="refs-ledger-row">
            ${item.external && item.href
              ? `<a class="refs-ledger-link" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer"><span class="refs-ledger-code">${escapeHtml(item.code)}</span><span class="refs-ledger-sub">${escapeHtml(item.sub)}</span></a>`
              : `<button type="button" class="refs-ledger-link" data-ledger-idx="${item.idx}"><span class="refs-ledger-code">${escapeHtml(item.code)}</span><span class="refs-ledger-sub">${escapeHtml(item.sub)}</span></button>`}
            ${item.splitHref ? `<button type="button" class="lib-act cited-split" data-ledger-tab="${escapeHtml(item.splitHref)}" data-ledger-title="${item.splitTitle}" title="Open in reader tab">Tab</button><button type="button" class="lib-act cited-split" data-ledger-split="${escapeHtml(item.splitHref)}" data-ledger-title="${item.splitTitle}" title="Open side-by-side">Split</button>` : ''}
          </div>
        `).join('')}
      </div>`;
  }).join('')}</div>`;
}

export function openRefsLedgerPopover(btn: Element | null, root: Element | null = dom.view, fallbackTitle = state.currentTitle): void {
  activeLedgerItems = collectSectionReferences(root, fallbackTitle);
  const total = activeLedgerItems.length;
  const topTier = activeLedgerItems[0]?.tier || 'cfr';
  const filterHtml = total >= 8
    ? `<input type="search" class="pop-filter" id="refs-ledger-filter" placeholder="Filter ${total} outgoing references…" aria-label="Filter section references" autocomplete="off">`
    : '';
  citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Outgoing References (${total})</div>
      <span class="peek-badge">LEDGER</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close reference ledger">${icon('close')}</button>
    </div>
    ${filterHtml}
    <div id="refs-ledger-list">${renderRefsLedgerHtml(activeLedgerItems)}</div>
  `, { interactive: true, returnFocus: btn, focusSelector: '#refs-ledger-filter, .refs-ledger-link', refTier: topTier });

  const filterEl = document.getElementById('refs-ledger-filter') as HTMLInputElement | null;
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      const slot = document.getElementById('refs-ledger-list');
      if (slot) slot.innerHTML = renderRefsLedgerHtml(activeLedgerItems, filterEl.value);
      citePop.reposition(btn);
    });
  }
}

if (dom.citePop) {
  dom.citePop.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    const sp = t?.closest<HTMLElement>('[data-cited-split]');
    if (sp) {
      const secId = sp.dataset.citedSplit;
      const tNum = Number(sp.dataset.citedTitle) || state.currentTitle;
      citePop.close(false);
      if (secId) emit('split:open', { title: tNum, sectionId: secId, pushHistory: true });
      return;
    }
    const ctab = t?.closest<HTMLElement>('[data-cited-tab]');
    if (ctab) {
      const secId = ctab.dataset.citedTab;
      const tNum = Number(ctab.dataset.citedTitle) || state.currentTitle;
      citePop.close(false);
      if (secId) openMainReaderTab({ kind: 'section', title: tNum, sectionId: secId });
      return;
    }
    const lsp = t?.closest<HTMLElement>('[data-ledger-split]');
    if (lsp) {
      const baseTitle = Number(lsp.dataset.ledgerTitle) || state.currentTitle;
      const parsed = parseCfrHref(lsp.dataset.ledgerSplit || '', baseTitle);
      citePop.close(false);
      if (parsed?.kind === 'section') {
        emit('split:open', { title: parsed.title, sectionId: parsed.section, para: parsed.para, unit: parsed.unit, pushHistory: true });
      } else if (parsed?.kind === 'part') {
        emit('split:open', { kind: 'part', title: parsed.title, partId: parsed.part, pushHistory: true });
      }
      return;
    }
    const ltab = t?.closest<HTMLElement>('[data-ledger-tab]');
    if (ltab) {
      const baseTitle = Number(ltab.dataset.ledgerTitle) || state.currentTitle;
      const parsed = parseCfrHref(ltab.dataset.ledgerTab || '', baseTitle);
      citePop.close(false);
      if (parsed?.kind === 'section') {
        openMainReaderTab({ kind: 'section', title: parsed.title, sectionId: parsed.section, para: parsed.para, unit: parsed.unit });
      } else if (parsed?.kind === 'part') {
        openMainReaderTab({ kind: 'part', title: parsed.title, partId: parsed.part });
      }
      return;
    }
    const ljmp = t?.closest<HTMLElement>('[data-ledger-idx]');
    if (ljmp) {
      const idx = Number(ljmp.dataset.ledgerIdx);
      const item = activeLedgerItems[idx];
      if (!item) return;
      if (item.el?.isConnected && (item.tier === 'local' || item.tier === 'ibr' || item.tier === 'uninstalled')) {
        citePop.close(false);
        flashElements([item.el], true);
      } else if (item.href && item.href.startsWith('#')) {
        citePop.close(false);
        window.location.hash = item.href;
      }
    }
  });
}
