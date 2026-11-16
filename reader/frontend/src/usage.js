import { state } from './state';
import { updateChatContext } from './components/chat';
import { clearTreeSelection } from './components/sidebar';
import { setViewHead } from './components/view_head';
import { enterView, escapeHtml, icon, lsGet, lsSet } from './dom';
import { dom } from './state_init';
import { findPartInTree } from './views/reader_part';

// --- Usage: what this reader has opened, kept in this browser only ---
// localStorage `usage` = { v, since, s: { "29|1910.1200": {n, t, l, h, p} }, p: { "29|1910": {n, t, h} } }
// A section visit counts toward its part too; opening a part page counts toward the part only.
// Title totals are the sum of their parts. The older per-title `visited` sets (which
// predate this) still drive "sections read", so that number has history from day one.
export const USAGE_KEY = 'usage';


export function loadUsage() {
  try {
    const u = JSON.parse(lsGet(USAGE_KEY) || 'null');
    if (u && u.v === 1 && u.s && u.p) return u;
  } catch (e) { /* corrupt or unavailable: start over */ }
  return { v: 1, since: Date.now(), s: {}, p: {} };
}


export function bumpPart(u, title, part, heading, now) {
  if (!part) return;
  const key = title + '|' + part;
  const e = u.p[key] || (u.p[key] = { n: 0 });
  e.n += 1;
  e.t = now;
  if (heading) e.h = String(heading).trim();
}


export function recordSectionVisit(data) {
  if (!data || !data.id) return;
  const u = loadUsage();
  const now = Date.now();
  const key = state.currentTitle + '|' + data.id;
  const e = u.s[key] || (u.s[key] = { n: 0 });
  e.n += 1;
  e.t = now;
  e.l = data.label || data.id;
  e.h = data.section_title || data.title_label || '';
  e.p = data.part || '';
  const partNode = data.part && state.treeData ? findPartInTree(state.treeData, data.part) : null;
  bumpPart(u, state.currentTitle, data.part, partNode && partNode.d, now);
  lsSet(USAGE_KEY, JSON.stringify(u));
}


export function recordPartVisit(partId, heading) {
  const u = loadUsage();
  bumpPart(u, state.currentTitle, partId, heading, Date.now());
  lsSet(USAGE_KEY, JSON.stringify(u));
}


export function visitedCountFor(title) {
  try {
    const raw = lsGet(title === 29 ? 'visited' : 'visited-' + title);
    return raw ? JSON.parse(raw).length : 0;
  } catch (e) { return 0; }
}


export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}


export const fmt = (n) => Number(n || 0).toLocaleString();

export const titleHref = (t, rest) => `#/title/${t}/${rest || ''}`;


// The FRAMEWORK home: one page across every installed title.
export function renderOverview() {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = 'FRAMEWORK';
  setViewHead('');

  const u = loadUsage();
  const titles = state.installedTitles.length ? state.installedTitles
    : [{ title: state.currentTitle, name: state.metaInfo.name || `Title ${state.currentTitle}`, section_count: state.metaInfo.section_count, edition: state.metaInfo.edition }];
  const nameOf = (t) => (titles.find(x => x.title === t) || {}).name || `Title ${t}`;
  const installed = new Set(titles.map(t => t.title));
  const split = (key) => { const i = key.indexOf('|'); return [parseInt(key.slice(0, i), 10), key.slice(i + 1)]; };

  // Entries gain `ti` (title number) and `id`; `t` stays the last-visit time.
  // Only titles still installed count (a removed title's history stays stored but hidden).
  const entries = (map) => Object.entries(map).map(([k, e]) => { const [ti, id] = split(k); return { ...e, ti, id }; })
    .filter(e => installed.has(e.ti));
  const sections = entries(u.s);
  const parts = entries(u.p);

  const byTitle = new Map();
  for (const p of parts) byTitle.set(p.ti, (byTitle.get(p.ti) || 0) + p.n);
  const totalVisits = [...byTitle.values()].reduce((a, b) => a + b, 0);
  const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
  const readByTitle = new Map(titles.map(t => [t.title, visitedCountFor(t.title)]));
  const totalRead = [...readByTitle.values()].reduce((a, b) => a + b, 0);
  const recent = [...sections].sort((a, b) => b.t - a.t);
  const last = recent[0];

  const sectionLink = (e, inner) => `<a class="ov-row" href="${titleHref(e.ti, 'section/' + encodeURIComponent(e.id))}">${inner}</a>`;
  const tag = (t) => `<span class="ov-tag" title="${escapeHtml(nameOf(t))}">${t} CFR</span>`;
  const secNum = (e) => escapeHtml(String(e.l).replace(/^§\s*/, ''));

  // Three 2:3 cards across the top: the most visited titles, each with its four most read
  // sections. Titles nobody has opened yet fill any empty slots, in title order.
  const ranked = [...titles].sort((a, b) => (byTitle.get(b.title) || 0) - (byTitle.get(a.title) || 0) || a.title - b.title).slice(0, 3);
  const topCards = `
    <div class="ov-cards">
      ${ranked.map(t => {
        const n = byTitle.get(t.title) || 0;
        const read = readByTitle.get(t.title) || 0;
        const top = sections.filter(e => e.ti === t.title).sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 4);
        const share = totalVisits ? Math.round(n / totalVisits * 100) : 0;
        return `
          <article class="ov-card">
            <a class="ov-card-head" href="${titleHref(t.title)}">
              <span class="ov-card-kicker">Title</span>
              <span class="ov-card-num">${t.title}</span>
              <span class="ov-card-name">${escapeHtml(t.name)}</span>
              <span class="ov-card-meta">${n ? `${fmt(n)} ${n === 1 ? 'visit' : 'visits'} · ${share}%` : 'Not opened yet'}<span class="sep" aria-hidden="true">·</span>${fmt(read)} of ${fmt(t.section_count)} read</span>
            </a>
            <div class="ov-card-foot">
              <div class="ov-card-label">Most read</div>
              ${top.length ? top.map(e => sectionLink(e, `
                <span class="ov-row-num">${secNum(e)}</span>
                <span class="ov-row-text">${escapeHtml(e.h)}</span>
                <span class="ov-row-val">${fmt(e.n)}</span>`)).join('')
                : `
                <div class="ov-card-empty">
                  <svg class="ov-card-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                  <div class="ov-card-empty-text">No sections read yet</div>
                  <a class="ov-card-empty-link" href="${titleHref(t.title)}">Start reading Title ${t.title} →</a>
                </div>`}
            </div>
          </article>`;
      }).join('')}
    </div>`;

  // Thin bars scaled to the panel's largest value, as in Linear's insights.
  const barList = (rows, max) => rows.map(r => `
    <a class="ov-row ov-bar-row" href="${r.href}">
      ${r.ti ? tag(r.ti) : ''}<span class="ov-row-num">${escapeHtml(r.num)}</span>
      <span class="ov-row-text">${escapeHtml(r.text)}</span>
      <span class="ov-row-val">${escapeHtml(r.val)}</span>
      <span class="ov-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round(r.value / max * 100))}%"></span></span>
    </a>`).join('');

  const titleRows = titles.map(t => ({ t: t.title, n: byTitle.get(t.title) || 0 }))
    .filter(r => r.n).sort((a, b) => b.n - a.n)
    .map(r => ({
      href: titleHref(r.t), num: String(r.t), text: nameOf(r.t), value: r.n,
      val: `${Math.round(r.n / totalVisits * 100)}%`,
    }));
  const topParts = [...parts].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 5);
  const partRows = topParts.map(p => ({
    href: titleHref(p.ti, 'part/' + encodeURIComponent(p.id)), num: p.id, text: p.h || `Part ${p.id}`,
    value: p.n, val: fmt(p.n), ti: p.ti,
  }));
  const topSections = [...sections].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 5);

  const metric = (label, value, sub, href) => {
    const inner = `<div class="ov-metric-label">${label}</div><div class="ov-metric-value">${value}</div><div class="ov-metric-sub">${sub}</div>`;
    return href ? `<a class="ov-metric is-link" href="${href}">${inner}</a>` : `<div class="ov-metric">${inner}</div>`;
  };

  const metrics = `
    <div class="ov-metrics">
      ${metric('Titles installed', fmt(titles.length), escapeHtml(titles.map(t => t.title).join(' · ')))}
      ${metric('Sections read', fmt(totalRead), `of ${fmt(totalSections)}`)}
      ${metric('Visits', fmt(totalVisits), `since ${escapeHtml(new Date(u.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}`)}
      ${last
        ? metric('Last read', escapeHtml(last.l), `${last.ti} CFR · ${escapeHtml(timeAgo(last.t))}`, titleHref(last.ti, 'section/' + encodeURIComponent(last.id)))
        : metric('Last read', '—', 'Nothing yet')}
    </div>`;

  const panel = (heading, body) => `<section class="ov-panel"><h2 class="ov-h">${heading}</h2><div class="ov-list">${body}</div></section>`;

  const activity = !sections.length && !parts.length ? `
    <div class="ov-empty">
      <div class="ov-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      </div>
      <div class="ov-empty-title">Nothing read yet</div>
      <p>Your most visited titles, parts and sections will show up here as you read. Pick a title below to start.</p>
    </div>` : `
    <div class="ov-grid">
      ${panel('Most visited titles', barList(titleRows, titleRows.length ? titleRows[0].value : 1))}
      ${panel('Most visited parts', barList(partRows, partRows.length ? partRows[0].value : 1) || '<div class="ov-none"><svg class="ov-none-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h12M2 8h8M2 12h5"/></svg><span>No parts yet</span></div>')}
      ${panel('Most visited sections', topSections.map(e => sectionLink(e, `
        ${tag(e.ti)}<span class="ov-row-num">${secNum(e)}</span>
        <span class="ov-row-text">${escapeHtml(e.h)}</span>
        <span class="ov-row-val">${fmt(e.n)}</span>`)).join('') || '<div class="ov-none"><svg class="ov-none-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h12M2 8h8M2 12h5"/></svg><span>No sections yet</span></div>')}
      ${panel('Recently read', recent.slice(0, 5).map(e => sectionLink(e, `
        ${tag(e.ti)}<span class="ov-row-num">${secNum(e)}</span>
        <span class="ov-row-text">${escapeHtml(e.h)}</span>
        <span class="ov-row-val">${escapeHtml(timeAgo(e.t))}</span>`)).join('') || '<div class="ov-none"><svg class="ov-none-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h12M2 8h8M2 12h5"/></svg><span>No sections yet</span></div>')}
    </div>`;

  const table = `
    <section class="ov-panel ov-titles">
      <div class="ov-panel-head">
        <h2 class="ov-h">Installed titles</h2>
        <a class="btn btn-sm btn-download" href="#/library" title="Download titles, parts or sections from eCFR">${icon('download')} Download</a>
      </div>
      <div class="ov-table" role="table" aria-label="Installed titles">
        <div class="ov-tr ov-thead" role="row">
          <span role="columnheader">Title</span><span role="columnheader">Name</span>
          <span role="columnheader" class="num">Sections</span><span role="columnheader" class="num">Read</span>
          <span role="columnheader" class="num">Edition</span>
        </div>
        ${titles.map(t => {
          const read = readByTitle.get(t.title) || 0;
          const count = Number(t.section_count || 0);
          const pct = count ? read / count * 100 : 0;
          const pctText = !read ? '—' : pct < 0.1 ? '<0.1%' : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
          return `
            <a class="ov-tr" role="row" href="${titleHref(t.title)}">
              <span role="cell" class="ov-title-num">${t.title}</span>
              <span role="cell" class="ov-title-name">${escapeHtml(t.name)}${t.partial ? '<span class="ov-partial">Partial</span>' : ''}</span>
              <span role="cell" class="num">${fmt(count)}</span>
              <span role="cell" class="num" title="${fmt(read)} of ${fmt(count)} sections">${pctText}</span>
              <span role="cell" class="num muted">${escapeHtml(t.edition || '—')}</span>
            </a>`;
        }).join('')}
      </div>
    </section>`;

  dom.view.innerHTML = `
    <div class="ov">
      <div class="ov-head">
        <h1>Overview</h1>
        <p>Your reading across ${titles.length === 1 ? 'one installed title' : `${fmt(titles.length)} installed titles`}. Kept in this browser only.</p>
      </div>
      ${topCards}
      ${metrics}
      ${activity}
      ${table}
    </div>
  `;
  enterView();
}
