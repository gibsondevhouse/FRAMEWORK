import { state } from '../state';
import { on } from '../core/events';
import { createProject, loadProjects, projDot } from '../core/projects_store';
import { escapeHtml, isMac, plural } from '../dom';
import { drawerShown, navState, openPanel, registerDrawerPanel } from '../nav';
import { drEmpty, drLabel, setPanel } from '../panels/shared';
import { dom } from '../state_init';
import { timeAgo } from '../usage';
import { joinSep } from '../components/ui';

// --- Projects drawer panel ---
state.newProjectOpen = false;

export function showNewProjectForm(): void {
  state.newProjectOpen = true;
  if (!drawerShown() || navState.panel !== 'projects') openPanel('projects');
  else renderProjectsPanel();
  requestAnimationFrame(() => document.getElementById('dr-new-name')?.focus());
}

export const projectRouteId = (): string | null => {
  const m = /\/projects\/([^/?]+)/.exec(state.activeRoute || '');
  return m ? decodeURIComponent(m[1]) : null;
};

export function renderProjectsPanel(): void {
  const list = loadProjects();
  const current = projectRouteId();
  const form = state.newProjectOpen ? `<form class="dr-new" id="dr-new-project">
      <input class="dr-input" id="dr-new-name" name="name" placeholder="Workspace name" maxlength="80" autocomplete="off" aria-label="New workspace name">
      <button type="submit" class="lib-act is-primary">Create</button></form>` : '';
  const rows = list.map(p => `<a class="dr-proj${p.id === current ? ' is-current' : ''}" href="#/projects/${encodeURIComponent(p.id)}"${p.id === current ? ' aria-current="page"' : ''}>
      ${projDot(p)}<span class="dr-proj-text"><span class="dr-name">${escapeHtml(p.name)}</span>
      <span class="dr-proj-meta">${joinSep([plural(p.sections.length, 'section'), escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))])}</span></span></a>`).join('');
  const mod = isMac ? '⌘' : 'Ctrl ';
  setPanel('projects', `${form}
    ${list.length ? `<section class="dr-sec">${drLabel('Workspaces', `<span class="dr-count">${list.length}</span>`)}${rows}</section>`
      : drEmpty('No workspaces yet', `Organize sections for program compliance, an audit, or a review. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd>.`)
        + (state.newProjectOpen ? '' : '<button type="button" class="btn dr-empty-btn" data-nav-act="new-project">New workspace</button>')}
    <div class="dr-foot">
      <a class="dr-link" href="#/projects">All workspaces</a>
      <span class="dr-foot-acts"><button type="button" class="dr-link" data-proj-act="export"${list.length ? '' : ' disabled'}>Export</button><button type="button" class="dr-link" data-proj-act="import">Import</button></span>
    </div>`);
}

dom.sidebar.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement | null;
  if (!form || form.id !== 'dr-new-project') return;
  e.preventDefault();
  const nameInput = form.elements.namedItem('name') as HTMLInputElement | null;
  const name = nameInput?.value.trim() || '';
  if (!name) return;
  state.newProjectOpen = false;
  const p = createProject(name);
  window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
});

dom.sidebar.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (e.key === 'Escape' && t?.id === 'dr-new-name') {
    e.preventDefault();
    state.newProjectOpen = false;
    renderProjectsPanel();
  }
});

dom.sidebar.addEventListener('click', (e) => {
  const navAct = (e.target as Element | null)?.closest<HTMLElement>('[data-nav-act]');
  if (navAct && navAct.dataset.navAct === 'new-project') showNewProjectForm();
});

registerDrawerPanel('projects', renderProjectsPanel);
on('nav:new-project', () => showNewProjectForm());
