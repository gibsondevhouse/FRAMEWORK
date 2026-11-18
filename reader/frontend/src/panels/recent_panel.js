import { applyFontSize } from '../components/rail';
import { onDockAction } from '../components/transfer_dock';
import { escapeHtml, showToast } from '../dom';
import { setNavMode } from '../nav';
import { showNewProjectForm } from '../panels/projects_panel';
import { runSettingsAction } from '../panels/settings_panel';
import { drEmpty, drLabel, setPanel } from '../panels/shared';
import { dom } from '../state_init';
import { loadUsage, timeAgo } from '../usage';
import { queueBatch } from '../views/library';
import { loadProjects } from '../views/projects';

// --- Recent panel (re-click Overview or Home): reading history and recent pins ---
export function renderHistoryPanel() {
  const u = loadUsage();
  const rows = Object.entries(u.s).map(([key, e]) => ({ key, title: Number(key.split('|')[0]), id: key.slice(key.indexOf('|') + 1), ...e }))
    .sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 24);
  const dayOf = (ms) => {
    const d = new Date(ms); const today = new Date();
    const days = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier';
  };
  let lastDay = '';
  const list = rows.map(r => {
    const day = dayOf(r.t);
    const label = day !== lastDay ? `<div class="dr-day">${day}</div>` : '';
    lastDay = day;
    return `${label}<a class="dr-item" href="#/title/${r.title}/section/${encodeURIComponent(r.id)}">
      <span class="dr-item-top"><span class="dr-item-kicker">${escapeHtml(r.l || '§ ' + r.id)}<span class="sep" aria-hidden="true">·</span>Title ${r.title}</span><span class="dr-time">${escapeHtml(timeAgo(r.t))}</span></span>
      <span class="dr-item-name">${escapeHtml(r.h || '')}</span></a>`;
  }).join('');
  const pins = loadProjects().flatMap(p => p.sections.map(s => ({ ...s, project: p }))).sort((a, b) => (b.pinned_at || '').localeCompare(a.pinned_at || '')).slice(0, 6);
  setPanel('history', `
    <section class="dr-sec">${drLabel('Recently read')}${list || drEmpty('Nothing read yet', 'Sections you open appear here, newest first.')}</section>
    ${pins.length ? `<section class="dr-sec">${drLabel('Recent pins')}${pins.map(s => `<a class="dr-item" href="#/title/${s.title}/section/${encodeURIComponent(s.id)}">
        <span class="dr-item-top"><span class="dr-item-kicker">§ ${escapeHtml(s.id)}<span class="sep" aria-hidden="true">·</span>${escapeHtml(s.project.name)}</span></span>
        <span class="dr-item-name">${escapeHtml(s.heading || '')}</span></a>`).join('')}</section>` : ''}`);
}


// Panel controls (delegated): settings, library actions, drawer header actions.
dom.sidebar.addEventListener('click', async (e) => {
  const set = e.target.closest('[data-set]');
  if (set) {
    if (set.dataset.set === 'mode') setNavMode(set.dataset.value);
    return;
  }
  const navAct = e.target.closest('[data-nav-act]');
  if (navAct && navAct.dataset.navAct === 'new-project') { showNewProjectForm(); return; }
  const setAct = e.target.closest('[data-set-act]');
  if (setAct) { runSettingsAction(setAct); return; }
  const dockBtn = e.target.closest('[data-dock]');
  if (dockBtn) { onDockAction(dockBtn); return; }
  const act = e.target.closest('button[data-act]');
  if (act && (act.dataset.act === 'download-suite' || act.dataset.act === 'update-all')) {
    act.disabled = true;
    try {
      if (act.dataset.act === 'download-suite') await queueBatch('/api/library/batch-download', { suite: act.dataset.suite }, 'Every title in this suite is installed and current');
      else await queueBatch('/api/library/update-all', null, 'Every installed title is already current');
    } catch (err) { showToast(err.message, 5000); act.disabled = false; }
  }
});


dom.sidebar.addEventListener('input', (e) => {
  if (e.target.id === 'set-size') applyFontSize(e.target.value);
});

dom.sidebar.addEventListener('change', (e) => {
  if (e.target.matches('[data-set-model]')) {
    dom.modelSelect.value = e.target.value;
    dom.modelSelect.dispatchEvent(new Event('change'));
  }
});
