import { ConstitutionOutlineItem, ConstitutionStatus } from '../state';
import {
  amendmentName, articleName, CONST_START_HREF, constGroups, constHref, constJob, constUnitName, toRoman,
} from '../core/constitution';
import { kpiStripHtml, tabLeadHtml } from '../components/page_shell';
import { fmt } from '../usage';
import { fmtBytes, shortDate, statPill } from '../components/ui';
import { escapeHtml, icon } from '../dom';

// --- Library → Constitution tab (#/library/constitution) ---
// Not installed: what it is, where it comes from, one Download button and a preview of the
// contents. Installed: the KPI strip and every article section and amendment as a row that
// opens the reader (#/constitution/{id}), filtered by the shared library filter box.

const SOURCE_LINE = 'GovInfo · House Rules and Manual (official GPO XML)';

export function constEdition(c: ConstitutionStatus | null): string {
  const cong = c?.meta?.congress;
  return cong ? `House Manual, ${ordinal(Number(cong))} Congress` : '';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function constStatusPill(c: ConstitutionStatus | null): string {
  const j = constJob();
  if (j) return statPill('busy', j.state === 'running' ? (j.phase || 'Working…') : 'Queued');
  return c?.installed ? statPill('synced', 'Installed') : statPill('uninstalled', 'Not installed');
}

/** The switchboard tab's count and sub line. */
export function constTabCounts(c: ConstitutionStatus | null): { countLabel: string; sub: string } {
  if (!c?.installed) return { countLabel: 'Not installed', sub: 'Articles, amendments and annotations' };
  const amend = new Set(c.outline.filter(u => u.amendment).map(u => u.amendment)).size;
  return { countLabel: `${amend} amendments`, sub: constEdition(c) || 'Installed' };
}

function rowHtml(u: ConstitutionOutlineItem): string {
  const name = constUnitName(u);
  const status = u.note_count ? `${u.note_count} ${u.note_count === 1 ? 'annotation' : 'annotations'}` : '';
  const hay = `${u.label} ${name} ${u.amendment ? `amendment ${u.amendment} ${toRoman(u.amendment)}` : ''} ${u.article ? `article ${u.article}` : ''}`;
  return `<a class="lib-row" href="${constHref(u.id)}" data-hay="${escapeHtml(hay.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(u.label)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${escapeHtml(status)}</span>
    </a>`;
}

export function constContentsHtml(c: ConstitutionStatus): string {
  const g = constGroups(c.outline);
  const parts: string[] = [];
  if (g.preamble) parts.push(`<div class="lib-label">Preamble</div>${g.preamble.units.map(rowHtml).join('')}`);
  for (const a of g.articles) parts.push(`<div class="lib-label">${escapeHtml(`${a.label} · ${a.name}`)}</div>${a.units.map(rowHtml).join('')}`);
  if (g.amendments.length) parts.push(`<div class="lib-label">Amendments</div>${g.amendments.flatMap(a => a.units).map(rowHtml).join('')}`);
  return parts.join('');
}

/** What the Constitution holds, shown before it is installed (names only, no download needed). */
function previewHtml(): string {
  const arts = [1, 2, 3, 4, 5, 6, 7].map(n =>
    `<li><span class="const-pv-num">Article ${toRoman(n)}</span><span class="const-pv-name">${escapeHtml(articleName(n))}</span></li>`).join('');
  const amds = Array.from({ length: 27 }, (_, i) => i + 1).map(n =>
    `<li><span class="const-pv-num">${toRoman(n)}</span><span class="const-pv-name">${escapeHtml(amendmentName(n))}</span></li>`).join('');
  return `<div class="const-preview" aria-label="What the Constitution contains">
      <section><h3 class="const-pv-head">The seven articles</h3><ul class="const-pv-list">${arts}</ul></section>
      <section><h3 class="const-pv-head">The 27 amendments</h3><ul class="const-pv-list is-cols">${amds}</ul></section>
    </div>`;
}

export function constTabHtml(c: ConstitutionStatus | null, filter: string): string {
  const job = constJob();
  if (!c) {
    return `<div class="empty-state"><h2>The Constitution’s status didn’t load</h2><p>Reload the page to try again.</p></div>`;
  }
  const kicker = `<span class="ref-badge" data-ref-tier="const">CONST. · THE SUPREME LAW</span><span>${escapeHtml(SOURCE_LINE)}</span>`;
  if (!c.installed) {
    return `
      ${tabLeadHtml({
        refTier: 'const',
        kickerHtml: kicker,
        title: 'The Constitution of the United States',
        subHtml: 'The full text of the Preamble, the seven articles and all 27 amendments, with the House Parliamentarian’s annotations kept apart from the text. It is a small download (well under 1 MB) and needs no key.',
        actionsHtml: job ? constStatusPill(c)
          : `<button type="button" class="btn btn-accent" data-act="const-download">${icon('download')} Download the Constitution</button>`,
      })}
      ${previewHtml()}`;
  }
  const g = constGroups(c.outline);
  const latest = Math.max(0, ...c.outline.map(u => u.amendment || 0));
  const sections = c.outline.filter(u => u.kind === 'section' || u.kind === 'article').length;
  const built = c.meta.built_at ? shortDate(c.meta.built_at.slice(0, 10)) : '';
  const checked = c.meta.checked_at ? shortDate(c.meta.checked_at.slice(0, 10)) : '';
  const bytes = Number(c.meta.xml_bytes || 0);
  const actions = job ? constStatusPill(c)
    : `<a class="btn btn-accent" href="${CONST_START_HREF}">${icon('book')} Open in reader</a>`
      + `<button type="button" class="btn" data-act="const-update">${icon('refresh')} Check for a new edition</button>`
      + '<button type="button" class="btn" data-act="const-remove">Remove</button>';
  return `
    ${tabLeadHtml({
      refTier: 'const',
      kickerHtml: kicker,
      title: 'The Constitution of the United States',
      subHtml: escapeHtml([constEdition(c) || 'Installed', built ? `installed ${built}` : '', checked ? `checked for updates ${checked}` : ''].filter(Boolean).join(' · '))
        + '.<br>Annotations are the House Parliamentarian’s notes, shown below the text and never mixed into it.',
      actionsHtml: actions,
    })}
    ${kpiStripHtml([
      { labelHtml: 'Articles', valueHtml: String(g.articles.length), subHtml: `${sections} sections` },
      { labelHtml: 'Amendments', valueHtml: String(g.amendments.length), subHtml: latest ? `Latest: ${escapeHtml(amendmentName(latest))}` : '' },
      { labelHtml: 'Annotations', valueHtml: escapeHtml(fmt(c.note_count)), subHtml: 'Parliamentarian’s notes' },
      { labelHtml: 'Edition', valueHtml: escapeHtml(c.meta.edition || '—'), subHtml: bytes ? `${escapeHtml(fmtBytes(bytes))} of source XML` : 'GovInfo bulk data' },
    ], { label: 'The Constitution at a glance', refTier: 'const' })}
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter articles, amendments or topics…" aria-label="Filter the Constitution" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}">
    </div>
    <div class="lib-list" id="lib-list">${constContentsHtml(c)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>Nothing matches. Try a topic (“speech”, “taxes”) or a number (“14”).</div>`;
}
