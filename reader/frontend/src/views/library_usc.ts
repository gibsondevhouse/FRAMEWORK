import { state } from '../state';
import type { TransferJob } from '../state';
import { escapeHtml, icon } from '../dom';
import { fmt } from '../usage';
import { plural } from '../components/sidebar';
import { SEP, fmtBytes, fmtSections, joinSep, statPill, StatPillState } from '../components/ui';
import { kpiStripHtml, tabLeadHtml } from '../components/page_shell';

// --- The U.S. Code side of the Library (#/library/usc, #/library/usc/{n}) ---
// `GET /api/usc/catalog` lists all 54 titles offline (static names, desks and implementing
// CFR titles from app/usc_titles.json, install state from each usc-{N}.sqlite3, staleness
// against the release point this server last fetched). Installs run on the shared library
// queue as title 1000 + N (`usc-title` / `usc-update`). Sections open on the server-rendered
// page `/usc/{t}/{s}` until the SPA has a U.S. Code reader.

export const USC_JOB_BASE = 1000;

export interface UscInstalled {
  release_point: string | null;
  built_at?: string | null;
  section_count: number;
  note_count: number;
  bytes: number;
  stale: boolean;
}

export interface UscCatalogTitle {
  title: number;
  name: string;
  reserved: boolean;
  positive_law: boolean;
  desk: string;
  cfr: number[];
  installed: UscInstalled | null;
}

export interface UscCatalog {
  release: { release_point: string; current_through?: string | null } | null;
  desks: string[];
  titles: UscCatalogTitle[];
}

export interface UscTreeNode {
  t: string;
  id: string;
  l?: string;
  d?: string;
  s?: string | null;
  c?: UscTreeNode[];
}

export const uscLibHref = (title?: number | null): string => `#/library/usc${title ? `/${title}` : ''}`;
export const uscSectionHref = (title: number, id: string): string => `/usc/${title}/${encodeURIComponent(id)}`;
export const uscCite = (title: number): string => `${title} U.S.C.`;

export function uscJobFor(title: number): TransferJob | undefined {
  const active = [state.jobs.current, ...state.jobs.queued].filter(Boolean) as TransferJob[];
  return active.find(j => j.title === USC_JOB_BASE + title);
}

export function uscStatus(t: UscCatalogTitle): { state: StatPillState; text: string; title?: string } {
  if (t.reserved) return { state: 'uninstalled', text: 'Reserved' };
  const j = uscJobFor(t.title);
  if (j) {
    return { state: 'busy', text: j.state === 'running' ? (j.kind === 'usc-update' ? 'Updating' : 'Downloading') : 'Queued' };
  }
  const inst = t.installed;
  if (!inst) return { state: 'uninstalled', text: 'Not installed' };
  if (inst.stale) return { state: 'stale', text: 'Update available', title: 'The OLRC has a newer release point' };
  return { state: 'synced', text: 'Installed', title: inst.release_point ? `Release point ${inst.release_point}` : '' };
}

export function uscStatusPill(t: UscCatalogTitle, bare = false): string {
  const s = uscStatus(t);
  return statPill(s.state, s.text, { bare, title: s.title });
}

function uscAct(act: string, label: string, title: number, cls = ''): string {
  return `<button type="button" class="lib-act${cls ? ' ' + cls : ''}" data-act="${act}" data-usc-title="${title}">${label}</button>`;
}

/** Hover actions on a U.S. Code brief or row. */
export function uscActions(t: UscCatalogTitle): string {
  if (t.reserved || uscJobFor(t.title)) return '';
  if (!t.installed) return uscAct('usc-download', `${icon('download')}Download`, t.title, 'is-primary');
  return `<a class="lib-act" href="${uscLibHref(t.title)}">Open</a>`
    + (t.installed.stale ? uscAct('usc-update', 'Update', t.title) : '')
    + uscAct('usc-remove', 'Remove', t.title, 'is-danger');
}

/** CFR chips: installed titles open their start page, others their Library page. */
export function cfrChipsHtml(titles: number[], installedCfr: Set<number>): string {
  return titles.map(n => installedCfr.has(n)
    ? `<a class="citation-chip" data-ref-tier="cfr" href="#/title/${n}/">${n} CFR</a>`
    : `<a class="citation-chip is-dim" data-ref-tier="uninstalled" href="#/library/cfr/${n}" title="Not installed">${n} CFR</a>`).join('');
}

/** U.S. Code chips for a CFR title ("Authorized by"). */
export function uscChipsHtml(titles: UscCatalogTitle[]): string {
  return titles.map(u => `<a class="citation-chip${u.installed ? '' : ' is-dim'}" data-ref-tier="${u.installed ? 'usc' : 'uninstalled'}" href="${uscLibHref(u.title)}"${u.installed ? '' : ' title="Not installed"'}>${uscCite(u.title)}</a>`).join('');
}

export function authorizedBy(cfrTitle: number, cat: UscCatalog | null): UscCatalogTitle[] {
  return (cat?.titles || []).filter(u => !u.reserved && u.cfr.includes(cfrTitle));
}

export function uscStory(t: UscCatalogTitle, installedCfr: Set<number>): string {
  const inst = t.installed;
  const kicker = `${uscCite(t.title)}${t.positive_law ? `${SEP}Positive law` : ''}`;
  const name = escapeHtml(t.name);
  const headline = t.reserved ? name : `<a href="${uscLibHref(t.title)}">${name}</a>`;
  const dateline = joinSep([
    inst?.release_point ? `Release ${escapeHtml(inst.release_point)}` : '',
    inst ? fmtSections(inst.section_count) : '',
    inst && inst.bytes ? `${fmtBytes(inst.bytes)} on disk` : '',
    !inst && !t.reserved ? 'Installs the whole title' : '',
  ]);
  const acts = uscActions(t);
  const hay = `${t.title} usc u.s.c. title ${t.name} ${t.desk} ${t.positive_law ? 'positive law' : ''} ${t.cfr.map(n => `${n} cfr`).join(' ')}`.toLowerCase();
  return `<article class="lib-story has-tier-bar${t.reserved ? ' is-dim' : ''}" data-ref-tier="usc" data-hay="${escapeHtml(hay)}">
    <div class="story-top"><span class="story-kicker">${kicker}</span>${uscStatusPill(t, !inst)}</div>
    <h3 class="story-name">${headline}</h3>
    ${t.cfr.length ? `<div class="story-links"><span class="story-links-lbl">Implemented by</span>${cfrChipsHtml(t.cfr, installedCfr)}</div>` : ''}
    <div class="story-foot"><span class="story-date">${dateline}</span>${acts ? `<div class="story-actions">${acts}</div>` : ''}</div>
  </article>`;
}

export function uscTitleList(cat: UscCatalog, installedCfr: Set<number>): string {
  const live = cat.titles.filter(t => !t.reserved);
  const reserved = cat.titles.filter(t => t.reserved);
  const desk = (name: string, ts: UscCatalogTitle[]) => `<section class="lib-desk" aria-label="${escapeHtml(name)}">
      <header class="lib-desk-header"><h3 class="lib-desk-name">${escapeHtml(name)}</h3><span class="lib-desk-count">${plural(ts.length, 'title')}</span></header>
      <div class="lib-stories">${ts.map(t => uscStory(t, installedCfr)).join('')}</div></section>`;
  const names = [...cat.desks];
  for (const t of live) if (!names.includes(t.desk)) names.push(t.desk);
  return names.map(n => {
    const ts = live.filter(t => t.desk === n);
    return ts.length ? desk(n, ts) : '';
  }).join('') + (reserved.length ? desk('Reserved', reserved) : '');
}

export function uscStats(cat: UscCatalog | null) {
  const live = (cat?.titles || []).filter(t => !t.reserved);
  const inst = live.filter(t => t.installed);
  return {
    live,
    inst,
    stale: inst.filter(t => t.installed!.stale),
    sections: inst.reduce((a, t) => a + (t.installed?.section_count || 0), 0),
    notes: inst.reduce((a, t) => a + (t.installed?.note_count || 0), 0),
    bytes: inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0),
  };
}

export function releaseLine(cat: UscCatalog | null): string {
  const r = cat?.release;
  if (!r) return 'Release point not checked yet';
  return `Release point ${r.release_point}${r.current_through ? `, current through ${r.current_through}` : ''}`;
}

export function uscCheckBusy(): boolean {
  return state.jobs.current?.kind === 'usc-update' || state.jobs.queued.some(j => j.kind === 'usc-update');
}

/** The U.S. Code tab: lead card, KPI strip, filter, and every title under its desk. */
export function uscTabHtml(cat: UscCatalog | null, filter: string, installedCfr: Set<number>): string {
  if (!cat) {
    return `<div class="empty-state"><h2>The U.S. Code catalog didn’t load</h2><p>Reload the page to try again.</p></div>`;
  }
  const s = uscStats(cat);
  const updateAll = s.stale.length && !uscCheckBusy()
    ? `<button type="button" class="btn btn-accent" data-act="usc-update-all">${icon('download')} Update ${plural(s.stale.length, 'title')}</button>` : '';
  return `
    ${tabLeadHtml({
      refTier: 'usc',
      kickerHtml: `<span class="ref-badge" data-ref-tier="usc">U.S.C. · STATUTES</span><span>Office of the Law Revision Counsel · USLM XML</span>`,
      title: 'United States Code',
      subHtml: `${escapeHtml(releaseLine(cat))}. Each title installs whole and updates when the OLRC publishes a new release point. Notes stay apart from the statutory text.`,
      actionsHtml: `<button type="button" class="btn" data-act="usc-check">${icon('refresh')} Check for updates</button>${updateAll}`,
    })}
    ${kpiStripHtml([
      { labelHtml: 'Installed', valueHtml: `${s.inst.length} <span class="pg-kpi-of">of ${s.live.length}</span>`, subHtml: s.bytes ? `${escapeHtml(fmtBytes(s.bytes))} on disk` : 'No titles yet' },
      { labelHtml: 'Sections', valueHtml: escapeHtml(fmt(s.sections)), subHtml: s.sections ? `${escapeHtml(fmt(s.notes))} notes kept apart` : 'Install a title to read it' },
      { labelHtml: 'Positive law', valueHtml: `${s.inst.filter(t => t.positive_law).length} installed`, subHtml: `${s.live.filter(t => t.positive_law).length} titles are legal evidence of the law` },
      s.stale.length
        ? { labelHtml: '<span class="stat-dot is-stale" aria-hidden="true"></span>Release point', valueHtml: `${s.stale.length} behind`, subHtml: escapeHtml(cat.release?.release_point || ''), alert: true }
        : { labelHtml: 'Release point', valueHtml: escapeHtml(cat.release?.release_point || 'Not checked'), subHtml: s.inst.length ? (cat.release ? 'Every installed title is current' : 'Use Check for updates') : 'Nothing installed yet' },
    ], { label: 'U.S. Code at a glance', refTier: 'usc' })}
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter titles, topics or CFR titles…" aria-label="Filter U.S. Code titles" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}">
    </div>
    <div class="lib-list" id="lib-list">${uscTitleList(cat, installedCfr)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>No title matches. Try a topic (“labor”) or a CFR title (“29 cfr”).</div>`;
}

// --- One title (#/library/usc/{n}): chapters with section counts ---

function leafStats(n: UscTreeNode): { total: number; inactive: number; first: string | null } {
  if (n.t === 'section') return { total: 1, inactive: n.s ? 1 : 0, first: n.s ? null : n.id };
  let total = 0, inactive = 0, first: string | null = null;
  for (const c of n.c || []) {
    const s = leafStats(c);
    total += s.total;
    inactive += s.inactive;
    first = first || s.first;
  }
  return { total, inactive, first };
}

export function uscChaptersHtml(title: number, tree: UscTreeNode | null): string {
  if (!tree) return '';
  const top = tree.c || [];
  return top.map(n => {
    const s = leafStats(n);
    const num = n.t === 'section' ? (n.l || n.id).replace(/^§\s*/, '§ ') : (n.l || n.id);
    const name = n.d || '';
    const dim = s.total > 0 && s.inactive === s.total;
    const status = s.total
      ? `${escapeHtml(fmtSections(s.total - s.inactive) || 'No active sections')}${s.inactive ? `<span class="lib-row-note">${s.inactive} repealed or omitted</span>` : ''}`
      : '';
    const open = s.first ? `<a class="lib-act" href="${uscSectionHref(title, s.first)}">Read</a>` : '';
    return `<div class="lib-row${dim ? ' is-dim' : ''}${open ? ' has-actions' : ''}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${status}</span><span class="lib-actions">${open}</span></div>`;
  }).join('');
}

export function uscDetailBodyHtml(t: UscCatalogTitle, tree: UscTreeNode | null, installedCfr: Set<number>): string {
  const inst = t.installed;
  const implemented = t.cfr.length
    ? `<section class="lib-links-band" aria-label="Implementing regulations">
        <span class="story-links-lbl">Implemented by</span>${cfrChipsHtml(t.cfr, installedCfr)}
      </section>` : '';
  if (!inst) {
    return `${implemented}
      <div class="empty-state"><h2>${escapeHtml(`${uscCite(t.title)} isn’t installed`)}</h2>
        <p>Download the whole title from the Office of the Law Revision Counsel to see its chapters and read its sections offline.</p>
        ${t.reserved || uscJobFor(t.title) ? '' : `<p><button type="button" class="btn btn-accent" data-act="usc-download" data-usc-title="${t.title}">${icon('download')} Download Title ${t.title}</button></p>`}
      </div>`;
  }
  return `${implemented}
    <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter chapters…" aria-label="Filter chapters" autocomplete="off" spellcheck="false">
    <div class="lib-list" id="lib-list">${tree ? uscChaptersHtml(t.title, tree) : '<p class="lib-none">Couldn’t read this title’s contents.</p>'}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>Nothing matches.</div>`;
}

export function uscDetailSub(t: UscCatalogTitle): string {
  const inst = t.installed;
  if (!inst) return joinSep(['Not installed', t.positive_law ? 'Positive law' : '', escapeHtml(t.desk)]);
  return joinSep([
    inst.stale ? 'Update available' : 'Installed',
    inst.release_point ? `Release ${escapeHtml(inst.release_point)}` : '',
    fmtSections(inst.section_count),
    inst.note_count ? `${fmt(inst.note_count)} notes` : '',
    t.positive_law ? 'Positive law' : '',
  ]);
}

export function uscDetailActions(t: UscCatalogTitle, tree: UscTreeNode | null): string {
  const j = uscJobFor(t.title);
  if (j) return uscStatusPill(t);
  if (t.reserved) return '';
  if (!t.installed) return `<button type="button" class="btn btn-accent" data-act="usc-download" data-usc-title="${t.title}">${icon('download')} Download title</button>`;
  const first = tree ? leafStats(tree).first : null;
  return (first ? `<a class="btn" href="${uscSectionHref(t.title, first)}">${icon('book')} Read</a>` : '')
    + (t.installed.stale ? `<button type="button" class="btn" data-act="usc-update" data-usc-title="${t.title}">Update</button>` : '')
    + `<button type="button" class="btn" data-act="usc-remove" data-usc-title="${t.title}">Remove</button>`;
}
