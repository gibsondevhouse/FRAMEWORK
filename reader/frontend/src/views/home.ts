import {
  AuthorityTier, CorpusSummary, HomeFrCat, HomeTab, NewsStatusSnapshot,
  state, TitleSnapshotRow, TransferJob,
} from '../state';
import { getJSON } from '../api/client';
import { pollJobsIfActive, queueBatch, setJobs } from '../api/jobs';
import { emit, on } from '../core/events';
import { onView } from '../core/view_dispatch';
import { amendedWeek, isStale, jobFor, LibraryTitleRow } from '../core/library_meta';
import {
  fmtMoney, frDocumentNumber, inspectionActivityNr, linkifyNewsText,
  newsKicker, newsPartHref, newsSectionHref, newsStatusPillHtml, titleInstalled,
} from '../core/news_format';
import { loadProjects, projDot, WorkspaceRecord } from '../core/projects_store';
import { HOME_CONTENT } from '../data/home_content';
import { updateChatContext } from '../components/chat';
import { restoreTabGroup } from '../components/reader_tabs';
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
  allSystemFrameworks, authorityForCorpus, corpusHashFor, deskFilterRibbonHtml,
  FOUNDATIONAL_ADMIN_STATUTES, mapRawDeskToId, refTierForCorpus, setActiveDesk,
  syncCorporaState, SYSTEM_TIERS, TIER_META,
} from '../components/corpora';
import { fmtMB, fmtSections, SEP, joinSep, shortDate, statPill } from '../components/ui';
import { startNewWorkspace } from '../views/projects';

const HOME_NEWS_CACHE = 'newsCache:v1:all';
const HOME_STATUS_CACHE = 'newsCache:v1:status';
const HOME_TAB_ORDER: HomeTab[] = ['overview', 'usc', 'cfr', 'fr'];

interface RecentSectionItem extends UsageSectionEntry {
  ti: number;
  id: string;
}

interface HomeNewsItem {
  guid?: string;
  category: string;
  title: string;
  link?: string;
  published_at: string;
  agency?: string;
  citation?: string | null;
  action?: string | null;
  effective_on?: string | null;
  comments_close_on?: string | null;
  scheduled_on?: string | null;
  docket_ids?: string[];
  penalty_usd?: number;
  snippet?: string;
  takeaways?: Array<{ label: string; text: string }>;
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

const FEATURED_CATALOG_FALLBACK: Array<{
  title: number;
  name: string;
  agencies: string[];
  sections: number;
  size_mb: number;
  summary: string;
}> = [
  {
    title: 21,
    name: 'Food and Drugs',
    agencies: ['FDA', 'DEA'],
    sections: 8404,
    size_mb: 21.2,
    summary: 'FDA rules for food, drugs, biologics, medical devices, cosmetics and tobacco, plus controlled substances.',
  },
  {
    title: 26,
    name: 'Internal Revenue',
    agencies: ['IRS'],
    sections: 6018,
    size_mb: 83.8,
    summary: 'Federal tax regulations: income, estate, excise and employment taxes.',
  },
  {
    title: 48,
    name: 'Federal Acquisition Regulations System',
    agencies: ['GSA', 'DOD', 'NASA'],
    sections: 11185,
    size_mb: 21.3,
    summary: 'How the government buys: the Federal Acquisition Regulation and agency supplements.',
  },
  {
    title: 10,
    name: 'Energy',
    agencies: ['NRC', 'DOE'],
    sections: 5330,
    size_mb: 20.1,
    summary: 'Nuclear licensing and safety (NRC), Department of Energy programs, efficiency standards and nuclear facility oversight.',
  },
  {
    title: 12,
    name: 'Banks and Banking',
    agencies: ['OCC', 'FRS', 'FDIC', 'CFPB'],
    sections: 7193,
    size_mb: 38.0,
    summary: 'Rules for banks, credit unions and lenders: capital, consumer lending, deposit insurance and the Federal Reserve.',
  },
  {
    title: 14,
    name: 'Aeronautics and Space',
    agencies: ['FAA', 'NASA'],
    sections: 6382,
    size_mb: 16.2,
    summary: 'Aviation safety: aircraft certification, pilots, airports and air carriers, plus commercial space and NASA.',
  },
];

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
    const isSyncing = Boolean(status?.syncing);
    const isErr = Object.values(status?.sources || {}).some(s => s && s.enabled && (s.retry_after || s.last_error));
    items.push({
      id: 'fr-sync',
      tier: 'fr',
      code: 'FR',
      name: 'Federal Register',
      detail: isSyncing ? 'Syncing latest filings…' : frReason,
      actionLabel: isSyncing ? 'Syncing…' : (isErr ? 'Retry sync' : 'Sync now'),
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

function cachedNewsArticles(): HomeNewsItem[] {
  const cachedNews = lsGetJSON<{ data?: { articles?: HomeNewsItem[] } } | null>(HOME_NEWS_CACHE);
  return Array.isArray(cachedNews?.data?.articles) ? cachedNews!.data!.articles! : [];
}

function frCategoryLabel(cat: string): string {
  if (cat === 'public_inspection') return 'Public Inspection';
  if (cat === 'rules') return 'Final Rule';
  if (cat === 'rulemaking') return 'Proposed Rule';
  if (cat === 'notices') return 'Notice';
  return 'Filing';
}

function articlePrimaryHref(a: HomeNewsItem): string {
  const docNum = frDocumentNumber(a);
  if (docNum) return `#/news/fr/${encodeURIComponent(docNum)}`;
  const actNr = inspectionActivityNr(a);
  if (actNr) return `#/news/inspection/${encodeURIComponent(actNr)}`;
  return `#/news?cat=${encodeURIComponent(a.category || 'all')}`;
}

function articleDateNoteHtml(a: HomeNewsItem): string {
  if (a.comments_close_on) {
    return `<span class="hm-fr-date-badge is-deadline">Comments close ${escapeHtml(shortDate(a.comments_close_on))}</span>`;
  }
  if (a.effective_on) {
    return `<span class="hm-fr-date-badge is-effective">Effective ${escapeHtml(shortDate(a.effective_on))}</span>`;
  }
  if (a.scheduled_on) {
    return `<span class="hm-fr-date-badge">Publishes ${escapeHtml(shortDate(a.scheduled_on))}</span>`;
  }
  return '';
}

function systemsStripHtml(
  allFrameworks: CorpusSummary[],
  titles: TitleSnapshotRow[],
  status: NewsStatusSnapshot | null,
  attention: UpdateAttentionItem[],
  articles: HomeNewsItem[],
): string {
  const activeTier = state.homeTierFilter || 'all';
  const cfrAttention = attention.filter(a => a.tier === 'cfr');
  const cfrStaleCount = cfrAttention.length;
  const frNeedsSync = attention.some(a => a.tier === 'fr');
  const busy = Boolean(state.jobs.current || state.jobs.queued.length);

  // Real Federal Register filings (exclude DOL enforcement records)
  const frArticles = (articles || [])
    .filter(a => a && a.category !== 'enforcement')
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));

  // Real eCFR catalog amendment info (when /api/library has hydrated)
  const libTitles = (state.navLibData?.titles || []) as LibraryTitleRow[];
  const week = libTitles.length ? amendedWeek({ titles: libTitles }) : { newest: '', cut: '', recent: 0 };
  const amendedSorted = libTitles
    .filter(t => !t.reserved && t.amended)
    .sort((a, b) => String(b.amended || '').localeCompare(String(a.amended || '')));
  const latestEdition = week.newest || titles.reduce((m, t) => (t.edition && t.edition > m ? t.edition : m), '') || state.metaInfo.edition || '';

  const cards = SYSTEM_TIERS.map((tier) => {
    const meta = TIER_META[tier];
    const list = allFrameworks.filter(c => c.tier === tier);
    const isSelected = activeTier === tier;
    let headline = '';
    let detail = '';
    let footer = '';
    let statusHtml = '';

    if (tier === 'federal-statute') {
      const installedUsc = list.filter(c => c.installed && c.edition);
      const latestUsc = installedUsc.sort((a, b) => String(b.edition || '').localeCompare(String(a.edition || '')))[0];
      const linkedCfrSet = new Set(list.flatMap(c => c.linked_titles || []));
      const linkedRules = frArticles.filter(a =>
        (a.category === 'rules' || a.category === 'rulemaking')
        && (a.cfr_parts || []).some(p => linkedCfrSet.has(p.title)),
      );
      const latestLinked = linkedRules[0];
      const linkedUsc = latestLinked
        ? list.find(c => (c.linked_titles || []).some(n => (latestLinked.cfr_parts || []).some(p => p.title === n)))
        : null;

      if (latestUsc) {
        statusHtml = statPill('synced', 'Current', { bare: true });
        headline = `Updated ${shortDate(latestUsc.edition)}`;
        detail = `${latestUsc.code} · ${latestUsc.name}`;
        footer = 'Local U.S.C. edition verified';
      } else if (latestLinked && linkedUsc) {
        const shortUsc = linkedUsc.code.split('§§')[0].trim();
        const touchedParts = [...new Set(
          linkedRules.flatMap(a => (a.cfr_parts || []).map(p => `${p.title} CFR Part ${p.part}`)),
        )].slice(0, 2);
        statusHtml = `<span class="hm-sys-note">${escapeHtml(shortDate(latestLinked.published_at))}</span>`;
        headline = `${shortUsc} · ${plural(linkedRules.length, 'related rule')}`;
        detail = touchedParts.length
          ? `Implementing rulemaking active in ${touchedParts.join(' & ')}`
          : latestLinked.title;
        footer = 'USLM public-law diffing next';
      } else {
        const codes = list.slice(0, 3).map(c => c.code.split('§§')[0].trim()).join(' · ');
        statusHtml = '<span class="hm-sys-note">Feed planned</span>';
        headline = 'No statutory changes';
        detail = codes ? `Tracking statutory authority for ${codes}` : 'Federal enabling statutes ready for public-law tracking';
        footer = 'USLM public-law sync planned';
      }
    } else if (tier === 'federal-reg') {
      const cfrFrLead = frArticles.find(a =>
        (a.category === 'rules' || a.category === 'rulemaking') && a.cfr_parts && a.cfr_parts.length > 0,
      ) || frArticles.find(a => a.cfr_parts && a.cfr_parts.length > 0);
      statusHtml = busy
        ? statPill('busy', 'Updating', { bare: true })
        : cfrStaleCount > 0
          ? statPill('stale', `${cfrStaleCount} ${cfrStaleCount === 1 ? 'update' : 'updates'}`, { bare: true })
          : statPill('synced', 'Up to date', { bare: true });

      if (cfrStaleCount > 0) {
        headline = `${plural(cfrStaleCount, 'edition update')} available`;
        detail = cfrAttention.slice(0, 2).map(a => `${a.code} (${a.detail})`).join(' · ');
        footer = 'Newer eCFR edition ready to sync';
      } else if (week.recent > 0) {
        const recentTitles = amendedSorted.filter(t => t.amended && t.amended >= week.cut);
        headline = `${plural(week.recent, 'title')} amended this week`;
        detail = recentTitles.slice(0, 2).map(t => `${t.title} CFR ${t.name || ''}`.trim()).join(' · ');
        footer = recentTitles[0]?.amended ? `Latest amendment ${shortDate(recentTitles[0].amended)}` : `eCFR ${shortDate(latestEdition)}`;
      } else if (amendedSorted.length > 0) {
        const top = amendedSorted[0];
        headline = `Amended ${shortDate(top.amended)}`;
        detail = `${top.title} CFR · ${top.name || `Title ${top.title}`}`;
        footer = latestEdition ? `eCFR edition ${shortDate(latestEdition)}` : 'Checked against eCFR';
      } else if (cfrFrLead) {
        const ref = cfrFrLead.cfr_parts?.[0];
        headline = ref ? `${ref.title} CFR Part ${ref.part} · ${frCategoryLabel(cfrFrLead.category)}` : `CFR rulemaking · ${shortDate(cfrFrLead.published_at)}`;
        detail = cfrFrLead.title;
        footer = latestEdition ? `eCFR ${shortDate(latestEdition)} · No pending updates` : 'No pending eCFR updates';
      } else {
        headline = 'No recent amendments';
        detail = latestEdition ? `All tracked CFR editions match eCFR ${shortDate(latestEdition)}` : 'Checked against latest eCFR edition';
        footer = 'No pending eCFR updates';
      }
    } else if (tier === 'federal-register') {
      const lead = frArticles[0];
      const second = frArticles[1];
      const lastOk = status?.sources?.federal_register?.last_ok_at;
      const frSyncing = Boolean(status?.syncing);
      statusHtml = frSyncing
        ? statPill('busy', 'Syncing…', { bare: true })
        : frNeedsSync
          ? statPill('stale', 'Update due', { bare: true })
          : lead
            ? statPill('synced', lastOk ? timeAgo(Date.parse(lastOk)) : 'Current', { bare: true })
            : '<span class="hm-sys-note">Ready</span>';

      if (lead) {
        headline = `${frCategoryLabel(lead.category)} · ${shortDate(lead.published_at)}`;
        detail = lead.title;
        footer = second
          ? `Also: ${frCategoryLabel(second.category)} · ${shortDate(second.published_at)}`
          : (lastOk ? `Synced ${timeAgo(Date.parse(lastOk))}` : 'Federal Register API v1');
      } else {
        headline = 'No recent filings';
        detail = 'Final rules, proposed rules, notices, and public inspection filings appear here after sync';
        footer = lastOk ? `Checked ${timeAgo(Date.parse(lastOk))}` : 'Federal Register API v1';
      }
    }

    return `
      <button type="button" class="hm-sys-card${isSelected ? ' is-selected' : ''}" data-ref-tier="${meta.refTier}" data-hm-tier="${escapeHtml(tier)}" aria-pressed="${isSelected}">
        <div class="hm-sys-top">
          <span class="hm-sys-kicker">${escapeHtml(meta.short)}</span>
          ${statusHtml}
        </div>
        <div class="hm-sys-val">${escapeHtml(headline)}</div>
        <div class="hm-sys-sub">${escapeHtml(detail)}</div>
        <div class="hm-sys-meta">${escapeHtml(footer)}</div>
      </button>`;
  }).join('');

  return `
    <section class="hm-systems" id="hm-systems" aria-label="Recent changes across federal frameworks">
      <div class="hm-sys-grid">${cards}</div>
    </section>`;
}

function updatesBannerHtml(attention: UpdateAttentionItem[], titles: TitleSnapshotRow[]): string {
  const checkedAt = (state.navLibData as { checked_at?: number } | null)?.checked_at;
  const frSyncing = Boolean(cachedNewsStatus()?.syncing);

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
            ${attention.length > 1 ? `<button type="button" class="btn btn-sm btn-accent" data-hm-act="update-all-attention">Update all (${attention.length})</button>` : ''}
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
              <button type="button" class="btn btn-sm" data-hm-act="${item.act}"${item.titleNum ? ` data-title="${item.titleNum}"` : ''}${item.act === 'sync-fr' && frSyncing ? ' disabled' : ''}>${escapeHtml(item.actionLabel)}</button>
            </div>`).join('')}
        </div>
      </section>`;
  }

  const verifiedText = checkedAt
    ? `Checked ${timeAgo(checkedAt * 1000)}`
    : titles.length
      ? `${plural(titles.length, 'CFR title')} & FR feed ready on this device`
      : 'Federal Register feed ready';

  return `
    <section class="hm-updates is-synced" id="hm-updates" aria-label="Framework update status">
      <div class="hm-upd-calm">
        <div class="hm-upd-calm-left">
          <span class="stat-dot is-synced" aria-hidden="true"></span>
          <span class="hm-upd-calm-title">All editions current</span>
          ${SEP}
          <span class="hm-upd-calm-meta">${escapeHtml(verifiedText)}</span>
        </div>
        <div class="hm-upd-calm-acts">
          <button type="button" class="hm-inline-link" data-hm-act="check-updates">${icon('refresh')} Check for updates</button>
          <a class="hm-inline-link" href="#/library">Browse library ${icon('chevronRight')}</a>
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
      tone: idx === 0 ? 'cfr' : idx === 1 ? 'usc' : idx === 2 ? 'fr' : 'ibr',
    }));

  const distHtml = slices.length ? `
    <div class="hm-fp-dist">
      <div class="hm-fp-bar" role="img" aria-label="Reading activity distribution across frameworks">
        ${slices.map(s => `<span class="hm-fp-seg" data-ref-tier="${s.tone}" style="width:${s.pct}%" title="${s.ti} CFR: ${s.pct}% of study sessions"></span>`).join('')}
      </div>
      <div class="hm-fp-legend">
        ${slices.map(s => `<span class="hm-fp-leg-item" data-ref-tier="${s.tone}"><span class="hm-fp-swatch" aria-hidden="true"></span>${s.ti} CFR <strong>${s.pct}%</strong></span>`).join('')}
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
          <span class="hm-fp-lbl">Saved &amp; clipped</span>
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
      <section class="hm-resume" aria-label="Continue reading">
        <div class="hm-card-top">
          <span class="hm-kicker">Continue reading</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t || 0))}</span>
        </div>
        <div class="hm-resume-loc">
          <span class="hm-loc-tier" data-ref-tier="cfr">${last.ti} CFR</span>
          ${last.p ? `${SEP}<a href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
          ${last.ul ? `${SEP}<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ''}
        </div>
        <a class="hm-resume-title" href="${href}">${escapeHtml(last.l)} ${escapeHtml(last.h || '')}</a>
        <div class="hm-resume-acts">
          <a class="btn btn-sm btn-accent" href="${href}">Resume reading ${icon('chevronRight')}</a>
          ${last.p ? `<a class="hm-inline-link hm-part-link" href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Open Part ${escapeHtml(last.p)} ${icon('chevronRight')}</a>` : ''}
          <button type="button" class="hm-inline-link" data-hm-act="resume-split" data-title="${last.ti}" data-section="${escapeHtml(last.id)}"${last.u ? ` data-unit="${escapeHtml(last.u)}"` : ''}>${icon('stack')} Side-by-side</button>
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
                  <span class="hm-tag" data-ref-tier="cfr">${e.ti} CFR</span>
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
    <section class="hm-resume" aria-label="Start reading">
      <div class="hm-card-top">
        <span class="hm-kicker">Start here</span>
      </div>
      <div class="hm-resume-title is-static">Open a federal code or rulemaking feed</div>
      <p class="hm-muted">Pick a framework below, check Federal Register updates, or search across federal codes from the bar above.</p>
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
        const tabGroups = p.tab_groups || [];
        const firstGroup = tabGroups[0];
        const metaParts = [
          plural(p.sections.length, 'section'),
          tasks.length ? `${openTasks}/${tasks.length} open tasks` : '',
          cases ? plural(cases, 'case') : '',
          tabGroups.length ? plural(tabGroups.length, 'tab group') : '',
          escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now())),
        ];
        return `
          <article class="hm-ws-item">
            <div class="hm-ws-top">
              <a class="hm-ws-name" href="#/projects/${encodeURIComponent(p.id)}">${projDot(p)}<span>${escapeHtml(p.name)}</span></a>
              <span class="hm-ws-meta">${joinSep(metaParts)}</span>
            </div>
            ${p.description ? `<p class="hm-ws-desc">${escapeHtml(p.description)}</p>` : ''}
            ${(chips || firstGroup) ? `<div class="hm-ws-chips">
              ${chips}
              ${extra > 0 ? `<a class="hm-more-chip" href="#/projects/${encodeURIComponent(p.id)}">+${extra}</a>` : ''}
              ${firstGroup ? `<button type="button" class="hm-more-chip is-action" data-hm-act="restore-tabgroup" data-proj-id="${escapeHtml(p.id)}" data-group-id="${escapeHtml(firstGroup.id)}" title="Restore saved reader tab group: ${escapeHtml(firstGroup.name)}">Restore tabs ${icon('chevronRight')}</button>` : ''}
            </div>` : ''}
          </article>`;
      }).join('')}
    </div>` : `
    <div class="hm-empty-block">
      <div class="hm-empty-title">Organize your federal research</div>
      <p class="hm-muted">Curate pinned provisions, Federal Register filings, notes, and side-by-side reading sets in one place.</p>
      <div class="hm-empty-acts">
        <button type="button" class="btn btn-sm" data-hm-act="new-workspace">${icon('plus')} Create workspace</button>
      </div>
    </div>`;

  return `
    <section class="hm-ws" aria-label="Workspaces">
      <div class="hm-panel-head">
        <h2 class="hm-panel-title">Workspaces${projects.length ? ` <span class="hm-count">${projects.length}</span>` : ''}</h2>
        <div class="hm-panel-acts">
          <button type="button" class="hm-inline-link" data-hm-act="new-workspace">+ New</button>
          <a class="hm-inline-link" href="#/projects">View all</a>
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
        <span class="hm-title-kicker">${t.title} CFR${agencies.length ? `${SEP}<span class="hm-title-ag">${agencies.map(escapeHtml).join(' · ')}</span>` : ''}</span>
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
              : `<a class="hm-inline-link" href="${titleHref(t.title)}">Open ${icon('chevronRight')}</a>`}
        </div>
        <div class="hm-prog-meta">
          <span>${fmt(read)} of ${fmt(count)} read</span>
          ${pinnedInTitle ? `<span>${plural(pinnedInTitle, 'saved')}</span>` : ''}
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
  const meta = TIER_META[c.tier] || TIER_META['federal-statute'];
  const href = corpusHashFor(c);
  const isInstalled = c.installed !== false;

  let statusPill = '';
  let chipsHtml = '';
  let footLeft = '';
  let footRight = `<a class="hm-inline-link" href="${escapeHtml(href)}">Open framework ${icon('chevronRight')}</a>`;

  if (c.tier === 'federal-register') {
    const frReason = frAttentionReason(status);
    const frSyncing = Boolean(status?.syncing);
    const articles = Number(status?.articles || c.section_count || 0);
    statusPill = frSyncing
      ? statPill('busy', 'Syncing…', { bare: true })
      : frReason
        ? statPill('stale', 'Sync due', { bare: true })
        : articles > 0
          ? statPill('synced', 'Synced', { bare: true })
          : statPill('partial', 'Ready', { bare: true });
    chipsHtml = `
      <div class="hm-title-parts">
        <a class="hm-part-chip" href="#/news?cat=rules"><span class="hm-part-num">Final Rules</span></a>
        <a class="hm-part-chip" href="#/news?cat=rulemaking"><span class="hm-part-num">Proposed</span></a>
        <a class="hm-part-chip" href="#/news?cat=notices"><span class="hm-part-num">Notices</span></a>
      </div>`;
    footLeft = `<span class="hm-signal-muted">${escapeHtml(
      articles ? `${fmt(articles)} filings cached` : 'Federal Register API v1',
    )}</span>`;
    footRight = frSyncing
      ? '<span class="hm-signal-muted">Syncing…</span>'
      : frReason
        ? '<button type="button" class="hm-inline-link is-warn" data-hm-act="sync-fr">Sync now</button>'
        : `<a class="hm-inline-link" href="#/news">Newsroom ${icon('chevronRight')}</a>`;
  } else {
    statusPill = isInstalled
      ? statPill('synced', 'Installed', { bare: true })
      : statPill('partial', c.status_label || 'Statutory', { bare: true });
    const ext = safeHttpUrl(c.external_url);
    const auth = authorityForCorpus(c);
    const provChips = (auth?.provisions || []).slice(0, 2).map(p => {
      const ok = titleInstalled(p.cfrTitle);
      const targetHref = ok
        ? (p.cfrSection ? `#/title/${p.cfrTitle}/section/${encodeURIComponent(p.cfrSection)}` : `#/title/${p.cfrTitle}/part/${encodeURIComponent(p.cfrPart || '')}`)
        : `#/library/${p.cfrTitle}`;
      const label = p.cfrSection ? `${p.cfrTitle} CFR § ${p.cfrSection}` : `${p.cfrTitle} CFR Part ${p.cfrPart}`;
      return `<a class="hm-part-chip" href="${targetHref}"><span class="hm-part-num">${escapeHtml(p.cite.replace(/^\d+\s+U\.S\.C\.\s*/, ''))}</span><span>→ ${escapeHtml(label)}</span></a>`;
    }).join('');
    const linked = !provChips ? (c.linked_titles || [])
      .filter(n => titleInstalled(n))
      .slice(0, 2)
      .map(n => `<a class="hm-part-chip" href="#/title/${n}/"><span class="hm-part-num">${n} CFR</span><span>Implementing rules</span></a>`)
      .join('') : '';
    chipsHtml = `
      <div class="hm-title-parts">
        ${provChips || linked}
        ${ext ? `<a class="hm-part-chip" href="${escapeHtml(ext)}" target="_blank" rel="noopener noreferrer">Official U.S.C. ${icon('external')}</a>` : ''}
      </div>`;
    footLeft = `<span class="hm-signal-muted">${escapeHtml(c.status_label || 'Federal statutory authority')}</span>`;
  }

  const kickerLead = c.tier === 'federal-register'
    ? 'Federal Register'
    : c.tier === 'federal-statute'
      ? c.code
      : `${c.code} · ${meta.short}`;

  return `
    <article class="hm-title-card has-tier-bar" data-ref-tier="${refTier}">
      <div class="hm-title-top">
        <span class="hm-title-kicker">${escapeHtml(kickerLead)}${c.tier !== 'federal-statute' && c.agencies.length ? `${SEP}<span class="hm-title-ag">${c.agencies.slice(0, 2).map(escapeHtml).join(' · ')}</span>` : ''}</span>
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
        <span>All</span><span class="hm-tier-count">${tierCounts.get('all') || 0}</span>
      </button>
      ${SYSTEM_TIERS.map(t => {
        const m = TIER_META[t];
        const cnt = tierCounts.get(t) || 0;
        const on = tierFilter === t;
        return `<button type="button" class="hm-tier-tab${on ? ' is-active' : ''}" data-ref-tier="${m.refTier}" data-hm-tier="${escapeHtml(t)}" aria-pressed="${on}">
          <span>${escapeHtml(m.short)}</span><span class="hm-tier-count">${cnt}</span>
        </button>`;
      }).join('')}
    </div>`;

  const ribbonHtml = deskFilterRibbonHtml(deskId, filteredByTier);

  // Order cards in federal authority order matching Band 1: U.S.C., CFR, Federal Register
  const orderRank: Record<string, number> = {
    'federal-statute': 0,
    'federal-reg': 1,
    'federal-register': 2,
    'standard': 3,
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
    <section class="hm-titles" id="hm-titles" aria-label="Federal frameworks">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Federal Frameworks</h2>
          <span class="hm-sec-meta">${joinSep([plural(shown.length, 'framework'), totalSections ? `${fmt(totalSections)} offline sections` : '', totalRead ? `${fmt(totalRead)} read` : ''])}</span>
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

function newsSkeletonHtml(heading = 'Federal Register Pulse'): string {
  return `
    <div class="hm-panel-head">
      <h2 class="hm-panel-title">${icon('news')} ${escapeHtml(heading)}</h2>
      <div class="hm-panel-acts">
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
      </div>
    </div>
    <div class="hm-news-skel" aria-busy="true" aria-label="Loading Federal Register updates…">
      ${[1, 2, 3].map(() => `<div class="hm-news-skel-item">${skeletonHtml('pulse')}</div>`).join('')}
    </div>`;
}

function newsDispatchCardHtml(a: HomeNewsItem): string {
  const href = articlePrimaryHref(a);
  const docNum = frDocumentNumber(a);
  const dateBadge = articleDateNoteHtml(a);
  const takeaway = a.takeaways?.[0]?.text || a.action || '';
  return `
    <article class="hm-news-item">
      <div class="hm-news-top">
        <span class="hm-news-kicker">${escapeHtml(newsKicker(a))}</span>
        <span class="hm-news-right">
          ${a.penalty_usd ? `<span class="hm-news-fig">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : ''}
          <time class="hm-news-date">${escapeHtml(shortDate(a.published_at))}</time>
        </span>
      </div>
      <a class="hm-news-title" href="${href}">${escapeHtml(a.title)}</a>
      ${takeaway ? `<p class="hm-news-summary">${linkifyNewsText(takeaway)}</p>` : ''}
      <div class="hm-news-foot">
        ${pulseChipsHtml(a)}
        <div class="hm-news-meta-row">
          ${dateBadge}
          <a class="hm-inline-link hm-news-open" href="${href}">${docNum ? 'Read preamble' : 'Open filing'} ${icon('chevronRight')}</a>
        </div>
      </div>
    </article>`;
}

function newsSectionHtml(
  data: { articles?: HomeNewsItem[] } | null | undefined,
  status: NewsStatusSnapshot | null | undefined,
  opts: { limit?: number; heading?: string } = {},
): string {
  const articles = (data && data.articles) || [];
  const pill = newsStatusPillHtml(status);
  const limit = opts.limit || 3;
  const heading = opts.heading || 'Federal Register Pulse';
  if (!articles.length) {
    const canSync = status?.sync_enabled !== false;
    const syncing = Boolean(status?.syncing);
    return `
      <div class="hm-news-quiet">
        <span class="hm-news-quiet-label">${icon('news')} No Federal Register filings cached yet</span>
        <div class="hm-panel-acts">
          ${canSync ? `<button type="button" class="btn btn-sm" data-hm-act="sync-fr"${syncing ? ' disabled' : ''}>${syncing ? 'Syncing…' : 'Sync now'}</button>` : ''}
          <a class="hm-inline-link" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
        </div>
      </div>`;
  }
  const items = articles.slice(0, limit).map(newsDispatchCardHtml).join('');

  return `
    <div class="hm-panel-head">
      <h2 class="hm-panel-title">${escapeHtml(heading)}</h2>
      <div class="hm-panel-acts">
        <span id="hm-news-pill">${pill}</span>
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
      </div>
    </div>
    <div class="hm-news-grid">${items}</div>`;
}

function homeTabsHtml(
  allFrameworks: CorpusSummary[],
  titles: TitleSnapshotRow[],
  status: NewsStatusSnapshot | null,
  attention: UpdateAttentionItem[],
  totalSections: number,
  totalRead: number,
  projectsCount: number,
): string {
  const tab = state.homeTab || 'overview';
  const uscCount = allFrameworks.filter(c => c.tier === 'federal-statute').length;
  const cfrCount = titles.length;
  const frCount = Number(status?.articles || 0);
  const cfrAlert = attention.some(a => a.tier === 'cfr');
  const frAlert = attention.some(a => a.tier === 'fr');

  const tabs: Array<{
    id: HomeTab;
    label: string;
    abbr: string;
    refTier?: string;
    countLabel?: string;
    sub: string;
    alert?: boolean;
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      abbr: 'DESK',
      countLabel: `${allFrameworks.length} frameworks`,
      sub: totalRead
        ? `${fmt(totalRead)} sections studied · ${plural(projectsCount, 'workspace')}`
        : 'All systems, reading desk & workspaces',
      alert: attention.length > 0,
    },
    {
      id: 'usc',
      label: 'United States Code',
      abbr: 'U.S.C.',
      refTier: 'usc',
      countLabel: plural(uscCount, 'statute'),
      sub: 'Enabling acts & CFR delegation',
    },
    {
      id: 'cfr',
      label: 'Code of Federal Regulations',
      abbr: 'CFR',
      refTier: 'cfr',
      countLabel: plural(cfrCount, 'title'),
      sub: totalSections ? `${fmt(totalSections)} offline sections & key parts` : 'Codified rules & offline editions',
      alert: cfrAlert,
    },
    {
      id: 'fr',
      label: 'Federal Register',
      abbr: 'FR',
      refTier: 'fr',
      countLabel: frCount ? `${fmt(frCount)} filings` : 'Daily feed',
      sub: 'Daily rules, deadlines & dockets',
      alert: frAlert,
    },
  ];

  return `
    <nav class="hm-tabs" id="hm-tabs" role="tablist" aria-label="Home sections">
      ${tabs.map(t => {
        const active = tab === t.id;
        return `<button type="button" class="hm-tab${active ? ' is-active' : ''}" id="hm-tab-${t.id}" role="tab" aria-selected="${active}" aria-controls="hm-tab-body" tabindex="${active ? '0' : '-1'}" data-hm-tab="${t.id}"${t.refTier ? ` data-ref-tier="${t.refTier}"` : ''}>
          <span class="hm-tab-top">
            <span class="hm-tab-abbr">${t.refTier ? '<span class="tier-pip" aria-hidden="true"></span>' : ''}${escapeHtml(t.abbr)}</span>
            <span class="hm-tab-right">
              ${t.alert ? '<span class="stat-dot is-stale" title="Update or sync due" aria-hidden="true"></span>' : ''}
              ${t.countLabel ? `<span class="hm-tab-count">${escapeHtml(t.countLabel)}</span>` : ''}
            </span>
          </span>
          <span class="hm-tab-label">${escapeHtml(t.label)}</span>
          <span class="hm-tab-sub">${escapeHtml(t.sub)}</span>
        </button>`;
      }).join('')}
    </nav>`;
}

function uscDossierCardHtml(
  c: CorpusSummary,
  titles: TitleSnapshotRow[],
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  usage: UsageStore,
  articles: HomeNewsItem[],
): string {
  const auth = authorityForCorpus(c);
  const href = corpusHashFor(c);
  const ext = safeHttpUrl(c.external_url);
  const linkedTitleNum = (c.linked_titles || [])[0];
  const linkedTitle = linkedTitleNum ? titles.find(t => t.title === linkedTitleNum) : null;
  const linkedInstalled = Boolean(linkedTitle);

  const relatedRules = linkedTitleNum
    ? articles.filter(a => a && a.category !== 'enforcement' && (a.cfr_parts || []).some(p => p.title === linkedTitleNum))
    : [];
  const readInLinked = linkedTitleNum ? readCountForTitle(linkedTitleNum, usage) : 0;
  const pinnedInLinked = linkedTitleNum
    ? projects.reduce((sum, p) => sum + (p.sections || []).filter(s => s.title === linkedTitleNum).length, 0)
    : 0;
  const lastInLinked = linkedTitleNum ? recent.find(e => e.ti === linkedTitleNum) : null;

  const statusPill = linkedInstalled
    ? statPill('synced', `Linked · ${linkedTitleNum} CFR`, { bare: true })
    : statPill('partial', c.status_label || 'Statutory', { bare: true });

  const chainHtml = `
    <div class="hm-chain-bar" aria-label="Federal authority delegation chain">
      <span class="hm-chain-node is-usc" data-ref-tier="usc"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(c.code.split('§§')[0].trim())}</span>
      <span class="hm-chain-arrow" aria-hidden="true">→</span>
      ${linkedTitleNum
        ? `<a class="hm-chain-node is-cfr" data-ref-tier="cfr" href="${linkedInstalled ? titleHref(linkedTitleNum) : `#/library/${linkedTitleNum}`}"><span class="tier-pip" aria-hidden="true"></span>${linkedTitleNum} CFR ${escapeHtml(linkedTitle?.name || '')}</a>`
        : '<span class="hm-chain-node is-cfr" data-ref-tier="cfr">Implementing CFR</span>'}
      <span class="hm-chain-arrow" aria-hidden="true">→</span>
      <a class="hm-chain-node is-fr" data-ref-tier="fr" href="${linkedTitleNum ? `#/news?cfr_title=${linkedTitleNum}` : '#/news'}"><span class="tier-pip" aria-hidden="true"></span>${relatedRules.length ? plural(relatedRules.length, 'FR filing') : 'FR Rulemaking'}</a>
    </div>`;

  const actsHtml = auth && auth.acts.length ? `
    <div class="hm-usc-block">
      <div class="hm-usc-sec-lbl">Principal Enacted Acts</div>
      <div class="hm-usc-acts">
        ${auth.acts.map(act => `<span class="hm-usc-act">${escapeHtml(act)}</span>`).join('')}
      </div>
    </div>` : '';

  const provsHtml = auth && auth.provisions.length ? `
    <div class="hm-usc-block">
      <div class="hm-usc-sec-lbl">Enabling Provisions → Implementing CFR</div>
      <div class="hm-usc-provs">
        ${auth.provisions.map(p => {
          const ok = titleInstalled(p.cfrTitle);
          const cfrHref = ok
            ? (p.cfrSection ? `#/title/${p.cfrTitle}/section/${encodeURIComponent(p.cfrSection)}` : `#/title/${p.cfrTitle}/part/${encodeURIComponent(p.cfrPart || '')}`)
            : `#/library/${p.cfrTitle}`;
          const cfrLabel = p.cfrSection ? `${p.cfrTitle} CFR § ${p.cfrSection}` : `${p.cfrTitle} CFR Part ${p.cfrPart}`;
          return `
            <div class="hm-usc-prov-row">
              <div class="hm-usc-prov-main">
                <span class="hm-usc-prov-cite">${escapeHtml(p.cite)}</span>
                <span class="hm-usc-prov-title">${escapeHtml(p.title)}</span>
              </div>
              <a class="citation-chip${ok ? '' : ' is-dim'}" data-ref-tier="${ok ? 'cfr' : 'uninstalled'}" href="${cfrHref}">${escapeHtml(cfrLabel)}</a>
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const footprintSignal = lastInLinked
    ? `<a class="hm-signal-link" href="${sectionLinkHref(lastInLinked)}">Studied ${escapeHtml(lastInLinked.l)} under this mandate${SEP}${escapeHtml(timeAgo(lastInLinked.t || 0))}</a>`
    : (readInLinked || pinnedInLinked)
      ? `<span class="hm-signal-muted">${joinSep([readInLinked ? `${fmt(readInLinked)} implementing sections read` : '', pinnedInLinked ? `${plural(pinnedInLinked, 'provision')} saved` : ''])}</span>`
      : `<span class="hm-signal-muted">${escapeHtml(auth?.frNote || 'Federal statutory authority')}</span>`;

  return `
    <article class="hm-title-card hm-usc-card has-tier-bar" data-ref-tier="usc">
      <div class="hm-title-top">
        <span class="hm-title-kicker">${escapeHtml(c.code)}${SEP}<span class="hm-title-ag">U.S. Congress</span></span>
        ${statusPill}
      </div>
      <h3 class="hm-title-name"><a href="${escapeHtml(href)}">${escapeHtml(c.name)}</a></h3>
      ${c.summary ? `<p class="hm-title-desc">${escapeHtml(c.summary)}</p>` : ''}
      ${chainHtml}
      ${actsHtml}
      ${provsHtml}
      <div class="hm-title-foot">
        <div class="hm-title-signal-row">
          ${footprintSignal}
          <div class="hm-usc-foot-acts">
            ${ext ? `<a class="hm-inline-link" href="${escapeHtml(ext)}" target="_blank" rel="noopener noreferrer">Official U.S.C. ${icon('external')}</a>` : ''}
            <a class="hm-inline-link" href="${escapeHtml(href)}">Authority overview ${icon('chevronRight')}</a>
          </div>
        </div>
      </div>
    </article>`;
}

function renderUscTabHtml(
  allFrameworks: CorpusSummary[],
  titles: TitleSnapshotRow[],
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  status: NewsStatusSnapshot | null,
  usage: UsageStore,
  articles: HomeNewsItem[],
): string {
  const uscList = allFrameworks.filter(c => c.tier === 'federal-statute');
  const deskId = state.activeDesk || 'all';
  const filtered = deskId === 'all'
    ? uscList
    : uscList.filter(c => mapRawDeskToId(c.desk, (c.linked_titles || [])[0] ?? null) === deskId);
  const shown = filtered.length ? filtered : uscList;
  const ribbonHtml = deskFilterRibbonHtml(deskId, uscList);

  const linkedCfrSet = new Set(uscList.flatMap(c => c.linked_titles || []));
  const relatedRules = (articles || [])
    .filter(a => a && a.category !== 'enforcement' && (a.cfr_parts || []).some(p => linkedCfrSet.has(p.title)));

  let totalActs = 0;
  let totalProvs = 0;
  for (const c of uscList) {
    const auth = authorityForCorpus(c);
    totalActs += auth?.acts.length || 1;
    totalProvs += auth?.provisions.length || 0;
  }

  const cards = shown.map(c => uscDossierCardHtml(c, titles, recent, projects, usage, articles)).join('');

  return `
    <div class="hm-tab-lead" data-ref-tier="usc">
      <div class="hm-tab-lead-copy">
        <div class="hm-tab-lead-kicker"><span class="ref-badge" data-ref-tier="usc">U.S.C. · STATUTORY AUTHORITY</span><span>Acts of Congress &amp; Regulatory Delegation</span></div>
        <h2 class="hm-tab-lead-title">United States Code</h2>
        <p class="hm-tab-lead-sub">Enabling federal statutes enacted by Congress, their major statutory mandates, and direct delegation chains into your installed CFR titles and active Federal Register rulemaking.</p>
      </div>
      <div class="hm-tab-lead-acts">
        <a class="btn btn-sm" href="https://uscode.house.gov/" target="_blank" rel="noopener noreferrer">Official U.S.C. Portal ${icon('external')}</a>
        <button type="button" class="btn btn-sm btn-accent" data-hm-tab="cfr">Implementing CFR Desk ${icon('chevronRight')}</button>
      </div>
    </div>
    <div class="hm-kpi-strip" data-ref-tier="usc" aria-label="United States Code telemetry">
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Tracked Statutes</span>
        <span class="hm-kpi-val">${fmt(uscList.length)} U.S.C. titles</span>
        <span class="hm-kpi-sub">Linked to ${plural(linkedCfrSet.size || titles.length, 'CFR title')}</span>
      </div>
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Principal Enacted Acts</span>
        <span class="hm-kpi-val">${fmt(totalActs)} organic acts</span>
        <span class="hm-kpi-sub">OSH Act, FLSA, RCRA, CAA, CWA, HMTA</span>
      </div>
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Enabling Mandates Mapped</span>
        <span class="hm-kpi-val">${fmt(totalProvs)} provisions</span>
        <span class="hm-kpi-sub">Deep-linked to implementing CFR parts</span>
      </div>
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Implementing Rulemaking</span>
        <span class="hm-kpi-val">${fmt(relatedRules.length)} FR dockets</span>
        <span class="hm-kpi-sub">${relatedRules[0] ? `Latest ${escapeHtml(shortDate(relatedRules[0].published_at))}` : 'Synced via Federal Register API'}</span>
      </div>
    </div>
    <section class="hm-titles" id="hm-titles" data-snapshot-loaded="1" aria-label="United States Code statutory dossiers">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Statutory Delegation &amp; Implementing Regulations</h2>
          <span class="hm-sec-meta">${joinSep([plural(shown.length, 'statutory title'), `${fmt(totalProvs)} mapped provisions`])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add CFR titles to expand statutory coverage ${icon('chevronRight')}</a>
      </div>
      ${ribbonHtml ? `<div class="hm-filters">${ribbonHtml}</div>` : ''}
      <div class="hm-title-grid is-usc-grid">${cards || '<p class="hm-muted">No U.S.C. titles configured.</p>'}</div>
    </section>
    <section class="hm-usc-foundations" aria-label="Foundational federal administrative statutes">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Cross-Agency Rulemaking &amp; Administrative Law Bedrock</h2>
          <span class="hm-sec-meta">Title 5 &amp; Title 44 U.S.C. · Governing all federal agency rulemaking and enforcement</span>
        </div>
      </div>
      <div class="hm-found-grid">
        ${FOUNDATIONAL_ADMIN_STATUTES.map(st => {
          const safeHref = safeHttpUrl(st.href);
          return `
            <article class="hm-found-card" data-ref-tier="usc">
              <div class="hm-found-top">
                <span class="hm-found-code">${escapeHtml(st.code)}</span>
                <span class="hm-found-scope">${escapeHtml(st.scope)}</span>
              </div>
              <h3 class="hm-found-name">${escapeHtml(st.name)}</h3>
              <div class="hm-found-act">${escapeHtml(st.act)}</div>
              <p class="hm-found-desc">${escapeHtml(st.summary)}</p>
              ${safeHref ? `<a class="hm-inline-link hm-found-link" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">Read on uscode.house.gov ${icon('external')}</a>` : ''}
            </article>`;
        }).join('')}
      </div>
    </section>
    <section class="hm-news" id="hm-news" data-news-loaded="1" aria-label="Implementing Federal Register rulemaking">
      ${newsSectionHtml({ articles: relatedRules }, status, { limit: 3, heading: 'Implementing Federal Register Rulemaking' })}
    </section>`;
}

function cfrCatalogDiscoveryHtml(titles: TitleSnapshotRow[]): string {
  const installedSet = new Set(titles.map(t => t.title));
  const libRows = ((state.navLibData?.titles || []) as LibraryTitleRow[])
    .filter(r => !r.reserved && !installedSet.has(r.title));

  const candidates = libRows.length
    ? libRows.slice(0, 6).map(r => ({
      title: r.title,
      name: r.name || `Title ${r.title}`,
      agencies: (r.agencies || []).slice(0, 3),
      sections: Number(r.sections || 0),
      size_mb: Number(r.size_mb || 0),
      summary: r.summary || '',
    }))
    : FEATURED_CATALOG_FALLBACK.filter(f => !installedSet.has(f.title)).slice(0, 6);

  if (!candidates.length) return '';

  return `
    <section class="hm-cfr-catalog" aria-label="Available in eCFR catalog">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Available in eCFR Catalog</h2>
          <span class="hm-sec-meta">Download full titles or individual parts for instant offline indexing</span>
        </div>
        <a class="hm-inline-link" href="#/library">Explore all 50 CFR titles ${icon('chevronRight')}</a>
      </div>
      <div class="hm-catalog-grid">
        ${candidates.map(c => {
          const busy = Boolean(jobFor(c.title, 'title'));
          return `
            <article class="hm-catalog-card" data-ref-tier="uninstalled">
              <div class="hm-title-top">
                <span class="hm-title-kicker">${c.title} CFR${c.agencies.length ? `${SEP}<span class="hm-title-ag">${c.agencies.map(escapeHtml).join(' · ')}</span>` : ''}</span>
                ${busy ? statPill('busy', 'Queued', { bare: true }) : statPill('uninstalled', 'Available', { bare: true })}
              </div>
              <h3 class="hm-catalog-name"><a href="#/library/${c.title}">${escapeHtml(c.name)}</a></h3>
              ${c.summary ? `<p class="hm-title-desc">${escapeHtml(c.summary)}</p>` : ''}
              <div class="hm-catalog-foot">
                <span class="hm-signal-muted">${joinSep([c.sections ? fmtSections(c.sections) : '', c.size_mb ? fmtMB(c.size_mb) : ''])}</span>
                <div class="hm-catalog-acts">
                  <a class="hm-inline-link" href="#/library/${c.title}">Parts</a>
                  <button type="button" class="btn btn-sm" data-hm-act="download-title" data-title="${c.title}"${busy ? ' disabled' : ''}>${icon('download')} ${busy ? 'Queued' : 'Install'}</button>
                </div>
              </div>
            </article>`;
        }).join('')}
      </div>
    </section>`;
}

function renderCfrTabHtml(
  titles: TitleSnapshotRow[],
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  totalSections: number,
  totalRead: number,
  status: NewsStatusSnapshot | null,
  usage: UsageStore,
  attention: UpdateAttentionItem[],
): string {
  const cfrAttention = attention.filter(a => a.tier === 'cfr');
  const staleSet = new Set(((state.navLibData && state.navLibData.titles) || []).filter(isStale).map(t => t.title));
  syncCorporaState();
  const deskId = state.activeDesk || 'all';
  const allFrameworks = allSystemFrameworks(titles, titles, status);
  const cfrFrameworks = allFrameworks.filter(c => c.tier === 'federal-reg');
  const filtered = deskId === 'all'
    ? titles
    : titles.filter(t => {
      const corp = cfrFrameworks.find(c => c.title_num === t.title);
      return mapRawDeskToId(corp?.desk, t.title) === deskId;
    });
  const shown = filtered.length ? filtered : titles;
  const ribbonHtml = deskFilterRibbonHtml(deskId, cfrFrameworks);

  const installedSet = new Set(titles.map(t => t.title));
  const partsExplored = Object.keys(usage.p).filter(k => installedSet.has(parseInt(k.slice(0, k.indexOf('|')), 10))).length;
  const totalPinnedCfr = projects.reduce((sum, p) => sum + (p.sections || []).length, 0);
  const cfrWorkspaces = projects.filter(p => (p.sections || []).length > 0).length;
  const libTitles = (state.navLibData?.titles || []) as LibraryTitleRow[];
  const week = libTitles.length ? amendedWeek({ titles: libTitles }) : { newest: '', cut: '', recent: 0 };
  const latestEdition = week.newest || titles.reduce((m, t) => (t.edition && t.edition > m ? t.edition : m), '') || state.metaInfo.edition || '';

  // Curated High-Signal Parts across installed titles
  const keyParts: Array<{ ti: number; part: string; kicker: string; title: string; desc: string }> = [];
  for (const t of titles) {
    const curated = HOME_CONTENT[t.title]?.cards || [];
    for (const c of curated.slice(0, 2)) {
      keyParts.push({
        ti: t.title,
        part: c.part,
        kicker: `${t.title} CFR · ${c.kicker}`,
        title: c.title,
        desc: c.desc,
      });
      if (keyParts.length >= 6) break;
    }
    if (keyParts.length >= 6) break;
  }

  const last = recent[0];
  const activeStudyHtml = last ? `
    <div class="hm-cfr-study">
      <div class="hm-card-top">
        <span class="hm-kicker">Active CFR Provision</span>
        <span class="hm-time">${escapeHtml(timeAgo(last.t || 0))}</span>
      </div>
      <div class="hm-resume-loc">
        <span class="hm-loc-tier" data-ref-tier="cfr">${last.ti} CFR</span>
        ${last.p ? `${SEP}<a href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
        ${last.ul ? `${SEP}<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ''}
      </div>
      <a class="hm-resume-title" href="${sectionLinkHref(last)}">${escapeHtml(last.l)} ${escapeHtml(last.h || '')}</a>
      <div class="hm-resume-acts">
        <a class="btn btn-sm btn-accent" href="${sectionLinkHref(last)}">Resume section ${icon('chevronRight')}</a>
        ${last.p ? `<a class="btn btn-sm" href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)} Atlas</a>` : ''}
        ${last.p ? `<a class="hm-inline-link" href="${titleHref(last.ti, 'part/' + encodeURIComponent(last.p) + '/full')}">Full Part text ${icon('chevronRight')}</a>` : ''}
        <button type="button" class="hm-inline-link" data-hm-act="resume-split" data-title="${last.ti}" data-section="${escapeHtml(last.id)}"${last.u ? ` data-unit="${escapeHtml(last.u)}"` : ''}>${icon('stack')} Side-by-side</button>
      </div>
      ${recent.length > 1 ? `
        <div class="hm-trail">
          <div class="hm-trail-head"><span class="hm-kicker">Recent CFR trail</span></div>
          <div class="hm-trail-list">
            ${recent.slice(1, 5).map(e => `
              <a class="hm-trail-row" href="${sectionLinkHref(e)}">
                <span class="hm-tag" data-ref-tier="cfr">${e.ti} CFR</span>
                <span class="hm-row-num">${escapeHtml(String(e.l || e.id).replace(/^§\s*/, ''))}</span>
                <span class="hm-row-text">${escapeHtml(e.h || '')}</span>
                <span class="hm-row-val">${escapeHtml(timeAgo(e.t || 0))}</span>
              </a>`).join('')}
          </div>
        </div>` : ''}
    </div>` : `
    <div class="hm-cfr-study">
      <div class="hm-card-top"><span class="hm-kicker">CFR Reading Modes</span></div>
      <div class="hm-resume-title is-static">Clause-by-clause, full section, or full part</div>
      <p class="hm-muted">Open any installed title or high-frequency part to read unitized clauses with inline citation peeks, IBR consensus standards, and side-by-side comparison tabs.</p>
      ${titles[0] ? `<div class="hm-resume-acts"><a class="btn btn-sm btn-accent" href="${titleHref(titles[0].title)}">Open ${titles[0].title} CFR Start ${icon('chevronRight')}</a></div>` : ''}
    </div>`;

  const keyPartsBenchHtml = keyParts.length ? `
    <div class="hm-cfr-parts-bench">
      <div class="hm-panel-head">
        <h3 class="hm-panel-title">High-Frequency Regulatory Parts</h3>
        <span class="hm-count">${plural(keyParts.length, 'core part')}</span>
      </div>
      <div class="hm-cfr-parts-list">
        ${keyParts.map(kp => `
          <div class="hm-cfr-part-row">
            <div class="hm-cfr-part-main">
              <span class="hm-cfr-part-kicker" data-ref-tier="cfr">${escapeHtml(kp.kicker)}</span>
              <a class="hm-cfr-part-name" href="${titleHref(kp.ti, 'part/' + encodeURIComponent(kp.part))}">${escapeHtml(kp.title)}</a>
              <span class="hm-cfr-part-desc">${escapeHtml(kp.desc)}</span>
            </div>
            <div class="hm-cfr-part-acts">
              <a class="hm-part-chip" href="${titleHref(kp.ti, 'part/' + encodeURIComponent(kp.part))}"><span class="hm-part-num">Atlas</span></a>
              <a class="hm-part-chip" href="${titleHref(kp.ti, 'part/' + encodeURIComponent(kp.part) + '/full')}"><span class="hm-part-num">Full</span></a>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const cards = shown.map(t => cfrCardHtml(t, staleSet, recent, projects, usage)).join('');

  return `
    ${activeTransfersHtml()}
    ${updatesBannerHtml(cfrAttention, titles)}
    <div class="hm-tab-lead" data-ref-tier="cfr">
      <div class="hm-tab-lead-copy">
        <div class="hm-tab-lead-kicker"><span class="ref-badge" data-ref-tier="cfr">CFR · CODIFIED REGULATIONS</span><span>Local SQLite FTS5 &amp; Citation Graph</span></div>
        <h2 class="hm-tab-lead-title">Code of Federal Regulations</h2>
        <p class="hm-tab-lead-sub">Locally indexed eCFR editions with clause-by-clause unit reading, Part TOC Atlases, deterministic cross-reference graphs, and incorporation-by-reference (IBR) standards.</p>
      </div>
      <div class="hm-tab-lead-acts">
        <button type="button" class="btn btn-sm" data-hm-act="check-updates">${icon('refresh')} Check eCFR</button>
        <a class="btn btn-sm btn-accent" href="#/library">${icon('download')} Manage Library ${icon('chevronRight')}</a>
      </div>
    </div>
    <div class="hm-kpi-strip" data-ref-tier="cfr" aria-label="CFR archive telemetry">
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Installed Editions</span>
        <span class="hm-kpi-val">${plural(titles.length, 'CFR title')}</span>
        <span class="hm-kpi-sub">${fmt(totalSections)} offline sections indexed</span>
      </div>
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">eCFR Currency</span>
        <span class="hm-kpi-val">${cfrAttention.length > 0 ? `${plural(cfrAttention.length, 'update')} ready` : (latestEdition ? `Edition ${escapeHtml(shortDate(latestEdition))}` : 'Verified current')}</span>
        <span class="hm-kpi-sub">${week.recent > 0 ? `${plural(week.recent, 'title')} amended this week` : 'Checked against eCFR Versioner'}</span>
      </div>
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Study Coverage</span>
        <span class="hm-kpi-val">${fmt(totalRead)} sections</span>
        <span class="hm-kpi-sub">${fmt(partsExplored)} regulatory parts explored</span>
      </div>
      <div class="hm-kpi-cell">
        <span class="hm-kpi-lbl">Workspace Citations</span>
        <span class="hm-kpi-val">${fmt(totalPinnedCfr)} pinned</span>
        <span class="hm-kpi-sub">${cfrWorkspaces ? `Across ${plural(cfrWorkspaces, 'active workspace')}` : 'Pin any section with ⌘D'}</span>
      </div>
    </div>
    <div class="hm-cfr-desk">
      ${activeStudyHtml}
      ${keyPartsBenchHtml}
    </div>
    <section class="hm-titles" id="hm-titles" data-snapshot-loaded="1" aria-label="Installed CFR titles">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Installed CFR Titles</h2>
          <span class="hm-sec-meta">${joinSep([plural(shown.length, 'title'), totalSections ? `${fmt(totalSections)} offline sections` : '', totalRead ? `${fmt(totalRead)} read` : ''])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add or update CFR titles ${icon('chevronRight')}</a>
      </div>
      ${ribbonHtml ? `<div class="hm-filters">${ribbonHtml}</div>` : ''}
      ${cards ? `<div class="hm-title-grid">${cards}</div>` : '<p class="hm-muted">No CFR titles installed yet. <a href="#/library">Browse the Library</a> to download one.</p>'}
    </section>
    ${cfrCatalogDiscoveryHtml(titles)}`;
}

function frLeadSpotlightHtml(
  filteredArticles: HomeNewsItem[],
  allFrArticles: HomeNewsItem[],
): string {
  if (!allFrArticles.length) return '';
  const lead = filteredArticles.find(a => a.category === 'rules')
    || filteredArticles[0]
    || allFrArticles[0];
  if (!lead) return '';

  const leadHref = articlePrimaryHref(lead);
  const docNum = frDocumentNumber(lead);
  const firstPart = lead.cfr_parts?.[0];
  const dateBadge = articleDateNoteHtml(lead);
  const docket = lead.docket_ids?.[0] || '';

  const takeawaysHtml = lead.takeaways && lead.takeaways.length ? `
    <dl class="hm-fr-takeaways">
      ${lead.takeaways.slice(0, 3).map(t => `
        <div class="hm-fr-takeaway-row">
          <dt>${escapeHtml(t.label)}</dt>
          <dd>${linkifyNewsText(t.text)}</dd>
        </div>`).join('')}
    </dl>` : (lead.action || lead.snippet) ? `
    <p class="hm-fr-lead-dek">${linkifyNewsText(lead.action || lead.snippet || '')}</p>` : '';

  // Deadlines & effective dates watchlist across all FR articles
  const datedFilings = allFrArticles
    .filter(a => a.effective_on || a.comments_close_on || a.scheduled_on)
    .slice(0, 4);

  // Affected CFR parts across all FR articles
  const partMap = new Map<string, { title: number; part: string | number; count: number }>();
  for (const a of allFrArticles) {
    for (const p of a.cfr_parts || []) {
      const k = `${p.title}|${p.part}`;
      const cur = partMap.get(k);
      if (cur) cur.count += 1;
      else partMap.set(k, { title: p.title, part: p.part, count: 1 });
    }
  }
  const sectionSet = [...new Set(allFrArticles.flatMap(a => a.sections || []))].slice(0, 5);
  const touchedParts = [...partMap.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  return `
    <div class="hm-fr-desk" aria-label="Lead rulemaking dispatch and deadlines watchlist">
      <article class="hm-fr-lead" data-ref-tier="fr">
        <div class="hm-fr-lead-top">
          <div class="hm-fr-lead-kicker-wrap">
            <span class="ref-badge" data-ref-tier="fr">${escapeHtml(frCategoryLabel(lead.category).toUpperCase())}</span>
            ${lead.citation ? `<span class="hm-fr-cite">${escapeHtml(lead.citation)}</span>` : ''}
            ${docket ? `<span class="hm-fr-docket">${escapeHtml(docket)}</span>` : ''}
          </div>
          <time class="hm-news-date">${escapeHtml(shortDate(lead.published_at))}</time>
        </div>
        <h3 class="hm-fr-lead-title"><a href="${leadHref}">${escapeHtml(lead.title)}</a></h3>
        ${dateBadge ? `<div class="hm-fr-lead-dates">${dateBadge}${lead.agency ? `<span class="hm-fr-agency">${escapeHtml(lead.agency)}</span>` : ''}</div>` : ''}
        ${takeawaysHtml}
        ${pulseChipsHtml(lead)}
        <div class="hm-fr-lead-acts">
          <a class="btn btn-sm btn-accent" href="${leadHref}">${docNum ? 'Read in-app preamble' : 'Open filing'} ${icon('chevronRight')}</a>
          ${firstPart ? `<a class="btn btn-sm" href="${newsPartHref(firstPart.title, firstPart.part)}">Open ${firstPart.title} CFR Part ${escapeHtml(String(firstPart.part))}</a>` : ''}
          <a class="hm-inline-link" href="#/news?cat=${encodeURIComponent(lead.category)}">All ${escapeHtml(frCategoryLabel(lead.category).toLowerCase())}s ${icon('chevronRight')}</a>
        </div>
      </article>
      <aside class="hm-fr-rail" aria-label="Effective dates, comment deadlines, and affected CFR provisions">
        <div class="hm-fr-rail-block">
          <div class="hm-trail-head">
            <span class="hm-kicker">Effective Dates &amp; Comment Deadlines</span>
            <a class="hm-inline-link" href="#/news">Calendar ${icon('chevronRight')}</a>
          </div>
          ${datedFilings.length ? `
            <div class="hm-fr-date-list">
              ${datedFilings.map(a => {
                const isDeadline = Boolean(a.comments_close_on);
                const dateVal = a.comments_close_on || a.effective_on || a.scheduled_on || a.published_at;
                const kindLbl = a.comments_close_on ? 'Comments close' : a.effective_on ? 'Effective' : 'Publishes';
                return `
                  <a class="hm-fr-date-row" href="${articlePrimaryHref(a)}">
                    <span class="hm-fr-date-pill${isDeadline ? ' is-deadline' : ' is-effective'}">${escapeHtml(kindLbl)} ${escapeHtml(shortDate(dateVal))}</span>
                    <span class="hm-fr-date-title">${escapeHtml(a.title)}</span>
                  </a>`;
              }).join('')}
            </div>` : '<p class="hm-muted">Effective dates and comment deadlines from synced rules appear here.</p>'}
        </div>
        <div class="hm-fr-rail-block">
          <div class="hm-trail-head">
            <span class="hm-kicker">Affected CFR Parts &amp; Sections</span>
          </div>
          ${(touchedParts.length || sectionSet.length) ? `
            <div class="hm-news-chips">
              ${touchedParts.map(p => {
                const ok = titleInstalled(p.title);
                return `<a class="citation-chip${ok ? '' : ' is-dim'}" data-ref-tier="${ok ? 'cfr' : 'uninstalled'}" href="${newsPartHref(p.title, p.part)}">${p.title} CFR Part ${escapeHtml(String(p.part))}${p.count > 1 ? ` · ${p.count}` : ''}</a>`;
              }).join('')}
              ${sectionSet.map(s => {
                const ok = titleInstalled(29);
                return `<a class="citation-chip${ok ? '' : ' is-dim'}" data-ref-tier="${ok ? 'cfr' : 'uninstalled'}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`;
              }).join('')}
            </div>` : '<p class="hm-muted">CFR citations extracted from Federal Register dockets appear here.</p>'}
        </div>
      </aside>
    </div>`;
}

function renderFrTabHtml(
  allFrameworks: CorpusSummary[],
  projects: WorkspaceRecord[],
  status: NewsStatusSnapshot | null,
  articles: HomeNewsItem[],
  attention: UpdateAttentionItem[],
  hasCachedNews: boolean,
): string {
  const frAttention = attention.filter(a => a.tier === 'fr');
  const frArticles = (articles || []).filter(a => a && a.category !== 'enforcement');
  const activeCat: HomeFrCat = state.homeFrCat || 'all';
  const filteredArticles = activeCat === 'all'
    ? frArticles
    : frArticles.filter(a => a.category === activeCat);
  const shownArticles = filteredArticles.length ? filteredArticles : frArticles;

  const frSyncing = Boolean(status?.syncing);
  const lastOk = status?.sources?.federal_register?.last_ok_at;
  const totalCached = Number(status?.articles || frArticles.length || 0);
  const frReason = frAttentionReason(status);

  const pill = frSyncing
    ? statPill('busy', 'Syncing…')
    : frReason
      ? statPill('stale', 'Sync due')
      : totalCached > 0
        ? statPill('synced', lastOk ? `Synced ${timeAgo(Date.parse(lastOk))}` : 'Synced')
        : statPill('partial', 'Ready');

  const cats: Array<{ cat: HomeFrCat; label: string; desc: string; count: number }> = [
    { cat: 'all', label: 'All Filings', desc: 'Complete daily Federal Register stream', count: frArticles.length },
    { cat: 'rules', label: 'Final Rules', desc: 'Codified CFR amendments & effective dates', count: frArticles.filter(a => a.category === 'rules').length },
    { cat: 'rulemaking', label: 'Proposed Rules', desc: 'Open dockets & comment deadlines', count: frArticles.filter(a => a.category === 'rulemaking').length },
    { cat: 'notices', label: 'Notices', desc: 'Agency guidance, meetings & dockets', count: frArticles.filter(a => a.category === 'notices').length },
    { cat: 'public_inspection', label: 'Public Inspection', desc: 'Pre-publication filings scheduled next', count: frArticles.filter(a => a.category === 'public_inspection').length },
  ];

  const activeCatMeta = cats.find(c => c.cat === activeCat) || cats[0];
  const feedHeading = activeCat === 'all'
    ? 'Recent Federal Register Dispatches'
    : `${activeCatMeta.label} Dispatches`;

  const feedHtml = hasCachedNews || frArticles.length
    ? newsSectionHtml({ articles: shownArticles }, status, { limit: 6, heading: feedHeading })
    : newsSkeletonHtml(feedHeading);

  void allFrameworks;
  void projects;

  return `
    ${frAttention.length ? updatesBannerHtml(frAttention, []) : ''}
    <div class="hm-tab-lead" data-ref-tier="fr">
      <div class="hm-tab-lead-copy">
        <div class="hm-tab-lead-kicker"><span class="ref-badge" data-ref-tier="fr">FR · DAILY RULEMAKING</span><span>Federal Register API v1 &amp; In-App Preamble Reader</span></div>
        <h2 class="hm-tab-lead-title">Federal Register</h2>
        <p class="hm-tab-lead-sub">Daily Final Rules, Proposed Rules, Notices, and Public Inspection filings across configured federal agencies and installed CFR titles, with sanitized in-app preamble reading.</p>
      </div>
      <div class="hm-tab-lead-acts">
        <span id="hm-news-pill">${pill}</span>
        ${status?.sync_enabled !== false
          ? `<button type="button" class="btn btn-sm btn-accent" data-hm-act="sync-fr"${frSyncing ? ' disabled' : ''}>${icon('refresh')} ${frSyncing ? 'Syncing…' : 'Sync now'}</button>`
          : ''}
        <a class="btn btn-sm" href="#/news">Open Newsroom ${icon('chevronRight')}</a>
      </div>
    </div>
    <div class="hm-fr-cats" role="group" aria-label="Filter Federal Register categories">
      ${cats.map(c => {
        const isOn = activeCat === c.cat;
        return `
          <button type="button" class="hm-fr-cat${isOn ? ' is-active' : ''}" data-hm-fr-cat="${c.cat}" aria-pressed="${isOn}">
            <span class="hm-fr-cat-top">
              <span class="hm-fr-cat-label">${escapeHtml(c.label)}</span>
              <span class="hm-fr-cat-count">${fmt(c.count)}</span>
            </span>
            <span class="hm-fr-cat-meta">${escapeHtml(c.desc)}</span>
          </button>`;
      }).join('')}
    </div>
    ${frLeadSpotlightHtml(shownArticles, frArticles)}
    <section class="hm-news" id="hm-news" data-news-loaded="1" aria-label="Federal Register filings">
      ${feedHtml}
    </section>`;
}

function renderHomeTabBody(
  titles: TitleSnapshotRow[],
  allFrameworks: CorpusSummary[],
  recent: RecentSectionItem[],
  projects: WorkspaceRecord[],
  totalSections: number,
  totalRead: number,
  status: NewsStatusSnapshot | null,
  usage: UsageStore,
  attention: UpdateAttentionItem[],
  articles: HomeNewsItem[],
  hasCachedNews: boolean,
): string {
  const tab = state.homeTab || 'overview';
  if (tab === 'usc') return renderUscTabHtml(allFrameworks, titles, recent, projects, status, usage, articles);
  if (tab === 'cfr') return renderCfrTabHtml(titles, recent, projects, totalSections, totalRead, status, usage, attention);
  if (tab === 'fr') return renderFrTabHtml(allFrameworks, projects, status, articles, attention, hasCachedNews);

  return `
    ${activeTransfersHtml()}
    ${updatesBannerHtml(attention, titles)}
    ${systemsStripHtml(allFrameworks, titles, status, attention, articles)}
    <div class="hm-top">
      ${resumeCardHtml(recent, titles, usage, projects, totalRead)}
      ${workspacesCardHtml(projects)}
    </div>
    ${titlesBandHtml(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage)}
    <section class="hm-news" id="hm-news" aria-label="Federal Register Pulse">
      ${hasCachedNews ? newsSectionHtml({ articles }, status) : newsSkeletonHtml()}
    </section>`;
}

function patchHomeDynamicBands(
  titles: TitleSnapshotRow[],
  status: NewsStatusSnapshot | null,
  articles: HomeNewsItem[] = cachedNewsArticles(),
  replaceBody = false,
): void {
  const usage = loadUsage();
  const installed = new Set(titles.map(t => t.title));
  const recent = recentSectionsFor(usage, installed);
  const projects = loadProjects();
  const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
  const totalRead = titles.reduce((a, t) => a + readCountForTitle(t.title, usage), 0);
  const allFrameworks = allSystemFrameworks(titles, titles, status);
  const attention = collectAttentionItems(titles, status);

  const tabEl = document.getElementById('hm-tabs');
  if (tabEl) {
    tabEl.outerHTML = homeTabsHtml(
      allFrameworks, titles, status, attention, totalSections, totalRead, projects.length,
    );
  }

  const activeTab = state.homeTab || 'overview';
  const tabBody = document.getElementById('hm-tab-body');
  if (tabBody) {
    tabBody.setAttribute('aria-labelledby', `hm-tab-${activeTab}`);
  }

  if (replaceBody || activeTab !== 'overview' || !document.getElementById('hm-systems')) {
    if (tabBody) {
      const prevSnapLoaded = document.getElementById('hm-titles')?.dataset.snapshotLoaded;
      const prevNewsLoaded = document.getElementById('hm-news')?.dataset.newsLoaded;
      tabBody.innerHTML = renderHomeTabBody(
        titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage, attention, articles, true,
      );
      const nextTitles = document.getElementById('hm-titles');
      if (nextTitles && prevSnapLoaded) nextTitles.dataset.snapshotLoaded = prevSnapLoaded;
      const nextNews = document.getElementById('hm-news');
      if (nextNews && prevNewsLoaded) nextNews.dataset.newsLoaded = prevNewsLoaded;
    }
    return;
  }

  const sysEl = document.getElementById('hm-systems');
  if (sysEl) sysEl.outerHTML = systemsStripHtml(allFrameworks, titles, status, attention, articles);

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
    getJSON<{ articles?: HomeNewsItem[]; total?: number }>('/api/news?limit=12'),
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
    const freshArticles = Array.isArray(data?.articles) ? data!.articles! : [];
    if (freshArticles.length) {
      lsSetJSON(HOME_NEWS_CACHE, { t: Date.now(), data: { articles: freshArticles.slice(0, 30), total: data.total, offset: 0 } });
    }
    const box = document.getElementById('hm-news');
    if (box && (state.homeTab || 'overview') === 'overview') {
      box.innerHTML = newsSectionHtml(data, enrichedStatus);
    }
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, enrichedStatus, freshArticles);
    if (enrichedStatus?.syncing) watchHomeNewsSync(seq);
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
  const activeTab = state.homeTab || 'overview';

  const sub = joinSep([
    'Federal codes, statutes & daily rulemaking',
    totalRead ? `${fmt(totalRead)} ${totalRead === 1 ? 'section' : 'sections'} studied` : '',
    projects.length ? escapeHtml(plural(projects.length, 'active workspace')) : '',
  ]);

  const scrollTop = dom.main.scrollTop;
  const edText = state.metaInfo.edition ? `Edition ${escapeHtml(shortDate(state.metaInfo.edition))}` : 'Local Archive';
  dom.view.innerHTML = `
    <div class="hm">
      <header class="hm-masthead">
        <div class="hm-folio">
          <div class="hm-folio-left">
            <span class="hm-folio-brand">FRAMEWORK</span>
            ${SEP}
            <span>${edText}</span>
          </div>
          <div class="hm-folio-right">
            <span>${escapeHtml(plural(allFrameworks.length, 'federal framework'))}</span>
            ${SEP}
            <span>U.S.C. · CFR · FR</span>
          </div>
        </div>
        <div class="hm-head">
          <div class="hm-title-copy">
            <h1 class="doc-title hm-display">Home</h1>
            <p class="hm-sub">${sub}</p>
          </div>
          <div class="hm-head-acts">
            <button type="button" class="btn btn-sm" data-hm-act="new-workspace">${icon('plus')} New workspace</button>
            <a class="btn btn-sm" href="#/library">${icon('download')} Library</a>
          </div>
        </div>
        <div class="hm-double-rule" aria-hidden="true"></div>
        ${homeTabsHtml(allFrameworks, titles, status, attention, totalSections, totalRead, projects.length)}
      </header>
      <div id="hm-tab-body" role="tabpanel" aria-labelledby="hm-tab-${activeTab}">
        ${renderHomeTabBody(
          titles,
          allFrameworks,
          recent,
          projects,
          totalSections,
          totalRead,
          status,
          usage,
          attention,
          cachedNews?.data?.articles || [],
          Boolean(cachedNews && cachedNews.data),
        )}
      </div>
    </div>`;

  if (enter) enterView();
  else dom.main.scrollTop = scrollTop;
  hydrateHome(state.routeSeq);
}

function watchHomeNewsSync(seq: number): void {
  const token = ++state.homeSyncToken;
  const started = Date.now();
  const tick = async () => {
    if (seq !== state.routeSeq || token !== state.homeSyncToken || Date.now() - started > 60000) return;
    let status: NewsStatusSnapshot;
    try { status = await getJSON<NewsStatusSnapshot>('/api/news/status'); } catch { return; }
    if (seq !== state.routeSeq || token !== state.homeSyncToken) return;
    if (status.syncing) {
      setTimeout(tick, 2000);
      return;
    }
    let data: { articles?: HomeNewsItem[]; total?: number } = { articles: [] };
    try { data = await getJSON<{ articles?: HomeNewsItem[]; total?: number }>('/api/news?limit=12'); } catch { /* ignore */ }
    if (seq !== state.routeSeq || token !== state.homeSyncToken) return;
    const totalArticles = Number(data?.total ?? data?.articles?.length ?? 0);
    const enrichedStatus: NewsStatusSnapshot = { ...status, articles: status.articles || totalArticles };
    state.navNewsStatus = enrichedStatus;
    lsSetJSON(HOME_STATUS_CACHE, { t: Date.now(), data: enrichedStatus });
    const freshArticles = Array.isArray(data?.articles) ? data.articles : [];
    if (freshArticles.length) {
      lsSetJSON(HOME_NEWS_CACHE, { t: Date.now(), data: { articles: freshArticles.slice(0, 30), total: data.total, offset: 0 } });
    }
    updateRailBadge();
    const box = document.getElementById('hm-news');
    if (box && (state.homeTab || 'overview') === 'overview') {
      box.innerHTML = newsSectionHtml(data, enrichedStatus);
    }
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, enrichedStatus, freshArticles);
    const errReason = Object.values(enrichedStatus.sources || {}).find(s => s && s.enabled && s.last_error)?.last_error;
    if (errReason) showToast(errReason, 5000);
    else showToast('Federal Register updated');
  };
  setTimeout(tick, 2000);
}

async function syncFrOnHome(force: boolean): Promise<boolean> {
  const seq = state.routeSeq;
  const prev = cachedNewsStatus();
  const optimistic: NewsStatusSnapshot = {
    sync_enabled: prev?.sync_enabled ?? true,
    syncing: true,
    dol_configured: prev?.dol_configured ?? false,
    articles: prev?.articles,
    sources: prev?.sources || {},
  };
  state.navNewsStatus = optimistic;
  patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), optimistic);
  const pillSlot = document.getElementById('hm-news-pill');
  if (pillSlot) pillSlot.innerHTML = newsStatusPillHtml(optimistic);

  try {
    const res = await getJSON<{ queued?: unknown[] }>('/api/news/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (res && Array.isArray(res.queued) && res.queued.length === 0) {
      await hydrateHome(seq);
      return false;
    }
    watchHomeNewsSync(seq);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    if (/already running/i.test(msg)) {
      watchHomeNewsSync(seq);
      return true;
    }
    state.navNewsStatus = prev;
    patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), prev);
    throw err;
  }
}

export function refreshHomeIfActive(): void {
  if (routeTarget() === 'overview' && dom.view.querySelector('.hm')) {
    renderHomeScreen({ enter: false });
  }
}

function activateHomeTab(nextTab: HomeTab, focusTab = false): void {
  if (!HOME_TAB_ORDER.includes(nextTab)) return;
  if (nextTab !== state.homeTab) {
    state.homeTab = nextTab;
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, cachedNewsStatus(), cachedNewsArticles(), true);
  }
  if (focusTab) {
    document.getElementById(`hm-tab-${nextTab}`)?.focus();
  }
}

onView('keydown', (ev) => {
  const e = ev as KeyboardEvent;
  const tabBtn = (e.target as Element | null)?.closest<HTMLElement>('#hm-tabs [data-hm-tab]');
  if (!tabBtn) return;
  const cur = (tabBtn.dataset.hmTab || 'overview') as HomeTab;
  const idx = HOME_TAB_ORDER.indexOf(cur);
  if (idx < 0) return;

  let nextIdx = -1;
  if (e.key === 'ArrowRight') nextIdx = (idx + 1) % HOME_TAB_ORDER.length;
  else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + HOME_TAB_ORDER.length) % HOME_TAB_ORDER.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = HOME_TAB_ORDER.length - 1;

  if (nextIdx >= 0) {
    e.preventDefault();
    activateHomeTab(HOME_TAB_ORDER[nextIdx], true);
  }
});

onView('click', async (e) => {
  if (!dom.view.querySelector('.hm')) return;
  const t = e.target as Element | null;

  const tabBtn = t?.closest<HTMLElement>('[data-hm-tab]');
  if (tabBtn) {
    const nextTab = (tabBtn.dataset.hmTab || 'overview') as HomeTab;
    activateHomeTab(nextTab, false);
    return;
  }

  const frCatBtn = t?.closest<HTMLElement>('[data-hm-fr-cat]');
  if (frCatBtn) {
    const nextCat = (frCatBtn.dataset.hmFrCat || 'all') as HomeFrCat;
    state.homeFrCat = state.homeFrCat === nextCat && nextCat !== 'all' ? 'all' : nextCat;
    const titles = state.homeSnapshot?.titles || installedFallbackList();
    patchHomeDynamicBands(titles, cachedNewsStatus(), cachedNewsArticles(), true);
    return;
  }

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
  } else if (act === 'resume-split') {
    const titleNum = Number(actEl.dataset.title) || state.currentTitle;
    const secId = actEl.dataset.section || '';
    const unit = actEl.dataset.unit || null;
    if (secId) {
      emit('split:open', { title: titleNum, sectionId: secId, unit, pushHistory: true });
    }
  } else if (act === 'restore-tabgroup') {
    const projId = actEl.dataset.projId;
    const groupId = actEl.dataset.groupId;
    const proj = loadProjects().find(p => p.id === projId);
    const grp = proj?.tab_groups?.find(g => g.id === groupId);
    if (grp) restoreTabGroup(grp);
  } else if (act === 'open-contents') {
    const titleNum = Number(actEl.dataset.title);
    if (titleNum && titleNum !== state.currentTitle) await switchTitle(titleNum);
    window.location.hash = `#/title/${titleNum || state.currentTitle}/`;
  } else if (act === 'download-title') {
    const titleNum = Number(actEl.dataset.title);
    if (!titleNum) return;
    (actEl as HTMLButtonElement).disabled = true;
    try {
      const job = await getJSON<TransferJob>('/api/library/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleNum, kind: 'section' }),
      });
      const snap = await getJSON<import('../state').JobsSnapshot>('/api/library/jobs');
      setJobs(snap);
      pollJobsIfActive();
      showToast(job?.label ? `Queued download for ${job.label}` : `Queued download for Title ${titleNum}`);
      refreshHomeIfActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed', 5000);
      (actEl as HTMLButtonElement).disabled = false;
    }
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
  } else if (act === 'update-all' || act === 'update-all-attention') {
    (actEl as HTMLButtonElement).disabled = true;
    try {
      const titles = state.homeSnapshot?.titles || installedFallbackList();
      const attention = collectAttentionItems(titles, cachedNewsStatus());
      const hasCfr = attention.some(a => a.tier === 'cfr');
      const hasFr = attention.some(a => a.tier === 'fr');
      if (hasCfr || act === 'update-all') {
        await queueBatch('/api/library/update-all', null, 'Every installed title is already current');
      }
      if (hasFr && act === 'update-all-attention') {
        await syncFrOnHome(true);
      }
      refreshHomeIfActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 5000);
      (actEl as HTMLButtonElement).disabled = false;
    }
  } else if (act === 'check-updates') {
    const btn = actEl as HTMLButtonElement;
    const prevHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const [, newsStatus] = await Promise.all([
        ensureNavLibrary(true),
        getJSON<NewsStatusSnapshot>('/api/news/status').catch(() => cachedNewsStatus()),
      ]);
      if (newsStatus) {
        state.navNewsStatus = newsStatus;
        lsSetJSON(HOME_STATUS_CACHE, { t: Date.now(), data: newsStatus });
      }
      updateRailBadge();
      const titles = state.homeSnapshot?.titles || installedFallbackList();
      patchHomeDynamicBands(titles, newsStatus || cachedNewsStatus());
      const attention = collectAttentionItems(titles, newsStatus || cachedNewsStatus());
      if (newsStatus?.sync_enabled && !newsStatus.syncing && frAttentionReason(newsStatus)) {
        await syncFrOnHome(false).catch(() => false);
      }
      showToast(attention.length ? `${plural(attention.length, 'update')} available` : 'All frameworks are up to date');
    } catch {
      showToast('Couldn’t reach update services right now', 4000);
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.innerHTML = prevHtml;
      }
    }
  } else if (act === 'sync-fr') {
    (actEl as HTMLButtonElement).disabled = true;
    try {
      const started = await syncFrOnHome(true);
      showToast(started ? 'Syncing Federal Register…' : 'Federal Register is already up to date');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed', 4000);
      if ((actEl as HTMLButtonElement).isConnected) (actEl as HTMLButtonElement).disabled = false;
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
