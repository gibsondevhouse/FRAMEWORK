import { state } from '../state';
import { cleanInlineLabel, escapeHtml, icon, showToast } from '../dom';
import { dom } from '../state_init';
import { openSaveTabGroupMenu } from './pin_pop';

// --- In-app Reader Tabs (Main Pane + Coordinated Workspace Tab Groups) ---
const SESSION_TABS_KEY = 'framework_session_tabs_v1';

let splitRestorer = null;
let splitCloser = null;

export function registerSplitTabHandlers({ restore, close } = {}) {
  if (restore) splitRestorer = restore;
  if (close) splitCloser = close;
}

export function buildReaderHref(entry) {
  if (!entry) return '#/';
  const t = Number(entry.title) || state.currentTitle || 29;
  if (entry.kind === 'part' && entry.partId) {
    return `#/title/${t}/part/${encodeURIComponent(String(entry.partId))}${entry.full ? '/full' : ''}`;
  }
  let h = `#/title/${t}/section/${encodeURIComponent(String(entry.sectionId || ''))}`;
  if (entry.unit === 'full') h += '/full';
  else if (entry.unit) h += `/${encodeURIComponent(String(entry.unit))}`;
  if (entry.para) h += `?p=${encodeURIComponent(String(entry.para))}`;
  return h;
}

export function tabIdentityMatch(a, b) {
  if (!a || !b) return false;
  const ka = a.kind || (a.partId && !a.sectionId ? 'part' : 'section');
  const kb = b.kind || (b.partId && !b.sectionId ? 'part' : 'section');
  if (ka !== kb || Number(a.title) !== Number(b.title)) return false;
  if (ka === 'part') return String(a.partId) === String(b.partId) && Boolean(a.full) === Boolean(b.full);
  return String(a.sectionId) === String(b.sectionId);
}

export function formatTabLabel(entry) {
  if (entry.label) return entry.label;
  const t = Number(entry.title) || state.currentTitle || 29;
  if (entry.kind === 'part' && entry.partId) {
    return `${t} CFR Part ${entry.partId}${entry.full ? ' · Full' : ''}`;
  }
  return `${t} CFR § ${entry.sectionId || ''}`;
}

export function persistSessionTabs() {
  try {
    sessionStorage.setItem(SESSION_TABS_KEY, JSON.stringify({
      mainTabs: state.mainTabs,
      activeMainTabId: state.activeMainTabId,
      splitTabs: state.splitTabs,
      activeSplitTabId: state.activeSplitTabId,
      splitWide: state.splitWide,
    }));
  } catch (e) { /* ignore storage errors */ }
}

export function restoreSessionTabsSnapshot() {
  try {
    const raw = sessionStorage.getItem(SESSION_TABS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.mainTabs)) {
      state.mainTabs = data.mainTabs;
      state.activeMainTabId = data.activeMainTabId || data.mainTabs[0]?.id || null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function makeMainTabEntry(meta) {
  const kind = meta.kind || (meta.partId && !meta.sectionId ? 'part' : 'section');
  const title = Number(meta.title) || state.currentTitle || 29;
  const entry = {
    id: meta.id || `mtab_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    kind,
    title,
    sectionId: meta.sectionId ? String(meta.sectionId) : undefined,
    partId: meta.partId ? String(meta.partId) : undefined,
    unit: meta.unit || null,
    full: Boolean(meta.full),
    para: meta.para || null,
    label: cleanInlineLabel(meta.label || '') || formatTabLabel({ kind, title, sectionId: meta.sectionId, partId: meta.partId, full: meta.full }),
    heading: cleanInlineLabel(meta.heading || ''),
    tier: meta.tier || 'cfr',
    href: meta.href || buildReaderHref({ kind, title, sectionId: meta.sectionId, partId: meta.partId, unit: meta.unit, full: meta.full, para: meta.para }),
  };
  return entry;
}

export function syncMainTabFromRoute(meta) {
  const next = makeMainTabEntry(meta);
  const openAsNew = state.pendingNewMainTab;
  state.pendingNewMainTab = false;

  if (openAsNew) {
    const existing = state.mainTabs.find(t => tabIdentityMatch(t, next));
    if (existing) {
      Object.assign(existing, { ...next, id: existing.id });
      state.activeMainTabId = existing.id;
    } else {
      state.mainTabs.push(next);
      state.activeMainTabId = next.id;
    }
  } else {
    const active = state.mainTabs.find(t => t.id === state.activeMainTabId);
    if (active) {
      Object.assign(active, { ...next, id: active.id });
    } else {
      const same = state.mainTabs.find(t => tabIdentityMatch(t, next));
      if (same) {
        Object.assign(same, { ...next, id: same.id });
        state.activeMainTabId = same.id;
      } else {
        state.mainTabs.push(next);
        state.activeMainTabId = next.id;
      }
    }
  }
  persistSessionTabs();
  renderMainTabs();
}

export function hideMainTabs() {
  if (dom.mainTabs) dom.mainTabs.hidden = true;
}

export function renderMainTabs() {
  if (!dom.mainTabs) return;
  const isReader = Boolean(state.currentSection || state.currentPart);
  const show = isReader && (state.mainTabs.length > 1 || (state.mainTabs.length >= 1 && state.splitTabs.length > 0));
  dom.mainTabs.hidden = !show;
  if (!show) {
    dom.mainTabs.innerHTML = '';
    return;
  }

  const canClose = state.mainTabs.length > 1;
  const pillsHtml = state.mainTabs.map(t => {
    const active = t.id === state.activeMainTabId;
    const tier = Number(t.title) !== Number(state.currentTitle) ? 'cross' : (t.tier || 'cfr');
    const titleAttr = `${formatTabLabel(t)}${t.heading ? ` — ${t.heading}` : ''}`;
    return `
      <div class="reader-tab${active ? ' is-active' : ''}" data-ref-tier="${tier}" role="presentation">
        <button type="button" class="reader-tab-btn" role="tab" aria-selected="${active ? 'true' : 'false'}" data-tab-switch="${escapeHtml(t.id)}" title="${escapeHtml(titleAttr)}">
          <span class="tier-pip" aria-hidden="true"></span>
          <span class="reader-tab-label">${escapeHtml(formatTabLabel(t))}</span>
        </button>
        ${canClose ? `<button type="button" class="reader-tab-close" data-tab-close="${escapeHtml(t.id)}" aria-label="Close ${escapeHtml(formatTabLabel(t))}" title="Close tab">${icon('close')}</button>` : ''}
      </div>`;
  }).join('');

  dom.mainTabs.innerHTML = `
    <div class="reader-tabs-strip">${pillsHtml}</div>
    <div class="reader-tabs-acts">
      <button type="button" class="btn btn-small reader-tabs-save" data-tabs-act="save-group" title="Save current main & side-by-side tabs as a workspace tab group">${icon('folder')} <span>Save group</span></button>
    </div>`;
}

export function openMainReaderTab(opts = {}) {
  const kind = opts.kind || (opts.partId && !opts.sectionId ? 'part' : 'section');
  const title = Number(opts.title) || state.currentTitle || 29;
  const target = {
    kind,
    title,
    sectionId: opts.sectionId || opts.section || undefined,
    partId: opts.partId || opts.part || undefined,
    unit: opts.unit || null,
    full: Boolean(opts.full),
    para: opts.para || null,
    label: opts.label || formatTabLabel({ kind, title, sectionId: opts.sectionId || opts.section, partId: opts.partId || opts.part, full: opts.full }),
    heading: opts.heading || '',
    tier: opts.tier || (title !== state.currentTitle ? 'cross' : 'cfr'),
  };
  const href = opts.href || buildReaderHref(target);
  target.href = href;

  // Ensure the currently viewed main reader doc is captured as Tab 1 before adding Tab 2.
  if (state.mainTabs.length === 0 && (state.currentSection || state.currentPart)) {
    syncMainTabFromRoute(state.currentSection ? {
      kind: 'section',
      title: state.currentTitle,
      sectionId: state.currentSection.id,
      unit: state.currentSection.unit,
      label: `${state.currentTitle} CFR ${cleanInlineLabel(state.currentSection.label)}`,
      heading: state.currentSection.section_title || '',
      href: window.location.hash || buildReaderHref({ kind: 'section', title: state.currentTitle, sectionId: state.currentSection.id, unit: state.currentSection.unit }),
    } : {
      kind: 'part',
      title: state.currentTitle,
      partId: state.currentPart,
      full: state.activeRoute.endsWith('/full'),
      label: `${state.currentTitle} CFR Part ${state.currentPart}`,
      href: window.location.hash || buildReaderHref({ kind: 'part', title: state.currentTitle, partId: state.currentPart, full: state.activeRoute.endsWith('/full') }),
    });
  }

  const existing = state.mainTabs.find(t => tabIdentityMatch(t, target));
  if (existing) {
    existing.href = href;
    existing.para = target.para;
    existing.unit = target.unit;
    state.activeMainTabId = existing.id;
    persistSessionTabs();
    renderMainTabs();
    if (window.location.hash !== href) window.location.hash = href;
    else showToast(`${formatTabLabel(existing)} focused`);
    return existing;
  }

  state.pendingNewMainTab = true;
  if (window.location.hash === href) {
    syncMainTabFromRoute(target);
    return state.mainTabs.find(t => t.id === state.activeMainTabId) || null;
  }
  window.location.hash = href;
  return null;
}

export function switchMainTab(tabId) {
  const tab = state.mainTabs.find(t => t.id === tabId);
  if (!tab) return;
  state.activeMainTabId = tab.id;
  persistSessionTabs();
  renderMainTabs();
  if (window.location.hash !== tab.href) {
    window.location.hash = tab.href;
  }
}

export function closeMainTab(tabId) {
  if (state.mainTabs.length <= 1) return;
  const idx = state.mainTabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;
  const wasActive = state.mainTabs[idx].id === state.activeMainTabId;
  state.mainTabs.splice(idx, 1);
  if (wasActive) {
    const next = state.mainTabs[Math.min(idx, state.mainTabs.length - 1)] || state.mainTabs[0];
    state.activeMainTabId = next?.id || null;
    persistSessionTabs();
    if (next && window.location.hash !== next.href) {
      window.location.hash = next.href;
    } else {
      renderMainTabs();
    }
  } else {
    persistSessionTabs();
    renderMainTabs();
  }
}

export function suggestTabGroupName() {
  const m = state.mainTabs.find(t => t.id === state.activeMainTabId) || state.mainTabs[0];
  const s = state.splitTabs.find(t => t.id === state.activeSplitTabId) || state.splitTabs[0];
  const mLabel = m ? formatTabLabel(m) : '';
  const sLabel = s ? formatTabLabel(s) : '';
  if (mLabel && sLabel) return `${mLabel} + ${sLabel}`;
  const total = state.mainTabs.length + state.splitTabs.length;
  return mLabel ? `${mLabel}${total > 1 ? ` (${total} tabs)` : ''}` : `Research tabs (${total})`;
}

export function buildTabGroupSnapshot(customName = '') {
  const activeMainIdx = Math.max(0, state.mainTabs.findIndex(t => t.id === state.activeMainTabId));
  const activeSplitIdx = Math.max(0, state.splitTabs.findIndex(t => t.id === state.activeSplitTabId));
  return {
    id: `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: (customName || '').trim() || suggestTabGroupName(),
    saved_at: new Date().toISOString(),
    mainTabs: state.mainTabs.map(t => ({
      id: t.id,
      kind: t.kind,
      title: Number(t.title),
      sectionId: t.sectionId,
      partId: t.partId,
      unit: t.unit || null,
      full: Boolean(t.full),
      para: t.para || null,
      label: formatTabLabel(t),
      heading: t.heading || '',
      tier: t.tier || 'cfr',
      href: t.href || buildReaderHref(t),
    })),
    activeMainIdx,
    splitTabs: state.splitTabs.map(s => ({
      id: s.id,
      kind: s.kind || (s.partId && !s.sectionId ? 'part' : 'section'),
      title: Number(s.title),
      sectionId: s.sectionId,
      partId: s.partId,
      unit: s.unit || null,
      full: Boolean(s.full),
      para: s.para || null,
      label: s.label || formatTabLabel(s),
      heading: s.heading || '',
    })),
    activeSplitIdx,
    splitWide: Boolean(state.splitWide),
  };
}

export function restoreTabGroup(group) {
  if (!group) return;
  const restoredMain = (group.mainTabs || []).map(t => makeMainTabEntry(t));
  state.mainTabs = restoredMain;
  const activeMain = restoredMain[Math.min(group.activeMainIdx || 0, Math.max(0, restoredMain.length - 1))] || null;
  state.activeMainTabId = activeMain?.id || null;
  state.splitWide = Boolean(group.splitWide);

  const restoredSplit = Array.isArray(group.splitTabs) ? group.splitTabs : [];
  if (restoredSplit.length > 0 && splitRestorer) {
    splitRestorer(restoredSplit, group.activeSplitIdx || 0, group.splitWide);
  } else if (splitCloser) {
    splitCloser();
  }

  persistSessionTabs();
  renderMainTabs();
  const total = restoredMain.length + restoredSplit.length;
  showToast(`Restored “${group.name}” (${total} ${total === 1 ? 'tab' : 'tabs'})`);

  if (activeMain?.href && window.location.hash !== activeMain.href) {
    window.location.hash = activeMain.href;
  }
}

if (dom.mainTabs) {
  dom.mainTabs.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-tab-close]');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeMainTab(closeBtn.dataset.tabClose);
      return;
    }
    const switchBtn = e.target.closest('[data-tab-switch]');
    if (switchBtn) {
      switchMainTab(switchBtn.dataset.tabSwitch);
      return;
    }
    const saveBtn = e.target.closest('[data-tabs-act="save-group"]');
    if (saveBtn) {
      openSaveTabGroupMenu(saveBtn);
    }
  });
}
