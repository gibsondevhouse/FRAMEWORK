import { state } from '../state';
import { plural, switchTitle } from '../components/sidebar';
import { fillTitleSelect } from '../components/title_switcher';
import { escapeHtml, icon, lsGet, lsSet, showToast } from '../dom';
import { updateRailHome } from '../nav';
import { dom } from '../state_init';
import { fmt, renderOverview } from '../usage';
import { fmtBytes, fmtSections, getJSON, pollJobs } from '../views/library';

// --- Transfer dock: downloads in progress, wherever the reader is ---
// A floating card at the bottom right of the reading panel (`#transfer-dock`, outside the
// routed view so navigation never unmounts it). It shows the running job's pipeline step,
// a progress bar, speed and time left while the text streams, and what's queued after it;
// Cancel stops the running job (not once it's installing), Clear queue drops the rest. It
// minimizes to a pill (`localStorage` `dockMinimized`) and hides when nothing is active.
// Structure is rebuilt only when its shape changes; progress ticks patch text and widths
// in place, so the bar animates and keyboard focus stays on its button.
export const DOCK_STEPS = [
  ['Checking eCFR', 'Connecting to eCFR'],
  ['Downloading contents', 'Reading the table of contents'],
  ['Downloading text', 'Streaming the regulation text'],
  ['Reading text', 'Extracting sections and appendices'],
  ['Indexing', 'Building the search index'],
  ['Installing', 'Swapping in the new edition'],
];

export const dock = { el: document.getElementById('transfer-dock'), min: lsGet('dockMinimized') === '1', key: '', hideT: null, srText: '' };

export const rate = { id: null, t: 0, done: 0, bps: 0 };


// Bytes per second from successive polls of the streaming step, smoothed (EMA) so the
// figure doesn't jitter; reset whenever the job or step changes.
export function recordJobProgress(j) {
  const streaming = j && j.phase === 'Downloading text' && j.done > 0 && (j.total == null || j.total > 100000);
  if (!streaming || j.id !== rate.id) {
    Object.assign(rate, { id: streaming ? j.id : null, t: streaming ? performance.now() : 0, done: streaming ? j.done : 0, bps: 0 });
    return;
  }
  const now = performance.now();
  const dt = (now - rate.t) / 1000;
  if (dt < 0.5) return;
  const delta = j.done - rate.done;
  if (delta > 0) rate.bps = rate.bps ? rate.bps * 0.7 + (delta / dt) * 0.3 : delta / dt;
  rate.t = now;
  rate.done = j.done;
}


export function fmtEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m ${Math.round(seconds % 60)}s left`;
}


// What the dock shows for a job: step index, descriptor, percent (null = indeterminate)
// and the two telemetry strings under the bar.
export function dockModel(j) {
  if (!j) return { step: -1, label: 'Starting…', pct: null, left: '', right: '' };
  const step = DOCK_STEPS.findIndex(([phase]) => phase === j.phase);
  const label = step >= 0 ? DOCK_STEPS[step][1] : j.phase === 'Waiting' ? 'Starting…' : j.phase;
  const has = j.total != null && j.total > 0 && j.done != null;
  const pct = has ? Math.min(99, Math.floor((j.done / j.total) * 100)) : null;
  let left = '', right = '';
  if (j.phase === 'Downloading text' && (j.total == null || j.total > 100000) && j.done) {
    left = j.total ? `${fmtBytes(Math.min(j.done, j.total))} of ${fmtBytes(j.total)}` : fmtBytes(j.done);
    const speed = rate.id === j.id && rate.bps > 51200 ? `${fmtBytes(rate.bps)}/s` : '';
    const eta = speed && j.total ? fmtEta((j.total - j.done) / rate.bps) : '';
    right = [speed, eta].filter(Boolean).join(' · ');
  } else if (j.phase === 'Downloading text' && has) {
    left = `${fmt(j.done)} of ${plural(j.total, 'file')}`;
  } else if ((j.phase === 'Reading text' || j.phase === 'Indexing') && has) {
    left = `${fmt(j.done)} of ${fmtSections(j.total)}`;
  }
  return { step, label, pct, left, right };
}


export function dockHtml(j, m) {
  const pctText = m.pct == null ? '' : `${m.pct}%`;
  const title = j ? escapeHtml(j.label) : 'Preparing download';
  if (dock.min) {
    return `<button type="button" class="dock-mini" data-dock="expand" aria-label="Show download progress: ${title}">
      <span class="stat-dot is-busy" aria-hidden="true"></span><span class="dock-mini-text">${title}</span>
      <span class="dock-mini-pct" data-f="pct">${pctText}</span>${icon('chevronUp')}</button>`;
  }
  const cancelling = j && j.cancelling;
  const locked = j && j.phase === 'Installing';
  const steps = DOCK_STEPS.map((_, i) => `<span class="${i < m.step ? 'is-done' : i === m.step ? 'is-now' : ''}"></span>`).join('');
  const queued = state.jobs.queued;
  return `<section class="dock-card" aria-label="Downloads">
    <div class="dock-head">
      <span class="stat-dot is-busy" aria-hidden="true"></span>
      <span class="dock-title">${title}</span>
      <span class="dock-pct" data-f="pct">${pctText}</span>
      <button type="button" class="dock-icon" data-dock="minimize" title="Minimize" aria-label="Minimize downloads">${icon('chevronDown')}</button>
    </div>
    <div class="dock-phase">
      <span class="dock-phase-text">${escapeHtml(cancelling ? 'Cancelling…' : m.label)}</span>
      ${m.step >= 0 ? `<span class="dock-steps" role="img" aria-label="Step ${m.step + 1} of ${DOCK_STEPS.length}">${steps}</span>` : ''}
    </div>
    <div class="dock-track"><span class="dock-fill${m.pct == null ? ' is-indeterminate' : ''}" data-f="fill" style="width:${m.pct == null ? 35 : m.pct}%"></span></div>
    <div class="dock-tele"><span data-f="left">${escapeHtml(m.left)}</span><span data-f="right">${escapeHtml(m.right)}</span></div>
    <div class="dock-foot">
      <span class="dock-queue">${queued.length ? `<span class="dock-queue-count">+${queued.length} queued</span>${escapeHtml(queued.map(q => q.label).join(', '))}` : 'Nothing queued'}</span>
      <span class="dock-acts">
        ${queued.length ? '<button type="button" class="lib-act" data-dock="clear">Clear queue</button>' : ''}
        ${j ? `<button type="button" class="lib-act is-danger" data-dock="cancel" data-id="${j.id}"${cancelling || locked ? ' disabled' : ''}${locked ? ' title="Installing: almost done"' : ''}>${cancelling ? 'Cancelling' : 'Cancel'}</button>` : ''}
      </span>
    </div>
  </section>`;
}


export function updateDock() {
  const el = dock.el;
  if (!el) return;
  const j = state.jobs.current;
  const active = Boolean(j || state.jobs.queued.length);
  if (!active) {
    if (!el.hidden && !dock.hideT) {
      el.classList.remove('is-visible');
      dock.hideT = setTimeout(() => {
        dock.hideT = null;
        if (!state.jobs.current && !state.jobs.queued.length) { el.hidden = true; el.innerHTML = ''; dock.key = ''; }
      }, 260);
    }
    return;
  }
  clearTimeout(dock.hideT);
  dock.hideT = null;
  recordJobProgress(j);
  const m = dockModel(j);
  const key = [dock.min, j && j.id, j && j.cancelling, j && j.phase === 'Installing', m.step, m.pct == null, state.jobs.queued.map(q => q.id).join('.')].join('|');
  if (key !== dock.key) {
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.dock : null;
    el.innerHTML = dockHtml(j, m);
    dock.key = key;
    if (focused) (el.querySelector(`[data-dock="${focused}"]`) || el.querySelector('[data-dock]'))?.focus();
  } else {
    const set = (f, v) => { const n = el.querySelector(`[data-f="${f}"]`); if (n && n.textContent !== v) n.textContent = v; };
    set('pct', m.pct == null ? '' : `${m.pct}%`);
    set('left', m.left);
    set('right', m.right);
    const fill = el.querySelector('[data-f="fill"]');
    if (fill && m.pct != null) fill.style.width = `${m.pct}%`;
  }
  // Screen readers hear the job and its step, not every tick.
  const sr = `${j ? j.label : 'Download'}: ${m.label}`;
  if (sr !== dock.srText) {
    dock.srText = sr;
    const live = document.getElementById('transfer-dock-live');
    if (live) live.textContent = sr;
  }
  if (el.hidden) {
    el.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-visible')));
  } else el.classList.add('is-visible');
  el.classList.toggle('is-min', dock.min);
}


if (dock.el) {
  dock.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dock]');
    if (btn) onDockAction(btn);
  });
}


// Dock buttons (also in the drawer's Library panel): minimize, expand, cancel, clear queue.
export async function onDockAction(btn) {
  {
    const act = btn.dataset.dock;
    if (act === 'minimize' || act === 'expand') {
      dock.min = act === 'minimize';
      lsSet('dockMinimized', dock.min ? '1' : '0');
      dock.key = '';
      updateDock();
      dock.el.querySelector('[data-dock]')?.focus();
      return;
    }
    btn.disabled = true;
    try {
      if (act === 'cancel') {
        await getJSON(`/api/library/jobs/${btn.dataset.id}/cancel`, { method: 'POST' });
      } else if (act === 'clear') {
        const res = await getJSON('/api/library/jobs/clear', { method: 'POST' });
        for (const j of res.cancelled || []) state.jobsSeenActive.delete(j.id);
        if (res.count) showToast(`Cleared ${plural(res.count, 'queued download')}`);
      }
      await pollJobs();
    } catch (err) {
      showToast(err.message, 5000);
      btn.disabled = false;
    }
  }
}


// Re-read the installed titles after a download or removal: the title switcher, the
// current title (if it was removed or rebuilt), and the overview if it's on screen.
export async function refreshTitles(changed = []) {
  let list;
  try { list = await getJSON('/api/titles'); } catch (e) { return; }
  state.installedTitles = list;
  fillTitleSelect();
  updateRailHome();
  if (!list.some(t => t.title === state.currentTitle) && list.length) {
    await switchTitle(list[0].title);
  } else if (changed.includes(state.currentTitle)) {
    state.treeData = null; // rebuilt: reload its contents
    const meta = list.find(t => t.title === state.currentTitle);
    if (meta) state.metaInfo = meta;
    await switchTitle(state.currentTitle);
  }
  if (dom.view.querySelector('.ov')) renderOverview();
}
