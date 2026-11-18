import { state } from '../state';
import { dockModel } from '../components/transfer_dock';
import { escapeHtml, icon } from '../dom';
import { drawerShown, navState, updateRailBadge } from '../nav';
import { drEmpty, drLabel, setPanel } from '../panels/shared';
import { fmtMB, joinSep, transferTrackHtml } from '../components/ui';
import { amendedWeek, getJSON, isStale, suiteState, titleStatus } from '../views/library';

// --- Library panel: transfers, installed titles, suites ---
export const navLib = { data: null, at: 0, loading: null };

export async function ensureNavLibrary(force = false) {
  if (!force && navLib.data && Date.now() - navLib.at < 60000) return navLib.data;
  if (!navLib.loading) {
    navLib.loading = getJSON('/api/library').then(d => {
      navLib.data = d;
      navLib.at = Date.now();
      return d;
    }).finally(() => { navLib.loading = null; });
  }
  return navLib.loading;
}


export function transferHtml() {
  const j = state.jobs.current;
  if (!j && !state.jobs.queued.length) return '<p class="dr-note">Nothing downloading.</p>';
  const m = dockModel(j);
  const card = !j ? '' : `<div class="dr-job">
      <div class="dr-job-head"><span class="stat-dot is-busy" aria-hidden="true"></span><span class="dr-job-title">${escapeHtml(j.label)}</span><span class="dr-job-pct" data-f="pct">${m.pct == null ? '' : m.pct + '%'}</span></div>
      <div class="dr-job-phase" data-f="phase">${escapeHtml(j.cancelling ? 'Cancelling…' : m.label)}</div>
      ${transferTrackHtml(m.pct, { bindFill: true })}
      <div class="dock-tele"><span data-f="left">${escapeHtml(m.left)}</span><span data-f="right">${escapeHtml(m.right)}</span></div>
      <div class="dr-job-acts"><button type="button" class="lib-act is-danger" data-dock="cancel" data-id="${j.id}"${j.cancelling || j.phase === 'Installing' ? ' disabled' : ''}>Cancel</button></div>
    </div>`;
  const queue = state.jobs.queued.map(q => `<div class="dr-row is-static"><span class="stat-dot is-busy" aria-hidden="true"></span><span class="dr-name">${escapeHtml(q.label)}</span><span class="dr-time">Queued</span></div>`).join('');
  return card + queue + (state.jobs.queued.length ? '<button type="button" class="dr-link" data-dock="clear">Clear queue</button>' : '');
}


state.navTransferKey = '';

export function updateNavTransfers() {
  updateRailBadge();
  if (navState.panel !== 'library' || !drawerShown()) return;
  const box = document.getElementById('dr-transfers');
  if (!box) return;
  const j = state.jobs.current;
  const m = dockModel(j);
  const key = [j && j.id, j && j.cancelling, j && j.phase === 'Installing', m.pct == null, state.jobs.queued.map(q => q.id).join('.')].join('|');
  if (key !== state.navTransferKey) {
    state.navTransferKey = key;
    box.innerHTML = transferHtml();
    const count = document.getElementById('dr-transfers-count');
    const n = (j ? 1 : 0) + state.jobs.queued.length;
    if (count) count.textContent = n ? String(n) : '';
    const sec = document.getElementById('dr-transfers-sec');
    if (sec) sec.hidden = !n;
    return;
  }
  const set = (f, v) => { const n = box.querySelector(`[data-f="${f}"]`); if (n && n.textContent !== v) n.textContent = v; };
  set('pct', m.pct == null ? '' : `${m.pct}%`);
  set('phase', j && j.cancelling ? 'Cancelling…' : m.label);
  set('left', m.left);
  set('right', m.right);
  const fill = box.querySelector('[data-f="fill"]');
  if (fill && m.pct != null) fill.style.width = `${m.pct}%`;
}


export function renderLibraryPanel() {
  const d = navLib.data;
  state.navTransferKey = '';
  const active = (state.jobs.current ? 1 : 0) + state.jobs.queued.length;
  // Transfers only while something is queued or running (the section appears with the job).
  const transfers = `<section class="dr-sec" id="dr-transfers-sec"${active ? '' : ' hidden'}>${drLabel('Transfers', `<span class="dr-count" id="dr-transfers-count">${active || ''}</span>`)}<div id="dr-transfers">${transferHtml()}</div></section>`;
  if (!d) {
    setPanel('library', transfers + '<div class="loading">Loading the library…</div>');
    ensureNavLibrary().then(() => { if (navState.panel === 'library') renderLibraryPanel(); updateRailBadge(); })
      .catch(() => setPanel('library', transfers + drEmpty('Couldn’t reach eCFR', 'The installed titles are still in the reader. Try the library again in a moment.')));
    return;
  }
  const live = d.titles.filter(t => !t.reserved);
  const installed = live.filter(t => t.installed);
  const stale = installed.filter(isStale);
  const rows = installed.map(t => {
    const st = titleStatus(t);
    return `<a class="dr-row" href="#/title/${t.title}/">
      <span class="dr-num">${t.title}</span><span class="dr-name">${escapeHtml(t.name)}</span>
      <span class="stat-dot is-${st.state}" title="${escapeHtml(st.text)}" aria-hidden="true"></span><span class="sr-only">${escapeHtml(st.text)}</span></a>`;
  }).join('');
  const suites = Object.values(d.suites || {}).map(s => {
    const st = suiteState(s, d);
    const have = st.ts.filter(t => t.installed && t.installed.whole).length;
    return `<div class="dr-suite">
      <div class="dr-suite-text"><span class="dr-suite-name">${escapeHtml(s.name)}</span>
        <span class="dr-suite-meta">${joinSep([`${have} of ${st.ts.length} installed`, fmtMB(s.size_mb)])}</span></div>
      ${st.label ? `<button type="button" class="icon-btn drawer-icon" data-act="download-suite" data-suite="${escapeHtml(s.id)}" title="${escapeHtml(st.label)}" aria-label="${escapeHtml(st.label)}: ${escapeHtml(s.name)}">${icon('download')}</button>`
        : st.busy.length ? '<span class="stat-dot is-busy" title="In progress" aria-hidden="true"></span>'
        : st.ts.length ? '<span class="stat-dot is-synced" title="Installed" aria-hidden="true"></span>'
        : '<span class="stat-dot is-uninstalled" title="Not installed" aria-hidden="true"></span>'}
    </div>`;
  }).join('');
  setPanel('library', `
    <a class="dr-cta" href="#/library">
      <span class="dr-cta-text"><span class="dr-cta-title">Browse the library</span><span class="dr-cta-meta">${live.length} titles · ${amendedWeek(d).recent} amended this week</span></span>${icon('chevronRight')}
    </a>
    ${transfers}
    <section class="dr-sec">${drLabel('Installed', `<span class="dr-count">${installed.length}</span>${stale.length ? `<button type="button" class="dr-link" data-act="update-all">Update ${stale.length}</button>` : ''}`)}
      ${rows || '<p class="dr-note">No titles installed.</p>'}</section>
    ${suites ? `<section class="dr-sec">${drLabel('Suites')}${suites}</section>` : ''}`);
  updateRailBadge();
}
