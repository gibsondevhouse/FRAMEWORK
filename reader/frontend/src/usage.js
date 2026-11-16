import { state } from './state';
import { lsGet, lsSet } from './dom';
import { findPartInTree } from './views/reader_part';

// --- Usage: what this reader has opened, kept in this browser only ---
// localStorage `usage` = { v, since, s: { "29|1910.1200": {n, t, l, h, p, u?, ul?} }, p: { "29|1910": {n, t, h} } }
// A section visit counts toward its part too; opening a part page counts toward the part only.
// Title totals are the sum of their parts. The older per-title `visited` sets (which
// predate this) still drive "sections read", so that number has history from day one.
export const USAGE_KEY = 'usage';


export function loadUsage() {
  try {
    const u = JSON.parse(lsGet(USAGE_KEY) || 'null');
    if (u && u.v === 1 && u.s && u.p) return u;
  } catch (e) { /* corrupt or unavailable: start over */ }
  return { v: 1, since: Date.now(), s: {}, p: {} };
}


export function bumpPart(u, title, part, heading, now) {
  if (!part) return;
  const key = title + '|' + part;
  const e = u.p[key] || (u.p[key] = { n: 0 });
  e.n += 1;
  e.t = now;
  if (heading) e.h = String(heading).trim();
}


export function recordSectionVisit(data, unitInfo = null) {
  if (!data || !data.id) return;
  const u = loadUsage();
  const now = Date.now();
  const key = state.currentTitle + '|' + data.id;
  const e = u.s[key] || (u.s[key] = { n: 0 });
  e.n += 1;
  e.t = now;
  e.l = data.label || data.id;
  e.h = data.section_title || data.title_label || '';
  e.p = data.part || '';
  if (unitInfo && unitInfo.key) { e.u = unitInfo.key; e.ul = unitInfo.label || unitInfo.key; }
  else { delete e.u; delete e.ul; }
  const partNode = data.part && state.treeData ? findPartInTree(state.treeData, data.part) : null;
  bumpPart(u, state.currentTitle, data.part, partNode && partNode.d, now);
  lsSet(USAGE_KEY, JSON.stringify(u));
}


export function recordSectionUnit(sectionId, unitInfo = null) {
  if (!sectionId) return;
  const u = loadUsage();
  const key = state.currentTitle + '|' + sectionId;
  const e = u.s[key];
  if (!e) return;
  e.t = Date.now();
  if (unitInfo && unitInfo.key) { e.u = unitInfo.key; e.ul = unitInfo.label || unitInfo.key; }
  else { delete e.u; delete e.ul; }
  lsSet(USAGE_KEY, JSON.stringify(u));
}


export function recordPartVisit(partId, heading) {
  const u = loadUsage();
  bumpPart(u, state.currentTitle, partId, heading, Date.now());
  lsSet(USAGE_KEY, JSON.stringify(u));
}


export function visitedCountFor(title) {
  try {
    const raw = lsGet(title === 29 ? 'visited' : 'visited-' + title);
    return raw ? JSON.parse(raw).length : 0;
  } catch (e) { return 0; }
}


export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}


export const fmt = (n) => Number(n || 0).toLocaleString();

export const titleHref = (t, rest) => `#/title/${t}/${rest || ''}`;
