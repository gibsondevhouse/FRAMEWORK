// Title 29 Reader frontend application
(function () {
  'use strict';

  // --- State ---
  let currentTitle = 29;
  let installedTitles = [];
  let treeData = null;
  let currentSection = null;
  let currentPart = null;
  let activeRoute = '';
  let metaInfo = {};
  let chatConfig = { configured: false, models: [], default: null };
  let chatHistory = [];
  let isGenerating = false;
  // Bumped on every route change. A loader that awaited the network checks it before painting,
  // so a slow page can't land on top of the one the reader has since moved to.
  let routeSeq = 0;

  // Cache DOM
  const dom = {
    topbar: document.querySelector('.topbar'),
    titleSelect: document.getElementById('title-select'),
    titlePop: document.getElementById('title-pop'),
    navToggle: document.getElementById('nav-toggle'),
    search: document.getElementById('search'),
    searchDropdown: document.getElementById('search-dropdown'),
    edition: document.getElementById('edition'),
    themeToggle: document.getElementById('theme-toggle'),
    chatToggle: document.getElementById('chat-toggle'),
    layout: document.getElementById('layout'),
    sidebar: document.getElementById('sidebar'),
    sidebarResizer: document.getElementById('sidebar-resizer'),
    navBackdrop: document.getElementById('nav-backdrop'),
    treeFilter: document.getElementById('tree-filter'),
    tree: document.getElementById('tree'),
    main: document.getElementById('main'),
    view: document.getElementById('view'),
    viewHead: document.getElementById('view-head'),
    chat: document.getElementById('chat'),
    modelSelect: document.getElementById('model-select'),
    chatNew: document.getElementById('chat-new'),
    chatClose: document.getElementById('chat-close'),
    chatContext: document.getElementById('chat-context'),
    contextToggle: document.getElementById('context-toggle'),
    contextLabel: document.getElementById('context-label'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatText: document.getElementById('chat-text'),
    chatSend: document.getElementById('chat-send'),
    askFloat: document.getElementById('ask-float'),
    toast: document.getElementById('toast'),
  };

  // --- Helpers ---
  function showToast(msg, duration = 3000) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    clearTimeout(dom.toast._t);
    dom.toast._t = setTimeout(() => { dom.toast.hidden = true; }, duration);
  }

  function renderMarkdown(md) {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(marked.parse(md));
    }
    return escapeHtml(md);
  }

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable (private mode, quota) */ }
  }

  function isMobile() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  // Inline icons (16px grid, stroked with currentColor; styled by `.icon` in styles.css).
  const ICON_PATHS = {
    sparkle: '<path d="M8 2.25 9.35 6.65 13.75 8 9.35 9.35 8 13.75 6.65 9.35 2.25 8 6.65 6.65Z"/>',
    external: '<path d="M6.5 3.5h-2A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5v-2"/><path d="M9.5 3H13v3.5M13 3 7.5 8.5"/>',
    link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2A2.6 2.6 0 0 0 9 3.3l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9A2.6 2.6 0 0 0 7 12.7l.9-.9"/>',
    expand: '<path d="M9.5 2.75h3.75V6.5M6.5 13.25H2.75V9.5M13.25 2.75 9 7M2.75 13.25 7 9"/>',
    stack: '<rect x="2.75" y="2.75" width="10.5" height="4.25" rx="1.25"/><rect x="2.75" y="9" width="10.5" height="4.25" rx="1.25"/>',
    chevronLeft: '<path d="m9.5 4.5-3.5 3.5 3.5 3.5"/>',
    chevronDown: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
    chevronRight: '<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>',
    download: '<path d="M8 2.75v7.5M4.75 7 8 10.25 11.25 7"/><path d="M3 12.75h10"/>',
    check: '<path d="m3.75 8.25 2.75 2.75 5.75-6"/>',
    list: '<circle cx="3" cy="4" r=".6" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".6" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".6" fill="currentColor" stroke="none"/><path d="M6 4h7.5M6 8h7.5M6 12h7.5"/>',
    book: '<path d="M2.5 12.5A1.5 1.5 0 0 1 4 11h9.5"/><path d="M4 2.5h9.5v11H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 2.5Z"/>',
    file: '<path d="M9 2.5H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5L9 2.5Z"/><path d="M9 2.5V6.5H13"/>',
  };
  function icon(name, extraClass = '') {
    return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  }

  // A short fade-and-rise each time the main view is replaced.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function enterView() {
    dom.main.scrollTop = 0;
    if (reduceMotion.matches || !dom.view.animate) return;
    dom.view.animate(
      [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
      { duration: 180, easing: 'cubic-bezier(.25, .46, .45, .94)' }
    );
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

  // --- Router ---
  function parseHash() {
    const hash = window.location.hash || '#/';
    const [pathPart, queryPart] = hash.slice(1).split('?');
    const params = new URLSearchParams(queryPart || '');
    return { path: pathPart || '/', params };
  }

  async function handleRoute() {
    const { path, params } = parseHash();
    activeRoute = path;
    const seq = ++routeSeq;

    // Close mobile nav on route change
    document.body.classList.remove('nav-open');

    let checkPath = path;
    const titleMatch = path.match(/^\/title\/(\d+)(\/.*)?$/);
    if (titleMatch) {
      const targetTitle = parseInt(titleMatch[1], 10);
      if (targetTitle && targetTitle !== currentTitle) {
        await switchTitle(targetTitle);
        if (seq !== routeSeq) return;
      }
      checkPath = titleMatch[2] || '/';
    }

    if (checkPath === '/' || checkPath === '') {
      // `#/` is the FRAMEWORK overview across every title; `#/title/N/` is that title's start page.
      if (titleMatch) renderHome();
      else renderOverview();
    } else if (checkPath.startsWith('/section/')) {
      // /section/{id}, /section/{id}/{unit}, /section/{id}/full. Ids never contain "/".
      const rest = checkPath.slice('/section/'.length);
      const slash = rest.indexOf('/');
      const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
      const sectionId = decode(slash < 0 ? rest : rest.slice(0, slash));
      const view = slash < 0 ? null : decode(rest.slice(slash + 1)) || null;
      await loadSection(sectionId, params, view);
    } else if (checkPath.startsWith('/part/')) {
      const rest = checkPath.replace('/part/', '');
      // `/part/{id}` is the section index; `/part/{id}/full` is every section's text in order.
      const fullMatch = rest.match(/^(.+?)\/full$/);
      if (fullMatch) await loadPartFull(fullMatch[1], params);
      else await loadPart(rest);
    } else if (checkPath === '/library' || checkPath.startsWith('/library/')) {
      // /library, /library/{title}, /library/{title}/part/{part}
      const m = /^\/library(?:\/(\d+)(?:\/part\/(.+))?)?\/?$/.exec(checkPath);
      if (!m) renderNotFound();
      else {
        const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
        await loadLibrary(m[1] ? parseInt(m[1], 10) : null, m[2] ? decode(m[2]) : null);
      }
    } else if (checkPath.startsWith('/search')) {
      const q = params.get('q') || '';
      dom.search.value = q;
      await loadSearchPage(q, params.get('scope'));
    } else {
      renderNotFound();
    }
  }

  window.addEventListener('hashchange', handleRoute);

  // --- Views ---

  // Curated starting points per installed title. Titles without an entry get the generic hero.
  const HOME_CONTENT = {
    29: {
      tagline: 'Federal labor regulations — workplace safety, wages and hours, leave, and employee benefits — with local search and Claude.',
      cards: [
        { part: '1910', kicker: 'OSHA Safety', title: 'Part 1910 — General Industry', desc: 'PPE, hazard communication, walking-working surfaces, fire protection, and machinery.' },
        { part: '1926', kicker: 'OSHA Safety', title: 'Part 1926 — Construction', desc: 'Scaffolds, fall protection, cranes, excavations, and electrical safety on sites.' },
        { part: '541', kicker: 'Wage & Hour', title: 'Part 541 — Overtime Exemptions', desc: 'Executive, administrative, professional, computer, and outside sales exemptions (FLSA).' },
        { part: '825', kicker: 'Leave & Family', title: 'Part 825 — Family & Medical Leave', desc: 'FMLA employee eligibility, employer notice obligations, leave duration, and certification.' },
        { part: '1904', kicker: 'Recordkeeping', title: 'Part 1904 — Injury Recording', desc: 'Recording and reporting occupational injuries, illnesses, and severe incidents.' },
        { part: '2560', kicker: 'Employee Benefits', title: 'Part 2560 — ERISA Administration', desc: 'Claims procedures, participant remedies, and retirement plan fiduciaries.' },
      ],
    },
    40: {
      tagline: 'EPA regulations — air and water quality, hazardous waste, permits, and chemical releases — with local search and Claude.',
      cards: [
        { part: '50', kicker: 'Air', title: 'Part 50 — Air Quality Standards', desc: 'National ambient air quality standards (NAAQS) for ozone, particulates, lead, and more.' },
        { part: '70', kicker: 'Air Permits', title: 'Part 70 — Operating Permits', desc: 'State operating permit programs for major stationary sources (Title V).' },
        { part: '122', kicker: 'Water', title: 'Part 122 — NPDES Permits', desc: 'The discharge permit program for point sources under the Clean Water Act.' },
        { part: '136', kicker: 'Water', title: 'Part 136 — Test Procedures', desc: 'Approved analytical methods for pollutant monitoring and compliance.' },
        { part: '261', kicker: 'Hazardous Waste', title: 'Part 261 — Waste Identification', desc: 'What counts as a solid and hazardous waste under RCRA: listings and characteristics.' },
        { part: '302', kicker: 'Emergencies', title: 'Part 302 — Reportable Quantities', desc: 'CERCLA hazardous substance designations and release notification thresholds.' },
      ],
    },
    49: {
      tagline: 'DOT regulations — hazardous materials, motor carriers, drivers, and vehicle safety — with local search and Claude.',
      cards: [
        { part: '172', kicker: 'Hazmat', title: 'Part 172 — Hazmat Table & Communication', desc: 'The hazardous materials table, shipping papers, marking, labeling, and placarding.' },
        { part: '173', kicker: 'Hazmat', title: 'Part 173 — Packaging Requirements', desc: 'General shipment and packaging requirements by hazard class.' },
        { part: '390', kicker: 'Motor Carriers', title: 'Part 390 — FMCSA General', desc: 'Who the federal motor carrier safety regulations apply to, and general duties.' },
        { part: '391', kicker: 'Drivers', title: 'Part 391 — Driver Qualifications', desc: 'Qualification files, medical certification, and disqualifying offenses.' },
        { part: '383', kicker: 'Drivers', title: 'Part 383 — Commercial Driver’s License', desc: 'CDL standards: who needs one, testing, endorsements, and disqualifications.' },
        { part: '571', kicker: 'Vehicles', title: 'Part 571 — Vehicle Safety Standards', desc: 'Federal motor vehicle safety standards (FMVSS) for cars, trucks, and buses.' },
      ],
    },
  };

  function renderHome() {
    currentSection = null;
    currentPart = null;
    clearTreeSelection();
    updateChatContext();
    document.title = `Title ${currentTitle} · FRAMEWORK`;
    setViewHead('');

    const name = metaInfo.name || '';
    const content = HOME_CONTENT[currentTitle];
    const tagline = content ? content.tagline
      : `Read, search, and ask questions about Title ${currentTitle} of the Code of Federal Regulations.`;
    const count = Number(metaInfo.section_count || 0);
    const metaLine = [
      count ? `${count.toLocaleString()} sections` : '',
      metaInfo.edition ? `current as of ${metaInfo.edition}` : '',
    ].filter(Boolean).join(' · ');

    const cardsHtml = content ? `
      <div class="card-grid">
        ${content.cards.map(c => `
          <a class="card" href="#/part/${encodeURIComponent(c.part)}">
            <span class="card-kicker">${escapeHtml(c.kicker)}</span>
            <div class="card-title">${escapeHtml(c.title)}</div>
            <div class="card-desc">${escapeHtml(c.desc)}</div>
          </a>
        `).join('')}
      </div>
    ` : '';

    dom.view.innerHTML = `
      <div class="home-hero">
        <h1>Title ${currentTitle}${name ? ' — ' + escapeHtml(name) : ''}</h1>
        <p>${escapeHtml(tagline)}</p>
        ${metaLine ? `<p class="home-meta">${escapeHtml(metaLine)}</p>` : ''}
      </div>

      ${cardsHtml}

      <div class="home">
        <h2>Getting around</h2>
        <ul class="tips">
          <li><span class="tip-keys"><kbd>/</kbd></span><span>Search the full text, or jump straight to a section number</span></li>
          <li><span class="tip-keys"><kbd>${isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span><span>Open Ask Claude</span></li>
          <li><span class="tip-keys"><kbd>↑</kbd><kbd>↓</kbd></span><span>Move through the contents list or search suggestions</span></li>
          <li><span class="tip-keys"><kbd>Esc</kbd></span><span>Clear the contents filter or close suggestions</span></li>
        </ul>
      </div>
    `;
    enterView();
  }

  // --- Usage: what this reader has opened, kept in this browser only ---
  // localStorage `usage` = { v, since, s: { "29|1910.1200": {n, t, l, h, p} }, p: { "29|1910": {n, t, h} } }
  // A section visit counts toward its part too; opening a part page counts toward the part only.
  // Title totals are the sum of their parts. The older per-title `visited` sets (which
  // predate this) still drive "sections read", so that number has history from day one.
  const USAGE_KEY = 'usage';

  function loadUsage() {
    try {
      const u = JSON.parse(lsGet(USAGE_KEY) || 'null');
      if (u && u.v === 1 && u.s && u.p) return u;
    } catch (e) { /* corrupt or unavailable: start over */ }
    return { v: 1, since: Date.now(), s: {}, p: {} };
  }

  function bumpPart(u, title, part, heading, now) {
    if (!part) return;
    const key = title + '|' + part;
    const e = u.p[key] || (u.p[key] = { n: 0 });
    e.n += 1;
    e.t = now;
    if (heading) e.h = String(heading).trim();
  }

  function recordSectionVisit(data) {
    if (!data || !data.id) return;
    const u = loadUsage();
    const now = Date.now();
    const key = currentTitle + '|' + data.id;
    const e = u.s[key] || (u.s[key] = { n: 0 });
    e.n += 1;
    e.t = now;
    e.l = data.label || data.id;
    e.h = data.section_title || data.title_label || '';
    e.p = data.part || '';
    const partNode = data.part && treeData ? findPartInTree(treeData, data.part) : null;
    bumpPart(u, currentTitle, data.part, partNode && partNode.d, now);
    lsSet(USAGE_KEY, JSON.stringify(u));
  }

  function recordPartVisit(partId, heading) {
    const u = loadUsage();
    bumpPart(u, currentTitle, partId, heading, Date.now());
    lsSet(USAGE_KEY, JSON.stringify(u));
  }

  function visitedCountFor(title) {
    try {
      const raw = lsGet(title === 29 ? 'visited' : 'visited-' + title);
      return raw ? JSON.parse(raw).length : 0;
    } catch (e) { return 0; }
  }

  function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    const d = Math.floor(s / 86400);
    if (d === 1) return 'yesterday';
    if (d < 30) return `${d}d ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const fmt = (n) => Number(n || 0).toLocaleString();
  const titleHref = (t, rest) => `#/title/${t}/${rest || ''}`;

  // The FRAMEWORK home: one page across every installed title.
  function renderOverview() {
    currentSection = null;
    currentPart = null;
    clearTreeSelection();
    updateChatContext();
    document.title = 'FRAMEWORK';
    setViewHead('');

    const u = loadUsage();
    const titles = installedTitles.length ? installedTitles
      : [{ title: currentTitle, name: metaInfo.name || `Title ${currentTitle}`, section_count: metaInfo.section_count, edition: metaInfo.edition }];
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

  // --- Library: download titles, parts or sections from eCFR (#/library…) ---
  // Three levels, like the sidebar: every title → one title's parts → one part's sections.
  // Row actions (Download, Open, Update, Remove) appear on hover or focus. Downloads queue on
  // the server and run one at a time; `jobs` polls while any are active, wherever you are,
  // and refreshes the title list (and this page) as each finishes.
  const lib = { view: null, data: null, filter: '' };
  let jobs = { current: null, queued: [], recent: [] };
  let jobsTimer = null;
  let jobsSeenActive = new Set(); // ids of jobs this page has seen queued or running
  let lastRunningId = null;

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const libHref = (title, part) => '#/library' + (title ? `/${title}` : '') + (part ? `/part/${encodeURIComponent(part)}` : '');

  async function getJSON(url, opts) {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((body && body.detail) || `Request failed (${res.status})`);
    return body;
  }

  async function loadLibrary(title, part) {
    const seq = routeSeq;
    currentSection = null;
    currentPart = null;
    clearTreeSelection();
    updateChatContext();
    setViewHead('');
    const sameView = lib.view && lib.view.title === title && lib.view.part === part;
    if (!sameView) {
      lib.filter = '';
      dom.view.innerHTML = '<div class="loading">Loading from eCFR…</div>';
    }
    lib.view = { title, part };
    try {
      const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : title ? `/api/library/${title}` : '/api/library';
      const data = await getJSON(url);
      if (seq !== routeSeq) return;
      if (!title) setJobs(data.jobs);
      lib.data = data;
      renderLibrary(!sameView);
      if (!title) pollJobsIfActive();
    } catch (err) {
      if (seq !== routeSeq) return;
      dom.view.innerHTML = `
        <div class="empty-state">
          <h2>Couldn’t load the library</h2>
          <p>${escapeHtml(err.message)}</p>
          <button type="button" class="btn" id="lib-retry">Try again</button>
        </div>`;
      document.getElementById('lib-retry').addEventListener('click', () => loadLibrary(title, part));
    }
  }

  // Refetch the page's data in place (after a download or removal), keeping filter and scroll.
  async function refreshLibrary() {
    if (!lib.view || !dom.view.querySelector('.lib')) return;
    const { title, part } = lib.view;
    try {
      const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : title ? `/api/library/${title}` : '/api/library';
      lib.data = await getJSON(url);
      renderLibrary(false);
    } catch (e) { /* keep what's on screen */ }
  }

  // The job a row would start, if one is queued or running: shown as "Queued" / "Downloading".
  function jobFor(title, kind, id) {
    const active = [jobs.current, ...jobs.queued].filter(Boolean);
    return active.find(j => j.title === title && (
      kind === 'title' ? (j.kind === 'title' || j.kind === 'update')
        : kind === 'part' ? j.kind === 'part' && j.target && j.target.part === id
        : j.kind === 'section' && j.target && j.target.id === id));
  }
  const jobStatus = (j) => j ? `<span class="lib-busy">${j.state === 'running' ? 'Downloading…' : 'Queued'}</span>` : '';

  function actBtn(act, label, attrs, cls = '') {
    return `<button type="button" class="lib-act${cls ? ' ' + cls : ''}" data-act="${act}" ${attrs}>${label}</button>`;
  }

  function libRow({ href, num, name, status, actions, dim, key }) {
    const main = href
      ? `<a class="lib-main" href="${href}"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></a>`
      : `<span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>`;
    return `<div class="lib-row${dim ? ' is-dim' : ''}${actions ? ' has-actions' : ''}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}"${key ? ` data-key="${escapeHtml(key)}"` : ''}>
      ${main}<span class="lib-status">${status || ''}</span><span class="lib-actions">${actions || ''}</span></div>`;
  }

  function jobPanelHtml() {
    const j = jobs.current;
    if (!j && !jobs.queued.length) return '';
    const pct = j && j.total ? Math.min(100, Math.round(j.done / j.total * 100)) : null;
    const detail = !j ? '' : j.phase === 'Downloading text' && j.total && j.total > 100000
      ? `${(j.done / 1048576).toFixed(1)} of ${(j.total / 1048576).toFixed(1)} MB`
      : pct != null ? `${pct}%` : '';
    return `
      <div class="lib-job" role="status" aria-live="polite">
        <div class="lib-job-line">
          <span class="lib-job-label">${j ? escapeHtml(j.label) : 'Starting…'}</span>
          <span class="lib-job-phase">${j ? escapeHtml(j.phase) : ''}${detail ? `<span class="sep" aria-hidden="true">·</span>${escapeHtml(detail)}` : ''}</span>
        </div>
        <div class="lib-bar${pct == null ? ' is-indeterminate' : ''}"><span style="width:${pct == null ? 30 : pct}%"></span></div>
        ${jobs.queued.length ? `<div class="lib-job-queue">Then ${jobs.queued.map(q => escapeHtml(q.label)).join(', ')}</div>` : ''}
      </div>`;
  }

  function renderLibrary(fresh) {
    const { title, part } = lib.view;
    const d = lib.data;
    let crumbs, heading, sub, head = '', body = '', placeholder;

    if (!title) {
      document.title = 'Library · FRAMEWORK';
      crumbs = `<a href="#/">Overview</a>`;
      heading = 'Library';
      sub = 'Download a whole title, a part or single sections from eCFR into FRAMEWORK. Open a title to pick parts and sections.';
      placeholder = 'Filter titles';
      body = d.titles.map(t => {
        const inst = t.installed;
        const j = jobFor(t.title, 'title');
        if (t.reserved) return libRow({ num: String(t.title), name: t.name, status: 'Reserved', dim: true });
        let status = '', acts = '';
        if (!inst) {
          acts = actBtn('download', 'Download title', `data-title="${t.title}"`);
        } else {
          const stale = t.latest && inst.edition && t.latest > inst.edition;
          status = inst.whole
            ? `Installed · ${escapeHtml(fmtDate(inst.edition))}`
            : `${[inst.parts ? `${inst.parts} ${inst.parts === 1 ? 'part' : 'parts'}` : '', inst.sections ? `${inst.sections} ${inst.sections === 1 ? 'section' : 'sections'}` : ''].filter(Boolean).join(' · ')}`;
          acts = `<a class="lib-act" href="#/title/${t.title}/">Open</a>`
            + (inst.whole ? '' : actBtn('download', 'Download all', `data-title="${t.title}"`))
            + (stale ? actBtn('update', 'Update', `data-title="${t.title}" title="eCFR has a newer edition (${escapeHtml(fmtDate(t.latest))})"`) : '')
            + actBtn('remove', 'Remove', `data-title="${t.title}"`, 'is-danger');
        }
        return libRow({ href: libHref(t.title), num: String(t.title), name: t.name, status: j ? jobStatus(j) : status, actions: j ? '' : acts, key: `t${t.title}` });
      }).join('');
    } else if (!part) {
      document.title = `Title ${title} · Library · FRAMEWORK`;
      const inst = d.installed;
      crumbs = `<a href="#/">Overview</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a>`;
      heading = `Title ${title} — ${d.name}`;
      sub = inst
        ? (inst.whole ? `Installed · ${fmtDate(inst.edition)} · ${fmt(inst.section_count)} sections`
          : `Partly installed · ${fmt(inst.section_count)} ${inst.section_count === 1 ? 'section' : 'sections'}`)
        : `Not installed · eCFR edition ${fmtDate(d.latest)}`;
      placeholder = 'Filter parts';
      const j = jobFor(title, 'title');
      head = d.reserved ? '' : j ? `<span class="lib-head-status">${jobStatus(j)}</span>`
        : (inst && inst.whole ? `<a class="btn" href="#/title/${title}/">Open in reader</a>`
          : `<button type="button" class="btn" data-act="download" data-title="${title}">${icon('download')} Download whole title</button>`);
      body = d.groups.map(g => `
        ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ''}
        ${g.parts.map(p => {
          const pj = jobFor(title, 'part', p.id);
          if (p.r || !p.leaves) return libRow({ num: p.l.replace(/^Parts?\s+/, ''), name: p.d || 'Reserved', status: 'Reserved', dim: true });
          const status = p.installed === 'all' ? 'Installed'
            : p.installed === 'some' ? `${p.installed_sections} of ${fmt(p.leaves)} installed` : `${fmt(p.leaves)} ${p.leaves === 1 ? 'section' : 'sections'}`;
          const acts = p.installed === 'all'
            ? `<a class="lib-act" href="#/title/${title}/part/${encodeURIComponent(p.id)}">Open</a>`
            : actBtn('download', 'Download part', `data-title="${title}" data-part="${escapeHtml(p.id)}"`);
          return libRow({ href: libHref(title, p.id), num: p.id, name: p.d || p.l, status: pj ? jobStatus(pj) : status, actions: pj ? '' : acts, key: `p${p.id}` });
        }).join('')}`).join('');
    } else {
      document.title = `Part ${part} · Library · FRAMEWORK`;
      crumbs = `<a href="#/">Overview</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${libHref(title)}">Title ${title}</a>`;
      heading = `${d.l} — ${d.d}`;
      const count = d.groups.reduce((a, g) => a + g.sections.filter(s => !s.r).length, 0);
      const countText = `${fmt(count)} ${count === 1 ? 'section' : 'sections'}`;
      sub = d.installed === 'all' ? `Installed · ${countText}` : d.installed === 'some' ? `Partly installed · ${countText}` : countText;
      placeholder = 'Filter sections';
      const j = jobFor(title, 'part', part);
      head = j ? `<span class="lib-head-status">${jobStatus(j)}</span>`
        : d.installed === 'all' ? `<a class="btn" href="#/title/${title}/part/${encodeURIComponent(part)}">Open in reader</a>`
        : `<button type="button" class="btn" data-act="download" data-title="${title}" data-part="${escapeHtml(part)}">${icon('download')} Download part</button>`;
      body = d.groups.map(g => `
        ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ''}
        ${g.sections.map(s => {
          const num = s.t === 'appendix' ? s.l : s.l.replace(/^§\s*/, '');
          const name = s.t === 'appendix' ? (s.d && s.d !== s.l ? s.d.replace(s.l, '').replace(/^\s*[—–-]\s*/, '') : '') : s.d;
          if (s.r) return libRow({ num, name: name || 'Reserved', status: 'Reserved', dim: true });
          const sj = jobFor(title, 'section', s.id);
          const acts = s.installed
            ? `<a class="lib-act" href="#/title/${title}/section/${encodeURIComponent(s.id)}">Open</a>`
            : actBtn('download', 'Download', `data-title="${title}" data-part="${escapeHtml(part)}" data-section="${escapeHtml(s.id)}" data-kind="${s.t}"`);
          return libRow({ num, name, status: sj ? jobStatus(sj) : (s.installed ? 'Installed' : ''), actions: sj ? '' : acts, key: `s${s.id}` });
        }).join('')}`).join('');
    }

    const scrollTop = dom.main.scrollTop;
    dom.view.innerHTML = `
      <div class="lib">
        <div class="doc-kicker">${crumbs}</div>
        <div class="lib-head">
          <div class="lib-head-text">
            <h1 class="doc-title">${escapeHtml(heading)}</h1>
            <p class="lib-sub">${escapeHtml(sub)}</p>
          </div>
          ${head}
        </div>
        <div id="lib-job-slot">${jobPanelHtml()}</div>
        <input class="lib-filter" id="lib-filter" type="search" placeholder="${placeholder}…" aria-label="${placeholder}" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
        <div class="lib-list" id="lib-list">${body}</div>
        <div class="lib-none" id="lib-none" hidden>Nothing matches.</div>
      </div>`;
    applyLibraryFilter();
    if (fresh) enterView();
    else dom.main.scrollTop = scrollTop;
  }

  function applyLibraryFilter() {
    const words = lib.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const list = document.getElementById('lib-list');
    if (!list) return;
    let shown = 0;
    let label = null, labelHas = false;
    const closeLabel = () => { if (label) label.hidden = !labelHas; };
    for (const el of list.children) {
      if (el.classList.contains('lib-label')) {
        closeLabel();
        label = el; labelHas = false;
        continue;
      }
      const hay = el.dataset.hay || '';
      const ok = words.every(w => hay.includes(w));
      el.hidden = !ok;
      if (ok) { shown++; labelHas = true; }
    }
    closeLabel();
    document.getElementById('lib-none').hidden = shown > 0;
  }

  dom.view.addEventListener('input', (e) => {
    if (e.target.id !== 'lib-filter') return;
    lib.filter = e.target.value;
    applyLibraryFilter();
  });

  dom.view.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !dom.view.querySelector('.lib')?.contains(btn)) return;
    const title = parseInt(btn.dataset.title, 10);
    const act = btn.dataset.act;
    if (act === 'remove') {
      // Two clicks: the first arms the button for a few seconds.
      if (!btn.classList.contains('is-armed')) {
        btn.classList.add('is-armed');
        btn.textContent = 'Confirm remove';
        clearTimeout(btn._t);
        btn._t = setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = 'Remove'; }, 4000);
        return;
      }
      btn.disabled = true;
      try {
        await getJSON(`/api/library/${title}`, { method: 'DELETE' });
        showToast(`Removed Title ${title}`);
        await refreshTitles();
        await refreshLibrary();
      } catch (err) {
        showToast(err.message, 5000);
        btn.disabled = false;
      }
      return;
    }
    btn.disabled = true;
    try {
      const job = act === 'update'
        ? await getJSON(`/api/library/${title}/update`, { method: 'POST' })
        : await getJSON('/api/library/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            part: btn.dataset.part || null,
            section: btn.dataset.section || null,
            kind: btn.dataset.kind === 'appendix' ? 'appendix' : 'section',
          }),
        });
      jobsSeenActive.add(job.id);
      await pollJobs();
    } catch (err) {
      showToast(err.message, 5000);
      btn.disabled = false;
    }
  });

  function setJobs(snapshot) {
    if (!snapshot) return;
    jobs = snapshot;
    for (const j of [jobs.current, ...jobs.queued]) if (j) jobsSeenActive.add(j.id);
  }

  function pollJobsIfActive() {
    if ((jobs.current || jobs.queued.length) && !jobsTimer) jobsTimer = setTimeout(pollJobs, 700);
  }

  async function pollJobs() {
    clearTimeout(jobsTimer);
    jobsTimer = null;
    let snap;
    try { snap = await getJSON('/api/library/jobs'); } catch (e) { jobsTimer = setTimeout(pollJobs, 3000); return; }
    const before = new Set(jobsSeenActive);
    setJobs(snap);
    const finished = snap.recent.filter(j => before.has(j.id));
    for (const j of finished) {
      jobsSeenActive.delete(j.id);
      if (j.state === 'error') showToast(`${j.label}: ${j.error}`, 6000);
      else showToast(j.phase === 'Already installed' ? `${j.label} is already installed` : `Downloaded ${j.label}`);
    }
    if (finished.some(j => j.state === 'done')) {
      await refreshTitles(finished.filter(j => j.state === 'done').map(j => j.title));
    }
    if (dom.view.querySelector('.lib')) {
      if (finished.length) await refreshLibrary();
      else {
        const slot = document.getElementById('lib-job-slot');
        if (slot) slot.innerHTML = jobPanelHtml();
        // Row states ("Queued" → "Downloading…") only change when a job starts or ends.
        const runningId = snap.current ? snap.current.id : null;
        if (runningId !== lastRunningId) {
          lastRunningId = runningId;
          renderLibrary(false);
        }
      }
    }
    pollJobsIfActive();
  }

  // Re-read the installed titles after a download or removal: the title switcher, the
  // current title (if it was removed or rebuilt), and the overview if it's on screen.
  async function refreshTitles(changed = []) {
    let list;
    try { list = await getJSON('/api/titles'); } catch (e) { return; }
    installedTitles = list;
    fillTitleSelect();
    if (!list.some(t => t.title === currentTitle) && list.length) {
      await switchTitle(list[0].title);
    } else if (changed.includes(currentTitle)) {
      treeData = null; // rebuilt: reload its contents
      const meta = list.find(t => t.title === currentTitle);
      if (meta) metaInfo = meta;
      await switchTitle(currentTitle);
    }
    if (dom.view.querySelector('.ov')) renderOverview();
  }

  // --- Title switcher (top bar) ---
  // A Linear-style menu instead of a native select: "Download titles…" first (opens the
  // library), then the installed titles, number in a muted column, a check on the current one.
  // Keyboard: ↓/Enter/Space opens on the current title, ↑↓ Home End move, Enter picks,
  // Esc closes and returns focus to the button, Tab closes.
  function fillTitleSelect() {
    if (!dom.titleSelect) return;
    const cur = installedTitles.find(t => t.title === currentTitle);
    const name = cur ? cur.name : (metaInfo.name || '');
    document.getElementById('title-select-num').textContent = `Title ${currentTitle}`;
    document.getElementById('title-select-name').textContent = name;
    dom.titleSelect.title = `Title ${currentTitle}${name ? ': ' + name : ''}. Switch title`;
    dom.titlePop.innerHTML = `
      <a class="tm-item tm-download" role="menuitem" href="#/library" tabindex="-1">${icon('download')}<span class="tm-name">Download titles…</span></a>
      <div class="tm-sep" role="separator"></div>
      ${installedTitles.map(t => {
        const on = t.title === currentTitle;
        return `<button type="button" class="tm-item${on ? ' is-current' : ''}" role="menuitemradio" aria-checked="${on}" data-title="${t.title}" tabindex="-1">
          <span class="tm-num">${t.title}</span><span class="tm-name">${escapeHtml(t.name)}</span>
          ${t.partial ? '<span class="tm-meta">Partial</span>' : ''}
          ${on ? icon('check', 'tm-check') : '<span class="tm-check" aria-hidden="true"></span>'}
        </button>`;
      }).join('')}`;
  }

  const titleMenuItems = () => [...dom.titlePop.querySelectorAll('.tm-item')];

  function openTitleMenu(focusWhich = 'current') {
    if (!dom.titlePop.hidden) return;
    dom.titlePop.hidden = false;
    dom.titleSelect.setAttribute('aria-expanded', 'true');
    const items = titleMenuItems();
    const target = focusWhich === 'first' ? items[0]
      : focusWhich === 'last' ? items[items.length - 1]
      : dom.titlePop.querySelector('.is-current') || items[0];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', onTitleMenuOutside, true);
  }

  function closeTitleMenu(returnFocus) {
    if (dom.titlePop.hidden) return;
    dom.titlePop.hidden = true;
    dom.titleSelect.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onTitleMenuOutside, true);
    if (returnFocus) dom.titleSelect.focus();
  }

  function onTitleMenuOutside(e) {
    if (!document.getElementById('title-menu').contains(e.target)) closeTitleMenu(false);
  }

  dom.titleSelect.addEventListener('click', () => {
    if (dom.titlePop.hidden) openTitleMenu();
    else closeTitleMenu(false);
  });
  dom.titleSelect.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openTitleMenu(e.key === 'ArrowUp' ? 'last' : 'current');
    }
  });
  dom.titlePop.addEventListener('keydown', (e) => {
    const items = titleMenuItems();
    const i = items.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTitleMenu(true); }
    else if (e.key === 'Tab') closeTitleMenu(false);
  });
  dom.titlePop.addEventListener('click', async (e) => {
    const item = e.target.closest('.tm-item');
    if (!item) return;
    closeTitleMenu(false);
    if (item.classList.contains('tm-download')) return; // the link navigates
    const newTitle = parseInt(item.dataset.title, 10);
    if (newTitle && newTitle !== currentTitle) {
      await switchTitle(newTitle);
      window.location.hash = `#/title/${newTitle}/`;
    } else {
      dom.titleSelect.focus();
    }
  });

  function renderNotFound() {
    clearTreeSelection();
    document.title = 'Not found · FRAMEWORK';
    setViewHead('');
    dom.view.innerHTML = `
      <div class="empty-state">
        <h2>Page not found</h2>
        <p>That section or part isn’t in Title ${currentTitle}.</p>
        <a href="#/title/${currentTitle}/" class="btn">Back to Title ${currentTitle}</a>
      </div>
    `;
    enterView();
  }

  // --- Main panel header: previous/next ---
  //   ‹ part | ‹ section ……… section › | part ›
  // Lives in #view-head, pinned to the top of the reading panel while the text scrolls
  // under it. Buttons show only the number; the name appears in a small popup on hover or
  // keyboard focus. A neighbour that doesn't exist leaves no button. A part page offers its
  // own first section as "next section". Pages with nothing to step through hide the header.
  function setViewHead(html) {
    const head = dom.viewHead;
    if (!head) return;
    // A keyboard user stepping with Enter keeps their place on the same button.
    const step = head.contains(document.activeElement) ? document.activeElement.dataset.step : null;
    if (railObserver) { railObserver.disconnect(); railObserver = null; }
    head.innerHTML = html || '';
    head.hidden = !html;
    if (step) (head.querySelector(`[data-step="${step}"]`) || head.querySelector('a'))?.focus({ preventScroll: true });
  }

  function firstSectionOf(partId) {
    const k = treeIdx.parts.get(String(partId));
    if (k === undefined) return null;
    const find = (node) => {
      for (const c of node.c || []) {
        if (LEAF_TYPES.has(c.t)) return c;
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const leaf = find(treeIdx.nodes[k]);
    return leaf ? { id: leaf.id, label: (leaf.l || '').trim(), title: tocTitle(leaf) } : null;
  }

  function docStepBtn(kind, dir, href, label, name, labelHtml) {
    const prev = dir < 0;
    const what = `${prev ? 'Previous' : 'Next'} ${kind}`;
    const chevron = icon(prev ? 'chevronLeft' : 'chevronRight');
    const title = (name || '').trim();
    return `<a class="doc-step-btn is-${prev ? 'prev' : 'next'}" href="${href}" data-step="${kind}-${prev ? 'prev' : 'next'}" aria-label="${escapeHtml(`${what}: ${label}${title ? ' ' + title : ''}`)}">`
      + `${prev ? chevron : ''}<span class="step-label">${labelHtml || escapeHtml(label)}</span>${prev ? '' : chevron}`
      + `<span class="tip" aria-hidden="true"><span class="tip-kind">${what} · ${escapeHtml(label)}</span>${escapeHtml(title)}</span></a>`;
  }

  function partNeighbors(partId) {
    const list = treeIdx.partList;
    const k = treeIdx.parts.get(String(partId));
    const i = k === undefined ? -1 : list.indexOf(k);
    if (i < 0) return [null, null];
    return [treeIdx.nodes[list[i - 1]] || null, treeIdx.nodes[list[i + 1]] || null];
  }

  function docStepHtml(partId, prevSection, nextSection) {
    const [prevPart, nextPart] = partNeighbors(partId);
    const partBtn = (node, dir) => node
      ? docStepBtn('part', dir, `#/part/${encodeURIComponent(node.id)}`, `Part ${node.id}`, node.d,
        `<span class="step-word">Part </span>${escapeHtml(node.id)}`)
      : '';
    const sectionBtn = (s, dir) => s
      ? docStepBtn('section', dir, `#/section/${encodeURIComponent(s.id)}`, s.label, s.title)
      : '';
    const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
    const left = [partBtn(prevPart, -1), sectionBtn(prevSection, -1)].filter(Boolean).join(sep);
    const right = [sectionBtn(nextSection, 1), partBtn(nextPart, 1)].filter(Boolean).join(sep);
    if (!left && !right) return '';
    return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
  }

  // --- Load Section ---
  // `view` is a unit key (read that unit), 'full' (the whole section), or null (the default:
  // the first unit of a long section, or the page of a short one).
  async function loadSection(sectionId, params, view) {
    const full = view === 'full';
    // A link to a paragraph, e.g. ?p=(f)(1), opens the clause that holds it.
    const pClause = params && /^\(([a-z])\)/.exec(params.get('p') || '');
    const unit = full ? null : (view || (pClause ? pClause[1] : ''));
    const sameSection = currentSection && currentSection.id === sectionId && !dom.view.querySelector('.loading');
    if (!sameSection) dom.view.innerHTML = '<div class="loading">Loading section ' + escapeHtml(sectionId) + '…</div>';
    try {
      const qs = unit === null ? '' : '?unit=' + encodeURIComponent(unit);
      const seq = routeSeq;
      const res = await fetch('/api/' + currentTitle + '/section/' + encodeURIComponent(sectionId) + qs);
      if (seq !== routeSeq) return;
      if (!res.ok) {
        renderNotFound();
        return;
      }
      const data = await res.json();
      if (seq !== routeSeq) return;
      currentSection = data;
      currentPart = data.part;
      updateChatContext();

      const reading = data.mode === 'units' && data.unit ? 'units' : 'scroll';
      const current = reading === 'units' ? (data.outline || []).find(u => u.key === data.unit) : null;
      const heading = data.section_title || data.title_label || '';
      document.title = `${data.label}${current ? ' ' + unitShort(current) : ''} · Title ${currentTitle}`;
      setViewHead((reading === 'units' ? unitStepHtml(data) : docStepHtml(data.part, data.prev, data.next)) + railHtml(data, reading));

      // The line above the title places the section (title and part) and links up to its part.
      const partLink = data.part ? `<a href="#/part/${encodeURIComponent(data.part)}">Part ${escapeHtml(data.part)}</a>` : '';
      // Inside an appendix, every chapter after the first says which appendix it belongs to.
      const i = current ? data.outline.indexOf(current) : -1;
      const showContext = current && current.group && current.kind === 'chapter' && i > 0 && data.outline[i - 1].group === current.group;
      const fullPart = data.part ? `<a class="btn" href="#/part/${encodeURIComponent(data.part)}/full?from=${encodeURIComponent(data.id)}">${icon('list')} See full part</a>` : '';
      const toggle = data.mode !== 'units' ? ''
        : full ? `<a class="btn" href="${sectionHref(data.id)}">${icon('stack')} Read in parts</a>`
        : `<a class="btn" href="${sectionHref(data.id, 'full')}">${icon('expand')} See full section</a>`;
      dom.view.innerHTML = `
        <div class="doc-kicker">${currentTitle} CFR ${partLink}</div>
        <h1 class="doc-title">${escapeHtml(data.label)} ${escapeHtml(heading)}</h1>

        <div class="doc-actions">
          ${toggle}
          ${fullPart}
          <a class="btn" href="${escapeHtml(data.ecfr_url)}" target="_blank" rel="noopener">${icon('external')} eCFR</a>
          <button class="btn" id="btn-copy-link">${icon('link')} Copy link</button>
          <div class="spacer"></div>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>

        ${data.reserved ? '<div class="reserved-note">This section is reserved.</div>' : ''}
        ${showContext ? `<div class="unit-context">${escapeHtml(current.group_label)}<span class="sep" aria-hidden="true">·</span>${escapeHtml(current.group_title || '')}</div>` : ''}

        ${data.html || ''}
      `;

      enterView();
      bindRail();
      if (reading === 'scroll') watchRail();
      else if (railObserver) { railObserver.disconnect(); railObserver = null; }

      // Bind actions
      document.getElementById('btn-copy-link')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          showToast('Link copied');
        } catch (e) {
          showToast('Couldn’t copy the link');
        }
      });
      document.getElementById('font-dec')?.addEventListener('click', () => adjustFontSize(-1));
      document.getElementById('font-inc')?.addEventListener('click', () => adjustFontSize(1));

      // Handle highlight param if present
      if (params && params.get('p')) {
        highlightParagraph(params.get('p'));
      }

      // Highlight in sidebar tree
      selectTreeNode('s-' + data.id);
      // Stepping between clauses of one section is one visit, not many.
      if (!sameSection) recordSectionVisit(data);

    } catch (err) {
      console.error(err);
      setViewHead('');
      dom.view.innerHTML = `<div class="msg-error">Failed to load section: ${escapeHtml(err.message)}</div>`;
    }
  }

  function highlightParagraph(pText) {
    setTimeout(() => {
      // Find matching paragraph
      const clean = pText.trim();
      const pmarks = document.querySelectorAll('.reg-p .pmark');
      for (const el of pmarks) {
        if (el.textContent.includes(clean)) {
          const p = el.closest('.reg-p');
          p.classList.add('flash');
          p.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }, 150);
  }

  // --- Units and the rail ---
  //
  // The server cuts a section into units (`data.outline`): its lettered clauses (a), (b), …
  // and any appendices embedded in it, long appendices split again at their own headings
  // (A.1, A.2 …). A long section (`data.mode === 'units'`) is read one unit at a time at
  // #/section/{id}/{unit}; #/section/{id}/full shows all of it; short sections are one page.
  //
  // The rail is a tight stack of short bars pinned in the reading panel's left gutter, one
  // per unit, with a small gap between groups (the rule, then each appendix). Bar length
  // hints at the unit's length. The unit on screen is lit; hovering a bar brightens and
  // stretches it and shows the unit's name. In unit view a bar opens that unit; on a full
  // page it scrolls there, and the lit bar follows the scroll.

  function sectionHref(id, view) {
    return `#/section/${encodeURIComponent(id)}${view ? '/' + encodeURIComponent(view) : ''}`;
  }

  function unitShort(u) {
    if (u.label) return u.label;
    const t = (u.title || '').trim();
    return t.length > 18 ? t.slice(0, 17).trim() + '…' : t;
  }

  function unitName(u) {
    const inGroup = u.group && u.kind === 'chapter';
    return (inGroup ? `${u.group_label} · ` : '') + (u.title || u.label || '');
  }

  function unitKind(u) {
    return { clause: 'clause', chapter: 'part', appendix: 'appendix' }[u.kind] || 'part';
  }

  function railHtml(data, mode) {
    const units = data.outline || [];
    if (units.length < 2) return '';
    let html = '';
    let lastGroup;
    let rows = units.length;
    units.forEach((u, i) => {
      if (i && u.group !== lastGroup) { html += '<span class="rail-gap" aria-hidden="true"></span>'; rows++; }
      lastGroup = u.group;
      const current = mode === 'units' && u.key === data.unit;
      const href = mode === 'units' ? sectionHref(data.id, u.key) : `#u-${u.key}`;
      const name = unitName(u);
      html += `<a class="rail-item${current ? ' is-current' : ''}" href="${href}" data-unit="${escapeHtml(u.key)}"`
        + `${mode === 'units' ? '' : ` data-anchor="u-${escapeHtml(u.key)}"`}${current ? ' aria-current="true"' : ''}`
        + ` data-label="${escapeHtml(u.label || '')}" data-name="${escapeHtml(name)}"`
        + ` aria-label="${escapeHtml(`${u.label ? u.label + ' ' : ''}${name}`)}">`
        + `<span class="rail-bar" aria-hidden="true"></span></a>`;
    });
    // One shared label (.rail-pop) glides to whichever bar is under the pointer; it is a link
    // itself, so the pointer can move onto it and click.
    return `<nav class="rail" style="--rows:${rows}" aria-label="Contents of this section">${html}`
      + `<a class="rail-pop" tabindex="-1" aria-hidden="true"><span class="rail-pop-label"></span><span class="rail-pop-name"></span></a></nav>`;
  }

  // Hover for the rail. The bars are only a few pixels apart, so instead of per-bar :hover
  // (which hops to a neighbour on the slightest drift), pick the bar nearest the pointer and
  // only switch when the pointer is clearly closer to another one. The label stays put while
  // the pointer is on it. Nothing here scrolls; the wheel still scrolls the page.
  function bindRail() {
    const rail = dom.viewHead && dom.viewHead.querySelector('.rail');
    if (!rail) return;
    const pop = rail.querySelector('.rail-pop');
    const items = [...rail.querySelectorAll('.rail-item')];
    let active = null;
    let hideTimer = 0;

    const centerY = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    const show = (item) => {
      clearTimeout(hideTimer);
      const opening = !rail.classList.contains('is-open');
      if (item === active && !opening) return;
      if (active) active.classList.remove('is-hover');
      active = item;
      item.classList.add('is-hover');
      pop.querySelector('.rail-pop-label').textContent = item.dataset.label || '';
      pop.querySelector('.rail-pop-name').textContent = item.dataset.name || '';
      pop.href = item.getAttribute('href');
      if (item.dataset.anchor) pop.dataset.anchor = item.dataset.anchor; else delete pop.dataset.anchor;
      // Appear in place when opening; glide only from one bar to the next.
      if (opening) pop.classList.add('is-placing');
      pop.style.top = (centerY(item) - rail.getBoundingClientRect().top) + 'px';
      if (opening) {
        void pop.offsetHeight;
        pop.classList.remove('is-placing');
        rail.classList.add('is-open');
      }
    };
    const hide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        rail.classList.remove('is-open');
        if (active) active.classList.remove('is-hover');
        active = null;
      }, 140);
    };

    rail.addEventListener('pointermove', (e) => {
      if (pop.contains(e.target)) { clearTimeout(hideTimer); return; }
      let best = null;
      let bestD = Infinity;
      for (const it of items) {
        const d = Math.abs(e.clientY - centerY(it));
        if (d < bestD) { bestD = d; best = it; }
      }
      if (!best) return;
      if (active && best !== active) {
        const row = active.getBoundingClientRect().height;
        if (Math.abs(e.clientY - centerY(active)) - bestD < Math.max(2, row * 0.35)) { clearTimeout(hideTimer); return; }
      }
      show(best);
    });
    rail.addEventListener('pointerleave', hide);
    rail.addEventListener('focusin', (e) => { const it = e.target.closest('.rail-item'); if (it) show(it); });
    rail.addEventListener('focusout', hide);
  }

  function unitStepHtml(data) {
    const sectionBtn = (s, dir) => s
      ? docStepBtn('section', dir, sectionHref(s.id), s.label, s.title)
      : '';
    const unitBtn = (u, dir) => u
      ? docStepBtn(unitKind(u), dir, sectionHref(data.id, u.key), unitShort(u), unitName(u))
      : '';
    const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
    const left = [sectionBtn(data.prev, -1), unitBtn(data.unit_prev, -1)].filter(Boolean).join(sep);
    const right = [unitBtn(data.unit_next, 1), sectionBtn(data.next, 1)].filter(Boolean).join(sep);
    return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
  }

  // Scroll-spy for full pages: light the bar of the last unit whose top has passed just
  // under the pinned header. `railObserver` holds the teardown for the current page.
  let railObserver = null;
  function watchRail() {
    if (railObserver) { railObserver.disconnect(); railObserver = null; }
    const rail = dom.viewHead && dom.viewHead.querySelector('.rail');
    const sections = [...dom.view.querySelectorAll('.reg-unit')];
    if (!rail || !sections.length) return;
    let lit = null;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = dom.main.getBoundingClientRect().top + 96;
      let key = sections[0].dataset.unit;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= line) key = s.dataset.unit;
        else break;
      }
      if (key === lit) return;
      lit = key;
      rail.querySelectorAll('.rail-item').forEach(a => {
        const on = a.dataset.unit === key;
        a.classList.toggle('is-current', on);
        if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    dom.main.addEventListener('scroll', onScroll, { passive: true });
    // Lazy figures loading above the fold shift everything down without a scroll event.
    dom.view.addEventListener('load', onScroll, true);
    railObserver = { disconnect: () => {
      dom.main.removeEventListener('scroll', onScroll);
      dom.view.removeEventListener('load', onScroll, true);
      if (frame) cancelAnimationFrame(frame);
    } };
    update();
  }

  // Scroll + brief highlight for in-page anchors (rail bars on a full page).
  function scrollToAnchor(id) {
    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ block: 'start', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    return true;
  }

  if (dom.viewHead) {
    dom.viewHead.addEventListener('click', (e) => {
      const a = e.target.closest('[data-anchor]');
      if (!a) return;
      e.preventDefault();
      scrollToAnchor(a.dataset.anchor);
    });
  }

  // A figure that won't load (a few dozen legacy image names) gets a quiet fallback.
  dom.view.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('reg-img')) return;
    const fig = img.closest('.reg-figure');
    if (!fig || fig.classList.contains('is-broken')) return;
    fig.classList.add('is-broken');
    fig.href = (currentSection && currentSection.ecfr_url) || fig.href;
    fig.title = 'This figure is only available on eCFR';
    fig.innerHTML = `${icon('external')}<span>Figure — view on eCFR</span>`;
  }, true);

  function adjustFontSize(delta) {
    let current = parseInt(lsGet('fontSize'), 10) || 16;
    current = Math.max(13, Math.min(24, current + delta));
    lsSet('fontSize', String(current));
    document.documentElement.style.setProperty('--reader-size', current + 'px');
  }

  // --- Load Part Table of Contents ---
  async function loadPart(partId) {
    dom.view.innerHTML = '<div class="loading">Loading Part ' + escapeHtml(partId) + '…</div>';
    currentSection = null;
    currentPart = partId;
    updateChatContext();

    try {
      const seq = routeSeq;
      // Fetch TOC tree nodes for this part and front matter
      const [frontRes] = await Promise.all([
        fetch('/api/' + currentTitle + '/part/' + encodeURIComponent(partId)),
        ensureTreeLoaded()
      ]);

      const front = frontRes.ok ? await frontRes.json() : { part: '', subparts: {} };
      if (seq !== routeSeq) return;

      // Find part node in tree
      const partNode = findPartInTree(treeData, partId);
      if (!partNode) {
        renderNotFound();
        return;
      }

      let groupsHtml = '';
      if (partNode.c) {
        for (const child of partNode.c) {
          if (child.t === 'subpart' || child.t === 'subject_group') {
            const subpartFront = front.subparts[child.id] || '';
            const sections = (child.c || []).map(s => `
              <li class="${s.r ? 'reserved' : ''}">
                <a href="#/section/${encodeURIComponent(s.id)}">
                  <span class="toc-num">${escapeHtml(s.l)}</span>
                  <span class="toc-title">${escapeHtml(tocTitle(s))}</span>
                </a>
              </li>
            `).join('');

            groupsHtml += `
              <div class="toc-group">
                <h3>${escapeHtml(child.d && child.d.trim() !== (child.l || '').trim() ? `${child.l}: ${child.d}` : child.l)}</h3>
                ${subpartFront ? `<div class="front-matter"><details><summary>Subpart notes</summary>${subpartFront}</details></div>` : ''}
                <ul class="toc-list">${sections}</ul>
              </div>
            `;
          } else if (child.t === 'section' || child.t === 'appendix') {
            groupsHtml += `
              <ul class="toc-list">
                <li class="${child.r ? 'reserved' : ''}">
                  <a href="#/section/${encodeURIComponent(child.id)}">
                    <span class="toc-num">${escapeHtml(child.l)}</span>
                    <span class="toc-title">${escapeHtml(tocTitle(child))}</span>
                  </a>
                </li>
              </ul>
            `;
          }
        }
      }

      document.title = `Part ${partId} · Title ${currentTitle}`;
      setViewHead(docStepHtml(partId, null, firstSectionOf(partId)));
      dom.view.innerHTML = `
        <div class="doc-kicker">${currentTitle} CFR ${escapeHtml(partNode.l)}</div>
        <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
        <div class="doc-actions">
          <a class="btn" href="#/part/${encodeURIComponent(partId)}/full">${icon('list')} See full part</a>
        </div>
        ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ''}
        ${groupsHtml || '<p class="muted">No sections listed in this part.</p>'}
      `;

      enterView();
      selectTreeNode('p-' + partId);
      recordPartVisit(partId, partNode.d);
    } catch (err) {
      console.error(err);
      setViewHead('');
      dom.view.innerHTML = `<div class="msg-error">Failed to load part: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- Load Part (full text) ---
  // Every section of a part in reading order, each with its own anchor. Arriving from a
  // section page scrolls that section into view; prev/next part in the header jump between
  // parts without leaving the full-text view.
  async function loadPartFull(partId, params) {
    dom.view.innerHTML = '<div class="loading">Loading Part ' + escapeHtml(partId) + '…</div>';
    currentSection = null;
    currentPart = partId;
    updateChatContext();

    try {
      const seq = routeSeq;
      await ensureTreeLoaded();
      if (seq !== routeSeq) return;
      const partNode = findPartInTree(treeData, partId);
      if (!partNode) { renderNotFound(); return; }

      const res = await fetch('/api/' + currentTitle + '/part/' + encodeURIComponent(partId) + '/full');
      if (seq !== routeSeq) return;
      if (!res.ok) { renderNotFound(); return; }
      const data = await res.json();
      if (seq !== routeSeq) return;

      const from = params && params.get('from');
      const anchorId = (id) => 'sec-' + String(id).replace(/[^a-zA-Z0-9.\-]/g, '_');
      const sectionsHtml = (data.sections || []).map(s => {
        // The stored label on sections already begins with "§ "; appendices have "Appendix X".
        const num = escapeHtml(s.label);
        const title = escapeHtml(s.title || '');
        const body = s.reserved ? '<div class="reserved-note">This section is reserved.</div>' : (s.html || '');
        return `<article class="full-section${s.id === from ? ' is-from' : ''}" id="${anchorId(s.id)}">
          <header class="full-section-head">
            <a class="full-section-anchor" href="${sectionHref(s.id)}" title="Open this section on its own">
              <span class="full-section-num">${num}</span>
              <span class="full-section-title">${title}</span>
            </a>
          </header>
          ${body}
        </article>`;
      }).join('');

      document.title = `Part ${partId} (full) · Title ${currentTitle}`;
      // Full-text mode steps between parts, not between sections.
      const [prevPart, nextPart] = partNeighbors(partId);
      const partBtn = (node, dir) => node
        ? docStepBtn('part', dir, `#/part/${encodeURIComponent(node.id)}/full`, `Part ${node.id}`, node.d,
          `<span class="step-word">Part </span>${escapeHtml(node.id)}`)
        : '';
      const headRow = (prevPart || nextPart)
        ? `<nav class="doc-step" aria-label="Previous and next part">${partBtn(prevPart, -1)}<span class="spacer"></span>${partBtn(nextPart, 1)}</nav>`
        : '';
      setViewHead(headRow);

      dom.view.innerHTML = `
        <div class="doc-kicker">${currentTitle} CFR ${escapeHtml(partNode.l)} · <a href="#/part/${encodeURIComponent(partId)}">Table of contents</a></div>
        <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
        ${sectionsHtml || '<p class="muted">No sections in this part.</p>'}
      `;
      recordPartVisit(partId, partNode.d);

      // No enterView() here: a fade-rise on hundreds of nodes is a jank parade, and the
      // scroll-to has to land on the right pixel. Images load after the render and push
      // content down, so re-anchor on each image load (and once fonts are ready) until the
      // user takes over scrolling. `.full-section`'s scroll-margin-top handles the offset
      // past the pinned header.
      if (from) {
        const el = document.getElementById(anchorId(from));
        if (el) {
          // Re-anchor each frame for ~2.5s. The browser re-measures everything on each call,
          // so as images and fonts settle, we stay locked on the target. The moment the user
          // scrolls away from our last set value we stop and leave them alone.
          const start = performance.now();
          let lastSet = -1;
          const anchor = () => {
            if (lastSet >= 0 && Math.abs(dom.main.scrollTop - lastSet) > 4) return;
            const r = el.getBoundingClientRect();
            const m = dom.main.getBoundingClientRect();
            const rel = r.top - m.top;
            if (rel < 60 || rel > 100) { // target is ~72 (scroll-margin), re-align only if off
              el.scrollIntoView({ block: 'start' });
              lastSet = dom.main.scrollTop;
            }
            if (performance.now() - start < 2500) requestAnimationFrame(anchor);
          };
          requestAnimationFrame(anchor);
        }
      } else {
        dom.main.scrollTop = 0;
      }
      selectTreeNode('s-' + (from || (data.sections[0] && data.sections[0].id)));
    } catch (err) {
      console.error(err);
      setViewHead('');
      dom.view.innerHTML = `<div class="msg-error">Failed to load part: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Some entries repeat their own label in the heading: "§ 261.5 [Reserved]".
  function tocTitle(node) {
    const l = (node.l || '').trim();
    const d = (node.d || '').trim();
    return l && d.startsWith(l) && d.length > l.length ? d.slice(l.length).trim() : d;
  }

  function findPartInTree(node, partId) {
    if (!node) return null;
    if (node.t === 'part' && String(node.id) === String(partId)) return node;
    if (node.c) {
      for (const ch of node.c) {
        const found = findPartInTree(ch, partId);
        if (found) return found;
      }
    }
    return null;
  }

  // --- Search Page ---
  async function loadSearchPage(query, scope) {
    currentSection = null;
    currentPart = null;
    clearTreeSelection();
    updateChatContext();
    document.title = 'Search · FRAMEWORK';
    setViewHead('');

    if (!query.trim()) {
      dom.view.innerHTML = '<div class="empty-state"><h2>Search</h2><p>Type a word, phrase or section number in the search box above.</p></div>';
      return;
    }

    const allTitles = scope === 'all' && installedTitles.length > 1;
    dom.view.innerHTML = `<div class="loading">Searching for “${escapeHtml(query)}”…</div>`;
    try {
      const url = allTitles
        ? `/api/search?q=${encodeURIComponent(query)}&title=all&limit=50`
        : `/api/${currentTitle}/search?q=${encodeURIComponent(query)}&limit=50`;
      const seq = routeSeq;
      const res = await fetch(url);
      const data = await res.json();
      if (seq !== routeSeq) return;

      let itemsHtml = '';
      if (!data.results || data.results.length === 0) {
        itemsHtml = `<div class="empty-state"><h2>No results</h2><p>Nothing in ${allTitles ? 'the installed titles' : 'Title ' + currentTitle} matches “${escapeHtml(query)}”. Try fewer or different words.</p></div>`;
      } else {
        itemsHtml = data.results.map(r => {
          // The FTS snippet already carries its own ellipses; show exactly one at each cut end.
          let snippet = (r.snippet || '').replace(/^[\s.…]+|[\s.…]+$/g, '');
          snippet = escapeHtml(snippet).replace(/\x02/g, '<mark>').replace(/\x03/g, '</mark>');
          const rTitle = r.title || currentTitle;
          return `
            <div class="result">
              <a class="result-title" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
                <span class="result-num">${escapeHtml(r.label)}</span>
                <span class="result-name">${escapeHtml(r.title_label || r.title)}</span>
                <span class="result-part">${allTitles ? `Title ${rTitle} · ` : ''}Part ${escapeHtml(r.part || '')}</span>
              </a>
              ${snippet ? `<div class="result-snippet">…${snippet}…</div>` : ''}
            </div>
          `;
        }).join('');
      }

      // Scope toggle: only meaningful when more than one title is installed.
      let scopeHtml = '';
      if (installedTitles.length > 1) {
        const qEnc = encodeURIComponent(query);
        scopeHtml = `<span class="search-scope" role="group" aria-label="Search scope">
          <a class="${allTitles ? '' : 'scope-on'}" href="#/search?q=${qEnc}"${allTitles ? '' : ' aria-current="true"'}>Title ${currentTitle}</a>
          <a class="${allTitles ? 'scope-on' : ''}" href="#/search?q=${qEnc}&scope=all"${allTitles ? ' aria-current="true"' : ''}>All ${installedTitles.length} titles</a>
        </span>`;
      }

      const total = Number(data.total || 0);
      dom.view.innerHTML = `
        <div class="doc-kicker">Search</div>
        <h1 class="doc-title">${escapeHtml(query)}</h1>
        <div class="search-meta"><span>${total.toLocaleString()} ${total === 1 ? 'result' : 'results'} · ${data.ms} ms</span>${scopeHtml}</div>
        <div class="results-list">${itemsHtml}</div>
      `;
      enterView();
    } catch (err) {
      dom.view.innerHTML = `<div class="msg-error">Search failed: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- Live Search Dropdown ---
  let searchTimer = null;
  let sdActive = -1; // index of the keyboard-highlighted dropdown row

  function moveSdActive(delta) {
    const items = [...dom.searchDropdown.querySelectorAll('.sd-item')];
    if (dom.searchDropdown.hidden || !items.length) return;
    sdActive = (sdActive + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === sdActive));
    items[sdActive].scrollIntoView({ block: 'nearest' });
  }

  dom.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    sdActive = -1;
    const q = dom.search.value.trim();
    if (!q) {
      dom.searchDropdown.hidden = true;
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/${currentTitle}/search?q=${encodeURIComponent(q)}&limit=6`);
        const data = await res.json();
        if (!data.results || data.results.length === 0) {
          dom.searchDropdown.innerHTML = `<div class="sd-footer">No quick matches. Press <kbd>Enter</kbd> to search the full text.</div>`;
        } else {
          const items = data.results.map(r => {
            let snip = (r.snippet || '').replace(/[\x02\x03]/g, '');
            const rTitle = r.title || currentTitle;
            return `
              <a class="sd-item" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
                <span class="sd-label">${escapeHtml(r.label)}</span>
                <span>${escapeHtml(r.title_label || r.title)}</span>
                ${snip ? `<span class="sd-snippet">${escapeHtml(snip)}</span>` : ''}
              </a>
            `;
          }).join('');
          dom.searchDropdown.innerHTML = items + `<div class="sd-footer"><kbd>Enter</kbd> All ${Number(data.total).toLocaleString()} results</div>`;
        }
        dom.searchDropdown.hidden = false;
      } catch (e) {
        dom.searchDropdown.hidden = true;
      }
    }, 180);
  });

  dom.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const items = dom.searchDropdown.querySelectorAll('.sd-item');
      if (!dom.searchDropdown.hidden && sdActive >= 0 && items[sdActive]) {
        window.location.hash = items[sdActive].getAttribute('href');
        dom.searchDropdown.hidden = true;
        dom.search.blur();
        return;
      }
      dom.searchDropdown.hidden = true;
      const q = dom.search.value.trim();
      if (q) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!dom.searchDropdown.hidden) {
        e.preventDefault();
        moveSdActive(e.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (e.key === 'Escape') {
      dom.searchDropdown.hidden = true;
    }
  });

  document.addEventListener('click', (e) => {
    if (!dom.search.contains(e.target) && !dom.searchDropdown.contains(e.target)) {
      dom.searchDropdown.hidden = true;
    }
  });

  // Hotkey for search & command palette (and chat)
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      dom.search.focus();
      dom.search.select();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'j' || (e.shiftKey && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      toggleChat();
    }
  });

  // --- Sidebar: drill-down contents ---
  //
  // Three levels, one at a time:
  // 1. Agencies (Subtitle A plus the chapters of Subtitle B), or every part via the "All parts" tab
  // 2. One agency's parts (subchapters as plain labels)
  // 3. One part's sections (subparts as plain labels)
  // The sticky header is a clickable breadcrumb plus one title; the tabs only show at the top level.
  // Every tree.json node gets a preorder key `k`; `treeIdx` holds parent links and id -> key maps.

  const LEAF_TYPES = new Set(['section', 'appendix']);
  const MAX_FILTER_RESULTS = 100;

  // Short, plain names for the agencies behind each chapter. Codes are searchable in the filter.
  // Keyed by title first: chapter numbers repeat across titles (Chapter I is the NLRB in
  // Title 29 but the EPA in Title 40). Titles or chapters without an entry fall back to
  // "Ch. N" plus the chapter's own heading.
  const AGENCY_META = {
    29: {
      'sub-A': { code: 'DOL', name: 'Office of the Secretary of Labor' },
      'ch-I': { code: 'NLRB', name: 'National Labor Relations Board' },
      'ch-II': { code: 'OLMS', name: 'Federal Transit Employee Protections' },
      'ch-III': { code: 'NRAB', name: 'National Railroad Adjustment Board' },
      'ch-IV': { code: 'OLMS', name: 'Labor-Management Standards (LMRDA)' },
      'ch-V': { code: 'WHD', name: 'Wage and Hour Division (FLSA, FMLA)' },
      'ch-IX': { code: 'CICBC', name: 'Construction Industry Collective Bargaining' },
      'ch-X': { code: 'NMB', name: 'National Mediation Board' },
      'ch-XII': { code: 'FMCS', name: 'Federal Mediation and Conciliation Service' },
      'ch-XIV': { code: 'EEOC', name: 'Equal Employment Opportunity Commission' },
      'ch-XVII': { code: 'OSHA', name: 'Occupational Safety and Health Admin' },
      'ch-XX': { code: 'OSHRC', name: 'Occupational Safety and Health Review' },
      'ch-XXV': { code: 'EBSA', name: 'Employee Benefits Security (ERISA)' },
      'ch-XXVII': { code: 'FMSHRC', name: 'Federal Mine Safety & Health Review' },
      'ch-XL': { code: 'PBGC', name: 'Pension Benefit Guaranty Corporation' },
    },
    40: {
      'ch-I': { code: 'EPA', name: 'Environmental Protection Agency' },
      'ch-IV': { code: 'DOJ', name: 'EPA and Department of Justice' },
      'ch-V': { code: 'CEQ', name: 'Council on Environmental Quality' },
      'ch-VI': { code: 'CSB', name: 'Chemical Safety and Hazard Investigation Board' },
      'ch-VII': { code: 'DOD', name: 'EPA and Defense: Vessel Discharge Standards' },
      'ch-VIII': { code: 'GCERC', name: 'Gulf Coast Ecosystem Restoration Council' },
      'ch-IX': { code: 'FPISC', name: 'Federal Permitting Improvement Steering Council' },
    },
    49: {
      'sub-A': { code: 'DOT', name: 'Office of the Secretary of Transportation' },
      'ch-I': { code: 'PHMSA', name: 'Pipeline and Hazardous Materials Safety Admin' },
      'ch-II': { code: 'FRA', name: 'Federal Railroad Administration' },
      'ch-III': { code: 'FMCSA', name: 'Federal Motor Carrier Safety Administration' },
      'ch-IV': { code: 'USCG', name: 'Coast Guard' },
      'ch-V': { code: 'NHTSA', name: 'National Highway Traffic Safety Admin' },
      'ch-VI': { code: 'FTA', name: 'Federal Transit Administration' },
      'ch-VII': { code: 'Amtrak', name: 'National Railroad Passenger Corporation' },
      'ch-VIII': { code: 'NTSB', name: 'National Transportation Safety Board' },
      'ch-X': { code: 'STB', name: 'Surface Transportation Board' },
      'ch-XII': { code: 'TSA', name: 'Transportation Security Administration' },
    },
  };

  function agencyMeta(node) {
    return (AGENCY_META[currentTitle] || {})[agencyKeyForNode(node)] || null;
  }

  const treeIdx = {
    nodes: [],
    parent: [],
    sections: new Map(),
    parts: new Map(),
    agencies: new Map(),
    partList: [],
    agencyList: []
  };
  let visited = loadVisited();
  let treePromise = null;
  let currentTreeKey = null;   // the section or part on screen
  let currentPartKey = null;   // the part that contains it
  let currentAgencyKey = null; // the agency/chapter that contains it
  let rootViewMode = lsGet('rootViewMode') === 'all-parts' ? 'all-parts' : 'agencies';
  let sideView = rootViewMode; // 'agencies', 'all-parts', or the key k of an agency or part
  let treeFilterState = null;  // { q, re, results } while the filter has text

  // Visited sections are tracked per title (section numbers repeat across titles).
  function visitedKey() {
    return currentTitle === 29 ? 'visited' : 'visited-' + currentTitle;
  }

  function loadVisited() {
    try { return new Set(JSON.parse(lsGet(visitedKey()) || '[]')); } catch (e) { return new Set(); }
  }

  async function switchTitle(newTitle) {
    if (newTitle === currentTitle && treeData) return;
    currentTitle = newTitle;
    fillTitleSelect();
    const titleMeta = installedTitles.find(t => t.title === newTitle);
    if (titleMeta) {
      metaInfo = titleMeta;
      dom.edition.textContent = `eCFR ${titleMeta.edition || ''}`;
    }
    dom.search.placeholder = `Search Title ${newTitle} or jump to a section…`;
    dom.chatText.placeholder = `Ask about this section, or anything in Title ${newTitle}…`;
    dom.sidebar.setAttribute('aria-label', `Title ${newTitle} contents`);
    treePromise = null;
    treeData = null;
    treeIdx.nodes = [];
    treeIdx.parent = [];
    treeIdx.sections = new Map();
    treeIdx.parts = new Map();
    treeIdx.agencies = new Map();
    treeIdx.partList = [];
    treeIdx.agencyList = [];
    currentTreeKey = null;
    currentPartKey = null;
    currentAgencyKey = null;
    clearFilterQuietly();
    visited = loadVisited();
    sideView = rootViewMode;
    dom.tree.innerHTML = '<div class="loading">Loading contents…</div>';
    await ensureTreeLoaded();
  }

  function ensureTreeLoaded() {
    if (!treePromise) {
      treePromise = fetch('/api/' + currentTitle + '/tree')
        .then(res => {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(data => {
          treeData = data;
          indexTree(data);
          renderSidebar();
        })
        .catch(err => {
          treePromise = null;
          dom.tree.innerHTML = `<div class="side-empty">Couldn't load the contents (${escapeHtml(err.message)}).</div>`;
          throw err;
        });
    }
    return treePromise;
  }

  function normalizeForMatch(s) {
    return ' ' + String(s).toLowerCase().replace(/[§,;:()[\]"'\/–—]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function formatRange(range) {
    return String(range || '').trim().replace(/\s*[–-]\s*/g, '–');
  }

  function isAgencyNode(node) {
    return !!node && (node.t === 'chapter' || (node.t === 'subtitle' && String(node.id) === 'A'));
  }

  function agencyKeyForNode(node) {
    if (!node) return '';
    if (node.t === 'subtitle') return 'sub-' + String(node.id || '').trim();
    if (node.t === 'chapter') return 'ch-' + String(node.id || '').trim();
    return '';
  }

  function agencyInfo(node) {
    if (!node) return { code: 'CFR', name: '', range: '' };
    const meta = agencyMeta(node) || {};
    const roman = /^[IVXLC]+$/.test(String(node.id)) ? node.id : '';
    const code = meta.code || (node.t === 'subtitle' ? `Sub. ${node.id}` : (roman ? `Ch. ${roman}` : 'Ch.'));
    // Fallback headings read "Agency, Department of X" or repeat "Chapter XI—": keep the agency.
    const name = meta.name || (node.d || node.l || '').trim().replace(/^Chapter\s+[IVXLC]+\s*[—–-]\s*/i, '').replace(/,\s*Department of [A-Z][A-Za-z ]+$/, '');
    return { code, name, range: formatRange(node.range) };
  }

  function agencyOf(k) {
    for (let p = k; p >= 0; p = treeIdx.parent[p]) {
      if (isAgencyNode(treeIdx.nodes[p])) return p;
    }
    return null;
  }

  function indexTree(root) {
    const walk = (node, parentKey) => {
      const k = treeIdx.nodes.length;
      node.k = k;
      treeIdx.nodes.push(node);
      treeIdx.parent.push(parentKey);
      const label = (node.l || '').trim();
      const desc = (node.d || '').trim();
      let hayText = desc && desc !== label ? `${label} ${desc}` : label || desc;
      node.partCount = 0;

      if (isAgencyNode(node)) {
        treeIdx.agencies.set(agencyKeyForNode(node), k);
        treeIdx.agencyList.push(k);
        const meta = agencyMeta(node);
        if (meta) hayText += ` ${meta.code} ${meta.name}`; // so "osha" or "erisa" finds the agency
      }
      node.hay = normalizeForMatch(hayText);

      if (LEAF_TYPES.has(node.t)) {
        treeIdx.sections.set(String(node.id), k);
        node.n = node.r ? 0 : 1;
        return;
      }
      if (node.t === 'part') {
        treeIdx.parts.set(String(node.id), k);
        if (!node.r) treeIdx.partList.push(k);
      }
      node.n = 0;
      for (const child of node.c || []) {
        walk(child, k);
        node.n += child.n;
        if (child.t === 'part' && !child.r) node.partCount += 1;
        else if (child.partCount) node.partCount += child.partCount;
      }
    };
    walk(root, -1);
  }

  function isWithin(k, ancestorK) {
    for (let p = k; p >= 0; p = treeIdx.parent[p]) if (p === ancestorK) return true;
    return false;
  }

  function partOf(k) {
    for (let p = k; p >= 0; p = treeIdx.parent[p]) {
      if (treeIdx.nodes[p].t === 'part') return p;
    }
    return null;
  }

  // --- Rendering ---

  function rowParts(node) {
    const l = (node.l || '').trim();
    let d = (node.d || '').trim();
    // Some entries repeat their own label: "§ 1910.139 [Reserved]".
    if (l && d.startsWith(l) && d.length > l.length) d = d.slice(l.length).trim();
    if (node.t === 'appendix') {
      const m = /^Appendix\s+(?!to\b)(\S+)/i.exec(l);
      return [m ? `App. ${m[1]}` : 'App.', d || l];
    }
    return [String(node.id), d];
  }

  function tooltipFor(node) {
    const l = (node.l || '').trim();
    const d = (node.d || '').trim();
    return d && d !== l ? `${l} — ${d}` : (l || d);
  }

  function hl(str) {
    const text = String(str ?? '');
    const re = treeFilterState && treeFilterState.re;
    if (!re) return escapeHtml(text);
    let out = '';
    let last = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index + m[1].length;
      out += escapeHtml(text.slice(last, start)) + '<mark>' + escapeHtml(m[2]) + '</mark>';
      last = start + m[2].length;
    }
    return out + escapeHtml(text.slice(last));
  }

  function itemHtml(node) {
    const leaf = LEAF_TYPES.has(node.t);
    const [num, text] = rowParts(node);
    const href = `#/${leaf ? 'section' : 'part'}/${encodeURIComponent(node.id)}`;
    // `.current` = the page on screen; `.ancestor-current` = the part that contains it.
    const isPage = node.k === currentTreeKey;
    const isAncestor = !isPage && !leaf && node.k === currentPartKey;
    const cls = ['side-item', leaf ? 'is-section' : 'is-part'];
    if (isPage) cls.push('current');
    if (isAncestor) cls.push('ancestor-current');
    if (leaf && visited.has(String(node.id))) cls.push('visited');
    return `<a class="${cls.join(' ')}" href="${href}" data-k="${node.k}" title="${escapeHtml(tooltipFor(node))}"${isPage ? ' aria-current="page"' : ''}>`
      + `<span class="side-num">${hl(num)}</span><span class="side-text">${hl(text)}</span></a>`;
  }

  function agencyRowHtml(node) {
    const info = agencyInfo(node);
    // An agency is never the page itself, only the container of it.
    const isAncestor = node.k === currentAgencyKey;
    const meta = [info.range && `Parts ${info.range}`, plural(node.partCount || 0, 'part')].filter(Boolean).join(' · ');
    return `<button type="button" class="side-agency${isAncestor ? ' ancestor-current' : ''}" data-action="agency" data-k="${node.k}"`
      + ` title="${escapeHtml(tooltipFor(node))}">`
      + `<span class="side-agency-code">${hl(info.code)}</span>`
      + `<span class="side-agency-body"><span class="side-agency-name">${hl(info.name)}</span>`
      + `<span class="side-agency-meta">${escapeHtml(meta)}</span></span></button>`;
  }

  function agencyLabelHtml(agencyNode) {
    const info = agencyInfo(agencyNode);
    return `<div class="side-label"><span class="side-label-code">${escapeHtml(info.code)}</span> ${escapeHtml(info.name)}</div>`;
  }

  // Rows in tree order, with a small agency label each time the agency changes.
  // Used for the all-parts list and for filter results.
  function groupedHtml(keys) {
    let html = '';
    let lastAgency = -2;
    for (const k of keys) {
      const node = treeIdx.nodes[k];
      if (isAgencyNode(node)) {
        html += agencyRowHtml(node);
        lastAgency = k;
        continue;
      }
      const agency = agencyOf(k);
      if (agency !== lastAgency) {
        if (agency != null) html += agencyLabelHtml(treeIdx.nodes[agency]);
        lastAgency = agency;
      }
      html += itemHtml(node);
    }
    return `<div class="side-list">${html}</div>`;
  }

  function crumbsHtml(crumbs) {
    const parts = crumbs.map((c, i) => {
      if (i === crumbs.length - 1) return `<span class="side-crumb-current" aria-current="location">${escapeHtml(c.label)}</span>`;
      const kAttr = c.k != null ? ` data-k="${c.k}"` : '';
      return `<button type="button" class="side-crumb" data-action="${c.action}"${kAttr}>${escapeHtml(c.label)}</button>`;
    });
    return `<nav class="side-breadcrumbs" aria-label="Sidebar location">${parts.join('<span class="side-sep" aria-hidden="true">›</span>')}</nav>`;
  }

  function agenciesListHtml() {
    return `<div class="side-list side-agencies-list">${treeIdx.agencyList.map(k => agencyRowHtml(treeIdx.nodes[k])).join('')}</div>`;
  }

  function agencyViewHtml(agency) {
    const info = agencyInfo(agency);
    let body = '';
    for (const c of agency.c || []) {
      if (c.r) continue;
      if (c.t === 'part') {
        body += itemHtml(c);
      } else if (c.t === 'subchapter') {
        const parts = (c.c || []).filter(ch => ch.t === 'part' && !ch.r);
        if (!parts.length) continue;
        const l = (c.l || '').trim();
        const d = (c.d || '').trim();
        body += `<div class="side-label">${escapeHtml(d ? `${l} — ${d}` : l)}</div>`;
        body += parts.map(itemHtml).join('');
      }
    }
    const meta = [info.range && `Parts ${info.range}`, plural(agency.partCount || 0, 'part')].filter(Boolean).join(' · ');
    return `<div class="side-head">`
      + crumbsHtml([{ label: 'Agencies', action: 'agencies' }, { label: info.code }])
      + `<div class="side-heading" title="${escapeHtml(tooltipFor(agency))}"><div class="side-heading-title">${escapeHtml(info.name)}</div>`
      + `<div class="side-heading-meta">${escapeHtml(meta)}</div></div>`
      + `</div><div class="side-list">${body}</div>`;
  }

  function partsListHtml() {
    return groupedHtml(treeIdx.partList);
  }

  // Subparts in the part view fold. Folded subparts are remembered per title and part in
  // localStorage ('sideFolded': ["29|1910|A", …]); the subpart holding the page on screen
  // always opens (see openCurrentGroup).
  let foldedGroups = (() => {
    try { return new Set(JSON.parse(lsGet('sideFolded') || '[]')); } catch (e) { return new Set(); }
  })();
  function groupKey(part, sub) { return `${currentTitle}|${part.id}|${sub.id}`; }
  function saveFolded() { lsSet('sideFolded', JSON.stringify([...foldedGroups])); }

  function setGroupOpen(group, open, save = true) {
    group.classList.toggle('is-folded', !open);
    group.querySelector('.side-group-toggle')?.setAttribute('aria-expanded', String(open));
    if (group.dataset.group) {
      if (open) foldedGroups.delete(group.dataset.group); else foldedGroups.add(group.dataset.group);
      if (save) saveFolded();
    }
  }

  function partViewHtml(part) {
    const walk = (node) => {
      let out = '';
      for (const c of node.c || []) {
        if (c.r) continue;
        if (LEAF_TYPES.has(c.t)) {
          out += itemHtml(c);
        } else if (c.n) {
          const l = (c.l || '').trim();
          const d = (c.d || '').trim();
          if (c.t === 'subpart') {
            const key = groupKey(part, c);
            const folded = foldedGroups.has(key) && !(currentTreeKey != null && isWithin(currentTreeKey, c.k));
            out += `<div class="side-group${folded ? ' is-folded' : ''}" data-group="${escapeHtml(key)}">`
              + `<button type="button" class="side-label side-group-toggle" data-action="toggle-group" aria-expanded="${!folded}">`
              + `<span class="side-group-name">${escapeHtml(d ? `${l} — ${d}` : l)}</span>${icon('chevronDown', 'side-group-caret')}</button>`
              + `<div class="side-group-body"><div class="side-group-inner">${walk(c)}</div></div></div>`;
          } else {
            out += `<div class="side-label minor">${escapeHtml(d || l)}</div>` + walk(c);
          }
        }
      }
      return out;
    };
    const body = walk(part);

    // The breadcrumb leads back the way you came: through the agency, or to the all-parts list.
    const agencyKey = agencyOf(part.k);
    const crumbs = rootViewMode === 'agencies' && agencyKey != null
      ? [{ label: 'Agencies', action: 'agencies' }, { label: agencyInfo(treeIdx.nodes[agencyKey]).code, action: 'agency', k: agencyKey }]
      : [{ label: 'All parts', action: 'parts' }];
    crumbs.push({ label: `Part ${part.id}` });

    return `<div class="side-head">`
      + crumbsHtml(crumbs)
      + `<a class="side-part-title${part.k === currentTreeKey ? ' current' : ''}" href="#/part/${encodeURIComponent(part.id)}"${part.k === currentTreeKey ? ' aria-current="page"' : ''}>${escapeHtml((part.d || '').trim())}</a>`
      + `</div><div class="side-list">${body}</div>`;
  }

  function filterResultsHtml() {
    const f = treeFilterState;
    const q = f.q.trim();
    const fullText = `<a class="side-fulltext" href="#/search?q=${encodeURIComponent(q)}">Search the full text for “${escapeHtml(q)}”</a>`;
    if (!f.results.length) return `<div class="side-empty">Nothing matches.</div>${fullText}`;
    return groupedHtml(f.results) + fullText;
  }

  function updateNavTabsUI() {
    const tabs = document.getElementById('side-nav-tabs');
    if (!tabs) return;
    // The switch stays at every level and shows the mode you're browsing in (inside a part
    // too); clicking either option returns to that top-level list. Filter results ignore
    // the mode, so it hides while the filter has text.
    tabs.hidden = !!treeFilterState;
    const isAllParts = rootViewMode === 'all-parts';
    const tabAgencies = document.getElementById('tab-agencies');
    const tabParts = document.getElementById('tab-parts');
    if (tabAgencies && tabParts) {
      tabAgencies.classList.toggle('active', !isAllParts);
      tabAgencies.setAttribute('aria-selected', String(!isAllParts));
      tabParts.classList.toggle('active', isAllParts);
      tabParts.setAttribute('aria-selected', String(isAllParts));
      tabParts.textContent = `All ${treeIdx.partList.length} parts`;
    }
  }

  function renderSidebar() {
    if (!treeData) return;
    updateNavTabsUI();
    if (treeFilterState) dom.tree.innerHTML = filterResultsHtml();
    else if (sideView === 'agencies') dom.tree.innerHTML = agenciesListHtml();
    else if (sideView === 'all-parts') dom.tree.innerHTML = partsListHtml();
    else if (typeof sideView === 'number') {
      const node = treeIdx.nodes[sideView];
      dom.tree.innerHTML = isAgencyNode(node) ? agencyViewHtml(node) : partViewHtml(node);
    }
    dom.tree.scrollTop = 0;
  }

  function clearFilterQuietly() {
    if (!treeFilterState && !dom.treeFilter.value) return;
    clearTimeout(filterTimer);
    dom.treeFilter.value = '';
    treeFilterState = null;
  }

  function showAgenciesList() {
    rootViewMode = 'agencies';
    lsSet('rootViewMode', 'agencies');
    sideView = 'agencies';
    renderSidebar();
    revealCurrent(false);
  }

  function showAgencyView(k) {
    rootViewMode = 'agencies';
    lsSet('rootViewMode', 'agencies');
    sideView = k;
    renderSidebar();
    revealCurrent(false);
  }

  function showPartsList() {
    rootViewMode = 'all-parts';
    lsSet('rootViewMode', 'all-parts');
    sideView = 'all-parts';
    renderSidebar();
    revealCurrent(false);
  }

  // --- Current item ---

  function selectTreeNode(elementId) {
    if (!treeData) return;
    const m = /^([sp])-(.+)$/.exec(elementId);
    if (!m) return;
    const k = (m[1] === 's' ? treeIdx.sections : treeIdx.parts).get(m[2]);
    if (k === undefined) return;
    currentTreeKey = k;
    currentPartKey = partOf(k);
    currentAgencyKey = agencyOf(k);
    if (m[1] === 's') markVisited(m[2]);

    const switchPart = currentPartKey != null && sideView !== currentPartKey;
    if (switchPart) sideView = currentPartKey; // clearing the filter will land here
    if (treeFilterState) {
      refreshCurrent();
      return;
    }
    if (switchPart) {
      const hadFocus = dom.tree.contains(document.activeElement);
      renderSidebar();
      revealCurrent(false);
      // Keep keyboard users inside the sidebar when the list is replaced.
      if (hadFocus) (dom.tree.querySelector('.side-item.current') || dom.tree.querySelector('.side-part-title'))?.focus({ preventScroll: true });
    } else {
      refreshCurrent();
      revealCurrent(true);
    }
  }

  // Only the page on screen gets `.current` and aria-current="page"; the part and agency
  // containing it get `.ancestor-current`. Mirrors the classes set in itemHtml/agencyRowHtml.
  function refreshCurrent() {
    dom.tree.querySelectorAll('.current, .ancestor-current').forEach(el => {
      el.classList.remove('current', 'ancestor-current');
      el.removeAttribute('aria-current');
    });
    if (currentTreeKey == null) return;
    const markPage = (el) => { if (el) { el.classList.add('current'); el.setAttribute('aria-current', 'page'); } };
    const markAncestor = (el) => { if (el && !el.classList.contains('current')) el.classList.add('ancestor-current'); };

    const page = dom.tree.querySelector(`.side-item[data-k="${currentTreeKey}"]`);
    markPage(page);
    // Navigating into a folded subpart opens it.
    const folded = page && page.closest('.side-group.is-folded');
    if (folded) setGroupOpen(folded, true);
    if (currentTreeKey === currentPartKey) {
      if (sideView === currentPartKey) markPage(dom.tree.querySelector('.side-part-title'));
    } else {
      markAncestor(dom.tree.querySelector(`.side-item.is-part[data-k="${currentPartKey}"]`));
    }
    markAncestor(dom.tree.querySelector(`.side-agency[data-k="${currentAgencyKey}"]`));
  }

  // Home, search and not-found pages don't correspond to anything in the sidebar.
  function clearTreeSelection() {
    if (currentTreeKey == null) return;
    currentTreeKey = null;
    currentPartKey = null;
    currentAgencyKey = null;
    refreshCurrent();
  }

  function revealCurrent(smooth = false) {
    const el = dom.tree.querySelector('.side-item.current')
      || dom.tree.querySelector('.side-item.ancestor-current, .side-agency.ancestor-current');
    if (el) scrollIntoTree(el, smooth);
  }

  function scrollIntoTree(el, smooth) {
    const box = dom.tree.getBoundingClientRect();
    if (!box.height) return; // sidebar hidden
    const head = dom.tree.querySelector('.side-head');
    const top = box.top + (head && !head.contains(el) ? head.offsetHeight : 0);
    const r = el.getBoundingClientRect();
    if (r.top < top + 4 || r.bottom > box.bottom - 4) {
      dom.tree.scrollTo({ top: dom.tree.scrollTop + r.top - box.top - box.height / 3, behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  function markVisited(id) {
    if (visited.has(id)) return;
    visited.add(id);
    lsSet(visitedKey(), JSON.stringify([...visited]));
    dom.tree.querySelector(`.side-item.is-section[data-k="${treeIdx.sections.get(id)}"]`)?.classList.add('visited');
  }

  // --- Filter ---

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function computeFilter(q) {
    const cleaned = q.trim().replace(/^\d{1,2}\s*c\.?\s*f\.?\s*r\.?\s*/i, '');
    const tokens = [...new Set(normalizeForMatch(cleaned).trim().split(' ').filter(Boolean))].slice(0, 12);
    if (!tokens.length) return null;

    // Tokens match the start of a word. An agency, part or section matches if its own
    // heading has every token, or has at least one and its ancestors supply the rest
    // ("osha ladders" finds § 1910.23). Context-only matches are skipped under an
    // ancestor that matches everything itself, so "osha" lists the agency, not 3,000 rows.
    const ALL = (1 << tokens.length) - 1;
    const total = treeIdx.nodes.length;
    const own = new Int32Array(total);
    const anc = new Int32Array(total);
    const ancFull = new Uint8Array(total);
    const results = [];
    for (const node of treeIdx.nodes) {
      const k = node.k;
      const p = treeIdx.parent[k];
      let m = 0;
      for (let i = 0; i < tokens.length; i++) if (node.hay.includes(' ' + tokens[i])) m |= 1 << i;
      own[k] = m;
      if (p >= 0) {
        anc[k] = anc[p] | own[p];
        ancFull[k] = ancFull[p] || own[p] === ALL ? 1 : 0;
      }
      if (node.r || !(node.t === 'part' || LEAF_TYPES.has(node.t) || isAgencyNode(node))) continue;
      if (m === ALL || (m !== 0 && (m | anc[k]) === ALL && !ancFull[k])) {
        results.push(k);
        if (results.length >= MAX_FILTER_RESULTS) break;
      }
    }
    const alt = tokens.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp(`(^|[\\s§,;:()\\[\\]"'/\\u2013\\u2014])(${alt})`, 'gi');
    return { q, re, results };
  }

  function applyTreeFilter() {
    if (!treeData) return;
    treeFilterState = computeFilter(dom.treeFilter.value);
    renderSidebar();
    if (!treeFilterState) revealCurrent(false);
  }

  let filterTimer = 0;
  dom.treeFilter.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyTreeFilter, 120);
  });

  dom.treeFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (dom.treeFilter.value) {
        dom.treeFilter.value = '';
        applyTreeFilter();
      } else {
        dom.treeFilter.blur();
      }
    } else if (e.key === 'ArrowDown') {
      const first = dom.tree.querySelector('a, button');
      if (first) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(filterTimer);
      applyTreeFilter();
      const q = dom.treeFilter.value.trim();
      const first = dom.tree.querySelector('.side-item, .side-agency');
      if (first) {
        if (first.tagName === 'A') window.location.hash = first.getAttribute('href');
        else first.click();
      } else if (q) {
        window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
      }
    }
  });

  // --- Mouse & keyboard ---

  dom.tree.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-action="toggle-group"]');
    if (toggle) {
      const group = toggle.closest('.side-group');
      const open = group.classList.contains('is-folded');
      if (e.altKey) {
        // Alt-click folds or opens every subpart in the part at once.
        dom.tree.querySelectorAll('.side-group').forEach(g => setGroupOpen(g, open, false));
        saveFolded();
      } else {
        setGroupOpen(group, open);
      }
      return;
    }
    const action = e.target.closest('[data-action]');
    if (action) {
      const kind = action.dataset.action;
      const k = parseInt(action.dataset.k, 10);
      clearFilterQuietly(); // picking an agency from filter results opens it
      if (kind === 'agencies') showAgenciesList();
      else if (kind === 'parts') showPartsList();
      else if (kind === 'agency' && !isNaN(k)) showAgencyView(k);
      else return;
      // Keyboard users lose focus when the clicked control is replaced; put it somewhere useful.
      if (e.detail === 0) (dom.tree.querySelector('.current, .ancestor-current') || dom.tree.querySelector('a, button'))?.focus({ preventScroll: true });
      return;
    }
    const link = e.target.closest('a');
    if (link && link.getAttribute('href') === window.location.hash) document.body.classList.remove('nav-open');
  });

  const sideNavTabs = document.getElementById('side-nav-tabs');
  if (sideNavTabs) {
    sideNavTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.side-nav-tab');
      if (!btn) return;
      if (btn.dataset.mode === 'agencies') showAgenciesList();
      else showPartsList();
    });
  }

  dom.tree.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    // Skip rows inside folded subparts.
    const items = [...dom.tree.querySelectorAll('a, button')].filter(el => !el.closest('.side-group.is-folded .side-group-body'));
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      next.focus({ preventScroll: true });
      scrollIntoTree(next, false);
    } else if (e.key === 'ArrowUp') {
      dom.treeFilter.focus();
    }
  });

  // --- Sidebar visibility & width (☰ toggles; drag the right edge to resize) ---

  function setSidebarHidden(hidden) {
    document.documentElement.classList.toggle('sidebar-hidden', hidden);
    lsSet('sidebarHidden', hidden ? '1' : '0');
    if (!hidden) requestAnimationFrame(() => revealCurrent(false));
  }

  function setSidebarWidth(px, save) {
    const w = Math.round(Math.min(560, Math.max(220, px)));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    dom.sidebarResizer.setAttribute('aria-valuenow', String(w));
    if (save) lsSet('sidebarW', String(w));
  }

  dom.navBackdrop.addEventListener('click', () => document.body.classList.remove('nav-open'));

  dom.sidebarResizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = dom.sidebarResizer;
    const startX = e.clientX;
    const startW = dom.sidebar.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const move = (ev) => setSidebarWidth(startW + ev.clientX - startX, false);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      setSidebarWidth(dom.sidebar.getBoundingClientRect().width, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  dom.sidebarResizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = dom.sidebar.getBoundingClientRect().width;
    setSidebarWidth(w + (e.key === 'ArrowRight' ? 20 : -20), true);
  });

  dom.sidebarResizer.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty('--sidebar-w');
    dom.sidebarResizer.setAttribute('aria-valuenow', String(Math.round(dom.sidebar.getBoundingClientRect().width)));
    lsSet('sidebarW', '');
  });
  dom.sidebarResizer.setAttribute('aria-valuenow', String(Math.round(dom.sidebar.getBoundingClientRect().width) || 300));

  // --- Claude Chat Assistant ---
  function toggleChat() {
    if (dom.chat.hidden) {
      openChat();
    } else {
      closeChat();
    }
  }

  function openChat() {
    dom.chat.hidden = false;
    dom.layout.classList.add('chat-open');
    dom.chatToggle.classList.add('is-active');
    dom.chatToggle.setAttribute('aria-expanded', 'true');
    if (chatHistory.length === 0) {
      renderChatWelcome();
    }
    dom.chatText.focus();
  }

  function closeChat() {
    const hadFocus = dom.chat.contains(document.activeElement);
    dom.chat.hidden = true;
    dom.layout.classList.remove('chat-open');
    dom.chatToggle.classList.remove('is-active');
    dom.chatToggle.setAttribute('aria-expanded', 'false');
    if (hadFocus) dom.chatToggle.focus();
  }

  function updateChatContext() {
    if (currentSection) {
      dom.chatContext.hidden = false;
      dom.contextLabel.textContent = `${currentSection.label} (Title ${currentTitle})`;
    } else {
      dom.chatContext.hidden = true;
    }
    // An open, unused chat keeps its starter prompts in step with the page.
    if (!dom.chat.hidden && chatHistory.length === 0 && !isGenerating) renderChatWelcome();
  }

  function renderChatWelcome() {
    if (!chatConfig.configured) {
      dom.chatMessages.innerHTML = `
        <div class="setup-card">
          <h3>Connect Claude</h3>
          <p>Reading and search work without it. To ask questions and summarize sections, add an Anthropic API key:</p>
          <ol>
            <li>Create a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a></li>
            <li>Add it to <code>reader/.env</code>:
              <pre>ANTHROPIC_API_KEY=sk-ant-…</pre>
            </li>
            <li>Restart the reader.</li>
          </ol>
        </div>
      `;
      return;
    }

    // A key is set but the model list couldn't be loaded (rejected key, no network).
    if (chatConfig.error) {
      dom.chatMessages.innerHTML = `
        <div class="setup-card">
          <h3>Claude isn’t available</h3>
          <p class="setup-error">${escapeHtml(chatConfig.error)}</p>
          <p>Reading and search still work in the meantime.</p>
        </div>
      `;
      return;
    }

    const HOME_PROMPTS = {
      29: [
        'How do overtime exemptions work under Part 541?',
        'What are OSHA’s main hazard communication rules?',
        'What are employer responsibilities under FMLA?',
      ],
      40: [
        'What makes a waste “hazardous” under RCRA?',
        'When does a facility need a Title V operating permit?',
        'What has to be reported after a chemical spill, and to whom?',
      ],
      49: [
        'What are the placarding rules for hazmat shipments?',
        'Who needs a CDL, and what disqualifies a driver?',
        'Which carriers are subject to the FMCSA safety regulations?',
      ],
    };

    let prompts = [
      'What are the key requirements in this section?',
      'Who is exempt and who is covered?',
      'Draft an audit and compliance checklist for this rule.'
    ];

    if (!currentSection) {
      prompts = HOME_PROMPTS[currentTitle] || [
        'What does this title cover, at a high level?',
        'What are the most important definitions in this title?',
        'Find the penalty and enforcement provisions in this title.',
      ];
    }

    const titleList = installedTitles.map(t => 'Title ' + t.title).join(', ') || `Title ${currentTitle}`;
    dom.chatMessages.innerHTML = `
      <div class="chat-empty">
        <h3>Ask Claude about ${currentSection ? escapeHtml(currentSection.label) : 'Title ' + currentTitle}</h3>
        <p>Claude searches and reads the full regulation text across ${escapeHtml(titleList)}. Select any passage in a section to ask about it.</p>
        <div class="suggestions">
          ${prompts.map(p => `<button type="button" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
        </div>
      </div>
    `;

    dom.chatMessages.querySelectorAll('.suggestions button').forEach(b => {
      b.addEventListener('click', () => {
        dom.chatText.value = b.dataset.prompt;
        submitChat();
      });
    });
  }

  const TOOL_LABELS = {
    search_regulations: 'Searching the regulations…',
    read_section: 'Reading a section…',
    list_part: 'Looking through a part…',
  };

  async function submitChat() {
    const text = dom.chatText.value.trim();
    if (!text || isGenerating) return;

    if (!chatConfig.configured) {
      openChat();
      return;
    }
    if (!(dom.modelSelect.value || chatConfig.default)) {
      showToast(chatConfig.error || 'Claude isn’t available right now.', 5000);
      return;
    }

    dom.chatText.value = '';
    dom.chatText.style.height = 'auto';

    // Add user message to UI and history
    chatHistory.push({ role: 'user', content: text });
    appendChatMessage('user', text);

    const assistantMsgEl = appendChatMessage('assistant', '');
    isGenerating = true;
    dom.chatSend.disabled = true;

    const model = dom.modelSelect.value || chatConfig.default;
    const includeContext = dom.contextToggle.checked && currentSection;
    const sectionId = includeContext ? currentSection.id : null;
    let replyText = '';

    try {
      const res = await fetch('/api/' + currentTitle + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          section_id: sectionId,
          model
        })
      });

      if (!res.ok) {
        const err = await res.json();
        assistantMsgEl.innerHTML = `<div class="msg-error">${escapeHtml(err.detail || 'Request failed')}</div>`;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let toolsEl = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));

          if (ev.type === 'tool') {
            if (!toolsEl) {
              toolsEl = document.createElement('div');
              toolsEl.className = 'tool-activity';
              assistantMsgEl.prepend(toolsEl);
            }
            const chip = document.createElement('span');
            chip.className = 'tool-chip running';
            chip.id = `tool-${Date.now()}`;
            chip.textContent = TOOL_LABELS[ev.name] || `Using ${ev.name}…`;
            toolsEl.appendChild(chip);
          } else if (ev.type === 'tool_result') {
            if (toolsEl && toolsEl.lastElementChild) {
              toolsEl.lastElementChild.className = 'tool-chip';
              toolsEl.lastElementChild.textContent = ev.summary || `Finished ${ev.name}`;
            }
          } else if (ev.type === 'text') {
            replyText += ev.text;
            let contentDiv = assistantMsgEl.querySelector('.md');
            if (!contentDiv) {
              contentDiv = document.createElement('div');
              contentDiv.className = 'md';
              assistantMsgEl.appendChild(contentDiv);
            }
            contentDiv.innerHTML = renderMarkdown(replyText);
            dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
          } else if (ev.type === 'error') {
            const errDiv = document.createElement('div');
            errDiv.className = 'msg-error';
            errDiv.textContent = ev.message;
            assistantMsgEl.appendChild(errDiv);
          }
        }
      }

    } catch (err) {
      assistantMsgEl.innerHTML = `<div class="msg-error">Chat error: ${escapeHtml(err.message)}</div>`;
    } finally {
      // Keep history alternating user/assistant: a turn with no reply is dropped
      // so the next send doesn't carry an empty or unpaired message.
      if (replyText) chatHistory.push({ role: 'assistant', content: replyText });
      else chatHistory.pop();
      isGenerating = false;
      dom.chatSend.disabled = false;
    }
  }

  function appendChatMessage(role, content) {
    // Clear welcome empty state if present
    const empty = dom.chatMessages.querySelector('.chat-empty, .setup-card');
    if (empty) empty.remove();

    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    if (role === 'user') {
      msg.textContent = content;
    } else {
      if (content) {
        msg.innerHTML = `<div class="md">${renderMarkdown(content)}</div>`;
      }
    }
    dom.chatMessages.appendChild(msg);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    return msg;
  }

  // Auto-resize chat textarea
  dom.chatText.addEventListener('input', () => {
    dom.chatText.style.height = 'auto';
    dom.chatText.style.height = Math.min(dom.chatText.scrollHeight, 180) + 'px';
  });

  dom.chatText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitChat();
    }
  });

  dom.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitChat();
  });

  dom.chatNew.addEventListener('click', () => {
    chatHistory = [];
    renderChatWelcome();
  });

  dom.chatToggle.addEventListener('click', toggleChat);
  dom.chatClose.addEventListener('click', closeChat);

  // --- Selection Floating Tool ("Ask about this") ---
  let selectedText = '';
  document.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    const str = sel.toString().trim();
    if (str.length > 10 && dom.view.contains(sel.anchorNode)) {
      selectedText = str;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      dom.askFloat.hidden = false;
      // Keep the popover inside the viewport: flip above the selection near the bottom edge.
      const w = dom.askFloat.offsetWidth;
      const h = dom.askFloat.offsetHeight;
      const below = rect.bottom + 8;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 8) : below;
      const left = Math.min(Math.max(10, rect.left), window.innerWidth - w - 10);
      dom.askFloat.style.top = `${window.scrollY + top}px`;
      dom.askFloat.style.left = `${window.scrollX + left}px`;
    } else {
      dom.askFloat.hidden = true;
    }
  });

  // The popover is positioned against the viewport; hide it once the text scrolls away.
  dom.main.addEventListener('scroll', () => {
    if (!dom.askFloat.hidden) dom.askFloat.hidden = true;
  }, { passive: true });

  dom.askFloat.addEventListener('click', (e) => {
    const action = e.target.dataset.ask;
    if (!action || !selectedText) return;
    openChat();
    if (action === 'explain') {
      dom.chatText.value = `Can you explain what this clause means in plain English?\n\n"${selectedText}"`;
    } else {
      dom.chatText.value = `Regarding this provision: "${selectedText}"\n\n`;
    }
    dom.askFloat.hidden = true;
    dom.chatText.focus();
  });

  // --- Theme & Nav Toggles ---
  dom.themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    lsSet('theme', next);
  });

  const chatKbd = document.getElementById('chat-kbd');
  if (chatKbd) chatKbd.textContent = isMac ? '⌘K' : 'Ctrl K';

  dom.navToggle.addEventListener('click', () => {
    if (isMobile()) {
      document.body.classList.toggle('nav-open');
      if (document.body.classList.contains('nav-open')) requestAnimationFrame(() => revealCurrent());
    } else {
      setSidebarHidden(!document.documentElement.classList.contains('sidebar-hidden'));
    }
  });

  // --- Init ---
  async function init() {
    try {
      const titlesRes = await fetch('/api/titles');
      if (titlesRes.ok) {
        installedTitles = await titlesRes.json();
        // Title 29 is the default, but it may have been removed in the library.
        if (installedTitles.length && !installedTitles.some(t => t.title === currentTitle)) {
          await switchTitle(installedTitles[0].title);
        }
        fillTitleSelect();
      }

      const [metaRes, modelsRes] = await Promise.all([
        fetch('/api/' + currentTitle + '/meta'),
        fetch('/api/' + currentTitle + '/models'),
        ensureTreeLoaded()
      ]);

      if (metaRes.ok) {
        metaInfo = await metaRes.json();
        dom.edition.textContent = `eCFR ${metaInfo.edition || ''}`;
      }

      if (modelsRes.ok) {
        chatConfig = await modelsRes.json();
        if (chatConfig.configured && chatConfig.models.length > 0) {
          dom.modelSelect.innerHTML = chatConfig.models.map(m => `
            <option value="${escapeHtml(m.id)}" ${m.id === chatConfig.default ? 'selected' : ''}>
              ${escapeHtml(m.name)}
            </option>
          `).join('');
          dom.modelSelect.hidden = false;
        } else {
          // No key, or the key was rejected: the chat panel explains; an empty picker only adds noise.
          dom.modelSelect.innerHTML = '';
          dom.modelSelect.hidden = true;
        }
      }
    } catch (e) {
      console.warn('Initialization warnings:', e);
    }

    handleRoute();
    // A download may already be running (started in another tab or before a reload).
    getJSON('/api/library/jobs').then(snap => { setJobs(snap); pollJobsIfActive(); }).catch(() => {});
  }

  init();
})();

