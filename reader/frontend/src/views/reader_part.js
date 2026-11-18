import { state } from '../state';
import { renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { adjustFontSize, sectionHref } from '../components/rail';
import { syncMainTabFromRoute } from '../components/reader_tabs';
import { clearTreeSelection, ensureTreeLoaded, plural, selectTreeNode } from '../components/sidebar';
import { openSplitPane } from '../components/split_pane';
import { renderNotFound } from '../components/title_switcher';
import { docStepBtn, docStepHtml, firstSectionOf, partNeighbors, setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, icon, lsGet, lsSet, showToast, skeletonHtml, smoothScrollToTarget } from '../dom';
import { dom } from '../state_init';
import { loadUsage, recordPartVisit } from '../usage';
import { segmentedHtml } from '../components/ui';
import { enhanceDomAnchors, renderViewError } from './doc_utils';
import { loadProjects } from './projects';
import { collectSectionReferences, openRefsLedgerPopover } from './reader';

const TOC_VIEW_KEY = 'tocViewMode';
function getTocViewMode() {
  return lsGet(TOC_VIEW_KEY) === 'compact' ? 'compact' : 'cards';
}

function shortSubpartCode(label = '', idx = 0) {
  const m = /Subpart\s+([A-Z0-9\-]+)/i.exec(label);
  if (m) return m[1];
  const m2 = /Subject Group\s+([A-Z0-9\-]+)/i.exec(label);
  if (m2) return m2[1];
  return String(idx + 1);
}

// Visual Part TOC builder shared by both the main reader (#/part/{id}) and the split reader.
export function buildPartTocView({ partNode, front = { part: '', subparts: {} }, titleNum = state.currentTitle, tier = 'cfr', isSplit = false } = {}) {
  const usage = loadUsage();
  const projects = loadProjects();
  const pinnedMap = new Map();
  for (const p of projects) {
    for (const s of p.sections || []) {
      if (Number(s.title) === Number(titleNum)) {
        pinnedMap.set(String(s.id), (pinnedMap.get(String(s.id)) || 0) + 1);
      }
    }
  }

  let sectionCount = 0;
  let activeCount = 0;
  let reservedCount = 0;
  let appendixCount = 0;
  let readCount = 0;
  let pinnedCount = 0;
  const subparts = [];
  const rawBlocks = [];

  const prefix = isSplit ? 'sp-toc-grp-' : 'toc-grp-';
  const hrefFor = (secId) => `#/title/${titleNum}/section/${encodeURIComponent(secId)}`;

  const countNode = (s) => {
    sectionCount++;
    if (s.r) reservedCount++;
    else activeCount++;
    if (s.t === 'appendix') appendixCount++;
    const uEntry = usage.s?.[`${titleNum}|${s.id}`];
    if (uEntry) readCount++;
    if (pinnedMap.has(String(s.id))) pinnedCount++;
  };

  let flatRun = [];
  const flushFlat = () => {
    if (!flatRun.length) return;
    rawBlocks.push({ type: 'flat', children: flatRun });
    flatRun = [];
  };
  for (const child of partNode.c || []) {
    if (child.t === 'subpart' || child.t === 'subject_group') {
      flushFlat();
      const children = child.c || [];
      children.forEach(countNode);
      const spIdx = subparts.length;
      const anchorId = `${prefix}${spIdx}`;
      const rawLabel = cleanInlineLabel(child.l || '');
      const rawDesc = cleanInlineLabel(child.d || '');
      const fullTitle = rawDesc && rawDesc !== rawLabel ? rawDesc : rawLabel;
      const code = shortSubpartCode(rawLabel, spIdx);
      subparts.push({ code, rawLabel, fullTitle, anchorId, count: children.length });
      rawBlocks.push({ type: 'subpart', child, children, anchorId, code, rawLabel, fullTitle, spIdx });
    } else if (child.t === 'section' || child.t === 'appendix') {
      countNode(child);
      flatRun.push(child);
    }
  }
  flushFlat();

  const totalSecs = Math.max(1, sectionCount);
  const itemHtml = (s, idx = 0) => {
    const tTitle = tocTitle(s);
    const uEntry = usage.s?.[`${titleNum}|${s.id}`];
    const isPinned = pinnedMap.has(String(s.id));
    const pinCount = pinnedMap.get(String(s.id)) || 0;
    const isApp = s.t === 'appendix';
    const isRes = Boolean(s.r);
    const badges = [
      isApp ? '<span class="toc-pill is-app">Appendix</span>' : '',
      isRes ? '<span class="toc-pill is-res">Reserved</span>' : '',
      uEntry && !isRes ? `<span class="toc-pill is-read">${uEntry.u ? escapeHtml(uEntry.ul || uEntry.u) : 'Visited'}</span>` : '',
      isPinned ? `<span class="toc-pill is-pin">${pinCount > 1 ? `Pinned ×${pinCount}` : 'Pinned'}</span>` : '',
    ].filter(Boolean).join('');
    const hay = `${s.l || ''} ${s.id || ''} ${tTitle} ${isPinned ? 'pinned' : ''} ${uEntry ? 'read' : ''}`.toLowerCase();
    const seqStr = String(idx + 1).padStart(2, '0');
    const initialMode = isApp ? 'Appendix' : isRes ? 'Reserved' : 'CFR Section';
    const initialInfo = isRes
      ? '<span class="toc-fact is-muted">No active text</span>'
      : uEntry?.n > 1
        ? `<span class="toc-fact">${uEntry.n} reads</span>`
        : '<span class="toc-fact is-loading" data-sec-info-loading>Loading preview…</span>';
    return `
      <li class="toc-item toc-slide${isRes ? ' reserved' : ''}${isApp ? ' is-appendix' : ''}${uEntry ? ' is-read' : ''}${isPinned ? ' is-pinned' : ''}" data-slide-idx="${idx}" data-sec-id="${escapeHtml(s.id)}" data-hay="${escapeHtml(hay)}">
        <article class="toc-card">
          <div class="toc-card-top">
            <span class="toc-card-eyebrow">
              <span class="toc-seq">${seqStr}</span>
              <span class="toc-num">${escapeHtml(s.l)}</span>
            </span>
            ${badges ? `<span class="toc-card-badges">${badges}</span>` : ''}
          </div>
          <h4 class="toc-title"><a class="toc-card-link" href="${hrefFor(s.id)}">${escapeHtml(tTitle)}</a></h4>
          <div class="toc-thumb-sheet">
            <p class="toc-card-excerpt" data-sec-excerpt="${escapeHtml(s.id)}">${isRes ? 'This section is reserved.' : ''}</p>
            <div class="toc-thumb-facts">
              <span class="toc-fact toc-card-meta" data-sec-meta="${escapeHtml(s.id)}">${initialMode}</span>
              <span class="toc-thumb-info" data-sec-info="${escapeHtml(s.id)}">${initialInfo}</span>
            </div>
          </div>
          <div class="toc-card-foot">
            <div class="toc-card-acts">
              ${!isSplit && !isRes ? `<button type="button" class="btn btn-small toc-card-split" data-toc-split="${escapeHtml(s.id)}" title="Open ${escapeHtml(s.l)} side-by-side" aria-label="Open ${escapeHtml(s.l)} side-by-side">Side-by-side</button>` : ''}
              <a class="btn btn-small toc-card-read" href="${hrefFor(s.id)}">Read ${icon('arrowRight')}</a>
            </div>
          </div>
        </article>
      </li>`;
  };

  const carouselCtrlHtml = (label, count) => `
    <div class="toc-car-ctrl" aria-label="${escapeHtml(label)} carousel controls">
      <button type="button" class="icon-btn toc-cbtn" data-car-dir="-1" title="Previous sections" aria-label="Previous sections" disabled>${icon('chevronLeft')}</button>
      <span class="toc-ccnt">01–03 / ${String(count).padStart(2, '0')}</span>
      <button type="button" class="icon-btn toc-cbtn" data-car-dir="1" title="Next sections" aria-label="Next sections">${icon('chevronRight')}</button>
    </div>`;

  let groupsHtml = '';
  for (const blk of rawBlocks) {
    const count = blk.children.length;
    // More than 3 vertical thumbnail cards initiates the carousel; <= 3 stay in a clean 3-up row.
    const isCarousel = count > 3;
    if (blk.type === 'subpart') {
      const sharePct = Math.max(4, Math.round((count / totalSecs) * 100));
      const subpartFront = front.subparts?.[blk.child.id] || '';
      const headingText = blk.rawLabel && blk.fullTitle !== blk.rawLabel
        ? `<span class="toc-group-code">${escapeHtml(blk.rawLabel)}</span><span class="toc-group-name">${escapeHtml(blk.fullTitle)}</span>`
        : `<span class="toc-group-name">${escapeHtml(blk.fullTitle)}</span>`;
      groupsHtml += `
        <section class="toc-group" id="${escapeHtml(blk.anchorId)}" data-ref-tier="${tier}">
          <header class="toc-group-head">
            <div class="toc-group-titles">${headingText}</div>
            <div class="toc-group-right">
              <span class="toc-group-bar" title="${sharePct}% of part"><span style="width:${sharePct}%"></span></span>
              <span class="toc-group-count">${count}</span>
              ${isCarousel ? carouselCtrlHtml(blk.fullTitle, count) : ''}
            </div>
          </header>
          ${subpartFront ? `<div class="front-matter"><details><summary>Subpart notes</summary>${subpartFront}</details></div>` : ''}
          <div class="toc-carousel${isCarousel ? ' is-carousel' : ' is-static'}" data-count="${count}" data-active-idx="0">
            <div class="toc-viewport" tabindex="${isCarousel ? '0' : '-1'}" role="region" aria-label="${escapeHtml(blk.fullTitle)} thumbnails">
              <ul class="toc-list toc-carousel-track">${blk.children.map((c, idx) => itemHtml(c, idx)).join('')}</ul>
            </div>
            ${isCarousel ? `<div class="toc-cpips" role="tablist" aria-label="Jump to page in ${escapeHtml(blk.fullTitle)}"></div>` : ''}
          </div>
        </section>`;
    } else {
      const flatHead = isCarousel
        ? `<header class="toc-group-head">
            <div class="toc-group-titles"><span class="toc-group-name">Sections</span></div>
            <div class="toc-group-right">
              <span class="toc-group-count">${count}</span>
              ${carouselCtrlHtml('Sections', count)}
            </div>
          </header>`
        : '';
      groupsHtml += `
        <section class="toc-group is-flat" data-ref-tier="${tier}">
          ${flatHead}
          <div class="toc-carousel${isCarousel ? ' is-carousel' : ' is-static'}" data-count="${count}" data-active-idx="0">
            <div class="toc-viewport" tabindex="${isCarousel ? '0' : '-1'}" role="region" aria-label="Part sections thumbnails">
              <ul class="toc-list toc-carousel-track">${blk.children.map((c, idx) => itemHtml(c, idx)).join('')}</ul>
            </div>
            ${isCarousel ? `<div class="toc-cpips" role="tablist" aria-label="Jump to page in sections"></div>` : ''}
          </div>
        </section>`;
    }
  }

  const statItems = [
    subparts.length ? `<div class="toc-stat"><span class="toc-stat-val">${subparts.length}</span><span class="toc-stat-lbl">${subparts.length === 1 ? 'Subpart' : 'Subparts'}</span></div>` : '',
    `<div class="toc-stat"><span class="toc-stat-val">${activeCount}</span><span class="toc-stat-lbl">${activeCount === 1 ? 'Active §' : 'Active §§'}</span></div>`,
    appendixCount ? `<div class="toc-stat is-app"><span class="toc-stat-val">${appendixCount}</span><span class="toc-stat-lbl">${appendixCount === 1 ? 'Appendix' : 'Appendices'}</span></div>` : '',
    reservedCount ? `<div class="toc-stat is-muted"><span class="toc-stat-val">${reservedCount}</span><span class="toc-stat-lbl">Reserved</span></div>` : '',
    readCount ? `<div class="toc-stat is-read"><span class="toc-stat-val">${readCount}</span><span class="toc-stat-lbl">Visited</span></div>` : '',
    pinnedCount ? `<div class="toc-stat is-pin"><span class="toc-stat-val">${pinnedCount}</span><span class="toc-stat-lbl">Pinned</span></div>` : '',
  ].filter(Boolean).join('');

  const mapBarHtml = subparts.length >= 2
    ? `<div class="toc-map-bar" role="navigation" aria-label="Part structure map">
        ${subparts.map((sp, i) => {
          const pct = Math.max(2, Math.round((sp.count / totalSecs) * 100));
          return `<button type="button" class="toc-map-seg" style="flex:${Math.max(1, sp.count)} 1 0;--seg-i:${i % 6}" data-toc-jump="${escapeHtml(sp.anchorId)}" title="${escapeHtml(sp.rawLabel)}: ${escapeHtml(sp.fullTitle)} (${plural(sp.count, 'section')}, ${pct}%)"><span class="toc-map-code">${escapeHtml(sp.code)}</span></button>`;
        }).join('')}
      </div>
      <div class="toc-subpart-chips">
        ${subparts.map(sp => `<button type="button" class="toc-sub-chip" data-toc-jump="${escapeHtml(sp.anchorId)}"><span class="toc-sub-code">${escapeHtml(sp.code)}</span><span class="toc-sub-name">${escapeHtml(sp.fullTitle)}</span><span class="toc-sub-cnt">${sp.count}</span></button>`).join('')}
      </div>`
    : '';

  const atlasHtml = sectionCount > 0
    ? `<section class="toc-atlas surface-card has-tier-bar" data-ref-tier="${tier}" aria-label="Part visual overview">
        <div class="toc-atlas-stats">${statItems}</div>
        ${mapBarHtml}
      </section>`
    : '';

  return {
    sectionCount,
    subpartCount: subparts.length,
    atlasHtml,
    groupsHtml,
  };
}

function excerptFromSectionData(data) {
  if (!data) return { excerpt: '', refCount: 0, docLen: 0 };
  if (data.reserved) return { excerpt: 'This section is reserved.', refCount: 0, docLen: 0 };
  const doc = new DOMParser().parseFromString(data.html || '', 'text/html');
  const paras = [...doc.body.querySelectorAll('.reg-p, .reg-callout')].slice(0, 3);
  const raw = paras.map(p => p.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const excerpt = raw.length > 240 ? raw.slice(0, 239).trimEnd() + '…' : raw;
  const refCount = doc.body.querySelectorAll('a.xref, a.xref-cross, a.xref-external, a.xref-usc').length;
  const docLen = (doc.body.textContent || '').replace(/\s+/g, ' ').trim().length;
  return { excerpt, refCount, docLen };
}

async function hydrateSlideExcerpt(slide, titleNum, signal) {
  if (!slide || slide.dataset.hydrated === '1' || slide.classList.contains('reserved')) return;
  if (signal?.aborted) return;
  const secId = slide.dataset.secId;
  if (!secId) return;
  slide.dataset.hydrated = '1';
  const cacheKey = `${titleNum}|${secId}|`;
  let data = state.peekCache.get(cacheKey) || state.peekCache.get(`${titleNum}|${secId}|full`);
  if (!data) {
    try {
      const res = await fetch(`/api/${titleNum}/section/${encodeURIComponent(secId)}?unit=`, { signal });
      if (!res.ok) return;
      data = await res.json();
      state.peekCache.set(`${titleNum}|${secId}|${data.unit || 'full'}`, data);
    } catch (e) {
      return;
    }
  }
  if (!slide.isConnected) return;
  const exEl = slide.querySelector('[data-sec-excerpt]');
  const metaEl = slide.querySelector('[data-sec-meta]');
  const infoEl = slide.querySelector('[data-sec-info]');
  const { excerpt, refCount, docLen } = excerptFromSectionData(data);
  if (exEl && excerpt) exEl.textContent = excerpt;
  const outline = Array.isArray(data.outline) ? data.outline : [];
  if (metaEl) {
    if (outline.length > 1) metaEl.textContent = `${outline.length} units`;
    else if (data.kind === 'appendix') metaEl.textContent = 'Appendix';
    else metaEl.textContent = 'Single page';
  }
  if (infoEl) {
    const totalChars = outline.reduce((acc, u) => acc + (Number(u.chars) || 0), 0) || docLen;
    const mins = totalChars > 0 ? Math.max(1, Math.round(totalChars / 1200)) : 0;
    const appGroups = new Set(outline.filter(u => u.kind === 'appendix').map(u => u.group || u.key));
    const facts = [];
    if (totalChars > 0) facts.push(`<span class="toc-fact">${totalChars < 700 ? '<1 min' : `~${mins} min`}</span>`);
    if (appGroups.size > 0) facts.push(`<span class="toc-fact is-app">+${appGroups.size} app.</span>`);
    if (refCount > 0) facts.push(`<span class="toc-fact">${refCount} ${refCount === 1 ? 'ref' : 'refs'}</span>`);
    infoEl.innerHTML = facts.join('');
  }
}

export function getColsPerView(carousel) {
  if (!carousel) return 3;
  const raw = parseInt(getComputedStyle(carousel).getPropertyValue('--toc-cols'), 10);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 3) : 3;
}

function buildCarouselPipList(totalSlides, perView) {
  const maxIdx = Math.max(0, totalSlides - perView);
  if (maxIdx <= 0) return [];
  // Generate page-step indices ending cleanly on maxIdx so the last page is always full.
  const indices = [0];
  for (let i = perView; i < maxIdx; i += perView) indices.push(i);
  if (indices[indices.length - 1] !== maxIdx) indices.push(maxIdx);
  return indices;
}

export function positionCarousel(carousel) {
  if (!carousel) return;
  const viewport = carousel.querySelector('.toc-viewport');
  const track = carousel.querySelector('.toc-carousel-track');
  const wrap = carousel.closest('.toc-groups-wrap');
  const grp = carousel.closest('.toc-group') || carousel;
  if (!viewport || !track) return;

  const isUnwrapped = wrap && (wrap.classList.contains('is-compact') || wrap.classList.contains('is-filtering'));
  if (isUnwrapped || !carousel.classList.contains('is-carousel')) {
    track.style.transform = 'none';
    return;
  }

  const slides = [...track.querySelectorAll('.toc-slide:not([hidden])')];
  const perView = getColsPerView(carousel);
  const maxIdx = Math.max(0, slides.length - perView);
  const rawIdx = Number(carousel.dataset.activeIdx) || 0;
  const clamped = Math.max(0, Math.min(rawIdx, maxIdx));
  carousel.dataset.activeIdx = String(clamped);

  if (slides.length <= perView || !slides[0]) {
    track.style.transform = 'none';
  } else {
    const targetSlide = slides[clamped] || slides[0];
    const offsetX = Math.max(0, Math.round(targetSlide.offsetLeft - slides[0].offsetLeft));
    track.style.transform = `translate3d(${-offsetX}px, 0, 0)`;
  }

  slides.forEach((s, i) => {
    const visible = i >= clamped && i < clamped + perView;
    s.classList.toggle('is-visible', visible);
    s.setAttribute('aria-hidden', String(!visible));
  });

  const prevBtn = grp.querySelector('[data-car-dir="-1"]');
  const nextBtn = grp.querySelector('[data-car-dir="1"]');
  if (prevBtn) prevBtn.disabled = clamped <= 0;
  if (nextBtn) nextBtn.disabled = clamped >= maxIdx;

  const cntEl = grp.querySelector('.toc-ccnt');
  if (cntEl) {
    const startNum = String(clamped + 1).padStart(2, '0');
    const endNum = String(Math.min(slides.length, clamped + perView)).padStart(2, '0');
    const totalNum = String(slides.length).padStart(2, '0');
    cntEl.textContent = `${startNum}–${endNum} / ${totalNum}`;
  }

  const pipRow = carousel.querySelector('.toc-cpips');
  if (pipRow) {
    const pages = buildCarouselPipList(slides.length, perView);
    const activePage = pages.reduce((best, pIdx) => (pIdx <= clamped ? pIdx : best), 0);
    pipRow.innerHTML = pages.map((pIdx, pageNo) => {
      const on = pIdx === activePage;
      const endP = Math.min(slides.length, pIdx + perView);
      return `<button type="button" class="toc-cpip${on ? ' is-active' : ''}" data-car-idx="${pIdx}" title="Show ${pIdx + 1}–${endP}" aria-label="Page ${pageNo + 1}: items ${pIdx + 1} to ${endP}" aria-selected="${on}"></button>`;
    }).join('');
  }
}

export function setCarouselIndex(carousel, nextIdx, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
  if (!carousel) return;
  const track = carousel.querySelector('.toc-carousel-track');
  if (!track) return;
  const slides = [...track.querySelectorAll('.toc-slide:not([hidden])')];
  if (!slides.length) return;
  const perView = getColsPerView(carousel);
  const maxIdx = Math.max(0, slides.length - perView);
  const clamped = Math.max(0, Math.min(nextIdx, maxIdx));
  carousel.dataset.activeIdx = String(clamped);

  positionCarousel(carousel);

  // Hydrate all currently visible thumbnails plus one lookahead slide.
  const endIdx = Math.min(slides.length, clamped + perView + 1);
  for (let i = clamped; i < endIdx; i++) {
    hydrateSlideExcerpt(slides[i], titleNum, signal);
  }
}

export function initPartTocCarousels(container, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
  if (!container) return;
  requestAnimationFrame(() => {
    if (signal?.aborted) return;
    for (const car of container.querySelectorAll('.toc-carousel')) {
      if (car.classList.contains('is-carousel')) {
        setCarouselIndex(car, Number(car.dataset.activeIdx) || 0, { titleNum, signal });
      } else {
        for (const slide of car.querySelectorAll('.toc-slide:not([hidden])')) {
          hydrateSlideExcerpt(slide, titleNum, signal);
        }
      }
    }
    const wrap = container.querySelector('.toc-groups-wrap');
    if (wrap && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        for (const car of wrap.querySelectorAll('.toc-carousel.is-carousel')) {
          positionCarousel(car);
        }
      });
      ro.observe(wrap);
      if (signal) signal.addEventListener('abort', () => ro.disconnect(), { once: true });
    }
  });
}

// --- Load Part Table of Contents ---
export async function loadPart(partId) {
  dom.view.innerHTML = skeletonHtml('list', 'Loading Part ' + partId + '…');
  state.currentSection = null;
  state.currentPart = partId;
  updateChatContext();

  try {
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    // Fetch TOC tree nodes for this part and front matter
    const [frontRes] = await Promise.all([
      fetch('/api/' + state.currentTitle + '/part/' + encodeURIComponent(partId), { signal }),
      ensureTreeLoaded()
    ]);

    const front = frontRes.ok ? await frontRes.json() : { part: '', subparts: {} };
    if (seq !== state.routeSeq) return;

    // Find part node in tree
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
          <span class="toc-filter-meta" id="part-toc-matches"></span>
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
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load part', err?.message || 'Unexpected error', {
      onRetry: () => loadPart(partId),
    });
  }
}


// --- Load Part (full text) ---
// Every section of a part in reading order, each with its own anchor. Arriving from a
// section page scrolls that section into view; prev/next part in the header jump between
// parts without leaving the full-text view.
export async function loadPartFull(partId, params) {
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

    const res = await fetch('/api/' + state.currentTitle + '/part/' + encodeURIComponent(partId) + '/full', { signal });
    if (seq !== state.routeSeq) return;
    if (!res.ok) { renderNotFound(); return; }
    const data = await res.json();
    if (seq !== state.routeSeq) return;

    const from = params && params.get('from');
    const anchorId = (id) => 'sec-' + String(id).replace(/[^a-zA-Z0-9.\-]/g, '_');
    const sections = data.sections || [];
    const sectionsHtml = sections.map(s => {
      // The stored label on sections already begins with "§ "; appendices have "Appendix X".
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
    // Full-text mode steps between parts, not between sections.
    const [prevPart, nextPart] = partNeighbors(partId);
    const partBtn = (node, dir) => node
      ? docStepBtn('part', dir, `#/part/${encodeURIComponent(node.id)}/full`, `Part ${node.id}`, node.d,
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

    // No enterView() here: a fade-rise on hundreds of nodes is a jank parade, and the
    // scroll-to has to land on the right pixel. Images load after the render and push
    // content down, so re-anchor on each image load (and once fonts are ready) until the
    // user takes over scrolling. `.full-section`'s scroll-margin-top handles the offset
    // past the pinned header.
    if (from) {
      const el = document.getElementById(anchorId(from));
      if (el) {
        // Re-anchor each frame for ~2.5s. The browser re-measures everything on each call,
        // so as images and fonts settle, we stay locked on the target. The moment the user
        // scrolls away from our last set value we stop and leave them alone.
        const start = performance.now();
        let lastSet = -1;
        const anchor = () => {
          if (lastSet >= 0 && Math.abs(dom.main.scrollTop - lastSet) > 4) return;
          const r = el.getBoundingClientRect();
          const m = dom.main.getBoundingClientRect();
          const rel = r.top - m.top;
          if (rel < 60 || rel > 100) { // target is ~72 (scroll-margin), re-align only if off
            el.scrollIntoView({ block: 'start' });
            lastSet = dom.main.scrollTop;
          }
          if (performance.now() - start < 2500) requestAnimationFrame(anchor);
        };
        requestAnimationFrame(anchor);
      }
    } else {
      dom.main.scrollTop = 0;
    }
    selectTreeNode('s-' + (from || (sections[0] && sections[0].id)));
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load part', err?.message || 'Unexpected error', {
      onRetry: () => loadPartFull(partId, params),
    });
  }
}

export function handlePartTocCarouselClick(e, root, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
  const dirBtn = e.target.closest('[data-car-dir]');
  if (dirBtn) {
    const car = dirBtn.closest('.toc-group')?.querySelector('.toc-carousel');
    if (car) {
      const cur = Number(car.dataset.activeIdx) || 0;
      const step = Number(dirBtn.dataset.carDir) * getColsPerView(car);
      setCarouselIndex(car, cur + step, { titleNum, signal });
    }
    return true;
  }
  const pipBtn = e.target.closest('[data-car-idx]');
  if (pipBtn) {
    const car = pipBtn.closest('.toc-carousel');
    if (car) setCarouselIndex(car, Number(pipBtn.dataset.carIdx) || 0, { titleNum, signal });
    return true;
  }
  const jumpBtn = e.target.closest('[data-toc-jump]');
  if (jumpBtn) {
    const id = jumpBtn.dataset.tocJump;
    const target = root ? root.querySelector(`#${CSS.escape(id)}`) : document.getElementById(id);
    if (target) {
      target.hidden = false;
      smoothScrollToTarget(target, { block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    }
    return true;
  }
  return false;
}

export function handlePartTocCarouselKeydown(e, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  const car = e.target.closest?.('.toc-carousel.is-carousel');
  if (!car) return false;
  const wrap = car.closest('.toc-groups-wrap');
  if (wrap?.classList.contains('is-compact') || wrap?.classList.contains('is-filtering')) return false;
  e.preventDefault();
  const cur = Number(car.dataset.activeIdx) || 0;
  const step = (e.key === 'ArrowRight' ? 1 : -1) * getColsPerView(car);
  setCarouselIndex(car, cur + step, { titleNum, signal });
  return true;
}

dom.view.addEventListener('input', (e) => {
  if (e.target.id !== 'part-toc-filter') return;
  const q = e.target.value.trim().toLowerCase();
  const wrap = dom.view.querySelector('.toc-groups-wrap');
  if (wrap) wrap.classList.toggle('is-filtering', Boolean(q));
  let visible = 0;
  let total = 0;
  for (const grp of dom.view.querySelectorAll('.toc-group')) {
    let grpShown = 0;
    for (const li of grp.querySelectorAll('li[data-hay]')) {
      total++;
      const show = !q || li.dataset.hay.includes(q);
      li.hidden = !show;
      if (show) { grpShown++; visible++; }
    }
    grp.hidden = grpShown === 0;
    const cnt = grp.querySelector('.toc-group-count');
    if (cnt) cnt.textContent = String(grpShown);
  }
  if (!q) initPartTocCarousels(dom.view, { titleNum: state.currentTitle });
  else {
    for (const car of dom.view.querySelectorAll('.toc-carousel')) positionCarousel(car);
  }
  const metaEl = document.getElementById('part-toc-matches');
  if (metaEl) metaEl.textContent = q ? `${visible} of ${total} shown` : '';
  const emptyEl = document.getElementById('part-toc-empty');
  if (emptyEl) emptyEl.hidden = visible > 0 || !q;
});

dom.view.addEventListener('click', async (e) => {
  if (handlePartTocCarouselClick(e, dom.view)) return;
  const viewBtn = e.target.closest('[data-toc-view]');
  if (viewBtn) {
    const mode = viewBtn.dataset.tocView === 'compact' ? 'compact' : 'cards';
    lsSet(TOC_VIEW_KEY, mode);
    const wrap = dom.view.querySelector('.toc-groups-wrap');
    if (wrap) wrap.classList.toggle('is-compact', mode === 'compact');
    for (const b of dom.view.querySelectorAll('[data-toc-view]')) {
      b.setAttribute('aria-pressed', String(b.dataset.tocView === mode));
    }
    initPartTocCarousels(dom.view, { titleNum: state.currentTitle });
    return;
  }
  const tocSplit = e.target.closest('[data-toc-split]');
  if (tocSplit) {
    e.preventDefault();
    e.stopPropagation();
    openSplitPane({ title: state.currentTitle, sectionId: tocSplit.dataset.tocSplit, pushHistory: true });
    return;
  }
  if (e.target.closest('#btn-part-refs-ledger')) {
    openRefsLedgerPopover(e.target.closest('#btn-part-refs-ledger'));
    return;
  }
  if (e.target.closest('#btn-part-copy')) {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied');
    } catch (err) {
      showToast('Couldn’t copy the link');
    }
    return;
  }
  if (e.target.closest('#part-font-dec')) { adjustFontSize(-1); return; }
  if (e.target.closest('#part-font-inc')) { adjustFontSize(1); return; }
  const splitBtn = e.target.closest('[data-full-split]');
  if (splitBtn) {
    openSplitPane({ title: state.currentTitle, sectionId: splitBtn.dataset.fullSplit, pushHistory: true });
  }
});


dom.view.addEventListener('keydown', (e) => {
  handlePartTocCarouselKeydown(e);
});

// Some entries repeat their own label in the heading: "§ 261.5 [Reserved]".
export function tocTitle(node) {
  const l = cleanInlineLabel(node.l || '');
  const d = cleanInlineLabel(node.d || '');
  return l && d.startsWith(l) && d.length > l.length ? d.slice(l.length).trim() : d;
}


export function findPartInTree(node, partId) {
  if (!node) return null;
  if (node.t === 'part' && String(node.id) === String(partId)) return node;
  if (node.c) {
    for (const ch of node.c) {
      const found = findPartInTree(ch, partId);
      if (found) return found;
    }
  }
  return null;
}
