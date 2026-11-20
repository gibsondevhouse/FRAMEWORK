import { ConstitutionStatus, ConstitutionUnitData, state } from '../state';
import { getJSON } from '../api/client';
import {
  CONST_LIB_HREF, CONST_START_HREF, constCitation, constGroups, constHref, constUnitName, fetchConstitution, toRoman,
  articleName, splitClauses,
} from '../core/constitution';
import { constSectionRef } from '../core/projects_store';
import { onView } from '../core/view_dispatch';
import { pinButtonHtml } from '../components/pin_pop';
import { emptyStateHtml, statPill } from '../components/ui';
import { docStepBtn, setViewHead } from '../components/view_head';
import { copyText, enterView, escapeHtml, icon } from '../dom';
import { dom } from '../state_init';
import { renderViewError } from './doc_utils';
import { constContentsHtml, constEdition } from './library_constitution';

// --- The Constitution reader: #/constitution/ (contents) and #/constitution/{unitId} ---
// Built like the U.S. Code reader: the drawer lists the articles and amendments, the header
// steps to the previous and next unit, and the page carries Pin (⌘D), Cite and Copy link.
// The text has no paragraph markers, so its numbered clauses are split out where the House
// Manual numbers them ("1 The House … 2 No Person …") and each clause number copies its
// citation ("U.S. Const. art. I, § 2, cl. 2"). Annotations sit below, never in the text.

function setConstActiveCorpus(c: ConstitutionStatus): void {
  state.activeCorpusId = 'us:constitution';
  state.activeCorpus = {
    corpus_id: 'us:constitution',
    tier: 'federal-constitution',
    jurisdiction: 'US',
    jurisdiction_label: 'Federal',
    code: 'U.S. Const.',
    name: 'Constitution of the United States',
    desk: 'all',
    agencies: [],
    edition: c.meta.edition || null,
    section_count: c.unit_count,
    installed: true,
    status_label: 'Installed',
  };
}

function bodyHtml(u: ConstitutionUnitData): string {
  const cite = constCitation(u.label);
  return splitClauses(u.text).map(c => c.n == null
    ? `<p class="const-p">${escapeHtml(c.text)}</p>`
    : `<p class="const-p const-clause" id="cl${c.n}"><button type="button" class="const-cl" data-const-cite="${escapeHtml(`${cite}, cl. ${c.n}`)}" title="Copy ${escapeHtml(`${cite}, cl. ${c.n}`)}" aria-label="Clause ${c.n}: copy citation">${c.n}</button>${escapeHtml(c.text)}</p>`).join('');
}

function stepHtml(u: ConstitutionUnitData, c: ConstitutionStatus): string {
  const byId = new Map(c.outline.map(o => [o.id, o]));
  const btn = (id: string | null, dir: number) => {
    const o = id ? byId.get(id) : null;
    return o ? docStepBtn('section', dir, constHref(o.id), o.label, constUnitName(o)) : '';
  };
  const left = btn(u.prev, -1);
  const right = btn(u.next, 1);
  if (!left && !right) return '';
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}

function groupLabel(u: Pick<ConstitutionUnitData, 'kind' | 'article' | 'amendment'>): { text: string; href: string } {
  if (u.amendment) return { text: `Amendment ${toRoman(u.amendment)}`, href: CONST_START_HREF };
  if (u.article) return { text: `Article ${toRoman(u.article)} · ${articleName(u.article)}`, href: CONST_START_HREF };
  return { text: 'Preamble', href: CONST_START_HREF };
}

function renderStart(c: ConstitutionStatus): void {
  setViewHead('');
  document.title = 'U.S. Constitution · FRAMEWORK';
  const g = constGroups(c.outline);
  const first = c.outline[0];
  dom.view.innerHTML = `<div class="ts-front const-front">
    <header class="ts-masthead">
      <div class="ts-kicker">
        <span class="ref-badge" data-ref-tier="const">CONST. · U.S. CONSTITUTION</span>
        ${statPill('synced', 'Installed')}
      </div>
      <h1 class="ts-title">The Constitution of the United States</h1>
      <p class="ts-sub">${escapeHtml([constEdition(c), `${g.articles.length} articles`, `${g.amendments.length} amendments`, `${c.note_count.toLocaleString()} annotations`].filter(Boolean).join(' · '))}</p>
      <div class="ts-actions">
        ${first ? `<a class="btn btn-accent" href="${constHref(first.id)}">${icon('book')}<span>Start reading</span></a>` : ''}
        <a class="btn" href="${CONST_LIB_HREF}">${icon('grid')}<span>Constitution in Library</span></a>
      </div>
    </header>
    <section class="ts-section" aria-label="Contents">
      <div class="ts-sec-head">
        <h2 class="ts-sec-title">Articles &amp; Amendments</h2>
        <input class="lib-filter" id="const-filter" type="search" placeholder="Filter articles, amendments or topics…" aria-label="Filter the Constitution" autocomplete="off" spellcheck="false">
      </div>
      <div class="lib-list" id="const-list">${constContentsHtml(c)}</div>
      <div class="lib-none" id="const-none" aria-live="polite" hidden>Nothing matches. Try a topic (“speech”, “taxes”) or a number (“14”).</div>
    </section>
  </div>`;
  const amend = [...dom.view.querySelectorAll<HTMLElement>('#const-list .lib-label')].find(el => el.textContent === 'Amendments');
  if (amend) amend.id = 'const-amendments';
  enterView();
}

function renderUnit(u: ConstitutionUnitData, c: ConstitutionStatus): void {
  setViewHead(stepHtml(u, c));
  const name = constUnitName(u);
  const cite = constCitation(u.label);
  const grp = groupLabel(u);
  document.title = `${cite} · FRAMEWORK`;
  const sep = '<span class="sep" aria-hidden="true">·</span>';
  const notes = u.notes || [];
  const notesHtml = notes.length ? `<section class="usc-notes const-notes" id="const-notes" aria-label="Annotations">
      <h2 class="usc-notes-head">Annotations <span class="usc-notes-count">${notes.length}</span></h2>
      <p class="const-notes-src">Notes by the Parliamentarian of the House, from the House Rules and Manual. They explain how the text has been read; they are not part of it.</p>
      ${notes.map(n => `<div class="usc-note-card"><p>${escapeHtml(n)}</p></div>`).join('')}
    </section>` : '';
  dom.view.innerHTML = `
    <div class="doc-kicker" data-ref-tier="const">
      <a href="${CONST_START_HREF}">U.S. Constitution</a>${sep}<a href="${grp.href}">${escapeHtml(grp.text)}</a>
      ${c.meta.edition ? `${sep}<span>${escapeHtml(constEdition(c))}</span>` : ''}
    </div>
    <h1 class="doc-title">${escapeHtml(u.label)}${name ? ` ${escapeHtml(name)}` : ''}</h1>
    <div class="doc-actions">
      ${pinButtonHtml(constSectionRef(u))}
      <button type="button" class="btn" id="const-btn-cite" data-const-cite="${escapeHtml(cite)}" title="Copy ${escapeHtml(cite)}">${icon('link')} Cite</button>
      ${notes.length ? `<button type="button" class="btn" id="const-jump-notes">${icon('stack')} Annotations (${notes.length})</button>` : ''}
      <a class="btn" href="${CONST_START_HREF}">${icon('list')} Contents</a>
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon('link')} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>
    <div class="reg-body const-body" id="reg-body">${bodyHtml(u)}</div>
    ${notesHtml}`;
  enterView();
}

export function renderConstDrawerHtml(c: ConstitutionStatus | null): string {
  const cur = state.currentConstUnit?.id || null;
  const g = constGroups(c?.outline || []);
  const row = (href: string, label: string, name: string, active: boolean) =>
    `<a class="dr-row${active ? ' is-current' : ''}" href="${href}"${active ? ' aria-current="page"' : ''} title="${escapeHtml(`${label}${name ? ` · ${name}` : ''}`)}">
      <span class="tier-pip" data-ref-tier="const" aria-hidden="true"></span>
      <span class="dr-name">${escapeHtml(label)}${name ? ` — ${escapeHtml(name)}` : ''}</span>
    </a>`;
  const arts = g.articles.map(a => {
    const active = Boolean(cur && a.units.some(u => u.id === cur));
    return row(constHref(a.units[0].id), a.label, a.name, active);
  }).join('');
  const amds = g.amendments.map(a => {
    const active = Boolean(cur && a.units.some(u => u.id === cur));
    return row(constHref(a.units[0].id), a.label.replace('Amendment', 'Amdt.'), a.name, active);
  }).join('');
  return `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>Framework Navigation</span></h3>
      ${row(CONST_START_HREF, 'Contents', '', !cur)}
      ${g.preamble ? row(constHref('preamble'), 'Preamble', '', cur === 'preamble') : ''}
      <a class="dr-row" href="${CONST_LIB_HREF}"><span class="dr-name">Manage in Library</span>${icon('chevronRight')}</a>
    </section>
    <section class="dr-sec">
      <h3 class="dr-label"><span>Articles</span><span class="dr-count">${g.articles.length}</span></h3>
      ${arts || '<p class="dr-note">Loading contents…</p>'}
    </section>
    <section class="dr-sec">
      <h3 class="dr-label"><span>Amendments</span><span class="dr-count">${g.amendments.length}</span></h3>
      ${amds}
    </section>
    <div class="dr-foot">
      <a class="dr-link" href="${CONST_LIB_HREF}">Constitution in Library</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}

export async function loadConstitutionRoute(unitId: string | null): Promise<void> {
  const seq = state.routeSeq;
  const signal = state.routeAbort?.signal;
  // The CFR and U.S. Code readers' state would otherwise keep Cite/Pin/⌘D pointed at them.
  state.currentSection = null;
  state.currentUscSection = null;
  state.currentConstUnit = null;
  const c = await fetchConstitution();
  if (seq !== state.routeSeq) return;
  if (!c?.installed) {
    setViewHead('');
    document.title = 'U.S. Constitution · FRAMEWORK';
    dom.view.innerHTML = emptyStateHtml({
      title: 'The Constitution isn’t installed',
      body: 'Download it from the Constitution tab in the Library (it takes a few seconds), then come back here.',
      actionsHtml: `<a class="btn btn-accent" href="${CONST_LIB_HREF}">${icon('download')} Open the Constitution tab</a>`,
    });
    return;
  }
  setConstActiveCorpus(c);
  const drawer = document.getElementById('panel-corpus');
  if (!unitId) {
    if (drawer) drawer.innerHTML = renderConstDrawerHtml(c);
    renderStart(c);
    return;
  }
  try {
    const u = await getJSON<ConstitutionUnitData>(`/api/constitution/unit/${encodeURIComponent(unitId)}`, { signal });
    if (seq !== state.routeSeq) return;
    state.currentConstUnit = u;
    if (drawer) drawer.innerHTML = renderConstDrawerHtml(c);
    renderUnit(u, c);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError' || seq !== state.routeSeq) return;
    setViewHead('');
    if (drawer) drawer.innerHTML = renderConstDrawerHtml(c);
    renderViewError(dom.view, 'Not found', `The Constitution has no part called “${unitId}”.`);
  }
}

onView('click', async (e: Event) => {
  const t = e.target as Element | null;
  if (!t) return;
  const citeBtn = t.closest<HTMLElement>('[data-const-cite]');
  if (citeBtn && state.currentConstUnit) {
    const cite = citeBtn.dataset.constCite || '';
    await copyText(cite, `Copied ${cite}`, 'Couldn’t copy the citation');
    return;
  }
  if (t.closest('#const-jump-notes')) {
    document.getElementById('const-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

onView('input', (e: Event) => {
  const inp = (e.target as Element | null)?.closest('#const-filter') as HTMLInputElement | null;
  if (!inp) return;
  const list = document.getElementById('const-list');
  if (!list) return;
  const words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  let label: HTMLElement | null = null;
  let labelHas = false;
  const close = () => { if (label) label.hidden = !labelHas; };
  for (const el of list.children as HTMLCollectionOf<HTMLElement>) {
    if (el.classList.contains('lib-label')) { close(); label = el; labelHas = false; continue; }
    const ok = words.every(w => (el.dataset.hay || '').includes(w));
    el.hidden = !ok;
    if (ok) { shown++; labelHas = true; }
  }
  close();
  const none = document.getElementById('const-none');
  if (none) none.hidden = shown > 0;
});
