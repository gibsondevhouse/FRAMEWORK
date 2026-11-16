import { state } from '../state';
import { docStepBtn } from '../components/view_head';
import { escapeHtml, icon, lsGet, lsSet, reduceMotion } from '../dom';
import { dom } from '../state_init';

// --- Units and the rail ---
//
// The server cuts a section into units (`data.outline`): its lettered clauses (a), (b), …
// and any appendices embedded in it, long appendices split again at their own headings
// (A.1, A.2 …). A long section (`data.mode === 'units'`) is read one unit at a time at
// #/section/{id}/{unit}; #/section/{id}/full shows all of it; short sections are one page.
//
// The rail is a tight stack of short bars pinned in the reading panel's left gutter, one
// per unit, with a small gap between groups (the rule, then each appendix). Bar length
// hints at the unit's length. The unit on screen is lit; hovering a bar brightens and
// stretches it and shows the unit's name. In unit view a bar opens that unit; on a full
// page it scrolls there, and the lit bar follows the scroll.

export function sectionHref(id, view) {
  return `#/section/${encodeURIComponent(id)}${view ? '/' + encodeURIComponent(view) : ''}`;
}


export function unitShort(u) {
  if (u.label) return u.label;
  const t = (u.title || '').trim();
  return t.length > 18 ? t.slice(0, 17).trim() + '…' : t;
}


export function unitName(u) {
  const inGroup = u.group && u.kind === 'chapter';
  return (inGroup ? `${u.group_label} · ` : '') + (u.title || u.label || '');
}


export function unitKind(u) {
  return { clause: 'clause', chapter: 'part', appendix: 'appendix' }[u.kind] || 'part';
}


export function railHtml(data, mode) {
  const units = data.outline || [];
  if (units.length < 2) return '';
  let html = '';
  let lastGroup;
  let rows = units.length;
  units.forEach((u, i) => {
    if (i && u.group !== lastGroup) { html += '<span class="rail-gap" aria-hidden="true"></span>'; rows++; }
    lastGroup = u.group;
    const current = mode === 'units' && u.key === data.unit;
    const href = mode === 'units' ? sectionHref(data.id, u.key) : `#u-${u.key}`;
    const name = unitName(u);
    html += `<a class="rail-item${current ? ' is-current' : ''}" href="${href}" data-unit="${escapeHtml(u.key)}"`
      + `${mode === 'units' ? '' : ` data-anchor="u-${escapeHtml(u.key)}"`}${current ? ' aria-current="true"' : ''}`
      + ` data-label="${escapeHtml(u.label || '')}" data-name="${escapeHtml(name)}"`
      + ` aria-label="${escapeHtml(`${u.label ? u.label + ' ' : ''}${name}`)}">`
      + `<span class="rail-bar" aria-hidden="true"></span></a>`;
  });
  // One shared label (.rail-pop) glides to whichever bar is under the pointer; it is a link
  // itself, so the pointer can move onto it and click.
  return `<nav class="rail" style="--rows:${rows}" aria-label="Contents of this section">${html}`
    + `<a class="rail-pop" tabindex="-1" aria-hidden="true"><span class="rail-pop-label"></span><span class="rail-pop-name"></span></a></nav>`;
}


// Hover for the rail. The bars are only a few pixels apart, so instead of per-bar :hover
// (which hops to a neighbour on the slightest drift), pick the bar nearest the pointer and
// only switch when the pointer is clearly closer to another one. The label stays put while
// the pointer is on it. Nothing here scrolls; the wheel still scrolls the page.
export function bindRail() {
  const rail = dom.viewHead && dom.viewHead.querySelector('.rail');
  if (!rail) return;
  const pop = rail.querySelector('.rail-pop');
  const items = [...rail.querySelectorAll('.rail-item')];
  let active = null;
  let hideTimer = 0;

  const centerY = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  const show = (item) => {
    clearTimeout(hideTimer);
    const opening = !rail.classList.contains('is-open');
    if (item === active && !opening) return;
    if (active) active.classList.remove('is-hover');
    active = item;
    item.classList.add('is-hover');
    pop.querySelector('.rail-pop-label').textContent = item.dataset.label || '';
    pop.querySelector('.rail-pop-name').textContent = item.dataset.name || '';
    pop.href = item.getAttribute('href');
    if (item.dataset.anchor) pop.dataset.anchor = item.dataset.anchor; else delete pop.dataset.anchor;
    // Appear in place when opening; glide only from one bar to the next.
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
    if (pop.contains(e.target)) { clearTimeout(hideTimer); return; }
    let best = null;
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
  rail.addEventListener('focusin', (e) => { const it = e.target.closest('.rail-item'); if (it) show(it); });
  rail.addEventListener('focusout', hide);
}


export function unitStepHtml(data) {
  const sectionBtn = (s, dir) => s
    ? docStepBtn('section', dir, sectionHref(s.id), s.label, s.title)
    : '';
  const unitBtn = (u, dir) => u
    ? docStepBtn(unitKind(u), dir, sectionHref(data.id, u.key), unitShort(u), unitName(u))
    : '';
  const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
  const left = [sectionBtn(data.prev, -1), unitBtn(data.unit_prev, -1)].filter(Boolean).join(sep);
  const right = [unitBtn(data.unit_next, 1), sectionBtn(data.next, 1)].filter(Boolean).join(sep);
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}


// Scroll-spy for full pages: light the bar of the last unit whose top has passed just
// under the pinned header. `railObserver` holds the teardown for the current page.
state.railObserver = null;

export function watchRail() {
  if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }
  const rail = dom.viewHead && dom.viewHead.querySelector('.rail');
  const sections = [...dom.view.querySelectorAll('.reg-unit')];
  if (!rail || !sections.length) return;
  let lit = null;
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
    rail.querySelectorAll('.rail-item').forEach(a => {
      const on = a.dataset.unit === key;
      a.classList.toggle('is-current', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
  dom.main.addEventListener('scroll', onScroll, { passive: true });
  // Lazy figures loading above the fold shift everything down without a scroll event.
  dom.view.addEventListener('load', onScroll, true);
  state.railObserver = { disconnect: () => {
    dom.main.removeEventListener('scroll', onScroll);
    dom.view.removeEventListener('load', onScroll, true);
    if (frame) cancelAnimationFrame(frame);
  } };
  update();
}


// Scroll + brief highlight for in-page anchors (rail bars on a full page).
export function scrollToAnchor(id) {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  return true;
}


if (dom.viewHead) {
  dom.viewHead.addEventListener('click', (e) => {
    const a = e.target.closest('[data-anchor]');
    if (!a) return;
    e.preventDefault();
    scrollToAnchor(a.dataset.anchor);
  });
}


// A figure that won't load (a few dozen legacy image names) gets a quiet fallback.
dom.view.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('reg-img')) return;
  const fig = img.closest('.reg-figure');
  if (!fig || fig.classList.contains('is-broken')) return;
  fig.classList.add('is-broken');
  fig.href = (state.currentSection && state.currentSection.ecfr_url) || fig.href;
  fig.title = 'This figure is only available on eCFR';
  fig.innerHTML = `${icon('external')}<span>Figure — view on eCFR</span>`;
}, true);


// One writer for the reading size: the reader's A−/A+, the drawer's quick buttons and
// the settings page's range all go through here, and every visible readout follows.
export function applyFontSize(v) {
  const size = Math.max(13, Math.min(24, Number(v) || 16));
  lsSet('fontSize', String(size));
  document.documentElement.style.setProperty('--reader-size', size + 'px');
  for (const out of document.querySelectorAll('[data-size-val]')) out.textContent = `${size} px`;
  const range = document.getElementById('set-size');
  if (range && Number(range.value) !== size) range.value = String(size);
}


export function adjustFontSize(delta) {
  applyFontSize((parseInt(lsGet('fontSize'), 10) || 16) + delta);
}
