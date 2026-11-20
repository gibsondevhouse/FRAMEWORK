import { SectionOutlineItem, state, TransferJob } from '../state';
import { getJSON } from '../api/client';

// --- Public Laws: shared types, links and citations ---
// GovInfo's slip laws (USLM, 113th Congress on), installed as one database (`plaw.py`). The
// Library's Public Laws tab lists them by Congress, `#/law/{id}` reads one a section at a
// time with where it was placed in the U.S. Code, and U.S. Code sections list the laws that
// enacted or amended them ("Enacted by").

export const PLAW_JOB_KEY = 3000;
export const PLAW_LIB_HREF = '#/library/plaw';
export const plawLibHref = (congress?: number | null): string => `${PLAW_LIB_HREF}${congress ? `/${congress}` : ''}`;
export const lawHref = (id: string, view?: string | null): string =>
  `#/law/${encodeURIComponent(id)}${view ? `/${encodeURIComponent(view)}` : ''}`;

export interface PlawCongressCount { congress: number; law_type: 'public' | 'private'; laws: number }

export interface PlawStatus {
  installed: boolean;
  law_count: number;
  usc_link_count: number;
  meta: Record<string, string>;
  congresses: PlawCongressCount[];
  first_congress: number;
  current_congress: number;
}

export interface PlawLawRow {
  id: string;
  congress: number;
  law_type: 'public' | 'private';
  number: number;
  citation: string | null;
  statute: string | null;
  title: string | null;
  approved_date: string | null;
  bill: string | null;
  /** On `/api/plaw/usc/…` rows: how the law touches the section (reference, codified, note). */
  kinds?: string | null;
}

export interface PlawUscLink { title: number; section: string; kind: 'reference' | 'codified' | 'note' }

export interface PlawLawDetail extends PlawLawRow {
  usc: PlawUscLink[];
  provenance: { source_url: string; sha256: string; byte_len: number; fetched_at: string };
}

export interface PlawText {
  id: string;
  mode: 'units' | 'page';
  outline: SectionOutlineItem[];
  chars: number;
  unit: string | null;
  unit_prev: SectionOutlineItem | null;
  unit_next: SectionOutlineItem | null;
  html: string;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** The two calendar years a Congress sits: the 118th is 2023–2024. */
export const congressYears = (c: number): string => `${1789 + (c - 1) * 2}–${1790 + (c - 1) * 2}`;

/** "Pub. L. 118-5" (short, for lists and headings); private laws are "Priv. L.". */
export const lawShort = (l: Pick<PlawLawRow, 'congress' | 'number' | 'law_type'>): string =>
  `${l.law_type === 'private' ? 'Priv.' : 'Pub.'} L. ${l.congress}-${l.number}`;

/** Bluebook form: "Pub. L. No. 118-5, 137 Stat. 50 (2023)". */
export function lawCitation(l: Pick<PlawLawRow, 'congress' | 'number' | 'law_type' | 'statute' | 'approved_date'>): string {
  const year = (l.approved_date || '').slice(0, 4);
  return `${l.law_type === 'private' ? 'Priv.' : 'Pub.'} L. No. ${l.congress}-${l.number}`
    + (l.statute ? `, ${l.statute}` : '') + (year ? ` (${year})` : '');
}

export function plawScope(st: PlawStatus | null): { congresses: number[]; follow: boolean; types: string[] } | null {
  try {
    const s = JSON.parse(st?.meta?.scope || 'null');
    return s && Array.isArray(s.congresses) ? s : null;
  } catch {
    return null;
  }
}

/** Law counts per Congress (public laws only), newest first. */
export function plawCounts(st: PlawStatus | null): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of st?.congresses || []) if (r.law_type === 'public') m.set(r.congress, (m.get(r.congress) || 0) + r.laws);
  return m;
}

export async function fetchPlawStatus(): Promise<PlawStatus | null> {
  try {
    const d = await getJSON<{ status: PlawStatus }>('/api/plaw?limit=1');
    return d.status;
  } catch {
    return null;
  }
}

/** Every public law of one Congress (the API pages at 200). */
export async function fetchCongressLaws(congress: number, signal?: AbortSignal): Promise<PlawLawRow[]> {
  const out: PlawLawRow[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const d = await getJSON<{ total: number; results: PlawLawRow[] }>(
      `/api/plaw?congress=${congress}&type=public&limit=200&offset=${offset}`, { signal });
    out.push(...d.results);
    if (out.length >= d.total || !d.results.length) break;
  }
  return out;
}

export const isPlawJob = (j: TransferJob | null | undefined): boolean =>
  Boolean(j && (j.title === PLAW_JOB_KEY || String(j.kind || '').startsWith('plaw')));

export const plawJob = (): TransferJob | null =>
  [state.jobs?.current, ...(state.jobs?.queued || [])].find(isPlawJob) || null;
