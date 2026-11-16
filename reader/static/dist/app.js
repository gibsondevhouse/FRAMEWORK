// src/app.js
(function() {
	"use strict";
	let currentTitle = 29;
	let installedTitles = [];
	let treeData = null;
	let currentSection = null;
	let activeRoute = "";
	let metaInfo = {};
	let chatConfig = {
		configured: false,
		models: [],
		default: null
	};
	let chatHistory = [];
	let isGenerating = false;
	let routeSeq = 0;
	const dom = {
		topbar: document.querySelector(".topbar"),
		titleSelect: document.getElementById("title-select"),
		titlePop: document.getElementById("title-pop"),
		navToggle: document.getElementById("nav-toggle"),
		search: document.getElementById("search"),
		searchDropdown: document.getElementById("search-dropdown"),
		edition: document.getElementById("edition"),
		themeToggle: document.getElementById("theme-toggle"),
		chatToggle: document.getElementById("chat-toggle"),
		layout: document.getElementById("layout"),
		sidebar: document.getElementById("sidebar"),
		sidebarResizer: document.getElementById("sidebar-resizer"),
		navBackdrop: document.getElementById("nav-backdrop"),
		treeFilter: document.getElementById("tree-filter"),
		tree: document.getElementById("tree"),
		main: document.getElementById("main"),
		view: document.getElementById("view"),
		viewHead: document.getElementById("view-head"),
		chat: document.getElementById("chat"),
		modelSelect: document.getElementById("model-select"),
		chatNew: document.getElementById("chat-new"),
		chatClose: document.getElementById("chat-close"),
		chatContext: document.getElementById("chat-context"),
		contextToggle: document.getElementById("context-toggle"),
		contextLabel: document.getElementById("context-label"),
		chatMessages: document.getElementById("chat-messages"),
		chatForm: document.getElementById("chat-form"),
		chatText: document.getElementById("chat-text"),
		chatSend: document.getElementById("chat-send"),
		askFloat: document.getElementById("ask-float"),
		toast: document.getElementById("toast")
	};
	function showToast(msg, duration = 3e3) {
		dom.toast.textContent = msg;
		dom.toast.hidden = false;
		clearTimeout(dom.toast._t);
		dom.toast._t = setTimeout(() => {
			dom.toast.hidden = true;
		}, duration);
	}
	function renderMarkdown(md) {
		if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") return DOMPurify.sanitize(marked.parse(md));
		return escapeHtml(md);
	}
	const HTML_ESCAPES = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	};
	function escapeHtml(str) {
		return String(str ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
	}
	function lsGet(key) {
		try {
			return localStorage.getItem(key);
		} catch (e) {
			return null;
		}
	}
	function lsSet(key, value) {
		try {
			localStorage.setItem(key, value);
		} catch (e) {}
	}
	const ICON_PATHS = {
		sparkle: "<path d=\"M8 2.25 9.35 6.65 13.75 8 9.35 9.35 8 13.75 6.65 9.35 2.25 8 6.65 6.65Z\"/>",
		external: "<path d=\"M6.5 3.5h-2A1.5 1.5 0 0 0 3 5v6.5A1.5 1.5 0 0 0 4.5 13H11a1.5 1.5 0 0 0 1.5-1.5v-2\"/><path d=\"M9.5 3H13v3.5M13 3 7.5 8.5\"/>",
		link: "<path d=\"M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2A2.6 2.6 0 0 0 9 3.3l-.9.9\"/><path d=\"M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9A2.6 2.6 0 0 0 7 12.7l.9-.9\"/>",
		expand: "<path d=\"M9.5 2.75h3.75V6.5M6.5 13.25H2.75V9.5M13.25 2.75 9 7M2.75 13.25 7 9\"/>",
		stack: "<rect x=\"2.75\" y=\"2.75\" width=\"10.5\" height=\"4.25\" rx=\"1.25\"/><rect x=\"2.75\" y=\"9\" width=\"10.5\" height=\"4.25\" rx=\"1.25\"/>",
		chevronLeft: "<path d=\"m9.5 4.5-3.5 3.5 3.5 3.5\"/>",
		chevronDown: "<path d=\"m4.5 6.5 3.5 3.5 3.5-3.5\"/>",
		chevronRight: "<path d=\"m6.5 4.5 3.5 3.5-3.5 3.5\"/>",
		chevronUp: "<path d=\"m4.5 9.5 3.5-3.5 3.5 3.5\"/>",
		plus: "<path d=\"M8 3.25v9.5M3.25 8h9.5\"/>",
		folder: "<path d=\"M2.5 4.5A1.5 1.5 0 0 1 4 3h2.6l1.4 1.5h4A1.5 1.5 0 0 1 13.5 6v6A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12Z\"/>",
		bookmark: "<path d=\"M4.25 2.75h7.5v10.5L8 10.75l-3.75 2.5Z\"/>",
		bookmarkFilled: "<path d=\"M4.25 2.75h7.5v10.5L8 10.75l-3.75 2.5Z\" fill=\"currentColor\"/>",
		pin: "<rect x=\"2.5\" y=\"3\" width=\"11\" height=\"10\" rx=\"2\"/><path d=\"M6.5 3v10\"/>",
		pinOff: "<rect x=\"2.5\" y=\"3\" width=\"11\" height=\"10\" rx=\"2\"/><path d=\"M6.5 3v10\" stroke-dasharray=\"1.5 1.5\"/><path d=\"M9 8h2.5M10.5 6.5 12 8l-1.5 1.5\"/>",
		activity: "<path d=\"M1.75 8.25h2.5l1.75-4.5 4 8.5 1.75-4h2.5\"/>",
		download: "<path d=\"M8 2.75v7.5M4.75 7 8 10.25 11.25 7\"/><path d=\"M3 12.75h10\"/>",
		check: "<path d=\"m3.75 8.25 2.75 2.75 5.75-6\"/>",
		list: "<circle cx=\"3\" cy=\"4\" r=\".6\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"3\" cy=\"8\" r=\".6\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"3\" cy=\"12\" r=\".6\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M6 4h7.5M6 8h7.5M6 12h7.5\"/>",
		book: "<path d=\"M2.5 12.5A1.5 1.5 0 0 1 4 11h9.5\"/><path d=\"M4 2.5h9.5v11H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 2.5Z\"/>",
		file: "<path d=\"M9 2.5H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5L9 2.5Z\"/><path d=\"M9 2.5V6.5H13\"/>",
		news: "<path d=\"M2.5 4.5H11V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12Z\"/><path d=\"M11 6.5h1.5a1 1 0 0 1 1 1V12a1.5 1.5 0 0 1-1.5 1.5\"/><path d=\"M4.5 7h4.5M4.5 9.25h4.5M4.5 11.5h3\"/>",
		help: "<circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M6.25 6.25a1.85 1.85 0 0 1 3.55.75c0 1.25-1.8 1.5-1.8 2.75\"/><circle cx=\"8\" cy=\"11.85\" r=\".55\" fill=\"currentColor\" stroke=\"none\"/>",
		key: "<circle cx=\"5.5\" cy=\"8\" r=\"2.75\"/><path d=\"M8.25 8H14M11.75 8v2.25M13.5 8v1.5\"/>",
		rss: "<circle cx=\"4\" cy=\"12\" r=\"1.15\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M3.25 7.75A5 5 0 0 1 8.25 12.75M3.25 4A8.75 8.75 0 0 1 12 12.75\"/>",
		copy: "<rect x=\"5.5\" y=\"5.5\" width=\"7.5\" height=\"7.5\" rx=\"1.5\"/><path d=\"M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5\"/>",
		close: "<path d=\"m4 4 8 8M12 4l-8 8\"/>",
		eye: "<path d=\"M1.75 8S4 4.25 8 4.25 14.25 8 14.25 8 12 11.75 8 11.75 1.75 8 1.75 8Z\"/><circle cx=\"8\" cy=\"8\" r=\"1.75\"/>",
		eyeOff: "<path d=\"M2.5 2.5 13.5 13.5M6.4 4.45A6.6 6.6 0 0 1 8 4.25C12 4.25 14.25 8 14.25 8a10.4 10.4 0 0 1-2.2 2.55M4.1 5.65A10.6 10.6 0 0 0 1.75 8s2.25 3.75 6.25 3.75c.9 0 1.75-.18 2.5-.48\"/>"
	};
	function icon(name, extraClass = "") {
		return `<svg class="icon${extraClass ? " " + extraClass : ""}" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
	}
	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	function enterView() {
		dom.main.scrollTop = 0;
		if (reduceMotion.matches || !dom.view.animate) return;
		dom.view.animate([{
			opacity: 0,
			transform: "translateY(4px)"
		}, {
			opacity: 1,
			transform: "none"
		}], {
			duration: 180,
			easing: "cubic-bezier(.25, .46, .45, .94)"
		});
	}
	const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
	function parseHash() {
		const [pathPart, queryPart] = (window.location.hash || "#/").slice(1).split("?");
		const params = new URLSearchParams(queryPart || "");
		return {
			path: pathPart || "/",
			params
		};
	}
	async function handleRoute() {
		const { path, params } = parseHash();
		activeRoute = path;
		const seq = ++routeSeq;
		syncNavToRoute(path);
		let checkPath = path;
		const titleMatch = path.match(/^\/title\/(\d+)(\/.*)?$/);
		if (titleMatch) {
			const targetTitle = parseInt(titleMatch[1], 10);
			if (targetTitle && targetTitle !== currentTitle) {
				await switchTitle(targetTitle);
				if (seq !== routeSeq) return;
			}
			checkPath = titleMatch[2] || "/";
		}
		if (checkPath === "/" || checkPath === "") {
			if (titleMatch) renderHome();
			else renderOverview();
		} else if (checkPath.startsWith("/section/")) {
			const rest = checkPath.slice(9);
			const slash = rest.indexOf("/");
			const decode = (s) => {
				try {
					return decodeURIComponent(s);
				} catch (e) {
					return s;
				}
			};
			await loadSection(decode(slash < 0 ? rest : rest.slice(0, slash)), params, slash < 0 ? null : decode(rest.slice(slash + 1)) || null);
		} else if (checkPath.startsWith("/part/")) {
			const rest = checkPath.replace("/part/", "");
			const fullMatch = rest.match(/^(.+?)\/full$/);
			if (fullMatch) await loadPartFull(fullMatch[1], params);
			else await loadPart(rest);
		} else if (checkPath === "/library" || checkPath.startsWith("/library/")) {
			const m = /^\/library(?:\/(\d+)(?:\/part\/(.+))?)?\/?$/.exec(checkPath);
			if (!m) renderNotFound();
			else {
				const decode = (s) => {
					try {
						return decodeURIComponent(s);
					} catch (e) {
						return s;
					}
				};
				await loadLibrary(m[1] ? parseInt(m[1], 10) : null, m[2] ? decode(m[2]) : null);
			}
		} else if (!titleMatch && (checkPath === "/projects" || checkPath.startsWith("/projects/"))) {
			const id = checkPath.slice(10);
			renderProjects(id ? decodeURIComponent(id) : null);
		} else if (!titleMatch && (checkPath === "/news" || checkPath === "/news/")) await loadNews(params);
		else if (!titleMatch && (checkPath === "/help" || checkPath === "/help/")) await loadHelp(params);
		else if (!titleMatch && (checkPath === "/settings" || checkPath === "/settings/")) renderSettingsPage({ enter: true });
		else if (checkPath.startsWith("/search")) {
			const q = params.get("q") || "";
			dom.search.value = q;
			await loadSearchPage(q, params.get("scope"));
		} else renderNotFound();
	}
	window.addEventListener("hashchange", handleRoute);
	const HOME_CONTENT = {
		29: {
			tagline: "Federal labor regulations — workplace safety, wages and hours, leave, and employee benefits — with local search and Claude.",
			cards: [
				{
					part: "1910",
					kicker: "OSHA Safety",
					title: "Part 1910 — General Industry",
					desc: "PPE, hazard communication, walking-working surfaces, fire protection, and machinery."
				},
				{
					part: "1926",
					kicker: "OSHA Safety",
					title: "Part 1926 — Construction",
					desc: "Scaffolds, fall protection, cranes, excavations, and electrical safety on sites."
				},
				{
					part: "541",
					kicker: "Wage & Hour",
					title: "Part 541 — Overtime Exemptions",
					desc: "Executive, administrative, professional, computer, and outside sales exemptions (FLSA)."
				},
				{
					part: "825",
					kicker: "Leave & Family",
					title: "Part 825 — Family & Medical Leave",
					desc: "FMLA employee eligibility, employer notice obligations, leave duration, and certification."
				},
				{
					part: "1904",
					kicker: "Recordkeeping",
					title: "Part 1904 — Injury Recording",
					desc: "Recording and reporting occupational injuries, illnesses, and severe incidents."
				},
				{
					part: "2560",
					kicker: "Employee Benefits",
					title: "Part 2560 — ERISA Administration",
					desc: "Claims procedures, participant remedies, and retirement plan fiduciaries."
				}
			]
		},
		40: {
			tagline: "EPA regulations — air and water quality, hazardous waste, permits, and chemical releases — with local search and Claude.",
			cards: [
				{
					part: "50",
					kicker: "Air",
					title: "Part 50 — Air Quality Standards",
					desc: "National ambient air quality standards (NAAQS) for ozone, particulates, lead, and more."
				},
				{
					part: "70",
					kicker: "Air Permits",
					title: "Part 70 — Operating Permits",
					desc: "State operating permit programs for major stationary sources (Title V)."
				},
				{
					part: "122",
					kicker: "Water",
					title: "Part 122 — NPDES Permits",
					desc: "The discharge permit program for point sources under the Clean Water Act."
				},
				{
					part: "136",
					kicker: "Water",
					title: "Part 136 — Test Procedures",
					desc: "Approved analytical methods for pollutant monitoring and compliance."
				},
				{
					part: "261",
					kicker: "Hazardous Waste",
					title: "Part 261 — Waste Identification",
					desc: "What counts as a solid and hazardous waste under RCRA: listings and characteristics."
				},
				{
					part: "302",
					kicker: "Emergencies",
					title: "Part 302 — Reportable Quantities",
					desc: "CERCLA hazardous substance designations and release notification thresholds."
				}
			]
		},
		49: {
			tagline: "DOT regulations — hazardous materials, motor carriers, drivers, and vehicle safety — with local search and Claude.",
			cards: [
				{
					part: "172",
					kicker: "Hazmat",
					title: "Part 172 — Hazmat Table & Communication",
					desc: "The hazardous materials table, shipping papers, marking, labeling, and placarding."
				},
				{
					part: "173",
					kicker: "Hazmat",
					title: "Part 173 — Packaging Requirements",
					desc: "General shipment and packaging requirements by hazard class."
				},
				{
					part: "390",
					kicker: "Motor Carriers",
					title: "Part 390 — FMCSA General",
					desc: "Who the federal motor carrier safety regulations apply to, and general duties."
				},
				{
					part: "391",
					kicker: "Drivers",
					title: "Part 391 — Driver Qualifications",
					desc: "Qualification files, medical certification, and disqualifying offenses."
				},
				{
					part: "383",
					kicker: "Drivers",
					title: "Part 383 — Commercial Driver’s License",
					desc: "CDL standards: who needs one, testing, endorsements, and disqualifications."
				},
				{
					part: "571",
					kicker: "Vehicles",
					title: "Part 571 — Vehicle Safety Standards",
					desc: "Federal motor vehicle safety standards (FMVSS) for cars, trucks, and buses."
				}
			]
		}
	};
	function renderHome() {
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		document.title = `Title ${currentTitle} · FRAMEWORK`;
		setViewHead("");
		const name = metaInfo.name || "";
		const content = HOME_CONTENT[currentTitle];
		const tagline = content ? content.tagline : `Read, search, and ask questions about Title ${currentTitle} of the Code of Federal Regulations.`;
		const count = Number(metaInfo.section_count || 0);
		const metaLine = [count ? `${count.toLocaleString()} sections` : "", metaInfo.edition ? `current as of ${metaInfo.edition}` : ""].filter(Boolean).join(" · ");
		const cardsHtml = content ? `
      <div class="card-grid">
        ${content.cards.map((c) => `
          <a class="card" href="#/part/${encodeURIComponent(c.part)}">
            <span class="card-kicker">${escapeHtml(c.kicker)}</span>
            <div class="card-title">${escapeHtml(c.title)}</div>
            <div class="card-desc">${escapeHtml(c.desc)}</div>
          </a>
        `).join("")}
      </div>
    ` : "";
		dom.view.innerHTML = `
      <div class="home-hero">
        <h1>Title ${currentTitle}${name ? " — " + escapeHtml(name) : ""}</h1>
        <p>${escapeHtml(tagline)}</p>
        ${metaLine ? `<p class="home-meta">${escapeHtml(metaLine)}</p>` : ""}
      </div>

      ${cardsHtml}

      <div class="home">
        <h2>Getting around</h2>
        <ul class="tips">
          <li><span class="tip-keys"><kbd>/</kbd></span><span>Search the full text, or jump straight to a section number</span></li>
          <li><span class="tip-keys"><kbd>${isMac ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd></span><span>Open Ask Claude</span></li>
          <li><span class="tip-keys"><kbd>↑</kbd><kbd>↓</kbd></span><span>Move through the contents list or search suggestions</span></li>
          <li><span class="tip-keys"><kbd>Esc</kbd></span><span>Clear the contents filter or close suggestions</span></li>
        </ul>
      </div>
    `;
		enterView();
	}
	const USAGE_KEY = "usage";
	function loadUsage() {
		try {
			const u = JSON.parse(lsGet(USAGE_KEY) || "null");
			if (u && u.v === 1 && u.s && u.p) return u;
		} catch (e) {}
		return {
			v: 1,
			since: Date.now(),
			s: {},
			p: {}
		};
	}
	function bumpPart(u, title, part, heading, now) {
		if (!part) return;
		const key = title + "|" + part;
		const e = u.p[key] || (u.p[key] = { n: 0 });
		e.n += 1;
		e.t = now;
		if (heading) e.h = String(heading).trim();
	}
	function recordSectionVisit(data) {
		if (!data || !data.id) return;
		const u = loadUsage();
		const now = Date.now();
		const key = currentTitle + "|" + data.id;
		const e = u.s[key] || (u.s[key] = { n: 0 });
		e.n += 1;
		e.t = now;
		e.l = data.label || data.id;
		e.h = data.section_title || data.title_label || "";
		e.p = data.part || "";
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
			const raw = lsGet(title === 29 ? "visited" : "visited-" + title);
			return raw ? JSON.parse(raw).length : 0;
		} catch (e) {
			return 0;
		}
	}
	function timeAgo(ms) {
		const s = Math.max(0, (Date.now() - ms) / 1e3);
		if (s < 60) return "just now";
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		const d = Math.floor(s / 86400);
		if (d === 1) return "yesterday";
		if (d < 30) return `${d}d ago`;
		return new Date(ms).toLocaleDateString(void 0, {
			month: "short",
			day: "numeric",
			year: "numeric"
		});
	}
	const fmt = (n) => Number(n || 0).toLocaleString();
	const titleHref = (t, rest) => `#/title/${t}/${rest || ""}`;
	function renderOverview() {
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		document.title = "FRAMEWORK";
		setViewHead("");
		const u = loadUsage();
		const titles = installedTitles.length ? installedTitles : [{
			title: currentTitle,
			name: metaInfo.name || `Title ${currentTitle}`,
			section_count: metaInfo.section_count,
			edition: metaInfo.edition
		}];
		const nameOf = (t) => (titles.find((x) => x.title === t) || {}).name || `Title ${t}`;
		const installed = new Set(titles.map((t) => t.title));
		const split = (key) => {
			const i = key.indexOf("|");
			return [parseInt(key.slice(0, i), 10), key.slice(i + 1)];
		};
		const entries = (map) => Object.entries(map).map(([k, e]) => {
			const [ti, id] = split(k);
			return {
				...e,
				ti,
				id
			};
		}).filter((e) => installed.has(e.ti));
		const sections = entries(u.s);
		const parts = entries(u.p);
		const byTitle = /* @__PURE__ */ new Map();
		for (const p of parts) byTitle.set(p.ti, (byTitle.get(p.ti) || 0) + p.n);
		const totalVisits = [...byTitle.values()].reduce((a, b) => a + b, 0);
		const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
		const readByTitle = new Map(titles.map((t) => [t.title, visitedCountFor(t.title)]));
		const totalRead = [...readByTitle.values()].reduce((a, b) => a + b, 0);
		const recent = [...sections].sort((a, b) => b.t - a.t);
		const last = recent[0];
		const sectionLink = (e, inner) => `<a class="ov-row" href="${titleHref(e.ti, "section/" + encodeURIComponent(e.id))}">${inner}</a>`;
		const tag = (t) => `<span class="ov-tag" title="${escapeHtml(nameOf(t))}">${t} CFR</span>`;
		const secNum = (e) => escapeHtml(String(e.l).replace(/^§\s*/, ""));
		const topCards = `
      <div class="ov-cards">
        ${[...titles].sort((a, b) => (byTitle.get(b.title) || 0) - (byTitle.get(a.title) || 0) || a.title - b.title).slice(0, 3).map((t) => {
			const n = byTitle.get(t.title) || 0;
			const read = readByTitle.get(t.title) || 0;
			const top = sections.filter((e) => e.ti === t.title).sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 4);
			const share = totalVisits ? Math.round(n / totalVisits * 100) : 0;
			return `
            <article class="ov-card">
              <a class="ov-card-head" href="${titleHref(t.title)}">
                <span class="ov-card-kicker">Title</span>
                <span class="ov-card-num">${t.title}</span>
                <span class="ov-card-name">${escapeHtml(t.name)}</span>
                <span class="ov-card-meta">${n ? `${fmt(n)} ${n === 1 ? "visit" : "visits"} · ${share}%` : "Not opened yet"}<span class="sep" aria-hidden="true">·</span>${fmt(read)} of ${fmt(t.section_count)} read</span>
              </a>
              <div class="ov-card-foot">
                <div class="ov-card-label">Most read</div>
                ${top.length ? top.map((e) => sectionLink(e, `
                  <span class="ov-row-num">${secNum(e)}</span>
                  <span class="ov-row-text">${escapeHtml(e.h)}</span>
                  <span class="ov-row-val">${fmt(e.n)}</span>`)).join("") : `
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
		}).join("")}
      </div>`;
		const barList = (rows, max) => rows.map((r) => `
      <a class="ov-row ov-bar-row" href="${r.href}">
        ${r.ti ? tag(r.ti) : ""}<span class="ov-row-num">${escapeHtml(r.num)}</span>
        <span class="ov-row-text">${escapeHtml(r.text)}</span>
        <span class="ov-row-val">${escapeHtml(r.val)}</span>
        <span class="ov-bar" aria-hidden="true"><span style="width:${Math.max(2, Math.round(r.value / max * 100))}%"></span></span>
      </a>`).join("");
		const titleRows = titles.map((t) => ({
			t: t.title,
			n: byTitle.get(t.title) || 0
		})).filter((r) => r.n).sort((a, b) => b.n - a.n).map((r) => ({
			href: titleHref(r.t),
			num: String(r.t),
			text: nameOf(r.t),
			value: r.n,
			val: `${Math.round(r.n / totalVisits * 100)}%`
		}));
		const partRows = [...parts].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 5).map((p) => ({
			href: titleHref(p.ti, "part/" + encodeURIComponent(p.id)),
			num: p.id,
			text: p.h || `Part ${p.id}`,
			value: p.n,
			val: fmt(p.n),
			ti: p.ti
		}));
		const topSections = [...sections].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 5);
		const metric = (label, value, sub, href) => {
			const inner = `<div class="ov-metric-label">${label}</div><div class="ov-metric-value">${value}</div><div class="ov-metric-sub">${sub}</div>`;
			return href ? `<a class="ov-metric is-link" href="${href}">${inner}</a>` : `<div class="ov-metric">${inner}</div>`;
		};
		const metrics = `
      <div class="ov-metrics">
        ${metric("Titles installed", fmt(titles.length), escapeHtml(titles.map((t) => t.title).join(" · ")))}
        ${metric("Sections read", fmt(totalRead), `of ${fmt(totalSections)}`)}
        ${metric("Visits", fmt(totalVisits), `since ${escapeHtml(new Date(u.since).toLocaleDateString(void 0, {
			month: "short",
			day: "numeric"
		}))}`)}
        ${last ? metric("Last read", escapeHtml(last.l), `${last.ti} CFR · ${escapeHtml(timeAgo(last.t))}`, titleHref(last.ti, "section/" + encodeURIComponent(last.id))) : metric("Last read", "—", "Nothing yet")}
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
        ${panel("Most visited titles", barList(titleRows, titleRows.length ? titleRows[0].value : 1))}
        ${panel("Most visited parts", barList(partRows, partRows.length ? partRows[0].value : 1) || "<div class=\"ov-none\"><svg class=\"ov-none-icon\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 4h12M2 8h8M2 12h5\"/></svg><span>No parts yet</span></div>")}
        ${panel("Most visited sections", topSections.map((e) => sectionLink(e, `
          ${tag(e.ti)}<span class="ov-row-num">${secNum(e)}</span>
          <span class="ov-row-text">${escapeHtml(e.h)}</span>
          <span class="ov-row-val">${fmt(e.n)}</span>`)).join("") || "<div class=\"ov-none\"><svg class=\"ov-none-icon\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 4h12M2 8h8M2 12h5\"/></svg><span>No sections yet</span></div>")}
        ${panel("Recently read", recent.slice(0, 5).map((e) => sectionLink(e, `
          ${tag(e.ti)}<span class="ov-row-num">${secNum(e)}</span>
          <span class="ov-row-text">${escapeHtml(e.h)}</span>
          <span class="ov-row-val">${escapeHtml(timeAgo(e.t))}</span>`)).join("") || "<div class=\"ov-none\"><svg class=\"ov-none-icon\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M2 4h12M2 8h8M2 12h5\"/></svg><span>No sections yet</span></div>")}
      </div>`;
		const table = `
      <section class="ov-panel ov-titles">
        <div class="ov-panel-head">
          <h2 class="ov-h">Installed titles</h2>
          <a class="btn btn-sm btn-download" href="#/library" title="Download titles, parts or sections from eCFR">${icon("download")} Download</a>
        </div>
        <div class="ov-table" role="table" aria-label="Installed titles">
          <div class="ov-tr ov-thead" role="row">
            <span role="columnheader">Title</span><span role="columnheader">Name</span>
            <span role="columnheader" class="num">Sections</span><span role="columnheader" class="num">Read</span>
            <span role="columnheader" class="num">Edition</span>
          </div>
          ${titles.map((t) => {
			const read = readByTitle.get(t.title) || 0;
			const count = Number(t.section_count || 0);
			const pct = count ? read / count * 100 : 0;
			const pctText = !read ? "—" : pct < .1 ? "<0.1%" : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
			return `
              <a class="ov-tr" role="row" href="${titleHref(t.title)}">
                <span role="cell" class="ov-title-num">${t.title}</span>
                <span role="cell" class="ov-title-name">${escapeHtml(t.name)}${t.partial ? "<span class=\"ov-partial\">Partial</span>" : ""}</span>
                <span role="cell" class="num">${fmt(count)}</span>
                <span role="cell" class="num" title="${fmt(read)} of ${fmt(count)} sections">${pctText}</span>
                <span role="cell" class="num muted">${escapeHtml(t.edition || "—")}</span>
              </a>`;
		}).join("")}
        </div>
      </section>`;
		dom.view.innerHTML = `
      <div class="ov">
        <div class="ov-head">
          <h1>Overview</h1>
          <p>Your reading across ${titles.length === 1 ? "one installed title" : `${fmt(titles.length)} installed titles`}. Kept in this browser only.</p>
        </div>
        ${topCards}
        ${metrics}
        ${activity}
        ${table}
      </div>
    `;
		enterView();
	}
	const lib = {
		view: null,
		data: null,
		filter: "",
		sort: "desk",
		wire: null
	};
	try {
		const saved = localStorage.getItem("libSort");
		if ([
			"desk",
			"number",
			"updated"
		].includes(saved)) lib.sort = saved;
	} catch (e) {}
	let jobs = {
		current: null,
		queued: [],
		recent: []
	};
	let jobsTimer = null;
	let jobsSeenActive = /* @__PURE__ */ new Set();
	let lastJobsKey = "";
	const fmtDate = (iso) => {
		if (!iso) return "";
		const d = /* @__PURE__ */ new Date(iso + "T00:00:00");
		return isNaN(d) ? iso : d.toLocaleDateString(void 0, {
			month: "short",
			day: "numeric",
			year: "numeric"
		});
	};
	const libHref = (title, part) => "#/library" + (title ? `/${title}` : "") + (part ? `/part/${encodeURIComponent(part)}` : "");
	async function getJSON(url, opts) {
		const res = await fetch(url, opts);
		let body = null;
		try {
			body = await res.json();
		} catch (e) {}
		if (!res.ok) throw new Error(body && body.detail || `Request failed (${res.status})`);
		return body;
	}
	async function loadLibrary(title, part) {
		const seq = routeSeq;
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		setViewHead("");
		const sameView = lib.view && lib.view.title === title && lib.view.part === part;
		if (!sameView) {
			lib.filter = "";
			dom.view.innerHTML = "<div class=\"loading\">Loading from eCFR…</div>";
		}
		lib.view = {
			title,
			part
		};
		try {
			const data = await getJSON(part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : title ? `/api/library/${title}` : "/api/library");
			if (seq !== routeSeq) return;
			if (!title) setJobs(data.jobs);
			lib.data = data;
			renderLibrary(!sameView);
			if (!title) {
				pollJobsIfActive();
				loadWire();
			}
		} catch (err) {
			if (seq !== routeSeq) return;
			dom.view.innerHTML = `
        <div class="empty-state">
          <h2>Couldn’t load the library</h2>
          <p>${escapeHtml(err.message)}</p>
          <button type="button" class="btn" id="lib-retry">Try again</button>
        </div>`;
			document.getElementById("lib-retry").addEventListener("click", () => loadLibrary(title, part));
		}
	}
	async function refreshLibrary() {
		if (!lib.view || !dom.view.querySelector(".lib")) return;
		const { title, part } = lib.view;
		try {
			const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : title ? `/api/library/${title}` : "/api/library";
			lib.data = await getJSON(url);
			renderLibrary(false);
		} catch (e) {}
	}
	function jobFor(title, kind, id) {
		return [jobs.current, ...jobs.queued].filter(Boolean).find((j) => j.title === title && (kind === "title" ? j.kind === "title" || j.kind === "update" : kind === "part" ? j.kind === "part" && j.target && j.target.part === id : j.kind === "section" && j.target && j.target.id === id));
	}
	function actBtn(act, label, attrs, cls = "") {
		return `<button type="button" class="lib-act${cls ? " " + cls : ""}" data-act="${act}" ${attrs}>${label}</button>`;
	}
	function libRow({ href, num, name, status, actions, dim, key }) {
		const main = href ? `<a class="lib-main" href="${href}"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></a>` : `<span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>`;
		return `<div class="lib-row${dim ? " is-dim" : ""}${actions ? " has-actions" : ""}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}"${key ? ` data-key="${escapeHtml(key)}"` : ""}>
      ${main}<span class="lib-status">${status || ""}</span><span class="lib-actions">${actions || ""}</span></div>`;
	}
	function statPill(state, text, { bare = false, title = "" } = {}) {
		return `<span class="stat-pill is-${state}${bare ? " is-bare" : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="stat-dot is-${state}" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
	}
	const isStale = (t) => Boolean(t.installed && t.latest && t.installed.edition && t.latest > t.installed.edition);
	const jobStatus = (j) => j ? statPill("busy", j.state === "running" ? "Downloading" : "Queued", { bare: true }) : "";
	function titleStatus(t) {
		if (t.reserved) return {
			state: "uninstalled",
			text: "Reserved"
		};
		const j = jobFor(t.title, "title");
		if (j) return {
			state: "busy",
			text: j.state === "running" ? j.kind === "update" ? "Updating" : "Downloading" : "Queued"
		};
		const inst = t.installed;
		if (!inst) return {
			state: "uninstalled",
			text: "Not installed"
		};
		if (isStale(t)) return {
			state: "stale",
			text: "Update available",
			title: `eCFR has a newer edition (${fmtDate(t.latest)})`
		};
		if (!inst.whole) {
			const what = [inst.parts ? plural(inst.parts, "part") : "", inst.sections ? plural(inst.sections, "section") : ""].filter(Boolean).join(", ");
			return {
				state: "partial",
				text: "Partial",
				title: what ? `Installed: ${what}` : ""
			};
		}
		return {
			state: "synced",
			text: "Installed",
			title: `Edition ${fmtDate(inst.edition)}`
		};
	}
	function renderStatusPill(t, opts = {}) {
		const s = titleStatus(t);
		return statPill(s.state, s.text, {
			title: s.title,
			...opts
		});
	}
	const fmtBytes = (bytes) => {
		if (!bytes || bytes <= 0) return "";
		if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		const mb = bytes / 1048576;
		if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
		return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
	};
	const fmtMB = (mb) => mb ? fmtBytes(mb * 1048576) : "";
	const fmtSections = (n) => n ? `${fmt(n)} ${n === 1 ? "section" : "sections"}` : "";
	const SEP = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
	const joinSep = (xs) => xs.filter(Boolean).join(SEP);
	function relTime(ms) {
		const s = Math.max(0, (Date.now() - ms) / 1e3);
		if (s < 60) return "just now";
		if (s < 3600) return `${Math.round(s / 60)} min ago`;
		if (s < 86400) return `${Math.round(s / 3600)} h ago`;
		return shortDate(new Date(ms).toISOString().slice(0, 10));
	}
	function amendedWeek(d) {
		const newest = d.titles.reduce((m, t) => t.latest && t.latest > m ? t.latest : m, "");
		if (!newest) return {
			newest: "",
			cut: "",
			recent: 0
		};
		const [y, m, dd] = newest.split("-").map(Number);
		const cut = new Date(Date.UTC(y, m - 1, dd - 7)).toISOString().slice(0, 10);
		return {
			newest,
			cut,
			recent: d.titles.filter((t) => t.amended && t.amended >= cut).length
		};
	}
	const LIB_SORTS = [
		["desk", "By desk"],
		["number", "By number"],
		["updated", "Recently amended"]
	];
	const shortDate = (iso) => {
		if (!iso) return "";
		const d = /* @__PURE__ */ new Date(iso + "T00:00:00");
		if (isNaN(d)) return iso;
		const opts = d.getFullYear() === (/* @__PURE__ */ new Date()).getFullYear() ? {
			month: "short",
			day: "numeric"
		} : {
			month: "short",
			day: "numeric",
			year: "numeric"
		};
		return d.toLocaleDateString(void 0, opts);
	};
	function titleActions(t) {
		if (t.reserved || jobFor(t.title, "title")) return "";
		const inst = t.installed;
		if (!inst) return actBtn("download", `${icon("download")}Download`, `data-title="${t.title}"`, "is-primary");
		return `<a class="lib-act" href="#/title/${t.title}/">Open</a>` + (inst.whole ? "" : actBtn("download", "Download all", `data-title="${t.title}"`)) + (isStale(t) ? actBtn("update", "Update", `data-title="${t.title}" title="eCFR has a newer edition (${escapeHtml(fmtDate(t.latest))})"`) : "") + actBtn("remove", "Remove", `data-title="${t.title}"`, "is-danger");
	}
	function libStory(t) {
		const inst = t.installed;
		const agencies = (t.agencies || []).slice(0, 3);
		const kicker = `Title ${t.title}${agencies.length ? `${SEP}<span class="story-ag">${agencies.map(escapeHtml).join(" ")}</span>` : ""}`;
		const name = escapeHtml(t.name);
		const headline = t.reserved ? name : `<a href="${libHref(t.title)}">${name}</a>`;
		const sections = inst ? inst.section_count : t.sections;
		const dateline = joinSep([
			t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : "",
			t.reserved ? "" : fmtSections(sections),
			t.reserved || !t.size_mb ? "" : `<span title="Size of the title's text on eCFR">${fmtMB(t.size_mb)}</span>`
		]);
		const acts = titleActions(t);
		const hay = `${t.title} title ${t.name} ${t.summary || ""} ${t.desk || ""} ${(t.agencies || []).join(" ")}`.toLowerCase();
		return `<article class="lib-story${t.reserved ? " is-dim" : ""}" data-hay="${escapeHtml(hay)}">
      <div class="story-top"><span class="story-kicker">${kicker}</span>${renderStatusPill(t, { bare: !inst })}</div>
      <h3 class="story-name">${headline}</h3>
      ${t.summary ? `<p class="story-dek">${escapeHtml(t.summary)}</p>` : ""}
      <div class="story-foot"><span class="story-date">${dateline}</span>${acts ? `<div class="story-actions">${acts}</div>` : ""}</div>
    </article>`;
	}
	function libMetrics(d) {
		const live = d.titles.filter((t) => !t.reserved);
		const inst = live.filter((t) => t.installed);
		const sections = inst.reduce((a, t) => a + (t.installed.section_count || 0), 0);
		const bytes = inst.reduce((a, t) => a + (t.installed.bytes || 0), 0);
		const stale = live.filter(isStale);
		const { cut, recent } = amendedWeek(d);
		const updating = [jobs.current, ...jobs.queued].some((j) => j && j.kind === "update");
		const tile = (label, value, sub, cls = "") => `<div class="metric-card${cls}">
        <div class="metric-label">${label}</div><div class="metric-val">${value}</div><div class="metric-sub">${sub}</div></div>`;
		return `<section class="lib-metrics" aria-label="Library at a glance">
      ${tile("<span class=\"stat-dot is-synced\" aria-hidden=\"true\"></span>eCFR", "Online", d.checked_at ? `Title list checked ${escapeHtml(relTime(d.checked_at * 1e3))}` : `${live.length} titles tracked`)}
      ${tile("Installed", `${inst.length}<span class="metric-of">of ${live.length}</span>`, joinSep([fmtSections(sections) || "No sections yet", bytes ? `${fmtBytes(bytes)} on disk` : ""]))}
      ${tile("Amended this week", String(recent), cut ? `Since ${escapeHtml(shortDate(cut))}${SEP}<button type="button" class="metric-link" data-sort="updated">Show</button>` : "No edition date")}
      ${stale.length ? tile("<span class=\"stat-dot is-stale\" aria-hidden=\"true\"></span>Editions", `${stale.length} outdated`, updating ? statPill("busy", "Updating", { bare: true }) : `<button type="button" class="metric-link is-strong" data-act="update-all">Update all ${icon("chevronRight")}</button>`, " is-alert") : tile("Editions", inst.length ? "Current" : "—", inst.length ? "Every installed title is up to date" : "Nothing installed yet")}
    </section>`;
	}
	function suiteState(s, d) {
		const ts = s.titles.map((n) => d.titles.find((t) => t.title === n)).filter((t) => t && !t.reserved);
		const busy = ts.filter((t) => jobFor(t.title, "title"));
		const whole = ts.filter((t) => t.installed && t.installed.whole);
		const any = ts.filter((t) => t.installed);
		const stale = ts.filter(isStale);
		const needs = ts.filter((t) => !jobFor(t.title, "title") && (!t.installed || !t.installed.whole || isStale(t)));
		let pill;
		if (busy.length) pill = statPill("busy", `${busy.length} of ${ts.length} in progress`);
		else if (whole.length === ts.length && !stale.length) pill = statPill("synced", "Installed");
		else if (whole.length === ts.length) pill = statPill("stale", "Update available");
		else if (any.length) pill = statPill("partial", `${any.length} of ${ts.length} installed`);
		else pill = statPill("uninstalled", "Not installed", { bare: true });
		const onlyUpdates = needs.length && needs.every((t) => t.installed && t.installed.whole);
		const label = !needs.length ? "" : onlyUpdates ? `Update ${needs.length === ts.length ? "suite" : plural(needs.length, "title")}` : needs.length === ts.length ? "Download suite" : `Download ${plural(needs.length, "remaining title")}`;
		return {
			ts,
			pill,
			needs,
			label,
			busy
		};
	}
	function suiteHero(s, d) {
		const st = suiteState(s, d);
		const rows = st.ts.map((t) => {
			const parts = ((HOME_CONTENT[t.title] || {}).cards || []).slice(0, 3);
			const partHref = (p) => t.installed && t.installed.whole ? `#/title/${t.title}/part/${encodeURIComponent(p)}` : libHref(t.title, p);
			return `<li class="suite-row">
        <span class="suite-num">${t.title}</span>
        <div class="suite-row-body">
          <a class="suite-name" href="${libHref(t.title)}">${escapeHtml(t.name)}</a>
          <span class="suite-ag">${(t.agencies || []).slice(0, 3).map(escapeHtml).join(" ")}</span>
          ${parts.length ? `<div class="suite-parts">${parts.map((c) => {
				const [num, ...rest] = c.title.replace(/^Part\s+/, "").split(" — ");
				return `<a href="${partHref(c.part)}"><span class="suite-part-num">${escapeHtml(num)}</span>${escapeHtml(rest.join(" — "))}</a>`;
			}).join("")}</div>` : ""}
          <div class="suite-meta">${joinSep([
				t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : "",
				fmtSections(t.installed ? t.installed.section_count : t.sections),
				t.size_mb ? fmtMB(t.size_mb) : "",
				t.installed && t.installed.bytes ? `${fmtBytes(t.installed.bytes)} on disk` : ""
			].map((x) => x && `<span>${x}</span>`))}</div>
        </div>
        ${renderStatusPill(t, { bare: true })}
      </li>`;
		}).join("");
		const action = st.label ? `<button type="button" class="btn btn-accent" data-act="download-suite" data-suite="${escapeHtml(s.id)}">${icon("download")}${escapeHtml(st.label)}</button>` : st.busy.length ? "" : `<a class="btn" href="#/title/${st.ts[0] ? st.ts[0].title : ""}/">Open in reader</a>`;
		return `<article class="suite-hero" aria-labelledby="suite-${escapeHtml(s.id)}">
      <div class="story-top"><span class="story-kicker">Featured suite${SEP}${escapeHtml(s.badge || "")}</span>${st.pill}</div>
      <h2 class="suite-title" id="suite-${escapeHtml(s.id)}">${escapeHtml(s.name)}</h2>
      <p class="suite-dek">${escapeHtml(s.summary)}</p>
      <ul class="suite-rows">${rows}</ul>
      <div class="suite-foot">
        <span class="suite-telemetry">${joinSep([
			plural(st.ts.length, "title"),
			fmtSections(s.sections),
			s.size_mb ? `${fmtMB(s.size_mb)} of text` : ""
		])}</span>
        ${action}
      </div>
    </article>`;
	}
	function suiteCard(s, d) {
		const st = suiteState(s, d);
		const titles = st.ts.map((t) => `<a href="${libHref(t.title)}"><span class="suite-part-num">${t.title}</span>${escapeHtml(t.name)}</a>`).join("");
		const action = st.label ? actBtn("download-suite", `${icon("download")}${escapeHtml(st.label)}`, `data-suite="${escapeHtml(s.id)}"`, "is-primary") : "";
		return `<article class="suite-card">
      <div class="story-top"><span class="story-kicker">${escapeHtml(s.badge || "Suite")}</span>${st.pill}</div>
      <h3 class="story-name">${escapeHtml(s.name)}</h3>
      <p class="story-dek">${escapeHtml(s.summary)}</p>
      <div class="suite-parts suite-card-titles">${titles}</div>
      <div class="story-foot"><span class="story-date">${joinSep([fmtSections(s.sections), fmtMB(s.size_mb)])}</span>${action}</div>
    </article>`;
	}
	function wireSummary(c) {
		if (!c) return "<span class=\"wire-pending\" aria-hidden=\"true\"></span>";
		if (!c.count) return "";
		if (c.removed === c.count) return escapeHtml(`${plural(c.count, "section")} removed`);
		const verb = c.kind === "revised" ? "revised" : "amended";
		const parts = c.parts.slice(0, 3);
		const more = c.parts.length - parts.length;
		const where = parts.length ? ` in ${parts.length + more === 1 ? "Part" : "Parts"} ${parts.join(", ")}${more > 0 ? ` +${more}` : ""}` : "";
		return `${escapeHtml(`${plural(c.count, "section")} ${verb}${where}`)}${c.first && c.first.name ? `<span class="wire-first">${escapeHtml(c.first.name)}</span>` : ""}`;
	}
	function libWire(d) {
		const top = d.titles.filter((t) => !t.reserved && t.amended).sort((a, b) => b.amended.localeCompare(a.amended) || a.title - b.title).slice(0, 5);
		const byTitle = new Map((lib.wire && lib.wire.items || []).map((c) => [c.title, c]));
		const failed = lib.wire && lib.wire.failed;
		return `<aside class="reg-wire" id="lib-wire" aria-labelledby="wire-title">
      <div class="wire-head">
        <h2 class="wire-title" id="wire-title">${icon("activity")}The Regulatory Wire</h2>
        <span class="wire-badge">Live eCFR</span>
      </div>
      <p class="wire-sub">Latest amendments, newest first</p>
      <ol class="wire-items">${top.map((t) => {
			const c = byTitle.get(t.title);
			const summary = !lib.wire ? wireSummary(null) : failed || !c || c.amended !== t.amended ? "" : wireSummary(c);
			return `<li class="wire-entry"><a href="${libHref(t.title)}">
          <span class="wire-entry-head"><span class="wire-entry-title">Title ${t.title}${(t.agencies || [])[0] ? `${SEP}${escapeHtml(t.agencies[0])}` : ""}</span>
            <time class="wire-entry-date" datetime="${escapeHtml(t.amended)}">${escapeHtml(shortDate(t.amended))}</time></span>
          <span class="wire-entry-name">${escapeHtml(t.name)}</span>
          ${summary ? `<span class="wire-entry-summary">${summary}</span>` : ""}
        </a></li>`;
		}).join("")}</ol>
      <div class="wire-foot"><button type="button" class="wire-link" data-sort="updated">All titles by last amendment ${icon("chevronRight")}</button></div>
    </aside>`;
	}
	async function loadWire() {
		if (lib.wire && Date.now() - lib.wire.at < 18e5 && !lib.wire.failed) return;
		try {
			lib.wire = {
				at: Date.now(),
				items: await getJSON("/api/library/wire")
			};
		} catch (e) {
			lib.wire = {
				at: Date.now(),
				items: [],
				failed: true
			};
		}
		const el = document.getElementById("lib-wire");
		if (el && lib.data && lib.view && !lib.view.title) el.outerHTML = libWire(lib.data);
	}
	function libTitleList(d, sort) {
		const live = d.titles.filter((t) => !t.reserved);
		const reserved = d.titles.filter((t) => t.reserved);
		const grid = (ts) => `<div class="lib-stories">${ts.map(libStory).join("")}</div>`;
		const desk = (name, ts, extra = "") => `<section class="lib-desk${extra}" aria-label="${escapeHtml(name)}">
        <header class="lib-desk-header"><h3 class="lib-desk-name">${escapeHtml(name)}</h3><span class="lib-desk-count">${plural(ts.length, "title")}</span></header>
        ${grid(ts)}</section>`;
		if (sort === "number" || sort === "updated") {
			const ordered = sort === "number" ? live : [...live].sort((a, b) => (b.amended || "").localeCompare(a.amended || "") || a.title - b.title);
			return desk(sort === "number" ? "All titles by number" : "All titles by last amendment", ordered, " is-flat") + (reserved.length ? desk("Reserved", reserved) : "");
		}
		const names = [...d.desks || []];
		for (const t of live) if (!names.includes(t.desk)) names.push(t.desk);
		return names.map((name) => {
			const ts = live.filter((t) => t.desk === name);
			return ts.length ? desk(name, ts) : "";
		}).join("") + (reserved.length ? desk("Reserved", reserved) : "");
	}
	function libFrontHtml(d) {
		const live = d.titles.filter((t) => !t.reserved);
		const { newest, recent } = amendedWeek(d);
		const sub = joinSep([
			"Code of Federal Regulations from eCFR",
			newest ? `Edition ${escapeHtml(fmtDate(newest))}` : "",
			`${live.length} active titles`,
			recent ? `${recent} amended this week` : "No amendments this week"
		]);
		const suites = Object.values(d.suites || {});
		const lead = suites.find((s) => s.featured) || suites[0];
		const others = suites.filter((s) => s !== lead);
		return `<div class="lib lib-front">
      <div class="doc-kicker"><a href="#/">Overview</a></div>
      <header class="lib-masthead">
        <h1 class="doc-title">Library</h1>
        <p class="lib-sub">${sub}</p>
      </header>
      ${libMetrics(d)}
      <div class="lib-broadsheet${lead ? "" : " is-wire-only"}">${lead ? suiteHero(lead, d) : ""}${libWire(d)}</div>
      ${others.length ? `<section class="lib-suites" aria-label="More compliance suites">
        <header class="lib-desk-header"><h2 class="lib-desk-name">More suites</h2><span class="lib-desk-count">${plural(others.length, "suite")}</span></header>
        <div class="lib-suite-grid">${others.map((s) => suiteCard(s, d)).join("")}</div></section>` : ""}
      <div class="lib-tools">
        <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter titles or agencies…" aria-label="Filter titles or agencies" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
        <div class="lib-seg" role="group" aria-label="Order titles">${LIB_SORTS.map(([k, label]) => `<button type="button" data-sort="${k}" aria-pressed="${lib.sort === k}">${label}</button>`).join("")}</div>
      </div>
      <div class="lib-list" id="lib-list">${libTitleList(d, lib.sort)}</div>
      <div class="lib-none" id="lib-none" hidden>No title matches. Try an agency (“OSHA”) or a topic.</div>
    </div>`;
	}
	function renderLibrary(fresh) {
		const { title, part } = lib.view;
		const d = lib.data;
		let crumbs, heading, sub, head = "", body = "", placeholder;
		const scrollTop = dom.main.scrollTop;
		if (!title) {
			document.title = "Library · FRAMEWORK";
			const active = document.activeElement;
			const refocus = active && active.id === "lib-filter" ? "#lib-filter" : active && active.dataset && active.dataset.sort ? `.lib-seg [data-sort="${active.dataset.sort}"]` : null;
			const caret = active && active.id === "lib-filter" ? active.selectionStart : null;
			dom.view.innerHTML = libFrontHtml(d);
			applyLibraryFilter();
			if (refocus) {
				const el = dom.view.querySelector(refocus);
				if (el) {
					el.focus({ preventScroll: true });
					if (caret != null) el.setSelectionRange(caret, caret);
				}
			}
			if (fresh) enterView();
			else dom.main.scrollTop = scrollTop;
			return;
		}
		if (!part) {
			document.title = `Title ${title} · Library · FRAMEWORK`;
			const inst = d.installed;
			crumbs = `<a href="#/">Overview</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a>`;
			heading = `Title ${title} — ${d.name}`;
			sub = inst ? inst.whole ? `Installed · ${fmtDate(inst.edition)} · ${fmt(inst.section_count)} sections` : `Partly installed · ${fmt(inst.section_count)} ${inst.section_count === 1 ? "section" : "sections"}` : `Not installed · eCFR edition ${fmtDate(d.latest)}`;
			placeholder = "Filter parts";
			const j = jobFor(title, "title");
			head = d.reserved ? "" : j ? `<span class="lib-head-status">${jobStatus(j)}</span>` : inst && inst.whole ? `<a class="btn" href="#/title/${title}/">Open in reader</a>` : `<button type="button" class="btn" data-act="download" data-title="${title}">${icon("download")} Download whole title</button>`;
			body = d.groups.map((g) => `
        ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ""}
        ${g.parts.map((p) => {
				const pj = jobFor(title, "part", p.id);
				if (p.r || !p.leaves) return libRow({
					num: p.l.replace(/^Parts?\s+/, ""),
					name: p.d || "Reserved",
					status: "Reserved",
					dim: true
				});
				const status = p.installed === "all" ? statPill("synced", "Installed", { bare: true }) : p.installed === "some" ? statPill("partial", `${p.installed_sections} of ${fmt(p.leaves)}`, {
					bare: true,
					title: "Sections installed"
				}) : escapeHtml(fmtSections(p.leaves));
				const acts = p.installed === "all" ? `<a class="lib-act" href="#/title/${title}/part/${encodeURIComponent(p.id)}">Open</a>` : actBtn("download", "Download part", `data-title="${title}" data-part="${escapeHtml(p.id)}"`);
				return libRow({
					href: libHref(title, p.id),
					num: p.id,
					name: p.d || p.l,
					status: pj ? jobStatus(pj) : status,
					actions: pj ? "" : acts,
					key: `p${p.id}`
				});
			}).join("")}`).join("");
		} else {
			document.title = `Part ${part} · Library · FRAMEWORK`;
			crumbs = `<a href="#/">Overview</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${libHref(title)}">Title ${title}</a>`;
			heading = `${d.l} — ${d.d}`;
			const count = d.groups.reduce((a, g) => a + g.sections.filter((s) => !s.r).length, 0);
			const countText = fmtSections(count) || "0 sections";
			sub = d.installed === "all" ? `Installed · ${countText}` : d.installed === "some" ? `Partly installed · ${countText}` : countText;
			placeholder = "Filter sections";
			const j = jobFor(title, "part", part);
			head = j ? `<span class="lib-head-status">${jobStatus(j)}</span>` : d.installed === "all" ? `<a class="btn" href="#/title/${title}/part/${encodeURIComponent(part)}">Open in reader</a>` : `<button type="button" class="btn" data-act="download" data-title="${title}" data-part="${escapeHtml(part)}">${icon("download")} Download part</button>`;
			body = d.groups.map((g) => `
        ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ""}
        ${g.sections.map((s) => {
				const num = s.t === "appendix" ? s.l : s.l.replace(/^§\s*/, "");
				const name = s.t === "appendix" ? s.d && s.d !== s.l ? s.d.replace(s.l, "").replace(/^\s*[—–-]\s*/, "") : "" : s.d;
				if (s.r) return libRow({
					num,
					name: name || "Reserved",
					status: "Reserved",
					dim: true
				});
				const sj = jobFor(title, "section", s.id);
				const acts = s.installed ? `<a class="lib-act" href="#/title/${title}/section/${encodeURIComponent(s.id)}">Open</a>` : actBtn("download", "Download", `data-title="${title}" data-part="${escapeHtml(part)}" data-section="${escapeHtml(s.id)}" data-kind="${s.t}"`);
				return libRow({
					num,
					name,
					status: sj ? jobStatus(sj) : s.installed ? statPill("synced", "Installed", { bare: true }) : "",
					actions: sj ? "" : acts,
					key: `s${s.id}`
				});
			}).join("")}`).join("");
		}
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
		const list = document.getElementById("lib-list");
		if (!list) return;
		if (list.querySelector(".lib-story")) {
			let n = 0;
			for (const desk of list.querySelectorAll(".lib-desk")) {
				let k = 0;
				for (const el of desk.querySelectorAll(".lib-story")) {
					const ok = words.every((w) => (el.dataset.hay || "").includes(w));
					el.hidden = !ok;
					if (ok) k++;
				}
				desk.hidden = k === 0;
				const total = desk.querySelectorAll(".lib-story").length;
				const count = desk.querySelector(".lib-desk-count");
				if (count) count.textContent = words.length && k !== total ? `${k} of ${plural(total, "title")}` : plural(total, "title");
				n += k;
			}
			document.getElementById("lib-none").hidden = n > 0;
			return;
		}
		let shown = 0;
		let label = null, labelHas = false;
		const closeLabel = () => {
			if (label) label.hidden = !labelHas;
		};
		for (const el of list.children) {
			if (el.classList.contains("lib-label")) {
				closeLabel();
				label = el;
				labelHas = false;
				continue;
			}
			const hay = el.dataset.hay || "";
			const ok = words.every((w) => hay.includes(w));
			el.hidden = !ok;
			if (ok) {
				shown++;
				labelHas = true;
			}
		}
		closeLabel();
		document.getElementById("lib-none").hidden = shown > 0;
	}
	dom.view.addEventListener("input", (e) => {
		if (e.target.id !== "lib-filter") return;
		lib.filter = e.target.value;
		applyLibraryFilter();
	});
	dom.view.addEventListener("click", (e) => {
		const sortBtn = e.target.closest("button[data-sort]");
		if (!sortBtn || !dom.view.querySelector(".lib")?.contains(sortBtn)) return;
		const fromSeg = Boolean(sortBtn.closest(".lib-seg"));
		if (sortBtn.dataset.sort !== lib.sort) {
			lib.sort = sortBtn.dataset.sort;
			lsSet("libSort", lib.sort);
			renderLibrary(false);
		}
		if (fromSeg) dom.view.querySelector(`.lib-seg [data-sort="${lib.sort}"]`)?.focus();
		else {
			const tools = dom.view.querySelector(".lib-tools");
			if (tools) tools.scrollIntoView({
				behavior: reduceMotion.matches ? "auto" : "smooth",
				block: "start"
			});
		}
	});
	async function queueBatch(url, body, emptyMsg) {
		const res = await getJSON(url, body ? {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		} : { method: "POST" });
		for (const j of res.queued || []) jobsSeenActive.add(j.id);
		showToast(res.count ? `Queued ${plural(res.count, "title")}` : emptyMsg);
		await pollJobs();
	}
	dom.view.addEventListener("click", async (e) => {
		const btn = e.target.closest("button[data-act]");
		if (!btn || !dom.view.querySelector(".lib")?.contains(btn)) return;
		const title = parseInt(btn.dataset.title, 10);
		const act = btn.dataset.act;
		if (act === "remove") {
			if (!btn.classList.contains("is-armed")) {
				btn.classList.add("is-armed");
				btn.textContent = "Confirm remove";
				clearTimeout(btn._t);
				btn._t = setTimeout(() => {
					btn.classList.remove("is-armed");
					btn.textContent = "Remove";
				}, 4e3);
				return;
			}
			btn.disabled = true;
			try {
				await getJSON(`/api/library/${title}`, { method: "DELETE" });
				showToast(`Removed Title ${title}`);
				await refreshTitles();
				await refreshLibrary();
			} catch (err) {
				showToast(err.message, 5e3);
				btn.disabled = false;
			}
			return;
		}
		btn.disabled = true;
		try {
			if (act === "download-suite") {
				await queueBatch("/api/library/batch-download", { suite: btn.dataset.suite }, "Every title in this suite is installed and current");
				return;
			}
			if (act === "update-all") {
				await queueBatch("/api/library/update-all", null, "Every installed title is already current");
				return;
			}
			const job = act === "update" ? await getJSON(`/api/library/${title}/update`, { method: "POST" }) : await getJSON("/api/library/download", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title,
					part: btn.dataset.part || null,
					section: btn.dataset.section || null,
					kind: btn.dataset.kind === "appendix" ? "appendix" : "section"
				})
			});
			jobsSeenActive.add(job.id);
			await pollJobs();
		} catch (err) {
			showToast(err.message, 5e3);
			btn.disabled = false;
		}
	});
	function setJobs(snapshot) {
		if (!snapshot) return;
		jobs = snapshot;
		for (const j of [jobs.current, ...jobs.queued]) if (j) jobsSeenActive.add(j.id);
		updateDock();
		updateNavTransfers();
	}
	function pollJobsIfActive() {
		if ((jobs.current || jobs.queued.length) && !jobsTimer) jobsTimer = setTimeout(pollJobs, 700);
	}
	async function pollJobs() {
		clearTimeout(jobsTimer);
		jobsTimer = null;
		let snap;
		try {
			snap = await getJSON("/api/library/jobs");
		} catch (e) {
			jobsTimer = setTimeout(pollJobs, 3e3);
			return;
		}
		const before = new Set(jobsSeenActive);
		setJobs(snap);
		const finished = snap.recent.filter((j) => before.has(j.id));
		for (const j of finished) {
			jobsSeenActive.delete(j.id);
			if (j.state === "error") showToast(`${j.label}: ${j.error}`, 6e3);
			else if (j.state === "cancelled") showToast(`Cancelled ${j.label}`);
			else showToast(j.phase === "Already installed" ? `${j.label} is already installed` : `Downloaded ${j.label}`);
		}
		if (finished.some((j) => j.state === "done")) await refreshTitles(finished.filter((j) => j.state === "done").map((j) => j.title));
		if (finished.length) {
			navLib.at = 0;
			navStorage = null;
			if (drawerShown() && navState.panel === "library") ensureNavLibrary(true).then(renderLibraryPanel).catch(() => {});
			if (drawerShown() || onSettingsPage()) refreshSettingsViews();
		}
		if (dom.view.querySelector(".lib")) {
			if (finished.length) await refreshLibrary();
			else {
				const key = [snap.current, ...snap.queued].filter(Boolean).map((j) => `${j.id}${j.state[0]}`).join(",");
				if (key !== lastJobsKey) {
					lastJobsKey = key;
					renderLibrary(false);
				}
			}
		}
		pollJobsIfActive();
	}
	const DOCK_STEPS = [
		["Checking eCFR", "Connecting to eCFR"],
		["Downloading contents", "Reading the table of contents"],
		["Downloading text", "Streaming the regulation text"],
		["Reading text", "Extracting sections and appendices"],
		["Indexing", "Building the search index"],
		["Installing", "Swapping in the new edition"]
	];
	const dock = {
		el: document.getElementById("transfer-dock"),
		min: lsGet("dockMinimized") === "1",
		key: "",
		hideT: null,
		srText: ""
	};
	const rate = {
		id: null,
		t: 0,
		done: 0,
		bps: 0
	};
	function recordJobProgress(j) {
		const streaming = j && j.phase === "Downloading text" && j.done > 0 && (j.total == null || j.total > 1e5);
		if (!streaming || j.id !== rate.id) {
			Object.assign(rate, {
				id: streaming ? j.id : null,
				t: streaming ? performance.now() : 0,
				done: streaming ? j.done : 0,
				bps: 0
			});
			return;
		}
		const now = performance.now();
		const dt = (now - rate.t) / 1e3;
		if (dt < .5) return;
		const delta = j.done - rate.done;
		if (delta > 0) rate.bps = rate.bps ? rate.bps * .7 + delta / dt * .3 : delta / dt;
		rate.t = now;
		rate.done = j.done;
	}
	function fmtEta(seconds) {
		if (!isFinite(seconds) || seconds <= 0) return "";
		if (seconds < 60) return `${Math.ceil(seconds)}s left`;
		const m = Math.floor(seconds / 60);
		return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m ${Math.round(seconds % 60)}s left`;
	}
	function dockModel(j) {
		if (!j) return {
			step: -1,
			label: "Starting…",
			pct: null,
			left: "",
			right: ""
		};
		const step = DOCK_STEPS.findIndex(([phase]) => phase === j.phase);
		const label = step >= 0 ? DOCK_STEPS[step][1] : j.phase === "Waiting" ? "Starting…" : j.phase;
		const has = j.total != null && j.total > 0 && j.done != null;
		const pct = has ? Math.min(99, Math.floor(j.done / j.total * 100)) : null;
		let left = "", right = "";
		if (j.phase === "Downloading text" && (j.total == null || j.total > 1e5) && j.done) {
			left = j.total ? `${fmtBytes(Math.min(j.done, j.total))} of ${fmtBytes(j.total)}` : fmtBytes(j.done);
			const speed = rate.id === j.id && rate.bps > 51200 ? `${fmtBytes(rate.bps)}/s` : "";
			right = [speed, speed && j.total ? fmtEta((j.total - j.done) / rate.bps) : ""].filter(Boolean).join(" · ");
		} else if (j.phase === "Downloading text" && has) left = `${fmt(j.done)} of ${plural(j.total, "file")}`;
		else if ((j.phase === "Reading text" || j.phase === "Indexing") && has) left = `${fmt(j.done)} of ${fmtSections(j.total)}`;
		return {
			step,
			label,
			pct,
			left,
			right
		};
	}
	function dockHtml(j, m) {
		const pctText = m.pct == null ? "" : `${m.pct}%`;
		const title = j ? escapeHtml(j.label) : "Preparing download";
		if (dock.min) return `<button type="button" class="dock-mini" data-dock="expand" aria-label="Show download progress: ${title}">
        <span class="stat-dot is-busy" aria-hidden="true"></span><span class="dock-mini-text">${title}</span>
        <span class="dock-mini-pct" data-f="pct">${pctText}</span>${icon("chevronUp")}</button>`;
		const cancelling = j && j.cancelling;
		const locked = j && j.phase === "Installing";
		const steps = DOCK_STEPS.map((_, i) => `<span class="${i < m.step ? "is-done" : i === m.step ? "is-now" : ""}"></span>`).join("");
		const queued = jobs.queued;
		return `<section class="dock-card" aria-label="Downloads">
      <div class="dock-head">
        <span class="stat-dot is-busy" aria-hidden="true"></span>
        <span class="dock-title">${title}</span>
        <span class="dock-pct" data-f="pct">${pctText}</span>
        <button type="button" class="dock-icon" data-dock="minimize" title="Minimize" aria-label="Minimize downloads">${icon("chevronDown")}</button>
      </div>
      <div class="dock-phase">
        <span class="dock-phase-text">${escapeHtml(cancelling ? "Cancelling…" : m.label)}</span>
        ${m.step >= 0 ? `<span class="dock-steps" role="img" aria-label="Step ${m.step + 1} of ${DOCK_STEPS.length}">${steps}</span>` : ""}
      </div>
      <div class="dock-track"><span class="dock-fill${m.pct == null ? " is-indeterminate" : ""}" data-f="fill" style="width:${m.pct == null ? 35 : m.pct}%"></span></div>
      <div class="dock-tele"><span data-f="left">${escapeHtml(m.left)}</span><span data-f="right">${escapeHtml(m.right)}</span></div>
      <div class="dock-foot">
        <span class="dock-queue">${queued.length ? `<span class="dock-queue-count">+${queued.length} queued</span>${escapeHtml(queued.map((q) => q.label).join(", "))}` : "Nothing queued"}</span>
        <span class="dock-acts">
          ${queued.length ? "<button type=\"button\" class=\"lib-act\" data-dock=\"clear\">Clear queue</button>" : ""}
          ${j ? `<button type="button" class="lib-act is-danger" data-dock="cancel" data-id="${j.id}"${cancelling || locked ? " disabled" : ""}${locked ? " title=\"Installing: almost done\"" : ""}>${cancelling ? "Cancelling" : "Cancel"}</button>` : ""}
        </span>
      </div>
    </section>`;
	}
	function updateDock() {
		const el = dock.el;
		if (!el) return;
		const j = jobs.current;
		if (!Boolean(j || jobs.queued.length)) {
			if (!el.hidden && !dock.hideT) {
				el.classList.remove("is-visible");
				dock.hideT = setTimeout(() => {
					dock.hideT = null;
					if (!jobs.current && !jobs.queued.length) {
						el.hidden = true;
						el.innerHTML = "";
						dock.key = "";
					}
				}, 260);
			}
			return;
		}
		clearTimeout(dock.hideT);
		dock.hideT = null;
		recordJobProgress(j);
		const m = dockModel(j);
		const key = [
			dock.min,
			j && j.id,
			j && j.cancelling,
			j && j.phase === "Installing",
			m.step,
			m.pct == null,
			jobs.queued.map((q) => q.id).join(".")
		].join("|");
		if (key !== dock.key) {
			const focused = el.contains(document.activeElement) ? document.activeElement.dataset.dock : null;
			el.innerHTML = dockHtml(j, m);
			dock.key = key;
			if (focused) (el.querySelector(`[data-dock="${focused}"]`) || el.querySelector("[data-dock]"))?.focus();
		} else {
			const set = (f, v) => {
				const n = el.querySelector(`[data-f="${f}"]`);
				if (n && n.textContent !== v) n.textContent = v;
			};
			set("pct", m.pct == null ? "" : `${m.pct}%`);
			set("left", m.left);
			set("right", m.right);
			const fill = el.querySelector("[data-f=\"fill\"]");
			if (fill && m.pct != null) fill.style.width = `${m.pct}%`;
		}
		const sr = `${j ? j.label : "Download"}: ${m.label}`;
		if (sr !== dock.srText) {
			dock.srText = sr;
			const live = document.getElementById("transfer-dock-live");
			if (live) live.textContent = sr;
		}
		if (el.hidden) {
			el.hidden = false;
			requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-visible")));
		} else el.classList.add("is-visible");
		el.classList.toggle("is-min", dock.min);
	}
	if (dock.el) dock.el.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-dock]");
		if (btn) onDockAction(btn);
	});
	async function onDockAction(btn) {
		{
			const act = btn.dataset.dock;
			if (act === "minimize" || act === "expand") {
				dock.min = act === "minimize";
				lsSet("dockMinimized", dock.min ? "1" : "0");
				dock.key = "";
				updateDock();
				dock.el.querySelector("[data-dock]")?.focus();
				return;
			}
			btn.disabled = true;
			try {
				if (act === "cancel") await getJSON(`/api/library/jobs/${btn.dataset.id}/cancel`, { method: "POST" });
				else if (act === "clear") {
					const res = await getJSON("/api/library/jobs/clear", { method: "POST" });
					for (const j of res.cancelled || []) jobsSeenActive.delete(j.id);
					if (res.count) showToast(`Cleared ${plural(res.count, "queued download")}`);
				}
				await pollJobs();
			} catch (err) {
				showToast(err.message, 5e3);
				btn.disabled = false;
			}
		}
	}
	async function refreshTitles(changed = []) {
		let list;
		try {
			list = await getJSON("/api/titles");
		} catch (e) {
			return;
		}
		installedTitles = list;
		fillTitleSelect();
		updateRailHome();
		if (!list.some((t) => t.title === currentTitle) && list.length) await switchTitle(list[0].title);
		else if (changed.includes(currentTitle)) {
			treeData = null;
			const meta = list.find((t) => t.title === currentTitle);
			if (meta) metaInfo = meta;
			await switchTitle(currentTitle);
		}
		if (dom.view.querySelector(".ov")) renderOverview();
	}
	function fillTitleSelect() {
		if (!dom.titleSelect) return;
		const cur = installedTitles.find((t) => t.title === currentTitle);
		const name = cur ? cur.name : metaInfo.name || "";
		document.getElementById("title-select-num").textContent = `Title ${currentTitle}`;
		document.getElementById("title-select-name").textContent = name;
		dom.titleSelect.title = `Title ${currentTitle}${name ? ": " + name : ""}. Switch title`;
		dom.titlePop.innerHTML = `
      <a class="tm-item tm-download" role="menuitem" href="#/library" tabindex="-1">${icon("download")}<span class="tm-name">Download titles…</span></a>
      <div class="tm-sep" role="separator"></div>
      ${installedTitles.map((t) => {
			const on = t.title === currentTitle;
			return `<button type="button" class="tm-item${on ? " is-current" : ""}" role="menuitemradio" aria-checked="${on}" data-title="${t.title}" tabindex="-1">
          <span class="tm-num">${t.title}</span><span class="tm-name">${escapeHtml(t.name)}</span>
          ${t.partial ? "<span class=\"tm-meta\">Partial</span>" : ""}
          ${on ? icon("check", "tm-check") : "<span class=\"tm-check\" aria-hidden=\"true\"></span>"}
        </button>`;
		}).join("")}`;
	}
	const titleMenuItems = () => [...dom.titlePop.querySelectorAll(".tm-item")];
	function openTitleMenu(focusWhich = "current") {
		if (!dom.titlePop.hidden) return;
		dom.titlePop.hidden = false;
		dom.titleSelect.setAttribute("aria-expanded", "true");
		const items = titleMenuItems();
		const target = focusWhich === "first" ? items[0] : focusWhich === "last" ? items[items.length - 1] : dom.titlePop.querySelector(".is-current") || items[0];
		target?.focus({ preventScroll: true });
		target?.scrollIntoView({ block: "nearest" });
		document.addEventListener("pointerdown", onTitleMenuOutside, true);
	}
	function closeTitleMenu(returnFocus) {
		if (dom.titlePop.hidden) return;
		dom.titlePop.hidden = true;
		dom.titleSelect.setAttribute("aria-expanded", "false");
		document.removeEventListener("pointerdown", onTitleMenuOutside, true);
		if (returnFocus) dom.titleSelect.focus();
	}
	function onTitleMenuOutside(e) {
		if (!document.getElementById("title-menu").contains(e.target)) closeTitleMenu(false);
	}
	dom.titleSelect.addEventListener("click", () => {
		if (dom.titlePop.hidden) openTitleMenu();
		else closeTitleMenu(false);
	});
	dom.titleSelect.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			openTitleMenu(e.key === "ArrowUp" ? "last" : "current");
		}
	});
	dom.titlePop.addEventListener("keydown", (e) => {
		const items = titleMenuItems();
		const i = items.indexOf(document.activeElement);
		const go = (n) => {
			e.preventDefault();
			items[(n + items.length) % items.length].focus();
		};
		if (e.key === "ArrowDown") go(i + 1);
		else if (e.key === "ArrowUp") go(i - 1);
		else if (e.key === "Home") go(0);
		else if (e.key === "End") go(items.length - 1);
		else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			closeTitleMenu(true);
		} else if (e.key === "Tab") closeTitleMenu(false);
	});
	dom.titlePop.addEventListener("click", async (e) => {
		const item = e.target.closest(".tm-item");
		if (!item) return;
		closeTitleMenu(false);
		if (item.classList.contains("tm-download")) return;
		const newTitle = parseInt(item.dataset.title, 10);
		if (newTitle && newTitle !== currentTitle) {
			await switchTitle(newTitle);
			window.location.hash = `#/title/${newTitle}/`;
		} else dom.titleSelect.focus();
	});
	function renderNotFound() {
		clearTreeSelection();
		document.title = "Not found · FRAMEWORK";
		setViewHead("");
		dom.view.innerHTML = `
      <div class="empty-state">
        <h2>Page not found</h2>
        <p>That section or part isn’t in Title ${currentTitle}.</p>
        <a href="#/title/${currentTitle}/" class="btn">Back to Title ${currentTitle}</a>
      </div>
    `;
		enterView();
	}
	function setViewHead(html) {
		const head = dom.viewHead;
		if (!head) return;
		const step = head.contains(document.activeElement) ? document.activeElement.dataset.step : null;
		if (railObserver) {
			railObserver.disconnect();
			railObserver = null;
		}
		head.innerHTML = html || "";
		head.hidden = !html;
		if (step) (head.querySelector(`[data-step="${step}"]`) || head.querySelector("a"))?.focus({ preventScroll: true });
	}
	function firstSectionOf(partId) {
		const k = treeIdx.parts.get(String(partId));
		if (k === void 0) return null;
		const find = (node) => {
			for (const c of node.c || []) {
				if (LEAF_TYPES.has(c.t)) return c;
				const hit = find(c);
				if (hit) return hit;
			}
			return null;
		};
		const leaf = find(treeIdx.nodes[k]);
		return leaf ? {
			id: leaf.id,
			label: (leaf.l || "").trim(),
			title: tocTitle(leaf)
		} : null;
	}
	function docStepBtn(kind, dir, href, label, name, labelHtml) {
		const prev = dir < 0;
		const what = `${prev ? "Previous" : "Next"} ${kind}`;
		const chevron = icon(prev ? "chevronLeft" : "chevronRight");
		const title = (name || "").trim();
		return `<a class="doc-step-btn is-${prev ? "prev" : "next"}" href="${href}" data-step="${kind}-${prev ? "prev" : "next"}" aria-label="${escapeHtml(`${what}: ${label}${title ? " " + title : ""}`)}">${prev ? chevron : ""}<span class="step-label">${labelHtml || escapeHtml(label)}</span>${prev ? "" : chevron}<span class="tip" aria-hidden="true"><span class="tip-kind">${what} · ${escapeHtml(label)}</span>${escapeHtml(title)}</span></a>`;
	}
	function partNeighbors(partId) {
		const list = treeIdx.partList;
		const k = treeIdx.parts.get(String(partId));
		const i = k === void 0 ? -1 : list.indexOf(k);
		if (i < 0) return [null, null];
		return [treeIdx.nodes[list[i - 1]] || null, treeIdx.nodes[list[i + 1]] || null];
	}
	function docStepHtml(partId, prevSection, nextSection) {
		const [prevPart, nextPart] = partNeighbors(partId);
		const partBtn = (node, dir) => node ? docStepBtn("part", dir, `#/part/${encodeURIComponent(node.id)}`, `Part ${node.id}`, node.d, `<span class="step-word">Part </span>${escapeHtml(node.id)}`) : "";
		const sectionBtn = (s, dir) => s ? docStepBtn("section", dir, `#/section/${encodeURIComponent(s.id)}`, s.label, s.title) : "";
		const sep = "<span class=\"doc-step-sep\" aria-hidden=\"true\"></span>";
		const left = [partBtn(prevPart, -1), sectionBtn(prevSection, -1)].filter(Boolean).join(sep);
		const right = [sectionBtn(nextSection, 1), partBtn(nextPart, 1)].filter(Boolean).join(sep);
		if (!left && !right) return "";
		return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
	}
	async function loadSection(sectionId, params, view) {
		const full = view === "full";
		const pClause = params && /^\(([a-z])\)/.exec(params.get("p") || "");
		const unit = full ? null : view || (pClause ? pClause[1] : "");
		const sameSection = currentSection && currentSection.id === sectionId && !dom.view.querySelector(".loading");
		if (!sameSection) dom.view.innerHTML = "<div class=\"loading\">Loading section " + escapeHtml(sectionId) + "…</div>";
		try {
			const qs = unit === null ? "" : "?unit=" + encodeURIComponent(unit);
			const seq = routeSeq;
			const res = await fetch("/api/" + currentTitle + "/section/" + encodeURIComponent(sectionId) + qs);
			if (seq !== routeSeq) return;
			if (!res.ok) {
				renderNotFound();
				return;
			}
			const data = await res.json();
			if (seq !== routeSeq) return;
			currentSection = data;
			data.part;
			updateChatContext();
			const reading = data.mode === "units" && data.unit ? "units" : "scroll";
			const current = reading === "units" ? (data.outline || []).find((u) => u.key === data.unit) : null;
			const heading = data.section_title || data.title_label || "";
			document.title = `${data.label}${current ? " " + unitShort(current) : ""} · Title ${currentTitle}`;
			setViewHead((reading === "units" ? unitStepHtml(data) : docStepHtml(data.part, data.prev, data.next)) + railHtml(data, reading));
			const partLink = data.part ? `<a href="#/part/${encodeURIComponent(data.part)}">Part ${escapeHtml(data.part)}</a>` : "";
			const i = current ? data.outline.indexOf(current) : -1;
			const showContext = current && current.group && current.kind === "chapter" && i > 0 && data.outline[i - 1].group === current.group;
			const fullPart = data.part ? `<a class="btn" href="#/part/${encodeURIComponent(data.part)}/full?from=${encodeURIComponent(data.id)}">${icon("list")} See full part</a>` : "";
			const toggle = data.mode !== "units" ? "" : full ? `<a class="btn" href="${sectionHref(data.id)}">${icon("stack")} Read in parts</a>` : `<a class="btn" href="${sectionHref(data.id, "full")}">${icon("expand")} See full section</a>`;
			dom.view.innerHTML = `
        <div class="doc-kicker">${currentTitle} CFR ${partLink}</div>
        <h1 class="doc-title">${escapeHtml(data.label)} ${escapeHtml(heading)}</h1>

        <div class="doc-actions">
          ${toggle}
          ${fullPart}
          <a class="btn" href="${escapeHtml(data.ecfr_url)}" target="_blank" rel="noopener">${icon("external")} eCFR</a>
          <button class="btn" id="btn-copy-link">${icon("link")} Copy link</button>
          ${pinButtonHtml()}
          ${newsActivityButtonHtml()}
          <div class="spacer"></div>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>

        ${data.reserved ? "<div class=\"reserved-note\">This section is reserved.</div>" : ""}
        ${showContext ? `<div class="unit-context">${escapeHtml(current.group_label)}<span class="sep" aria-hidden="true">·</span>${escapeHtml(current.group_title || "")}</div>` : ""}

        ${data.html || ""}
      `;
			enterView();
			bindRail();
			if (reading === "scroll") watchRail();
			else if (railObserver) {
				railObserver.disconnect();
				railObserver = null;
			}
			document.getElementById("btn-copy-link")?.addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(window.location.href);
					showToast("Link copied");
				} catch (e) {
					showToast("Couldn’t copy the link");
				}
			});
			document.getElementById("font-dec")?.addEventListener("click", () => adjustFontSize(-1));
			document.getElementById("font-inc")?.addEventListener("click", () => adjustFontSize(1));
			if (params && params.get("p")) highlightParagraph(params.get("p"));
			selectTreeNode("s-" + data.id);
			if (!sameSection) recordSectionVisit(data);
			fillNewsActivity("section", data.id, seq);
		} catch (err) {
			console.error(err);
			setViewHead("");
			dom.view.innerHTML = `<div class="msg-error">Failed to load section: ${escapeHtml(err.message)}</div>`;
		}
	}
	function highlightParagraph(pText) {
		setTimeout(() => {
			const clean = pText.trim();
			const pmarks = document.querySelectorAll(".reg-p .pmark");
			for (const el of pmarks) if (el.textContent.includes(clean)) {
				const p = el.closest(".reg-p");
				p.classList.add("flash");
				p.scrollIntoView({
					behavior: "smooth",
					block: "center"
				});
				break;
			}
		}, 150);
	}
	function sectionHref(id, view) {
		return `#/section/${encodeURIComponent(id)}${view ? "/" + encodeURIComponent(view) : ""}`;
	}
	function unitShort(u) {
		if (u.label) return u.label;
		const t = (u.title || "").trim();
		return t.length > 18 ? t.slice(0, 17).trim() + "…" : t;
	}
	function unitName(u) {
		return (u.group && u.kind === "chapter" ? `${u.group_label} · ` : "") + (u.title || u.label || "");
	}
	function unitKind(u) {
		return {
			clause: "clause",
			chapter: "part",
			appendix: "appendix"
		}[u.kind] || "part";
	}
	function railHtml(data, mode) {
		const units = data.outline || [];
		if (units.length < 2) return "";
		let html = "";
		let lastGroup;
		let rows = units.length;
		units.forEach((u, i) => {
			if (i && u.group !== lastGroup) {
				html += "<span class=\"rail-gap\" aria-hidden=\"true\"></span>";
				rows++;
			}
			lastGroup = u.group;
			const current = mode === "units" && u.key === data.unit;
			const href = mode === "units" ? sectionHref(data.id, u.key) : `#u-${u.key}`;
			const name = unitName(u);
			html += `<a class="rail-item${current ? " is-current" : ""}" href="${href}" data-unit="${escapeHtml(u.key)}"${mode === "units" ? "" : ` data-anchor="u-${escapeHtml(u.key)}"`}${current ? " aria-current=\"true\"" : ""} data-label="${escapeHtml(u.label || "")}" data-name="${escapeHtml(name)}" aria-label="${escapeHtml(`${u.label ? u.label + " " : ""}${name}`)}"><span class="rail-bar" aria-hidden="true"></span></a>`;
		});
		return `<nav class="rail" style="--rows:${rows}" aria-label="Contents of this section">${html}<a class="rail-pop" tabindex="-1" aria-hidden="true"><span class="rail-pop-label"></span><span class="rail-pop-name"></span></a></nav>`;
	}
	function bindRail() {
		const rail = dom.viewHead && dom.viewHead.querySelector(".rail");
		if (!rail) return;
		const pop = rail.querySelector(".rail-pop");
		const items = [...rail.querySelectorAll(".rail-item")];
		let active = null;
		let hideTimer = 0;
		const centerY = (el) => {
			const r = el.getBoundingClientRect();
			return r.top + r.height / 2;
		};
		const show = (item) => {
			clearTimeout(hideTimer);
			const opening = !rail.classList.contains("is-open");
			if (item === active && !opening) return;
			if (active) active.classList.remove("is-hover");
			active = item;
			item.classList.add("is-hover");
			pop.querySelector(".rail-pop-label").textContent = item.dataset.label || "";
			pop.querySelector(".rail-pop-name").textContent = item.dataset.name || "";
			pop.href = item.getAttribute("href");
			if (item.dataset.anchor) pop.dataset.anchor = item.dataset.anchor;
			else delete pop.dataset.anchor;
			if (opening) pop.classList.add("is-placing");
			pop.style.top = centerY(item) - rail.getBoundingClientRect().top + "px";
			if (opening) {
				pop.offsetHeight;
				pop.classList.remove("is-placing");
				rail.classList.add("is-open");
			}
		};
		const hide = () => {
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => {
				rail.classList.remove("is-open");
				if (active) active.classList.remove("is-hover");
				active = null;
			}, 140);
		};
		rail.addEventListener("pointermove", (e) => {
			if (pop.contains(e.target)) {
				clearTimeout(hideTimer);
				return;
			}
			let best = null;
			let bestD = Infinity;
			for (const it of items) {
				const d = Math.abs(e.clientY - centerY(it));
				if (d < bestD) {
					bestD = d;
					best = it;
				}
			}
			if (!best) return;
			if (active && best !== active) {
				const row = active.getBoundingClientRect().height;
				if (Math.abs(e.clientY - centerY(active)) - bestD < Math.max(2, row * .35)) {
					clearTimeout(hideTimer);
					return;
				}
			}
			show(best);
		});
		rail.addEventListener("pointerleave", hide);
		rail.addEventListener("focusin", (e) => {
			const it = e.target.closest(".rail-item");
			if (it) show(it);
		});
		rail.addEventListener("focusout", hide);
	}
	function unitStepHtml(data) {
		const sectionBtn = (s, dir) => s ? docStepBtn("section", dir, sectionHref(s.id), s.label, s.title) : "";
		const unitBtn = (u, dir) => u ? docStepBtn(unitKind(u), dir, sectionHref(data.id, u.key), unitShort(u), unitName(u)) : "";
		const sep = "<span class=\"doc-step-sep\" aria-hidden=\"true\"></span>";
		return `<nav class="doc-step" aria-label="Previous and next">${[sectionBtn(data.prev, -1), unitBtn(data.unit_prev, -1)].filter(Boolean).join(sep)}<span class="spacer"></span>${[unitBtn(data.unit_next, 1), sectionBtn(data.next, 1)].filter(Boolean).join(sep)}</nav>`;
	}
	let railObserver = null;
	function watchRail() {
		if (railObserver) {
			railObserver.disconnect();
			railObserver = null;
		}
		const rail = dom.viewHead && dom.viewHead.querySelector(".rail");
		const sections = [...dom.view.querySelectorAll(".reg-unit")];
		if (!rail || !sections.length) return;
		let lit = null;
		let frame = 0;
		const update = () => {
			frame = 0;
			const line = dom.main.getBoundingClientRect().top + 96;
			let key = sections[0].dataset.unit;
			for (const s of sections) if (s.getBoundingClientRect().top <= line) key = s.dataset.unit;
			else break;
			if (key === lit) return;
			lit = key;
			rail.querySelectorAll(".rail-item").forEach((a) => {
				const on = a.dataset.unit === key;
				a.classList.toggle("is-current", on);
				if (on) a.setAttribute("aria-current", "true");
				else a.removeAttribute("aria-current");
			});
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		dom.main.addEventListener("scroll", onScroll, { passive: true });
		dom.view.addEventListener("load", onScroll, true);
		railObserver = { disconnect: () => {
			dom.main.removeEventListener("scroll", onScroll);
			dom.view.removeEventListener("load", onScroll, true);
			if (frame) cancelAnimationFrame(frame);
		} };
		update();
	}
	function scrollToAnchor(id) {
		const target = document.getElementById(id);
		if (!target) return false;
		target.scrollIntoView({
			block: "start",
			behavior: reduceMotion.matches ? "auto" : "smooth"
		});
		return true;
	}
	if (dom.viewHead) dom.viewHead.addEventListener("click", (e) => {
		const a = e.target.closest("[data-anchor]");
		if (!a) return;
		e.preventDefault();
		scrollToAnchor(a.dataset.anchor);
	});
	dom.view.addEventListener("error", (e) => {
		const img = e.target;
		if (!(img instanceof HTMLImageElement) || !img.classList.contains("reg-img")) return;
		const fig = img.closest(".reg-figure");
		if (!fig || fig.classList.contains("is-broken")) return;
		fig.classList.add("is-broken");
		fig.href = currentSection && currentSection.ecfr_url || fig.href;
		fig.title = "This figure is only available on eCFR";
		fig.innerHTML = `${icon("external")}<span>Figure — view on eCFR</span>`;
	}, true);
	function applyFontSize(v) {
		const size = Math.max(13, Math.min(24, Number(v) || 16));
		lsSet("fontSize", String(size));
		document.documentElement.style.setProperty("--reader-size", size + "px");
		for (const out of document.querySelectorAll("[data-size-val]")) out.textContent = `${size} px`;
		const range = document.getElementById("set-size");
		if (range && Number(range.value) !== size) range.value = String(size);
	}
	function adjustFontSize(delta) {
		applyFontSize((parseInt(lsGet("fontSize"), 10) || 16) + delta);
	}
	async function loadPart(partId) {
		dom.view.innerHTML = "<div class=\"loading\">Loading Part " + escapeHtml(partId) + "…</div>";
		currentSection = null;
		updateChatContext();
		try {
			const seq = routeSeq;
			const [frontRes] = await Promise.all([fetch("/api/" + currentTitle + "/part/" + encodeURIComponent(partId)), ensureTreeLoaded()]);
			const front = frontRes.ok ? await frontRes.json() : {
				part: "",
				subparts: {}
			};
			if (seq !== routeSeq) return;
			const partNode = findPartInTree(treeData, partId);
			if (!partNode) {
				renderNotFound();
				return;
			}
			let groupsHtml = "";
			if (partNode.c) {
				for (const child of partNode.c) if (child.t === "subpart" || child.t === "subject_group") {
					const subpartFront = front.subparts[child.id] || "";
					const sections = (child.c || []).map((s) => `
              <li class="${s.r ? "reserved" : ""}">
                <a href="#/section/${encodeURIComponent(s.id)}">
                  <span class="toc-num">${escapeHtml(s.l)}</span>
                  <span class="toc-title">${escapeHtml(tocTitle(s))}</span>
                </a>
              </li>
            `).join("");
					groupsHtml += `
              <div class="toc-group">
                <h3>${escapeHtml(child.d && child.d.trim() !== (child.l || "").trim() ? `${child.l}: ${child.d}` : child.l)}</h3>
                ${subpartFront ? `<div class="front-matter"><details><summary>Subpart notes</summary>${subpartFront}</details></div>` : ""}
                <ul class="toc-list">${sections}</ul>
              </div>
            `;
				} else if (child.t === "section" || child.t === "appendix") groupsHtml += `
              <ul class="toc-list">
                <li class="${child.r ? "reserved" : ""}">
                  <a href="#/section/${encodeURIComponent(child.id)}">
                    <span class="toc-num">${escapeHtml(child.l)}</span>
                    <span class="toc-title">${escapeHtml(tocTitle(child))}</span>
                  </a>
                </li>
              </ul>
            `;
			}
			document.title = `Part ${partId} · Title ${currentTitle}`;
			setViewHead(docStepHtml(partId, null, firstSectionOf(partId)));
			dom.view.innerHTML = `
        <div class="doc-kicker">${currentTitle} CFR ${escapeHtml(partNode.l)}</div>
        <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
        <div class="doc-actions">
          <a class="btn" href="#/part/${encodeURIComponent(partId)}/full">${icon("list")} See full part</a>
          ${newsActivityButtonHtml()}
        </div>
        ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ""}
        ${groupsHtml || "<p class=\"muted\">No sections listed in this part.</p>"}
      `;
			enterView();
			selectTreeNode("p-" + partId);
			recordPartVisit(partId, partNode.d);
			fillNewsActivity("part", partId, seq);
		} catch (err) {
			console.error(err);
			setViewHead("");
			dom.view.innerHTML = `<div class="msg-error">Failed to load part: ${escapeHtml(err.message)}</div>`;
		}
	}
	async function loadPartFull(partId, params) {
		dom.view.innerHTML = "<div class=\"loading\">Loading Part " + escapeHtml(partId) + "…</div>";
		currentSection = null;
		updateChatContext();
		try {
			const seq = routeSeq;
			await ensureTreeLoaded();
			if (seq !== routeSeq) return;
			const partNode = findPartInTree(treeData, partId);
			if (!partNode) {
				renderNotFound();
				return;
			}
			const res = await fetch("/api/" + currentTitle + "/part/" + encodeURIComponent(partId) + "/full");
			if (seq !== routeSeq) return;
			if (!res.ok) {
				renderNotFound();
				return;
			}
			const data = await res.json();
			if (seq !== routeSeq) return;
			const from = params && params.get("from");
			const anchorId = (id) => "sec-" + String(id).replace(/[^a-zA-Z0-9.\-]/g, "_");
			const sectionsHtml = (data.sections || []).map((s) => {
				const num = escapeHtml(s.label);
				const title = escapeHtml(s.title || "");
				const body = s.reserved ? "<div class=\"reserved-note\">This section is reserved.</div>" : s.html || "";
				return `<article class="full-section${s.id === from ? " is-from" : ""}" id="${anchorId(s.id)}">
          <header class="full-section-head">
            <a class="full-section-anchor" href="${sectionHref(s.id)}" title="Open this section on its own">
              <span class="full-section-num">${num}</span>
              <span class="full-section-title">${title}</span>
            </a>
          </header>
          ${body}
        </article>`;
			}).join("");
			document.title = `Part ${partId} (full) · Title ${currentTitle}`;
			const [prevPart, nextPart] = partNeighbors(partId);
			const partBtn = (node, dir) => node ? docStepBtn("part", dir, `#/part/${encodeURIComponent(node.id)}/full`, `Part ${node.id}`, node.d, `<span class="step-word">Part </span>${escapeHtml(node.id)}`) : "";
			setViewHead(prevPart || nextPart ? `<nav class="doc-step" aria-label="Previous and next part">${partBtn(prevPart, -1)}<span class="spacer"></span>${partBtn(nextPart, 1)}</nav>` : "");
			dom.view.innerHTML = `
        <div class="doc-kicker">${currentTitle} CFR ${escapeHtml(partNode.l)} · <a href="#/part/${encodeURIComponent(partId)}">Table of contents</a></div>
        <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
        ${sectionsHtml || "<p class=\"muted\">No sections in this part.</p>"}
      `;
			recordPartVisit(partId, partNode.d);
			if (from) {
				const el = document.getElementById(anchorId(from));
				if (el) {
					const start = performance.now();
					let lastSet = -1;
					const anchor = () => {
						if (lastSet >= 0 && Math.abs(dom.main.scrollTop - lastSet) > 4) return;
						const r = el.getBoundingClientRect();
						const m = dom.main.getBoundingClientRect();
						const rel = r.top - m.top;
						if (rel < 60 || rel > 100) {
							el.scrollIntoView({ block: "start" });
							lastSet = dom.main.scrollTop;
						}
						if (performance.now() - start < 2500) requestAnimationFrame(anchor);
					};
					requestAnimationFrame(anchor);
				}
			} else dom.main.scrollTop = 0;
			selectTreeNode("s-" + (from || data.sections[0] && data.sections[0].id));
		} catch (err) {
			console.error(err);
			setViewHead("");
			dom.view.innerHTML = `<div class="msg-error">Failed to load part: ${escapeHtml(err.message)}</div>`;
		}
	}
	function tocTitle(node) {
		const l = (node.l || "").trim();
		const d = (node.d || "").trim();
		return l && d.startsWith(l) && d.length > l.length ? d.slice(l.length).trim() : d;
	}
	function findPartInTree(node, partId) {
		if (!node) return null;
		if (node.t === "part" && String(node.id) === String(partId)) return node;
		if (node.c) for (const ch of node.c) {
			const found = findPartInTree(ch, partId);
			if (found) return found;
		}
		return null;
	}
	let searchState = null;
	function renderResultRow(r, showTitleInPart) {
		let snippet = (r.snippet || "").replace(/^[\s.…]+|[\s.…]+$/g, "");
		snippet = escapeHtml(snippet).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
		const rTitle = r.title || currentTitle;
		return `
      <div class="result">
        <a class="result-title" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
          <span class="result-num">${escapeHtml(r.label)}</span>
          <span class="result-name">${escapeHtml(r.title_label || r.title)}</span>
          <span class="result-part">${showTitleInPart ? `Title ${rTitle} · ` : ""}Part ${escapeHtml(r.part || "")}</span>
        </a>
        ${snippet ? `<div class="result-snippet">…${snippet}…</div>` : ""}
      </div>
    `;
	}
	function renderSearchView() {
		if (!searchState) return;
		const { query, allTitles, data, view, filters, collapsed } = searchState;
		const rawResults = data.results || [];
		const total = Number(data.total || 0);
		let scopeHtml = "";
		if (installedTitles.length > 1) {
			const qEnc = encodeURIComponent(query);
			scopeHtml = `<span class="search-scope" role="group" aria-label="Search scope">
        <a class="${allTitles ? "" : "scope-on"}" href="#/search?q=${qEnc}"${allTitles ? "" : " aria-current=\"true\""}>Title ${currentTitle}</a>
        <a class="${allTitles ? "scope-on" : ""}" href="#/search?q=${qEnc}&scope=all"${allTitles ? " aria-current=\"true\"" : ""}>All ${installedTitles.length} titles</a>
      </span>`;
		}
		const viewToggleHtml = rawResults.length ? `<span class="search-view-toggle" role="group" aria-label="Results layout">
      <button type="button" class="${view === "compact" ? "is-on" : ""}" data-sview="compact" aria-pressed="${view === "compact"}">Compact</button>
      <button type="button" class="${view === "grouped" ? "is-on" : ""}" data-sview="grouped" aria-pressed="${view === "grouped"}">Grouped</button>
    </span>` : "";
		const qText = filters.text.trim().toLowerCase();
		const applyFilters = (list, { ignoreTitle = false, ignorePart = false } = {}) => list.filter((r) => {
			const rTitle = r.title || currentTitle;
			if (!ignoreTitle && filters.title !== null && rTitle !== filters.title) return false;
			if (!ignorePart && filters.part !== null && (r.part || "") !== filters.part) return false;
			if (filters.kind !== "all" && (r.kind || "section") !== filters.kind) return false;
			if (qText) {
				if (!`${r.label || ""} ${r.title_label || ""} ${r.part || ""} ${r.snippet || ""} title ${rTitle}`.toLowerCase().includes(qText)) return false;
			}
			return true;
		});
		const filtered = view === "grouped" ? applyFilters(rawResults) : rawResults;
		const hasActiveFilter = view === "grouped" && (filters.title !== null || filters.part !== null || filters.kind !== "all" || qText !== "");
		let filtersHtml = "";
		let bodyHtml = "";
		if (!rawResults.length) bodyHtml = `<div class="empty-state"><h2>No results</h2><p>Nothing in ${allTitles ? "the installed titles" : "Title " + currentTitle} matches “${escapeHtml(query)}”. Try fewer or different words.</p></div>`;
		else if (view === "compact") bodyHtml = `<div class="results-list">${rawResults.map((r) => renderResultRow(r, allTitles)).join("")}</div>`;
		else {
			const titleCounts = /* @__PURE__ */ new Map();
			for (const r of applyFilters(rawResults, {
				ignoreTitle: true,
				ignorePart: true
			})) {
				const t = r.title || currentTitle;
				titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
			}
			const sortedTitleFacets = [...titleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
			const partCounts = /* @__PURE__ */ new Map();
			for (const r of applyFilters(rawResults, { ignorePart: true })) {
				const p = r.part || "";
				if (p) partCounts.set(p, (partCounts.get(p) || 0) + 1);
			}
			const sortedPartFacets = [...partCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], void 0, { numeric: true }));
			const hasAppendices = rawResults.some((r) => r.kind === "appendix");
			const titlePills = sortedTitleFacets.length > 1 ? `
        <div class="search-filter-row">
          <span class="search-filter-label">Titles</span>
          <div class="search-filter-pills">
            <button type="button" class="sf-pill${filters.title === null ? " is-active" : ""}" data-ftitle="">All <span class="sf-pill-count">${rawResults.length}</span></button>
            ${sortedTitleFacets.map(([t, c]) => `<button type="button" class="sf-pill${filters.title === t ? " is-active" : ""}" data-ftitle="${t}">Title ${t} <span class="sf-pill-count">${c}</span></button>`).join("")}
          </div>
        </div>` : "";
			const partPills = sortedPartFacets.length > 1 ? `
        <div class="search-filter-row">
          <span class="search-filter-label">Parts</span>
          <div class="search-filter-pills">
            <button type="button" class="sf-pill${filters.part === null ? " is-active" : ""}" data-fpart="">All</button>
            ${sortedPartFacets.slice(0, 14).map(([p, c]) => `<button type="button" class="sf-pill${filters.part === p ? " is-active" : ""}" data-fpart="${escapeHtml(p)}">Part ${escapeHtml(p)} <span class="sf-pill-count">${c}</span></button>`).join("")}
          </div>
        </div>` : "";
			const kindPills = hasAppendices ? `
        <div class="search-filter-pills">
          <button type="button" class="sf-pill${filters.kind === "all" ? " is-active" : ""}" data-fkind="all">All types</button>
          <button type="button" class="sf-pill${filters.kind === "section" ? " is-active" : ""}" data-fkind="section">Sections</button>
          <button type="button" class="sf-pill${filters.kind === "appendix" ? " is-active" : ""}" data-fkind="appendix">Appendices</button>
        </div>` : "";
			filtersHtml = `
        <div class="search-filters" role="region" aria-label="Filter search results">
          <div class="search-filter-row">
            <input type="search" id="sf-text" class="search-filter-input" value="${escapeHtml(filters.text)}" placeholder="Filter these results by section, part, or phrase…" autocomplete="off" spellcheck="false">
            ${kindPills}
            ${hasActiveFilter ? "<button type=\"button\" class=\"sf-clear\" id=\"sf-clear\">Clear filters</button>" : ""}
          </div>
          ${titlePills}
          ${partPills}
        </div>
      `;
			if (!filtered.length) bodyHtml = `<div class="empty-state"><h2>No matching results</h2><p>None of the loaded results match your current filters.</p></div>`;
			else {
				const byTitle = /* @__PURE__ */ new Map();
				for (const r of filtered) {
					const t = r.title || currentTitle;
					if (!byTitle.has(t)) byTitle.set(t, []);
					byTitle.get(t).push(r);
				}
				bodyHtml = `<div class="search-groups">${[...byTitle.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).map(([t, tItems]) => {
					const tMeta = installedTitles.find((x) => x.title === t);
					const tLabel = tMeta ? `Title ${t} — ${tMeta.name}` : `Title ${t}`;
					const isCollapsed = collapsed.has(t);
					const byPart = /* @__PURE__ */ new Map();
					for (const r of tItems) {
						const p = r.part || "";
						if (!byPart.has(p)) byPart.set(p, []);
						byPart.get(p).push(r);
					}
					const partsHtml = [...byPart.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], void 0, { numeric: true })).map(([p, pItems]) => `
            <div class="search-part-group">
              ${p ? `<div class="search-part-head">
                <a class="search-part-link" href="#/title/${t}/part/${encodeURIComponent(p)}">Part ${escapeHtml(p)}</a>
                <span class="search-part-count">${pItems.length} ${pItems.length === 1 ? "result" : "results"}</span>
              </div>` : ""}
              ${pItems.map((r) => renderResultRow(r, false)).join("")}
            </div>
          `).join("");
					return `
            <section class="search-title-group${isCollapsed ? " is-collapsed" : ""}" data-tgroup="${t}">
              <button type="button" class="search-title-head" aria-expanded="${!isCollapsed}">
                <span class="search-title-caret" aria-hidden="true">${icon("chevronDown")}</span>
                <span class="search-title-name">${escapeHtml(tLabel)}</span>
                <span class="search-title-count">${tItems.length} ${tItems.length === 1 ? "result" : "results"}</span>
              </button>
              <div class="search-title-body">${partsHtml}</div>
            </section>
          `;
				}).join("")}</div>`;
			}
		}
		const countText = hasActiveFilter ? `${filtered.length.toLocaleString()} of ${rawResults.length.toLocaleString()} shown (${total.toLocaleString()} total)` : `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`;
		const wasFilterFocused = document.activeElement?.id === "sf-text";
		const selStart = wasFilterFocused ? document.activeElement.selectionStart : null;
		dom.view.innerHTML = `
      <div class="doc-kicker">Search</div>
      <h1 class="doc-title">${escapeHtml(query)}</h1>
      <div class="search-meta">
        <span>${countText} · ${data.ms} ms</span>
        <div class="search-controls">${viewToggleHtml}${scopeHtml}</div>
      </div>
      ${filtersHtml}
      ${bodyHtml}
    `;
		dom.view.querySelectorAll("[data-sview]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const next = btn.dataset.sview;
				if (next === searchState.view) return;
				searchState.view = next;
				lsSet("searchView", next);
				renderSearchView();
			});
		});
		const sfInput = document.getElementById("sf-text");
		if (sfInput) {
			if (wasFilterFocused) {
				sfInput.focus();
				if (selStart !== null) sfInput.setSelectionRange(selStart, selStart);
			}
			sfInput.addEventListener("input", () => {
				searchState.filters.text = sfInput.value;
				renderSearchView();
			});
		}
		dom.view.querySelectorAll("[data-ftitle]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const val = btn.dataset.ftitle === "" ? null : Number(btn.dataset.ftitle);
				searchState.filters.title = searchState.filters.title === val ? null : val;
				searchState.filters.part = null;
				renderSearchView();
			});
		});
		dom.view.querySelectorAll("[data-fpart]").forEach((btn) => {
			btn.addEventListener("click", () => {
				const val = btn.dataset.fpart === "" ? null : btn.dataset.fpart;
				searchState.filters.part = searchState.filters.part === val ? null : val;
				renderSearchView();
			});
		});
		dom.view.querySelectorAll("[data-fkind]").forEach((btn) => {
			btn.addEventListener("click", () => {
				searchState.filters.kind = btn.dataset.fkind;
				renderSearchView();
			});
		});
		const sfClear = document.getElementById("sf-clear");
		if (sfClear) sfClear.addEventListener("click", () => {
			searchState.filters = {
				title: null,
				part: null,
				kind: "all",
				text: ""
			};
			renderSearchView();
		});
		dom.view.querySelectorAll(".search-title-head").forEach((btn) => {
			btn.addEventListener("click", () => {
				const t = Number(btn.closest(".search-title-group").dataset.tgroup);
				if (searchState.collapsed.has(t)) searchState.collapsed.delete(t);
				else searchState.collapsed.add(t);
				renderSearchView();
			});
		});
	}
	async function loadSearchPage(query, scope) {
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		document.title = "Search · FRAMEWORK";
		setViewHead("");
		if (!query.trim()) {
			searchState = null;
			dom.view.innerHTML = "<div class=\"empty-state\"><h2>Search</h2><p>Type a word, phrase or section number in the search box above.</p></div>";
			return;
		}
		const allTitles = scope === "all" && installedTitles.length > 1;
		dom.view.innerHTML = `<div class="loading">Searching for “${escapeHtml(query)}”…</div>`;
		try {
			const url = allTitles ? `/api/search?q=${encodeURIComponent(query)}&title=all&limit=100` : `/api/${currentTitle}/search?q=${encodeURIComponent(query)}&limit=100`;
			const seq = routeSeq;
			const data = await (await fetch(url)).json();
			if (seq !== routeSeq) return;
			searchState = {
				query,
				allTitles,
				data,
				view: lsGet("searchView") === "grouped" ? "grouped" : "compact",
				filters: {
					title: null,
					part: null,
					kind: "all",
					text: ""
				},
				collapsed: /* @__PURE__ */ new Set()
			};
			renderSearchView();
			enterView();
		} catch (err) {
			dom.view.innerHTML = `<div class="msg-error">Search failed: ${escapeHtml(err.message)}</div>`;
		}
	}
	let searchTimer = null;
	let sdActive = -1;
	function moveSdActive(delta) {
		const items = [...dom.searchDropdown.querySelectorAll(".sd-item")];
		if (dom.searchDropdown.hidden || !items.length) return;
		sdActive = (sdActive + delta + items.length) % items.length;
		items.forEach((el, i) => el.classList.toggle("active", i === sdActive));
		items[sdActive].scrollIntoView({ block: "nearest" });
	}
	dom.search.addEventListener("input", () => {
		clearTimeout(searchTimer);
		sdActive = -1;
		const q = dom.search.value.trim();
		if (!q) {
			dom.searchDropdown.hidden = true;
			return;
		}
		if (q.startsWith(">")) {
			dom.searchDropdown.innerHTML = commandItemsHtml(q.slice(1));
			dom.searchDropdown.hidden = false;
			moveSdActive(1);
			return;
		}
		searchTimer = setTimeout(async () => {
			try {
				const data = await (await fetch(`/api/${currentTitle}/search?q=${encodeURIComponent(q)}&limit=6`)).json();
				if (!data.results || data.results.length === 0) dom.searchDropdown.innerHTML = `<div class="sd-footer">No quick matches. Press <kbd>Enter</kbd> to search the full text.</div>`;
				else {
					const items = data.results.map((r) => {
						let snip = (r.snippet || "").replace(/[\x02\x03]/g, "");
						return `
              <a class="sd-item" href="#/title/${r.title || currentTitle}/section/${encodeURIComponent(r.id)}">
                <span class="sd-label">${escapeHtml(r.label)}</span>
                <span>${escapeHtml(r.title_label || r.title)}</span>
                ${snip ? `<span class="sd-snippet">${escapeHtml(snip)}</span>` : ""}
              </a>
            `;
					}).join("");
					dom.searchDropdown.innerHTML = items + `<div class="sd-footer"><kbd>Enter</kbd> All ${Number(data.total).toLocaleString()} results<span class="sd-hint">Type <kbd>&gt;</kbd> for commands</span></div>`;
				}
				dom.searchDropdown.hidden = false;
			} catch (e) {
				dom.searchDropdown.hidden = true;
			}
		}, 180);
	});
	dom.search.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			const items = dom.searchDropdown.querySelectorAll(".sd-item");
			if (!dom.searchDropdown.hidden && sdActive >= 0 && items[sdActive]) {
				const cmd = items[sdActive].dataset.cmd;
				dom.searchDropdown.hidden = true;
				dom.search.blur();
				if (cmd || dom.search.value.trim().startsWith(">")) dom.search.value = "";
				if (cmd) {
					runCommand(cmd);
					return;
				}
				window.location.hash = items[sdActive].getAttribute("href");
				dom.searchDropdown.hidden = true;
				dom.search.blur();
				return;
			}
			dom.searchDropdown.hidden = true;
			const q = dom.search.value.trim();
			if (q && !q.startsWith(">")) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!dom.searchDropdown.hidden) {
				e.preventDefault();
				moveSdActive(e.key === "ArrowDown" ? 1 : -1);
			}
		} else if (e.key === "Escape") dom.searchDropdown.hidden = true;
	});
	dom.searchDropdown.addEventListener("click", (e) => {
		const item = e.target.closest(".sd-cmd");
		if (!item) return;
		dom.searchDropdown.hidden = true;
		dom.search.value = "";
		if (item.dataset.cmd) {
			e.preventDefault();
			runCommand(item.dataset.cmd);
		}
	});
	document.addEventListener("click", (e) => {
		if (!dom.search.contains(e.target) && !dom.searchDropdown.contains(e.target)) dom.searchDropdown.hidden = true;
	});
	document.addEventListener("keydown", (e) => {
		const active = document.activeElement;
		const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
		if (e.key === "/" && !typing || (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
			e.preventDefault();
			dom.search.focus();
			dom.search.select();
		} else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "j" || e.shiftKey && e.key.toLowerCase() === "k")) {
			e.preventDefault();
			toggleChat();
		}
	});
	const LEAF_TYPES = /* @__PURE__ */ new Set(["section", "appendix"]);
	const MAX_FILTER_RESULTS = 100;
	const AGENCY_META = {
		29: {
			"sub-A": {
				code: "DOL",
				name: "Office of the Secretary of Labor"
			},
			"ch-I": {
				code: "NLRB",
				name: "National Labor Relations Board"
			},
			"ch-II": {
				code: "OLMS",
				name: "Federal Transit Employee Protections"
			},
			"ch-III": {
				code: "NRAB",
				name: "National Railroad Adjustment Board"
			},
			"ch-IV": {
				code: "OLMS",
				name: "Labor-Management Standards (LMRDA)"
			},
			"ch-V": {
				code: "WHD",
				name: "Wage and Hour Division (FLSA, FMLA)"
			},
			"ch-IX": {
				code: "CICBC",
				name: "Construction Industry Collective Bargaining"
			},
			"ch-X": {
				code: "NMB",
				name: "National Mediation Board"
			},
			"ch-XII": {
				code: "FMCS",
				name: "Federal Mediation and Conciliation Service"
			},
			"ch-XIV": {
				code: "EEOC",
				name: "Equal Employment Opportunity Commission"
			},
			"ch-XVII": {
				code: "OSHA",
				name: "Occupational Safety and Health Admin"
			},
			"ch-XX": {
				code: "OSHRC",
				name: "Occupational Safety and Health Review"
			},
			"ch-XXV": {
				code: "EBSA",
				name: "Employee Benefits Security (ERISA)"
			},
			"ch-XXVII": {
				code: "FMSHRC",
				name: "Federal Mine Safety & Health Review"
			},
			"ch-XL": {
				code: "PBGC",
				name: "Pension Benefit Guaranty Corporation"
			}
		},
		40: {
			"ch-I": {
				code: "EPA",
				name: "Environmental Protection Agency"
			},
			"ch-IV": {
				code: "DOJ",
				name: "EPA and Department of Justice"
			},
			"ch-V": {
				code: "CEQ",
				name: "Council on Environmental Quality"
			},
			"ch-VI": {
				code: "CSB",
				name: "Chemical Safety and Hazard Investigation Board"
			},
			"ch-VII": {
				code: "DOD",
				name: "EPA and Defense: Vessel Discharge Standards"
			},
			"ch-VIII": {
				code: "GCERC",
				name: "Gulf Coast Ecosystem Restoration Council"
			},
			"ch-IX": {
				code: "FPISC",
				name: "Federal Permitting Improvement Steering Council"
			}
		},
		49: {
			"sub-A": {
				code: "DOT",
				name: "Office of the Secretary of Transportation"
			},
			"ch-I": {
				code: "PHMSA",
				name: "Pipeline and Hazardous Materials Safety Admin"
			},
			"ch-II": {
				code: "FRA",
				name: "Federal Railroad Administration"
			},
			"ch-III": {
				code: "FMCSA",
				name: "Federal Motor Carrier Safety Administration"
			},
			"ch-IV": {
				code: "USCG",
				name: "Coast Guard"
			},
			"ch-V": {
				code: "NHTSA",
				name: "National Highway Traffic Safety Admin"
			},
			"ch-VI": {
				code: "FTA",
				name: "Federal Transit Administration"
			},
			"ch-VII": {
				code: "Amtrak",
				name: "National Railroad Passenger Corporation"
			},
			"ch-VIII": {
				code: "NTSB",
				name: "National Transportation Safety Board"
			},
			"ch-X": {
				code: "STB",
				name: "Surface Transportation Board"
			},
			"ch-XII": {
				code: "TSA",
				name: "Transportation Security Administration"
			}
		}
	};
	function agencyMeta(node) {
		return (AGENCY_META[currentTitle] || {})[agencyKeyForNode(node)] || null;
	}
	const treeIdx = {
		nodes: [],
		parent: [],
		sections: /* @__PURE__ */ new Map(),
		parts: /* @__PURE__ */ new Map(),
		agencies: /* @__PURE__ */ new Map(),
		partList: [],
		agencyList: []
	};
	let visited = loadVisited();
	let treePromise = null;
	let currentTreeKey = null;
	let currentPartKey = null;
	let currentAgencyKey = null;
	let rootViewMode = lsGet("rootViewMode") === "all-parts" ? "all-parts" : "agencies";
	let sideView = rootViewMode;
	let treeFilterState = null;
	function visitedKey() {
		return currentTitle === 29 ? "visited" : "visited-" + currentTitle;
	}
	function loadVisited() {
		try {
			return new Set(JSON.parse(lsGet(visitedKey()) || "[]"));
		} catch (e) {
			return /* @__PURE__ */ new Set();
		}
	}
	async function switchTitle(newTitle) {
		if (newTitle === currentTitle && treeData) return;
		currentTitle = newTitle;
		fillTitleSelect();
		const titleMeta = installedTitles.find((t) => t.title === newTitle);
		if (titleMeta) {
			metaInfo = titleMeta;
			dom.edition.textContent = `eCFR ${titleMeta.edition || ""}`;
		}
		dom.search.placeholder = `Search Title ${newTitle} or jump to a section…`;
		dom.chatText.placeholder = `Ask about this section, or anything in Title ${newTitle}…`;
		updateRailHome();
		applyNav();
		treePromise = null;
		treeData = null;
		treeIdx.nodes = [];
		treeIdx.parent = [];
		treeIdx.sections = /* @__PURE__ */ new Map();
		treeIdx.parts = /* @__PURE__ */ new Map();
		treeIdx.agencies = /* @__PURE__ */ new Map();
		treeIdx.partList = [];
		treeIdx.agencyList = [];
		currentTreeKey = null;
		currentPartKey = null;
		currentAgencyKey = null;
		clearFilterQuietly();
		visited = loadVisited();
		sideView = rootViewMode;
		dom.tree.innerHTML = "<div class=\"loading\">Loading contents…</div>";
		await ensureTreeLoaded();
	}
	function ensureTreeLoaded() {
		if (!treePromise) treePromise = fetch("/api/" + currentTitle + "/tree").then((res) => {
			if (!res.ok) throw new Error("HTTP " + res.status);
			return res.json();
		}).then((data) => {
			treeData = data;
			indexTree(data);
			renderSidebar();
		}).catch((err) => {
			treePromise = null;
			dom.tree.innerHTML = `<div class="side-empty">Couldn't load the contents (${escapeHtml(err.message)}).</div>`;
			throw err;
		});
		return treePromise;
	}
	function normalizeForMatch(s) {
		return " " + String(s).toLowerCase().replace(/[§,;:()[\]"'\/–—]/g, " ").replace(/\s+/g, " ").trim() + " ";
	}
	function plural(n, word) {
		return `${n} ${word}${n === 1 ? "" : "s"}`;
	}
	function formatRange(range) {
		return String(range || "").trim().replace(/\s*[–-]\s*/g, "–");
	}
	function isAgencyNode(node) {
		return !!node && (node.t === "chapter" || node.t === "subtitle" && String(node.id) === "A");
	}
	function agencyKeyForNode(node) {
		if (!node) return "";
		if (node.t === "subtitle") return "sub-" + String(node.id || "").trim();
		if (node.t === "chapter") return "ch-" + String(node.id || "").trim();
		return "";
	}
	function agencyInfo(node) {
		if (!node) return {
			code: "CFR",
			name: "",
			range: ""
		};
		const meta = agencyMeta(node) || {};
		const roman = /^[IVXLC]+$/.test(String(node.id)) ? node.id : "";
		return {
			code: meta.code || (node.t === "subtitle" ? `Sub. ${node.id}` : roman ? `Ch. ${roman}` : "Ch."),
			name: meta.name || (node.d || node.l || "").trim().replace(/^Chapter\s+[IVXLC]+\s*[—–-]\s*/i, "").replace(/,\s*Department of [A-Z][A-Za-z ]+$/, ""),
			range: formatRange(node.range)
		};
	}
	function agencyOf(k) {
		for (let p = k; p >= 0; p = treeIdx.parent[p]) if (isAgencyNode(treeIdx.nodes[p])) return p;
		return null;
	}
	function indexTree(root) {
		const walk = (node, parentKey) => {
			const k = treeIdx.nodes.length;
			node.k = k;
			treeIdx.nodes.push(node);
			treeIdx.parent.push(parentKey);
			const label = (node.l || "").trim();
			const desc = (node.d || "").trim();
			let hayText = desc && desc !== label ? `${label} ${desc}` : label || desc;
			node.partCount = 0;
			if (isAgencyNode(node)) {
				treeIdx.agencies.set(agencyKeyForNode(node), k);
				treeIdx.agencyList.push(k);
				const meta = agencyMeta(node);
				if (meta) hayText += ` ${meta.code} ${meta.name}`;
			}
			node.hay = normalizeForMatch(hayText);
			if (LEAF_TYPES.has(node.t)) {
				treeIdx.sections.set(String(node.id), k);
				node.n = node.r ? 0 : 1;
				return;
			}
			if (node.t === "part") {
				treeIdx.parts.set(String(node.id), k);
				if (!node.r) treeIdx.partList.push(k);
			}
			node.n = 0;
			for (const child of node.c || []) {
				walk(child, k);
				node.n += child.n;
				if (child.t === "part" && !child.r) node.partCount += 1;
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
		for (let p = k; p >= 0; p = treeIdx.parent[p]) if (treeIdx.nodes[p].t === "part") return p;
		return null;
	}
	function rowParts(node) {
		const l = (node.l || "").trim();
		let d = (node.d || "").trim();
		if (l && d.startsWith(l) && d.length > l.length) d = d.slice(l.length).trim();
		if (node.t === "appendix") {
			const m = /^Appendix\s+(?!to\b)(\S+)/i.exec(l);
			return [m ? `App. ${m[1]}` : "App.", d || l];
		}
		return [String(node.id), d];
	}
	function tooltipFor(node) {
		const l = (node.l || "").trim();
		const d = (node.d || "").trim();
		return d && d !== l ? `${l} — ${d}` : l || d;
	}
	function hl(str) {
		const text = String(str ?? "");
		const re = treeFilterState && treeFilterState.re;
		if (!re) return escapeHtml(text);
		let out = "";
		let last = 0;
		for (const m of text.matchAll(re)) {
			const start = m.index + m[1].length;
			out += escapeHtml(text.slice(last, start)) + "<mark>" + escapeHtml(m[2]) + "</mark>";
			last = start + m[2].length;
		}
		return out + escapeHtml(text.slice(last));
	}
	function itemHtml(node) {
		const leaf = LEAF_TYPES.has(node.t);
		const [num, text] = rowParts(node);
		const href = `#/${leaf ? "section" : "part"}/${encodeURIComponent(node.id)}`;
		const isPage = node.k === currentTreeKey;
		const isAncestor = !isPage && !leaf && node.k === currentPartKey;
		const cls = ["side-item", leaf ? "is-section" : "is-part"];
		if (isPage) cls.push("current");
		if (isAncestor) cls.push("ancestor-current");
		if (leaf && visited.has(String(node.id))) cls.push("visited");
		return `<a class="${cls.join(" ")}" href="${href}" data-k="${node.k}" title="${escapeHtml(tooltipFor(node))}"${isPage ? " aria-current=\"page\"" : ""}><span class="side-num">${hl(num)}</span><span class="side-text">${hl(text)}</span></a>`;
	}
	function agencyRowHtml(node) {
		const info = agencyInfo(node);
		const isAncestor = node.k === currentAgencyKey;
		const meta = [info.range && `Parts ${info.range}`, plural(node.partCount || 0, "part")].filter(Boolean).join(" · ");
		return `<button type="button" class="side-agency${isAncestor ? " ancestor-current" : ""}" data-action="agency" data-k="${node.k}" title="${escapeHtml(tooltipFor(node))}"><span class="side-agency-code">${hl(info.code)}</span><span class="side-agency-body"><span class="side-agency-name">${hl(info.name)}</span><span class="side-agency-meta">${escapeHtml(meta)}</span></span></button>`;
	}
	function agencyLabelHtml(agencyNode) {
		const info = agencyInfo(agencyNode);
		return `<div class="side-label"><span class="side-label-code">${escapeHtml(info.code)}</span> ${escapeHtml(info.name)}</div>`;
	}
	function groupedHtml(keys) {
		let html = "";
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
		return `<nav class="side-breadcrumbs" aria-label="Sidebar location">${crumbs.map((c, i) => {
			if (i === crumbs.length - 1) return `<span class="side-crumb-current" aria-current="location">${escapeHtml(c.label)}</span>`;
			const kAttr = c.k != null ? ` data-k="${c.k}"` : "";
			return `<button type="button" class="side-crumb" data-action="${c.action}"${kAttr}>${escapeHtml(c.label)}</button>`;
		}).join("<span class=\"side-sep\" aria-hidden=\"true\">›</span>")}</nav>`;
	}
	function agenciesListHtml() {
		return `<div class="side-list side-agencies-list">${treeIdx.agencyList.map((k) => agencyRowHtml(treeIdx.nodes[k])).join("")}</div>`;
	}
	function agencyViewHtml(agency) {
		const info = agencyInfo(agency);
		let body = "";
		for (const c of agency.c || []) {
			if (c.r) continue;
			if (c.t === "part") body += itemHtml(c);
			else if (c.t === "subchapter") {
				const parts = (c.c || []).filter((ch) => ch.t === "part" && !ch.r);
				if (!parts.length) continue;
				const l = (c.l || "").trim();
				const d = (c.d || "").trim();
				body += `<div class="side-label">${escapeHtml(d ? `${l} — ${d}` : l)}</div>`;
				body += parts.map(itemHtml).join("");
			}
		}
		const meta = [info.range && `Parts ${info.range}`, plural(agency.partCount || 0, "part")].filter(Boolean).join(" · ");
		return `<div class="side-head">` + crumbsHtml([{
			label: "Agencies",
			action: "agencies"
		}, { label: info.code }]) + `<div class="side-heading" title="${escapeHtml(tooltipFor(agency))}"><div class="side-heading-title">${escapeHtml(info.name)}</div><div class="side-heading-meta">${escapeHtml(meta)}</div></div></div><div class="side-list">${body}</div>`;
	}
	function partsListHtml() {
		return groupedHtml(treeIdx.partList);
	}
	let foldedGroups = (() => {
		try {
			return new Set(JSON.parse(lsGet("sideFolded") || "[]"));
		} catch (e) {
			return /* @__PURE__ */ new Set();
		}
	})();
	function groupKey(part, sub) {
		return `${currentTitle}|${part.id}|${sub.id}`;
	}
	function saveFolded() {
		lsSet("sideFolded", JSON.stringify([...foldedGroups]));
	}
	function setGroupOpen(group, open, save = true) {
		group.classList.toggle("is-folded", !open);
		group.querySelector(".side-group-toggle")?.setAttribute("aria-expanded", String(open));
		if (group.dataset.group) {
			if (open) foldedGroups.delete(group.dataset.group);
			else foldedGroups.add(group.dataset.group);
			if (save) saveFolded();
		}
	}
	function partViewHtml(part) {
		const walk = (node) => {
			let out = "";
			for (const c of node.c || []) {
				if (c.r) continue;
				if (LEAF_TYPES.has(c.t)) out += itemHtml(c);
				else if (c.n) {
					const l = (c.l || "").trim();
					const d = (c.d || "").trim();
					if (c.t === "subpart") {
						const key = groupKey(part, c);
						const folded = foldedGroups.has(key) && !(currentTreeKey != null && isWithin(currentTreeKey, c.k));
						out += `<div class="side-group${folded ? " is-folded" : ""}" data-group="${escapeHtml(key)}"><button type="button" class="side-label side-group-toggle" data-action="toggle-group" aria-expanded="${!folded}"><span class="side-group-name">${escapeHtml(d ? `${l} — ${d}` : l)}</span>${icon("chevronDown", "side-group-caret")}</button><div class="side-group-body"><div class="side-group-inner">${walk(c)}</div></div></div>`;
					} else out += `<div class="side-label minor">${escapeHtml(d || l)}</div>` + walk(c);
				}
			}
			return out;
		};
		const body = walk(part);
		const agencyKey = agencyOf(part.k);
		const crumbs = rootViewMode === "agencies" && agencyKey != null ? [{
			label: "Agencies",
			action: "agencies"
		}, {
			label: agencyInfo(treeIdx.nodes[agencyKey]).code,
			action: "agency",
			k: agencyKey
		}] : [{
			label: "All parts",
			action: "parts"
		}];
		crumbs.push({ label: `Part ${part.id}` });
		return `<div class="side-head">` + crumbsHtml(crumbs) + `<a class="side-part-title${part.k === currentTreeKey ? " current" : ""}" href="#/part/${encodeURIComponent(part.id)}"${part.k === currentTreeKey ? " aria-current=\"page\"" : ""}>${escapeHtml((part.d || "").trim())}</a></div><div class="side-list">${body}</div>`;
	}
	function filterResultsHtml() {
		const f = treeFilterState;
		const q = f.q.trim();
		const fullText = `<a class="side-fulltext" href="#/search?q=${encodeURIComponent(q)}">Search the full text for “${escapeHtml(q)}”</a>`;
		if (!f.results.length) return `<div class="side-empty">Nothing matches.</div>${fullText}`;
		return groupedHtml(f.results) + fullText;
	}
	function updateNavTabsUI() {
		const tabs = document.getElementById("side-nav-tabs");
		if (!tabs) return;
		tabs.hidden = !!treeFilterState;
		const isAllParts = rootViewMode === "all-parts";
		const tabAgencies = document.getElementById("tab-agencies");
		const tabParts = document.getElementById("tab-parts");
		if (tabAgencies && tabParts) {
			tabAgencies.classList.toggle("active", !isAllParts);
			tabAgencies.setAttribute("aria-selected", String(!isAllParts));
			tabParts.classList.toggle("active", isAllParts);
			tabParts.setAttribute("aria-selected", String(isAllParts));
			tabParts.textContent = `All ${treeIdx.partList.length} parts`;
		}
	}
	function renderSidebar() {
		if (!treeData) return;
		updateNavTabsUI();
		if (treeFilterState) dom.tree.innerHTML = filterResultsHtml();
		else if (sideView === "agencies") dom.tree.innerHTML = agenciesListHtml();
		else if (sideView === "all-parts") dom.tree.innerHTML = partsListHtml();
		else if (typeof sideView === "number") {
			const node = treeIdx.nodes[sideView];
			dom.tree.innerHTML = isAgencyNode(node) ? agencyViewHtml(node) : partViewHtml(node);
		}
		dom.tree.scrollTop = 0;
	}
	function clearFilterQuietly() {
		if (!treeFilterState && !dom.treeFilter.value) return;
		clearTimeout(filterTimer);
		dom.treeFilter.value = "";
		treeFilterState = null;
	}
	function showAgenciesList() {
		rootViewMode = "agencies";
		lsSet("rootViewMode", "agencies");
		sideView = "agencies";
		renderSidebar();
		revealCurrent(false);
	}
	function showAgencyView(k) {
		rootViewMode = "agencies";
		lsSet("rootViewMode", "agencies");
		sideView = k;
		renderSidebar();
		revealCurrent(false);
	}
	function showPartsList() {
		rootViewMode = "all-parts";
		lsSet("rootViewMode", "all-parts");
		sideView = "all-parts";
		renderSidebar();
		revealCurrent(false);
	}
	function selectTreeNode(elementId) {
		if (!treeData) return;
		const m = /^([sp])-(.+)$/.exec(elementId);
		if (!m) return;
		const k = (m[1] === "s" ? treeIdx.sections : treeIdx.parts).get(m[2]);
		if (k === void 0) return;
		currentTreeKey = k;
		currentPartKey = partOf(k);
		currentAgencyKey = agencyOf(k);
		if (m[1] === "s") markVisited(m[2]);
		const switchPart = currentPartKey != null && sideView !== currentPartKey;
		if (switchPart) sideView = currentPartKey;
		if (treeFilterState) {
			refreshCurrent();
			return;
		}
		if (switchPart) {
			const hadFocus = dom.tree.contains(document.activeElement);
			renderSidebar();
			revealCurrent(false);
			if (hadFocus) (dom.tree.querySelector(".side-item.current") || dom.tree.querySelector(".side-part-title"))?.focus({ preventScroll: true });
		} else {
			refreshCurrent();
			revealCurrent(true);
		}
	}
	function refreshCurrent() {
		dom.tree.querySelectorAll(".current, .ancestor-current").forEach((el) => {
			el.classList.remove("current", "ancestor-current");
			el.removeAttribute("aria-current");
		});
		if (currentTreeKey == null) return;
		const markPage = (el) => {
			if (el) {
				el.classList.add("current");
				el.setAttribute("aria-current", "page");
			}
		};
		const markAncestor = (el) => {
			if (el && !el.classList.contains("current")) el.classList.add("ancestor-current");
		};
		const page = dom.tree.querySelector(`.side-item[data-k="${currentTreeKey}"]`);
		markPage(page);
		const folded = page && page.closest(".side-group.is-folded");
		if (folded) setGroupOpen(folded, true);
		if (currentTreeKey === currentPartKey) {
			if (sideView === currentPartKey) markPage(dom.tree.querySelector(".side-part-title"));
		} else markAncestor(dom.tree.querySelector(`.side-item.is-part[data-k="${currentPartKey}"]`));
		markAncestor(dom.tree.querySelector(`.side-agency[data-k="${currentAgencyKey}"]`));
	}
	function clearTreeSelection() {
		if (currentTreeKey == null) return;
		currentTreeKey = null;
		currentPartKey = null;
		currentAgencyKey = null;
		refreshCurrent();
	}
	function revealCurrent(smooth = false) {
		const el = dom.tree.querySelector(".side-item.current") || dom.tree.querySelector(".side-item.ancestor-current, .side-agency.ancestor-current");
		if (el) scrollIntoTree(el, smooth);
	}
	function scrollIntoTree(el, smooth) {
		const box = dom.tree.getBoundingClientRect();
		if (!box.height) return;
		const head = dom.tree.querySelector(".side-head");
		const top = box.top + (head && !head.contains(el) ? head.offsetHeight : 0);
		const r = el.getBoundingClientRect();
		if (r.top < top + 4 || r.bottom > box.bottom - 4) dom.tree.scrollTo({
			top: dom.tree.scrollTop + r.top - box.top - box.height / 3,
			behavior: smooth ? "smooth" : "auto"
		});
	}
	function markVisited(id) {
		if (visited.has(id)) return;
		visited.add(id);
		lsSet(visitedKey(), JSON.stringify([...visited]));
		dom.tree.querySelector(`.side-item.is-section[data-k="${treeIdx.sections.get(id)}"]`)?.classList.add("visited");
	}
	function escapeRegExp(s) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	function computeFilter(q) {
		const cleaned = q.trim().replace(/^\d{1,2}\s*c\.?\s*f\.?\s*r\.?\s*/i, "");
		const tokens = [...new Set(normalizeForMatch(cleaned).trim().split(" ").filter(Boolean))].slice(0, 12);
		if (!tokens.length) return null;
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
			for (let i = 0; i < tokens.length; i++) if (node.hay.includes(" " + tokens[i])) m |= 1 << i;
			own[k] = m;
			if (p >= 0) {
				anc[k] = anc[p] | own[p];
				ancFull[k] = ancFull[p] || own[p] === ALL ? 1 : 0;
			}
			if (node.r || !(node.t === "part" || LEAF_TYPES.has(node.t) || isAgencyNode(node))) continue;
			if (m === ALL || m !== 0 && (m | anc[k]) === ALL && !ancFull[k]) {
				results.push(k);
				if (results.length >= MAX_FILTER_RESULTS) break;
			}
		}
		const alt = tokens.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
		return {
			q,
			re: new RegExp(`(^|[\\s§,;:()\\[\\]"'/\\u2013\\u2014])(${alt})`, "gi"),
			results
		};
	}
	function applyTreeFilter() {
		if (!treeData) return;
		treeFilterState = computeFilter(dom.treeFilter.value);
		renderSidebar();
		if (!treeFilterState) revealCurrent(false);
	}
	let filterTimer = 0;
	dom.treeFilter.addEventListener("input", () => {
		clearTimeout(filterTimer);
		filterTimer = setTimeout(applyTreeFilter, 120);
	});
	dom.treeFilter.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			if (dom.treeFilter.value) {
				dom.treeFilter.value = "";
				applyTreeFilter();
			} else dom.treeFilter.blur();
		} else if (e.key === "ArrowDown") {
			const first = dom.tree.querySelector("a, button");
			if (first) {
				e.preventDefault();
				first.focus();
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			clearTimeout(filterTimer);
			applyTreeFilter();
			const q = dom.treeFilter.value.trim();
			const first = dom.tree.querySelector(".side-item, .side-agency");
			if (first) {
				if (first.tagName === "A") window.location.hash = first.getAttribute("href");
				else first.click();
			} else if (q) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
		}
	});
	dom.tree.addEventListener("click", (e) => {
		const toggle = e.target.closest("[data-action=\"toggle-group\"]");
		if (toggle) {
			const group = toggle.closest(".side-group");
			const open = group.classList.contains("is-folded");
			if (e.altKey) {
				dom.tree.querySelectorAll(".side-group").forEach((g) => setGroupOpen(g, open, false));
				saveFolded();
			} else setGroupOpen(group, open);
			return;
		}
		const action = e.target.closest("[data-action]");
		if (action) {
			const kind = action.dataset.action;
			const k = parseInt(action.dataset.k, 10);
			clearFilterQuietly();
			if (kind === "agencies") showAgenciesList();
			else if (kind === "parts") showPartsList();
			else if (kind === "agency" && !isNaN(k)) showAgencyView(k);
			else return;
			if (e.detail === 0) (dom.tree.querySelector(".current, .ancestor-current") || dom.tree.querySelector("a, button"))?.focus({ preventScroll: true });
			return;
		}
		const link = e.target.closest("a");
		if (link && link.getAttribute("href") === window.location.hash && isFly() && flyOpen()) closeDrawer();
	});
	const sideNavTabs = document.getElementById("side-nav-tabs");
	if (sideNavTabs) sideNavTabs.addEventListener("click", (e) => {
		const btn = e.target.closest(".side-nav-tab");
		if (!btn) return;
		if (btn.dataset.mode === "agencies") showAgenciesList();
		else showPartsList();
	});
	dom.tree.addEventListener("keydown", (e) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const items = [...dom.tree.querySelectorAll("a, button")].filter((el) => !el.closest(".side-group.is-folded .side-group-body"));
		const i = items.indexOf(document.activeElement);
		if (i < 0) return;
		e.preventDefault();
		const next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
		if (next) {
			next.focus({ preventScroll: true });
			scrollIntoTree(next, false);
		} else if (e.key === "ArrowUp") dom.treeFilter.focus();
	});
	const PROJECTS_KEY = "framework_projects_v1";
	const PROJECT_HUES = [
		"--accent",
		"--ok",
		"--warn",
		"--partial",
		"--blue",
		"--danger"
	];
	const validProject = (p) => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.sections);
	function loadProjects() {
		try {
			const v = JSON.parse(lsGet(PROJECTS_KEY) || "[]");
			return Array.isArray(v) ? v.filter(validProject) : [];
		} catch (e) {
			return [];
		}
	}
	function saveProjects(list, { quiet = false } = {}) {
		lsSet(PROJECTS_KEY, JSON.stringify(list));
		if (navState.panel === "projects" || navState.panel === "history") renderPanel(navState.panel);
		if (navState.panel === "projects") drawerEl.meta.textContent = panelMeta("projects");
		if (!quiet && routeTarget() === "projects") renderProjects(projectRouteId());
		updatePinButton();
	}
	const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
	function createProject(name, extra = {}) {
		const list = loadProjects();
		const p = {
			id: `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
			name: (name || "").trim() || "Untitled dossier",
			description: "",
			tags: [],
			created_at: nowIso(),
			updated_at: nowIso(),
			sections: [],
			...extra
		};
		list.unshift(p);
		saveProjects(list);
		return p;
	}
	function updateProject(id, fn, opts) {
		const list = loadProjects();
		const p = list.find((x) => x.id === id);
		if (!p) return null;
		fn(p);
		p.updated_at = nowIso();
		saveProjects(list, opts);
		return p;
	}
	function projectHue(p) {
		let h = 0;
		for (const ch of p.id) h = h * 31 + ch.charCodeAt(0) >>> 0;
		return PROJECT_HUES[h % PROJECT_HUES.length];
	}
	const projDot = (p) => `<span class="proj-dot" style="--hue: var(${projectHue(p)})" aria-hidden="true"></span>`;
	const secKey = (title, id) => `${title}|${id}`;
	const projectsWith = (title, id) => loadProjects().filter((p) => p.sections.some((s) => s.title === title && s.id === id));
	function togglePin(projectId, sec) {
		let pinned = false;
		const p = updateProject(projectId, (proj) => {
			const i = proj.sections.findIndex((s) => s.title === sec.title && s.id === sec.id);
			if (i >= 0) proj.sections.splice(i, 1);
			else {
				proj.sections.push({
					...sec,
					pinned_at: nowIso(),
					note: ""
				});
				pinned = true;
			}
		});
		if (p) showToast(pinned ? `Pinned ${sec.label} to ${p.name}` : `Removed ${sec.label} from ${p.name}`);
		return pinned;
	}
	function currentSectionRef() {
		if (!currentSection) return null;
		return {
			title: currentTitle,
			id: currentSection.id,
			label: currentSection.label || `§ ${currentSection.id}`,
			heading: currentSection.section_title || currentSection.title_label || "",
			part: currentSection.part || ""
		};
	}
	let newProjectOpen = false;
	function showNewProjectForm() {
		newProjectOpen = true;
		if (!drawerShown() || navState.panel !== "projects") openPanel("projects");
		else renderProjectsPanel();
		requestAnimationFrame(() => document.getElementById("dr-new-name")?.focus());
	}
	const projectRouteId = () => {
		const m = /\/projects\/([^/?]+)/.exec(activeRoute || "");
		return m ? decodeURIComponent(m[1]) : null;
	};
	function renderProjectsPanel() {
		const list = loadProjects();
		const current = projectRouteId();
		const form = newProjectOpen ? `<form class="dr-new" id="dr-new-project">
        <input class="dr-input" id="dr-new-name" name="name" placeholder="Dossier name" maxlength="80" autocomplete="off" aria-label="New dossier name">
        <button type="submit" class="lib-act is-primary">Create</button></form>` : "";
		const rows = list.map((p) => `<a class="dr-proj${p.id === current ? " is-current" : ""}" href="#/projects/${encodeURIComponent(p.id)}"${p.id === current ? " aria-current=\"page\"" : ""}>
        ${projDot(p)}<span class="dr-proj-text"><span class="dr-name">${escapeHtml(p.name)}</span>
        <span class="dr-proj-meta">${joinSep([plural(p.sections.length, "section"), escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))])}</span></span></a>`).join("");
		const mod = isMac ? "⌘" : "Ctrl ";
		setPanel("projects", `${form}
      ${list.length ? `<section class="dr-sec">${drLabel("Dossiers", `<span class="dr-count">${list.length}</span>`)}${rows}</section>` : drEmpty("No dossiers yet", `Group the sections you need for an audit, a permit or a review. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd>.`) + (newProjectOpen ? "" : "<button type=\"button\" class=\"btn dr-empty-btn\" data-nav-act=\"new-project\">New dossier</button>")}
      <div class="dr-foot">
        <a class="dr-link" href="#/projects">All projects</a>
        <span class="dr-foot-acts"><button type="button" class="dr-link" data-proj-act="export"${list.length ? "" : " disabled"}>Export</button><button type="button" class="dr-link" data-proj-act="import">Import</button></span>
      </div>`);
	}
	dom.sidebar.addEventListener("submit", (e) => {
		if (e.target.id !== "dr-new-project") return;
		e.preventDefault();
		const name = e.target.elements.name.value.trim();
		if (!name) return;
		newProjectOpen = false;
		const p = createProject(name);
		window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
	});
	dom.sidebar.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && e.target.id === "dr-new-name") {
			e.preventDefault();
			newProjectOpen = false;
			renderProjectsPanel();
		}
	});
	function downloadJson(name, data) {
		const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1e3);
	}
	const exportProjects = (list, name = "framework-projects.json") => downloadJson(name, {
		format: "framework-projects",
		version: 1,
		exported_at: nowIso(),
		projects: list
	});
	const importInput = document.getElementById("projects-import");
	importInput.addEventListener("change", async () => {
		const file = importInput.files && importInput.files[0];
		importInput.value = "";
		if (!file) return;
		try {
			const raw = JSON.parse(await file.text());
			const incoming = (Array.isArray(raw) ? raw : raw.projects || []).filter(validProject);
			if (!incoming.length) throw new Error("No dossiers in that file");
			const list = loadProjects();
			for (const p of incoming) {
				const i = list.findIndex((x) => x.id === p.id);
				if (i < 0) list.push(p);
				else if ((p.updated_at || "") >= (list[i].updated_at || "")) list[i] = p;
			}
			saveProjects(list);
			showToast(`Imported ${plural(incoming.length, "dossier")}`);
		} catch (err) {
			showToast(`Couldn’t import: ${err.message}`, 5e3);
		}
	});
	function onProjectAction(btn) {
		const act = btn.dataset.projAct;
		if (act === "export") exportProjects(loadProjects());
		else if (act === "import") importInput.click();
		else if (act === "new") {
			const p = createProject("Untitled dossier");
			window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
			requestAnimationFrame(() => setTimeout(() => {
				const n = dom.view.querySelector(".proj-name");
				if (n) {
					n.focus();
					n.select();
				}
			}, 60));
		} else if (act === "export-one") {
			const p = loadProjects().find((x) => x.id === btn.dataset.id);
			if (p) exportProjects([p], `${p.name.replace(/[^\w-]+/g, "-").toLowerCase() || "dossier"}.json`);
		} else if (act === "delete" || act === "unpin") {
			if (!btn.classList.contains("is-armed")) {
				const label = btn.textContent;
				btn.classList.add("is-armed");
				btn.textContent = act === "delete" ? "Delete dossier?" : "Remove?";
				clearTimeout(btn._t);
				btn._t = setTimeout(() => {
					btn.classList.remove("is-armed");
					btn.textContent = label;
				}, 4e3);
				return;
			}
			if (act === "delete") {
				const list = loadProjects().filter((x) => x.id !== btn.dataset.id);
				window.location.hash = "#/projects";
				saveProjects(list);
				showToast("Dossier deleted");
			} else {
				const [title, ...rest] = btn.dataset.sec.split("|");
				updateProject(projectRouteId(), (p) => {
					p.sections = p.sections.filter((s) => !(s.title === Number(title) && s.id === rest.join("|")));
				});
			}
		}
	}
	dom.sidebar.addEventListener("click", (e) => {
		const b = e.target.closest("[data-proj-act]");
		if (b) onProjectAction(b);
	});
	dom.view.addEventListener("click", (e) => {
		const b = e.target.closest("[data-proj-act]");
		if (b && dom.view.querySelector(".proj-page")) onProjectAction(b);
	});
	function titlesOf(p) {
		const ts = [...new Set(p.sections.map((s) => s.title))].sort((a, b) => a - b);
		return ts.length ? `${ts.length === 1 ? "Title" : "Titles"} ${ts.join(", ")}` : "";
	}
	function renderProjects(id) {
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		setViewHead("");
		const list = loadProjects();
		const sections = list.reduce((a, p) => a + p.sections.length, 0);
		const fresh = !dom.view.querySelector(`.proj-page[data-id="${id || ""}"]`);
		if (!id) {
			document.title = "Projects · FRAMEWORK";
			const cards = list.map((p) => `<article class="lib-story proj-card">
          <div class="story-top"><span class="story-kicker">${projDot(p)}Dossier${SEP}Updated ${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</span></div>
          <h3 class="story-name"><a href="#/projects/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></h3>
          ${p.description ? `<p class="story-dek">${escapeHtml(p.description)}</p>` : ""}
          ${p.tags && p.tags.length ? `<div class="proj-tags">${p.tags.map((t) => `<span class="proj-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
          <div class="story-foot"><span class="story-date">${joinSep([plural(p.sections.length, "section"), escapeHtml(titlesOf(p))])}</span></div>
        </article>`).join("");
			const mod = isMac ? "⌘" : "Ctrl ";
			dom.view.innerHTML = `<div class="lib lib-front proj-page" data-id="">
        <div class="doc-kicker"><a href="#/">Overview</a></div>
        <div class="lib-head">
          <div class="lib-head-text"><h1 class="doc-title">Projects</h1>
            <p class="lib-sub">${joinSep([
				"Dossiers of pinned sections for an audit, a permit or a review",
				plural(list.length, "dossier"),
				plural(sections, "section")
			])}</p></div>
          <button type="button" class="btn" data-proj-act="new">${icon("plus")} New dossier</button>
        </div>
        ${list.length ? `<div class="lib-desk"><header class="lib-desk-header"><h2 class="lib-desk-name">All dossiers</h2><span class="lib-desk-count">${plural(list.length, "dossier")}</span></header>
          <div class="lib-stories">${cards}</div></div>` : `<div class="proj-empty"><div class="dr-empty-title">Start a dossier</div>
              <p>Collect the sections an audit or a permit review turns on, with a note on each. Open any section and press <strong>Pin</strong> or <kbd>${mod}D</kbd>, or start an empty dossier here.</p>
              <span class="proj-empty-acts"><button type="button" class="btn btn-accent" data-proj-act="new">${icon("plus")} New dossier</button><button type="button" class="btn" data-proj-act="import">Import JSON</button></span></div>`}
      </div>`;
			if (fresh) enterView();
			return;
		}
		const p = list.find((x) => x.id === id);
		if (!p) {
			document.title = "Projects · FRAMEWORK";
			dom.view.innerHTML = `<div class="empty-state proj-page" data-id="${escapeHtml(id)}"><h2>No such dossier</h2><p>It may have been deleted, or it lives in another browser.</p><a class="btn" href="#/projects">All projects</a></div>`;
			return;
		}
		document.title = `${p.name} · Projects · FRAMEWORK`;
		const installed = new Set(installedTitles.map((t) => t.title));
		const items = p.sections.map((s) => {
			const href = `#/title/${s.title}/section/${encodeURIComponent(s.id)}`;
			return `<article class="proj-item">
        <div class="story-top"><span class="story-kicker">Title ${s.title}${s.part ? `${SEP}Part ${escapeHtml(s.part)}` : ""}</span>
          <span class="proj-item-date">Pinned ${escapeHtml(shortDate((s.pinned_at || "").slice(0, 10)))}</span></div>
        <h3 class="story-name">${installed.has(s.title) ? `<a href="${href}">${escapeHtml(s.label || "§ " + s.id)} ${escapeHtml(s.heading || "")}</a>` : `${escapeHtml(s.label || "§ " + s.id)} ${escapeHtml(s.heading || "")}`}</h3>
        ${installed.has(s.title) ? "" : `<p class="proj-missing">Title ${s.title} isn’t installed. <a href="#/library/${s.title}">Download it</a> to read this section.</p>`}
        <textarea class="proj-note" rows="1" data-sec="${escapeHtml(secKey(s.title, s.id))}" placeholder="Add a note…" aria-label="Note on ${escapeHtml(s.label || s.id)}">${escapeHtml(s.note || "")}</textarea>
        <div class="proj-item-acts"><button type="button" class="lib-act is-danger" data-proj-act="unpin" data-sec="${escapeHtml(secKey(s.title, s.id))}">Remove</button></div>
      </article>`;
		}).join("");
		const mod = isMac ? "⌘" : "Ctrl ";
		dom.view.innerHTML = `<div class="lib proj-page proj-detail" data-id="${escapeHtml(p.id)}">
      <div class="doc-kicker"><a href="#/projects">Projects</a></div>
      <div class="proj-head">
        <span class="proj-icon" style="--hue: var(${projectHue(p)})" aria-hidden="true">${icon("folder")}</span>
        <input class="proj-name" value="${escapeHtml(p.name)}" maxlength="80" aria-label="Dossier name" spellcheck="false">
        <span class="proj-head-acts">
          <button type="button" class="lib-act" data-proj-act="export-one" data-id="${escapeHtml(p.id)}">Export</button>
          <button type="button" class="lib-act is-danger" data-proj-act="delete" data-id="${escapeHtml(p.id)}">Delete</button>
        </span>
      </div>
      <textarea class="proj-desc" rows="1" placeholder="Add a description…" aria-label="Description">${escapeHtml(p.description || "")}</textarea>
      <dl class="proj-props">
        <div><dt>Tags</dt><dd><input class="proj-tags-input" value="${escapeHtml((p.tags || []).join(", "))}" placeholder="Add tags, separated by commas" aria-label="Tags"></dd></div>
        <div><dt>Sections</dt><dd>${joinSep([plural(p.sections.length, "section"), escapeHtml(titlesOf(p))]) || "0 sections"}</dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(fmtDate((p.created_at || "").slice(0, 10)))}</dd></div>
        <div><dt>Updated</dt><dd data-f="updated">${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</dd></div>
      </dl>
      <div class="lib-desk">
        <header class="lib-desk-header"><h2 class="lib-desk-name">Pinned sections</h2><span class="lib-desk-count">${plural(p.sections.length, "section")}</span></header>
        ${items || `<div class="proj-empty is-inline"><p>Nothing pinned yet. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd> to add it here.</p></div>`}
      </div>
    </div>`;
		for (const t of dom.view.querySelectorAll(".proj-desc, .proj-note")) autosize(t);
		if (fresh) enterView();
		if (navState.panel === "projects") renderProjectsPanel();
	}
	function autosize(t) {
		t.style.height = "auto";
		t.style.height = `${t.scrollHeight}px`;
	}
	let projEditT = null;
	dom.view.addEventListener("input", (e) => {
		const page = e.target.closest(".proj-detail");
		if (!page) return;
		const id = page.dataset.id;
		const t = e.target;
		if (t.matches("textarea")) autosize(t);
		clearTimeout(projEditT);
		projEditT = setTimeout(() => {
			updateProject(id, (p) => {
				if (t.matches(".proj-name")) p.name = t.value.trim() || "Untitled dossier";
				else if (t.matches(".proj-desc")) p.description = t.value;
				else if (t.matches(".proj-tags-input")) p.tags = t.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
				else if (t.matches(".proj-note")) {
					const s = p.sections.find((x) => secKey(x.title, x.id) === t.dataset.sec);
					if (s) s.note = t.value;
				}
			}, { quiet: true });
			const upd = page.querySelector("[data-f=\"updated\"]");
			if (upd) upd.textContent = "just now";
			if (t.matches(".proj-name")) document.title = `${t.value.trim() || "Untitled dossier"} · Projects · FRAMEWORK`;
		}, 300);
	});
	dom.view.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && e.target.matches(".proj-name, .proj-tags-input")) {
			e.preventDefault();
			e.target.blur();
		}
	});
	const NEWS_CATEGORIES = [
		{
			key: "all",
			label: "All"
		},
		{
			key: "rules",
			label: "Final Rules"
		},
		{
			key: "rulemaking",
			label: "Proposed Rules"
		},
		{
			key: "enforcement",
			label: "Enforcement & Penalties"
		},
		{
			key: "public_inspection",
			label: "Public Inspection"
		},
		{
			key: "notices",
			label: "Notices"
		}
	];
	const NEWS_SOURCE_LABELS = {
		federal_register: "Federal Register",
		federal_register_pi: "Federal Register Public Inspection",
		dol_osha: "DOL enforcement data"
	};
	const US_STATE_NAMES = {
		AL: "Alabama",
		AK: "Alaska",
		AZ: "Arizona",
		AR: "Arkansas",
		CA: "California",
		CO: "Colorado",
		CT: "Connecticut",
		DE: "Delaware",
		DC: "District of Columbia",
		FL: "Florida",
		GA: "Georgia",
		GU: "Guam",
		HI: "Hawaii",
		ID: "Idaho",
		IL: "Illinois",
		IN: "Indiana",
		IA: "Iowa",
		KS: "Kansas",
		KY: "Kentucky",
		LA: "Louisiana",
		ME: "Maine",
		MD: "Maryland",
		MA: "Massachusetts",
		MI: "Michigan",
		MN: "Minnesota",
		MS: "Mississippi",
		MO: "Missouri",
		MT: "Montana",
		NE: "Nebraska",
		NV: "Nevada",
		NH: "New Hampshire",
		NJ: "New Jersey",
		NM: "New Mexico",
		NY: "New York",
		NC: "North Carolina",
		ND: "North Dakota",
		OH: "Ohio",
		OK: "Oklahoma",
		OR: "Oregon",
		PA: "Pennsylvania",
		PR: "Puerto Rico",
		RI: "Rhode Island",
		SC: "South Carolina",
		SD: "South Dakota",
		TN: "Tennessee",
		TX: "Texas",
		UT: "Utah",
		VT: "Vermont",
		VA: "Virginia",
		VI: "Virgin Islands",
		WA: "Washington",
		WV: "West Virginia",
		WI: "Wisconsin",
		WY: "Wyoming"
	};
	const stateName = (code) => US_STATE_NAMES[(code || "").toUpperCase()] || code;
	const NEWS_CITE_RE = /\b29\s*C\.?F\.?R\.?\s*(?:§§?\s*)?(\d{1,4}\.\d+)(?:\([a-z0-9]{1,4}\))*|§§?\s*(19\d{2}\.\d+)(?:\([a-z0-9]{1,4}\))*/gi;
	function lsGetJSON(key) {
		try {
			const v = lsGet(key);
			return v ? JSON.parse(v) : null;
		} catch (e) {
			return null;
		}
	}
	function lsSetJSON(key, value) {
		lsSet(key, JSON.stringify(value));
	}
	const moneyFmt = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0
	});
	function fmtMoney(n) {
		return moneyFmt.format(n);
	}
	function safeHttpUrl(u) {
		if (!u) return "";
		try {
			const p = new URL(u, window.location.href).protocol;
			return p === "http:" || p === "https:" ? u : "";
		} catch (e) {
			return "";
		}
	}
	function extLink(url, html) {
		const safe = safeHttpUrl(url);
		return safe ? `<a target="_blank" rel="noopener" href="${escapeHtml(safe)}">${html}</a>` : html;
	}
	function titleInstalled(t) {
		return installedTitles.some((x) => x.title === t);
	}
	function newsSectionHref(t, id) {
		return titleInstalled(t) ? `#/title/${t}/section/${encodeURIComponent(id)}` : `#/library/${t}`;
	}
	function newsPartHref(t, part) {
		return titleInstalled(t) ? `#/title/${t}/part/${encodeURIComponent(part)}` : `#/library/${t}`;
	}
	function linkifyNewsText(text) {
		return escapeHtml(text || "").replace(NEWS_CITE_RE, (m, a, b) => {
			return `<a class="citation-link" href="${newsSectionHref(29, a || b)}">${m}</a>`;
		});
	}
	function newsSnippetHtml(snippet) {
		return escapeHtml(snippet || "").replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
	}
	const newsState = {
		view: null,
		data: null,
		status: null,
		facets: null,
		watchToken: 0
	};
	function newsViewFromParams(params) {
		const get = (k) => (params && params.get(k) || "").trim();
		return {
			cat: NEWS_CATEGORIES.some((c) => c.key === get("cat")) ? get("cat") : "all",
			q: get("q"),
			section: get("section"),
			part: get("part"),
			state: /^[A-Za-z]{2}$/.test(get("state")) ? get("state").toUpperCase() : "",
			min_penalty: /^\d+$/.test(get("min_penalty")) ? get("min_penalty") : "",
			gravity: /^[WRS]$/.test(get("gravity")) ? get("gravity") : ""
		};
	}
	function isDefaultNewsView(view) {
		return !view.q && !view.section && !view.part && !view.state && !view.min_penalty && !view.gravity;
	}
	function newsHash(view) {
		const p = new URLSearchParams();
		if (view.cat && view.cat !== "all") p.set("cat", view.cat);
		for (const k of [
			"q",
			"section",
			"part",
			"state",
			"min_penalty",
			"gravity"
		]) if (view[k]) p.set(k, view[k]);
		const qs = p.toString();
		return "#/news" + (qs ? "?" + qs : "");
	}
	function newsApiUrl(view, offset = 0) {
		const p = new URLSearchParams();
		if (view.cat && view.cat !== "all") p.set("category", view.cat);
		for (const k of [
			"q",
			"section",
			"part",
			"state",
			"min_penalty",
			"gravity"
		]) if (view[k]) p.set(k, view[k]);
		if (offset) p.set("offset", String(offset));
		const qs = p.toString();
		return "/api/news" + (qs ? "?" + qs : "");
	}
	function setNewsView(next, { replace = false } = {}) {
		const hash = newsHash(next);
		if (replace) {
			history.replaceState(null, "", hash);
			loadNews(new URLSearchParams(hash.split("?")[1] || ""));
		} else window.location.hash = hash;
	}
	function trimNewsForCache(data) {
		return {
			articles: (data.articles || []).slice(0, 30),
			total: data.total,
			offset: 0
		};
	}
	function newsChanged(oldData, newData, oldStatus, newStatus) {
		const guids = (d) => (d && d.articles || []).map((a) => a.guid).join("|");
		const oks = (s) => s && s.sources ? Object.values(s.sources).map((x) => x.last_ok_at || "").join("|") : "";
		return guids(oldData) !== guids(newData) || oks(oldStatus) !== oks(newStatus);
	}
	function preservingNewsScroll(fn) {
		const mainRect = dom.main.getBoundingClientRect();
		let anchor = null, offset = 0;
		for (const el of dom.view.querySelectorAll("[data-guid]")) {
			const r = el.getBoundingClientRect();
			if (r.bottom > mainRect.top + 8) {
				anchor = el.dataset.guid;
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
				dom.main.scrollTop += r.top - dom.main.getBoundingClientRect().top - offset;
				return;
			}
		}
		dom.main.scrollTop = top;
	}
	async function loadNews(params) {
		const seq = routeSeq;
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		setViewHead("");
		document.title = "News · FRAMEWORK";
		const view = newsViewFromParams(params);
		const firstPaint = !dom.view.querySelector(".news-front");
		const cacheable = isDefaultNewsView(view);
		const cached = cacheable ? lsGetJSON(`newsCache:v1:${view.cat}`) : null;
		const cachedStatus = lsGetJSON("newsCache:v1:status");
		if (cached && cached.data && cachedStatus && cachedStatus.data) renderNews(view, cached.data, cachedStatus.data, {
			enter: firstPaint,
			fromCache: true
		});
		else {
			dom.view.innerHTML = "<div class=\"loading\">Loading news…</div>";
			if (firstPaint) enterView();
		}
		let data, status;
		try {
			const wantFacets = view.cat === "enforcement";
			[data, status] = await Promise.all([getJSON(newsApiUrl(view)), getJSON("/api/news/status")]);
			if (wantFacets && status.dol_configured && !newsState.facets) newsState.facets = await getJSON("/api/news/facets");
		} catch (e) {
			if (seq !== routeSeq) return;
			if (cached && cached.data) markNewsOffline(cached.t);
			else {
				dom.view.innerHTML = `
          <div class="news-front"><div class="news-head"><div>
            <div class="doc-kicker">FRAMEWORK Newsroom</div><h1 class="doc-title">OSHA Regulatory News</h1>
          </div></div>
          <div class="empty-state"><h2>Couldn’t reach the news service</h2>
          <p>${escapeHtml(e.message)}</p>
          <button type="button" class="btn" data-news-act="reload">Try again</button></div></div>`;
				showToast("Could not reach the news service");
			}
			return;
		}
		if (seq !== routeSeq) return;
		if (cacheable) {
			lsSetJSON(`newsCache:v1:${view.cat}`, {
				t: Date.now(),
				data: trimNewsForCache(data)
			});
			lsSetJSON("newsCache:v1:status", {
				t: Date.now(),
				data: status
			});
		}
		if (!cached || !cached.data || !cachedStatus || !cachedStatus.data || newsChanged(cached.data, data, cachedStatus.data, status)) preservingNewsScroll(() => renderNews(view, data, status, { enter: firstPaint && !(cached && cached.data) }));
		else {
			newsState.view = view;
			newsState.data = data;
			newsState.status = status;
		}
		let watch = status.syncing;
		if (status.sync_enabled && status.due && !status.syncing) {
			try {
				watch = ((await getJSON("/api/news/refresh", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ force: false })
				})).queued || []).length > 0;
			} catch (e) {
				try {
					watch = (await getJSON("/api/news/status")).syncing;
				} catch (e2) {
					watch = false;
				}
			}
			if (seq !== routeSeq) return;
		}
		if (watch) watchNewsSync(seq, view);
	}
	function markNewsOffline(cachedAt) {
		const slot = document.getElementById("news-head-status");
		if (slot) slot.innerHTML = statPill("stale", `Offline · showing saved news from ${fmtDate(new Date(cachedAt).toISOString().slice(0, 10))}`);
	}
	function watchNewsSync(seq, view) {
		const token = ++newsState.watchToken;
		const started = Date.now();
		const slot = document.getElementById("news-head-status");
		if (slot) slot.innerHTML = statPill("busy", "Checking for news…");
		const tick = async () => {
			if (seq !== routeSeq || token !== newsState.watchToken || Date.now() - started > 12e4) return;
			let status;
			try {
				status = await getJSON("/api/news/status");
			} catch (e) {
				return;
			}
			if (seq !== routeSeq || token !== newsState.watchToken) return;
			if (status.syncing) {
				setTimeout(tick, 3e3);
				return;
			}
			let data;
			try {
				data = await getJSON(newsApiUrl(view));
			} catch (e) {
				return;
			}
			if (seq !== routeSeq || token !== newsState.watchToken) return;
			if (isDefaultNewsView(view)) {
				lsSetJSON(`newsCache:v1:${view.cat}`, {
					t: Date.now(),
					data: trimNewsForCache(data)
				});
				lsSetJSON("newsCache:v1:status", {
					t: Date.now(),
					data: status
				});
			}
			if (newsChanged(newsState.data, data, newsState.status, status)) preservingNewsScroll(() => renderNews(view, data, status, {}));
			else {
				newsState.status = status;
				const s = document.getElementById("news-head-status");
				if (s) s.innerHTML = newsHeadStatusHtml(status);
			}
		};
		setTimeout(tick, 3e3);
	}
	async function refreshNewsCommand() {
		try {
			await getJSON("/api/news/refresh", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ force: true })
			});
			showToast("Checking for news…");
			if (routeTarget() === "news" && newsState.view) watchNewsSync(routeSeq, newsState.view);
		} catch (err) {
			const m = String(err.message || "");
			showToast(/already running/i.test(m) ? "Already checking for news" : /sync is off/i.test(m) ? "News sync is off" : m);
		}
	}
	function newsHeadStatusHtml(status) {
		if (!status) return "";
		if (!status.sync_enabled) return statPill("stale", "News sync is off");
		if (status.syncing) return statPill("busy", "Checking for news…");
		const enabled = Object.values(status.sources || {}).filter((s) => s.enabled);
		const lastOk = enabled.map((s) => s.last_ok_at).filter(Boolean).sort().pop();
		if (enabled.find((s) => s.last_error) && lastOk) return statPill("stale", `Last update failed · showing data from ${fmtDate(lastOk.slice(0, 10))}`) + ` <button type="button" class="btn btn-sm" data-news-act="refresh">Retry</button>`;
		return `${lastOk ? statPill("synced", `Updated ${timeAgo(Date.parse(lastOk))}`) : ""} <button type="button" class="btn btn-sm" data-news-act="refresh">Refresh</button>`;
	}
	function newsBreakingHtml(articles) {
		const today = Date.now();
		const daysAgo = (iso) => (today - Date.parse(iso + "T00:00:00")) / 864e5;
		const pi = articles.find((a) => a.category === "public_inspection" && daysAgo(a.published_at) <= 3);
		const fine = articles.find((a) => a.category === "enforcement" && (a.penalty_usd || 0) >= 5e4 && daysAgo(a.published_at) <= 14);
		const hit = pi || fine;
		if (!hit) return "";
		const tag = pi ? "Public inspection" : "Enforcement";
		const href = pi ? safeHttpUrl(hit.link) : "#/news?cat=enforcement";
		const ext = pi && href ? " target=\"_blank\" rel=\"noopener\"" : "";
		if (!href) return "";
		return `<a class="news-breaking" href="${escapeHtml(href)}"${ext}>
      <span class="news-breaking-tag">${icon("activity")} ${escapeHtml(tag.toUpperCase())} · ${escapeHtml(fmtDate(hit.published_at))}</span>
      <span class="news-breaking-text">${escapeHtml(hit.title)}</span>${icon("chevronRight")}</a>`;
	}
	function newsKicker(a) {
		if (a.category === "enforcement") return ["ENFORCEMENT", a.state].filter(Boolean).join(" · ");
		if (a.category === "public_inspection") return ["PUBLIC INSPECTION", (a.doc_type || "").toUpperCase()].filter(Boolean).join(" · ");
		return [a.category === "rules" ? "FINAL RULE" : a.category === "rulemaking" ? "PROPOSED RULE" : "NOTICE", a.citation].filter(Boolean).join(" · ");
	}
	function newsBylineHtml(a) {
		return `<div class="news-byline">${escapeHtml(fmtDate(a.published_at))}<span class="sep" aria-hidden="true">·</span>${escapeHtml(NEWS_SOURCE_LABELS[a.source] || a.source)}</div>`;
	}
	function newsChipsHtml(a) {
		const chips = [];
		for (const r of a.cfr_parts || []) {
			const href = newsPartHref(r.title, r.part);
			const dim = !titleInstalled(r.title);
			chips.push(`<a class="citation-chip${dim ? " is-dim" : ""}" href="${href}"${dim ? ` title="Title ${r.title} isn’t installed. Open the library"` : ""}>${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
		}
		for (const s of a.sections || []) {
			const dim = !titleInstalled(29);
			chips.push(`<a class="citation-chip${dim ? " is-dim" : ""}" href="${newsSectionHref(29, s)}"${dim ? " title=\"Title 29 isn’t installed. Open the library\"" : ""}>§ ${escapeHtml(s)}</a>`);
		}
		if (!chips.length) return "";
		const extra = chips.length - 6;
		return `<div class="news-chips">${extra > 0 ? chips.slice(0, 6).join("") + chips.slice(6).map((c) => c.replace("citation-chip", "citation-chip is-extra")).join("") + `<button type="button" class="citation-chip news-chip-more" data-news-act="expand-chips">+${extra}</button>` : chips.join("")}</div>`;
	}
	function newsActionsHtml(a) {
		const out = [];
		const srcLabel = a.source === "dol_osha" ? "OSHA establishment search" : "Federal Register";
		const link = safeHttpUrl(a.link);
		if (link) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(link)}">${icon("external")} ${srcLabel}</a>`);
		const pdf = safeHttpUrl(a.pdf_url || "");
		if (pdf) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(pdf)}">${icon("external")} PDF</a>`);
		const sec = (a.sections || [])[0];
		const partRef = (a.cfr_parts || [])[0];
		if (sec) out.push(`<a class="btn btn-sm btn-accent" href="${newsSectionHref(29, sec)}">${icon("book")} Open § ${escapeHtml(sec)}</a>`);
		else if (partRef) out.push(`<a class="btn btn-sm btn-accent" href="${newsPartHref(partRef.title, partRef.part)}">${icon("book")} Open Part ${escapeHtml(String(partRef.part))}</a>`);
		return out.join("");
	}
	function newsCardHtml(a, { hero = false } = {}) {
		const tag = hero ? "section" : "article";
		const figure = a.penalty_usd ? `<span class="news-figure">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : "";
		const rows = (a.takeaways || []).map((t, i) => {
			const text = i === 0 && a.snippet ? newsSnippetHtml(a.snippet) : linkifyNewsText(t.text);
			return `<dt>${escapeHtml(t.label)}</dt><dd>${text}</dd>`;
		}).join("");
		return `
      <${tag} class="news-card${hero ? " news-hero" : ""}" data-guid="${escapeHtml(a.guid)}" data-cat="${escapeHtml(a.category)}">
        <div class="news-card-top"><span class="news-kicker">${escapeHtml(newsKicker(a))}</span>${figure}</div>
        <h3 class="news-card-title">${extLink(a.link, escapeHtml(a.title))}</h3>
        ${newsBylineHtml(a)}
        ${rows ? `<dl class="news-takeaways">${rows}</dl>` : ""}
        ${newsChipsHtml(a)}
        <div class="news-card-foot">${newsActionsHtml(a)}</div>
      </${tag}>`;
	}
	function newsTabsHtml(view, status) {
		const counts = status && status.counts || {};
		return `<div class="lib-seg news-tabs" role="tablist" aria-label="News categories">${NEWS_CATEGORIES.map((c) => {
			const on = view.cat === c.key;
			const n = counts[c.key];
			return `<button type="button" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-pressed="${on}" data-news-cat="${c.key}">${escapeHtml(c.label)}${n ? ` <span class="news-tab-count">${n}</span>` : ""}</button>`;
		}).join("")}</div>`;
	}
	function newsFilterChipsHtml(view) {
		const chips = [];
		const chip = (key, label) => chips.push(`<button type="button" class="news-filter-chip" data-news-act="clear-filter" data-filter-key="${key}" aria-label="Remove filter: ${escapeHtml(label)}">${escapeHtml(label)}<span aria-hidden="true"> ×</span></button>`);
		if (view.section) chip("section", `Citing § ${view.section}`);
		if (view.part) chip("part", `Citing Part ${view.part}`);
		if (view.state) chip("state", stateName(view.state));
		if (view.min_penalty) chip("min_penalty", `Over ${fmtMoney(Number(view.min_penalty))}`);
		if (view.gravity) chip("gravity", {
			W: "Willful",
			R: "Repeat",
			S: "Serious"
		}[view.gravity]);
		return chips.length ? `<div class="news-filter-chips">${chips.join("")}</div>` : "";
	}
	function newsFacetsHtml(view, status) {
		if (view.cat !== "enforcement" || !status || !status.dol_configured) return "";
		const states = newsState.facets && newsState.facets.states || [];
		const sel = (v, cur) => v === cur ? " selected" : "";
		return `<div class="news-facets">
      <select data-news-facet="state" aria-label="State">
        <option value="">All states</option>
        ${states.map((s) => `<option value="${escapeHtml(s.code)}"${sel(s.code, view.state)}>${escapeHtml(stateName(s.code))} (${s.count})</option>`).join("")}
      </select>
      <select data-news-facet="min_penalty" aria-label="Minimum penalty">
        <option value="">Any penalty</option>
        ${[
			25e3,
			1e5,
			25e4
		].map((v) => `<option value="${v}"${sel(String(v), view.min_penalty)}>Over ${fmtMoney(v)}</option>`).join("")}
      </select>
      <select data-news-facet="gravity" aria-label="Violation gravity">
        <option value="">Any gravity</option>
        ${[
			["W", "Willful"],
			["R", "Repeat"],
			["S", "Serious"]
		].map(([v, l]) => `<option value="${v}"${sel(v, view.gravity)}>${l}</option>`).join("")}
      </select>
    </div>`;
	}
	function newsEmptyHtml(view, status) {
		const s = status || {};
		if (!s.sync_enabled && !(s.counts && s.counts.all)) return `<div class="empty-state"><h2>News sync is off</h2>
        <p>Set <code>NEWS_SYNC=1</code> in <code>reader/.env</code> and restart FRAMEWORK.</p></div>`;
		if (view.cat === "enforcement" && !view.q && s && !s.dol_configured) return `<div class="news-setup">
        <h3>Enforcement data needs a free DOL API key</h3>
        <p>Register at <a href="https://dataportal.dol.gov/registration" target="_blank" rel="noopener">dataportal.dol.gov/registration</a>,
        then save <code>DOL_API_KEY</code> in <code>reader/.env</code> using the setup guide or in-app editor.
        Federal Register news works without it.</p>
        <div class="news-setup-actions">
          <button type="button" class="btn btn-sm btn-accent" data-open-env="dol_api_key">${icon("key")} Add DOL key</button>
          <a class="btn btn-sm" href="#/help">${icon("help")} Connections &amp; API keys</a>
        </div></div>`;
		if (view.q) {
			const tab = NEWS_CATEGORIES.find((c) => c.key === view.cat) || NEWS_CATEGORIES[0];
			const widen = view.cat !== "all" ? `<button type="button" class="btn" data-news-act="search-all">Search all news</button>` : "";
			return `<div class="empty-state"><h2>No news matches “${escapeHtml(view.q)}” in ${escapeHtml(tab.label)}</h2>${widen}</div>`;
		}
		const enabled = Object.values(s.sources || {}).filter((x) => x.enabled);
		const neverSynced = enabled.every((x) => !x.last_ok_at);
		const failed = enabled.find((x) => x.last_error);
		if (neverSynced && failed) {
			const retry = failed.retry_after ? `<p>Retrying ${escapeHtml(timeUntil(failed.retry_after))}.</p>` : "";
			return `<div class="empty-state"><h2>Couldn’t fetch the news</h2>
        <p>${escapeHtml(failed.last_error)}</p>${retry}
        <button type="button" class="btn" data-news-act="refresh">Retry</button></div>`;
		}
		if (neverSynced) return `<div class="empty-state">${statPill("busy", "Fetching from the Federal Register…")}
        <p class="dr-note">The first sync takes a few seconds.</p></div>`;
		return "<div class=\"empty-state\"><h2>Nothing here yet</h2><p>No items in this view.</p></div>";
	}
	function renderNews(view, data, status, opts = {}) {
		newsState.view = view;
		newsState.data = data;
		newsState.status = status;
		const articles = data.articles || [];
		let hero = null;
		if (articles.length) {
			const fresh = (a) => (Date.now() - Date.parse(a.published_at + "T00:00:00")) / 864e5 <= 30;
			hero = (view.cat === "all" ? articles.find((a) => a.category === "rules" && fresh(a)) : null) || articles[0];
		}
		const feed = articles.filter((a) => !hero || a.guid !== hero.guid);
		const more = data.total > articles.length ? `<div class="news-more"><button type="button" class="btn" data-news-act="more">Load more</button></div>` : "";
		const qEl = document.getElementById("news-q");
		const qFocus = qEl && document.activeElement === qEl ? {
			value: qEl.value,
			start: qEl.selectionStart,
			end: qEl.selectionEnd
		} : null;
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
          ${hero ? newsCardHtml(hero, { hero: true }) : ""}
          <div class="news-grid" id="news-grid">${feed.map((a) => newsCardHtml(a)).join("")}</div>
          ${more}` : newsEmptyHtml(view, status)}
      </div>`;
		if (opts.enter) enterView();
		if (qFocus) {
			const q = document.getElementById("news-q");
			if (q) {
				q.value = qFocus.value;
				q.focus();
				try {
					q.setSelectionRange(qFocus.start, qFocus.end);
				} catch (e) {}
			}
		}
	}
	async function loadMoreNews() {
		const seq = routeSeq;
		const { view, data } = newsState;
		if (!view || !data) return;
		let page;
		try {
			page = await getJSON(newsApiUrl(view, data.articles.length));
		} catch (e) {
			return;
		}
		if (seq !== routeSeq || newsState.data !== data) return;
		data.articles = data.articles.concat(page.articles || []);
		data.total = page.total;
		const grid = document.getElementById("news-grid");
		if (grid) {
			const shown = new Set([...dom.view.querySelectorAll("[data-guid]")].map((el) => el.dataset.guid));
			grid.insertAdjacentHTML("beforeend", (page.articles || []).filter((a) => !shown.has(a.guid)).map((a) => newsCardHtml(a)).join(""));
		}
		const moreBtn = dom.view.querySelector("[data-news-act=\"more\"]");
		if (moreBtn && data.articles.length >= data.total) moreBtn.closest(".news-more").remove();
	}
	dom.view.addEventListener("click", (e) => {
		const tab = e.target.closest("[data-news-cat]");
		if (tab && newsState.view) {
			setNewsView({
				...newsState.view,
				cat: tab.dataset.newsCat
			});
			return;
		}
		const act = e.target.closest("[data-news-act]");
		if (!act) return;
		const kind = act.dataset.newsAct;
		if (kind === "refresh") refreshNewsCommand();
		else if (kind === "reload") handleRoute();
		else if (kind === "more") loadMoreNews();
		else if (kind === "search-all") setNewsView({
			...newsState.view,
			cat: "all"
		});
		else if (kind === "clear-filter") setNewsView({
			...newsState.view,
			[act.dataset.filterKey]: ""
		}, { replace: true });
		else if (kind === "expand-chips") {
			const row = act.closest(".news-chips");
			if (row) {
				row.classList.add("is-expanded");
				act.remove();
			}
		}
	});
	let newsQTimer = null;
	dom.view.addEventListener("input", (e) => {
		if (e.target.id !== "news-q" || !newsState.view) return;
		clearTimeout(newsQTimer);
		const q = e.target.value.trim();
		newsQTimer = setTimeout(() => {
			if (newsState.view && q !== newsState.view.q) setNewsView({
				...newsState.view,
				q
			}, { replace: true });
		}, 250);
	});
	dom.view.addEventListener("keydown", (e) => {
		if (e.target.id === "news-q" && e.key === "Escape" && e.target.value) {
			e.target.value = "";
			if (newsState.view && newsState.view.q) setNewsView({
				...newsState.view,
				q: ""
			}, { replace: true });
			return;
		}
		const tab = e.target.closest && e.target.closest(".news-tabs [role=\"tab\"]");
		if (!tab) return;
		if (![
			"ArrowLeft",
			"ArrowRight",
			"Home",
			"End"
		].includes(e.key)) return;
		e.preventDefault();
		const tabs = [...dom.view.querySelectorAll(".news-tabs [role=\"tab\"]")];
		const i = tabs.indexOf(tab);
		tabs[e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length].focus();
	});
	dom.view.addEventListener("change", (e) => {
		const facet = e.target.closest && e.target.closest("[data-news-facet]");
		if (!facet || !newsState.view) return;
		setNewsView({
			...newsState.view,
			[facet.dataset.newsFacet]: facet.value
		}, { replace: true });
	});
	const newsPop = document.getElementById("news-pop");
	const newsActivityCache = /* @__PURE__ */ new Map();
	let newsActivityCtx = null;
	function newsActivityButtonHtml() {
		return `<button type="button" class="btn" id="btn-news-activity" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("news")} <span>Activity</span></button>`;
	}
	async function fillNewsActivity(kind, id, seq) {
		newsActivityCtx = null;
		if (currentTitle !== 29) return;
		const key = `29|${kind === "part" ? "part:" : ""}${id}`;
		let data = newsActivityCache.get(key);
		if (!data) {
			try {
				data = await getJSON(kind === "part" ? `/api/news/part/${encodeURIComponent(id)}?title=29` : `/api/news/section/${encodeURIComponent(id)}?title=29`);
			} catch (e) {
				return;
			}
			newsActivityCache.set(key, data);
		}
		if (seq !== routeSeq) return;
		const btn = document.getElementById("btn-news-activity");
		if (!btn || !data.count) return;
		newsActivityCtx = {
			kind,
			id,
			data
		};
		btn.querySelector("span").textContent = data.count === 1 ? "1 rule or citation" : `${data.count} rules & citations`;
		btn.hidden = false;
	}
	function newsTimelineHtml(ctx) {
		const label = ctx.kind === "part" ? `Part ${ctx.id}` : `§ ${ctx.id}`;
		const nodes = (ctx.data.articles || []).map((a) => {
			let meta = fmtDate(a.published_at), second = "";
			if (a.category === "rules") meta += ` · Final rule${a.citation ? " · " + a.citation : ""}`;
			else if (a.category === "rulemaking") meta += " · Proposed rule" + (a.comments_close_on ? ` · comments close ${fmtDate(a.comments_close_on)}` : "");
			else if (a.category === "public_inspection") meta += " · Public inspection" + (a.scheduled_on ? ` · publishes ${fmtDate(a.scheduled_on)}` : "");
			else if (a.category === "enforcement") {
				meta += " · Citation" + (a.penalty_usd ? ` · ${fmtMoney(a.penalty_usd)}` : "");
				second = [a.company, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
			} else meta += " · Notice";
			const title = a.category === "enforcement" && second ? second : a.title;
			return `<li class="tl-node" data-kind="${escapeHtml(a.category)}">
        <span class="tl-dot" aria-hidden="true"></span>
        <div class="tl-meta">${escapeHtml(meta)}</div>
        ${extLink(a.link, `<span class="tl-title">${escapeHtml(title)}</span>`)}
      </li>`;
		}).join("");
		const allHref = ctx.kind === "part" ? `#/news?part=${encodeURIComponent(ctx.id)}` : `#/news?section=${encodeURIComponent(ctx.id)}`;
		return `<div class="news-pop-head">Federal Register &amp; OSHA activity · ${escapeHtml(label)}</div>
      <ol class="reg-timeline">${nodes}</ol>
      <a class="news-pop-foot" href="${allHref}">${icon("news")} See all in News</a>`;
	}
	function openNewsActivity() {
		const btn = document.getElementById("btn-news-activity");
		if (!btn || !newsActivityCtx) return;
		newsPop.innerHTML = newsTimelineHtml(newsActivityCtx);
		newsPop.setAttribute("aria-label", `Federal Register and OSHA activity for ${newsActivityCtx.kind === "part" ? "Part " : "§ "}${newsActivityCtx.id}`);
		newsPop.hidden = false;
		const r = btn.getBoundingClientRect();
		const w = newsPop.offsetWidth;
		newsPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
		newsPop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - newsPop.offsetHeight - 8)}px`;
		btn.setAttribute("aria-expanded", "true");
		(newsPop.querySelector("a, button") || newsPop).focus?.();
		setTimeout(() => document.addEventListener("pointerdown", onNewsPopOutside), 0);
	}
	function closeNewsActivity(returnFocus = true) {
		if (newsPop.hidden) return;
		newsPop.hidden = true;
		document.removeEventListener("pointerdown", onNewsPopOutside);
		const btn = document.getElementById("btn-news-activity");
		if (btn) {
			btn.setAttribute("aria-expanded", "false");
			if (returnFocus) btn.focus();
		}
	}
	function onNewsPopOutside(e) {
		if (!newsPop.contains(e.target) && !e.target.closest("#btn-news-activity")) closeNewsActivity(false);
	}
	dom.view.addEventListener("click", (e) => {
		if (e.target.closest("#btn-news-activity")) newsPop.hidden ? openNewsActivity() : closeNewsActivity();
	});
	newsPop.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			closeNewsActivity();
		}
	});
	window.addEventListener("hashchange", () => closeNewsActivity(false));
	const pinPop = document.getElementById("pin-pop");
	function pinButtonHtml() {
		const n = currentSection ? projectsWith(currentTitle, currentSection.id).length : 0;
		return `<button type="button" class="btn${n ? " is-pinned" : ""}" id="btn-pin" aria-haspopup="dialog" aria-expanded="false" title="Pin to a project (${isMac ? "⌘" : "Ctrl "}D)">${icon(n ? "bookmarkFilled" : "bookmark")} ${n ? "Pinned" : "Pin"}</button>`;
	}
	function updatePinButton() {
		const b = document.getElementById("btn-pin");
		if (b) b.outerHTML = pinButtonHtml();
	}
	function renderPinMenu() {
		const sec = currentSectionRef();
		if (!sec) return;
		const list = loadProjects();
		pinPop.innerHTML = `<div class="pin-head">Pin <strong>${escapeHtml(sec.label)}</strong> to</div>
      ${list.length ? `<div class="pin-list" role="group" aria-label="Dossiers">${list.map((p) => {
			const on = p.sections.some((s) => s.title === sec.title && s.id === sec.id);
			return `<button type="button" class="pin-opt" role="menuitemcheckbox" aria-checked="${on}" data-proj="${escapeHtml(p.id)}">
          <span class="pin-check">${on ? icon("check") : ""}</span>${projDot(p)}<span class="pin-name">${escapeHtml(p.name)}</span><span class="pin-count">${p.sections.length}</span></button>`;
		}).join("")}</div>` : "<p class=\"pin-none\">No dossiers yet. Name one to start.</p>"}
      <form class="pin-new"><input class="dr-input" name="name" placeholder="New dossier…" maxlength="80" autocomplete="off" aria-label="New dossier name"></form>`;
	}
	function openPinMenu() {
		if (!currentSection) return;
		renderPinMenu();
		pinPop.hidden = false;
		const btn = document.getElementById("btn-pin");
		const r = btn ? btn.getBoundingClientRect() : {
			left: window.innerWidth / 2 - 140,
			bottom: 120
		};
		const w = pinPop.offsetWidth;
		pinPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
		pinPop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pinPop.offsetHeight - 8)}px`;
		if (btn) btn.setAttribute("aria-expanded", "true");
		(pinPop.querySelector(".pin-opt") || pinPop.querySelector("input"))?.focus();
		setTimeout(() => document.addEventListener("pointerdown", onPinOutside), 0);
	}
	function closePinMenu(returnFocus = true) {
		if (pinPop.hidden) return;
		pinPop.hidden = true;
		document.removeEventListener("pointerdown", onPinOutside);
		const btn = document.getElementById("btn-pin");
		if (btn) {
			btn.setAttribute("aria-expanded", "false");
			if (returnFocus) btn.focus();
		}
	}
	function onPinOutside(e) {
		if (!pinPop.contains(e.target) && !e.target.closest("#btn-pin")) closePinMenu(false);
	}
	pinPop.addEventListener("click", (e) => {
		const opt = e.target.closest(".pin-opt");
		if (!opt) return;
		togglePin(opt.dataset.proj, currentSectionRef());
		const focusId = opt.dataset.proj;
		renderPinMenu();
		pinPop.querySelector(`.pin-opt[data-proj="${focusId}"]`)?.focus();
	});
	pinPop.addEventListener("submit", (e) => {
		e.preventDefault();
		const name = e.target.elements.name.value.trim();
		if (!name) return;
		const p = createProject(name);
		togglePin(p.id, currentSectionRef());
		renderPinMenu();
		pinPop.querySelector(`.pin-opt[data-proj="${p.id}"]`)?.focus();
	});
	pinPop.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			closePinMenu();
			return;
		}
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const items = [...pinPop.querySelectorAll(".pin-opt, input")];
		const i = items.indexOf(document.activeElement);
		e.preventDefault();
		items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
	});
	dom.view.addEventListener("click", (e) => {
		if (e.target.closest("#btn-pin")) pinPop.hidden ? openPinMenu() : closePinMenu();
	});
	window.addEventListener("hashchange", () => closePinMenu(false));
	function commandList() {
		const mod = isMac ? "⌘" : "Ctrl ";
		return [
			[
				"Go to Overview",
				"#/",
				"G O"
			],
			[
				`Go to Title ${currentTitle} home`,
				`#/title/${currentTitle}/`,
				"G H"
			],
			[
				"Open contents",
				"cmd:reader",
				"G C"
			],
			[
				"Open projects",
				"cmd:projects",
				"G P"
			],
			[
				"All projects",
				"#/projects",
				""
			],
			[
				"Go to News",
				"#/news",
				"G N"
			],
			[
				"Refresh news",
				"cmd:news-refresh",
				""
			],
			[
				"New dossier",
				"cmd:new-project",
				""
			],
			[
				"Open the library",
				"#/library",
				""
			],
			[
				"Library drawer",
				"cmd:library",
				"G L"
			],
			[
				"Settings",
				"cmd:settings",
				"G S"
			],
			[
				"All settings",
				"#/settings",
				""
			],
			[
				"Connections & API keys",
				"#/help",
				""
			],
			[
				"Edit API keys",
				"cmd:env-modal",
				""
			],
			[
				"Show or hide the drawer",
				"cmd:drawer",
				`${mod}B`
			],
			[
				"Ask Claude",
				"cmd:chat",
				`${mod}J`
			],
			[
				`Switch to ${document.documentElement.dataset.theme === "light" ? "dark" : "light"} theme`,
				"cmd:theme",
				""
			],
			...loadProjects().map((p) => [
				`Project: ${p.name}`,
				`#/projects/${encodeURIComponent(p.id)}`,
				""
			]),
			...installedTitles.filter((t) => t.title !== currentTitle).map((t) => [
				`Switch to Title ${t.title} ${t.name}`,
				`#/title/${t.title}/`,
				""
			])
		];
	}
	function commandItemsHtml(q) {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		const hits = commandList().filter(([label]) => words.every((w) => label.toLowerCase().includes(w))).slice(0, 12);
		if (!hits.length) return "<div class=\"sd-footer\">No command matches.</div>";
		return hits.map(([label, to, keys]) => {
			const cmd = to.startsWith("cmd:") ? to.slice(4) : "";
			return `<a class="sd-item sd-cmd" href="${cmd ? "#" : escapeHtml(to)}"${cmd ? ` data-cmd="${cmd}"` : ""}>
        <span class="sd-cmd-label">${escapeHtml(label)}</span>${keys ? `<span class="sd-cmd-keys">${keys.split(" ").map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join("")}</span>` : ""}</a>`;
		}).join("") + "<div class=\"sd-footer\">Commands · <kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to run</div>";
	}
	function runCommand(cmd) {
		if (cmd === "theme") setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
		else if (cmd === "drawer") toggleDrawer();
		else if (cmd === "chat") toggleChat();
		else if (cmd === "new-project") showNewProjectForm();
		else if (cmd === "news-refresh") refreshNewsCommand();
		else if (cmd === "env-modal") openEnvModal();
		else openPanel(cmd, { focus: true });
	}
	const NAV_PANELS = {
		reader: "Contents",
		projects: "Projects",
		library: "Library",
		settings: "Settings",
		history: "Recent"
	};
	const NAV_TARGETS = [
		"overview",
		"home",
		"reader",
		"projects",
		"news",
		"library",
		"settings"
	];
	const navState = (() => {
		let st = {};
		try {
			st = JSON.parse(lsGet("railState") || "{}") || {};
		} catch (e) {
			st = {};
		}
		const w = st.width || parseInt(lsGet("sidebarW"), 10) || null;
		return {
			panel: NAV_PANELS[st.panel] && st.panel !== "history" ? st.panel : "reader",
			collapsed: st.collapsed != null ? Boolean(st.collapsed) : lsGet("sidebarHidden") === "1",
			mode: st.mode === "flyout" ? "flyout" : "pinned",
			width: w >= 220 && w <= 560 ? w : null
		};
	})();
	let navRetracted = document.documentElement.classList.contains("drawer-retracted");
	let historyFor = "overview";
	const mqMobile = window.matchMedia("(max-width: 900px)");
	const mqNarrow = window.matchMedia("(max-width: 1200px)");
	const railEl = document.getElementById("activity-rail");
	const drawerEl = {
		title: document.getElementById("drawer-title"),
		meta: document.getElementById("drawer-meta"),
		acts: document.getElementById("drawer-acts"),
		mode: document.getElementById("drawer-mode"),
		close: document.getElementById("drawer-close")
	};
	function saveNav() {
		lsSet("railState", JSON.stringify(navState));
	}
	const isFly = () => navState.mode === "flyout" || mqMobile.matches || mqNarrow.matches && dom.layout.classList.contains("chat-open");
	const flyOpen = () => document.body.classList.contains("nav-open");
	const drawerShown = () => isFly() ? flyOpen() : !navState.collapsed && !navRetracted;
	function routeTarget(path = activeRoute) {
		const p = path || "/";
		if (p === "/") return "overview";
		if (/^\/title\/\d+\/?$/.test(p)) return "home";
		const rest = p.replace(/^\/title\/\d+/, "");
		if (rest.startsWith("/library")) return "library";
		if (rest.startsWith("/projects")) return "projects";
		if (rest.startsWith("/news")) return "news";
		if (rest.startsWith("/help") || rest.startsWith("/settings")) return "settings";
		return "reader";
	}
	function announce(text) {
		const live = document.getElementById("nav-live");
		if (live) live.textContent = text;
	}
	function applyNav() {
		const root = document.documentElement;
		const fly = isFly();
		if (!fly && flyOpen()) document.body.classList.remove("nav-open");
		root.classList.toggle("drawer-fly", fly);
		root.classList.toggle("drawer-collapsed", !fly && navState.collapsed);
		root.classList.toggle("drawer-retracted", !fly && !navState.collapsed && navRetracted);
		const shown = drawerShown();
		dom.sidebar.inert = !shown;
		for (const el of dom.sidebar.querySelectorAll(".drawer-panel")) el.hidden = el.dataset.panel !== navState.panel;
		drawerEl.title.textContent = NAV_PANELS[navState.panel];
		drawerEl.meta.textContent = panelMeta(navState.panel);
		drawerEl.acts.innerHTML = panelActions(navState.panel);
		const pinned = navState.mode === "pinned";
		drawerEl.mode.setAttribute("aria-pressed", String(pinned));
		drawerEl.mode.title = pinned ? "Float the drawer over the page" : "Pin the drawer beside the page";
		drawerEl.mode.setAttribute("aria-label", drawerEl.mode.title);
		drawerEl.mode.innerHTML = icon(pinned ? "pin" : "pinOff");
		drawerEl.mode.hidden = mqMobile.matches;
		const route = routeTarget();
		const lit = shown ? navState.panel === "history" ? historyFor : navState.panel : route;
		for (const b of railEl.querySelectorAll(".ar-btn")) {
			const t = b.dataset.target;
			b.classList.toggle("is-active", t === lit);
			if (b.tagName === "A") {
				if (t === route) b.setAttribute("aria-current", "page");
				else b.removeAttribute("aria-current");
			} else b.setAttribute("aria-expanded", String(shown && navState.panel === t));
		}
		document.body.classList.toggle("drawer-library", shown && navState.panel === "library");
	}
	function panelMeta(panel) {
		if (panel === "reader") return `Title ${currentTitle}`;
		if (panel === "projects") {
			const n = loadProjects().length;
			return n ? plural(n, "dossier") : "";
		}
		if (panel === "library") return installedTitles.length ? `${installedTitles.length} installed` : "";
		if (panel === "history") return "Reading history";
		return "";
	}
	function panelActions(panel) {
		if (panel === "projects") return `<button type="button" class="icon-btn drawer-icon" data-nav-act="new-project" title="New dossier" aria-label="New dossier">${icon("plus")}</button>`;
		if (panel === "library") return `<a class="icon-btn drawer-icon" href="#/library" title="Open the library" aria-label="Open the library">${icon("external")}</a>`;
		return "";
	}
	function renderPanel(panel) {
		if (panel === "projects") renderProjectsPanel();
		else if (panel === "library") renderLibraryPanel();
		else if (panel === "settings") renderSettingsPanel();
		else if (panel === "history") renderHistoryPanel();
	}
	function focusPanel(panel) {
		const el = document.getElementById(`panel-${panel}`);
		if (!el) return;
		const first = panel === "reader" ? dom.treeFilter : el.querySelector("input, button, a[href], select, textarea");
		if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
	}
	function openPanel(panel, { focus = false, toggle = false } = {}) {
		if (toggle && drawerShown() && navState.panel === panel) {
			closeDrawer();
			return;
		}
		navState.panel = panel;
		if (isFly()) document.body.classList.add("nav-open");
		else {
			navState.collapsed = false;
			navRetracted = false;
		}
		if (panel !== "history") saveNav();
		renderPanel(panel);
		applyNav();
		if (panel === "reader") requestAnimationFrame(() => revealCurrent(false));
		if (focus) focusPanel(panel);
		announce(`${NAV_PANELS[panel]} drawer open`);
	}
	function closeDrawer() {
		const hadFocus = dom.sidebar.contains(document.activeElement);
		if (isFly()) document.body.classList.remove("nav-open");
		else navState.collapsed = true;
		saveNav();
		applyNav();
		if (hadFocus) railEl.querySelector(".ar-btn.is-active, .ar-btn[aria-current]")?.focus();
		announce("Drawer closed");
	}
	function toggleDrawer(focus = true) {
		if (drawerShown()) closeDrawer();
		else openPanel(navState.panel === "history" ? "reader" : navState.panel, { focus });
	}
	function goTarget(t) {
		if (t === "overview") window.location.hash = "#/";
		else if (t === "home") window.location.hash = `#/title/${currentTitle}/`;
		else if (t === "news") {
			if (routeTarget() === "news") dom.main.scrollTop = 0;
			else window.location.hash = "#/news";
		} else openPanel(t, { focus: true });
	}
	function setNavMode(mode) {
		navState.mode = mode === "flyout" ? "flyout" : "pinned";
		if (navState.mode === "pinned") navState.collapsed = false;
		saveNav();
		applyNav();
		refreshSettingsViews();
	}
	function syncNavToRoute(path) {
		const t = routeTarget(path);
		document.body.classList.remove("nav-open");
		navRetracted = t === "overview" || t === "home" || t === "news" || t === "settings";
		if (t === "library" && navState.panel !== "library") navState.panel = "library";
		else if (t === "projects") navState.panel = "projects";
		else if (t === "reader" && (navState.panel === "history" || navState.panel === "library")) navState.panel = "reader";
		if (navState.panel !== "history") saveNav();
		renderPanel(navState.panel);
		applyNav();
	}
	function updateRailHome() {
		const home = document.getElementById("ar-home");
		if (!home) return;
		home.href = `#/title/${currentTitle}/`;
		const t = installedTitles.find((x) => x.title === currentTitle);
		home.dataset.tip = `Title ${currentTitle} home`;
		home.setAttribute("aria-label", `Title ${currentTitle}${t ? " " + t.name : ""} home`);
	}
	function updateRailBadge() {
		const badge = document.getElementById("ar-library-badge");
		if (!badge) return;
		const busy = Boolean(jobs.current || jobs.queued.length);
		const stale = navLib.data ? navLib.data.titles.filter(isStale).length : 0;
		badge.hidden = !busy && !stale;
		badge.className = `ar-badge${busy ? " is-busy" : stale ? " is-stale" : ""}`;
		const btn = badge.closest(".ar-btn");
		btn.dataset.tip = busy ? "Library · downloading" : stale ? `Library · ${plural(stale, "update")}` : "Library";
	}
	railEl.addEventListener("click", (e) => {
		const btn = e.target.closest(".ar-btn");
		if (!btn) return;
		const t = btn.dataset.target;
		if (btn.tagName === "A") {
			if (routeTarget() === t) {
				e.preventDefault();
				if (t === "news") {
					dom.main.scrollTop = 0;
					return;
				}
				historyFor = t;
				openPanel("history", {
					toggle: true,
					focus: e.detail === 0
				});
			}
			return;
		}
		openPanel(t, {
			toggle: true,
			focus: e.detail === 0
		});
	});
	railEl.addEventListener("keydown", (e) => {
		const i = (mqMobile.matches ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]).indexOf(e.key);
		if (i < 0 && e.key !== "Home" && e.key !== "End") return;
		const items = [...railEl.querySelectorAll(".ar-btn")];
		const at = items.indexOf(document.activeElement);
		if (at < 0) return;
		e.preventDefault();
		items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (i ? 1 : -1) + items.length) % items.length].focus();
	});
	drawerEl.close.addEventListener("click", () => closeDrawer());
	drawerEl.mode.addEventListener("click", () => setNavMode(navState.mode === "pinned" ? "flyout" : "pinned"));
	dom.navBackdrop.addEventListener("click", () => closeDrawer());
	dom.navToggle.addEventListener("click", (e) => toggleDrawer(e.detail === 0));
	for (const mq of [mqMobile, mqNarrow]) mq.addEventListener("change", () => applyNav());
	let goPending = 0;
	const GO_KEYS = {
		o: "overview",
		h: "home",
		c: "reader",
		p: "projects",
		n: "news",
		l: "library",
		s: "settings"
	};
	document.addEventListener("keydown", (e) => {
		const active = document.activeElement;
		const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
		const mod = e.metaKey || e.ctrlKey;
		if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
			e.preventDefault();
			toggleDrawer();
			return;
		}
		if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d" && currentSection && routeTarget() === "reader") {
			e.preventDefault();
			openPinMenu();
			return;
		}
		if (e.altKey && !mod && /^Digit[1-7]$/.test(e.code)) {
			e.preventDefault();
			goTarget(NAV_TARGETS[Number(e.code.slice(5)) - 1]);
			return;
		}
		if (e.key === "Escape" && isFly() && flyOpen() && !e.defaultPrevented) {
			closeDrawer();
			return;
		}
		if (typing || mod || e.altKey) return;
		const k = e.key.toLowerCase();
		if (goPending && Date.now() - goPending < 1200 && GO_KEYS[k]) {
			e.preventDefault();
			goPending = 0;
			goTarget(GO_KEYS[k]);
			return;
		}
		goPending = k === "g" ? Date.now() : 0;
	});
	const drLabel = (text, extra = "") => `<h3 class="dr-label"><span>${text}</span>${extra}</h3>`;
	const drEmpty = (title, body) => `<div class="dr-empty"><div class="dr-empty-title">${title}</div><p>${body}</p></div>`;
	function setPanel(panel, html) {
		const el = document.getElementById(`panel-${panel}`);
		if (!el) return;
		const scroller = el.querySelector(".dr-scroll");
		const top = scroller ? scroller.scrollTop : 0;
		el.innerHTML = `<div class="dr-scroll">${html}</div>`;
		const next = el.querySelector(".dr-scroll");
		if (next) next.scrollTop = top;
		if (navState.panel === panel) drawerEl.meta.textContent = panelMeta(panel);
	}
	const navLib = {
		data: null,
		at: 0,
		loading: null
	};
	async function ensureNavLibrary(force = false) {
		if (!force && navLib.data && Date.now() - navLib.at < 6e4) return navLib.data;
		if (!navLib.loading) navLib.loading = getJSON("/api/library").then((d) => {
			navLib.data = d;
			navLib.at = Date.now();
			return d;
		}).finally(() => {
			navLib.loading = null;
		});
		return navLib.loading;
	}
	function transferHtml() {
		const j = jobs.current;
		if (!j && !jobs.queued.length) return "<p class=\"dr-note\">Nothing downloading.</p>";
		const m = dockModel(j);
		return (!j ? "" : `<div class="dr-job">
        <div class="dr-job-head"><span class="stat-dot is-busy" aria-hidden="true"></span><span class="dr-job-title">${escapeHtml(j.label)}</span><span class="dr-job-pct" data-f="pct">${m.pct == null ? "" : m.pct + "%"}</span></div>
        <div class="dr-job-phase" data-f="phase">${escapeHtml(j.cancelling ? "Cancelling…" : m.label)}</div>
        <div class="dock-track"><span class="dock-fill${m.pct == null ? " is-indeterminate" : ""}" data-f="fill" style="width:${m.pct == null ? 35 : m.pct}%"></span></div>
        <div class="dock-tele"><span data-f="left">${escapeHtml(m.left)}</span><span data-f="right">${escapeHtml(m.right)}</span></div>
        <div class="dr-job-acts"><button type="button" class="lib-act is-danger" data-dock="cancel" data-id="${j.id}"${j.cancelling || j.phase === "Installing" ? " disabled" : ""}>Cancel</button></div>
      </div>`) + jobs.queued.map((q) => `<div class="dr-row is-static"><span class="stat-dot is-busy" aria-hidden="true"></span><span class="dr-name">${escapeHtml(q.label)}</span><span class="dr-time">Queued</span></div>`).join("") + (jobs.queued.length ? "<button type=\"button\" class=\"dr-link\" data-dock=\"clear\">Clear queue</button>" : "");
	}
	let navTransferKey = "";
	function updateNavTransfers() {
		updateRailBadge();
		if (navState.panel !== "library" || !drawerShown()) return;
		const box = document.getElementById("dr-transfers");
		if (!box) return;
		const j = jobs.current;
		const m = dockModel(j);
		const key = [
			j && j.id,
			j && j.cancelling,
			j && j.phase === "Installing",
			m.pct == null,
			jobs.queued.map((q) => q.id).join(".")
		].join("|");
		if (key !== navTransferKey) {
			navTransferKey = key;
			box.innerHTML = transferHtml();
			const count = document.getElementById("dr-transfers-count");
			const n = (j ? 1 : 0) + jobs.queued.length;
			if (count) count.textContent = n ? String(n) : "";
			const sec = document.getElementById("dr-transfers-sec");
			if (sec) sec.hidden = !n;
			return;
		}
		const set = (f, v) => {
			const n = box.querySelector(`[data-f="${f}"]`);
			if (n && n.textContent !== v) n.textContent = v;
		};
		set("pct", m.pct == null ? "" : `${m.pct}%`);
		set("phase", j && j.cancelling ? "Cancelling…" : m.label);
		set("left", m.left);
		set("right", m.right);
		const fill = box.querySelector("[data-f=\"fill\"]");
		if (fill && m.pct != null) fill.style.width = `${m.pct}%`;
	}
	function renderLibraryPanel() {
		const d = navLib.data;
		navTransferKey = "";
		const active = (jobs.current ? 1 : 0) + jobs.queued.length;
		const transfers = `<section class="dr-sec" id="dr-transfers-sec"${active ? "" : " hidden"}>${drLabel("Transfers", `<span class="dr-count" id="dr-transfers-count">${active || ""}</span>`)}<div id="dr-transfers">${transferHtml()}</div></section>`;
		if (!d) {
			setPanel("library", transfers + "<div class=\"loading\">Loading the library…</div>");
			ensureNavLibrary().then(() => {
				if (navState.panel === "library") renderLibraryPanel();
				updateRailBadge();
			}).catch(() => setPanel("library", transfers + drEmpty("Couldn’t reach eCFR", "The installed titles are still in the reader. Try the library again in a moment.")));
			return;
		}
		const live = d.titles.filter((t) => !t.reserved);
		const installed = live.filter((t) => t.installed);
		const stale = installed.filter(isStale);
		const rows = installed.map((t) => {
			const st = titleStatus(t);
			return `<a class="dr-row" href="#/title/${t.title}/">
        <span class="dr-num">${t.title}</span><span class="dr-name">${escapeHtml(t.name)}</span>
        <span class="stat-dot is-${st.state}" title="${escapeHtml(st.text)}" aria-hidden="true"></span><span class="sr-only">${escapeHtml(st.text)}</span></a>`;
		}).join("");
		const suites = Object.values(d.suites || {}).map((s) => {
			const st = suiteState(s, d);
			const have = st.ts.filter((t) => t.installed && t.installed.whole).length;
			return `<div class="dr-suite">
        <div class="dr-suite-text"><span class="dr-suite-name">${escapeHtml(s.name)}</span>
          <span class="dr-suite-meta">${joinSep([`${have} of ${st.ts.length} installed`, fmtMB(s.size_mb)])}</span></div>
        ${st.label ? `<button type="button" class="icon-btn drawer-icon" data-act="download-suite" data-suite="${escapeHtml(s.id)}" title="${escapeHtml(st.label)}" aria-label="${escapeHtml(st.label)}: ${escapeHtml(s.name)}">${icon("download")}</button>` : st.busy.length ? "<span class=\"stat-dot is-busy\" title=\"In progress\" aria-hidden=\"true\"></span>" : "<span class=\"stat-dot is-synced\" title=\"Installed\" aria-hidden=\"true\"></span>"}
      </div>`;
		}).join("");
		setPanel("library", `
      <a class="dr-cta" href="#/library">
        <span class="dr-cta-text"><span class="dr-cta-title">Browse the library</span><span class="dr-cta-meta">${live.length} titles · ${amendedWeek(d).recent} amended this week</span></span>${icon("chevronRight")}
      </a>
      ${transfers}
      <section class="dr-sec">${drLabel("Installed", `<span class="dr-count">${installed.length}</span>${stale.length ? `<button type="button" class="dr-link" data-act="update-all">Update ${stale.length}</button>` : ""}`)}
        ${rows || "<p class=\"dr-note\">No titles installed.</p>"}</section>
      ${suites ? `<section class="dr-sec">${drLabel("Suites")}${suites}</section>` : ""}`);
		updateRailBadge();
	}
	let navStorage = null;
	let navNewsStatus = null;
	let navEnvStatus = null;
	async function loadEnvStatus() {
		try {
			navEnvStatus = await getJSON("/api/settings/env");
		} catch (e) {
			navEnvStatus = null;
		}
		if (navEnvStatus) refreshSettingsViews();
	}
	function timeUntil(iso) {
		const s = (Date.parse(iso) - Date.now()) / 1e3;
		if (isNaN(s)) return "";
		if (s <= 60) return "any moment";
		if (s < 3600) return `in ${Math.round(s / 60)}m`;
		if (s < 86400) return `in ${Math.round(s / 3600)}h`;
		return `in ${Math.round(s / 86400)}d`;
	}
	function newsSettingsHtml() {
		const ns = navNewsStatus;
		if (!ns) return "<div class=\"loading\">Checking…</div>";
		if (!ns.sync_enabled) return "<p class=\"dr-note\">News sync is off (<code>NEWS_SYNC=0</code> in <code>reader/.env</code>).</p>";
		const enabled = Object.entries(ns.sources).filter(([, s]) => s.enabled);
		const lastOk = enabled.map(([, s]) => s.last_ok_at).filter(Boolean).sort().pop();
		const nextDue = enabled.map(([, s]) => s.next_due_at).filter(Boolean).sort()[0];
		const backing = enabled.filter(([, s]) => s.retry_after);
		const when = backing.length ? backing.map(([, s]) => `${escapeHtml(s.last_error || "Update failed")} · retrying ${escapeHtml(timeUntil(s.retry_after))}`).join(" · ") : `Last update ${lastOk ? escapeHtml(timeAgo(Date.parse(lastOk))) : "never"} · next check ${nextDue ? escapeHtml(timeUntil(nextDue)) || "due now" : "—"}`;
		return `
      <div class="dr-row is-static"><span class="dr-name">Federal Register</span><span class="dr-time">on</span></div>
      <div class="dr-row is-static"><span class="dr-name">DOL enforcement</span><span class="dr-time">${ns.dol_configured ? "on" : "off"}</span></div>
      ${ns.dol_configured ? "" : "<p class=\"dr-note\">Enforcement requires a free <code>DOL_API_KEY</code>. <a class=\"dr-inline-link\" href=\"#/help\">Open setup guide</a> or <button type=\"button\" class=\"dr-inline-btn\" data-open-env=\"dol_api_key\">enter key</button>.</p>"}
      <p class="dr-note">${when}</p>`;
	}
	async function loadNewsSettings() {
		try {
			navNewsStatus = await getJSON("/api/news/status");
		} catch (e) {
			navNewsStatus = {
				sync_enabled: false,
				sources: {},
				dol_configured: false
			};
		}
		refreshSettingsViews();
	}
	function setTheme(next) {
		document.documentElement.dataset.theme = next;
		lsSet("theme", next);
		refreshSettingsViews();
	}
	const settingSeg = (name, value, opts) => `<div class="lib-seg" role="group" aria-label="${name}">${opts.map(([v, label]) => `<button type="button" data-set="${name}" data-value="${v}" aria-pressed="${value === v}">${label}</button>`).join("")}</div>`;
	function settingsClaudeHtml() {
		return chatConfig.configured && chatConfig.models.length ? `<select class="set-select" data-set-model aria-label="Claude model">${chatConfig.models.map((m) => `<option value="${escapeHtml(m.id)}"${(dom.modelSelect.value || chatConfig.default) === m.id ? " selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}</select>` : "<p class=\"dr-note\">Claude requires an <code>ANTHROPIC_API_KEY</code>. <a class=\"dr-inline-link\" href=\"#/help\">Open setup guide</a> or <button type=\"button\" class=\"dr-inline-btn\" data-open-env=\"anthropic_api_key\">enter key</button>.</p>";
	}
	function settingsStorageHtml() {
		const st = navStorage;
		if (!st) return "<div class=\"loading\">Measuring…</div>";
		return `
      <div class="set-total"><span class="set-total-val">${fmtBytes(st.total_bytes) || "0 KB"}</span><span class="set-total-sub">on disk in ${plural(st.titles.length, "title")}</span></div>
      ${st.titles.map((t) => {
			const meta = installedTitles.find((x) => x.title === t.title);
			return `<div class="dr-row is-static"><span class="dr-num">${t.title}</span><span class="dr-name">${escapeHtml(meta ? meta.name : `Title ${t.title}`)}</span><span class="dr-time">${fmtBytes(t.bytes)}</span></div>`;
		}).join("")}
      ${st.legacy_bytes ? `<div class="dr-row is-static"><span class="dr-num"></span><span class="dr-name">Title 29 legacy copy</span><span class="dr-time">${fmtBytes(st.legacy_bytes)}</span></div>` : ""}
      <div class="set-row">
        <span class="set-name">Temporary files<span class="set-sub">${st.temp_files ? `${plural(st.temp_files, "file")} from unfinished downloads` : "None left over"}</span></span>
        <button type="button" class="lib-act" data-set-act="prune"${st.temp_files ? "" : " disabled"}>${st.temp_files ? `Clean up ${fmtBytes(st.temp_bytes)}` : "Clean"}</button>
      </div>`;
	}
	function settingsKeysHtml() {
		const mod = isMac ? "⌘" : "Ctrl";
		return `<dl class="set-keys">${[
			[`${mod} K`, "Search or jump to a section"],
			["/", "Search"],
			[">", "Commands, in search"],
			[`${mod} B`, "Show or hide the drawer"],
			[`${mod} J`, "Ask Claude"],
			[`${mod} D`, "Pin the section to a project"],
			["G O", "Overview"],
			["G H", "Title home"],
			["G C", "Contents"],
			["G P", "Projects"],
			["G N", "News"],
			["G L", "Library"],
			["G S", "Settings"],
			[isMac ? "⌥ 1–7" : "Alt 1–7", "Rail items in order"],
			["Esc", "Close the floating drawer"]
		].map(([k, v]) => `<div><dt>${k.split(" ").map((x) => `<kbd>${escapeHtml(x)}</kbd>`).join("")}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>`;
	}
	function renderSettingsPanel() {
		const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
		const size = parseInt(lsGet("fontSize"), 10) || 16;
		const envKeys = navEnvStatus && navEnvStatus.keys;
		const configuredKeysCount = envKeys ? (envKeys.DOL_API_KEY.configured ? 1 : 0) + (envKeys.ANTHROPIC_API_KEY.configured ? 1 : 0) : null;
		const settingsMeta = configuredKeysCount == null ? "Claude · News · Storage · Keyboard" : `${configuredKeysCount} of 2 optional keys set`;
		setPanel("settings", `
      <section class="dr-sec">${drLabel("Quick settings")}
        <div class="set-row"><span class="set-name">Theme</span>${settingSeg("theme", theme, [["dark", "Dark"], ["light", "Light"]])}</div>
        <div class="set-row"><span class="set-name">Reading text</span>
          <span class="set-quick-size" role="group" aria-label="Reading text size">
            <button type="button" data-set-act="font-dec" aria-label="Smaller text">A−</button>
            <span class="set-val" data-size-val>${size} px</span>
            <button type="button" data-set-act="font-inc" aria-label="Larger text">A+</button>
          </span></div>
        <div class="set-row"><span class="set-name">Drawer</span>${settingSeg("mode", navState.mode, [["pinned", "Pinned"], ["flyout", "Overlay"]])}</div>
      </section>
      <section class="dr-sec">${drLabel("Quick actions")}
        <div class="set-quick-acts">
          <button type="button" class="dr-act" data-open-env="">${icon("key")} Edit API keys</button>
          <button type="button" class="dr-act" data-set-act="news-refresh">${icon("news")} Check for news</button>
          <a class="dr-act" href="#/help">${icon("external")} Connections &amp; API keys</a>
        </div>
      </section>
      <a class="dr-cta" href="#/settings">
        <span class="dr-cta-text"><span class="dr-cta-title">Open settings</span><span class="dr-cta-meta">${escapeHtml(settingsMeta)}</span></span>${icon("chevronRight")}
      </a>`);
		if (!navEnvStatus) loadEnvStatus();
	}
	function renderSettingsPage(opts = {}) {
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		setViewHead("");
		document.title = "Settings · FRAMEWORK";
		const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
		const size = parseInt(lsGet("fontSize"), 10) || 16;
		const top = dom.main.scrollTop;
		dom.view.innerHTML = `
      <div class="settings-front">
        <header class="help-head">
          <div>
            <div class="doc-kicker">FRAMEWORK</div>
            <h1 class="doc-title">Settings</h1>
            <p class="help-lead">Appearance, Claude, news sync, storage and keyboard shortcuts. API keys and data sources live in <a href="#/help">Connections &amp; API Keys</a>.</p>
          </div>
          <div class="help-head-actions">
            <button type="button" class="btn" data-open-env="">${icon("key")} Edit API keys</button>
          </div>
        </header>
        <div class="settings-grid">
          <section class="set-card">
            <h2 class="set-card-label">Appearance</h2>
            <div class="set-row"><span class="set-name">Theme</span>${settingSeg("theme", theme, [["dark", "Dark"], ["light", "Light"]])}</div>
            <div class="set-row set-col">
              <div class="set-row-head"><label class="set-name" for="set-size">Reading text</label><span class="set-val" id="set-size-val" data-size-val>${size} px</span></div>
              <input type="range" class="set-range" id="set-size" min="13" max="24" step="1" value="${size}">
            </div>
            <div class="set-row"><span class="set-name">Drawer</span>${settingSeg("mode", navState.mode, [["pinned", "Pinned"], ["flyout", "Overlay"]])}</div>
            <p class="dr-note">Pinned sits beside the page. Overlay slides over it and closes once you pick something.</p>
          </section>
          <section class="set-card">
            <h2 class="set-card-label">Claude</h2>
            ${settingsClaudeHtml()}
          </section>
          <section class="set-card">
            <h2 class="set-card-label">News</h2>
            ${newsSettingsHtml()}
          </section>
          <section class="set-card">
            <h2 class="set-card-label">Storage</h2>
            ${settingsStorageHtml()}
          </section>
          <section class="set-card set-card-wide">
            <h2 class="set-card-label">Keyboard</h2>
            ${settingsKeysHtml()}
          </section>
        </div>
      </div>`;
		if (opts.enter) enterView();
		else dom.main.scrollTop = top;
		if (!navStorage) loadStorage();
		if (!navNewsStatus) loadNewsSettings();
		if (!navEnvStatus) loadEnvStatus();
	}
	const onSettingsPage = () => activeRoute === "/settings" || activeRoute === "/settings/";
	function refreshSettingsViews() {
		if (navState.panel === "settings") renderSettingsPanel();
		if (onSettingsPage()) renderSettingsPage();
	}
	async function runSettingsAction(btn) {
		const act = btn.dataset.setAct;
		if (act === "font-dec") adjustFontSize(-1);
		else if (act === "font-inc") adjustFontSize(1);
		else if (act === "news-refresh") refreshNewsCommand();
		else if (act === "prune") {
			btn.disabled = true;
			try {
				const res = await getJSON("/api/library/storage/prune", { method: "POST" });
				showToast(res.removed ? `Removed ${plural(res.removed, "temporary file")} (${fmtBytes(res.freed_bytes)})` : "Nothing to clean up");
			} catch (err) {
				showToast(err.message, 5e3);
			}
			navStorage = null;
			refreshSettingsViews();
		}
	}
	dom.view.addEventListener("click", (e) => {
		const set = e.target.closest("[data-set]");
		if (set) {
			if (set.dataset.set === "theme") setTheme(set.dataset.value);
			else if (set.dataset.set === "mode") setNavMode(set.dataset.value);
			return;
		}
		const setAct = e.target.closest("[data-set-act]");
		if (setAct) runSettingsAction(setAct);
	});
	dom.view.addEventListener("input", (e) => {
		if (e.target.id === "set-size") applyFontSize(e.target.value);
	});
	dom.view.addEventListener("change", (e) => {
		if (e.target.matches("[data-set-model]")) {
			dom.modelSelect.value = e.target.value;
			dom.modelSelect.dispatchEvent(new Event("change"));
		}
	});
	const HELP_LOGOS = {
		dol: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M32 8 52 16v14c0 13.5-8.6 22.8-20 26-11.4-3.2-20-12.5-20-26V16L32 8Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
      <path d="M32 18v24M21 24h22" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="m21 24-4 9h8l-4-9Zm22 0-4 9h8l-4-9Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M25 44h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`,
		anthropic: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="48" height="48" rx="14" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
      <path d="M25.5 44 33 20l7.5 24M28.2 36.5h9.6" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M18.5 44 26 20h3.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
    </svg>`,
		fr: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="10" y="10" width="44" height="44" rx="10" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
      <circle cx="22" cy="42" r="3.2" fill="var(--accent)"/>
      <path d="M20 31.5a12.5 12.5 0 0 1 12.5 12.5M20 22a22 22 0 0 1 22 22" stroke="var(--accent)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M36 18h10M36 24h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".7"/>
    </svg>`,
		ecfr: `<svg class="help-logo-svg" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M12 18c0-2.2 1.8-4 4-4h13c2.2 0 3 1.2 3 3v31c0-1.5-1.3-2.5-3-2.5H16c-2.2 0-4 1.8-4 4V18Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
      <path d="M52 18c0-2.2-1.8-4-4-4H35c-2.2 0-3 1.2-3 3v31c0-1.5 1.3-2.5 3-2.5h13c2.2 0 4 1.8 4 4V18Z" stroke="currentColor" stroke-width="2.2" fill="currentColor" fill-opacity=".06"/>
      <path d="M18 23h8M18 29h8M38 23h8M38 29h8" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`
	};
	const FR_RSS_FEEDS = [{
		label: "OSHA Published Documents RSS",
		desc: "Final Rules, Proposed Rules, and Notices from the Federal Register.",
		url: "https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration"
	}, {
		label: "OSHA Public Inspection RSS",
		desc: "Pre-publication filings scheduled to appear in tomorrow’s Federal Register.",
		url: "https://www.federalregister.gov/api/v1/public-inspection-documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration"
	}];
	async function loadHelp() {
		const seq = routeSeq;
		currentSection = null;
		clearTreeSelection();
		updateChatContext();
		setViewHead("");
		document.title = "Connections & API Keys · FRAMEWORK";
		if (!navEnvStatus) {
			dom.view.innerHTML = "<div class=\"loading\">Loading setup guide…</div>";
			enterView();
		}
		try {
			const [env, newsSt] = await Promise.all([getJSON("/api/settings/env"), getJSON("/api/news/status").catch(() => null)]);
			if (seq !== routeSeq) return;
			navEnvStatus = env;
			if (newsSt) navNewsStatus = newsSt;
			renderHelp(env, { enter: true });
		} catch (e) {
			if (seq !== routeSeq) return;
			renderHelp(navEnvStatus || {
				env_exists: false,
				env_file: "reader/.env",
				keys: {}
			}, { enter: true });
		}
	}
	function renderHelp(env, opts = {}) {
		const keys = env && env.keys || {};
		const dol = keys.DOL_API_KEY || {};
		const ant = keys.ANTHROPIC_API_KEY || {};
		const syncOn = keys.NEWS_SYNC ? keys.NEWS_SYNC.value : true;
		const retDays = keys.NEWS_RETENTION_DAYS ? keys.NEWS_RETENTION_DAYS.value : 365;
		const titleCount = installedTitles.length;
		const titlesWord = `${titleCount} ${titleCount === 1 ? "title" : "titles"}`;
		const chip = (target, state, label) => `
      <button type="button" class="help-status-chip" data-help-jump="${target}">
        <span class="stat-dot is-${state}" aria-hidden="true"></span>${escapeHtml(label)}</button>`;
		const statusStrip = `
      <nav class="help-status" aria-label="Connection status">
        ${chip("federal-register", syncOn ? "synced" : "stale", syncOn ? "Federal Register · On" : "Federal Register · Sync off")}
        ${chip("ecfr", "synced", `CFR Library · ${titlesWord}`)}
        ${chip("dol", dol.configured ? "synced" : "uninstalled", `DOL enforcement · ${dol.configured ? "On" : "Off"}`)}
        ${chip("anthropic", ant.configured ? "synced" : "uninstalled", `Claude assistant · ${ant.configured ? "On" : "Off"}`)}
      </nav>`;
		const optionalCards = [{
			id: "dol",
			logo: HELP_LOGOS.dol,
			provider: "U.S. Department of Labor · Free key",
			title: "OSHA Enforcement Data",
			pill: dol.configured ? statPill("synced", `On (${dol.masked || "key saved"})`) : statPill("uninstalled", "Off"),
			body: `
          <p><strong>What this key allows:</strong> Unlocks the <em>Enforcement &amp; Penalties</em> tab in <a href="#/news?cat=enforcement">News</a> and adds workplace inspection citations to the regulation timeline inside Title 29 sections.</p>
          <p>You’ll see cited companies, city/state locations, violation severity (Willful, Repeat, Serious), cited 29 CFR standards, and current penalty totals directly from <code>apiprod.dol.gov/v4</code>.</p>`,
			actions: `
          <button type="button" class="btn btn-accent" data-open-env="dol_api_key">${icon("key")} ${dol.configured ? "Update DOL key" : "Add DOL key"}</button>
          <a class="btn" href="https://dataportal.dol.gov/registration" target="_blank" rel="noopener">${icon("external")} Get a free DOL key</a>`
		}, {
			id: "anthropic",
			logo: HELP_LOGOS.anthropic,
			provider: "Anthropic · Paid key",
			title: "Claude Regulatory Assistant",
			pill: ant.configured ? statPill("synced", `On (${ant.masked || "key saved"})`) : statPill("uninstalled", "Off"),
			body: `
          <p><strong>What this key allows:</strong> Turns on the <em>Ask Claude</em> side panel so you can ask plain-English compliance questions, summarize long sections, and trace requirements across your installed CFR titles.</p>
          <p>Reading regulations, full-text search, projects, and Federal Register news all work without it—this key is only for the AI assistant.</p>`,
			actions: `
          <button type="button" class="btn btn-accent" data-open-env="anthropic_api_key">${icon("key")} ${ant.configured ? "Update Anthropic key" : "Add Anthropic key"}</button>
          <a class="btn" href="https://console.anthropic.com" target="_blank" rel="noopener">${icon("external")} Get an Anthropic key</a>`
		}];
		const includedCards = [{
			id: "federal-register",
			logo: HELP_LOGOS.fr,
			provider: "Federal Register · No key needed",
			title: "OSHA Rulemaking & Official RSS Feeds",
			pill: syncOn ? statPill("synced", `On · ${retDays}d history`) : statPill("stale", "Sync off"),
			body: `
          <p><strong>What this source allows:</strong> Keeps the <a href="#/news">Newsroom</a> updated on business days with OSHA Final Rules, Proposed Rules, Notices, and Public Inspection filings—automatically, with no key or setup.</p>
          <div class="help-rss-list">${FR_RSS_FEEDS.map((f) => `
            <div class="help-rss-row">
              <div class="help-rss-text"><strong>${escapeHtml(f.label)}</strong><span>${escapeHtml(f.desc)}</span></div>
              <div class="help-rss-btns">
                <button type="button" class="btn btn-sm" data-copy-url="${escapeHtml(f.url)}">${icon("copy")} Copy RSS URL</button>
                <a class="btn btn-sm" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">${icon("rss")} Open</a>
              </div>
            </div>`).join("")}
          </div>
          <p class="help-fineprint">The same updates, as official Federal Register feeds for any external RSS reader. FRAMEWORK itself reads the richer JSON API and skips <code>osha.gov/rss</code>, which rejects automated readers.</p>`,
			actions: `
          <button type="button" class="btn" data-open-env="news_sync">${icon("key")} Sync settings</button>
          <a class="btn" href="#/news">${icon("news")} Open Newsroom</a>`
		}, {
			id: "ecfr",
			logo: HELP_LOGOS.ecfr,
			provider: "eCFR · No key needed",
			title: "Federal Regulations Library (Titles 1–50)",
			pill: statPill("synced", `On · ${titlesWord} installed`),
			body: `
          <p><strong>What this source allows:</strong> Downloads full Code of Federal Regulations titles, parts, or individual sections directly from <code>ecfr.gov</code> into your local SQLite library for fast offline reading and search.</p>`,
			actions: `
          <a class="btn" href="#/library">${icon("book")} Browse CFR Library</a>`
		}];
		const cardHtml = (c) => `
      <article class="help-card" id="help-${c.id}">
        <div class="help-logo" aria-hidden="true">${c.logo}</div>
        <div class="help-body">
          <div class="help-card-top">
            <span class="help-provider">${escapeHtml(c.provider)}</span>
            ${c.pill}
          </div>
          <h3 class="help-card-title">${escapeHtml(c.title)}</h3>
          <div class="help-card-copy">${c.body}</div>
          <div class="help-actions">${c.actions}</div>
        </div>
      </article>`;
		dom.view.innerHTML = `
      <div class="help-front">
        <header class="help-head">
          <div>
            <div class="doc-kicker">FRAMEWORK Settings · Help</div>
            <h1 class="doc-title">Connections &amp; API Keys</h1>
            <p class="help-lead">Reading and search work offline out of the box. The optional keys below unlock more—each is saved locally and applies instantly, with no restart.</p>
          </div>
          <div class="help-head-actions">
            <button type="button" class="btn" data-open-env="">${icon("key")} Edit API keys</button>
          </div>
        </header>
        ${statusStrip}
        <section class="help-group" aria-labelledby="help-group-optional">
          <h2 class="help-group-label" id="help-group-optional">Optional keys</h2>
          ${optionalCards.map(cardHtml).join("")}
        </section>
        <section class="help-group" aria-labelledby="help-group-included">
          <h2 class="help-group-label" id="help-group-included">Included · already running</h2>
          ${includedCards.map(cardHtml).join("")}
        </section>
        <footer class="help-footnote">
          <p>Keys are stored in <code>reader/.env</code>, a private plain-text file on your computer—never shared or uploaded. ${env && env.env_exists ? "Yours exists and is active." : "It’s created the first time you save a key here."}</p>
          <details class="help-env-details">
            <summary>What is a .env file?</summary>
            <p>A <strong>.env</strong> file holds environment settings—API keys and preferences—as plain <code>KEY=value</code> lines. Normally, setting one up means copying example files in a terminal; here, <em>Edit API keys</em> creates and updates <code>reader/.env</code> for you, and changes take effect right away with no restart.</p>
            <button type="button" class="btn btn-sm" data-open-env="">${icon("key")} Open the editor</button>
          </details>
        </footer>
      </div>`;
		if (opts.enter) enterView();
	}
	const envModalEl = document.getElementById("env-modal");
	const envModalDialog = envModalEl ? envModalEl.querySelector(".modal-dialog") : null;
	let envModalReturnFocus = null;
	let envModalSnapshot = null;
	function envPreviewText(form, snapshot) {
		const keys = snapshot && snapshot.keys || {};
		const dolInput = form.querySelector("#env-dol-key");
		const dolClear = form.querySelector("#env-dol-clear");
		const antInput = form.querySelector("#env-ant-key");
		const antClear = form.querySelector("#env-ant-clear");
		const modelInput = form.querySelector("#env-ant-model");
		const syncInput = form.querySelector("#env-news-sync");
		const retInput = form.querySelector("#env-news-retention");
		const dolVal = dolClear && dolClear.checked ? "" : dolInput && dolInput.value.trim() ? "••••(new key)" : keys.DOL_API_KEY && keys.DOL_API_KEY.masked || "";
		const antVal = antClear && antClear.checked ? "" : antInput && antInput.value.trim() ? "••••(new key)" : keys.ANTHROPIC_API_KEY && keys.ANTHROPIC_API_KEY.masked || "";
		const modelVal = modelInput && modelInput.value.trim() || "";
		const syncVal = syncInput && syncInput.checked ? "1" : "0";
		const retVal = retInput && retInput.value.trim() || "365";
		return [
			`ANTHROPIC_API_KEY=${antVal}`,
			`ANTHROPIC_MODEL=${modelVal}`,
			`DOL_API_KEY=${dolVal}`,
			`NEWS_SYNC=${syncVal}`,
			`NEWS_RETENTION_DAYS=${retVal}`
		].join("\n");
	}
	function renderEnvModal(env, focusKey = "") {
		if (!envModalDialog) return;
		const keys = env && env.keys || {};
		const dol = keys.DOL_API_KEY || {};
		const ant = keys.ANTHROPIC_API_KEY || {};
		const model = keys.ANTHROPIC_MODEL && keys.ANTHROPIC_MODEL.value || "";
		const modelDefault = keys.ANTHROPIC_MODEL && keys.ANTHROPIC_MODEL.default || "claude-sonnet-5-5";
		const newsSync = keys.NEWS_SYNC ? Boolean(keys.NEWS_SYNC.value) : true;
		const retDays = keys.NEWS_RETENTION_DAYS && keys.NEWS_RETENTION_DAYS.value || 365;
		envModalDialog.innerHTML = `
      <div class="modal-head">
        <div>
          <div class="doc-kicker">${env && env.env_exists ? "Update local settings" : "Create reader/.env"}</div>
          <h2 id="env-modal-title" class="modal-title">Configure API Keys &amp; Sync Settings</h2>
        </div>
        <button type="button" class="icon-btn" data-env-close aria-label="Close modal">${icon("close")}</button>
      </div>
      <form id="env-modal-form" class="modal-body" autocomplete="off">
        <p class="modal-intro">Keys are saved privately to <code>reader/.env</code> on your computer and take effect immediately—no restart needed. Leave an existing key blank to keep it unchanged.</p>

        <div class="env-field">
          <div class="env-field-head">
            <label for="env-dol-key">DOL API Key <code>DOL_API_KEY</code></label>
            ${dol.configured ? statPill("synced", `Saved (${dol.masked || "set"})`) : statPill("uninstalled", "Not set")}
          </div>
          <p class="env-field-help">Free key from <a href="https://dataportal.dol.gov/registration" target="_blank" rel="noopener">dataportal.dol.gov/registration</a> for OSHA inspections and penalties.</p>
          <div class="env-secret-row">
            <input id="env-dol-key" name="dol_api_key" type="password" placeholder="${dol.configured ? "Leave blank to keep existing key, or paste new key" : "Paste your DOL X-API-KEY"}" spellcheck="false" autocomplete="off">
            <button type="button" class="btn btn-sm" data-env-reveal="env-dol-key" aria-label="Show or hide DOL key">${icon("eye")}</button>
          </div>
          ${dol.configured ? `<label class="env-clear-check"><input type="checkbox" id="env-dol-clear" name="clear_dol_api_key"> Remove saved DOL key</label>` : ""}
        </div>

        <div class="env-field">
          <div class="env-field-head">
            <label for="env-ant-key">Anthropic API Key <code>ANTHROPIC_API_KEY</code></label>
            ${ant.configured ? statPill("synced", `Saved (${ant.masked || "set"})`) : statPill("uninstalled", "Not set")}
          </div>
          <p class="env-field-help">From <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> to enable the Ask Claude side panel.</p>
          <div class="env-secret-row">
            <input id="env-ant-key" name="anthropic_api_key" type="password" placeholder="${ant.configured ? "Leave blank to keep existing key, or paste new key" : "sk-ant-…"}" spellcheck="false" autocomplete="off">
            <button type="button" class="btn btn-sm" data-env-reveal="env-ant-key" aria-label="Show or hide Anthropic key">${icon("eye")}</button>
          </div>
          ${ant.configured ? `<label class="env-clear-check"><input type="checkbox" id="env-ant-clear" name="clear_anthropic_api_key"> Remove saved Anthropic key</label>` : ""}
        </div>

        <details class="env-advanced"${focusKey === "news_sync" ? " open" : ""}>
          <summary>Advanced options (Claude model &amp; News sync)</summary>
          <div class="env-advanced-body">
            <div class="env-field">
              <label for="env-ant-model">Preferred Claude Model <code>ANTHROPIC_MODEL</code></label>
              <input id="env-ant-model" name="anthropic_model" type="text" value="${escapeHtml(model)}" placeholder="${escapeHtml(modelDefault)}" spellcheck="false">
            </div>
            <div class="env-field-row">
              <label class="env-toggle-row"><input type="checkbox" id="env-news-sync" name="news_sync"${newsSync ? " checked" : ""}> <span>Enable background news sync (<code>NEWS_SYNC</code>)</span></label>
              <div class="env-days-field">
                <label for="env-news-retention">Retention (days)</label>
                <input id="env-news-retention" name="news_retention_days" type="number" min="1" max="3650" value="${Number(retDays)}">
              </div>
            </div>
          </div>
        </details>

        <div class="env-preview-wrap">
          <span class="env-preview-label">Preview of <code>reader/.env</code></span>
          <pre class="env-preview" id="env-preview"></pre>
        </div>

        <p class="modal-error" id="env-modal-error" hidden></p>

        <div class="modal-foot">
          <button type="button" class="btn" data-env-close>Cancel</button>
          <button type="submit" class="btn btn-accent" id="env-modal-save">${icon("check")} Save to reader/.env</button>
        </div>
      </form>`;
		const form = document.getElementById("env-modal-form");
		const preview = document.getElementById("env-preview");
		const syncPreview = () => {
			if (preview) preview.textContent = envPreviewText(form, envModalSnapshot);
		};
		syncPreview();
		form.addEventListener("input", syncPreview);
		form.addEventListener("change", syncPreview);
		form.addEventListener("submit", submitEnvModal);
		requestAnimationFrame(() => {
			const targetId = focusKey === "dol_api_key" ? "env-dol-key" : focusKey === "anthropic_api_key" ? "env-ant-key" : focusKey === "news_sync" ? "env-news-sync" : "env-dol-key";
			(document.getElementById(targetId) || envModalDialog.querySelector("input, button"))?.focus();
		});
	}
	async function openEnvModal(focusKey = "") {
		if (!envModalEl || !envModalDialog) return;
		envModalReturnFocus = document.activeElement;
		envModalDialog.innerHTML = `<div class="modal-head"><h2 id="env-modal-title" class="modal-title">Configure reader/.env</h2>
      <button type="button" class="icon-btn" data-env-close aria-label="Close modal">${icon("close")}</button></div>
      <div class="modal-body"><div class="loading">Loading current configuration…</div></div>`;
		envModalEl.hidden = false;
		try {
			envModalSnapshot = await getJSON("/api/settings/env");
			navEnvStatus = envModalSnapshot;
			renderEnvModal(envModalSnapshot, focusKey);
		} catch (err) {
			envModalSnapshot = {
				env_exists: false,
				env_file: "reader/.env",
				keys: {}
			};
			renderEnvModal(envModalSnapshot, focusKey);
		}
	}
	function closeEnvModal(restoreFocus = true) {
		if (!envModalEl || envModalEl.hidden) return;
		envModalEl.hidden = true;
		if (restoreFocus && envModalReturnFocus && document.contains(envModalReturnFocus)) envModalReturnFocus.focus();
		envModalReturnFocus = null;
	}
	async function refreshModelsConfig() {
		try {
			const modelsRes = await fetch("/api/" + currentTitle + "/models");
			if (!modelsRes.ok) return;
			chatConfig = await modelsRes.json();
			if (chatConfig.configured && chatConfig.models.length > 0) {
				dom.modelSelect.innerHTML = chatConfig.models.map((m) => `
          <option value="${escapeHtml(m.id)}" ${m.id === chatConfig.default ? "selected" : ""}>
            ${escapeHtml(m.name)}
          </option>
        `).join("");
				dom.modelSelect.hidden = false;
			} else {
				dom.modelSelect.innerHTML = "";
				dom.modelSelect.hidden = true;
			}
			if (!dom.chat.hidden && chatHistory.length === 0 && !isGenerating) renderChatWelcome();
		} catch (e) {}
	}
	async function submitEnvModal(e) {
		e.preventDefault();
		const form = e.currentTarget;
		const saveBtn = document.getElementById("env-modal-save");
		const errEl = document.getElementById("env-modal-error");
		if (errEl) {
			errEl.hidden = true;
			errEl.textContent = "";
		}
		if (saveBtn) saveBtn.disabled = true;
		const payload = {
			dol_api_key: form.dol_api_key ? form.dol_api_key.value : null,
			clear_dol_api_key: Boolean(form.clear_dol_api_key && form.clear_dol_api_key.checked),
			anthropic_api_key: form.anthropic_api_key ? form.anthropic_api_key.value : null,
			clear_anthropic_api_key: Boolean(form.clear_anthropic_api_key && form.clear_anthropic_api_key.checked),
			anthropic_model: form.anthropic_model ? form.anthropic_model.value : null,
			news_sync: Boolean(form.news_sync && form.news_sync.checked),
			news_retention_days: form.news_retention_days ? Number(form.news_retention_days.value) || 365 : 365
		};
		try {
			const res = await getJSON("/api/settings/env", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			navEnvStatus = res.status;
			envModalSnapshot = res.status;
			const [newsSt] = await Promise.all([getJSON("/api/news/status").catch(() => null), refreshModelsConfig()]);
			if (newsSt) navNewsStatus = newsSt;
			closeEnvModal(true);
			showToast((res.news_sync_queued || []).length > 0 ? "Saved to reader/.env · Syncing DOL enforcement data…" : "Saved to reader/.env — active immediately");
			refreshSettingsViews();
			if (activeRoute === "/help" || activeRoute === "/help/") renderHelp(navEnvStatus);
			else if (routeTarget() === "news") handleRoute();
		} catch (err) {
			if (errEl) {
				errEl.textContent = err.message || "Could not save reader/.env";
				errEl.hidden = false;
			}
			if (saveBtn) saveBtn.disabled = false;
		}
	}
	if (envModalEl) envModalEl.addEventListener("click", (e) => {
		if (e.target === envModalEl || e.target.closest("[data-env-close]")) {
			closeEnvModal(true);
			return;
		}
		const rev = e.target.closest("[data-env-reveal]");
		if (rev) {
			const inp = document.getElementById(rev.dataset.envReveal);
			if (inp) {
				const show = inp.type === "password";
				inp.type = show ? "text" : "password";
				rev.innerHTML = icon(show ? "eyeOff" : "eye");
			}
		}
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && envModalEl && !envModalEl.hidden) {
			e.preventDefault();
			closeEnvModal(true);
		}
	});
	document.addEventListener("click", (e) => {
		const trigger = e.target.closest("[data-open-env]");
		if (trigger) {
			e.preventDefault();
			openEnvModal(trigger.dataset.openEnv || "");
			return;
		}
		const copyBtn = e.target.closest("[data-copy-url]");
		if (copyBtn) {
			const url = copyBtn.dataset.copyUrl;
			if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => showToast("RSS feed URL copied")).catch(() => showToast(url, 5e3));
			else showToast(url, 5e3);
			return;
		}
		const jump = e.target.closest("[data-help-jump]");
		if (jump) {
			const el = document.getElementById("help-" + jump.dataset.helpJump);
			if (el) el.scrollIntoView({
				behavior: reduceMotion.matches ? "auto" : "smooth",
				block: "start"
			});
		}
	});
	async function loadStorage() {
		try {
			navStorage = await getJSON("/api/library/storage");
		} catch (e) {
			navStorage = {
				titles: [],
				legacy_bytes: 0,
				temp_files: 0,
				temp_bytes: 0,
				total_bytes: 0
			};
		}
		refreshSettingsViews();
	}
	function renderHistoryPanel() {
		const u = loadUsage();
		const rows = Object.entries(u.s).map(([key, e]) => ({
			key,
			title: Number(key.split("|")[0]),
			id: key.slice(key.indexOf("|") + 1),
			...e
		})).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 24);
		const dayOf = (ms) => {
			const d = new Date(ms);
			const days = Math.floor((new Date((/* @__PURE__ */ new Date()).toDateString()) - new Date(d.toDateString())) / 864e5);
			return days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
		};
		let lastDay = "";
		const list = rows.map((r) => {
			const day = dayOf(r.t);
			const label = day !== lastDay ? `<div class="dr-day">${day}</div>` : "";
			lastDay = day;
			return `${label}<a class="dr-item" href="#/title/${r.title}/section/${encodeURIComponent(r.id)}">
        <span class="dr-item-top"><span class="dr-item-kicker">${escapeHtml(r.l || "§ " + r.id)}<span class="sep" aria-hidden="true">·</span>Title ${r.title}</span><span class="dr-time">${escapeHtml(timeAgo(r.t))}</span></span>
        <span class="dr-item-name">${escapeHtml(r.h || "")}</span></a>`;
		}).join("");
		const pins = loadProjects().flatMap((p) => p.sections.map((s) => ({
			...s,
			project: p
		}))).sort((a, b) => (b.pinned_at || "").localeCompare(a.pinned_at || "")).slice(0, 6);
		setPanel("history", `
      <section class="dr-sec">${drLabel("Recently read")}${list || drEmpty("Nothing read yet", "Sections you open appear here, newest first.")}</section>
      ${pins.length ? `<section class="dr-sec">${drLabel("Recent pins")}${pins.map((s) => `<a class="dr-item" href="#/title/${s.title}/section/${encodeURIComponent(s.id)}">
          <span class="dr-item-top"><span class="dr-item-kicker">§ ${escapeHtml(s.id)}<span class="sep" aria-hidden="true">·</span>${escapeHtml(s.project.name)}</span></span>
          <span class="dr-item-name">${escapeHtml(s.heading || "")}</span></a>`).join("")}</section>` : ""}`);
	}
	dom.sidebar.addEventListener("click", async (e) => {
		const set = e.target.closest("[data-set]");
		if (set) {
			if (set.dataset.set === "theme") setTheme(set.dataset.value);
			else if (set.dataset.set === "mode") setNavMode(set.dataset.value);
			return;
		}
		const navAct = e.target.closest("[data-nav-act]");
		if (navAct && navAct.dataset.navAct === "new-project") {
			showNewProjectForm();
			return;
		}
		const setAct = e.target.closest("[data-set-act]");
		if (setAct) {
			runSettingsAction(setAct);
			return;
		}
		const dockBtn = e.target.closest("[data-dock]");
		if (dockBtn) {
			onDockAction(dockBtn);
			return;
		}
		const act = e.target.closest("button[data-act]");
		if (act && (act.dataset.act === "download-suite" || act.dataset.act === "update-all")) {
			act.disabled = true;
			try {
				if (act.dataset.act === "download-suite") await queueBatch("/api/library/batch-download", { suite: act.dataset.suite }, "Every title in this suite is installed and current");
				else await queueBatch("/api/library/update-all", null, "Every installed title is already current");
			} catch (err) {
				showToast(err.message, 5e3);
				act.disabled = false;
			}
		}
	});
	dom.sidebar.addEventListener("input", (e) => {
		if (e.target.id === "set-size") applyFontSize(e.target.value);
	});
	dom.sidebar.addEventListener("change", (e) => {
		if (e.target.matches("[data-set-model]")) {
			dom.modelSelect.value = e.target.value;
			dom.modelSelect.dispatchEvent(new Event("change"));
		}
	});
	function setSidebarWidth(px, save) {
		const w = Math.round(Math.min(560, Math.max(220, px)));
		document.documentElement.style.setProperty("--sidebar-w", w + "px");
		dom.sidebarResizer.setAttribute("aria-valuenow", String(w));
		if (save) {
			navState.width = w;
			saveNav();
		}
	}
	dom.sidebarResizer.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const handle = dom.sidebarResizer;
		const startX = e.clientX;
		const startW = dom.sidebar.getBoundingClientRect().width;
		handle.setPointerCapture(e.pointerId);
		handle.classList.add("dragging");
		document.body.classList.add("resizing");
		const move = (ev) => setSidebarWidth(startW + ev.clientX - startX, false);
		const up = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", up);
			handle.classList.remove("dragging");
			document.body.classList.remove("resizing");
			setSidebarWidth(dom.sidebar.getBoundingClientRect().width, true);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
		handle.addEventListener("pointercancel", up);
	});
	dom.sidebarResizer.addEventListener("keydown", (e) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		const w = dom.sidebar.getBoundingClientRect().width;
		setSidebarWidth(w + (e.key === "ArrowRight" ? 20 : -20), true);
	});
	dom.sidebarResizer.addEventListener("dblclick", () => {
		document.documentElement.style.removeProperty("--sidebar-w");
		dom.sidebarResizer.setAttribute("aria-valuenow", String(Math.round(dom.sidebar.getBoundingClientRect().width)));
		navState.width = null;
		saveNav();
	});
	dom.sidebarResizer.setAttribute("aria-valuenow", String(Math.round(dom.sidebar.getBoundingClientRect().width) || 288));
	function toggleChat() {
		if (dom.chat.hidden) openChat();
		else closeChat();
	}
	function openChat() {
		dom.chat.hidden = false;
		dom.layout.classList.add("chat-open");
		applyNav();
		dom.chatToggle.classList.add("is-active");
		dom.chatToggle.setAttribute("aria-expanded", "true");
		if (chatHistory.length === 0) renderChatWelcome();
		dom.chatText.focus();
	}
	function closeChat() {
		const hadFocus = dom.chat.contains(document.activeElement);
		dom.chat.hidden = true;
		dom.layout.classList.remove("chat-open");
		applyNav();
		dom.chatToggle.classList.remove("is-active");
		dom.chatToggle.setAttribute("aria-expanded", "false");
		if (hadFocus) dom.chatToggle.focus();
	}
	function updateChatContext() {
		if (currentSection) {
			dom.chatContext.hidden = false;
			dom.contextLabel.textContent = `${currentSection.label} (Title ${currentTitle})`;
		} else dom.chatContext.hidden = true;
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
            <li>Save it to <code>reader/.env</code> using the built-in key editor (no restart required).</li>
          </ol>
          <div class="setup-card-actions">
            <button type="button" class="btn btn-sm btn-accent" data-open-env="anthropic_api_key">${icon("key")} Enter Anthropic Key</button>
            <a class="btn btn-sm" href="#/help">${icon("help")} Setup Guide</a>
          </div>
        </div>
      `;
			return;
		}
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
				"How do overtime exemptions work under Part 541?",
				"What are OSHA’s main hazard communication rules?",
				"What are employer responsibilities under FMLA?"
			],
			40: [
				"What makes a waste “hazardous” under RCRA?",
				"When does a facility need a Title V operating permit?",
				"What has to be reported after a chemical spill, and to whom?"
			],
			49: [
				"What are the placarding rules for hazmat shipments?",
				"Who needs a CDL, and what disqualifies a driver?",
				"Which carriers are subject to the FMCSA safety regulations?"
			]
		};
		let prompts = [
			"What are the key requirements in this section?",
			"Who is exempt and who is covered?",
			"Draft an audit and compliance checklist for this rule."
		];
		if (!currentSection) prompts = HOME_PROMPTS[currentTitle] || [
			"What does this title cover, at a high level?",
			"What are the most important definitions in this title?",
			"Find the penalty and enforcement provisions in this title."
		];
		const titleList = installedTitles.map((t) => "Title " + t.title).join(", ") || `Title ${currentTitle}`;
		dom.chatMessages.innerHTML = `
      <div class="chat-empty">
        <h3>Ask Claude about ${currentSection ? escapeHtml(currentSection.label) : "Title " + currentTitle}</h3>
        <p>Claude searches and reads the full regulation text across ${escapeHtml(titleList)}. Select any passage in a section to ask about it.</p>
        <div class="suggestions">
          ${prompts.map((p) => `<button type="button" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}
        </div>
      </div>
    `;
		dom.chatMessages.querySelectorAll(".suggestions button").forEach((b) => {
			b.addEventListener("click", () => {
				dom.chatText.value = b.dataset.prompt;
				submitChat();
			});
		});
	}
	const TOOL_LABELS = {
		search_regulations: "Searching the regulations…",
		read_section: "Reading a section…",
		list_part: "Looking through a part…"
	};
	async function submitChat() {
		const text = dom.chatText.value.trim();
		if (!text || isGenerating) return;
		if (!chatConfig.configured) {
			openChat();
			return;
		}
		if (!(dom.modelSelect.value || chatConfig.default)) {
			showToast(chatConfig.error || "Claude isn’t available right now.", 5e3);
			return;
		}
		dom.chatText.value = "";
		dom.chatText.style.height = "auto";
		chatHistory.push({
			role: "user",
			content: text
		});
		appendChatMessage("user", text);
		const assistantMsgEl = appendChatMessage("assistant", "");
		isGenerating = true;
		dom.chatSend.disabled = true;
		const model = dom.modelSelect.value || chatConfig.default;
		const sectionId = dom.contextToggle.checked && currentSection ? currentSection.id : null;
		let replyText = "";
		try {
			const res = await fetch("/api/" + currentTitle + "/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: chatHistory,
					section_id: sectionId,
					model
				})
			});
			if (!res.ok) {
				assistantMsgEl.innerHTML = `<div class="msg-error">${escapeHtml((await res.json()).detail || "Request failed")}</div>`;
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let toolsEl = null;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n\n");
				buffer = lines.pop();
				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const ev = JSON.parse(line.slice(6));
					if (ev.type === "tool") {
						if (!toolsEl) {
							toolsEl = document.createElement("div");
							toolsEl.className = "tool-activity";
							assistantMsgEl.prepend(toolsEl);
						}
						const chip = document.createElement("span");
						chip.className = "tool-chip running";
						chip.id = `tool-${Date.now()}`;
						chip.textContent = TOOL_LABELS[ev.name] || `Using ${ev.name}…`;
						toolsEl.appendChild(chip);
					} else if (ev.type === "tool_result") {
						if (toolsEl && toolsEl.lastElementChild) {
							toolsEl.lastElementChild.className = "tool-chip";
							toolsEl.lastElementChild.textContent = ev.summary || `Finished ${ev.name}`;
						}
					} else if (ev.type === "text") {
						replyText += ev.text;
						let contentDiv = assistantMsgEl.querySelector(".md");
						if (!contentDiv) {
							contentDiv = document.createElement("div");
							contentDiv.className = "md";
							assistantMsgEl.appendChild(contentDiv);
						}
						contentDiv.innerHTML = renderMarkdown(replyText);
						dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
					} else if (ev.type === "error") {
						const errDiv = document.createElement("div");
						errDiv.className = "msg-error";
						errDiv.textContent = ev.message;
						assistantMsgEl.appendChild(errDiv);
					}
				}
			}
		} catch (err) {
			assistantMsgEl.innerHTML = `<div class="msg-error">Chat error: ${escapeHtml(err.message)}</div>`;
		} finally {
			if (replyText) chatHistory.push({
				role: "assistant",
				content: replyText
			});
			else chatHistory.pop();
			isGenerating = false;
			dom.chatSend.disabled = false;
		}
	}
	function appendChatMessage(role, content) {
		const empty = dom.chatMessages.querySelector(".chat-empty, .setup-card");
		if (empty) empty.remove();
		const msg = document.createElement("div");
		msg.className = `msg msg-${role}`;
		if (role === "user") msg.textContent = content;
		else if (content) msg.innerHTML = `<div class="md">${renderMarkdown(content)}</div>`;
		dom.chatMessages.appendChild(msg);
		dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
		return msg;
	}
	dom.chatText.addEventListener("input", () => {
		dom.chatText.style.height = "auto";
		dom.chatText.style.height = Math.min(dom.chatText.scrollHeight, 180) + "px";
	});
	dom.chatText.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submitChat();
		}
	});
	dom.chatForm.addEventListener("submit", (e) => {
		e.preventDefault();
		submitChat();
	});
	dom.chatNew.addEventListener("click", () => {
		chatHistory = [];
		renderChatWelcome();
	});
	dom.chatToggle.addEventListener("click", toggleChat);
	dom.chatClose.addEventListener("click", closeChat);
	let selectedText = "";
	document.addEventListener("mouseup", () => {
		const sel = window.getSelection();
		const str = sel.toString().trim();
		if (str.length > 10 && dom.view.contains(sel.anchorNode)) {
			selectedText = str;
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			dom.askFloat.hidden = false;
			const w = dom.askFloat.offsetWidth;
			const h = dom.askFloat.offsetHeight;
			const below = rect.bottom + 8;
			const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 8) : below;
			const left = Math.min(Math.max(10, rect.left), window.innerWidth - w - 10);
			dom.askFloat.style.top = `${window.scrollY + top}px`;
			dom.askFloat.style.left = `${window.scrollX + left}px`;
		} else dom.askFloat.hidden = true;
	});
	dom.main.addEventListener("scroll", () => {
		if (!dom.askFloat.hidden) dom.askFloat.hidden = true;
	}, { passive: true });
	dom.askFloat.addEventListener("click", (e) => {
		const action = e.target.dataset.ask;
		if (!action || !selectedText) return;
		openChat();
		if (action === "explain") dom.chatText.value = `Can you explain what this clause means in plain English?\n\n"${selectedText}"`;
		else dom.chatText.value = `Regarding this provision: "${selectedText}"\n\n`;
		dom.askFloat.hidden = true;
		dom.chatText.focus();
	});
	dom.themeToggle.addEventListener("click", () => {
		setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
	});
	const chatKbd = document.getElementById("chat-kbd");
	if (chatKbd) chatKbd.textContent = isMac ? "⌘J" : "Ctrl J";
	async function init() {
		try {
			const titlesRes = await fetch("/api/titles");
			if (titlesRes.ok) {
				installedTitles = await titlesRes.json();
				if (installedTitles.length && !installedTitles.some((t) => t.title === currentTitle)) await switchTitle(installedTitles[0].title);
				fillTitleSelect();
				updateRailHome();
			}
			const [metaRes] = await Promise.all([
				fetch("/api/" + currentTitle + "/meta"),
				refreshModelsConfig(),
				ensureTreeLoaded()
			]);
			if (metaRes.ok) {
				metaInfo = await metaRes.json();
				dom.edition.textContent = `eCFR ${metaInfo.edition || ""}`;
			}
		} catch (e) {
			console.warn("Initialization warnings:", e);
		}
		handleRoute();
		getJSON("/api/library/jobs").then((snap) => {
			setJobs(snap);
			pollJobsIfActive();
		}).catch(() => {});
	}
	init();
})();
