import { SectionOutlineItem, state } from '../state';
import { getJSON } from '../api/client';
import {
  congressYears, lawCitation, lawHref, lawShort, ordinal, PlawLawDetail, PlawText, PlawUscLink, plawLibHref,
} from '../core/plaw';
import { uscCite } from '../core/usc_label';
import { onView } from '../core/view_dispatch';
import { bindRail, railHtml, unitName, unitShort, watchRail } from '../components/rail';
import { emptyStateHtml, shortDate } from '../components/ui';
import { docStepBtn, setViewHead } from '../components/view_head';
import { copyText, enterView, escapeHtml, icon } from '../dom';
import { dom } from '../state_init';
import { enhanceDomAnchors, renderViewError } from './doc_utils';

// --- The Public Law reader: #/law/{id}[/{unit}|/full] ---
// A law reads a section at a time when it is long (like a long U.S. Code section): the rail
// and the header step through SEC. 1, SEC. 2 …, and "See full law" shows all of it. Below
// the text, "Where it went in the U.S. Code" lists the sections it was codified at, added as
// notes to, or cites/amends — links into the U.S. Code reader when that title is installed.

const LINK_GROUPS: Array<{ kind: PlawUscLink['kind']; label: string; hint: string }> = [
  { kind: 'codified', label: 'Placed in the U.S. Code at', hint: 'Its margin notes say these sections now hold its text.' },
  { kind: 'note', label: 'Added as notes to', hint: 'Provisions printed as statutory notes under these sections.' },
  { kind: 'reference', label: 'Amends or cites', hint: 'U.S. Code sections its text refers to, usually the ones it amends.' },
];

function setLawActiveCorpus(law: PlawLawDetail): void {
  state.activeCorpusId = `us:plaw:${law.id}`;
  state.activeCorpus = {
    corpus_id: `us:plaw:${law.id}`,
    tier: 'federal-statute',
    jurisdiction: 'US',
    jurisdiction_label: 'Federal',
    code: lawShort(law),
    name: law.title || 'Public Law',
    desk: 'all',
    agencies: ['U.S. Congress'],
    edition: law.statute || null,
    installed: true,
    status_label: 'Installed',
  };
}

function uscChip(l: PlawUscLink, installed: Set<number>): string {
  const label = `${uscCite(l.title)} § ${l.section}`;
  return installed.has(l.title)
    ? `<a class="citation-chip" data-ref-tier="usc" href="#/usc/${l.title}/section/${encodeURIComponent(l.section)}">${escapeHtml(label)}</a>`
    : `<a class="citation-chip is-dim" data-ref-tier="uninstalled" href="#/library/usc/${l.title}" title="${escapeHtml(`${uscCite(l.title)} isn’t installed`)}">${escapeHtml(label)}</a>`;
}

export function plawUscPanelHtml(links: PlawUscLink[]): string {
  if (!links.length) return '';
  const installed = new Set((state.installedUscTitles || []).map(t => t.title));
  const groups = LINK_GROUPS.map(g => {
    const ls = links.filter(l => l.kind === g.kind);
    if (!ls.length) return '';
    const shown = ls.slice(0, 80);
    return `<div class="plaw-usc-group">
        <h3 class="plaw-usc-head">${escapeHtml(g.label)} <span class="usc-notes-count">${ls.length}</span></h3>
        <p class="plaw-usc-hint">${escapeHtml(g.hint)}</p>
        <div class="story-links">${shown.map(l => uscChip(l, installed)).join('')}${ls.length > shown.length ? `<span class="plaw-usc-more">and ${ls.length - shown.length} more</span>` : ''}</div>
      </div>`;
  }).join('');
  return `<section class="usc-notes plaw-usc" id="plaw-usc" aria-label="Where it went in the U.S. Code">
      <h2 class="usc-notes-head">Where it went in the U.S. Code</h2>
      ${groups}
    </section>`;
}

const unitHref = (id: string, key: string): string => lawHref(id, key);

function stepHtml(law: PlawLawDetail, t: PlawText): string {
  const btn = (u: SectionOutlineItem | null, dir: number) => (u ? docStepBtn('section', dir, unitHref(law.id, u.key), unitShort(u), unitName(u)) : '');
  const left = btn(t.unit_prev, -1);
  const right = btn(t.unit_next, 1);
  if (!left && !right) return '';
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}

function renderLaw(law: PlawLawDetail, t: PlawText, full: boolean): void {
  const reading = t.mode === 'units' && t.unit ? 'units' : 'scroll';
  const outline = t.outline || [];
  const idx = reading === 'units' ? outline.findIndex(u => u.key === t.unit) : -1;
  const cur = idx >= 0 ? outline[idx] : null;
  setViewHead(stepHtml(law, t) + railHtml({ id: law.id, outline, unit: t.unit || '' }, reading, key => unitHref(law.id, key)));
  const short = lawShort(law);
  const cite = lawCitation(law);
  document.title = `${short}${cur ? ` ${unitShort(cur)}` : ''} · FRAMEWORK`;
  const sep = '<span class="sep" aria-hidden="true">·</span>';
  const toggle = t.mode !== 'units' ? ''
    : full ? `<a class="btn" href="${lawHref(law.id)}">${icon('stack')} Read in parts</a>`
      : `<a class="btn" href="${lawHref(law.id, 'full')}">${icon('expand')} See full law</a>`;
  const banner = cur
    ? `<div class="unit-context"><span>${escapeHtml(cur.group_label || short)}</span>${sep}<span class="unit-pos">Section ${idx + 1} of ${outline.length}</span></div>`
    : '';
  const head = cur && cur.key !== 'preamble' && cur.label
    ? `<h2 class="plaw-sec-head">${escapeHtml(cur.label)}${cur.title ? ` <span class="plaw-sec-title">${escapeHtml(cur.title)}</span>` : ''}</h2>` : '';
  const links = law.usc || [];
  dom.view.innerHTML = `
    <div class="doc-kicker" data-ref-tier="usc">
      <a href="${plawLibHref(law.congress)}">Public Laws</a>${sep}<a href="${plawLibHref(law.congress)}">${ordinal(law.congress)} Congress (${congressYears(law.congress)})</a>
      ${law.approved_date ? `${sep}<span>Signed ${escapeHtml(shortDate(law.approved_date))}</span>` : ''}
      ${law.statute ? `${sep}<span>${escapeHtml(law.statute)}</span>` : ''}
      ${law.bill ? `${sep}<span>${escapeHtml(law.bill)}</span>` : ''}
    </div>
    <h1 class="doc-title">${escapeHtml(short)} ${escapeHtml(law.title || '')}</h1>
    <div class="doc-actions">
      ${toggle}
      <button type="button" class="btn" id="plaw-btn-cite" data-plaw-cite="${escapeHtml(cite)}" title="Copy ${escapeHtml(cite)}">${icon('link')} Cite</button>
      ${links.length ? `<button type="button" class="btn" id="plaw-jump-usc">${icon('list')} U.S. Code (${links.length})</button>` : ''}
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon('link')} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>
    ${banner}
    <div class="reg-body usc-body plaw-body" id="reg-body">${head}${t.html}</div>
    ${plawUscPanelHtml(links)}
    <p class="plaw-prov">Source: GovInfo, ${escapeHtml(law.provenance?.source_url?.split('#')[0] || 'bulk data')} · SHA-256 ${escapeHtml((law.provenance?.sha256 || '').slice(0, 12))}…</p>`;
  enhanceDomAnchors(dom.view);
  enterView();
  bindRail();
  if (reading === 'scroll') watchRail();
}

export function renderPlawDrawerHtml(law: PlawLawDetail, t: PlawText | null): string {
  const outline = t?.outline || [];
  const cur = t?.unit || null;
  let lastGroup: string | null = null;
  const rows = outline.slice(0, 400).map(u => {
    const groupHead = u.group_label && u.group_label !== lastGroup
      ? `<h3 class="dr-label"><span>${escapeHtml(u.group_label)}</span></h3>` : '';
    lastGroup = u.group_label || lastGroup;
    const active = cur === u.key;
    const label = [u.label, u.title].filter(Boolean).join(' — ');
    return `${groupHead}<a class="dr-row${active ? ' is-current' : ''}" href="${unitHref(law.id, u.key)}"${active ? ' aria-current="page"' : ''} title="${escapeHtml(label)}">
        <span class="tier-pip" data-ref-tier="usc" aria-hidden="true"></span><span class="dr-name">${escapeHtml(label || u.key)}</span></a>`;
  }).join('');
  return `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>${escapeHtml(lawShort(law))}</span><span class="dr-count">${outline.length}</span></h3>
      ${rows || '<p class="dr-note">This law is one page.</p>'}
    </section>
    <div class="dr-foot">
      <a class="dr-link" href="${plawLibHref(law.congress)}">${ordinal(law.congress)} Congress</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}

export async function loadLawRoute(id: string, view: string | null): Promise<void> {
  const seq = state.routeSeq;
  const signal = state.routeAbort?.signal;
  state.currentSection = null;
  state.currentUscSection = null;
  state.currentConstUnit = null;
  const full = view === 'full';
  const unitQ = full ? '' : `?unit=${encodeURIComponent(view || '')}`;
  try {
    const [law, text] = await Promise.all([
      getJSON<PlawLawDetail>(`/api/plaw/law/${encodeURIComponent(id)}?text=false`, { signal }),
      getJSON<PlawText>(`/api/plaw/law/${encodeURIComponent(id)}/text${unitQ}`, { signal }),
    ]);
    if (seq !== state.routeSeq) return;
    setLawActiveCorpus(law);
    const drawer = document.getElementById('panel-corpus');
    if (drawer) drawer.innerHTML = renderPlawDrawerHtml(law, text);
    renderLaw(law, text, full);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || seq !== state.routeSeq) return;
    setViewHead('');
    const msg = err instanceof Error ? err.message : String(err);
    if (/isn't installed|No such law/i.test(msg)) {
      document.title = 'Public Law · FRAMEWORK';
      dom.view.innerHTML = emptyStateHtml({
        title: 'This law isn’t in your library',
        body: 'Public Laws download by Congress from the Library’s Public Laws tab.',
        actionsHtml: `<a class="btn btn-accent" href="#/library/plaw">${icon('download')} Open the Public Laws tab</a>`,
      });
      return;
    }
    renderViewError(dom.view, 'Couldn’t open this law', msg);
  }
}

onView('click', async (e: Event) => {
  const t = e.target as Element | null;
  if (!t) return;
  const cite = t.closest<HTMLElement>('#plaw-btn-cite');
  if (cite) {
    const text = cite.dataset.plawCite || '';
    await copyText(text, `Copied ${text}`, 'Couldn’t copy the citation');
    return;
  }
  if (t.closest('#plaw-jump-usc')) document.getElementById('plaw-usc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
