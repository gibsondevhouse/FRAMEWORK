import { state, UscSectionData, UscTitleSummary, UscTreeNodeData } from '../state';
import { fetchUscMeta, fetchUscSection, fetchUscTree } from '../api/client';
import { onView } from '../core/view_dispatch';
import { corpusHashFor } from '../components/corpora';
import { adjustFontSize } from '../components/rail';
import { fmtSections, statPill } from '../components/ui';
import { docStepBtn, setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, showToast } from '../dom';
import { dom } from '../state_init';
import { renderViewError } from './doc_utils';
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
  ].join(' <span aria-hidden="true">›</span> ');

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

  dom.view.innerHTML = `<div class="ts-front">
    <header class="reg-head">
      <div class="reg-kicker">${crumbs}${meta?.title_name ? ` · ${escapeHtml(meta.title_name)}` : ''}</div>
      <h1 class="reg-title">${escapeHtml(nodeDisplayLabel(node))}${node.d ? ` — ${escapeHtml(node.d)}` : ''}</h1>
    </header>
    <div style="margin-bottom:14px">
      <input class="lib-filter" id="usc-node-filter" type="search" placeholder="Filter sections and subchapters…" aria-label="Filter sections" autocomplete="off" spellcheck="false">
    </div>
    <div class="lib-list" id="usc-node-list">${rows || '<p class="lib-none">No sections in this division.</p>'}</div>
    <div class="lib-none" id="usc-node-none" aria-live="polite" hidden>Nothing matches that filter.</div>
  </div>`;
  enterView();
}

function renderUscSection(titleNum: number, meta: UscTitleSummary | null, d: UscSectionData): void {
  const stepHtml = (d.prev || d.next)
    ? `<div class="doc-step">${
      d.prev ? docStepBtn('section', -1, uscSectionHref(titleNum, d.prev.id), d.prev.label, d.prev.heading || '') : '<span class="doc-step-spacer"></span>'
    }<span class="doc-step-cur">${escapeHtml(d.label || `§ ${d.id}`)}</span>${
      d.next ? docStepBtn('section', 1, uscSectionHref(titleNum, d.next.id), d.next.label, d.next.heading || '') : '<span class="doc-step-spacer"></span>'
    }</div>`
    : '';
  setViewHead(stepHtml);

  const crumbs = [
    `<a href="${uscTitleHref(titleNum)}">${escapeHtml(uscCite(titleNum))}</a>`,
    ...(d.path || []).map(p => {
      const label = [p.l, p.d].filter(Boolean).join(' ').trim();
      if (!label) return '';
      return p.id
        ? `<a href="${uscNodeHref(titleNum, p.id)}">${escapeHtml(label)}</a>`
        : escapeHtml(label);
    }).filter(Boolean),
  ].join(' <span aria-hidden="true">›</span> ');

  const statusTag = d.status
    ? ` <span class="ref-badge" data-ref-tier="usc" style="vertical-align:middle">${escapeHtml(d.status)}</span>`
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

  dom.view.innerHTML = `<header class="reg-head">
      <div class="reg-kicker">${crumbs}${meta?.release_point ? ` · Release ${escapeHtml(meta.release_point)}` : ''}</div>
      <h1 class="reg-title">${escapeHtml(d.label)} ${escapeHtml(d.heading)}${statusTag}</h1>
      <div class="doc-actions">
        ${notes.length ? `<button type="button" class="btn" id="usc-jump-notes">${icon('list')} Notes (${notes.length})</button>` : ''}
        <a class="btn" href="/usc/${titleNum}/${encodeURIComponent(d.id)}" target="_blank" rel="noopener noreferrer">${icon('external')} Standalone</a>
        <button type="button" class="btn" id="usc-copy">${icon('link')} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="usc-font-dec" aria-label="Decrease text size" title="Smaller text">A−</button>
          <button type="button" id="usc-font-inc" aria-label="Increase text size" title="Larger text">A+</button>
        </div>
      </div>
    </header>
    <article class="reg-body usc-body" id="reg-body">${d.html}</article>
    ${notesHtml}`;
  enterView();
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
  opts: { nodeId?: string | null; sectionId?: string | null } = {},
): Promise<void> {
  const seq = state.routeSeq;
  const signal = state.routeAbort?.signal;
  state.currentUscTitle = titleNum;
  state.currentUscNode = opts.nodeId || null;
  state.currentUscSection = null;

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
      const sec = await fetchUscSection(titleNum, opts.sectionId, { signal });
      if (seq !== state.routeSeq) return;
      state.currentUscSection = sec;
      renderUscSection(titleNum, meta, sec);
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

onView('click', (e: Event) => {
  const t = e.target as Element | null;
  if (!t) return;
  if (t.closest('#usc-font-dec')) { adjustFontSize(-1); return; }
  if (t.closest('#usc-font-inc')) { adjustFontSize(1); return; }
  if (t.closest('#usc-jump-notes')) {
    document.getElementById('usc-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (t.closest('#usc-copy')) {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => showToast('Link copied'))
      .catch(() => showToast('Copy failed'));
    return;
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
