import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { updatePinButton } from '../components/pin_pop';
import { clearTreeSelection, plural } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, isMac, lsGet, lsSet, showToast } from '../dom';
import { drawerEl, navState, panelMeta, renderPanel, routeTarget } from '../nav';
import { projectRouteId, renderProjectsPanel } from '../panels/projects_panel';
import { dom } from '../state_init';
import { timeAgo } from '../usage';
import { refreshHomeIfActive } from '../views/home';
import { SEP, fmtDate, joinSep, shortDate } from '../views/library';

// --- Projects: workspaces of pinned sections (per browser, `localStorage` `framework_projects_v1`) ---
// A workspace: {id, name, description, tags[], created_at, updated_at, sections[]}, each
// section {title, id, label, heading, part, pinned_at, note}. Pin the open section with the
// Pin button or ⌘D; `#/projects` lists workspaces and `#/projects/{id}` is one workspace, edited
// in place (name, description, tags, a note per section). Export/Import moves them as JSON.
export const PROJECTS_KEY = 'framework_projects_v1';

export const PROJECT_HUES = ['--accent', '--ok', '--warn', '--partial', '--blue', '--danger'];

export const validProject = (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.sections);


export function loadProjects() {
  try {
    const v = JSON.parse(lsGet(PROJECTS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(validProject) : [];
  } catch (e) { return []; }
}


// `quiet`: a page edit (typing a name or note) refreshes the drawer, not the page itself.
export function saveProjects(list, { quiet = false } = {}) {
  lsSet(PROJECTS_KEY, JSON.stringify(list));
  if (navState.panel === 'projects' || navState.panel === 'history') renderPanel(navState.panel);
  if (navState.panel === 'projects') drawerEl.meta.textContent = panelMeta('projects');
  if (!quiet && routeTarget() === 'projects') renderProjects(projectRouteId());
  if (!quiet && routeTarget() === 'overview') refreshHomeIfActive();
  updatePinButton();
}


export const nowIso = () => new Date().toISOString();

export function createProject(name, extra = {}) {
  const list = loadProjects();
  const p = {
    id: `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name || '').trim() || 'Untitled workspace', description: '', tags: [],
    created_at: nowIso(), updated_at: nowIso(), sections: [], ...extra,
  };
  list.unshift(p);
  saveProjects(list);
  return p;
}


export function updateProject(id, fn, opts) {
  const list = loadProjects();
  const p = list.find(x => x.id === id);
  if (!p) return null;
  fn(p);
  p.updated_at = nowIso();
  saveProjects(list, opts);
  return p;
}


export function projectHue(p) {
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_HUES[h % PROJECT_HUES.length];
}

export const projDot = (p) => `<span class="proj-dot" style="--hue: var(${projectHue(p)})" aria-hidden="true"></span>`;

export const secKey = (title, id) => `${title}|${id}`;

export const projectsWith = (title, id) => loadProjects().filter(p => p.sections.some(s => s.title === title && s.id === id));


export function togglePin(projectId, sec) {
  let pinned = false;
  const p = updateProject(projectId, (proj) => {
    const i = proj.sections.findIndex(s => s.title === sec.title && s.id === sec.id);
    if (i >= 0) proj.sections.splice(i, 1);
    else { proj.sections.push({ ...sec, pinned_at: nowIso(), note: '' }); pinned = true; }
  });
  if (p) showToast(pinned ? `Pinned ${sec.label} to ${p.name}` : `Removed ${sec.label} from ${p.name}`);
  return pinned;
}


export function currentSectionRef() {
  if (!state.currentSection) return null;
  return {
    title: state.currentTitle, id: state.currentSection.id, label: state.currentSection.label || `§ ${state.currentSection.id}`,
    heading: state.currentSection.section_title || state.currentSection.title_label || '', part: state.currentSection.part || '',
  };
}


// --- Export / import (JSON) ---
export function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportProjects = (list, name = 'framework-projects.json') => downloadJson(name, { format: 'framework-projects', version: 1, exported_at: nowIso(), projects: list });


export const importInput = document.getElementById('projects-import');

importInput.addEventListener('change', async () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const incoming = (Array.isArray(raw) ? raw : raw.projects || []).filter(validProject);
    if (!incoming.length) throw new Error('No workspaces in that file');
    const list = loadProjects();
    for (const p of incoming) {
      const i = list.findIndex(x => x.id === p.id);
      if (i < 0) list.push(p);
      else if ((p.updated_at || '') >= (list[i].updated_at || '')) list[i] = p; // keep the newer copy
    }
    saveProjects(list);
    showToast(`Imported ${plural(incoming.length, 'workspace')}`);
  } catch (err) {
    showToast(`Couldn’t import: ${err.message}`, 5000);
  }
});


export function startNewWorkspace() {
  const p = createProject('Untitled workspace');
  window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
  requestAnimationFrame(() => setTimeout(() => { const n = dom.view.querySelector('.proj-name'); if (n) { n.focus(); n.select(); } }, 60));
}


export function onProjectAction(btn) {
  const act = btn.dataset.projAct;
  if (act === 'export') exportProjects(loadProjects());
  else if (act === 'import') importInput.click();
  else if (act === 'new') startNewWorkspace();
  else if (act === 'export-one') {
    const p = loadProjects().find(x => x.id === btn.dataset.id);
    if (p) exportProjects([p], `${p.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'workspace'}.json`);
  } else if (act === 'delete' || act === 'unpin') {
    if (!btn.classList.contains('is-armed')) {
      const label = btn.textContent;
      btn.classList.add('is-armed');
      btn.textContent = act === 'delete' ? 'Delete workspace?' : 'Remove?';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = label; }, 4000);
      return;
    }
    if (act === 'delete') {
      const list = loadProjects().filter(x => x.id !== btn.dataset.id);
      window.location.hash = '#/projects';
      saveProjects(list);
      showToast('Workspace deleted');
    } else {
      const [title, ...rest] = btn.dataset.sec.split('|');
      updateProject(projectRouteId(), (p) => { p.sections = p.sections.filter(s => !(s.title === Number(title) && s.id === rest.join('|'))); });
    }
  }
}

dom.sidebar.addEventListener('click', (e) => { const b = e.target.closest('[data-proj-act]'); if (b) onProjectAction(b); });

dom.view.addEventListener('click', (e) => { const b = e.target.closest('[data-proj-act]'); if (b && dom.view.querySelector('.proj-page, .hm')) onProjectAction(b); });


// --- Pages: #/projects and #/projects/{id} ---
export function titlesOf(p) {
  const ts = [...new Set(p.sections.map(s => s.title))].sort((a, b) => a - b);
  return ts.length ? `${ts.length === 1 ? 'Title' : 'Titles'} ${ts.join(', ')}` : '';
}


export function renderProjects(id) {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  const list = loadProjects();
  const sections = list.reduce((a, p) => a + p.sections.length, 0);
  const fresh = !dom.view.querySelector(`.proj-page[data-id="${id || ''}"]`);
  if (!id) {
    document.title = 'Projects · FRAMEWORK';
    const cards = list.map(p => `<article class="lib-story proj-card">
        <div class="story-top"><span class="story-kicker">${projDot(p)}Workspace${SEP}Updated ${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</span></div>
        <h3 class="story-name"><a href="#/projects/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></h3>
        ${p.description ? `<p class="story-dek">${escapeHtml(p.description)}</p>` : ''}
        ${p.tags && p.tags.length ? `<div class="proj-tags">${p.tags.map(t => `<span class="proj-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="story-foot"><span class="story-date">${joinSep([plural(p.sections.length, 'section'), escapeHtml(titlesOf(p))])}</span></div>
      </article>`).join('');
    const mod = isMac ? '⌘' : 'Ctrl ';
    dom.view.innerHTML = `<div class="lib lib-front proj-page" data-id="">
      <div class="doc-kicker"><a href="#/">Home</a></div>
      <div class="lib-head">
        <div class="lib-head-text"><h1 class="doc-title">Projects</h1>
          <p class="lib-sub">${joinSep(['Workspaces of pinned sections for program compliance, audits, or reviews', plural(list.length, 'workspace'), plural(sections, 'section')])}</p></div>
        <button type="button" class="btn" data-proj-act="new">${icon('plus')} New workspace</button>
      </div>
      ${list.length ? `<div class="lib-desk"><header class="lib-desk-header"><h2 class="lib-desk-name">All workspaces</h2><span class="lib-desk-count">${plural(list.length, 'workspace')}</span></header>
        <div class="lib-stories">${cards}</div></div>`
        : `<div class="proj-empty"><div class="dr-empty-title">Start a workspace</div>
            <p>Collect the sections a compliance program, audit, or permit review turns on, with a note on each. Open any section and press <strong>Pin</strong> or <kbd>${mod}D</kbd>, or start an empty workspace here.</p>
            <span class="proj-empty-acts"><button type="button" class="btn btn-accent" data-proj-act="new">${icon('plus')} New workspace</button><button type="button" class="btn" data-proj-act="import">Import file</button></span></div>`}
    </div>`;
    if (fresh) enterView();
    return;
  }
  const p = list.find(x => x.id === id);
  if (!p) {
    document.title = 'Projects · FRAMEWORK';
    dom.view.innerHTML = `<div class="empty-state proj-page" data-id="${escapeHtml(id)}"><h2>No such workspace</h2><p>It may have been deleted, or it lives in another browser.</p><a class="btn" href="#/projects">All workspaces</a></div>`;
    return;
  }
  document.title = `${p.name} · Projects · FRAMEWORK`;
  const installed = new Set(state.installedTitles.map(t => t.title));
  const items = p.sections.map(s => {
    const href = `#/title/${s.title}/section/${encodeURIComponent(s.id)}`;
    return `<article class="proj-item">
      <div class="story-top"><span class="story-kicker">Title ${s.title}${s.part ? `${SEP}Part ${escapeHtml(s.part)}` : ''}</span>
        <span class="proj-item-date">Pinned ${escapeHtml(shortDate((s.pinned_at || '').slice(0, 10)))}</span></div>
      <h3 class="story-name">${installed.has(s.title) ? `<a href="${href}">${escapeHtml(s.label || '§ ' + s.id)} ${escapeHtml(s.heading || '')}</a>`
        : `${escapeHtml(s.label || '§ ' + s.id)} ${escapeHtml(s.heading || '')}`}</h3>
      ${installed.has(s.title) ? '' : `<p class="proj-missing">Title ${s.title} isn’t installed. <a href="#/library/${s.title}">Download it</a> to read this section.</p>`}
      <textarea class="proj-note" rows="1" data-sec="${escapeHtml(secKey(s.title, s.id))}" placeholder="Add a note…" aria-label="Note on ${escapeHtml(s.label || s.id)}">${escapeHtml(s.note || '')}</textarea>
      <div class="proj-item-acts"><button type="button" class="lib-act is-danger" data-proj-act="unpin" data-sec="${escapeHtml(secKey(s.title, s.id))}">Remove</button></div>
    </article>`;
  }).join('');
  const mod = isMac ? '⌘' : 'Ctrl ';
  dom.view.innerHTML = `<div class="lib proj-page proj-detail" data-id="${escapeHtml(p.id)}">
    <div class="doc-kicker"><a href="#/projects">Projects</a></div>
    <div class="proj-head">
      <span class="proj-icon" style="--hue: var(${projectHue(p)})" aria-hidden="true">${icon('folder')}</span>
      <input class="proj-name" value="${escapeHtml(p.name)}" maxlength="80" aria-label="Workspace name" spellcheck="false">
      <span class="proj-head-acts">
        <button type="button" class="lib-act" data-proj-act="export-one" data-id="${escapeHtml(p.id)}">Export</button>
        <button type="button" class="lib-act is-danger" data-proj-act="delete" data-id="${escapeHtml(p.id)}">Delete</button>
      </span>
    </div>
    <textarea class="proj-desc" rows="1" placeholder="Add a description…" aria-label="Description">${escapeHtml(p.description || '')}</textarea>
    <dl class="proj-props">
      <div><dt>Tags</dt><dd><input class="proj-tags-input" value="${escapeHtml((p.tags || []).join(', '))}" placeholder="Add tags, separated by commas" aria-label="Tags"></dd></div>
      <div><dt>Sections</dt><dd>${joinSep([plural(p.sections.length, 'section'), escapeHtml(titlesOf(p))]) || '0 sections'}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(fmtDate((p.created_at || '').slice(0, 10)))}</dd></div>
      <div><dt>Updated</dt><dd data-f="updated">${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</dd></div>
    </dl>
    <div class="lib-desk">
      <header class="lib-desk-header"><h2 class="lib-desk-name">Pinned sections</h2><span class="lib-desk-count">${plural(p.sections.length, 'section')}</span></header>
      ${items || `<div class="proj-empty is-inline"><p>Nothing pinned yet. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd> to add it here.</p></div>`}
    </div>
  </div>`;
  for (const t of dom.view.querySelectorAll('.proj-desc, .proj-note')) autosize(t);
  if (fresh) enterView();
  if (navState.panel === 'projects') renderProjectsPanel();
}


export function autosize(t) {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}


// In-place edits save as you type (debounced) without re-rendering the page.
state.projEditT = null;

dom.view.addEventListener('input', (e) => {
  const page = e.target.closest('.proj-detail');
  if (!page) return;
  const id = page.dataset.id;
  const t = e.target;
  if (t.matches('textarea')) autosize(t);
  clearTimeout(state.projEditT);
  state.projEditT = setTimeout(() => {
    updateProject(id, (p) => {
      if (t.matches('.proj-name')) p.name = t.value.trim() || 'Untitled workspace';
      else if (t.matches('.proj-desc')) p.description = t.value;
      else if (t.matches('.proj-tags-input')) p.tags = t.value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 12);
      else if (t.matches('.proj-note')) {
        const s = p.sections.find(x => secKey(x.title, x.id) === t.dataset.sec);
        if (s) s.note = t.value;
      }
    }, { quiet: true });
    const upd = page.querySelector('[data-f="updated"]');
    if (upd) upd.textContent = 'just now';
    if (t.matches('.proj-name')) document.title = `${t.value.trim() || 'Untitled workspace'} · Projects · FRAMEWORK`;
  }, 300);
});

dom.view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.proj-name, .proj-tags-input')) { e.preventDefault(); e.target.blur(); }
});
