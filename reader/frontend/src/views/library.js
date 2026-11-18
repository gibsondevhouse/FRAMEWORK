import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection, plural } from '../components/sidebar';
import { refreshTitles, updateDock } from '../components/transfer_dock';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsSet, reduceMotion, showToast, skeletonHtml } from '../dom';
import { drawerShown, navState } from '../nav';
import { ensureNavLibrary, navLib, renderLibraryPanel, updateNavTransfers } from '../panels/library_panel';
import { onSettingsPage, refreshSettingsViews } from '../panels/settings_panel';
import { dom } from '../state_init';
import { fmt } from '../usage';
import { HOME_CONTENT } from '../views/core';
import { refreshHomeIfActive } from '../views/home';
import {
  SEP, fmtBytes, fmtDate, fmtMB, fmtSections, joinSep, metricCardHtml,
  emptyStateHtml, shortDate, statPill,
} from '../components/ui';
export { SEP, fmtBytes, fmtDate, fmtMB, fmtSections, joinSep, shortDate, statPill };
import { refreshWelcome } from './welcome';
import { corpusHashFor, refTierForCorpus, TIER_META, TIER_ORDER } from '../components/corpora';

// --- Library: download titles, parts or sections from eCFR (#/library…) ---
// Three levels, like the sidebar: every title → one title's parts → one part's sections.
// Row actions (Download, Open, Update, Remove) appear on hover or focus. Downloads queue on
// the server and run one at a time; `jobs` polls while any are active, wherever you are,
// and refreshes the title list (and this page) as each finishes.
export const lib = { view: null, data: null, filter: '', sort: 'desk', tier: 'all', wire: null };

try {
  const saved = localStorage.getItem('libSort');
  if (['desk', 'number', 'updated'].includes(saved)) lib.sort = saved;
} catch (e) { /* storage unavailable: default order */ }

state.jobs = { current: null, queued: [], recent: [] };

state.jobsTimer = null;

state.jobsSeenActive = new Set();
 // ids of jobs this page has seen queued or running
state.lastJobsKey = '';


// --- Status: a 6px dot and a word, Linear's issue-status vocabulary (`.stat-pill`) ---
// Re-exported from components/ui.js for compatibility across existing callers.

export const isStale = (t) => Boolean(t.installed && t.latest && t.installed.edition && t.latest > t.installed.edition);

export const jobStatus = (j) => j ? statPill('busy', j.state === 'running' ? 'Downloading' : 'Queued', { bare: true }) : '';


export async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error((body && body.detail) || `Request failed (${res.status})`);
  return body;
}


export async function loadLibrary(title, part) {
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  const sameView = lib.view && lib.view.title === title && lib.view.part === part;
  if (!sameView) {
    lib.filter = '';
    dom.view.innerHTML = skeletonHtml(title ? 'list' : 'cards', 'Loading from eCFR…');
  }
  lib.view = { title, part };
  try {
    const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : title ? `/api/library/${title}` : '/api/library';
    const data = await getJSON(url);
    if (seq !== state.routeSeq) return;
    if (!title) setJobs(data.jobs);
    lib.data = data;
    renderLibrary(!sameView);
    if (!title) {
      pollJobsIfActive();
      loadWire();
    }
  } catch (err) {
    if (seq !== state.routeSeq) return;
    dom.view.innerHTML = emptyStateHtml({
      title: 'Couldn’t load the library',
      body: escapeHtml(err.message),
      actionsHtml: '<button type="button" class="btn" id="lib-retry">Try again</button>',
    });
    document.getElementById('lib-retry').addEventListener('click', () => loadLibrary(title, part));
  }
}


// Refetch the page's data in place (after a download or removal), keeping filter and scroll.
export async function refreshLibrary() {
  if (!lib.view || !dom.view.querySelector('.lib')) return;
  const { title, part } = lib.view;
  try {
    const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : title ? `/api/library/${title}` : '/api/library';
    lib.data = await getJSON(url);
    renderLibrary(false);
  } catch (e) { /* keep what's on screen */ }
}


// The job a row would start, if one is queued or running: shown as "Queued" / "Downloading".
export function jobFor(title, kind, id) {
  const active = [state.jobs.current, ...state.jobs.queued].filter(Boolean);
  return active.find(j => j.title === title && (
    kind === 'title' ? (j.kind === 'title' || j.kind === 'update')
      : kind === 'part' ? j.kind === 'part' && j.target && j.target.part === id
      : j.kind === 'section' && j.target && j.target.id === id));
}


export function actBtn(act, label, attrs, cls = '') {
  return `<button type="button" class="lib-act${cls ? ' ' + cls : ''}" data-act="${act}" ${attrs}>${label}</button>`;
}


export function libRow({ href, num, name, status, actions, dim, key }) {
  const main = href
    ? `<a class="lib-main" href="${href}"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></a>`
    : `<span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>`;
  return `<div class="lib-row${dim ? ' is-dim' : ''}${actions ? ' has-actions' : ''}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}"${key ? ` data-key="${escapeHtml(key)}"` : ''}>
    ${main}<span class="lib-status">${status || ''}</span><span class="lib-actions">${actions || ''}</span></div>`;
}


export const libHref = (title, part) => '#/library' + (title ? `/${title}` : '') + (part ? `/part/${encodeURIComponent(part)}` : '');

export function titleStatus(t) {
  if (t.reserved) return { state: 'uninstalled', text: 'Reserved' };
  const j = jobFor(t.title, 'title');
  if (j) return { state: 'busy', text: j.state === 'running' ? (j.kind === 'update' ? 'Updating' : 'Downloading') : 'Queued' };
  const inst = t.installed;
  if (!inst) return { state: 'uninstalled', text: 'Not installed' };
  if (isStale(t)) return { state: 'stale', text: 'Update available', title: `eCFR has a newer edition (${fmtDate(t.latest)})` };
  if (!inst.whole) {
    const what = [inst.parts ? plural(inst.parts, 'part') : '', inst.sections ? plural(inst.sections, 'section') : ''].filter(Boolean).join(', ');
    return { state: 'partial', text: 'Partial', title: what ? `Installed: ${what}` : '' };
  }
  return { state: 'synced', text: 'Installed', title: `Edition ${fmtDate(inst.edition)}` };
}

export function renderStatusPill(t, opts = {}) {
  const s = titleStatus(t);
  return statPill(s.state, s.text, { title: s.title, ...opts });
}

export function relTime(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return shortDate(new Date(ms).toISOString().slice(0, 10));
}


// The newest eCFR edition date and how many titles were amended in the 7 days before it.
export function amendedWeek(d) {
  const newest = d.titles.reduce((m, t) => (t.latest && t.latest > m ? t.latest : m), '');
  if (!newest) return { newest: '', cut: '', recent: 0 };
  const [y, m, dd] = newest.split('-').map(Number);
  const cut = new Date(Date.UTC(y, m - 1, dd - 7)).toISOString().slice(0, 10);
  return { newest, cut, recent: d.titles.filter(t => t.amended && t.amended >= cut).length };
}


// --- The front page (#/library): a newsroom of titles ---
// Masthead (edition, counts) → four metric tiles → the broadsheet lead: the featured
// compliance suite (65%) beside the Regulatory Wire, eCFR's latest amendments (35%) → the
// other suites → every title as a brief under its topic desk (or ordered by number or by
// last amendment). Briefs: kicker (title number, agencies), status pill, headline, one-line
// summary, dateline (amended · sections · size); actions slide in on hover or focus.
export const LIB_SORTS = [['desk', 'By desk'], ['number', 'By number'], ['updated', 'Recently amended']];


export function titleActions(t) {
  if (t.reserved || jobFor(t.title, 'title')) return '';
  const inst = t.installed;
  if (!inst) return actBtn('download', `${icon('download')}Download`, `data-title="${t.title}"`, 'is-primary');
  return `<a class="lib-act" href="#/title/${t.title}/">Open</a>`
    + (inst.whole ? '' : actBtn('download', 'Download all', `data-title="${t.title}"`))
    + (isStale(t) ? actBtn('update', 'Update', `data-title="${t.title}" title="eCFR has a newer edition (${escapeHtml(fmtDate(t.latest))})"`) : '')
    + actBtn('remove', 'Remove', `data-title="${t.title}"`, 'is-danger');
}


export function libStory(t) {
  const inst = t.installed;
  const agencies = (t.agencies || []).slice(0, 3);
  const kicker = `Title ${t.title}${agencies.length ? `${SEP}<span class="story-ag">${agencies.map(escapeHtml).join(' ')}</span>` : ''}`;
  const name = escapeHtml(t.name);
  const headline = t.reserved ? name : `<a href="${libHref(t.title)}">${name}</a>`;
  const sections = inst ? inst.section_count : t.sections;
  const dateline = joinSep([
    t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : '',
    t.reserved ? '' : fmtSections(sections),
    t.reserved || !t.size_mb ? '' : `<span title="Size of the title's text on eCFR">${fmtMB(t.size_mb)}</span>`,
  ]);
  const acts = titleActions(t);
  const hay = `${t.title} title ${t.name} ${t.summary || ''} ${t.desk || ''} ${(t.agencies || []).join(' ')}`.toLowerCase();
  return `<article class="lib-story has-tier-bar${t.reserved ? ' is-dim' : ''}" data-ref-tier="cfr" data-hay="${escapeHtml(hay)}">
    <div class="story-top"><span class="story-kicker">${kicker}</span>${renderStatusPill(t, { bare: !inst })}</div>
    <h3 class="story-name">${headline}</h3>
    ${t.summary ? `<p class="story-dek">${escapeHtml(t.summary)}</p>` : ''}
    <div class="story-foot"><span class="story-date">${dateline}</span>${acts ? `<div class="story-actions">${acts}</div>` : ''}</div>
  </article>`;
}


export function libMetrics(d) {
  const live = d.titles.filter(t => !t.reserved);
  const inst = live.filter(t => t.installed);
  const sections = inst.reduce((a, t) => a + (t.installed.section_count || 0), 0);
  const bytes = inst.reduce((a, t) => a + (t.installed.bytes || 0), 0);
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
      sub: cut ? `Since ${escapeHtml(shortDate(cut))}${SEP}<button type="button" class="metric-link" data-sort="updated">Show</button>` : 'No edition date',
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


// A suite's state across its titles: the pill, which titles still need a download, and the
// label for the batch button.
export function suiteState(s, d) {
  const ts = s.titles.map(n => d.titles.find(t => t.title === n)).filter(t => t && !t.reserved);
  const busy = ts.filter(t => jobFor(t.title, 'title'));
  const whole = ts.filter(t => t.installed && t.installed.whole);
  const any = ts.filter(t => t.installed);
  const stale = ts.filter(isStale);
  const needs = ts.filter(t => !jobFor(t.title, 'title') && (!t.installed || !t.installed.whole || isStale(t)));
  let pill;
  if (!ts.length) pill = statPill('uninstalled', 'Not installed', { bare: true });
  else if (busy.length) pill = statPill('busy', `${busy.length} of ${ts.length} in progress`);
  else if (whole.length === ts.length && !stale.length) pill = statPill('synced', 'Installed');
  else if (whole.length === ts.length) pill = statPill('stale', 'Update available');
  else if (any.length) pill = statPill('partial', `${any.length} of ${ts.length} installed`);
  else pill = statPill('uninstalled', 'Not installed', { bare: true });
  const onlyUpdates = needs.length && needs.every(t => t.installed && t.installed.whole);
  const label = !needs.length ? '' : onlyUpdates ? `Update ${needs.length === ts.length ? 'suite' : plural(needs.length, 'title')}`
    : needs.length === ts.length ? 'Download suite' : `Download ${plural(needs.length, 'remaining title')}`;
  return { ts, pill, needs, label, busy };
}


export function suiteHero(s, d) {
  const st = suiteState(s, d);
  const rows = st.ts.map(t => {
    const parts = ((HOME_CONTENT[t.title] || {}).cards || []).slice(0, 3);
    const partHref = (p) => (t.installed && t.installed.whole ? `#/title/${t.title}/part/${encodeURIComponent(p)}` : libHref(t.title, p));
    return `<li class="suite-row">
      <span class="suite-num">${t.title}</span>
      <div class="suite-row-body">
        <a class="suite-name" href="${libHref(t.title)}">${escapeHtml(t.name)}</a>
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
        ].map(x => x && `<span>${x}</span>`))}</div>
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
      <span class="suite-telemetry">${joinSep([plural(st.ts.length, 'title'), fmtSections(s.sections), s.size_mb ? `${fmtMB(s.size_mb)} of text` : ''])}</span>
      ${action}
    </div>
  </article>`;
}


export function suiteCard(s, d) {
  const st = suiteState(s, d);
  const titles = st.ts.map(t => `<a href="${libHref(t.title)}"><span class="suite-part-num">${t.title}</span>${escapeHtml(t.name)}</a>`).join('');
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
export function wireSummary(c) {
  if (!c) return '<span class="wire-pending" aria-hidden="true"></span>';
  if (!c.count) return '';
  if (c.removed === c.count) return escapeHtml(`${plural(c.count, 'section')} removed`);
  const verb = c.kind === 'revised' ? 'revised' : 'amended';
  const parts = c.parts.slice(0, 3);
  const more = c.parts.length - parts.length;
  const where = parts.length ? ` in ${parts.length + more === 1 ? 'Part' : 'Parts'} ${parts.join(', ')}${more > 0 ? ` +${more}` : ''}` : '';
  return `${escapeHtml(`${plural(c.count, 'section')} ${verb}${where}`)}${c.first && c.first.name ? `<span class="wire-first">${escapeHtml(c.first.name)}</span>` : ''}`;
}


export function libWire(d) {
  const top = d.titles.filter(t => !t.reserved && t.amended)
    .sort((a, b) => b.amended.localeCompare(a.amended) || a.title - b.title).slice(0, 5);
  const byTitle = new Map(((lib.wire && lib.wire.items) || []).map(c => [c.title, c]));
  const failed = lib.wire && lib.wire.failed;
  return `<aside class="reg-wire" id="lib-wire" aria-labelledby="wire-title">
    <div class="wire-head">
      <h2 class="wire-title" id="wire-title">${icon('activity')}The Regulatory Wire</h2>
      <span class="wire-badge">Live eCFR</span>
    </div>
    <p class="wire-sub">Latest amendments, newest first</p>
    <ol class="wire-items">${top.map(t => {
      const c = byTitle.get(t.title);
      // Loading: a placeholder line. Loaded: what changed, if eCFR said. Failed: nothing.
      const summary = !lib.wire ? wireSummary(null) : failed || !c || c.amended !== t.amended ? '' : wireSummary(c);
      return `<li class="wire-entry"><a href="${libHref(t.title)}">
        <span class="wire-entry-head"><span class="wire-entry-title">Title ${t.title}${(t.agencies || [])[0] ? `${SEP}${escapeHtml(t.agencies[0])}` : ''}</span>
          <time class="wire-entry-date" datetime="${escapeHtml(t.amended)}">${escapeHtml(shortDate(t.amended))}</time></span>
        <span class="wire-entry-name">${escapeHtml(t.name)}</span>
        ${summary ? `<span class="wire-entry-summary">${summary}</span>` : ''}
      </a></li>`;
    }).join('')}</ol>
    <div class="wire-foot"><button type="button" class="wire-link" data-sort="updated">All titles by last amendment ${icon('chevronRight')}</button></div>
  </aside>`;
}


export async function loadWire() {
  if (lib.wire && Date.now() - lib.wire.at < 30 * 60 * 1000 && !lib.wire.failed) return;
  try {
    lib.wire = { at: Date.now(), items: await getJSON('/api/library/wire') };
  } catch (e) {
    lib.wire = { at: Date.now(), items: [], failed: true };
  }
  const el = document.getElementById('lib-wire');
  if (el && lib.data && lib.view && !lib.view.title) el.outerHTML = libWire(lib.data);
}


export function libTitleList(d, sort) {
  const live = d.titles.filter(t => !t.reserved);
  const reserved = d.titles.filter(t => t.reserved);
  const grid = (ts) => `<div class="lib-stories">${ts.map(libStory).join('')}</div>`;
  const desk = (name, ts, extra = '') => `<section class="lib-desk${extra}" aria-label="${escapeHtml(name)}">
      <header class="lib-desk-header"><h3 class="lib-desk-name">${escapeHtml(name)}</h3><span class="lib-desk-count">${plural(ts.length, 'title')}</span></header>
      ${grid(ts)}</section>`;
  if (sort === 'number' || sort === 'updated') {
    const ordered = sort === 'number' ? live : [...live].sort((a, b) => (b.amended || '').localeCompare(a.amended || '') || a.title - b.title);
    return desk(sort === 'number' ? 'All titles by number' : 'All titles by last amendment', ordered, ' is-flat')
      + (reserved.length ? desk('Reserved', reserved) : '');
  }
  const names = [...(d.desks || [])];
  for (const t of live) if (!names.includes(t.desk)) names.push(t.desk);
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

export function libTierTabsHtml(d) {
  const cfrCount = (d.titles || []).filter(t => !t.reserved).length;
  const extras = state.extraCorpora || [];
  const countFor = (id) => {
    if (id === 'all') return cfrCount + extras.length;
    if (id === 'federal-reg') return cfrCount + extras.filter(c => c.tier === 'federal-reg').length;
    return extras.filter(c => c.tier === id).length;
  };
  return `<div class="lib-tier-bar" role="tablist" aria-label="Filter catalog by authority tier">${LIB_TIER_TABS.map(t => {
    const on = lib.tier === t.id;
    const count = countFor(t.id);
    return `<button type="button" role="tab" aria-selected="${on}" class="lib-tier-tab${on ? ' is-active' : ''}" data-ref-tier="${t.refTier}" data-lib-tier="${t.id}">
      <span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(t.label)}</span>${count ? `<span class="lib-tier-count">${count}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}

function libExtraTierBodyHtml(tierId) {
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
  const tierDescriptions = {
    'federal-statute': 'United States Code (U.S.C.) XML statutory packs (Title 29 OSH Act/FLSA, Title 42 EPA statutes, Title 49 Transportation) plug directly into this catalog slot alongside CFR cross-links.',
    'state': 'State administrative codes and OSHA-approved State Plans (e.g., California 8 CCR, Texas TAC, Washington WAC) share the same CorpusSummary contract and search facets.',
    'county': 'County and municipal fire, air-quality, and environmental health ordinances attach under State feeds using jurisdiction codes like US-CA-LA.',
    'standard': 'Incorporated consensus standards (ANSI, NFPA, ASTM, ASME) currently resolve inside section peeker popovers and each Title Start Almanac.',
  };
  return `<section class="resolver-card has-tier-bar" data-ref-tier="${meta.refTier}" style="margin-top:8px">
    <div class="doc-kicker"><span class="ref-badge">${escapeHtml(meta.tag)}</span>${SEP}Catalog Slot Pre-Wired</div>
    <h2 class="doc-title" style="font-size:20px">${escapeHtml(meta.label)}</h2>
    <p class="resolver-msg">${escapeHtml(tierDescriptions[tierId] || 'Backend ingestion pack pending.')}</p>
    <div class="resolver-acts">
      <button type="button" class="btn btn-accent" data-lib-tier="federal-reg">View Federal CFR Catalog</button>
      <a class="btn" href="#/title/${state.currentTitle}/">Open ${state.currentTitle} CFR Almanac</a>
    </div>
  </section>`;
}

export function libFrontHtml(d) {
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
  const extraTiers = TIER_ORDER.filter(t => t !== 'federal-reg' && (lib.extraCorporaCount || (state.extraCorpora || []).some(c => c.tier === t)));
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
    <div class="lib-none" id="lib-none" hidden>No title matches. Try an agency (“OSHA”) or a topic.</div>`;

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
  </div>`;
}


export function renderLibrary(fresh) {
  const { title, part } = lib.view;
  const d = lib.data;
  let crumbs, heading, sub, head = '', body = '', placeholder;
  const scrollTop = dom.main.scrollTop;

  if (!title) {
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
      for (const btn of frontShell.querySelectorAll('.lib-seg [data-sort]')) {
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

  if (!part) {
    document.title = `Title ${title} · Library · FRAMEWORK`;
    const inst = d.installed;
    crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a>`;
    heading = `Title ${title} — ${d.name}`;
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
    document.title = `Part ${part} · Library · FRAMEWORK`;
    crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${libHref(title)}">Title ${title}</a>`;
    heading = `${d.l} — ${d.d}`;
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
        const name = s.t === 'appendix' ? (s.d && s.d !== s.l ? s.d.replace(s.l, '').replace(/^\s*[—–-]\s*/, '') : '') : s.d;
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
      <div class="lib-none" id="lib-none" hidden>Nothing matches.</div>
    </div>`;
  applyLibraryFilter();
  if (fresh) enterView();
  else dom.main.scrollTop = scrollTop;
}


export function applyLibraryFilter() {
  const words = lib.filter.toLowerCase().split(/\s+/).filter(Boolean);
  const list = document.getElementById('lib-list');
  if (!list) return;
  if (list.querySelector('.lib-story')) {
    // Front page: briefs filter in place; each desk hides when none match and its count
    // says how many do. The masthead, suites and wire stay put above the list.
    let n = 0;
    for (const desk of list.querySelectorAll('.lib-desk')) {
      let k = 0;
      for (const el of desk.querySelectorAll('.lib-story')) {
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
    document.getElementById('lib-none').hidden = n > 0;
    return;
  }
  let shown = 0;
  let label = null, labelHas = false;
  const closeLabel = () => { if (label) label.hidden = !labelHas; };
  for (const el of list.children) {
    if (el.classList.contains('lib-label')) {
      closeLabel();
      label = el; labelHas = false;
      continue;
    }
    const hay = el.dataset.hay || '';
    const ok = words.every(w => hay.includes(w));
    el.hidden = !ok;
    if (ok) { shown++; labelHas = true; }
  }
  closeLabel();
  document.getElementById('lib-none').hidden = shown > 0;
}


dom.view.addEventListener('input', (e) => {
  if (e.target.id !== 'lib-filter') return;
  lib.filter = e.target.value;
  applyLibraryFilter();
});


// Ordering: the segmented control, and the "Show" / "All titles by last amendment" links in
// the metrics and the wire, which jump to the list ordered by amendment.
dom.view.addEventListener('click', (e) => {
  const tierBtn = e.target.closest('button[data-lib-tier]');
  if (tierBtn && dom.view.querySelector('.lib-front')?.contains(tierBtn)) {
    lib.tier = tierBtn.dataset.libTier || 'all';
    dom.view.innerHTML = libFrontHtml(lib.data);
    applyLibraryFilter();
    return;
  }
  const sortBtn = e.target.closest('button[data-sort]');
  if (!sortBtn || !dom.view.querySelector('.lib')?.contains(sortBtn)) return;
  const fromSeg = Boolean(sortBtn.closest('.lib-seg'));
  if (sortBtn.dataset.sort !== lib.sort) {
    lib.sort = sortBtn.dataset.sort;
    lsSet('libSort', lib.sort);
    renderLibrary(false);
  }
  if (fromSeg) dom.view.querySelector(`.lib-seg [data-sort="${lib.sort}"]`)?.focus();
  else {
    const tools = dom.view.querySelector('.lib-tools');
    if (tools) tools.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
});


// Queue several titles (a suite, or every outdated title) and report what was queued.
export async function queueBatch(url, body, emptyMsg) {
  const res = await getJSON(url, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : { method: 'POST' });
  for (const j of res.queued || []) state.jobsSeenActive.add(j.id);
  showToast(res.count ? `Queued ${plural(res.count, 'title')}` : emptyMsg);
  await pollJobs();
}


dom.view.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || !dom.view.querySelector('.lib')?.contains(btn)) return;
  const title = parseInt(btn.dataset.title, 10);
  const act = btn.dataset.act;
  if (act === 'remove') {
    // Two clicks: the first arms the button for a few seconds.
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'Confirm remove';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = 'Remove'; }, 4000);
      return;
    }
    btn.disabled = true;
    try {
      await getJSON(`/api/library/${title}`, { method: 'DELETE' });
      showToast(`Removed Title ${title}`);
      await refreshTitles();
      await refreshLibrary();
    } catch (err) {
      showToast(err.message, 5000);
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
      ? await getJSON(`/api/library/${title}/update`, { method: 'POST' })
      : await getJSON('/api/library/download', {
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
    showToast(err.message, 5000);
    btn.disabled = false;
  }
});


export function setJobs(snapshot) {
  if (!snapshot) return;
  state.jobs = snapshot;
  for (const j of [state.jobs.current, ...state.jobs.queued]) if (j) state.jobsSeenActive.add(j.id);
  updateDock();
  updateNavTransfers();
  document.dispatchEvent(new CustomEvent('framework:jobs-updated', { detail: { snap: snapshot } }));
}


export function pollJobsIfActive() {
  if ((state.jobs.current || state.jobs.queued.length) && !state.jobsTimer) state.jobsTimer = setTimeout(pollJobs, 700);
}


export async function pollJobs() {
  clearTimeout(state.jobsTimer);
  state.jobsTimer = null;
  let snap;
  try { snap = await getJSON('/api/library/jobs'); } catch (e) { state.jobsTimer = setTimeout(pollJobs, 3000); return; }
  const before = new Set(state.jobsSeenActive);
  setJobs(snap);
  const finished = snap.recent.filter(j => before.has(j.id));
  for (const j of finished) {
    state.jobsSeenActive.delete(j.id);
    if (j.state === 'error') showToast(`${j.label}: ${j.error}`, 6000);
    else if (j.state === 'cancelled') showToast(`Cancelled ${j.label}`);
    else showToast(j.phase === 'Already installed' ? `${j.label} is already installed` : `Downloaded ${j.label}`);
  }
  if (finished.some(j => j.state === 'done')) {
    await refreshTitles(finished.filter(j => j.state === 'done').map(j => j.title));
  }
  if (finished.length) {
    document.dispatchEvent(new CustomEvent('framework:jobs-finished', { detail: { finished, snap } }));
    // The drawer's library and storage figures change with every install.
    navLib.at = 0;
    state.navStorage = null;
    if (drawerShown() && navState.panel === 'library') ensureNavLibrary(true).then(renderLibraryPanel).catch(() => {});
    if (drawerShown() || onSettingsPage()) refreshSettingsViews();
  }
  if (dom.view.querySelector('.lib')) {
    if (finished.length) await refreshLibrary();
    else {
      // Statuses ("Queued" → "Downloading") only change when a job starts, ends or joins
      // the queue; the progress itself lives in the transfer dock.
      const key = [snap.current, ...snap.queued].filter(Boolean).map(j => `${j.id}${j.state[0]}`).join(',');
      if (key !== state.lastJobsKey) {
        state.lastJobsKey = key;
        renderLibrary(false);
      }
    }
  }
  refreshWelcome();
  refreshHomeIfActive();
  pollJobsIfActive();
}
