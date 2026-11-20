import {
  congressYears, lawHref, lawShort, ordinal, PlawLawRow, PlawStatus, plawCounts, plawJob, plawLibHref, plawPrivateCount, plawScope,
  splitLawTypes,
} from '../core/plaw';
import { kpiStripHtml, tabLeadHtml } from '../components/page_shell';
import { shortDate, statPill } from '../components/ui';
import { fmt } from '../usage';
import { escapeHtml, icon } from '../dom';

// --- Library → Public Laws tab (#/library/plaw[/{congress}]) ---
// Before install: what Public Laws are and two downloads (this Congress, or every Congress
// GovInfo has in USLM, the 113th on). After: a KPI strip, one tile per Congress (law count,
// or "Not downloaded" with an Add button that rebuilds with that Congress included), and the
// chosen Congress's laws as rows into the law reader (#/law/{id}), filtered by #lib-filter.

const MB_PER_CONGRESS = 32;

function jobLine(): string {
  const j = plawJob();
  return j ? statPill('busy', j.state === 'running' ? (j.phase || 'Downloading') : 'Queued') : '';
}

export function plawTabCounts(st: PlawStatus | null): { countLabel: string; sub: string } {
  if (!st?.installed) return { countLabel: 'Not installed', sub: 'Laws as Congress passed them' };
  const n = plawCounts(st).size;
  return { countLabel: `${fmt(st.law_count)} laws`, sub: n ? `${n} ${n === 1 ? 'Congress' : 'Congresses'} · since the ${ordinal(Math.min(...plawCounts(st).keys()))}` : 'No laws yet' };
}

function congressTiles(st: PlawStatus, selected: number): string {
  const counts = plawCounts(st);
  const tiles: string[] = [];
  for (let c = st.current_congress; c >= st.first_congress; c--) {
    const n = counts.get(c);
    const on = c === selected;
    tiles.push(`<a class="plaw-cong${on ? ' is-on' : ''}${n == null ? ' is-missing' : ''}" href="${plawLibHref(c)}"${on ? ' aria-current="page"' : ''}>
        <span class="plaw-cong-num">${ordinal(c)}</span>
        <span class="plaw-cong-years">${congressYears(c)}</span>
        <span class="plaw-cong-count">${n == null ? 'Not downloaded' : `${fmt(n)} ${n === 1 ? 'law' : 'laws'}`}</span>
      </a>`);
  }
  return `<nav class="plaw-congs" aria-label="Congresses">${tiles.join('')}</nav>`;
}

function lawRow(l: PlawLawRow): string {
  const hay = `${lawShort(l)} ${l.congress}-${l.number} ${l.title || ''} ${l.bill || ''} ${l.statute || ''}`.toLowerCase();
  return `<a class="lib-row" href="${lawHref(l.id)}" data-hay="${escapeHtml(hay)}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(lawShort(l))}</span><span class="lib-name">${escapeHtml(l.title || 'Untitled law')}</span></span>
      <span class="lib-status">${escapeHtml([l.bill, l.approved_date ? shortDate(l.approved_date) : ''].filter(Boolean).join(' · '))}</span>
    </a>`;
}

/** The selected Congress's laws: public laws, then private laws under their own label. */
function lawListHtml(sel: number, laws: PlawLawRow[]): string {
  if (!laws.length) return '<p class="lib-none">No laws yet in this Congress.</p>';
  const { public: pub, private: pvt } = splitLawTypes(laws);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const head = `${ordinal(sel)} Congress · ${congressYears(sel)} · ${count(pub.length, 'public law', 'public laws')}`;
  return (pub.length ? `<div class="lib-label">${escapeHtml(head)}</div>${pub.map(lawRow).join('')}` : '')
    + (pvt.length ? `<div class="lib-label">${escapeHtml(`Private laws · ${count(pvt.length, 'law', 'laws')} for named people or entities`)}</div>${pvt.map(lawRow).join('')}` : '');
}

export function plawTabHtml(st: PlawStatus | null, congress: number | null, laws: PlawLawRow[] | null, filter: string): string {
  if (!st) return `<div class="empty-state"><h2>Public Laws didn’t load</h2><p>Reload the page to try again.</p></div>`;
  const kicker = `<span class="ref-badge" data-ref-tier="usc">PUB. L. · SESSION LAWS</span><span>GovInfo bulk data · USLM XML · no key needed</span>`;
  const job = jobLine();
  const span = st.current_congress - st.first_congress + 1;
  if (!st.installed) {
    return `
      ${tabLeadHtml({
        refTier: 'usc',
        kickerHtml: kicker,
        title: 'Public Laws',
        subHtml: `Each law as Congress passed it, with the places it changed in the U.S. Code. GovInfo publishes them in this format from the ${ordinal(st.first_congress)} Congress (2013) on. One Congress is about ${MB_PER_CONGRESS} MB.`,
        actionsHtml: job || `<button type="button" class="btn btn-accent" data-act="plaw-download" data-congresses="${st.current_congress}">${icon('download')} Download the ${ordinal(st.current_congress)} Congress</button>`
          + `<button type="button" class="btn" data-act="plaw-download" data-congresses="all">Every Congress since 2013 (about ${span * MB_PER_CONGRESS} MB)</button>`,
      })}
      <div class="plaw-explain">
        <p><strong>What you get.</strong> Every public law: its title, the bill it came from, the date it was signed, its Statutes at Large page and the full text, read a section at a time.</p>
        <p><strong>Why it helps.</strong> The U.S. Code shows the law as it stands today. A Public Law shows what Congress actually changed and when, and each U.S. Code section you open lists the laws that enacted or amended it.</p>
      </div>`;
  }
  const counts = plawCounts(st);
  const sel = plawSelected(st, congress);
  const scope = plawScope(st);
  const missing = !counts.has(sel);
  const pvt = plawPrivateCount(st);
  const newest = st.meta.built_at ? shortDate(st.meta.built_at.slice(0, 10)) : '';
  const lead = tabLeadHtml({
    refTier: 'usc',
    kickerHtml: kicker,
    title: 'Public Laws',
    subHtml: escapeHtml([`${fmt(st.law_count)} laws`, `${counts.size} ${counts.size === 1 ? 'Congress' : 'Congresses'}`,
      scope?.follow ? 'new Congresses added automatically' : '', newest ? `updated ${newest}` : ''].filter(Boolean).join(' · '))
      + '. Open a law to read it a section at a time and see where it went in the U.S. Code.',
    actionsHtml: job || `<button type="button" class="btn" data-act="plaw-update">${icon('refresh')} Check for new laws</button>`
      + '<button type="button" class="btn" data-act="plaw-remove">Remove</button>',
  });
  const kpis = kpiStripHtml([
    { labelHtml: 'Laws', valueHtml: escapeHtml(fmt(st.law_count)), subHtml: pvt ? `Including ${fmt(pvt)} private ${pvt === 1 ? 'law' : 'laws'}` : 'Public laws installed' },
    { labelHtml: 'Congresses', valueHtml: `${counts.size} <span class="pg-kpi-of">of ${span}</span>`, subHtml: `${ordinal(st.first_congress)} to ${ordinal(st.current_congress)}` },
    { labelHtml: 'U.S. Code links', valueHtml: escapeHtml(fmt(st.usc_link_count)), subHtml: 'Places these laws changed or cite' },
    { labelHtml: 'Source', valueHtml: 'GovInfo', subHtml: 'Official GPO slip laws' },
  ], { label: 'Public Laws at a glance', refTier: 'usc' });
  const body = missing
    ? `<div class="empty-state"><h2>The ${ordinal(sel)} Congress isn’t downloaded</h2>
        <p>Add it to read its laws (about ${MB_PER_CONGRESS} MB). Public Laws rebuild with it included.</p>
        ${job || `<p><button type="button" class="btn btn-accent" data-act="plaw-add" data-congress="${sel}">${icon('download')} Add the ${ordinal(sel)} Congress</button></p>`}</div>`
    : `<div class="lib-tools">
        <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter laws by title, number or bill…" aria-label="Filter laws" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}">
      </div>
      <div class="lib-list" id="lib-list">${laws ? lawListHtml(sel, laws) : '<p class="lib-none">Loading laws…</p>'}</div>
      <div class="lib-none" id="lib-none" aria-live="polite" hidden>No law matches. Try words from its title, a number (“118-5”) or a bill (“H.R. 3746”).</div>`;
  return `${lead}${kpis}${congressTiles(st, sel)}${body}`;
}

/** The congresses a rebuild should hold once `add` is included (the stored scope plus it). */
export function plawScopeWith(st: PlawStatus | null, add: number): number[] {
  const have = new Set([...(plawScope(st)?.congresses || []), ...plawCounts(st).keys()]);
  have.add(add);
  return [...have].sort((a, b) => a - b);
}

/** The Congress the tab shows: the one asked for when it's in range, else the newest installed. */
export function plawSelected(st: PlawStatus | null, congress: number | null): number {
  if (!st) return congress || 0;
  if (congress && congress >= st.first_congress && congress <= st.current_congress) return congress;
  const counts = plawCounts(st);
  return counts.size ? Math.max(...counts.keys()) : st.current_congress;
}
