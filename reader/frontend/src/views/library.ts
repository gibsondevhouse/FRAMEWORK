import { state } from '../state';
import type { TransferJob } from '../state';
import { getJSON, invalidateTitleCaches } from '../api/client';
import { pollJobs, pollJobsIfActive, queueBatch, setJobs } from '../api/jobs';
import { on } from '../core/events';
import { onView } from '../core/view_dispatch';
import {
  amendedWeek, isStale, jobFor, jobStatus, LibraryCatalogData, LibrarySuite,
  LibraryTitleRow, suiteState, titleStatus,
} from '../core/library_meta';
import { HOME_CONTENT } from '../data/home_content';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection, plural } from '../components/sidebar';
import { refreshTitles } from '../components/transfer_dock';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsGet, lsSet, reduceMotion, showToast, skeletonHtml } from '../dom';
import { announce } from '../nav';
import { dom } from '../state_init';
import { fmt } from '../usage';
import {
  SEP, fmtBytes, fmtDate, fmtMB, fmtSections, joinSep,
  emptyStateHtml, shortDate, statPill,
} from '../components/ui';
export {
  SEP, amendedWeek, fmtBytes, fmtDate, fmtMB, fmtSections, getJSON, isStale,
  jobFor, jobStatus, joinSep, pollJobs, pollJobsIfActive, queueBatch, setJobs,
  shortDate, statPill, suiteState, titleStatus,
};
import { flagHtml, kpiStripHtml, KpiCell, pageMastheadHtml, switchboardHtml, tabLeadHtml, bindSwitchboardKeys } from '../components/page_shell';
import {
  authorizedBy, cfrChipsHtml, releaseLine, UscCatalog, UscCatalogTitle, UscTreeNode,
  uscChipsHtml, uscDetailActions, uscDetailBodyHtml, uscDetailSub, uscJobFor, uscLibHref, uscStats,
  uscStatusPill, uscStory, uscTabHtml, uscCite,
} from './library_usc';

export type LibSort = 'desk' | 'number' | 'updated';

export interface WireItem {
  title: number;
  amended?: string;
  count?: number;
  removed?: number;
  kind?: string;
  parts?: string[];
  first?: { name?: string };
}

export interface LibraryPartRow {
  id: string;
  l: string;
  d?: string;
  r?: boolean;
  leaves?: number;
  installed?: 'all' | 'some' | 'none';
  installed_sections?: number;
}

export interface LibraryTitleGroup {
  label?: string;
  parts: LibraryPartRow[];
}

export interface LibraryTitleDetailResponse {
  name?: string;
  reserved?: boolean;
  latest?: string | null;
  installed?: {
    whole?: boolean;
    edition?: string | null;
    section_count?: number;
  } | null;
  groups: LibraryTitleGroup[];
}

export interface LibrarySectionRow {
  id: string;
  t: 'section' | 'appendix';
  l: string;
  d?: string;
  r?: boolean;
  installed?: boolean;
}

export interface LibraryPartGroup {
  label?: string;
  sections: LibrarySectionRow[];
}

export interface LibraryPartDetailResponse {
  l: string;
  d?: string;
  installed?: 'all' | 'some' | 'none';
  groups: LibraryPartGroup[];
}

export type LibTab = 'overview' | 'usc' | 'cfr';
export const LIB_TAB_ORDER: LibTab[] = ['overview', 'usc', 'cfr'];
export const LIB_TAB_HREF: Record<LibTab, string> = { overview: '#/library', usc: '#/library/usc', cfr: '#/library/cfr' };

export interface LibViewState {
  /** tab = which switchboard tab; title/part = a CFR drill-down (tab 'cfr') or a U.S. Code title (tab 'usc'). */
  view: { tab: LibTab; title: number | null; part: string | null } | null;
  data: LibraryCatalogData | LibraryTitleDetailResponse | LibraryPartDetailResponse | null;
  usc: UscCatalog | null;
  uscTree: { title: number; tree: UscTreeNode | null } | null;
  filter: string;
  sort: LibSort;
  wire: { at: number; items: WireItem[]; failed?: boolean } | null;
  focusTab: boolean;
}

// --- Library: download titles, parts or sections from eCFR (#/library…) ---
// Three levels, like the sidebar: every title → one title's parts → one part's sections.
// Row actions (Download, Open, Update, Remove) appear on hover or focus. Downloads queue on
// the server and run one at a time; `jobs` polls while any are active, wherever you are,
// and refreshes the title list (and this page) as each finishes.
export const lib: LibViewState = {
  view: null, data: null, usc: null, uscTree: null, filter: '', sort: 'desk', wire: null, focusTab: false,
};

const savedSort = lsGet('libSort');
if (savedSort === 'desk' || savedSort === 'number' || savedSort === 'updated') {
  lib.sort = savedSort;
}

state.jobs = { current: null, queued: [], recent: [] };
state.jobsTimer = null;
state.jobsSeenActive = new Set();
// ids of jobs this page has seen queued or running
state.lastJobsKey = '';

const removeTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

// Status helpers are imported from core/library_meta and re-exported above.

const fetchUscCatalog = (): Promise<UscCatalog | null> => getJSON<UscCatalog>('/api/usc/catalog').catch(() => null);

const installedCfrSet = (): Set<number> => new Set((state.installedTitles || []).map(t => t.title));

async function fetchView(tab: LibTab, title: number | null, part: string | null): Promise<void> {
  if (tab === 'usc' && title) {
    const [cat, jobs] = await Promise.all([
      fetchUscCatalog(),
      getJSON<NonNullable<LibraryCatalogData['jobs']>>('/api/library/jobs').catch(() => null),
    ]);
    const row = cat?.titles.find(t => t.title === title);
    const tree = row?.installed ? await getJSON<UscTreeNode>(`/api/usc/${title}/tree`).catch(() => null) : null;
    if (jobs) setJobs(jobs);
    lib.usc = cat;
    lib.uscTree = { title, tree };
    return;
  }
  if (!title) {
    const [data, cat] = await Promise.all([getJSON<LibraryCatalogData>('/api/library'), fetchUscCatalog()]);
    setJobs(data.jobs);
    lib.data = data;
    lib.usc = cat;
    return;
  }
  const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : `/api/library/${title}`;
  const [data, cat] = await Promise.all([
    getJSON<LibraryTitleDetailResponse & LibraryPartDetailResponse>(url),
    lib.usc ? Promise.resolve(lib.usc) : fetchUscCatalog(),
  ]);
  lib.data = data;
  lib.usc = cat;
}

export async function loadLibrary(tab: LibTab = 'overview', title?: number | null, part?: string | null): Promise<void> {
  const normTitle = title ?? null;
  const normPart = part ?? null;
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  const prev = lib.view;
  const sameView = Boolean(prev && prev.tab === tab && prev.title === normTitle && prev.part === normPart);
  // Switching between the front tabs keeps the page on screen while the data refreshes.
  const frontSwitch = Boolean(!normTitle && prev && !prev.title && lib.data && dom.view.querySelector('.lib-front'));
  if (!sameView) {
    lib.filter = '';
    if (!frontSwitch) dom.view.innerHTML = skeletonHtml(normTitle ? 'list' : 'cards', 'Loading the library…');
  }
  lib.view = { tab, title: normTitle, part: normPart };
  if (frontSwitch && !sameView) renderLibrary(false);
  try {
    await fetchView(tab, normTitle, normPart);
    if (seq !== state.routeSeq) return;
    renderLibrary(!sameView && !frontSwitch);
    pollJobsIfActive();
    if (!normTitle && tab === 'cfr') loadWire();
  } catch (err) {
    if (seq !== state.routeSeq) return;
    const message = err instanceof Error ? err.message : String(err);
    dom.view.innerHTML = emptyStateHtml({
      title: 'Couldn’t load the library',
      body: escapeHtml(message),
      actionsHtml: '<button type="button" class="btn" id="lib-retry">Try again</button>',
    });
    document.getElementById('lib-retry')?.addEventListener('click', () => loadLibrary(tab, normTitle, normPart));
  }
}

// Refetch the page's data in place (after a download or removal), keeping filter and scroll.
export async function refreshLibrary(): Promise<void> {
  if (!lib.view || !dom.view.querySelector('.lib')) return;
  const { tab, title, part } = lib.view;
  try {
    await fetchView(tab, title, part);
    renderLibrary(false);
  } catch { /* keep what's on screen */ }
}

// The library page re-renders when jobs start/finish/change state.

export function actBtn(act: string, label: string, attrs: string, cls = ''): string {
  return `<button type="button" class="lib-act${cls ? ' ' + cls : ''}" data-act="${act}" ${attrs}>${label}</button>`;
}

export interface LibRowOpts {
  href?: string;
  num: string;
  name: string;
  status?: string;
  actions?: string;
  dim?: boolean;
  key?: string;
}

export function libRow({ href, num, name, status, actions, dim, key }: LibRowOpts): string {
  const main = href
    ? `<a class="lib-main" href="${href}"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></a>`
    : `<span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>`;
  return `<div class="lib-row${dim ? ' is-dim' : ''}${actions ? ' has-actions' : ''}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}"${key ? ` data-key="${escapeHtml(key)}"` : ''}>
    ${main}<span class="lib-status">${status || ''}</span><span class="lib-actions">${actions || ''}</span></div>`;
}

export const libHref = (title?: number | null, part?: string | null): string =>
  (title ? `#/library/cfr/${title}` : '#/library') + (part ? `/part/${encodeURIComponent(part)}` : '');

export function renderStatusPill(t: LibraryTitleRow, opts: { bare?: boolean; title?: string } = {}): string {
  const s = titleStatus(t);
  return statPill(s.state, s.text, { title: s.title, ...opts });
}

export function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return shortDate(new Date(ms).toISOString().slice(0, 10));
}

// --- The front page (#/library): a newsroom of titles ---
// Masthead (edition, counts) → four metric tiles → the broadsheet lead: the featured
// compliance suite (65%) beside the Regulatory Wire, eCFR's latest amendments (35%) → the
// other suites → every title as a brief under its topic desk (or ordered by number or by
// last amendment). Briefs: kicker (title number, agencies), status pill, headline, one-line
// summary, dateline (amended · sections · size); actions slide in on hover or focus.
export const LIB_SORTS: Array<[LibSort, string]> = [['desk', 'By desk'], ['number', 'By number'], ['updated', 'Recently amended']];

export function titleActions(t: LibraryTitleRow): string {
  if (t.reserved || jobFor(t.title, 'title')) return '';
  const inst = t.installed;
  if (!inst) return actBtn('download', `${icon('download')}Download`, `data-title="${t.title}"`, 'is-primary');
  return `<a class="lib-act" href="#/title/${t.title}/">Open</a>`
    + (inst.whole ? '' : actBtn('download', 'Download all', `data-title="${t.title}"`))
    + (isStale(t) ? actBtn('update', 'Update', `data-title="${t.title}" title="eCFR has a newer edition (${escapeHtml(fmtDate(t.latest))})"`) : '')
    + actBtn('remove', 'Remove', `data-title="${t.title}"`, 'is-danger');
}

export function libStory(t: LibraryTitleRow): string {
  const inst = t.installed;
  const agencies = (t.agencies || []).slice(0, 3);
  const kicker = `Title ${t.title}${agencies.length ? `${SEP}<span class="story-ag">${agencies.map(escapeHtml).join(' ')}</span>` : ''}`;
  const name = escapeHtml(t.name || '');
  const headline = t.reserved ? name : `<a href="${libHref(t.title)}">${name}</a>`;
  const sections = inst ? inst.section_count : t.sections;
  const dateline = joinSep([
    t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : '',
    t.reserved ? '' : fmtSections(sections),
    t.reserved || !t.size_mb ? '' : `<span title="Size of the title's text on eCFR">${fmtMB(t.size_mb)}</span>`,
  ]);
  const acts = titleActions(t);
  const auth = t.reserved ? [] : authorizedBy(t.title, lib.usc);
  const hay = `${t.title} title cfr ${t.name || ''} ${t.summary || ''} ${t.desk || ''} ${(t.agencies || []).join(' ')} ${auth.map(u => `${u.title} usc`).join(' ')}`.toLowerCase();
  return `<article class="lib-story has-tier-bar${t.reserved ? ' is-dim' : ''}" data-ref-tier="cfr" data-hay="${escapeHtml(hay)}">
    <div class="story-top"><span class="story-kicker">${kicker}</span>${renderStatusPill(t, { bare: !inst })}</div>
    <h3 class="story-name">${headline}</h3>
    ${t.summary ? `<p class="story-dek">${escapeHtml(t.summary)}</p>` : ''}
    ${auth.length ? `<div class="story-links"><span class="story-links-lbl">Authorized by</span>${uscChipsHtml(auth)}</div>` : ''}
    <div class="story-foot"><span class="story-date">${dateline}</span>${acts ? `<div class="story-actions">${acts}</div>` : ''}</div>
  </article>`;
}

export function libMetrics(d: LibraryCatalogData): string {
  const live = d.titles.filter(t => !t.reserved);
  const inst = live.filter(t => t.installed);
  const sections = inst.reduce((a, t) => a + (t.installed?.section_count || 0), 0);
  const bytes = inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0);
  const stale = live.filter(isStale);
  const { cut, recent } = amendedWeek(d);
  const updating = [state.jobs.current, ...state.jobs.queued].some(j => j && j.kind === 'update');
  const cells: KpiCell[] = [
    {
      labelHtml: '<span class="stat-dot is-synced" aria-hidden="true"></span>eCFR',
      valueHtml: 'Online',
      subHtml: d.checked_at ? `Title list checked ${escapeHtml(relTime(d.checked_at * 1000))}` : `${live.length} titles tracked`,
    },
    {
      labelHtml: 'Installed',
      valueHtml: `${inst.length} <span class="pg-kpi-of">of ${live.length}</span>`,
      subHtml: joinSep([fmtSections(sections) || 'No sections yet', bytes ? `${fmtBytes(bytes)} on disk` : '']),
    },
    {
      labelHtml: 'Amended this week',
      valueHtml: String(recent),
      subHtml: cut ? `Since ${escapeHtml(shortDate(cut))}${recent ? `${SEP}<button type="button" class="metric-link" data-sort="updated">Show</button>` : ''}` : 'No edition date',
    },
    stale.length
      ? {
        labelHtml: '<span class="stat-dot is-stale" aria-hidden="true"></span>Editions',
        valueHtml: `${stale.length} outdated`,
        subHtml: updating ? statPill('busy', 'Updating', { bare: true })
          : `<button type="button" class="metric-link is-strong" data-act="update-all">Update all ${icon('chevronRight')}</button>`,
        alert: true,
      }
      : {
        labelHtml: 'Editions',
        valueHtml: inst.length ? 'Current' : '—',
        subHtml: inst.length ? 'Every installed title is up to date' : 'Nothing installed yet',
      },
  ];
  return kpiStripHtml(cells, { label: 'CFR at a glance', refTier: 'cfr', cls: 'lib-metrics' });
}

export function suiteHero(s: LibrarySuite, d: LibraryCatalogData): string {
  const st = suiteState(s, d);
  const rows = st.ts.map(t => {
    const parts = (HOME_CONTENT[t.title]?.cards || []).slice(0, 3);
    const partHref = (p: string) => (t.installed && t.installed.whole ? `#/title/${t.title}/part/${encodeURIComponent(p)}` : libHref(t.title, p));
    return `<li class="suite-row">
      <span class="suite-num">${t.title}</span>
      <div class="suite-row-body">
        <a class="suite-name" href="${libHref(t.title)}">${escapeHtml(t.name || '')}</a>
        <span class="suite-ag">${(t.agencies || []).slice(0, 3).map(escapeHtml).join(' ')}</span>
        ${parts.length ? `<div class="suite-parts">${parts.map(c => {
          const [num, ...rest] = c.title.replace(/^Part\s+/, '').split(' — ');
          return `<a href="${partHref(c.part)}"><span class="suite-part-num">${escapeHtml(num)}</span>${escapeHtml(rest.join(' — '))}</a>`;
        }).join('')}</div>` : ''}
        <div class="suite-meta">${joinSep([
          t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : '',
          fmtSections(t.installed ? t.installed.section_count : t.sections),
          t.size_mb ? fmtMB(t.size_mb) : '',
          t.installed && t.installed.bytes ? `${fmtBytes(t.installed.bytes)} on disk` : '',
        ].map(x => x && `<span>${x}</span>`).filter(Boolean))}</div>
      </div>
      ${renderStatusPill(t, { bare: true })}
    </li>`;
  }).join('');
  const action = st.label
    ? `<button type="button" class="btn btn-accent" data-act="download-suite" data-suite="${escapeHtml(s.id)}">${icon('download')}${escapeHtml(st.label)}</button>`
    : st.busy.length ? '' : `<a class="btn" href="#/title/${st.ts[0] ? st.ts[0].title : ''}/">Open in reader</a>`;
  return `<article class="suite-hero has-tier-bar" data-ref-tier="cfr" aria-labelledby="suite-${escapeHtml(s.id)}">
    <div class="story-top"><span class="story-kicker"><span class="ref-badge">FEATURED BUNDLE</span>${s.badge ? `${SEP}${escapeHtml(s.badge)}` : ''}</span>${st.pill}</div>
    <h2 class="suite-title" id="suite-${escapeHtml(s.id)}">${escapeHtml(s.name)}</h2>
    <p class="suite-dek">${escapeHtml(s.summary)}</p>
    <ul class="suite-rows">${rows}</ul>
    ${(s.usc_titles || []).length ? `<div class="story-links suite-usc"><span class="story-links-lbl">Also installs the statutes</span>${uscChipsHtml((s.usc_titles || []).map(n => lib.usc?.titles.find(u => u.title === n)).filter((u): u is UscCatalogTitle => Boolean(u)))}</div>` : ''}
    <div class="suite-foot">
      <span class="suite-telemetry">${joinSep([plural(st.total, 'title'), fmtSections(s.sections), s.size_mb ? `${fmtMB(s.size_mb)} of text` : ''])}</span>
      ${action}
    </div>
  </article>`;
}

export function suiteCard(s: LibrarySuite, d: LibraryCatalogData): string {
  const st = suiteState(s, d);
  const titles = st.ts.length
    ? st.ts.map(t => `<a href="${libHref(t.title)}"><span class="suite-part-num">${t.title}</span>${escapeHtml(t.name || '')}</a>`).join('')
    : (s.titles || []).map(n => `<span><span class="suite-part-num">${n}</span>Title ${n} CFR</span>`).join('');
  const action = st.label
    ? actBtn('download-suite', `${icon('download')}${escapeHtml(st.label)}`, `data-suite="${escapeHtml(s.id)}"`, 'is-primary') : '';
  return `<article class="suite-card has-tier-bar" data-ref-tier="cfr">
    <div class="story-top"><span class="story-kicker"><span class="ref-badge">CFR PACK</span>${s.badge ? `${SEP}${escapeHtml(s.badge)}` : ''}</span>${st.pill}</div>
    <h3 class="story-name">${escapeHtml(s.name)}</h3>
    <p class="story-dek">${escapeHtml(s.summary)}</p>
    <div class="suite-parts suite-card-titles">${titles}</div>
    <div class="story-foot"><span class="story-date">${joinSep([fmtSections(s.sections), fmtMB(s.size_mb)])}</span>${action}</div>
  </article>`;
}

// The Regulatory Wire: the five most recently amended titles, newest first. Dates come with
// the catalog; what changed (`/api/library/wire`, eCFR's version history) fills in after.
export function wireSummary(c: WireItem | null | undefined): string {
  if (!c) return '<span class="wire-pending" aria-hidden="true"></span>';
  if (!c.count) return '';
  if (c.removed === c.count) return escapeHtml(`${plural(c.count, 'section')} removed`);
  const verb = c.kind === 'revised' ? 'revised' : 'amended';
  const parts = (c.parts || []).slice(0, 3);
  const more = (c.parts || []).length - parts.length;
  const where = parts.length ? ` in ${parts.length + more === 1 ? 'Part' : 'Parts'} ${parts.join(', ')}${more > 0 ? ` +${more}` : ''}` : '';
  return `${escapeHtml(`${plural(c.count, 'section')} ${verb}${where}`)}${c.first && c.first.name ? `<span class="wire-first">${escapeHtml(c.first.name)}</span>` : ''}`;
}

export function libWire(d: LibraryCatalogData): string {
  const top = d.titles.filter(t => !t.reserved && Boolean(t.amended))
    .sort((a, b) => (b.amended || '').localeCompare(a.amended || '') || a.title - b.title).slice(0, 5);
  const byTitle = new Map((lib.wire?.items || []).map(c => [c.title, c]));
  const failed = Boolean(lib.wire && lib.wire.failed);
  const listHtml = top.length
    ? `<ol class="wire-items">${top.map(t => {
        const c = byTitle.get(t.title);
        // Loading: a placeholder line. Loaded: what changed, if eCFR said. Failed: nothing.
        const summary = !lib.wire ? wireSummary(null) : failed || !c || c.amended !== t.amended ? '' : wireSummary(c);
        return `<li class="wire-entry"><a href="${libHref(t.title)}">
          <span class="wire-entry-head"><span class="wire-entry-title">Title ${t.title}${(t.agencies || [])[0] ? `${SEP}${escapeHtml(t.agencies![0])}` : ''}</span>
            <time class="wire-entry-date" datetime="${escapeHtml(t.amended || '')}">${escapeHtml(shortDate(t.amended))}</time></span>
          <span class="wire-entry-name">${escapeHtml(t.name || '')}</span>
          ${summary ? `<span class="wire-entry-summary">${summary}</span>` : ''}
        </a></li>`;
      }).join('')}</ol>
      <div class="wire-foot"><button type="button" class="wire-link" data-sort="updated">All titles by last amendment ${icon('chevronRight')}</button></div>`
    : '<p class="wire-empty">No recent eCFR amendment dates in this catalog slice.</p>';
  return `<aside class="reg-wire${top.length ? '' : ' is-empty'}" id="lib-wire" aria-labelledby="wire-title">
    <div class="wire-head">
      <h2 class="wire-title" id="wire-title">${icon('activity')}The Regulatory Wire</h2>
      <span class="wire-badge">Live eCFR</span>
    </div>
    <p class="wire-sub">Latest amendments, newest first</p>
    ${listHtml}
  </aside>`;
}

export async function loadWire(): Promise<void> {
  if (lib.wire && Date.now() - lib.wire.at < 30 * 60 * 1000 && !lib.wire.failed) return;
  try {
    lib.wire = { at: Date.now(), items: await getJSON<WireItem[]>('/api/library/wire') };
  } catch {
    lib.wire = { at: Date.now(), items: [], failed: true };
  }
  const el = document.getElementById('lib-wire');
  if (el && lib.data && lib.view && !lib.view.title) el.outerHTML = libWire(lib.data as LibraryCatalogData);
}

export function libTitleList(d: LibraryCatalogData, sort: LibSort): string {
  const live = d.titles.filter(t => !t.reserved);
  const reserved = d.titles.filter(t => t.reserved);
  const grid = (ts: LibraryTitleRow[]) => `<div class="lib-stories">${ts.map(libStory).join('')}</div>`;
  const desk = (name: string, ts: LibraryTitleRow[], extra = '') => `<section class="lib-desk${extra}" aria-label="${escapeHtml(name)}">
      <header class="lib-desk-header"><h3 class="lib-desk-name">${escapeHtml(name)}</h3><span class="lib-desk-count">${plural(ts.length, 'title')}</span></header>
      ${grid(ts)}</section>`;
  if (sort === 'number' || sort === 'updated') {
    const ordered = sort === 'number' ? live : [...live].sort((a, b) => (b.amended || '').localeCompare(a.amended || '') || a.title - b.title);
    return desk(sort === 'number' ? 'All titles by number' : 'All titles by last amendment', ordered, ' is-flat')
      + (reserved.length ? desk('Reserved', reserved) : '');
  }
  const names = [...(d.desks || [])];
  for (const t of live) if (t.desk && !names.includes(t.desk)) names.push(t.desk);
  return names.map(name => {
    const ts = live.filter(t => t.desk === name);
    return ts.length ? desk(name, ts) : '';
  }).join('') + (reserved.length ? desk('Reserved', reserved) : '');
}

// --- The front tabs (#/library, #/library/usc, #/library/cfr) ---
// One masthead and switchboard (components/page_shell) over three panels: Overview (both
// codes: updates due, bundles, what's installed), U.S. Code (views/library_usc) and CFR
// (eCFR metrics, the featured bundle beside the Regulatory Wire, every title by desk).
// The Federal Register lives in the Newsroom; the masthead links there.

function cfrLive(d: LibraryCatalogData): LibraryTitleRow[] {
  return d.titles.filter(t => !t.reserved);
}

function anyUpdating(): boolean {
  return [state.jobs.current, ...state.jobs.queued].some(j => j && (j.kind === 'update' || j.kind === 'usc-update'));
}

function libTabsHtml(d: LibraryCatalogData, cat: UscCatalog | null, tab: LibTab): string {
  const live = cfrLive(d);
  const inst = live.filter(t => t.installed);
  const stale = live.filter(isStale);
  const u = uscStats(cat);
  const total = inst.length + u.inst.length;
  const bytes = inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0) + u.bytes;
  const due = stale.length + u.stale.length;
  const { newest } = amendedWeek(d);
  return switchboardHtml({
    id: 'lib-tabs',
    idPrefix: 'lib-tab',
    dataAttr: 'lib-tab',
    panelId: 'lib-tab-body',
    label: 'Library sections',
    active: tab,
    tabs: [
      {
        id: 'overview', label: 'Overview', abbr: 'Desk', href: LIB_TAB_HREF.overview,
        countLabel: `${total} installed`,
        sub: [bytes ? `${fmtBytes(bytes)} on disk` : 'Nothing installed yet', due ? `${due} ${due === 1 ? 'update' : 'updates'} due` : ''].filter(Boolean).join(' · '),
        alert: due > 0,
      },
      {
        id: 'usc', label: 'United States Code', abbr: 'U.S.C.', refTier: 'usc', href: LIB_TAB_HREF.usc,
        countLabel: `${u.inst.length} of ${u.live.length || 53} titles`,
        sub: releaseLine(cat),
        alert: u.stale.length > 0, alertTitle: 'Behind the current release point',
      },
      {
        id: 'cfr', label: 'Code of Federal Regulations', abbr: 'CFR', refTier: 'cfr', href: LIB_TAB_HREF.cfr,
        countLabel: `${inst.length} of ${live.length} titles`,
        sub: newest ? `eCFR edition ${shortDate(newest)}` : 'eCFR Versioner',
        alert: stale.length > 0, alertTitle: 'eCFR has a newer edition',
      },
    ],
  });
}

function updateRows(d: LibraryCatalogData, cat: UscCatalog | null): string {
  const rows: string[] = [];
  for (const t of uscStats(cat).stale) {
    const j = uscJobFor(t.title);
    rows.push(libRow({
      href: uscLibHref(t.title), num: uscCite(t.title), name: t.name,
      status: j ? jobStatus(j) : statPill('stale', `Behind ${cat?.release?.release_point || 'the OLRC'}`, { bare: true }),
      actions: j ? '' : `<button type="button" class="lib-act" data-act="usc-update" data-usc-title="${t.title}">Update</button>`,
    }));
  }
  for (const t of cfrLive(d).filter(isStale)) {
    const j = jobFor(t.title, 'title');
    rows.push(libRow({
      href: libHref(t.title), num: `${t.title} CFR`, name: t.name || '',
      status: j ? jobStatus(j) : statPill('stale', `Edition ${shortDate(t.latest)} available`, { bare: true }),
      actions: j ? '' : actBtn('update', 'Update', `data-title="${t.title}"`),
    }));
  }
  return rows.join('');
}

function bundleCard(s: LibrarySuite, d: LibraryCatalogData, cat: UscCatalog | null): string {
  const st = suiteState(s, d);
  const us = (s.usc_titles || []).map(n => cat?.titles.find(t => t.title === n)).filter((t): t is UscCatalogTitle => Boolean(t));
  const uBusy = us.filter(t => uscJobFor(t.title));
  const uNeeds = us.filter(t => !uscJobFor(t.title) && (!t.installed || t.installed.stale));
  const cfrTs = st.ts;
  const cfrWhole = cfrTs.filter(t => t.installed && t.installed.whole);
  const total = us.length + cfrTs.length;
  const installed = us.filter(t => t.installed).length + cfrWhole.length;
  const stale = us.filter(t => t.installed?.stale).length + cfrTs.filter(isStale).length;
  let pill: string;
  if (st.busy.length || uBusy.length) pill = statPill('busy', `${st.busy.length + uBusy.length} of ${total} in progress`);
  else if (total && installed === total && !stale) pill = statPill('synced', 'Installed');
  else if (total && installed === total) pill = statPill('stale', 'Update available');
  else if (installed) pill = statPill('partial', `${installed} of ${total} installed`);
  else pill = statPill('uninstalled', 'Not installed', { bare: true });
  const onlyUpdates = Boolean(st.label.startsWith('Update') || !st.label) && uNeeds.every(t => t.installed);
  const action = st.label || uNeeds.length
    ? actBtn('download-suite', `${icon('download')}${onlyUpdates ? 'Update bundle' : 'Download bundle'}`, `data-suite="${escapeHtml(s.id)}"`, 'is-primary') : '';
  const cfrInst = installedCfrSet();
  return `<article class="suite-card lib-bundle has-tier-bar" data-ref-tier="usc">
    <div class="story-top"><span class="story-kicker"><span class="ref-badge">BUNDLE</span>${s.badge ? `${SEP}${escapeHtml(s.badge)}` : ''}</span>${pill}</div>
    <h3 class="story-name">${escapeHtml(s.name)}</h3>
    <p class="story-dek">${escapeHtml(s.summary)}</p>
    <div class="lib-bundle-chain">
      ${us.length ? `<div class="story-links"><span class="story-links-lbl">Statutes</span>${uscChipsHtml(us)}</div>` : ''}
      <div class="story-links"><span class="story-links-lbl">Regulations</span>${cfrChipsHtml(s.titles, cfrInst)}</div>
    </div>
    <div class="story-foot"><span class="story-date">${joinSep([us.length ? plural(us.length, 'statute title') : '', plural(s.titles.length, 'CFR title'), s.size_mb ? `${fmtMB(s.size_mb)} of CFR text` : ''])}</span>${action}</div>
  </article>`;
}

function overviewHtml(d: LibraryCatalogData, cat: UscCatalog | null): string {
  const live = cfrLive(d);
  const inst = live.filter(t => t.installed);
  const u = uscStats(cat);
  const cfrSections = inst.reduce((a, t) => a + (t.installed?.section_count || 0), 0);
  const cfrBytes = inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0);
  const due = live.filter(isStale).length + u.stale.length;
  const updating = anyUpdating();
  const cells: KpiCell[] = [
    { labelHtml: 'Installed', valueHtml: `${inst.length + u.inst.length} titles`, subHtml: joinSep([`${u.inst.length} U.S.C.`, `${inst.length} CFR`]) },
    { labelHtml: 'Sections', valueHtml: escapeHtml(fmt(cfrSections + u.sections)), subHtml: joinSep([`${fmt(u.sections)} statutory`, `${fmt(cfrSections)} regulatory`]) },
    { labelHtml: 'On disk', valueHtml: escapeHtml(fmtBytes(cfrBytes + u.bytes) || '0 B'), subHtml: 'Local SQLite, readable offline' },
    due
      ? {
        labelHtml: '<span class="stat-dot is-stale" aria-hidden="true"></span>Updates', valueHtml: `${due} due`, alert: true,
        subHtml: updating ? statPill('busy', 'Updating', { bare: true }) : `<button type="button" class="metric-link is-strong" data-act="update-everything">Update all ${icon('chevronRight')}</button>`,
      }
      : { labelHtml: 'Updates', valueHtml: inst.length + u.inst.length ? 'All current' : '—', subHtml: cat?.release || !u.inst.length ? 'Against eCFR and the OLRC' : 'U.S. Code not checked yet' },
  ];
  const rows = updateRows(d, cat);
  const unchecked = u.inst.length && !cat?.release
    ? `<div class="lib-row has-note"><span class="lib-main"><span class="lib-num">U.S.C.</span><span class="lib-name">The OLRC release point hasn’t been checked yet</span></span><span class="lib-status"><button type="button" class="lib-act" data-act="usc-check">Check now</button></span><span class="lib-actions"></span></div>` : '';
  const updates = rows || unchecked
    ? `<section class="lib-band" aria-label="Updates due">${flagHtml('Updates due', due ? plural(due, 'title') : '')}<div class="lib-list lib-updates">${rows}${unchecked}</div></section>` : '';
  const suites = Object.values(d.suites || {});
  const bundles = suites.length
    ? `<section class="lib-band" aria-label="Bundles">${flagHtml('Bundles', 'Statutes with the regulations that implement them')}<div class="lib-suite-grid">${suites.map(s => bundleCard(s, d, cat)).join('')}</div></section>` : '';
  const cfrInst = installedCfrSet();
  const shelf = u.inst.map(t => uscStory(t, cfrInst)).join('') + inst.map(libStory).join('');
  const installed = `<section class="lib-band" aria-label="Installed titles">${flagHtml('On this computer', plural(inst.length + u.inst.length, 'title'))}
    ${shelf ? `<div class="lib-stories">${shelf}</div>`
      : emptyStateHtml({
        title: 'Nothing installed yet',
        body: 'Install U.S. Code titles for the statutes, CFR titles for the regulations, or a bundle above for both.',
        actionsHtml: `<a class="btn" href="${LIB_TAB_HREF.usc}">Browse the U.S. Code</a><a class="btn" href="${LIB_TAB_HREF.cfr}">Browse the CFR</a>`,
      })}</section>`;
  return `${kpiStripHtml(cells, { label: 'Library at a glance', cls: 'lib-metrics' })}${updates}${bundles}${installed}`;
}

function cfrTabHtml(d: LibraryCatalogData): string {
  const suites = Object.values(d.suites || {});
  const lead = suites.find(s => s.featured) || suites[0];
  const stale = cfrLive(d).filter(isStale);
  const updating = [state.jobs.current, ...state.jobs.queued].some(j => j && j.kind === 'update');
  return `
    ${tabLeadHtml({
      refTier: 'cfr',
      kickerHtml: '<span class="ref-badge" data-ref-tier="cfr">CFR · REGULATIONS</span><span>eCFR Versioner API</span>',
      title: 'Code of Federal Regulations',
      subHtml: 'Download whole titles, single parts or sections. Installed editions are checked against eCFR’s daily updates.',
      actionsHtml: stale.length && !updating ? `<button type="button" class="btn btn-accent" data-act="update-all">${icon('download')} Update ${plural(stale.length, 'title')}</button>` : '',
    })}
    ${libMetrics(d)}
    <div class="lib-broadsheet${lead ? '' : ' is-wire-only'}">${lead ? suiteHero(lead, d) : ''}${libWire(d)}</div>
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter titles or agencies…" aria-label="Filter titles or agencies" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
      <div class="lib-seg" role="group" aria-label="Order titles">${LIB_SORTS.map(([k, label]) =>
        `<button type="button" data-sort="${k}" aria-pressed="${lib.sort === k}">${label}</button>`).join('')}</div>
    </div>
    <div class="lib-list" id="lib-list">${libTitleList(d, lib.sort)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>No title matches. Try an agency (“OSHA”) or a topic.</div>`;
}

export function libFrontHtml(d: LibraryCatalogData, cat: UscCatalog | null = lib.usc, tab: LibTab = lib.view?.tab || 'overview'): string {
  const live = cfrLive(d);
  const inst = live.filter(t => t.installed);
  const u = uscStats(cat);
  const due = live.filter(isStale).length + u.stale.length;
  const { newest } = amendedWeek(d);
  const masthead = pageMastheadHtml({
    folioLeftHtml: `<a href="#/">Home</a>${SEP}<span>Library</span>`,
    folioRightHtml: joinSep([
      cat?.release ? `OLRC release ${escapeHtml(cat.release.release_point)}` : 'OLRC release not checked',
      newest ? `eCFR edition ${escapeHtml(shortDate(newest))}` : '',
    ]),
    title: 'Library',
    subHtml: joinSep([
      'Federal statutes and regulations on this computer',
      plural(inst.length + u.inst.length, 'title') + ' installed',
      due ? `${plural(due, 'update')} due` : '',
    ]),
    actionsHtml: (due && !anyUpdating() ? `<button type="button" class="btn btn-sm" data-act="update-everything">${icon('download')} Update all</button>` : '')
      + `<a class="btn btn-sm" href="#/news">${icon('news')} Federal Register in the Newsroom</a>`,
    tabsHtml: libTabsHtml(d, cat, tab),
  });
  const body = tab === 'usc' ? uscTabHtml(cat, lib.filter, installedCfrSet())
    : tab === 'cfr' ? cfrTabHtml(d)
      : overviewHtml(d, cat);
  return `<div class="lib lib-front pg" data-lib-tab="${tab}">
    ${masthead}
    <div id="lib-tab-body" class="pg-tab-body" role="tabpanel" aria-labelledby="lib-tab-${tab}">${body}</div>
  </div>`;
}

function renderFront(fresh: boolean): void {
  const d = lib.data as LibraryCatalogData;
  const tab = lib.view?.tab || 'overview';
  document.title = `${tab === 'usc' ? 'U.S. Code · ' : tab === 'cfr' ? 'CFR · ' : ''}Library · FRAMEWORK`;
  const scrollTop = dom.main.scrollTop;
  // A re-render replaces the tabs, so keep keyboard focus on the tablist when it was there.
  const keepTabFocus = lib.focusTab || Boolean(document.activeElement?.closest('#lib-tabs'));
  const html = libFrontHtml(d, lib.usc, tab);
  const shell = !fresh && dom.view.querySelector<HTMLElement>(`.lib-front[data-lib-tab="${tab}"]`);
  if (shell) {
    // Patch in place: the filter box (and its focus and caret) stays the same element.
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const next = tmp.firstElementChild as HTMLElement;
    shell.querySelector('.pg-masthead')?.replaceWith(next.querySelector('.pg-masthead')!);
    const body = shell.querySelector('#lib-tab-body');
    const nextBody = next.querySelector('#lib-tab-body');
    const tools = body?.querySelector(':scope > .lib-tools');
    if (body && nextBody) {
      const nodes = [...nextBody.children].map(n => (tools && n.classList.contains('lib-tools') ? tools : n));
      body.replaceChildren(...nodes);
    }
    for (const btn of shell.querySelectorAll<HTMLElement>('.lib-seg [data-sort]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.sort === lib.sort));
    }
    applyLibraryFilter();
    dom.main.scrollTop = scrollTop;
  } else {
    dom.view.innerHTML = html;
    applyLibraryFilter();
    if (fresh) enterView();
    else dom.main.scrollTop = scrollTop;
  }
  if (keepTabFocus) {
    lib.focusTab = false;
    document.getElementById(`lib-tab-${tab}`)?.focus();
  }
}

function renderUscDetail(fresh: boolean): void {
  const title = lib.view?.title || 0;
  const t = lib.usc?.titles.find(x => x.title === title);
  const tree = lib.uscTree && lib.uscTree.title === title ? lib.uscTree.tree : null;
  if (!t) {
    dom.view.innerHTML = emptyStateHtml({
      title: `U.S. Code Title ${title} isn’t in the catalog`,
      body: 'Titles are numbered 1 to 54, and 53 is reserved.',
      actionsHtml: `<a class="btn" href="${LIB_TAB_HREF.usc}">All U.S. Code titles</a>`,
    });
    return;
  }
  document.title = `${uscCite(title)} · Library · FRAMEWORK`;
  const scrollTop = dom.main.scrollTop;
  const html = `<div class="lib lib-usc-title pg" data-lib-view="usc|${title}">
    ${pageMastheadHtml({
      folioLeftHtml: `<a href="#/">Home</a>${SEP}<a href="#/library">Library</a>${SEP}<a href="${LIB_TAB_HREF.usc}">U.S. Code</a>`,
      folioRightHtml: `<span>${escapeHtml(uscCite(title))}</span>${SEP}${uscStatusPill(t, true)}`,
      title: `Title ${title} — ${t.name}`,
      subHtml: uscDetailSub(t),
      actionsHtml: uscDetailActions(t, tree),
    })}
    <div class="pg-tab-body">${uscDetailBodyHtml(t, tree, installedCfrSet())}</div>
  </div>`;
  const filterEl = document.getElementById('lib-filter') as HTMLInputElement | null;
  const keep = !fresh && filterEl && dom.view.querySelector(`.lib[data-lib-view="usc|${title}"]`);
  dom.view.innerHTML = html;
  if (keep) {
    const next = document.getElementById('lib-filter') as HTMLInputElement | null;
    if (next) next.value = lib.filter;
  }
  applyLibraryFilter();
  if (fresh) enterView();
  else dom.main.scrollTop = scrollTop;
}

bindSwitchboardKeys('#lib-tabs', 'lib-tab', () => LIB_TAB_ORDER, (id) => {
  lib.focusTab = true;
  window.location.hash = LIB_TAB_HREF[id as LibTab] || LIB_TAB_HREF.overview;
});

export function renderLibrary(fresh: boolean): void {
  if (!lib.view) return;
  const { tab, title, part } = lib.view;
  if (tab === 'usc' && title) {
    renderUscDetail(fresh);
    return;
  }
  if (!lib.data) return;
  if (!title) {
    renderFront(fresh);
    return;
  }
  const scrollTop = dom.main.scrollTop;

  let crumbs: string, heading: string, sub: string, head = '', body = '', placeholder: string;

  if (!part) {
    const d = lib.data as LibraryTitleDetailResponse;
    document.title = `Title ${title} · Library · FRAMEWORK`;
    const inst = d.installed;
    crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${LIB_TAB_HREF.cfr}">CFR</a>`;
    heading = `Title ${title} — ${d.name || ''}`;
    sub = inst
      ? (inst.whole ? `Installed · ${fmtDate(inst.edition)} · ${fmt(inst.section_count)} sections`
        : `Partly installed · ${fmt(inst.section_count)} ${inst.section_count === 1 ? 'section' : 'sections'}`)
      : `Not installed · eCFR edition ${fmtDate(d.latest)}`;
    placeholder = 'Filter parts';
    const j = jobFor(title, 'title');
    head = d.reserved ? '' : j ? `<span class="lib-head-status">${jobStatus(j)}</span>`
      : (inst && inst.whole ? `<a class="btn" href="#/title/${title}/">Open in reader</a>`
        : `<button type="button" class="btn" data-act="download" data-title="${title}">${icon('download')} Download whole title</button>`);
    body = d.groups.map(g => `
      ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ''}
      ${g.parts.map(p => {
        const pj = jobFor(title, 'part', p.id);
        if (p.r || !p.leaves) return libRow({ num: p.l.replace(/^Parts?\s+/, ''), name: p.d || 'Reserved', status: 'Reserved', dim: true });
        const status = p.installed === 'all' ? statPill('synced', 'Installed', { bare: true })
          : p.installed === 'some' ? statPill('partial', `${p.installed_sections} of ${fmt(p.leaves)}`, { bare: true, title: 'Sections installed' })
          : escapeHtml(fmtSections(p.leaves));
        const acts = p.installed === 'all'
          ? `<a class="lib-act" href="#/title/${title}/part/${encodeURIComponent(p.id)}">Open</a>`
          : actBtn('download', 'Download part', `data-title="${title}" data-part="${escapeHtml(p.id)}"`);
        return libRow({ href: libHref(title, p.id), num: p.id, name: p.d || p.l, status: pj ? jobStatus(pj) : status, actions: pj ? '' : acts, key: `p${p.id}` });
      }).join('')}`).join('');
  } else {
    const d = lib.data as LibraryPartDetailResponse;
    document.title = `Part ${part} · Library · FRAMEWORK`;
    crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${LIB_TAB_HREF.cfr}">CFR</a><span class="sep" aria-hidden="true">›</span><a href="${libHref(title)}">Title ${title}</a>`;
    heading = `${d.l} — ${d.d || ''}`;
    const count = d.groups.reduce((a, g) => a + g.sections.filter(s => !s.r).length, 0);
    const countText = fmtSections(count) || '0 sections';
    sub = d.installed === 'all' ? `Installed · ${countText}` : d.installed === 'some' ? `Partly installed · ${countText}` : countText;
    placeholder = 'Filter sections';
    const j = jobFor(title, 'part', part);
    head = j ? `<span class="lib-head-status">${jobStatus(j)}</span>`
      : d.installed === 'all' ? `<a class="btn" href="#/title/${title}/part/${encodeURIComponent(part)}">Open in reader</a>`
      : `<button type="button" class="btn" data-act="download" data-title="${title}" data-part="${escapeHtml(part)}">${icon('download')} Download part</button>`;
    body = d.groups.map(g => `
      ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ''}
      ${g.sections.map(s => {
        const num = s.t === 'appendix' ? s.l : s.l.replace(/^§\s*/, '');
        const name = s.t === 'appendix' ? (s.d && s.d !== s.l ? s.d.replace(s.l, '').replace(/^\s*[—–-]\s*/, '') : '') : (s.d || '');
        if (s.r) return libRow({ num, name: name || 'Reserved', status: 'Reserved', dim: true });
        const sj = jobFor(title, 'section', s.id);
        const acts = s.installed
          ? `<a class="lib-act" href="#/title/${title}/section/${encodeURIComponent(s.id)}">Open</a>`
          : actBtn('download', 'Download', `data-title="${title}" data-part="${escapeHtml(part)}" data-section="${escapeHtml(s.id)}" data-kind="${s.t}"`);
        return libRow({ num, name, status: sj ? jobStatus(sj) : (s.installed ? statPill('synced', 'Installed', { bare: true }) : ''), actions: sj ? '' : acts, key: `s${s.id}` });
      }).join('')}`).join('');
  }

  const viewKey = `${title}|${part || ''}`;
  const curShell = !fresh && dom.view.querySelector(`.lib[data-lib-view="${CSS.escape(viewKey)}"]`);
  if (curShell) {
    const subEl = document.getElementById('lib-sub-slot');
    const headEl = document.getElementById('lib-head-act-slot');
    const listEl = document.getElementById('lib-list');
    if (subEl) subEl.textContent = sub;
    if (headEl) headEl.innerHTML = head;
    if (listEl) listEl.innerHTML = body;
    applyLibraryFilter();
    dom.main.scrollTop = scrollTop;
    return;
  }

  dom.view.innerHTML = `
    <div class="lib" data-lib-view="${escapeHtml(viewKey)}">
      <div class="doc-kicker">${crumbs}</div>
      <div class="lib-head">
        <div class="lib-head-text">
          <h1 class="doc-title">${escapeHtml(heading)}</h1>
          <p class="lib-sub" id="lib-sub-slot">${escapeHtml(sub)}</p>
        </div>
        <span id="lib-head-act-slot">${head}</span>
      </div>
      ${!part && authorizedBy(title, lib.usc).length ? `<section class="lib-links-band" aria-label="Authorizing statutes"><span class="story-links-lbl">Authorized by</span>${uscChipsHtml(authorizedBy(title, lib.usc))}</section>` : ''}
      <input class="lib-filter" id="lib-filter" type="search" placeholder="${placeholder}…" aria-label="${placeholder}" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
      <div class="lib-list" id="lib-list">${body}</div>
      <div class="lib-none" id="lib-none" aria-live="polite" hidden>Nothing matches.</div>
    </div>`;
  applyLibraryFilter();
  if (fresh) enterView();
  else dom.main.scrollTop = scrollTop;
}

export function applyLibraryFilter(): void {
  const words = lib.filter.toLowerCase().split(/\s+/).filter(Boolean);
  const list = document.getElementById('lib-list');
  const noneEl = document.getElementById('lib-none');
  if (!list) return;
  if (list.querySelector('.lib-story')) {
    // Front page: briefs filter in place; each desk hides when none match and its count
    // says how many do. The masthead, suites and wire stay put above the list.
    let n = 0;
    for (const desk of list.querySelectorAll<HTMLElement>('.lib-desk')) {
      let k = 0;
      for (const el of desk.querySelectorAll<HTMLElement>('.lib-story')) {
        const ok = words.every(w => (el.dataset.hay || '').includes(w));
        el.hidden = !ok;
        if (ok) k++;
      }
      desk.hidden = k === 0;
      const total = desk.querySelectorAll('.lib-story').length;
      const count = desk.querySelector('.lib-desk-count');
      if (count) count.textContent = words.length && k !== total ? `${k} of ${plural(total, 'title')}` : plural(total, 'title');
      n += k;
    }
    if (noneEl) noneEl.hidden = n > 0;
    return;
  }
  let shown = 0;
  let label: HTMLElement | null = null;
  let labelHas = false;
  const closeLabel = () => { if (label) label.hidden = !labelHas; };
  for (const child of list.children) {
    const el = child as HTMLElement;
    if (el.classList.contains('lib-label')) {
      closeLabel();
      label = el;
      labelHas = false;
      continue;
    }
    const hay = el.dataset.hay || '';
    const ok = words.every(w => hay.includes(w));
    el.hidden = !ok;
    if (ok) { shown++; labelHas = true; }
  }
  closeLabel();
  if (noneEl) noneEl.hidden = shown > 0;
}

onView('input', (e) => {
  const target = e.target as HTMLInputElement | null;
  if (!target || target.id !== 'lib-filter') return;
  lib.filter = target.value;
  applyLibraryFilter();
});

// Ordering: the segmented control, and the "Show" / "All titles by last amendment" links in
// the metrics and the wire, which jump to the list ordered by amendment.
onView('click', (e) => {
  const target = e.target as Element | null;
  const sortBtn = target?.closest<HTMLButtonElement>('button[data-sort]');
  if (!sortBtn || !dom.view.querySelector('.lib')?.contains(sortBtn)) return;
  const fromSeg = Boolean(sortBtn.closest('.lib-seg'));
  const nextSort = sortBtn.dataset.sort;
  if ((nextSort === 'desk' || nextSort === 'number' || nextSort === 'updated') && nextSort !== lib.sort) {
    lib.sort = nextSort;
    lsSet('libSort', lib.sort);
    renderLibrary(false);
  }
  if (fromSeg) dom.view.querySelector<HTMLElement>(`.lib-seg [data-sort="${lib.sort}"]`)?.focus();
  else {
    const tools = dom.view.querySelector('.lib-tools');
    if (tools) tools.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
});

on('jobs:updated', (snap) => {
  if (!dom.view.querySelector('.lib')) return;
  const activeJobs = [snap.current, ...(snap.queued || [])].filter((j): j is TransferJob => Boolean(j));
  const key = activeJobs.map(j => `${j.id}${j.state[0]}`).join(',');
  if (key !== state.lastJobsKey) {
    state.lastJobsKey = key;
    renderLibrary(false);
  }
});

on('jobs:finished', () => {
  if (dom.view.querySelector('.lib')) refreshLibrary();
});

onView('click', async (e) => {
  const target = e.target as Element | null;
  const btn = target?.closest<HTMLButtonElement>('button[data-act]');
  if (!btn || !dom.view.querySelector('.lib')?.contains(btn)) return;
  const isUsc = btn.dataset.uscTitle !== undefined;
  const title = parseInt((isUsc ? btn.dataset.uscTitle : btn.dataset.title) || '', 10);
  const act = btn.dataset.act;
  if (act === 'remove' || act === 'usc-remove') {
    const what = act === 'usc-remove' ? `${title} U.S.C.` : `Title ${title}`;
    // Two clicks: the first arms the button for a few seconds.
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'Confirm remove';
      announce(`Press again to confirm removing ${what}`);
      clearTimeout(removeTimers.get(btn));
      removeTimers.set(btn, setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = 'Remove'; }, 4000));
      return;
    }
    btn.disabled = true;
    try {
      if (act === 'usc-remove') {
        await getJSON(`/api/usc/${title}`, { method: 'DELETE' });
        showToast(`Removed ${what}`);
      } else {
        await getJSON(`/api/library/${title}`, { method: 'DELETE' });
        invalidateTitleCaches([title]);
        showToast(`Removed ${what}`);
        await refreshTitles();
      }
      await refreshLibrary();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 5000);
      btn.disabled = false;
    }
    return;
  }
  btn.disabled = true;
  try {
    if (act === 'download-suite') {
      await queueBatch('/api/library/batch-download', { suite: btn.dataset.suite }, 'Every title in this suite is installed and current');
      return;
    }
    if (act === 'update-all') {
      await queueBatch('/api/library/update-all', null, 'Every installed title is already current');
      return;
    }
    if (act === 'usc-check') {
      // The one explicit network check for the U.S. Code: ask the OLRC for its release point.
      try {
        const r = await getJSON<{ release_point: string; titles: Array<{ stale: boolean }> }>('/api/usc/release?refresh=true');
        const behind = r.titles.filter(t => t.stale).length;
        showToast(behind ? `${behind} U.S. Code ${behind === 1 ? 'title is' : 'titles are'} behind release point ${r.release_point}` : `U.S. Code is current (release point ${r.release_point})`);
      } finally {
        await refreshLibrary();
      }
      return;
    }
    if (act === 'usc-update-all') {
      await queueBatch('/api/usc/update-all', null, 'Every installed U.S. Code title is already current');
      return;
    }
    if (act === 'update-everything') {
      const cfr = await getJSON<{ queued?: TransferJob[] }>('/api/library/update-all', { method: 'POST' });
      const usc = await getJSON<{ queued?: TransferJob[] }>('/api/usc/update-all', { method: 'POST' }).catch(() => ({ queued: [] as TransferJob[] }));
      const queued = [...(cfr.queued || []), ...(usc.queued || [])];
      for (const j of queued) state.jobsSeenActive.add(j.id);
      if (!queued.length) {
        showToast('Everything installed is already current');
        btn.disabled = false;
      }
      await pollJobs();
      return;
    }
    if (act === 'usc-download' || act === 'usc-update') {
      const job = await getJSON<{ job: TransferJob }>('/api/usc/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      state.jobsSeenActive.add(job.job.id);
      await pollJobs();
      return;
    }
    const job = act === 'update'
      ? await getJSON<TransferJob>(`/api/library/${title}/update`, { method: 'POST' })
      : await getJSON<TransferJob>('/api/library/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          part: btn.dataset.part || null,
          section: btn.dataset.section || null,
          kind: btn.dataset.kind === 'appendix' ? 'appendix' : 'section',
        }),
      });
    state.jobsSeenActive.add(job.id);
    await pollJobs();
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), 5000);
    btn.disabled = false;
  }
});
