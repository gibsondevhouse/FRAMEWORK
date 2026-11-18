import { state, TreeFilterState, TreeNode } from '../state';
import { fetchTitleTree } from '../api/client';
import { emit, on } from '../core/events';
import { cleanInlineLabel, escapeHtml, icon, lsGet, lsSet, plural, skeletonHtml } from '../dom';
import { closeDrawer, flyOpen, isFly } from '../nav';
import { dom } from '../state_init';
export { plural };

export const LEAF_TYPES = new Set(['section', 'appendix']);
export const MAX_FILTER_RESULTS = 100;

export interface AgencyMetaEntry {
  code: string;
  name: string;
}

export const AGENCY_META: Record<number, Record<string, AgencyMetaEntry>> = {
  29: {
    'sub-A': { code: 'DOL', name: 'Office of the Secretary of Labor' },
    'ch-I': { code: 'NLRB', name: 'National Labor Relations Board' },
    'ch-II': { code: 'OLMS', name: 'Federal Transit Employee Protections' },
    'ch-III': { code: 'NRAB', name: 'National Railroad Adjustment Board' },
    'ch-IV': { code: 'OLMS', name: 'Labor-Management Standards (LMRDA)' },
    'ch-V': { code: 'WHD', name: 'Wage and Hour Division (FLSA, FMLA)' },
    'ch-IX': { code: 'CICBC', name: 'Construction Industry Collective Bargaining' },
    'ch-X': { code: 'NMB', name: 'National Mediation Board' },
    'ch-XII': { code: 'FMCS', name: 'Federal Mediation and Conciliation Service' },
    'ch-XIV': { code: 'EEOC', name: 'Equal Employment Opportunity Commission' },
    'ch-XVII': { code: 'OSHA', name: 'Occupational Safety and Health Admin' },
    'ch-XX': { code: 'OSHRC', name: 'Occupational Safety and Health Review' },
    'ch-XXV': { code: 'EBSA', name: 'Employee Benefits Security (ERISA)' },
    'ch-XXVII': { code: 'FMSHRC', name: 'Federal Mine Safety & Health Review' },
    'ch-XL': { code: 'PBGC', name: 'Pension Benefit Guaranty Corporation' },
  },
  40: {
    'ch-I': { code: 'EPA', name: 'Environmental Protection Agency' },
    'ch-IV': { code: 'DOJ', name: 'EPA and Department of Justice' },
    'ch-V': { code: 'CEQ', name: 'Council on Environmental Quality' },
    'ch-VI': { code: 'CSB', name: 'Chemical Safety and Hazard Investigation Board' },
    'ch-VII': { code: 'DOD', name: 'EPA and Defense: Vessel Discharge Standards' },
    'ch-VIII': { code: 'GCERC', name: 'Gulf Coast Ecosystem Restoration Council' },
    'ch-IX': { code: 'FPISC', name: 'Federal Permitting Improvement Steering Council' },
  },
  49: {
    'sub-A': { code: 'DOT', name: 'Office of the Secretary of Transportation' },
    'ch-I': { code: 'PHMSA', name: 'Pipeline and Hazardous Materials Safety Admin' },
    'ch-II': { code: 'FRA', name: 'Federal Railroad Administration' },
    'ch-III': { code: 'FMCSA', name: 'Federal Motor Carrier Safety Administration' },
    'ch-IV': { code: 'USCG', name: 'Coast Guard' },
    'ch-V': { code: 'NHTSA', name: 'National Highway Traffic Safety Admin' },
    'ch-VI': { code: 'FTA', name: 'Federal Transit Administration' },
    'ch-VII': { code: 'Amtrak', name: 'National Railroad Passenger Corporation' },
    'ch-VIII': { code: 'NTSB', name: 'National Transportation Safety Board' },
    'ch-X': { code: 'STB', name: 'Surface Transportation Board' },
    'ch-XII': { code: 'TSA', name: 'Transportation Security Administration' },
  },
};

export function agencyMeta(node: TreeNode | null | undefined): AgencyMetaEntry | null {
  return (AGENCY_META[state.currentTitle] || {})[agencyKeyForNode(node)] || null;
}

export interface TreeIndex {
  nodes: TreeNode[];
  parent: number[];
  sections: Map<string, number>;
  parts: Map<string, number>;
  agencies: Map<string, number>;
  partList: number[];
  agencyList: number[];
}

export const treeIdx: TreeIndex = {
  nodes: [],
  parent: [],
  sections: new Map(),
  parts: new Map(),
  agencies: new Map(),
  partList: [],
  agencyList: [],
};

state.visited = loadVisited();
state.treePromise = null;
state.currentTreeKey = null;
state.currentPartKey = null;
state.currentAgencyKey = null;
state.rootViewMode = lsGet('rootViewMode') === 'all-parts' ? 'all-parts' : 'agencies';
state.sideView = state.rootViewMode;
state.treeFilterState = null;

export function visitedKey(): string {
  return state.currentTitle === 29 ? 'visited' : 'visited-' + state.currentTitle;
}

export function loadVisited(): Set<string> {
  try { return new Set(JSON.parse(lsGet(visitedKey()) || '[]') as string[]); } catch { return new Set(); }
}

export async function switchTitle(newTitle: number): Promise<void> {
  if (newTitle === state.currentTitle && state.treeData) return;
  state.currentTitle = newTitle;
  const titleMeta = state.installedTitles.find(t => t.title === newTitle);
  if (titleMeta) {
    state.metaInfo = titleMeta;
    dom.edition.textContent = `eCFR ${titleMeta.edition || ''}`;
  }
  dom.chatText.placeholder = `Ask about this section, or anything in Title ${newTitle}…`;
  emit('title:switched', { title: newTitle });
  state.treePromise = null;
  state.treeData = null;
  treeIdx.nodes = [];
  treeIdx.parent = [];
  treeIdx.sections = new Map();
  treeIdx.parts = new Map();
  treeIdx.agencies = new Map();
  treeIdx.partList = [];
  treeIdx.agencyList = [];
  state.currentTreeKey = null;
  state.currentPartKey = null;
  state.currentAgencyKey = null;
  clearFilterQuietly();
  state.visited = loadVisited();
  state.sideView = state.rootViewMode;
  dom.tree.innerHTML = skeletonHtml('tree', 'Loading contents…');
  await ensureTreeLoaded();
}

export function ensureTreeLoaded(): Promise<void> {
  if (!state.treePromise) {
    state.treePromise = fetchTitleTree(state.currentTitle)
      .then(data => {
        state.treeData = data;
        indexTree(data);
        renderSidebar();
      })
      .catch(err => {
        state.treePromise = null;
        const msg = err instanceof Error ? err.message : 'Load failed';
        dom.tree.innerHTML = `<div class="side-empty">Couldn't load the contents (${escapeHtml(msg)}).</div>`;
        throw err;
      });
  }
  return state.treePromise;
}

export function normalizeForMatch(s: unknown): string {
  return ' ' + String(s ?? '').toLowerCase().replace(/[§,;:()[\]"'\/–—]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

export function formatRange(range?: string | null): string {
  return String(range || '').trim().replace(/\s*[–-]\s*/g, '–');
}

export function isAgencyNode(node: TreeNode | null | undefined): boolean {
  return Boolean(node && (node.t === 'chapter' || (node.t === 'subtitle' && String(node.id) === 'A')));
}

export function agencyKeyForNode(node: TreeNode | null | undefined): string {
  if (!node) return '';
  if (node.t === 'subtitle') return 'sub-' + String(node.id || '').trim();
  if (node.t === 'chapter') return 'ch-' + String(node.id || '').trim();
  return '';
}

export function agencyInfo(node: TreeNode | null | undefined): { code: string; name: string; range: string } {
  if (!node) return { code: 'CFR', name: '', range: '' };
  const meta = agencyMeta(node);
  const roman = /^[IVXLC]+$/.test(String(node.id)) ? node.id : '';
  const code = meta?.code || (node.t === 'subtitle' ? `Sub. ${node.id}` : (roman ? `Ch. ${roman}` : 'Ch.'));
  const name = meta?.name || (node.d || node.l || '').trim().replace(/^Chapter\s+[IVXLC]+\s*[—–-]\s*/i, '').replace(/,\s*Department of [A-Z][A-Za-z ]+$/, '');
  return { code, name, range: formatRange(node.range) };
}

export function agencyOf(k: number): number | null {
  for (let p = k; p >= 0; p = treeIdx.parent[p]) {
    if (isAgencyNode(treeIdx.nodes[p])) return p;
  }
  return null;
}

export function partForSection(sectionId: string): string | null {
  for (let p = treeIdx.sections.get(String(sectionId)); p != null && p >= 0; p = treeIdx.parent[p]) {
    if (treeIdx.nodes[p]?.t === 'part') return treeIdx.nodes[p].id || null;
  }
  return null;
}

export function indexTree(root: TreeNode): void {
  const walk = (node: TreeNode, parentKey: number) => {
    const k = treeIdx.nodes.length;
    node.k = k;
    node.l = cleanInlineLabel(node.l);
    node.d = cleanInlineLabel(node.d);
    treeIdx.nodes.push(node);
    treeIdx.parent.push(parentKey);
    const label = node.l;
    const desc = node.d;
    let hayText = desc && desc !== label ? `${label} ${desc}` : label || desc;
    node.partCount = 0;

    if (isAgencyNode(node)) {
      treeIdx.agencies.set(agencyKeyForNode(node), k);
      treeIdx.agencyList.push(k);
      const meta = agencyMeta(node);
      if (meta) hayText += ` ${meta.code} ${meta.name}`;
    }
    node.hay = normalizeForMatch(hayText);

    if (node.t && LEAF_TYPES.has(node.t)) {
      treeIdx.sections.set(String(node.id), k);
      node.n = node.r ? 0 : 1;
      return;
    }
    if (node.t === 'part') {
      treeIdx.parts.set(String(node.id), k);
      if (!node.r) treeIdx.partList.push(k);
    }
    node.n = 0;
    for (const child of node.c || []) {
      walk(child, k);
      node.n += child.n || 0;
      if (child.t === 'part' && !child.r) node.partCount += 1;
      else if (child.partCount) node.partCount += child.partCount;
    }
  };
  walk(root, -1);
}

export function isWithin(k: number, ancestorK: number): boolean {
  for (let p = k; p >= 0; p = treeIdx.parent[p]) if (p === ancestorK) return true;
  return false;
}

export function partOf(k: number): number | null {
  for (let p = k; p >= 0; p = treeIdx.parent[p]) {
    if (treeIdx.nodes[p]?.t === 'part') return p;
  }
  return null;
}

export function rowParts(node: TreeNode): [string, string] {
  const l = (node.l || '').trim();
  let d = (node.d || '').trim();
  if (l && d.startsWith(l) && d.length > l.length) d = d.slice(l.length).trim();
  if (node.t === 'appendix') {
    const m = /^Appendix\s+(?!to\b)(\S+)/i.exec(l);
    return [m ? `App. ${m[1]}` : 'App.', d || l];
  }
  return [String(node.id || ''), d];
}

export function tooltipFor(node: TreeNode): string {
  const l = (node.l || '').trim();
  const d = (node.d || '').trim();
  return d && d !== l ? `${l} — ${d}` : (l || d);
}

export function hl(str: unknown): string {
  const text = String(str ?? '');
  const re = state.treeFilterState && state.treeFilterState.re;
  if (!re) return escapeHtml(text);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    const start = idx + m[1].length;
    out += escapeHtml(text.slice(last, start)) + '<mark>' + escapeHtml(m[2]) + '</mark>';
    last = start + m[2].length;
  }
  return out + escapeHtml(text.slice(last));
}

export function itemHtml(node: TreeNode): string {
  const leaf = Boolean(node.t && LEAF_TYPES.has(node.t));
  const [num, text] = rowParts(node);
  const href = `#/${leaf ? 'section' : 'part'}/${encodeURIComponent(String(node.id || ''))}`;
  const isPage = node.k === state.currentTreeKey;
  const isAncestor = !isPage && !leaf && node.k === state.currentPartKey;
  const cls = ['side-item', leaf ? 'is-section' : 'is-part'];
  if (isPage) cls.push('current');
  if (isAncestor) cls.push('ancestor-current');
  if (leaf && state.visited.has(String(node.id))) cls.push('visited');
  return `<a class="${cls.join(' ')}" href="${href}" data-k="${node.k}" title="${escapeHtml(tooltipFor(node))}"${isPage ? ' aria-current="page"' : ''}>`
    + `<span class="side-num">${hl(num)}</span><span class="side-text">${hl(text)}</span></a>`;
}

export function agencyRowHtml(node: TreeNode): string {
  const info = agencyInfo(node);
  const isAncestor = node.k === state.currentAgencyKey;
  const meta = [info.range && `Parts ${info.range}`, plural(node.partCount || 0, 'part')].filter(Boolean).join(' · ');
  return `<button type="button" class="side-agency${isAncestor ? ' ancestor-current' : ''}" data-action="agency" data-k="${node.k}"`
    + ` title="${escapeHtml(tooltipFor(node))}">`
    + `<span class="side-agency-code">${hl(info.code)}</span>`
    + `<span class="side-agency-body"><span class="side-agency-name">${hl(info.name)}</span>`
    + `<span class="side-agency-meta">${escapeHtml(meta)}</span></span></button>`;
}

export function agencyLabelHtml(agencyNode: TreeNode): string {
  const info = agencyInfo(agencyNode);
  return `<div class="side-label"><span class="side-label-code">${escapeHtml(info.code)}</span> ${escapeHtml(info.name)}</div>`;
}

export function groupedHtml(keys: number[]): string {
  let html = '';
  let lastAgency: number | null = -2;
  for (const k of keys) {
    const node = treeIdx.nodes[k];
    if (isAgencyNode(node)) {
      html += agencyRowHtml(node);
      lastAgency = k;
      continue;
    }
    const agency = agencyOf(k);
    if (agency !== lastAgency) {
      if (agency != null) html += agencyLabelHtml(treeIdx.nodes[agency]);
      lastAgency = agency;
    }
    html += itemHtml(node);
  }
  return `<div class="side-list">${html}</div>`;
}

export function crumbsHtml(crumbs: Array<{ label: string; action?: string; k?: number }>): string {
  const parts = crumbs.map((c, i) => {
    if (i === crumbs.length - 1) return `<span class="side-crumb-current" aria-current="location">${escapeHtml(c.label)}</span>`;
    const kAttr = c.k != null ? ` data-k="${c.k}"` : '';
    return `<button type="button" class="side-crumb" data-action="${c.action}"${kAttr}>${escapeHtml(c.label)}</button>`;
  });
  return `<nav class="side-breadcrumbs" aria-label="Sidebar location">${parts.join('<span class="side-sep" aria-hidden="true">›</span>')}</nav>`;
}

export function agenciesListHtml(): string {
  return `<div class="side-list side-agencies-list">${treeIdx.agencyList.map(k => agencyRowHtml(treeIdx.nodes[k])).join('')}</div>`;
}

export function agencyViewHtml(agency: TreeNode): string {
  const info = agencyInfo(agency);
  let body = '';
  for (const c of agency.c || []) {
    if (c.r) continue;
    if (c.t === 'part') {
      body += itemHtml(c);
    } else if (c.t === 'subchapter') {
      const parts = (c.c || []).filter(ch => ch.t === 'part' && !ch.r);
      if (!parts.length) continue;
      const l = (c.l || '').trim();
      const d = (c.d || '').trim();
      body += `<div class="side-label">${escapeHtml(d ? `${l} — ${d}` : l)}</div>`;
      body += parts.map(itemHtml).join('');
    }
  }
  const meta = [info.range && `Parts ${info.range}`, plural(agency.partCount || 0, 'part')].filter(Boolean).join(' · ');
  return `<div class="side-head">`
    + crumbsHtml([{ label: 'Agencies', action: 'agencies' }, { label: info.code }])
    + `<div class="side-heading" title="${escapeHtml(tooltipFor(agency))}"><div class="side-heading-title">${escapeHtml(info.name)}</div>`
    + `<div class="side-heading-meta">${escapeHtml(meta)}</div></div>`
    + `</div><div class="side-list">${body}</div>`;
}

export function partsListHtml(): string {
  return groupedHtml(treeIdx.partList);
}

state.foldedGroups = (() => {
  try { return new Set(JSON.parse(lsGet('sideFolded') || '[]') as string[]); } catch { return new Set(); }
})();

export function groupKey(part: TreeNode, sub: TreeNode): string { return `${state.currentTitle}|${part.id}|${sub.id}`; }

export function saveFolded(): void {
  if (state.foldedGroups) lsSet('sideFolded', JSON.stringify([...state.foldedGroups]));
}

export function setGroupOpen(group: HTMLElement, open: boolean, save = true): void {
  group.classList.toggle('is-folded', !open);
  group.querySelector('.side-group-toggle')?.setAttribute('aria-expanded', String(open));
  if (group.dataset.group && state.foldedGroups) {
    if (open) state.foldedGroups.delete(group.dataset.group);
    else state.foldedGroups.add(group.dataset.group);
    if (save) saveFolded();
  }
}

export function partViewHtml(part: TreeNode): string {
  const walk = (node: TreeNode): string => {
    let out = '';
    for (const c of node.c || []) {
      if (c.r) continue;
      if (c.t && LEAF_TYPES.has(c.t)) {
        out += itemHtml(c);
      } else if (c.n) {
        const l = (c.l || '').trim();
        const d = (c.d || '').trim();
        if (c.t === 'subpart') {
          const key = groupKey(part, c);
          const folded = Boolean(state.foldedGroups?.has(key) && !(state.currentTreeKey != null && c.k != null && isWithin(state.currentTreeKey, c.k)));
          out += `<div class="side-group${folded ? ' is-folded' : ''}" data-group="${escapeHtml(key)}">`
            + `<button type="button" class="side-label side-group-toggle" data-action="toggle-group" aria-expanded="${!folded}">`
            + `<span class="side-group-name">${escapeHtml(d ? `${l} — ${d}` : l)}</span>${icon('chevronDown', 'side-group-caret')}</button>`
            + `<div class="side-group-body"><div class="side-group-inner">${walk(c)}</div></div></div>`;
        } else {
          out += `<div class="side-label minor">${escapeHtml(d || l)}</div>` + walk(c);
        }
      }
    }
    return out;
  };
  const body = walk(part);
  const agencyKey = part.k != null ? agencyOf(part.k) : null;
  const crumbs: Array<{ label: string; action?: string; k?: number }> = state.rootViewMode === 'agencies' && agencyKey != null
    ? [{ label: 'Agencies', action: 'agencies' }, { label: agencyInfo(treeIdx.nodes[agencyKey]).code, action: 'agency', k: agencyKey }]
    : [{ label: 'All parts', action: 'parts' }];
  crumbs.push({ label: `Part ${part.id}` });

  return `<div class="side-head">`
    + crumbsHtml(crumbs)
    + `<a class="side-part-title${part.k === state.currentTreeKey ? ' current' : ''}" href="#/part/${encodeURIComponent(String(part.id || ''))}"${part.k === state.currentTreeKey ? ' aria-current="page"' : ''}>${escapeHtml((part.d || '').trim())}</a>`
    + `</div><div class="side-list">${body}</div>`;
}

export function filterResultsHtml(): string {
  const f = state.treeFilterState;
  if (!f) return '';
  const q = f.q.trim();
  const fullText = `<a class="side-fulltext" href="#/search?q=${encodeURIComponent(q)}">Search the full text for “${escapeHtml(q)}”</a>`;
  if (!f.results.length) return `<div class="side-empty">Nothing matches.</div>${fullText}`;
  return groupedHtml(f.results) + fullText;
}

export function updateNavTabsUI(): void {
  const tabs = document.getElementById('side-nav-tabs');
  if (!tabs) return;
  tabs.hidden = Boolean(state.treeFilterState);
  const isAllParts = state.rootViewMode === 'all-parts';
  const tabAgencies = document.getElementById('tab-agencies');
  const tabParts = document.getElementById('tab-parts');
  if (tabAgencies && tabParts) {
    tabAgencies.classList.toggle('active', !isAllParts);
    tabAgencies.setAttribute('aria-selected', String(!isAllParts));
    tabParts.classList.toggle('active', isAllParts);
    tabParts.setAttribute('aria-selected', String(isAllParts));
    tabParts.textContent = `All ${treeIdx.partList.length} parts`;
  }
}

export function renderSidebar(): void {
  if (!state.treeData) return;
  updateNavTabsUI();
  if (state.treeFilterState) dom.tree.innerHTML = filterResultsHtml();
  else if (state.sideView === 'agencies') dom.tree.innerHTML = agenciesListHtml();
  else if (state.sideView === 'all-parts') dom.tree.innerHTML = partsListHtml();
  else if (typeof state.sideView === 'number') {
    const node = treeIdx.nodes[state.sideView];
    dom.tree.innerHTML = isAgencyNode(node) ? agencyViewHtml(node) : partViewHtml(node);
  }
  dom.tree.scrollTop = 0;
}

export function clearFilterQuietly(): void {
  if (!state.treeFilterState && !dom.treeFilter.value) return;
  if (state.filterTimer) clearTimeout(state.filterTimer);
  dom.treeFilter.value = '';
  state.treeFilterState = null;
}

export function showAgenciesList(): void {
  state.rootViewMode = 'agencies';
  lsSet('rootViewMode', 'agencies');
  state.sideView = 'agencies';
  renderSidebar();
  revealCurrent(false);
}

export function showAgencyView(k: number): void {
  state.rootViewMode = 'agencies';
  lsSet('rootViewMode', 'agencies');
  state.sideView = k;
  renderSidebar();
  revealCurrent(false);
}

export function showPartsList(): void {
  state.rootViewMode = 'all-parts';
  lsSet('rootViewMode', 'all-parts');
  state.sideView = 'all-parts';
  renderSidebar();
  revealCurrent(false);
}

export function selectTreeNode(elementId: string): void {
  if (!state.treeData) return;
  const m = /^([sp])-(.+)$/.exec(elementId);
  if (!m) return;
  const k = (m[1] === 's' ? treeIdx.sections : treeIdx.parts).get(m[2]);
  if (k === undefined) return;
  state.currentTreeKey = k;
  state.currentPartKey = partOf(k);
  state.currentAgencyKey = agencyOf(k);
  if (m[1] === 's') markVisited(m[2]);

  const switchPart = state.currentPartKey != null && state.sideView !== state.currentPartKey;
  if (switchPart && state.currentPartKey != null) state.sideView = state.currentPartKey;
  if (state.treeFilterState) {
    refreshCurrent();
    return;
  }
  if (switchPart) {
    const hadFocus = dom.tree.contains(document.activeElement);
    renderSidebar();
    revealCurrent(false);
    if (hadFocus) (dom.tree.querySelector<HTMLElement>('.side-item.current') || dom.tree.querySelector<HTMLElement>('.side-part-title'))?.focus({ preventScroll: true });
  } else {
    refreshCurrent();
    revealCurrent(true);
  }
}

export function refreshCurrent(): void {
  dom.tree.querySelectorAll('.current, .ancestor-current').forEach(el => {
    el.classList.remove('current', 'ancestor-current');
    el.removeAttribute('aria-current');
  });
  if (state.currentTreeKey == null) return;
  const markPage = (el: Element | null) => { if (el) { el.classList.add('current'); el.setAttribute('aria-current', 'page'); } };
  const markAncestor = (el: Element | null) => { if (el && !el.classList.contains('current')) el.classList.add('ancestor-current'); };

  const page = dom.tree.querySelector(`.side-item[data-k="${state.currentTreeKey}"]`);
  markPage(page);
  const folded = page?.closest<HTMLElement>('.side-group.is-folded');
  if (folded) setGroupOpen(folded, true);
  if (state.currentTreeKey === state.currentPartKey) {
    if (state.sideView === state.currentPartKey) markPage(dom.tree.querySelector('.side-part-title'));
  } else {
    markAncestor(dom.tree.querySelector(`.side-item.is-part[data-k="${state.currentPartKey}"]`));
  }
  markAncestor(dom.tree.querySelector(`.side-agency[data-k="${state.currentAgencyKey}"]`));
}

export function clearTreeSelection(): void {
  if (state.currentTreeKey == null) return;
  state.currentTreeKey = null;
  state.currentPartKey = null;
  state.currentAgencyKey = null;
  refreshCurrent();
}

export function revealCurrent(smooth = false): void {
  const el = dom.tree.querySelector('.side-item.current')
    || dom.tree.querySelector('.side-item.ancestor-current, .side-agency.ancestor-current');
  if (el) scrollIntoTree(el, smooth);
}

export function scrollIntoTree(el: Element, smooth: boolean): void {
  const box = dom.tree.getBoundingClientRect();
  if (!box.height) return;
  const head = dom.tree.querySelector<HTMLElement>('.side-head');
  const top = box.top + (head && !head.contains(el) ? head.offsetHeight : 0);
  const r = el.getBoundingClientRect();
  if (r.top < top + 4 || r.bottom > box.bottom - 4) {
    dom.tree.scrollTo({ top: dom.tree.scrollTop + r.top - box.top - box.height / 3, behavior: smooth ? 'smooth' : 'auto' });
  }
}

export function markVisited(id: string): void {
  if (state.visited.has(id)) return;
  state.visited.add(id);
  lsSet(visitedKey(), JSON.stringify([...state.visited]));
  dom.tree.querySelector(`.side-item.is-section[data-k="${treeIdx.sections.get(id)}"]`)?.classList.add('visited');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function computeFilter(q: string): TreeFilterState | null {
  const cleaned = q.trim().replace(/^\d{1,2}\s*c\.?\s*f\.?\s*r\.?\s*/i, '');
  const tokens = [...new Set(normalizeForMatch(cleaned).trim().split(' ').filter(Boolean))].slice(0, 12);
  if (!tokens.length) return null;

  const ALL = (1 << tokens.length) - 1;
  const total = treeIdx.nodes.length;
  const own = new Int32Array(total);
  const anc = new Int32Array(total);
  const ancFull = new Uint8Array(total);
  const results: number[] = [];
  for (const node of treeIdx.nodes) {
    const k = node.k ?? 0;
    const p = treeIdx.parent[k];
    let m = 0;
    const hay = node.hay || '';
    for (let i = 0; i < tokens.length; i++) if (hay.includes(' ' + tokens[i])) m |= 1 << i;
    own[k] = m;
    if (p >= 0) {
      anc[k] = anc[p] | own[p];
      ancFull[k] = ancFull[p] || own[p] === ALL ? 1 : 0;
    }
    if (node.r || !(node.t === 'part' || (node.t && LEAF_TYPES.has(node.t)) || isAgencyNode(node))) continue;
    if (m === ALL || (m !== 0 && (m | anc[k]) === ALL && !ancFull[k])) {
      results.push(k);
      if (results.length >= MAX_FILTER_RESULTS) break;
    }
  }
  const alt = tokens.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(^|[\\s§,;:()\\[\\]"'/\\u2013\\u2014])(${alt})`, 'gi');
  return { q, re, results };
}

export function applyTreeFilter(): void {
  if (!state.treeData) return;
  state.treeFilterState = computeFilter(dom.treeFilter.value);
  renderSidebar();
  if (!state.treeFilterState) revealCurrent(false);
}

state.filterTimer = null;

dom.treeFilter?.addEventListener('input', () => {
  if (state.filterTimer) clearTimeout(state.filterTimer);
  state.filterTimer = setTimeout(applyTreeFilter, 120);
});

dom.treeFilter?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (dom.treeFilter.value) {
      dom.treeFilter.value = '';
      applyTreeFilter();
    } else {
      dom.treeFilter.blur();
    }
  } else if (e.key === 'ArrowDown') {
    const first = dom.tree.querySelector<HTMLElement>('a, button');
    if (first) { e.preventDefault(); first.focus(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (state.filterTimer) clearTimeout(state.filterTimer);
    applyTreeFilter();
    const q = dom.treeFilter.value.trim();
    const first = dom.tree.querySelector<HTMLElement>('.side-item, .side-agency');
    if (first) {
      if (first.tagName === 'A') {
        const href = first.getAttribute('href');
        if (href) window.location.hash = href;
      } else {
        first.click();
      }
    } else if (q) {
      window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }
  }
});

dom.tree?.addEventListener('click', (e) => {
  const t = e.target as Element | null;
  const toggle = t?.closest('[data-action="toggle-group"]');
  if (toggle) {
    const group = toggle.closest<HTMLElement>('.side-group');
    if (!group) return;
    const open = group.classList.contains('is-folded');
    if (e.altKey) {
      dom.tree.querySelectorAll<HTMLElement>('.side-group').forEach(g => setGroupOpen(g, open, false));
      saveFolded();
    } else {
      setGroupOpen(group, open);
    }
    return;
  }
  const action = t?.closest<HTMLElement>('[data-action]');
  if (action) {
    const kind = action.dataset.action;
    const k = parseInt(action.dataset.k || '', 10);
    clearFilterQuietly();
    if (kind === 'agencies') showAgenciesList();
    else if (kind === 'parts') showPartsList();
    else if (kind === 'agency' && !Number.isNaN(k)) showAgencyView(k);
    else return;
    if (e.detail === 0) (dom.tree.querySelector<HTMLElement>('.current, .ancestor-current') || dom.tree.querySelector<HTMLElement>('a, button'))?.focus({ preventScroll: true });
    return;
  }
  const link = t?.closest('a');
  if (link && link.getAttribute('href') === window.location.hash && isFly() && flyOpen()) closeDrawer();
});

export const sideNavTabs = typeof document !== 'undefined' ? document.getElementById('side-nav-tabs') : null;

if (sideNavTabs) {
  sideNavTabs.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('.side-nav-tab');
    if (!btn) return;
    if (btn.dataset.mode === 'agencies') showAgenciesList();
    else showPartsList();
  });
}

dom.tree?.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...dom.tree.querySelectorAll<HTMLElement>('a, button')].filter(el => !el.closest('.side-group.is-folded .side-group-body'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (next) {
    next.focus({ preventScroll: true });
    scrollIntoTree(next, false);
  } else if (e.key === 'ArrowUp') {
    dom.treeFilter.focus();
  }
});

on('nav:panel-opened', ({ panel }) => {
  if (panel === 'reader') requestAnimationFrame(() => revealCurrent(false));
});
