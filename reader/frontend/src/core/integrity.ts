/**
 * The integrity report (`GET /api/integrity`, `app/integrity.py`) shaped for the Settings
 * "Data integrity" tab (FT-07), plus the incomplete-title notice (FT-08).
 *
 * Pure (no DOM, no state) so it is unit-tested in `tests/unit.test.ts`. Statuses here are
 * words with their own class, never `statPill`, which stays reserved for sync state.
 */

export type IntegrityStatus = 'OK' | 'WARN' | 'FAIL' | 'INFO';

export interface IntegrityItem {
  corpus: string;
  target: string;
  check: string;
  status: IntegrityStatus;
  detail: string;
  provenance?: Record<string, string>;
}

export interface IntegrityReport {
  status: IntegrityStatus;
  summary: Partial<Record<IntegrityStatus, number>>;
  items: IntegrityItem[];
  checked_at?: string;
  online?: boolean;
}

export interface IntegrityTarget {
  target: string;
  status: IntegrityStatus;
  checks: IntegrityItem[];
  provenance: Record<string, string> | null;
}

export interface IntegrityGroup {
  corpus: string;
  label: string;
  status: IntegrityStatus;
  targets: IntegrityTarget[];
  /** False when the framework's only line is the INFO "not installed" note. */
  installed: boolean;
}

/** The authority chain's order, as the rest of the app lists frameworks. */
export const INTEGRITY_FRAMEWORKS: ReadonlyArray<[string, string]> = [
  ['constitution', 'U.S. Constitution'],
  ['usc', 'United States Code'],
  ['plaw', 'Public Laws'],
  ['cfr', 'Code of Federal Regulations'],
  ['fr', 'Federal Register'],
  ['agenda', 'Unified Agenda'],
];

const RANK: Record<IntegrityStatus, number> = { FAIL: 3, WARN: 2, OK: 1, INFO: 0 };

/** The most serious status of a set (a store with only notes reads as a note). */
export function worstStatus(statuses: IntegrityStatus[]): IntegrityStatus {
  return statuses.reduce<IntegrityStatus>((w, s) => (RANK[s] > RANK[w] ? s : w), 'INFO');
}

/** The plain word shown for a status. */
export function statusWord(s: IntegrityStatus): string {
  return { OK: 'OK', WARN: 'Check', FAIL: 'Problem', INFO: 'Note' }[s] || s;
}

/** The report grouped by framework, then by store ("title 29", "corpus", …), in report order. */
export function groupIntegrity(report: IntegrityReport | null): IntegrityGroup[] {
  const items = report?.items || [];
  const names = new Map(INTEGRITY_FRAMEWORKS);
  const order = [...INTEGRITY_FRAMEWORKS.map(([k]) => k), ...items.map(i => i.corpus).filter(c => !names.has(c))];
  const groups: IntegrityGroup[] = [];
  for (const corpus of [...new Set(order)]) {
    const mine = items.filter(i => i.corpus === corpus);
    if (!mine.length) continue;
    const targets: IntegrityTarget[] = [];
    for (const target of [...new Set(mine.map(i => i.target))]) {
      const rows = mine.filter(i => i.target === target);
      const prov = rows.find(i => i.check === 'provenance' && i.provenance);
      targets.push({
        target,
        status: worstStatus(rows.map(r => r.status)),
        checks: rows.filter(r => r !== prov),
        provenance: prov?.provenance || null,
      });
    }
    const installed = !mine.every(i => i.check === 'installed' && i.status === 'INFO');
    groups.push({ corpus, label: names.get(corpus) || corpus.toUpperCase(), status: worstStatus(mine.map(i => i.status)), targets, installed });
  }
  return groups;
}

/** "a1b2c3d4e5f6…" for a SHA-256 (the full value goes in a title attribute). */
export function shortHash(h: string | null | undefined): string {
  if (!h || h === 'unknown') return h || '';
  return h.length > 16 ? `${h.slice(0, 12)}…` : h;
}

/** Provenance rows worth showing, labelled in plain words, in a fixed order; "unknown" stays visible. */
export function provenanceRows(p: Record<string, string> | null): Array<{ key: string; label: string; value: string; hash: boolean }> {
  if (!p) return [];
  const labels: Array<[string, string]> = [
    ['edition', 'Edition'], ['release_point', 'Release point'], ['current_through', 'Current through'],
    ['source_url', 'Source'], ['fetched_at', 'Fetched'], ['built_at', 'Built'],
    ['xml_sha256', 'Source SHA-256'], ['zip_sha256', 'Download SHA-256'], ['structure_sha256', 'Structure SHA-256'],
  ];
  return labels.filter(([k]) => p[k]).map(([key, label]) => ({ key, label, value: p[key], hash: key.endsWith('sha256') }));
}

/** FT-08: the sentence a CFR title shows when its download had sections with no text. */
export function incompleteTitleNotice(meta: { missing_sections?: number | null; missing_sample?: string[] | null } | null | undefined): string {
  const n = Number(meta?.missing_sections || 0);
  if (!n) return '';
  const sample = (meta?.missing_sample || []).slice(0, 3).map(id => `§\u00a0${id}`).join(', ');
  return `${n === 1 ? '1 section' : `${n.toLocaleString()} sections`} listed in eCFR’s table of contents had no text in this download`
    + `${sample ? ` (for example ${sample})` : ''}, so ${n === 1 ? 'it isn’t' : 'they aren’t'} in this copy.`;
}
