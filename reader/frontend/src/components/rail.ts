import { SectionDocData, SectionNeighbor, SectionOutlineItem, state } from '../state';
import { docStepBtn } from '../components/view_head';
import { escapeHtml, icon, lsGet, lsSet, smoothScrollToTarget } from '../dom';
import { dom } from '../state_init';
import { bindBrokenImageFallback } from '../views/doc_utils';

export function sectionHref(id: string, view?: string | null): string {
  return `#/section/${encodeURIComponent(id)}${view ? '/' + encodeURIComponent(view) : ''}`;
}

export function unitShort(u: SectionOutlineItem): string {
  if (u.label) return u.label;
  const t = (u.title || '').trim();
  return t.length > 18 ? t.slice(0, 17).trim() + '…' : t;
}

export function unitName(u: SectionOutlineItem): string {
  const inGroup = u.group && u.kind === 'chapter';
  return (inGroup ? `${u.group_label} · ` : '') + (u.title || u.label || '');
}

const UNIT_KIND_MAP: Record<string, 'clause' | 'part' | 'appendix'> = {
  clause: 'clause',
  chapter: 'part',
  appendix: 'appendix',
};

export function unitKind(u: SectionOutlineItem): 'clause' | 'part' | 'appendix' {
  return (u.kind && UNIT_KIND_MAP[u.kind]) || 'part';
}

/** `hrefFor(key)` builds a unit link in units mode; the CFR's section route by default. */
export function railHtml(
  data: Pick<SectionDocData, 'id' | 'outline' | 'unit'>,
  mode: string,
  hrefFor: (key: string) => string = (key) => sectionHref(data.id, key),
): string {
  const units = data.outline || [];
  if (units.length < 2 || (mode !== 'units' && units.length < 4)) return '';
  const maxChars = Math.max(1, ...units.map(u => Number(u.chars) || 0));
  let html = '';
  let lastGroup: string | null | undefined;
  let rows = units.length;
  units.forEach((u, i) => {
    if (i && u.group !== lastGroup) { html += '<span class="rail-gap" aria-hidden="true"></span>'; rows++; }
    lastGroup = u.group;
    const current = mode === 'units' && u.key === data.unit;
    const href = mode === 'units' ? hrefFor(u.key) : `#u-${u.key}`;
    const name = unitName(u);
    const ratio = Math.sqrt((Number(u.chars) || 0) / maxChars);
    const barPx = Math.round(7 + ratio * 7);
    html += `<a class="rail-item${current ? ' is-current' : ''}" href="${href}" data-unit="${escapeHtml(u.key)}"`
      + `${mode === 'units' ? '' : ` data-anchor="u-${escapeHtml(u.key)}"`}${current ? ' aria-current="true"' : ''}`
      + ` data-label="${escapeHtml(u.label || '')}" data-name="${escapeHtml(name)}"`
      + ` aria-label="${escapeHtml(`${u.label ? u.label + ' ' : ''}${name}`)}">`
      + `<span class="rail-bar" style="--w:${barPx}px" aria-hidden="true"></span></a>`;
  });
  return `<nav class="rail" style="--rows:${rows}" aria-label="Contents of this section">${html}`
    + `<a class="rail-pop" tabindex="-1" aria-hidden="true"><span class="rail-pop-label"></span><span class="rail-pop-name"></span></a></nav>`;
}

export function bindRail(): void {
  const rail = dom.viewHead?.querySelector<HTMLElement>('.rail');
  if (!rail) return;
  const pop = rail.querySelector<HTMLAnchorElement>('.rail-pop');
  if (!pop) return;
  const items = [...rail.querySelectorAll<HTMLElement>('.rail-item')];
  let active: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const centerY = (el: Element) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const show = (item: HTMLElement) => {
    clearTimeout(hideTimer);
    const opening = !rail.classList.contains('is-open');
    if (item === active && !opening) return;
    if (active) active.classList.remove('is-hover');
    active = item;
    item.classList.add('is-hover');
    const lbl = pop.querySelector('.rail-pop-label');
    const nm = pop.querySelector('.rail-pop-name');
    if (lbl) lbl.textContent = item.dataset.label || '';
    if (nm) nm.textContent = item.dataset.name || '';
    pop.href = item.getAttribute('href') || '#';
    if (item.dataset.anchor) pop.dataset.anchor = item.dataset.anchor; else delete pop.dataset.anchor;
    if (opening) pop.classList.add('is-placing');
    pop.style.top = (centerY(item) - rail.getBoundingClientRect().top) + 'px';
    if (opening) {
      void pop.offsetHeight;
      pop.classList.remove('is-placing');
      rail.classList.add('is-open');
    }
  };
  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      rail.classList.remove('is-open');
      if (active) active.classList.remove('is-hover');
      active = null;
    }, 140);
  };

  rail.addEventListener('pointermove', (e) => {
    if (pop.contains(e.target as Node | null)) { clearTimeout(hideTimer); return; }
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const it of items) {
      const d = Math.abs(e.clientY - centerY(it));
      if (d < bestD) { bestD = d; best = it; }
    }
    if (!best) return;
    if (active && best !== active) {
      const row = active.getBoundingClientRect().height;
      if (Math.abs(e.clientY - centerY(active)) - bestD < Math.max(2, row * 0.35)) { clearTimeout(hideTimer); return; }
    }
    show(best);
  });
  rail.addEventListener('pointerleave', hide);
  rail.addEventListener('focusin', (e) => {
    const it = (e.target as Element | null)?.closest<HTMLElement>('.rail-item');
    if (it) show(it);
  });
  rail.addEventListener('focusout', hide);
}

export function unitStepHtml(data: SectionDocData): string {
  const sectionBtn = (s: SectionNeighbor | null | undefined, dir: number) => s
    ? docStepBtn('section', dir, sectionHref(s.id), s.label || s.id, s.title)
    : '';
  const unitBtn = (u: SectionOutlineItem | null | undefined, dir: number) => {
    if (!u) return '';
    return docStepBtn(unitKind(u), dir, sectionHref(data.id, u.key), unitShort(u), unitName(u));
  };
  const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
  const left = [sectionBtn(data.prev, -1), unitBtn(data.unit_prev, -1)].filter(Boolean).join(sep);
  const right = [unitBtn(data.unit_next, 1), sectionBtn(data.next, 1)].filter(Boolean).join(sep);
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}

state.railObserver = null;

export function watchRail(): void {
  if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }
  const rail = dom.viewHead?.querySelector('.rail');
  const sections = [...dom.view.querySelectorAll<HTMLElement>('.reg-unit')];
  if (!rail || !sections.length) return;
  let lit: string | undefined;
  let frame = 0;
  const update = () => {
    frame = 0;
    const line = dom.main.getBoundingClientRect().top + 96;
    let key = sections[0].dataset.unit;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= line) key = s.dataset.unit;
      else break;
    }
    if (key === lit) return;
    lit = key;
    rail.querySelectorAll<HTMLElement>('.rail-item').forEach(a => {
      const on = a.dataset.unit === key;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
  dom.main.addEventListener('scroll', onScroll, { passive: true });
  dom.view.addEventListener('load', onScroll, true);
  state.railObserver = { disconnect: () => {
    dom.main.removeEventListener('scroll', onScroll);
    dom.view.removeEventListener('load', onScroll, true);
    if (frame) cancelAnimationFrame(frame);
  } };
  update();
}

export function scrollToAnchor(
  id: string,
  rootOrOpts: Element | { root?: Element | null; flash?: boolean } = {},
): boolean {
  const isNode = rootOrOpts && 'querySelector' in rootOrOpts && typeof rootOrOpts.querySelector === 'function';
  const root = isNode ? (rootOrOpts as Element) : ((rootOrOpts as { root?: Element | null }).root || dom.view);
  const flash = isNode ? true : ((rootOrOpts as { flash?: boolean }).flash !== false);
  let target: HTMLElement | null = null;
  try {
    target = (root && root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)) || (document.getElementById(id) as HTMLElement | null);
  } catch {
    target = document.getElementById(id) as HTMLElement | null;
  }
  if (!target) return false;
  smoothScrollToTarget(target, {
    block: target.matches('.reg-footnote, .reg-p, .reg-figure') ? 'center' : 'start',
  });
  if (flash && (target.matches('.reg-footnote, .reg-p, .table-wrap, .reg-appendix, .reg-figure'))) {
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }
  return true;
}

for (const rootEl of [dom.viewHead, dom.view].filter(Boolean)) {
  rootEl.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLElement>('[data-anchor]');
    if (!a || !a.dataset.anchor) return;
    e.preventDefault();
    scrollToAnchor(a.dataset.anchor, dom.view);
  });
}

bindBrokenImageFallback(dom.view, () => state.currentSection?.ecfr_url || '');

export function applyFontSize(v: string | number): void {
  const size = Math.max(13, Math.min(24, Number(v) || 16));
  lsSet('fontSize', String(size));
  document.documentElement.style.setProperty('--reader-size', size + 'px');
  for (const out of document.querySelectorAll('[data-size-val]')) out.textContent = `${size} px`;
  const range = document.getElementById('set-size') as HTMLInputElement | null;
  if (range && Number(range.value) !== size) range.value = String(size);
}

export function adjustFontSize(delta: number): void {
  applyFontSize((parseInt(lsGet('fontSize') || '', 10) || 16) + delta);
}
