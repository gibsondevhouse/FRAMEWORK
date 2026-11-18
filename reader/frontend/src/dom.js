import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { state } from './state';
import { dom } from './state_init';

// --- Helpers ---
export function showToast(msg, duration = 3000) {
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  clearTimeout(dom.toast._t);
  dom.toast._t = setTimeout(() => { dom.toast.hidden = true; }, duration);
}


export function renderMarkdown(md) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(md));
  }
  return escapeHtml(md);
}


export const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const INLINE_MARKUP_RE = /<\/?(?:span|em|strong|i|b|sup|sub|small|u)\b[^>]*>/gi;

export function cleanInlineLabel(str) {
  return String(str ?? '').replace(INLINE_MARKUP_RE, '').replace(/\s+/g, ' ').trim();
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}


export function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}


export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable (private mode, quota) */ }
}


// Inline icons (16px grid, stroked with currentColor; styled by `.icon` in styles.css).
export const ICON_PATHS = {
  sparkle: '<path d="M8 2.25 9.35 6.65 13.75 8 9.35 9.35 8 13.75 6.65 9.35 2.25 8 6.65 6.65Z"/>',
  external: '<path d="M6.5 3.5h-2A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5v-2"/><path d="M9.5 3H13v3.5M13 3 7.5 8.5"/>',
  link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2A2.6 2.6 0 0 0 9 3.3l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9A2.6 2.6 0 0 0 7 12.7l.9-.9"/>',
  expand: '<path d="M9.5 2.75h3.75V6.5M6.5 13.25H2.75V9.5M13.25 2.75 9 7M2.75 13.25 7 9"/>',
  stack: '<rect x="2.75" y="2.75" width="10.5" height="4.25" rx="1.25"/><rect x="2.75" y="9" width="10.5" height="4.25" rx="1.25"/>',
  chevronLeft: '<path d="m9.5 4.5-3.5 3.5 3.5 3.5"/>',
  chevronDown: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  chevronRight: '<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>',
  chevronUp: '<path d="m4.5 9.5 3.5-3.5 3.5 3.5"/>',
  plus: '<path d="M8 3.25v9.5M3.25 8h9.5"/>',
  folder: '<path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.6l1.4 1.5h4A1.5 1.5 0 0 1 13.5 6v6A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12Z"/>',
  bookmark: '<path d="M4.25 2.75h7.5v10.5L8 10.75l-3.75 2.5Z"/>',
  bookmarkFilled: '<path d="M4.25 2.75h7.5v10.5L8 10.75l-3.75 2.5Z" fill="currentColor"/>',
  pin: '<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M6.5 3v10"/>',
  pinOff: '<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M6.5 3v10" stroke-dasharray="1.5 1.5"/><path d="M9 8h2.5M10.5 6.5 12 8l-1.5 1.5"/>',
  activity: '<path d="M1.75 8.25h2.5l1.75-4.5 4 8.5 1.75-4h2.5"/>',
  download: '<path d="M2.5 10.5v2A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-2"/><path d="M8 2.5v8M5 7.5 8 10.5 11 7.5"/>',
  check: '<path d="m3.75 8.25 2.75 2.75 5.75-6"/>',
  list: '<circle cx="3" cy="4" r=".6" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".6" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".6" fill="currentColor" stroke="none"/><path d="M6 4h7.5M6 8h7.5M6 12h7.5"/>',
  book: '<path d="M2.5 12.5A1.5 1.5 0 0 1 4 11h9.5"/><path d="M4 2.5h9.5v11H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 2.5Z"/><path d="M6 5.5h4.5M6 8h3"/>',
  file: '<path d="M9 2.5H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5L9 2.5Z"/><path d="M9 2.5V6.5H13"/>',
  news: '<path d="M2.5 4.5H11V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12Z"/><path d="M11 6.5h1.5a1 1 0 0 1 1 1V12a1.5 1.5 0 0 1-1.5 1.5"/><path d="M4.5 7h4.5M4.5 9.25h4.5M4.5 11.5h3"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.25 6.25a1.85 1.85 0 0 1 3.55.75c0 1.25-1.8 1.5-1.8 2.75"/><circle cx="8" cy="11.85" r=".55" fill="currentColor" stroke="none"/>',
  key: '<circle cx="5.5" cy="8" r="2.75"/><path d="M8.25 8H14M11.75 8v2.25M13.5 8v1.5"/>',
  rss: '<circle cx="4" cy="12" r="1.15" fill="currentColor" stroke="none"/><path d="M3.25 7.75A5 5 0 0 1 8.25 12.75M3.25 4A8.75 8.75 0 0 1 12 12.75"/>',
  copy: '<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  eye: '<path d="M1.75 8S4 4.25 8 4.25 14.25 8 14.25 8 12 11.75 8 11.75 1.75 8 1.75 8Z"/><circle cx="8" cy="8" r="1.75"/>',
  eyeOff: '<path d="M2.5 2.5 13.5 13.5M6.4 4.45A6.6 6.6 0 0 1 8 4.25C12 4.25 14.25 8 14.25 8a10.4 10.4 0 0 1-2.2 2.55M4.1 5.65A10.6 10.6 0 0 0 1.75 8s2.25 3.75 6.25 3.75c.9 0 1.75-.18 2.5-.48"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>',
  arrowRight: '<path d="M3.25 8h9.5M9 4.25 12.75 8 9 11.75"/>',
};

export function icon(name, extraClass = '') {
  return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}


export function skeletonHtml(kind = 'doc', label = 'Loading…') {
  const line = (w, cls = '') => `<span class="skel skel-line${cls ? ' ' + cls : ''}" style="width:${w}"></span>`;
  let body = '';
  if (kind === 'tree') {
    body = `<div class="skel-stack">${line('82%')}${line('64%')}${line('72%')}${line('58%')}</div>`;
  } else if (kind === 'list') {
    body = `<div class="skel-stack" style="gap:16px">${[78, 66, 84, 70].map(w =>
      `<div class="skel-stack" style="gap:8px">${line('26%', 'is-sm')}${line(w + '%', 'is-lg')}${line('90%')}</div>`
    ).join('')}</div>`;
  } else if (kind === 'cards') {
    body = `<div class="skel-stack" style="gap:18px">${line('18%', 'is-sm')}${line('36%', 'is-xl')}<div class="skel-grid-2">${[1, 2, 3, 4].map(() =>
      `<div class="skel-card">${line('34%', 'is-sm')}${line('74%', 'is-lg')}${line('92%')}${line('64%')}</div>`
    ).join('')}</div></div>`;
  } else if (kind === 'lines') {
    body = `<div class="skel-stack" style="gap:8px;margin-top:8px" aria-hidden="true">${line('86%', 'is-sm')}${line('74%', 'is-sm')}${line('68%', 'is-sm')}</div>`;
    return body;
  } else if (kind === 'summary') {
    body = `<div class="skel-stack" style="margin-top:8px;gap:6px" aria-hidden="true">${line('92%', 'is-sm')}${line('68%', 'is-sm')}</div>`;
    return body;
  } else if (kind === 'pulse') {
    body = `<div class="skel-stack" style="gap:8px" aria-hidden="true">${line('46%', 'is-sm')}${line('92%')}${line('74%')}</div>`;
    return body;
  } else {
    body = `<div class="skel-stack" style="gap:16px">${line('24%', 'is-sm')}${line('62%', 'is-xl')}<div class="skel-stack" style="gap:10px;margin-top:8px">${line('94%')}${line('88%')}${line('91%')}${line('76%')}${line('84%')}</div></div>`;
  }
  return `<div class="loading is-skel" role="status" aria-busy="true" aria-label="${escapeHtml(label)}">${body}</div>`;
}


// Easy-on-the-eye motion system: respects OS prefers-reduced-motion AND explicit user setting ('none' | 'less' | 'full').
export const MOTION_KEY = 'motionLevel';
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function getMotionLevel() {
  const stored = lsGet(MOTION_KEY);
  if (stored === 'none' || stored === 'less' || stored === 'full') return stored;
  return reduceMotion.matches ? 'none' : 'full';
}

export function applyMotionLevel(level) {
  const next = level === 'none' || level === 'less' || level === 'full' ? level : getMotionLevel();
  lsSet(MOTION_KEY, next);
  document.documentElement.dataset.motion = next;
  state.motionLevel = next;
  return next;
}

if (!document.documentElement.dataset.motion) {
  document.documentElement.dataset.motion = getMotionLevel();
}
state.motionLevel = getMotionLevel();

export function animateCalm(el, { fromY = 16, fromX = 0, fromScale = 0.99, duration = 640, delay = 0 } = {}) {
  const level = getMotionLevel();
  if (level === 'none' || !el || !el.animate) return;
  try { el._calmAnim?.cancel(); } catch (e) { /* ignore */ }
  const keyframes = level === 'less'
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `translate3d(${fromX}px, ${fromY}px, 0) scale(${fromScale})` }, { opacity: 1, transform: 'none' }];
  el._calmAnim = el.animate(keyframes, {
    duration: level === 'less' ? Math.min(180, Math.round(duration * 0.3)) : duration,
    delay: level === 'less' ? 0 : delay,
    easing: level === 'less' ? 'ease-out' : 'cubic-bezier(0.32, 0.72, 0, 1)',
    fill: delay > 0 ? 'backwards' : 'none',
  });
}

export function enterView({ subtle = false, fromX = 0 } = {}) {
  dom.main.scrollTop = 0;
  const level = getMotionLevel();
  if (level === 'none') return;
  if (subtle && !fromX) {
    const targets = dom.view.querySelectorAll('.unit-context, .reg-body, .reg-footnotes');
    if (targets.length) {
      for (const t of targets) animateCalm(t, { fromY: 14, fromScale: 1, duration: 540 });
      return;
    }
  }
  if (level === 'full' && !fromX) {
    const head = dom.view.querySelector('.doc-kicker, .help-head, .home-head, .lib-head');
    const body = dom.view.querySelector('.reg-body, .part-toc-tools, .toc-group, .full-section, .settings-grid, .lib-stories');
    if (head && body) {
      animateCalm(dom.view, { fromY: 14, fromScale: 0.992, duration: 640 });
      animateCalm(body, { fromY: 18, fromScale: 1, duration: 740, delay: 90 });
      return;
    }
  }
  animateCalm(dom.view, { fromY: fromX ? 0 : 16, fromX, fromScale: 0.99, duration: 720 });
}

export function smoothScrollToTarget(el, { block = 'center', duration = 820 } = {}) {
  if (!el) return;
  if (getMotionLevel() !== 'full') {
    el.scrollIntoView({ behavior: 'auto', block });
    return;
  }
  const scroller = el.closest('.main, .split-pane');
  if (!scroller) {
    el.scrollIntoView({ behavior: 'smooth', block });
    return;
  }
  try { if (scroller._scrollRaf) cancelAnimationFrame(scroller._scrollRaf); } catch (e) { /* ignore */ }
  const sRect = scroller.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const offsetTop = eRect.top - sRect.top + scroller.scrollTop;
  const target = block === 'center'
    ? offsetTop - Math.max(80, (scroller.clientHeight - eRect.height) / 2)
    : offsetTop - 76;
  const clamped = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
  const start = scroller.scrollTop;
  const dist = clamped - start;
  if (Math.abs(dist) < 2) { scroller.scrollTop = clamped; return; }

  const t0 = performance.now();
  let canceled = false;
  const cancel = () => {
    canceled = true;
    scroller.removeEventListener('wheel', cancel);
    scroller.removeEventListener('touchstart', cancel);
  };
  scroller.addEventListener('wheel', cancel, { passive: true, once: true });
  scroller.addEventListener('touchstart', cancel, { passive: true, once: true });

  const step = (now) => {
    if (canceled) return;
    const p = Math.min(1, (now - t0) / duration);
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // Silky ease-in-out glide
    scroller.scrollTop = start + dist * eased;
    if (p < 1) {
      scroller._scrollRaf = requestAnimationFrame(step);
    } else {
      scroller._scrollRaf = 0;
      scroller.removeEventListener('wheel', cancel);
      scroller.removeEventListener('touchstart', cancel);
    }
  };
  scroller._scrollRaf = requestAnimationFrame(step);
}


export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
