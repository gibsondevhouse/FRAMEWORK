import { state } from './state';
import { openPinMenu } from './components/pin_pop';
import { plural, revealCurrent } from './components/sidebar';
import { icon, lsGet, lsSet } from './dom';
import { navLib, renderLibraryPanel } from './panels/library_panel';
import { renderProjectsPanel } from './panels/projects_panel';
import { renderHistoryPanel } from './panels/recent_panel';
import { refreshSettingsViews, renderSettingsPanel } from './panels/settings_panel';
import { dom } from './state_init';
import { isStale } from './views/library';
import { loadProjects } from './views/projects';

// --- Navigation: activity rail + sliding drawer ---
// The rail (`#activity-rail`) holds the app's landmarks: Overview and the title's Home are
// links; Contents, Projects, Library and Settings open a panel in the drawer (`#sidebar`)
// beside it. Panels stay mounted and only one shows, so the contents tree keeps its place.
//
// State (`localStorage` `railState`): `panel`, `collapsed` (the drawer is put away), `mode`
// ('pinned' pushes the page aside, 'flyout' floats over it) and `width`. On top of that:
//   retracted — Overview and a title's Home put a pinned drawer away for the page's width
//               (until a rail item asks for it again);
//   fly       — the drawer floats when the mode says so, under 900px (the rail is then a
//               bottom bar), and up to 1200px while the chat is open; `body.nav-open`
//               says it's out, and it goes away on navigation, Esc or a backdrop click.
// Re-clicking Overview or Home while on it opens "Recent" (reading history and pins).
// Keys: ⌘B / Ctrl+B toggles the drawer; G then O H C P L S jumps to a rail item (Linear's
// "go to"); Alt+1…6 does the same; ⌘D pins the open section to a project.
export const NAV_PANELS = { reader: 'Contents', projects: 'Workspaces', library: 'Library', settings: 'Settings', history: 'Recent' };

// Alt+1…7 follows this order; News is a link like Overview and Home.
export const NAV_TARGETS = ['overview', 'home', 'reader', 'projects', 'news', 'library', 'settings'];

export const navState = (() => {
  let st = {};
  try { st = JSON.parse(lsGet('railState') || '{}') || {}; } catch (e) { st = {}; }
  const w = st.width || parseInt(lsGet('sidebarW'), 10) || null;
  return {
    panel: NAV_PANELS[st.panel] && st.panel !== 'history' ? st.panel : 'reader',
    collapsed: st.collapsed != null ? Boolean(st.collapsed) : lsGet('sidebarHidden') === '1',
    mode: st.mode === 'flyout' ? 'flyout' : 'pinned',
    width: w >= 220 && w <= 560 ? w : null,
  };
})();

state.navRetracted = document.documentElement.classList.contains('drawer-retracted');

state.historyFor = 'overview';

export const mqMobile = window.matchMedia('(max-width: 900px)');

export const mqNarrow = window.matchMedia('(max-width: 1200px)');

export const railEl = document.getElementById('activity-rail');

export const drawerEl = {
  title: document.getElementById('drawer-title'),
  meta: document.getElementById('drawer-meta'),
  acts: document.getElementById('drawer-acts'),
  mode: document.getElementById('drawer-mode'),
  close: document.getElementById('drawer-close'),
};


export function saveNav() {
  lsSet('railState', JSON.stringify(navState));
}

export const isFly = () => navState.mode === 'flyout' || mqMobile.matches || (mqNarrow.matches && dom.layout.classList.contains('chat-open'));

export const flyOpen = () => document.body.classList.contains('nav-open');

export const drawerShown = () => (isFly() ? flyOpen() : !navState.collapsed && !state.navRetracted);


// Which landmark a route belongs to.
export function routeTarget(path = state.activeRoute) {
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


export function announce(text) {
  const live = document.getElementById('nav-live');
  if (live) live.textContent = text;
}


// Paint the state: html classes, which panel shows, the drawer header, the lit rail item.
export function applyNav() {
  const root = document.documentElement;
  const fly = isFly();
  if (!fly && flyOpen()) document.body.classList.remove('nav-open');
  root.classList.toggle('drawer-fly', fly);
  root.classList.toggle('drawer-collapsed', !fly && navState.collapsed);
  root.classList.toggle('drawer-retracted', !fly && !navState.collapsed && state.navRetracted);
  const shown = drawerShown();
  dom.sidebar.inert = !shown;
  for (const el of dom.sidebar.querySelectorAll('.drawer-panel')) el.hidden = el.dataset.panel !== navState.panel;
  drawerEl.title.textContent = NAV_PANELS[navState.panel];
  drawerEl.meta.textContent = panelMeta(navState.panel);
  drawerEl.acts.innerHTML = panelActions(navState.panel);
  const pinned = navState.mode === 'pinned';
  drawerEl.mode.setAttribute('aria-pressed', String(pinned));
  drawerEl.mode.title = pinned ? 'Float the drawer over the page' : 'Pin the drawer beside the page';
  drawerEl.mode.setAttribute('aria-label', drawerEl.mode.title);
  drawerEl.mode.innerHTML = icon(pinned ? 'pin' : 'pinOff');
  drawerEl.mode.hidden = mqMobile.matches;
  // One lit item: the open panel's, else the page's landmark.
  const route = routeTarget();
  const lit = shown ? (navState.panel === 'history' ? state.historyFor : navState.panel) : route;
  for (const b of railEl.querySelectorAll('.ar-btn')) {
    const t = b.dataset.target;
    b.classList.toggle('is-active', t === lit);
    if (b.tagName === 'A') {
      if (t === route) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    } else {
      b.setAttribute('aria-expanded', String(shown && navState.panel === t));
    }
  }
  // The Library panel shows the same transfers as the floating dock: one is enough.
  document.body.classList.toggle('drawer-library', shown && navState.panel === 'library');
}


export function panelMeta(panel) {
  if (panel === 'reader') return state.noTitles ? 'No titles installed' : `Title ${state.currentTitle}`;
  if (panel === 'projects') { const n = loadProjects().length; return n ? plural(n, 'workspace') : ''; }
  if (panel === 'library') return state.installedTitles.length ? `${state.installedTitles.length} installed` : '';
  if (panel === 'history') return 'Reading history';
  return '';
}


export function panelActions(panel) {
  if (panel === 'projects') return `<button type="button" class="icon-btn drawer-icon" data-nav-act="new-project" title="New workspace" aria-label="New workspace">${icon('plus')}</button>`;
  if (panel === 'library') return `<a class="icon-btn drawer-icon" href="#/library" title="Open the library" aria-label="Open the library">${icon('external')}</a>`;
  return '';
}


export function renderPanel(panel) {
  if (panel === 'projects') renderProjectsPanel();
  else if (panel === 'library') renderLibraryPanel();
  else if (panel === 'settings') renderSettingsPanel();
  else if (panel === 'history') renderHistoryPanel();
}


// Focus a panel's first useful control (keyboard and hotkey openings only).
export function focusPanel(panel) {
  const el = document.getElementById(`panel-${panel}`);
  if (!el) return;
  const first = panel === 'reader' ? dom.treeFilter : el.querySelector('input, button, a[href], select, textarea');
  if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
}


export function openPanel(panel, { focus = false, toggle = false } = {}) {
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
  if (panel === 'reader') requestAnimationFrame(() => revealCurrent(false));
  if (focus) focusPanel(panel);
  announce(`${NAV_PANELS[panel]} drawer open`);
}


export function closeDrawer() {
  const hadFocus = dom.sidebar.contains(document.activeElement);
  if (isFly()) document.body.classList.remove('nav-open');
  else navState.collapsed = true;
  saveNav();
  applyNav();
  if (hadFocus) railEl.querySelector('.ar-btn.is-active, .ar-btn[aria-current]')?.focus();
  announce('Drawer closed');
}


export function toggleDrawer(focus = true) {
  if (drawerShown()) closeDrawer();
  else openPanel(navState.panel === 'history' ? 'reader' : navState.panel, { focus });
}


export function goTarget(t) {
  if (t === 'overview') window.location.hash = '#/';
  else if (t === 'home') window.location.hash = `#/title/${state.currentTitle}/`;
  else if (t === 'news') {
    if (routeTarget() === 'news') dom.main.scrollTop = 0;
    else window.location.hash = '#/news';
  } else openPanel(t, { focus: true });
}


export function setNavMode(mode) {
  navState.mode = mode === 'flyout' ? 'flyout' : 'pinned';
  if (navState.mode === 'pinned') navState.collapsed = false;
  saveNav();
  applyNav();
  refreshSettingsViews();
}


// Route changes: light the landmark, put a pinned drawer away on Overview and Home, close a
// floating one, and bring the matching panel forward when entering the library or projects.
export function syncNavToRoute(path) {
  const t = routeTarget(path);
  document.body.classList.remove('nav-open');
  // News and Help retract a pinned drawer for the page's width, like Overview and Home
  // (and the first-run picker while no titles are installed).
  state.navRetracted = t === 'overview' || t === 'home' || t === 'news' || t === 'settings' || (state.noTitles && t === 'reader');
  if (t === 'library' && navState.panel !== 'library') navState.panel = 'library';
  else if (t === 'projects') navState.panel = 'projects';
  else if (t === 'reader' && (navState.panel === 'history' || navState.panel === 'library')) navState.panel = 'reader';
  if (navState.panel !== 'history') saveNav();
  renderPanel(navState.panel);
  applyNav();
}


export function updateRailHome() {
  const home = document.getElementById('ar-home');
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


export function updateRailBadge() {
  const badge = document.getElementById('ar-library-badge');
  if (!badge) return;
  const busy = Boolean(state.jobs.current || state.jobs.queued.length);
  const stale = navLib.data ? navLib.data.titles.filter(isStale).length : 0;
  badge.hidden = !busy && !stale;
  badge.className = `ar-badge${busy ? ' is-busy' : stale ? ' is-stale' : ''}`;
  const btn = badge.closest('.ar-btn');
  btn.dataset.tip = busy ? 'Library · downloading' : stale ? `Library · ${plural(stale, 'update')}` : 'Library';
}


railEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.ar-btn');
  if (!btn) return;
  const t = btn.dataset.target;
  if (btn.tagName === 'A') {
    // Already here: the landmark's own drawer, reading history. News has no Recent
    // panel: re-clicking it just scrolls the page back to the top.
    if (routeTarget() === t) {
      e.preventDefault();
      if (t === 'news') { dom.main.scrollTop = 0; return; }
      state.historyFor = t;
      openPanel('history', { toggle: true, focus: e.detail === 0 });
    }
    return;
  }
  openPanel(t, { toggle: true, focus: e.detail === 0 });
});


// Arrow keys move along the rail (up/down, or left/right when it's a bottom bar).
railEl.addEventListener('keydown', (e) => {
  const keys = mqMobile.matches ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  const i = keys.indexOf(e.key);
  if (i < 0 && e.key !== 'Home' && e.key !== 'End') return;
  const items = [...railEl.querySelectorAll('.ar-btn')];
  const at = items.indexOf(document.activeElement);
  if (at < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (i ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});


drawerEl.close.addEventListener('click', () => closeDrawer());

drawerEl.mode.addEventListener('click', () => setNavMode(navState.mode === 'pinned' ? 'flyout' : 'pinned'));

dom.navBackdrop.addEventListener('click', () => closeDrawer());

dom.navToggle.addEventListener('click', (e) => toggleDrawer(e.detail === 0));

for (const mq of [mqMobile, mqNarrow]) mq.addEventListener('change', () => applyNav());


// Hotkeys. "G then a letter" waits 1.2s for the letter; typing in a field never triggers it.
state.goPending = 0;

export const GO_KEYS = { h: 'overview', o: 'overview', t: 'home', c: 'reader', p: 'projects', n: 'news', l: 'library', s: 'settings' };

document.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleDrawer();
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd' && state.currentSection && routeTarget() === 'reader') {
    e.preventDefault();
    openPinMenu();
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
