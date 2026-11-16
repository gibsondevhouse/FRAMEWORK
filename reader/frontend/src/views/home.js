import { state } from '../state';
import { HOME_PROMPTS, launchChatPrompt, updateChatContext } from '../components/chat';
import { clearTreeSelection, plural, switchTitle } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, isMac } from '../dom';
import { openPanel, routeTarget } from '../nav';
import { navLib } from '../panels/library_panel';
import { dom } from '../state_init';
import { fmt, loadUsage, timeAgo, titleHref, visitedCountFor } from '../usage';
import { HOME_CONTENT } from '../views/core';
import { SEP, fmtDate, getJSON, isStale, joinSep, shortDate, statPill } from '../views/library';
import {
  fmtMoney, lsGetJSON, lsSetJSON, newsKicker, newsPartHref, newsSectionHref,
  newsStatusPillHtml, refreshNewsCommand, titleInstalled,
} from '../views/news';
import { loadProjects, projDot, startNewWorkspace } from '../views/projects';

// --- Home (#/): actionable launchpad across reader, workspaces, news, Claude, and library ---

const HOME_NEWS_CACHE = 'newsCache:v1:all';
const HOME_STATUS_CACHE = 'newsCache:v1:status';
const CITE_JUMP_RE = /^(?:(\d+)\s*c\.?f\.?r\.?\s*)?(?:§§?\s*)?(\d{1,4}\.\d+[a-z0-9-]*)$/i;


function installedList() {
  if (state.installedTitles.length) return state.installedTitles;
  if (state.metaInfo.edition) {
    return [{
      title: state.currentTitle,
      name: state.metaInfo.name || `Title ${state.currentTitle}`,
      section_count: state.metaInfo.section_count,
      edition: state.metaInfo.edition,
    }];
  }
  return [];
}


function sectionLinkHref(e) {
  return titleHref(e.ti, 'section/' + encodeURIComponent(e.id) + (e.u ? '/' + encodeURIComponent(e.u) : ''));
}


function activeTransfersHtml() {
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


function resumeCardHtml(recent, titles) {
  if (recent.length) {
    const last = recent[0];
    const href = sectionLinkHref(last);
    const trail = recent.slice(1, 4);
    return `
      <section class="hm-card hm-resume" aria-label="Continue reading">
        <div class="hm-card-top">
          <span class="hm-kicker">Continue reading</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t))}</span>
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
          <button type="button" class="btn btn-sm" data-hm-act="open-contents" data-title="${last.ti}">${icon('book')} Contents</button>
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
                  <span class="hm-row-val">${escapeHtml(timeAgo(e.t))}</span>
                </a>`).join('')}
            </div>
          </div>` : ''}
      </section>`;
  }

  const starters = [];
  for (const t of titles) {
    const c = HOME_CONTENT[t.title];
    if (!c) continue;
    for (const card of c.cards.slice(0, 2)) {
      starters.push({ ti: t.title, part: card.part, kicker: card.kicker, title: card.title });
      if (starters.length >= 4) break;
    }
    if (starters.length >= 4) break;
  }

  return `
    <section class="hm-card hm-resume" aria-label="Start reading">
      <div class="hm-card-top">
        <span class="hm-kicker">Start reading</span>
      </div>
      <div class="hm-resume-title is-static">Jump into your installed regulations</div>
      <p class="hm-muted">Open a key part below, search by section number, or browse the table of contents.</p>
      ${starters.length ? `
        <div class="hm-starter-grid">
          ${starters.map(s => `
            <a class="hm-starter" href="${titleHref(s.ti, 'part/' + encodeURIComponent(s.part))}">
              <span class="hm-starter-kicker">${s.ti} CFR${SEP}${escapeHtml(s.kicker)}</span>
              <span class="hm-starter-name">${escapeHtml(s.title)}</span>
            </a>`).join('')}
        </div>` : ''}
      <div class="hm-resume-acts">
        <button type="button" class="btn btn-sm btn-accent" data-hm-act="open-contents" data-title="${state.currentTitle}">${icon('book')} Browse Contents</button>
        <a class="btn btn-sm" href="${titleHref(state.currentTitle)}">Title ${state.currentTitle} start</a>
      </div>
    </section>`;
}


function quickLaunchHtml(last) {
  const configured = state.chatConfig && state.chatConfig.configured;
  const chatError = state.chatConfig && state.chatConfig.error;

  let claudeBody = '';
  if (configured && !chatError) {
    const basePrompts = HOME_PROMPTS[state.currentTitle] || [
      'What does this title cover, at a high level?',
      'What are the most important definitions in this title?',
      'Find the penalty and enforcement provisions in this title.',
    ];
    const prompts = last
      ? [`Summarize the key duties and exceptions in ${last.l}`, ...basePrompts.slice(0, 2)]
      : basePrompts.slice(0, 3);
    claudeBody = `
      <div class="hm-prompts">
        ${prompts.map(p => `<button type="button" class="hm-prompt-btn" data-hm-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
      </div>`;
  } else if (chatError) {
    claudeBody = `
      <p class="hm-muted">${escapeHtml(chatError)}</p>
      <div class="hm-claude-acts">
        <a class="btn btn-sm" href="#/help">${icon('help')} Check connection</a>
      </div>`;
  } else {
    claudeBody = `
      <p class="hm-muted">Ask questions, summarize provisions, or draft compliance checklists grounded in your local CFR text.</p>
      <div class="hm-claude-acts">
        <button type="button" class="btn btn-sm" data-open-env="anthropic_api_key">${icon('key')} Connect Claude</button>
        <a class="btn btn-sm" href="#/help">Setup guide</a>
      </div>`;
  }

  return `
    <section class="hm-card hm-launch" aria-label="Quick jump and Claude">
      <div class="hm-card-top">
        <span class="hm-kicker">Quick jump &amp; search</span>
        <kbd aria-hidden="true">/</kbd>
      </div>
      <form class="hm-jump-form" id="hm-jump-form">
        <div class="hm-jump-wrap">
          ${icon('search')}
          <input id="hm-jump-input" class="hm-jump-input" type="search"
            placeholder="Jump to § 1910.1200 or search all titles…"
            aria-label="Jump to section or search all installed titles" autocomplete="off" spellcheck="false">
        </div>
        <button type="submit" class="btn btn-sm">Go</button>
      </form>
      <div class="hm-quick-links">
        <button type="button" class="hm-chip-btn" data-hm-act="open-contents">${icon('book')} Contents</button>
        <button type="button" class="hm-chip-btn" data-hm-act="open-palette">${icon('list')} Commands</button>
        <a class="hm-chip-btn" href="#/help">${icon('key')} Connections</a>
      </div>
      <div class="hm-claude">
        <div class="hm-claude-head">
          <span class="hm-claude-title">${icon('sparkle', 'icon-accent')} Ask Claude</span>
          <span class="hm-claude-state">${configured && !chatError ? 'Ready' : chatError ? 'Unavailable' : 'Optional'}</span>
        </div>
        ${claudeBody}
      </div>
    </section>`;
}


function workspacesCardHtml(projects) {
  const sorted = [...projects].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 4);
  const body = sorted.length ? `
    <div class="hm-ws-list">
      ${sorted.map(p => {
        const chips = (p.sections || []).slice(0, 3).map(s => {
          const ok = titleInstalled(s.title);
          const href = ok ? `#/title/${s.title}/section/${encodeURIComponent(s.id)}` : `#/library/${s.title}`;
          const tip = ok ? '' : ` title="Title ${s.title} isn’t installed. Open the library"`;
          return `<a class="citation-chip${ok ? '' : ' is-dim'}" href="${href}"${tip}>${escapeHtml(s.label || '§ ' + s.id)}</a>`;
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
      <p class="hm-muted">Group pinned regulations and notes for a safety program, facility audit, or permit review.</p>
      <div class="hm-empty-acts">
        <button type="button" class="btn btn-sm btn-accent" data-hm-act="new-workspace">${icon('plus')} New workspace</button>
        <button type="button" class="btn btn-sm" data-proj-act="import">Import JSON</button>
      </div>
      <p class="hm-empty-tip">Tip: Press <kbd>${isMac ? '⌘' : 'Ctrl '}D</kbd> while reading any section to pin it to a workspace.</p>
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


function pulseChipsHtml(a) {
  const chips = [];
  for (const r of (a.cfr_parts || []).slice(0, 2)) {
    const ok = titleInstalled(r.title);
    chips.push(`<a class="citation-chip${ok ? '' : ' is-dim'}" href="${newsPartHref(r.title, r.part)}">${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
  }
  for (const s of (a.sections || []).slice(0, Math.max(0, 3 - chips.length))) {
    const ok = titleInstalled(29);
    chips.push(`<a class="citation-chip${ok ? '' : ' is-dim'}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`);
  }
  return chips.length ? `<div class="hm-news-chips">${chips.join('')}</div>` : '';
}


function newsCardBodyHtml(data, status) {
  const articles = (data && data.articles) || [];
  if (!articles.length) {
    return `
      <div class="hm-empty-block">
        <div class="hm-empty-title">No local OSHA news yet</div>
        <p class="hm-muted">Check the Federal Register feed or open Newsroom to inspect rulemaking and enforcement activity.</p>
        <div class="hm-empty-acts">
          <button type="button" class="btn btn-sm" data-hm-act="refresh-news">Check news</button>
          <a class="btn btn-sm" href="#/news">Open Newsroom</a>
        </div>
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
  const dolFoot = status && !status.dol_configured
    ? `<div class="hm-news-foot"><span>DOL inspection sync is off</span>${SEP}<button type="button" class="hm-inline-link" data-open-env="dol_api_key">Add free DOL key</button></div>`
    : '';
  return `<div class="hm-news-list">${items}</div>${dolFoot}`;
}


function newsPanelHtml(cachedData, cachedStatus) {
  const pill = newsStatusPillHtml(cachedStatus);
  return `
    <section class="hm-card hm-news" id="hm-news" aria-label="Regulatory Pulse">
      <div class="hm-panel-head">
        <h2 class="hm-panel-title">${icon('news')} Regulatory Pulse</h2>
        <div class="hm-panel-acts">
          <span id="hm-news-pill">${pill}</span>
          <a class="hm-inline-link" href="#/news">Newsroom</a>
        </div>
      </div>
      <div id="hm-news-body">${newsCardBodyHtml(cachedData, cachedStatus)}</div>
    </section>`;
}


function titlesBandHtml(titles, readByTitle, totalSections, totalRead) {
  const staleSet = new Set(((navLib.data && navLib.data.titles) || []).filter(isStale).map(t => t.title));
  const cards = titles.map(t => {
    const read = readByTitle.get(t.title) || 0;
    const count = Number(t.section_count || 0);
    const pct = count ? Math.min(100, read / count * 100) : 0;
    const pctText = !read ? '' : pct < 0.1 ? '<0.1%' : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
    const parts = ((HOME_CONTENT[t.title] || {}).cards || []).slice(0, 3);
    const status = t.partial ? statPill('partial', 'Partial', { bare: true })
      : staleSet.has(t.title) ? statPill('stale', 'Update available', { bare: true })
      : `<span class="hm-title-ed">${escapeHtml(shortDate(t.edition) || 'Local')}</span>`;

    return `
      <article class="hm-title-card">
        <div class="hm-title-top">
          <span class="hm-title-kicker">${t.title} CFR</span>
          ${status}
        </div>
        <h3 class="hm-title-name"><a href="${titleHref(t.title)}">${escapeHtml(t.name)}</a></h3>
        <div class="hm-title-prog">
          <span>${fmt(count)} sections${SEP}${read ? `${fmt(read)} read (${pctText})` : 'Not started'}</span>
          <div class="hm-prog-track" aria-hidden="true"><span style="width:${read ? Math.max(2, Math.round(pct)) : 0}%"></span></div>
        </div>
        ${parts.length ? `
          <div class="hm-title-parts">
            ${parts.map(c => {
              const label = c.title.replace(/^Part\s+\d+\s*[—–-]\s*/, '');
              return `<a class="hm-part-chip" href="${titleHref(t.title, 'part/' + encodeURIComponent(c.part))}"><span class="hm-part-num">${escapeHtml(c.part)}</span><span>${escapeHtml(label)}</span></a>`;
            }).join('')}
          </div>` : ''}
        <div class="hm-title-acts">
          <a class="lib-act" href="${titleHref(t.title)}">Title start</a>
          <button type="button" class="lib-act" data-hm-act="open-contents" data-title="${t.title}">Contents</button>
          ${t.partial ? `<a class="lib-act" href="#/library/${t.title}">Complete</a>` : staleSet.has(t.title) ? '<a class="lib-act" href="#/library">Update</a>' : ''}
        </div>
      </article>`;
  }).join('');

  return `
    <section class="hm-titles" aria-label="Installed titles">
      <div class="hm-sec-head">
        <div class="hm-sec-head-left">
          <h2 class="hm-sec-title">Installed Titles</h2>
          <span class="hm-sec-meta">${joinSep([plural(titles.length, 'title'), `${fmt(totalSections)} sections`, totalRead ? `${fmt(totalRead)} read` : ''])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Browse all 50 titles ${icon('chevronRight')}</a>
      </div>
      <div class="hm-title-grid">${cards}</div>
    </section>`;
}


async function hydrateHomeNews(seq) {
  const box = document.getElementById('hm-news');
  if (!box) return;
  try {
    const [data, status] = await Promise.all([
      getJSON('/api/news?limit=4'),
      getJSON('/api/news/status'),
    ]);
    if (seq !== state.routeSeq) return;
    const currentBox = document.getElementById('hm-news');
    if (!currentBox) return;
    const body = document.getElementById('hm-news-body');
    const pill = document.getElementById('hm-news-pill');
    if (body) body.innerHTML = newsCardBodyHtml(data, status);
    if (pill) pill.innerHTML = newsStatusPillHtml(status);
    if (data && data.articles && data.articles.length) {
      lsSetJSON(HOME_NEWS_CACHE, { t: Date.now(), data: { articles: data.articles.slice(0, 30), total: data.total, offset: 0 } });
    }
    if (status) lsSetJSON(HOME_STATUS_CACHE, { t: Date.now(), data: status });
  } catch (e) {
    /* keep cached news or empty state quietly */
  } finally {
    const el = document.getElementById('hm-news');
    if (el && seq === state.routeSeq) el.dataset.newsLoaded = '1';
  }
}


export function renderHomeScreen({ enter = true } = {}) {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = 'Home · FRAMEWORK';
  setViewHead('');

  const u = loadUsage();
  const titles = installedList();
  const installed = new Set(titles.map(t => t.title));
  const split = (key) => { const i = key.indexOf('|'); return [parseInt(key.slice(0, i), 10), key.slice(i + 1)]; };
  const sections = Object.entries(u.s)
    .map(([k, e]) => { const [ti, id] = split(k); return { ...e, ti, id }; })
    .filter(e => installed.has(e.ti));
  const recent = [...sections].sort((a, b) => (b.t || 0) - (a.t || 0));
  const last = recent[0] || null;

  const projects = loadProjects();
  const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
  const readByTitle = new Map(titles.map(t => [t.title, visitedCountFor(t.title)]));
  const totalRead = [...readByTitle.values()].reduce((a, b) => a + b, 0);

  const cachedNews = lsGetJSON(HOME_NEWS_CACHE);
  const cachedStatus = lsGetJSON(HOME_STATUS_CACHE);
  const sub = joinSep([
    escapeHtml(plural(titles.length, 'installed title')),
    projects.length ? escapeHtml(plural(projects.length, 'workspace')) : '',
    state.metaInfo.edition ? `eCFR ${escapeHtml(shortDate(state.metaInfo.edition))}` : '',
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
          <a class="btn btn-sm" href="#/library">${icon('download')} Library</a>
        </div>
      </header>
      ${activeTransfersHtml()}
      <div class="hm-hero">
        ${resumeCardHtml(recent, titles)}
        ${quickLaunchHtml(last)}
      </div>
      <div class="hm-mid">
        ${workspacesCardHtml(projects)}
        ${newsPanelHtml(cachedNews && cachedNews.data, cachedStatus && cachedStatus.data)}
      </div>
      ${titlesBandHtml(titles, readByTitle, totalSections, totalRead)}
    </div>`;

  if (enter) enterView();
  else dom.main.scrollTop = scrollTop;
  hydrateHomeNews(state.routeSeq);
}


export function refreshHomeIfActive() {
  if (routeTarget() === 'overview' && dom.view.querySelector('.hm')) {
    renderHomeScreen({ enter: false });
  }
}


// --- Delegated Home interactions ---

dom.view.addEventListener('click', async (e) => {
  if (!dom.view.querySelector('.hm')) return;
  const promptBtn = e.target.closest('[data-hm-prompt]');
  if (promptBtn) {
    launchChatPrompt(promptBtn.dataset.hmPrompt, { submit: true });
    return;
  }
  const actEl = e.target.closest('[data-hm-act]');
  if (!actEl) return;
  const act = actEl.dataset.hmAct;
  if (act === 'new-workspace') {
    startNewWorkspace();
  } else if (act === 'open-history') {
    state.historyFor = 'overview';
    openPanel('history', { focus: e.detail === 0 });
  } else if (act === 'open-contents') {
    const t = Number(actEl.dataset.title);
    if (t && t !== state.currentTitle) await switchTitle(t);
    openPanel('reader', { focus: true });
  } else if (act === 'open-palette') {
    dom.search.value = '>';
    dom.search.focus();
    dom.search.dispatchEvent(new Event('input'));
  } else if (act === 'refresh-news') {
    await refreshNewsCommand();
    hydrateHomeNews(state.routeSeq);
  }
});


dom.view.addEventListener('submit', async (e) => {
  if (e.target.id !== 'hm-jump-form') return;
  e.preventDefault();
  const input = document.getElementById('hm-jump-input');
  const q = (input && input.value || '').trim();
  if (!q) {
    dom.search.focus();
    return;
  }
  if (q.startsWith('>')) {
    dom.search.value = q;
    dom.search.focus();
    dom.search.dispatchEvent(new Event('input'));
    return;
  }
  const cite = CITE_JUMP_RE.exec(q);
  if (cite) {
    const targetTitle = cite[1] ? Number(cite[1]) : null;
    const secId = cite[2];
    const searchTitle = targetTitle && titleInstalled(targetTitle) ? String(targetTitle) : 'all';
    try {
      const data = await getJSON(`/api/search?q=${encodeURIComponent(secId)}&title=${searchTitle}&limit=1`);
      const hit = data && data.results && data.results[0];
      if (hit && String(hit.id).toLowerCase() === secId.toLowerCase()) {
        window.location.hash = `#/title/${hit.title || state.currentTitle}/section/${encodeURIComponent(hit.id)}`;
        return;
      }
    } catch (err) { /* fall back to full search page */ }
  }
  const scope = state.installedTitles.length > 1 ? '&scope=all' : '';
  window.location.hash = `#/search?q=${encodeURIComponent(q)}${scope}`;
});
