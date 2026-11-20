import { state, TransferJob } from '../state';
import { getJSON } from '../api/client';
import { pollJobs } from '../api/jobs';
import {
  agendaDate, agendaHref, AgendaEntry, AgendaFacets, agendaJob, AgendaListResponse, AgendaRow, AgendaStatus,
  AGENDA_STAGES, AGENDA_TAB_HREF, editionLabel, parseAgendaCfr, parseAgendaUsc, reginfoHref, stageKey, stageShort,
} from '../core/agenda';
import { on } from '../core/events';
import { newsPartHref, newsSectionHref, titleInstalled } from '../core/news_format';
import { onView } from '../core/view_dispatch';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { emptyStateHtml, fmtDate, statPill } from '../components/ui';
import { setViewHead } from '../components/view_head';
import { copyText, enterView, escapeHtml, icon, safeHttpUrl, showToast, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { fmt } from '../usage';
import { NewsStatusResponse, newsState, newsTabsHtml, newsViewFromParams } from './news';

// --- Newsroom → Unified Agenda (#/news?cat=agenda, #/news/agenda/{RIN}) ---
// The Agenda is what agencies plan to do: every rule in reginfo.gov's spring and fall
// editions. The tab lists one edition (newest by default) filtered by agency, stage and
// words or a RIN; a RIN page shows the rule's abstract, timetable, CFR parts and legal
// authority (linked into the readers when installed) and the Federal Register documents it
// became. The router sends `cat=agenda` here, so news.ts never imports this module.

const PAGE = 50;

interface AgendaView { edition: string; agency: string; stage: string; q: string }

const ag: {
  view: AgendaView | null;
  list: AgendaListResponse | null;
  facets: AgendaFacets | null;
  status: AgendaStatus | null;
  newsStatus: NewsStatusResponse | null;
} = { view: null, list: null, facets: null, status: null, newsStatus: null };

function viewFromParams(params?: URLSearchParams | null): AgendaView {
  const get = (k: string) => (params?.get(k) || '').trim();
  return {
    edition: /^\d{6}$/.test(get('edition')) ? get('edition') : '',
    agency: /^\d{4}$/.test(get('agency')) ? get('agency') : '',
    stage: AGENDA_STAGES.some(s => s.key === get('stage')) ? get('stage') : '',
    q: get('q').slice(0, 200),
  };
}

function agendaTabHash(v: AgendaView): string {
  const p = new URLSearchParams({ cat: 'agenda' });
  for (const k of ['edition', 'agency', 'stage', 'q'] as const) if (v[k]) p.set(k, v[k]);
  return `#/news?${p.toString()}`;
}

function listUrl(v: AgendaView, offset = 0): string {
  const p = new URLSearchParams({ limit: String(PAGE) });
  for (const k of ['edition', 'agency', 'stage', 'q'] as const) if (v[k]) p.set(k, v[k]);
  if (offset) p.set('offset', String(offset));
  return `/api/agenda?${p.toString()}`;
}

function jobPill(): string {
  const j = agendaJob();
  return j ? statPill('busy', j.state === 'running' ? (j.phase || 'Downloading the Unified Agenda') : 'Queued') : '';
}

function headActionsHtml(st: AgendaStatus | null): string {
  const job = jobPill();
  if (job) return job;
  if (!st?.installed) return '';
  return `${statPill('synced', `${editionLabel(st.editions[0]?.edition)} edition`)}
    <button type="button" class="btn btn-sm" data-agenda-act="update">${icon('refresh')} Check for a new edition</button>
    <button type="button" class="btn btn-sm" data-agenda-act="remove">Remove</button>`;
}

function frontHtml(view: AgendaView, body: string): string {
  const nv = newsViewFromParams(new URLSearchParams(agendaTabHash(view).split('?')[1]));
  const ns = ag.newsStatus;
  const entries = ag.status?.installed ? (ag.status.editions.find(e => e.edition === (ag.list?.edition || ''))?.entries ?? ag.status.editions[0]?.entries) : 0;
  const tabStatus = ns ? { ...ns, counts: { ...(ns.counts || {}), agenda: entries || 0 } } : null;
  return `
    <div class="news-front agenda-front">
      <div class="news-head">
        <div>
          <div class="doc-kicker">FRAMEWORK Newsroom · reginfo.gov</div>
          <h1 class="doc-title">Regulatory News</h1>
        </div>
        <div class="news-head-status" id="agenda-head-status" aria-live="polite">${headActionsHtml(ag.status)}</div>
      </div>
      <div class="news-bar">
        ${newsTabsHtml(nv, tabStatus)}
        ${ag.status?.installed ? `<input type="search" class="news-q" id="agenda-q" value="${escapeHtml(view.q)}"
          placeholder="Filter planned rules or a RIN (1218-AD39)…" aria-label="Search the Unified Agenda" autocomplete="off" spellcheck="false">` : ''}
      </div>
      ${body}
    </div>`;
}

function notInstalledHtml(): string {
  const job = jobPill();
  return `<div class="agenda-intro">
      <h2>The Unified Agenda</h2>
      <p>Twice a year, every federal agency publishes the rules it plans to propose, finish or review: the
        <strong>Unified Agenda of Regulatory and Deregulatory Actions</strong>. Each planned rule has a RIN
        (Regulation Identifier Number), a stage, a timetable and the CFR parts it would change.</p>
      <p>Download the last two years of editions from reginfo.gov (about 22 MB, no key needed). Planned rules then link to
        the Federal Register documents they became and into the CFR and U.S. Code readers.</p>
      <div class="agenda-intro-acts">${job || `<button type="button" class="btn btn-accent" data-agenda-act="download">${icon('download')} Download the Unified Agenda</button>`}</div>
    </div>`;
}

function filtersHtml(view: AgendaView, f: AgendaFacets | null, st: AgendaStatus): string {
  const sel = (a: string, b: string) => (a === b ? ' selected' : '');
  const agencies = f?.agencies || [];
  const stages = f?.stages || [];
  return `<div class="news-facets agenda-facets">
      <select data-agenda-filter="edition" aria-label="Edition">
        ${st.editions.map((e, i) => `<option value="${i === 0 ? '' : escapeHtml(e.edition)}"${sel(view.edition || st.editions[0].edition, e.edition)}>${escapeHtml(editionLabel(e.edition))} edition (${fmt(e.entries)})</option>`).join('')}
      </select>
      <select data-agenda-filter="agency" aria-label="Agency">
        <option value="">All agencies</option>
        ${agencies.map(a => `<option value="${escapeHtml(a.code)}"${sel(a.code, view.agency)}>${escapeHtml(a.acronym || a.name || a.code)} (${fmt(a.entries)})</option>`).join('')}
      </select>
    </div>
    <div class="lib-seg agenda-stages" role="group" aria-label="Stage">
      <button type="button" data-agenda-stage="" aria-pressed="${!view.stage}">All stages</button>
      ${stages.map(s => `<button type="button" data-agenda-stage="${escapeHtml(s.key)}" aria-pressed="${view.stage === s.key}">${escapeHtml(stageShort(s.label))} <span class="news-tab-count">${fmt(s.entries)}</span></button>`).join('')}
    </div>`;
}

function rowHtml(r: AgendaRow): string {
  const who = [r.parent_acronym, r.agency_acronym && r.agency_acronym !== r.parent_acronym ? r.agency_acronym : ''].filter(Boolean).join(' · ');
  return `<a class="agenda-row has-tier-bar" data-ref-tier="fr" data-stage="${escapeHtml(stageKey(r.stage))}" href="${agendaHref(r.rin, r.edition)}">
      <span class="agenda-rin">${escapeHtml(r.rin)}</span>
      <span class="agenda-main">
        <span class="agenda-title">${escapeHtml(r.title)}</span>
        <span class="agenda-meta">${escapeHtml([who, r.priority].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="agenda-tags">${/^yes/i.test(r.major || '') ? '<span class="agenda-major">Major</span>' : ''}<span class="agenda-stage">${escapeHtml(stageShort(r.stage))}</span></span>
    </a>`;
}

function listBodyHtml(view: AgendaView): string {
  const st = ag.status as AgendaStatus;
  const list = ag.list;
  const rows = list?.results || [];
  const label = `${editionLabel(list?.edition)} edition · ${fmt(list?.total || 0)} planned ${list?.total === 1 ? 'rule' : 'rules'}`;
  const more = list && list.total > rows.length
    ? `<div class="news-more"><button type="button" class="btn" data-agenda-act="more">Load more (${fmt(list.total - rows.length)} left)</button></div>` : '';
  const none = view.q
    ? `No planned rule matches “${escapeHtml(view.q)}”. Try other words or a RIN such as 1218-AD39.`
    : 'No planned rules match these filters.';
  return `${filtersHtml(view, ag.facets, st)}
    <div class="lib-label agenda-count" aria-live="polite">${escapeHtml(label)}</div>
    ${rows.length ? `<div class="agenda-list" id="agenda-list">${rows.map(rowHtml).join('')}</div>${more}`
      : `<div class="empty-state"><h2>Nothing here</h2><p>${none}</p></div>`}`;
}

function paintTab(view: AgendaView, opts: { enter?: boolean } = {}): void {
  const qEl = document.getElementById('agenda-q') as HTMLInputElement | null;
  const qFocus = qEl && document.activeElement === qEl ? { start: qEl.selectionStart ?? qEl.value.length } : null;
  const body = ag.status?.installed ? listBodyHtml(view) : notInstalledHtml();
  dom.view.innerHTML = frontHtml(view, body);
  if (opts.enter) enterView();
  if (qFocus) {
    const q = document.getElementById('agenda-q') as HTMLInputElement | null;
    if (q) {
      q.focus();
      try { q.setSelectionRange(qFocus.start, qFocus.start); } catch { /* type=search quirks */ }
    }
  }
}

function resetPage(): void {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
}

/** #/news?cat=agenda[&edition&agency&stage&q] */
export async function loadAgendaTab(params?: URLSearchParams | null): Promise<void> {
  const seq = state.routeSeq;
  resetPage();
  document.title = 'Unified Agenda · News · FRAMEWORK';
  const view = viewFromParams(params);
  newsState.view = newsViewFromParams(params);
  const firstPaint = !dom.view.querySelector('.agenda-front');
  if (firstPaint) {
    dom.view.innerHTML = skeletonHtml('cards', 'Loading the Unified Agenda…');
    enterView();
  }
  try {
    const [list, facets, newsStatus] = await Promise.all([
      getJSON<AgendaListResponse>(listUrl(view)),
      getJSON<AgendaFacets>(`/api/agenda/facets${view.edition ? `?edition=${view.edition}` : ''}`),
      getJSON<NewsStatusResponse>('/api/news/status').catch(() => null),
    ]);
    if (seq !== state.routeSeq) return;
    ag.view = view;
    ag.list = list;
    ag.facets = facets;
    ag.status = list.status;
    ag.newsStatus = newsStatus;
    paintTab(view, { enter: firstPaint });
  } catch (err) {
    if (seq !== state.routeSeq) return;
    dom.view.innerHTML = emptyStateHtml({
      title: 'The Unified Agenda didn’t load',
      body: escapeHtml(err instanceof Error ? err.message : String(err)),
      actionsHtml: `<a class="btn" href="#/news">${icon('chevronLeft')} All news</a>`,
    });
  }
}

function setAgendaView(next: AgendaView): void {
  history.replaceState(null, '', agendaTabHash(next));
  void loadAgendaTab(new URLSearchParams(agendaTabHash(next).split('?')[1]));
}

async function loadMore(): Promise<void> {
  const seq = state.routeSeq;
  const { view, list } = ag;
  if (!view || !list) return;
  let page: AgendaListResponse;
  try { page = await getJSON<AgendaListResponse>(listUrl(view, list.results.length)); } catch { return; }
  if (seq !== state.routeSeq || ag.list !== list) return;
  list.results = list.results.concat(page.results);
  list.total = page.total;
  const box = document.getElementById('agenda-list');
  if (box) box.insertAdjacentHTML('beforeend', page.results.map(rowHtml).join(''));
  const more = dom.view.querySelector<HTMLElement>('[data-agenda-act="more"]');
  if (more) {
    if (list.total > list.results.length) more.textContent = `Load more (${fmt(list.total - list.results.length)} left)`;
    else more.closest('.news-more')?.remove();
  }
}

// --- One planned rule: #/news/agenda/{RIN}[?edition=] ---

function cfrChip(s: string): string {
  const c = parseAgendaCfr(s);
  if (!c) return `<span class="citation-chip is-dim">${escapeHtml(s)}</span>`;
  const dim = !titleInstalled(c.title);
  const href = c.section ? newsSectionHref(c.title, c.section) : newsPartHref(c.title, c.part);
  return `<a class="citation-chip${dim ? ' is-dim' : ''}" data-ref-tier="${dim ? 'uninstalled' : 'cfr'}" href="${href}">${escapeHtml(s)}</a>`;
}

function uscChip(s: string): string {
  const u = parseAgendaUsc(s);
  const installed = u && (state.installedUscTitles || []).some(t => t.title === u.title);
  if (!u) return `<span class="citation-chip is-dim">${escapeHtml(s)}</span>`;
  return installed
    ? `<a class="citation-chip" data-ref-tier="usc" href="#/usc/${u.title}/section/${encodeURIComponent(u.section)}">${escapeHtml(s)}</a>`
    : `<a class="citation-chip is-dim" data-ref-tier="uninstalled" href="#/library/usc/${u.title}">${escapeHtml(s)}</a>`;
}

function timetableHtml(e: AgendaEntry): string {
  if (!e.timetable.length) return '';
  const byCite = new Map(e.fr_documents.filter(d => d.citation).map(d => [d.citation as string, d]));
  const rows = e.timetable.map(t => {
    const doc = t.fr_citation ? byCite.get(t.fr_citation) : null;
    const cite = t.fr_citation
      ? (doc ? `<a href="#/news/fr/${encodeURIComponent(doc.document_number)}">${escapeHtml(t.fr_citation)}</a>` : escapeHtml(t.fr_citation))
      : '';
    return `<tr><td>${escapeHtml(t.action)}</td><td class="num">${escapeHtml(agendaDate(t.date))}</td><td>${cite}</td></tr>`;
  }).join('');
  return `<section class="agenda-sec" aria-labelledby="agenda-tt-h">
      <h2 class="agenda-sec-head" id="agenda-tt-h">Timetable</h2>
      <div class="table-wrap"><table class="reg-table agenda-tt"><thead><tr><th>Action</th><th>Date</th><th>Federal Register</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}

function frDocsHtml(e: AgendaEntry): string {
  const docs = e.fr_documents;
  const body = docs.length
    ? `<div class="agenda-frdocs">${docs.map(d => `<a class="agenda-frdoc has-tier-bar" data-ref-tier="fr" href="#/news/fr/${encodeURIComponent(d.document_number)}">
          <span class="agenda-frdoc-kicker">${escapeHtml(joinPlain([d.type, d.citation, d.publication_date ? fmtDate(d.publication_date) : '']))}</span>
          <span class="agenda-frdoc-title">${escapeHtml(d.title || d.document_number)}</span></a>`).join('')}</div>`
    : `<p class="dr-note">None in your Federal Register archive yet. ${e.timetable.some(t => t.fr_citation)
      ? 'The timetable cites Federal Register pages that aren’t downloaded; the archive is set up under Settings → Data sources.' : 'This rule hasn’t been published in the Federal Register.'}</p>`;
  return `<section class="agenda-sec" aria-labelledby="agenda-fr-h">
      <h2 class="agenda-sec-head" id="agenda-fr-h">In the Federal Register <span class="usc-notes-count">${docs.length}</span></h2>
      ${body}
    </section>`;
}

const joinPlain = (xs: Array<string | null | undefined>): string => xs.filter(Boolean).join(' · ');

function renderEntry(e: AgendaEntry): void {
  document.title = `${e.rin} ${e.title} · Unified Agenda · FRAMEWORK`;
  const reginfo = safeHttpUrl(reginfoHref(e.rin, e.edition));
  const comment = safeHttpUrl(e.comment_url || '');
  const facts: Array<[string, string]> = [
    ['RIN', `<span class="agenda-rin">${escapeHtml(e.rin)}</span>`],
    ['Stage', escapeHtml(e.stage || '—')],
    ['Agency', escapeHtml(joinPlain([e.agency, e.parent && e.parent !== e.agency ? e.parent : '']) || '—')],
    ['Priority', escapeHtml(e.priority || '—')],
    ['Major rule', escapeHtml(e.major || '—')],
    ['Status', escapeHtml(e.rin_status || '—')],
  ];
  const history = e.history.length > 1
    ? `<section class="agenda-sec" aria-labelledby="agenda-hist-h"><h2 class="agenda-sec-head" id="agenda-hist-h">Earlier editions</h2>
        <ul class="agenda-hist">${e.history.map(h => `<li>${h.edition === e.edition ? `<strong>${escapeHtml(editionLabel(h.edition))}</strong>`
          : `<a href="${agendaHref(e.rin, h.edition)}">${escapeHtml(editionLabel(h.edition))}</a>`} · ${escapeHtml(stageShort(h.stage))}</li>`).join('')}</ul></section>` : '';
  const related = e.related.length
    ? `<section class="agenda-sec"><h2 class="agenda-sec-head">Related rules</h2><div class="story-links">${e.related.map(r => `<a class="citation-chip" data-ref-tier="fr" href="${agendaHref(r)}">${escapeHtml(r)}</a>`).join('')}</div></section>` : '';
  dom.view.innerHTML = `
    <article class="agenda-rule">
      <div class="doc-kicker" data-ref-tier="fr">
        <a href="${AGENDA_TAB_HREF}">Unified Agenda</a>${'<span class="sep" aria-hidden="true">·</span>'}<span>${escapeHtml(editionLabel(e.edition))} edition</span>${e.parent_acronym ? `<span class="sep" aria-hidden="true">·</span><a href="${AGENDA_TAB_HREF}&agency=${encodeURIComponent(e.parent_code || '')}">${escapeHtml(e.parent_acronym)}</a>` : ''}
      </div>
      <h1 class="doc-title">${escapeHtml(e.title)}</h1>
      <div class="doc-actions">
        <a class="btn" href="${AGENDA_TAB_HREF}">${icon('chevronLeft')} Unified Agenda</a>
        <button type="button" class="btn" id="agenda-copy-rin" data-rin="${escapeHtml(e.rin)}">${icon('link')} Copy RIN</button>
        ${reginfo ? `<a class="btn" href="${escapeHtml(reginfo)}" target="_blank" rel="noopener noreferrer">${icon('external')} reginfo.gov</a>` : ''}
        ${comment ? `<a class="btn" href="${escapeHtml(comment)}" target="_blank" rel="noopener noreferrer">${icon('external')} Comment</a>` : ''}
      </div>
      <dl class="agenda-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${e.abstract ? `<div class="agenda-abstract reg-body"><p class="reg-p">${escapeHtml(e.abstract)}</p></div>` : ''}
      ${e.cfr.length || e.authority.length ? `<section class="agenda-sec"><h2 class="agenda-sec-head">What it would change</h2>
        ${e.cfr.length ? `<p class="agenda-chips-label">CFR</p><div class="story-links">${e.cfr.map(cfrChip).join('')}</div>` : ''}
        ${e.authority.length ? `<p class="agenda-chips-label">Legal authority</p><div class="story-links">${e.authority.map(uscChip).join('')}</div>` : ''}
      </section>` : ''}
      ${timetableHtml(e)}
      ${frDocsHtml(e)}
      ${history}
      ${related}
    </article>`;
}

/** #/news/agenda/{RIN}[?edition=YYYYMM] */
export async function loadAgendaRule(rin: string, params?: URLSearchParams | null): Promise<void> {
  const seq = state.routeSeq;
  resetPage();
  const edition = (params?.get('edition') || '').trim();
  dom.view.innerHTML = skeletonHtml('doc', 'Loading the planned rule…');
  enterView();
  try {
    const q = /^\d{6}$/.test(edition) ? `?edition=${edition}` : '';
    const e = await getJSON<AgendaEntry>(`/api/agenda/rin/${encodeURIComponent(rin)}${q}`);
    if (seq !== state.routeSeq) return;
    renderEntry(e);
  } catch (err) {
    if (seq !== state.routeSeq) return;
    const msg = err instanceof Error ? err.message : String(err);
    document.title = 'Unified Agenda · FRAMEWORK';
    dom.view.innerHTML = emptyStateHtml({
      title: /No such RIN/i.test(msg) ? `${rin} isn’t in your Unified Agenda` : 'Couldn’t open this planned rule',
      body: /No such RIN/i.test(msg) ? 'Download the Unified Agenda, or a newer edition, from the Newsroom’s Unified Agenda tab.' : escapeHtml(msg),
      actionsHtml: `<a class="btn btn-accent" href="${AGENDA_TAB_HREF}">${icon('chevronLeft')} Unified Agenda</a>`,
    });
  }
}

// --- Events ---

let qTimer: ReturnType<typeof setTimeout> | undefined;
let removeTimer: ReturnType<typeof setTimeout> | undefined;

async function startJob(url: string): Promise<void> {
  const res = await getJSON<{ job: TransferJob }>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  state.jobsSeenActive.add(res.job.id);
  const slot = document.getElementById('agenda-head-status');
  if (slot) slot.innerHTML = statPill('busy', 'Queued');
  const intro = dom.view.querySelector('.agenda-intro-acts');
  if (intro) intro.innerHTML = statPill('busy', 'Queued');
  await pollJobs();
}

onView('click', async (e: Event) => {
  const t = e.target as Element | null;
  if (!t) return;
  const copy = t.closest<HTMLElement>('#agenda-copy-rin');
  if (copy) {
    await copyText(copy.dataset.rin || '', `Copied ${copy.dataset.rin}`, 'Couldn’t copy the RIN');
    return;
  }
  if (!dom.view.querySelector('.agenda-front')) return;
  const stage = t.closest<HTMLElement>('[data-agenda-stage]');
  if (stage && ag.view) {
    setAgendaView({ ...ag.view, stage: stage.dataset.agendaStage || '' });
    return;
  }
  const btn = t.closest<HTMLButtonElement>('button[data-agenda-act]');
  if (!btn) return;
  const act = btn.dataset.agendaAct;
  try {
    if (act === 'more') await loadMore();
    else if (act === 'download') { btn.disabled = true; await startJob('/api/agenda/build'); }
    else if (act === 'update') { btn.disabled = true; await startJob('/api/agenda/update'); }
    else if (act === 'remove') {
      if (!btn.classList.contains('is-armed')) {
        btn.classList.add('is-armed');
        btn.textContent = 'Confirm remove';
        clearTimeout(removeTimer);
        removeTimer = setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = 'Remove'; }, 4000);
        return;
      }
      btn.disabled = true;
      await getJSON('/api/agenda', { method: 'DELETE' });
      showToast('Removed the Unified Agenda');
      void loadAgendaTab(new URLSearchParams('cat=agenda'));
    }
  } catch (err) {
    btn.disabled = false;
    showToast(err instanceof Error ? err.message : 'That didn’t work');
  }
});

onView('change', (e: Event) => {
  const sel = (e.target as Element | null)?.closest<HTMLSelectElement>('[data-agenda-filter]');
  if (!sel || !ag.view) return;
  const key = sel.dataset.agendaFilter as 'edition' | 'agency';
  // A different edition has its own agencies and stages: keep the words, drop the rest.
  setAgendaView(key === 'edition' ? { ...ag.view, edition: sel.value, agency: '', stage: '' } : { ...ag.view, [key]: sel.value });
});

onView('input', (e: Event) => {
  const el = e.target as HTMLInputElement | null;
  if (!el || el.id !== 'agenda-q' || !ag.view) return;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { if (ag.view) setAgendaView({ ...ag.view, q: el.value.trim() }); }, 250);
});

// A finished download or update repaints the tab when it is on screen.
on('jobs:finished', () => {
  if (dom.view.querySelector('.agenda-front')) void loadAgendaTab(new URLSearchParams(location.hash.split('?')[1] || 'cat=agenda'));
});
