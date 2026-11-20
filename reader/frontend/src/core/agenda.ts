import { state, TransferJob } from '../state';

// --- The Unified Agenda: shared types, names and links ---
// reginfo.gov's spring and fall editions of planned federal rules (`agenda.py`), one row per
// (RIN, edition). The Newsroom's Unified Agenda tab (#/news?cat=agenda) lists an edition by
// agency and stage, and #/news/agenda/{RIN} is one planned rule with its timetable and the
// Federal Register documents it became.

export const AGENDA_JOB_KEY = 4000;
export const AGENDA_TAB_HREF = '#/news?cat=agenda';
export const agendaHref = (rin: string, edition?: string | null): string =>
  `#/news/agenda/${encodeURIComponent(rin)}${edition ? `?edition=${encodeURIComponent(edition)}` : ''}`;

export interface AgendaEdition {
  edition: string;
  title: string | null;
  entries: number;
  run_date?: string | null;
  fetched_at?: string | null;
}

export interface AgendaStatus {
  installed: boolean;
  entry_count: number;
  edition_count: number;
  editions: AgendaEdition[];
  meta: Record<string, string>;
}

export interface AgendaRow {
  rin: string;
  edition: string;
  agency_code?: string | null;
  agency: string | null;
  agency_acronym: string | null;
  parent_code?: string | null;
  parent: string | null;
  parent_acronym: string | null;
  title: string;
  stage: string | null;
  priority: string | null;
  major: string | null;
  rin_status?: string | null;
}

export interface AgendaListResponse {
  installed: boolean;
  edition?: string | null;
  total: number;
  results: AgendaRow[];
  status: AgendaStatus;
}

export interface AgendaFacets {
  installed: boolean;
  edition: string | null;
  agencies: Array<{ code: string; acronym: string | null; name: string | null; entries: number }>;
  stages: Array<{ key: string; label: string; entries: number }>;
}

export interface AgendaTimetableRow { action: string; date: string; fr_citation: string | null }

export interface AgendaFrDocument {
  document_number: string;
  type: string | null;
  title: string | null;
  publication_date: string | null;
  citation: string | null;
  html_url: string | null;
}

export interface AgendaEntry extends AgendaRow {
  abstract: string | null;
  cfr: string[];
  authority: string[];
  timetable: AgendaTimetableRow[];
  related: string[];
  further_info_url: string | null;
  comment_url: string | null;
  history: Array<{ edition: string; stage: string | null; rin_status: string | null }>;
  fr_documents: AgendaFrDocument[];
}

/** The stages, in the order a rule moves through them, with short names for chips. */
export const AGENDA_STAGES: Array<{ key: string; label: string; short: string }> = [
  { key: 'prerule', label: 'Prerule Stage', short: 'Prerule' },
  { key: 'proposed', label: 'Proposed Rule Stage', short: 'Proposed rule' },
  { key: 'final', label: 'Final Rule Stage', short: 'Final rule' },
  { key: 'long_term', label: 'Long-Term Actions', short: 'Long-term' },
  { key: 'completed', label: 'Completed Actions', short: 'Completed' },
];

export const stageShort = (label: string | null | undefined): string =>
  AGENDA_STAGES.find(s => s.label === label)?.short || label || '';

export const stageKey = (label: string | null | undefined): string =>
  AGENDA_STAGES.find(s => s.label === label)?.key || '';

/** "202510" → "Fall 2025", "202504" → "Spring 2025", "201200" (annual) → "2012". */
export function editionLabel(ed: string | null | undefined): string {
  const m = /^(\d{4})(\d{2})$/.exec(ed || '');
  if (!m) return ed || '';
  const month = parseInt(m[2], 10);
  if (!month) return m[1];
  return `${month >= 7 ? 'Fall' : 'Spring'} ${m[1]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Timetable dates: "10/00/2025" (month only) → "Oct 2025", "03/15/2026" → "Mar 15, 2026"; else as given ("To Be Determined"). */
export function agendaDate(d: string | null | undefined): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || '').trim());
  if (!m) return (d || '').trim();
  const mon = MONTHS[parseInt(m[1], 10) - 1];
  if (!mon) return d || '';
  const day = parseInt(m[2], 10);
  return day ? `${mon} ${day}, ${m[3]}` : `${mon} ${m[3]}`;
}

/** "29 CFR 1910" / "40 CFR 261.3" → {title, part, section?}; anything else null. */
export function parseAgendaCfr(s: string): { title: number; part: string; section: string | null } | null {
  const m = /^\s*(\d{1,2})\s+CFR\s+(\d+[A-Z]?)(?:\.(\d+[a-z]?))?\b/i.exec(s);
  if (!m) return null;
  return { title: parseInt(m[1], 10), part: m[2], section: m[3] ? `${m[2]}.${m[3]}` : null };
}

/** "29 U.S.C. 655" / "42 USC 7401 et seq" → {title, section}; anything else null. */
export function parseAgendaUsc(s: string): { title: number; section: string } | null {
  const m = /^\s*(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s+(?:§+\s*)?(\d+[a-z]?(?:-\d+)?)/i.exec(s);
  return m ? { title: parseInt(m[1], 10), section: m[2] } : null;
}

export const reginfoHref = (rin: string, edition: string): string =>
  `https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=${encodeURIComponent(edition)}&RIN=${encodeURIComponent(rin)}`;

export const isAgendaJob = (j: TransferJob | null | undefined): boolean =>
  Boolean(j && (j.title === AGENDA_JOB_KEY || String(j.kind || '').startsWith('agenda')));

export const agendaJob = (): TransferJob | null =>
  [state.jobs?.current, ...(state.jobs?.queued || [])].find(isAgendaJob) || null;
