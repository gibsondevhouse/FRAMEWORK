import { ActionProjectItem, state, TabGroupRecord } from '../state';
import { emit } from './events';
import { lsGet, lsSet, showToast } from '../dom';

// Workspace persistence and mutation engine (`localStorage` `framework_projects_v1`).

export const PROJECTS_KEY = 'framework_projects_v1';

export const PROJECT_HUES = ['--accent', '--ok', '--warn', '--partial', '--blue', '--danger'];

export interface WorkspaceSectionRef {
  title: number;
  id: string;
  label: string;
  heading?: string;
  part?: string;
  tier?: string;
  jurisdiction?: string;
  pinned_at?: string;
  note?: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  sections: WorkspaceSectionRef[];
  projects?: ActionProjectItem[];
  tab_groups?: TabGroupRecord[];
}

export const validProject = (p: unknown): p is WorkspaceRecord =>
  Boolean(p && typeof p === 'object' && typeof (p as WorkspaceRecord).id === 'string'
    && typeof (p as WorkspaceRecord).name === 'string' && Array.isArray((p as WorkspaceRecord).sections));

const normalizeWorkspace = (p: WorkspaceRecord): WorkspaceRecord => ({
  ...p,
  tags: Array.isArray(p.tags) ? p.tags : [],
  sections: p.sections.map(s => ({ tier: 'federal-reg', jurisdiction: 'US', ...s })),
  projects: Array.isArray(p.projects) ? p.projects : [],
  tab_groups: Array.isArray(p.tab_groups) ? p.tab_groups : [],
});

export function loadProjects(): WorkspaceRecord[] {
  try {
    const v = JSON.parse(lsGet(PROJECTS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(validProject).map(normalizeWorkspace) : [];
  } catch {
    return [];
  }
}

export function saveProjects(list: WorkspaceRecord[], { quiet = false } = {}): void {
  lsSet(PROJECTS_KEY, JSON.stringify(list));
  emit('projects:changed', { quiet });
}

export const nowIso = (): string => new Date().toISOString();

export function createProject(name: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  const list = loadProjects();
  const p: WorkspaceRecord = {
    id: `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name || '').trim() || 'Untitled workspace',
    description: '',
    tags: [],
    created_at: nowIso(),
    updated_at: nowIso(),
    sections: [],
    projects: [],
    tab_groups: [],
    ...extra,
  };
  list.unshift(p);
  saveProjects(list);
  return p;
}

export function updateProject(
  id: string | null | undefined,
  fn: (proj: WorkspaceRecord) => void,
  opts?: { quiet?: boolean },
): WorkspaceRecord | null {
  if (!id) return null;
  const list = loadProjects();
  const p = list.find(x => x.id === id);
  if (!p) return null;
  fn(p);
  p.updated_at = nowIso();
  saveProjects(list, opts);
  return p;
}

export function addTabGroupToWorkspace(
  workspaceId: string | null | undefined,
  groupSnapshot: TabGroupRecord | null,
): WorkspaceRecord | null {
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

export function projectHue(p: { id: string }): string {
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_HUES[h % PROJECT_HUES.length];
}

export const projDot = (p: { id: string }): string =>
  `<span class="proj-dot" style="--hue: var(${projectHue(p)})" aria-hidden="true"></span>`;

export const secKey = (title: number, id: string): string => `${title}|${id}`;

export const projectsWith = (title: number, id: string): WorkspaceRecord[] =>
  loadProjects().filter(p => p.sections.some(s => s.title === title && s.id === id));

export function togglePin(projectId: string, sec: WorkspaceSectionRef): boolean {
  let pinned = false;
  const p = updateProject(projectId, (proj) => {
    const i = proj.sections.findIndex(s => s.title === sec.title && s.id === sec.id);
    if (i >= 0) proj.sections.splice(i, 1);
    else {
      proj.sections.push({ ...sec, pinned_at: nowIso(), note: '' });
      pinned = true;
    }
  });
  if (p) showToast(pinned ? `Pinned ${sec.label} to ${p.name}` : `Removed ${sec.label} from ${p.name}`);
  return pinned;
}

export function currentSectionRef(): WorkspaceSectionRef | null {
  if (!state.currentSection) return null;
  return {
    title: state.currentTitle,
    id: state.currentSection.id,
    label: state.currentSection.label || `§ ${state.currentSection.id}`,
    heading: state.currentSection.section_title || state.currentSection.title_label || '',
    part: state.currentSection.part || '',
    tier: 'federal-reg',
    jurisdiction: 'US',
  };
}

export function clipToWorkspace(
  sec: WorkspaceSectionRef,
  { para = '', quote = '', cite = '', projectId = null }: { para?: string; quote?: string; cite?: string; projectId?: string | null } = {},
): WorkspaceRecord | null {
  if (!sec || !sec.id) return null;
  let list = loadProjects();
  let targetProj = projectId ? list.find(x => x.id === projectId) : list[0];
  if (!targetProj) {
    targetProj = createProject('Research clips');
    list = loadProjects();
    targetProj = list.find(x => x.id === targetProj!.id) || list[0];
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

export function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportProjects = (list: WorkspaceRecord[], name = 'framework-projects.json'): void =>
  downloadJson(name, { format: 'framework-projects', version: 1, exported_at: nowIso(), projects: list });
