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
import { SEP, emptyStateHtml, fmtDate, joinSep, shortDate } from '../components/ui';
import { refTierForCorpus, TIER_META, TIER_ORDER } from '../components/corpora';
import { buildTabGroupSnapshot, formatTabLabel, restoreTabGroup } from '../components/reader_tabs';

// --- Projects: workspaces of pinned sections (per browser, `localStorage` `framework_projects_v1`) ---
// A workspace: {id, name, description, tags[], created_at, updated_at, sections[]}, each
// section {title, id, label, heading, part, pinned_at, note}. Pin the open section with the
// Pin button or ⌘D; `#/projects` lists workspaces and `#/projects/{id}` is one workspace, edited
// in place (name, description, tags, a note per section). Export/Import moves them as JSON.
export const PROJECTS_KEY = 'framework_projects_v1';

export const PROJECT_HUES = ['--accent', '--ok', '--warn', '--partial', '--blue', '--danger'];

export const validProject = (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.sections);

const normalizeWorkspace = (p) => ({
  ...p,
  tags: Array.isArray(p.tags) ? p.tags : [],
  sections: p.sections.map(s => ({ tier: 'federal-reg', jurisdiction: 'US', ...s })),
  projects: Array.isArray(p.projects) ? p.projects : [],
  tab_groups: Array.isArray(p.tab_groups) ? p.tab_groups : [],
});

export function loadProjects() {
  try {
    const v = JSON.parse(lsGet(PROJECTS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(validProject).map(normalizeWorkspace) : [];
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
    created_at: nowIso(), updated_at: nowIso(), sections: [], projects: [], tab_groups: [], ...extra,
  };
  list.unshift(p);
  saveProjects(list);
  return p;
}

export function addTabGroupToWorkspace(workspaceId, groupSnapshot) {
  if (!groupSnapshot) return null;
  const p = updateProject(workspaceId, (proj) => {
    if (!Array.isArray(proj.tab_groups)) proj.tab_groups = [];
    proj.tab_groups.unshift(groupSnapshot);
  });
  if (p) {
    const count = (groupSnapshot.mainTabs?.length || 0) + (groupSnapshot.splitTabs?.length || 0);
    showToast(`Saved “${groupSnapshot.name}” (${count} ${count === 1 ? 'tab' : 'tabs'}) to ${p.name}`);
  }
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
    tier: 'federal-reg', jurisdiction: 'US',
  };
}


export function clipToWorkspace(sec, { para = '', quote = '', cite = '', projectId = null } = {}) {
  if (!sec || !sec.id) return null;
  let list = loadProjects();
  let targetProj = projectId ? list.find(x => x.id === projectId) : list[0];
  if (!targetProj) {
    targetProj = createProject('Research clips');
    list = loadProjects();
    targetProj = list.find(x => x.id === targetProj.id) || list[0];
  }
  if (!targetProj) return null;

  const cleanQuote = String(quote || '').replace(/\s+/g, ' ').trim();
  const clippedCite = cite || `${sec.title} C.F.R. ${sec.label || '§ ' + sec.id}${para || ''}`;
  const entryLine = cleanQuote ? `[${clippedCite}] "${cleanQuote}"` : `[${clippedCite}]`;

  updateProject(targetProj.id, (p) => {
    let item = p.sections.find(s => s.title === sec.title && s.id === sec.id);
    if (!item) {
      item = { ...sec, pinned_at: nowIso(), note: entryLine };
      p.sections.push(item);
    } else if (!item.note || !item.note.includes(entryLine)) {
      item.note = item.note ? `${item.note}\n\n${entryLine}` : entryLine;
    }
  });
  showToast(`Clipped ${clippedCite} to ${targetProj.name}`);
  return targetProj;
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
  } else if (act === 'delete' || act === 'unpin' || act === 'tabgroup-delete') {
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
    } else if (act === 'unpin') {
      const [title, ...rest] = btn.dataset.sec.split('|');
      updateProject(projectRouteId(), (p) => { p.sections = p.sections.filter(s => !(s.title === Number(title) && s.id === rest.join('|'))); });
    } else if (act === 'tabgroup-delete') {
      const gid = btn.dataset.groupId;
      updateProject(projectRouteId(), (p) => {
        p.tab_groups = (p.tab_groups || []).filter(g => g.id !== gid);
      });
    }
  } else if (act === 'tabgroup-restore') {
    const p = loadProjects().find(x => x.id === projectRouteId());
    const grp = p?.tab_groups?.find(g => g.id === btn.dataset.groupId);
    if (grp) restoreTabGroup(grp);
  } else if (act === 'tabgroup-save-active') {
    if (!state.mainTabs.length && !state.splitTabs.length) {
      showToast('No open reader tabs to save');
      return;
    }
    addTabGroupToWorkspace(projectRouteId(), buildTabGroupSnapshot());
  } else if (act === 'task-cycle') {
    const taskId = btn.dataset.taskId;
    const order = ['open', 'in_progress', 'done'];
    updateProject(projectRouteId(), (p) => {
      const item = (p.projects || []).find(x => x.id === taskId);
      if (item) item.status = order[(order.indexOf(item.status) + 1) % order.length];
    });
  } else if (act === 'task-remove') {
    const taskId = btn.dataset.taskId;
    updateProject(projectRouteId(), (p) => {
      p.projects = (p.projects || []).filter(x => x.id !== taskId);
    });
  } else if (act === 'task-add') {
    const page = btn.closest('.proj-detail');
    const inp = page?.querySelector('#proj-task-input');
    const title = inp?.value.trim() || '';
    if (!title) { inp?.focus(); return; }
    updateProject(projectRouteId(), (p) => {
      if (!Array.isArray(p.projects)) p.projects = [];
      p.projects.unshift({
        id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        title,
        status: 'open',
        created_at: nowIso(),
      });
    });
    showToast('Action project added');
  }
}

dom.sidebar.addEventListener('click', (e) => { const b = e.target.closest('[data-proj-act]'); if (b) onProjectAction(b); });

dom.view.addEventListener('click', (e) => { const b = e.target.closest('[data-proj-act]'); if (b && dom.view.querySelector('.proj-page, .hm')) onProjectAction(b); });

const TASK_STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', done: 'Done' };

function renderWorkspaceTasksHtml(p) {
  const tasks = p.projects || [];
  const rows = tasks.map(t => `
    <div class="proj-task-row is-${escapeHtml(t.status || 'open')}">
      <button type="button" class="proj-task-status" data-proj-act="task-cycle" data-task-id="${escapeHtml(t.id)}" title="Click to advance status">${escapeHtml(TASK_STATUS_LABEL[t.status] || 'Open')}</button>
      <span class="proj-task-title">${escapeHtml(t.title)}</span>
      <button type="button" class="icon-btn proj-task-del" data-proj-act="task-remove" data-task-id="${escapeHtml(t.id)}" aria-label="Remove action project">${icon('close')}</button>
    </div>
  `).join('');
  return `
    <div class="lib-desk proj-actions-sec">
      <header class="lib-desk-header"><h2 class="lib-desk-name">Action projects</h2><span class="lib-desk-count">${plural(tasks.length, 'project')}</span></header>
      <div class="proj-task-add">
        <input type="text" class="ui-input proj-task-input" id="proj-task-input" placeholder="Add an action project (e.g. Audit GHS SDS binder for Line 4)…" aria-label="New action project title" autocomplete="off">
        <button type="button" class="btn btn-sm btn-accent" data-proj-act="task-add">${icon('plus')} Add project</button>
      </div>
      ${rows ? `<div class="proj-task-list">${rows}</div>` : '<p class="proj-task-empty">Action projects turn the legal authorities pinned below into checklists and deliverables.</p>'}
    </div>`;
}

function renderWorkspaceTabGroupsHtml(p) {
  const groups = p.tab_groups || [];
  const activeCount = state.mainTabs.length + state.splitTabs.length;
  const rows = groups.map(g => {
    const mainPills = (g.mainTabs || []).map(t => `<span class="proj-tabgroup-pill" data-ref-tier="${t.tier || 'cfr'}"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(formatTabLabel(t))}</span>`).join('');
    const splitPills = (g.splitTabs || []).map(s => `<span class="proj-tabgroup-pill is-split" data-ref-tier="${s.title !== (g.mainTabs?.[0]?.title) ? 'cross' : 'cfr'}"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(s.label || formatTabLabel(s))}</span>`).join('');
    const total = (g.mainTabs?.length || 0) + (g.splitTabs?.length || 0);
    return `
      <article class="proj-tabgroup has-tier-bar" data-ref-tier="cfr">
        <div class="proj-tabgroup-head">
          <div class="proj-tabgroup-meta">
            <h3 class="proj-tabgroup-name">${escapeHtml(g.name)}</h3>
            <span class="proj-tabgroup-time">${plural(total, 'tab')}${SEP}Saved ${escapeHtml(timeAgo(Date.parse(g.saved_at) || Date.now()))}</span>
          </div>
          <div class="proj-tabgroup-acts">
            <button type="button" class="btn btn-sm btn-accent" data-proj-act="tabgroup-restore" data-group-id="${escapeHtml(g.id)}">Open tabs</button>
            <button type="button" class="lib-act is-danger" data-proj-act="tabgroup-delete" data-group-id="${escapeHtml(g.id)}">Remove</button>
          </div>
        </div>
        ${mainPills ? `<div class="proj-tabgroup-row"><span class="proj-tabgroup-lane">Main</span><div class="proj-tabgroup-pills">${mainPills}</div></div>` : ''}
        ${splitPills ? `<div class="proj-tabgroup-row"><span class="proj-tabgroup-lane">Side-by-side</span><div class="proj-tabgroup-pills">${splitPills}</div></div>` : ''}
      </article>`;
  }).join('');

  return `
    <div class="lib-desk proj-tabgroups-sec">
      <header class="lib-desk-header">
        <h2 class="lib-desk-name">Saved tab groups</h2>
        <span class="lib-desk-count">${plural(groups.length, 'group')}</span>
        ${activeCount > 0 ? `<button type="button" class="btn btn-sm" data-proj-act="tabgroup-save-active">${icon('plus')} Save active (${activeCount})</button>` : ''}
      </header>
      ${rows ? `<div class="proj-tabgroup-list">${rows}</div>` : '<p class="proj-task-empty">Open multiple sections in reader tabs or side-by-side panes, then click <strong>Save group</strong> to snapshot your research path here.</p>'}
    </div>`;
}

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
    document.title = 'Workspaces · FRAMEWORK';
    const cards = list.map(p => {
      const topTier = refTierForCorpus(p.sections[0]?.tier || 'federal-reg');
      const taskCount = (p.projects || []).length;
      const grpCount = (p.tab_groups || []).length;
      return `<article class="lib-story proj-card has-tier-bar" data-ref-tier="${topTier}">
        <div class="story-top"><span class="story-kicker">${projDot(p)}Workspace${SEP}Updated ${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</span></div>
        <h3 class="story-name"><a href="#/projects/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></h3>
        ${p.description ? `<p class="story-dek">${escapeHtml(p.description)}</p>` : ''}
        ${p.tags && p.tags.length ? `<div class="proj-tags">${p.tags.map(t => `<span class="proj-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="story-foot"><span class="story-date">${joinSep([plural(p.sections.length, 'section'), taskCount ? plural(taskCount, 'project') : '', grpCount ? plural(grpCount, 'tab group') : '', escapeHtml(titlesOf(p))])}</span></div>
      </article>`;
    }).join('');
    const mod = isMac ? '⌘' : 'Ctrl ';
    dom.view.innerHTML = `<div class="lib lib-front proj-page" data-id="">
      <div class="doc-kicker"><a href="#/">Home</a></div>
      <div class="lib-head">
        <div class="lib-head-text"><h1 class="doc-title">Workspaces</h1>
          <p class="lib-sub">${joinSep(['Subject-based workspaces of pinned sections and projects', plural(list.length, 'workspace'), plural(sections, 'section')])}</p></div>
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
    document.title = 'Workspaces · FRAMEWORK';
    dom.view.innerHTML = emptyStateHtml({
      title: 'No such workspace',
      body: 'It may have been deleted, or it lives in another browser.',
      actionsHtml: '<a class="btn" href="#/projects">All workspaces</a>',
      cls: 'proj-page',
    });
    return;
  }
  document.title = `${p.name} · Workspaces · FRAMEWORK`;
  const installed = new Set(state.installedTitles.map(t => t.title));
  const groupedHtml = TIER_ORDER.map(tier => {
    const tierSecs = p.sections.filter(s => (s.tier || 'federal-reg') === tier);
    if (!tierSecs.length) return '';
    const tMeta = TIER_META[tier] || TIER_META['federal-reg'];
    const rTier = tMeta.refTier;
    const rows = tierSecs.map(s => {
      const href = `#/title/${s.title}/section/${encodeURIComponent(s.id)}`;
      return `<article class="proj-item has-tier-bar" data-ref-tier="${rTier}">
        <div class="story-top"><span class="story-kicker"><span class="ref-badge">${escapeHtml(tMeta.tag)}</span>${SEP}Title ${s.title}${s.part ? `${SEP}Part ${escapeHtml(s.part)}` : ''}</span>
          <span class="proj-item-date">Pinned ${escapeHtml(shortDate((s.pinned_at || '').slice(0, 10)))}</span></div>
        <h3 class="story-name">${installed.has(s.title) ? `<a href="${href}">${escapeHtml(s.label || '§ ' + s.id)} ${escapeHtml(s.heading || '')}</a>`
          : `${escapeHtml(s.label || '§ ' + s.id)} ${escapeHtml(s.heading || '')}`}</h3>
        ${installed.has(s.title) ? '' : `<p class="proj-missing">Title ${s.title} isn’t installed. <a href="#/library/${s.title}">Download it</a> to read this section.</p>`}
        <textarea class="proj-note" rows="1" data-sec="${escapeHtml(secKey(s.title, s.id))}" placeholder="Add a note…" aria-label="Note on ${escapeHtml(s.label || s.id)}">${escapeHtml(s.note || '')}</textarea>
        <div class="proj-item-acts"><button type="button" class="lib-act is-danger" data-proj-act="unpin" data-sec="${escapeHtml(secKey(s.title, s.id))}">Remove</button></div>
      </article>`;
    }).join('');
    return `<div class="proj-tier-group" data-ref-tier="${rTier}">
      <div class="proj-tier-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(tMeta.label)}</span><span class="proj-tier-count">${tierSecs.length}</span></div>
      ${rows}
    </div>`;
  }).join('');
  const mod = isMac ? '⌘' : 'Ctrl ';
  dom.view.innerHTML = `<div class="lib proj-page proj-detail" data-id="${escapeHtml(p.id)}">
    <div class="doc-kicker"><a href="#/projects">Workspaces</a></div>
    <div class="proj-head">
      <span class="proj-icon" style="--hue: var(${projectHue(p)})" aria-hidden="true">${icon('folder')}</span>
      <input class="proj-name" value="${escapeHtml(p.name)}" maxlength="80" aria-label="Workspace name" spellcheck="false">
      <span class="proj-head-acts">
        <button type="button" class="btn btn-sm" data-proj-act="export-one" data-id="${escapeHtml(p.id)}">Export</button>
        <button type="button" class="btn btn-sm is-danger" data-proj-act="delete" data-id="${escapeHtml(p.id)}">Delete</button>
      </span>
    </div>
    <textarea class="proj-desc" rows="1" placeholder="Add a description…" aria-label="Description">${escapeHtml(p.description || '')}</textarea>
    <dl class="proj-props">
      <div><dt>Tags</dt><dd><input class="proj-tags-input" value="${escapeHtml((p.tags || []).join(', '))}" placeholder="Add tags, separated by commas" aria-label="Tags"></dd></div>
      <div><dt>Sections</dt><dd>${joinSep([plural(p.sections.length, 'section'), escapeHtml(titlesOf(p))]) || '0 sections'}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(fmtDate((p.created_at || '').slice(0, 10)))}</dd></div>
      <div><dt>Updated</dt><dd data-f="updated">${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</dd></div>
    </dl>
    ${renderWorkspaceTasksHtml(p)}
    ${renderWorkspaceTabGroupsHtml(p)}
    <div class="lib-desk">
      <header class="lib-desk-header"><h2 class="lib-desk-name">Pinned sections</h2><span class="lib-desk-count">${plural(p.sections.length, 'section')}</span></header>
      ${groupedHtml || `<div class="proj-empty is-inline"><p>Nothing pinned yet. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd> to add it here.</p></div>`}
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
    if (t.matches('.proj-name')) document.title = `${t.value.trim() || 'Untitled workspace'} · Workspaces · FRAMEWORK`;
  }, 300);
});

dom.view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'proj-task-input') {
    e.preventDefault();
    const btn = e.target.closest('.proj-task-add')?.querySelector('[data-proj-act="task-add"]');
    if (btn) onProjectAction(btn);
    return;
  }
  if (e.key === 'Enter' && e.target.matches('.proj-name, .proj-tags-input')) { e.preventDefault(); e.target.blur(); }
});
