import { loadProjects } from '../core/projects_store';
import { escapeHtml } from '../dom';
import { registerDrawerPanel } from '../nav';
import { drEmpty, drLabel, setPanel } from '../panels/shared';
import { loadUsage, timeAgo } from '../usage';

// --- Recent panel (re-click Overview or Home): reading history and recent pins ---
export function renderHistoryPanel(): void {
  const u = loadUsage();
  const rows = Object.entries(u.s).map(([key, e]) => ({ key, title: Number(key.split('|')[0]), id: key.slice(key.indexOf('|') + 1), ...e }))
    .sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 24);
  const dayOf = (ms: number | undefined) => {
    const d = new Date(ms || 0);
    const today = new Date();
    const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier';
  };
  let lastDay = '';
  const list = rows.map(r => {
    const day = dayOf(r.t);
    const label = day !== lastDay ? `<div class="dr-day">${day}</div>` : '';
    lastDay = day;
    return `${label}<a class="dr-item" href="#/title/${r.title}/section/${encodeURIComponent(r.id)}">
      <span class="dr-item-top"><span class="dr-item-kicker">${escapeHtml(r.l || '§ ' + r.id)}<span class="sep" aria-hidden="true">·</span>Title ${r.title}</span><span class="dr-time">${escapeHtml(timeAgo(r.t || 0))}</span></span>
      <span class="dr-item-name">${escapeHtml(r.h || '')}</span></a>`;
  }).join('');
  const pins = loadProjects().flatMap(p => p.sections.map(s => ({ ...s, project: p })))
    .sort((a, b) => (b.pinned_at || '').localeCompare(a.pinned_at || '')).slice(0, 6);
  setPanel('history', `
    <section class="dr-sec">${drLabel('Recently read')}${list || drEmpty('Nothing read yet', 'Sections you open appear here, newest first.')}</section>
    ${pins.length ? `<section class="dr-sec">${drLabel('Recent pins')}${pins.map(s => `<a class="dr-item" href="#/title/${s.title}/section/${encodeURIComponent(s.id)}">
        <span class="dr-item-top"><span class="dr-item-kicker">§ ${escapeHtml(s.id)}<span class="sep" aria-hidden="true">·</span>${escapeHtml(s.project.name)}</span></span>
        <span class="dr-item-name">${escapeHtml(s.heading || '')}</span></a>`).join('')}</section>` : ''}`);
}

registerDrawerPanel('history', renderHistoryPanel);
