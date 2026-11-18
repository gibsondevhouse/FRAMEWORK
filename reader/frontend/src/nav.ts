import { state } from './state';
import { emit, on } from './core/events';
import { isStale } from './core/library_meta';
import { loadProjects } from './core/projects_store';
import { icon, lsGet, lsSet, plural } from './dom';
import { dom } from './state_init';

export type NavPanelKey = 'reader' | 'projects' | 'library' | 'settings' | 'history';
export type NavTarget = 'overview' | 'home' | 'reader' | 'projects' | 'news' | 'library' | 'settings';
export type NavMode = 'pinned' | 'flyout';

export const NAV_PANELS: Record<NavPanelKey, string> = {
  reader: 'Contents', projects: 'Workspaces', library: 'Library', settings: 'Settings', history: 'Recent',
};

// Alt+1…7 follows this order; News is a link like Overview and Home.
export const NAV_TARGETS: NavTarget[] = ['overview', 'home', 'reader', 'projects', 'news', 'library', 'settings'];

export interface NavState {
  panel: NavPanelKey;
  collapsed: boolean;
  mode: NavMode;
  width: number | null;
}

export const navState: NavState = (() => {
  let st: Partial<NavState> = {};
  try { st = JSON.parse(lsGet('railState') || '{}') || {}; } catch { st = {}; }
  const w = Number(st.width) || parseInt(lsGet('sidebarW') || '', 10) || 0;
  const panel = st.panel && st.panel in NAV_PANELS && st.panel !== 'history' ? st.panel : 'reader';
  return {
    panel,
    collapsed: st.collapsed != null ? Boolean(st.collapsed) : lsGet('sidebarHidden') === '1',
    mode: st.mode === 'flyout' ? 'flyout' : 'pinned',
    width: w >= 220 && w <= 560 ? w : null,
  };
})();

const HAS_DOC = typeof document !== 'undefined';
state.navRetracted = HAS_DOC ? document.documentElement.classList.contains('drawer-retracted') : false;
state.historyFor = 'overview';

export const mqMobile: MediaQueryList = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(max-width: 900px)')
  : ({ matches: false, media: '(max-width: 900px)', addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
export const mqNarrow: MediaQueryList = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(max-width: 1200px)')
  : ({ matches: false, media: '(max-width: 1200px)', addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList);
export const railEl = (HAS_DOC ? document.getElementById('activity-rail') : null) as HTMLElement;

export const drawerEl = {
  title: (HAS_DOC ? document.getElementById('drawer-title') : null) as HTMLElement,
  meta: (HAS_DOC ? document.getElementById('drawer-meta') : null) as HTMLElement,
  acts: (HAS_DOC ? document.getElementById('drawer-acts') : null) as HTMLElement,
  mode: (HAS_DOC ? document.getElementById('drawer-mode') : null) as HTMLButtonElement,
  close: (HAS_DOC ? document.getElementById('drawer-close') : null) as HTMLButtonElement,
};

export function saveNav(): void {
  lsSet('railState', JSON.stringify(navState));
}

export const isFly = (): boolean => navState.mode === 'flyout' || mqMobile.matches || (mqNarrow.matches && dom.layout.classList.contains('chat-open'));
export const flyOpen = (): boolean => document.body.classList.contains('nav-open');
export const drawerShown = (): boolean => (isFly() ? flyOpen() : !navState.collapsed && !state.navRetracted);

export function routeTarget(path = state.activeRoute): NavTarget {
  const p = path || '/';
  if (p === '/') return 'overview';
  if (/^\/title\/\d+\/?$/.test(p)) return 'home';
  const rest = p.replace(/^\/title\/\d+/, '');
  if (rest.startsWith('/library')) return 'library';
  if (rest.startsWith('/projects')) return 'projects';
  if (rest.startsWith('/news')) return 'news';
  if (rest.startsWith('/help') || rest.startsWith('/settings')) return 'settings';
  return 'reader';
}

export function announce(text: string): void {
  const live = document.getElementById('nav-live');
  if (live) live.textContent = text;
}

export function applyNav(): void {
  const root = document.documentElement;
  const fly = isFly();
  if (!fly && flyOpen()) document.body.classList.remove('nav-open');
  root.classList.toggle('drawer-fly', fly);
  root.classList.toggle('drawer-collapsed', !fly && navState.collapsed);
  root.classList.toggle('drawer-retracted', !fly && !navState.collapsed && Boolean(state.navRetracted));
  const shown = drawerShown();
  dom.sidebar.inert = !shown;
  for (const el of dom.sidebar.querySelectorAll<HTMLElement>('.drawer-panel')) {
    el.hidden = el.dataset.panel !== navState.panel;
  }
  drawerEl.title.textContent = NAV_PANELS[navState.panel];
  drawerEl.meta.textContent = panelMeta(navState.panel);
  drawerEl.acts.innerHTML = panelActions(navState.panel);
  const pinned = navState.mode === 'pinned';
  drawerEl.mode.setAttribute('aria-pressed', String(pinned));
  drawerEl.mode.title = pinned ? 'Float the drawer over the page' : 'Pin the drawer beside the page';
  drawerEl.mode.setAttribute('aria-label', drawerEl.mode.title);
  drawerEl.mode.innerHTML = icon(pinned ? 'pin' : 'pinOff');
  drawerEl.mode.hidden = mqMobile.matches;

  const route = routeTarget();
  const lit = shown ? (navState.panel === 'history' ? state.historyFor : navState.panel) : route;
  for (const b of railEl.querySelectorAll<HTMLElement>('.ar-btn')) {
    const t = b.dataset.target;
    b.classList.toggle('is-active', t === lit);
    if (b.tagName === 'A') {
      if (t === route) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    } else {
      b.setAttribute('aria-expanded', String(shown && navState.panel === t));
    }
  }
  document.body.classList.toggle('drawer-library', shown && navState.panel === 'library');
}

export function panelMeta(panel: NavPanelKey): string {
  if (panel === 'reader') return state.noTitles ? 'No titles installed' : `Title ${state.currentTitle}`;
  if (panel === 'projects') { const n = loadProjects().length; return n ? plural(n, 'workspace') : ''; }
  if (panel === 'library') return state.installedTitles.length ? `${state.installedTitles.length} installed` : '';
  if (panel === 'history') return 'Reading history';
  return '';
}

export function panelActions(panel: NavPanelKey): string {
  if (panel === 'projects') return `<button type="button" class="icon-btn drawer-icon" data-nav-act="new-project" title="New workspace" aria-label="New workspace">${icon('plus')}</button>`;
  if (panel === 'library') return `<a class="icon-btn drawer-icon" href="#/library" title="Open the library" aria-label="Open the library">${icon('external')}</a>`;
  return '';
}

const panelRenderers = new Map<string, () => void>();

export function registerDrawerPanel(panel: string, renderFn: () => void): void {
  if (panel && typeof renderFn === 'function') panelRenderers.set(panel, renderFn);
}

export function renderPanel(panel: string): void {
  const fn = panelRenderers.get(panel);
  if (fn) fn();
}

export function focusPanel(panel: string): void {
  const el = document.getElementById(`panel-${panel}`);
  if (!el) return;
  const first = panel === 'reader' ? dom.treeFilter : el.querySelector<HTMLElement>('input, button, a[href], select, textarea');
  if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
}

export function openPanel(panel: NavPanelKey, { focus = false, toggle = false } = {}): void {
  if (toggle && drawerShown() && navState.panel === panel) {
    closeDrawer();
    return;
  }
  navState.panel = panel;
  if (isFly()) document.body.classList.add('nav-open');
  else { navState.collapsed = false; state.navRetracted = false; }
  if (panel !== 'history') saveNav();
  renderPanel(panel);
  applyNav();
  emit('nav:panel-opened', { panel });
  if (focus) focusPanel(panel);
  announce(`${NAV_PANELS[panel]} drawer open`);
}

export function closeDrawer(): void {
  const hadFocus = dom.sidebar.contains(document.activeElement);
  if (isFly()) document.body.classList.remove('nav-open');
  else navState.collapsed = true;
  saveNav();
  applyNav();
  if (hadFocus) railEl.querySelector<HTMLElement>('.ar-btn.is-active, .ar-btn[aria-current]')?.focus();
  announce('Drawer closed');
}

export function toggleDrawer(focus = true): void {
  if (drawerShown()) closeDrawer();
  else openPanel(navState.panel === 'history' ? 'reader' : navState.panel, { focus });
}

export function goTarget(t: NavTarget): void {
  if (t === 'overview') window.location.hash = '#/';
  else if (t === 'home') window.location.hash = `#/title/${state.currentTitle}/`;
  else if (t === 'news') {
    if (routeTarget() === 'news') dom.main.scrollTop = 0;
    else window.location.hash = '#/news';
  } else {
    openPanel(t, { focus: true });
  }
}

export function setNavMode(mode: string): void {
  navState.mode = mode === 'flyout' ? 'flyout' : 'pinned';
  if (navState.mode === 'pinned') navState.collapsed = false;
  saveNav();
  applyNav();
  emit('nav:mode-changed');
}

export function syncNavToRoute(path: string): void {
  const t = routeTarget(path);
  document.body.classList.remove('nav-open');
  state.navRetracted = t === 'overview' || t === 'home' || t === 'news' || t === 'settings' || (state.noTitles && t === 'reader');
  if (t === 'library' && navState.panel !== 'library') navState.panel = 'library';
  else if (t === 'projects') navState.panel = 'projects';
  else if (t === 'reader' && (navState.panel === 'history' || navState.panel === 'library')) navState.panel = 'reader';
  if (navState.panel !== 'history') saveNav();
  renderPanel(navState.panel);
  applyNav();
}

export function updateRailHome(): void {
  const home = document.getElementById('ar-home') as HTMLAnchorElement | null;
  if (!home) return;
  if (state.noTitles) {
    home.href = '#/';
    home.dataset.tip = 'Pick a profile';
    home.setAttribute('aria-label', 'Pick a profile');
    return;
  }
  home.href = `#/title/${state.currentTitle}/`;
  const t = state.installedTitles.find(x => x.title === state.currentTitle);
  home.dataset.tip = `Title ${state.currentTitle} start`;
  home.setAttribute('aria-label', `Title ${state.currentTitle}${t ? ' ' + t.name : ''} start`);
}

export function updateRailBadge(): void {
  const badge = document.getElementById('ar-library-badge');
  if (!badge) return;
  const busy = Boolean(state.jobs.current || state.jobs.queued.length);
  const libData = state.navLibData;
  const stale = libData?.titles ? libData.titles.filter(isStale).length : 0;
  badge.hidden = !busy && !stale;
  badge.className = `ar-badge${busy ? ' is-busy' : stale ? ' is-stale' : ''}`;
  const btn = badge.closest<HTMLElement>('.ar-btn');
  if (btn) btn.dataset.tip = busy ? 'Library · downloading' : stale ? `Library · ${plural(stale, 'update')}` : 'Library';
}

if (railEl) {
  railEl.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('.ar-btn');
    if (!btn) return;
    const t = btn.dataset.target;
    if (!t) return;
    if (btn.tagName === 'A') {
      if (routeTarget() === t) {
        e.preventDefault();
        if (t === 'news') { dom.main.scrollTop = 0; return; }
        state.historyFor = t;
        openPanel('history', { toggle: true, focus: e.detail === 0 });
      }
      return;
    }
    if (t in NAV_PANELS) openPanel(t as NavPanelKey, { toggle: true, focus: e.detail === 0 });
  });

  railEl.addEventListener('keydown', (e) => {
    const keys = mqMobile.matches ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const i = keys.indexOf(e.key);
    if (i < 0 && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...railEl.querySelectorAll<HTMLElement>('.ar-btn')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (i ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  });
}

drawerEl.close?.addEventListener('click', () => closeDrawer());
drawerEl.mode?.addEventListener('click', () => setNavMode(navState.mode === 'pinned' ? 'flyout' : 'pinned'));
dom.navBackdrop?.addEventListener('click', () => closeDrawer());
dom.navToggle?.addEventListener('click', (e) => toggleDrawer(e.detail === 0));
for (const mq of [mqMobile, mqNarrow]) mq.addEventListener?.('change', () => applyNav());

state.goPending = 0;

export const GO_KEYS: Record<string, NavTarget> = {
  h: 'overview', o: 'overview', t: 'home', c: 'reader', p: 'projects', n: 'news', l: 'library', s: 'settings',
};

if (HAS_DOC) document.addEventListener('keydown', (e) => {
  const active = document.activeElement as HTMLElement | null;
  const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleDrawer();
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd' && state.currentSection && routeTarget() === 'reader') {
    e.preventDefault();
    emit('pin:open');
    return;
  }
  if (e.altKey && !mod && /^Digit[1-7]$/.test(e.code)) {
    e.preventDefault();
    goTarget(NAV_TARGETS[Number(e.code.slice(5)) - 1]);
    return;
  }
  if (e.key === 'Escape' && isFly() && flyOpen() && !e.defaultPrevented) {
    closeDrawer();
    return;
  }
  if (typing || mod || e.altKey) return;
  const k = e.key.toLowerCase();
  if (state.goPending && Date.now() - state.goPending < 1200 && GO_KEYS[k]) {
    e.preventDefault();
    state.goPending = 0;
    goTarget(GO_KEYS[k]);
    return;
  }
  state.goPending = k === 'g' ? Date.now() : 0;
});

on('projects:changed', () => {
  if (navState.panel === 'projects' || navState.panel === 'history') renderPanel(navState.panel);
  if (navState.panel === 'projects') drawerEl.meta.textContent = panelMeta('projects');
});

on('title:switched', () => {
  updateRailHome();
  applyNav();
});

on('titles:refreshed', () => {
  updateRailHome();
});
