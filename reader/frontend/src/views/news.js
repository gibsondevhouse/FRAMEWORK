import { NEWS_CITE_RE } from '../citations';
import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, lsGet, lsSet, showToast } from '../dom';
import { routeTarget } from '../nav';
import { timeUntil } from '../panels/settings_panel';
import { handleRoute } from '../router';
import { dom } from '../state_init';
import { timeAgo } from '../usage';
import { fmtDate, getJSON, statPill } from '../views/library';

// --- News (#/news): OSHA rulemaking and enforcement from sanctioned APIs ---
//
// The page is a newsroom front: an optional breaking banner, a lead hero card, category
// tabs with counts, a filter box (FTS inside News only), enforcement facets, and cards
// whose three bullets are built server-side from the record's own fields. A
// stale-while-revalidate cache paints the default tab instantly; opening the page on
// stale data asks the server for a sync with POST /api/news/refresh {"force": false}
// (GETs never sync). Search and routing all live in the #/news hash query.

export const NEWS_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'rules', label: 'Final Rules' },
  { key: 'rulemaking', label: 'Proposed Rules' },
  { key: 'enforcement', label: 'Enforcement & Penalties' },
  { key: 'public_inspection', label: 'Public Inspection' },
  { key: 'notices', label: 'Notices' },
];

export const NEWS_SOURCE_LABELS = {
  federal_register: 'Federal Register',
  federal_register_pi: 'Federal Register Public Inspection',
  dol_osha: 'DOL enforcement data',
};

export const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  GU: 'Guam', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', VI: 'Virgin Islands', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export const stateName = (code) => US_STATE_NAMES[(code || '').toUpperCase()] || code;


// "29 CFR 1910.1200(a)", "§ 1926.651" -> links. Bare numbers are left alone, and a bare
// § only links in OSHA's 1900-1999 range. Kept in step with news.extract_citations by
// tests/test_news_frontend.py (CITATION_CASES).

export function lsGetJSON(key) {
  try { const v = lsGet(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

export function lsSetJSON(key, value) {
  lsSet(key, JSON.stringify(value));
}


export const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function fmtMoney(n) { return moneyFmt.format(n); }


export function safeHttpUrl(u) {
  if (!u) return '';
  try {
    const p = new URL(u, window.location.href).protocol;
    return p === 'http:' || p === 'https:' ? u : '';
  } catch (e) { return ''; }
}

export function extLink(url, html) {
  const safe = safeHttpUrl(url);
  return safe ? `<a target="_blank" rel="noopener" href="${escapeHtml(safe)}">${html}</a>` : html;
}


// Into the reader when the title is installed, otherwise to the library (what Projects
// does for sections of uninstalled titles).
export function titleInstalled(t) { return state.installedTitles.some(x => x.title === t); }

export function newsSectionHref(t, id) {
  return titleInstalled(t) ? `#/title/${t}/section/${encodeURIComponent(id)}` : `#/library/${t}`;
}

export function newsPartHref(t, part) {
  return titleInstalled(t) ? `#/title/${t}/part/${encodeURIComponent(part)}` : `#/library/${t}`;
}


export function linkifyNewsText(text) {
  // Escaping first is safe: the pattern contains nothing that escapeHtml changes.
  return escapeHtml(text || '').replace(NEWS_CITE_RE, (m, a, b) => {
    const id = a || b;
    return `<a class="citation-link" href="${newsSectionHref(29, id)}">${m}</a>`;
  });
}

export function newsSnippetHtml(snippet) {
  return escapeHtml(snippet || '').replace(/\x02/g, '<mark>').replace(/\x03/g, '</mark>');
}


export const newsState = { view: null, data: null, status: null, facets: null, watchToken: 0 };


export function newsViewFromParams(params) {
  const get = (k) => (params && params.get(k) || '').trim();
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

export function isDefaultNewsView(view) {
  return !view.q && !view.section && !view.part && !view.state && !view.min_penalty && !view.gravity;
}

export function newsHash(view) {
  const p = new URLSearchParams();
  if (view.cat && view.cat !== 'all') p.set('cat', view.cat);
  for (const k of ['q', 'section', 'part', 'state', 'min_penalty', 'gravity']) {
    if (view[k]) p.set(k, view[k]);
  }
  const qs = p.toString();
  return '#/news' + (qs ? '?' + qs : '');
}

export function newsApiUrl(view, offset = 0) {
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
export function setNewsView(next, { replace = false } = {}) {
  const hash = newsHash(next);
  if (replace) {
    history.replaceState(null, '', hash);
    loadNews(new URLSearchParams(hash.split('?')[1] || ''));
  } else {
    window.location.hash = hash;
  }
}


export function trimNewsForCache(data) {
  return { articles: (data.articles || []).slice(0, 30), total: data.total, offset: 0 };
}

export function newsChanged(oldData, newData, oldStatus, newStatus) {
  const guids = (d) => (d && d.articles || []).map(a => a.guid).join('|');
  const oks = (s) => s && s.sources ? Object.values(s.sources).map(x => x.last_ok_at || '').join('|') : '';
  return guids(oldData) !== guids(newData) || oks(oldStatus) !== oks(newStatus);
}


// Repaint without jumping the page under the reader: keep the first visible card where it was.
export function preservingNewsScroll(fn) {
  const mainRect = dom.main.getBoundingClientRect();
  let anchor = null, offset = 0;
  for (const el of dom.view.querySelectorAll('[data-guid]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > mainRect.top + 8) { anchor = el.dataset.guid; offset = r.top - mainRect.top; break; }
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


export async function loadNews(params) {
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
  const cached = cacheable ? lsGetJSON(`newsCache:v1:${view.cat}`) : null;
  const cachedStatus = lsGetJSON('newsCache:v1:status');
  if (cached && cached.data && cachedStatus && cachedStatus.data) {
    renderNews(view, cached.data, cachedStatus.data, { enter: firstPaint, fromCache: true });
  } else {
    dom.view.innerHTML = '<div class="loading">Loading news…</div>';
    if (firstPaint) enterView();
  }

  let data, status;
  try {
    const wantFacets = view.cat === 'enforcement';
    [data, status] = await Promise.all([getJSON(newsApiUrl(view)), getJSON('/api/news/status')]);
    if (wantFacets && status.dol_configured && !newsState.facets) {
      newsState.facets = await getJSON('/api/news/facets');
    }
  } catch (e) {
    if (seq !== state.routeSeq) return;
    if (cached && cached.data) markNewsOffline(cached.t);
    else {
      dom.view.innerHTML = `
        <div class="news-front"><div class="news-head"><div>
          <div class="doc-kicker">FRAMEWORK Newsroom</div><h1 class="doc-title">OSHA Regulatory News</h1>
        </div></div>
        <div class="empty-state"><h2>Couldn’t reach the news service</h2>
        <p>${escapeHtml(e.message)}</p>
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
      || newsChanged(cached.data, data, cachedStatus.data, status)) {
    preservingNewsScroll(() => renderNews(view, data, status, { enter: firstPaint && !(cached && cached.data) }));
  } else {
    newsState.view = view; newsState.data = data; newsState.status = status;
  }

  // Refresh-on-open: only this POST can start a sync, and only for due sources.
  let watch = status.syncing;
  if (status.sync_enabled && status.due && !status.syncing) {
    try {
      const r = await getJSON('/api/news/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      watch = (r.queued || []).length > 0;
    } catch (e) {
      // getJSON's errors carry no status code. A 409 means a sync started meanwhile.
      try { watch = (await getJSON('/api/news/status')).syncing; } catch (e2) { watch = false; }
    }
    if (seq !== state.routeSeq) return;
  }
  if (watch) watchNewsSync(seq, view);
}


export function markNewsOffline(cachedAt) {
  const slot = document.getElementById('news-head-status');
  if (slot) slot.innerHTML = statPill('stale', `Offline · showing saved news from ${fmtDate(new Date(cachedAt).toISOString().slice(0, 10))}`);
}


export function watchNewsSync(seq, view) {
  const token = ++newsState.watchToken;
  const started = Date.now();
  const slot = document.getElementById('news-head-status');
  if (slot) slot.innerHTML = statPill('busy', 'Checking for news…');
  const tick = async () => {
    if (seq !== state.routeSeq || token !== newsState.watchToken || Date.now() - started > 120000) return;
    let status;
    try { status = await getJSON('/api/news/status'); } catch (e) { return; }
    if (seq !== state.routeSeq || token !== newsState.watchToken) return;
    if (status.syncing) { setTimeout(tick, 3000); return; }
    let data;
    try { data = await getJSON(newsApiUrl(view)); } catch (e) { return; }
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


export async function refreshNewsCommand() {
  try {
    await getJSON('/api/news/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    showToast('Checking for news…');
    if (routeTarget() === 'news' && newsState.view) watchNewsSync(state.routeSeq, newsState.view);
  } catch (err) {
    const m = String(err.message || '');
    showToast(/already running/i.test(m) ? 'Already checking for news'
      : /sync is off/i.test(m) ? 'News sync is off' : m);
  }
}


// --- Newsroom rendering ---

export function newsHeadStatusHtml(status) {
  if (!status) return '';
  if (!status.sync_enabled) return statPill('stale', 'News sync is off');
  if (status.syncing) return statPill('busy', 'Checking for news…');
  const enabled = Object.values(status.sources || {}).filter(s => s.enabled);
  const lastOk = enabled.map(s => s.last_ok_at).filter(Boolean).sort().pop();
  const failed = enabled.find(s => s.last_error);
  if (failed && lastOk) {
    return statPill('stale', `Last update failed · showing data from ${fmtDate(lastOk.slice(0, 10))}`)
      + ` <button type="button" class="btn btn-sm" data-news-act="refresh">Retry</button>`;
  }
  const updated = lastOk ? statPill('synced', `Updated ${timeAgo(Date.parse(lastOk))}`) : '';
  return `${updated} <button type="button" class="btn btn-sm" data-news-act="refresh">Refresh</button>`;
}


export function newsBreakingHtml(articles) {
  const today = Date.now();
  const daysAgo = (iso) => (today - Date.parse(iso + 'T00:00:00')) / 86400000;
  const pi = articles.find(a => a.category === 'public_inspection' && daysAgo(a.published_at) <= 3);
  const fine = articles.find(a => a.category === 'enforcement' && (a.penalty_usd || 0) >= 50000
    && daysAgo(a.published_at) <= 14);
  const hit = pi || fine;
  if (!hit) return '';
  const tag = pi ? 'Public inspection' : 'Enforcement';
  const href = pi ? safeHttpUrl(hit.link) : '#/news?cat=enforcement';
  const ext = pi && href ? ' target="_blank" rel="noopener"' : '';
  if (!href) return '';
  return `<a class="news-breaking" href="${escapeHtml(href)}"${ext}>
    <span class="news-breaking-tag">${icon('activity')} ${escapeHtml(tag.toUpperCase())} · ${escapeHtml(fmtDate(hit.published_at))}</span>
    <span class="news-breaking-text">${escapeHtml(hit.title)}</span>${icon('chevronRight')}</a>`;
}


export function newsKicker(a) {
  if (a.category === 'enforcement') return ['ENFORCEMENT', a.state].filter(Boolean).join(' · ');
  if (a.category === 'public_inspection') {
    return ['PUBLIC INSPECTION', (a.doc_type || '').toUpperCase()].filter(Boolean).join(' · ');
  }
  const label = a.category === 'rules' ? 'FINAL RULE' : a.category === 'rulemaking' ? 'PROPOSED RULE' : 'NOTICE';
  return [label, a.citation].filter(Boolean).join(' · ');
}


export function newsBylineHtml(a) {
  return `<div class="news-byline">${escapeHtml(fmtDate(a.published_at))}<span class="sep" aria-hidden="true">·</span>${escapeHtml(NEWS_SOURCE_LABELS[a.source] || a.source)}</div>`;
}


export function newsChipsHtml(a) {
  const chips = [];
  for (const r of a.cfr_parts || []) {
    const href = newsPartHref(r.title, r.part);
    const dim = !titleInstalled(r.title);
    chips.push(`<a class="citation-chip${dim ? ' is-dim' : ''}" href="${href}"${dim ? ` title="Title ${r.title} isn’t installed. Open the library"` : ''}>${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
  }
  for (const s of a.sections || []) {
    const dim = !titleInstalled(29);
    chips.push(`<a class="citation-chip${dim ? ' is-dim' : ''}" href="${newsSectionHref(29, s)}"${dim ? ' title="Title 29 isn’t installed. Open the library"' : ''}>§ ${escapeHtml(s)}</a>`);
  }
  if (!chips.length) return '';
  const extra = chips.length - 6;
  const shown = extra > 0
    ? chips.slice(0, 6).join('') + chips.slice(6).map(c => c.replace('citation-chip', 'citation-chip is-extra')).join('')
      + `<button type="button" class="citation-chip news-chip-more" data-news-act="expand-chips">+${extra}</button>`
    : chips.join('');
  return `<div class="news-chips">${shown}</div>`;
}


export function newsActionsHtml(a) {
  const out = [];
  const srcLabel = a.source === 'dol_osha' ? 'OSHA establishment search' : 'Federal Register';
  const link = safeHttpUrl(a.link);
  if (link) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(link)}">${icon('external')} ${srcLabel}</a>`);
  const pdf = safeHttpUrl(a.pdf_url || '');
  if (pdf) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(pdf)}">${icon('external')} PDF</a>`);
  const sec = (a.sections || [])[0];
  const partRef = (a.cfr_parts || [])[0];
  if (sec) out.push(`<a class="btn btn-sm btn-accent" href="${newsSectionHref(29, sec)}">${icon('book')} Open § ${escapeHtml(sec)}</a>`);
  else if (partRef) out.push(`<a class="btn btn-sm btn-accent" href="${newsPartHref(partRef.title, partRef.part)}">${icon('book')} Open Part ${escapeHtml(String(partRef.part))}</a>`);
  return out.join('');
}


export function newsCardHtml(a, { hero = false } = {}) {
  const tag = hero ? 'section' : 'article';
  // The penalty figure is plain tabular text, never a statPill (pills mean sync state).
  const figure = a.penalty_usd ? `<span class="news-figure">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : '';
  const rows = (a.takeaways || []).map((t, i) => {
    const text = i === 0 && a.snippet ? newsSnippetHtml(a.snippet) : linkifyNewsText(t.text);
    return `<dt>${escapeHtml(t.label)}</dt><dd>${text}</dd>`;
  }).join('');
  return `
    <${tag} class="news-card${hero ? ' news-hero' : ''}" data-guid="${escapeHtml(a.guid)}" data-cat="${escapeHtml(a.category)}">
      <div class="news-card-top"><span class="news-kicker">${escapeHtml(newsKicker(a))}</span>${figure}</div>
      <h3 class="news-card-title">${extLink(a.link, escapeHtml(a.title))}</h3>
      ${newsBylineHtml(a)}
      ${rows ? `<dl class="news-takeaways">${rows}</dl>` : ''}
      ${newsChipsHtml(a)}
      <div class="news-card-foot">${newsActionsHtml(a)}</div>
    </${tag}>`;
}


export function newsTabsHtml(view, status) {
  const counts = (status && status.counts) || {};
  return `<div class="lib-seg news-tabs" role="tablist" aria-label="News categories">${NEWS_CATEGORIES.map(c => {
    const on = view.cat === c.key;
    const n = counts[c.key];
    return `<button type="button" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-pressed="${on}" data-news-cat="${c.key}">${escapeHtml(c.label)}${n ? ` <span class="news-tab-count">${n}</span>` : ''}</button>`;
  }).join('')}</div>`;
}


export function newsFilterChipsHtml(view) {
  const chips = [];
  const chip = (key, label) => chips.push(`<button type="button" class="news-filter-chip" data-news-act="clear-filter" data-filter-key="${key}" aria-label="Remove filter: ${escapeHtml(label)}">${escapeHtml(label)}<span aria-hidden="true"> ×</span></button>`);
  if (view.section) chip('section', `Citing § ${view.section}`);
  if (view.part) chip('part', `Citing Part ${view.part}`);
  if (view.state) chip('state', stateName(view.state));
  if (view.min_penalty) chip('min_penalty', `Over ${fmtMoney(Number(view.min_penalty))}`);
  if (view.gravity) chip('gravity', { W: 'Willful', R: 'Repeat', S: 'Serious' }[view.gravity]);
  return chips.length ? `<div class="news-filter-chips">${chips.join('')}</div>` : '';
}


export function newsFacetsHtml(view, status) {
  // Only on the Enforcement tab, and only with a DOL key: FR records have no state,
  // penalty or gravity, so the facets would just confuse other tabs.
  if (view.cat !== 'enforcement' || !status || !status.dol_configured) return '';
  const states = (newsState.facets && newsState.facets.states) || [];
  const sel = (v, cur) => v === cur ? ' selected' : '';
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


export function newsEmptyHtml(view, status) {
  const s = status || {};
  if (!s.sync_enabled && !(s.counts && s.counts.all)) {
    return `<div class="empty-state"><h2>News sync is off</h2>
      <p>Set <code>NEWS_SYNC=1</code> in <code>reader/.env</code> and restart FRAMEWORK.</p></div>`;
  }
  if (view.cat === 'enforcement' && !view.q && s && !s.dol_configured) {
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
      <p>${escapeHtml(failed.last_error)}</p>${retry}
      <button type="button" class="btn" data-news-act="refresh">Retry</button></div>`;
  }
  if (neverSynced) {
    return `<div class="empty-state">${statPill('busy', 'Fetching from the Federal Register…')}
      <p class="dr-note">The first sync takes a few seconds.</p></div>`;
  }
  return '<div class="empty-state"><h2>Nothing here yet</h2><p>No items in this view.</p></div>';
}


export function renderNews(view, data, status, opts = {}) {
  newsState.view = view;
  newsState.data = data;
  newsState.status = status;
  const articles = data.articles || [];
  // The lead hero: the newest Final Rule within 30 days on All, else the tab's newest.
  let hero = null;
  if (articles.length) {
    const fresh = (a) => (Date.now() - Date.parse(a.published_at + 'T00:00:00')) / 86400000 <= 30;
    hero = (view.cat === 'all' ? articles.find(a => a.category === 'rules' && fresh(a)) : null) || articles[0];
  }
  const feed = articles.filter(a => !hero || a.guid !== hero.guid);
  const more = data.total > articles.length
    ? `<div class="news-more"><button type="button" class="btn" data-news-act="more">Load more</button></div>` : '';

  // Keep the reader's place in the filter box across re-renders.
  const qEl = document.getElementById('news-q');
  const qFocus = qEl && document.activeElement === qEl
    ? { value: qEl.value, start: qEl.selectionStart, end: qEl.selectionEnd } : null;

  dom.view.innerHTML = `
    <div class="news-front">
      <div class="news-head">
        <div>
          <div class="doc-kicker">FRAMEWORK Newsroom · OSHA</div>
          <h1 class="doc-title">Regulatory News</h1>
        </div>
        <div class="news-head-status" id="news-head-status">${newsHeadStatusHtml(status)}</div>
      </div>
      ${newsBreakingHtml(articles)}
      <div class="news-bar">
        ${newsTabsHtml(view, status)}
        <input type="search" class="news-q" id="news-q" value="${escapeHtml(view.q)}"
          placeholder="Search news: keyword, company, § 1910.1030, 91 FR 55744" aria-label="Search news" autocomplete="off" spellcheck="false">
      </div>
      ${newsFilterChipsHtml(view)}
      ${newsFacetsHtml(view, status)}
      ${articles.length ? `
        ${hero ? newsCardHtml(hero, { hero: true }) : ''}
        <div class="news-grid" id="news-grid">${feed.map(a => newsCardHtml(a)).join('')}</div>
        ${more}` : newsEmptyHtml(view, status)}
    </div>`;
  if (opts.enter) enterView();
  if (qFocus) {
    const q = document.getElementById('news-q');
    if (q) {
      q.value = qFocus.value;
      q.focus();
      try { q.setSelectionRange(qFocus.start, qFocus.end); } catch (e) { /* type=search quirks */ }
    }
  }
}


export async function loadMoreNews() {
  const seq = state.routeSeq;
  const { view, data } = newsState;
  if (!view || !data) return;
  let page;
  try { page = await getJSON(newsApiUrl(view, data.articles.length)); } catch (e) { return; }
  if (seq !== state.routeSeq || newsState.data !== data) return;
  data.articles = data.articles.concat(page.articles || []);
  data.total = page.total;
  const grid = document.getElementById('news-grid');
  if (grid) {
    const shown = new Set([...dom.view.querySelectorAll('[data-guid]')].map(el => el.dataset.guid));
    grid.insertAdjacentHTML('beforeend',
      (page.articles || []).filter(a => !shown.has(a.guid)).map(a => newsCardHtml(a)).join(''));
  }
  const moreBtn = dom.view.querySelector('[data-news-act="more"]');
  if (moreBtn && data.articles.length >= data.total) moreBtn.closest('.news-more').remove();
}


// Delegated events for the whole newsroom (no inline handlers).
dom.view.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-news-cat]');
  if (tab && newsState.view) {
    setNewsView({ ...newsState.view, cat: tab.dataset.newsCat });
    return;
  }
  const act = e.target.closest('[data-news-act]');
  if (!act) return;
  const kind = act.dataset.newsAct;
  if (kind === 'refresh') refreshNewsCommand();
  else if (kind === 'reload') handleRoute();
  else if (kind === 'more') loadMoreNews();
  else if (kind === 'search-all') setNewsView({ ...newsState.view, cat: 'all' });
  else if (kind === 'clear-filter') {
    setNewsView({ ...newsState.view, [act.dataset.filterKey]: '' }, { replace: true });
  } else if (kind === 'expand-chips') {
    const row = act.closest('.news-chips');
    if (row) { row.classList.add('is-expanded'); act.remove(); }
  }
});

state.newsQTimer = null;

dom.view.addEventListener('input', (e) => {
  if (e.target.id !== 'news-q' || !newsState.view) return;
  clearTimeout(state.newsQTimer);
  const q = e.target.value.trim();
  state.newsQTimer = setTimeout(() => {
    if (newsState.view && q !== newsState.view.q) setNewsView({ ...newsState.view, q }, { replace: true });
  }, 250);
});

dom.view.addEventListener('keydown', (e) => {
  if (e.target.id === 'news-q' && e.key === 'Escape' && e.target.value) {
    e.target.value = '';
    if (newsState.view && newsState.view.q) setNewsView({ ...newsState.view, q: '' }, { replace: true });
    return;
  }
  const tab = e.target.closest && e.target.closest('.news-tabs [role="tab"]');
  if (!tab) return;
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const tabs = [...dom.view.querySelectorAll('.news-tabs [role="tab"]')];
  const i = tabs.indexOf(tab);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
});

dom.view.addEventListener('change', (e) => {
  const facet = e.target.closest && e.target.closest('[data-news-facet]');
  if (!facet || !newsState.view) return;
  setNewsView({ ...newsState.view, [facet.dataset.newsFacet]: facet.value }, { replace: true });
});
