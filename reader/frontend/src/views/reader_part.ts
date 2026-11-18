import { state, TreeNode } from '../state';
import { fetchPartFront, fetchPartFull } from '../api/client';
import { emit } from '../core/events';
import { onView } from '../core/view_dispatch';
import { renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import {
  buildPartTocView, getTocViewMode, handlePartTocCarouselClick, handlePartTocCarouselKeydown,
  initPartTocCarousels, PartFrontData, positionCarousel, TOC_VIEW_KEY,
} from '../components/part_toc';
import { adjustFontSize, sectionHref } from '../components/rail';
import { syncMainTabFromRoute } from '../components/reader_tabs';
import { collectSectionReferences, openRefsLedgerPopover } from '../components/refs_popovers';
import { clearTreeSelection, ensureTreeLoaded, plural, selectTreeNode } from '../components/sidebar';
import { renderNotFound } from '../components/title_switcher';
import { docStepBtn, docStepHtml, firstSectionOf, partNeighbors, setViewHead } from '../components/view_head';
import { copyText, enterView, escapeHtml, findPartInTree, icon, lsSet, skeletonHtml, tocTitle } from '../dom';
import { dom } from '../state_init';
import { recordPartVisit } from '../usage';
import { segmentedHtml } from '../components/ui';
import { enhanceDomAnchors, renderViewError } from './doc_utils';

export { buildPartTocView, findPartInTree, initPartTocCarousels, tocTitle };

export async function loadPart(partId: string): Promise<void> {
  dom.view.innerHTML = skeletonHtml('list', 'Loading Part ' + partId + '…');
  state.currentSection = null;
  state.currentPart = partId;
  updateChatContext();

  try {
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    const [frontRes] = await Promise.all([
      fetchPartFront(state.currentTitle, partId, { signal }),
      ensureTreeLoaded(),
    ]);

    const front: PartFrontData = frontRes.ok ? (await frontRes.json() as PartFrontData) : { part: '', subparts: {} };
    if (seq !== state.routeSeq) return;

    const partNode = findPartInTree(state.treeData, partId);
    if (!partNode) {
      if (state.metaInfo?.partial && /^\d+[a-z]?(?:-\d+)?$/i.test(partId)) {
        clearTreeSelection();
        setViewHead('');
        await renderResolverPage(dom.view, { title: state.currentTitle, part: partId });
        return;
      }
      renderNotFound();
      return;
    }

    const toc = buildPartTocView({
      partNode,
      front,
      titleNum: state.currentTitle,
      tier: 'cfr',
      isSplit: false,
    });
    const viewMode = getTocViewMode();
    document.title = `Part ${partId} · Title ${state.currentTitle}`;
    setViewHead(docStepHtml(partId, null, firstSectionOf(partId)));
    const sep = '<span class="sep" aria-hidden="true">·</span>';
    const toolsHtml = toc.sectionCount >= 2
      ? `<div class="part-toc-tools">
          ${toc.sectionCount >= 6
            ? `<input type="search" id="part-toc-filter" class="ui-input part-toc-filter" placeholder="Filter ${plural(toc.sectionCount, 'section')} in Part ${escapeHtml(partId)}…" aria-label="Filter sections in part" autocomplete="off" spellcheck="false">`
            : '<span class="toc-tools-label">Sections index</span>'}
          <span class="toc-filter-meta" id="part-toc-matches" aria-live="polite"></span>
          ${segmentedHtml({
            label: 'Table of contents layout',
            value: viewMode,
            cls: 'seg toc-view-toggle',
            dataAttr: 'data-toc-view',
            items: [{ value: 'cards', label: 'Thumbnails' }, { value: 'compact', label: 'Index' }],
          })}
        </div>`
      : '';
    dom.view.innerHTML = `
      <div class="doc-kicker" data-ref-tier="cfr">
        <span class="ref-badge">FEDERAL REG</span>${sep}<span>${state.currentTitle} CFR ${escapeHtml(partNode.l)}</span>
        ${toc.sectionCount ? `${sep}<span>${plural(toc.sectionCount, 'section')}</span>` : ''}
        ${toc.subpartCount ? `${sep}<span>${plural(toc.subpartCount, 'subpart')}</span>` : ''}
      </div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn btn-accent" href="#/part/${encodeURIComponent(partId)}/full">${icon('list')} See full part</a>
        ${newsActivityButtonHtml()}
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <button type="button" class="btn" id="btn-part-copy" title="Copy part link">${icon('link')} Copy link</button>
        </div>
      </div>
      ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ''}
      ${toc.atlasHtml}
      ${toolsHtml}
      <div class="toc-groups-wrap${viewMode === 'compact' ? ' is-compact' : ''}">
        ${toc.groupsHtml || '<p class="muted">No sections listed in this part.</p>'}
      </div>
      <p class="part-toc-empty muted" id="part-toc-empty" hidden>No matching sections in Part ${escapeHtml(partId)}.</p>
    `;

    syncMainTabFromRoute({
      kind: 'part',
      title: state.currentTitle,
      partId,
      full: false,
      label: `${state.currentTitle} CFR Part ${partId}`,
      heading: partNode.d || partNode.l || '',
      href: window.location.hash || `#/title/${state.currentTitle}/part/${encodeURIComponent(partId)}`,
    });
    const swapX = state.swapMotionX || 0;
    state.swapMotionX = 0;
    enterView({ fromX: swapX });
    initPartTocCarousels(dom.view, { titleNum: state.currentTitle, signal });
    selectTreeNode('p-' + partId);
    recordPartVisit(partId, partNode.d);
    fillNewsActivity('part', partId, seq);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load part', (err instanceof Error ? err.message : '') || 'Unexpected error', {
      onRetry: () => loadPart(partId),
    });
  }
}

export async function loadPartFull(partId: string, params?: URLSearchParams | null): Promise<void> {
  dom.view.innerHTML = skeletonHtml('doc', 'Loading Part ' + partId + '…');
  state.currentSection = null;
  state.currentPart = partId;
  updateChatContext();

  try {
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    await ensureTreeLoaded();
    if (seq !== state.routeSeq) return;
    const partNode = findPartInTree(state.treeData, partId);
    if (!partNode) {
      if (state.metaInfo?.partial && /^\d+[a-z]?(?:-\d+)?$/i.test(partId)) {
        clearTreeSelection();
        setViewHead('');
        await renderResolverPage(dom.view, { title: state.currentTitle, part: partId });
        return;
      }
      renderNotFound();
      return;
    }

    const res = await fetchPartFull(state.currentTitle, partId, { signal });
    if (seq !== state.routeSeq) return;
    if (!res.ok) { renderNotFound(); return; }
    const data = (await res.json()) as { sections?: Array<{ id: string; label?: string; title?: string; reserved?: boolean; html?: string }> };
    if (seq !== state.routeSeq) return;

    const from = params && params.get('from');
    const anchorId = (id: string) => 'sec-' + String(id).replace(/[^a-zA-Z0-9.\-]/g, '_');
    const sections = data.sections || [];
    const sectionsHtml = sections.map(s => {
      const num = escapeHtml(s.label);
      const title = escapeHtml(s.title || '');
      const body = s.reserved ? '<div class="reserved-note">This section is reserved.</div>' : (s.html || '');
      return `<article class="full-section${s.id === from ? ' is-from' : ''}" id="${anchorId(s.id)}">
        <header class="full-section-head has-tier-bar" data-ref-tier="cfr">
          <a class="full-section-anchor" href="${sectionHref(s.id)}" title="Open this section on its own">
            <span class="full-section-num">${num}</span>
            <span class="full-section-title">${title}</span>
          </a>
          <button type="button" class="lib-act full-section-split" data-full-split="${escapeHtml(s.id)}" title="Open ${num} side-by-side">Split</button>
        </header>
        ${body}
      </article>`;
    }).join('');

    document.title = `Part ${partId} (full) · Title ${state.currentTitle}`;
    const [prevPart, nextPart] = partNeighbors(partId);
    const partBtn = (node: TreeNode | null, dir: number) => node
      ? docStepBtn('part', dir, `#/part/${encodeURIComponent(String(node.id || ''))}/full`, `Part ${node.id || ''}`, node.d,
        `<span class="step-word">Part </span>${escapeHtml(node.id)}`)
      : '';
    const headRow = (prevPart || nextPart)
      ? `<nav class="doc-step" aria-label="Previous and next part">${partBtn(prevPart, -1)}<span class="spacer"></span>${partBtn(nextPart, 1)}</nav>`
      : '';
    setViewHead(headRow);

    const sep = '<span class="sep" aria-hidden="true">·</span>';
    dom.view.innerHTML = `
      <div class="doc-kicker" data-ref-tier="cfr">
        <span class="ref-badge">FULL PART</span>${sep}<span>${state.currentTitle} CFR ${escapeHtml(partNode.l)}</span>${sep}<span>${plural(sections.length, 'section')}</span>${sep}<a href="#/part/${encodeURIComponent(partId)}">Table of contents</a>
      </div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn" href="#/part/${encodeURIComponent(partId)}">${icon('list')} Table of contents</a>
        ${newsActivityButtonHtml()}
        <button type="button" class="btn" id="btn-part-refs-ledger" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('list')} <span>Refs</span></button>
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <button type="button" class="btn" id="btn-part-copy" title="Copy direct link">${icon('link')} Copy link</button>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button type="button" id="part-font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button type="button" id="part-font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>
      </div>
      ${sectionsHtml || '<p class="muted">No sections in this part.</p>'}
    `;
    enhanceDomAnchors(dom.view);
    state.swapMotionX = 0;
    syncMainTabFromRoute({
      kind: 'part',
      title: state.currentTitle,
      partId,
      full: true,
      label: `${state.currentTitle} CFR Part ${partId} · Full`,
      heading: partNode.d || partNode.l || '',
      href: window.location.hash || `#/title/${state.currentTitle}/part/${encodeURIComponent(partId)}/full`,
    });
    const refs = collectSectionReferences(dom.view);
    const ledgerBtn = document.getElementById('btn-part-refs-ledger');
    if (ledgerBtn && refs.length) {
      const span = ledgerBtn.querySelector('span');
      if (span) span.textContent = `Refs ${refs.length}`;
      ledgerBtn.hidden = false;
    }
    recordPartVisit(partId, partNode.d);
    fillNewsActivity('part', partId, seq);

    if (from) {
      const el = document.getElementById(anchorId(from));
      if (el) {
        let userScrolled = false;
        let lastSet = -1;
        const align = () => {
          if (userScrolled || signal?.aborted || !el.isConnected) return;
          if (lastSet >= 0 && Math.abs(dom.main.scrollTop - lastSet) > 4) {
            userScrolled = true;
            return;
          }
          const r = el.getBoundingClientRect();
          const m = dom.main.getBoundingClientRect();
          const rel = r.top - m.top;
          if (rel < 60 || rel > 100) {
            el.scrollIntoView({ block: 'start' });
            lastSet = dom.main.scrollTop;
          }
        };
        requestAnimationFrame(align);
        document.fonts?.ready?.then(align);
        const onImgLoad = () => align();
        dom.view.addEventListener('load', onImgLoad, true);
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(align) : null;
        if (ro) ro.observe(dom.view);
        const stop = () => {
          dom.view.removeEventListener('load', onImgLoad, true);
          ro?.disconnect();
        };
        setTimeout(stop, 2600);
        signal?.addEventListener('abort', stop, { once: true });
      }
    } else {
      dom.main.scrollTop = 0;
    }
    selectTreeNode('s-' + (from || (sections[0] && sections[0].id)));
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load part', (err instanceof Error ? err.message : '') || 'Unexpected error', {
      onRetry: () => loadPartFull(partId, params),
    });
  }
}

onView('input', (e) => {
  const input = e.target as HTMLInputElement | null;
  if (!input || input.id !== 'part-toc-filter') return;
  const q = input.value.trim().toLowerCase();
  const wrap = dom.view.querySelector('.toc-groups-wrap');
  if (wrap) wrap.classList.toggle('is-filtering', Boolean(q));
  let visible = 0;
  let total = 0;
  for (const grp of dom.view.querySelectorAll<HTMLElement>('.toc-group')) {
    let grpShown = 0;
    for (const li of grp.querySelectorAll<HTMLElement>('li[data-hay]')) {
      total++;
      const show = !q || (li.dataset.hay || '').includes(q);
      li.hidden = !show;
      if (show) { grpShown++; visible++; }
    }
    grp.hidden = grpShown === 0;
    const cnt = grp.querySelector('.toc-group-count');
    if (cnt) cnt.textContent = String(grpShown);
  }
  if (!q) initPartTocCarousels(dom.view, { titleNum: state.currentTitle });
  else {
    for (const car of dom.view.querySelectorAll<HTMLElement>('.toc-carousel')) positionCarousel(car);
  }
  const metaEl = document.getElementById('part-toc-matches');
  if (metaEl) metaEl.textContent = q ? `${visible} of ${total} shown` : '';
  const emptyEl = document.getElementById('part-toc-empty');
  if (emptyEl) emptyEl.hidden = visible > 0 || !q;
});

onView('click', async (e) => {
  if (handlePartTocCarouselClick(e, dom.view)) return;
  const t = e.target as Element | null;
  if (!t) return;
  const viewBtn = t.closest<HTMLElement>('[data-toc-view]');
  if (viewBtn) {
    const mode = viewBtn.dataset.tocView === 'compact' ? 'compact' : 'cards';
    lsSet(TOC_VIEW_KEY, mode);
    const wrap = dom.view.querySelector('.toc-groups-wrap');
    if (wrap) wrap.classList.toggle('is-compact', mode === 'compact');
    for (const b of dom.view.querySelectorAll<HTMLElement>('[data-toc-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.tocView === mode));
    }
    initPartTocCarousels(dom.view, { titleNum: state.currentTitle });
    return;
  }
  const tocSplit = t.closest<HTMLElement>('[data-toc-split]');
  if (tocSplit) {
    e.preventDefault();
    e.stopPropagation();
    emit('split:open', { title: state.currentTitle, sectionId: tocSplit.dataset.tocSplit, pushHistory: true });
    return;
  }
  const ledgerBtn = t.closest('#btn-part-refs-ledger');
  if (ledgerBtn) {
    openRefsLedgerPopover(ledgerBtn);
    return;
  }
  if (t.closest('#btn-part-copy')) {
    await copyText(window.location.href, 'Link copied', 'Couldn’t copy the link');
    return;
  }
  if (t.closest('#part-font-dec')) { adjustFontSize(-1); return; }
  if (t.closest('#part-font-inc')) { adjustFontSize(1); return; }
  const splitBtn = t.closest<HTMLElement>('[data-full-split]');
  if (splitBtn) {
    emit('split:open', { title: state.currentTitle, sectionId: splitBtn.dataset.fullSplit, pushHistory: true });
  }
});

onView('keydown', (e) => {
  handlePartTocCarouselKeydown(e as KeyboardEvent);
});
