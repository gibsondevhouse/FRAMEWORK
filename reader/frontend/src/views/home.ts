import {
  AuthorityTier, CorpusSummary, NewsStatusSnapshot, state, TitleSnapshotRow, TransferJob,
} from '../state';
import { getJSON } from '../api/client';
import { pollJobsIfActive, queueBatch, setJobs } from '../api/jobs';
import { on } from '../core/events';
import { onView } from '../core/view_dispatch';
import { isStale, jobFor, LibraryTitleRow } from '../core/library_meta';
import {
  fmtMoney, newsKicker, newsPartHref, newsSectionHref, newsStatusPillHtml, titleInstalled,
} from '../core/news_format';
import { loadProjects, projDot, WorkspaceRecord } from '../core/projects_store';
import { HOME_CONTENT } from '../data/home_content';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection, plural, switchTitle } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import {
  enterView, escapeHtml, icon, lsGetJSON, lsSetJSON, safeHttpUrl, showToast, skeletonHtml,
} from '../dom';
import { routeTarget, updateRailBadge } from '../nav';
import { ensureNavLibrary } from '../panels/library_panel';
import { dom } from '../state_init';
import { fmt, loadUsage, timeAgo, titleHref, UsageSectionEntry, UsageStore, visitedCountFor } from '../usage';
import {
  allSystemFrameworks, corpusHashFor, deskFilterRibbonHtml, mapRawDeskToId,
  refTierForCorpus, setActiveDesk, syncCorporaState, SYSTEM_TIERS, TIER_META,
} from '../components/corpora';
import { SEP, joinSep, shortDate, statPill } from '../components/ui';
import { startNewWorkspace } from '../views/projects';

const HOME_NEWS_CACHE = 'newsCache:v1:all';
const HOME_STATUS_CACHE = 'newsCache:v1:status';

interface RecentSectionItem extends UsageSectionEntry {
  ti: number;
  id: string;
}

interface HomeNewsItem {
  category: string;
  title: string;
  published_at: string;
  penalty_usd?: number;
  cfr_parts?: Array<{ title: number; part: string | number }>;
  sections?: string[];
}

interface UpdateAttentionItem {
  id: string;
  tier: 'cfr' | 'fr';
  code: string;
  name: string;
  detail: string;
  actionLabel: string;
  act: 'update-title' | 'sync-fr';
  titleNum?: number;
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

function recentSectionsFor(usage: UsageStore, installedSet: Set<number>): RecentSectionItem[] {
  const split = (key: string): [number, string] => {
    const i = key.indexOf('|');
    return [parseInt(key.slice(0, i), 10), key.slice(i + 1)];
  };
  return Object.entries(usage.s)
    .map(([k, e]) => { const [ti, id] = split(k); return { ...e, ti, id }; })
    .filter(e => installedSet.has(e.ti))
    .sort((a, b) => (b.t || 0) - (a.t || 0));
}

function readCountForTitle(title: number, usage: UsageStore): number {
  const fromVisited = visitedCountFor(title);
  const prefix = `${title}|`;
  let fromUsage = 0;
  for (const k of Object.keys(usage.s)) {
    if (k.startsWith(prefix)) fromUsage += 1;
  }
  return Math.max(fromVisited, fromUsage);
}

function cachedNewsStatus(): NewsStatusSnapshot | null {
  const cachedNews = lsGetJSON<{ data?: { total?: number; articles?: HomeNewsItem[] } } | null>(HOME_NEWS_CACHE);
  const fallbackTotal = Number(cachedNews?.data?.total ?? cachedNews?.data?.articles?.length ?? 0);
  if (state.navNewsStatus) {
    if (!state.navNewsStatus.articles && fallbackTotal > 0) {
      return { ...state.navNewsStatus, articles: fallbackTotal };
    }
    return state.navNewsStatus;
  }
  const cached = lsGetJSON<{ data?: NewsStatusSnapshot } | null>(HOME_STATUS_CACHE);
  if (!cached?.data) return null;
  return !cached.data.articles && fallbackTotal > 0
    ? { ...cached.data, articles: fallbackTotal }
    : cached.data;
}

function libRowByTitle(): Map<number, LibraryTitleRow> {
  return new Map(((state.navLibData?.titles || []) as LibraryTitleRow[]).map(r => [r.title, r]));
}

function frAttentionReason(status: NewsStatusSnapshot | null): string | null {
  if (!status || !status.sync_enabled) return null;
  const srcs = Object.values(status.sources || {}).filter(s => s && s.enabled);
  const errored = srcs.find(s => s.retry_after || s.last_error);
  if (errored) return errored.last_error || 'Last sync failed';
  const now = Date.now();
  const due = srcs.find(s => s.next_due_at && Date.parse(s.next_due_at) <= now);
  if (due) return 'New filings due for sync';
  return null;
}

function collectAttentionItems(titles: TitleSnapshotRow[], status: NewsStatusSnapshot | null): UpdateAttentionItem[] {
  const items: UpdateAttentionItem[] = [];
  const libMap = libRowByTitle();
  for (const t of titles) {
    if (jobFor(t.title, 'title')) continue;
    if (t.unreadable) {
      items.push({
        id: `cfr-rebuild-${t.title}`,
        tier: 'cfr',
        code: `${t.title} CFR`,
        name: t.name,
        detail: 'Database unreadable — rebuild required',
        actionLabel: 'Rebuild',
        act: 'update-title',
        titleNum: t.title,
      });
      continue;
    }
    const row = libMap.get(t.title);
    if (row && isStale(row)) {
      const fromEd = shortDate(row.installed?.edition || t.edition) || 'Installed';
      const toEd = shortDate(row.latest) || 'Latest';
      items.push({
        id: `cfr-stale-${t.title}`,
        tier: 'cfr',
        code: `${t.title} CFR`,
        name: t.name,
        detail: `${fromEd} → eCFR ${toEd}`,
        actionLabel: 'Update',
        act: 'update-title',
        titleNum: t.title,
      });
    }
  }
  const frReason = frAttentionReason(status);
  if (frReason) {
    items.push({
      id: 'fr-sync',
      tier: 'fr',
      code: 'FR',
      name: 'Federal Register',
      detail: frReason,
      actionLabel: 'Sync FR',
      act: 'sync-fr',
    });
  }
  return items;
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

function systemsStripHtml(
  allFrameworks: CorpusSummary[],
  titles: TitleSnapshotRow[],
  totalSections: number,
  totalRead: number,
  status: NewsStatusSnapshot | null,
  attention: UpdateAttentionItem[],
): string {
  const activeTier = state.homeTierFilter || 'all';
  const cfrStaleCount = attention.filter(a => a.tier === 'cfr').length;
  const frNeedsSync = attention.some(a => a.tier === 'fr');
  const busy = Boolean(state.jobs.current || state.jobs.queued.length);

  const cards = SYSTEM_TIERS.map(tier => {
    const meta = TIER_META[tier];
    const list = allFrameworks.filter(c => c.tier === tier);
    const isSelected = activeTier === tier;
    let countLabel = '';
    let subLabel = '';
    let statusHtml = '';
    let pct = 0;

    if (tier === 'federal-statute') {
      const installedCnt = list.filter(c => c.installed).length;
      countLabel = installedCnt ? plural(installedCnt, 'statute') : plural(list.length, 'linked statute');
      subLabel = list.slice(0, 2).map(c => c.code.split('§§')[0].trim()).join(' · ') || 'Enabling acts';
      statusHtml = installedCnt
        ? statPill('synced', 'Installed', { bare: true })
        : statPill('partial', 'Authority map', { bare: true });
      pct = installedCnt ? 100 : list.length ? 35 : 0;
    } else if (tier === 'federal-reg') {
      countLabel = `${plural(titles.length, 'title')}`;
      subLabel = `${fmt(totalSections)} sections · ${fmt(totalRead)} read`;
      statusHtml = busy
        ? statPill('busy', 'Updating', { bare: true })
        : cfrStaleCount > 0
          ? statPill('stale', `${cfrStaleCount} ${cfrStaleCount === 1 ? 'update' : 'updates'}`, { bare: true })
          : statPill('synced', 'Current', { bare: true });
      pct = totalSections ? Math.min(100, Math.round((totalRead / totalSections) * 100)) : 0;
    } else if (tier === 'federal-register') {
      const articles = Number(status?.articles || 0);
      countLabel = articles ? `${fmt(articles)} filings` : 'Live feed';
      const lastOk = status?.sources?.federal_register?.last_ok_at;
      subLabel = lastOk ? `Synced ${timeAgo(Date.parse(lastOk))}` : 'Rules, notices & enforcement';
      statusHtml = frNeedsSync
        ? statPill('stale', 'Needs sync', { bare: true })
        : articles > 0
          ? statPill('synced', 'Synced', { bare: true })
          : statPill('partial', 'Ready', { bare: true });
      pct = articles > 0 ? 100 : 18;
    } else {
      const installedCnt = list.filter(c => c.installed).length;
      countLabel = installedCnt ? plural(installedCnt, 'state code') : plural(list.length, 'state overlay');
      subLabel = list.slice(0, 2).map(c => c.code).join(' · ') || 'State plans & codes';
      statusHtml = installedCnt
        ? statPill('synced', 'Installed', { bare: true })
        : statPill('partial', 'Mapped', { bare: true });
      pct = installedCnt ? 100 : list.length ? 30 : 0;
    }

    return `
      <button type="button" class="hm-sys-card has-tier-bar${isSelected ? ' is-selected' : ''}" data-ref-tier="${meta.refTier}" data-hm-tier="${escapeHtml(tier)}" aria-pressed="${isSelected}">
        <div class="hm-sys-top">
          <span class="hm-sys-kicker"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(meta.short)}</span>
          ${statusHtml}
        </div>
        <div class="hm-sys-name">${escapeHtml(meta.label)}</div>
        <div class="hm-sys-val">${escapeHtml(countLabel)}</div>
        <div class="hm-sys-sub">${escapeHtml(subLabel)}</div>
        <div class="hm-sys-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      </button>`;
  }).join('');

  return `
    <section class="hm-systems" id="hm-systems" aria-label="Legal framework systems">
      <div class="hm-sec-head">
        <div class="hm-sec-head-left">
          <h2 class="hm-sec-title">${icon('layers')} Legal Systems</h2>
          <span class="hm-sec-meta">Click any authority tier to focus frameworks below</span>
        </div>
        ${activeTier !== 'all' ? '<button type="button" class="hm-inline-link" data-hm-tier="all">Show all systems</button>' : ''}
      </div>
      <div class="hm-sys-grid">${cards}</div>
    </section>`;
}

function updatesBannerHtml(attention: UpdateAttentionItem[], titles: TitleSnapshotRow[]): string {
  const cfrUpdates = attention.filter(a => a.tier === 'cfr');
  const checkedAt = (state.navLibData as { checked_at?: number } | null)?.checked_at;

  if (attention.length) {
    return `
      <section class="hm-updates is-attention" id="hm-updates" aria-label="Frameworks needing updates">
        <div class="hm-upd-head">
          <div class="hm-upd-title-wrap">
            <span class="stat-dot is-stale" aria-hidden="true"></span>
            <h2 class="hm-upd-title">${escapeHtml(plural(attention.length, 'framework'))} need${attention.length === 1 ? 's' : ''} updating</h2>
            <span class="hm-upd-sub">Keep offline editions and Federal Register filings current</span>
          </div>
          <div class="hm-upd-head-acts">
            ${cfrUpdates.length > 1 ? `<button type="button" class="btn btn-sm btn-accent" data-hm-act="update-all">Update all CFR (${cfrUpdates.length})</button>` : ''}
            <button type="button" class="btn btn-sm" data-hm-act="check-updates">${icon('refresh')} Recheck</button>
          </div>
        </div>
        <div class="hm-upd-list">
          ${attention.map(item => `
            <div class="hm-upd-row" data-ref-tier="${item.tier}">
              <span class="tier-pip" aria-hidden="true"></span>
              <span class="hm-upd-code">${escapeHtml(item.code)}</span>
              <span class="hm-upd-name">${escapeHtml(item.name)}</span>
              <span class="hm-upd-detail">${escapeHtml(item.detail)}</span>
              <button type="button" class="btn btn-sm" data-hm-act="${item.act}"${item.titleNum ? ` data-title="${item.titleNum}"` : ''}>${escapeHtml(item.actionLabel)}</button>
            </div>`).join('')}
        </div>
      </section>`;
  }

  const verifiedText = checkedAt
    ? `Checked ${timeAgo(checkedAt * 1000)}`
    : titles.length
      ? `${plural(titles.length, 'CFR title')} ready offline`
      : 'Ready';

  return `
    <section class="hm-updates is-synced" id="hm-updates" aria-label="Framework update status">
      <div class="hm-upd-calm">
        <div class="hm-upd-calm-left">
          <span class="stat-dot is-synced" aria-hidden="true"></span>
          <span class="hm-upd-calm-title">All frameworks up to date</span>
          ${SEP}
          <span class="hm-upd-calm-meta">${escapeHtml(verifiedText)}</span>
        </div>
        <div class="hm-upd-calm-acts">
          <button type="button" class="hm-inline-link" data-hm-act="check-updates">${icon('refresh')} Check for updates</button>
          <a class="hm-inline-link" href="#/library">Library catalog ${icon('chevronRight')}</a>
        </div>
      </div>
    </section>`;
}

function workFootprintHtml(
  titles: TitleSnapshotRow[],
  usage: UsageStore,
  projects: WorkspaceRecord[],
  totalRead: number,
): string {
  const installedSet = new Set(titles.map(t => t.title));
  const visitsByTitle = new Map<number, number>();
  let totalVisits = 0;
  for (const [k, e] of Object.entries(usage.s)) {
    const ti = parseInt(k.slice(0, k.indexOf('|')), 10);
    if (!installedSet.has(ti)) continue;
    const n = Number(e.n || 1);
    visitsByTitle.set(ti, (visitsByTitle.get(ti) || 0) + n);
    totalVisits += n;
  }
  const partsExplored = Object.keys(usage.p).filter(k => installedSet.has(parseInt(k.slice(0, k.indexOf('|')), 10))).length;
  const totalPinned = projects.reduce((sum, p) => sum + (p.sections?.length || 0) + (p.cases?.length || 0), 0);
  const openTasks = projects.reduce((sum, p) => sum + (p.projects || []).filter(t => t.status !== 'done').length, 0);

  const slices = [...visitsByTitle.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ti, visits], idx) => ({
      ti,
      visits,
      pct: totalVisits ? Math.max(4, Math.round((visits / totalVisits) * 100)) : 0,
      tone: idx === 0 ? 'cfr' : idx === 1 ? 'state' : idx === 2 ? 'usc' : 'fr',
    }));

  const distHtml = slices.length ? `
    <div class="hm-fp-dist">
      <div class="hm-fp-bar" role="img" aria-label="Reading activity distribution across frameworks">
        ${slices.map(s => `<span class="hm-fp-seg" data-ref-tier="${s.tone}" style="width:${s.pct}%" title="${s.ti} CFR: ${s.pct}% of study sessions"></span>`).join('')}
      </div>
      <div class="hm-fp-legend">
        ${slices.map(s => `<span class="hm-fp-leg-item" data-ref-tier="${s.tone}"><span class="tier-pip" aria-hidden="true"></span>${s.ti} CFR <strong>${s.pct}%</strong></span>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="hm-footprint" aria-label="Your work across frameworks">
      <div class="hm-fp-metrics">
        <div class="hm-fp-stat">
          <span class="hm-fp-num">${fmt(totalRead)}</span>
          <span class="hm-fp-lbl">Sections read</span>
        </div>
        <div class="hm-fp-stat">
          <span class="hm-fp-num">${fmt(partsExplored)}</span>
          <span class="hm-fp-lbl">Parts explored</span>
        </div>
        <div class="hm-fp-stat">
          <span class="hm-fp-num">${fmt(totalPinned)}</span>
          <span class="hm-fp-lbl">Pins &amp; clips</span>
        </div>
        <div class="hm-fp-stat">
          <span class="hm-fp-num">${fmt(openTasks)}</span>
          <span class="hm-fp-lbl">Open tasks</span>
        </div>
      </div>
      ${distHtml}
    </div>`;
}

function resumeCardHtml(
  recent: RecentSectionItem[],
  titles: TitleSnapshotRow[],
  usage: UsageStore,
  projects: WorkspaceRecord[],
  totalRead: number,
): string {
  const footprint = workFootprintHtml(titles, usage, projects, totalRead);

  if (recent.length) {
    const last = recent[0];
    const href = sectionLinkHref(last);
    const expanded = Boolean(state.homeHistoryExpanded);
    const trail = expanded ? recent.slice(1, 13) : recent.slice(1, 4);
    const hasMore = recent.length > 4;

    return `
      <section class="hm-card hm-resume" aria-label="Continue reading">
        <div class="hm-card-top">
          <span class="hm-kicker">Continue reading</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t || 0))}</span>
        </div>
        <div class="hm-resume-loc">
          <span class="hm-loc-tier" data-ref-tier="cfr"><span class="tier-pip" aria-hidden="true"></span>${last.ti} CFR</span>
          ${last.p ? `${SEP}<a href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
          ${last.ul ? `${SEP}<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ''}
        </div>
        <a class="hm-resume-title" href="${href}">${escapeHtml(last.l)} ${escapeHtml(last.h || '')}</a>
        <div class="hm-resume-acts">
          <a class="btn btn-sm btn-accent" href="${href}">Resume reading ${icon('chevronRight')}</a>
          ${last.p ? `<a class="btn btn-sm" href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
        </div>
        ${footprint}
        ${trail.length ? `
          <div class="hm-trail">
            <div class="hm-trail-head">
              <span class="hm-kicker">Recently opened</span>
              ${hasMore ? `<button type="button" class="hm-inline-link" data-hm-act="toggle-history">${expanded ? 'Show less' : `Show all (${recent.length - 1})`}</button>` : ''}
            </div>
            <div class="hm-trail-list">
              ${trail.map(e => `
                <a class="hm-trail-row" href="${sectionLinkHref(e)}">
                  <span class="hm-tag" data-ref-tier="cfr"><span class="tier-pip" aria-hidden="true"></span>${e.ti} CFR</span>
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
      <p class="hm-muted">Pick a key part below or search across your frameworks from the bar above.</p>
      ${starters.length ? `
        <div class="hm-starter-grid">
          ${starters.map(s => `
            <a class="hm-starter" href="${titleHref(s.ti, 'part/' + encodeURIComponent(s.part))}">
              <span class="hm-starter-kicker">${escapeHtml(s.kicker)}</span>
              <span class="hm-starter-name">${escapeHtml(s.title)}</span>
            </a>`).join('')}
        </div>` : ''}
      ${footprint}
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
        const tasks = p.projects || [];
        const openTasks = tasks.filter(x => x.status !== 'done').length;
        const cases = (p.cases || []).length;
        const tabGroups = (p.tab_groups || []).length;
        const metaParts = [
          plural(p.sections.length, 'section'),
          tasks.length ? `${openTasks}/${tasks.length} open tasks` : '',
          cases ? plural(cases, 'case') : '',
          tabGroups ? plural(tabGroups, 'tab group') : '',
          escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now())),
        ];
        return `
          <article class="hm-ws-item">
            <div class="hm-ws-top">
              <a class="hm-ws-name" href="#/projects/${encodeURIComponent(p.id)}">${projDot(p)}<span>${escapeHtml(p.name)}</span></a>
              <span class="hm-ws-meta">${joinSep(metaParts)}</span>
            </div>
            ${p.description ? `<p class="hm-ws-desc">${escapeHtml(p.description)}</p>` : ''}
            ${chips ? `<div class="hm-ws-chips">${chips}${extra > 0 ? `<a class="hm-more-chip" href="#/projects/${encodeURIComponent(p.id)}">+${extra}</a>` : ''}</div>` : ''}
          </article>`;
      }).join('')}
    </div>` : `
    <div class="hm-empty-block">
      <div class="hm-empty-title">Organize program compliance</div>
      <p class="hm-muted">Group pinned sections, clipped DOL cases, action tasks, and saved dual-pane tab groups across CFR, FR, U.S.C., and State frameworks.</p>
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
    return `<a class="hm-signal-link" href="#/news">${escapeHtml(plural(t.news.count, 'recent update'))}</a>`;
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
      <a class="hm-part-chip" href="${titleHref(t.title)}">Browse contents</a>
    </div>`;
}

function cfrCardHtml(
  t: TitleSnapshotRow,
  staleSet: Set<number>,
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  usage: UsageStore,
): string {
  const read = readCountForTitle(t.title, usage);
  const count = Number(t.section_count || 0);
  const pct = count ? Math.min(100, (read / count) * 100) : 0;
  const agencies = (t.agencies || []).slice(0, 2);
  const pinnedInTitle = projects.reduce((sum, p) => sum + (p.sections || []).filter(s => s.title === t.title).length, 0);
  const isTitleStale = staleSet.has(t.title) || Boolean(t.unreadable);
  const busy = Boolean(jobFor(t.title, 'title'));

  return `
    <article class="hm-title-card has-tier-bar" data-ref-tier="cfr">
      <div class="hm-title-top">
        <span class="hm-title-kicker"><span class="tier-pip" aria-hidden="true"></span> FEDERAL REG · ${t.title} CFR${agencies.length ? `${SEP}<span class="hm-title-ag">${agencies.map(escapeHtml).join(' · ')}</span>` : ''}</span>
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
          ${isTitleStale && !busy
            ? `<button type="button" class="hm-inline-link is-warn" data-hm-act="update-title" data-title="${t.title}">${t.unreadable ? 'Rebuild' : 'Update'}</button>`
            : t.partial
              ? `<a class="hm-inline-link" href="#/library/${t.title}">Add parts</a>`
              : `<a class="hm-inline-link" href="${titleHref(t.title)}">Start page ${icon('chevronRight')}</a>`}
        </div>
        <div class="hm-prog-meta">
          <span>${fmt(read)} of ${fmt(count)} read</span>
          ${pinnedInTitle ? `<span>${plural(pinnedInTitle, 'pin')}</span>` : ''}
        </div>
        <div class="hm-prog-track" title="${fmt(read)} of ${fmt(count)} sections read" aria-hidden="true"><span style="width:${read ? Math.max(3, Math.round(pct)) : 0}%"></span></div>
      </div>
    </article>`;
}

function extraFrameworkCardHtml(
  c: CorpusSummary,
  projects: WorkspaceRecord[],
  status: NewsStatusSnapshot | null,
): string {
  const refTier = refTierForCorpus(c);
  const meta = TIER_META[c.tier] || TIER_META.state;
  const href = corpusHashFor(c);
  const isInstalled = c.installed !== false;
  const clippedCases = projects.reduce((sum, p) => sum + (p.cases || []).length, 0);

  let statusPill = '';
  let chipsHtml = '';
  let footLeft = '';
  let footRight = `<a class="hm-inline-link" href="${escapeHtml(href)}">Open framework ${icon('chevronRight')}</a>`;

  if (c.tier === 'federal-register') {
    const frReason = frAttentionReason(status);
    const articles = Number(status?.articles || c.section_count || 0);
    statusPill = frReason
      ? statPill('stale', 'Sync due', { bare: true })
      : articles > 0
        ? statPill('synced', 'Synced', { bare: true })
        : statPill('partial', 'Ready', { bare: true });
    chipsHtml = `
      <div class="hm-title-parts">
        <a class="hm-part-chip" href="#/news?cat=rules"><span class="hm-part-num">Final Rules</span></a>
        <a class="hm-part-chip" href="#/news?cat=rulemaking"><span class="hm-part-num">Proposed</span></a>
        <a class="hm-part-chip" href="#/news?cat=enforcement"><span class="hm-part-num">Enforcement</span></a>
      </div>`;
    footLeft = `<span class="hm-signal-muted">${joinSep([
      articles ? `${fmt(articles)} filings cached` : 'Federal Register API v1',
      clippedCases ? plural(clippedCases, 'clipped case') : '',
    ])}</span>`;
    footRight = frReason
      ? '<button type="button" class="hm-inline-link is-warn" data-hm-act="sync-fr">Sync FR</button>'
      : `<a class="hm-inline-link" href="#/news">Newsroom ${icon('chevronRight')}</a>`;
  } else if (c.tier === 'federal-statute') {
    statusPill = isInstalled
      ? statPill('synced', 'Installed', { bare: true })
      : statPill('partial', c.status_label || 'Authority', { bare: true });
    const ext = safeHttpUrl(c.external_url);
    const linked = (c.linked_titles || [])
      .filter(n => titleInstalled(n))
      .slice(0, 2)
      .map(n => `<a class="hm-part-chip" href="#/title/${n}/"><span class="hm-part-num">${n} CFR</span><span>Implementing rules</span></a>`)
      .join('');
    chipsHtml = `
      <div class="hm-title-parts">
        ${linked}
        ${ext ? `<a class="hm-part-chip" href="${escapeHtml(ext)}" target="_blank" rel="noopener noreferrer">Official U.S.C. ${icon('external')}</a>` : ''}
      </div>`;
    footLeft = `<span class="hm-signal-muted">${escapeHtml(c.status_label || 'Statutory authority layer')}</span>`;
  } else {
    statusPill = isInstalled
      ? statPill('synced', 'Installed', { bare: true })
      : statPill('partial', c.jurisdiction_label || 'State overlay', { bare: true });
    const linked = (c.linked_titles || [])
      .filter(n => titleInstalled(n))
      .slice(0, 2)
      .map(n => `<a class="hm-part-chip" href="#/title/${n}/"><span class="hm-part-num">${n} CFR</span><span>Federal baseline</span></a>`)
      .join('');
    chipsHtml = linked ? `<div class="hm-title-parts">${linked}</div>` : '';
    footLeft = `<span class="hm-signal-muted">${escapeHtml(c.agencies.join(' · ') || 'Delegated state program')}</span>`;
  }

  return `
    <article class="hm-title-card has-tier-bar" data-ref-tier="${refTier}">
      <div class="hm-title-top">
        <span class="hm-title-kicker"><span class="tier-pip${isInstalled ? '' : ' is-hollow'}" aria-hidden="true"></span> ${escapeHtml(meta.tag)} · ${escapeHtml(c.code)}${c.agencies.length ? `${SEP}<span class="hm-title-ag">${c.agencies.slice(0, 2).map(escapeHtml).join(' · ')}</span>` : ''}</span>
        ${statusPill}
      </div>
      <h3 class="hm-title-name"><a href="${escapeHtml(href)}">${escapeHtml(c.name)}</a></h3>
      ${c.summary ? `<p class="hm-title-desc">${escapeHtml(c.summary)}</p>` : ''}
      ${chipsHtml}
      <div class="hm-title-foot">
        <div class="hm-title-signal-row">
          ${footLeft}
          ${footRight}
        </div>
        <div class="hm-prog-track is-tier" aria-hidden="true"><span style="width:${isInstalled ? 100 : 28}%"></span></div>
      </div>
    </article>`;
}

function titlesBandHtml(
  titles: TitleSnapshotRow[],
  allFrameworks: CorpusSummary[],
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  totalSections: number,
  totalRead: number,
  status: NewsStatusSnapshot | null,
  usage: UsageStore,
): string {
  const staleSet = new Set(((state.navLibData && state.navLibData.titles) || []).filter(isStale).map(t => t.title));
  syncCorporaState();
  const deskId = state.activeDesk || 'all';
  const tierFilter = state.homeTierFilter || 'all';
  const snapByTitle = new Map(titles.map(t => [t.title, t]));

  const filteredByTier = tierFilter === 'all'
    ? allFrameworks
    : allFrameworks.filter(c => c.tier === tierFilter);
  const filtered = deskId === 'all'
    ? filteredByTier
    : filteredByTier.filter(c => c.tier === 'federal-register' || mapRawDeskToId(c.desk, c.title_num ?? null) === deskId);
  const shown = filtered.length ? filtered : filteredByTier;

  const tierCounts = new Map<string, number>([['all', allFrameworks.length]]);
  for (const c of allFrameworks) tierCounts.set(c.tier, (tierCounts.get(c.tier) || 0) + 1);

  const tierTabsHtml = `
    <div class="hm-tier-tabs" role="group" aria-label="Filter by legal framework system">
      <button type="button" class="hm-tier-tab${tierFilter === 'all' ? ' is-active' : ''}" data-hm-tier="all" aria-pressed="${tierFilter === 'all'}">
        <span>All Systems</span><span class="hm-tier-count">${tierCounts.get('all') || 0}</span>
      </button>
      ${SYSTEM_TIERS.map(t => {
        const m = TIER_META[t];
        const cnt = tierCounts.get(t) || 0;
        const on = tierFilter === t;
        return `<button type="button" class="hm-tier-tab${on ? ' is-active' : ''}" data-ref-tier="${m.refTier}" data-hm-tier="${escapeHtml(t)}" aria-pressed="${on}">
          <span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(m.short)}</span><span class="hm-tier-count">${cnt}</span>
        </button>`;
      }).join('')}
    </div>`;

  const ribbonHtml = deskFilterRibbonHtml(deskId, filteredByTier);

  // Order cards consistently: CFR first when viewing All, then FR, U.S.C., State
  const orderRank: Record<string, number> = {
    'federal-reg': 0,
    'federal-register': 1,
    'federal-statute': 2,
    'state': 3,
    'county': 4,
    'standard': 5,
  };
  const ordered = [...shown].sort((a, b) => (orderRank[a.tier] ?? 9) - (orderRank[b.tier] ?? 9));

  const cards = ordered.map(c => {
    if (c.tier === 'federal-reg' && c.title_num != null) {
      const snap = snapByTitle.get(c.title_num);
      if (snap) return cfrCardHtml(snap, staleSet, recent, projects, usage);
    }
    return extraFrameworkCardHtml(c, projects, status);
  }).join('');

  return `
    <section class="hm-titles" id="hm-titles" aria-label="Legal frameworks">
      <div class="hm-sec-head">
        <div class="hm-sec-head-left">
          <h2 class="hm-sec-title">Legal Frameworks</h2>
          <span class="hm-sec-meta">${joinSep([plural(shown.length, 'framework'), `${fmt(totalSections)} CFR sections offline`, totalRead ? `${fmt(totalRead)} read` : ''])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add or update frameworks ${icon('chevronRight')}</a>
      </div>
      <div class="hm-filters">
        ${tierTabsHtml}
        ${ribbonHtml}
      </div>
      <div class="hm-title-grid">${cards}</div>
    </section>`;
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
    <div class="hm-news-skel" aria-busy="true" aria-label="Loading regulatory news…">
      ${[1, 2, 3].map(() => `<div class="hm-news-skel-item">${skeletonHtml('pulse')}</div>`).join('')}
    </div>`;
}

function newsSectionHtml(data: { articles?: HomeNewsItem[] } | null | undefined, status: NewsStatusSnapshot | null | undefined): string {
  const articles = (data && data.articles) || [];
  const pill = newsStatusPillHtml(status);
  if (!articles.length) {
    return `
      <div class="hm-news-quiet">
        <span class="hm-news-quiet-label">${icon('news')} No Federal Register or enforcement updates cached yet</span>
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

function patchHomeDynamicBands(titles: TitleSnapshotRow[], status: NewsStatusSnapshot | null): void {
  const usage = loadUsage();
  const installed = new Set(titles.map(t => t.title));
  const recent = recentSectionsFor(usage, installed);
  const projects = loadProjects();
  const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
  const totalRead = titles.reduce((a, t) => a + readCountForTitle(t.title, usage), 0);
  const allFrameworks = allSystemFrameworks(titles, titles, status);
  const attention = collectAttentionItems(titles, status);

  const sysEl = document.getElementById('hm-systems');
  if (sysEl) sysEl.outerHTML = systemsStripHtml(allFrameworks, titles, totalSections, totalRead, status, attention);

  const updEl = document.getElementById('hm-updates');
  if (updEl) updEl.outerHTML = updatesBannerHtml(attention, titles);

  const box = document.getElementById('hm-titles');
  if (box) {
    const loaded = box.dataset.snapshotLoaded;
    box.outerHTML = titlesBandHtml(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage);
    const nextBox = document.getElementById('hm-titles');
    if (nextBox && loaded) nextBox.dataset.snapshotLoaded = loaded;
  }
}

async function hydrateHome(seq: number): Promise<void> {
  const titlesPromise = getJSON<{ ai_configured: boolean; titles: TitleSnapshotRow[] }>('/api/titles/snapshot').then(snap => {
    if (seq !== state.routeSeq) return;
    if (snap && Array.isArray(snap.titles)) {
      state.homeSnapshot = snap;
      patchHomeDynamicBands(snap.titles, cachedNewsStatus());
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
    const totalArticles = Number(data?.total ?? data?.articles?.length ?? 0);
    const enrichedStatus = status
      ? { ...status, articles: status.articles || totalArticles }
      : null;
    if (enrichedStatus) {
      state.navNewsStatus = enrichedStatus;
      lsSetJSON(HOME_STATUS_CACHE, { t: Date.now(), data: enrichedStatus });
      updateRailBadge();
    }
    const box = document.getElementById('hm-news');
    if (box) box.innerHTML = newsSectionHtml(data, enrichedStatus);
    if (data && data.articles && data.articles.length) {
      lsSetJSON(HOME_NEWS_CACHE, { t: Date.now(), data: { articles: data.articles.slice(0, 30), total: data.total, offset: 0 } });
    }
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, enrichedStatus);
  }).catch(() => {
    if (seq !== state.routeSeq) return;
    const box = document.getElementById('hm-news');
    if (box) box.innerHTML = newsSectionHtml({ articles: [] }, null);
  }).finally(() => {
    const el = document.getElementById('hm-news');
    if (el && seq === state.routeSeq) el.dataset.newsLoaded = '1';
  });

  // Silently check eCFR catalog staleness (cached 60s; gracefully ignored if offline)
  const libPromise = ensureNavLibrary().then(() => {
    if (seq !== state.routeSeq) return;
    updateRailBadge();
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, cachedNewsStatus());
  }).catch(() => {});

  await Promise.allSettled([titlesPromise, newsPromise, libPromise]);
}

export function renderHomeScreen({ enter = true }: { enter?: boolean } = {}): void {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = 'Home · FRAMEWORK';
  setViewHead('');

  const usage = loadUsage();
  const titles = installedFallbackList();
  const installed = new Set(titles.map(t => t.title));
  const recent = recentSectionsFor(usage, installed);
  const projects = loadProjects();
  const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
  const totalRead = titles.reduce((a, t) => a + readCountForTitle(t.title, usage), 0);

  const cachedNews = lsGetJSON<{ data?: { articles?: HomeNewsItem[] } } | null>(HOME_NEWS_CACHE);
  const status = cachedNewsStatus();
  const allFrameworks = allSystemFrameworks(titles, titles, status);
  const attention = collectAttentionItems(titles, status);

  const sub = joinSep([
    escapeHtml(`${plural(titles.length, 'CFR title')} offline`),
    'FR · U.S.C. · State mapped',
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
      ${systemsStripHtml(allFrameworks, titles, totalSections, totalRead, status, attention)}
      ${updatesBannerHtml(attention, titles)}
      <div class="hm-top">
        ${resumeCardHtml(recent, titles, usage, projects, totalRead)}
        ${workspacesCardHtml(projects)}
      </div>
      ${titlesBandHtml(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage)}
      <section class="hm-card hm-news" id="hm-news" aria-label="Regulatory Pulse">
        ${cachedNews && cachedNews.data ? newsSectionHtml(cachedNews.data, status) : newsSkeletonHtml()}
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

  const tierBtn = t?.closest<HTMLElement>('[data-hm-tier]');
  if (tierBtn) {
    const nextTier = (tierBtn.dataset.hmTier || 'all') as 'all' | AuthorityTier;
    state.homeTierFilter = state.homeTierFilter === nextTier && nextTier !== 'all' ? 'all' : nextTier;
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, cachedNewsStatus());
    return;
  }

  const deskBtn = t?.closest<HTMLElement>('[data-desk]');
  if (deskBtn) {
    setActiveDesk(deskBtn.dataset.desk || 'all');
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, cachedNewsStatus());
    return;
  }

  const actEl = t?.closest<HTMLElement>('[data-hm-act]');
  if (!actEl) return;
  const act = actEl.dataset.hmAct;

  if (act === 'new-workspace') {
    startNewWorkspace();
  } else if (act === 'toggle-history') {
    state.homeHistoryExpanded = !state.homeHistoryExpanded;
    renderHomeScreen({ enter: false });
  } else if (act === 'open-contents') {
    const titleNum = Number(actEl.dataset.title);
    if (titleNum && titleNum !== state.currentTitle) await switchTitle(titleNum);
    window.location.hash = `#/title/${titleNum || state.currentTitle}/`;
  } else if (act === 'update-title') {
    const titleNum = Number(actEl.dataset.title);
    if (!titleNum) return;
    (actEl as HTMLButtonElement).disabled = true;
    try {
      const job = await getJSON<TransferJob>(`/api/library/${titleNum}/update`, { method: 'POST' });
      const snap = await getJSON<import('../state').JobsSnapshot>('/api/library/jobs');
      setJobs(snap);
      pollJobsIfActive();
      showToast(job?.label ? `Queued update for ${job.label}` : `Queued update for Title ${titleNum}`);
      refreshHomeIfActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 5000);
      (actEl as HTMLButtonElement).disabled = false;
    }
  } else if (act === 'update-all') {
    (actEl as HTMLButtonElement).disabled = true;
    try {
      await queueBatch('/api/library/update-all', null, 'Every installed title is already current');
      refreshHomeIfActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 5000);
      (actEl as HTMLButtonElement).disabled = false;
    }
  } else if (act === 'check-updates') {
    (actEl as HTMLButtonElement).disabled = true;
    try {
      await ensureNavLibrary(true);
      updateRailBadge();
      const titles = state.homeSnapshot?.titles || installedFallbackList();
      patchHomeDynamicBands(titles, cachedNewsStatus());
      showToast('Checked eCFR for framework updates');
    } catch {
      showToast('Couldn’t reach eCFR right now', 4000);
    } finally {
      (actEl as HTMLButtonElement).disabled = false;
    }
  } else if (act === 'sync-fr') {
    (actEl as HTMLButtonElement).disabled = true;
    try {
      await getJSON('/api/news/refresh', { method: 'POST', body: JSON.stringify({ force: true }) });
      showToast('Federal Register sync started');
      hydrateHome(state.routeSeq);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 4000);
      (actEl as HTMLButtonElement).disabled = false;
    }
  }
});

on('projects:changed', ({ quiet }) => { if (!quiet) refreshHomeIfActive(); });
on('env:saved', () => refreshHomeIfActive());
on('jobs:updated', () => {
  if (routeTarget() === 'overview' && dom.view.querySelector('.hm')) {
    const existing = dom.view.querySelector('.hm-transfer');
    const html = activeTransfersHtml();
    if (Boolean(existing) !== Boolean(html)) refreshHomeIfActive();
  }
});
on('jobs:finished', () => { refreshHomeIfActive(); });
