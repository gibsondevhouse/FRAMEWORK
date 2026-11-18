import { NewsActivityCtx, SectionDocData, SectionGraphData, SplitState, state } from '../state';
import {
  fetchPartFront, fetchPartFull, fetchSectionGraph, fetchSectionRaw,
  fetchTitleTree, titleTreeCache,
} from '../api/client';
import { on } from '../core/events';
import { currentSectionRef, WorkspaceSectionRef } from '../core/projects_store';
import { animateCalm, cleanInlineLabel, copyText, escapeHtml, findPartInTree, icon, skeletonHtml } from '../dom';
import { fetchNewsActivity, openNewsActivityFor } from './news_activity';
import {
  buildPartTocView, handlePartTocCarouselClick, handlePartTocCarouselKeydown, initPartTocCarousels, PartFrontData,
} from './part_toc';
import { openSaveTabGroupMenu, pinButtonHtml, toggleSplitPinMenu } from './pin_pop';
import { adjustFontSize, scrollToAnchor, unitShort } from './rail';
import {
  buildReaderHref, formatTabLabel, openMainReaderTab, persistSessionTabs,
  registerSplitTabHandlers, renderMainTabs, tabIdentityMatch,
} from './reader_tabs';
import { collectSectionReferences, openCitedByPopover, openRefsLedgerPopover } from './refs_popovers';
import { dom } from '../state_init';
import {
  bindBrokenImageFallback, createParaToolsController, enhanceDomAnchors, highlightTarget,
  openFigureModal, parseCfrHref, wrapIbrMentions,
} from '../views/doc_utils';

let splitAbort: AbortController | null = null;
let splitSeq = 0;
let activeSplitDoc: SectionDocData | null = null;
let activeSplitGraph: SectionGraphData | null = null;
let activeSplitNewsCtx: NewsActivityCtx | null = null;

const splitParaTools = createParaToolsController({
  root: dom.splitPane,
  bodySelector: '.split-body',
  paraSelector: '.split-body .reg-p[id]',
  isActive: () => Boolean(activeSplitDoc),
  getSectionRef: activeSplitSectionRef,
});

function activeSplitTab(): SplitState | null {
  return state.splitTabs.find(t => t.id === state.activeSplitTabId) || state.splitTabs[0] || null;
}

function unitQueryFor(view: string | null | undefined, para: string | null | undefined): string {
  if (view === 'full') return '';
  if (view) return '?unit=' + encodeURIComponent(view);
  const pClause = para && /^\(([a-z])\)/i.exec(para.trim());
  return '?unit=' + encodeURIComponent(pClause ? pClause[1].toLowerCase() : '');
}

export function buildSplitHash(entry: SplitState | null = state.splitState): string {
  return buildReaderHref(entry);
}

export function isSplitOpen(): boolean {
  return Boolean(dom.splitPane && !dom.splitPane.hidden);
}

function makeSplitTab(entry: SplitState): SplitState {
  return {
    id: entry.id || `stab_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    kind: entry.kind || (entry.partId && !entry.sectionId ? 'part' : 'section'),
    title: Number(entry.title) || state.currentTitle || 29,
    sectionId: entry.sectionId ? String(entry.sectionId) : undefined,
    partId: entry.partId ? String(entry.partId) : undefined,
    full: Boolean(entry.full),
    para: entry.para || null,
    unit: entry.unit || null,
    label: entry.label || formatTabLabel(entry),
    heading: entry.heading || '',
    history: Array.isArray(entry.history) && entry.history.length ? entry.history : [{ ...entry }],
  };
}

function syncSplitTabStripInPlace(): void {
  const host = dom.splitPane?.querySelector('#split-tabs');
  if (host) host.outerHTML = splitTabsBarHtml();
}

export function splitTabsBarHtml(): string {
  if (!state.splitTabs.length) return '';
  const pills = state.splitTabs.map(tab => {
    const active = tab.id === state.activeSplitTabId;
    const tier = Number(tab.title) !== Number(state.currentTitle) ? 'cross' : 'cfr';
    const label = tab.label || formatTabLabel(tab);
    const titleAttr = `${label}${tab.heading ? ` — ${tab.heading}` : ''}`;
    return `
      <div class="reader-tab${active ? ' is-active' : ''}" data-ref-tier="${tier}" role="presentation">
        <button type="button" class="reader-tab-btn" role="tab" aria-selected="${active ? 'true' : 'false'}" data-split-tab="${escapeHtml(tab.id)}" title="${escapeHtml(titleAttr)}">
          <span class="tier-pip" aria-hidden="true"></span>
          <span class="reader-tab-label">${escapeHtml(label)}</span>
        </button>
        <button type="button" class="reader-tab-close" data-split-tab-close="${escapeHtml(tab.id)}" aria-label="Close ${escapeHtml(label)}" title="Close tab">${icon('close')}</button>
      </div>`;
  }).join('');
  return `
    <div id="split-tabs" class="reader-tabs is-split-tabs" role="tablist" aria-label="Side-by-side reader tabs">
      <div class="reader-tabs-strip">${pills}</div>
      <div class="reader-tabs-acts">
        <button type="button" class="btn btn-small reader-tabs-save" data-split-tabs-act="save-group" title="Save current main & side-by-side tabs as a workspace tab group">${icon('folder')} <span>Save group</span></button>
      </div>
    </div>`;
}

function splitHeaderHtml({
  splitTier = 'cfr',
  kickerHtml,
  titleText,
  hasBack = false,
  isLoading = false,
}: { splitTier?: string; kickerHtml: string; titleText: string; hasBack?: boolean; isLoading?: boolean }): string {
  const acts = isLoading
    ? `<button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon('close')}</button>`
    : `<button type="button" class="icon-btn" data-split-act="swap" title="Swap with main reader" aria-label="Swap panes">${icon('stack')}</button>
       <button type="button" class="icon-btn${state.splitWide ? ' is-active' : ''}" data-split-act="wide" title="Toggle split width" aria-label="Toggle width">${icon('expand')}</button>
       <button type="button" class="btn btn-small" data-split-act="to-main-tab" title="Move into a main reader tab">${icon('plus')} Main tab</button>
       <button type="button" class="btn btn-small" data-split-act="promote" title="Open in main reading pane">Open</button>
       <button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon('close')}</button>`;
  return `
    <header class="split-head" data-ref-tier="${splitTier}">
      ${hasBack ? `<button type="button" class="icon-btn" data-split-act="back" title="Back in split pane" aria-label="Back">${icon('chevronLeft')}</button>` : ''}
      <div class="split-head-meta">
        <div class="doc-kicker"><span class="tier-pip" aria-hidden="true"></span> ${kickerHtml}</div>
        <h2 class="split-head-title">${escapeHtml(titleText)}</h2>
      </div>
      <div class="split-head-acts">${acts}</div>
    </header>`;
}

export function closeSplitPane(): void {
  splitParaTools.hide();
  if (splitAbort) {
    try { splitAbort.abort(); } catch { /* ignore */ }
    splitAbort = null;
  }
  splitSeq++;
  activeSplitDoc = null;
  activeSplitGraph = null;
  activeSplitNewsCtx = null;
  state.splitState = null;
  state.splitTabs = [];
  state.activeSplitTabId = null;
  persistSessionTabs();
  renderMainTabs();
  if (dom.splitPane) {
    dom.splitPane.hidden = true;
    dom.splitPane.innerHTML = '';
  }
  if (dom.mainStage) {
    dom.mainStage.classList.remove('is-split', 'is-split-wide');
  }
}

export function closeSplitTab(tabId: string): void {
  const idx = state.splitTabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;
  if (state.splitTabs.length <= 1) {
    closeSplitPane();
    return;
  }
  const wasActive = state.splitTabs[idx].id === state.activeSplitTabId;
  state.splitTabs.splice(idx, 1);
  if (wasActive) {
    const next = state.splitTabs[Math.min(idx, state.splitTabs.length - 1)] || state.splitTabs[0];
    state.activeSplitTabId = next.id || null;
    persistSessionTabs();
    openSplitPane({ ...next, tabId: next.id, newTab: false, pushHistory: false });
  } else {
    persistSessionTabs();
    syncSplitTabStripInPlace();
  }
}

export function promoteSplitToMain(): void {
  if (!state.splitState) return;
  const target = buildSplitHash(state.splitState);
  closeSplitPane();
  window.location.hash = target;
}

export function moveActiveSplitToMainTab(): void {
  const active = activeSplitTab() || state.splitState;
  if (!active) return;
  const target = {
    kind: active.kind || (active.partId && !active.sectionId ? 'part' : 'section'),
    title: active.title,
    sectionId: active.sectionId,
    partId: active.partId,
    unit: active.unit || null,
    full: Boolean(active.full),
    para: active.para || null,
    label: active.label || formatTabLabel(active),
    heading: active.heading || '',
    href: buildSplitHash(active),
  };
  if (active.id && state.splitTabs.length > 1) {
    closeSplitTab(active.id);
  } else {
    closeSplitPane();
  }
  openMainReaderTab(target);
}

function activeSplitSectionRef(): WorkspaceSectionRef | null {
  if (!activeSplitDoc || !state.splitState || state.splitState.kind === 'part') return null;
  return {
    title: state.splitState.title,
    id: activeSplitDoc.id,
    label: cleanInlineLabel(activeSplitDoc.label) || `§ ${activeSplitDoc.id}`,
    heading: cleanInlineLabel(activeSplitDoc.section_title || activeSplitDoc.title_label || ''),
    part: activeSplitDoc.part || '',
    tier: 'federal-reg',
    jurisdiction: 'US',
  };
}

function swapSplitWithMain(): void {
  if (!state.splitState) return;
  const splitHref = buildSplitHash(state.splitState);
  const mainSec = currentSectionRef();
  const mainPart = !mainSec && state.currentPart ? { kind: 'part' as const, title: state.currentTitle, partId: state.currentPart } : null;
  if (!mainSec && !mainPart) {
    promoteSplitToMain();
    return;
  }
  const nextSplit: OpenSplitOptions = mainSec
    ? { kind: 'section', title: mainSec.title, sectionId: mainSec.id, unit: state.currentSection?.unit || null, label: `${mainSec.title} CFR ${mainSec.label}`, heading: mainSec.heading }
    : { kind: 'part', title: mainPart!.title, partId: mainPart!.partId, label: `${mainPart!.title} CFR Part ${mainPart!.partId}` };
  state.swapMotionX = 36;
  window.location.hash = splitHref;
  openSplitPane({ ...nextSplit, newTab: false, pushHistory: true, fromX: -36 });
}

async function loadTreeForTitle(tNum: number, signal?: AbortSignal) {
  if (tNum === state.currentTitle && state.treeData) return state.treeData;
  if (titleTreeCache.has(tNum)) return titleTreeCache.get(tNum) || null;
  try {
    return await fetchTitleTree(tNum, { signal });
  } catch {
    return null;
  }
}

function renderSplitLoading(tNum: number, labelText: string): void {
  dom.splitPane.innerHTML = `
    ${splitTabsBarHtml()}
    ${splitHeaderHtml({ splitTier: tNum !== state.currentTitle ? 'cross' : 'cfr', kickerHtml: `${tNum} CFR · ${escapeHtml(labelText)}`, titleText: 'Loading…', isLoading: true })}
    <div class="split-body">${skeletonHtml('doc', `Loading ${labelText}…`)}</div>
  `;
}

function renderSplitUnavailable(tNum: number, titleLabel: string, bodyMsg: string): void {
  dom.splitPane.innerHTML = `
    ${splitTabsBarHtml()}
    ${splitHeaderHtml({ splitTier: 'uninstalled', kickerHtml: `${tNum} CFR`, titleText: titleLabel, hasBack: (activeSplitTab()?.history?.length || 0) > 1 })}
    <div class="split-body"><p class="muted">${escapeHtml(bodyMsg)}</p></div>
  `;
}

function updateSplitRefsBtn(): void {
  const btn = document.getElementById('split-btn-refs');
  if (!btn || !state.splitState) return;
  const refs = collectSectionReferences(dom.splitPane, state.splitState.title);
  const span = btn.querySelector('span');
  if (span) span.textContent = refs.length ? `Refs ${refs.length}` : 'Refs';
  btn.hidden = refs.length === 0;
}

function splitActionsBarHtml({
  pinRef = null,
  partId = null,
  ecfrUrl = '',
  partFull = false,
}: {
  pinRef?: WorkspaceSectionRef | null;
  partId?: string | null;
  ecfrUrl?: string;
  partFull?: boolean;
} = {}): string {
  return `
    <div class="split-tools">
      ${partId ? `<button type="button" class="btn btn-small" data-split-part="${escapeHtml(partId)}" data-split-full="${partFull ? '1' : '0'}" title="${partFull ? 'View Full Part text' : `View Part ${escapeHtml(partId)} TOC`}">${icon('list')} ${partFull ? 'Full part' : `Part ${escapeHtml(partId)}`}</button>` : ''}
      ${pinRef ? pinButtonHtml(pinRef, 'split-btn-pin') : ''}
      <button type="button" class="btn btn-small" id="split-btn-refs" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('list')} <span>Refs</span></button>
      <button type="button" class="btn btn-small" id="split-btn-cited" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('link')} <span>Cited by</span></button>
      <button type="button" class="btn btn-small" id="split-btn-news" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('news')} <span>Activity</span></button>
      <div class="spacer"></div>
      <button type="button" class="btn btn-small" data-split-act="copy" title="Copy link">${icon('link')} Copy</button>
      ${ecfrUrl ? `<a class="btn btn-small" href="${escapeHtml(ecfrUrl)}" target="_blank" rel="noopener noreferrer" title="View on eCFR">${icon('external')} eCFR</a>` : ''}
      <div class="size-ctl split-size-ctl" role="group" aria-label="Text size">
        <button type="button" data-split-act="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
        <button type="button" data-split-act="font-inc" title="Larger text" aria-label="Larger text">A+</button>
      </div>
    </div>`;
}

async function openSplitPart(nextEntry: SplitState, seq: number, signal?: AbortSignal, { fromX = 0 }: { fromX?: number } = {}): Promise<void> {
  const tNum = nextEntry.title;
  const partId = nextEntry.partId || '';
  const full = Boolean(nextEntry.full);
  const tab = activeSplitTab();
  const hasBack = (tab?.history?.length || 0) > 1;

  if (full) {
    const [tree, fullRes] = await Promise.all([
      loadTreeForTitle(tNum, signal),
      fetchPartFull(tNum, partId, { signal }),
    ]);
    if (seq !== splitSeq) return;
    if (!fullRes.ok) {
      renderSplitUnavailable(tNum, `Part ${partId}`, `Couldn’t load full text for Title ${tNum} Part ${partId}.`);
      return;
    }
    const data = (await fullRes.json()) as { sections?: Array<{ id: string; label?: string; title?: string; reserved?: boolean; html?: string }> };
    if (seq !== splitSeq) return;
    const partNode = tree ? findPartInTree(tree, partId) : null;
    const heading = cleanInlineLabel(partNode?.d || partNode?.l || `Part ${partId}`);
    const splitTier = tNum !== state.currentTitle ? 'cross' : 'cfr';
    if (tab) {
      tab.label = `${tNum} CFR Part ${partId} · Full`;
      tab.heading = heading;
      persistSessionTabs();
    }
    const sections = data.sections || [];
    const sectionsHtml = sections.map(s => `
      <article class="full-section" id="split-sec-${escapeHtml(String(s.id).replace(/[^a-zA-Z0-9.\-]/g, '_'))}">
        <header class="full-section-head has-tier-bar" data-ref-tier="${splitTier}">
          <a class="full-section-anchor" href="#/title/${tNum}/section/${encodeURIComponent(s.id)}">
            <span class="full-section-num">${escapeHtml(s.label)}</span>
            <span class="full-section-title">${escapeHtml(s.title || '')}</span>
          </a>
        </header>
        ${s.reserved ? '<div class="reserved-note">This section is reserved.</div>' : (s.html || '')}
      </article>`).join('');

    dom.splitPane.innerHTML = `
      ${splitTabsBarHtml()}
      ${splitHeaderHtml({ splitTier, kickerHtml: `${tNum} CFR · Full Part ${escapeHtml(partId)}`, titleText: heading, hasBack })}
      ${splitActionsBarHtml({ partId, partFull: false })}
      <div class="split-body">${sectionsHtml || '<p class="muted">No sections in this part.</p>'}</div>
    `;
    const bodyEl = dom.splitPane.querySelector<HTMLElement>('.split-body');
    if (bodyEl) {
      enhanceDomAnchors(bodyEl);
      animateCalm(bodyEl, { fromY: fromX ? 0 : 14, fromX, fromScale: 0.992, duration: 640 });
    }
    updateSplitRefsBtn();
    hydrateSplitNews(tNum, 'part', partId, seq);
    dom.splitPane.scrollTop = 0;
    return;
  }

  const [tree, frontRes] = await Promise.all([
    loadTreeForTitle(tNum, signal),
    fetchPartFront(tNum, partId, { signal }),
  ]);
  if (seq !== splitSeq) return;
  const partNode = tree ? findPartInTree(tree, partId) : null;
  if (!partNode) {
    renderSplitUnavailable(tNum, `Part ${partId}`, `Title ${tNum} Part ${partId} isn’t installed yet.`);
    return;
  }
  const front: PartFrontData = frontRes.ok ? (await frontRes.json() as PartFrontData) : { part: '', subparts: {} };
  const splitTier = tNum !== state.currentTitle ? 'cross' : 'cfr';
  if (tab) {
    tab.label = `${tNum} CFR Part ${partId}`;
    tab.heading = cleanInlineLabel(partNode.d || partNode.l);
    persistSessionTabs();
  }
  const toc = buildPartTocView({
    partNode,
    front,
    titleNum: tNum,
    tier: splitTier,
    isSplit: true,
  });

  dom.splitPane.innerHTML = `
    ${splitTabsBarHtml()}
    ${splitHeaderHtml({ splitTier, kickerHtml: `${tNum} CFR · ${escapeHtml(partNode.l)}`, titleText: partNode.d || partNode.l || `Part ${partId}`, hasBack })}
    ${splitActionsBarHtml({ partId, partFull: true })}
    <div class="split-body">
      ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ''}
      ${toc.atlasHtml}
      <div class="toc-groups-wrap">
        ${toc.groupsHtml || '<p class="muted">No sections listed in this part.</p>'}
      </div>
    </div>
  `;
  animateCalm(dom.splitPane.querySelector('.split-body'), { fromY: fromX ? 0 : 14, fromX, fromScale: 0.992, duration: 640 });
  initPartTocCarousels(dom.splitPane, { titleNum: tNum, signal });
  updateSplitRefsBtn();
  hydrateSplitNews(tNum, 'part', partId, seq);
  dom.splitPane.scrollTop = 0;
}

async function hydrateSplitNews(tNum: number, kind: 'section' | 'part', id: string, seq: number): Promise<void> {
  if (tNum !== 29) return;
  const data = await fetchNewsActivity(tNum, kind, id);
  if (!data || !data.count || seq !== splitSeq) return;
  activeSplitNewsCtx = { kind, id, data };
  const btn = document.getElementById('split-btn-news');
  if (btn) {
    const span = btn.querySelector('span');
    if (span) span.textContent = `${data.count} ${data.count === 1 ? 'rule' : 'rules'}`;
    btn.hidden = false;
  }
}

export interface OpenSplitOptions {
  kind?: 'section' | 'part' | null;
  title?: number;
  sectionId?: string | null;
  partId?: string | null;
  full?: boolean;
  para?: string | null;
  unit?: string | null;
  label?: string;
  heading?: string;
  pushHistory?: boolean;
  newTab?: boolean;
  tabId?: string | null;
  fromX?: number;
}

export async function openSplitPane({
  kind = null, title, sectionId = null, partId = null, full = false,
  para = null, unit = null, label = '', heading = '',
  pushHistory = true, newTab = true, tabId = null, fromX = 0,
}: OpenSplitOptions): Promise<void> {
  if (!dom.splitPane || !dom.mainStage) return;
  const resolvedKind: 'section' | 'part' = kind || (partId && !sectionId ? 'part' : 'section');
  if (resolvedKind === 'section' && !sectionId) return;
  if (resolvedKind === 'part' && !partId) return;

  splitParaTools.hide();
  activeSplitGraph = null;
  activeSplitNewsCtx = null;

  const tNum = Number(title) || state.currentTitle || 29;
  const nextEntry: SplitState = resolvedKind === 'part'
    ? { kind: 'part', title: tNum, partId: String(partId), full: Boolean(full), label: label || `${tNum} CFR Part ${partId}${full ? ' · Full' : ''}`, heading }
    : { kind: 'section', title: tNum, sectionId: String(sectionId), para: para || null, unit: unit || null, label: label || `${tNum} CFR § ${sectionId}`, heading };

  let targetTab = tabId ? state.splitTabs.find(t => t.id === tabId) || null : null;
  if (!targetTab && newTab) {
    targetTab = state.splitTabs.find(t => tabIdentityMatch(t, nextEntry)) || null;
    if (targetTab) {
      Object.assign(targetTab, { ...nextEntry, id: targetTab.id, history: targetTab.history || [] });
    } else {
      targetTab = makeSplitTab(nextEntry);
      state.splitTabs.push(targetTab);
    }
  } else if (!targetTab) {
    targetTab = activeSplitTab();
    if (!targetTab) {
      targetTab = makeSplitTab(nextEntry);
      state.splitTabs.push(targetTab);
    } else {
      Object.assign(targetTab, { ...nextEntry, id: targetTab.id, history: targetTab.history || [] });
    }
  }

  state.activeSplitTabId = targetTab.id || null;
  if (pushHistory) {
    const hist = targetTab.history || (targetTab.history = []);
    const top = hist[hist.length - 1];
    const same = top && top.kind === nextEntry.kind && top.title === nextEntry.title
      && top.sectionId === nextEntry.sectionId && top.partId === nextEntry.partId
      && Boolean(top.full) === Boolean(nextEntry.full)
      && top.unit === nextEntry.unit && top.para === nextEntry.para;
    if (!same) hist.push({ ...nextEntry });
  }

  if (splitAbort) {
    try { splitAbort.abort(); } catch { /* ignore */ }
  }
  splitAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const seq = ++splitSeq;

  const wasClosed = dom.splitPane.hidden;
  dom.splitPane.hidden = false;
  if (wasClosed) {
    dom.mainStage.classList.remove('is-split');
    void dom.mainStage.offsetWidth;
  }
  dom.mainStage.classList.add('is-split');
  dom.mainStage.classList.toggle('is-split-wide', Boolean(state.splitWide));
  state.splitState = nextEntry;
  persistSessionTabs();
  renderMainTabs();
  if (wasClosed) {
    renderSplitLoading(tNum, resolvedKind === 'part' ? `Part ${partId}` : `§ ${sectionId}`);
    animateCalm(dom.splitPane, { fromX: 34, fromY: 0, fromScale: 0.985, duration: 740 });
  } else {
    syncSplitTabStripInPlace();
    const prevBody = dom.splitPane.querySelector<HTMLElement>('.split-body');
    if (prevBody) {
      prevBody.style.transition = 'opacity var(--t-quick) var(--ease-calm)';
      prevBody.style.opacity = '0.35';
    }
  }

  try {
    if (resolvedKind === 'part') {
      await openSplitPart(nextEntry, seq, splitAbort?.signal, { fromX });
      return;
    }

    const qs = unitQueryFor(unit, para);
    const res = await fetchSectionRaw(tNum, sectionId!, qs, {
      signal: splitAbort?.signal,
    });
    if (seq !== splitSeq) return;
    if (!res.ok) {
      renderSplitUnavailable(tNum, `§ ${sectionId}`, `Couldn’t load § ${sectionId} from Title ${tNum}.`);
      return;
    }

    const data = (await res.json()) as SectionDocData;
    if (seq !== splitSeq) return;
    activeSplitDoc = data;
    state.peekCache.set(`${tNum}|${sectionId}|${data.unit || 'full'}`, data);

    const docHeading = cleanInlineLabel(data.section_title || data.title_label || '');
    const docLabel = cleanInlineLabel(data.label);
    targetTab.label = `${tNum} CFR ${docLabel}`;
    targetTab.heading = docHeading;
    persistSessionTabs();

    const hasBack = (targetTab.history?.length || 0) > 1;
    const outline = data.outline || [];
    const showUnits = data.mode === 'units' && outline.length > 1;
    const unitsHtml = showUnits
      ? `<div class="split-units" role="navigation" aria-label="Section parts">
          ${outline.map(u => `<button type="button" class="split-unit-chip${data.unit === u.key ? ' is-active' : ''}" data-split-unit="${escapeHtml(u.key)}">${escapeHtml(unitShort(u))}</button>`).join('')}
          <button type="button" class="split-unit-chip${!data.unit ? ' is-active' : ''}" data-split-unit="full">Full</button>
        </div>`
      : '';

    const partKicker = data.part
      ? ` · <button type="button" class="split-kicker-link" data-split-part="${escapeHtml(data.part)}" data-split-full="0">Part ${escapeHtml(data.part)}</button>`
      : '';
    const isCrossTitle = tNum !== state.currentTitle;
    const splitTier = isCrossTitle ? 'cross' : 'cfr';
    const pinRef = activeSplitSectionRef();

    dom.splitPane.innerHTML = `
      ${splitTabsBarHtml()}
      ${splitHeaderHtml({ splitTier, kickerHtml: `${tNum} CFR${partKicker}`, titleText: `${docLabel} ${docHeading}`, hasBack })}
      ${splitActionsBarHtml({ pinRef, partId: data.part, ecfrUrl: data.ecfr_url || '', partFull: false })}
      ${unitsHtml}
      <div class="split-body">
        ${data.reserved ? '<div class="reserved-note">This section is reserved.</div>' : ''}
        ${data.html || ''}
      </div>
    `;

    const bodyEl = dom.splitPane.querySelector<HTMLElement>('.split-body');
    if (bodyEl) {
      enhanceDomAnchors(bodyEl);
      animateCalm(bodyEl, { fromY: fromX ? 0 : 14, fromX, fromScale: 0.992, duration: wasClosed ? 680 : 600, delay: wasClosed ? 110 : 0 });
      updateSplitRefsBtn();
      const applyGraph = (g: SectionGraphData | null) => {
        if (!g || seq !== splitSeq || !bodyEl.isConnected) return;
        activeSplitGraph = g;
        if (g.cited_by_count > 0) {
          const citedBtn = document.getElementById('split-btn-cited');
          if (citedBtn) {
            const span = citedBtn.querySelector('span');
            if (span) span.textContent = `Cited by ${g.cited_by_count}`;
            citedBtn.hidden = false;
          }
        }
        if (g.ibr?.length) {
          wrapIbrMentions(bodyEl, g.ibr);
          updateSplitRefsBtn();
        }
      };
      fetchSectionGraph(tNum, data.id, { signal: splitAbort?.signal })
        .then(applyGraph)
        .catch(() => {});
      hydrateSplitNews(tNum, 'section', data.id, seq);
      if (para) {
        highlightTarget(bodyEl, para, 60);
      } else {
        dom.splitPane.scrollTop = 0;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    if (seq !== splitSeq) return;
    renderSplitUnavailable(tNum, resolvedKind === 'part' ? `Part ${partId}` : `§ ${sectionId}`, (err instanceof Error ? err.message : '') || 'Error');
  }
}

export function restoreSplitTabs(entries: SplitState[], activeIdx = 0, wide = false): void {
  if (!entries || !entries.length) {
    closeSplitPane();
    return;
  }
  state.splitWide = Boolean(wide);
  state.splitTabs = entries.map(e => makeSplitTab(e));
  const active = state.splitTabs[Math.min(activeIdx, state.splitTabs.length - 1)] || state.splitTabs[0];
  state.activeSplitTabId = active.id || null;
  persistSessionTabs();
  openSplitPane({ ...active, tabId: active.id, newTab: false, pushHistory: false });
}

registerSplitTabHandlers({
  restore: restoreSplitTabs,
  close: closeSplitPane,
});

export function getActiveSplitDoc(): SectionDocData | null {
  return activeSplitDoc;
}

if (dom.splitPane) {
  dom.splitPane.addEventListener('click', async (e) => {
    if (await splitParaTools.handleClick(e)) return;
    const t = e.target as Element | null;
    const splitTabClose = t?.closest<HTMLElement>('[data-split-tab-close]');
    if (splitTabClose?.dataset.splitTabClose) {
      e.preventDefault();
      e.stopPropagation();
      closeSplitTab(splitTabClose.dataset.splitTabClose);
      return;
    }
    const splitTabBtn = t?.closest<HTMLElement>('[data-split-tab]');
    if (splitTabBtn) {
      const tab = state.splitTabs.find(x => x.id === splitTabBtn.dataset.splitTab);
      if (tab) openSplitPane({ ...tab, tabId: tab.id, newTab: false, pushHistory: false });
      return;
    }
    const saveSplitGroupBtn = t?.closest('[data-split-tabs-act="save-group"]');
    if (saveSplitGroupBtn) {
      openSaveTabGroupMenu(saveSplitGroupBtn);
      return;
    }

    const splitPin = t?.closest('#split-btn-pin');
    if (splitPin) {
      const ref = activeSplitSectionRef();
      if (ref) toggleSplitPinMenu(splitPin, ref);
      return;
    }
    const splitRefs = t?.closest('#split-btn-refs');
    if (splitRefs && state.splitState) {
      openRefsLedgerPopover(splitRefs, dom.splitPane, state.splitState.title);
      return;
    }
    const splitCited = t?.closest('#split-btn-cited');
    if (splitCited && activeSplitGraph && state.splitState) {
      openCitedByPopover(splitCited, activeSplitGraph, state.splitState.title);
      return;
    }
    const splitNews = t?.closest('#split-btn-news');
    if (splitNews && activeSplitNewsCtx) {
      openNewsActivityFor(splitNews, activeSplitNewsCtx);
      return;
    }

    const partBtn = t?.closest<HTMLElement>('[data-split-part]');
    if (partBtn && state.splitState) {
      openSplitPane({
        kind: 'part',
        title: state.splitState.title,
        partId: partBtn.dataset.splitPart,
        full: partBtn.dataset.splitFull === '1',
        newTab: false,
        pushHistory: true,
      });
      return;
    }

    const actBtn = t?.closest<HTMLElement>('[data-split-act]');
    if (actBtn) {
      const act = actBtn.dataset.splitAct;
      if (act === 'close') closeSplitPane();
      else if (act === 'promote') promoteSplitToMain();
      else if (act === 'to-main-tab') moveActiveSplitToMainTab();
      else if (act === 'swap') swapSplitWithMain();
      else if (act === 'wide') {
        state.splitWide = !state.splitWide;
        dom.mainStage?.classList.toggle('is-split-wide', state.splitWide);
        actBtn.classList.toggle('is-active', state.splitWide);
        persistSessionTabs();
      } else if (act === 'copy') {
        const url = new URL(buildSplitHash(), window.location.href).href;
        await copyText(url, 'Link copied', 'Couldn’t copy the link');
      } else if (act === 'font-dec') adjustFontSize(-1);
      else if (act === 'font-inc') adjustFontSize(1);
      else if (act === 'back') {
        const tab = activeSplitTab();
        if (tab && tab.history && tab.history.length > 1) {
          tab.history.pop();
          const prev = tab.history[tab.history.length - 1];
          if (prev) openSplitPane({ ...prev, tabId: tab.id, newTab: false, pushHistory: false });
        }
      }
      return;
    }

    const unitBtn = t?.closest<HTMLElement>('[data-split-unit]');
    if (unitBtn && state.splitState) {
      openSplitPane({
        kind: 'section',
        title: state.splitState.title,
        sectionId: state.splitState.sectionId,
        para: null,
        unit: unitBtn.dataset.splitUnit,
        newTab: false,
        pushHistory: false,
      });
      return;
    }

    if (handlePartTocCarouselClick(e, dom.splitPane, { titleNum: state.splitState?.title || state.currentTitle, signal: splitAbort?.signal })) {
      return;
    }

    const anchorTrigger = t?.closest<HTMLElement>('[data-anchor]');
    if (anchorTrigger?.dataset.anchor) {
      e.preventDefault();
      scrollToAnchor(anchorTrigger.dataset.anchor, dom.splitPane);
      return;
    }

    const localPara = t?.closest<HTMLElement>('a.xref-local[data-local-para]');
    if (localPara) {
      e.preventDefault();
      highlightTarget(dom.splitPane, localPara.dataset.localPara || '', 0);
      return;
    }

    const figLink = t?.closest('a.reg-figure:not(.is-broken)');
    if (figLink && dom.splitPane.contains(figLink)) {
      e.preventDefault();
      openFigureModal(figLink);
      return;
    }

    const link = t?.closest('a[href^="#"]');
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && link.getAttribute('target') !== '_blank') {
      const isInlineRef = !link.classList.contains('xref-local')
        && Boolean(link.closest('.reg-body, .full-section .reg-body, .front-matter'))
        && link.classList.contains('xref');
      if (isInlineRef) return;
      const parsed = parseCfrHref(link.getAttribute('href'), state.splitState?.title || state.currentTitle);
      if (parsed && parsed.kind === 'section') {
        e.preventDefault();
        openSplitPane({
          kind: 'section',
          title: parsed.title,
          sectionId: parsed.section,
          para: parsed.para,
          unit: parsed.unit,
          newTab: false,
          pushHistory: true,
        });
      } else if (parsed && parsed.kind === 'part') {
        e.preventDefault();
        openSplitPane({
          kind: 'part',
          title: parsed.title,
          partId: parsed.part,
          newTab: false,
          pushHistory: true,
        });
      }
    }
  });

  dom.splitPane.addEventListener('keydown', (e) => {
    handlePartTocCarouselKeydown(e, {
      titleNum: state.splitState?.title || state.currentTitle,
      signal: splitAbort?.signal,
    });
  });

  bindBrokenImageFallback(dom.splitPane, () => activeSplitDoc?.ecfr_url || '');
}

on('split:open', (opts) => openSplitPane(opts as OpenSplitOptions));
