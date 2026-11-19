import { CorpusSummary, state } from './state';
import { emit, on } from './core/events';
import { isStale } from './core/library_meta';
import { loadProjects } from './core/projects_store';
import {
  allSystemFrameworks, corpusHashFor, refTierForCorpus, TIER_META,
} from './components/corpora';
import { escapeHtml, icon, lsGet, lsSet, plural } from './dom';
import { dom } from './state_init';

export type NavPanelKey = 'reader' | 'corpus' | 'projects' | 'library' | 'settings' | 'history';
export type NavTarget = 'overview' | 'home' | 'reader' | 'corpus' | 'projects' | 'news' | 'library' | 'settings' | 'help';
export type NavMode = 'pinned' | 'flyout';

export const NAV_PANELS: Record<NavPanelKey, string> = {
  reader: 'Contents',
  corpus: 'Framework',
  projects: 'Workspaces',
  library: 'Library',
  settings: 'Settings',
  history: 'Recent',
};

// Alt+1…7: main pages first, then framework start & contents drawer.
export const NAV_TARGETS: NavTarget[] = ['overview', 'projects', 'news', 'library', 'settings', 'home', 'reader'];

export interface NavState {
  panel: NavPanelKey;
  collapsed: boolean;
  mode: NavMode;
  width: number | null;
  railCompact: boolean;
}

export const navState: NavState = (() => {
  let st: Partial<NavState> = {};
  try { st = JSON.parse(lsGet('railState') || '{}') || {}; } catch { st = {}; }
  const w = Number(st.width) || parseInt(lsGet('sidebarW') || '', 10) || 0;
  return {
    panel: st.panel === 'corpus' ? 'corpus' : 'reader',
    collapsed: st.collapsed != null ? Boolean(st.collapsed) : lsGet('sidebarHidden') === '1',
    mode: st.mode === 'flyout' ? 'flyout' : 'pinned',
    width: w >= 220 && w <= 560 ? w : null,
    railCompact: Boolean(st.railCompact),
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
  pip: (HAS_DOC ? document.getElementById('drawer-pip') : null) as HTMLElement | null,
  title: (HAS_DOC ? document.getElementById('drawer-title') : null) as HTMLElement,
  meta: (HAS_DOC ? document.getElementById('drawer-meta') : null) as HTMLElement,
  acts: (HAS_DOC ? document.getElementById('drawer-acts') : null) as HTMLElement,
  mode: (HAS_DOC ? document.getElementById('drawer-mode') : null) as HTMLButtonElement,
  close: (HAS_DOC ? document.getElementById('drawer-close') : null) as HTMLButtonElement,
};

export function saveNav(): void {
  lsSet('railState', JSON.stringify(navState));
}

/**
 * Returns true ONLY while the user is inside a legal framework:
 * - Framework Start page (`#/title/{n}/`, `#/corpus/{tier}/{jur}/{code}/`)
 * - Part Table of Contents or Full Part (`#/title/{n}/part/{p}`, `#/part/{p}`)
 * - Section Reader (`#/title/{n}/section/{id}`, `#/section/{id}`)
 */
export function isFrameworkRoute(path = state.activeRoute): boolean {
  if (state.noTitles) return false;
  const p = (path || '/').split('?')[0] || '/';
  return /^\/(?:title\/\d+(?:\/(?:$|part\/|section\/))|title\/\d+$|part\/|section\/|corpus\/)/.test(p);
}

export const isFly = (): boolean =>
  navState.mode === 'flyout'
  || mqMobile.matches
  || (mqNarrow.matches && Boolean(dom.layout?.classList.contains('chat-open')));

export const flyOpen = (): boolean => HAS_DOC && document.body.classList.contains('nav-open');

export const drawerShown = (): boolean => {
  if (!isFrameworkRoute()) return false;
  return isFly() ? flyOpen() : !navState.collapsed && !state.navRetracted;
};

export function routeTarget(path = state.activeRoute): NavTarget {
  const p = (path || '/').split('?')[0] || '/';
  if (p === '/') return 'overview';
  if (p.startsWith('/corpus/')) return 'corpus';
  if (/^\/title\/\d+\/?$/.test(p)) return 'home';
  const rest = p.replace(/^\/title\/\d+/, '');
  if (rest.startsWith('/library')) return 'library';
  if (rest.startsWith('/projects')) return 'projects';
  if (rest.startsWith('/news')) return 'news';
  if (rest.startsWith('/settings')) return 'settings';
  if (rest.startsWith('/help')) return 'help';
  if (rest.startsWith('/search')) return 'overview';
  return 'reader';
}

export function announce(text: string): void {
  const live = HAS_DOC ? document.getElementById('nav-live') : null;
  if (live) live.textContent = text;
}

export function applyNav(): void {
  if (!HAS_DOC || !dom.sidebar || !railEl) return;
  const root = document.documentElement;
  const inFw = isFrameworkRoute();
  const fly = isFly();
  if ((!fly || !inFw) && flyOpen()) document.body.classList.remove('nav-open');

  root.classList.toggle('in-framework', inFw);
  root.classList.toggle('rail-compact', !inFw && navState.railCompact);
  root.classList.toggle('drawer-fly', fly);
  root.classList.toggle('drawer-collapsed', inFw && !fly && navState.collapsed);
  root.classList.toggle('drawer-retracted', !inFw || (!fly && !navState.collapsed && Boolean(state.navRetracted)));

  const shown = drawerShown();
  dom.sidebar.inert = !shown;

  const activePanel: NavPanelKey = routeTarget() === 'corpus' ? 'corpus' : 'reader';
  navState.panel = activePanel;

  for (const el of dom.sidebar.querySelectorAll<HTMLElement>('.drawer-panel')) {
    el.hidden = el.dataset.panel !== activePanel;
  }

  // Color-code secondary framework drawer header to the active legal authority tier
  const activeTier = activePanel === 'corpus' && state.activeCorpus
    ? refTierForCorpus(state.activeCorpus)
    : 'cfr';
  dom.sidebar.dataset.refTier = activeTier;
  if (drawerEl.pip) drawerEl.pip.dataset.refTier = activeTier;

  drawerEl.title.textContent = activePanel === 'corpus' && state.activeCorpus
    ? state.activeCorpus.code
    : (state.noTitles ? 'Contents' : `${state.currentTitle} CFR`);
  drawerEl.meta.textContent = panelMeta(activePanel);
  drawerEl.acts.innerHTML = panelActions(activePanel);

  const pinned = navState.mode === 'pinned';
  if (drawerEl.mode) {
    drawerEl.mode.setAttribute('aria-pressed', String(pinned));
    drawerEl.mode.title = pinned ? 'Float the framework drawer over the page' : 'Pin the framework drawer beside the page';
    drawerEl.mode.setAttribute('aria-label', drawerEl.mode.title);
    drawerEl.mode.innerHTML = icon(pinned ? 'pin' : 'pinOff');
    drawerEl.mode.hidden = mqMobile.matches;
  }

  const route = routeTarget();
  for (const b of railEl.querySelectorAll<HTMLElement>('.ar-btn')) {
    const t = b.dataset.target;
    let isActive = false;
    if (t === 'reader') {
      isActive = inFw && (route === 'reader' || route === 'corpus' || (shown && route !== 'home'));
      b.setAttribute('aria-expanded', String(shown));
    } else if (t === 'home') {
      isActive = route === 'home';
    } else {
      isActive = t === route;
    }
    b.classList.toggle('is-active', isActive);
    if (b.tagName === 'A') {
      if (t === route) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  if (dom.navToggle) {
    dom.navToggle.title = inFw ? 'Show or hide framework drawer (⌘B)' : 'Expand or compact sidebar (⌘B)';
    dom.navToggle.setAttribute('aria-label', inFw ? 'Show or hide framework drawer' : 'Expand or compact sidebar');
    dom.navToggle.setAttribute('aria-expanded', String(inFw ? shown : !navState.railCompact));
  }

  document.body.classList.remove('drawer-library');
  updateSidebarFrameworkHighlight();
}

export function panelMeta(panel: NavPanelKey): string {
  if (panel === 'corpus' && state.activeCorpus) {
    return TIER_META[state.activeCorpus.tier]?.short || state.activeCorpus.jurisdiction_label || '';
  }
  if (panel === 'reader') {
    if (state.noTitles) return 'No titles installed';
    const cur = state.installedTitles.find(t => t.title === state.currentTitle);
    return cur?.name || state.metaInfo.name || `Title ${state.currentTitle}`;
  }
  return '';
}

export function panelActions(panel: NavPanelKey): string {
  if (panel === 'reader' && !state.noTitles) {
    const onStart = routeTarget() === 'home';
    if (!onStart) {
      return `<a class="drawer-start-pill" href="#/title/${state.currentTitle}/" title="Open Title ${state.currentTitle} start page">${icon('grid')}<span>Start</span></a>`;
    }
  }
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
  const first = panel === 'reader'
    ? dom.treeFilter
    : el.querySelector<HTMLElement>('input, button, a[href], select, textarea');
  if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
}

export function openPanel(panel: NavPanelKey, { focus = false, toggle = false } = {}): void {
  // Main pages navigate directly rather than opening a drawer
  if (panel === 'projects') { window.location.hash = '#/projects'; return; }
  if (panel === 'library') { window.location.hash = '#/library'; return; }
  if (panel === 'settings') { window.location.hash = '#/settings'; return; }
  if (panel === 'history') { window.location.hash = '#/'; return; }

  // Secondary framework drawer only opens inside a legal framework
  if (!isFrameworkRoute()) {
    if (state.noTitles) {
      window.location.hash = '#/library';
      return;
    }
    navState.collapsed = false;
    state.navRetracted = false;
    saveNav();
    window.location.hash = `#/title/${state.currentTitle}/`;
    if (focus) setTimeout(() => focusPanel('reader'), 60);
    return;
  }

  const resolved: NavPanelKey = routeTarget() === 'corpus' ? 'corpus' : 'reader';
  if (toggle && drawerShown() && navState.panel === resolved) {
    closeDrawer();
    return;
  }
  navState.panel = resolved;
  if (isFly()) document.body.classList.add('nav-open');
  else { navState.collapsed = false; state.navRetracted = false; }
  saveNav();
  renderPanel(resolved);
  applyNav();
  emit('nav:panel-opened', { panel: resolved });
  if (focus) focusPanel(resolved);
  announce(`${NAV_PANELS[resolved]} drawer open`);
}

export function closeDrawer(): void {
  const hadFocus = dom.sidebar?.contains(document.activeElement);
  if (isFly()) document.body.classList.remove('nav-open');
  else navState.collapsed = true;
  saveNav();
  applyNav();
  if (hadFocus) railEl?.querySelector<HTMLElement>('.ar-btn.is-active, .ar-btn[aria-current]')?.focus();
  announce('Framework drawer closed');
}

export function toggleDrawer(focus = true): void {
  if (!isFrameworkRoute()) {
    navState.railCompact = !navState.railCompact;
    saveNav();
    applyNav();
    announce(navState.railCompact ? 'Sidebar compacted' : 'Sidebar expanded');
    return;
  }
  if (drawerShown()) closeDrawer();
  else openPanel(routeTarget() === 'corpus' ? 'corpus' : 'reader', { focus });
}

export function goTarget(t: NavTarget): void {
  if (t === 'overview') window.location.hash = '#/';
  else if (t === 'projects') window.location.hash = '#/projects';
  else if (t === 'library') window.location.hash = '#/library';
  else if (t === 'settings') window.location.hash = '#/settings';
  else if (t === 'help') window.location.hash = '#/help';
  else if (t === 'home') window.location.hash = state.noTitles ? '#/library' : `#/title/${state.currentTitle}/`;
  else if (t === 'news') {
    if (routeTarget() === 'news') dom.main.scrollTop = 0;
    else window.location.hash = '#/news';
  } else if (t === 'reader') {
    openPanel('reader', { focus: true });
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
  const inFw = isFrameworkRoute(path);
  const t = routeTarget(path);
  if (HAS_DOC) document.body.classList.remove('nav-open');
  state.navRetracted = !inFw;
  if (inFw) {
    navState.panel = t === 'corpus' ? 'corpus' : 'reader';
    saveNav();
    renderPanel(navState.panel);
  }
  applyNav();
}

export function updateRailHome(): void {
  const home = HAS_DOC ? document.getElementById('ar-home') as HTMLAnchorElement | null : null;
  if (home) {
    if (state.noTitles) {
      home.href = '#/library';
      home.dataset.tip = 'Browse library';
      home.setAttribute('aria-label', 'Browse library');
    } else {
      home.href = `#/title/${state.currentTitle}/`;
      const t = state.installedTitles.find(x => x.title === state.currentTitle);
      home.dataset.tip = `Title ${state.currentTitle} start`;
      home.setAttribute('aria-label', `Title ${state.currentTitle}${t ? ' ' + t.name : ''} start`);
    }
  }
  renderSidebarFrameworks();
}

export function updateRailBadge(): void {
  if (!HAS_DOC) return;
  const badge = document.getElementById('ar-library-badge');
  const libPill = document.getElementById('ar-library-pill');
  const projPill = document.getElementById('ar-projects-count');
  const newsPill = document.getElementById('ar-news-pill');

  const busy = Boolean(state.jobs.current || state.jobs.queued.length);
  const libData = state.navLibData;
  const stale = libData?.titles ? libData.titles.filter(isStale).length : 0;

  if (badge) {
    badge.hidden = !busy && !stale;
    badge.className = `ar-badge${busy ? ' is-busy' : stale ? ' is-stale' : ''}`;
    const btn = badge.closest<HTMLElement>('.ar-btn');
    if (btn) btn.dataset.tip = busy ? 'Library · downloading' : stale ? `Library · ${plural(stale, 'update')}` : 'Library';
  }
  if (libPill) {
    if (busy) {
      libPill.hidden = false;
      libPill.textContent = 'Sync';
      libPill.className = 'ar-pill is-busy';
    } else if (stale > 0) {
      libPill.hidden = false;
      libPill.textContent = `${stale}`;
      libPill.className = 'ar-pill is-warn';
    } else {
      libPill.hidden = true;
    }
  }
  if (projPill) {
    const n = loadProjects().length;
    projPill.hidden = n === 0;
    projPill.textContent = n ? String(n) : '';
  }
  if (newsPill) {
    const frCount = Number(state.navNewsStatus?.articles || 0);
    newsPill.hidden = frCount === 0;
    newsPill.textContent = frCount ? String(frCount) : '';
  }
  renderSidebarFrameworks();
}

function updateSidebarFrameworkHighlight(): void {
  if (!HAS_DOC) return;
  const box = document.getElementById('ar-frameworks');
  if (!box) return;
  const inFw = isFrameworkRoute();
  const activeHash = window.location.hash || '#/';
  for (const link of box.querySelectorAll<HTMLAnchorElement>('.ar-fw-row')) {
    const tNum = Number(link.dataset.fwTitle || 0);
    const cid = link.dataset.fwId || '';
    const isCurrent = inFw && (
      (tNum > 0 && routeTarget() !== 'corpus' && tNum === state.currentTitle)
      || (cid !== '' && state.activeCorpus?.corpus_id === cid)
      || (link.getAttribute('href') === activeHash)
    );
    link.classList.toggle('is-current', isCurrent);
  }
}

export function renderSidebarFrameworks(): void {
  if (!HAS_DOC) return;
  const box = document.getElementById('ar-frameworks');
  if (!box) return;
  const all = allSystemFrameworks();
  const staleSet = new Set((state.navLibData?.titles || []).filter(isStale).map(t => t.title));

  const cfr = all.filter(c => c.tier === 'federal-reg');
  const fr = all.filter(c => c.tier === 'federal-register');
  const usc = all.filter(c => c.tier === 'federal-statute');
  const states = all.filter(c => c.tier === 'state');

  const rowHtml = (c: CorpusSummary, opts: { stale?: boolean } = {}) => {
    const refTier = refTierForCorpus(c);
    const href = corpusHashFor(c);
    const code = c.tier === 'federal-reg'
      ? `${c.code} CFR`
      : c.tier === 'federal-statute'
        ? c.code.split('§§')[0].trim()
        : c.code;
    const isInstalled = c.installed !== false;
    return `<a class="ar-fw-row" href="${escapeHtml(href)}" data-ref-tier="${refTier}" data-fw-id="${escapeHtml(c.corpus_id)}"${c.title_num ? ` data-fw-title="${c.title_num}"` : ''} title="${escapeHtml(c.code + ' · ' + c.name)}">
      <span class="tier-pip${isInstalled ? '' : ' is-hollow'}" aria-hidden="true"></span>
      <span class="ar-fw-code">${escapeHtml(code)}</span>
      <span class="ar-fw-name">${escapeHtml(c.name)}</span>
      ${opts.stale ? '<span class="stat-dot is-stale ar-fw-stale" title="Update available" aria-label="Update available"></span>' : ''}
    </a>`;
  };

  const parts: string[] = [];
  if (cfr.length) {
    parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">CFR · Federal Rules</div>${cfr.map(c => rowHtml(c, { stale: Boolean(c.title_num && staleSet.has(c.title_num)) })).join('')}</div>`);
  }
  if (fr.length) {
    parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">FR · Rulemaking</div>${fr.map(c => rowHtml(c, { stale: Boolean(c.update_available) })).join('')}</div>`);
  }
  if (usc.length) {
    parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">U.S.C. · Statutes</div>${usc.slice(0, 3).map(c => rowHtml(c)).join('')}</div>`);
  }
  if (states.length) {
    parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">State · Plans &amp; Codes</div>${states.slice(0, 3).map(c => rowHtml(c)).join('')}</div>`);
  }

  box.innerHTML = parts.join('') || '<div class="ar-fw-empty">No frameworks installed</div>';
  updateSidebarFrameworkHighlight();
}

export function renderCorpusDrawer(corpus: CorpusSummary | null = state.activeCorpus): void {
  if (!HAS_DOC) return;
  const el = document.getElementById('panel-corpus');
  if (!el) return;
  if (!corpus) {
    el.innerHTML = '<div class="dr-scroll"><p class="dr-note">Select a legal framework to view its outline.</p></div>';
    return;
  }
  const meta = TIER_META[corpus.tier] || TIER_META.state;
  const refTier = refTierForCorpus(corpus);
  const startHref = corpusHashFor(corpus);
  const linked = (corpus.linked_titles || [])
    .map(n => state.installedTitles.find(t => t.title === n))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const frLinks = corpus.tier === 'federal-register' ? `
    <section class="dr-sec">
      <h3 class="dr-label"><span>Rulemaking Feeds</span></h3>
      <a class="dr-row" href="#/news?cat=rules"><span class="dr-name">Final Rules</span>${icon('chevronRight')}</a>
      <a class="dr-row" href="#/news?cat=rulemaking"><span class="dr-name">Proposed Rules</span>${icon('chevronRight')}</a>
      <a class="dr-row" href="#/news?cat=public_inspection"><span class="dr-name">Public Inspection</span>${icon('chevronRight')}</a>
      <a class="dr-row" href="#/news?cat=enforcement"><span class="dr-name">Enforcement &amp; Citations</span>${icon('chevronRight')}</a>
    </section>` : '';

  const linkedHtml = linked.length ? `
    <section class="dr-sec">
      <h3 class="dr-label"><span>Linked CFR Frameworks</span><span class="dr-count">${linked.length}</span></h3>
      ${linked.map(t => `<a class="dr-row" href="#/title/${t.title}/">
        <span class="tier-pip" data-ref-tier="cfr" aria-hidden="true"></span>
        <span class="dr-num">${t.title}</span>
        <span class="dr-name">${escapeHtml(t.name)}</span>
      </a>`).join('')}
    </section>` : '';

  const peerFrameworks = allSystemFrameworks()
    .filter(c => c.tier === corpus.tier && c.corpus_id !== corpus.corpus_id);
  const peersHtml = peerFrameworks.length ? `
    <section class="dr-sec">
      <h3 class="dr-label"><span>Other ${escapeHtml(meta.short)} Frameworks</span></h3>
      ${peerFrameworks.map(p => `<a class="dr-row" href="${escapeHtml(corpusHashFor(p))}">
        <span class="tier-pip${p.installed === false ? ' is-hollow' : ''}" data-ref-tier="${refTier}" aria-hidden="true"></span>
        <span class="dr-name">${escapeHtml(p.code)} · ${escapeHtml(p.name)}</span>
      </a>`).join('')}
    </section>` : '';

  el.innerHTML = `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>Framework Navigation</span></h3>
      <a class="dr-row is-current" href="${escapeHtml(startHref)}" aria-current="page">
        <span class="tier-pip" data-ref-tier="${refTier}" aria-hidden="true"></span>
        <span class="dr-name">Start page &amp; authority overview</span>
      </a>
      ${corpus.external_url ? `<a class="dr-row" href="${escapeHtml(corpus.external_url)}" target="_blank" rel="noopener noreferrer">
        <span class="dr-name">Official statutory text</span>${icon('external')}
      </a>` : ''}
    </section>
    ${frLinks}
    ${linkedHtml}
    ${peersHtml}
    <div class="dr-foot">
      <a class="dr-link" href="#/library">Browse catalog</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}

registerDrawerPanel('corpus', () => renderCorpusDrawer(state.activeCorpus));

if (railEl) {
  railEl.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('.ar-btn');
    if (!btn) return;
    const t = btn.dataset.target;
    if (!t) return;
    if (btn.tagName === 'A') {
      if (t === 'news' && routeTarget() === 'news') {
        e.preventDefault();
        dom.main.scrollTop = 0;
      }
      return;
    }
    if (t === 'reader') {
      openPanel('reader', { toggle: true, focus: e.detail === 0 });
    }
  });

  railEl.addEventListener('keydown', (e) => {
    const keys = mqMobile.matches ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const i = keys.indexOf(e.key);
    if (i < 0 && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...railEl.querySelectorAll<HTMLElement>('.ar-btn, .ar-fw-row')].filter(el => el.offsetParent !== null);
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
  updateRailBadge();
});

on('title:switched', () => {
  updateRailHome();
  applyNav();
});

on('titles:refreshed', () => {
  updateRailHome();
  updateRailBadge();
});
