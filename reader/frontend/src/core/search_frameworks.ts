// Cross-framework search: turns the `usc` / `fr` / `constitution` / `plaw` / `agenda` blocks of
// `GET /api/search?include=…` into one row shape, so the search page lists every federal
// framework the same way. Pure (no DOM, no state) and unit-tested. CFR rows keep their own
// renderer in `views/search.ts` (title/part grouping, facets).
import type { SearchResponse } from '../state';
import { agendaHref, editionLabel, stageShort } from './agenda';
import { lawHref, lawShort } from './plaw';
import { uscCite } from './usc_label';

export type SearchFramework = 'cfr' | 'const' | 'usc' | 'plaw' | 'fr' | 'agenda';
export type SearchFrameworkFilter = SearchFramework | 'all';

/** Every block the search page asks for. */
export const SEARCH_INCLUDE = 'fr,usc,constitution,plaw,agenda';

/** How many rows of each framework the "All" view shows before "Show all". */
export const FRAMEWORK_PREVIEW = 5;

export interface FrameworkRow {
  href: string;
  /** The citation-like lead ("29 U.S.C. § 655", "91 FR 69092", "Pub. L. 114-2"). */
  num: string;
  name: string;
  /** Right-aligned context (status, date, stage). */
  meta: string;
  /** Raw snippet with \x02/\x03 highlight sentinels. */
  snippet: string;
}

export interface FrameworkGroup {
  key: Exclude<SearchFramework, 'cfr'>;
  label: string;
  short: string;
  /** `data-ref-tier` value that colours the group. */
  tier: 'const' | 'usc' | 'fr';
  total: number;
  rows: FrameworkRow[];
}

/** Display order: the authority chain, Constitution → statutes → regulations → rulemaking. */
export const FRAMEWORK_ORDER: SearchFramework[] = ['const', 'usc', 'plaw', 'cfr', 'fr', 'agenda'];

export const FRAMEWORK_LABELS: Record<SearchFramework, { label: string; short: string }> = {
  const: { label: 'U.S. Constitution', short: 'Constitution' },
  usc: { label: 'United States Code', short: 'U.S.C.' },
  plaw: { label: 'Public Laws', short: 'Public Laws' },
  cfr: { label: 'Code of Federal Regulations', short: 'CFR' },
  fr: { label: 'Federal Register', short: 'Federal Register' },
  agenda: { label: 'Unified Agenda', short: 'Unified Agenda' },
};

const SEARCH_FRAMEWORKS = new Set<string>(FRAMEWORK_ORDER);

export const parseFrameworkFilter = (v: string | null | undefined): SearchFrameworkFilter =>
  (v && SEARCH_FRAMEWORKS.has(v) ? (v as SearchFramework) : 'all');

/** The installed non-CFR frameworks of a response, in display order, rows normalized. */
export function frameworkGroups(data: SearchResponse): FrameworkGroup[] {
  const out: FrameworkGroup[] = [];
  const add = (key: FrameworkGroup['key'], tier: FrameworkGroup['tier'], total: number, rows: FrameworkRow[]): void => {
    out.push({ key, tier, ...FRAMEWORK_LABELS[key], total: Math.max(Number(total) || 0, rows.length), rows });
  };

  const c = data.constitution;
  if (c?.installed) {
    add('const', 'const', c.total, c.results.map(r => ({
      href: `#/constitution/${encodeURIComponent(r.id)}`,
      num: r.label || r.id,
      name: r.kind === 'annotation' ? 'Annotation' : '',
      meta: '',
      snippet: r.snippet || '',
    })));
  }

  const u = data.usc;
  if (u?.installed) {
    add('usc', 'usc', u.total, u.results.map(r => ({
      href: `#/usc/${r.usc_title}/section/${encodeURIComponent(r.id)}`,
      num: `${uscCite(r.usc_title)} § ${r.id}`,
      name: r.heading || '',
      meta: r.status || '',
      snippet: r.snippet || '',
    })));
  }

  const p = data.plaw;
  if (p?.installed) {
    add('plaw', 'usc', p.total, p.results.map(r => ({
      href: lawHref(r.id),
      num: lawShort(r),
      name: r.title || '',
      meta: [r.statute, r.approved_date].filter(Boolean).join(' · '),
      snippet: r.snippet || '',
    })));
  }

  const f = data.fr;
  if (f?.installed) {
    add('fr', 'fr', f.total, f.results.map(r => ({
      href: `#/news/fr/${encodeURIComponent(r.document_number)}`,
      num: r.citation || r.document_number,
      name: r.title || '',
      meta: [r.type, r.publication_date].filter(Boolean).join(' · '),
      snippet: r.snippet || r.abstract || '',
    })));
  }

  const a = data.agenda;
  if (a?.installed) {
    // The same rule appears once per edition, newest first: keep its newest entry.
    const seen = new Set<string>();
    const rows: FrameworkRow[] = [];
    for (const r of a.results) {
      if (seen.has(r.rin)) continue;
      seen.add(r.rin);
      rows.push({
        href: agendaHref(r.rin, r.edition),
        num: `RIN ${r.rin}`,
        name: r.title || '',
        meta: [r.parent_acronym, stageShort(r.stage), editionLabel(r.edition)].filter(Boolean).join(' · '),
        snippet: r.snippet || '',
      });
    }
    add('agenda', 'fr', a.total - (a.results.length - rows.length), rows);
  }
  return out;
}
