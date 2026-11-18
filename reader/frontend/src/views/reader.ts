import { SectionDocData, state } from '../state';
import { fetchSectionGraph, fetchSectionRaw } from '../api/client';
import { currentSectionRef } from '../core/projects_store';
import { onView } from '../core/view_dispatch';
import { citePop, renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { pinButtonHtml } from '../components/pin_pop';
import { adjustFontSize, bindRail, railHtml, sectionHref, unitShort, unitStepHtml, watchRail } from '../components/rail';
import { syncMainTabFromRoute } from '../components/reader_tabs';
import { collectSectionReferences, openCitedByPopover, openRefsLedgerPopover } from '../components/refs_popovers';
import { clearTreeSelection, partForSection, selectTreeNode } from '../components/sidebar';
import { renderNotFound } from '../components/title_switcher';
import { docStepHtml, setViewHead } from '../components/view_head';
import { cleanInlineLabel, copyText, enterView, escapeHtml, icon, lsGet, lsSet, safeHttpUrl, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { recordSectionUnit, recordSectionVisit } from '../usage';
import {
  createParaToolsController, enhanceDomAnchors, highlightTarget,
  openFigureModal, renderViewError, wrapIbrMentions,
} from './doc_utils';

const READING_MODE_KEY = 'readingModeByPart:v1';

function loadReadingModePrefs(): Record<string, string> {
  try {
    const obj = JSON.parse(lsGet(READING_MODE_KEY) || '{}') as unknown;
    return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function getPreferredPartMode(title: number, part: string | null | undefined): string | null {
  if (!part) return null;
  const prefs = loadReadingModePrefs();
  return prefs[`${title}|${part}`] || null;
}

function savePreferredPartMode(title: number, part: string, mode: string): void {
  if (!part) return;
  const prefs = loadReadingModePrefs();
  prefs[`${title}|${part}`] = mode;
  lsSet(READING_MODE_KEY, JSON.stringify(prefs));
}

export function highlightParagraph(pText: string, delay = 120): void {
  highlightTarget(dom.view, pText, delay);
}

const mainParaTools = createParaToolsController({
  root: dom.view,
  bodySelector: '.reg-body',
  paraSelector: '.reg-body .reg-p[id]',
  isActive: () => Boolean(state.currentSection),
  getSectionRef: currentSectionRef,
});

onView('click', async (e) => {
  if (await mainParaTools.handleClick(e)) return;
  const t = e.target as Element | null;
  if (!t) return;

  if (t.closest('#btn-copy-link')) {
    await copyText(window.location.href, 'Link copied', 'Couldn’t copy the link');
    return;
  }
  if (t.closest('#font-dec')) { adjustFontSize(-1); return; }
  if (t.closest('#font-inc')) { adjustFontSize(1); return; }

  const modeBtn = t.closest<HTMLElement>('a[data-mode-pref]');
  if (modeBtn && state.currentSection?.part && modeBtn.dataset.modePref) {
    savePreferredPartMode(state.currentTitle, state.currentSection.part, modeBtn.dataset.modePref);
  }

  const citedBtn = t.closest('#btn-cited-by');
  if (citedBtn && state.currentSection) {
    const graphData = state.graphCache.get(`${state.currentTitle}|${state.currentSection.id}`);
    if (graphData) openCitedByPopover(citedBtn, graphData);
    return;
  }

  const refsBtn = t.closest('#btn-refs-ledger');
  if (refsBtn && state.currentSection) {
    openRefsLedgerPopover(refsBtn);
    return;
  }

  if ((e as MouseEvent).altKey) return;
  const localPara = t.closest<HTMLElement>('a.xref-local[data-local-para]');
  if (localPara?.dataset.localPara) {
    e.preventDefault();
    highlightParagraph(localPara.dataset.localPara, 0);
    return;
  }
  const figLink = t.closest('a.reg-figure:not(.is-broken)');
  if (figLink && dom.view.contains(figLink)) {
    e.preventDefault();
    openFigureModal(figLink);
  }
});

function updateRefsLedgerButton(): void {
  const btn = document.getElementById('btn-refs-ledger');
  if (!btn) return;
  const items = collectSectionReferences();
  const span = btn.querySelector('span');
  if (span) span.textContent = items.length ? `Refs ${items.length}` : 'Refs';
  btn.hidden = items.length === 0;
}

async function fillSectionGraph(titleNum: number, sectionId: string, seq: number, signal?: AbortSignal): Promise<void> {
  let data;
  try {
    data = await fetchSectionGraph(titleNum, sectionId, { signal });
  } catch {
    return;
  }
  if (!data || seq !== state.routeSeq || !state.currentSection || state.currentSection.id !== sectionId) return;

  if (data.cited_by_count > 0) {
    const btn = document.getElementById('btn-cited-by');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) span.textContent = `Cited by ${data.cited_by_count}`;
      btn.hidden = false;
    }
  }
  if (data.ibr && data.ibr.length) {
    wrapIbrMentions(dom.view, data.ibr);
    updateRefsLedgerButton();
  }
}

export async function loadSection(sectionId: string, params?: URLSearchParams | null, view?: string | null): Promise<void> {
  mainParaTools.hide();
  citePop.close(false);
  const knownPart = partForSection(sectionId);
  const prefMode = !view && !params?.get('p') && knownPart ? getPreferredPartMode(state.currentTitle, knownPart) : null;
  const full = view === 'full' || prefMode === 'full';
  const pClause = params && /^\(([a-z])\)/.exec(params.get('p') || '');
  const unit = full ? null : (view || (pClause ? pClause[1] : ''));
  const sameSection = Boolean(state.currentSection && state.currentSection.id === sectionId && !dom.view.querySelector('.loading'));
  if (!sameSection) dom.view.innerHTML = skeletonHtml('doc', 'Loading section ' + sectionId + '…');
  try {
    const qs = unit === null ? '' : '?unit=' + encodeURIComponent(unit);
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    const res = await fetchSectionRaw(state.currentTitle, sectionId, qs, { signal });
    if (seq !== state.routeSeq) return;
    if (!res.ok) {
      if (state.metaInfo?.partial && /^\d+[a-z]?(?:\.\d+.*)?$/i.test(sectionId)) {
        clearTreeSelection();
        setViewHead('');
        await renderResolverPage(dom.view, {
          title: state.currentTitle,
          section: sectionId,
          para: params ? params.get('p') : null,
        });
        return;
      }
      renderNotFound();
      return;
    }
    const data = (await res.json()) as SectionDocData;
    if (seq !== state.routeSeq) return;
    state.currentSection = data;
    state.currentPart = data.part;
    updateChatContext();

    const reading = data.mode === 'units' && data.unit ? 'units' : 'scroll';
    const outline = data.outline || [];
    const unitIdx = reading === 'units' ? outline.findIndex(u => u.key === data.unit) : -1;
    const current = unitIdx >= 0 ? outline[unitIdx] : null;
    const heading = cleanInlineLabel(data.section_title || data.title_label || '');
    const label = cleanInlineLabel(data.label);
    document.title = `${label}${current ? ' ' + unitShort(current) : ''} · Title ${state.currentTitle}`;
    setViewHead((reading === 'units' ? unitStepHtml(data) : docStepHtml(data.part || '', data.prev, data.next)) + railHtml(data, reading));

    const partLink = data.part ? `<a href="#/part/${encodeURIComponent(data.part)}">Part ${escapeHtml(data.part)}</a>` : '';
    let unitBannerHtml = '';
    if (current) {
      const unitLabel = current.group && current.kind === 'chapter'
        ? `${current.group_label} · ${current.group_title || ''}`
        : `${current.label ? `Clause ${current.label}` : (current.title || '')}`;
      unitBannerHtml = `<div class="unit-context"><span>${escapeHtml(unitLabel)}</span><span class="sep" aria-hidden="true">·</span><span class="unit-pos">Unit ${unitIdx + 1} of ${outline.length}</span></div>`;
    }

    const fullPart = data.part ? `<a class="btn" href="#/part/${encodeURIComponent(data.part)}/full?from=${encodeURIComponent(data.id)}">${icon('list')} See full part</a>` : '';
    const toggle = data.mode !== 'units' ? ''
      : full ? `<a class="btn" href="${sectionHref(data.id)}" data-mode-pref="units">${icon('stack')} Read in parts</a>`
      : `<a class="btn" href="${sectionHref(data.id, 'full')}" data-mode-pref="full">${icon('expand')} See full section</a>`;
    const ecfrHref = safeHttpUrl(data.ecfr_url);
    dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${partLink}</div>
      <h1 class="doc-title">${escapeHtml(label)} ${escapeHtml(heading)}</h1>

      <div class="doc-actions">
        ${toggle}
        ${fullPart}
        ${pinButtonHtml()}
        ${newsActivityButtonHtml()}
        <button type="button" class="btn" id="btn-cited-by" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('link')} <span>Cited by</span></button>
        <button type="button" class="btn" id="btn-refs-ledger" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('list')} <span>Refs</span></button>
        <div class="spacer"></div>
        <div class="doc-actions-util">
          ${ecfrHref ? `<a class="btn" href="${escapeHtml(ecfrHref)}" target="_blank" rel="noopener" title="Open official text on eCFR">${icon('external')} eCFR</a>` : ''}
          <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon('link')} Copy link</button>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>
      </div>

      ${data.reserved ? '<div class="reserved-note">This section is reserved.</div>' : ''}
      ${unitBannerHtml}

      ${data.html || ''}
    `;

    enhanceDomAnchors(dom.view);
    updateRefsLedgerButton();
    syncMainTabFromRoute({
      kind: 'section',
      title: state.currentTitle,
      sectionId: data.id,
      unit: data.unit || (full ? 'full' : null),
      para: params?.get('p') || null,
      label: `${state.currentTitle} CFR ${label}`,
      heading,
      href: window.location.hash || sectionHref(data.id, data.unit || (full ? 'full' : null)),
    });
    const swapX = state.swapMotionX || 0;
    state.swapMotionX = 0;
    enterView({ subtle: sameSection && !swapX, fromX: swapX });
    bindRail();
    if (reading === 'scroll') watchRail();
    else if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }

    const pTarget = params?.get('p');
    if (pTarget) highlightParagraph(pTarget);

    selectTreeNode('s-' + data.id);
    const unitInfo = reading === 'units' && current ? { key: current.key, label: unitShort(current) } : null;
    if (!sameSection) recordSectionVisit(data, unitInfo);
    else recordSectionUnit(data.id, unitInfo);
    fillNewsActivity('section', data.id, seq);
    fillSectionGraph(state.currentTitle, data.id, seq, signal);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load section', (err instanceof Error ? err.message : '') || 'Unexpected error', {
      onRetry: () => loadSection(sectionId, params, view),
    });
  }
}
