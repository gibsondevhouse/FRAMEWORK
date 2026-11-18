import { RefTier, state, TreeNode } from '../state';
import { fetchSectionCached } from '../api/client';
import { loadProjects } from '../core/projects_store';
import {
  cleanInlineLabel, escapeHtml, extractDocExcerpt, icon, lsGet, plural,
  smoothScrollToTarget, tocTitle,
} from '../dom';
import { loadUsage } from '../usage';

export const TOC_VIEW_KEY = 'tocViewMode';

export function getTocViewMode(): 'cards' | 'compact' {
  return lsGet(TOC_VIEW_KEY) === 'compact' ? 'compact' : 'cards';
}

function shortSubpartCode(label = '', idx = 0): string {
  const m = /Subpart\s+([A-Z0-9\-]+)/i.exec(label);
  if (m) return m[1];
  const m2 = /Subject Group\s+([A-Z0-9\-]+)/i.exec(label);
  if (m2) return m2[1];
  return String(idx + 1);
}

export interface PartFrontData {
  part?: string;
  subparts?: Record<string, string>;
}

export interface PartTocBuildResult {
  sectionCount: number;
  subpartCount: number;
  atlasHtml: string;
  groupsHtml: string;
}

export function buildPartTocView({
  partNode,
  front = { part: '', subparts: {} },
  titleNum = state.currentTitle,
  tier = 'cfr',
  isSplit = false,
}: {
  partNode: TreeNode;
  front?: PartFrontData;
  titleNum?: number;
  tier?: RefTier | string;
  isSplit?: boolean;
}): PartTocBuildResult {
  const usage = loadUsage();
  const projects = loadProjects();
  const pinnedMap = new Map<string, number>();
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

  interface SubpartMeta {
    code: string;
    rawLabel: string;
    fullTitle: string;
    anchorId: string;
    count: number;
  }
  type RawBlock =
    | { type: 'subpart'; child: TreeNode; children: TreeNode[]; anchorId: string; code: string; rawLabel: string; fullTitle: string; spIdx: number }
    | { type: 'flat'; children: TreeNode[] };

  const subparts: SubpartMeta[] = [];
  const rawBlocks: RawBlock[] = [];

  const prefix = isSplit ? 'sp-toc-grp-' : 'toc-grp-';
  const hrefFor = (secId: string) => `#/title/${titleNum}/section/${encodeURIComponent(secId)}`;

  const countNode = (s: TreeNode) => {
    sectionCount++;
    if (s.r) reservedCount++;
    else activeCount++;
    if (s.t === 'appendix') appendixCount++;
    const uEntry = usage.s?.[`${titleNum}|${s.id}`];
    if (uEntry) readCount++;
    if (pinnedMap.has(String(s.id))) pinnedCount++;
  };

  let flatRun: TreeNode[] = [];
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
  const itemHtml = (s: TreeNode, idx = 0) => {
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
      : (uEntry?.n || 0) > 1
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
          <h4 class="toc-title"><a class="toc-card-link" href="${hrefFor(String(s.id))}">${escapeHtml(tTitle)}</a></h4>
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
              <a class="btn btn-small toc-card-read" href="${hrefFor(String(s.id))}">Read ${icon('arrowRight')}</a>
            </div>
          </div>
        </article>
      </li>`;
  };

  const carouselCtrlHtml = (label: string, count: number) => `
    <div class="toc-car-ctrl" aria-label="${escapeHtml(label)} carousel controls">
      <button type="button" class="icon-btn toc-cbtn" data-car-dir="-1" title="Previous sections" aria-label="Previous sections" disabled>${icon('chevronLeft')}</button>
      <span class="toc-ccnt">01–03 / ${String(count).padStart(2, '0')}</span>
      <button type="button" class="icon-btn toc-cbtn" data-car-dir="1" title="Next sections" aria-label="Next sections">${icon('chevronRight')}</button>
    </div>`;

  let groupsHtml = '';
  for (const blk of rawBlocks) {
    const count = blk.children.length;
    const isCarousel = count > 3;
    if (blk.type === 'subpart') {
      const sharePct = Math.max(4, Math.round((count / totalSecs) * 100));
      const subpartFront = front.subparts?.[String(blk.child.id)] || '';
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

interface HydrateTask {
  slide: HTMLElement;
  titleNum: number;
  signal?: AbortSignal;
}

const MAX_CONCURRENT_HYDRATE = 4;
let activeHydrates = 0;
const hydrateQueue: HydrateTask[] = [];
const tocResizeObservers = new WeakMap<Element, ResizeObserver>();

function pumpHydrateQueue(): void {
  while (activeHydrates < MAX_CONCURRENT_HYDRATE && hydrateQueue.length > 0) {
    const task = hydrateQueue.shift();
    if (!task || task.signal?.aborted || !task.slide.isConnected || task.slide.dataset.hydrated === '1') continue;
    activeHydrates++;
    hydrateSlideExcerptNow(task.slide, task.titleNum, task.signal).finally(() => {
      activeHydrates--;
      pumpHydrateQueue();
    });
  }
}

function hydrateSlideExcerpt(slide: HTMLElement | null | undefined, titleNum: number, signal?: AbortSignal): void {
  if (!slide || slide.dataset.hydrated === '1' || slide.dataset.queued === '1' || slide.classList.contains('reserved')) return;
  if (signal?.aborted) return;
  slide.dataset.queued = '1';
  hydrateQueue.push({ slide, titleNum, signal });
  pumpHydrateQueue();
}

async function hydrateSlideExcerptNow(slide: HTMLElement, titleNum: number, signal?: AbortSignal): Promise<void> {
  if (!slide || slide.dataset.hydrated === '1' || slide.classList.contains('reserved')) return;
  if (signal?.aborted) return;
  const secId = slide.dataset.secId;
  if (!secId) return;
  const cacheKey = `${titleNum}|${secId}|`;
  let data = state.peekCache.get(cacheKey) || state.peekCache.get(`${titleNum}|${secId}|full`) || null;
  if (!data) {
    try {
      data = await fetchSectionCached(titleNum, secId, '?unit=', cacheKey, { signal });
      if (!data) return;
    } catch {
      delete slide.dataset.queued;
      return;
    }
  }
  if (!slide.isConnected || signal?.aborted) return;
  slide.dataset.hydrated = '1';
  const exEl = slide.querySelector('[data-sec-excerpt]');
  const metaEl = slide.querySelector('[data-sec-meta]');
  const infoEl = slide.querySelector('[data-sec-info]');
  const { excerpt, refCount, docLen } = data.reserved
    ? { excerpt: 'This section is reserved.', refCount: 0, docLen: 0 }
    : extractDocExcerpt(data.html || '', { maxChars: 240, maxParas: 3 });
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
    const facts: string[] = [];
    if (totalChars > 0) facts.push(`<span class="toc-fact">${totalChars < 700 ? '<1 min' : `~${mins} min`}</span>`);
    if (appGroups.size > 0) facts.push(`<span class="toc-fact is-app">+${appGroups.size} app.</span>`);
    if (refCount > 0) facts.push(`<span class="toc-fact">${refCount} ${refCount === 1 ? 'ref' : 'refs'}</span>`);
    infoEl.innerHTML = facts.join('');
  }
}

export function getColsPerView(carousel: Element | null | undefined): number {
  if (!carousel) return 3;
  const raw = parseInt(getComputedStyle(carousel).getPropertyValue('--toc-cols'), 10);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 3) : 3;
}

function buildCarouselPipList(totalSlides: number, perView: number): number[] {
  const maxIdx = Math.max(0, totalSlides - perView);
  if (maxIdx <= 0) return [];
  const indices = [0];
  for (let i = perView; i < maxIdx; i += perView) indices.push(i);
  if (indices[indices.length - 1] !== maxIdx) indices.push(maxIdx);
  return indices;
}

export function positionCarousel(carousel: HTMLElement | null | undefined): void {
  if (!carousel) return;
  const viewport = carousel.querySelector('.toc-viewport');
  const track = carousel.querySelector<HTMLElement>('.toc-carousel-track');
  const wrap = carousel.closest('.toc-groups-wrap');
  const grp = carousel.closest('.toc-group') || carousel;
  if (!viewport || !track) return;

  const isUnwrapped = wrap && (wrap.classList.contains('is-compact') || wrap.classList.contains('is-filtering'));
  if (isUnwrapped || !carousel.classList.contains('is-carousel')) {
    track.style.transform = 'none';
    return;
  }

  const slides = [...track.querySelectorAll<HTMLElement>('.toc-slide:not([hidden])')];
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

  const prevBtn = grp.querySelector<HTMLButtonElement>('[data-car-dir="-1"]');
  const nextBtn = grp.querySelector<HTMLButtonElement>('[data-car-dir="1"]');
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
      return `<button type="button" role="tab" class="toc-cpip${on ? ' is-active' : ''}" data-car-idx="${pIdx}" title="Show ${pIdx + 1}–${endP}" aria-label="Page ${pageNo + 1}: items ${pIdx + 1} to ${endP}" aria-selected="${on}"></button>`;
    }).join('');
  }
}

export function setCarouselIndex(
  carousel: HTMLElement | null | undefined,
  nextIdx: number,
  { titleNum = state.currentTitle, signal = state.routeAbort?.signal }: { titleNum?: number; signal?: AbortSignal } = {},
): void {
  if (!carousel) return;
  const track = carousel.querySelector('.toc-carousel-track');
  if (!track) return;
  const slides = [...track.querySelectorAll<HTMLElement>('.toc-slide:not([hidden])')];
  if (!slides.length) return;
  const perView = getColsPerView(carousel);
  const maxIdx = Math.max(0, slides.length - perView);
  const clamped = Math.max(0, Math.min(nextIdx, maxIdx));
  carousel.dataset.activeIdx = String(clamped);

  positionCarousel(carousel);

  const endIdx = Math.min(slides.length, clamped + perView + 1);
  for (let i = clamped; i < endIdx; i++) {
    hydrateSlideExcerpt(slides[i], titleNum, signal);
  }
}

export function initPartTocCarousels(
  container: Element | null | undefined,
  { titleNum = state.currentTitle, signal = state.routeAbort?.signal }: { titleNum?: number; signal?: AbortSignal } = {},
): void {
  if (!container) return;
  requestAnimationFrame(() => {
    if (signal?.aborted) return;
    const cars = [...container.querySelectorAll<HTMLElement>('.toc-carousel')];
    for (const car of cars) {
      if (car.classList.contains('is-carousel')) {
        positionCarousel(car);
      }
    }
    const observeAndHydrate = (car: HTMLElement) => {
      if (car.classList.contains('is-carousel')) {
        setCarouselIndex(car, Number(car.dataset.activeIdx) || 0, { titleNum, signal });
      } else {
        for (const slide of car.querySelectorAll<HTMLElement>('.toc-slide:not([hidden])')) {
          hydrateSlideExcerpt(slide, titleNum, signal);
        }
      }
    };
    if (typeof IntersectionObserver !== 'undefined') {
      const scrollRoot = container.closest('.split-body') || container.closest('#main, .main') || null;
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          observeAndHydrate(entry.target as HTMLElement);
        }
      }, { root: scrollRoot, rootMargin: '600px 0px' });
      for (const car of cars) io.observe(car);
      if (signal) signal.addEventListener('abort', () => io.disconnect(), { once: true });
    } else {
      for (const car of cars) observeAndHydrate(car);
    }
    const wrap = container.querySelector('.toc-groups-wrap');
    if (wrap && typeof ResizeObserver !== 'undefined') {
      const prevRo = tocResizeObservers.get(wrap);
      if (prevRo) {
        try { prevRo.disconnect(); } catch { /* ignore */ }
      }
      const ro = new ResizeObserver(() => {
        for (const car of wrap.querySelectorAll<HTMLElement>('.toc-carousel.is-carousel')) {
          positionCarousel(car);
        }
      });
      tocResizeObservers.set(wrap, ro);
      ro.observe(wrap);
      if (signal) signal.addEventListener('abort', () => { ro.disconnect(); tocResizeObservers.delete(wrap); }, { once: true });
    }
  });
}

export function handlePartTocCarouselClick(
  e: Event,
  root: Element | null | undefined,
  { titleNum = state.currentTitle, signal = state.routeAbort?.signal }: { titleNum?: number; signal?: AbortSignal } = {},
): boolean {
  const t = e.target as Element | null;
  const dirBtn = t?.closest<HTMLElement>('[data-car-dir]');
  if (dirBtn) {
    const car = dirBtn.closest('.toc-group')?.querySelector<HTMLElement>('.toc-carousel');
    if (car) {
      const cur = Number(car.dataset.activeIdx) || 0;
      const step = Number(dirBtn.dataset.carDir) * getColsPerView(car);
      setCarouselIndex(car, cur + step, { titleNum, signal });
    }
    return true;
  }
  const pipBtn = t?.closest<HTMLElement>('[data-car-idx]');
  if (pipBtn) {
    const car = pipBtn.closest<HTMLElement>('.toc-carousel');
    if (car) setCarouselIndex(car, Number(pipBtn.dataset.carIdx) || 0, { titleNum, signal });
    return true;
  }
  const jumpBtn = t?.closest<HTMLElement>('[data-toc-jump]');
  if (jumpBtn && jumpBtn.dataset.tocJump) {
    const id = jumpBtn.dataset.tocJump;
    const target = root ? root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : document.getElementById(id);
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

export function handlePartTocCarouselKeydown(
  e: KeyboardEvent,
  { titleNum = state.currentTitle, signal = state.routeAbort?.signal }: { titleNum?: number; signal?: AbortSignal } = {},
): boolean {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  const car = (e.target as Element | null)?.closest<HTMLElement>('.toc-carousel.is-carousel');
  if (!car) return false;
  const wrap = car.closest('.toc-groups-wrap');
  if (wrap?.classList.contains('is-compact') || wrap?.classList.contains('is-filtering')) return false;
  e.preventDefault();
  const cur = Number(car.dataset.activeIdx) || 0;
  const step = (e.key === 'ArrowRight' ? 1 : -1) * getColsPerView(car);
  setCarouselIndex(car, cur + step, { titleNum, signal });
  return true;
}
