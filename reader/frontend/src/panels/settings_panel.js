import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { loadStorage } from '../components/env_modal';
import { adjustFontSize, applyFontSize } from '../components/rail';
import { clearTreeSelection, plural } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, getMotionLevel, applyMotionLevel, icon, isMac, lsGet, lsSet, showToast } from '../dom';
import { mqMobile, navState, setNavMode } from '../nav';
import { drLabel, setPanel } from '../panels/shared';
import { dom } from '../state_init';
import { timeAgo } from '../usage';
import { fmtBytes, segmentedHtml } from '../components/ui';
import { getJSON } from '../views/library';
import { refreshNewsCommand } from '../views/news';

// --- Settings panel ---
state.navStorage = null;

state.navNewsStatus = null;

state.navEnvStatus = null;


export async function loadEnvStatus() {
  try { state.navEnvStatus = await getJSON('/api/settings/env'); } catch (e) { state.navEnvStatus = null; }
  if (state.navEnvStatus) refreshSettingsViews();
}


// "in 12m" / "in 3h" for next-check and backoff times in Settings.
export function timeUntil(iso) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (isNaN(s)) return '';
  if (s <= 60) return 'any moment';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}


// Read-only: keys stay in .env, the same as ANTHROPIC_API_KEY.
export function newsSettingsHtml() {
  const ns = state.navNewsStatus;
  if (!ns) return '<div class="loading">Checking…</div>';
  if (!ns.sync_enabled) return '<p class="dr-note">News sync is off (<code>NEWS_SYNC=0</code> in <code>reader/.env</code>).</p>';
  const enabled = Object.entries(ns.sources).filter(([, s]) => s.enabled);
  const lastOk = enabled.map(([, s]) => s.last_ok_at).filter(Boolean).sort().pop();
  const nextDue = enabled.map(([, s]) => s.next_due_at).filter(Boolean).sort()[0];
  const backing = enabled.filter(([, s]) => s.retry_after);
  const when = backing.length
    ? backing.map(([, s]) => `${escapeHtml(s.last_error || 'Update failed')} · retrying ${escapeHtml(timeUntil(s.retry_after))}`).join(' · ')
    : `Last update ${lastOk ? escapeHtml(timeAgo(Date.parse(lastOk))) : 'never'} · next check ${nextDue ? escapeHtml(timeUntil(nextDue)) || 'due now' : '—'}`;
  return `
    <div class="dr-row is-static"><span class="dr-name">Federal Register</span><span class="dr-time">on</span></div>
    <div class="dr-row is-static"><span class="dr-name">DOL enforcement</span><span class="dr-time">${ns.dol_configured ? 'on' : 'off'}</span></div>
    ${ns.dol_configured ? '' : '<p class="dr-note">Enforcement requires a free <code>DOL_API_KEY</code>. <a class="dr-inline-link" href="#/help">Open setup guide</a> or <button type="button" class="dr-inline-btn" data-open-env="dol_api_key">enter key</button>.</p>'}
    <p class="dr-note">${when}</p>`;
}


export async function loadNewsSettings() {
  try { state.navNewsStatus = await getJSON('/api/news/status'); } catch (e) { state.navNewsStatus = { sync_enabled: false, sources: {}, dol_configured: false }; }
  refreshSettingsViews();
}


// Shared builders for the light drawer panel and the full #/settings page.
export const settingSeg = (name, value, opts, disabled = false) => segmentedHtml({
  label: name,
  value,
  cls: 'seg',
  dataAttr: `data-set="${escapeHtml(name)}" data-value`,
  items: opts.map(([v, label]) => ({ value: v, label, attrs: disabled ? 'disabled' : '' })),
});


export function settingsClaudeHtml() {
  return state.chatConfig.configured && state.chatConfig.models.length
    ? `<select class="set-select" data-set-model aria-label="Claude model">${state.chatConfig.models.map(m =>
        `<option value="${escapeHtml(m.id)}"${(dom.modelSelect.value || state.chatConfig.default) === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>`
    : '<p class="dr-note">Claude requires an <code>ANTHROPIC_API_KEY</code>. <a class="dr-inline-link" href="#/help">Open setup guide</a> or <button type="button" class="dr-inline-btn" data-open-env="anthropic_api_key">enter key</button>.</p>';
}


export function settingsStorageHtml() {
  const st = state.navStorage;
  if (!st) return '<div class="loading">Measuring…</div>';
  return `
    <div class="set-total"><span class="set-total-val">${fmtBytes(st.total_bytes) || '0 KB'}</span><span class="set-total-sub">on disk in ${plural(st.titles.length, 'title')}</span></div>
    ${st.titles.map(t => {
      const meta = state.installedTitles.find(x => x.title === t.title);
      return `<div class="dr-row is-static"><span class="dr-num">${t.title}</span><span class="dr-name">${escapeHtml(meta ? meta.name : `Title ${t.title}`)}</span><span class="dr-time">${fmtBytes(t.bytes)}</span></div>`;
    }).join('')}
    ${st.legacy_bytes ? `<div class="dr-row is-static"><span class="dr-num"></span><span class="dr-name">Title 29 legacy copy</span><span class="dr-time">${fmtBytes(st.legacy_bytes)}</span></div>` : ''}
    <div class="set-row">
      <span class="set-name">Temporary files<span class="set-sub">${st.temp_files ? `${plural(st.temp_files, 'file')} from unfinished downloads` : 'None left over'}</span></span>
      <button type="button" class="btn btn-sm" data-set-act="prune"${st.temp_files ? '' : ' disabled'}>${st.temp_files ? `Clean up ${fmtBytes(st.temp_bytes)}` : 'Clean'}</button>
    </div>`;
}


export function settingsKeysHtml() {
  const mod = isMac ? '⌘' : 'Ctrl';
  const keys = [
    [`${mod} K`, 'Search or jump to a section'], ['/', 'Search'], ['>', 'Commands, in search'],
    [`${mod} B`, 'Show or hide the drawer'], [`${mod} J`, 'Ask Claude'], [`${mod} D`, 'Pin section to a workspace'],
    ['G H', 'Home'], ['G T', 'Title start'], ['G C', 'Contents'], ['G P', 'Workspaces'], ['G N', 'News'], ['G L', 'Library'], ['G S', 'Settings'],
    [isMac ? '⌥ 1–7' : 'Alt 1–7', 'Rail items in order'], ['Esc', 'Close the floating drawer'],
  ];
  return `<dl class="set-keys">${keys.map(([k, v]) => `<div><dt>${k.split(' ').map(x => `<kbd>${escapeHtml(x)}</kbd>`).join('')}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}


// The drawer panel stays light: the quick adjustments people actually flip mid-reading,
// a few one-click actions, and one way into the full page. Everything deeper (Claude
// model, News status, Storage, Keyboard) lives at #/settings.
export function renderSettingsPanel() {
  const size = parseInt(lsGet('fontSize'), 10) || 16;
  const envKeys = state.navEnvStatus && state.navEnvStatus.keys;
  const configuredKeysCount = envKeys
    ? (envKeys.DOL_API_KEY.configured ? 1 : 0) + (envKeys.ANTHROPIC_API_KEY.configured ? 1 : 0)
    : null;
  const settingsMeta = configuredKeysCount == null ? 'Claude · News · Storage · Keyboard'
    : `${configuredKeysCount} of 2 optional keys set`;
  setPanel('settings', `
    <section class="dr-sec">${drLabel('Quick settings')}
      <div class="set-row"><span class="set-name">Reading text</span>
        <span class="set-quick-size" role="group" aria-label="Reading text size">
          <button type="button" data-set-act="font-dec" aria-label="Smaller text">A−</button>
          <span class="set-val" data-size-val>${size} px</span>
          <button type="button" data-set-act="font-inc" aria-label="Larger text">A+</button>
        </span></div>
      <div class="set-row"><span class="set-name">Drawer${mqMobile.matches ? '<span class="set-sub">Overlay on narrow screens</span>' : ''}</span>${settingSeg('mode', mqMobile.matches ? 'flyout' : navState.mode, [['pinned', 'Pinned'], ['flyout', 'Overlay']], mqMobile.matches)}</div>
      <div class="set-row"><span class="set-name">Motion</span>${settingSeg('motion', getMotionLevel(), [['none', 'No'], ['less', 'Less'], ['full', 'Full']])}</div>
    </section>
    <section class="dr-sec">${drLabel('Quick actions')}
      <div class="set-quick-acts">
        <button type="button" class="dr-act" data-open-env="">${icon('key')} Edit API keys</button>
        <button type="button" class="dr-act" data-set-act="news-refresh">${icon('news')} Check for news</button>
        <a class="dr-act" href="#/help">${icon('external')} Connections &amp; API keys</a>
      </div>
    </section>
    <a class="dr-cta" href="#/settings">
      <span class="dr-cta-text"><span class="dr-cta-title">Open settings</span><span class="dr-cta-meta">${escapeHtml(settingsMeta)}</span></span>${icon('chevronRight')}
    </a>`);
  if (!state.navEnvStatus) loadEnvStatus();
}


// The full settings page (#/settings): everything the light drawer panel links to.
export function renderSettingsPage(opts = {}) {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  document.title = 'Settings · FRAMEWORK';
  const size = parseInt(lsGet('fontSize'), 10) || 16;
  const top = dom.main.scrollTop;
  dom.view.innerHTML = `
    <div class="settings-front">
      <header class="help-head">
        <div>
          <div class="doc-kicker">FRAMEWORK</div>
          <h1 class="doc-title">Settings</h1>
          <p class="help-lead">Appearance, Claude, news sync, storage and keyboard shortcuts. API keys and data sources live in <a href="#/help">Connections &amp; API Keys</a>.</p>
        </div>
        <div class="help-head-actions">
          <button type="button" class="btn" data-open-env="">${icon('key')} Edit API keys</button>
        </div>
      </header>
      <div class="settings-grid">
        <section class="set-card">
          <h2 class="set-card-label">Appearance</h2>
          <div class="set-row set-col">
            <div class="set-row-head"><label class="set-name" for="set-size">Reading text</label><span class="set-val" id="set-size-val" data-size-val>${size} px</span></div>
            <input type="range" class="set-range" id="set-size" min="13" max="24" step="1" value="${size}">
          </div>
          <div class="set-row"><span class="set-name">Drawer${mqMobile.matches ? '<span class="set-sub">Overlay on narrow screens</span>' : ''}</span>${settingSeg('mode', mqMobile.matches ? 'flyout' : navState.mode, [['pinned', 'Pinned'], ['flyout', 'Overlay']], mqMobile.matches)}</div>
          <p class="dr-note">Pinned sits beside the page. Overlay slides over it and closes once you pick something.</p>
          <div class="set-row"><span class="set-name">Motion</span>${settingSeg('motion', getMotionLevel(), [['none', 'No'], ['less', 'Less'], ['full', 'Full']])}</div>
          <p class="dr-note">Full uses slow, soothing glides and tactile settling. Less keeps quiet fades without movement. No turns motion off.</p>
        </section>
        <section class="set-card">
          <h2 class="set-card-label">Claude</h2>
          ${settingsClaudeHtml()}
        </section>
        <section class="set-card">
          <h2 class="set-card-label">News</h2>
          ${newsSettingsHtml()}
        </section>
        <section class="set-card">
          <h2 class="set-card-label">Storage</h2>
          ${settingsStorageHtml()}
        </section>
        <section class="set-card set-card-wide">
          <h2 class="set-card-label">Keyboard</h2>
          ${settingsKeysHtml()}
        </section>
      </div>
    </div>`;
  if (opts.enter) enterView();
  else dom.main.scrollTop = top;
  if (!state.navStorage) loadStorage();
  if (!state.navNewsStatus) loadNewsSettings();
  if (!state.navEnvStatus) loadEnvStatus();
}


export const onSettingsPage = () => state.activeRoute === '/settings' || state.activeRoute === '/settings/';


// Settings state is shown in two places (the quick panel and the page); refresh whichever
// is on screen after a change or a lazy load lands.
export function refreshSettingsViews() {
  if (navState.panel === 'settings') renderSettingsPanel();
  if (onSettingsPage()) renderSettingsPage();
}


export function setMotionSetting(level) {
  applyMotionLevel(level);
  refreshSettingsViews();
}

// One dispatcher for [data-set-act] buttons, wherever they render (drawer or page).
export async function runSettingsAction(btn) {
  const act = btn.dataset.setAct;
  if (act === 'font-dec') adjustFontSize(-1);
  else if (act === 'font-inc') adjustFontSize(1);
  else if (act === 'news-refresh') refreshNewsCommand();
  else if (act === 'prune') {
    btn.disabled = true;
    try {
      const res = await getJSON('/api/library/storage/prune', { method: 'POST' });
      showToast(res.removed ? `Removed ${plural(res.removed, 'temporary file')} (${fmtBytes(res.freed_bytes)})` : 'Nothing to clean up');
    } catch (err) { showToast(err.message, 5000); }
    state.navStorage = null;
    refreshSettingsViews();
  }
}


// Settings page controls (delegated on the view, mirroring the drawer's handlers).
dom.view.addEventListener('click', (e) => {
  const set = e.target.closest('[data-set]');
  if (set) {
    if (set.dataset.set === 'mode') setNavMode(set.dataset.value);
    else if (set.dataset.set === 'motion') setMotionSetting(set.dataset.value);
    return;
  }
  const setAct = e.target.closest('[data-set-act]');
  if (setAct) runSettingsAction(setAct);
});

dom.view.addEventListener('input', (e) => {
  if (e.target.id === 'set-size') applyFontSize(e.target.value);
});

dom.view.addEventListener('change', (e) => {
  if (e.target.matches('[data-set-model]')) {
    dom.modelSelect.value = e.target.value;
    dom.modelSelect.dispatchEvent(new Event('change'));
  }
});
