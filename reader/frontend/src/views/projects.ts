import { ActionProjectItem, state } from '../state';
import { on } from '../core/events';
import { onView } from '../core/view_dispatch';
import {
  PROJECTS_KEY, PROJECT_HUES, validProject, loadProjects, saveProjects, nowIso,
  createProject, addTabGroupToWorkspace, updateProject, projectHue, projDot, secKey,
  projectsWith, togglePin, currentSectionRef, clipToWorkspace, downloadJson, exportProjects,
  WorkspaceRecord,
  USC_TIER, CONST_TIER,
} from '../core/projects_store';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, isMac, plural, showToast } from '../dom';
import { announce, routeTarget } from '../nav';
import { dom } from '../state_init';
import { timeAgo } from '../usage';
import { SEP, emptyStateHtml, fmtDate, joinSep, shortDate } from '../components/ui';
import { refTierForCorpus, TIER_META, TIER_ORDER } from '../components/corpora';
import { buildTabGroupSnapshot, formatTabLabel, restoreTabGroup } from '../components/reader_tabs';
import { CONST_LIB_HREF, constCached, constHref } from '../core/constitution';

export {
  PROJECTS_KEY, PROJECT_HUES, validProject, loadProjects, saveProjects, nowIso,
  createProject, addTabGroupToWorkspace, updateProject, projectHue, projDot, secKey,
  projectsWith, togglePin, currentSectionRef, clipToWorkspace, downloadJson, exportProjects,
};

const armedTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

const projectRouteId = (): string | null => {
  const m = /\/projects\/([^/?]+)/.exec(state.activeRoute || '');
  return m ? decodeURIComponent(m[1]) : null;
};

export const importInput = document.getElementById('projects-import') as HTMLInputElement;

importInput.addEventListener('change', async () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text()) as unknown;
    const rawArr = Array.isArray(raw) ? raw : ((raw as { projects?: unknown[] })?.projects || []);
    const incoming = rawArr.filter(validProject);
    if (!incoming.length) throw new Error('No workspaces in that file');
    const list = loadProjects();
    for (const p of incoming) {
      const i = list.findIndex(x => x.id === p.id);
      if (i < 0) list.push(p);
      else if ((p.updated_at || '') >= (list[i].updated_at || '')) list[i] = p;
    }
    saveProjects(list);
    showToast(`Imported ${plural(incoming.length, 'workspace')}`);
  } catch (err) {
    showToast(`Couldn’t import: ${err instanceof Error ? err.message : 'Invalid file'}`, 5000);
  }
});

export function startNewWorkspace(): void {
  const p = createProject('Untitled workspace');
  window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
  requestAnimationFrame(() => setTimeout(() => {
    const n = dom.view.querySelector<HTMLInputElement>('.proj-name');
    if (n) { n.focus(); n.select(); }
  }, 60));
}

export function onProjectAction(btn: HTMLElement): void {
  const act = btn.dataset.projAct;
  if (act === 'export') exportProjects(loadProjects());
  else if (act === 'import') importInput.click();
  else if (act === 'new') startNewWorkspace();
  else if (act === 'export-one') {
    const p = loadProjects().find(x => x.id === btn.dataset.id);
    if (p) exportProjects([p], `${p.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'workspace'}.json`);
  } else if (act === 'delete' || act === 'unpin' || act === 'tabgroup-delete') {
    if (!btn.classList.contains('is-armed')) {
      const label = btn.textContent || 'Remove';
      btn.classList.add('is-armed');
      btn.textContent = act === 'delete' ? 'Delete workspace?' : 'Remove?';
      announce(act === 'delete' ? 'Press again to delete workspace' : 'Press again to confirm removal');
      const prevT = armedTimers.get(btn);
      if (prevT) clearTimeout(prevT);
      armedTimers.set(btn, setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = label; }, 4000));
      return;
    }
    if (act === 'delete') {
      const list = loadProjects().filter(x => x.id !== btn.dataset.id);
      window.location.hash = '#/projects';
      saveProjects(list);
      showToast('Workspace deleted');
    } else if (act === 'unpin') {
      const [title, ...rest] = (btn.dataset.sec || '').split('|');
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
    const order: ActionProjectItem['status'][] = ['open', 'in_progress', 'done'];
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
    const inp = page?.querySelector<HTMLInputElement>('#proj-task-input');
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

dom.sidebar.addEventListener('click', (e) => {
  const b = (e.target as Element | null)?.closest<HTMLElement>('[data-proj-act]');
  if (b) onProjectAction(b);
});

onView('click', (e) => {
  const b = (e.target as Element | null)?.closest<HTMLElement>('[data-proj-act]');
  if (b && dom.view.querySelector('.proj-page, .hm')) onProjectAction(b);
});

const TASK_STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In Progress', done: 'Done' };

function renderWorkspaceTasksHtml(p: WorkspaceRecord): string {
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

function renderWorkspaceTabGroupsHtml(p: WorkspaceRecord): string {
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

export function titlesOf(p: WorkspaceRecord): string {
  const ts = [...new Set(p.sections.filter(s => s.tier !== CONST_TIER).map(s => s.title))].sort((a, b) => a - b);
  const titles = ts.length ? `${ts.length === 1 ? 'Title' : 'Titles'} ${ts.join(', ')}` : '';
  return p.sections.some(s => s.tier === CONST_TIER) ? [titles, 'Constitution'].filter(Boolean).join(', ') : titles;
}

export function renderProjects(id: string | null): void {
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
  const installedUsc = new Set((state.installedUscTitles || []).map(t => t.title));
  const constInstalled = constCached()?.installed !== false;
  const groupedHtml = TIER_ORDER.map(tier => {
    const tierSecs = p.sections.filter(s => (s.tier || 'federal-reg') === tier);
    if (!tierSecs.length) return '';
    const tMeta = TIER_META[tier] || TIER_META['federal-reg'];
    const rTier = tMeta.refTier;
    const rows = tierSecs.map(s => {
      const isUsc = s.tier === USC_TIER;
      const isConst = s.tier === CONST_TIER;
      const href = isConst ? constHref(s.id)
        : isUsc ? `#/usc/${s.title}/section/${encodeURIComponent(s.id)}` : `#/title/${s.title}/section/${encodeURIComponent(s.id)}`;
      const have = isConst ? constInstalled : isUsc ? installedUsc.has(s.title) : installed.has(s.title);
      const libHref = isConst ? CONST_LIB_HREF : isUsc ? `#/library/usc/${s.title}` : `#/library/${s.title}`;
      const where = isConst ? 'U.S. Constitution' : `Title ${s.title}`;
      return `<article class="proj-item has-tier-bar" data-ref-tier="${rTier}">
        <div class="story-top"><span class="story-kicker"><span class="ref-badge">${escapeHtml(tMeta.tag)}</span>${SEP}${where}${s.part ? `${SEP}Part ${escapeHtml(s.part)}` : ''}</span>
          <span class="proj-item-date">Pinned ${escapeHtml(shortDate((s.pinned_at || '').slice(0, 10)))}</span></div>
        <h3 class="story-name">${have ? `<a href="${href}">${escapeHtml(s.label || '§ ' + s.id)} ${escapeHtml(s.heading || '')}</a>`
          : `${escapeHtml(s.label || '§ ' + s.id)} ${escapeHtml(s.heading || '')}`}</h3>
        ${have ? '' : `<p class="proj-missing">${isConst ? 'The Constitution' : isUsc ? `${s.title} U.S.C.` : `Title ${s.title}`} isn’t installed. <a href="${libHref}">Download it</a> to read this section.</p>`}
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
  for (const t of dom.view.querySelectorAll<HTMLElement>('.proj-desc, .proj-note')) autosize(t);
  if (fresh) enterView();
}

export function autosize(t: HTMLElement): void {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight}px`;
}

state.projEditT = null;

onView('input', (e) => {
  const page = (e.target as Element | null)?.closest<HTMLElement>('.proj-detail');
  if (!page) return;
  const id = page.dataset.id;
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  if (t.matches('textarea')) autosize(t);
  if (state.projEditT) clearTimeout(state.projEditT);
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

onView('keydown', (e) => {
  const ke = e as KeyboardEvent;
  const target = ke.target as HTMLElement | null;
  if (ke.key === 'Enter' && target?.id === 'proj-task-input') {
    ke.preventDefault();
    const btn = target.closest('.proj-task-add')?.querySelector<HTMLElement>('[data-proj-act="task-add"]');
    if (btn) onProjectAction(btn);
    return;
  }
  if (ke.key === 'Enter' && target?.matches('.proj-name, .proj-tags-input')) { ke.preventDefault(); target.blur(); }
});

on('projects:changed', ({ quiet }) => {
  if (!quiet && routeTarget() === 'projects') renderProjects(projectRouteId());
});
