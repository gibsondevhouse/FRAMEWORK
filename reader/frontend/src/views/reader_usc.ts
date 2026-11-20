import { SectionOutlineItem, state, UscCitedBy, UscSectionData, UscTitleSummary, UscTreeNodeData } from '../state';
import { fetchUscCitations, fetchUscMeta, fetchUscSection, fetchUscTree } from '../api/client';
import { currentSectionRef, uscSectionRef } from '../core/projects_store';
import { onView } from '../core/view_dispatch';
import { corpusHashFor } from '../components/corpora';
import { citePop } from '../components/cfr_resolver';
import { pinButtonHtml } from '../components/pin_pop';
import { bindRail, railHtml, unitKind, unitName, unitShort, watchRail } from '../components/rail';
import { collectSectionReferences, openRefsLedgerPopover } from '../components/refs_popovers';
import { fmtSections, statPill } from '../components/ui';
import { docStepBtn, setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, plural } from '../dom';
import { dom } from '../state_init';
import { createParaToolsController, enhanceDomAnchors, highlightTarget, renderViewError } from './doc_utils';
import { cfrChipsHtml, uscCite, uscLibHref, uscSectionHref } from './library_usc';

export const uscTitleHref = (title: number): string => `#/usc/${title}/`;
export const uscNodeHref = (title: number, nodeId: string): string => `#/usc/${title}/node/${encodeURIComponent(nodeId)}`;

function findNodeAndParent(
  root: UscTreeNodeData | null | undefined,
  targetId: string,
  ancestors: UscTreeNodeData[] = [],
): { node: UscTreeNodeData; ancestors: UscTreeNodeData[]; siblings: UscTreeNodeData[]; index: number } | null {
  if (!root) return null;
  const kids = root.c || [];
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.id === targetId) {
      return { node: child, ancestors, siblings: kids, index: i };
    }
    const hit = findNodeAndParent(child, targetId, [...ancestors, child]);
    if (hit) return hit;
  }
  return null;
}

function nodeStats(n: UscTreeNodeData): { total: number; inactive: number; first: string | null } {
  if (n.t === 'section') return { total: 1, inactive: n.s ? 1 : 0, first: n.s ? null : n.id };
  let total = 0;
  let inactive = 0;
  let first: string | null = null;
  for (const c of n.c || []) {
    const s = nodeStats(c);
    total += s.total;
    inactive += s.inactive;
    if (!first && s.first) first = s.first;
  }
  return { total, inactive, first };
}

function nodeDisplayLabel(n: UscTreeNodeData): string {
  const raw = (n.l || n.id || '').trim();
  return n.t === 'section' ? raw.replace(/^§\s*/, '§ ') : raw;
}

function setUscActiveCorpus(titleNum: number, meta: UscTitleSummary | null): void {
  const id = `us:usc:${titleNum}-u.s.c.`;
  state.activeCorpusId = id;
  state.activeCorpus = {
    corpus_id: id,
    tier: 'federal-statute',
    jurisdiction: 'US',
    jurisdiction_label: 'Federal',
    code: `${titleNum} U.S.C.`,
    title_num: titleNum,
    name: meta?.title_name || `Title ${titleNum}`,
    desk: 'all',
    agencies: ['U.S. Congress'],
    edition: meta?.release_point || null,
    section_count: meta?.section_count || 0,
    installed: true,
    status_label: 'Installed',
  };
}

async function ensureUscTitleData(titleNum: number, signal?: AbortSignal): Promise<{ meta: UscTitleSummary | null; tree: UscTreeNodeData | null }> {
  let meta = state.installedUscTitles.find(t => t.title === titleNum) || null;
  let tree = state.uscTrees.get(titleNum) || null;
  const [fetchedMeta, fetchedTree] = await Promise.all([
    meta ? Promise.resolve(meta) : fetchUscMeta(titleNum, { signal }),
    tree ? Promise.resolve(tree) : fetchUscTree(titleNum, { signal }),
  ]);
  if (fetchedMeta) meta = fetchedMeta;
  if (fetchedTree) {
    tree = fetchedTree;
    state.uscTrees.set(titleNum, fetchedTree);
  }
  return { meta, tree };
}

function renderUscTitleStart(titleNum: number, meta: UscTitleSummary | null, tree: UscTreeNodeData | null): void {
  setViewHead('');
  const top = tree?.c || [];
  const firstActive = tree ? nodeStats(tree).first : null;
  const installedCfr = new Set(state.installedTitles.map(t => t.title));
  const linkedCfr = (state.corpora.find(c => c.tier === 'federal-statute' && c.title_num === titleNum)?.linked_titles) || [];

  const rows = top.map(n => {
    const s = nodeStats(n);
    const num = nodeDisplayLabel(n);
    const name = n.d || '';
    const dim = s.total > 0 && s.inactive === s.total;
    const href = n.t === 'section' ? uscSectionHref(titleNum, n.id) : uscNodeHref(titleNum, n.id);
    const status = n.t === 'section'
      ? (n.s ? `<span class="lib-row-note">${escapeHtml(n.s)}</span>` : '')
      : `${escapeHtml(fmtSections(s.total - s.inactive) || 'No active sections')}${s.inactive ? `<span class="lib-row-note">${s.inactive} repealed or omitted</span>` : ''}`;
    return `<a class="lib-row${dim ? ' is-dim' : ''}" href="${href}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${status}</span>
    </a>`;
  }).join('');

  const subParts = [
    meta?.release_point ? `Release ${meta.release_point}` : '',
    meta?.current_through ? `Current through ${meta.current_through}` : '',
    meta?.section_count ? `${meta.section_count.toLocaleString()} sections` : '',
    meta?.note_count ? `${meta.note_count.toLocaleString()} notes` : '',
  ].filter(Boolean);

  dom.view.innerHTML = `<div class="ts-front">
    <header class="ts-masthead">
      <div class="ts-kicker">
        <span class="ref-badge" data-ref-tier="usc">U.S.C. · TITLE ${titleNum}</span>
        ${meta?.positive_law ? '<span class="ts-kicker-tag">Positive law</span>' : ''}
        ${statPill('synced', 'Installed')}
      </div>
      <h1 class="ts-title">${escapeHtml(meta?.title_name || `Title ${titleNum}`)}</h1>
      <p class="ts-sub">${escapeHtml(subParts.join(' · ') || 'United States Code')}</p>
      <div class="ts-actions">
        ${firstActive ? `<a class="btn btn-accent" href="${uscSectionHref(titleNum, firstActive)}">${icon('book')}<span>Start reading</span></a>` : ''}
        <a class="btn" href="${uscLibHref(titleNum)}">${icon('grid')}<span>Title in Library</span></a>
      </div>
      ${linkedCfr.length ? `<div class="story-links" style="margin-top:12px"><span class="story-links-lbl">Implemented by</span>${cfrChipsHtml(linkedCfr, installedCfr)}</div>` : ''}
    </header>
    <section class="ts-section" aria-label="Contents">
      <div class="ts-sec-head">
        <h2 class="ts-sec-title">Chapters &amp; Divisions</h2>
        <input class="lib-filter" id="usc-node-filter" type="search" placeholder="Filter chapters…" aria-label="Filter chapters" autocomplete="off" spellcheck="false">
      </div>
      <div class="lib-list" id="usc-node-list">${rows || '<p class="lib-none">No contents found in this title.</p>'}</div>
      <div class="lib-none" id="usc-node-none" aria-live="polite" hidden>Nothing matches that filter.</div>
    </section>
  </div>`;
  enterView();
}

function renderUscNode(
  titleNum: number,
  meta: UscTitleSummary | null,
  tree: UscTreeNodeData | null,
  nodeId: string,
): void {
  const hit = findNodeAndParent(tree, nodeId);
  if (!hit) {
    renderViewError(dom.view, 'Chapter not found', `${uscCite(titleNum)} does not contain “${nodeId}”.`);
    return;
  }
  const { node, ancestors, siblings, index } = hit;
  const prevSib = index > 0 ? siblings[index - 1] : null;
  const nextSib = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  const stepHtml = (prevSib || nextSib)
    ? `<div class="doc-step">${
      prevSib ? docStepBtn('part', -1, uscNodeHref(titleNum, prevSib.id), nodeDisplayLabel(prevSib), prevSib.d || '') : '<span class="doc-step-spacer"></span>'
    }<span class="doc-step-cur">${escapeHtml(nodeDisplayLabel(node))}</span>${
      nextSib ? docStepBtn('part', 1, uscNodeHref(titleNum, nextSib.id), nodeDisplayLabel(nextSib), nextSib.d || '') : '<span class="doc-step-spacer"></span>'
    }</div>`
    : '';
  setViewHead(stepHtml);

  const crumbs = [
    `<a href="${uscTitleHref(titleNum)}">${escapeHtml(uscCite(titleNum))}</a>`,
    ...ancestors.map(a => `<a href="${uscNodeHref(titleNum, a.id)}">${escapeHtml(nodeDisplayLabel(a))}</a>`),
  ].join('<span class="sep" aria-hidden="true">›</span>');

  const children = node.c || [];
  const rows = children.map(c => {
    const num = nodeDisplayLabel(c);
    const name = c.d || '';
    const href = c.t === 'section' ? uscSectionHref(titleNum, c.id) : uscNodeHref(titleNum, c.id);
    const s = c.t === 'section' ? null : nodeStats(c);
    const dim = c.t === 'section' ? Boolean(c.s) : Boolean(s && s.total > 0 && s.inactive === s.total);
    const status = c.t === 'section'
      ? (c.s ? `<span class="lib-row-note">${escapeHtml(c.s)}</span>` : '')
      : `${escapeHtml(fmtSections((s?.total || 0) - (s?.inactive || 0)) || 'No active sections')}`;
    return `<a class="lib-row${dim ? ' is-dim' : ''}" href="${href}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${status}</span>
    </a>`;
  }).join('');

  const sep = '<span class="sep" aria-hidden="true">·</span>';
  const counts = nodeStats(node);
  dom.view.innerHTML = `<div class="usc-node-page">
    <div class="doc-kicker" data-ref-tier="usc">
      <span class="ref-badge">U.S. CODE</span>${sep}${crumbs}
      ${counts.total ? `${sep}<span>${plural(counts.total - counts.inactive, 'active section')}</span>` : ''}
    </div>
    <h1 class="doc-title">${escapeHtml(nodeDisplayLabel(node))}${node.d ? ` — ${escapeHtml(node.d)}` : ''}</h1>
    <div class="doc-actions">
      ${counts.first ? `<a class="btn btn-accent" href="${uscSectionHref(titleNum, counts.first)}">${icon('book')} Start reading</a>` : ''}
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon('link')} Copy link</button>
      </div>
    </div>
    <div class="usc-node-tools">
      <input class="lib-filter" id="usc-node-filter" type="search" placeholder="Filter sections and subchapters…" aria-label="Filter sections" autocomplete="off" spellcheck="false">
    </div>
    <div class="lib-list" id="usc-node-list">${rows || '<p class="lib-none">No sections in this division.</p>'}</div>
    <div class="lib-none" id="usc-node-none" aria-live="polite" hidden>Nothing matches that filter.</div>
  </div>`;
  enterView();
}

const uscUnitHref = (title: number, id: string, view: string): string => `${uscSectionHref(title, id)}/${encodeURIComponent(view)}`;

/** The pinned header, as the CFR builds it: ‹ section | ‹ unit … unit › | section › in units mode. */
function uscStepHtml(titleNum: number, d: UscSectionData, reading: string): string {
  const secBtn = (s: UscSectionData['prev'], dir: number) => s
    ? docStepBtn('section', dir, uscSectionHref(titleNum, s.id), s.label, s.heading || '')
    : '';
  const unitBtn = (u: SectionOutlineItem | null | undefined, dir: number) => u
    ? docStepBtn(unitKind(u), dir, uscUnitHref(titleNum, d.id, u.key), unitShort(u), unitName(u))
    : '';
  const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
  const units = reading === 'units';
  const left = [secBtn(d.prev, -1), units ? unitBtn(d.unit_prev, -1) : ''].filter(Boolean).join(sep);
  const right = [units ? unitBtn(d.unit_next, 1) : '', secBtn(d.next, 1)].filter(Boolean).join(sep);
  if (!left && !right) return '';
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}

function renderUscSection(titleNum: number, meta: UscTitleSummary | null, d: UscSectionData, full: boolean): void {
  const outline = d.outline || [];
  const reading = d.mode === 'units' && d.unit ? 'units' : 'scroll';
  const unitIdx = reading === 'units' ? outline.findIndex(u => u.key === d.unit) : -1;
  const current = unitIdx >= 0 ? outline[unitIdx] : null;
  setViewHead(uscStepHtml(titleNum, d, reading)
    + railHtml({ id: d.id, outline, unit: d.unit || '' }, reading, key => uscUnitHref(titleNum, d.id, key)));

  // Like the CFR kicker ("29 CFR Part 1910"): the title, then the chapter holding the section.
  const chapter = [...(d.path || [])].reverse().find(p => p.t === 'chapter') || (d.path || [])[0] || null;
  const chapterLabel = chapter ? [chapter.l, chapter.d].filter(Boolean).join(' — ').trim() : '';
  const chapterLink = chapter && chapterLabel
    ? (chapter.id ? `<a href="${uscNodeHref(titleNum, chapter.id)}">${escapeHtml(chapterLabel)}</a>` : escapeHtml(chapterLabel))
    : '';
  const label = (d.label || `§ ${d.id}`).replace(/\.\s*$/, '');
  document.title = `${titleNum} U.S.C. ${label}${current ? ' ' + unitShort(current) : ''} · FRAMEWORK`;
  const toggle = d.mode !== 'units' ? ''
    : full ? `<a class="btn" href="${uscSectionHref(titleNum, d.id)}">${icon('stack')} Read in parts</a>`
    : `<a class="btn" href="${uscUnitHref(titleNum, d.id, 'full')}">${icon('expand')} See full section</a>`;
  const unitBanner = current
    ? `<div class="unit-context"><span>${escapeHtml(current.label ? `Subdivision ${current.label}` : (current.title || ''))}</span><span class="sep" aria-hidden="true">·</span><span class="unit-pos">Unit ${unitIdx + 1} of ${outline.length}</span></div>`
    : '';

  const notes = d.notes || [];
  let notesHtml = '';
  if (notes.length) {
    const groups = new Map<string, typeof notes>();
    for (const n of notes) {
      const cat = (n.category || 'editorial').toLowerCase();
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(n);
    }
    const blocks = [...groups.entries()].map(([cat, items]) => `
      <div class="usc-note-group">
        <h3 class="usc-note-cat">${escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1))} notes</h3>
        ${items.map(n => `<div class="usc-note-card">${n.html}</div>`).join('')}
      </div>
    `).join('');
    notesHtml = `<section class="usc-notes" id="usc-notes" aria-label="Statutory and editorial notes">
      <h2 class="usc-notes-head">Notes <span class="usc-notes-count">${notes.length}</span></h2>
      ${blocks}
    </section>`;
  }

  dom.view.innerHTML = `
    <div class="doc-kicker" data-ref-tier="usc">
      <a href="${uscTitleHref(titleNum)}">${escapeHtml(uscCite(titleNum))}</a> ${chapterLink}
      ${meta?.release_point ? `<span class="sep" aria-hidden="true">·</span><span>Release ${escapeHtml(meta.release_point)}</span>` : ''}
    </div>
    <h1 class="doc-title">${escapeHtml(label)} ${escapeHtml(d.heading)}</h1>

    <div class="doc-actions">
      ${toggle}
      ${chapter?.id ? `<a class="btn" href="${uscNodeHref(titleNum, chapter.id)}">${icon('list')} Chapter contents</a>` : ''}
      ${pinButtonHtml(uscSectionRef(titleNum, d))}
      ${notes.length ? `<button type="button" class="btn" id="usc-jump-notes">${icon('stack')} Notes (${notes.length})</button>` : ''}
      <button type="button" class="btn" id="usc-btn-cited" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('link')} <span>Cited by</span></button>
      <button type="button" class="btn" id="usc-btn-refs" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('list')} <span>Refs</span></button>
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <a class="btn" href="/usc/${titleNum}/${encodeURIComponent(d.id)}" target="_blank" rel="noopener" title="Open a printable standalone page">${icon('external')} Standalone</a>
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon('link')} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>

    ${d.status ? `<div class="reserved-note">This section is ${escapeHtml(d.status.toLowerCase())}.</div>` : ''}
    ${unitBanner}
    <div class="reg-body usc-body" id="reg-body">${d.html}</div>
    ${notesHtml}`;
  enhanceDomAnchors(dom.view);
  updateUscRefsButton();
  enterView();
  bindRail();
  if (reading === 'scroll') watchRail();
}

function updateUscRefsButton(): void {
  const btn = document.getElementById('usc-btn-refs');
  if (!btn) return;
  const n = collectSectionReferences(dom.view).length;
  const span = btn.querySelector('span');
  if (span) span.textContent = n ? `Refs ${n}` : 'Refs';
  btn.hidden = n === 0;
}

// --- Cited by: U.S. Code sections, CFR sections and CFR parts (Authority) that cite this section ---
const citedCache = new Map<string, UscCitedBy>();

async function fillUscCitedBy(titleNum: number, sectionId: string, seq: number, signal?: AbortSignal): Promise<void> {
  const key = `${titleNum}|${sectionId}`;
  let data = citedCache.get(key) || null;
  if (!data) {
    try { data = await fetchUscCitations(titleNum, sectionId, { signal }); } catch { return; }
    if (data) citedCache.set(key, data);
  }
  if (!data || !data.count || seq !== state.routeSeq || state.currentUscSection?.id !== sectionId) return;
  const btn = document.getElementById('usc-btn-cited');
  if (!btn) return;
  const span = btn.querySelector('span');
  if (span) span.textContent = `Cited by ${data.count}`;
  btn.hidden = false;
}

function citedRow(href: string, code: string, sub: string): string {
  return `<div class="refs-ledger-row"><a class="refs-ledger-link" href="${href}"><span class="refs-ledger-code">${escapeHtml(code)}</span><span class="refs-ledger-sub">${escapeHtml(sub)}</span></a></div>`;
}

function openUscCitedBy(btn: Element, d: UscCitedBy): void {
  const group = (tier: string, label: string, rows: string[]) => rows.length
    ? `<div class="refs-ledger-group" data-ref-tier="${tier}"><div class="refs-ledger-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(label)}</span><span class="refs-ledger-count">${rows.length}</span></div>${rows.slice(0, 60).join('')}</div>`
    : '';
  const html = `<div class="refs-ledger-wrap">${[
    group('cfr', 'Regulations written under it (Authority)', d.authority.map(a =>
      citedRow(`#/title/${a.title}/part/${encodeURIComponent(a.part)}`, `${a.title} CFR Part ${a.part}`, 'Authority line cites this section'))),
    group('cross', 'CFR sections citing it', d.cfr.map(c =>
      citedRow(`#/title/${c.title}/section/${encodeURIComponent(c.id)}`, `${c.title} CFR ${c.label}`,
        c.heading + (c.paragraphs.length ? ` · cites ${c.paragraphs.join(', ')}` : '')))),
    group('usc', 'U.S. Code sections citing it', d.usc.map(u =>
      citedRow(uscSectionHref(u.title, u.id), `${u.title} U.S.C. ${u.label}`, u.heading))),
  ].join('')}</div>`;
  citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Cited by ${plural(d.count, 'item')} in your library</div>
      <span class="peek-badge">CITED BY</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close citing sections">${icon('close')}</button>
    </div>
    ${html}
    <p class="peek-text">Only titles installed on this computer are searched.</p>
  `, { interactive: true, returnFocus: btn, focusSelector: '.refs-ledger-link', refTier: 'usc' });
}

export function renderUscDrawerHtml(titleNum: number): string {
  const tree = state.uscTrees.get(titleNum);
  const top = tree?.c || [];
  const curSection = state.currentUscSection?.id || null;
  const curNode = state.currentUscNode || null;
  const isStart = !curSection && !curNode;

  const chapters = top.map(n => {
    const href = n.t === 'section' ? uscSectionHref(titleNum, n.id) : uscNodeHref(titleNum, n.id);
    const active = curNode === n.id || (curSection && n.t === 'section' && curSection === n.id);
    const label = nodeDisplayLabel(n);
    const title = n.d ? ` · ${n.d}` : '';
    return `<a class="dr-row${active ? ' is-current' : ''}" href="${href}"${active ? ' aria-current="page"' : ''} title="${escapeHtml(label + title)}">
      <span class="tier-pip" data-ref-tier="usc" aria-hidden="true"></span>
      <span class="dr-name">${escapeHtml(label)}${n.d ? ` — ${escapeHtml(n.d)}` : ''}</span>
    </a>`;
  }).join('');

  return `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>Framework Navigation</span></h3>
      <a class="dr-row${isStart ? ' is-current' : ''}" href="${uscTitleHref(titleNum)}"${isStart ? ' aria-current="page"' : ''}>
        <span class="tier-pip" data-ref-tier="usc" aria-hidden="true"></span>
        <span class="dr-name">Title ${titleNum} start page</span>
      </a>
      <a class="dr-row" href="${uscLibHref(titleNum)}">
        <span class="dr-name">Manage in Library</span>${icon('chevronRight')}
      </a>
    </section>
    <section class="dr-sec">
      <h3 class="dr-label"><span>Chapters &amp; Divisions</span><span class="dr-count">${top.length}</span></h3>
      ${chapters || '<p class="dr-note">Loading contents…</p>'}
    </section>
    <div class="dr-foot">
      <a class="dr-link" href="#/library/usc">U.S. Code catalog</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}

export async function loadUscRoute(
  titleNum: number,
  opts: { nodeId?: string | null; sectionId?: string | null; view?: string | null; para?: string | null } = {},
): Promise<void> {
  const seq = state.routeSeq;
  const signal = state.routeAbort?.signal;
  state.currentUscTitle = titleNum;
  state.currentUscNode = opts.nodeId || null;
  state.currentUscSection = null;
  // The CFR reader's section state would otherwise keep its Cite/Pin/⌘D tools pointed at CFR.
  state.currentSection = null;

  const { meta, tree } = await ensureUscTitleData(titleNum, signal);
  if (seq !== state.routeSeq) return;
  if (!meta && !tree) {
    setViewHead('');
    renderViewError(
      dom.view,
      `${uscCite(titleNum)} is not installed`,
      'Download this U.S. Code title in the Library to read it inside FRAMEWORK.',
    );
    return;
  }
  setUscActiveCorpus(titleNum, meta);
  const drawerPanel = document.getElementById('panel-corpus');
  if (drawerPanel) drawerPanel.innerHTML = renderUscDrawerHtml(titleNum);

  if (opts.sectionId) {
    try {
      // Like the CFR: a long section opens its first unit, `/full` the whole text, `/{key}` one
      // unit, and `?p=(b)(1)` the unit holding (b) (falling back to the whole section).
      const full = opts.view === 'full';
      const pTok = /^\(([0-9A-Za-z]{1,8})\)/.exec(opts.para || '');
      const unit = full ? null : (opts.view || (pTok ? pTok[1].toLowerCase() : ''));
      let sec: UscSectionData;
      try {
        sec = await fetchUscSection(titleNum, opts.sectionId, { signal }, unit);
      } catch (err) {
        if (!pTok || opts.view || (err as Error)?.name === 'AbortError') throw err;
        sec = await fetchUscSection(titleNum, opts.sectionId, { signal }, null);
      }
      if (seq !== state.routeSeq) return;
      uscParaTools.hide();
      state.currentUscSection = sec;
      renderUscSection(titleNum, meta, sec, full);
      if (opts.para) highlightTarget(dom.view, opts.para);
      fillUscCitedBy(titleNum, sec.id, seq, signal);
      if (drawerPanel) drawerPanel.innerHTML = renderUscDrawerHtml(titleNum);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || seq !== state.routeSeq) return;
      setViewHead('');
      renderViewError(
        dom.view,
        'Section not found',
        `${uscCite(titleNum)} § ${opts.sectionId} could not be loaded.`,
      );
    }
    return;
  }

  if (opts.nodeId) {
    renderUscNode(titleNum, meta, tree, opts.nodeId);
    return;
  }

  renderUscTitleStart(titleNum, meta, tree);
}

// Cite / Clip on hover, exactly as in the CFR reader, citing "29 U.S.C. § 655(b)(1)".
const uscParaTools = createParaToolsController({
  root: dom.view,
  bodySelector: '.usc-body',
  paraSelector: '.usc-body .reg-p[id]',
  isActive: () => Boolean(state.currentUscSection && !state.currentSection),
  getSectionRef: currentSectionRef,
  citeTitle: 'Copy U.S. Code citation',
});

onView('click', async (e: Event) => {
  if (await uscParaTools.handleClick(e)) return;
  const t = e.target as Element | null;
  if (!t) return;
  if (t.closest('#usc-jump-notes')) {
    document.getElementById('usc-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const refsBtn = t.closest('#usc-btn-refs');
  if (refsBtn && state.currentUscSection) { openRefsLedgerPopover(refsBtn, dom.view); return; }
  const citedBtn = t.closest('#usc-btn-cited');
  if (citedBtn && state.currentUscSection && state.currentUscTitle) {
    const data = citedCache.get(`${state.currentUscTitle}|${state.currentUscSection.id}`);
    if (data) openUscCitedBy(citedBtn, data);
  }
});

onView('input', (e: Event) => {
  const inp = (e.target as Element | null)?.closest('#usc-node-filter') as HTMLInputElement | null;
  if (!inp) return;
  const list = document.getElementById('usc-node-list');
  const none = document.getElementById('usc-node-none');
  if (!list) return;
  const q = inp.value.trim().toLowerCase();
  let shown = 0;
  for (const row of list.querySelectorAll<HTMLElement>('.lib-row')) {
    const hay = row.dataset.hay || '';
    const match = !q || hay.includes(q);
    row.hidden = !match;
    if (match) shown++;
  }
  if (none) none.hidden = shown > 0;
});

export { corpusHashFor };
