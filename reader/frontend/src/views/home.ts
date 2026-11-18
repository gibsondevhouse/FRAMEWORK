import { NewsStatusSnapshot, state, TitleSnapshotRow } from '../state';
import { getJSON } from '../api/client';
import { on } from '../core/events';
import { onView } from '../core/view_dispatch';
import { isStale, jobFor } from '../core/library_meta';
import {
  fmtMoney, newsKicker, newsPartHref, newsSectionHref, newsStatusPillHtml, titleInstalled,
} from '../core/news_format';
import { loadProjects, projDot, WorkspaceRecord } from '../core/projects_store';
import { HOME_CONTENT } from '../data/home_content';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection, plural, switchTitle } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsGetJSON, lsSetJSON, skeletonHtml } from '../dom';
import { openPanel, routeTarget } from '../nav';
import { dom } from '../state_init';
import { fmt, loadUsage, timeAgo, titleHref, UsageSectionEntry, visitedCountFor } from '../usage';
import {
  deskFilterRibbonHtml, deskLabel, mapRawDeskToId, refTierForCorpus,
  setActiveDesk, syncCorporaState, TIER_META,
} from '../components/corpora';
import { SEP, joinSep, shortDate, statPill } from '../components/ui';
import { startNewWorkspace } from '../views/projects';

const HOME_NEWS_CACHE = 'newsCache:v1:all';
const HOME_STATUS_CACHE = 'newsCache:v1:status';

interface RecentSectionItem extends UsageSectionEntry {
  ti: number;
  id: string;
}

function installedFallbackList(): TitleSnapshotRow[] {
  const base: TitleSnapshotRow[] = state.installedTitles.length ? state.installedTitles
    : state.metaInfo.edition ? [{
      title: state.currentTitle,
      name: state.metaInfo.name || `Title ${state.currentTitle}`,
      section_count: state.metaInfo.section_count,
      edition: state.metaInfo.edition,
    }] : [];
  const cachedByTitle = new Map(((state.homeSnapshot && state.homeSnapshot.titles) || []).map(x => [x.title, x]));
  return base.map(t => {
    const cached = cachedByTitle.get(t.title) || ({} as Partial<TitleSnapshotRow>);
    return {
      agencies: cached.agencies || [],
      summary: cached.summary || '',
      scope_parts: cached.scope_parts ?? null,
      scope_sections_count: cached.scope_sections_count || 0,
      unreadable: Boolean(cached.unreadable),
      news: cached.news || { count: 0, latest_title: null, latest_date: null },
      ...t,
    };
  });
}

function sectionLinkHref(e: { ti: number; id: string; u?: string }): string {
  return titleHref(e.ti, 'section/' + encodeURIComponent(e.id) + (e.u ? '/' + encodeURIComponent(e.u) : ''));
}

function activeTransfersHtml(): string {
  const j = state.jobs.current;
  const queued = state.jobs.queued || [];
  if (!j && !queued.length) return '';
  const pill = statPill('busy', j ? (j.state === 'running' ? j.phase || 'Downloading' : 'Queued') : 'Queued');
  const text = j ? j.label : 'Preparing download';
  const more = queued.length ? ` · +${queued.length} queued` : '';
  return `
    <a class="hm-transfer" href="#/library">
      ${pill}
      <span class="hm-transfer-text">${escapeHtml(text)}${escapeHtml(more)}</span>
      <span class="hm-transfer-cta">Watch in Library ${icon('chevronRight')}</span>
    </a>`;
}

function resumeCardHtml(recent: RecentSectionItem[], titles: TitleSnapshotRow[]): string {
  if (recent.length) {
    const last = recent[0];
    const href = sectionLinkHref(last);
    const trail = recent.slice(1, 3);
    return `
      <section class="hm-card hm-resume" aria-label="Continue reading">
        <div class="hm-card-top">
          <span class="hm-kicker">Continue reading</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t || 0))}</span>
        </div>
        <div class="hm-resume-loc">
          <span>${last.ti} CFR</span>
          ${last.p ? `${SEP}<a href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
          ${last.ul ? `${SEP}<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ''}
        </div>
        <a class="hm-resume-title" href="${href}">${escapeHtml(last.l)} ${escapeHtml(last.h || '')}</a>
        <div class="hm-resume-acts">
          <a class="btn btn-sm btn-accent" href="${href}">Resume reading ${icon('chevronRight')}</a>
          ${last.p ? `<a class="btn btn-sm" href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
        </div>
        ${trail.length ? `
          <div class="hm-trail">
            <div class="hm-trail-head">
              <span class="hm-kicker">Recently opened</span>
              <button type="button" class="hm-inline-link" data-hm-act="open-history">Full history</button>
            </div>
            <div class="hm-trail-list">
              ${trail.map(e => `
                <a class="hm-trail-row" href="${sectionLinkHref(e)}">
                  <span class="hm-tag">${e.ti} CFR</span>
                  <span class="hm-row-num">${escapeHtml(String(e.l || e.id).replace(/^§\s*/, ''))}</span>
                  <span class="hm-row-text">${escapeHtml(e.h || '')}</span>
                  <span class="hm-row-val">${escapeHtml(timeAgo(e.t || 0))}</span>
                </a>`).join('')}
            </div>
          </div>` : ''}
      </section>`;
  }

  const starters: Array<{ ti: number; part: string; kicker: string; title: string }> = [];
  for (const t of titles) {
    if (t.partial && t.scope_parts && t.scope_parts.length) {
      for (const p of t.scope_parts.slice(0, 2)) {
        starters.push({ ti: t.title, part: p, kicker: `${t.title} CFR`, title: `Part ${p}` });
        if (starters.length >= 4) break;
      }
    } else {
      const c = HOME_CONTENT[t.title];
      if (c) {
        for (const card of c.cards.slice(0, 2)) {
          starters.push({ ti: t.title, part: card.part, kicker: `${t.title} CFR · ${card.kicker}`, title: card.title });
          if (starters.length >= 4) break;
        }
      }
    }
    if (starters.length >= 4) break;
  }

  return `
    <section class="hm-card hm-resume" aria-label="Start reading">
      <div class="hm-card-top">
        <span class="hm-kicker">Start here</span>
      </div>
      <div class="hm-resume-title is-static">Open a regulation to begin</div>
      <p class="hm-muted">Pick a key part below or search across your downloaded titles from the bar above.</p>
      ${starters.length ? `
        <div class="hm-starter-grid">
          ${starters.map(s => `
            <a class="hm-starter" href="${titleHref(s.ti, 'part/' + encodeURIComponent(s.part))}">
              <span class="hm-starter-kicker">${escapeHtml(s.kicker)}</span>
              <span class="hm-starter-name">${escapeHtml(s.title)}</span>
            </a>`).join('')}
        </div>` : ''}
    </section>`;
}

function workspacesCardHtml(projects: WorkspaceRecord[]): string {
  const sorted = [...projects].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 3);
  const body = sorted.length ? `
    <div class="hm-ws-list">
      ${sorted.map(p => {
        const chips = (p.sections || []).slice(0, 3).map(s => {
          const ok = titleInstalled(s.title);
          const href = ok ? `#/title/${s.title}/section/${encodeURIComponent(s.id)}` : `#/library/${s.title}`;
          const tip = ok ? '' : ` title="Title ${s.title} isn’t installed. Open Library"`;
          return `<a class="citation-chip${ok ? '' : ' is-dim'}" data-ref-tier="${ok ? 'cfr' : 'uninstalled'}" href="${href}"${tip}>${escapeHtml(s.label || '§ ' + s.id)}</a>`;
        }).join('');
        const extra = (p.sections || []).length - 3;
        return `
          <article class="hm-ws-item">
            <div class="hm-ws-top">
              <a class="hm-ws-name" href="#/projects/${encodeURIComponent(p.id)}">${projDot(p)}<span>${escapeHtml(p.name)}</span></a>
              <span class="hm-ws-meta">${joinSep([plural(p.sections.length, 'section'), escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))])}</span>
            </div>
            ${p.description ? `<p class="hm-ws-desc">${escapeHtml(p.description)}</p>` : ''}
            ${chips ? `<div class="hm-ws-chips">${chips}${extra > 0 ? `<a class="hm-more-chip" href="#/projects/${encodeURIComponent(p.id)}">+${extra}</a>` : ''}</div>` : ''}
          </article>`;
      }).join('')}
    </div>` : `
    <div class="hm-empty-block">
      <div class="hm-empty-title">Organize program compliance</div>
      <p class="hm-muted">Group pinned sections and notes for a safety program, facility audit, or permit review.</p>
      <div class="hm-empty-acts">
        <button type="button" class="btn btn-sm btn-accent" data-hm-act="new-workspace">${icon('plus')} New workspace</button>
      </div>
    </div>`;

  return `
    <section class="hm-card hm-ws" aria-label="Workspaces">
      <div class="hm-panel-head">
        <h2 class="hm-panel-title">${icon('folder')} Workspaces${projects.length ? ` <span class="hm-count">${projects.length}</span>` : ''}</h2>
        <div class="hm-panel-acts">
          <button type="button" class="hm-inline-link" data-hm-act="new-workspace">+ New</button>
          <a class="hm-inline-link" href="#/projects">All workspaces</a>
        </div>
      </div>
      ${body}
    </section>`;
}

function titleLivingSignalHtml(t: TitleSnapshotRow, recent: RecentSectionItem[], projects: WorkspaceRecord[]): string {
  const lastInTitle = recent.find(e => e.ti === t.title);
  if (lastInTitle) {
    return `<a class="hm-signal-link" href="${sectionLinkHref(lastInTitle)}">Last read ${escapeHtml(lastInTitle.l)}${SEP}${escapeHtml(timeAgo(lastInTitle.t || 0))}</a>`;
  }
  const ws = projects.find(p => (p.sections || []).some(s => s.title === t.title));
  if (ws) {
    return `<a class="hm-signal-link" href="#/projects/${encodeURIComponent(ws.id)}">${projDot(ws)}In ${escapeHtml(ws.name)}</a>`;
  }
  if (t.news && t.news.count > 0) {
    return `<a class="hm-signal-link" href="#/news">${escapeHtml(plural(t.news.count, 'recent OSHA update'))}</a>`;
  }
  return `<span class="hm-signal-muted">${t.section_count ? `${fmt(t.section_count)} sections ready` : 'Ready offline'}</span>`;
}

function titleStatusHtml(t: TitleSnapshotRow, staleSet: Set<number>): string {
  if (t.unreadable) return statPill('stale', 'Needs rebuild', { bare: true });
  const j = jobFor(t.title, 'title');
  if (j) return statPill('busy', j.state === 'running' ? 'Updating' : 'Queued', { bare: true });
  if (staleSet.has(t.title)) return statPill('stale', 'Update available', { bare: true });
  if (t.partial) {
    const parts = (t.scope_parts || []).length;
    const text = parts ? `Partial · ${plural(parts, 'part')}` : 'Partial';
    return statPill('partial', text, { bare: true });
  }
  return `<span class="hm-title-ed">${escapeHtml(shortDate(t.edition) || 'Ready')}</span>`;
}

function titlePartsHtml(t: TitleSnapshotRow): string {
  if (t.partial && t.scope_parts && t.scope_parts.length) {
    return `
      <div class="hm-title-parts">
        ${t.scope_parts.slice(0, 3).map(p => `<a class="hm-part-chip" href="${titleHref(t.title, 'part/' + encodeURIComponent(p))}"><span class="hm-part-num">Part ${escapeHtml(p)}</span></a>`).join('')}
        ${t.scope_parts.length > 3 ? `<span class="hm-part-more">+${t.scope_parts.length - 3} more</span>` : ''}
      </div>`;
  }
  const parts = ((HOME_CONTENT[t.title] || { cards: [] }).cards || []).slice(0, 3);
  if (parts.length) {
    return `
      <div class="hm-title-parts">
        ${parts.map(c => {
          const label = c.title.replace(/^Part\s+\d+\s*[—–-]\s*/, '');
          return `<a class="hm-part-chip" href="${titleHref(t.title, 'part/' + encodeURIComponent(c.part))}"><span class="hm-part-num">${escapeHtml(c.part)}</span><span>${escapeHtml(label)}</span></a>`;
        }).join('')}
      </div>`;
  }
  return `
    <div class="hm-title-parts">
      <button type="button" class="hm-part-chip" data-hm-act="open-contents" data-title="${t.title}">Browse contents</button>
    </div>`;
}

function titlesBandHtml(
  titles: TitleSnapshotRow[],
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  totalSections: number,
  totalRead: number,
): string {
  const staleSet = new Set(((state.navLibData && state.navLibData.titles) || []).filter(isStale).map(t => t.title));
  const corpora = syncCorporaState();
  const deskId = state.activeDesk || 'all';
  const visibleTitles = deskId === 'all'
    ? titles
    : titles.filter(t => mapRawDeskToId(t.desk, t.title) === deskId);
  const shown = visibleTitles.length ? visibleTitles : titles;
  const ribbonHtml = deskFilterRibbonHtml(deskId, corpora);

  const cards = shown.map(t => {
    const read = visitedCountFor(t.title);
    const count = Number(t.section_count || 0);
    const pct = count ? Math.min(100, read / count * 100) : 0;
    const agencies = (t.agencies || []).slice(0, 2);
    const corpus = corpora.find(c => c.tier === 'federal-reg' && c.title_num === t.title)
      || { tier: 'federal-reg' as const, desk: mapRawDeskToId(t.desk, t.title), corpus_id: '', jurisdiction: 'US', jurisdiction_label: 'Federal', code: String(t.title), name: t.name, agencies: [] };
    const rTier = refTierForCorpus(corpus);
    const tierTag = TIER_META[corpus.tier]?.tag || 'FEDERAL REG';

    return `
      <article class="hm-title-card has-tier-bar" data-ref-tier="${rTier}">
        <div class="hm-title-top">
          <span class="hm-title-kicker"><span class="tier-pip" aria-hidden="true"></span> ${escapeHtml(tierTag)} · ${t.title} CFR${agencies.length ? `${SEP}<span class="hm-title-ag">${agencies.map(escapeHtml).join(' · ')}</span>` : ''}</span>
          ${titleStatusHtml(t, staleSet)}
        </div>
        <h3 class="hm-title-name"><a href="${titleHref(t.title)}">${escapeHtml(t.name)}</a></h3>
        ${t.summary
          ? `<p class="hm-title-desc">${escapeHtml(t.summary)}</p>`
          : !(state.homeSnapshot && Array.isArray(state.homeSnapshot.titles))
            ? skeletonHtml('summary')
            : ''}
        ${titlePartsHtml(t)}
        <div class="hm-title-foot">
          <div class="hm-title-signal-row">
            ${titleLivingSignalHtml(t, recent, projects)}
            ${t.partial
              ? `<a class="hm-inline-link" href="#/library/${t.title}">Add parts</a>`
              : `<button type="button" class="hm-inline-link" data-hm-act="open-contents" data-title="${t.title}">Contents</button>`}
          </div>
          <div class="hm-prog-track" title="${fmt(read)} of ${fmt(count)} sections read" aria-hidden="true"><span style="width:${read ? Math.max(3, Math.round(pct)) : 0}%"></span></div>
        </div>
      </article>`;
  }).join('');

  return `
    <section class="hm-titles" id="hm-titles" aria-label="Downloaded titles">
      <div class="hm-sec-head">
        <div class="hm-sec-head-left">
          <h2 class="hm-sec-title">Downloaded Frameworks</h2>
          <span class="hm-sec-meta">${joinSep([plural(shown.length, 'framework'), `${fmt(totalSections)} sections offline`, totalRead ? `${fmt(totalRead)} read` : ''])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add or update frameworks ${icon('chevronRight')}</a>
      </div>
      ${ribbonHtml}
      <div class="hm-title-grid">${cards}</div>
    </section>`;
}

interface HomeNewsItem {
  category: string;
  title: string;
  published_at: string;
  penalty_usd?: number;
  cfr_parts?: Array<{ title: number; part: string | number }>;
  sections?: string[];
}

function pulseChipsHtml(a: HomeNewsItem): string {
  const chips: string[] = [];
  for (const r of (a.cfr_parts || []).slice(0, 2)) {
    const ok = titleInstalled(r.title);
    chips.push(`<a class="citation-chip${ok ? '' : ' is-dim'}" data-ref-tier="${ok ? 'cfr' : 'uninstalled'}" href="${newsPartHref(r.title, r.part)}">${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
  }
  for (const s of (a.sections || []).slice(0, Math.max(0, 3 - chips.length))) {
    const ok = titleInstalled(29);
    chips.push(`<a class="citation-chip${ok ? '' : ' is-dim'}" data-ref-tier="${ok ? 'cfr' : 'uninstalled'}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`);
  }
  return chips.length ? `<div class="hm-news-chips">${chips.join('')}</div>` : '';
}

function newsSkeletonHtml(): string {
  return `
    <div class="hm-panel-head">
      <h2 class="hm-panel-title">${icon('news')} Regulatory Pulse</h2>
      <div class="hm-panel-acts">
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
      </div>
    </div>
    <div class="hm-news-skel" aria-busy="true" aria-label="Loading OSHA news…">
      ${[1, 2, 3].map(() => `<div class="hm-news-skel-item">${skeletonHtml('pulse')}</div>`).join('')}
    </div>`;
}

function newsSectionHtml(data: { articles?: HomeNewsItem[] } | null | undefined, status: NewsStatusSnapshot | null | undefined): string {
  const articles = (data && data.articles) || [];
  const pill = newsStatusPillHtml(status);
  if (!articles.length) {
    return `
      <div class="hm-news-quiet">
        <span class="hm-news-quiet-label">${icon('news')} No OSHA regulatory news cached yet</span>
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
      </div>`;
  }
  const items = articles.slice(0, 3).map(a => `
    <article class="hm-news-item">
      <div class="hm-news-top">
        <span class="hm-news-kicker">${escapeHtml(newsKicker(a))}</span>
        <span class="hm-news-right">
          ${a.penalty_usd ? `<span class="hm-news-fig">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : ''}
          <time class="hm-news-date">${escapeHtml(shortDate(a.published_at))}</time>
        </span>
      </div>
      <a class="hm-news-title" href="#/news?cat=${encodeURIComponent(a.category)}">${escapeHtml(a.title)}</a>
      ${pulseChipsHtml(a)}
    </article>`).join('');

  return `
    <div class="hm-panel-head">
      <h2 class="hm-panel-title">${icon('news')} Regulatory Pulse</h2>
      <div class="hm-panel-acts">
        <span id="hm-news-pill">${pill}</span>
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
      </div>
    </div>
    <div class="hm-news-grid">${items}</div>`;
}

async function hydrateHome(seq: number): Promise<void> {
  const titlesPromise = getJSON<{ ai_configured: boolean; titles: TitleSnapshotRow[] }>('/api/titles/snapshot').then(snap => {
    if (seq !== state.routeSeq) return;
    if (snap && Array.isArray(snap.titles)) {
      state.homeSnapshot = snap;
      const u = loadUsage();
      const installed = new Set(snap.titles.map(t => t.title));
      const split = (key: string): [number, string] => { const i = key.indexOf('|'); return [parseInt(key.slice(0, i), 10), key.slice(i + 1)]; };
      const recent: RecentSectionItem[] = Object.entries(u.s)
        .map(([k, e]) => { const [ti, id] = split(k); return { ...e, ti, id }; })
        .filter(e => installed.has(e.ti))
        .sort((a, b) => (b.t || 0) - (a.t || 0));
      const totalSections = snap.titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
      const totalRead = snap.titles.reduce((a, t) => a + visitedCountFor(t.title), 0);
      const box = document.getElementById('hm-titles');
      if (box) {
        box.outerHTML = titlesBandHtml(snap.titles, recent, loadProjects(), totalSections, totalRead);
      }
    }
  }).catch(() => {}).finally(() => {
    const el = document.getElementById('hm-titles');
    if (el && seq === state.routeSeq) el.dataset.snapshotLoaded = '1';
  });

  const newsPromise = Promise.all([
    getJSON<{ articles?: HomeNewsItem[]; total?: number }>('/api/news?limit=3'),
    getJSON<NewsStatusSnapshot>('/api/news/status'),
  ]).then(([data, status]) => {
    if (seq !== state.routeSeq) return;
    const box = document.getElementById('hm-news');
    if (box) box.innerHTML = newsSectionHtml(data, status);
    if (data && data.articles && data.articles.length) {
      lsSetJSON(HOME_NEWS_CACHE, { t: Date.now(), data: { articles: data.articles.slice(0, 30), total: data.total, offset: 0 } });
    }
    if (status) lsSetJSON(HOME_STATUS_CACHE, { t: Date.now(), data: status });
  }).catch(() => {
    if (seq !== state.routeSeq) return;
    const box = document.getElementById('hm-news');
    if (box) box.innerHTML = newsSectionHtml({ articles: [] }, null);
  }).finally(() => {
    const el = document.getElementById('hm-news');
    if (el && seq === state.routeSeq) el.dataset.newsLoaded = '1';
  });

  await Promise.allSettled([titlesPromise, newsPromise]);
}

export function renderHomeScreen({ enter = true }: { enter?: boolean } = {}): void {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = 'Home · FRAMEWORK';
  setViewHead('');

  const u = loadUsage();
  const titles = installedFallbackList();
  const installed = new Set(titles.map(t => t.title));
  const split = (key: string): [number, string] => { const i = key.indexOf('|'); return [parseInt(key.slice(0, i), 10), key.slice(i + 1)]; };
  const recent: RecentSectionItem[] = Object.entries(u.s)
    .map(([k, e]) => { const [ti, id] = split(k); return { ...e, ti, id }; })
    .filter(e => installed.has(e.ti))
    .sort((a, b) => (b.t || 0) - (a.t || 0));

  const projects = loadProjects();
  const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
  const totalRead = titles.reduce((a, t) => a + visitedCountFor(t.title), 0);

  const cachedNews = lsGetJSON<{ data?: { articles?: HomeNewsItem[] } } | null>(HOME_NEWS_CACHE);
  const cachedStatus = lsGetJSON<{ data?: NewsStatusSnapshot } | null>(HOME_STATUS_CACHE);
  const sub = joinSep([
    escapeHtml(`${plural(titles.length, 'title')} ready offline`),
    state.metaInfo.edition ? `Edition ${escapeHtml(shortDate(state.metaInfo.edition))}` : '',
    projects.length ? escapeHtml(plural(projects.length, 'workspace')) : '',
  ]);

  const scrollTop = dom.main.scrollTop;
  dom.view.innerHTML = `
    <div class="hm">
      <header class="hm-head">
        <div>
          <div class="doc-kicker">FRAMEWORK</div>
          <h1 class="doc-title">Home</h1>
          <p class="hm-sub">${sub}</p>
        </div>
        <div class="hm-head-acts">
          <button type="button" class="btn btn-sm" data-hm-act="new-workspace">${icon('plus')} New workspace</button>
          <a class="btn btn-sm" href="#/library">${icon('download')} Manage library</a>
        </div>
      </header>
      ${activeTransfersHtml()}
      <div class="hm-top">
        ${resumeCardHtml(recent, titles)}
        ${workspacesCardHtml(projects)}
      </div>
      ${titlesBandHtml(titles, recent, projects, totalSections, totalRead)}
      <section class="hm-card hm-news" id="hm-news" aria-label="Regulatory Pulse">
        ${cachedNews && cachedNews.data ? newsSectionHtml(cachedNews.data, cachedStatus && cachedStatus.data) : newsSkeletonHtml()}
      </section>
    </div>`;

  if (enter) enterView();
  else dom.main.scrollTop = scrollTop;
  hydrateHome(state.routeSeq);
}

export function refreshHomeIfActive(): void {
  if (routeTarget() === 'overview' && dom.view.querySelector('.hm')) {
    renderHomeScreen({ enter: false });
  }
}

onView('click', async (e) => {
  if (!dom.view.querySelector('.hm')) return;
  const t = e.target as Element | null;
  const deskBtn = t?.closest<HTMLElement>('[data-desk]');
  if (deskBtn) {
    setActiveDesk(deskBtn.dataset.desk || 'all');
    renderHomeScreen({ enter: false });
    return;
  }
  const actEl = t?.closest<HTMLElement>('[data-hm-act]');
  if (!actEl) return;
  const act = actEl.dataset.hmAct;
  if (act === 'new-workspace') {
    startNewWorkspace();
  } else if (act === 'open-history') {
    state.historyFor = 'overview';
    openPanel('history', { focus: (e as MouseEvent).detail === 0 });
  } else if (act === 'open-contents') {
    const titleNum = Number(actEl.dataset.title);
    if (titleNum && titleNum !== state.currentTitle) await switchTitle(titleNum);
    openPanel('reader', { focus: true });
  }
});

on('projects:changed', ({ quiet }) => { if (!quiet) refreshHomeIfActive(); });
on('env:saved', () => refreshHomeIfActive());
