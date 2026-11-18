import { state, TransferJob } from '../state';
import { fetchInstalledTitles, getJSON } from '../api/client';
import { pollJobs, registerTitleRefresher } from '../api/jobs';
import { emit, on } from '../core/events';
import { switchTitle } from '../components/sidebar';
import { escapeHtml, icon, lsGet, lsSet, plural, showToast } from '../dom';
import { titleHref } from '../usage';
import { fmtBytes, fmtSections, transferTrackHtml } from './ui';

// --- Transfer dock: downloads in progress, wherever the reader is ---
export const DOCK_STEPS: Array<[string, string]> = [
  ['Checking eCFR', 'Connecting to eCFR'],
  ['Downloading contents', 'Reading the table of contents'],
  ['Downloading text', 'Streaming the regulation text'],
  ['Reading text', 'Extracting sections and appendices'],
  ['Indexing', 'Building the search index'],
  ['Installing', 'Swapping in the new edition'],
];

export const dock: {
  el: HTMLElement | null;
  min: boolean;
  key: string;
  hideT: ReturnType<typeof setTimeout> | null;
  srText: string;
} = {
  el: typeof document !== 'undefined' ? document.getElementById('transfer-dock') : null,
  min: lsGet('dockMinimized') === '1',
  key: '',
  hideT: null,
  srText: '',
};

export const rate: { id: number | null; t: number; done: number; bps: number } = { id: null, t: 0, done: 0, bps: 0 };

export function recordJobProgress(j: TransferJob | null | undefined): void {
  const streaming = Boolean(j && j.phase === 'Downloading text' && (j.done || 0) > 0 && (j.total == null || j.total > 100000));
  if (!streaming || !j || j.id !== rate.id) {
    Object.assign(rate, { id: streaming && j ? j.id : null, t: streaming ? performance.now() : 0, done: streaming && j ? (j.done || 0) : 0, bps: 0 });
    return;
  }
  const now = performance.now();
  const dt = (now - rate.t) / 1000;
  if (dt < 0.5) return;
  const delta = (j.done || 0) - rate.done;
  if (delta > 0) rate.bps = rate.bps ? rate.bps * 0.7 + (delta / dt) * 0.3 : delta / dt;
  rate.t = now;
  rate.done = j.done || 0;
}

export function fmtEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m ${Math.round(seconds % 60)}s left`;
}

export interface DockModel {
  step: number;
  label: string;
  pct: number | null;
  left: string;
  right: string;
}

export function dockModel(j: TransferJob | null | undefined): DockModel {
  if (!j) return { step: -1, label: 'Starting…', pct: null, left: '', right: '' };
  const step = DOCK_STEPS.findIndex(([phase]) => phase === j.phase);
  const label = step >= 0 ? DOCK_STEPS[step][1] : j.phase === 'Waiting' ? 'Starting…' : (j.phase || '');
  const has = j.total != null && j.total > 0 && j.done != null;
  const pct = has ? Math.min(99, Math.floor(((j.done || 0) / (j.total || 1)) * 100)) : null;
  let left = '';
  let right = '';
  if (j.phase === 'Downloading text' && (j.total == null || j.total > 100000) && j.done) {
    left = j.total ? `${fmtBytes(Math.min(j.done, j.total))} of ${fmtBytes(j.total)}` : fmtBytes(j.done);
    const speed = rate.id === j.id && rate.bps > 51200 ? `${fmtBytes(rate.bps)}/s` : '';
    const eta = speed && j.total ? fmtEta((j.total - j.done) / rate.bps) : '';
    right = [speed, eta].filter(Boolean).join(' · ');
  } else if (j.phase === 'Downloading text' && has) {
    left = `${Number(j.done).toLocaleString()} of ${plural(j.total || 0, 'file')}`;
  } else if ((j.phase === 'Reading text' || j.phase === 'Indexing') && has) {
    left = `${Number(j.done).toLocaleString()} of ${fmtSections(j.total)}`;
  }
  return { step, label, pct, left, right };
}

export function dockHtml(j: TransferJob | null | undefined, m: DockModel): string {
  const pctText = m.pct == null ? '' : `${m.pct}%`;
  const title = j ? escapeHtml(j.label) : 'Preparing download';
  if (dock.min) {
    return `<button type="button" class="dock-mini" data-dock="expand" aria-label="Show download progress: ${title}">
      <span class="stat-dot is-busy" aria-hidden="true"></span><span class="dock-mini-text">${title}</span>
      <span class="dock-mini-pct" data-f="pct">${pctText}</span>${icon('chevronUp')}</button>`;
  }
  const cancelling = Boolean(j && j.cancelling);
  const locked = Boolean(j && j.phase === 'Installing');
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
    ${transferTrackHtml(m.pct, { bindFill: true })}
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

export function updateDock(): void {
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
  if (dock.hideT !== null) clearTimeout(dock.hideT);
  dock.hideT = null;
  recordJobProgress(j);
  const m = dockModel(j);
  const key = [dock.min, j && j.id, j && j.cancelling, j && j.phase === 'Installing', m.step, m.pct == null, state.jobs.queued.map(q => q.id).join('.')].join('|');
  if (key !== dock.key) {
    const activeEl = document.activeElement as HTMLElement | null;
    const focused = activeEl && el.contains(activeEl) ? activeEl.dataset.dock : null;
    el.innerHTML = dockHtml(j, m);
    dock.key = key;
    if (focused) (el.querySelector<HTMLElement>(`[data-dock="${focused}"]`) || el.querySelector<HTMLElement>('[data-dock]'))?.focus();
  } else {
    const set = (f: string, v: string) => { const n = el.querySelector(`[data-f="${f}"]`); if (n && n.textContent !== v) n.textContent = v; };
    set('pct', m.pct == null ? '' : `${m.pct}%`);
    set('left', m.left);
    set('right', m.right);
    const fill = el.querySelector<HTMLElement>('[data-f="fill"]');
    if (fill && m.pct != null) fill.style.width = `${m.pct}%`;
  }
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
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-dock]');
    if (btn) onDockAction(btn);
  });
}

export async function onDockAction(btn: HTMLButtonElement): Promise<void> {
  const act = btn.dataset.dock;
  if (act === 'minimize' || act === 'expand') {
    dock.min = act === 'minimize';
    lsSet('dockMinimized', dock.min ? '1' : '0');
    dock.key = '';
    updateDock();
    dock.el?.querySelector<HTMLElement>('[data-dock]')?.focus();
    return;
  }
  btn.disabled = true;
  try {
    if (act === 'cancel') {
      await getJSON(`/api/library/jobs/${btn.dataset.id}/cancel`, { method: 'POST' });
    } else if (act === 'clear') {
      const res = await getJSON<{ cancelled?: Array<{ id: number }>; count?: number }>('/api/library/jobs/clear', { method: 'POST' });
      for (const j of res.cancelled || []) state.jobsSeenActive.delete(j.id);
      if (res.count) showToast(`Cleared ${plural(res.count, 'queued download')}`);
    }
    await pollJobs();
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Action failed', 5000);
    btn.disabled = false;
  }
}

export async function refreshTitles(changed: number[] = []): Promise<void> {
  let list;
  try { list = await fetchInstalledTitles(); } catch { return; }
  const hadNone = state.noTitles;
  state.installedTitles = list;
  state.noTitles = list.length === 0;
  emit('titles:refreshed', { hadNone, changed, list });
  if (hadNone && list.length) {
    await switchTitle(list[0].title);
    const welcomeOpen = Boolean(document.getElementById('welcome-list'));
    if (welcomeOpen) {
      const target = titleHref(list[0].title);
      if (window.location.hash === target) emit('route:refresh');
      else window.location.hash = target;
    }
    return;
  }
  if (!list.some(t => t.title === state.currentTitle) && list.length) {
    await switchTitle(list[0].title);
  } else if (changed.includes(state.currentTitle)) {
    state.treeData = null;
    const meta = list.find(t => t.title === state.currentTitle);
    if (meta) state.metaInfo = meta;
    await switchTitle(state.currentTitle);
  }
}

registerTitleRefresher(refreshTitles);
on('jobs:updated', () => updateDock());
