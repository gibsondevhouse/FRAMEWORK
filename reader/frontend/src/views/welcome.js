import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { DOCK_STEPS, dockModel } from '../components/transfer_dock';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, showToast, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { getJSON, pollJobs } from './library';

// --- First run: pick a profile (shown while nothing is installed) ---
// Profiles are curated sets of whole titles and single parts, served by `/api/profiles`
// (the table lives in app/profiles.py). Picking one queues each download through the
// library, the transfer dock and this slot track them, and `refreshTitles` opens the
// reader as soon as the first title is in; the rest keep downloading in the background.
state.profilesData = null;

// "29 Labor · 30 Mineral Resources · 49 Transportation, Parts 171–180"
export function profileSummary(p, names) {
  const groups = [];
  for (const d of p.downloads) {
    let g = groups.find(x => x.title === d.title);
    if (!g) { g = { title: d.title, parts: [] }; groups.push(g); }
    if (d.part) g.parts.push(String(d.part));
  }
  const partsText = (parts) => {
    if (!parts.length) return '';
    if (parts.length === 1) return `Part ${parts[0]}`;
    const nums = parts.map(Number);
    const contiguous = nums.every(n => !isNaN(n)) && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    return contiguous ? `Parts ${parts[0]}–${parts[parts.length - 1]}` : `Parts ${parts.join(', ')}`;
  };
  return groups.map(g => {
    const name = names[g.title] ? ` ${escapeHtml(names[g.title])}` : '';
    const parts = partsText(g.parts);
    return `<span class="welcome-item"><span class="welcome-item-num">${g.title}</span>${name}${parts ? `, ${parts}` : ''}</span>`;
  }).join('<span class="sep" aria-hidden="true">·</span>');
}


export function welcomeProgressHtml() {
  const j = state.jobs.current;
  const queued = state.jobs.queued || [];
  if (!j && !queued.length) return '';
  const m = dockModel(j);
  const pctText = m.pct == null ? '' : `${m.pct}%`;
  const title = j ? escapeHtml(j.label) : 'Preparing download';
  const steps = DOCK_STEPS.map((_, i) => `<span class="${i < m.step ? 'is-done' : i === m.step ? 'is-now' : ''}"></span>`).join('');
  const queueText = queued.length ? `+${queued.length} queued (${queued.map(q => q.label).join(', ')})` : 'Nothing else queued';
  return `
    <div class="welcome-progress">
      <section class="dock-card welcome-job" aria-label="Profile download progress">
        <div class="dock-head">
          <span class="stat-dot is-busy" aria-hidden="true"></span>
          <span class="dock-title">${title}</span>
          <span class="dock-pct">${pctText}</span>
        </div>
        <div class="dock-phase">
          <span class="dock-phase-text">${escapeHtml(j && j.cancelling ? 'Cancelling…' : m.label)}</span>
          ${m.step >= 0 ? `<span class="dock-steps" aria-hidden="true">${steps}</span>` : ''}
        </div>
        <div class="dock-track"><span class="dock-fill${m.pct == null ? ' is-indeterminate' : ''}" style="width:${m.pct == null ? 35 : m.pct}%"></span></div>
        <div class="dock-tele"><span>${escapeHtml(m.left)}</span><span>${escapeHtml(m.right)}</span></div>
        <div class="dock-foot"><span class="dock-queue">${escapeHtml(queueText)}</span></div>
      </section>
      <p class="welcome-note">The reader opens as soon as the first title is ready; the rest keep downloading in the background. <a href="#/library">Open the library</a> to watch or add more.</p>
    </div>`;
}


export async function renderWelcome() {
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = 'Welcome · FRAMEWORK';
  setViewHead('');
  if (!state.profilesData) {
    dom.view.innerHTML = skeletonHtml('list', 'Loading…');
    try {
      state.profilesData = await getJSON('/api/profiles');
    } catch (err) {
      if (seq !== state.routeSeq) return;
      dom.view.innerHTML = `
        <div class="empty-state">
          <h2>Couldn’t load the profiles</h2>
          <p>${escapeHtml(err.message)}</p>
          <button type="button" class="btn" id="welcome-retry">Try again</button>
        </div>`;
      document.getElementById('welcome-retry').addEventListener('click', () => renderWelcome());
      return;
    }
    if (seq !== state.routeSeq) return;
  }
  const names = state.profilesData.title_names || {};
  const busy = Boolean(state.jobs.current || (state.jobs.queued && state.jobs.queued.length));
  dom.view.innerHTML = `
    <div class="welcome">
      <div class="doc-kicker">Welcome</div>
      <div class="welcome-head">
        <h1 class="doc-title">What do you work in?</h1>
        <p>Nothing is installed yet. Pick a profile and FRAMEWORK downloads those regulations from eCFR, one title at a time. You can add or remove titles later from the library.</p>
      </div>
      <div id="welcome-job-slot">${welcomeProgressHtml()}</div>
      <div class="welcome-list" id="welcome-list"${busy ? ' hidden' : ''}>
        ${state.profilesData.profiles.map(p => `
          <button type="button" class="welcome-card" data-profile="${escapeHtml(p.id)}">
            <span class="welcome-card-name">${escapeHtml(p.name)}</span>
            <span class="welcome-card-desc">${escapeHtml(p.description)}</span>
            <span class="welcome-card-meta">${profileSummary(p, names)}</span>
          </button>`).join('')}
        <a class="welcome-card welcome-own" href="#/library">
          <span class="welcome-card-name">Choose my own</span>
          <span class="welcome-card-desc">Browse all 50 titles and download whole titles, parts or single sections.</span>
        </a>
      </div>
    </div>`;
  enterView();
}


// Keep the picker's progress panel current while downloads run (called from pollJobs).
export function refreshWelcome() {
  const slot = document.getElementById('welcome-job-slot');
  const list = document.getElementById('welcome-list');
  if (!slot || !list) return;
  slot.innerHTML = welcomeProgressHtml();
  const busy = Boolean(state.jobs.current || (state.jobs.queued && state.jobs.queued.length));
  list.hidden = busy;
  if (!busy) for (const b of list.querySelectorAll('button')) b.disabled = false;
}


export async function installProfile(p) {
  for (const d of p.downloads) {
    const job = await getJSON('/api/library/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: d.title, part: d.part ? String(d.part) : null, section: null, kind: 'section' }),
    });
    state.jobsSeenActive.add(job.id);
  }
}


dom.view.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-profile]');
  if (!btn || !dom.view.querySelector('.welcome')?.contains(btn)) return;
  const profile = (state.profilesData?.profiles || []).find(x => x.id === btn.dataset.profile);
  if (!profile) return;
  const list = document.getElementById('welcome-list');
  for (const b of list.querySelectorAll('button')) b.disabled = true;
  try {
    await installProfile(profile);
  } catch (err) {
    showToast(err.message, 6000);
  }
  // Whatever was queued before an error shows in the panel; the list comes back if nothing is.
  await pollJobs();
  refreshWelcome();
});
