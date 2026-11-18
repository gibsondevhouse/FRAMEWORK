import { InstalledTitleMeta, state, TransferJob } from '../state';
import { fetchPartFull, fetchSectionRaw, getJSON } from '../api/client';
import { pollJobs } from '../api/jobs';
import { emit, on } from '../core/events';
import { onView } from '../core/view_dispatch';
import { jobFor } from '../core/library_meta';
import { enterView, escapeHtml, icon, showToast } from '../dom';
import { dom } from '../state_init';
import { createPopover } from './popover';
import { dockModel } from './transfer_dock';
import { fmtDate, transferTrackHtml } from './ui';

export interface RawCfrTarget {
  title?: number | string | null;
  cfrTitle?: number | string | null;
  section?: string | null;
  part?: string | null;
  para?: string | null;
  kind?: string | null;
  ecfrUrl?: string | null;
}

export interface NormalizedCfrTarget {
  title: number;
  part: string | null;
  section: string | null;
  para: string | null;
  kind: 'section' | 'appendix' | 'part';
  ecfrUrl: string;
}

interface TitleInfoSummary {
  reserved?: boolean;
  name?: string;
  latest?: string | null;
}

interface ResolverCtx {
  target: NormalizedCfrTarget;
  info: TitleInfoSummary | null;
  loading: boolean;
  error: string | null;
  openInSplit?: boolean;
  container?: Element;
}

const titleInfoCache = new Map<number, { info: TitleInfoSummary; at: number }>();
const INFO_TTL_MS = 5 * 60 * 1000;

export const citePopEl = dom.citePop;
export const citePop = createPopover({
  el: dom.citePop,
  scrollContainer: dom.main,
  padding: 12,
});

export function normalizeCfrTarget(raw: RawCfrTarget = {}): NormalizedCfrTarget {
  const title = Number(raw.title || raw.cfrTitle) || 0;
  const section = raw.section ? String(raw.section).trim() : null;
  const part = raw.part
    ? String(raw.part).trim()
    : (section && section.includes('.') ? section.split('.', 1)[0] : null);
  const para = raw.para ? String(raw.para).trim() : null;
  const kind: NormalizedCfrTarget['kind'] = raw.kind === 'appendix' ? 'appendix' : (section ? 'section' : 'part');
  const ecfrUrl = raw.ecfrUrl || (
    section
      ? `https://www.ecfr.gov/current/title-${title}/section-${encodeURIComponent(section)}`
      : part
        ? `https://www.ecfr.gov/current/title-${title}/part-${encodeURIComponent(part)}`
        : `https://www.ecfr.gov/current/title-${title}`
  );
  return { title, part, section, para, kind, ecfrUrl };
}

async function fetchTitleInfo(title: number): Promise<TitleInfoSummary> {
  const cached = titleInfoCache.get(title);
  if (cached && (Date.now() - cached.at) < INFO_TTL_MS) return cached.info;
  const info = await getJSON<TitleInfoSummary>(`/api/library/${title}`);
  titleInfoCache.set(title, { info, at: Date.now() });
  return info;
}

export async function checkLocalCfrTarget(
  target: NormalizedCfrTarget,
): Promise<{ installed: boolean; meta: InstalledTitleMeta | null; kind?: string; partialMissing?: boolean }> {
  const meta = state.installedTitles.find(t => t.title === target.title) || null;
  if (!meta) return { installed: false, meta: null };
  if (target.section) {
    try {
      const res = await fetchSectionRaw(target.title, target.section, '?unit=');
      if (res.ok) return { installed: true, meta, kind: 'section' };
      return { installed: false, meta, partialMissing: true };
    } catch {
      return { installed: false, meta, partialMissing: true };
    }
  }
  if (target.part) {
    try {
      const res = await fetchPartFull(target.title, target.part);
      if (res.ok) return { installed: true, meta, kind: 'part' };
      return { installed: false, meta, partialMissing: true };
    } catch {
      return { installed: false, meta, partialMissing: true };
    }
  }
  return { installed: true, meta, kind: 'title' };
}

function activeJobForTarget(target: NormalizedCfrTarget): TransferJob | null {
  if (target.section) {
    return jobFor(target.title, 'section', target.section)
      || (target.part ? jobFor(target.title, 'part', target.part) : null)
      || jobFor(target.title, 'title')
      || null;
  }
  if (target.part) {
    return jobFor(target.title, 'part', target.part) || jobFor(target.title, 'title') || null;
  }
  return jobFor(target.title, 'title') || null;
}

function targetDisplayTitle(target: NormalizedCfrTarget): string {
  if (target.section) return `${target.title} CFR § ${target.section}`;
  if (target.part) return `${target.title} CFR Part ${target.part}`;
  return `Title ${target.title}`;
}

export function targetHashFor(target: Pick<NormalizedCfrTarget, 'title' | 'section' | 'part' | 'para'>): string {
  if (target.section) {
    return `#/title/${target.title}/section/${encodeURIComponent(target.section)}`
      + (target.para ? `?p=${encodeURIComponent(target.para)}` : '');
  }
  if (target.part) return `#/title/${target.title}/part/${encodeURIComponent(target.part)}`;
  return `#/title/${target.title}/`;
}

function resolverBodyHtml(
  target: NormalizedCfrTarget,
  { info = null, error = null, loading = false, openInSplit = false, isPage = false }: {
    info?: TitleInfoSummary | null; error?: string | null; loading?: boolean; openInSplit?: boolean; isPage?: boolean;
  } = {},
): string {
  const titleNum = target.title;
  const installedMeta = state.installedTitles.find(t => t.title === titleNum);
  const job = activeJobForTarget(target);
  const reserved = Boolean(info && info.reserved);
  const titleName = (info && info.name) || (installedMeta && installedMeta.name) || `Title ${titleNum}`;
  const edition = info && info.latest ? ` · Edition ${fmtDate(info.latest)}` : '';
  const statusMsg = reserved
    ? `Title ${titleNum} is reserved on eCFR and contains no regulatory text.`
    : installedMeta?.partial
      ? `Title ${titleNum} is partially installed — this ${target.section ? 'section' : 'part'} hasn’t been downloaded yet.`
      : `Title ${titleNum} is not installed in the local reader.`;

  let jobHtml = '';
  if (job) {
    const m = dockModel(job);
    const pctText = m.pct == null ? '' : ` · ${m.pct}%`;
    const isQueued = job.state === 'queued';
    const note = openInSplit
      ? 'Downloading in background — will open side-by-side when ready.'
      : 'Downloading in background — will open automatically when ready.';
    jobHtml = `
      <div class="resolver-progress" data-res-job="${job.id}">
        <div class="resolver-progress-head">
          <span class="stat-dot is-busy" aria-hidden="true"></span>
          <span>${escapeHtml(isQueued ? `Queued · ${job.label}` : `${m.label}${pctText}`)}</span>
        </div>
        ${transferTrackHtml(m.pct)}
        <p class="resolver-note">${escapeHtml(note)}</p>
      </div>
    `;
  }

  let actionsHtml = '';
  if (!reserved && !job) {
    const primaryCls = isPage ? 'btn btn-accent' : 'btn btn-small btn-accent';
    const secCls = isPage ? 'btn' : 'btn btn-small';
    const btns: string[] = [];
    if (target.section) {
      btns.push(`<button type="button" class="${primaryCls}" data-res-dl="section">${icon('download')} Download § ${escapeHtml(target.section)}</button>`);
      if (target.part) {
        btns.push(`<button type="button" class="${secCls}" data-res-dl="part">Download Part ${escapeHtml(target.part)}</button>`);
      }
    } else if (target.part) {
      btns.push(`<button type="button" class="${primaryCls}" data-res-dl="part">${icon('download')} Download Part ${escapeHtml(target.part)}</button>`);
      btns.push(`<button type="button" class="${secCls}" data-res-dl="title">Download Title ${titleNum}</button>`);
    } else {
      btns.push(`<button type="button" class="${primaryCls}" data-res-dl="title">${icon('download')} Download Title ${titleNum}</button>`);
    }
    actionsHtml = `<div class="resolver-acts">
      ${btns.join('')}
      <a class="${secCls}" href="${escapeHtml(target.ecfrUrl)}" target="_blank" rel="noopener noreferrer">${icon('external')} View on eCFR</a>
    </div>`;
  } else {
    actionsHtml = `<div class="resolver-acts">
      <a class="${isPage ? 'btn' : 'btn btn-small'}" href="${escapeHtml(target.ecfrUrl)}" target="_blank" rel="noopener noreferrer">${icon('external')} View on eCFR</a>
      ${isPage ? `<a class="btn" href="#/library/${titleNum}">Open in Library</a>` : ''}
    </div>`;
  }

  return `
    <div class="resolver-meta">${escapeHtml(titleName)}${escapeHtml(edition)}${loading ? ' · Checking eCFR…' : ''}</div>
    <p class="resolver-msg">${escapeHtml(error || statusMsg)}</p>
    ${jobHtml}
    ${actionsHtml}
  `;
}

let activeModalCtx: ResolverCtx | null = null;
let activePageCtx: ResolverCtx | null = null;

async function submitCfrDownload(scopeKind: string, target: NormalizedCfrTarget, openInSplit = false): Promise<TransferJob> {
  const body = {
    title: target.title,
    part: (scopeKind === 'section' || scopeKind === 'part') ? target.part : null,
    section: scopeKind === 'section' ? target.section : null,
    kind: target.kind === 'appendix' ? 'appendix' : 'section',
  };
  const job = await getJSON<TransferJob>('/api/library/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  state.jobsSeenActive.add(job.id);
  state.pendingDownloads.set(job.id, {
    title: target.title,
    part: body.part,
    section: body.section,
    kind: body.section ? (body.kind as 'section' | 'appendix') : (body.part ? 'part' : 'title'),
    para: target.para || null,
    openInSplit: Boolean(openInSplit && target.section),
    fromHash: window.location.hash || '#/',
  });
  await pollJobs();
  return job;
}

function renderPopResolver(ctx: ResolverCtx): void {
  if (!citePopEl || !citePop.isOpen() || !citePop.isInteractive()) return;
  const { target, info, loading, error, openInSplit } = ctx;
  citePopEl.innerHTML = `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(targetDisplayTitle(target))}</div>
      <span class="peek-badge">UNINSTALLED</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close download prompt">${icon('close')}</button>
    </div>
    ${resolverBodyHtml(target, { info, loading, error, openInSplit, isPage: false })}
  `;
  citePop.reposition();
}

export async function openCfrDownloadCard(
  anchorEl: Element | null,
  rawTarget: RawCfrTarget,
  { openInSplit = false }: { openInSplit?: boolean } = {},
): Promise<void> {
  const target = normalizeCfrTarget(rawTarget);
  const ctx: ResolverCtx = { target, info: null, loading: true, error: null, openInSplit };
  activeModalCtx = ctx;

  citePop.open(anchorEl, '', { interactive: true, returnFocus: anchorEl, refTier: 'uninstalled' });
  renderPopResolver(ctx);

  try {
    const info = await fetchTitleInfo(target.title);
    if (activeModalCtx !== ctx || !citePop.isOpen()) return;
    ctx.info = info;
    ctx.loading = false;
    renderPopResolver(ctx);
  } catch (err) {
    if (activeModalCtx !== ctx || !citePop.isOpen()) return;
    ctx.loading = false;
    ctx.error = err instanceof Error ? err.message : null;
    renderPopResolver(ctx);
  }
}

export async function renderResolverPage(container: Element | null, rawTarget: RawCfrTarget): Promise<void> {
  if (!container) return;
  const target = normalizeCfrTarget(rawTarget);
  const ctx: ResolverCtx = { target, info: null, loading: true, error: null, container };
  activePageCtx = ctx;

  const draw = () => {
    if (activePageCtx !== ctx || !container.contains(container.querySelector('.resolver-card') || container)) return;
    container.innerHTML = `
      <div class="resolver-card">
        <div class="doc-kicker">External Regulatory Reference</div>
        <h1 class="doc-title">${escapeHtml(targetDisplayTitle(target))}</h1>
        ${resolverBodyHtml(target, { info: ctx.info, loading: ctx.loading, error: ctx.error, isPage: true })}
      </div>
    `;
  };

  document.title = `${targetDisplayTitle(target)} · FRAMEWORK`;
  container.innerHTML = `<div class="resolver-card">
    <div class="doc-kicker">External Regulatory Reference</div>
    <h1 class="doc-title">${escapeHtml(targetDisplayTitle(target))}</h1>
    ${resolverBodyHtml(target, { loading: true, isPage: true })}
  </div>`;
  enterView();

  try {
    ctx.info = await fetchTitleInfo(target.title);
    ctx.loading = false;
  } catch (err) {
    ctx.loading = false;
    ctx.error = err instanceof Error ? err.message : null;
  }
  if (activePageCtx === ctx && container.querySelector('.resolver-card')) draw();
}

async function handleResolverActionClick(btn: HTMLButtonElement | null, ctx: ResolverCtx | null, redraw: () => void): Promise<void> {
  if (!btn || !ctx) return;
  const scope = btn.dataset.resDl;
  if (!scope) return;
  btn.disabled = true;
  try {
    await submitCfrDownload(scope, ctx.target, Boolean(ctx.openInSplit));
    ctx.error = null;
    redraw();
  } catch (err) {
    btn.disabled = false;
    ctx.error = err instanceof Error ? err.message : 'Download failed';
    showToast(ctx.error, 5000);
    redraw();
  }
}

if (dom.citePop) {
  dom.citePop.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (t?.closest('[data-pop-close]')) {
      activeModalCtx = null;
      citePop.close(true);
      return;
    }
    const dlBtn = t?.closest<HTMLButtonElement>('[data-res-dl]');
    if (dlBtn && activeModalCtx) {
      handleResolverActionClick(dlBtn, activeModalCtx, () => { if (activeModalCtx) renderPopResolver(activeModalCtx); });
    }
  });
}

onView('click', (e) => {
  const dlBtn = (e.target as Element | null)?.closest<HTMLButtonElement>('.resolver-card [data-res-dl]');
  if (dlBtn && activePageCtx && dom.view.contains(dlBtn)) {
    handleResolverActionClick(dlBtn, activePageCtx, () => {
      const card = dom.view.querySelector('.resolver-card');
      if (activePageCtx && card) {
        card.innerHTML = `
          <div class="doc-kicker">External Regulatory Reference</div>
          <h1 class="doc-title">${escapeHtml(targetDisplayTitle(activePageCtx.target))}</h1>
          ${resolverBodyHtml(activePageCtx.target, { info: activePageCtx.info, loading: activePageCtx.loading, error: activePageCtx.error, isPage: true })}
        `;
      }
    });
  }
});

on('jobs:updated', () => {
  if (activeModalCtx && citePop.isOpen() && citePop.isInteractive() && citePopEl?.querySelector('[data-res-dl], [data-res-job]')) {
    renderPopResolver(activeModalCtx);
  }
  const card = dom.view?.querySelector('.resolver-card');
  if (activePageCtx && card) {
    card.innerHTML = `
      <div class="doc-kicker">External Regulatory Reference</div>
      <h1 class="doc-title">${escapeHtml(targetDisplayTitle(activePageCtx.target))}</h1>
      ${resolverBodyHtml(activePageCtx.target, { info: activePageCtx.info, loading: activePageCtx.loading, error: activePageCtx.error, isPage: true })}
    `;
  }
});

async function upgradeDomExternalLinks(finishedTitles: Set<number>): Promise<void> {
  if (!finishedTitles.size) return;
  for (const key of [...state.peekCache.keys()]) {
    const tNum = Number(key.split('|', 1)[0]);
    if (finishedTitles.has(tNum)) state.peekCache.delete(key);
  }
  for (const tNum of finishedTitles) state.refsCache.delete(tNum);
  for (const key of [...state.graphCache.keys()]) {
    const tNum = Number(key.split('|', 1)[0]);
    if (finishedTitles.has(tNum)) state.graphCache.delete(key);
  }
  for (const root of [dom.view, dom.splitPane].filter(Boolean)) {
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a.xref-external[data-cfr-title]')) {
      const t = Number(a.dataset.cfrTitle);
      if (!finishedTitles.has(t)) continue;
      const target = normalizeCfrTarget({
        title: t,
        part: a.dataset.cfrPart,
        section: a.dataset.cfrSection,
        para: a.dataset.cfrPara,
      });
      const status = await checkLocalCfrTarget(target);
      if (!status.installed || !a.isConnected) continue;
      a.href = targetHashFor(target);
      a.className = 'xref xref-cross';
      a.removeAttribute('target');
      a.removeAttribute('rel');
      a.removeAttribute('title');
      delete a.dataset.cfrTitle;
      delete a.dataset.cfrPart;
      delete a.dataset.cfrSection;
      delete a.dataset.cfrPara;
    }
  }
}

on('jobs:finished', async ({ finished }) => {
  if (!finished.length) return;
  const doneJobs = finished.filter(j => j.state === 'done');
  const doneTitles = new Set(doneJobs.map(j => j.title).filter((t): t is number => typeof t === 'number'));
  await upgradeDomExternalLinks(doneTitles);

  for (const j of finished) {
    const entry = state.pendingDownloads.get(j.id);
    if (!entry) continue;
    state.pendingDownloads.delete(j.id);
    if (j.state !== 'done') continue;

    const target = normalizeCfrTarget(entry);
    const label = targetDisplayTitle(target);

    if (entry.openInSplit && target.section) {
      if (activeModalCtx && citePop.isOpen()) {
        activeModalCtx = null;
        citePop.close(false);
      }
      emit('split:open', { title: target.title, sectionId: target.section, para: target.para, pushHistory: true });
      showToast(`Ready — opened ${label} side-by-side`);
      continue;
    }

    const onResolverPage = Boolean(dom.view.querySelector('.resolver-card'));
    const sameOrigin = window.location.hash === entry.fromHash || onResolverPage;
    if (sameOrigin) {
      if (activeModalCtx && citePop.isOpen()) {
        activeModalCtx = null;
        citePop.close(false);
      }
      if (activePageCtx) activePageCtx = null;
      window.location.hash = targetHashFor(target);
      showToast(`Ready — opened ${label}`);
    } else {
      showToast(`${label} ready in library`);
    }
  }
});

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    activeModalCtx = null;
    if (!dom.view?.querySelector('.resolver-card')) activePageCtx = null;
  });
}
