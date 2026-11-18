import { NEWS_CITE_RE } from '../citations';
import { state } from '../state';
import type { NewsArticle } from '../state';
import { getJSON } from '../api/client';
import { emit, on } from '../core/events';
import { onView } from '../core/view_dispatch';
import {
  extLink, fmtMoney, inspectionActivityNr, linkifyNewsText, moneyFmt, NEWS_SOURCE_LABELS,
  newsBylineHtml, newsKicker, newsPartHref, newsSectionHref, newsStatusPillHtml,
  NewsStatusPayload, stateName, titleInstalled, US_STATE_NAMES,
} from '../core/news_format';
import { enrichInspection, loadInspection, renderInspectionCase } from './news_case';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection, plural } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsGetJSON, lsSetJSON, safeHttpUrl, showToast, skeletonHtml } from '../dom';
import { routeTarget } from '../nav';
import { timeUntil } from '../panels/settings_panel';
import { dom } from '../state_init';
import { fmt, timeAgo, titleHref } from '../usage';
import { SEP, emptyStateHtml, fmtDate, joinSep, metricCardHtml, statPill } from '../components/ui';

export {
  enrichInspection, extLink, fmtMoney, inspectionActivityNr, linkifyNewsText, loadInspection,
  lsGetJSON, lsSetJSON, moneyFmt, NEWS_SOURCE_LABELS, newsBylineHtml, newsKicker, newsPartHref,
  newsSectionHref, newsStatusPillHtml, renderInspectionCase, safeHttpUrl, stateName,
  titleInstalled, US_STATE_NAMES,
};

// --- News (#/news): agency rulemaking and enforcement from sanctioned APIs ---
//
// The page is a newsroom front: an optional breaking banner, a lead hero card, category
// tabs with counts, a filter box (FTS inside News only), enforcement facets, and cards
// whose three bullets are built server-side from the record's own fields. A
// stale-while-revalidate cache paints the default tab instantly; opening the page on
// stale data asks the server for a sync with POST /api/news/refresh {"force": false}
// (GETs never sync). Search and routing all live in the #/news hash query.

export interface NewsScopeMeta {
  title: number;
  agency: string;
  agencySourceLabel: string;
  exampleSection: string;
}

export const NEWS_SCOPES: Record<number, NewsScopeMeta> = {
  29: {
    title: 29,
    agency: 'OSHA',
    agencySourceLabel: 'OSHA.gov',
    exampleSection: '1910.1030',
  },
};

export function newsScope(titleNum?: number | null): NewsScopeMeta {
  const n = titleNum && NEWS_SCOPES[titleNum] ? titleNum : 29;
  return NEWS_SCOPES[n];
}

export function articleNewsTitle(a: NewsArticle): number {
  if (typeof a.title_num === 'number' && a.title_num > 0) return a.title_num;
  const firstPart = a.cfr_parts?.[0]?.title;
  return typeof firstPart === 'number' && firstPart > 0 ? firstPart : 29;
}

export const NEWS_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'rules', label: 'Final Rules' },
  { key: 'rulemaking', label: 'Proposed Rules' },
  { key: 'enforcement', label: 'Enforcement & Penalties' },
  { key: 'public_inspection', label: 'Public Inspection' },
  { key: 'notices', label: 'Notices' },
];

export function newsSnippetHtml(snippet?: string | null): string {
  return escapeHtml(snippet || '').replace(/\x02/g, '<mark>').replace(/\x03/g, '</mark>');
}

export interface NewsViewQuery {
  cat: string;
  q: string;
  section: string;
  part: string;
  state: string;
  min_penalty: string;
  gravity: string;
  [key: string]: string;
}

export interface NewsFeedPayload {
  articles: NewsArticle[];
  total: number;
  offset?: number;
}

export interface NewsStatusResponse extends NewsStatusPayload {
  dol_configured?: boolean;
  due?: boolean;
  counts?: Record<string, number>;
  sources?: Record<string, { enabled?: boolean; last_ok_at?: string | null; retry_after?: string | null; last_error?: string | null }>;
}

export interface NewsFacetsResponse {
  states?: Array<{ code: string; count: number }>;
}

export interface EnforcementSummaryResponse {
  total_cases?: number;
  total_penalty_usd?: number;
  avg_penalty_usd?: number;
  gravity_counts?: Record<string, number>;
  top_sections?: Array<{ section_id: string; count: number }>;
  top_states?: Array<{ code: string; total_penalty_usd: number; count: number }>;
}

export interface NewsState {
  view: NewsViewQuery | null;
  data: NewsFeedPayload | null;
  status: NewsStatusResponse | null;
  facets: NewsFacetsResponse | null;
  summary: EnforcementSummaryResponse | null;
  watchToken: number;
}

export const newsState: NewsState = { view: null, data: null, status: null, facets: null, summary: null, watchToken: 0 };

export function newsViewFromParams(params?: URLSearchParams | null): NewsViewQuery {
  const get = (k: string) => (params?.get(k) || '').trim();
  const cat = NEWS_CATEGORIES.some(c => c.key === get('cat')) ? get('cat') : 'all';
  return {
    cat,
    q: get('q'),
    section: get('section'),
    part: get('part'),
    state: /^[A-Za-z]{2}$/.test(get('state')) ? get('state').toUpperCase() : '',
    min_penalty: /^\d+$/.test(get('min_penalty')) ? get('min_penalty') : '',
    gravity: /^[WRS]$/.test(get('gravity')) ? get('gravity') : '',
  };
}

export function isDefaultNewsView(view: NewsViewQuery): boolean {
  return !view.q && !view.section && !view.part && !view.state && !view.min_penalty && !view.gravity;
}

export function newsHash(view: NewsViewQuery): string {
  const p = new URLSearchParams();
  if (view.cat && view.cat !== 'all') p.set('cat', view.cat);
  for (const k of ['q', 'section', 'part', 'state', 'min_penalty', 'gravity']) {
    if (view[k]) p.set(k, view[k]);
  }
  const qs = p.toString();
  return '#/news' + (qs ? '?' + qs : '');
}

export function newsApiUrl(view: NewsViewQuery, offset = 0): string {
  const p = new URLSearchParams();
  if (view.cat && view.cat !== 'all') p.set('category', view.cat);
  for (const k of ['q', 'section', 'part', 'state', 'min_penalty', 'gravity']) {
    if (view[k]) p.set(k, view[k]);
  }
  if (offset) p.set('offset', String(offset));
  const qs = p.toString();
  return '/api/news' + (qs ? '?' + qs : '');
}

// Tab changes get a history entry (location.hash); filters and typing rewrite in place.
export function setNewsView(next: NewsViewQuery, { replace = false } = {}): void {
  const hash = newsHash(next);
  if (replace) {
    history.replaceState(null, '', hash);
    loadNews(new URLSearchParams(hash.split('?')[1] || ''));
  } else {
    window.location.hash = hash;
  }
}

export function trimNewsForCache(data: NewsFeedPayload): NewsFeedPayload {
  return { articles: (data.articles || []).slice(0, 30), total: data.total, offset: 0 };
}

export function newsChanged(
  oldData: NewsFeedPayload | null,
  newData: NewsFeedPayload | null,
  oldStatus: NewsStatusResponse | null,
  newStatus: NewsStatusResponse | null,
): boolean {
  const guids = (d: NewsFeedPayload | null) => (d?.articles || []).map(a => a.guid || '').join('|');
  const oks = (s: NewsStatusResponse | null) => (s?.sources ? Object.values(s.sources).map(x => x.last_ok_at || '').join('|') : '');
  return guids(oldData) !== guids(newData) || oks(oldStatus) !== oks(newStatus);
}

// Repaint without jumping the page under the reader: keep the first visible card where it was.
export function preservingNewsScroll(fn: () => void): void {
  const mainRect = dom.main.getBoundingClientRect();
  let anchor: string | null = null;
  let offset = 0;
  for (const el of dom.view.querySelectorAll<HTMLElement>('[data-guid]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > mainRect.top + 8) {
      anchor = el.dataset.guid || null;
      offset = r.top - mainRect.top;
      break;
    }
  }
  const top = dom.main.scrollTop;
  fn();
  if (anchor) {
    const el = dom.view.querySelector(`[data-guid="${CSS.escape(anchor)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      dom.main.scrollTop += (r.top - dom.main.getBoundingClientRect().top) - offset;
      return;
    }
  }
  dom.main.scrollTop = top;
}

interface NewsCachedItem<T> {
  t: number;
  data: T;
}

export async function loadNews(params?: URLSearchParams | null): Promise<void> {
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  document.title = 'News · FRAMEWORK';
  const view = newsViewFromParams(params);
  const firstPaint = !dom.view.querySelector('.news-front');
  const cacheable = isDefaultNewsView(view);
  const cached = cacheable ? lsGetJSON(`newsCache:v1:${view.cat}`) as NewsCachedItem<NewsFeedPayload> | null : null;
  const cachedStatus = lsGetJSON('newsCache:v1:status') as NewsCachedItem<NewsStatusResponse> | null;
  if (cached && cached.data && cachedStatus && cachedStatus.data) {
    renderNews(view, cached.data, cachedStatus.data, { enter: firstPaint, fromCache: true });
  } else {
    dom.view.innerHTML = skeletonHtml('cards', 'Loading news…');
    if (firstPaint) enterView();
  }

  let data: NewsFeedPayload;
  let status: NewsStatusResponse;
  try {
    const wantEnf = view.cat === 'enforcement';
    const [feedRes, statusRes] = await Promise.all([
      getJSON<NewsFeedPayload>(newsApiUrl(view)),
      getJSON<NewsStatusResponse>('/api/news/status'),
    ]);
    data = feedRes;
    status = statusRes;
    if (wantEnf) {
      const extras: Array<Promise<unknown>> = [];
      if (status.dol_configured && !newsState.facets) {
        extras.push(getJSON<NewsFacetsResponse>('/api/news/facets').then(f => { newsState.facets = f; }).catch(() => {}));
      }
      extras.push(getJSON<EnforcementSummaryResponse>('/api/news/enforcement/summary').then(s => { newsState.summary = s; }).catch(() => {}));
      await Promise.all(extras);
    }
  } catch (e) {
    if (seq !== state.routeSeq) return;
    const scope = newsScope(state.currentTitle);
    const msg = e instanceof Error ? e.message : String(e);
    if (cached && cached.data) markNewsOffline(cached.t);
    else {
      dom.view.innerHTML = `
        <div class="news-front"><div class="news-head"><div>
          <div class="doc-kicker">FRAMEWORK Newsroom</div><h1 class="doc-title">${escapeHtml(scope.agency)} Regulatory News</h1>
        </div></div>
        <div class="empty-state"><h2>Couldn’t reach the news service</h2>
        <p>${escapeHtml(msg)}</p>
        <button type="button" class="btn" data-news-act="reload">Try again</button></div></div>`;
      showToast('Could not reach the news service');
    }
    return;
  }
  if (seq !== state.routeSeq) return;
  if (cacheable) {
    lsSetJSON(`newsCache:v1:${view.cat}`, { t: Date.now(), data: trimNewsForCache(data) });
    lsSetJSON('newsCache:v1:status', { t: Date.now(), data: status });
  }
  if (!cached || !cached.data || !cachedStatus || !cachedStatus.data
      || newsChanged(cached.data, data, cachedStatus.data, status)
      || view.cat === 'enforcement') {
    preservingNewsScroll(() => renderNews(view, data, status, { enter: firstPaint && !(cached && cached.data) }));
  } else {
    newsState.view = view;
    newsState.data = data;
    newsState.status = status;
  }

  // Refresh-on-open: only this POST can start a sync, and only for due sources.
  let watch = Boolean(status.syncing);
  if (status.sync_enabled && status.due && !status.syncing) {
    try {
      const r = await getJSON<{ queued?: unknown[] }>('/api/news/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      watch = (r.queued || []).length > 0;
    } catch {
      // getJSON's errors carry no status code. A 409 means a sync started meanwhile.
      try { watch = Boolean((await getJSON<NewsStatusResponse>('/api/news/status')).syncing); } catch { watch = false; }
    }
    if (seq !== state.routeSeq) return;
  }
  if (watch) watchNewsSync(seq, view);
}

export function markNewsOffline(cachedAt: number): void {
  const slot = document.getElementById('news-head-status');
  if (slot) slot.innerHTML = statPill('stale', `Offline · showing saved news from ${fmtDate(new Date(cachedAt).toISOString().slice(0, 10))}`);
}

export function watchNewsSync(seq: number, view: NewsViewQuery): void {
  const token = ++newsState.watchToken;
  const started = Date.now();
  const slot = document.getElementById('news-head-status');
  if (slot) slot.innerHTML = statPill('busy', 'Checking for news…');
  const tick = async () => {
    if (seq !== state.routeSeq || token !== newsState.watchToken || Date.now() - started > 120000) return;
    let status: NewsStatusResponse;
    try { status = await getJSON<NewsStatusResponse>('/api/news/status'); } catch { return; }
    if (seq !== state.routeSeq || token !== newsState.watchToken) return;
    if (status.syncing) { setTimeout(tick, 3000); return; }
    let data: NewsFeedPayload;
    try { data = await getJSON<NewsFeedPayload>(newsApiUrl(view)); } catch { return; }
    if (seq !== state.routeSeq || token !== newsState.watchToken) return;
    if (isDefaultNewsView(view)) {
      lsSetJSON(`newsCache:v1:${view.cat}`, { t: Date.now(), data: trimNewsForCache(data) });
      lsSetJSON('newsCache:v1:status', { t: Date.now(), data: status });
    }
    if (newsChanged(newsState.data, data, newsState.status, status)) {
      preservingNewsScroll(() => renderNews(view, data, status, {}));
    } else {
      newsState.status = status;
      const s = document.getElementById('news-head-status');
      if (s) s.innerHTML = newsHeadStatusHtml(status);
    }
  };
  setTimeout(tick, 3000);
}

export async function refreshNewsCommand(): Promise<void> {
  try {
    await getJSON('/api/news/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    showToast('Checking for news…');
    if (routeTarget() === 'news' && newsState.view) watchNewsSync(state.routeSeq, newsState.view);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    showToast(/already running/i.test(m) ? 'Already checking for news'
      : /sync is off/i.test(m) ? 'News sync is off' : m);
  }
}

// --- Newsroom rendering ---

export function newsHeadStatusHtml(status: NewsStatusResponse | null | undefined): string {
  if (!status) return '';
  const pill = newsStatusPillHtml(status);
  if (!status.sync_enabled || status.syncing) return pill;
  const enabled = Object.values(status.sources || {}).filter(s => s.enabled);
  const lastOk = enabled.map(s => s.last_ok_at).filter(Boolean).sort().pop();
  const failed = enabled.find(s => s.last_error);
  if (failed && lastOk) return `${pill} <button type="button" class="btn btn-sm" data-news-act="refresh">Retry</button>`;
  return `${pill} <button type="button" class="btn btn-sm" data-news-act="refresh">Refresh</button>`;
}

export function newsBreakingHtml(articles: NewsArticle[]): string {
  const today = Date.now();
  const daysAgo = (iso: string) => (today - Date.parse(iso + 'T00:00:00')) / 86400000;
  const pi = articles.find(a => a.category === 'public_inspection' && daysAgo(a.published_at) <= 3);
  const fine = articles.find(a => a.category === 'enforcement' && (a.penalty_usd || 0) >= 50000
    && daysAgo(a.published_at) <= 14);
  const hit = pi || fine;
  if (!hit) return '';
  const tag = pi ? 'Public inspection' : 'Enforcement';
  const actNr = !pi ? inspectionActivityNr(hit) : null;
  const href = pi ? safeHttpUrl(hit.link) : actNr ? `#/news/inspection/${actNr}` : '#/news?cat=enforcement';
  const ext = pi && href ? ' target="_blank" rel="noopener"' : '';
  if (!href) return '';
  return `<a class="news-breaking" href="${escapeHtml(href)}"${ext}>
    <span class="news-breaking-tag">${icon('activity')} ${escapeHtml(tag.toUpperCase())} · ${escapeHtml(fmtDate(hit.published_at))}</span>
    <span class="news-breaking-text">${escapeHtml(hit.title)}</span>${icon('chevronRight')}</a>`;
}

export function newsChipsHtml(a: NewsArticle): string {
  const chips: string[] = [];
  const defaultTitle = articleNewsTitle(a);
  for (const r of a.cfr_parts || []) {
    const href = newsPartHref(r.title, r.part);
    const dim = !titleInstalled(r.title);
    chips.push(`<a class="citation-chip${dim ? ' is-dim' : ''}" data-ref-tier="${dim ? 'uninstalled' : 'cfr'}" href="${href}"${dim ? ` title="Title ${r.title} isn’t installed. Open the library"` : ''}>${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
  }
  for (const s of a.sections || []) {
    const dim = !titleInstalled(defaultTitle);
    chips.push(`<a class="citation-chip${dim ? ' is-dim' : ''}" data-ref-tier="${dim ? 'uninstalled' : 'cfr'}" href="${newsSectionHref(defaultTitle, s)}"${dim ? ` title="Title ${defaultTitle} isn’t installed. Open the library"` : ''}>§ ${escapeHtml(s)}</a>`);
  }
  if (!chips.length) return '';
  const extra = chips.length - 6;
  const shown = extra > 0
    ? chips.slice(0, 6).join('') + chips.slice(6).map(c => c.replace('citation-chip', 'citation-chip is-extra')).join('')
      + `<button type="button" class="citation-chip news-chip-more" data-news-act="expand-chips">+${extra}</button>`
    : chips.join('');
  return `<div class="news-chips">${shown}</div>`;
}

export function newsActionsHtml(a: NewsArticle): string {
  const out: string[] = [];
  const defaultTitle = articleNewsTitle(a);
  const scope = newsScope(defaultTitle);
  const actNr = inspectionActivityNr(a);
  if (actNr) {
    out.push(`<a class="btn btn-sm btn-accent" href="#/news/inspection/${actNr}">${icon('file')} Case file</a>`);
  }
  const srcLabel = a.source === 'dol_osha' ? scope.agencySourceLabel : 'Federal Register';
  const link = safeHttpUrl(a.link);
  if (link) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(link)}">${icon('external')} ${escapeHtml(srcLabel)}</a>`);
  const pdf = safeHttpUrl(a.pdf_url || '');
  if (pdf) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(pdf)}">${icon('external')} PDF</a>`);
  const sec = (a.sections || [])[0];
  const partRef = (a.cfr_parts || [])[0];
  const secCls = actNr ? 'btn btn-sm' : 'btn btn-sm btn-accent';
  if (sec) out.push(`<a class="${secCls}" href="${newsSectionHref(defaultTitle, sec)}">${icon('book')} Open § ${escapeHtml(sec)}</a>`);
  else if (partRef) out.push(`<a class="${secCls}" href="${newsPartHref(partRef.title, partRef.part)}">${icon('book')} Open Part ${escapeHtml(String(partRef.part))}</a>`);
  return out.join('');
}

export function newsCardHtml(a: NewsArticle, { hero = false }: { hero?: boolean } = {}): string {
  const tag = hero ? 'section' : 'article';
  // The penalty figure is plain tabular text, never a statPill (pills mean sync state).
  const figure = a.penalty_usd ? `<span class="news-figure">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : '';
  const rows = (a.takeaways || []).map((t, i) => {
    const text = i === 0 && a.snippet ? newsSnippetHtml(a.snippet) : linkifyNewsText(t.text);
    return `<dt>${escapeHtml(t.label)}</dt><dd>${text}</dd>`;
  }).join('');
  const actNr = inspectionActivityNr(a);
  const titleHtml = actNr
    ? `<a href="#/news/inspection/${actNr}">${escapeHtml(a.title)}</a>`
    : extLink(a.link, escapeHtml(a.title));
  return `
    <${tag} class="news-card${hero ? ' news-hero' : ''}" data-guid="${escapeHtml(a.guid || '')}" data-cat="${escapeHtml(a.category)}">
      <div class="news-card-top"><span class="news-kicker">${escapeHtml(newsKicker(a))}</span>${figure}</div>
      <h3 class="news-card-title">${titleHtml}</h3>
      ${newsBylineHtml(a)}
      ${rows ? `<dl class="news-takeaways">${rows}</dl>` : ''}
      ${newsChipsHtml(a)}
      <div class="news-card-foot">${newsActionsHtml(a)}</div>
    </${tag}>`;
}

export function newsTabsHtml(view: NewsViewQuery, status: NewsStatusResponse | null | undefined): string {
  const counts = status?.counts || {};
  return `<div class="lib-seg news-tabs" role="tablist" aria-label="News categories">${NEWS_CATEGORIES.map(c => {
    const on = view.cat === c.key;
    const n = counts[c.key];
    return `<button type="button" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-pressed="${on}" data-news-cat="${c.key}">${escapeHtml(c.label)}${n ? ` <span class="news-tab-count">${n}</span>` : ''}</button>`;
  }).join('')}</div>`;
}

export function newsFilterChipsHtml(view: NewsViewQuery): string {
  const chips: string[] = [];
  const chip = (key: string, label: string) =>
    chips.push(`<button type="button" class="news-filter-chip" data-news-act="clear-filter" data-filter-key="${key}" aria-label="Remove filter: ${escapeHtml(label)}">${escapeHtml(label)}${icon('close')}</button>`);
  if (view.section) chip('section', `Citing § ${view.section}`);
  if (view.part) chip('part', `Citing Part ${view.part}`);
  if (view.state) chip('state', stateName(view.state));
  if (view.min_penalty) chip('min_penalty', `Over ${fmtMoney(Number(view.min_penalty))}`);
  if (view.gravity) chip('gravity', ({ W: 'Willful', R: 'Repeat', S: 'Serious' }[view.gravity] || view.gravity));
  return chips.length ? `<div class="news-filter-chips">${chips.join('')}</div>` : '';
}

export function newsFacetsHtml(view: NewsViewQuery, status: NewsStatusResponse | null | undefined): string {
  // Only on the Enforcement tab, and only with a DOL key: FR records have no state,
  // penalty or gravity, so the facets would just confuse other tabs.
  if (view.cat !== 'enforcement' || !status || !status.dol_configured) return '';
  const states = newsState.facets?.states || [];
  const sel = (v: string, cur: string) => (v === cur ? ' selected' : '');
  return `<div class="news-facets">
    <select data-news-facet="state" aria-label="State">
      <option value="">All states</option>
      ${states.map(s => `<option value="${escapeHtml(s.code)}"${sel(s.code, view.state)}>${escapeHtml(stateName(s.code))} (${s.count})</option>`).join('')}
    </select>
    <select data-news-facet="min_penalty" aria-label="Minimum penalty">
      <option value="">Any penalty</option>
      ${[25000, 100000, 250000].map(v => `<option value="${v}"${sel(String(v), view.min_penalty)}>Over ${fmtMoney(v)}</option>`).join('')}
    </select>
    <select data-news-facet="gravity" aria-label="Violation gravity">
      <option value="">Any gravity</option>
      ${[['W', 'Willful'], ['R', 'Repeat'], ['S', 'Serious']].map(([v, l]) => `<option value="${v}"${sel(v, view.gravity)}>${l}</option>`).join('')}
    </select>
  </div>`;
}

export function newsEmptyHtml(view: NewsViewQuery, status: NewsStatusResponse | null | undefined): string {
  const s: Partial<NewsStatusResponse> = status || {};
  if (!s.sync_enabled && !(s.counts && s.counts.all)) {
    return `<div class="empty-state"><h2>News sync is off</h2>
      <p>Set <code>NEWS_SYNC=1</code> in <code>reader/.env</code> and restart FRAMEWORK.</p></div>`;
  }
  if (view.cat === 'enforcement' && !view.q && !s.dol_configured) {
    return `<div class="news-setup">
      <h3>Enforcement data needs a free DOL API key</h3>
      <p>Register at <a href="https://dataportal.dol.gov/registration" target="_blank" rel="noopener">dataportal.dol.gov/registration</a>,
      then save <code>DOL_API_KEY</code> in <code>reader/.env</code> using the setup guide or in-app editor.
      Federal Register news works without it.</p>
      <div class="news-setup-actions">
        <button type="button" class="btn btn-sm btn-accent" data-open-env="dol_api_key">${icon('key')} Add DOL key</button>
        <a class="btn btn-sm" href="#/help">${icon('help')} Connections &amp; API keys</a>
      </div></div>`;
  }
  if (view.q) {
    const tab = NEWS_CATEGORIES.find(c => c.key === view.cat) || NEWS_CATEGORIES[0];
    const widen = view.cat !== 'all'
      ? `<button type="button" class="btn" data-news-act="search-all">Search all news</button>` : '';
    return `<div class="empty-state"><h2>No news matches “${escapeHtml(view.q)}” in ${escapeHtml(tab.label)}</h2>${widen}</div>`;
  }
  const enabled = Object.values(s.sources || {}).filter(x => x.enabled);
  const neverSynced = enabled.every(x => !x.last_ok_at);
  const failed = enabled.find(x => x.last_error);
  if (neverSynced && failed) {
    const retry = failed.retry_after ? `<p>Retrying ${escapeHtml(timeUntil(failed.retry_after))}.</p>` : '';
    return `<div class="empty-state"><h2>Couldn’t fetch the news</h2>
      <p>${escapeHtml(failed.last_error || '')}</p>${retry}
      <button type="button" class="btn" data-news-act="refresh">Retry</button></div>`;
  }
  if (neverSynced) {
    return `<div class="empty-state">${statPill('busy', 'Fetching from the Federal Register…')}
      <p class="dr-note">The first sync takes a few seconds.</p></div>`;
  }
  return '<div class="empty-state"><h2>Nothing here yet</h2><p>No items in this view.</p></div>';
}

export function enforcementSummaryHtml(view: NewsViewQuery): string {
  const s = newsState.summary;
  if (view.cat !== 'enforcement' || !isDefaultNewsView(view) || !s || !s.total_cases) return '';
  const scope = newsScope(state.currentTitle);
  const g = s.gravity_counts || {};
  const highGrav = (g.W || 0) + (g.R || 0);
  const topSec = (s.top_sections || [])[0];
  const topState = (s.top_states || [])[0];
  return `
    <section class="ins-summary-strip" aria-label="Enforcement telemetry">
      ${metricCardHtml({
        label: 'Tracked penalties',
        value: escapeHtml(fmtMoney(s.total_penalty_usd || 0)),
        sub: escapeHtml(`${plural(s.total_cases, 'case')} · avg ${fmtMoney(s.avg_penalty_usd || 0)}`),
      })}
      ${metricCardHtml({
        label: 'High gravity',
        value: fmt(highGrav),
        of: 'cases',
        sub: joinSep([
          g.W ? `<button type="button" class="metric-link" data-news-quick-gravity="W">${g.W} Willful</button>` : '0 Willful',
          g.R ? `<button type="button" class="metric-link" data-news-quick-gravity="R">${g.R} Repeat</button>` : '0 Repeat',
        ]),
      })}
      ${topSec
        ? metricCardHtml({
          label: 'Top cited standard',
          value: `<a class="ins-tile-link" href="${newsSectionHref(scope.title, topSec.section_id)}">§ ${escapeHtml(topSec.section_id)}</a>`,
          sub: `<button type="button" class="metric-link" data-news-quick-sec="${escapeHtml(topSec.section_id)}">Filter ${plural(topSec.count, 'case')} ${icon('chevronRight')}</button>`,
        })
        : metricCardHtml({ label: 'Top cited standard', value: '—', sub: 'No CFR mappings yet' })}
      ${topState
        ? metricCardHtml({
          label: 'Top state',
          value: escapeHtml(stateName(topState.code)),
          sub: `<button type="button" class="metric-link" data-news-quick-state="${escapeHtml(topState.code)}">${escapeHtml(fmtMoney(topState.total_penalty_usd))} · ${plural(topState.count, 'case')} ${icon('chevronRight')}</button>`,
        })
        : metricCardHtml({ label: 'Top state', value: '—', sub: 'No state data' })}
    </section>`;
}

export function renderNews(
  view: NewsViewQuery,
  data: NewsFeedPayload,
  status: NewsStatusResponse,
  opts: { enter?: boolean; fromCache?: boolean } = {},
): void {
  newsState.view = view;
  newsState.data = data;
  newsState.status = status;
  const scope = newsScope(state.currentTitle);
  const articles = data.articles || [];
  // The lead hero: the newest Final Rule within 30 days on All, else the tab's newest.
  let hero: NewsArticle | null = null;
  if (articles.length) {
    const fresh = (a: NewsArticle) => (Date.now() - Date.parse(a.published_at + 'T00:00:00')) / 86400000 <= 30;
    hero = (view.cat === 'all' ? articles.find(a => a.category === 'rules' && fresh(a)) : null) || articles[0];
  }
  const feed = articles.filter(a => !hero || a.guid !== hero.guid);
  const more = data.total > articles.length
    ? `<div class="news-more"><button type="button" class="btn" data-news-act="more">Load more</button></div>` : '';

  // Keep the reader's place in the filter box across re-renders.
  const qEl = document.getElementById('news-q') as HTMLInputElement | null;
  const qFocus = qEl && document.activeElement === qEl
    ? { value: qEl.value, start: qEl.selectionStart ?? qEl.value.length, end: qEl.selectionEnd ?? qEl.value.length } : null;

  dom.view.innerHTML = `
    <div class="news-front">
      <div class="news-head">
        <div>
          <div class="doc-kicker">FRAMEWORK Newsroom · ${escapeHtml(scope.agency)}</div>
          <h1 class="doc-title">Regulatory News</h1>
        </div>
        <div class="news-head-status" id="news-head-status" aria-live="polite">${newsHeadStatusHtml(status)}</div>
      </div>
      ${newsBreakingHtml(articles)}
      <div class="news-bar">
        ${newsTabsHtml(view, status)}
        <input type="search" class="news-q" id="news-q" value="${escapeHtml(view.q)}"
          placeholder="Filter news, company, or § ${escapeHtml(scope.exampleSection)}…" aria-label="Search news" autocomplete="off" spellcheck="false">
      </div>
      ${newsFilterChipsHtml(view)}
      ${newsFacetsHtml(view, status)}
      ${enforcementSummaryHtml(view)}
      ${articles.length ? `
        ${hero ? newsCardHtml(hero, { hero: true }) : ''}
        <div class="news-grid" id="news-grid">${feed.map(a => newsCardHtml(a)).join('')}</div>
        ${more}` : newsEmptyHtml(view, status)}
    </div>`;
  if (opts.enter) enterView();
  if (qFocus) {
    const q = document.getElementById('news-q') as HTMLInputElement | null;
    if (q) {
      q.value = qFocus.value;
      q.focus();
      try { q.setSelectionRange(qFocus.start, qFocus.end); } catch { /* type=search quirks */ }
    }
  }
}

export async function loadMoreNews(): Promise<void> {
  const seq = state.routeSeq;
  const { view, data } = newsState;
  if (!view || !data) return;
  let page: NewsFeedPayload;
  try { page = await getJSON<NewsFeedPayload>(newsApiUrl(view, data.articles.length)); } catch { return; }
  if (seq !== state.routeSeq || newsState.data !== data) return;
  data.articles = data.articles.concat(page.articles || []);
  data.total = page.total;
  const grid = document.getElementById('news-grid');
  if (grid) {
    const shown = new Set([...dom.view.querySelectorAll<HTMLElement>('[data-guid]')].map(el => el.dataset.guid));
    grid.insertAdjacentHTML('beforeend',
      (page.articles || []).filter(a => !shown.has(a.guid)).map(a => newsCardHtml(a)).join(''));
  }
  const moreBtn = dom.view.querySelector('[data-news-act="more"]');
  if (moreBtn && data.articles.length >= data.total) moreBtn.closest('.news-more')?.remove();
}

// Delegated events for the whole newsroom (no inline handlers).
onView('click', (e) => {
  const target = e.target as Element | null;
  if (!target) return;
  const tab = target.closest<HTMLElement>('[data-news-cat]');
  if (tab && newsState.view) {
    setNewsView({ ...newsState.view, cat: tab.dataset.newsCat || 'all' });
    return;
  }
  const qGrav = target.closest<HTMLElement>('[data-news-quick-gravity]');
  if (qGrav && newsState.view) {
    setNewsView({ ...newsState.view, cat: 'enforcement', gravity: qGrav.dataset.newsQuickGravity || '' }, { replace: true });
    return;
  }
  const qSec = target.closest<HTMLElement>('[data-news-quick-sec]');
  if (qSec && newsState.view) {
    setNewsView({ ...newsState.view, cat: 'enforcement', section: qSec.dataset.newsQuickSec || '' }, { replace: true });
    return;
  }
  const qState = target.closest<HTMLElement>('[data-news-quick-state]');
  if (qState && newsState.view) {
    setNewsView({ ...newsState.view, cat: 'enforcement', state: qState.dataset.newsQuickState || '' }, { replace: true });
    return;
  }
  const insAct = target.closest<HTMLButtonElement>('[data-ins-act="enrich"]');
  if (insAct) {
    const actNr = parseInt(insAct.dataset.actNr || '', 10);
    if (!Number.isNaN(actNr)) {
      insAct.disabled = true;
      const slot = document.getElementById('ins-status-slot');
      if (slot) slot.innerHTML = statPill('busy', 'Refreshing from DOL…');
      enrichInspection(actNr, state.routeSeq);
    }
    return;
  }
  const act = target.closest<HTMLElement>('[data-news-act]');
  if (!act) return;
  const kind = act.dataset.newsAct;
  if (kind === 'refresh') refreshNewsCommand();
  else if (kind === 'reload') emit('route:refresh');
  else if (kind === 'more') loadMoreNews();
  else if (kind === 'search-all' && newsState.view) setNewsView({ ...newsState.view, cat: 'all' });
  else if (kind === 'clear-filter' && newsState.view && act.dataset.filterKey) {
    setNewsView({ ...newsState.view, [act.dataset.filterKey]: '' }, { replace: true });
  } else if (kind === 'expand-chips') {
    const row = act.closest('.news-chips');
    if (row) { row.classList.add('is-expanded'); act.remove(); }
  }
});

state.newsQTimer = null;

onView('input', (e) => {
  const target = e.target as HTMLInputElement | null;
  if (!target || target.id !== 'news-q' || !newsState.view) return;
  clearTimeout(state.newsQTimer as ReturnType<typeof setTimeout>);
  const q = target.value.trim();
  state.newsQTimer = setTimeout(() => {
    if (newsState.view && q !== newsState.view.q) setNewsView({ ...newsState.view, q }, { replace: true });
  }, 250);
});

onView('keydown', (e) => {
  const ke = e as KeyboardEvent;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.id === 'news-q' && ke.key === 'Escape' && (target as HTMLInputElement).value) {
    (target as HTMLInputElement).value = '';
    if (newsState.view && newsState.view.q) setNewsView({ ...newsState.view, q: '' }, { replace: true });
    return;
  }
  const tab = target.closest<HTMLElement>('.news-tabs [role="tab"]');
  if (!tab) return;
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(ke.key)) return;
  ke.preventDefault();
  const tabs = [...dom.view.querySelectorAll<HTMLElement>('.news-tabs [role="tab"]')];
  const i = tabs.indexOf(tab);
  const next = ke.key === 'Home' ? 0 : ke.key === 'End' ? tabs.length - 1
    : (i + (ke.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
});

onView('change', (e) => {
  const target = e.target as Element | null;
  const facet = target?.closest<HTMLSelectElement>('[data-news-facet]');
  if (!facet || !newsState.view || !facet.dataset.newsFacet) return;
  setNewsView({ ...newsState.view, [facet.dataset.newsFacet]: facet.value }, { replace: true });
});

on('news:refresh', () => refreshNewsCommand());
on('env:saved', () => { if (routeTarget() === 'news') emit('route:refresh'); });
