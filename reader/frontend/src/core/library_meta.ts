import { state } from '../state';
import type { TransferJob } from '../state';
import { StatPillState, statPill, fmtDate } from '../components/ui';

// Pure library status, staleness, suite, and job lookup helpers (no view/DOM dependencies).

export interface LibraryTitleInstalled {
  whole?: boolean;
  edition?: string | null;
  section_count?: number;
  bytes?: number;
  parts?: number;
  sections?: number;
}

export interface LibraryTitleRow {
  title: number;
  name?: string;
  reserved?: boolean;
  latest?: string | null;
  amended?: string | null;
  sections?: number;
  size_mb?: number;
  summary?: string;
  desk?: string;
  agencies?: string[];
  installed?: LibraryTitleInstalled | null;
}

export interface LibraryCatalogData {
  checked_at?: number;
  titles: LibraryTitleRow[];
  suites?: Record<string, LibrarySuite>;
  jobs?: import('../state').JobsSnapshot;
  desks?: string[];
}

export interface LibrarySuite {
  id: string;
  name: string;
  summary: string;
  badge?: string;
  featured?: boolean;
  titles: number[];
  /** U.S. Code titles queued with the bundle (their statutes). */
  usc_titles?: number[];
  sections?: number;
  size_mb?: number;
}

export const isStale = (t: LibraryTitleRow): boolean =>
  Boolean(t.installed && t.latest && t.installed.edition && t.latest > t.installed.edition);

export function jobFor(title: number, kind: 'title' | 'part' | 'section', id?: string): TransferJob | undefined {
  const active = [state.jobs.current, ...state.jobs.queued].filter(Boolean) as TransferJob[];
  return active.find(j => j.title === title && (
    kind === 'title' ? (j.kind === 'title' || j.kind === 'update')
      : kind === 'part' ? j.kind === 'part' && j.target && j.target.part === id
        : j.kind === 'section' && j.target && j.target.id === id
  ));
}

export const jobStatus = (j: TransferJob | null | undefined): string =>
  j ? statPill('busy', j.state === 'running' ? 'Downloading' : 'Queued', { bare: true }) : '';

function pluralWord(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function titleStatus(t: LibraryTitleRow): { state: StatPillState; text: string; title?: string } {
  if (t.reserved) return { state: 'uninstalled', text: 'Reserved' };
  const j = jobFor(t.title, 'title');
  if (j) {
    return {
      state: 'busy',
      text: j.state === 'running' ? (j.kind === 'update' ? 'Updating' : 'Downloading') : 'Queued',
    };
  }
  const inst = t.installed;
  if (!inst) return { state: 'uninstalled', text: 'Not installed' };
  if (isStale(t)) {
    return { state: 'stale', text: 'Update available', title: `eCFR has a newer edition (${fmtDate(t.latest)})` };
  }
  if (!inst.whole) {
    const what = [
      inst.parts ? pluralWord(inst.parts, 'part') : '',
      inst.sections ? pluralWord(inst.sections, 'section') : '',
    ].filter(Boolean).join(', ');
    return { state: 'partial', text: 'Partial', title: what ? `Installed: ${what}` : '' };
  }
  return { state: 'synced', text: 'Installed', title: `Edition ${fmtDate(inst.edition)}` };
}

export function amendedWeek(d: LibraryCatalogData): { newest: string; cut: string; recent: number } {
  const newest = d.titles.reduce((m, t) => (t.latest && t.latest > m ? t.latest : m), '');
  if (!newest) return { newest: '', cut: '', recent: 0 };
  const [y, m, dd] = newest.split('-').map(Number);
  const cut = new Date(Date.UTC(y, m - 1, dd - 7)).toISOString().slice(0, 10);
  return { newest, cut, recent: d.titles.filter(t => t.amended && t.amended >= cut).length };
}

export function suiteState(s: LibrarySuite, d: LibraryCatalogData) {
  const ts = s.titles.map(n => d.titles.find(t => t.title === n)).filter((t): t is LibraryTitleRow => Boolean(t && !t.reserved));
  const total = ts.length || (s.titles || []).length;
  const busy = ts.filter(t => jobFor(t.title, 'title'));
  const whole = ts.filter(t => t.installed && t.installed.whole);
  const any = ts.filter(t => t.installed);
  const stale = ts.filter(isStale);
  const needs = ts.filter(t => !jobFor(t.title, 'title') && (!t.installed || !t.installed.whole || isStale(t)));
  let pill: string;
  if (!ts.length) pill = statPill('uninstalled', 'Not installed', { bare: true });
  else if (busy.length) pill = statPill('busy', `${busy.length} of ${ts.length} in progress`);
  else if (whole.length === ts.length && !stale.length) pill = statPill('synced', 'Installed');
  else if (whole.length === ts.length) pill = statPill('stale', 'Update available');
  else if (any.length) pill = statPill('partial', `${any.length} of ${ts.length} installed`);
  else pill = statPill('uninstalled', 'Not installed', { bare: true });

  const onlyUpdates = needs.length && needs.every(t => t.installed && t.installed.whole);
  const label = !needs.length ? ''
    : onlyUpdates ? `Update ${needs.length === ts.length ? 'suite' : pluralWord(needs.length, 'title')}`
      : needs.length === ts.length ? 'Download suite'
        : `Download ${pluralWord(needs.length, 'remaining title')}`;
  return { ts, total, pill, needs, label, busy };
}
