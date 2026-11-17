import { state } from '../state';
import { fillTitleSelect } from '../components/title_switcher';
import { escapeHtml, icon, lsGet, lsSet, skeletonHtml } from '../dom';
import { applyNav, closeDrawer, flyOpen, isFly, updateRailHome } from '../nav';
import { dom } from '../state_init';

// --- Sidebar: drill-down contents ---
//
// Three levels, one at a time:
// 1. Agencies (Subtitle A plus the chapters of Subtitle B), or every part via the "All parts" tab
// 2. One agency's parts (subchapters as plain labels)
// 3. One part's sections (subparts as plain labels)
// The sticky header is a clickable breadcrumb plus one title; the tabs only show at the top level.
// Every tree.json node gets a preorder key `k`; `treeIdx` holds parent links and id -> key maps.

export const LEAF_TYPES = new Set(['section', 'appendix']);

export const MAX_FILTER_RESULTS = 100;


// Short, plain names for the agencies behind each chapter. Codes are searchable in the filter.
// Keyed by title first: chapter numbers repeat across titles (Chapter I is the NLRB in
// Title 29 but the EPA in Title 40). Titles or chapters without an entry fall back to
// "Ch. N" plus the chapter's own heading.
export const AGENCY_META = {
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


export function agencyMeta(node) {
  return (AGENCY_META[state.currentTitle] || {})[agencyKeyForNode(node)] || null;
}


export const treeIdx = {
  nodes: [],
  parent: [],
  sections: new Map(),
  parts: new Map(),
  agencies: new Map(),
  partList: [],
  agencyList: []
};

state.visited = loadVisited();

state.treePromise = null;

state.currentTreeKey = null;
   // the section or part on screen
state.currentPartKey = null;
   // the part that contains it
state.currentAgencyKey = null;
 // the agency/chapter that contains it
state.rootViewMode = lsGet('rootViewMode') === 'all-parts' ? 'all-parts' : 'agencies';

state.sideView = state.rootViewMode;
 // 'agencies', 'all-parts', or the key k of an agency or part
state.treeFilterState = null;
  // { q, re, results } while the filter has text

// Visited sections are tracked per title (section numbers repeat across titles).
export function visitedKey() {
  return state.currentTitle === 29 ? 'visited' : 'visited-' + state.currentTitle;
}


export function loadVisited() {
  try { return new Set(JSON.parse(lsGet(visitedKey()) || '[]')); } catch (e) { return new Set(); }
}


export async function switchTitle(newTitle) {
  if (newTitle === state.currentTitle && state.treeData) return;
  state.currentTitle = newTitle;
  fillTitleSelect();
  const titleMeta = state.installedTitles.find(t => t.title === newTitle);
  if (titleMeta) {
    state.metaInfo = titleMeta;
    dom.edition.textContent = `eCFR ${titleMeta.edition || ''}`;
  }
  dom.search.placeholder = `Search Title ${newTitle} or jump to a section…`;
  dom.chatText.placeholder = `Ask about this section, or anything in Title ${newTitle}…`;
  updateRailHome();
  applyNav();
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


export function ensureTreeLoaded() {
  if (!state.treePromise) {
    state.treePromise = fetch('/api/' + state.currentTitle + '/tree')
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(data => {
        state.treeData = data;
        indexTree(data);
        renderSidebar();
      })
      .catch(err => {
        state.treePromise = null;
        dom.tree.innerHTML = `<div class="side-empty">Couldn't load the contents (${escapeHtml(err.message)}).</div>`;
        throw err;
      });
  }
  return state.treePromise;
}


export function normalizeForMatch(s) {
  return ' ' + String(s).toLowerCase().replace(/[§,;:()[\]"'\/–—]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}


export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}


export function formatRange(range) {
  return String(range || '').trim().replace(/\s*[–-]\s*/g, '–');
}


export function isAgencyNode(node) {
  return !!node && (node.t === 'chapter' || (node.t === 'subtitle' && String(node.id) === 'A'));
}


export function agencyKeyForNode(node) {
  if (!node) return '';
  if (node.t === 'subtitle') return 'sub-' + String(node.id || '').trim();
  if (node.t === 'chapter') return 'ch-' + String(node.id || '').trim();
  return '';
}


export function agencyInfo(node) {
  if (!node) return { code: 'CFR', name: '', range: '' };
  const meta = agencyMeta(node) || {};
  const roman = /^[IVXLC]+$/.test(String(node.id)) ? node.id : '';
  const code = meta.code || (node.t === 'subtitle' ? `Sub. ${node.id}` : (roman ? `Ch. ${roman}` : 'Ch.'));
  // Fallback headings read "Agency, Department of X" or repeat "Chapter XI—": keep the agency.
  const name = meta.name || (node.d || node.l || '').trim().replace(/^Chapter\s+[IVXLC]+\s*[—–-]\s*/i, '').replace(/,\s*Department of [A-Z][A-Za-z ]+$/, '');
  return { code, name, range: formatRange(node.range) };
}


export function agencyOf(k) {
  for (let p = k; p >= 0; p = treeIdx.parent[p]) {
    if (isAgencyNode(treeIdx.nodes[p])) return p;
  }
  return null;
}


export function indexTree(root) {
  const walk = (node, parentKey) => {
    const k = treeIdx.nodes.length;
    node.k = k;
    treeIdx.nodes.push(node);
    treeIdx.parent.push(parentKey);
    const label = (node.l || '').trim();
    const desc = (node.d || '').trim();
    let hayText = desc && desc !== label ? `${label} ${desc}` : label || desc;
    node.partCount = 0;

    if (isAgencyNode(node)) {
      treeIdx.agencies.set(agencyKeyForNode(node), k);
      treeIdx.agencyList.push(k);
      const meta = agencyMeta(node);
      if (meta) hayText += ` ${meta.code} ${meta.name}`; // so "osha" or "erisa" finds the agency
    }
    node.hay = normalizeForMatch(hayText);

    if (LEAF_TYPES.has(node.t)) {
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
      node.n += child.n;
      if (child.t === 'part' && !child.r) node.partCount += 1;
      else if (child.partCount) node.partCount += child.partCount;
    }
  };
  walk(root, -1);
}


export function isWithin(k, ancestorK) {
  for (let p = k; p >= 0; p = treeIdx.parent[p]) if (p === ancestorK) return true;
  return false;
}


export function partOf(k) {
  for (let p = k; p >= 0; p = treeIdx.parent[p]) {
    if (treeIdx.nodes[p].t === 'part') return p;
  }
  return null;
}


// --- Rendering ---

export function rowParts(node) {
  const l = (node.l || '').trim();
  let d = (node.d || '').trim();
  // Some entries repeat their own label: "§ 1910.139 [Reserved]".
  if (l && d.startsWith(l) && d.length > l.length) d = d.slice(l.length).trim();
  if (node.t === 'appendix') {
    const m = /^Appendix\s+(?!to\b)(\S+)/i.exec(l);
    return [m ? `App. ${m[1]}` : 'App.', d || l];
  }
  return [String(node.id), d];
}


export function tooltipFor(node) {
  const l = (node.l || '').trim();
  const d = (node.d || '').trim();
  return d && d !== l ? `${l} — ${d}` : (l || d);
}


export function hl(str) {
  const text = String(str ?? '');
  const re = state.treeFilterState && state.treeFilterState.re;
  if (!re) return escapeHtml(text);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[1].length;
    out += escapeHtml(text.slice(last, start)) + '<mark>' + escapeHtml(m[2]) + '</mark>';
    last = start + m[2].length;
  }
  return out + escapeHtml(text.slice(last));
}


export function itemHtml(node) {
  const leaf = LEAF_TYPES.has(node.t);
  const [num, text] = rowParts(node);
  const href = `#/${leaf ? 'section' : 'part'}/${encodeURIComponent(node.id)}`;
  // `.current` = the page on screen; `.ancestor-current` = the part that contains it.
  const isPage = node.k === state.currentTreeKey;
  const isAncestor = !isPage && !leaf && node.k === state.currentPartKey;
  const cls = ['side-item', leaf ? 'is-section' : 'is-part'];
  if (isPage) cls.push('current');
  if (isAncestor) cls.push('ancestor-current');
  if (leaf && state.visited.has(String(node.id))) cls.push('visited');
  return `<a class="${cls.join(' ')}" href="${href}" data-k="${node.k}" title="${escapeHtml(tooltipFor(node))}"${isPage ? ' aria-current="page"' : ''}>`
    + `<span class="side-num">${hl(num)}</span><span class="side-text">${hl(text)}</span></a>`;
}


export function agencyRowHtml(node) {
  const info = agencyInfo(node);
  // An agency is never the page itself, only the container of it.
  const isAncestor = node.k === state.currentAgencyKey;
  const meta = [info.range && `Parts ${info.range}`, plural(node.partCount || 0, 'part')].filter(Boolean).join(' · ');
  return `<button type="button" class="side-agency${isAncestor ? ' ancestor-current' : ''}" data-action="agency" data-k="${node.k}"`
    + ` title="${escapeHtml(tooltipFor(node))}">`
    + `<span class="side-agency-code">${hl(info.code)}</span>`
    + `<span class="side-agency-body"><span class="side-agency-name">${hl(info.name)}</span>`
    + `<span class="side-agency-meta">${escapeHtml(meta)}</span></span></button>`;
}


export function agencyLabelHtml(agencyNode) {
  const info = agencyInfo(agencyNode);
  return `<div class="side-label"><span class="side-label-code">${escapeHtml(info.code)}</span> ${escapeHtml(info.name)}</div>`;
}


// Rows in tree order, with a small agency label each time the agency changes.
// Used for the all-parts list and for filter results.
export function groupedHtml(keys) {
  let html = '';
  let lastAgency = -2;
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


export function crumbsHtml(crumbs) {
  const parts = crumbs.map((c, i) => {
    if (i === crumbs.length - 1) return `<span class="side-crumb-current" aria-current="location">${escapeHtml(c.label)}</span>`;
    const kAttr = c.k != null ? ` data-k="${c.k}"` : '';
    return `<button type="button" class="side-crumb" data-action="${c.action}"${kAttr}>${escapeHtml(c.label)}</button>`;
  });
  return `<nav class="side-breadcrumbs" aria-label="Sidebar location">${parts.join('<span class="side-sep" aria-hidden="true">›</span>')}</nav>`;
}


export function agenciesListHtml() {
  return `<div class="side-list side-agencies-list">${treeIdx.agencyList.map(k => agencyRowHtml(treeIdx.nodes[k])).join('')}</div>`;
}


export function agencyViewHtml(agency) {
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


export function partsListHtml() {
  return groupedHtml(treeIdx.partList);
}


// Subparts in the part view fold. Folded subparts are remembered per title and part in
// localStorage ('sideFolded': ["29|1910|A", …]); the subpart holding the page on screen
// always opens (see openCurrentGroup).
state.foldedGroups = (() => {
  try { return new Set(JSON.parse(lsGet('sideFolded') || '[]')); } catch (e) { return new Set(); }
})();

export function groupKey(part, sub) { return `${state.currentTitle}|${part.id}|${sub.id}`; }

export function saveFolded() { lsSet('sideFolded', JSON.stringify([...state.foldedGroups])); }


export function setGroupOpen(group, open, save = true) {
  group.classList.toggle('is-folded', !open);
  group.querySelector('.side-group-toggle')?.setAttribute('aria-expanded', String(open));
  if (group.dataset.group) {
    if (open) state.foldedGroups.delete(group.dataset.group); else state.foldedGroups.add(group.dataset.group);
    if (save) saveFolded();
  }
}


export function partViewHtml(part) {
  const walk = (node) => {
    let out = '';
    for (const c of node.c || []) {
      if (c.r) continue;
      if (LEAF_TYPES.has(c.t)) {
        out += itemHtml(c);
      } else if (c.n) {
        const l = (c.l || '').trim();
        const d = (c.d || '').trim();
        if (c.t === 'subpart') {
          const key = groupKey(part, c);
          const folded = state.foldedGroups.has(key) && !(state.currentTreeKey != null && isWithin(state.currentTreeKey, c.k));
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

  // The breadcrumb leads back the way you came: through the agency, or to the all-parts list.
  const agencyKey = agencyOf(part.k);
  const crumbs = state.rootViewMode === 'agencies' && agencyKey != null
    ? [{ label: 'Agencies', action: 'agencies' }, { label: agencyInfo(treeIdx.nodes[agencyKey]).code, action: 'agency', k: agencyKey }]
    : [{ label: 'All parts', action: 'parts' }];
  crumbs.push({ label: `Part ${part.id}` });

  return `<div class="side-head">`
    + crumbsHtml(crumbs)
    + `<a class="side-part-title${part.k === state.currentTreeKey ? ' current' : ''}" href="#/part/${encodeURIComponent(part.id)}"${part.k === state.currentTreeKey ? ' aria-current="page"' : ''}>${escapeHtml((part.d || '').trim())}</a>`
    + `</div><div class="side-list">${body}</div>`;
}


export function filterResultsHtml() {
  const f = state.treeFilterState;
  const q = f.q.trim();
  const fullText = `<a class="side-fulltext" href="#/search?q=${encodeURIComponent(q)}">Search the full text for “${escapeHtml(q)}”</a>`;
  if (!f.results.length) return `<div class="side-empty">Nothing matches.</div>${fullText}`;
  return groupedHtml(f.results) + fullText;
}


export function updateNavTabsUI() {
  const tabs = document.getElementById('side-nav-tabs');
  if (!tabs) return;
  // The switch stays at every level and shows the mode you're browsing in (inside a part
  // too); clicking either option returns to that top-level list. Filter results ignore
  // the mode, so it hides while the filter has text.
  tabs.hidden = !!state.treeFilterState;
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


export function renderSidebar() {
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


export function clearFilterQuietly() {
  if (!state.treeFilterState && !dom.treeFilter.value) return;
  clearTimeout(state.filterTimer);
  dom.treeFilter.value = '';
  state.treeFilterState = null;
}


export function showAgenciesList() {
  state.rootViewMode = 'agencies';
  lsSet('rootViewMode', 'agencies');
  state.sideView = 'agencies';
  renderSidebar();
  revealCurrent(false);
}


export function showAgencyView(k) {
  state.rootViewMode = 'agencies';
  lsSet('rootViewMode', 'agencies');
  state.sideView = k;
  renderSidebar();
  revealCurrent(false);
}


export function showPartsList() {
  state.rootViewMode = 'all-parts';
  lsSet('rootViewMode', 'all-parts');
  state.sideView = 'all-parts';
  renderSidebar();
  revealCurrent(false);
}


// --- Current item ---

export function selectTreeNode(elementId) {
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
  if (switchPart) state.sideView = state.currentPartKey; // clearing the filter will land here
  if (state.treeFilterState) {
    refreshCurrent();
    return;
  }
  if (switchPart) {
    const hadFocus = dom.tree.contains(document.activeElement);
    renderSidebar();
    revealCurrent(false);
    // Keep keyboard users inside the sidebar when the list is replaced.
    if (hadFocus) (dom.tree.querySelector('.side-item.current') || dom.tree.querySelector('.side-part-title'))?.focus({ preventScroll: true });
  } else {
    refreshCurrent();
    revealCurrent(true);
  }
}


// Only the page on screen gets `.current` and aria-current="page"; the part and agency
// containing it get `.ancestor-current`. Mirrors the classes set in itemHtml/agencyRowHtml.
export function refreshCurrent() {
  dom.tree.querySelectorAll('.current, .ancestor-current').forEach(el => {
    el.classList.remove('current', 'ancestor-current');
    el.removeAttribute('aria-current');
  });
  if (state.currentTreeKey == null) return;
  const markPage = (el) => { if (el) { el.classList.add('current'); el.setAttribute('aria-current', 'page'); } };
  const markAncestor = (el) => { if (el && !el.classList.contains('current')) el.classList.add('ancestor-current'); };

  const page = dom.tree.querySelector(`.side-item[data-k="${state.currentTreeKey}"]`);
  markPage(page);
  // Navigating into a folded subpart opens it.
  const folded = page && page.closest('.side-group.is-folded');
  if (folded) setGroupOpen(folded, true);
  if (state.currentTreeKey === state.currentPartKey) {
    if (state.sideView === state.currentPartKey) markPage(dom.tree.querySelector('.side-part-title'));
  } else {
    markAncestor(dom.tree.querySelector(`.side-item.is-part[data-k="${state.currentPartKey}"]`));
  }
  markAncestor(dom.tree.querySelector(`.side-agency[data-k="${state.currentAgencyKey}"]`));
}


// Home, search and not-found pages don't correspond to anything in the sidebar.
export function clearTreeSelection() {
  if (state.currentTreeKey == null) return;
  state.currentTreeKey = null;
  state.currentPartKey = null;
  state.currentAgencyKey = null;
  refreshCurrent();
}


export function revealCurrent(smooth = false) {
  const el = dom.tree.querySelector('.side-item.current')
    || dom.tree.querySelector('.side-item.ancestor-current, .side-agency.ancestor-current');
  if (el) scrollIntoTree(el, smooth);
}


export function scrollIntoTree(el, smooth) {
  const box = dom.tree.getBoundingClientRect();
  if (!box.height) return; // sidebar hidden
  const head = dom.tree.querySelector('.side-head');
  const top = box.top + (head && !head.contains(el) ? head.offsetHeight : 0);
  const r = el.getBoundingClientRect();
  if (r.top < top + 4 || r.bottom > box.bottom - 4) {
    dom.tree.scrollTo({ top: dom.tree.scrollTop + r.top - box.top - box.height / 3, behavior: smooth ? 'smooth' : 'auto' });
  }
}


export function markVisited(id) {
  if (state.visited.has(id)) return;
  state.visited.add(id);
  lsSet(visitedKey(), JSON.stringify([...state.visited]));
  dom.tree.querySelector(`.side-item.is-section[data-k="${treeIdx.sections.get(id)}"]`)?.classList.add('visited');
}


// --- Filter ---

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


export function computeFilter(q) {
  const cleaned = q.trim().replace(/^\d{1,2}\s*c\.?\s*f\.?\s*r\.?\s*/i, '');
  const tokens = [...new Set(normalizeForMatch(cleaned).trim().split(' ').filter(Boolean))].slice(0, 12);
  if (!tokens.length) return null;

  // Tokens match the start of a word. An agency, part or section matches if its own
  // heading has every token, or has at least one and its ancestors supply the rest
  // ("osha ladders" finds § 1910.23). Context-only matches are skipped under an
  // ancestor that matches everything itself, so "osha" lists the agency, not 3,000 rows.
  const ALL = (1 << tokens.length) - 1;
  const total = treeIdx.nodes.length;
  const own = new Int32Array(total);
  const anc = new Int32Array(total);
  const ancFull = new Uint8Array(total);
  const results = [];
  for (const node of treeIdx.nodes) {
    const k = node.k;
    const p = treeIdx.parent[k];
    let m = 0;
    for (let i = 0; i < tokens.length; i++) if (node.hay.includes(' ' + tokens[i])) m |= 1 << i;
    own[k] = m;
    if (p >= 0) {
      anc[k] = anc[p] | own[p];
      ancFull[k] = ancFull[p] || own[p] === ALL ? 1 : 0;
    }
    if (node.r || !(node.t === 'part' || LEAF_TYPES.has(node.t) || isAgencyNode(node))) continue;
    if (m === ALL || (m !== 0 && (m | anc[k]) === ALL && !ancFull[k])) {
      results.push(k);
      if (results.length >= MAX_FILTER_RESULTS) break;
    }
  }
  const alt = tokens.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(^|[\\s§,;:()\\[\\]"'/\\u2013\\u2014])(${alt})`, 'gi');
  return { q, re, results };
}


export function applyTreeFilter() {
  if (!state.treeData) return;
  state.treeFilterState = computeFilter(dom.treeFilter.value);
  renderSidebar();
  if (!state.treeFilterState) revealCurrent(false);
}


state.filterTimer = 0;

dom.treeFilter.addEventListener('input', () => {
  clearTimeout(state.filterTimer);
  state.filterTimer = setTimeout(applyTreeFilter, 120);
});


dom.treeFilter.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (dom.treeFilter.value) {
      dom.treeFilter.value = '';
      applyTreeFilter();
    } else {
      dom.treeFilter.blur();
    }
  } else if (e.key === 'ArrowDown') {
    const first = dom.tree.querySelector('a, button');
    if (first) { e.preventDefault(); first.focus(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(state.filterTimer);
    applyTreeFilter();
    const q = dom.treeFilter.value.trim();
    const first = dom.tree.querySelector('.side-item, .side-agency');
    if (first) {
      if (first.tagName === 'A') window.location.hash = first.getAttribute('href');
      else first.click();
    } else if (q) {
      window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
    }
  }
});


// --- Mouse & keyboard ---

dom.tree.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-action="toggle-group"]');
  if (toggle) {
    const group = toggle.closest('.side-group');
    const open = group.classList.contains('is-folded');
    if (e.altKey) {
      // Alt-click folds or opens every subpart in the part at once.
      dom.tree.querySelectorAll('.side-group').forEach(g => setGroupOpen(g, open, false));
      saveFolded();
    } else {
      setGroupOpen(group, open);
    }
    return;
  }
  const action = e.target.closest('[data-action]');
  if (action) {
    const kind = action.dataset.action;
    const k = parseInt(action.dataset.k, 10);
    clearFilterQuietly(); // picking an agency from filter results opens it
    if (kind === 'agencies') showAgenciesList();
    else if (kind === 'parts') showPartsList();
    else if (kind === 'agency' && !isNaN(k)) showAgencyView(k);
    else return;
    // Keyboard users lose focus when the clicked control is replaced; put it somewhere useful.
    if (e.detail === 0) (dom.tree.querySelector('.current, .ancestor-current') || dom.tree.querySelector('a, button'))?.focus({ preventScroll: true });
    return;
  }
  const link = e.target.closest('a');
  if (link && link.getAttribute('href') === window.location.hash && isFly() && flyOpen()) closeDrawer();
});


export const sideNavTabs = document.getElementById('side-nav-tabs');

if (sideNavTabs) {
  sideNavTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.side-nav-tab');
    if (!btn) return;
    if (btn.dataset.mode === 'agencies') showAgenciesList();
    else showPartsList();
  });
}


dom.tree.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  // Skip rows inside folded subparts.
  const items = [...dom.tree.querySelectorAll('a, button')].filter(el => !el.closest('.side-group.is-folded .side-group-body'));
  const i = items.indexOf(document.activeElement);
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
