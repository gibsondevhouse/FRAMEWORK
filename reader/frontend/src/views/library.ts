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
  SEP, fmtBytes, fmtDate, fmtMB, fmtSections, joinSep, metricCardHtml,
  emptyStateHtml, shortDate, statPill,
} from '../components/ui';
export {
  SEP, amendedWeek, fmtBytes, fmtDate, fmtMB, fmtSections, getJSON, isStale,
  jobFor, jobStatus, joinSep, pollJobs, pollJobsIfActive, queueBatch, setJobs,
  shortDate, statPill, suiteState, titleStatus,
};
import { corpusHashFor, refTierForCorpus, TIER_META, TIER_ORDER } from '../components/corpora';

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

export interface LibViewState {
  view: { title: number | null; part: string | null } | null;
  data: LibraryCatalogData | LibraryTitleDetailResponse | LibraryPartDetailResponse | null;
  filter: string;
  sort: LibSort;
  tier: string;
  wire: { at: number; items: WireItem[]; failed?: boolean } | null;
  extraCorporaCount?: number;
}

// --- Library: download titles, parts or sections from eCFR (#/library…) ---
// Three levels, like the sidebar: every title → one title's parts → one part's sections.
// Row actions (Download, Open, Update, Remove) appear on hover or focus. Downloads queue on
// the server and run one at a time; `jobs` polls while any are active, wherever you are,
// and refreshes the title list (and this page) as each finishes.
export const lib: LibViewState = { view: null, data: null, filter: '', sort: 'desk', tier: 'all', wire: null };

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

export async function loadLibrary(title?: number | null, part?: string | null): Promise<void> {
  const normTitle = title ?? null;
  const normPart = part ?? null;
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  const sameView = Boolean(lib.view && lib.view.title === normTitle && lib.view.part === normPart);
  if (!sameView) {
    lib.filter = '';
    dom.view.innerHTML = skeletonHtml(normTitle ? 'list' : 'cards', 'Loading from eCFR…');
  }
  lib.view = { title: normTitle, part: normPart };
  try {
    const url = normPart
      ? `/api/library/${normTitle}/part/${encodeURIComponent(normPart)}`
      : normTitle ? `/api/library/${normTitle}` : '/api/library';
    const data = await getJSON<LibraryCatalogData & LibraryTitleDetailResponse & LibraryPartDetailResponse>(url);
    if (seq !== state.routeSeq) return;
    if (!normTitle) setJobs(data.jobs);
    lib.data = data;
    renderLibrary(!sameView);
    if (!normTitle) {
      pollJobsIfActive();
      loadWire();
    }
  } catch (err) {
    if (seq !== state.routeSeq) return;
    const message = err instanceof Error ? err.message : String(err);
    dom.view.innerHTML = emptyStateHtml({
      title: 'Couldn’t load the library',
      body: escapeHtml(message),
      actionsHtml: '<button type="button" class="btn" id="lib-retry">Try again</button>',
    });
    document.getElementById('lib-retry')?.addEventListener('click', () => loadLibrary(normTitle, normPart));
  }
}

// Refetch the page's data in place (after a download or removal), keeping filter and scroll.
export async function refreshLibrary(): Promise<void> {
  if (!lib.view || !dom.view.querySelector('.lib')) return;
  const { title, part } = lib.view;
  try {
    const url = part
      ? `/api/library/${title}/part/${encodeURIComponent(part)}`
      : title ? `/api/library/${title}` : '/api/library';
    lib.data = await getJSON<LibraryCatalogData | LibraryTitleDetailResponse | LibraryPartDetailResponse>(url);
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
  '#/library' + (title ? `/${title}` : '') + (part ? `/part/${encodeURIComponent(part)}` : '');

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
  const hay = `${t.title} title ${t.name || ''} ${t.summary || ''} ${t.desk || ''} ${(t.agencies || []).join(' ')}`.toLowerCase();
  return `<article class="lib-story has-tier-bar${t.reserved ? ' is-dim' : ''}" data-ref-tier="cfr" data-hay="${escapeHtml(hay)}">
    <div class="story-top"><span class="story-kicker">${kicker}</span>${renderStatusPill(t, { bare: !inst })}</div>
    <h3 class="story-name">${headline}</h3>
    ${t.summary ? `<p class="story-dek">${escapeHtml(t.summary)}</p>` : ''}
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
  return `<section class="lib-metrics" aria-label="Library at a glance">
    ${metricCardHtml({
      label: '<span class="stat-dot is-synced" aria-hidden="true"></span>eCFR',
      value: 'Online',
      sub: d.checked_at ? `Title list checked ${escapeHtml(relTime(d.checked_at * 1000))}` : `${live.length} titles tracked`,
    })}
    ${metricCardHtml({
      label: 'Installed',
      value: String(inst.length),
      of: `of ${live.length}`,
      sub: joinSep([fmtSections(sections) || 'No sections yet', bytes ? `${fmtBytes(bytes)} on disk` : '']),
    })}
    ${metricCardHtml({
      label: 'Amended this week',
      value: String(recent),
      sub: cut ? `Since ${escapeHtml(shortDate(cut))}${recent ? `${SEP}<button type="button" class="metric-link" data-sort="updated">Show</button>` : ''}` : 'No edition date',
    })}
    ${stale.length
      ? metricCardHtml({
        label: '<span class="stat-dot is-stale" aria-hidden="true"></span>Editions',
        value: `${stale.length} outdated`,
        sub: updating ? statPill('busy', 'Updating', { bare: true })
          : `<button type="button" class="metric-link is-strong" data-act="update-all">Update all ${icon('chevronRight')}</button>`,
        alert: true,
      })
      : metricCardHtml({
        label: 'Editions',
        value: inst.length ? 'Current' : '—',
        sub: inst.length ? 'Every installed title is up to date' : 'Nothing installed yet',
      })}
  </section>`;
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
    <div class="story-top"><span class="story-kicker"><span class="ref-badge">FEDERAL CFR PACK</span>${s.badge ? `${SEP}${escapeHtml(s.badge)}` : ''}</span>${st.pill}</div>
    <h2 class="suite-title" id="suite-${escapeHtml(s.id)}">${escapeHtml(s.name)}</h2>
    <p class="suite-dek">${escapeHtml(s.summary)}</p>
    <ul class="suite-rows">${rows}</ul>
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

const LIB_TIER_TABS = [
  { id: 'all', label: 'All Authorities', refTier: 'cfr' },
  { id: 'federal-statute', label: 'U.S. Code', refTier: 'usc' },
  { id: 'federal-reg', label: 'Federal CFR', refTier: 'cfr' },
  { id: 'state', label: 'States', refTier: 'state' },
  { id: 'county', label: 'Counties', refTier: 'county' },
  { id: 'standard', label: 'Standards', refTier: 'ibr' },
];

const TIER_CONNECTOR_NOTES: Record<string, string> = {
  'federal-statute': 'United States Code (U.S.C.) XML packs (OSH Act, RCRA, Clean Air Act) plug in alongside CFR cross-links.',
  'state': 'State administrative codes and OSHA-approved State Plans (e.g. Cal/OSHA 8 CCR, WA WAC) attach via CorpusSummary.',
  'county': 'County and municipal fire, air-quality, and health ordinances attach under State jurisdiction feeds.',
  'standard': 'Consensus standards (ANSI, NFPA, ASTM, ASME) currently resolve via section peeks and each Title Start Almanac.',
};

export function libTierTabsHtml(d: LibraryCatalogData): string {
  const cfrCount = (d.titles || []).filter(t => !t.reserved).length;
  const extras = state.extraCorpora || [];
  const countFor = (id: string) => {
    if (id === 'all') return cfrCount + extras.length;
    if (id === 'federal-reg') return cfrCount + extras.filter(c => c.tier === 'federal-reg').length;
    return extras.filter(c => c.tier === id).length;
  };
  const populated = LIB_TIER_TABS.filter(t => t.id === 'all' || countFor(t.id) > 0);
  if (populated.length <= 2) return '';
  return `<div class="lib-tier-bar" role="tablist" aria-label="Filter catalog by authority tier">${populated.map(t => {
    const on = lib.tier === t.id;
    const count = countFor(t.id);
    return `<button type="button" role="tab" aria-selected="${on}" class="lib-tier-tab${on ? ' is-active' : ''}" data-ref-tier="${t.refTier}" data-lib-tier="${t.id}">
      <span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(t.label)}</span>${count ? `<span class="lib-tier-count">${count}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}

function libPlannedConnectorsHtml(): string {
  const extras = state.extraCorpora || [];
  const planned = LIB_TIER_TABS.filter(t => t.id !== 'all' && t.id !== 'federal-reg' && !extras.some(c => c.tier === t.id));
  if (!planned.length) return '';
  return `<details class="lib-planned">
    <summary><span>Planned jurisdiction connectors</span><span class="lib-planned-sub">${planned.length} pre-wired authority layers</span></summary>
    <div class="lib-planned-grid">${planned.map(t => `
      <div class="lib-planned-item" data-ref-tier="${t.refTier}">
        <div class="lib-planned-head"><span class="tier-pip is-hollow" aria-hidden="true"></span><span>${escapeHtml(t.label)}</span></div>
        <p class="lib-planned-desc">${escapeHtml(TIER_CONNECTOR_NOTES[t.id] || 'Ingestion pack pending.')}</p>
      </div>`).join('')}</div>
  </details>`;
}

function libExtraTierBodyHtml(tierId: string): string {
  const meta = TIER_META[tierId] || TIER_META['state'];
  const matches = (state.extraCorpora || []).filter(c => c.tier === tierId);
  if (matches.length) {
    return `<section class="lib-desk" aria-label="${escapeHtml(meta.label)}">
      <header class="lib-desk-header"><h3 class="lib-desk-name">${escapeHtml(meta.label)}</h3><span class="lib-desk-count">${plural(matches.length, 'corpus')}</span></header>
      <div class="lib-stories">${matches.map(c => `
        <article class="lib-story has-tier-bar" data-ref-tier="${refTierForCorpus(c)}">
          <div class="story-top"><span class="story-kicker"><span class="ref-badge">${escapeHtml(meta.tag)}</span>${SEP}${escapeHtml(c.jurisdiction_label || c.jurisdiction)}</span>${statPill('synced', 'Ready')}</div>
          <h3 class="story-name"><a href="${escapeHtml(corpusHashFor(c))}">${escapeHtml(c.code)} — ${escapeHtml(c.name)}</a></h3>
          ${c.summary ? `<p class="story-dek">${escapeHtml(c.summary)}</p>` : ''}
          <div class="story-foot"><span class="story-date">${escapeHtml((c.agencies || []).join(' · ') || meta.label)}</span><div class="story-actions"><a class="lib-act" href="${escapeHtml(corpusHashFor(c))}">Open</a></div></div>
        </article>`).join('')}</div></section>`;
  }
  const tierDescriptions: Record<string, string> = {
    'federal-statute': 'United States Code (U.S.C.) XML statutory packs (Title 29 OSH Act/FLSA, Title 42 EPA statutes, Title 49 Transportation) plug directly into this catalog slot alongside CFR cross-links.',
    'state': 'State administrative codes and OSHA-approved State Plans (e.g., California 8 CCR, Texas TAC, Washington WAC) share the same CorpusSummary contract and search facets.',
    'county': 'County and municipal fire, air-quality, and environmental health ordinances attach under State feeds using jurisdiction codes like US-CA-LA.',
    'standard': 'Incorporated consensus standards (ANSI, NFPA, ASTM, ASME) currently resolve inside section peeker popovers and each Title Start Almanac.',
  };
  return `<section class="resolver-card is-catalog-slot has-tier-bar" data-ref-tier="${meta.refTier}">
    <div class="doc-kicker"><span class="ref-badge">${escapeHtml(meta.tag)}</span>${SEP}Catalog Slot Pre-Wired</div>
    <h2 class="doc-title">${escapeHtml(meta.label)}</h2>
    <p class="resolver-msg">${escapeHtml(tierDescriptions[tierId] || 'Backend ingestion pack pending.')}</p>
    <div class="resolver-acts">
      <button type="button" class="btn btn-accent" data-lib-tier="federal-reg">View Federal CFR Catalog</button>
      <a class="btn" href="#/title/${state.currentTitle}/">Open ${state.currentTitle} CFR Almanac</a>
    </div>
  </section>`;
}

export function libFrontHtml(d: LibraryCatalogData): string {
  const live = d.titles.filter(t => !t.reserved);
  const { newest, recent } = amendedWeek(d);
  const sub = joinSep([
    'Multi-Jurisdiction Regulatory Catalog',
    newest ? `Edition ${escapeHtml(fmtDate(newest))}` : '',
    `${live.length} CFR titles`,
    recent ? `${recent} amended this week` : 'No amendments this week',
  ]);
  const suites = Object.values(d.suites || {});
  const lead = suites.find(s => s.featured) || suites[0];
  const others = suites.filter(s => s !== lead);
  const showCfr = lib.tier === 'all' || lib.tier === 'federal-reg';
  const extraTiers = TIER_ORDER.filter(t => t !== 'federal-reg' && Boolean(lib.extraCorporaCount || (state.extraCorpora || []).some(c => c.tier === t)));
  const cfrBody = `
    <div class="lib-broadsheet${lead ? '' : ' is-wire-only'}">${lead ? suiteHero(lead, d) : ''}${libWire(d)}</div>
    ${others.length ? `<section class="lib-suites" aria-label="More compliance suites">
      <header class="lib-desk-header"><h2 class="lib-desk-name">Jurisdiction Packs</h2><span class="lib-desk-count">${plural(others.length, 'pack')}</span></header>
      <div class="lib-suite-grid">${others.map(s => suiteCard(s, d)).join('')}</div></section>` : ''}
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter titles or agencies…" aria-label="Filter titles or agencies" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
      <div class="lib-seg" role="group" aria-label="Order titles">${LIB_SORTS.map(([k, label]) =>
        `<button type="button" data-sort="${k}" aria-pressed="${lib.sort === k}">${label}</button>`).join('')}</div>
    </div>
    <div class="lib-list" id="lib-list">${libTitleList(d, lib.sort)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>No title matches. Try an agency (“OSHA”) or a topic.</div>`;

  return `<div class="lib lib-front">
    <div class="doc-kicker"><a href="#/">Home</a></div>
    <header class="lib-masthead">
      <h1 class="doc-title">Library</h1>
      <p class="lib-sub">${sub}</p>
    </header>
    ${libMetrics(d)}
    ${libTierTabsHtml(d)}
    ${showCfr ? cfrBody : libExtraTierBodyHtml(lib.tier)}
    ${lib.tier === 'all' && extraTiers.length ? extraTiers.map(libExtraTierBodyHtml).join('') : ''}
    ${libPlannedConnectorsHtml()}
  </div>`;
}

export function renderLibrary(fresh: boolean): void {
  if (!lib.view || !lib.data) return;
  const { title, part } = lib.view;
  const scrollTop = dom.main.scrollTop;

  if (!title) {
    const d = lib.data as LibraryCatalogData;
    document.title = 'Library · FRAMEWORK';
    const existingList = !fresh && document.getElementById('lib-list');
    const frontShell = dom.view.querySelector('.lib-front');
    if (existingList && frontShell) {
      const tmp = document.createElement('div');
      tmp.innerHTML = libFrontHtml(d);
      const nextMetrics = tmp.querySelector('.lib-metrics');
      const curMetrics = frontShell.querySelector('.lib-metrics');
      if (nextMetrics && curMetrics) curMetrics.replaceWith(nextMetrics);
      const nextBroad = tmp.querySelector('.lib-broadsheet');
      const curBroad = frontShell.querySelector('.lib-broadsheet');
      if (nextBroad && curBroad) curBroad.replaceWith(nextBroad);
      const nextSuites = tmp.querySelector('.lib-suites');
      const curSuites = frontShell.querySelector('.lib-suites');
      if (nextSuites && curSuites) curSuites.replaceWith(nextSuites);
      for (const btn of frontShell.querySelectorAll<HTMLElement>('.lib-seg [data-sort]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.sort === lib.sort));
      }
      existingList.innerHTML = libTitleList(d, lib.sort);
      applyLibraryFilter();
      dom.main.scrollTop = scrollTop;
      return;
    }
    dom.view.innerHTML = libFrontHtml(d);
    applyLibraryFilter();
    if (fresh) enterView();
    else dom.main.scrollTop = scrollTop;
    return;
  }

  let crumbs: string, heading: string, sub: string, head = '', body = '', placeholder: string;

  if (!part) {
    const d = lib.data as LibraryTitleDetailResponse;
    document.title = `Title ${title} · Library · FRAMEWORK`;
    const inst = d.installed;
    crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a>`;
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
    crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${libHref(title)}">Title ${title}</a>`;
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
  const tierBtn = target?.closest<HTMLButtonElement>('button[data-lib-tier]');
  if (tierBtn && lib.data && dom.view.querySelector('.lib-front')?.contains(tierBtn)) {
    lib.tier = tierBtn.dataset.libTier || 'all';
    dom.view.innerHTML = libFrontHtml(lib.data as LibraryCatalogData);
    applyLibraryFilter();
    return;
  }
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
  const title = parseInt(btn.dataset.title || '', 10);
  const act = btn.dataset.act;
  if (act === 'remove') {
    // Two clicks: the first arms the button for a few seconds.
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'Confirm remove';
      announce(`Press again to confirm removing Title ${title}`);
      clearTimeout(removeTimers.get(btn));
      removeTimers.set(btn, setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = 'Remove'; }, 4000));
      return;
    }
    btn.disabled = true;
    try {
      await getJSON(`/api/library/${title}`, { method: 'DELETE' });
      invalidateTitleCaches([title]);
      showToast(`Removed Title ${title}`);
      await refreshTitles();
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
