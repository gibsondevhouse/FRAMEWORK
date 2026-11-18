import { state } from './state';
import { findPartInTree, lsGet, lsSet } from './dom';

// --- Usage: what this reader has opened, kept in this browser only ---
export const USAGE_KEY = 'usage';

export interface UsageSectionEntry {
  n: number;
  t?: number;
  l?: string;
  h?: string;
  p?: string;
  u?: string;
  ul?: string;
}

export interface UsagePartEntry {
  n: number;
  t?: number;
  h?: string;
}

export interface UsageStore {
  v: 1;
  since: number;
  s: Record<string, UsageSectionEntry>;
  p: Record<string, UsagePartEntry>;
}

export interface UsageUnitInfo {
  key?: string | null;
  label?: string | null;
}

export function loadUsage(): UsageStore {
  try {
    const u = JSON.parse(lsGet(USAGE_KEY) || 'null') as Partial<UsageStore> | null;
    if (u && u.v === 1 && u.s && u.p) return u as UsageStore;
  } catch { /* corrupt or unavailable: start over */ }
  return { v: 1, since: Date.now(), s: {}, p: {} };
}

export function bumpPart(u: UsageStore, title: number, part: string | null | undefined, heading: string | null | undefined, now: number): void {
  if (!part) return;
  const key = title + '|' + part;
  const e = u.p[key] || (u.p[key] = { n: 0 });
  e.n += 1;
  e.t = now;
  if (heading) e.h = String(heading).trim();
}

export function recordSectionVisit(
  data: { id?: string; label?: string; section_title?: string; title_label?: string; part?: string | null } | null | undefined,
  unitInfo: UsageUnitInfo | null = null,
): void {
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

export function recordSectionUnit(sectionId: string | null | undefined, unitInfo: UsageUnitInfo | null = null): void {
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

export function recordPartVisit(partId: string, heading?: string | null): void {
  const u = loadUsage();
  bumpPart(u, state.currentTitle, partId, heading, Date.now());
  lsSet(USAGE_KEY, JSON.stringify(u));
}

export function visitedCountFor(title: number): number {
  try {
    const raw = lsGet(title === 29 ? 'visited' : 'visited-' + title);
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  } catch { return 0; }
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const fmt = (n: number | string | null | undefined): string => Number(n || 0).toLocaleString();

export const titleHref = (t: number, rest?: string): string => `#/title/${t}/${rest || ''}`;
