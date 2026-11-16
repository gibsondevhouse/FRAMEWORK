import { navState, saveNav } from '../nav';
import { dom } from '../state_init';

// --- Drawer width (drag the right edge; double-click resets) ---
export function setSidebarWidth(px, save) {
  const w = Math.round(Math.min(560, Math.max(220, px)));
  document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  dom.sidebarResizer.setAttribute('aria-valuenow', String(w));
  if (save) { navState.width = w; saveNav(); }
}


dom.sidebarResizer.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const handle = dom.sidebarResizer;
  const startX = e.clientX;
  const startW = dom.sidebar.getBoundingClientRect().width;
  handle.setPointerCapture(e.pointerId);
  handle.classList.add('dragging');
  document.body.classList.add('resizing');
  const move = (ev) => setSidebarWidth(startW + ev.clientX - startX, false);
  const up = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    setSidebarWidth(dom.sidebar.getBoundingClientRect().width, true);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
});


dom.sidebarResizer.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const w = dom.sidebar.getBoundingClientRect().width;
  setSidebarWidth(w + (e.key === 'ArrowRight' ? 20 : -20), true);
});


dom.sidebarResizer.addEventListener('dblclick', () => {
  document.documentElement.style.removeProperty('--sidebar-w');
  dom.sidebarResizer.setAttribute('aria-valuenow', String(Math.round(dom.sidebar.getBoundingClientRect().width)));
  navState.width = null;
  saveNav();
});

dom.sidebarResizer.setAttribute('aria-valuenow', String(Math.round(dom.sidebar.getBoundingClientRect().width) || 288));
