// src/state.ts
var state = {
	currentTitle: 29,
	activeCorpusId: "us:cfr:29",
	activeCorpus: null,
	activeDesk: "all",
	homeTab: "overview",
	homeFrCat: "all",
	homeTierFilter: "all",
	homeHistoryExpanded: false,
	homeSyncToken: 0,
	corpora: [],
	extraCorpora: [],
	installedTitles: [],
	installedUscTitles: [],
	currentUscTitle: null,
	currentUscSection: null,
	currentUscNode: null,
	currentConstUnit: null,
	uscTrees: /* @__PURE__ */ new Map(),
	homeSnapshot: void 0,
	noTitles: false,
	profilesData: void 0,
	treeData: null,
	currentSection: null,
	currentPart: null,
	activeRoute: "",
	metaInfo: {},
	chatConfig: {
		configured: false,
		models: [],
		default: null
	},
	chatHistory: [],
	isGenerating: false,
	routeSeq: 0,
	jobs: {
		current: null,
		queued: [],
		recent: []
	},
	jobsTimer: void 0,
	jobsSeenActive: /* @__PURE__ */ new Set(),
	lastJobsKey: "",
	railObserver: null,
	searchState: null,
	searchTimer: void 0,
	sdActive: void 0,
	visited: /* @__PURE__ */ new Set(),
	treePromise: null,
	currentTreeKey: void 0,
	currentPartKey: void 0,
	currentAgencyKey: void 0,
	rootViewMode: void 0,
	sideView: void 0,
	treeFilterState: void 0,
	foldedGroups: void 0,
	filterTimer: void 0,
	newProjectOpen: void 0,
	projEditT: void 0,
	newsQTimer: void 0,
	newsActivityCtx: null,
	navRetracted: void 0,
	historyFor: void 0,
	goPending: 0,
	navTransferKey: void 0,
	navStorage: void 0,
	navNewsStatus: void 0,
	navEnvStatus: void 0,
	navLibData: null,
	envModalReturnFocus: void 0,
	envModalSnapshot: void 0,
	selectedText: "",
	motionLevel: "full",
	routeAbort: null,
	splitState: null,
	mainTabs: [],
	activeMainTabId: null,
	splitTabs: [],
	activeSplitTabId: null,
	splitWide: false,
	pendingNewMainTab: false,
	swapMotionX: 0,
	pendingDownloads: /* @__PURE__ */ new Map(),
	peekCache: /* @__PURE__ */ new Map(),
	graphCache: /* @__PURE__ */ new Map(),
	refsCache: /* @__PURE__ */ new Map()
};
// src/state_init.ts
state.currentTitle = 29;
state.activeCorpusId = "us:cfr:29";
state.corpora = [];
state.extraCorpora = [];
state.installedTitles = [];
state.noTitles = false;
state.profilesData = void 0;
state.treeData = null;
state.currentSection = null;
state.currentPart = null;
state.activeRoute = "";
state.metaInfo = {};
state.chatConfig = {
	configured: false,
	models: [],
	default: null
};
state.chatHistory = [];
state.isGenerating = false;
state.routeSeq = 0;
state.routeAbort = null;
var docMotion = typeof document !== "undefined" ? document.documentElement.dataset.motion : void 0;
state.motionLevel = docMotion === "none" || docMotion === "less" ? docMotion : "full";
state.splitState = null;
state.mainTabs = [];
state.activeMainTabId = null;
state.splitTabs = [];
state.activeSplitTabId = null;
state.splitWide = false;
state.pendingNewMainTab = false;
state.swapMotionX = 0;
state.pendingDownloads = /* @__PURE__ */ new Map();
state.peekCache = /* @__PURE__ */ new Map();
state.graphCache = /* @__PURE__ */ new Map();
state.refsCache = /* @__PURE__ */ new Map();
function byId(id) {
	return typeof document !== "undefined" ? document.getElementById(id) : null;
}
function queryEl(sel) {
	return typeof document !== "undefined" ? document.querySelector(sel) : null;
}
var dom = {
	topbar: queryEl(".topbar"),
	titleSelect: byId("title-select"),
	titlePop: byId("title-pop"),
	navToggle: byId("nav-toggle"),
	search: byId("search"),
	searchDropdown: byId("search-dropdown"),
	edition: byId("edition"),
	chatToggle: byId("chat-toggle"),
	layout: byId("layout"),
	sidebar: byId("sidebar"),
	sidebarResizer: byId("sidebar-resizer"),
	navBackdrop: byId("nav-backdrop"),
	treeFilter: byId("tree-filter"),
	tree: byId("tree"),
	mainStage: byId("main-stage"),
	main: byId("main"),
	mainTabs: byId("main-tabs"),
	splitPane: byId("split-pane"),
	view: byId("view"),
	viewHead: byId("view-head"),
	citePop: byId("cite-pop"),
	chat: byId("chat"),
	modelSelect: byId("model-select"),
	chatNew: byId("chat-new"),
	chatClose: byId("chat-close"),
	chatContext: byId("chat-context"),
	contextToggle: byId("context-toggle"),
	contextLabel: byId("context-label"),
	chatMessages: byId("chat-messages"),
	chatForm: byId("chat-form"),
	chatText: byId("chat-text"),
	chatSend: byId("chat-send"),
	askFloat: byId("ask-float"),
	toast: byId("toast")
};
// src/core/events.ts
var listeners = /* @__PURE__ */ new Map();
function on(event, handler) {
	let set = listeners.get(event);
	if (!set) {
		set = /* @__PURE__ */ new Set();
		listeners.set(event, set);
	}
	set.add(handler);
	return () => {
		set?.delete(handler);
	};
}
function emit(event, ...args) {
	const set = listeners.get(event);
	if (!set || set.size === 0) return;
	const payload = args[0];
	for (const fn of [...set]) try {
		fn(payload);
	} catch (err) {
		console.error(`[events:${String(event)}]`, err);
	}
}
// src/core/view_dispatch.ts
var handlers = {
	click: [],
	input: [],
	change: [],
	keydown: [],
	submit: []
};
var initialized = false;
function ensureBound() {
	if (initialized || typeof document === "undefined" || !dom.view) return;
	initialized = true;
	Object.keys(handlers).forEach((type) => {
		dom.view.addEventListener(type, (e) => {
			for (const fn of handlers[type]) fn(e);
		});
	});
}
/**
* Register a delegated handler on `#view` backed by one shared root listener per event type.
*/
function onView(type, handler) {
	ensureBound();
	const list = handlers[type];
	list.push(handler);
	return () => {
		const idx = list.indexOf(handler);
		if (idx !== -1) list.splice(idx, 1);
	};
}
// src/data/home_content.ts
var HOME_CONTENT = {
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
// node_modules/marked/lib/marked.esm.js
/**
* marked v18.2.1 - a markdown parser
* Copyright (c) 2018-2026, MarkedJS. (MIT License)
* Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
* https://github.com/markedjs/marked
*/
/**
* DO NOT EDIT THIS FILE
* The code in this file is generated from files in ./src/
*/
function G() {
	return {
		async: !1,
		breaks: !1,
		extensions: null,
		gfm: !0,
		hooks: null,
		pedantic: !1,
		renderer: null,
		silent: !1,
		tokenizer: null,
		walkTokens: null
	};
}
var S = G();
function ue(l) {
	S = l;
}
var q = { exec: () => null };
function D(l) {
	let e = [];
	return (t) => {
		let n = Math.max(0, Math.min(3, t - 1)), r = e[n];
		return r || (r = l(n), e[n] = r), r;
	};
}
function g(l, e = "") {
	let t = typeof l == "string" ? l : l.source, n = {
		replace: (r, s) => {
			let o = typeof s == "string" ? s : s.source;
			return o = o.replace(O.caret, "$1"), t = t.replace(r, o), n;
		},
		getRegex: () => new RegExp(t, e)
	};
	return n;
}
var _e = ((l = "") => {
	try {
		return !!new RegExp("(?<=1)(?<!1)" + l);
	} catch {
		return !1;
	}
})();
var O = {
	codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
	listInterruptsParagraph: /^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/,
	outputLinkReplace: /\\([\[\]])/g,
	indentCodeCompensation: /^(\s+)(?:```)/,
	beginningSpace: /^\s+/,
	endingHash: /#$/,
	startingSpaceChar: /^ /,
	endingSpaceChar: / $/,
	endingSpaceTabChar: /[ \t]$/,
	nonSpaceChar: /[^ ]/,
	newLineCharGlobal: /\n/g,
	tabCharGlobal: /\t/g,
	leadingSpaceTab: /^[ \t]+/,
	multipleSpaceGlobal: /\s+/g,
	blankLine: /^[ \t]*$/,
	doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
	blockquoteStart: /^ {0,3}>/,
	blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
	blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
	blockquoteMarkerWhitespace: /^( {0,3}>)(\t[ \t]*)/gm,
	nestedBlockMarker: /^ {0,3}(?:(?:[*+-]|\d{1,9}[.)])(?: |$)|> ?)/,
	listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
	listIsTask: /^\[[ xX]\][ \t]+\S/,
	listReplaceTask: /^\[[ xX]\][ \t]+/,
	listTaskCheckbox: /\[[ xX]\]/,
	anyLine: /\n.*\n/,
	hrefBrackets: /^<(.*)>$/,
	tableDelimiter: /[:|]/,
	tableAlignChars: /^\||\| *$/g,
	tableRowBlankLine: /\n[ \t]*$/,
	tableAlignRight: /^ *-+: *$/,
	tableAlignCenter: /^ *:-+: *$/,
	tableAlignLeft: /^ *:-+ *$/,
	startATag: /^<a /i,
	endATag: /^<\/a>/i,
	startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
	endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
	startAngleBracket: /^</,
	endAngleBracket: />$/,
	pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
	unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
	numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
	numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	escapeTest: /[&<>"']/,
	escapeReplace: /[&<>"']/g,
	escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
	escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	caret: /(^|[^\[])\^/g,
	percentDecode: /%25/g,
	findPipe: /\|/g,
	splitPipe: / \|/,
	slashPipe: /\\\|/g,
	carriageReturn: /\r\n|\r/g,
	spaceLine: /^ +$/gm,
	notSpaceStart: /^\S*/,
	endingNewline: /\n$/,
	listItemRegex: (l) => new RegExp(`^( {0,3}${l})((?:[	 ][^\\n]*)?(?:\\n|$))`),
	nextBulletRegex: D((l) => new RegExp(`^ {0,${l}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),
	hrRegex: D((l) => new RegExp(`^ {0,${l}}((?:-[ 	]*){3,}|(?:_[ 	]*){3,}|(?:\\*[ 	]*){3,})(?:\\n+|$)`)),
	fencesBeginRegex: D((l) => new RegExp(`^ {0,${l}}(?:\`\`\`|~~~)`)),
	headingBeginRegex: D((l) => new RegExp(`^ {0,${l}}#{1,6}(?:\\s|$)`)),
	pedanticHeadingBeginRegex: D((l) => new RegExp(`^ {0,${l}}#`)),
	htmlBeginRegex: D((l) => new RegExp(`^ {0,${l}}(?:</?(?:${he})(?:[ \\t]+|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, "i")),
	blockquoteBeginRegex: D((l) => new RegExp(`^ {0,${l}}>`)),
	nestedContainerMarkers: /^(?: {0,3}(?:(?:[*+-]|\d{1,9}[.)])[ \t]+|>[ \t]?))+/
};
var Ge = /^(?:[ \t]*(?:\n|$))+/;
var Ne = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var Fe = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
var V = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Qe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var ce = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var he = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var J = g(" {0,3}(?:</?(?:tag)(?:[ \\t]+|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)").replace("tag", he).getRegex();
var $e = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
var Le = g($e).replace(/bull/g, ce).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/\|table/g, "").replace(/html/g, J).getRegex();
var We = g($e).replace(/bull/g, ce).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).replace(/html/g, J).getRegex();
var de = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var Ue = /^[^\n]+/;
var ge = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
var Ke = g(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<(?:\\.|[^\n<>\\])*>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", ge).replace("title", /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/).getRegex();
var Xe = g(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, ce).getRegex();
var ke = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Ve = g("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*?[ \\t]*/?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", ke).replace("tag", he).replace("attribute", /[ \t]+[a-zA-Z:_][\w.:-]*(?:[ \t]*=[ \t]*"[^"\n]*"|[ \t]*=[ \t]*'[^'\n]*'|[ \t]*=[ \t]*[^\s"'=<>`]+)?/).getRegex();
var Ce = (l) => g(de).replace("hr", V).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l).replace("html", J).getRegex();
var Je = Ce(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var Ye = Ce(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var fe = {
	blockquote: g(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace("paragraph", Ye).getRegex(),
	code: Ne,
	def: Ke,
	fences: Fe,
	heading: Qe,
	hr: V,
	html: Ve,
	lheading: Le,
	list: Xe,
	newline: Ge,
	paragraph: Je,
	table: q,
	text: Ue
};
var Pe = g("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", V).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", J).getRegex();
var tt = {
	...fe,
	lheading: We,
	table: Pe,
	paragraph: g(de).replace("hr", V).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", Pe).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", J).getRegex()
};
var nt = {
	...fe,
	html: g(`^ *(?:comment(?: *\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1>(?: *\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?>(?: *\\n{2,}|\\s*$))`).replace("comment", ke).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
	def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
	heading: /^(#{1,6})(.*)(?:\n+|$)/,
	fences: q,
	lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
	paragraph: g(de).replace("hr", V).replace("heading", ` *#{1,6} *[^
]`).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").replace("lheading", Le).getRegex()
};
var rt = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var st = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var Ie = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
var it = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var L = /[\p{P}\p{S}]/u;
var N = /[\s\p{P}\p{S}]/u;
var Y = /[^\s\p{P}\p{S}]/u;
var ot = g(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, N).getRegex();
var at = /[\p{Pi}\p{Ps}"']/u;
var Ae = /(?!~)[\p{P}\p{S}]/u;
var lt = /(?!~)[\s\p{P}\p{S}]/u;
var ut = /(?:[^\s\p{P}\p{S}]|~)/u;
var pt = g(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", _e ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var Ee = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var ct = g(Ee, "u").replace(/punct/g, L).getRegex();
var ht = g(Ee, "u").replace(/punct/g, Ae).getRegex();
var gt = g(/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/, "u").replace(/openQuote/g, at).replace(/punct/g, L).getRegex();
var ze = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var kt = g(ze, "gu").replace(/notPunctSpace/g, Y).replace(/punctSpace/g, N).replace(/punct/g, L).getRegex();
var ft = g(ze, "gu").replace(/notPunctSpace/g, ut).replace(/punctSpace/g, lt).replace(/punct/g, Ae).getRegex();
var xt = g("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, Y).replace(/punctSpace/g, N).replace(/punct/g, L).getRegex();
var bt = g("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, Y).replace(/punctSpace/g, N).replace(/punct/g, L).getRegex();
var Tt = g("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, Y).replace(/punctSpace/g, N).replace(/punct/g, L).getRegex();
var Ot = g(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, L).getRegex();
var Pt = g("^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, Y).replace(/punctSpace/g, N).replace(/punct/g, L).getRegex();
var yt = g(/\\(punct)/, "gu").replace(/punct/g, L).getRegex();
var St = g(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, "gu").replace(/punct/g, L).getRegex();
var _t = g(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var $t = g(ke).replace("(?:-->|$)", "-->").getRegex();
var Lt = g("^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", $t).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var Me = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
var ie = g(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace("brackets", Me).getRegex();
var Ct = g(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/).replace("label", ie).replace("href", /<(?:\\.|[^\n<>\\])*>|(?!<)[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/).getRegex();
var It = g(/^!?\[(label)\]\[(ref)\]/).replace("label", ie).replace("ref", ge).getRegex();
var At = g(/^!?\[(ref)\](?:\[\])?/).replace("ref", ge).getRegex();
var ye = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
var Et = g(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace("brackets", Me).getRegex();
var zt = g("reflink|nolink(?!\\()", "g").replace("reflink", g(/^!?\[(label)\]\[(ref)\]/).replace("label", Et).replace("ref", ye).getRegex()).replace("nolink", g(/^!?\[(ref)\](?:\[\])?/).replace("ref", ye).getRegex()).getRegex();
var Se = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var Bt = g(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex();
var me = {
	_backpedal: q,
	anyPunctuation: yt,
	anyPunctuationOutsideCode: St,
	autolink: _t,
	blockSkip: pt,
	br: Ie,
	code: st,
	del: q,
	delLDelim: q,
	delRDelim: q,
	emStrongLDelim: ct,
	emStrongRDelimAst: kt,
	emStrongRDelimUnd: bt,
	escape: rt,
	link: Ct,
	nolink: At,
	punctuation: ot,
	reflink: It,
	reflinkSearch: zt,
	tag: Lt,
	text: it,
	url: q
};
var Dt = {
	...me,
	emStrongLDelim: gt,
	emStrongRDelimAst: xt,
	emStrongRDelimUnd: Tt,
	link: g(/^!?\[(label)\]\((.*?)\)/).replace("label", ie).getRegex(),
	reflink: g(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", ie).getRegex()
};
var pe = {
	...me,
	emStrongRDelimAst: ft,
	emStrongLDelim: ht,
	delLDelim: Ot,
	delRDelim: Pt,
	url: g(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("emailProtocol", Bt).replace("protocol", Se).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex(),
	_backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
	del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
	text: g(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/).replace("protocol", Se).replace(/emailProtocol/g, /(?:mailto|xmpp):/).replace("wwwStart", _e ? "(?<![^\\s*_~(])www\\." : "www\\.").getRegex()
};
var qt = {
	...pe,
	br: g(Ie).replace("{2,}", "*").getRegex(),
	text: g(pe.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
};
var ee = {
	normal: fe,
	gfm: tt,
	pedantic: nt
};
var F = {
	normal: me,
	gfm: pe,
	breaks: qt,
	pedantic: Dt
};
var vt = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
var Be = (l) => vt[l];
function y(l, e) {
	if (e) {
		if (O.escapeTest.test(l)) return l.replace(O.escapeReplace, Be);
	} else if (O.escapeTestNoEncode.test(l)) return l.replace(O.escapeReplaceNoEncode, Be);
	return l;
}
function De(l) {
	return O.numericCharacterReference.test(l) ? l.replace(O.numericCharacterReferenceOrAmpersand, (e, t, n) => {
		if (t === void 0 && n === void 0) return "&amp;";
		let r = t === void 0 ? Number.parseInt(n, 16) : Number.parseInt(t, 10);
		return r === 0 || r > 1114111 || r >= 55296 && r <= 57343 ? "�" : r === 38 ? "&amp;" : String.fromCodePoint(r);
	}) : l;
}
function xe(l) {
	try {
		l = encodeURI(l).replace(O.percentDecode, "%");
	} catch {
		return null;
	}
	return l;
}
function be(l, e) {
	let n = l.replace(O.findPipe, (s, o, i) => {
		let a = !1, c = o;
		for (; --c >= 0 && i[c] === "\\";) a = !a;
		return a ? "|" : " |";
	}).split(O.splitPipe), r = 0;
	if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
	else for (; n.length < e;) n.push("");
	for (; r < n.length; r++) n[r] = n[r].trim().replace(O.slashPipe, "|");
	return n;
}
function C(l, e, t) {
	let n = l.length;
	if (n === 0) return "";
	let r = 0;
	for (; r < n;) {
		let s = l.charAt(n - r - 1);
		if (s === e && !t) r++;
		else if (s !== e && t) r++;
		else break;
	}
	return l.slice(0, n - r);
}
function Re(l) {
	let e = l.split(`
`), t = e.length - 1;
	for (; t >= 0 && O.blankLine.test(e[t]);) t--;
	return e.length - t <= 2 ? l : e.slice(0, t + 1).join(`
`);
}
function W(l) {
	return l.trim().replace(O.multipleSpaceGlobal, " ").toLowerCase().toUpperCase().toLowerCase();
}
function Te(l, e) {
	if (l.indexOf(e[0]) === -1 && l.indexOf(e[1]) === -1) return -1;
	let t = 0;
	for (let n = 0; n < l.length; n++) if (l[n] === "\\") n++;
	else if (l[n] === e[0]) t++;
	else if (l[n] === e[1] && (t--, t < 0)) return n;
	return t > 0 ? -2 : -1;
}
var Q = /* @__PURE__ */ new WeakMap();
function Oe(l) {
	let e = {
		"*": -1,
		_: -1
	}, t = -1, n = l.length;
	for (let r = 0; r < n; r++) {
		let s = l[r];
		if (s !== "*" && s !== "_" && s !== "~") continue;
		let o = r === 0 ? `
` : l[r - 1], i = r + 1;
		for (; i < n && l[i] === s;) i++;
		o !== " " && o !== "	" && o !== `
` && o !== "\r" && o !== "\f" && (s === "~" ? t = r : e[s] = r), r = i - 1;
	}
	return {
		maskedSrc: l,
		lastPossibleEmStrongCloserIndex: e,
		lastPossibleDelCloserIndex: t
	};
}
function qe(l, e) {
	let t = Oe(e), n = Q.get(l);
	n ? n.push(t) : Q.set(l, [t]);
}
function ve(l) {
	let e = Q.get(l);
	e && (e.pop(), e.length === 0 && Q.delete(l));
}
function oe(l, e, t) {
	let n = Q.get(l)?.at(-1);
	return n && n.maskedSrc === e ? n.lastPossibleEmStrongCloserIndex[t] : Oe(e).lastPossibleEmStrongCloserIndex[t];
}
function ae(l, e) {
	let t = Q.get(l)?.at(-1);
	return t && t.maskedSrc === e ? t.lastPossibleDelCloserIndex : Oe(e).lastPossibleDelCloserIndex;
}
function te(l, e = 0) {
	let t = e, n = "";
	for (let r of l) if (r === "	") {
		let s = 4 - t % 4;
		n += " ".repeat(s), t += s;
	} else n += r, t++;
	return n;
}
function Ht(l, e) {
	let t = "";
	for (let n = 0; n < l.length; n++) {
		if (l[n] === "`") {
			let r = e.inline.code.exec(l.slice(n));
			if (r) {
				t += r[0], n += r[0].length - 1;
				continue;
			}
		}
		if (l[n] === "\\" && (l[n + 1] === "[" || l[n + 1] === "]")) {
			t += l[n + 1], n++;
			continue;
		}
		t += l[n];
	}
	return t;
}
function He(l, e, t, n, r) {
	let s = e.href, o = e.title || null, i = Ht(l[1], r), a = l[0].charAt(0) === "!", c = n.state.inLink, u = n.state.linkEmitted, d = n.state.inRawBlock;
	n.state.inLink = !0, n.state.linkEmitted = !1;
	let h = n.inlineTokens(i), p = n.state.linkEmitted;
	if (n.state.linkEmitted = u, n.state.inLink = c, !a) {
		if (p) {
			n.state.inRawBlock = d;
			return;
		}
		n.state.linkEmitted = !0;
	}
	return {
		type: a ? "image" : "link",
		raw: t,
		href: s,
		title: o,
		text: i,
		tokens: h
	};
}
function Zt(l, e, t) {
	let n = l.match(t.other.indentCodeCompensation);
	if (n === null) return e;
	let r = n[1];
	return e.split(`
`).map((s) => {
		let o = s.match(t.other.beginningSpace);
		if (o === null) return s;
		let [i] = o;
		return s.slice(Math.min(i.length, r.length));
	}).join(`
`);
}
function Ze(l, e, t, n) {
	if (!e.includes("<")) return !1;
	for (let r = 0; r < e.length; r++) {
		if (e[r] === "\\") {
			r++;
			continue;
		}
		if (e[r] === "`") {
			let i = n.inline.code.exec(e.slice(r));
			if (i) {
				r += i[0].length - 1;
				continue;
			}
		}
		if (e[r] !== "<") continue;
		let s = l.slice(t + r), o = n.inline.tag.exec(s) || n.inline.autolink.exec(s);
		if (o) {
			if (o[0].length > e.length - r) return !0;
			r += o[0].length - 1;
		}
	}
	return !1;
}
var _ = class {
	options;
	rules;
	lexer;
	constructor(e) {
		this.options = e || S;
	}
	space(e) {
		let t = this.rules.block.newline.exec(e);
		if (t && t[0].length > 0) return {
			type: "space",
			raw: t[0]
		};
	}
	code(e) {
		let t = this.rules.block.code.exec(e);
		if (t) {
			let n = this.options.pedantic ? t[0] : Re(t[0]);
			return {
				type: "code",
				raw: n,
				codeBlockStyle: "indented",
				text: n.replace(this.rules.other.codeRemoveIndent, "")
			};
		}
	}
	fences(e) {
		let t = this.rules.block.fences.exec(e);
		if (t) {
			let n = t[0], r = Zt(n, t[3] || "", this.rules);
			return t[3] !== void 0 && (r === "" || r.endsWith(`
`)) && (r += `
`), {
				type: "code",
				raw: n,
				lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2],
				text: r
			};
		}
	}
	heading(e) {
		let t = this.rules.block.heading.exec(e);
		if (t) {
			let n = t[2].trim();
			if (this.rules.other.endingHash.test(n)) {
				let r = C(n, "#");
				(this.options.pedantic || !r || this.rules.other.endingSpaceTabChar.test(r)) && (n = r.trim());
			}
			return {
				type: "heading",
				raw: C(t[0], `
`),
				depth: t[1].length,
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	hr(e) {
		let t = this.rules.block.hr.exec(e);
		if (t) return {
			type: "hr",
			raw: C(t[0], `
`)
		};
	}
	blockquote(e) {
		let t = this.rules.block.blockquote.exec(e);
		if (t) {
			let n = C(t[0], `
`).split(`
`), r = "", s = "", o = [];
			for (; n.length > 0;) {
				let i = !1, a = [], c = 0;
				for (; c < n.length; c++) if (this.rules.other.blockquoteStart.test(n[c])) a.push(n[c]), i = !0;
				else if (!i) a.push(n[c]);
				else break;
				n = n.slice(c);
				let u = a.join(`
`), d = u.replace(this.rules.other.blockquoteMarkerWhitespace, (k, m, b) => b.startsWith(" ") ? m + " " + b.slice(1) : m + te(b, m.length)).replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
				r = r ? `${r}
${u}` : u, s = s ? `${s}
${d}` : d;
				let h = this.lexer.state.top;
				if (this.lexer.state.top = !0, this.lexer.blockTokens(d, o, !0), this.lexer.state.top = h, n.length === 0) break;
				let p = o.at(-1);
				if (p?.type === "code" || p?.type === "heading" || p?.type === "hr" || p?.type === "html" || p?.type === "table") break;
				if (p?.type === "blockquote") {
					let k = p, m = n.join(`
`), b = k.raw + `
` + m.replace(this.rules.other.blockquoteSetextReplace2, ""), f = this.blockquote(b);
					o[o.length - 1] = f;
					let R = b.substring(f.raw.length).replace(/^\n/, ""), E = R ? R.split(`
`).length : 0, T = E ? n.slice(0, -E) : n;
					if (T.length > 0 && (r = `${r}
${T.join(`
`)}`), s = s.substring(0, s.length - k.text.length) + f.text, n = n.slice(T.length), n.length > 0 && this.rules.other.blockquoteStart.test(n[0])) continue;
					break;
				} else if (p?.type === "list") {
					let k = p, m = k.raw + `
` + n.join(`
`), b = this.list(m);
					o[o.length - 1] = b;
					let f = b.raw.length > k.raw.length ? m.slice(k.raw.length + 1, b.raw.length).split(`
`).length : 0;
					if (f > 0) {
						let R = n.slice(0, f).join(`
`);
						r = `${r}
${R}`, s = `${s}
${R}`;
					}
					if (n = n.slice(f), n.length > 0 && !this.rules.other.blockquoteStart.test(n[0])) break;
					continue;
				}
			}
			return {
				type: "blockquote",
				raw: r,
				tokens: o,
				text: s
			};
		}
	}
	list(e) {
		let t = this.rules.block.list.exec(e);
		if (t) {
			if (!this.options.pedantic && this.lexer.state.lastToken?.type === "text" && !this.rules.other.listInterruptsParagraph.test(e)) return;
			let n = e, r = () => n.length - e.length, s = t[1].trim(), o = s.length > 1, i = {
				type: "list",
				raw: "",
				ordered: o,
				start: o ? +s.slice(0, -1) : "",
				loose: !1,
				items: []
			};
			s = o ? `\\d{1,9}\\${s.slice(-1)}` : `\\${s}`, this.options.pedantic && (s = o ? s : "[*+-]");
			let a = this.rules.other.listItemRegex(s), c = !1;
			for (; e;) {
				let h = !1, p = "";
				if (!(t = a.exec(e)) || this.rules.block.hr.test(e)) break;
				let k = r();
				e = e.substring(t[0].length);
				let m = t[2].split(`
`, 1)[0], b = t[1].length, f = this.options.pedantic ? te(m, b) : m.replace(this.rules.other.leadingSpaceTab, (H) => te(H, b)), R = e.split(`
`, 1)[0], E = !f.trim(), T = 0;
				if (this.options.pedantic ? (T = 2, p = f.trimStart()) : E ? T = b + 1 : (T = f.search(this.rules.other.nonSpaceChar), T = T > 4 ? 1 : T, p = f.slice(T), T += b), E && this.rules.other.blankLine.test(R) && (e = e.substring(R.length + 1), h = !0), !h) {
					let H = this.rules.other.nextBulletRegex(T), K = this.rules.other.hrRegex(T), re = this.rules.other.fencesBeginRegex(T), B = this.options.pedantic ? this.rules.other.pedanticHeadingBeginRegex(T) : this.rules.other.headingBeginRegex(T), X = this.rules.other.htmlBeginRegex(T), se = this.rules.other.blockquoteBeginRegex(T), le = !1;
					for (; e;) {
						let we = e.split(`
`, 1)[0], Z;
						if (R = we, this.options.pedantic ? (R = R.replace(this.rules.other.listReplaceNesting, "  "), Z = R) : Z = R.replace(this.rules.other.leadingSpaceTab, ($) => te($)), re.test(R) || B.test(R) || X.test(R) || se.test(R) || H.test(R) || K.test(R)) break;
						if (Z.search(this.rules.other.nonSpaceChar) >= T || !R.trim()) p += `
` + Z.slice(T), le = !1;
						else {
							if (E) break;
							let $ = f;
							if (!this.options.pedantic && !p.includes(`
`) && !f.includes("	")) {
								let j;
								for (; !K.test($) && (j = this.rules.other.nestedBlockMarker.exec($));) $ = $.slice(j[0].length);
								if (!$.trim()) break;
							}
							if ($.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || re.test($) || B.test($) || X.test($) || K.test($)) break;
							if (!this.options.pedantic && !le) {
								let j = f.replace(this.rules.other.nestedContainerMarkers, "");
								if (this.rules.block.fences.test(j) || this.rules.block.heading.test(j) || this.rules.block.hr.test(j)) break;
							}
							let je = !this.options.pedantic && /^ {0,3}(?:=+|-+) *$/.test(R) && this.rules.block.lheading.test(`${f}
${R}`) ? `    ${Z.replace(/^ {0,3}/, "")}` : R;
							p += `
` + je, le = !0;
						}
						E = !R.trim(), e = e.substring(we.length + 1), f = Z.slice(T);
					}
				}
				let U = n.slice(k, r());
				i.loose || (c ? i.loose = !0 : this.rules.other.doubleBlankLine.test(U) && (c = !0)), i.items.push({
					type: "list_item",
					raw: U,
					task: !!this.options.gfm && this.rules.other.listIsTask.test(p),
					loose: !1,
					text: p,
					tokens: []
				});
			}
			let u = i.items.at(-1);
			if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
			else return;
			i.raw = n.slice(0, r()).trimEnd();
			let d = [];
			for (let h of i.items) if (this.lexer.state.top = !1, d.push(this.lexer.inlineQueue.length), h.tokens = this.lexer.blockTokens(h.text, []), !i.loose) {
				let p = h.tokens.filter((m) => m.type === "space");
				i.loose = p.length > 0 && p.some((m) => this.rules.other.anyLine.test(m.raw));
			}
			for (let h = 0; h < i.items.length; h++) {
				let p = i.items[h], k = p.tokens[0];
				if (p.task && (k?.type === "text" || k?.type === "paragraph")) {
					p.text = p.text.replace(this.rules.other.listReplaceTask, ""), k.raw = k.raw.replace(this.rules.other.listReplaceTask, ""), k.text = k.text.replace(this.rules.other.listReplaceTask, "");
					let m = this.lexer.inlineQueue;
					for (let f = d[h]; f < m.length; f++) if (m[f].tokens === k.tokens) {
						m[f].src = m[f].src.replace(this.rules.other.listReplaceTask, "");
						break;
					}
					let b = this.rules.other.listTaskCheckbox.exec(p.raw);
					if (b) {
						let f = {
							type: "checkbox",
							raw: b[0] + " ",
							checked: b[0] !== "[ ]"
						};
						p.checked = f.checked, i.loose ? p.tokens[0] && ["paragraph", "text"].includes(p.tokens[0].type) && "tokens" in p.tokens[0] && p.tokens[0].tokens ? (p.tokens[0].raw = f.raw + p.tokens[0].raw, p.tokens[0].text = f.raw + p.tokens[0].text, p.tokens[0].tokens.unshift(f)) : p.tokens.unshift({
							type: "paragraph",
							raw: f.raw,
							text: f.raw,
							tokens: [f]
						}) : p.tokens.unshift(f);
					}
				} else p.task && (p.task = !1);
			}
			if (i.loose) for (let h of i.items) {
				h.loose = !0;
				for (let p of h.tokens) p.type === "text" && (p.type = "paragraph");
			}
			return i;
		}
	}
	html(e) {
		let t = this.rules.block.html.exec(e);
		if (t) {
			if (this.lexer.state.lastToken?.type === "paragraph" && !this.rules.other.htmlBeginRegex(4).test(e)) return;
			let n = Re(t[0]);
			return {
				type: "html",
				block: !0,
				raw: n,
				pre: t[1] === "pre" || t[1] === "script" || t[1] === "style",
				text: n
			};
		}
	}
	def(e) {
		let t = this.rules.block.def.exec(e);
		if (t) {
			if (!this.rules.other.startAngleBracket.test(t[2]) && Te(t[2], "()") !== -1) return;
			let n = W(t[1]), r = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", s = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
			return {
				type: "def",
				tag: n,
				raw: C(t[0], `
`),
				href: r,
				title: s
			};
		}
	}
	table(e) {
		let t = this.rules.block.table.exec(e);
		if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
		let n = be(t[1]), r = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), s = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], o = {
			type: "table",
			raw: C(t[0], `
`),
			header: [],
			align: [],
			rows: []
		};
		if (n.length === r.length) {
			for (let i of r) this.rules.other.tableAlignRight.test(i) ? o.align.push("right") : this.rules.other.tableAlignCenter.test(i) ? o.align.push("center") : this.rules.other.tableAlignLeft.test(i) ? o.align.push("left") : o.align.push(null);
			for (let i = 0; i < n.length; i++) o.header.push({
				text: n[i],
				tokens: this.lexer.inline(n[i]),
				header: !0,
				align: o.align[i]
			});
			for (let i of s) o.rows.push(be(i, o.header.length).map((a, c) => ({
				text: a,
				tokens: this.lexer.inline(a),
				header: !1,
				align: o.align[c]
			})));
			return o;
		}
	}
	lheading(e) {
		let t = this.rules.block.lheading.exec(e);
		if (t) {
			let n = t[1].trim();
			return {
				type: "heading",
				raw: C(t[0], `
`),
				depth: t[2].charAt(0) === "=" ? 1 : 2,
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	paragraph(e) {
		let t = this.rules.block.paragraph.exec(e);
		if (t) {
			let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
			return {
				type: "paragraph",
				raw: t[0],
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	text(e) {
		let t = this.rules.block.text.exec(e);
		if (t) return {
			type: "text",
			raw: t[0],
			text: t[0],
			tokens: this.lexer.inline(t[0])
		};
	}
	escape(e) {
		if (e.charCodeAt(0) !== 92) return;
		let t = this.rules.inline.escape.exec(e);
		if (t) return {
			type: "escape",
			raw: t[0],
			text: t[1]
		};
	}
	tag(e) {
		if (e.charCodeAt(0) !== 60) return;
		let t = this.rules.inline.tag.exec(e);
		if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = !1), {
			type: "html",
			raw: t[0],
			inLink: this.lexer.state.inLink,
			inRawBlock: this.lexer.state.inRawBlock,
			block: !1,
			text: t[0]
		};
	}
	link(e) {
		if (this.lexer.state.linkParenPossible === !1) return;
		let t = e.charCodeAt(0);
		if (t !== 91 && t !== 33) return;
		let n = this.rules.inline.link.exec(e);
		if (n) {
			let r = n[0].charAt(0) === "!" ? 2 : 1;
			if (!this.options.pedantic && Ze(e, n[1], r, this.rules)) return;
			let s = n[2].trim();
			if (!this.options.pedantic && this.rules.other.startAngleBracket.test(s)) {
				if (!this.rules.other.endAngleBracket.test(s)) return;
				let c = C(s.slice(0, -1), "\\");
				if ((s.length - c.length) % 2 === 0) return;
			} else {
				let c = Te(n[2], "()");
				if (c === -2) return;
				if (c > -1) {
					let d = (n[0].indexOf("!") === 0 ? 5 : 4) + n[1].length + c;
					n[2] = n[2].substring(0, c), n[0] = n[0].substring(0, d).trim(), n[3] = "";
				}
			}
			let o = C(n[0].slice(0, -1), "\\");
			if ((n[0].length - o.length) % 2 === 0) return;
			let i = n[2], a = "";
			if (this.options.pedantic) {
				let c = this.rules.other.pedanticHrefTitle.exec(i);
				c && (i = c[1], a = c[3]);
			} else a = n[3] ? n[3].slice(1, -1) : "";
			return i = i.trim(), this.rules.other.startAngleBracket.test(i) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(s) ? i = i.slice(1) : i = i.slice(1, -1)), He(n, {
				href: i && i.replace(this.rules.inline.anyPunctuation, "$1"),
				title: a && a.replace(this.rules.inline.anyPunctuation, "$1")
			}, n[0], this.lexer, this.rules);
		}
	}
	reflink(e, t) {
		let n = e.charCodeAt(0);
		if (n !== 91 && n !== 33) return;
		let r;
		if ((r = this.rules.inline.reflink.exec(e)) || (r = this.rules.inline.nolink.exec(e))) {
			let s = r[0].charAt(0) === "!" ? 2 : 1;
			if (!this.options.pedantic && Ze(e, r[1], s, this.rules)) return;
			let o = t[W(r[2] || r[1])];
			if (!o) {
				let i = r[0].charAt(0);
				return {
					type: "text",
					raw: i,
					text: i
				};
			}
			return He(r, o, r[0], this.lexer, this.rules);
		}
	}
	emStrong(e, t, n = "") {
		let r = this.rules.inline.emStrongLDelim.exec(e);
		if (!r || !r[1] && !r[2] && !r[3] && !r[4]) return;
		let s = r[0][0], o = n === s, i = t.length - e.length, a = i;
		for (; !this.options.pedantic && a > 0 && t[a - 1] === s;) a--;
		let c = [...t.slice(Math.max(0, a - 2), a)].at(-1) ?? "", u = c === "*" || c === "_" || !!this.rules.inline.punctuation.exec(c);
		a < i && (n = c);
		let d = a < i ? u : n === "*" || n === "_" || !!this.rules.inline.punctuation.exec(n);
		if (r[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
		let h = r[1] || r[3] || "";
		if (!h || !n || d) {
			let p = [...r[0]].length - 1, k, m, b = p, f = 0, R = i - a + p, E = !this.options.pedantic && !!c.trim() && (!!h || s === "*" && !u);
			if (s !== "*" && s !== "_") return;
			let T = s === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd, U = oe(this, t, s), H = t.length - e.length + p;
			if (U < H) return;
			t = t.slice(-1 * e.length + p);
			let K = U - H;
			for (T.lastIndex = 0; (r = T.exec(t)) !== null && !(r.index > K);) {
				if (k = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !k) continue;
				if (m = [...k].length, r[3] || r[4]) {
					b += m;
					continue;
				} else if ((r[5] || r[6] || E) && R % 3 && !((R + m) % 3)) {
					if (o && (r[5] || r[6])) break;
					f += m;
					continue;
				}
				if (b -= m, b > 0) continue;
				m = Math.min(m, m + b + f);
				let re = [...r[0]][0].length, B = e.slice(0, p + r.index + re + m);
				if (Math.min(p, m) % 2) {
					let se = B.slice(1, -1);
					return {
						type: "em",
						raw: B,
						text: se,
						tokens: this.lexer.inlineTokens(se)
					};
				}
				let X = B.slice(2, -2);
				return {
					type: "strong",
					raw: B,
					text: X,
					tokens: this.lexer.inlineTokens(X)
				};
			}
		}
	}
	codespan(e) {
		if (e.charCodeAt(0) !== 96) return;
		let t = this.rules.inline.code.exec(e);
		if (t) {
			let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), r = this.rules.other.nonSpaceChar.test(n), s = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
			return r && s && (n = n.substring(1, n.length - 1)), {
				type: "codespan",
				raw: t[0],
				text: n
			};
		}
	}
	br(e) {
		let t = e.charCodeAt(0);
		if (t !== 32 && t !== 92 && t !== 10) return;
		let n = this.rules.inline.br.exec(e);
		if (n) return {
			type: "br",
			raw: n[0]
		};
	}
	del(e, t, n = "") {
		if (e.charCodeAt(0) !== 126) return;
		let r = this.rules.inline.delLDelim.exec(e);
		if (!r) return;
		if (!(r[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
			let o = [...r[0]].length - 1, i, a, c = o, u = this.rules.inline.delRDelim, d = ae(this, t), h = t.length - e.length + o;
			if (d < h) return;
			t = t.slice(-1 * e.length + o);
			let p = d - h;
			for (u.lastIndex = 0; (r = u.exec(t)) !== null && !(r.index > p);) {
				if (i = r[1] || r[2] || r[3] || r[4] || r[5] || r[6], !i || (a = [...i].length, a !== o)) continue;
				if (r[3] || r[4]) {
					c += a;
					continue;
				}
				if (c -= a, c > 0) continue;
				a = Math.min(a, a + c);
				let k = [...r[0]][0].length, m = e.slice(0, o + r.index + k + a), b = m.slice(o, -o);
				return {
					type: "del",
					raw: m,
					text: b,
					tokens: this.lexer.inlineTokens(b)
				};
			}
		}
	}
	autolink(e) {
		if (e.charCodeAt(0) !== 60) return;
		let t = this.rules.inline.autolink.exec(e);
		if (t) {
			let n, r;
			return t[2] === "@" ? (n = t[1], r = "mailto:" + n) : (n = t[1], r = n), {
				type: "link",
				raw: t[0],
				text: n,
				href: r,
				autolink: !0,
				tokens: [{
					type: "text",
					raw: n,
					text: n
				}]
			};
		}
	}
	url(e) {
		let t;
		if (t = this.rules.inline.url.exec(e)) {
			let n, r;
			if (t[2] === "@") n = t[0], r = "mailto:" + n;
			else {
				let s;
				do
					s = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
				while (s !== t[0]);
				n = t[0], t[1] === "www." ? r = "http://" + t[0] : r = t[0];
			}
			return {
				type: "link",
				raw: t[0],
				text: n,
				href: r,
				autolink: !0,
				tokens: [{
					type: "text",
					raw: n,
					text: n
				}]
			};
		}
	}
	inlineText(e) {
		let t = this.rules.inline.text.exec(e);
		if (t) {
			let n = this.lexer.state.inRawBlock;
			return {
				type: "text",
				raw: t[0],
				text: n ? t[0] : De(t[0]),
				escaped: n
			};
		}
	}
};
var w = class l {
	tokens;
	options;
	state;
	inlineQueue;
	tokenizer;
	constructor(e) {
		this.tokens = [], this.tokens.links = Object.create(null), this.options = e || S, this.options.tokenizer = this.options.tokenizer || new _(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = {
			inLink: !1,
			inRawBlock: !1,
			linkEmitted: !1,
			linkParenPossible: !0,
			top: !0
		};
		let t = {
			other: O,
			block: ee.normal,
			inline: F.normal
		};
		this.options.pedantic ? (t.block = ee.pedantic, t.inline = F.pedantic) : this.options.gfm && (t.block = ee.gfm, this.options.breaks ? t.inline = F.breaks : t.inline = F.gfm), this.tokenizer.rules = t;
	}
	static get rules() {
		return {
			block: ee,
			inline: F
		};
	}
	static lex(e, t) {
		return new l(t).lex(e);
	}
	static lexInline(e, t) {
		return new l(t).inlineTokens(e);
	}
	lex(e) {
		e = e.replace(O.carriageReturn, `
`), this.blockTokens(e, this.tokens);
		for (let t = 0; t < this.inlineQueue.length; t++) {
			let n = this.inlineQueue[t];
			this.state.inRawBlock = !1, this.inlineTokens(n.src, n.tokens);
		}
		return this.inlineQueue = [], this.tokens;
	}
	blockTokens(e, t = [], n = !1) {
		this.tokenizer.lexer = this;
		let r = this.state.lastToken;
		this.options.pedantic && (e = e.replace(O.tabCharGlobal, "    ").replace(O.spaceLine, ""));
		let s = 1 / 0, o, i = this.options.gfm && !this.options.pedantic && this.tokenizer.paragraph === _.prototype.paragraph;
		for (; e;) {
			if (e.length < s) s = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			this.state.lastToken = t.at(-1);
			let a;
			if (this.options.extensions?.block?.some((u) => (a = u.call({ lexer: this }, e, t)) ? (e = e.substring(a.raw.length), t.push(a), !0) : !1)) continue;
			if (a = this.tokenizer.space(e)) {
				e = e.substring(a.raw.length);
				let u = t.at(-1);
				a.raw.length === 1 && u !== void 0 ? u.raw += `
` : t.push(a);
				continue;
			}
			if (a = this.tokenizer.code(e)) {
				e = e.substring(a.raw.length);
				let u = t.at(-1);
				u?.type === "paragraph" || u?.type === "text" ? (u.raw += (u.raw.endsWith(`
`) ? "" : `
`) + a.raw, u.text += `
` + a.text, this.inlineQueue.at(-1).src = u.text) : t.push(a);
				continue;
			}
			if (a = this.tokenizer.fences(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.heading(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.hr(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.blockquote(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.list(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.html(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.def(e)) {
				e = e.substring(a.raw.length);
				let u = t.at(-1);
				u?.type === "paragraph" || u?.type === "text" ? (u.raw += (u.raw.endsWith(`
`) ? "" : `
`) + a.raw, u.text += `
` + a.raw, this.inlineQueue.at(-1).src = u.text) : (this.tokens.links[a.tag] || (this.tokens.links[a.tag] = {
					href: a.href,
					title: a.title
				}), t.push(a));
				continue;
			}
			if (a = this.tokenizer.table(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.lheading(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			let c = e;
			if (this.options.extensions?.startBlock) {
				let u = 1 / 0, d = e.slice(1), h;
				this.options.extensions.startBlock.forEach((p) => {
					h = p.call({ lexer: this }, d), typeof h == "number" && h >= 0 && (u = Math.min(u, h));
				}), u < 1 / 0 && u >= 0 && (c = e.substring(0, u + 1));
			}
			if (this.state.top && (a = this.tokenizer.paragraph(c))) {
				let u = t.at(-1);
				(n || u === o && i) && u?.type === "paragraph" ? (u.raw += (u.raw.endsWith(`
`) ? "" : `
`) + a.raw, u.text += `
` + a.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = u.text, o = u) : (t.push(a), o = a), n = c.length !== e.length, e = e.substring(a.raw.length);
				continue;
			}
			if (a = this.tokenizer.text(e)) {
				e = e.substring(a.raw.length);
				let u = t.at(-1);
				u?.type === "text" ? (u.raw += (u.raw.endsWith(`
`) ? "" : `
`) + a.raw, u.text += `
` + a.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = u.text) : t.push(a);
				continue;
			}
			if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return this.state.top = !0, this.state.lastToken = r, t;
	}
	inline(e, t = []) {
		return this.inlineQueue.push({
			src: e,
			tokens: t
		}), t;
	}
	linkInText(e) {
		if (!e.includes("[")) return !1;
		let t = this.tokenizer.rules.inline.link;
		for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return !0;
		for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
			let r = n[0], s = r.lastIndexOf("[");
			if (!(r.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, W(r.slice(s + 1, -1)))) && !(s > 1 && this.linkInText(r.slice(1, s - 1)))) return !0;
		}
		return !1;
	}
	inlineTokens(e, t = []) {
		this.tokenizer.lexer = this;
		let n = this.state.linkParenPossible;
		this.state.linkParenPossible = e.includes(")");
		try {
			return this.#t(e, t);
		} finally {
			this.state.linkParenPossible = n;
		}
	}
	#t(e, t) {
		let n = e.includes("*") || e.includes("_") || e.includes("~"), r = n || this.options.hooks?.emStrongMask || this.tokenizer.emStrong !== _.prototype.emStrong || this.tokenizer.del !== _.prototype.del ? this.#r(e) : e;
		if (!n) return this.#e(e, r, t);
		qe(this.tokenizer, r);
		try {
			return this.#e(e, r, t);
		} finally {
			ve(this.tokenizer);
		}
	}
	#e(e, t, n) {
		let r = !1, s = "", o = 1 / 0;
		for (; e;) {
			if (e.length < o) o = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			r || (s = ""), r = !1;
			let i;
			if (this.options.extensions?.inline?.some((u) => (i = u.call({ lexer: this }, e, n)) ? (e = e.substring(i.raw.length), n.push(i), !0) : !1)) continue;
			if (i = this.tokenizer.escape(e)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.tag(e)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.link(e)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.reflink(e, this.tokens.links)) {
				e = e.substring(i.raw.length);
				let u = n.at(-1);
				i.type === "text" && u?.type === "text" ? (u.raw += i.raw, u.text += i.text) : n.push(i);
				continue;
			}
			let a = e[0];
			if (a === "*" || a === "_") {
				let u = t.length - e.length;
				if (oe(this.tokenizer, t, a) <= u) {
					let h = 1;
					for (; h < e.length && e.charCodeAt(h) === a.charCodeAt(0);) h++;
					let p = e.substring(0, h), k = n.at(-1);
					k?.type === "text" && !k.escaped ? (k.raw += p, k.text += p) : n.push({
						type: "text",
						raw: p,
						text: p,
						escaped: !1
					}), e = e.substring(h), s = a, r = !0;
					continue;
				}
			} else if (a === "~") {
				let u = t.length - e.length;
				if (ae(this.tokenizer, t) <= u) {
					let h = 1;
					for (; h < e.length && e.charCodeAt(h) === 126;) h++;
					let p = e.substring(0, h), k = n.at(-1);
					k?.type === "text" && !k.escaped ? (k.raw += p, k.text += p) : n.push({
						type: "text",
						raw: p,
						text: p,
						escaped: !1
					}), e = e.substring(h), s = a, r = !0;
					continue;
				}
			}
			if (i = this.tokenizer.emStrong(e, t, s)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.codespan(e)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.br(e)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.del(e, t, s)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (i = this.tokenizer.autolink(e)) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			if (!this.state.inLink && (i = this.tokenizer.url(e))) {
				e = e.substring(i.raw.length), n.push(i);
				continue;
			}
			let c = e;
			if (this.options.extensions?.startInline) {
				let u = 1 / 0, d = e.slice(1), h;
				this.options.extensions.startInline.forEach((p) => {
					h = p.call({ lexer: this }, d), typeof h == "number" && h >= 0 && (u = Math.min(u, h));
				}), u < 1 / 0 && u >= 0 && (c = e.substring(0, u + 1));
			}
			if (i = this.tokenizer.inlineText(c)) {
				e = e.substring(i.raw.length), i.raw.slice(-1) !== "_" && (s = i.raw.slice(-1)), r = !0;
				let u = n.at(-1);
				u?.type === "text" ? (u.raw += i.raw, u.text += i.text) : n.push(i);
				continue;
			}
			if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return n;
	}
	#n(e) {
		let { blockSkip: t, tag: n, autolink: r } = this.tokenizer.rules.inline, s = "", o = 0, i;
		for (t.lastIndex = 0; i = t.exec(e);) {
			let a = i.index + (i[2] ? i[2].length : 0), c = i.index + i[0].length;
			if (e.charAt(a) === "<") {
				let u = e.slice(a), d = n.exec(u) || r.exec(u);
				if (!d) {
					t.lastIndex = a + 1;
					continue;
				}
				c = a + d[0].length, t.lastIndex = c;
			}
			s += e.slice(o, a) + "[" + "a".repeat(c - a - 2) + "]", o = c;
		}
		return s + e.slice(o);
	}
	#r(e) {
		let t = e;
		if (this.tokens.links && e.includes("[")) {
			let n = this.tokenizer.rules.inline.reflinkSearch, r = (s) => {
				let o = s.lastIndexOf("[");
				if (!Object.hasOwn(this.tokens.links, W(s.slice(o + 1, -1)))) return s;
				if (o > 1 && s.charAt(0) !== "!") {
					let i = s.slice(1, o - 1);
					if (this.linkInText(i)) return "[" + i.replace(n, r) + "][" + "a".repeat(s.length - o - 2) + "]";
				}
				return "[" + "a".repeat(s.length - 2) + "]";
			};
			t = t.replace(n, r);
		}
		return t = t.replace(this.tokenizer.rules.inline.anyPunctuationOutsideCode, (n, r, s) => s ? "+".repeat(n.length) : r ? r + n.slice(r.length, -r.length).replace(/`/g, "+") + r : n), t = this.#n(t), t = this.options.hooks?.emStrongMask?.call({ lexer: this }, t) ?? t, t;
	}
	infiniteLoopError(e) {
		let t = "Infinite loop on byte: " + e;
		if (this.options.silent) console.error(t);
		else throw new Error(t);
	}
};
var I = class {
	options;
	parser;
	constructor(e) {
		this.options = e || S;
	}
	space(e) {
		return "";
	}
	code({ text: e, lang: t, escaped: n }) {
		let r = (t || "").match(O.notSpaceStart)?.[0], s = e ? e.replace(O.endingNewline, "") + `
` : "";
		return r ? "<pre><code class=\"language-" + y(r) + "\">" + (n ? s : y(s, !0)) + `</code></pre>
` : "<pre><code>" + (n ? s : y(s, !0)) + `</code></pre>
`;
	}
	blockquote({ tokens: e }) {
		return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
	}
	html({ text: e }) {
		return e;
	}
	def(e) {
		return "";
	}
	heading({ tokens: e, depth: t }) {
		return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
	}
	hr(e) {
		return `<hr>
`;
	}
	list(e) {
		let t = e.ordered, n = e.start, r = "";
		for (let i = 0; i < e.items.length; i++) {
			let a = e.items[i];
			r += this.listitem(a);
		}
		let s = t ? "ol" : "ul", o = t && n !== 1 ? " start=\"" + n + "\"" : "";
		return "<" + s + o + `>
` + r + "</" + s + `>
`;
	}
	listitem(e) {
		return `<li>${this.parser.parse(e.tokens)}</li>
`;
	}
	checkbox({ checked: e }) {
		return "<input " + (e ? "checked=\"\" " : "") + "disabled=\"\" type=\"checkbox\"> ";
	}
	paragraph({ tokens: e }) {
		return `<p>${this.parser.parseInline(e)}</p>
`;
	}
	table(e) {
		let t = "", n = "";
		for (let s = 0; s < e.header.length; s++) n += this.tablecell(e.header[s]);
		t += this.tablerow({ text: n });
		let r = "";
		for (let s = 0; s < e.rows.length; s++) {
			let o = e.rows[s];
			n = "";
			for (let i = 0; i < o.length; i++) n += this.tablecell(o[i]);
			r += this.tablerow({ text: n });
		}
		return r && (r = `<tbody>${r}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + r + `</table>
`;
	}
	tablerow({ text: e }) {
		return `<tr>
${e}</tr>
`;
	}
	tablecell(e) {
		let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
		return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
	}
	strong({ tokens: e }) {
		return `<strong>${this.parser.parseInline(e)}</strong>`;
	}
	em({ tokens: e }) {
		return `<em>${this.parser.parseInline(e)}</em>`;
	}
	codespan({ text: e }) {
		return `<code>${y(e, !0)}</code>`;
	}
	br(e) {
		return "<br>";
	}
	del({ tokens: e }) {
		return `<del>${this.parser.parseInline(e)}</del>`;
	}
	link({ href: e, title: t, text: n, tokens: r, autolink: s }) {
		let o = s ? y(n, !0) : this.parser.parseInline(r), i = xe(e);
		if (i === null) return o;
		e = y(i, s);
		let a = "<a href=\"" + e + "\"";
		return t && (a += " title=\"" + y(t) + "\""), a += ">" + o + "</a>", a;
	}
	image({ href: e, title: t, text: n, tokens: r }) {
		r && (n = this.parser.parseInline(r, this.parser.textRenderer));
		let s = xe(e);
		if (s === null) return y(n);
		e = s;
		let o = `<img src="${y(e)}" alt="${y(n)}"`;
		return t && (o += ` title="${y(t)}"`), o += ">", o;
	}
	text(e) {
		return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : y(e.text);
	}
};
var z = class {
	parser;
	strong({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	em({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	codespan({ text: e }) {
		return e;
	}
	del({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	html({ text: e }) {
		return e;
	}
	text({ text: e }) {
		return e;
	}
	link({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	image({ text: e, tokens: t }) {
		return t ? this.parser.parseInline(t, this) : e;
	}
	br() {
		return `
`;
	}
	checkbox({ raw: e }) {
		return e;
	}
};
var P = class l {
	options;
	renderer;
	textRenderer;
	constructor(e) {
		this.options = e || S, this.options.renderer = this.options.renderer || new I(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new z(), this.textRenderer.parser = this;
	}
	static parse(e, t) {
		return new l(t).parse(e);
	}
	static parseInline(e, t) {
		return new l(t).parseInline(e);
	}
	parse(e) {
		this.renderer.parser = this;
		let t = "";
		for (let n = 0; n < e.length; n++) {
			let r = e[n];
			if (this.options.extensions?.renderers?.[r.type]) {
				let o = r, i = this.options.extensions.renderers[o.type].call({ parser: this }, o);
				if (i !== !1 || ![
					"space",
					"hr",
					"heading",
					"code",
					"table",
					"blockquote",
					"list",
					"checkbox",
					"html",
					"def",
					"paragraph",
					"text"
				].includes(o.type)) {
					t += i === !1 ? "" : i ?? "";
					continue;
				}
			}
			let s = r;
			switch (s.type) {
				case "space":
					t += this.renderer.space(s);
					break;
				case "hr":
					t += this.renderer.hr(s);
					break;
				case "heading":
					t += this.renderer.heading(s);
					break;
				case "code":
					t += this.renderer.code(s);
					break;
				case "table":
					t += this.renderer.table(s);
					break;
				case "blockquote":
					t += this.renderer.blockquote(s);
					break;
				case "list":
					t += this.renderer.list(s);
					break;
				case "checkbox":
					t += this.renderer.checkbox(s);
					break;
				case "html":
					t += this.renderer.html(s);
					break;
				case "def":
					t += this.renderer.def(s);
					break;
				case "paragraph":
					t += this.renderer.paragraph(s);
					break;
				case "text":
					t += this.renderer.text(s);
					break;
				default: {
					let o = "Token with \"" + s.type + "\" type was not found.";
					if (this.options.silent) return console.error(o), "";
					throw new Error(o);
				}
			}
		}
		return t;
	}
	parseInline(e, t = this.renderer) {
		this.renderer.parser = this;
		let n = "";
		for (let r = 0; r < e.length; r++) {
			let s = e[r];
			if (this.options.extensions?.renderers?.[s.type]) {
				let i = this.options.extensions.renderers[s.type].call({ parser: this }, s);
				if (i !== !1 || ![
					"escape",
					"html",
					"link",
					"image",
					"checkbox",
					"strong",
					"em",
					"codespan",
					"br",
					"del",
					"text"
				].includes(s.type)) {
					n += i === !1 ? "" : i ?? "";
					continue;
				}
			}
			let o = s;
			switch (o.type) {
				case "escape":
					n += t.text(o);
					break;
				case "html":
					n += t.html(o);
					break;
				case "link":
					n += t.link(o);
					break;
				case "image":
					n += t.image(o);
					break;
				case "checkbox":
					n += t.checkbox(o);
					break;
				case "strong":
					n += t.strong(o);
					break;
				case "em":
					n += t.em(o);
					break;
				case "codespan":
					n += t.codespan(o);
					break;
				case "br":
					n += t.br(o);
					break;
				case "del":
					n += t.del(o);
					break;
				case "text":
					n += t.text(o);
					break;
				default: {
					let i = "Token with \"" + o.type + "\" type was not found.";
					if (this.options.silent) return console.error(i), "";
					throw new Error(i);
				}
			}
		}
		return n;
	}
};
var A = class {
	options;
	block;
	constructor(e) {
		this.options = e || S;
	}
	static passThroughHooks = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens",
		"emStrongMask"
	]);
	static passThroughHooksRespectAsync = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens"
	]);
	preprocess(e) {
		return e;
	}
	postprocess(e) {
		return e;
	}
	processAllTokens(e) {
		return e;
	}
	emStrongMask(e) {
		return e;
	}
	provideLexer(e = this.block) {
		return e ? w.lex : w.lexInline;
	}
	provideParser(e = this.block) {
		return e ? P.parse : P.parseInline;
	}
};
function M(l, e) {
	if (Array.isArray(e)) for (let t = 0; t < e.length; t++) l.push(e[t]);
	else l.push(e);
}
var ne = class {
	defaults = G();
	options = this.setOptions;
	parse = this.parseMarkdown(!0);
	parseInline = this.parseMarkdown(!1);
	Parser = P;
	Renderer = I;
	TextRenderer = z;
	Lexer = w;
	Tokenizer = _;
	Hooks = A;
	constructor(...e) {
		this.use(...e);
	}
	walkTokens(e, t) {
		let n = [];
		for (let r of e) switch (M(n, t.call(this, r)), r.type) {
			case "table": {
				let s = r;
				for (let o of s.header) M(n, this.walkTokens(o.tokens, t));
				for (let o of s.rows) for (let i of o) M(n, this.walkTokens(i.tokens, t));
				break;
			}
			case "list": {
				let s = r;
				M(n, this.walkTokens(s.items, t));
				break;
			}
			default: {
				let s = r;
				this.defaults.extensions?.childTokens?.[s.type] ? this.defaults.extensions.childTokens[s.type].forEach((o) => {
					let i = s[o].flat(1 / 0);
					M(n, this.walkTokens(i, t));
				}) : s.tokens && M(n, this.walkTokens(s.tokens, t));
			}
		}
		return n;
	}
	use(...e) {
		let t = this.defaults.extensions || {
			renderers: Object.create(null),
			childTokens: Object.create(null)
		};
		return e.forEach((n) => {
			let r = { ...n };
			if (r.async = this.defaults.async || r.async || !1, n.extensions && (n.extensions.forEach((s) => {
				if (!s.name) throw new Error("extension name required");
				if ("renderer" in s) {
					let o = t.renderers[s.name];
					o ? t.renderers[s.name] = function(...i) {
						let a = s.renderer.apply(this, i);
						return a === !1 && (a = o.apply(this, i)), a;
					} : t.renderers[s.name] = s.renderer;
				}
				if ("tokenizer" in s) {
					if (!s.level || s.level !== "block" && s.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
					let o = t[s.level];
					o ? o.unshift(s.tokenizer) : t[s.level] = [s.tokenizer], s.start && (s.level === "block" ? t.startBlock ? t.startBlock.push(s.start) : t.startBlock = [s.start] : s.level === "inline" && (t.startInline ? t.startInline.push(s.start) : t.startInline = [s.start]));
				}
				"childTokens" in s && s.childTokens && (t.childTokens[s.name] = s.childTokens);
			}), r.extensions = t), n.renderer) {
				let s = this.defaults.renderer || new I(this.defaults);
				for (let o in n.renderer) {
					if (!(o in s)) throw new Error(`renderer '${o}' does not exist`);
					if (["options", "parser"].includes(o)) continue;
					let i = o, a = n.renderer[i], c = s[i];
					s[i] = (...u) => {
						let d = a.apply(s, u);
						return d === !1 && (d = c.apply(s, u)), d === !1 ? "" : d ?? "";
					};
				}
				r.renderer = s;
			}
			if (n.tokenizer) {
				let s = this.defaults.tokenizer || new _(this.defaults);
				for (let o in n.tokenizer) {
					if (!(o in s)) throw new Error(`tokenizer '${o}' does not exist`);
					if ([
						"options",
						"rules",
						"lexer"
					].includes(o)) continue;
					let i = o, a = n.tokenizer[i], c = s[i];
					s[i] = (...u) => {
						let d = a.apply(s, u);
						return d === !1 && (d = c.apply(s, u)), d;
					};
				}
				r.tokenizer = s;
			}
			if (n.hooks) {
				let s = this.defaults.hooks || new A();
				for (let o in n.hooks) {
					if (!(o in s)) throw new Error(`hook '${o}' does not exist`);
					if (["options", "block"].includes(o)) continue;
					let i = o, a = n.hooks[i], c = s[i];
					A.passThroughHooks.has(o) ? s[i] = (u) => {
						if (s.options.async && A.passThroughHooksRespectAsync.has(o)) return (async () => {
							let h = await a.call(s, u);
							return c.call(s, h);
						})();
						let d = a.call(s, u);
						return c.call(s, d);
					} : s[i] = (...u) => {
						if (s.options.async) return (async () => {
							let h = await a.apply(s, u);
							return h === !1 && (h = await c.apply(s, u)), h;
						})();
						let d = a.apply(s, u);
						return d === !1 && (d = c.apply(s, u)), d;
					};
				}
				r.hooks = s;
			}
			if (n.walkTokens) {
				let s = this.defaults.walkTokens, o = n.walkTokens;
				r.walkTokens = function(i) {
					let a = [];
					return M(a, o.call(this, i)), s && M(a, s.call(this, i)), a;
				};
			}
			this.defaults = {
				...this.defaults,
				...r
			};
		}), this;
	}
	setOptions(e) {
		return this.defaults = {
			...this.defaults,
			...e
		}, this;
	}
	lexer(e, t) {
		return w.lex(e, t ?? this.defaults);
	}
	parser(e, t) {
		return P.parse(e, t ?? this.defaults);
	}
	parseMarkdown(e) {
		return (n, r) => {
			let s = { ...r }, o = {
				...this.defaults,
				...s
			}, i = this.onError(!!o.silent, !!o.async);
			if (this.defaults.async === !0 && s.async === !1) return i(/* @__PURE__ */ new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
			if (typeof n > "u" || n === null) return i(/* @__PURE__ */ new Error("marked(): input parameter is undefined or null"));
			if (typeof n != "string") return i(/* @__PURE__ */ new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
			if (o.hooks && (o.hooks.options = o, o.hooks.block = e), o.async) return (async () => {
				let a = o.hooks ? await o.hooks.preprocess(n) : n, u = await (o.hooks ? await o.hooks.provideLexer(e) : e ? w.lex : w.lexInline)(a, o), d = o.hooks ? await o.hooks.processAllTokens(u) : u;
				o.walkTokens && await Promise.all(this.walkTokens(d, o.walkTokens));
				let p = await (o.hooks ? await o.hooks.provideParser(e) : e ? P.parse : P.parseInline)(d, o);
				return o.hooks ? await o.hooks.postprocess(p) : p;
			})().catch(i);
			try {
				o.hooks && (n = o.hooks.preprocess(n));
				let c = (o.hooks ? o.hooks.provideLexer(e) : e ? w.lex : w.lexInline)(n, o);
				o.hooks && (c = o.hooks.processAllTokens(c)), o.walkTokens && this.walkTokens(c, o.walkTokens);
				let d = (o.hooks ? o.hooks.provideParser(e) : e ? P.parse : P.parseInline)(c, o);
				return o.hooks && (d = o.hooks.postprocess(d)), d;
			} catch (a) {
				return i(a);
			}
		};
	}
	onError(e, t) {
		return (n) => {
			if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
				let r = "<p>An error occurred:</p><pre>" + y(n.message + "", !0) + "</pre>";
				return t ? Promise.resolve(r) : r;
			}
			if (t) return Promise.reject(n);
			throw n;
		};
	}
};
var v = new ne();
function x(l, e) {
	return v.parse(l, e);
}
x.options = x.setOptions = function(l) {
	return v.setOptions(l), x.defaults = v.defaults, ue(x.defaults), x;
};
x.getDefaults = G;
x.defaults = S;
function jt(...l) {
	return v.use(...l), x.defaults = v.defaults, ue(x.defaults), x;
}
x.use = jt;
x.walkTokens = function(l, e) {
	return v.walkTokens(l, e);
};
x.parseInline = v.parseInline;
x.Parser = P;
x.parser = P.parse;
x.Renderer = I;
x.TextRenderer = z;
x.Lexer = w;
x.lexer = w.lex;
x.Tokenizer = _;
x.Hooks = A;
x.parse = x;
x.options;
x.setOptions;
x.walkTokens;
x.parseInline;
P.parse;
w.lex;
// node_modules/dompurify/dist/purify.es.mjs
/*! @license DOMPurify 3.4.18 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.18/LICENSE */
function _OverloadYield(e, d) {
	this.v = e, this.k = d;
}
function _arrayLikeToArray(r, a) {
	(null == a || a > r.length) && (a = r.length);
	for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
	return n;
}
function _arrayWithHoles(r) {
	if (Array.isArray(r)) return r;
}
function _iterableToArrayLimit(r, l) {
	var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
	if (null != t) {
		var e, n, i, u, a = [], f = !0, o = !1;
		try {
			if (i = (t = t.call(r)).next, 0 === l) {
				if (Object(t) !== t) return;
				f = !1;
			} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
		} catch (r) {
			o = !0, n = r;
		} finally {
			try {
				if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
			} finally {
				if (o) throw n;
			}
		}
		return a;
	}
}
function _nonIterableRest() {
	throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
/*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */
function _slicedToArray(r, e) {
	return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _unsupportedIterableToArray(r, a) {
	if (r) {
		if ("string" == typeof r) return _arrayLikeToArray(r, a);
		var t = {}.toString.call(r).slice(8, -1);
		return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
	}
}
function AsyncGenerator(e) {
	var t, n;
	function resume(t, n) {
		try {
			var r = e[t](n), o = r.value, u = o instanceof _OverloadYield;
			Promise.resolve(u ? o.v : o).then(function(n) {
				if (u) {
					var i = "return" === t && o.k ? t : "next";
					if (!o.k || n.done) return resume(i, n);
					n = e[i](n).value;
				}
				settle(!!r.done, n);
			}, function(e) {
				resume("throw", e);
			});
		} catch (e) {
			settle(2, e);
		}
	}
	function settle(e, r) {
		2 === e ? t.reject(r) : t.resolve({
			value: r,
			done: e
		}), (t = t.next) ? resume(t.key, t.arg) : n = null;
	}
	this._invoke = function(e, r) {
		return new Promise(function(o, u) {
			var i = {
				key: e,
				arg: r,
				resolve: o,
				reject: u,
				next: null
			};
			n ? n = n.next = i : (t = n = i, resume(e, r));
		});
	}, "function" != typeof e.return && (this.return = void 0);
}
AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function() {
	return this;
}, AsyncGenerator.prototype.next = function(e) {
	return this._invoke("next", e);
}, AsyncGenerator.prototype.throw = function(e) {
	return this._invoke("throw", e);
}, AsyncGenerator.prototype.return = function(e) {
	return this._invoke("return", e);
};
var entries = Object.entries;
var objectKeys = Object.keys;
var setPrototypeOf = Object.setPrototypeOf;
var isFrozen = Object.isFrozen;
var getPrototypeOf = Object.getPrototypeOf;
var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
var freeze = Object.freeze;
var seal = Object.seal;
var create = Object.create;
var _ref = typeof Reflect !== "undefined" && Reflect;
var apply$1 = _ref.apply;
var construct = _ref.construct;
if (!freeze) freeze = function freeze(x) {
	return x;
};
if (!seal) seal = function seal(x) {
	return x;
};
if (!apply$1) apply$1 = function apply(func, thisArg) {
	for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
	return func.apply(thisArg, args);
};
if (!construct) construct = function construct(Func) {
	for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
	return new Func(...args);
};
var arrayForEach = unapply(Array.prototype.forEach);
var arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
var arrayPop = unapply(Array.prototype.pop);
var arrayPush = unapply(Array.prototype.push);
var arraySlice = unapply(Array.prototype.slice);
var arraySplice = unapply(Array.prototype.splice);
var arrayIsArray = Array.isArray;
var setCreate = unconstruct(Set);
var setAdd = unapply(Set.prototype.add);
var setHas = unapply(Set.prototype.has);
var stringToLowerCase = unapply(String.prototype.toLowerCase);
var stringToString = unapply(String.prototype.toString);
var stringMatch = unapply(String.prototype.match);
var stringReplace = unapply(String.prototype.replace);
var stringIndexOf = unapply(String.prototype.indexOf);
var stringTrim = unapply(String.prototype.trim);
var numberToString = unapply(Number.prototype.toString);
var booleanToString = unapply(Boolean.prototype.toString);
var bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
var symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
var objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
var objectToString = unapply(Object.prototype.toString);
var regExpTestRaw = RegExp.prototype.test;
var regExpTest = function regExpTest(regExp, value) {
	if (regExp instanceof RegExp) regExp.lastIndex = 0;
	return apply$1(regExpTestRaw, regExp, [value]);
};
var typeErrorCreate = unconstruct(TypeError);
/**
* Creates a new function that calls the given function with a specified thisArg and arguments.
*
* @param func - The function to be wrapped and called.
* @returns A new function that calls the given function with a specified thisArg and arguments.
*/
function unapply(func) {
	return function(thisArg) {
		for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
		return apply$1(func, thisArg, args);
	};
}
/**
* Creates a new function that constructs an instance of the given constructor function with the provided arguments.
*
* @param func - The constructor function to be wrapped and called.
* @returns A new function that constructs an instance of the given constructor function with the provided arguments.
*/
function unconstruct(Func) {
	return function() {
		for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
		return construct(Func, args);
	};
}
/**
* Add properties to a lookup table
*
* @param set - The set to which elements will be added.
* @param array - The array containing elements to be added to the set.
* @param transformCaseFunc - An optional function to transform the case of each element before adding to the set.
* @returns The modified set with added elements.
*/
function addToSet(set, array) {
	let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
	if (setPrototypeOf) setPrototypeOf(set, null);
	if (!arrayIsArray(array)) return set;
	let l = array.length;
	while (l--) {
		let element = array[l];
		if (typeof element === "string") {
			const lcElement = transformCaseFunc(element);
			if (lcElement !== element) {
				if (!isFrozen(array)) array[l] = lcElement;
				element = lcElement;
			}
		}
		set[element] = true;
	}
	return set;
}
/**
* Clean up an array to harden against CSPP
*
* @param array - The array to be cleaned.
* @returns The cleaned version of the array
*/
function cleanArray(array) {
	for (let index = 0; index < array.length; index++) if (!objectHasOwnProperty(array, index)) array[index] = null;
	return array;
}
/**
* Shallow clone an object
*
* @param object - The object to be cloned.
* @returns A new object that copies the original.
*/
function clone$1(object) {
	const newObject = create(null);
	for (const _ref2 of entries(object)) {
		var _ref3 = _slicedToArray(_ref2, 2);
		const property = _ref3[0];
		const value = _ref3[1];
		if (objectHasOwnProperty(object, property)) {
			if (arrayIsArray(value)) newObject[property] = cleanArray(value);
			else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone$1(value);
			else newObject[property] = value;
		}
	}
	return newObject;
}
/**
* Copy a flat lookup table
*
* @param set - The set to copy.
* @returns A new prototype-free set with the same entries.
*/
function cloneSet(set) {
	const newSet = create(null);
	const keys = objectKeys(set);
	let l = keys.length;
	while (l--) newSet[keys[l]] = set[keys[l]];
	return newSet;
}
/**
* Convert non-node values into strings without depending on direct property access.
*
* @param value - The value to stringify.
* @returns A string representation of the provided value.
*/
function stringifyValue(value) {
	switch (typeof value) {
		case "string": return value;
		case "number": return numberToString(value);
		case "boolean": return booleanToString(value);
		case "bigint": return bigintToString ? bigintToString(value) : "0";
		case "symbol": return symbolToString ? symbolToString(value) : "Symbol()";
		case "undefined": return objectToString(value);
		case "function":
		case "object": {
			if (value === null) return objectToString(value);
			const valueAsRecord = value;
			const valueToString = lookupGetter(valueAsRecord, "toString");
			if (typeof valueToString === "function") {
				const stringified = valueToString(valueAsRecord);
				return typeof stringified === "string" ? stringified : objectToString(stringified);
			}
			return objectToString(value);
		}
		default: return objectToString(value);
	}
}
/**
* This method automatically checks if the prop is function or getter and behaves accordingly.
*
* @param object - The object to look up the getter function in its prototype chain.
* @param prop - The property name for which to find the getter function.
* @returns The getter function found in the prototype chain or a fallback function.
*/
function lookupGetter(object, prop) {
	while (object !== null) {
		const desc = getOwnPropertyDescriptor(object, prop);
		if (desc) {
			if (desc.get) return unapply(desc.get);
			if (typeof desc.value === "function") return unapply(desc.value);
		}
		object = getPrototypeOf(object);
	}
	function fallbackValue() {
		return null;
	}
	return fallbackValue;
}
/**
* Like lookupGetter, but for accessor properties only, and returns null
* instead of a null-returning fallback when no getter exists on the chain.
* Lets a caller fall back to a direct property read in environments that
* lack the getter, where a fallback returning null would be indistinguishable
* from a legitimate null value (e.g. namespaceURI of a no-namespace element).
*
* @param object - The object (usually a prototype) to start the lookup at.
* @param prop - The accessor property name.
* @returns The unapplied getter, or null if none was found.
*/
function lookupAccessor(object, prop) {
	while (object !== null) {
		const desc = getOwnPropertyDescriptor(object, prop);
		if (desc) return desc.get ? unapply(desc.get) : null;
		object = getPrototypeOf(object);
	}
	return null;
}
function isRegex(value) {
	if (!value) return false;
	try {
		regExpTest(value, "");
		return true;
	} catch (_unused) {
		return false;
	}
}
var html$1 = freeze([
	"a",
	"abbr",
	"acronym",
	"address",
	"area",
	"article",
	"aside",
	"audio",
	"b",
	"bdi",
	"bdo",
	"big",
	"blink",
	"blockquote",
	"body",
	"br",
	"button",
	"canvas",
	"caption",
	"center",
	"cite",
	"code",
	"col",
	"colgroup",
	"content",
	"data",
	"datalist",
	"dd",
	"decorator",
	"del",
	"details",
	"dfn",
	"dialog",
	"dir",
	"div",
	"dl",
	"dt",
	"element",
	"em",
	"fieldset",
	"figcaption",
	"figure",
	"font",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hgroup",
	"hr",
	"html",
	"i",
	"img",
	"input",
	"ins",
	"kbd",
	"label",
	"legend",
	"li",
	"main",
	"map",
	"mark",
	"marquee",
	"menu",
	"menuitem",
	"meter",
	"nav",
	"nobr",
	"ol",
	"optgroup",
	"option",
	"output",
	"p",
	"picture",
	"pre",
	"progress",
	"q",
	"rp",
	"rt",
	"ruby",
	"s",
	"samp",
	"search",
	"section",
	"select",
	"shadow",
	"slot",
	"small",
	"source",
	"spacer",
	"span",
	"strike",
	"strong",
	"style",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"template",
	"textarea",
	"tfoot",
	"th",
	"thead",
	"time",
	"tr",
	"track",
	"tt",
	"u",
	"ul",
	"var",
	"video",
	"wbr"
]);
var svg$1 = freeze([
	"svg",
	"a",
	"altglyph",
	"altglyphdef",
	"altglyphitem",
	"animatecolor",
	"animatemotion",
	"animatetransform",
	"circle",
	"clippath",
	"defs",
	"desc",
	"ellipse",
	"filter",
	"font",
	"g",
	"glyph",
	"glyphref",
	"hkern",
	"image",
	"line",
	"lineargradient",
	"marker",
	"mask",
	"metadata",
	"mpath",
	"path",
	"pattern",
	"polygon",
	"polyline",
	"radialgradient",
	"rect",
	"stop",
	"style",
	"switch",
	"symbol",
	"text",
	"textpath",
	"title",
	"tref",
	"tspan",
	"view",
	"vkern"
]);
var svgFilters = freeze([
	"feBlend",
	"feColorMatrix",
	"feComponentTransfer",
	"feComposite",
	"feConvolveMatrix",
	"feDiffuseLighting",
	"feDisplacementMap",
	"feDistantLight",
	"feDropShadow",
	"feFlood",
	"feFuncA",
	"feFuncB",
	"feFuncG",
	"feFuncR",
	"feGaussianBlur",
	"feImage",
	"feMerge",
	"feMergeNode",
	"feMorphology",
	"feOffset",
	"fePointLight",
	"feSpecularLighting",
	"feSpotLight",
	"feTile",
	"feTurbulence"
]);
var svgDisallowed = freeze([
	"animate",
	"color-profile",
	"cursor",
	"discard",
	"font-face",
	"font-face-format",
	"font-face-name",
	"font-face-src",
	"font-face-uri",
	"foreignobject",
	"hatch",
	"hatchpath",
	"mesh",
	"meshgradient",
	"meshpatch",
	"meshrow",
	"missing-glyph",
	"script",
	"set",
	"solidcolor",
	"unknown",
	"use"
]);
var mathMl$1 = freeze([
	"math",
	"menclose",
	"merror",
	"mfenced",
	"mfrac",
	"mglyph",
	"mi",
	"mlabeledtr",
	"mmultiscripts",
	"mn",
	"mo",
	"mover",
	"mpadded",
	"mphantom",
	"mroot",
	"mrow",
	"ms",
	"mspace",
	"msqrt",
	"mstyle",
	"msub",
	"msup",
	"msubsup",
	"mtable",
	"mtd",
	"mtext",
	"mtr",
	"munder",
	"munderover",
	"mprescripts"
]);
var mathMlDisallowed = freeze([
	"maction",
	"maligngroup",
	"malignmark",
	"mlongdiv",
	"mscarries",
	"mscarry",
	"msgroup",
	"mstack",
	"msline",
	"msrow",
	"semantics",
	"annotation",
	"annotation-xml",
	"mprescripts",
	"none"
]);
var text = freeze(["#text"]);
var html = freeze([
	"accept",
	"action",
	"align",
	"alt",
	"autocapitalize",
	"autocomplete",
	"autopictureinpicture",
	"autoplay",
	"background",
	"bgcolor",
	"border",
	"capture",
	"cellpadding",
	"cellspacing",
	"checked",
	"cite",
	"class",
	"clear",
	"color",
	"cols",
	"colspan",
	"command",
	"commandfor",
	"controls",
	"controlslist",
	"coords",
	"crossorigin",
	"datetime",
	"decoding",
	"default",
	"dir",
	"disabled",
	"disablepictureinpicture",
	"disableremoteplayback",
	"download",
	"draggable",
	"enctype",
	"enterkeyhint",
	"exportparts",
	"face",
	"for",
	"headers",
	"height",
	"hidden",
	"high",
	"href",
	"hreflang",
	"id",
	"inert",
	"inputmode",
	"integrity",
	"ismap",
	"kind",
	"label",
	"lang",
	"list",
	"loading",
	"loop",
	"low",
	"max",
	"maxlength",
	"media",
	"method",
	"min",
	"minlength",
	"multiple",
	"muted",
	"name",
	"nonce",
	"noshade",
	"novalidate",
	"nowrap",
	"open",
	"optimum",
	"part",
	"pattern",
	"placeholder",
	"playsinline",
	"popover",
	"popovertarget",
	"popovertargetaction",
	"poster",
	"preload",
	"pubdate",
	"radiogroup",
	"readonly",
	"rel",
	"required",
	"rev",
	"reversed",
	"role",
	"rows",
	"rowspan",
	"spellcheck",
	"scope",
	"selected",
	"shape",
	"size",
	"sizes",
	"slot",
	"span",
	"srclang",
	"start",
	"src",
	"srcset",
	"step",
	"style",
	"summary",
	"tabindex",
	"title",
	"translate",
	"type",
	"usemap",
	"valign",
	"value",
	"width",
	"wrap",
	"xmlns"
]);
var svg = freeze([
	"accent-height",
	"accumulate",
	"additive",
	"alignment-baseline",
	"amplitude",
	"ascent",
	"attributename",
	"attributetype",
	"azimuth",
	"basefrequency",
	"baseline-shift",
	"begin",
	"bias",
	"by",
	"class",
	"clip",
	"clippathunits",
	"clip-path",
	"clip-rule",
	"color",
	"color-interpolation",
	"color-interpolation-filters",
	"color-profile",
	"color-rendering",
	"cx",
	"cy",
	"d",
	"dx",
	"dy",
	"diffuseconstant",
	"direction",
	"display",
	"divisor",
	"dominant-baseline",
	"dur",
	"edgemode",
	"elevation",
	"end",
	"exponent",
	"fill",
	"fill-opacity",
	"fill-rule",
	"filter",
	"filterunits",
	"flood-color",
	"flood-opacity",
	"font-family",
	"font-size",
	"font-size-adjust",
	"font-stretch",
	"font-style",
	"font-variant",
	"font-weight",
	"fx",
	"fy",
	"g1",
	"g2",
	"glyph-name",
	"glyphref",
	"gradientunits",
	"gradienttransform",
	"height",
	"href",
	"id",
	"image-rendering",
	"in",
	"in2",
	"intercept",
	"k",
	"k1",
	"k2",
	"k3",
	"k4",
	"kerning",
	"keypoints",
	"keysplines",
	"keytimes",
	"lang",
	"lengthadjust",
	"letter-spacing",
	"kernelmatrix",
	"kernelunitlength",
	"lighting-color",
	"local",
	"marker-end",
	"marker-mid",
	"marker-start",
	"markerheight",
	"markerunits",
	"markerwidth",
	"maskcontentunits",
	"maskunits",
	"max",
	"mask",
	"mask-type",
	"media",
	"method",
	"mode",
	"min",
	"name",
	"numoctaves",
	"offset",
	"operator",
	"opacity",
	"order",
	"orient",
	"orientation",
	"origin",
	"overflow",
	"paint-order",
	"path",
	"pathlength",
	"patterncontentunits",
	"patterntransform",
	"patternunits",
	"pointer-events",
	"points",
	"preservealpha",
	"preserveaspectratio",
	"primitiveunits",
	"r",
	"rx",
	"ry",
	"radius",
	"refx",
	"refy",
	"repeatcount",
	"repeatdur",
	"restart",
	"result",
	"rotate",
	"scale",
	"seed",
	"shape-rendering",
	"slope",
	"specularconstant",
	"specularexponent",
	"spreadmethod",
	"startoffset",
	"stddeviation",
	"stitchtiles",
	"stop-color",
	"stop-opacity",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"stroke-opacity",
	"stroke",
	"stroke-width",
	"style",
	"surfacescale",
	"systemlanguage",
	"tabindex",
	"tablevalues",
	"targetx",
	"targety",
	"transform",
	"transform-origin",
	"text-anchor",
	"text-decoration",
	"text-orientation",
	"text-rendering",
	"textlength",
	"type",
	"u1",
	"u2",
	"unicode",
	"values",
	"vector-effect",
	"viewbox",
	"visibility",
	"version",
	"vert-adv-y",
	"vert-origin-x",
	"vert-origin-y",
	"width",
	"word-spacing",
	"wrap",
	"writing-mode",
	"xchannelselector",
	"ychannelselector",
	"x",
	"x1",
	"x2",
	"xmlns",
	"y",
	"y1",
	"y2",
	"z",
	"zoomandpan"
]);
var mathMl = freeze([
	"accent",
	"accentunder",
	"align",
	"bevelled",
	"close",
	"columnalign",
	"columnlines",
	"columnspacing",
	"columnspan",
	"denomalign",
	"depth",
	"dir",
	"display",
	"displaystyle",
	"encoding",
	"fence",
	"frame",
	"height",
	"href",
	"id",
	"largeop",
	"length",
	"linethickness",
	"lquote",
	"lspace",
	"mathbackground",
	"mathcolor",
	"mathsize",
	"mathvariant",
	"maxsize",
	"minsize",
	"movablelimits",
	"notation",
	"numalign",
	"open",
	"rowalign",
	"rowlines",
	"rowspacing",
	"rowspan",
	"rspace",
	"rquote",
	"scriptlevel",
	"scriptminsize",
	"scriptsizemultiplier",
	"selection",
	"separator",
	"separators",
	"stretchy",
	"subscriptshift",
	"supscriptshift",
	"symmetric",
	"voffset",
	"width",
	"xmlns"
]);
var xml = freeze([
	"xlink:href",
	"xml:id",
	"xlink:title",
	"xml:space",
	"xmlns:xlink"
]);
var MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
var ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
var TMPLIT_EXPR = seal(/\${[\w\W]*/g);
var TMPL_MARKER_SERIALIZED = seal(/{{|}}|\${|<%|%>|&lt;%|%&gt;/);
var DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
var ARIA_ATTR = seal(/^aria-[\-\w]+$/);
var IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
var IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
var ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
var DOCTYPE_NAME = seal(/^html$/i);
var CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
var ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
var COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
var FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
var SELF_CLOSING_TAG = seal(/\/>/i);
var ATTR_VALUE_BREAKOUT = seal(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i);
var LEADING_WHITESPACE = seal(/^[\r\n\t ]+/);
var NODE_TYPE = {
	element: 1,
	text: 3,
	processingInstruction: 7,
	comment: 8,
	document: 9,
	documentFragment: 11
};
var LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, [
	"style",
	"script",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	"plaintext",
	"noscript"
]));
var getGlobal = function getGlobal() {
	return typeof window === "undefined" ? null : window;
};
/**
* Creates a no-op policy for internal use only.
* Don't export this function outside this module!
* @param trustedTypes The policy factory.
* @param purifyHostElement The Script element used to load DOMPurify (to determine policy name suffix).
* @return The policy created (or null, if Trusted Types
* are not supported or creating the policy failed).
*/
var _createTrustedTypesPolicy = function _createTrustedTypesPolicy(trustedTypes, purifyHostElement) {
	if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
	let suffix = null;
	const ATTR_NAME = "data-tt-policy-suffix";
	if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
	const policyName = "dompurify" + (suffix ? "#" + suffix : "");
	try {
		return trustedTypes.createPolicy(policyName, {
			createHTML(html) {
				return html;
			},
			createScriptURL(scriptUrl) {
				return scriptUrl;
			}
		});
	} catch (_) {
		console.warn("TrustedTypes policy " + policyName + " could not be created.");
		return null;
	}
};
var _createHooksMap = function _createHooksMap() {
	return {
		afterSanitizeAttributes: [],
		afterSanitizeElements: [],
		afterSanitizeShadowDOM: [],
		beforeSanitizeAttributes: [],
		beforeSanitizeElements: [],
		beforeSanitizeShadowDOM: [],
		uponSanitizeAttribute: [],
		uponSanitizeElement: [],
		uponSanitizeShadowNode: []
	};
};
/**
* Resolve a set-valued configuration option.
*
* @param cfg the cloned, prototype-free configuration object
* @param key the configuration property to read
* @param fallback the set to use when the option is absent or not an array
* @param options case transform, and an optional base set to extend a copy of
* @returns a fresh set built from cfg[key], or the fallback
*/
var _resolveSetOption = function _resolveSetOption(cfg, key, fallback, options) {
	return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? cloneSet(options.base) : {}, cfg[key], options.transform) : fallback;
};
/**
* Resolve an object-valued configuration option.
*
* @param cfg the cloned, prototype-free configuration object
* @param key the configuration property to read
* @param fallback the read-only value to use when the option is absent
* @returns a prototype-free clone of cfg[key], or the fallback
*/
var _resolveObjectOption = function _resolveObjectOption(cfg, key, fallback) {
	const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
	return value && typeof value === "object" ? clone$1(value) : fallback;
};
function createDOMPurify() {
	let window = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
	const DOMPurify = (root) => createDOMPurify(root);
	DOMPurify.version = "3.4.18";
	DOMPurify.removed = [];
	if (!window || !window.document || window.document.nodeType !== NODE_TYPE.document || !window.Element) {
		DOMPurify.isSupported = false;
		return DOMPurify;
	}
	let document = window.document;
	const originalDocument = document;
	const currentScript = originalDocument.currentScript;
	const HTMLTemplateElement = window.HTMLTemplateElement, Node = window.Node, Element = window.Element, NodeFilter = window.NodeFilter, DOMParser = window.DOMParser, trustedTypes = window.trustedTypes;
	const ElementPrototype = Element.prototype;
	const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
	const remove = lookupGetter(ElementPrototype, "remove");
	const removeAttributeNode = lookupGetter(ElementPrototype, "removeAttributeNode");
	const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
	const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
	const getParentNode = lookupGetter(ElementPrototype, "parentNode");
	const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
	const getAttributes = lookupGetter(ElementPrototype, "attributes");
	const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
	const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
	const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
	const _readNodeType = function _readNodeType(node) {
		return getNodeType ? getNodeType(node) : node.nodeType;
	};
	const _readNodeName = function _readNodeName(node) {
		return getNodeName ? getNodeName(node) : node.nodeName;
	};
	const getNamespaceURI = lookupAccessor(ElementPrototype, "namespaceURI");
	const _readNamespaceURI = function _readNamespaceURI(element) {
		return getNamespaceURI ? getNamespaceURI(element) : element.namespaceURI;
	};
	if (typeof HTMLTemplateElement === "function") {
		const template = document.createElement("template");
		if (template.content && template.content.ownerDocument) document = template.content.ownerDocument;
	}
	let trustedTypesPolicy;
	let emptyHTML = "";
	let defaultTrustedTypesPolicy;
	let defaultTrustedTypesPolicyResolved = false;
	let IN_TRUSTED_TYPES_POLICY = 0;
	const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy() {
		if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate("A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the \"DOMPurify and Trusted Types\" section of the README.");
	};
	const _createTrustedHTML = function _createTrustedHTML(html) {
		_assertNotInTrustedTypesPolicy();
		IN_TRUSTED_TYPES_POLICY++;
		try {
			return trustedTypesPolicy.createHTML(html);
		} finally {
			IN_TRUSTED_TYPES_POLICY--;
		}
	};
	const _signOutput = function _signOutput(html) {
		return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(html) : html;
	};
	const _createTrustedScriptURL = function _createTrustedScriptURL(scriptUrl) {
		_assertNotInTrustedTypesPolicy();
		IN_TRUSTED_TYPES_POLICY++;
		try {
			return trustedTypesPolicy.createScriptURL(scriptUrl);
		} finally {
			IN_TRUSTED_TYPES_POLICY--;
		}
	};
	const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy() {
		if (!defaultTrustedTypesPolicyResolved) {
			defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
			defaultTrustedTypesPolicyResolved = true;
		}
		return defaultTrustedTypesPolicy;
	};
	const _document = document, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
	const importNode = originalDocument.importNode;
	let hooks = _createHooksMap();
	/**
	* Expose whether this browser supports running the full DOMPurify.
	*/
	DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
	const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
	let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
	/**
	* We consider the elements and attributes below to be safe. Ideally
	* don't add any new ones but feel free to remove unwanted ones.
	*/
	let ALLOWED_TAGS = null;
	const DEFAULT_ALLOWED_TAGS = addToSet({}, [
		...html$1,
		...svg$1,
		...svgFilters,
		...mathMl$1,
		...text
	]);
	let ALLOWED_ATTR = null;
	const DEFAULT_ALLOWED_ATTR = addToSet({}, [
		...html,
		...svg,
		...mathMl,
		...xml
	]);
	let CUSTOM_ELEMENT_HANDLING = null;
	let FORBID_TAGS = null;
	let FORBID_ATTR = null;
	const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
		tagCheck: {
			writable: true,
			configurable: false,
			enumerable: true,
			value: null
		},
		attributeCheck: {
			writable: true,
			configurable: false,
			enumerable: true,
			value: null
		}
	}));
	let ALLOW_ARIA_ATTR = true;
	let ALLOW_DATA_ATTR = true;
	let ALLOW_UNKNOWN_PROTOCOLS = false;
	let ALLOW_SELF_CLOSE_IN_ATTR = true;
	let SAFE_FOR_TEMPLATES = false;
	let SAFE_FOR_XML = true;
	let WHOLE_DOCUMENT = false;
	let SET_CONFIG = false;
	let SET_CONFIG_ALLOWED_TAGS = null;
	let SET_CONFIG_ALLOWED_ATTR = null;
	let FORCE_BODY = false;
	let RETURN_DOM = false;
	let RETURN_DOM_FRAGMENT = false;
	let RETURN_TRUSTED_TYPE = false;
	let SANITIZE_DOM = true;
	let SANITIZE_NAMED_PROPS = false;
	const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
	let KEEP_CONTENT = true;
	let IN_PLACE = false;
	let IN_PLACE_VISITED = null;
	let USE_PROFILES = false;
	let FORBID_CONTENTS = null;
	const DEFAULT_FORBID_CONTENTS = addToSet({}, [
		"annotation-xml",
		"audio",
		"colgroup",
		"desc",
		"foreignobject",
		"head",
		"iframe",
		"math",
		"mi",
		"mn",
		"mo",
		"ms",
		"mtext",
		"noembed",
		"noframes",
		"noscript",
		"plaintext",
		"script",
		"selectedcontent",
		"style",
		"svg",
		"template",
		"thead",
		"title",
		"video",
		"xmp"
	]);
	let DATA_URI_TAGS = null;
	const DEFAULT_DATA_URI_TAGS = addToSet({}, [
		"audio",
		"video",
		"img",
		"source",
		"image",
		"track"
	]);
	let URI_SAFE_ATTRIBUTES = null;
	const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
		"alt",
		"class",
		"for",
		"id",
		"label",
		"name",
		"pattern",
		"placeholder",
		"role",
		"summary",
		"title",
		"value",
		"style",
		"xmlns"
	]);
	const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
	const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
	const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
	let NAMESPACE = HTML_NAMESPACE;
	let IS_EMPTY_INPUT = false;
	let ALLOWED_NAMESPACES = null;
	const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
		MATHML_NAMESPACE,
		SVG_NAMESPACE,
		HTML_NAMESPACE
	], stringToString);
	const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze(addToSet({}, [
		"mi",
		"mo",
		"mn",
		"ms",
		"mtext"
	]));
	let MATHML_TEXT_INTEGRATION_POINTS = null;
	const DEFAULT_HTML_INTEGRATION_POINTS = freeze(addToSet({}, ["annotation-xml"]));
	let HTML_INTEGRATION_POINTS = null;
	const DEFAULT_CUSTOM_ELEMENT_HANDLING = freeze(create(null));
	const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
		"title",
		"style",
		"font",
		"a",
		"script"
	]);
	let PARSER_MEDIA_TYPE = null;
	const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
	const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
	let transformCaseFunc = null;
	let CONFIG = null;
	const formElement = document.createElement("form");
	const isRegexOrFunction = function isRegexOrFunction(testValue) {
		return testValue instanceof RegExp || testValue instanceof Function;
	};
	/**
	* _parseConfig
	*
	* @param cfg optional config literal
	*/
	const _parseConfig = function _parseConfig() {
		let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
		if (!cfg || typeof cfg !== "object") cfg = {};
		cfg = clone$1(cfg);
		PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
		transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
		ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
		ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
		ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
		URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
			transform: transformCaseFunc,
			base: DEFAULT_URI_SAFE_ATTRIBUTES
		});
		DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
			transform: transformCaseFunc,
			base: DEFAULT_DATA_URI_TAGS
		});
		FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
		FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", create(null), { transform: transformCaseFunc });
		FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", create(null), { transform: transformCaseFunc });
		USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone$1(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
		ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
		ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
		ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
		ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
		SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
		SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
		WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
		RETURN_DOM = cfg.RETURN_DOM || false;
		RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
		RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
		FORCE_BODY = cfg.FORCE_BODY || false;
		SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
		SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
		KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
		IN_PLACE = cfg.IN_PLACE || false;
		IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
		NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
		MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
		HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", DEFAULT_HTML_INTEGRATION_POINTS);
		const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", DEFAULT_CUSTOM_ELEMENT_HANDLING);
		CUSTOM_ELEMENT_HANDLING = create(null);
		if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
		if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
		if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
		seal(CUSTOM_ELEMENT_HANDLING);
		if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
		if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
		if (USE_PROFILES) {
			if ((objectHasOwnProperty(cfg, "ALLOWED_TAGS") || objectHasOwnProperty(cfg, "ALLOWED_ATTR")) && typeof console !== "undefined" && typeof console.warn === "function") console.warn("DOMPurify: USE_PROFILES overrides ALLOWED_TAGS and ALLOWED_ATTR. Do not use these options together.");
			ALLOWED_TAGS = addToSet({}, text);
			ALLOWED_ATTR = create(null);
			if (USE_PROFILES.html === true) {
				addToSet(ALLOWED_TAGS, html$1);
				addToSet(ALLOWED_ATTR, html);
			}
			if (USE_PROFILES.svg === true) {
				addToSet(ALLOWED_TAGS, svg$1);
				addToSet(ALLOWED_ATTR, svg);
				addToSet(ALLOWED_ATTR, xml);
			}
			if (USE_PROFILES.svgFilters === true) {
				addToSet(ALLOWED_TAGS, svgFilters);
				addToSet(ALLOWED_ATTR, svg);
				addToSet(ALLOWED_ATTR, xml);
			}
			if (USE_PROFILES.mathMl === true) {
				addToSet(ALLOWED_TAGS, mathMl$1);
				addToSet(ALLOWED_ATTR, mathMl);
				addToSet(ALLOWED_ATTR, xml);
			}
		}
		EXTRA_ELEMENT_HANDLING.tagCheck = null;
		EXTRA_ELEMENT_HANDLING.attributeCheck = null;
		if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
			if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
			else if (arrayIsArray(cfg.ADD_TAGS)) {
				if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = cloneSet(ALLOWED_TAGS);
				addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
			}
		}
		if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
			if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
			else if (arrayIsArray(cfg.ADD_ATTR)) {
				if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = cloneSet(ALLOWED_ATTR);
				addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
			}
		}
		if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
			if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = cloneSet(FORBID_CONTENTS);
			addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
		}
		if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
		if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
			"html",
			"head",
			"body"
		]);
		if (ALLOWED_TAGS.table) {
			ALLOWED_TAGS.tbody = true;
			delete FORBID_TAGS.tbody;
		}
		if (cfg.TRUSTED_TYPES_POLICY) {
			if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createHTML\" hook.");
			if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createScriptURL\" hook.");
			const previousTrustedTypesPolicy = trustedTypesPolicy;
			trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
			try {
				emptyHTML = _createTrustedHTML("");
			} catch (error) {
				trustedTypesPolicy = previousTrustedTypesPolicy;
				throw error;
			}
		} else if (cfg.TRUSTED_TYPES_POLICY === null) {
			trustedTypesPolicy = void 0;
			emptyHTML = "";
		} else {
			if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
			if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
		}
		CONFIG = freeze(cfg);
	};
	const ALL_SVG_TAGS = addToSet({}, [
		...svg$1,
		...svgFilters,
		...svgDisallowed
	]);
	const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
	/**
	* Namespace rules for an element in the SVG namespace.
	*
	* @param tagName the element's lowercase tag name
	* @param parentNamespace the (possibly simulated) parent's namespace
	* @param parentTagName the parent's lowercase tag name
	* @returns true if a spec-compliant parser could produce this element
	*/
	const _checkSvgNamespace = function _checkSvgNamespace(tagName, parentNamespace, parentTagName) {
		if (parentNamespace === HTML_NAMESPACE) return tagName === "svg";
		if (parentNamespace === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
		return Boolean(ALL_SVG_TAGS[tagName]);
	};
	/**
	* Namespace rules for an element in the MathML namespace.
	*
	* @param tagName the element's lowercase tag name
	* @param parentNamespace the (possibly simulated) parent's namespace
	* @param parentTagName the parent's lowercase tag name
	* @returns true if a spec-compliant parser could produce this element
	*/
	const _checkMathMlNamespace = function _checkMathMlNamespace(tagName, parentNamespace, parentTagName) {
		if (parentNamespace === HTML_NAMESPACE) return tagName === "math";
		if (parentNamespace === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
		return Boolean(ALL_MATHML_TAGS[tagName]);
	};
	/**
	* Namespace rules for an element in the HTML namespace.
	*
	* @param tagName the element's lowercase tag name
	* @param parentNamespace the (possibly simulated) parent's namespace
	* @param parentTagName the parent's lowercase tag name
	* @returns true if a spec-compliant parser could produce this element
	*/
	const _checkHtmlNamespace = function _checkHtmlNamespace(tagName, parentNamespace, parentTagName) {
		if (parentNamespace === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
		if (parentNamespace === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
		return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
	};
	/**
	* @param element a DOM element whose namespace is being checked
	* @returns Return false if the element has a
	*  namespace that a spec-compliant parser would never
	*  return. Return true otherwise.
	*/
	const _checkValidNamespace = function _checkValidNamespace(element) {
		const elementNamespace = _readNamespaceURI(element);
		const tagName = stringToLowerCase(_readNodeName(element));
		const parentNode = getParentNode(element);
		let parentNamespace = NAMESPACE;
		let parentTagName = "template";
		if (parentNode && _readNodeType(parentNode) === NODE_TYPE.element) {
			parentNamespace = _readNamespaceURI(parentNode);
			parentTagName = stringToLowerCase(_readNodeName(parentNode));
		}
		if (!ALLOWED_NAMESPACES[elementNamespace]) return false;
		if (elementNamespace === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parentNamespace, parentTagName);
		if (elementNamespace === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parentNamespace, parentTagName);
		if (elementNamespace === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parentNamespace, parentTagName);
		return PARSER_MEDIA_TYPE === "application/xhtml+xml";
	};
	/**
	* _forceRemove
	*
	* @param node a DOM node
	*/
	const _forceRemove = function _forceRemove(node) {
		arrayPush(DOMPurify.removed, { element: node });
		try {
			getParentNode(node).removeChild(node);
		} catch (_) {
			remove(node);
			if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
		}
	};
	/**
	* Removes an Attr node as that exact node, without book-keeping. Name-based
	* removal lowercases the name in HTML documents and would miss a
	* case-preserved one such as `ONERROR`, so it is only the fallback for
	* clobbered or detached nodes.
	*
	* @param element the element to strip the attribute from
	* @param attribute the Attr node to remove
	* @param name the attribute's name, for the fallback path
	*/
	const _stripAttributeNode = function _stripAttributeNode(element, attribute, name) {
		try {
			removeAttributeNode(element, attribute);
		} catch (_) {
			try {
				element.removeAttribute(name);
			} catch (_) {}
		}
	};
	/**
	* Fail-closed teardown of an in-place root: strip every disallowed attribute
	* in the subtree first, so nothing armed is left behind, then remove all
	* children and the root's own attributes.
	*
	* @param root the in-place root to empty
	*/
	const _neutralizeRoot = function _neutralizeRoot(root) {
		_neutralizeSubtree(root);
		const childNodes = getChildNodes(root);
		if (childNodes) arrayForEach(arraySlice(childNodes), (child) => {
			try {
				remove(child);
			} catch (_) {}
		});
		if (_readNodeType(root) === NODE_TYPE.element) _stripAttributes(root, false);
	};
	/**
	* Removes an attribute, preferably as its exact Attr node: name-based
	* removal lowercases the name in HTML documents and misses case-preserved
	* names, e.g. from imported XHTML.
	*
	* @param name an Attribute name
	* @param element a DOM node
	* @param attr the exact Attr node to remove, when the caller has it
	*/
	const _removeAttribute = function _removeAttribute(name, element, attr) {
		if (!attr) try {
			attr = element.getAttributeNode(name);
		} catch (_) {
			attr = null;
		}
		arrayPush(DOMPurify.removed, {
			attribute: attr || null,
			from: element
		});
		if (attr) _stripAttributeNode(element, attr, name);
		else try {
			element.removeAttribute(name);
		} catch (_) {}
		if (name === "is") {
			if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
				_forceRemove(element);
			} catch (_) {}
			else try {
				element.setAttribute(name, "");
			} catch (_) {}
		}
	};
	/**
	* Removes an element's attributes without book-keeping. Used to neutralize
	* nodes discarded from an in-place tree.
	*
	* @param element the element to strip
	* @param keepAllowed whether attributes on the allowlist stay
	*/
	const _stripAttributes = function _stripAttributes(element, keepAllowed) {
		const attributes = getAttributes(element);
		if (!attributes) return;
		for (let i = attributes.length - 1; i >= 0; --i) {
			const attribute = attributes[i];
			const name = attribute && attribute.name;
			if (typeof name === "string" && !(keepAllowed && ALLOWED_ATTR[transformCaseFunc(name)])) _stripAttributeNode(element, attribute, name);
		}
	};
	/**
	* Iterative depth-first walk, so deep trees cannot overflow the call stack,
	* reading through the cached getters, so clobbering cannot hide children.
	* When `visit` returns false, the node's children are skipped. With
	* `intoShadow`, open shadow roots are walked after their host's children.
	*
	* @param root where to start
	* @param visit called for every node
	* @param intoShadow whether to enter open shadow roots
	*/
	const _walkTree = function _walkTree(root, visit) {
		let intoShadow = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
		const stack = [root];
		while (stack.length > 0) {
			const node = stack.pop();
			if (visit(node) === false) continue;
			if (intoShadow && _readNodeType(node) === NODE_TYPE.element) {
				const shadowRoot = getShadowRoot(node);
				if (_isDocumentFragment(shadowRoot)) stack.push(shadowRoot);
			}
			const childNodes = getChildNodes(node);
			if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
		}
	};
	/**
	* Strips disallowed attributes from every element of a discarded subtree,
	* so a handler that is already queued (a loading image) cannot fire.
	*
	* @param root the root of a removed subtree
	*/
	const _neutralizeSubtree = function _neutralizeSubtree(root) {
		_walkTree(root, (node) => {
			if (_readNodeType(node) === NODE_TYPE.element) _stripAttributes(node, true);
		});
	};
	/**
	* All nodes under `root`, root first, including open shadow roots. Template
	* content is not entered, it is inert.
	*
	* @param root the in-place root
	* @return the nodes
	*/
	const _collectLiveNodes = function _collectLiveNodes(root) {
		const nodes = [];
		_walkTree(root, (node) => {
			nodes.push(node);
		}, true);
		return nodes;
	};
	/**
	* Strips disallowed attributes from every element that was under the
	* in-place root when the call started and no longer is, whatever removed
	* or moved it.
	*
	* @param root the in-place root
	* @param before the root's nodes, collected before the walk
	*/
	const _neutralizeEscapedElements = function _neutralizeEscapedElements(root, before) {
		const reachable = setCreate();
		arrayForEach(_collectLiveNodes(root), (node) => {
			if (_readNodeType(node) === NODE_TYPE.element) setAdd(reachable, node);
		});
		arrayForEach(before, (node) => {
			if (_readNodeType(node) === NODE_TYPE.element && !setHas(reachable, node)) _stripAttributes(node, true);
		});
	};
	/**
	* Neutralizes everything that left the in-place tree during the call: what
	* DOMPurify removed, and what hooks or custom elements removed or moved out.
	*
	* @param root the in-place root
	* @param before the root's nodes, collected before the walk
	* @return true if the root itself was removed
	*/
	const _neutralizeDiscarded = function _neutralizeDiscarded(root, before) {
		let rootRemoved = false;
		arrayForEach(DOMPurify.removed, (entry) => {
			if (entry.element) {
				rootRemoved = rootRemoved || entry.element === root;
				_neutralizeSubtree(entry.element);
			}
		});
		_neutralizeEscapedElements(root, before);
		return rootRemoved;
	};
	const MAX_UNVISITED_ROUNDS = 8;
	/**
	* The walk only moves forward, so a node moved to a position it already
	* passed is never visited. Give every original node that is still in the
	* tree but unvisited the normal treatment, hooks included. Nodes created
	* during the call are left alone. Fails closed if the tree keeps changing.
	*
	* @param root the in-place root
	* @param before the root's nodes, collected before the walk
	*/
	const _sanitizeUnvisitedNodes = function _sanitizeUnvisitedNodes(root, before) {
		const visited = IN_PLACE_VISITED;
		let original = null;
		const getOriginal = () => {
			if (!original) {
				original = setCreate();
				arrayForEach(before, (beforeNode) => {
					setAdd(original, beforeNode);
				});
			}
			return original;
		};
		for (let round = 0;; round++) {
			const live = _collectLiveNodes(root);
			const containers = [root];
			let pending = false;
			arrayForEach(live, (node) => {
				if (_readNodeType(node) === NODE_TYPE.documentFragment) arrayPush(containers, node);
				else if (!pending && !setHas(visited, node)) pending = setHas(getOriginal(), node);
			});
			if (!pending) return;
			if (round >= MAX_UNVISITED_ROUNDS) throw typeErrorCreate("the tree kept changing during in-place sanitization; refusing to return it");
			arrayForEach(containers, (container, index) => {
				_sanitizeUnvisitedIn(container, index > 0, root, getOriginal());
			});
		}
	};
	/**
	* One _sanitizeUnvisitedNodes pass over the root or an open shadow root.
	*
	* @param container the root or an open shadow root
	* @param inShadow whether container is a shadow root
	* @param root the in-place root
	* @param original the root's nodes collected before the walk, as a set
	*/
	const _sanitizeUnvisitedIn = function _sanitizeUnvisitedIn(container, inShadow, root, original) {
		const iterator = _createNodeIterator(container);
		let node;
		while (node = iterator.nextNode()) {
			if (!setHas(original, node) || setHas(IN_PLACE_VISITED, node)) continue;
			if (inShadow) _executeHooks(hooks.uponSanitizeShadowNode, node, null);
			_sanitizeNode(node, root);
		}
	};
	/**
	* Records that _sanitizeElements processed `node`. No-op outside IN_PLACE.
	*
	* @param node the node being processed
	*/
	const _markVisited = function _markVisited(node) {
		if (IN_PLACE_VISITED) setAdd(IN_PLACE_VISITED, node);
	};
	/**
	* Patch-linkage attributes (declarative partial updates): `patchsrc`
	* always, `for` everywhere except on <label> and <output>. Gated on
	* SAFE_FOR_XML. Shared by the IN_PLACE pre-pass and _isValidAttribute.
	*
	* @param lcName the transformCaseFunc'd attribute name
	* @param lcTag the transformCaseFunc'd tag name of the carrying element
	* @return true if the attribute is patch linkage and must be dropped
	*/
	const _isPatchLinkageAttribute = function _isPatchLinkageAttribute(lcName, lcTag) {
		if (!SAFE_FOR_XML) return false;
		if (lcName === "patchsrc") return true;
		return lcName === "for" && lcTag !== "label" && lcTag !== "output";
	};
	/**
	* IN_PLACE pre-pass: sever all patch linkage before the walk, so no patch
	* can fire mid-walk into a part of the tree the walker already passed.
	* Removes range markers (processing instructions, comments with markup)
	* and strips linkage attributes. It cannot undo a patch that already fired.
	*
	* TODO: if the shipped feature can patch through `for` on <label>/<output>,
	* drop that pair here too.
	*
	* @param root the in-place root to sweep
	*/
	const _neutralizePatchLinkage = function _neutralizePatchLinkage(root) {
		if (!SAFE_FOR_XML) return;
		_walkTree(root, (node) => {
			const nodeType = _readNodeType(node);
			if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
				try {
					remove(node);
				} catch (_) {}
				return false;
			}
			if (nodeType === NODE_TYPE.element) {
				const element = node;
				const lcTag = transformCaseFunc(_readNodeName(node));
				try {
					if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
					if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
				} catch (_) {}
			}
			return true;
		});
	};
	/**
	* _initDocument
	*
	* @param dirty - a string of dirty markup
	* @return a DOM, filled with the dirty markup
	*/
	const _initDocument = function _initDocument(dirty) {
		let doc = null;
		let leadingWhitespace = null;
		if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
		else {
			const matches = stringMatch(dirty, LEADING_WHITESPACE);
			leadingWhitespace = matches && matches[0];
		}
		if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head></head><body>" + dirty + "</body></html>";
		const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
		if (NAMESPACE === HTML_NAMESPACE) try {
			doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
		} catch (_) {}
		if (!doc || !doc.documentElement) {
			doc = implementation.createDocument(NAMESPACE, "template", null);
			try {
				doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
			} catch (_) {}
		}
		const body = doc.body || doc.documentElement;
		if (dirty && leadingWhitespace) body.insertBefore(document.createTextNode(leadingWhitespace), body.childNodes[0] || null);
		if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
		return WHOLE_DOCUMENT ? doc.documentElement : body;
	};
	/**
	* Creates a NodeIterator over `root`. ownerDocument is read through the
	* cached getter: a form child named "ownerDocument" shadows the direct
	* read and would make createNodeIterator throw.
	*
	* @param root The node to start traversing on.
	* @param characterDataOnly whether to skip elements
	* @return The created NodeIterator
	*/
	const _createNodeIterator = function _createNodeIterator(root) {
		let characterDataOnly = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
		const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
		return createNodeIterator.call(doc || root, root, (characterDataOnly ? 0 : NodeFilter.SHOW_ELEMENT) | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
	};
	/**
	* Replace template expression syntax (mustache, ERB, template
	* literal) with a space; shared by all SAFE_FOR_TEMPLATES scrub
	* sites. Order matters: mustache, then ERB, then template literal.
	*
	* @param value the string to scrub
	* @returns the scrubbed string
	*/
	const _stripTemplateExpressions = function _stripTemplateExpressions(value) {
		value = stringReplace(value, MUSTACHE_EXPR$1, " ");
		value = stringReplace(value, ERB_EXPR$1, " ");
		value = stringReplace(value, TMPLIT_EXPR$1, " ");
		return value;
	};
	/**
	* Strips template expressions from the character data under `node`,
	* template contents included. Runs after the walk, since an expression can
	* also form when a removed element leaves two text nodes adjacent. Works on
	* the nodes rather than on markup, which keeps node references intact and
	* sees `<%` unescaped. Attribute values are handled in _sanitizeAttributes.
	*
	* @param node The root element whose character data should be scrubbed.
	*/
	const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
		var _node$querySelectorAl;
		_scrubOwnCharacterData(node);
		const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
		if (templates) arrayForEach(templates, (tmpl) => {
			if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
		});
	};
	/**
	* Normalizes `node` and strips template expressions from its own character
	* data. Template contents and shadow roots are not entered, their own
	* _sanitizeShadowDOM call scrubs them.
	*
	* @param node The root whose own character data should be scrubbed.
	*/
	const _scrubOwnCharacterData = function _scrubOwnCharacterData(node) {
		node.normalize();
		const walker = _createNodeIterator(node, true);
		let currentNode = walker.nextNode();
		while (currentNode) {
			currentNode.data = _stripTemplateExpressions(currentNode.data);
			currentNode = walker.nextNode();
		}
	};
	/**
	* Detects DOM clobbering on a form, the only element whose named children
	* shadow its own properties. Each probe compares a direct read with what
	* the property has to be.
	*
	* @param element element to check for clobbering attacks
	* @return true if clobbered, false if safe
	*/
	const _isClobbered = function _isClobbered(element) {
		const realTagName = getNodeName ? getNodeName(element) : null;
		if (typeof realTagName !== "string") return false;
		if (transformCaseFunc(realTagName) !== "form") return false;
		return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.removeAttributeNode !== "function" || typeof element.getAttributeNode !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
	};
	/**
	* Reads nodeType through the cached getter, so the result holds for nodes
	* from any realm (GHSA-4w3q-35jp-p934) and cannot be clobbered.
	*
	* @param value anything
	* @return the node type, or null if value is not a DOM node
	*/
	const _nodeTypeOf = function _nodeTypeOf(value) {
		if (!getNodeType || typeof value !== "object" || value === null) return null;
		try {
			const nodeType = getNodeType(value);
			return typeof nodeType === "number" ? nodeType : null;
		} catch (_) {
			return null;
		}
	};
	const _isDocumentFragment = function _isDocumentFragment(value) {
		return _nodeTypeOf(value) === NODE_TYPE.documentFragment;
	};
	const _isNode = function _isNode(value) {
		return _nodeTypeOf(value) !== null;
	};
	function _executeHooks(hooks, currentNode, data) {
		if (hooks.length === 0) return;
		arrayForEach(hooks, (hook) => {
			hook.call(DOMPurify, currentNode, data, CONFIG);
		});
	}
	/**
	* Structural-threat checks that condemn a node regardless of the
	* allowlists: mXSS via namespace confusion, risky CSS construction,
	* processing instructions, markup-bearing comments. Pure predicate;
	* the caller removes. Check order is load-bearing.
	*
	* @param currentNode the node to inspect
	* @param tagName the node's transformCaseFunc'd tag name
	* @param nodeType the node's type, read through the cached getter
	* @return true if the node must be removed
	*/
	const _isUnsafeNode = function _isUnsafeNode(currentNode, tagName, nodeType) {
		if (SAFE_FOR_XML && nodeType === NODE_TYPE.element && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
		if (SAFE_FOR_XML && LITERAL_TEXT_ELEMENTS[tagName] && nodeType === NODE_TYPE.element && _readNamespaceURI(currentNode) === HTML_NAMESPACE && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent))) return true;
		if (nodeType === NODE_TYPE.processingInstruction) return true;
		if (SAFE_FOR_XML && nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
		return false;
	};
	/**
	* Evaluate a CUSTOM_ELEMENT_HANDLING check (a RegExp or a predicate
	* function, per the validation in _parseConfig) against a name.
	* Additional arguments are forwarded to predicate functions - the
	* attributeNameCheck predicate receives the tag name as its second
	* argument. A null/absent check never matches.
	*
	* @param check the configured tagNameCheck / attributeNameCheck value
	* @param name the name to test
	* @param args extra arguments forwarded to a predicate function
	* @return true if the check matches the name
	*/
	const _matchesNameCheck = function _matchesNameCheck(check, name) {
		if (check instanceof RegExp) return regExpTest(check, name);
		if (check instanceof Function) {
			for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
			return Boolean(check(name, ...args));
		}
		return false;
	};
	/**
	* Handles a node whose tag is forbidden or not allowlisted: hoists its
	* content per KEEP_CONTENT and removes it. The one exception is a custom
	* element allowed via CUSTOM_ELEMENT_HANDLING, which is kept.
	*
	* @param currentNode the disallowed node
	* @param tagName the node's transformCaseFunc'd tag name
	* @return true if the node was removed, false if kept
	*/
	const _sanitizeDisallowedNode = function _sanitizeDisallowedNode(currentNode, tagName, root) {
		if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
		if (KEEP_CONTENT && !FORBID_CONTENTS[tagName] && !FORBID_CONTENTS[stringToLowerCase(tagName)]) {
			const parentNode = getParentNode(currentNode);
			const childNodes = getChildNodes(currentNode);
			if (childNodes && parentNode) {
				const childCount = childNodes.length;
				for (let i = childCount - 1; i >= 0; --i) {
					const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
					parentNode.insertBefore(hoisted, getNextSibling(currentNode));
				}
			}
		}
		_forceRemove(currentNode);
		return true;
	};
	/**
	* Forks an allowlist off its shared binding (the instance default or the
	* setConfig() capture) before a hook sees it, so a hook's widening stays
	* within the call. A set that is already call-local is returned as is.
	*
	* @param hookList the uponSanitize* hook array for this event
	* @param set the current ALLOWED_TAGS / ALLOWED_ATTR binding
	* @param defaultSet the per-instance DEFAULT_ALLOWED_* constant
	* @param setConfigSet the captured setConfig() binding, or null
	* @return a call-local clone if a hook is present and set is still shared,
	*   else set unchanged
	*/
	const _forkSharedAllowlist = function _forkSharedAllowlist(hookList, set, defaultSet, setConfigSet) {
		if (hookList.length === 0) return set;
		return set === defaultSet || set === setConfigSet ? cloneSet(set) : set;
	};
	/**
	* A hook may have detached the node it was called for. If so, treat it as
	* removed and stop processing it; the walk root is exempt. On the IN_PLACE
	* path the detached subtree is neutralized right away.
	*
	* @param currentNode the node a hook may have detached
	* @param root the current walk root
	* @return true if the node was detached
	*/
	const _handleHookDetachedNode = function _handleHookDetachedNode(currentNode, root) {
		if (currentNode === root || getParentNode(currentNode) !== null) return false;
		if (IN_PLACE) _neutralizeSubtree(currentNode);
		return true;
	};
	/**
	* _sanitizeElements
	*
	* @protect nodeName
	* @protect textContent
	* @protect removeChild
	* @param currentNode to check for permission to exist
	* @return true if node was killed, false if left alive
	*/
	const _sanitizeElements = function _sanitizeElements(currentNode, root) {
		_markVisited(currentNode);
		_executeHooks(hooks.beforeSanitizeElements, currentNode, null);
		if (_handleHookDetachedNode(currentNode, root)) return true;
		if (_isClobbered(currentNode)) {
			_forceRemove(currentNode);
			return true;
		}
		const tagName = transformCaseFunc(_readNodeName(currentNode));
		const nodeType = _readNodeType(currentNode);
		ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
		_executeHooks(hooks.uponSanitizeElement, currentNode, {
			tagName,
			allowedTags: ALLOWED_TAGS
		});
		if (_handleHookDetachedNode(currentNode, root)) return true;
		if (_isUnsafeNode(currentNode, tagName, nodeType)) {
			_forceRemove(currentNode);
			return true;
		}
		if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
			const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
			if (removed === false) {
				_executeHooks(hooks.afterSanitizeElements, currentNode, null);
				if (_handleHookDetachedNode(currentNode, root)) return true;
			}
			return removed;
		}
		if (nodeType === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
			_forceRemove(currentNode);
			return true;
		}
		if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
			_forceRemove(currentNode);
			return true;
		}
		if (SAFE_FOR_TEMPLATES && nodeType === NODE_TYPE.text) {
			const text = currentNode.textContent;
			const content = _stripTemplateExpressions(text);
			if (text !== content) {
				arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
				currentNode.textContent = content;
			}
		}
		_executeHooks(hooks.afterSanitizeElements, currentNode, null);
		return _handleHookDetachedNode(currentNode, root);
	};
	/**
	* _isValidAttribute
	*
	* @param lcTag Lowercase tag name of containing element.
	* @param lcName Lowercase attribute name.
	* @param value Attribute value.
	* @return Returns true if `value` is valid, otherwise false.
	*/
	const _isValidAttribute = function _isValidAttribute(lcTag, lcName, value) {
		if (FORBID_ATTR[lcName]) return false;
		if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
		if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document || value in formElement)) return false;
		const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
		if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
		if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
		if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
		if (URI_SAFE_ATTRIBUTES[lcName]) return true;
		const compactValue = stringReplace(value, ATTR_WHITESPACE$1, "");
		if (regExpTest(IS_ALLOWED_URI$1, compactValue)) return true;
		if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
		if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, compactValue)) return true;
		return !value;
	};
	const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
		"annotation-xml",
		"color-profile",
		"font-face",
		"font-face-format",
		"font-face-name",
		"font-face-src",
		"font-face-uri",
		"missing-glyph"
	]);
	/**
	* _isBasicCustomElement
	* checks if at least one dash is included in tagName, and it's not the first char
	* for more sophisticated checking see https://github.com/sindresorhus/validate-element-name
	*
	* @param tagName name of the tag of the node to sanitize
	* @returns Returns true if the tag name meets the basic criteria for a custom element, otherwise false.
	*/
	const _isBasicCustomElement = function _isBasicCustomElement(tagName) {
		return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
	};
	/**
	* Wrap an attribute value in the matching Trusted Types object when
	* the active policy requires it. Namespaced attributes pass through
	* unchanged (no TT support yet, see
	* https://bugs.chromium.org/p/chromium/issues/detail?id=1305293).
	*
	* @param lcTag lowercase tag name of the containing element
	* @param lcName lowercase attribute name
	* @param namespaceURI the attribute's namespace, if any
	* @param value the attribute value to wrap
	* @return the value, wrapped when Trusted Types demand it
	*/
	const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value) {
		if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
			case "TrustedHTML": return _createTrustedHTML(value);
			case "TrustedScriptURL": return _createTrustedScriptURL(value);
		}
		return value;
	};
	/**
	* Writes a changed attribute value back. If the new value clobbers, the
	* element is removed; if the write fails, the attribute is.
	*
	* @param currentNode the element carrying the attribute
	* @param name the attribute name as present on the element
	* @param namespaceURI the attribute's namespace, if any
	* @param value the new attribute value
	* @return true if the value was written without introducing clobbering
	*/
	const _setAttributeValue = function _setAttributeValue(currentNode, name, namespaceURI, value) {
		try {
			if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
			else currentNode.setAttribute(name, value);
			if (_isClobbered(currentNode)) {
				_forceRemove(currentNode);
				return false;
			}
			return true;
		} catch (_) {
			_removeAttribute(name, currentNode);
			return false;
		}
	};
	/**
	* Value checks that apply before a hook can force-keep an attribute. Also
	* used by isValidAttribute(), so it never approves a value that sanitize()
	* would strip.
	*
	* @param name the attribute name as found on the node (case preserved)
	* @param value the attribute value
	* @returns true if the attribute must be removed because of its value
	*/
	const _isUnsafeAttributeValue = function _isUnsafeAttributeValue(name, value) {
		if (SAFE_FOR_XML && regExpTest(ATTR_VALUE_BREAKOUT, value)) return true;
		return stringToLowerCase(name) === "attributename" && stringIndexOf(value, "href") !== -1;
	};
	/**
	* _sanitizeAttributes
	*
	* @protect attributes
	* @protect nodeName
	* @protect removeAttribute
	* @protect setAttribute
	*
	* @param currentNode to sanitize
	* @param root the current walk root
	*/
	const _sanitizeAttributes = function _sanitizeAttributes(currentNode, root) {
		_executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
		if (_handleHookDetachedNode(currentNode, root)) return;
		const attributes = currentNode.attributes;
		if (!attributes || _isClobbered(currentNode)) return;
		ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
		const hookEvent = {
			attrName: "",
			attrValue: "",
			keepAttr: true,
			allowedAttributes: ALLOWED_ATTR,
			forceKeepAttr: void 0
		};
		let l = attributes.length;
		const lcTag = transformCaseFunc(_readNodeName(currentNode));
		while (l--) {
			const attr = attributes[l];
			const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
			const lcName = transformCaseFunc(name);
			const initValue = attrValue;
			let value = name === "value" ? initValue : stringTrim(initValue);
			let recreatedNamedProp = false;
			hookEvent.attrName = lcName;
			hookEvent.attrValue = value;
			hookEvent.keepAttr = true;
			hookEvent.forceKeepAttr = void 0;
			_executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
			value = hookEvent.attrValue;
			if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
				_removeAttribute(name, currentNode, attr);
				value = SANITIZE_NAMED_PROPS_PREFIX + value;
				recreatedNamedProp = true;
			}
			if (_isUnsafeAttributeValue(name, value)) {
				_removeAttribute(name, currentNode, attr);
				continue;
			}
			if (hookEvent.forceKeepAttr) continue;
			if (!hookEvent.keepAttr) {
				_removeAttribute(name, currentNode, attr);
				continue;
			}
			if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
				_removeAttribute(name, currentNode, attr);
				continue;
			}
			if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
			if (!_isValidAttribute(lcTag, lcName, value)) {
				_removeAttribute(name, currentNode, attr);
				continue;
			}
			value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
			if (value !== initValue) {
				if (_setAttributeValue(currentNode, name, namespaceURI, value) && recreatedNamedProp) arrayPop(DOMPurify.removed);
			}
		}
		_executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
		_handleHookDetachedNode(currentNode, root);
	};
	/**
	* Sanitizes one node: the node itself, its attributes and, for a
	* template, its content.
	*
	* @param node the node to sanitize
	* @param root the current walk root
	*/
	const _sanitizeNode = function _sanitizeNode(node, root) {
		_sanitizeElements(node, root);
		_sanitizeAttributes(node, root);
		if (_isDocumentFragment(node.content)) _sanitizeShadowDOM2(node.content);
	};
	/**
	* _sanitizeShadowDOM
	*
	* @param fragment to iterate over recursively
	*/
	const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
		let shadowNode = null;
		const shadowIterator = _createNodeIterator(fragment);
		_executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
		while (shadowNode = shadowIterator.nextNode()) {
			_executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
			_sanitizeNode(shadowNode, fragment);
			if (_readNodeType(shadowNode) === NODE_TYPE.element) {
				const innerSr = getShadowRoot(shadowNode);
				if (_isDocumentFragment(innerSr)) {
					_sanitizeAttachedShadowRoots(innerSr);
					_sanitizeShadowDOM2(innerSr);
				}
			}
		}
		if (SAFE_FOR_TEMPLATES) _scrubOwnCharacterData(fragment);
		_executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
	};
	/**
	* Sanitizes every attached shadow root under `root`, since the node
	* iterator does not enter shadow trees. Needed for IN_PLACE input and for
	* DOM input whose clonable shadow roots were copied by importNode().
	*
	* @param root the subtree root to walk for attached shadow roots
	*/
	const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots(root) {
		const stack = [{
			node: root,
			shadow: null
		}];
		while (stack.length > 0) {
			const item = stack.pop();
			if (item.shadow) {
				_sanitizeShadowDOM2(item.shadow);
				continue;
			}
			const node = item.node;
			const isElement = _readNodeType(node) === NODE_TYPE.element;
			const childNodes = getChildNodes(node);
			if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push({
				node: childNodes[i],
				shadow: null
			});
			if (isElement) {
				const rootName = getNodeName ? getNodeName(node) : null;
				if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
					const content = node.content;
					if (_isDocumentFragment(content)) stack.push({
						node: content,
						shadow: null
					});
				}
			}
			if (isElement) {
				const sr = getShadowRoot(node);
				if (_isDocumentFragment(sr)) stack.push({
					node: null,
					shadow: sr
				}, {
					node: sr,
					shadow: null
				});
			}
		}
	};
	DOMPurify.sanitize = function(dirty) {
		let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		let body = null;
		let importedNode = null;
		let currentNode = null;
		let returnNode = null;
		IS_EMPTY_INPUT = !dirty;
		if (IS_EMPTY_INPUT) dirty = "<!-->";
		if (typeof dirty !== "string" && !_isNode(dirty)) {
			dirty = stringifyValue(dirty);
			if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
		}
		if (!DOMPurify.isSupported) return dirty;
		if (SET_CONFIG) {
			ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
			ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
		} else _parseConfig(cfg);
		DOMPurify.removed = [];
		const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
		let inPlaceNodes = [];
		const outerVisited = IN_PLACE_VISITED;
		if (inPlace) {
			_neutralizePatchLinkage(dirty);
			const nn = _readNodeName(dirty);
			if (typeof nn === "string") {
				const tagName = transformCaseFunc(nn);
				if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
					_neutralizeRoot(dirty);
					throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
				}
			}
			if (_isClobbered(dirty)) {
				_neutralizeRoot(dirty);
				throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
			}
			inPlaceNodes = _collectLiveNodes(dirty);
			IN_PLACE_VISITED = setCreate();
		} else if (_isNode(dirty)) {
			body = _initDocument("<!---->");
			importedNode = body.ownerDocument.importNode(dirty, true);
			if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
			else if (importedNode.nodeName === "HTML") body = importedNode;
			else body.appendChild(importedNode);
			_sanitizeAttachedShadowRoots(body);
		} else {
			if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return _signOutput(dirty);
			body = _initDocument(dirty);
			if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
		}
		if (body && FORCE_BODY) _forceRemove(body.firstChild);
		const walkRoot = inPlace ? dirty : body;
		try {
			if (inPlace) _sanitizeAttachedShadowRoots(dirty);
			const nodeIterator = _createNodeIterator(walkRoot);
			while (currentNode = nodeIterator.nextNode()) _sanitizeNode(currentNode, walkRoot);
			if (inPlace) _sanitizeUnvisitedNodes(dirty, inPlaceNodes);
		} catch (error) {
			if (inPlace) {
				_neutralizeRoot(dirty);
				_neutralizeDiscarded(dirty, inPlaceNodes);
			}
			throw error;
		} finally {
			IN_PLACE_VISITED = outerVisited;
		}
		if (inPlace) {
			if (_neutralizeDiscarded(dirty, inPlaceNodes)) throw typeErrorCreate("a node selected for removal could not be safely returned; refusing to sanitize in place");
			if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
			return dirty;
		}
		if (RETURN_DOM) {
			if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
			if (RETURN_DOM_FRAGMENT) {
				returnNode = createDocumentFragment.call(body.ownerDocument);
				while (body.firstChild) returnNode.appendChild(body.firstChild);
			} else returnNode = body;
			if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
			return returnNode;
		}
		const serialize = () => WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
		let serializedHTML = serialize();
		if (SAFE_FOR_TEMPLATES && regExpTest(TMPL_MARKER_SERIALIZED, serializedHTML)) {
			_scrubOwnCharacterData(body);
			serializedHTML = serialize();
		}
		if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
		return _signOutput(serializedHTML);
	};
	DOMPurify.setConfig = function() {
		let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
		_parseConfig(cfg);
		SET_CONFIG = true;
		SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
		SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
	};
	DOMPurify.clearConfig = function() {
		CONFIG = null;
		SET_CONFIG = false;
		SET_CONFIG_ALLOWED_TAGS = null;
		SET_CONFIG_ALLOWED_ATTR = null;
		trustedTypesPolicy = defaultTrustedTypesPolicy;
		emptyHTML = "";
	};
	DOMPurify.isValidAttribute = function(tag, attr, value) {
		if (!CONFIG) _parseConfig({});
		const lcTag = transformCaseFunc(tag);
		const lcName = transformCaseFunc(attr);
		if (typeof value === "string" && (_isUnsafeAttributeValue(attr, value) || !ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value))) return false;
		return _isValidAttribute(lcTag, lcName, value);
	};
	DOMPurify.addHook = function(entryPoint, hookFunction) {
		if (typeof hookFunction !== "function") return;
		if (!objectHasOwnProperty(hooks, entryPoint)) return;
		arrayPush(hooks[entryPoint], hookFunction);
	};
	DOMPurify.removeHook = function(entryPoint, hookFunction) {
		if (!objectHasOwnProperty(hooks, entryPoint)) return;
		if (hookFunction !== void 0) {
			const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
			return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
		}
		return arrayPop(hooks[entryPoint]);
	};
	DOMPurify.removeHooks = function(entryPoint) {
		if (!objectHasOwnProperty(hooks, entryPoint)) return;
		hooks[entryPoint] = [];
	};
	DOMPurify.removeAllHooks = function() {
		hooks = _createHooksMap();
	};
	return DOMPurify;
}
var purify_default = createDOMPurify();
// src/dom.ts
var toastTimer;
function showToast(msg, duration = 3e3) {
	if (!dom.toast) return;
	dom.toast.textContent = msg;
	dom.toast.hidden = false;
	if (toastTimer !== void 0) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		dom.toast.hidden = true;
	}, duration);
}
var purifyHookInstalled = false;
function ensurePurifyHook() {
	if (purifyHookInstalled || typeof purify_default === "undefined" || !purify_default.addHook) return;
	purifyHookInstalled = true;
	purify_default.addHook("afterSanitizeAttributes", (node) => {
		if (node instanceof Element && node.tagName === "A") {
			const href = node.getAttribute("href") || "";
			if (href && !href.startsWith("#") && !safeHttpUrl(href)) node.removeAttribute("href");
			else if (/^https?:/i.test(href)) {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noopener noreferrer");
			}
		}
	});
}
function renderMarkdown(md) {
	if (typeof x !== "undefined" && typeof purify_default !== "undefined") {
		ensurePurifyHook();
		return purify_default.sanitize(x.parse(md, { async: false }));
	}
	return escapeHtml(md);
}
function sanitizeHtml(rawHtml) {
	if (typeof purify_default !== "undefined") {
		ensurePurifyHook();
		return purify_default.sanitize(rawHtml || "", { FORBID_TAGS: [
			"script",
			"style",
			"iframe",
			"object",
			"embed",
			"form"
		] });
	}
	return escapeHtml(rawHtml || "");
}
var HTML_ESCAPES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
var INLINE_MARKUP_RE = /<\/?(?:span|em|strong|i|b|sup|sub|small|u)\b[^>]*>/gi;
function cleanInlineLabel(str) {
	return String(str ?? "").replace(INLINE_MARKUP_RE, "").replace(/\s+/g, " ").trim();
}
function escapeHtml(str) {
	return String(str ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] || ch);
}
function plural(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function lsGet(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function lsSet(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch {}
}
function lsGetJSON(key, fallback = null) {
	try {
		const v = lsGet(key);
		return v ? JSON.parse(v) : fallback;
	} catch {
		return fallback;
	}
}
function lsSetJSON(key, value) {
	lsSet(key, JSON.stringify(value));
}
function safeHttpUrl(u) {
	if (!u || typeof u !== "string") return "";
	try {
		const base = typeof window !== "undefined" ? window.location.href : "https://example.invalid/";
		const p = new URL(u, base).protocol;
		return p === "http:" || p === "https:" ? u : "";
	} catch {
		return "";
	}
}
async function copyText(text, okMsg = "Copied", errMsg = "Couldn’t copy") {
	try {
		await navigator.clipboard.writeText(text);
		if (okMsg) showToast(okMsg);
		return true;
	} catch {
		if (errMsg) showToast(errMsg);
		return false;
	}
}
function tocTitle(node) {
	const l = cleanInlineLabel(node.l || "");
	const d = cleanInlineLabel(node.d || "");
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
function extractDocExcerpt(html, { maxChars = 240, maxParas = 3 } = {}) {
	const doc = new DOMParser().parseFromString(html || "", "text/html");
	const raw = [...doc.body.querySelectorAll(".reg-p, .reg-callout")].slice(0, maxParas).map((p) => p.textContent || "").join(" ").replace(/\s+/g, " ").trim();
	return {
		doc,
		excerpt: raw.length > maxChars ? raw.slice(0, maxChars - 1).trimEnd() + "…" : raw,
		refCount: doc.body.querySelectorAll("a.xref, a.xref-cross, a.xref-external, a.xref-usc").length,
		docLen: (doc.body.textContent || "").replace(/\s+/g, " ").trim().length
	};
}
function setModalBackgroundInert(on) {
	const val = Boolean(on);
	if (dom.layout) dom.layout.inert = val;
	if (dom.topbar) dom.topbar.inert = val;
}
function trapFocusKeydown(container, e) {
	if (e.key !== "Tab" || !container) return;
	const focusable = [...container.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex=\"-1\"])")].filter((el) => el.offsetParent !== null || el === document.activeElement);
	if (!focusable.length) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}
var ICON_PATHS = {
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
	download: "<path d=\"M2.5 10.5v2A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-2\"/><path d=\"M8 2.5v8M5 7.5 8 10.5 11 7.5\"/>",
	check: "<path d=\"m3.75 8.25 2.75 2.75 5.75-6\"/>",
	list: "<circle cx=\"3\" cy=\"4\" r=\".6\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"3\" cy=\"8\" r=\".6\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"3\" cy=\"12\" r=\".6\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M6 4h7.5M6 8h7.5M6 12h7.5\"/>",
	book: "<path d=\"M2.5 12.5A1.5 1.5 0 0 1 4 11h9.5\"/><path d=\"M4 2.5h9.5v11H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 2.5Z\"/><path d=\"M6 5.5h4.5M6 8h3\"/>",
	file: "<path d=\"M9 2.5H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5L9 2.5Z\"/><path d=\"M9 2.5V6.5H13\"/>",
	news: "<path d=\"M2.5 4.5H11V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12Z\"/><path d=\"M11 6.5h1.5a1 1 0 0 1 1 1V12a1.5 1.5 0 0 1-1.5 1.5\"/><path d=\"M4.5 7h4.5M4.5 9.25h4.5M4.5 11.5h3\"/>",
	help: "<circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M6.25 6.25a1.85 1.85 0 0 1 3.55.75c0 1.25-1.8 1.5-1.8 2.75\"/><circle cx=\"8\" cy=\"11.85\" r=\".55\" fill=\"currentColor\" stroke=\"none\"/>",
	key: "<circle cx=\"5.5\" cy=\"8\" r=\"2.75\"/><path d=\"M8.25 8H14M11.75 8v2.25M13.5 8v1.5\"/>",
	rss: "<circle cx=\"4\" cy=\"12\" r=\"1.15\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M3.25 7.75A5 5 0 0 1 8.25 12.75M3.25 4A8.75 8.75 0 0 1 12 12.75\"/>",
	copy: "<rect x=\"5.5\" y=\"5.5\" width=\"7.5\" height=\"7.5\" rx=\"1.5\"/><path d=\"M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5\"/>",
	close: "<path d=\"m4 4 8 8M12 4l-8 8\"/>",
	eye: "<path d=\"M1.75 8S4 4.25 8 4.25 14.25 8 14.25 8 12 11.75 8 11.75 1.75 8 1.75 8Z\"/><circle cx=\"8\" cy=\"8\" r=\"1.75\"/>",
	eyeOff: "<path d=\"M2.5 2.5 13.5 13.5M6.4 4.45A6.6 6.6 0 0 1 8 4.25C12 4.25 14.25 8 14.25 8a10.4 10.4 0 0 1-2.2 2.55M4.1 5.65A10.6 10.6 0 0 0 1.75 8s2.25 3.75 6.25 3.75c.9 0 1.75-.18 2.5-.48\"/>",
	search: "<circle cx=\"7\" cy=\"7\" r=\"4.25\"/><path d=\"m10.2 10.2 3.3 3.3\"/>",
	arrowRight: "<path d=\"M3.25 8h9.5M9 4.25 12.75 8 9 11.75\"/>",
	home: "<path d=\"M2.5 7 8 2.75 13.5 7v5.25a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z\"/><path d=\"M6.5 13.25V9.5h3v3.75\"/>",
	refresh: "<path d=\"M13 8a5 5 0 1 1-1.35-3.42\"/><path d=\"M13 2.75v2.75h-2.75\"/>",
	layers: "<path d=\"M8 2.5 2.5 5.5 8 8.5 13.5 5.5 8 2.5Z\"/><path d=\"m2.5 8.5 5.5 3 5.5-3\"/><path d=\"m2.5 11.25 5.5 3 5.5-3\"/>",
	grid: "<rect x=\"2.5\" y=\"2.5\" width=\"4.5\" height=\"4.5\" rx=\"1.25\"/><rect x=\"9\" y=\"2.5\" width=\"4.5\" height=\"4.5\" rx=\"1.25\"/><rect x=\"2.5\" y=\"9\" width=\"4.5\" height=\"4.5\" rx=\"1.25\"/><rect x=\"9\" y=\"9\" width=\"4.5\" height=\"4.5\" rx=\"1.25\"/>"
};
function icon(name, extraClass = "") {
	return `<svg class="icon${extraClass ? " " + extraClass : ""}" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}
function skeletonHtml(kind = "doc", label = "Loading…") {
	const line = (w, cls = "") => `<span class="skel skel-line${cls ? " " + cls : ""}" style="width:${w}"></span>`;
	let body = "";
	if (kind === "tree") body = `<div class="skel-stack">${line("82%")}${line("64%")}${line("72%")}${line("58%")}</div>`;
	else if (kind === "list") body = `<div class="skel-stack" style="gap:16px">${[
		78,
		66,
		84,
		70
	].map((w) => `<div class="skel-stack" style="gap:8px">${line("26%", "is-sm")}${line(w + "%", "is-lg")}${line("90%")}</div>`).join("")}</div>`;
	else if (kind === "cards") body = `<div class="skel-stack" style="gap:18px">${line("18%", "is-sm")}${line("36%", "is-xl")}<div class="skel-grid-2">${[
		1,
		2,
		3,
		4
	].map(() => `<div class="skel-card">${line("34%", "is-sm")}${line("74%", "is-lg")}${line("92%")}${line("64%")}</div>`).join("")}</div></div>`;
	else if (kind === "lines") {
		body = `<div class="skel-stack" style="gap:8px;margin-top:8px" aria-hidden="true">${line("86%", "is-sm")}${line("74%", "is-sm")}${line("68%", "is-sm")}</div>`;
		return body;
	} else if (kind === "summary") {
		body = `<div class="skel-stack" style="margin-top:8px;gap:6px" aria-hidden="true">${line("92%", "is-sm")}${line("68%", "is-sm")}</div>`;
		return body;
	} else if (kind === "pulse") {
		body = `<div class="skel-stack" style="gap:8px" aria-hidden="true">${line("46%", "is-sm")}${line("92%")}${line("74%")}</div>`;
		return body;
	} else body = `<div class="skel-stack" style="gap:16px">${line("24%", "is-sm")}${line("62%", "is-xl")}<div class="skel-stack" style="gap:10px;margin-top:8px">${line("94%")}${line("88%")}${line("91%")}${line("76%")}${line("84%")}</div></div>`;
	return `<div class="loading is-skel" role="status" aria-busy="true" aria-label="${escapeHtml(label)}">${body}</div>`;
}
var MOTION_KEY = "motionLevel";
var reduceMotion = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
function getMotionLevel() {
	const stored = lsGet(MOTION_KEY);
	if (stored === "none" || stored === "less" || stored === "full") return stored;
	return reduceMotion.matches ? "none" : "full";
}
function applyMotionLevel(level) {
	const next = level === "none" || level === "less" || level === "full" ? level : getMotionLevel();
	lsSet(MOTION_KEY, next);
	if (typeof document !== "undefined") document.documentElement.dataset.motion = next;
	state.motionLevel = next;
	return next;
}
if (typeof document !== "undefined" && !document.documentElement.dataset.motion) document.documentElement.dataset.motion = getMotionLevel();
state.motionLevel = getMotionLevel();
var calmAnims = /* @__PURE__ */ new WeakMap();
var scrollRafs = /* @__PURE__ */ new WeakMap();
function animateCalm(el, { fromY = 16, fromX = 0, fromScale = .99, duration = 640, delay = 0 } = {}) {
	const level = getMotionLevel();
	if (level === "none" || !el || !el.animate) return;
	try {
		calmAnims.get(el)?.cancel();
	} catch {}
	const keyframes = level === "less" ? [{ opacity: 0 }, { opacity: 1 }] : [{
		opacity: 0,
		transform: `translate3d(${fromX}px, ${fromY}px, 0) scale(${fromScale})`
	}, {
		opacity: 1,
		transform: "none"
	}];
	calmAnims.set(el, el.animate(keyframes, {
		duration: level === "less" ? Math.min(180, Math.round(duration * .3)) : duration,
		delay: level === "less" ? 0 : delay,
		easing: level === "less" ? "ease-out" : "cubic-bezier(0.32, 0.72, 0, 1)",
		fill: delay > 0 ? "backwards" : "none"
	}));
}
function enterView({ subtle = false, fromX = 0 } = {}) {
	if (dom.main) dom.main.scrollTop = 0;
	const level = getMotionLevel();
	if (level === "none" || !dom.view) return;
	if (subtle && !fromX) {
		const targets = dom.view.querySelectorAll(".unit-context, .reg-body, .reg-footnotes");
		if (targets.length) {
			for (const t of targets) animateCalm(t, {
				fromY: 14,
				fromScale: 1,
				duration: 540
			});
			return;
		}
	}
	if (level === "full" && !fromX) {
		const head = dom.view.querySelector(".doc-kicker, .help-head, .home-head, .lib-head");
		const body = dom.view.querySelector(".reg-body, .part-toc-tools, .toc-group, .full-section, .settings-grid, .lib-stories");
		if (head && body) {
			animateCalm(dom.view, {
				fromY: 14,
				fromScale: .992,
				duration: 640
			});
			animateCalm(body, {
				fromY: 18,
				fromScale: 1,
				duration: 740,
				delay: 90
			});
			return;
		}
	}
	animateCalm(dom.view, {
		fromY: fromX ? 0 : 16,
		fromX,
		fromScale: .99,
		duration: 720
	});
}
function smoothScrollToTarget(el, { block = "center", duration = 820 } = {}) {
	if (!el) return;
	if (getMotionLevel() !== "full") {
		el.scrollIntoView({
			behavior: "auto",
			block
		});
		return;
	}
	const scroller = el.closest(".main, .split-pane");
	if (!scroller) {
		el.scrollIntoView({
			behavior: "smooth",
			block
		});
		return;
	}
	try {
		const prevRaf = scrollRafs.get(scroller);
		if (prevRaf) cancelAnimationFrame(prevRaf);
	} catch {}
	const sRect = scroller.getBoundingClientRect();
	const eRect = el.getBoundingClientRect();
	const offsetTop = eRect.top - sRect.top + scroller.scrollTop;
	const target = block === "center" ? offsetTop - Math.max(80, (scroller.clientHeight - eRect.height) / 2) : offsetTop - 76;
	const clamped = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
	const start = scroller.scrollTop;
	const dist = clamped - start;
	if (Math.abs(dist) < 2) {
		scroller.scrollTop = clamped;
		return;
	}
	const t0 = performance.now();
	let canceled = false;
	const cancel = () => {
		canceled = true;
		scroller.removeEventListener("wheel", cancel);
		scroller.removeEventListener("touchstart", cancel);
	};
	scroller.addEventListener("wheel", cancel, {
		passive: true,
		once: true
	});
	scroller.addEventListener("touchstart", cancel, {
		passive: true,
		once: true
	});
	const step = (now) => {
		if (canceled) return;
		const p = Math.min(1, (now - t0) / duration);
		const eased = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
		scroller.scrollTop = start + dist * eased;
		if (p < 1) scrollRafs.set(scroller, requestAnimationFrame(step));
		else {
			scrollRafs.set(scroller, 0);
			scroller.removeEventListener("wheel", cancel);
			scroller.removeEventListener("touchstart", cancel);
		}
	};
	scrollRafs.set(scroller, requestAnimationFrame(step));
}
var isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
// src/api/client.ts
var MAX_PEEK_CACHE = 40;
var MAX_GRAPH_CACHE = 80;
var MAX_REFS_CACHE = 24;
var MAX_TREE_CACHE = 16;
var titleTreeCache = /* @__PURE__ */ new Map();
function setBoundedCache(cache, key, val, max) {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, val);
	while (cache.size > max) {
		const oldest = cache.keys().next().value;
		if (oldest === void 0) break;
		cache.delete(oldest);
	}
	return val;
}
function cachePeekSection(key, data) {
	return setBoundedCache(state.peekCache, key, data, MAX_PEEK_CACHE);
}
function cacheSectionGraph(key, data) {
	return setBoundedCache(state.graphCache, key, data, MAX_GRAPH_CACHE);
}
function cacheTitleRefs(titleNum, data) {
	return setBoundedCache(state.refsCache, titleNum, data, MAX_REFS_CACHE);
}
function cacheTitleTree(titleNum, tree) {
	return setBoundedCache(titleTreeCache, titleNum, tree, MAX_TREE_CACHE);
}
function invalidateTitleCaches(titles) {
	if (!titles) {
		state.peekCache.clear();
		state.graphCache.clear();
		state.refsCache.clear();
		titleTreeCache.clear();
		return;
	}
	const set = /* @__PURE__ */ new Set();
	for (const t of titles) {
		const n = Number(t);
		if (Number.isFinite(n) && n > 0) set.add(n);
	}
	if (!set.size) return;
	for (const key of [...state.peekCache.keys()]) if (set.has(Number(key.split("|", 1)[0]))) state.peekCache.delete(key);
	for (const key of [...state.graphCache.keys()]) if (set.has(Number(key.split("|", 1)[0]))) state.graphCache.delete(key);
	for (const t of set) {
		state.refsCache.delete(t);
		titleTreeCache.delete(t);
	}
}
async function getJSON(url, opts) {
	const res = await fetch(url, opts);
	let body = null;
	try {
		body = await res.json();
	} catch {}
	if (!res.ok) throw new Error(body && body.detail || `Request failed (${res.status})`);
	return body;
}
async function tryGetJSON(url, opts) {
	try {
		const res = await fetch(url, opts);
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}
function fetchInstalledTitles(opts) {
	return getJSON("/api/titles", opts);
}
async function fetchInstalledUscTitles(opts) {
	return (await tryGetJSON("/api/usc/titles", opts))?.titles || [];
}
function fetchUscMeta(titleNum, opts) {
	return tryGetJSON(`/api/usc/${titleNum}/meta`, opts);
}
function fetchUscTree(titleNum, opts) {
	return tryGetJSON(`/api/usc/${titleNum}/tree`, opts);
}
/** `unit`: null = the whole section; '' = the first unit of a long section; else that unit. */
function fetchUscSection(titleNum, sectionId, opts, unit = null) {
	const qs = unit === null ? "" : `?unit=${encodeURIComponent(unit)}`;
	return getJSON(`/api/usc/${titleNum}/section/${encodeURIComponent(sectionId)}${qs}`, opts);
}
function fetchUscCitations(titleNum, sectionId, opts) {
	return tryGetJSON(`/api/usc/${titleNum}/citations/${encodeURIComponent(sectionId)}`, opts);
}
function fetchTitlesSnapshot(opts) {
	return tryGetJSON("/api/titles/snapshot", opts);
}
function fetchTitleMeta(titleNum, opts) {
	return getJSON(`/api/${titleNum}/meta`, opts);
}
async function fetchTitleTree(titleNum, opts) {
	const res = await fetch(`/api/${titleNum}/tree`, opts);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const tree = await res.json();
	cacheTitleTree(titleNum, tree);
	return tree;
}
function fetchSectionRaw(titleNum, sectionId, unitQs = "", opts) {
	return fetch(`/api/${titleNum}/section/${encodeURIComponent(sectionId)}${unitQs}`, opts);
}
async function fetchSectionCached(titleNum, sectionId, unitQs = "?unit=", cacheKey, opts) {
	const key = cacheKey ?? `${titleNum}|${sectionId}|${unitQs === "" ? "full" : unitQs.replace(/^\?unit=/, "")}`;
	const hit = state.peekCache.get(key);
	if (hit) return hit;
	const res = await fetchSectionRaw(titleNum, sectionId, unitQs, opts);
	if (!res.ok) return null;
	const data = await res.json();
	cachePeekSection(key, data);
	return data;
}
async function fetchSectionGraph(titleNum, sectionId, opts) {
	const key = `${titleNum}|${sectionId}`;
	const hit = state.graphCache.get(key);
	if (hit) return hit;
	const data = await tryGetJSON(`/api/${titleNum}/citations/${encodeURIComponent(sectionId)}`, opts);
	if (data) cacheSectionGraph(key, data);
	return data;
}
async function fetchTitleReferences(titleNum, opts) {
	const hit = state.refsCache.get(titleNum);
	if (hit) return hit;
	const data = await tryGetJSON(`/api/${titleNum}/references`, opts);
	if (data) cacheTitleRefs(titleNum, data);
	return data;
}
function fetchPartFront(titleNum, partId, opts) {
	return fetch(`/api/${titleNum}/part/${encodeURIComponent(partId)}`, opts);
}
function fetchPartFull(titleNum, partId, opts) {
	return fetch(`/api/${titleNum}/part/${encodeURIComponent(partId)}/full`, opts);
}
function fetchSearchResults(titleNum, query, limit = 100, opts, include) {
	return getJSON(titleNum === "all" || include ? `/api/search?q=${encodeURIComponent(query)}&title=${titleNum}&limit=${limit}${include ? `&include=${include}` : ""}` : `/api/${titleNum}/search?q=${encodeURIComponent(query)}&limit=${limit}`, opts);
}
function fetchLibraryJobs(opts) {
	return getJSON("/api/library/jobs", opts);
}
function fetchTitleModels(titleNum, opts) {
	return tryGetJSON(`/api/${titleNum}/models`, opts);
}
function fetchNewsPreview(limit = 3, opts) {
	return tryGetJSON(`/api/news?limit=${limit}`, opts);
}
// src/usage.ts
var USAGE_KEY = "usage";
function loadUsage() {
	try {
		const u = JSON.parse(lsGet("usage") || "null");
		if (u && u.v === 1 && u.s && u.p) return u;
	} catch {}
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
function recordSectionVisit(data, unitInfo = null) {
	if (!data || !data.id) return;
	const u = loadUsage();
	const now = Date.now();
	const key = state.currentTitle + "|" + data.id;
	const e = u.s[key] || (u.s[key] = { n: 0 });
	e.n += 1;
	e.t = now;
	e.l = data.label || data.id;
	e.h = data.section_title || data.title_label || "";
	e.p = data.part || "";
	if (unitInfo && unitInfo.key) {
		e.u = unitInfo.key;
		e.ul = unitInfo.label || unitInfo.key;
	} else {
		delete e.u;
		delete e.ul;
	}
	const partNode = data.part && state.treeData ? findPartInTree(state.treeData, data.part) : null;
	bumpPart(u, state.currentTitle, data.part, partNode && partNode.d, now);
	lsSet(USAGE_KEY, JSON.stringify(u));
}
function recordSectionUnit(sectionId, unitInfo = null) {
	if (!sectionId) return;
	const u = loadUsage();
	const key = state.currentTitle + "|" + sectionId;
	const e = u.s[key];
	if (!e) return;
	e.t = Date.now();
	if (unitInfo && unitInfo.key) {
		e.u = unitInfo.key;
		e.ul = unitInfo.label || unitInfo.key;
	} else {
		delete e.u;
		delete e.ul;
	}
	lsSet(USAGE_KEY, JSON.stringify(u));
}
function recordPartVisit(partId, heading) {
	const u = loadUsage();
	bumpPart(u, state.currentTitle, partId, heading, Date.now());
	lsSet(USAGE_KEY, JSON.stringify(u));
}
function visitedCountFor(title) {
	try {
		const raw = lsGet(title === 29 ? "visited" : "visited-" + title);
		return raw ? JSON.parse(raw).length : 0;
	} catch {
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
var fmt = (n) => Number(n || 0).toLocaleString();
var titleHref = (t, rest) => `#/title/${t}/${rest || ""}`;
// src/components/ui.ts
var SEP = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
var joinSep = (xs) => xs.filter(Boolean).join(SEP);
var fmtDate = (iso) => {
	if (!iso) return "";
	const d = /* @__PURE__ */ new Date(iso + "T00:00:00");
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(void 0, {
		month: "short",
		day: "numeric",
		year: "numeric"
	});
};
var shortDate = (iso) => {
	if (!iso) return "";
	const d = /* @__PURE__ */ new Date(iso + "T00:00:00");
	if (Number.isNaN(d.getTime())) return iso;
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
var fmtBytes = (bytes) => {
	if (!bytes || bytes <= 0) return "";
	if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	const mb = bytes / 1048576;
	if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
	return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
};
var fmtMB = (mb) => mb ? fmtBytes(mb * 1048576) : "";
var fmtSections = (n) => n ? `${fmt(n)} ${n === 1 ? "section" : "sections"}` : "";
function statPill(stateName, text, { bare = false, title = "" } = {}) {
	return `<span class="stat-pill is-${stateName}${bare ? " is-bare" : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="stat-dot is-${stateName}" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}
function metricCardHtml({ label, value, of = "", sub = "", alert = false }) {
	return `<div class="metric-card${alert ? " is-alert" : ""}"><div class="metric-label">${label}</div><div class="metric-val">${value}${of ? `<span class="metric-of">${escapeHtml(of)}</span>` : ""}</div><div class="metric-sub">${sub}</div></div>`;
}
function emptyStateHtml({ title = "", body = "", actionsHtml = "", cls = "" } = {}) {
	return `<div class="empty-state${cls ? " " + cls : ""}"><h2>${escapeHtml(title)}</h2>` + (body ? `<p>${body}</p>` : "") + (actionsHtml || "") + "</div>";
}
function segmentedHtml({ label, items, value, cls = "seg", role = "group", dataAttr = "data-value" }) {
	return `<div class="${cls}" role="${role}" aria-label="${escapeHtml(label)}">${items.map((it) => {
		const on = it.value === value;
		return `<button type="button" ${dataAttr}="${escapeHtml(it.value)}" aria-pressed="${on}"${it.attrs ? " " + it.attrs : ""}>${it.label}</button>`;
	}).join("")}</div>`;
}
function transferTrackHtml(pct, { bindFill = false } = {}) {
	return `<div class="dock-track"><span class="dock-fill${pct == null ? " is-indeterminate" : ""}"${bindFill ? " data-f=\"fill\"" : ""} style="width:${pct == null ? 35 : pct}%"></span></div>`;
}
// src/core/library_meta.ts
var isStale = (t) => Boolean(t.installed && t.latest && t.installed.edition && t.latest > t.installed.edition);
function jobFor(title, kind, id) {
	return [state.jobs.current, ...state.jobs.queued].filter(Boolean).find((j) => j.title === title && (kind === "title" ? j.kind === "title" || j.kind === "update" : kind === "part" ? j.kind === "part" && j.target && j.target.part === id : j.kind === "section" && j.target && j.target.id === id));
}
var jobStatus = (j) => j ? statPill("busy", j.state === "running" ? "Downloading" : "Queued", { bare: true }) : "";
function pluralWord(n, word) {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}
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
		const what = [inst.parts ? pluralWord(inst.parts, "part") : "", inst.sections ? pluralWord(inst.sections, "section") : ""].filter(Boolean).join(", ");
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
function suiteState(s, d) {
	const ts = s.titles.map((n) => d.titles.find((t) => t.title === n)).filter((t) => Boolean(t && !t.reserved));
	const total = ts.length || (s.titles || []).length;
	const busy = ts.filter((t) => jobFor(t.title, "title"));
	const whole = ts.filter((t) => t.installed && t.installed.whole);
	const any = ts.filter((t) => t.installed);
	const stale = ts.filter(isStale);
	const needs = ts.filter((t) => !jobFor(t.title, "title") && (!t.installed || !t.installed.whole || isStale(t)));
	let pill;
	if (!ts.length) pill = statPill("uninstalled", "Not installed", { bare: true });
	else if (busy.length) pill = statPill("busy", `${busy.length} of ${ts.length} in progress`);
	else if (whole.length === ts.length && !stale.length) pill = statPill("synced", "Installed");
	else if (whole.length === ts.length) pill = statPill("stale", "Update available");
	else if (any.length) pill = statPill("partial", `${any.length} of ${ts.length} installed`);
	else pill = statPill("uninstalled", "Not installed", { bare: true });
	const onlyUpdates = needs.length && needs.every((t) => t.installed && t.installed.whole);
	const label = !needs.length ? "" : onlyUpdates ? `Update ${needs.length === ts.length ? "suite" : pluralWord(needs.length, "title")}` : needs.length === ts.length ? "Download suite" : `Download ${pluralWord(needs.length, "remaining title")}`;
	return {
		ts,
		total,
		pill,
		needs,
		label,
		busy
	};
}
// src/core/projects_store.ts
var PROJECTS_KEY = "framework_projects_v1";
var PROJECT_HUES = [
	"--accent",
	"--ok",
	"--warn",
	"--partial",
	"--blue",
	"--danger"
];
var validProject = (p) => Boolean(p && typeof p === "object" && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.sections));
var normalizeWorkspace = (p) => ({
	...p,
	tags: Array.isArray(p.tags) ? p.tags : [],
	sections: p.sections.map((s) => ({
		tier: "federal-reg",
		jurisdiction: "US",
		...s
	})),
	cases: Array.isArray(p.cases) ? p.cases : [],
	projects: Array.isArray(p.projects) ? p.projects : [],
	tab_groups: Array.isArray(p.tab_groups) ? p.tab_groups : []
});
function loadProjects() {
	try {
		const v = JSON.parse(lsGet("framework_projects_v1") || "[]");
		return Array.isArray(v) ? v.filter(validProject).map(normalizeWorkspace) : [];
	} catch {
		return [];
	}
}
function saveProjects(list, { quiet = false } = {}) {
	lsSet(PROJECTS_KEY, JSON.stringify(list));
	emit("projects:changed", { quiet });
}
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
function createProject(name, extra = {}) {
	const list = loadProjects();
	const p = {
		id: `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		name: (name || "").trim() || "Untitled workspace",
		description: "",
		tags: [],
		created_at: nowIso(),
		updated_at: nowIso(),
		sections: [],
		projects: [],
		tab_groups: [],
		...extra
	};
	list.unshift(p);
	saveProjects(list);
	return p;
}
function updateProject(id, fn, opts) {
	if (!id) return null;
	const list = loadProjects();
	const p = list.find((x) => x.id === id);
	if (!p) return null;
	fn(p);
	p.updated_at = nowIso();
	saveProjects(list, opts);
	return p;
}
function addTabGroupToWorkspace(workspaceId, groupSnapshot) {
	if (!groupSnapshot) return null;
	const p = updateProject(workspaceId, (proj) => {
		if (!Array.isArray(proj.tab_groups)) proj.tab_groups = [];
		proj.tab_groups.unshift(groupSnapshot);
	});
	if (p) {
		const count = (groupSnapshot.mainTabs?.length || 0) + (groupSnapshot.splitTabs?.length || 0);
		showToast(`Saved “${groupSnapshot.name}” (${count} ${count === 1 ? "tab" : "tabs"}) to ${p.name}`);
	}
	return p;
}
function projectHue(p) {
	let h = 0;
	for (const ch of p.id) h = h * 31 + ch.charCodeAt(0) >>> 0;
	return PROJECT_HUES[h % PROJECT_HUES.length];
}
var projDot = (p) => `<span class="proj-dot" style="--hue: var(${projectHue(p)})" aria-hidden="true"></span>`;
var secKey = (title, id) => `${title}|${id}`;
var projectsWith = (title, id) => loadProjects().filter((p) => p.sections.some((s) => s.title === title && s.id === id));
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
var USC_TIER = "federal-statute";
/** A U.S. Code section's workspace reference (tier `federal-statute`, so Workspaces link it to the U.S.C. reader). */
function uscSectionRef(title, sec) {
	return {
		title,
		id: sec.id,
		label: (sec.label || `§ ${sec.id}`).replace(/\.\s*$/, ""),
		heading: sec.heading || "",
		tier: USC_TIER,
		jurisdiction: "US"
	};
}
var CONST_TIER = "federal-constitution";
/** A unit of the Constitution as a workspace reference (title 0, tier `federal-constitution`). */
function constSectionRef(unit) {
	return {
		title: 0,
		id: unit.id,
		label: unit.label,
		heading: unit.heading || "",
		tier: CONST_TIER,
		jurisdiction: "US"
	};
}
function currentSectionRef() {
	if (!state.currentSection && !state.currentUscSection && state.currentConstUnit) return constSectionRef(state.currentConstUnit);
	if (!state.currentSection && state.currentUscSection && state.currentUscTitle) return uscSectionRef(state.currentUscTitle, state.currentUscSection);
	if (!state.currentSection) return null;
	return {
		title: state.currentTitle,
		id: state.currentSection.id,
		label: state.currentSection.label || `§ ${state.currentSection.id}`,
		heading: state.currentSection.section_title || state.currentSection.title_label || "",
		part: state.currentSection.part || "",
		tier: "federal-reg",
		jurisdiction: "US"
	};
}
function clipToWorkspace(sec, { para = "", quote = "", cite = "", projectId = null } = {}) {
	if (!sec || !sec.id) return null;
	let list = loadProjects();
	let targetProj = projectId ? list.find((x) => x.id === projectId) : list[0];
	if (!targetProj) {
		targetProj = createProject("Research clips");
		list = loadProjects();
		targetProj = list.find((x) => x.id === targetProj.id) || list[0];
	}
	if (!targetProj) return null;
	const cleanQuote = String(quote || "").replace(/\s+/g, " ").trim();
	const clippedCite = cite || `${sec.title} C.F.R. ${sec.label || "§ " + sec.id}${para || ""}`;
	const entryLine = cleanQuote ? `[${clippedCite}] "${cleanQuote}"` : `[${clippedCite}]`;
	updateProject(targetProj.id, (p) => {
		let item = p.sections.find((s) => s.title === sec.title && s.id === sec.id);
		if (!item) {
			item = {
				...sec,
				pinned_at: nowIso(),
				note: entryLine
			};
			p.sections.push(item);
		} else if (!item.note || !item.note.includes(entryLine)) item.note = item.note ? `${item.note}\n\n${entryLine}` : entryLine;
	});
	showToast(`Clipped ${clippedCite} to ${targetProj.name}`);
	return targetProj;
}
function clipCaseToWorkspace(clip, projectId = null) {
	if (!clip || !clip.activity_nr) return null;
	let list = loadProjects();
	let targetProj = projectId ? list.find((x) => x.id === projectId) : list[0];
	if (!targetProj) {
		targetProj = createProject("Research clips");
		list = loadProjects();
		targetProj = list.find((x) => x.id === targetProj.id) || list[0];
	}
	if (!targetProj) return null;
	updateProject(targetProj.id, (p) => {
		if (!Array.isArray(p.cases)) p.cases = [];
		const idx = p.cases.findIndex((c) => c.activity_nr === clip.activity_nr);
		const rec = {
			...clip,
			clipped_at: nowIso()
		};
		if (idx >= 0) p.cases[idx] = rec;
		else p.cases.unshift(rec);
	});
	showToast(`Clipped Inspection #${clip.activity_nr} to ${targetProj.name}`);
	return targetProj;
}
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
var exportProjects = (list, name = "framework-projects.json") => downloadJson(name, {
	format: "framework-projects",
	version: 1,
	exported_at: nowIso(),
	projects: list
});
// src/citations.ts
var NEWS_CITE_RE = /\b29\s*C\.?F\.?R\.?\s*(?:§§?\s*)?(\d{1,4}\.\d+)(?:\([a-z0-9]{1,4}\))*|§§?\s*(19\d{2}\.\d+)(?:\([a-z0-9]{1,4}\))*/gi;
var PARA_TOKEN_RE = /\([a-zA-Z0-9]{1,4}\)/g;
/**
* The paragraph path ("(a)(2)(i)") of paragraph `idx` in a reader body, from each paragraph's
* nesting level (`lvl-N`, 0 = none) and marker text (`.pmark`). A folded marker such as
* "(a)(1)" (CFR) or "(5)(A)" (U.S.C.) sits at its first token's level, so a later child
* keeps only the tokens above its own level: "(2)" after "(a)(1)" is "(a)(2)".
*/
function paragraphPathFrom(paras, idx) {
	const tokens = (m) => m.match(PARA_TOKEN_RE) || [];
	const own = paras[idx] ? tokens(paras[idx].marks) : [];
	if (!own.length) return "";
	let target = paras[idx].lvl;
	const chain = [...own];
	for (let i = idx - 1; i >= 0 && target > 1; i--) {
		const p = paras[i];
		if (p.lvl <= 0 || p.lvl >= target) continue;
		const t = tokens(p.marks);
		if (!t.length) continue;
		chain.unshift(...t.slice(0, Math.min(t.length, target - p.lvl)));
		target = p.lvl;
	}
	return chain.join("");
}
// src/core/news_format.ts
var NEWS_SOURCE_LABELS = {
	federal_register: "Federal Register",
	federal_register_pi: "Federal Register Public Inspection",
	dol_osha: "DOL enforcement data"
};
var US_STATE_NAMES = {
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
var stateName = (code) => US_STATE_NAMES[(code || "").toUpperCase()] || code || "";
var moneyFmt = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0
});
function fmtMoney(n) {
	return moneyFmt.format(n);
}
function extLink(url, html) {
	const safe = safeHttpUrl(url);
	return safe ? `<a target="_blank" rel="noopener" href="${escapeHtml(safe)}">${html}</a>` : html;
}
function titleInstalled(t) {
	return state.installedTitles.some((x) => x.title === t);
}
function newsSectionHref(t, id) {
	return titleInstalled(t) ? `#/title/${t}/section/${encodeURIComponent(id)}` : `#/library/${t}`;
}
function newsPartHref(t, part) {
	return titleInstalled(t) ? `#/title/${t}/part/${encodeURIComponent(String(part))}` : `#/library/${t}`;
}
function inspectionActivityNr(a) {
	if (!a || a.category !== "enforcement" || !a.guid) return null;
	const m = /^dol-insp:(\d+)$/.exec(String(a.guid));
	return m ? m[1] : null;
}
function frDocumentNumber(a) {
	if (!a || a.category === "enforcement" || a.category === "public_inspection" || !a.guid) return null;
	const m = /^fr:([A-Za-z0-9._-]+)$/.exec(String(a.guid));
	return m ? m[1] : null;
}
function newsKicker(a) {
	if (a.category === "enforcement") return ["ENFORCEMENT", a.state].filter(Boolean).join(" · ");
	if (a.category === "public_inspection") return ["PUBLIC INSPECTION", (a.doc_type || "").toUpperCase()].filter(Boolean).join(" · ");
	return [a.category === "rules" ? "FINAL RULE" : a.category === "rulemaking" ? "PROPOSED RULE" : "NOTICE", a.citation].filter(Boolean).join(" · ");
}
function newsBylineHtml(a) {
	const src = a.source || "";
	return `<div class="news-byline">${escapeHtml(fmtDate(a.published_at))}<span class="sep" aria-hidden="true">·</span>${escapeHtml(NEWS_SOURCE_LABELS[src] || src)}</div>`;
}
function newsStatusPillHtml(status) {
	if (!status) return "";
	if (!status.sync_enabled) return statPill("stale", "News sync is off");
	if (status.syncing) return statPill("busy", "Checking for news…");
	const enabled = Object.values(status.sources || {}).filter((s) => s.enabled);
	const lastOk = enabled.map((s) => s.last_ok_at).filter(Boolean).sort().pop();
	const failed = enabled.find((s) => s.last_error);
	if (failed && lastOk) return statPill("stale", `Last update failed · showing data from ${fmtDate(lastOk.slice(0, 10))}`, { title: failed.last_error || "" });
	return lastOk ? statPill("synced", `Updated ${timeAgo(Date.parse(lastOk))}`) : "";
}
function linkifyNewsText(text) {
	return escapeHtml(text || "").replace(NEWS_CITE_RE, (m, a, b) => {
		return `<a class="citation-link" href="${newsSectionHref(29, a || b)}">${m}</a>`;
	});
}
// src/api/jobs.ts
var titleRefresher = null;
function registerTitleRefresher(fn) {
	titleRefresher = fn;
}
function setJobs(snapshot) {
	if (!snapshot) return;
	state.jobs = snapshot;
	for (const j of [state.jobs.current, ...state.jobs.queued]) if (j) state.jobsSeenActive.add(j.id);
	emit("jobs:updated", snapshot);
	document.dispatchEvent(new CustomEvent("framework:jobs-updated", { detail: { snap: snapshot } }));
}
function pollJobsIfActive() {
	if ((state.jobs.current || state.jobs.queued.length) && !state.jobsTimer) state.jobsTimer = setTimeout(pollJobs, 700);
}
async function pollJobs() {
	if (state.jobsTimer) {
		clearTimeout(state.jobsTimer);
		state.jobsTimer = null;
	}
	let snap;
	try {
		snap = await fetchLibraryJobs();
	} catch {
		state.jobsTimer = setTimeout(pollJobs, 3e3);
		return;
	}
	const before = new Set(state.jobsSeenActive);
	setJobs(snap);
	const finished = snap.recent.filter((j) => before.has(j.id));
	for (const j of finished) {
		state.jobsSeenActive.delete(j.id);
		if (j.state === "error") showToast(`${j.label}: ${j.error}`, 6e3);
		else if (j.state === "cancelled") showToast(`Cancelled ${j.label}`);
		else showToast(j.phase === "Already installed" ? `${j.label} is already installed` : `Downloaded ${j.label}`);
	}
	const doneTitles = finished.filter((j) => j.state === "done").map((j) => j.title);
	if (doneTitles.length) {
		invalidateTitleCaches(doneTitles);
		if (titleRefresher) await titleRefresher(doneTitles);
	}
	if (finished.length) {
		state.navStorage = null;
		emit("jobs:finished", {
			finished,
			snap
		});
		document.dispatchEvent(new CustomEvent("framework:jobs-finished", { detail: {
			finished,
			snap
		} }));
	}
	pollJobsIfActive();
}
async function queueBatch(url, body, emptyMsg) {
	const res = await getJSON(url, body ? {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	} : { method: "POST" });
	for (const j of res.queued || []) state.jobsSeenActive.add(j.id);
	showToast(res.count ? `Queued ${plural(res.count, "title")}` : emptyMsg);
	await pollJobs();
}
var isUscAppendix = (title) => title > 100;
/** "29", or "5a" for the Title 5 Appendix (105). */
var uscTitleLabel = (title) => isUscAppendix(title) ? `${title - 100}a` : String(title);
/** "29 U.S.C.", or "5 U.S.C. App." for an appendix title. */
var uscCite = (title) => isUscAppendix(title) ? `${title - 100} U.S.C. App.` : `${title} U.S.C.`;
// src/components/corpora.ts
var ACTIVE_DESK_KEY = "framework_desk_v1";
var TIER_ORDER = [
	"federal-constitution",
	"federal-statute",
	"federal-reg",
	"federal-register",
	"standard"
];
var SYSTEM_TIERS = [
	"federal-statute",
	"federal-reg",
	"federal-register"
];
var TIER_META = {
	"federal-constitution": {
		label: "U.S. Constitution",
		short: "Const.",
		refTier: "const",
		tag: "CONSTITUTION",
		subtitle: "The supreme law"
	},
	"federal-statute": {
		label: "U.S. Code (U.S.C.)",
		short: "U.S.C.",
		refTier: "usc",
		tag: "U.S.C.",
		subtitle: "Federal statutory law"
	},
	"federal-reg": {
		label: "Code of Federal Regulations (CFR)",
		short: "CFR",
		refTier: "cfr",
		tag: "FEDERAL REG",
		subtitle: "Codified federal rules"
	},
	"federal-register": {
		label: "Federal Register (FR)",
		short: "FR",
		refTier: "fr",
		tag: "FED REGISTER",
		subtitle: "Daily rulemaking & notices"
	},
	"standard": {
		label: "Incorporated Standards (IBR)",
		short: "IBR",
		refTier: "ibr",
		tag: "STANDARD",
		subtitle: "Standards incorporated by reference"
	}
};
var DESK_DEFS = [
	{
		id: "all",
		label: "All Topics"
	},
	{
		id: "ehs",
		label: "Labor & Workplace"
	},
	{
		id: "env",
		label: "Environmental"
	},
	{
		id: "transport",
		label: "Transportation"
	},
	{
		id: "labor-employment",
		label: "Health & Benefits"
	},
	{
		id: "fire-building",
		label: "Housing & Construction"
	},
	{
		id: "commerce-govcon",
		label: "Commerce & GovCon"
	}
];
var DESK_BY_CFR_TITLE = {
	10: "env",
	14: "transport",
	16: "commerce-govcon",
	21: "commerce-govcon",
	23: "transport",
	24: "fire-building",
	26: "commerce-govcon",
	29: "ehs",
	30: "ehs",
	33: "env",
	40: "env",
	42: "ehs",
	45: "labor-employment",
	46: "transport",
	48: "commerce-govcon",
	49: "transport"
};
var FOUNDATIONAL_ADMIN_STATUTES = [
	{
		code: "5 U.S.C. §§ 551–559",
		name: "Notice-and-Comment Rulemaking",
		act: "Administrative Procedure Act (APA)",
		summary: "Governs informal agency rulemaking (§ 553), public notice in the Federal Register, comment dockets, effective-date delays, and formal adjudications (§ 554).",
		href: "https://uscode.house.gov/browse/prelim@title5/part1/chapter5/subchapter2&edition=prelim",
		scope: "All CFR & FR Rules"
	},
	{
		code: "5 U.S.C. §§ 701–706",
		name: "Judicial Review of Agency Action",
		act: "APA Chapter 7",
		summary: "Establishes the right of review, final agency action standards, and scope of judicial review over statutory authority and arbitrary-or-capricious rulemaking.",
		href: "https://uscode.house.gov/browse/prelim@title5/part1/chapter7&edition=prelim",
		scope: "Statutory Interpretation"
	},
	{
		code: "5 U.S.C. §§ 601–612",
		name: "Small Entity Impact Analysis",
		act: "Regulatory Flexibility Act (RFA)",
		summary: "Requires agencies to publish initial and final regulatory flexibility analyses assessing compliance burdens on small businesses and organizations.",
		href: "https://uscode.house.gov/browse/prelim@title5/part1/chapter6&edition=prelim",
		scope: "Proposed & Final Rules"
	},
	{
		code: "44 U.S.C. §§ 3501–3521",
		name: "Information Collection & OMB Control",
		act: "Paperwork Reduction Act (PRA)",
		summary: "Mandates OIRA review and OMB control numbers for reporting, recordkeeping, and disclosure requirements codified across CFR parts.",
		href: "https://uscode.house.gov/browse/prelim@title44/chapter35/subchapter1&edition=prelim",
		scope: "Recordkeeping & Forms"
	}
];
var KNOWN_TITLE_AUTHORITIES = {
	21: {
		statuteCode: "21 U.S.C. §§ 301–399i",
		statuteLabel: "Federal Food, Drug, and Cosmetic Act",
		statuteHref: "https://uscode.house.gov/browse/prelim@title21/chapter9&edition=prelim",
		frNote: "FDA & DEA rulemaking and notices",
		summary: "Statutory mandate governing food safety, pharmaceutical approval, medical devices, biologics, good manufacturing practices, and controlled substances.",
		acts: [
			"Federal Food, Drug, and Cosmetic Act (21 U.S.C. §§ 301–399i)",
			"Public Health Service Act § 351 (42 U.S.C. § 262)",
			"Controlled Substances Act (21 U.S.C. §§ 801–971)"
		],
		provisions: [
			{
				cite: "21 U.S.C. § 342",
				title: "Adulterated food & current good manufacturing practice",
				cfrTitle: 21,
				cfrPart: "117"
			},
			{
				cite: "21 U.S.C. § 355",
				title: "New drug applications (NDA) & clinical investigations",
				cfrTitle: 21,
				cfrPart: "312"
			},
			{
				cite: "21 U.S.C. § 360c",
				title: "Classification & premarket oversight of medical devices",
				cfrTitle: 21,
				cfrPart: "820"
			},
			{
				cite: "21 U.S.C. § 821",
				title: "Registration & control of manufacture and distribution",
				cfrTitle: 21,
				cfrPart: "1301"
			}
		]
	},
	26: {
		statuteCode: "26 U.S.C.",
		statuteLabel: "Internal Revenue Code",
		statuteHref: "https://uscode.house.gov/browse/prelim@title26&edition=prelim",
		frNote: "Treasury & IRS regulations and notices",
		summary: "Comprehensive statutory tax code enacted by Congress governing federal income, payroll, estate, gift, and excise taxation and Treasury enforcement procedure.",
		acts: ["Internal Revenue Code of 1986 (26 U.S.C. §§ 1–9834)", "Employee Retirement Income Security Act Tax Provisions (26 U.S.C. §§ 401–436)"],
		provisions: [
			{
				cite: "26 U.S.C. § 61",
				title: "Gross income defined & general income tax computation",
				cfrTitle: 26,
				cfrPart: "1"
			},
			{
				cite: "26 U.S.C. § 401",
				title: "Qualified pension, profit-sharing, and stock bonus plans",
				cfrTitle: 26,
				cfrPart: "1"
			},
			{
				cite: "26 U.S.C. § 3101",
				title: "Federal Insurance Contributions Act (FICA) employment taxes",
				cfrTitle: 26,
				cfrPart: "31"
			},
			{
				cite: "26 U.S.C. § 7805",
				title: "Authorization for Treasury rules and regulations",
				cfrTitle: 26,
				cfrPart: "301"
			}
		]
	},
	29: {
		statuteCode: "29 U.S.C. §§ 201–678",
		statuteLabel: "Fair Labor Standards, NLRA & OSH Acts",
		statuteHref: "https://uscode.house.gov/browse/prelim@title29&edition=prelim",
		frNote: "Department of Labor & NLRB rulemaking",
		summary: "Federal statutory framework governing occupational safety and health standards, minimum wage and overtime exemptions, family leave, and employee benefit plans.",
		acts: [
			"Occupational Safety and Health Act (29 U.S.C. §§ 651–678)",
			"Fair Labor Standards Act (29 U.S.C. §§ 201–219)",
			"Employee Retirement Income Security Act (29 U.S.C. §§ 1001–1461)",
			"Family and Medical Leave Act (29 U.S.C. §§ 2601–2654)"
		],
		provisions: [
			{
				cite: "29 U.S.C. § 654",
				title: "General Duty Clause & employer workplace safety duties",
				cfrTitle: 29,
				cfrPart: "1910",
				cfrSection: "1910.120"
			},
			{
				cite: "29 U.S.C. § 655",
				title: "Promulgation of occupational safety & hazard standards",
				cfrTitle: 29,
				cfrPart: "1910",
				cfrSection: "1910.1200"
			},
			{
				cite: "29 U.S.C. § 657",
				title: "Inspections, investigations & injury recordkeeping",
				cfrTitle: 29,
				cfrPart: "1904"
			},
			{
				cite: "29 U.S.C. § 213",
				title: "FLSA executive, administrative & professional exemptions",
				cfrTitle: 29,
				cfrPart: "541"
			}
		]
	},
	40: {
		statuteCode: "42 U.S.C. §§ 6901, 7401",
		statuteLabel: "RCRA, Clean Air & Clean Water Acts",
		statuteHref: "https://uscode.house.gov/browse/prelim@title42&edition=prelim",
		frNote: "EPA final rules, proposals & notices",
		summary: "Principal federal environmental statutes authorizing national ambient air standards, hazardous waste management, discharge permits, and emergency release reporting.",
		acts: [
			"Resource Conservation and Recovery Act (42 U.S.C. §§ 6901–6992k)",
			"Clean Air Act (42 U.S.C. §§ 7401–7671q)",
			"Clean Water Act (33 U.S.C. §§ 1251–1388)",
			"CERCLA / Superfund (42 U.S.C. §§ 9601–9675)"
		],
		provisions: [
			{
				cite: "42 U.S.C. § 6921",
				title: "Identification and listing of hazardous waste (RCRA Subtitle C)",
				cfrTitle: 40,
				cfrPart: "261",
				cfrSection: "261.3"
			},
			{
				cite: "42 U.S.C. § 7409",
				title: "National primary & secondary ambient air quality standards",
				cfrTitle: 40,
				cfrPart: "50"
			},
			{
				cite: "33 U.S.C. § 1342",
				title: "National Pollutant Discharge Elimination System (NPDES)",
				cfrTitle: 40,
				cfrPart: "122"
			},
			{
				cite: "42 U.S.C. § 9602",
				title: "Hazardous substance designations & reportable quantities",
				cfrTitle: 40,
				cfrPart: "302"
			}
		]
	},
	48: {
		statuteCode: "41 U.S.C. §§ 101–8707",
		statuteLabel: "Public Contracts & Federal Procurement",
		statuteHref: "https://uscode.house.gov/browse/prelim@title41&edition=prelim",
		frNote: "FAR Council & agency acquisition rules",
		summary: "Statutory procurement authority governing federal competition requirements, contract award and administration, socioeconomic clauses, and procurement integrity.",
		acts: [
			"Public Contracts Act / Title 41 Codification (41 U.S.C. §§ 101–8707)",
			"Competition in Contracting Act (41 U.S.C. §§ 3301–3312)",
			"Contract Disputes Act (41 U.S.C. §§ 7101–7109)"
		],
		provisions: [
			{
				cite: "41 U.S.C. § 1303",
				title: "Federal Acquisition Regulatory Council & single government-wide regulation",
				cfrTitle: 48,
				cfrPart: "1"
			},
			{
				cite: "41 U.S.C. § 3301",
				title: "Full and open competition in federal solicitation and award",
				cfrTitle: 48,
				cfrPart: "6"
			},
			{
				cite: "41 U.S.C. § 3502",
				title: "Truthful cost or pricing data & audit disclosures",
				cfrTitle: 48,
				cfrPart: "15"
			},
			{
				cite: "41 U.S.C. § 7103",
				title: "Contracting officer decision & claims resolution procedure",
				cfrTitle: 48,
				cfrPart: "33"
			}
		]
	},
	49: {
		statuteCode: "49 U.S.C. §§ 5101–5128",
		statuteLabel: "Transportation & HazMat Statutes",
		statuteHref: "https://uscode.house.gov/browse/prelim@title49&edition=prelim",
		frNote: "DOT, FAA, FMCSA & PHMSA rulemaking",
		summary: "Congressional mandates for hazardous materials transportation, commercial motor carrier safety, driver qualification and CDL standards, and motor vehicle safety.",
		acts: [
			"Federal Hazardous Materials Transportation Law (49 U.S.C. §§ 5101–5128)",
			"Motor Carrier Safety Act (49 U.S.C. §§ 31131–31151)",
			"Commercial Motor Vehicle Safety Act (49 U.S.C. §§ 31301–31317)",
			"National Traffic and Motor Vehicle Safety Act (49 U.S.C. §§ 30101–30183)"
		],
		provisions: [
			{
				cite: "49 U.S.C. § 5103",
				title: "Designation of hazardous materials & transport regulations",
				cfrTitle: 49,
				cfrPart: "172",
				cfrSection: "172.101"
			},
			{
				cite: "49 U.S.C. § 5104",
				title: "Representation, marking, labeling & packaging of hazmat",
				cfrTitle: 49,
				cfrPart: "173"
			},
			{
				cite: "49 U.S.C. § 31136",
				title: "Minimum safety standards for commercial motor vehicles",
				cfrTitle: 49,
				cfrPart: "390"
			},
			{
				cite: "49 U.S.C. § 31308",
				title: "Commercial driver’s license (CDL) testing & standards",
				cfrTitle: 49,
				cfrPart: "383"
			}
		]
	}
};
function authorityForCorpus(corpus) {
	if (!corpus || corpus.tier !== "federal-statute") return null;
	for (const tNum of corpus.linked_titles || []) if (KNOWN_TITLE_AUTHORITIES[tNum]) return KNOWN_TITLE_AUTHORITIES[tNum];
	const code = String(corpus.code || "").toLowerCase();
	for (const auth of Object.values(KNOWN_TITLE_AUTHORITIES)) if (auth.statuteCode.toLowerCase() === code || auth.statuteCode.toLowerCase().startsWith(code.split("§§")[0].trim())) return auth;
	return null;
}
var VALID_DESKS = new Set(DESK_DEFS.map((d) => d.id));
function loadActiveDesk() {
	const saved = lsGet(ACTIVE_DESK_KEY);
	const next = saved && VALID_DESKS.has(saved) ? saved : "all";
	state.activeDesk = next;
	return next;
}
function setActiveDesk(desk) {
	const next = VALID_DESKS.has(desk) ? desk : "all";
	state.activeDesk = next;
	lsSet(ACTIVE_DESK_KEY, next);
	return next;
}
loadActiveDesk();
function mapRawDeskToId(rawDesk, titleNum = null) {
	const txt = String(rawDesk || "").trim().toLowerCase();
	if (VALID_DESKS.has(txt)) return txt;
	if (titleNum && DESK_BY_CFR_TITLE[titleNum]) return DESK_BY_CFR_TITLE[titleNum];
	if (txt.includes("safety") || txt.includes("osha") || txt.includes("health") || txt.includes("workplace")) return "ehs";
	if (txt.includes("environ") || txt.includes("epa")) return "env";
	if (txt.includes("transport") || txt.includes("dot") || txt.includes("hazmat")) return "transport";
	if (txt.includes("fire") || txt.includes("build")) return "fire-building";
	if (txt.includes("labor") || txt.includes("wage") || txt.includes("employ")) return "labor-employment";
	if (txt.includes("commer") || txt.includes("trade") || txt.includes("gov") || txt.includes("tax")) return "commerce-govcon";
	return "ehs";
}
function deskLabel(deskId) {
	return DESK_DEFS.find((d) => d.id === deskId)?.label || "Regulatory";
}
function tierMetaFor(tier) {
	return TIER_META[tier] || TIER_META["federal-reg"];
}
function refTierForCorpus(corpusOrTier) {
	return tierMetaFor(typeof corpusOrTier === "string" ? corpusOrTier : corpusOrTier?.tier || "federal-reg").refTier;
}
function corpusIdForTitle(titleNum) {
	return `us:cfr:${Number(titleNum) || 29}`;
}
function corpusHashFor(corpus, subPath = "/") {
	const cleanSub = subPath.startsWith("/") ? subPath : `/${subPath}`;
	if (corpus.tier === "federal-reg" && corpus.title_num) return `#/title/${corpus.title_num}${cleanSub}`;
	if (corpus.tier === "federal-statute" && corpus.installed && corpus.title_num) return `#/usc/${corpus.title_num}${cleanSub}`;
	return `#/corpus/${encodeURIComponent(corpus.tier)}/${encodeURIComponent(corpus.jurisdiction || "US")}/${encodeURIComponent(corpus.code || corpus.corpus_id)}${cleanSub === "/" ? "/" : cleanSub}`;
}
function parseCorpusPath(path) {
	const m = /^\/corpus\/([^/]+)\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path || "");
	if (!m) return null;
	const decode = (s) => {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	};
	return {
		tier: decode(m[1]),
		jurisdiction: decode(m[2]),
		code: decode(m[3]),
		subPath: m[4] || "/"
	};
}
function normalizeCorporaList(titles = state.installedTitles, snapshotRows = state.homeSnapshot?.titles, extras = state.extraCorpora) {
	const snapByTitle = new Map((snapshotRows || []).map((r) => [r.title, r]));
	const cfr = (titles || []).map((t) => {
		const snap = snapByTitle.get(t.title);
		const desk = mapRawDeskToId(snap?.desk, t.title);
		return {
			corpus_id: corpusIdForTitle(t.title),
			tier: "federal-reg",
			jurisdiction: "US",
			jurisdiction_label: "Federal",
			code: String(t.title),
			title_num: t.title,
			name: t.name || `Title ${t.title}`,
			desk,
			agencies: snap?.agencies || [],
			edition: t.edition || snap?.edition || null,
			section_count: t.section_count || snap?.section_count || 0,
			partial: Boolean(t.partial),
			summary: snap?.summary || "",
			installed: true
		};
	});
	const byId = new Map(cfr.map((c) => [c.corpus_id, c]));
	const mockWin = (typeof window !== "undefined" ? window.__FRAMEWORK_MOCK_CORPORA__ : void 0) || [];
	const injected = Array.isArray(extras) && extras.length ? extras : mockWin;
	for (const raw of injected) {
		if (!raw || !raw.corpus_id) continue;
		if (raw.tier === "state" || raw.tier === "county") continue;
		byId.set(raw.corpus_id, {
			...raw,
			tier: raw.tier || "federal-statute",
			jurisdiction: raw.jurisdiction || "US",
			jurisdiction_label: raw.jurisdiction_label || "Federal",
			code: raw.code || raw.corpus_id,
			name: raw.name || raw.corpus_id,
			desk: mapRawDeskToId(raw.desk),
			agencies: Array.isArray(raw.agencies) ? raw.agencies : [],
			installed: raw.installed !== false
		});
	}
	return [...byId.values()];
}
function syncCorporaState() {
	state.corpora = normalizeCorporaList();
	state.activeCorpusId = corpusIdForTitle(state.currentTitle);
	return state.corpora;
}
/**
* Full federal framework catalog spanning U.S. Code (U.S.C.), Code of Federal Regulations (CFR),
* and Federal Register (FR). Combines installed CFR titles, live FR status, any injected
* federal corpora, and statutory U.S.C. frameworks. State and local codes are out of scope.
*/
function allSystemFrameworks(titles = state.installedTitles, snapshotRows = state.homeSnapshot?.titles, newsStatus = state.navNewsStatus, extras = state.extraCorpora) {
	const base = normalizeCorporaList(titles, snapshotRows, extras).filter((c) => c.tier !== "state" && c.tier !== "county");
	const byId = new Map(base.map((c) => [c.corpus_id, c]));
	const installedSet = new Set((titles || []).map((t) => t.title));
	if (![...byId.values()].some((c) => c.tier === "federal-register")) {
		const frSrc = newsStatus?.sources?.federal_register;
		const piSrc = newsStatus?.sources?.federal_register_pi;
		const hasErr = Boolean(frSrc?.retry_after || frSrc?.last_error || piSrc?.retry_after || piSrc?.last_error);
		const articles = Number(newsStatus?.articles || 0);
		const frTitleNums = [...installedSet].sort((a, b) => a - b);
		byId.set("us:fr:daily", {
			corpus_id: "us:fr:daily",
			tier: "federal-register",
			jurisdiction: "US",
			jurisdiction_label: "Federal",
			code: "FR",
			name: "Federal Register",
			desk: "all",
			agencies: ["OFR", "Federal Agencies"],
			edition: frSrc?.last_ok_at ? frSrc.last_ok_at.slice(0, 10) : null,
			section_count: articles,
			summary: "Daily Final Rules, Proposed Rules, Notices, and Public Inspection filings across federal agencies and CFR titles.",
			installed: true,
			linked_titles: frTitleNums,
			status_label: hasErr ? "Sync issue" : articles > 0 ? `${articles} cached` : "Ready to sync",
			update_available: hasErr
		});
	}
	for (const u of state.installedUscTitles || []) {
		const id = `us:usc:${u.title}-u.s.c.`;
		if (byId.has(id)) continue;
		byId.set(id, {
			corpus_id: id,
			tier: "federal-statute",
			jurisdiction: "US",
			jurisdiction_label: "Federal",
			code: uscCite(u.title),
			title_num: u.title,
			name: u.title_name || `Title ${u.title}`,
			desk: mapRawDeskToId("", u.title),
			agencies: ["U.S. Congress"],
			edition: u.release_point || null,
			section_count: u.section_count || 0,
			summary: `${u.section_count || 0} sections${u.positive_law ? " · Positive law" : ""}`,
			installed: true,
			linked_titles: [],
			status_label: "Installed"
		});
	}
	if (![...byId.values()].some((c) => c.tier === "federal-statute" && !c.installed)) {
		const matchedTitles = [...installedSet].filter((n) => KNOWN_TITLE_AUTHORITIES[n]);
		const uscSourceTitles = matchedTitles.length ? matchedTitles : [
			29,
			40,
			49
		];
		for (const tNum of uscSourceTitles) {
			const auth = KNOWN_TITLE_AUTHORITIES[tNum];
			if (!auth) continue;
			const id = `us:usc:${auth.statuteCode.split("§§")[0].trim().replace(/\s+/g, "-").toLowerCase()}`;
			if (byId.has(id)) continue;
			byId.set(id, {
				corpus_id: id,
				tier: "federal-statute",
				jurisdiction: "US",
				jurisdiction_label: "Federal",
				code: auth.statuteCode,
				name: auth.statuteLabel,
				desk: mapRawDeskToId("", tNum),
				agencies: ["U.S. Congress"],
				summary: auth.summary || `Federal statutory authority underlying ${tNum} CFR rulemaking and federal agency mandate.`,
				installed: false,
				linked_titles: installedSet.has(tNum) ? [tNum] : [],
				external_url: auth.statuteHref,
				status_label: installedSet.has(tNum) ? `Linked · ${tNum} CFR` : "Statutory reference"
			});
		}
	}
	return [...byId.values()];
}
function findSystemFramework(tier, jurisdiction, code) {
	const all = allSystemFrameworks();
	const t = tier.toLowerCase();
	const j = jurisdiction.toLowerCase();
	const cd = code.toLowerCase();
	return all.find((c) => c.tier.toLowerCase() === t && (c.jurisdiction || "").toLowerCase() === j && String(c.code || "").toLowerCase() === cd) || null;
}
function jurisdictionStackForTitle(titleNum) {
	const t = Number(titleNum) || state.currentTitle;
	const known = KNOWN_TITLE_AUTHORITIES[t] || null;
	const nodes = [];
	if (known) nodes.push({
		tier: "federal-statute",
		ref_tier: "usc",
		code: known.statuteCode,
		label: known.statuteLabel,
		href: corpusHashFor({
			corpus_id: `us:usc:${known.statuteCode.split("§§")[0].trim().replace(/\s+/g, "-").toLowerCase()}`,
			tier: "federal-statute",
			jurisdiction: "US",
			code: known.statuteCode
		}),
		meta: "Enabling statute"
	});
	const cur = state.corpora.find((c) => c.tier === "federal-reg" && c.title_num === t);
	nodes.push({
		tier: "federal-reg",
		ref_tier: "cfr",
		code: `${t} CFR`,
		label: cur?.name || `Title ${t}`,
		current: true,
		meta: "Codified regulation"
	});
	nodes.push({
		tier: "federal-register",
		ref_tier: "fr",
		code: "Federal Register",
		label: known?.frNote || `Daily rulemaking & amendments for ${t} CFR`,
		href: "#/news",
		meta: "Daily rulemaking"
	});
	return {
		corpus_id: corpusIdForTitle(t),
		nodes
	};
}
function deskFilterRibbonHtml(activeDesk = state.activeDesk, corpora = state.corpora) {
	const counts = /* @__PURE__ */ new Map([["all", corpora.length]]);
	for (const c of corpora) {
		const d = c.desk || "ehs";
		if (d !== "all") counts.set(d, (counts.get(d) || 0) + 1);
	}
	const visibleDesks = DESK_DEFS.filter((d) => d.id === "all" || (counts.get(d.id) || 0) > 0);
	if (visibleDesks.length <= 2 && corpora.length < 2) return "";
	return `<div class="desk-ribbon" role="group" aria-label="Filter by federal topic">${visibleDesks.map((d) => {
		const on = activeDesk === d.id;
		const count = counts.get(d.id) || 0;
		return `<button type="button" class="desk-pill${on ? " is-active" : ""}" data-desk="${escapeHtml(d.id)}" aria-pressed="${on}">
      <span>${escapeHtml(d.label)}</span>${count ? `<span class="desk-pill-count">${count}</span>` : ""}
    </button>`;
	}).join("")}</div>`;
}
// src/components/popover.ts
var activePopovers = /* @__PURE__ */ new Set();
var customClosers = /* @__PURE__ */ new Set();
function registerPopoverCloser(fn) {
	customClosers.add(fn);
	return () => customClosers.delete(fn);
}
function closeAllPopovers(except = null, returnFocus = false) {
	for (const ctrl of [...activePopovers]) if (ctrl !== except && ctrl.isOpen()) ctrl.close(returnFocus);
	for (const fn of [...customClosers]) if (fn !== except) fn(false);
}
function getAnchorRect(anchor) {
	if (!anchor) return {
		left: Math.max(8, window.innerWidth / 2 - 140),
		right: Math.min(window.innerWidth - 8, window.innerWidth / 2 + 140),
		top: 120,
		bottom: 120,
		width: 280,
		height: 0
	};
	if ("getBoundingClientRect" in anchor && typeof anchor.getBoundingClientRect === "function") return anchor.getBoundingClientRect();
	return anchor;
}
function positionPopover(el, anchor, { offset = 6, placement = "auto", padding = 10 } = {}) {
	if (!el) return;
	const r = getAnchorRect(anchor);
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const below = r.bottom + offset;
	const above = r.top - offset - h;
	const preferTop = placement === "top" || placement === "auto" && below + h > vh - padding && (above >= padding || r.top > vh - r.bottom);
	const top = Math.max(padding, Math.min(preferTop ? above : below, Math.max(padding, vh - h - padding)));
	const left = Math.max(padding, Math.min(r.left, Math.max(padding, vw - w - padding)));
	el.style.transformOrigin = preferTop ? "bottom left" : "top left";
	el.style.left = `${Math.round(left)}px`;
	el.style.top = `${Math.round(top)}px`;
}
function createPopover({ el = null, triggerSelector = null, placement = "auto", offset = 6, padding = 10, closeOnRoute = true, scrollContainer = null, onOpen = null, onClose = null } = {}) {
	let currentAnchor = null;
	let returnFocusEl = null;
	let interactive = true;
	let outsideBound = false;
	let bindTimer = null;
	function setExpanded(trigger, expanded) {
		if (trigger && trigger instanceof Element && trigger.hasAttribute("aria-expanded")) trigger.setAttribute("aria-expanded", String(expanded));
	}
	function onOutsidePointerDown(e) {
		if (!el || el.hidden) return;
		const t = e.target;
		if (!t) return;
		if (el.contains(t)) return;
		if (triggerSelector && t instanceof Element && t.closest(triggerSelector)) return;
		if (currentAnchor instanceof Element && currentAnchor.contains(t)) return;
		ctrl.close(false);
	}
	function onDocumentKeydown(e) {
		if (e.key === "Escape" && el && !el.hidden) {
			e.preventDefault();
			e.stopPropagation();
			ctrl.close(true);
		}
	}
	function onContainerScroll() {
		if (!el || el.hidden) return;
		if (!interactive) ctrl.close(false);
	}
	function cleanupListeners() {
		if (bindTimer !== null) clearTimeout(bindTimer);
		bindTimer = null;
		if (outsideBound) {
			document.removeEventListener("pointerdown", onOutsidePointerDown, true);
			document.removeEventListener("keydown", onDocumentKeydown, true);
			if (scrollContainer) scrollContainer.removeEventListener("scroll", onContainerScroll);
			outsideBound = false;
		}
	}
	const ctrl = {
		el,
		isOpen: () => Boolean(el && !el.hidden),
		isInteractive: () => interactive,
		getAnchor: () => currentAnchor,
		setInteractive(next) {
			interactive = Boolean(next);
		},
		reposition(anchor = currentAnchor) {
			if (!el || el.hidden) return;
			if (anchor) currentAnchor = anchor;
			positionPopover(el, currentAnchor, {
				offset,
				placement,
				padding
			});
		},
		open(anchor, content, opts = {}) {
			if (!el) return;
			if (opts.closeOthers !== false) closeAllPopovers(ctrl, false);
			interactive = opts.interactive !== false;
			currentAnchor = anchor || null;
			returnFocusEl = opts.returnFocus !== void 0 ? opts.returnFocus : anchor instanceof Element ? anchor : document.activeElement;
			if (typeof content === "string") el.innerHTML = content;
			else if (typeof content === "function") content(el);
			if (opts.refTier) el.dataset.refTier = opts.refTier;
			else delete el.dataset.refTier;
			el.hidden = false;
			el.classList.toggle("is-peek", !interactive);
			positionPopover(el, currentAnchor, {
				offset: opts.offset ?? offset,
				placement: opts.placement ?? placement,
				padding: opts.padding ?? padding
			});
			if (currentAnchor instanceof Element) setExpanded(currentAnchor, true);
			cleanupListeners();
			bindTimer = setTimeout(() => {
				if (!el || el.hidden) return;
				document.addEventListener("pointerdown", onOutsidePointerDown, true);
				document.addEventListener("keydown", onDocumentKeydown, true);
				if (scrollContainer) scrollContainer.addEventListener("scroll", onContainerScroll, { passive: true });
				outsideBound = true;
			}, 0);
			if (opts.focusSelector) el.querySelector(opts.focusSelector)?.focus?.({ preventScroll: true });
			if (onOpen) onOpen(el, currentAnchor);
		},
		close(returnFocus = true) {
			if (!el || el.hidden) return;
			el.hidden = true;
			delete el.dataset.refTier;
			el.classList.remove("is-peek");
			cleanupListeners();
			const prevAnchor = currentAnchor;
			const prevReturn = returnFocusEl;
			currentAnchor = null;
			returnFocusEl = null;
			if (prevAnchor instanceof Element) setExpanded(prevAnchor, false);
			if (onClose) onClose(el, prevAnchor);
			if (returnFocus && prevReturn && "focus" in prevReturn && typeof prevReturn.focus === "function") prevReturn.focus({ preventScroll: true });
		}
	};
	activePopovers.add(ctrl);
	if (closeOnRoute && typeof window !== "undefined") window.addEventListener("hashchange", () => ctrl.close(false));
	return ctrl;
}
// src/nav.ts
var NAV_PANELS = {
	reader: "Contents",
	corpus: "Framework",
	projects: "Workspaces",
	library: "Library",
	settings: "Settings",
	history: "Recent"
};
var NAV_TARGETS = [
	"overview",
	"projects",
	"news",
	"library",
	"settings",
	"home",
	"reader"
];
var navState = (() => {
	let st = {};
	try {
		st = JSON.parse(lsGet("railState") || "{}") || {};
	} catch {
		st = {};
	}
	const w = Number(st.width) || parseInt(lsGet("sidebarW") || "", 10) || 0;
	return {
		panel: st.panel === "corpus" ? "corpus" : "reader",
		collapsed: st.collapsed != null ? Boolean(st.collapsed) : lsGet("sidebarHidden") === "1",
		mode: st.mode === "flyout" ? "flyout" : "pinned",
		width: w >= 220 && w <= 560 ? w : null,
		railCompact: Boolean(st.railCompact)
	};
})();
var HAS_DOC = typeof document !== "undefined";
state.navRetracted = HAS_DOC ? document.documentElement.classList.contains("drawer-retracted") : false;
state.historyFor = "overview";
var mqMobile = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 900px)") : {
	matches: false,
	media: "(max-width: 900px)",
	addEventListener() {},
	removeEventListener() {}
};
var mqNarrow = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 1200px)") : {
	matches: false,
	media: "(max-width: 1200px)",
	addEventListener() {},
	removeEventListener() {}
};
var railEl = HAS_DOC ? document.getElementById("activity-rail") : null;
var drawerEl = {
	pip: HAS_DOC ? document.getElementById("drawer-pip") : null,
	title: HAS_DOC ? document.getElementById("drawer-title") : null,
	meta: HAS_DOC ? document.getElementById("drawer-meta") : null,
	acts: HAS_DOC ? document.getElementById("drawer-acts") : null,
	mode: HAS_DOC ? document.getElementById("drawer-mode") : null,
	close: HAS_DOC ? document.getElementById("drawer-close") : null
};
function saveNav() {
	lsSet("railState", JSON.stringify(navState));
}
/**
* Returns true ONLY while the user is inside a legal framework:
* - Framework Start page (`#/title/{n}/`, `#/corpus/{tier}/{jur}/{code}/`)
* - Part Table of Contents or Full Part (`#/title/{n}/part/{p}`, `#/part/{p}`)
* - Section Reader (`#/title/{n}/section/{id}`, `#/section/{id}`)
*/
function isFrameworkRoute(path = state.activeRoute) {
	const p = (path || "/").split("?")[0] || "/";
	if (/^\/corpus\/(?!state\/|county\/)/.test(p)) return true;
	if (/^\/usc\/\d+(?:\/|$)/.test(p)) return true;
	if (/^\/constitution(?:\/|$)/.test(p)) return true;
	if (/^\/law\/[^/]+/.test(p)) return true;
	if (state.noTitles) return false;
	return /^\/(?:title\/\d+(?:\/(?:$|part\/|section\/))|title\/\d+$|part\/|section\/)/.test(p);
}
var isFly = () => navState.mode === "flyout" || mqMobile.matches || mqNarrow.matches && Boolean(dom.layout?.classList.contains("chat-open"));
var flyOpen = () => HAS_DOC && document.body.classList.contains("nav-open");
var drawerShown = () => {
	if (!isFrameworkRoute()) return false;
	return isFly() ? flyOpen() : !navState.collapsed && !state.navRetracted;
};
function routeTarget(path = state.activeRoute) {
	const p = (path || "/").split("?")[0] || "/";
	if (p === "/") return "overview";
	if (p.startsWith("/corpus/")) return "corpus";
	if (/^\/usc\/\d+/.test(p)) return "corpus";
	if (/^\/constitution(?:\/|$)/.test(p)) return "corpus";
	if (/^\/law\/[^/]+/.test(p)) return "corpus";
	if (/^\/title\/\d+\/?$/.test(p)) return "home";
	const rest = p.replace(/^\/title\/\d+/, "");
	if (rest.startsWith("/library")) return "library";
	if (rest.startsWith("/projects")) return "projects";
	if (rest.startsWith("/news")) return "news";
	if (rest.startsWith("/settings")) return "settings";
	if (rest.startsWith("/help")) return "help";
	if (rest.startsWith("/search")) return "overview";
	return "reader";
}
function announce(text) {
	const live = HAS_DOC ? document.getElementById("nav-live") : null;
	if (live) live.textContent = text;
}
function applyNav() {
	if (!HAS_DOC || !dom.sidebar || !railEl) return;
	const root = document.documentElement;
	const inFw = isFrameworkRoute();
	const fly = isFly();
	if ((!fly || !inFw) && flyOpen()) document.body.classList.remove("nav-open");
	root.classList.toggle("in-framework", inFw);
	root.classList.toggle("rail-compact", !inFw && navState.railCompact);
	root.classList.toggle("drawer-fly", fly);
	root.classList.toggle("drawer-collapsed", inFw && !fly && navState.collapsed);
	root.classList.toggle("drawer-retracted", !inFw || !fly && !navState.collapsed && Boolean(state.navRetracted));
	const shown = drawerShown();
	dom.sidebar.inert = !shown;
	const activePanel = routeTarget() === "corpus" ? "corpus" : "reader";
	navState.panel = activePanel;
	for (const el of dom.sidebar.querySelectorAll(".drawer-panel")) el.hidden = el.dataset.panel !== activePanel;
	const activeTier = activePanel === "corpus" && state.activeCorpus ? refTierForCorpus(state.activeCorpus) : "cfr";
	dom.sidebar.dataset.refTier = activeTier;
	if (drawerEl.pip) drawerEl.pip.dataset.refTier = activeTier;
	drawerEl.title.textContent = activePanel === "corpus" && state.activeCorpus ? state.activeCorpus.code : state.noTitles ? "Contents" : `${state.currentTitle} CFR`;
	drawerEl.meta.textContent = panelMeta(activePanel);
	drawerEl.acts.innerHTML = panelActions(activePanel);
	const pinned = navState.mode === "pinned";
	if (drawerEl.mode) {
		drawerEl.mode.setAttribute("aria-pressed", String(pinned));
		drawerEl.mode.title = pinned ? "Float the framework drawer over the page" : "Pin the framework drawer beside the page";
		drawerEl.mode.setAttribute("aria-label", drawerEl.mode.title);
		drawerEl.mode.innerHTML = icon(pinned ? "pin" : "pinOff");
		drawerEl.mode.hidden = mqMobile.matches;
	}
	const route = routeTarget();
	for (const b of railEl.querySelectorAll(".ar-btn")) {
		const t = b.dataset.target;
		let isActive = false;
		if (t === "reader") {
			isActive = inFw && (route === "reader" || route === "corpus" || shown && route !== "home");
			b.setAttribute("aria-expanded", String(shown));
		} else if (t === "home") isActive = route === "home";
		else isActive = t === route;
		b.classList.toggle("is-active", isActive);
		if (b.tagName === "A") {
			if (t === route) b.setAttribute("aria-current", "page");
			else b.removeAttribute("aria-current");
		}
	}
	if (dom.navToggle) {
		dom.navToggle.title = inFw ? "Show or hide framework drawer (⌘B)" : "Expand or compact sidebar (⌘B)";
		dom.navToggle.setAttribute("aria-label", inFw ? "Show or hide framework drawer" : "Expand or compact sidebar");
		dom.navToggle.setAttribute("aria-expanded", String(inFw ? shown : !navState.railCompact));
	}
	document.body.classList.remove("drawer-library");
	updateSidebarFrameworkHighlight();
}
function panelMeta(panel) {
	if (panel === "corpus" && state.activeCorpus) {
		const meta = TIER_META[state.activeCorpus.tier];
		if (state.activeCorpus.tier === "federal-constitution") return meta?.subtitle || "";
		return meta?.short || state.activeCorpus.jurisdiction_label || "";
	}
	if (panel === "reader") {
		if (state.noTitles) return "No titles installed";
		return state.installedTitles.find((t) => t.title === state.currentTitle)?.name || state.metaInfo.name || `Title ${state.currentTitle}`;
	}
	return "";
}
function panelActions(panel) {
	if (panel === "reader" && !state.noTitles) {
		if (!(routeTarget() === "home")) return `<a class="drawer-start-pill" href="#/title/${state.currentTitle}/" title="Open Title ${state.currentTitle} start page">${icon("grid")}<span>Start</span></a>`;
	}
	return "";
}
var panelRenderers = /* @__PURE__ */ new Map();
function registerDrawerPanel(panel, renderFn) {
	if (panel && typeof renderFn === "function") panelRenderers.set(panel, renderFn);
}
function renderPanel(panel) {
	const fn = panelRenderers.get(panel);
	if (fn) fn();
}
function focusPanel(panel) {
	const el = document.getElementById(`panel-${panel}`);
	if (!el) return;
	const first = panel === "reader" ? dom.treeFilter : el.querySelector("input, button, a[href], select, textarea");
	if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
}
function openPanel(panel, { focus = false, toggle = false } = {}) {
	if (panel === "projects") {
		window.location.hash = "#/projects";
		return;
	}
	if (panel === "library") {
		window.location.hash = "#/library";
		return;
	}
	if (panel === "settings") {
		window.location.hash = "#/settings";
		return;
	}
	if (panel === "history") {
		window.location.hash = "#/";
		return;
	}
	if (!isFrameworkRoute()) {
		if (state.noTitles) {
			window.location.hash = "#/library";
			return;
		}
		navState.collapsed = false;
		state.navRetracted = false;
		saveNav();
		window.location.hash = `#/title/${state.currentTitle}/`;
		if (focus) setTimeout(() => focusPanel("reader"), 60);
		return;
	}
	const resolved = routeTarget() === "corpus" ? "corpus" : "reader";
	if (toggle && drawerShown() && navState.panel === resolved) {
		closeDrawer();
		return;
	}
	navState.panel = resolved;
	if (isFly()) document.body.classList.add("nav-open");
	else {
		navState.collapsed = false;
		state.navRetracted = false;
	}
	saveNav();
	renderPanel(resolved);
	applyNav();
	emit("nav:panel-opened", { panel: resolved });
	if (focus) focusPanel(resolved);
	announce(`${NAV_PANELS[resolved]} drawer open`);
}
function closeDrawer() {
	const hadFocus = dom.sidebar?.contains(document.activeElement);
	if (isFly()) document.body.classList.remove("nav-open");
	else navState.collapsed = true;
	saveNav();
	applyNav();
	if (hadFocus) railEl?.querySelector(".ar-btn.is-active, .ar-btn[aria-current]")?.focus();
	announce("Framework drawer closed");
}
function toggleDrawer(focus = true) {
	if (!isFrameworkRoute()) {
		navState.railCompact = !navState.railCompact;
		saveNav();
		applyNav();
		announce(navState.railCompact ? "Sidebar compacted" : "Sidebar expanded");
		return;
	}
	if (drawerShown()) closeDrawer();
	else openPanel(routeTarget() === "corpus" ? "corpus" : "reader", { focus });
}
function goTarget(t) {
	if (t === "overview") window.location.hash = "#/";
	else if (t === "projects") window.location.hash = "#/projects";
	else if (t === "library") window.location.hash = "#/library";
	else if (t === "settings") window.location.hash = "#/settings";
	else if (t === "help") window.location.hash = "#/help";
	else if (t === "home") window.location.hash = state.noTitles ? "#/library" : `#/title/${state.currentTitle}/`;
	else if (t === "news") {
		if (routeTarget() === "news") dom.main.scrollTop = 0;
		else window.location.hash = "#/news";
	} else if (t === "reader") openPanel("reader", { focus: true });
}
function setNavMode(mode) {
	navState.mode = mode === "flyout" ? "flyout" : "pinned";
	if (navState.mode === "pinned") navState.collapsed = false;
	saveNav();
	applyNav();
	emit("nav:mode-changed");
}
function syncNavToRoute(path) {
	const inFw = isFrameworkRoute(path);
	const t = routeTarget(path);
	if (HAS_DOC) document.body.classList.remove("nav-open");
	state.navRetracted = !inFw;
	if (inFw) {
		navState.panel = t === "corpus" ? "corpus" : "reader";
		saveNav();
		renderPanel(navState.panel);
	}
	applyNav();
}
function updateRailHome() {
	const home = HAS_DOC ? document.getElementById("ar-home") : null;
	if (home) {
		if (state.noTitles) {
			home.href = "#/library";
			home.dataset.tip = "Browse library";
			home.setAttribute("aria-label", "Browse library");
		} else {
			home.href = `#/title/${state.currentTitle}/`;
			const t = state.installedTitles.find((x) => x.title === state.currentTitle);
			home.dataset.tip = `Title ${state.currentTitle} start`;
			home.setAttribute("aria-label", `Title ${state.currentTitle}${t ? " " + t.name : ""} start`);
		}
	}
	renderSidebarFrameworks();
}
function updateRailBadge() {
	if (!HAS_DOC) return;
	const badge = document.getElementById("ar-library-badge");
	const libPill = document.getElementById("ar-library-pill");
	const projPill = document.getElementById("ar-projects-count");
	const newsPill = document.getElementById("ar-news-pill");
	const busy = Boolean(state.jobs.current || state.jobs.queued.length);
	const libData = state.navLibData;
	const stale = libData?.titles ? libData.titles.filter(isStale).length : 0;
	if (badge) {
		badge.hidden = !busy && !stale;
		badge.className = `ar-badge${busy ? " is-busy" : stale ? " is-stale" : ""}`;
		const btn = badge.closest(".ar-btn");
		if (btn) btn.dataset.tip = busy ? "Library · downloading" : stale ? `Library · ${plural(stale, "update")}` : "Library";
	}
	if (libPill) {
		if (busy) {
			libPill.hidden = false;
			libPill.textContent = "Sync";
			libPill.className = "ar-pill is-busy";
		} else if (stale > 0) {
			libPill.hidden = false;
			libPill.textContent = `${stale}`;
			libPill.className = "ar-pill is-warn";
		} else libPill.hidden = true;
	}
	if (projPill) {
		const n = loadProjects().length;
		projPill.hidden = n === 0;
		projPill.textContent = n ? String(n) : "";
	}
	if (newsPill) {
		const frCount = Number(state.navNewsStatus?.articles || 0);
		newsPill.hidden = frCount === 0;
		newsPill.textContent = frCount ? String(frCount) : "";
	}
	renderSidebarFrameworks();
}
function updateSidebarFrameworkHighlight() {
	if (!HAS_DOC) return;
	const box = document.getElementById("ar-frameworks");
	if (!box) return;
	const inFw = isFrameworkRoute();
	const activeHash = window.location.hash || "#/";
	for (const link of box.querySelectorAll(".ar-fw-row")) {
		const tNum = Number(link.dataset.fwTitle || 0);
		const cid = link.dataset.fwId || "";
		const isCurrent = inFw && (tNum > 0 && routeTarget() !== "corpus" && tNum === state.currentTitle || cid !== "" && state.activeCorpus?.corpus_id === cid || link.getAttribute("href") === activeHash);
		link.classList.toggle("is-current", isCurrent);
	}
}
function shortFrameworkName(c) {
	if (c.tier === "federal-reg") {
		const map = {
			21: "Food & Drugs",
			26: "Internal Revenue",
			29: "Labor",
			40: "Environment",
			48: "Federal Acquisition",
			49: "Transportation"
		};
		if (c.title_num && map[c.title_num]) return map[c.title_num];
	}
	if (c.tier === "federal-register") return "Federal Register";
	if (c.tier === "federal-statute") {
		if (c.code.startsWith("21")) return "Food & Drug Act";
		if (c.code.startsWith("26")) return "Internal Revenue";
		if (c.code.startsWith("29")) return "Labor Statutes";
		if (c.code.startsWith("41")) return "Public Contracts";
		if (c.code.startsWith("42")) return "Public Health & Env";
		if (c.code.startsWith("49")) return "Transportation";
	}
	return c.name;
}
function renderSidebarFrameworks() {
	if (!HAS_DOC) return;
	const box = document.getElementById("ar-frameworks");
	if (!box) return;
	const all = allSystemFrameworks();
	const staleSet = new Set((state.navLibData?.titles || []).filter(isStale).map((t) => t.title));
	const usc = all.filter((c) => c.tier === "federal-statute");
	const cfr = all.filter((c) => c.tier === "federal-reg");
	const fr = all.filter((c) => c.tier === "federal-register");
	const rowHtml = (c, opts = {}) => {
		const refTier = refTierForCorpus(c);
		const href = corpusHashFor(c);
		const code = c.tier === "federal-reg" ? `${c.code} CFR` : c.tier === "federal-statute" ? c.code.split("§§")[0].trim() : c.code;
		const displayName = shortFrameworkName(c);
		return `<a class="ar-fw-row${c.installed !== false ? "" : " is-ref"}" href="${escapeHtml(href)}" data-ref-tier="${refTier}" data-fw-id="${escapeHtml(c.corpus_id)}"${c.title_num ? ` data-fw-title="${c.title_num}"` : ""} title="${escapeHtml(c.code + " — " + c.name)}">
      <span class="ar-fw-bar" aria-hidden="true"></span>
      <span class="ar-fw-name">${escapeHtml(displayName)}</span>
      <span class="ar-fw-code">${escapeHtml(code)}</span>
      ${opts.stale ? "<span class=\"stat-dot is-stale ar-fw-stale\" title=\"Update available\" aria-label=\"Update available\"></span>" : ""}
    </a>`;
	};
	const parts = [];
	parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">Constitution</div><a class="ar-fw-row" href="#/constitution/" data-ref-tier="const" data-fw-id="us:constitution" title="U.S. Const. — Constitution of the United States">
      <span class="ar-fw-bar" aria-hidden="true"></span>
      <span class="ar-fw-name">U.S. Constitution</span>
      <span class="ar-fw-code">Const.</span>
    </a></div>`);
	if (usc.length) {
		const installedUsc = usc.filter((c) => c.installed);
		const shownUsc = installedUsc.length ? [...installedUsc, ...usc.filter((c) => !c.installed)].slice(0, Math.max(3, installedUsc.length)) : usc.slice(0, 3);
		parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">Statutes (U.S.C.)</div>${shownUsc.map((c) => rowHtml(c)).join("")}</div>`);
	}
	if (cfr.length) parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">Regulations (CFR)</div>${cfr.map((c) => rowHtml(c, { stale: Boolean(c.title_num && staleSet.has(c.title_num)) })).join("")}</div>`);
	if (fr.length) parts.push(`<div class="ar-fw-group"><div class="ar-fw-tier">Rulemaking (FR)</div>${fr.map((c) => rowHtml(c, { stale: Boolean(c.update_available) })).join("")}</div>`);
	box.innerHTML = parts.join("") || "<div class=\"ar-fw-empty\">No frameworks installed</div>";
	updateSidebarFrameworkHighlight();
}
function renderCorpusDrawer(corpus = state.activeCorpus) {
	if (!HAS_DOC) return;
	const el = document.getElementById("panel-corpus");
	if (!el) return;
	if (!corpus) {
		el.innerHTML = "<div class=\"dr-scroll\"><p class=\"dr-note\">Select a federal framework to view its outline.</p></div>";
		return;
	}
	const meta = TIER_META[corpus.tier] || TIER_META["federal-statute"];
	const refTier = refTierForCorpus(corpus);
	const startHref = corpusHashFor(corpus);
	const linked = (corpus.linked_titles || []).map((n) => state.installedTitles.find((t) => t.title === n)).filter((t) => Boolean(t));
	const dolOn = Boolean(state.navNewsStatus?.dol_configured);
	const frLinks = corpus.tier === "federal-register" ? `
    <section class="dr-sec">
      <h3 class="dr-label"><span>Federal Register Feeds</span></h3>
      <a class="dr-row" href="#/news?cat=rules"><span class="dr-name">Final Rules</span>${icon("chevronRight")}</a>
      <a class="dr-row" href="#/news?cat=rulemaking"><span class="dr-name">Proposed Rules</span>${icon("chevronRight")}</a>
      <a class="dr-row" href="#/news?cat=notices"><span class="dr-name">Notices</span>${icon("chevronRight")}</a>
      <a class="dr-row" href="#/news?cat=public_inspection"><span class="dr-name">Public Inspection</span>${icon("chevronRight")}</a>
      ${dolOn ? `<a class="dr-row" href="#/news?cat=enforcement"><span class="dr-name">Enforcement</span>${icon("chevronRight")}</a>` : ""}
    </section>` : "";
	const linkedHtml = linked.length ? `
    <section class="dr-sec">
      <h3 class="dr-label"><span>Linked CFR Frameworks</span><span class="dr-count">${linked.length}</span></h3>
      ${linked.map((t) => `<a class="dr-row" href="#/title/${t.title}/">
        <span class="tier-pip" data-ref-tier="cfr" aria-hidden="true"></span>
        <span class="dr-num">${t.title}</span>
        <span class="dr-name">${escapeHtml(t.name)}</span>
      </a>`).join("")}
    </section>` : "";
	const peerFrameworks = allSystemFrameworks().filter((c) => c.tier === corpus.tier && c.corpus_id !== corpus.corpus_id);
	const peersHtml = peerFrameworks.length ? `
    <section class="dr-sec">
      <h3 class="dr-label"><span>Other ${escapeHtml(meta.short)} Frameworks</span></h3>
      ${peerFrameworks.map((p) => `<a class="dr-row" href="${escapeHtml(corpusHashFor(p))}">
        <span class="tier-pip${p.installed === false ? " is-hollow" : ""}" data-ref-tier="${refTier}" aria-hidden="true"></span>
        <span class="dr-name">${escapeHtml(p.code)} · ${escapeHtml(p.name)}</span>
      </a>`).join("")}
    </section>` : "";
	el.innerHTML = `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>Framework Navigation</span></h3>
      <a class="dr-row is-current" href="${escapeHtml(startHref)}" aria-current="page">
        <span class="tier-pip" data-ref-tier="${refTier}" aria-hidden="true"></span>
        <span class="dr-name">Start page &amp; authority overview</span>
      </a>
      ${corpus.external_url ? `<a class="dr-row" href="${escapeHtml(corpus.external_url)}" target="_blank" rel="noopener noreferrer">
        <span class="dr-name">Official statutory text</span>${icon("external")}
      </a>` : ""}
    </section>
    ${frLinks}
    ${linkedHtml}
    ${peersHtml}
    <div class="dr-foot">
      <a class="dr-link" href="#/library">Browse catalog</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}
registerDrawerPanel("corpus", () => renderCorpusDrawer(state.activeCorpus));
if (railEl) {
	railEl.addEventListener("click", (e) => {
		const btn = e.target?.closest(".ar-btn");
		if (!btn) return;
		const t = btn.dataset.target;
		if (!t) return;
		if (btn.tagName === "A") {
			if (t === "news" && routeTarget() === "news") {
				e.preventDefault();
				dom.main.scrollTop = 0;
			}
			return;
		}
		if (t === "reader") openPanel("reader", {
			toggle: true,
			focus: e.detail === 0
		});
	});
	railEl.addEventListener("keydown", (e) => {
		const i = (mqMobile.matches ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]).indexOf(e.key);
		if (i < 0 && e.key !== "Home" && e.key !== "End") return;
		const items = [...railEl.querySelectorAll(".ar-btn, .ar-fw-row")].filter((el) => el.offsetParent !== null);
		const at = items.indexOf(document.activeElement);
		if (at < 0) return;
		e.preventDefault();
		items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (i ? 1 : -1) + items.length) % items.length].focus();
	});
}
drawerEl.close?.addEventListener("click", () => closeDrawer());
drawerEl.mode?.addEventListener("click", () => setNavMode(navState.mode === "pinned" ? "flyout" : "pinned"));
dom.navBackdrop?.addEventListener("click", () => closeDrawer());
dom.navToggle?.addEventListener("click", (e) => toggleDrawer(e.detail === 0));
for (const mq of [mqMobile, mqNarrow]) mq.addEventListener?.("change", () => applyNav());
state.goPending = 0;
var GO_KEYS = {
	h: "overview",
	o: "overview",
	t: "home",
	c: "reader",
	p: "projects",
	n: "news",
	l: "library",
	s: "settings"
};
if (HAS_DOC) document.addEventListener("keydown", (e) => {
	const active = document.activeElement;
	const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
	const mod = e.metaKey || e.ctrlKey;
	if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
		e.preventDefault();
		toggleDrawer();
		return;
	}
	if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d" && (state.currentSection && routeTarget() === "reader" || (state.currentUscSection || state.currentConstUnit) && routeTarget() === "corpus")) {
		e.preventDefault();
		emit("pin:open");
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
	if (state.goPending && Date.now() - state.goPending < 1200 && GO_KEYS[k]) {
		e.preventDefault();
		state.goPending = 0;
		goTarget(GO_KEYS[k]);
		return;
	}
	state.goPending = k === "g" ? Date.now() : 0;
});
on("projects:changed", () => {
	updateRailBadge();
});
on("title:switched", () => {
	updateRailHome();
	applyNav();
});
on("titles:refreshed", () => {
	updateRailHome();
	updateRailBadge();
});
// src/components/sidebar.ts
var LEAF_TYPES = /* @__PURE__ */ new Set(["section", "appendix"]);
var AGENCY_META = {
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
	return (AGENCY_META[state.currentTitle] || {})[agencyKeyForNode(node)] || null;
}
var treeIdx = {
	nodes: [],
	parent: [],
	sections: /* @__PURE__ */ new Map(),
	parts: /* @__PURE__ */ new Map(),
	agencies: /* @__PURE__ */ new Map(),
	partList: [],
	agencyList: []
};
state.visited = loadVisited();
state.treePromise = null;
state.currentTreeKey = null;
state.currentPartKey = null;
state.currentAgencyKey = null;
state.rootViewMode = lsGet("rootViewMode") === "all-parts" ? "all-parts" : "agencies";
state.sideView = state.rootViewMode;
state.treeFilterState = null;
function visitedKey() {
	return state.currentTitle === 29 ? "visited" : "visited-" + state.currentTitle;
}
function loadVisited() {
	try {
		return new Set(JSON.parse(lsGet(visitedKey()) || "[]"));
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
async function switchTitle(newTitle) {
	if (newTitle === state.currentTitle && state.treeData) return;
	state.currentTitle = newTitle;
	const titleMeta = state.installedTitles.find((t) => t.title === newTitle);
	if (titleMeta) state.metaInfo = titleMeta;
	dom.chatText.placeholder = `Ask about this provision or anything in ${newTitle} CFR…`;
	emit("title:switched", { title: newTitle });
	state.treePromise = null;
	state.treeData = null;
	treeIdx.nodes = [];
	treeIdx.parent = [];
	treeIdx.sections = /* @__PURE__ */ new Map();
	treeIdx.parts = /* @__PURE__ */ new Map();
	treeIdx.agencies = /* @__PURE__ */ new Map();
	treeIdx.partList = [];
	treeIdx.agencyList = [];
	state.currentTreeKey = null;
	state.currentPartKey = null;
	state.currentAgencyKey = null;
	clearFilterQuietly();
	state.visited = loadVisited();
	state.sideView = state.rootViewMode;
	dom.tree.innerHTML = skeletonHtml("tree", "Loading contents…");
	await ensureTreeLoaded();
}
function ensureTreeLoaded() {
	if (!state.treePromise) state.treePromise = fetchTitleTree(state.currentTitle).then((data) => {
		state.treeData = data;
		indexTree(data);
		renderSidebar();
	}).catch((err) => {
		state.treePromise = null;
		const msg = err instanceof Error ? err.message : "Load failed";
		dom.tree.innerHTML = `<div class="side-empty">Couldn't load the contents (${escapeHtml(msg)}).</div>`;
		throw err;
	});
	return state.treePromise;
}
function normalizeForMatch(s) {
	return " " + String(s ?? "").toLowerCase().replace(/[§,;:()[\]"'\/–—]/g, " ").replace(/\s+/g, " ").trim() + " ";
}
function formatRange(range) {
	return String(range || "").trim().replace(/\s*[–-]\s*/g, "–");
}
function isAgencyNode(node) {
	return Boolean(node && (node.t === "chapter" || node.t === "subtitle" && String(node.id) === "A"));
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
	const meta = agencyMeta(node);
	const roman = /^[IVXLC]+$/.test(String(node.id)) ? node.id : "";
	return {
		code: meta?.code || (node.t === "subtitle" ? `Sub. ${node.id}` : roman ? `Ch. ${roman}` : "Ch."),
		name: meta?.name || (node.d || node.l || "").trim().replace(/^Chapter\s+[IVXLC]+\s*[—–-]\s*/i, "").replace(/,\s*Department of [A-Z][A-Za-z ]+$/, ""),
		range: formatRange(node.range)
	};
}
function agencyOf(k) {
	for (let p = k; p >= 0; p = treeIdx.parent[p]) if (isAgencyNode(treeIdx.nodes[p])) return p;
	return null;
}
function partForSection(sectionId) {
	for (let p = treeIdx.sections.get(String(sectionId)); p != null && p >= 0; p = treeIdx.parent[p]) if (treeIdx.nodes[p]?.t === "part") return treeIdx.nodes[p].id || null;
	return null;
}
function indexTree(root) {
	const walk = (node, parentKey) => {
		const k = treeIdx.nodes.length;
		node.k = k;
		node.l = cleanInlineLabel(node.l);
		node.d = cleanInlineLabel(node.d);
		treeIdx.nodes.push(node);
		treeIdx.parent.push(parentKey);
		const label = node.l;
		const desc = node.d;
		let hayText = desc && desc !== label ? `${label} ${desc}` : label || desc;
		node.partCount = 0;
		if (isAgencyNode(node)) {
			treeIdx.agencies.set(agencyKeyForNode(node), k);
			treeIdx.agencyList.push(k);
			const meta = agencyMeta(node);
			if (meta) hayText += ` ${meta.code} ${meta.name}`;
		}
		node.hay = normalizeForMatch(hayText);
		if (node.t && LEAF_TYPES.has(node.t)) {
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
			node.n += child.n || 0;
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
	for (let p = k; p >= 0; p = treeIdx.parent[p]) if (treeIdx.nodes[p]?.t === "part") return p;
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
	return [String(node.id || ""), d];
}
function tooltipFor(node) {
	const l = (node.l || "").trim();
	const d = (node.d || "").trim();
	return d && d !== l ? `${l} — ${d}` : l || d;
}
function hl(str) {
	const text = String(str ?? "");
	const re = state.treeFilterState && state.treeFilterState.re;
	if (!re) return escapeHtml(text);
	let out = "";
	let last = 0;
	for (const m of text.matchAll(re)) {
		const start = (m.index ?? 0) + m[1].length;
		out += escapeHtml(text.slice(last, start)) + "<mark>" + escapeHtml(m[2]) + "</mark>";
		last = start + m[2].length;
	}
	return out + escapeHtml(text.slice(last));
}
function itemHtml(node) {
	const leaf = Boolean(node.t && LEAF_TYPES.has(node.t));
	const [num, text] = rowParts(node);
	const href = `#/${leaf ? "section" : "part"}/${encodeURIComponent(String(node.id || ""))}`;
	const isPage = node.k === state.currentTreeKey;
	const isAncestor = !isPage && !leaf && node.k === state.currentPartKey;
	const cls = ["side-item", leaf ? "is-section" : "is-part"];
	if (isPage) cls.push("current");
	if (isAncestor) cls.push("ancestor-current");
	if (leaf && state.visited.has(String(node.id))) cls.push("visited");
	return `<a class="${cls.join(" ")}" href="${href}" data-k="${node.k}" title="${escapeHtml(tooltipFor(node))}"${isPage ? " aria-current=\"page\"" : ""}><span class="side-num">${hl(num)}</span><span class="side-text">${hl(text)}</span></a>`;
}
function agencyRowHtml(node) {
	const info = agencyInfo(node);
	const isAncestor = node.k === state.currentAgencyKey;
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
state.foldedGroups = (() => {
	try {
		return new Set(JSON.parse(lsGet("sideFolded") || "[]"));
	} catch {
		return /* @__PURE__ */ new Set();
	}
})();
function groupKey(part, sub) {
	return `${state.currentTitle}|${part.id}|${sub.id}`;
}
function saveFolded() {
	if (state.foldedGroups) lsSet("sideFolded", JSON.stringify([...state.foldedGroups]));
}
function setGroupOpen(group, open, save = true) {
	group.classList.toggle("is-folded", !open);
	group.querySelector(".side-group-toggle")?.setAttribute("aria-expanded", String(open));
	if (group.dataset.group && state.foldedGroups) {
		if (open) state.foldedGroups.delete(group.dataset.group);
		else state.foldedGroups.add(group.dataset.group);
		if (save) saveFolded();
	}
}
function partViewHtml(part) {
	const walk = (node) => {
		let out = "";
		for (const c of node.c || []) {
			if (c.r) continue;
			if (c.t && LEAF_TYPES.has(c.t)) out += itemHtml(c);
			else if (c.n) {
				const l = (c.l || "").trim();
				const d = (c.d || "").trim();
				if (c.t === "subpart") {
					const key = groupKey(part, c);
					const folded = Boolean(state.foldedGroups?.has(key) && !(state.currentTreeKey != null && c.k != null && isWithin(state.currentTreeKey, c.k)));
					out += `<div class="side-group${folded ? " is-folded" : ""}" data-group="${escapeHtml(key)}"><button type="button" class="side-label side-group-toggle" data-action="toggle-group" aria-expanded="${!folded}"><span class="side-group-name">${escapeHtml(d ? `${l} — ${d}` : l)}</span>${icon("chevronDown", "side-group-caret")}</button><div class="side-group-body"><div class="side-group-inner">${walk(c)}</div></div></div>`;
				} else out += `<div class="side-label minor">${escapeHtml(d || l)}</div>` + walk(c);
			}
		}
		return out;
	};
	const body = walk(part);
	const agencyKey = part.k != null ? agencyOf(part.k) : null;
	const crumbs = state.rootViewMode === "agencies" && agencyKey != null ? [{
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
	return `<div class="side-head">` + crumbsHtml(crumbs) + `<a class="side-part-title${part.k === state.currentTreeKey ? " current" : ""}" href="#/part/${encodeURIComponent(String(part.id || ""))}"${part.k === state.currentTreeKey ? " aria-current=\"page\"" : ""}>${escapeHtml((part.d || "").trim())}</a></div><div class="side-list">${body}</div>`;
}
function filterResultsHtml() {
	const f = state.treeFilterState;
	if (!f) return "";
	const q = f.q.trim();
	const fullText = `<a class="side-fulltext" href="#/search?q=${encodeURIComponent(q)}">Search the full text for “${escapeHtml(q)}”</a>`;
	if (!f.results.length) return `<div class="side-empty">Nothing matches.</div>${fullText}`;
	return groupedHtml(f.results) + fullText;
}
function updateNavTabsUI() {
	const tabs = document.getElementById("side-nav-tabs");
	if (!tabs) return;
	tabs.hidden = Boolean(state.treeFilterState);
	const isAllParts = state.rootViewMode === "all-parts";
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
	if (!state.treeData) return;
	updateNavTabsUI();
	if (state.treeFilterState) dom.tree.innerHTML = filterResultsHtml();
	else if (state.sideView === "agencies") dom.tree.innerHTML = agenciesListHtml();
	else if (state.sideView === "all-parts") dom.tree.innerHTML = partsListHtml();
	else if (typeof state.sideView === "number") {
		const node = treeIdx.nodes[state.sideView];
		dom.tree.innerHTML = isAgencyNode(node) ? agencyViewHtml(node) : partViewHtml(node);
	}
	dom.tree.scrollTop = 0;
}
function clearFilterQuietly() {
	if (!state.treeFilterState && !dom.treeFilter.value) return;
	if (state.filterTimer) clearTimeout(state.filterTimer);
	dom.treeFilter.value = "";
	state.treeFilterState = null;
}
function showAgenciesList() {
	state.rootViewMode = "agencies";
	lsSet("rootViewMode", "agencies");
	state.sideView = "agencies";
	renderSidebar();
	revealCurrent(false);
}
function showAgencyView(k) {
	state.rootViewMode = "agencies";
	lsSet("rootViewMode", "agencies");
	state.sideView = k;
	renderSidebar();
	revealCurrent(false);
}
function showPartsList() {
	state.rootViewMode = "all-parts";
	lsSet("rootViewMode", "all-parts");
	state.sideView = "all-parts";
	renderSidebar();
	revealCurrent(false);
}
function selectTreeNode(elementId) {
	if (!state.treeData) return;
	const m = /^([sp])-(.+)$/.exec(elementId);
	if (!m) return;
	const k = (m[1] === "s" ? treeIdx.sections : treeIdx.parts).get(m[2]);
	if (k === void 0) return;
	state.currentTreeKey = k;
	state.currentPartKey = partOf(k);
	state.currentAgencyKey = agencyOf(k);
	if (m[1] === "s") markVisited(m[2]);
	const switchPart = state.currentPartKey != null && state.sideView !== state.currentPartKey;
	if (switchPart && state.currentPartKey != null) state.sideView = state.currentPartKey;
	if (state.treeFilterState) {
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
	if (state.currentTreeKey == null) return;
	const markPage = (el) => {
		if (el) {
			el.classList.add("current");
			el.setAttribute("aria-current", "page");
		}
	};
	const markAncestor = (el) => {
		if (el && !el.classList.contains("current")) el.classList.add("ancestor-current");
	};
	const page = dom.tree.querySelector(`.side-item[data-k="${state.currentTreeKey}"]`);
	markPage(page);
	const folded = page?.closest(".side-group.is-folded");
	if (folded) setGroupOpen(folded, true);
	if (state.currentTreeKey === state.currentPartKey) {
		if (state.sideView === state.currentPartKey) markPage(dom.tree.querySelector(".side-part-title"));
	} else markAncestor(dom.tree.querySelector(`.side-item.is-part[data-k="${state.currentPartKey}"]`));
	markAncestor(dom.tree.querySelector(`.side-agency[data-k="${state.currentAgencyKey}"]`));
}
function clearTreeSelection() {
	if (state.currentTreeKey == null) return;
	state.currentTreeKey = null;
	state.currentPartKey = null;
	state.currentAgencyKey = null;
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
	if (state.visited.has(id)) return;
	state.visited.add(id);
	lsSet(visitedKey(), JSON.stringify([...state.visited]));
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
		const k = node.k ?? 0;
		const p = treeIdx.parent[k];
		let m = 0;
		const hay = node.hay || "";
		for (let i = 0; i < tokens.length; i++) if (hay.includes(" " + tokens[i])) m |= 1 << i;
		own[k] = m;
		if (p >= 0) {
			anc[k] = anc[p] | own[p];
			ancFull[k] = ancFull[p] || own[p] === ALL ? 1 : 0;
		}
		if (node.r || !(node.t === "part" || node.t && LEAF_TYPES.has(node.t) || isAgencyNode(node))) continue;
		if (m === ALL || m !== 0 && (m | anc[k]) === ALL && !ancFull[k]) {
			results.push(k);
			if (results.length >= 100) break;
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
	if (!state.treeData) return;
	state.treeFilterState = computeFilter(dom.treeFilter.value);
	renderSidebar();
	if (!state.treeFilterState) revealCurrent(false);
}
state.filterTimer = null;
dom.treeFilter?.addEventListener("input", () => {
	if (state.filterTimer) clearTimeout(state.filterTimer);
	state.filterTimer = setTimeout(applyTreeFilter, 120);
});
dom.treeFilter?.addEventListener("keydown", (e) => {
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
		if (state.filterTimer) clearTimeout(state.filterTimer);
		applyTreeFilter();
		const q = dom.treeFilter.value.trim();
		const first = dom.tree.querySelector(".side-item, .side-agency");
		if (first) {
			if (first.tagName === "A") {
				const href = first.getAttribute("href");
				if (href) window.location.hash = href;
			} else first.click();
		} else if (q) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
	}
});
dom.tree?.addEventListener("click", (e) => {
	const t = e.target;
	const toggle = t?.closest("[data-action=\"toggle-group\"]");
	if (toggle) {
		const group = toggle.closest(".side-group");
		if (!group) return;
		const open = group.classList.contains("is-folded");
		if (e.altKey) {
			dom.tree.querySelectorAll(".side-group").forEach((g) => setGroupOpen(g, open, false));
			saveFolded();
		} else setGroupOpen(group, open);
		return;
	}
	const action = t?.closest("[data-action]");
	if (action) {
		const kind = action.dataset.action;
		const k = parseInt(action.dataset.k || "", 10);
		clearFilterQuietly();
		if (kind === "agencies") showAgenciesList();
		else if (kind === "parts") showPartsList();
		else if (kind === "agency" && !Number.isNaN(k)) showAgencyView(k);
		else return;
		if (e.detail === 0) (dom.tree.querySelector(".current, .ancestor-current") || dom.tree.querySelector("a, button"))?.focus({ preventScroll: true });
		return;
	}
	const link = t?.closest("a");
	if (link && link.getAttribute("href") === window.location.hash && isFly() && flyOpen()) closeDrawer();
});
var sideNavTabs = typeof document !== "undefined" ? document.getElementById("side-nav-tabs") : null;
if (sideNavTabs) sideNavTabs.addEventListener("click", (e) => {
	const btn = e.target?.closest(".side-nav-tab");
	if (!btn) return;
	if (btn.dataset.mode === "agencies") showAgenciesList();
	else showPartsList();
});
dom.tree?.addEventListener("keydown", (e) => {
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
on("nav:panel-opened", ({ panel }) => {
	if (panel === "reader") requestAnimationFrame(() => revealCurrent(false));
});
// src/components/transfer_dock.ts
var DOCK_STEPS = [
	["Checking eCFR", "Connecting to eCFR"],
	["Downloading contents", "Reading the table of contents"],
	["Downloading text", "Streaming the regulation text"],
	["Reading text", "Extracting sections and appendices"],
	["Indexing", "Building the search index"],
	["Installing", "Swapping in the new edition"]
];
var dock = {
	el: typeof document !== "undefined" ? document.getElementById("transfer-dock") : null,
	min: lsGet("dockMinimized") === "1",
	key: "",
	hideT: null,
	srText: ""
};
var rate = {
	id: null,
	t: 0,
	done: 0,
	bps: 0
};
function recordJobProgress(j) {
	const streaming = Boolean(j && j.phase === "Downloading text" && (j.done || 0) > 0 && (j.total == null || j.total > 1e5));
	if (!streaming || !j || j.id !== rate.id) {
		Object.assign(rate, {
			id: streaming && j ? j.id : null,
			t: streaming ? performance.now() : 0,
			done: streaming && j ? j.done || 0 : 0,
			bps: 0
		});
		return;
	}
	const now = performance.now();
	const dt = (now - rate.t) / 1e3;
	if (dt < .5) return;
	const delta = (j.done || 0) - rate.done;
	if (delta > 0) rate.bps = rate.bps ? rate.bps * .7 + delta / dt * .3 : delta / dt;
	rate.t = now;
	rate.done = j.done || 0;
}
function fmtEta(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) return "";
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
	const label = step >= 0 ? DOCK_STEPS[step][1] : j.phase === "Waiting" ? "Starting…" : j.phase || "";
	const has = j.total != null && j.total > 0 && j.done != null;
	const pct = has ? Math.min(99, Math.floor((j.done || 0) / (j.total || 1) * 100)) : null;
	let left = "";
	let right = "";
	if (j.phase === "Downloading text" && (j.total == null || j.total > 1e5) && j.done) {
		left = j.total ? `${fmtBytes(Math.min(j.done, j.total))} of ${fmtBytes(j.total)}` : fmtBytes(j.done);
		const speed = rate.id === j.id && rate.bps > 51200 ? `${fmtBytes(rate.bps)}/s` : "";
		right = [speed, speed && j.total ? fmtEta((j.total - j.done) / rate.bps) : ""].filter(Boolean).join(" · ");
	} else if (j.phase === "Downloading text" && has) left = `${Number(j.done).toLocaleString()} of ${plural(j.total || 0, "file")}`;
	else if ((j.phase === "Reading text" || j.phase === "Indexing") && has) left = `${Number(j.done).toLocaleString()} of ${fmtSections(j.total)}`;
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
	const cancelling = Boolean(j && j.cancelling);
	const locked = Boolean(j && j.phase === "Installing");
	const steps = DOCK_STEPS.map((_, i) => `<span class="${i < m.step ? "is-done" : i === m.step ? "is-now" : ""}"></span>`).join("");
	const queued = state.jobs.queued;
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
    ${transferTrackHtml(m.pct, { bindFill: true })}
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
	const j = state.jobs.current;
	if (!Boolean(j || state.jobs.queued.length)) {
		if (!el.hidden && !dock.hideT) {
			el.classList.remove("is-visible");
			dock.hideT = setTimeout(() => {
				dock.hideT = null;
				if (!state.jobs.current && !state.jobs.queued.length) {
					el.hidden = true;
					el.innerHTML = "";
					dock.key = "";
				}
			}, 260);
		}
		return;
	}
	if (dock.hideT !== null) clearTimeout(dock.hideT);
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
		state.jobs.queued.map((q) => q.id).join(".")
	].join("|");
	if (key !== dock.key) {
		const activeEl = document.activeElement;
		const focused = activeEl && el.contains(activeEl) ? activeEl.dataset.dock : null;
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
	const btn = e.target?.closest("[data-dock]");
	if (btn) onDockAction(btn);
});
async function onDockAction(btn) {
	const act = btn.dataset.dock;
	if (act === "minimize" || act === "expand") {
		dock.min = act === "minimize";
		lsSet("dockMinimized", dock.min ? "1" : "0");
		dock.key = "";
		updateDock();
		dock.el?.querySelector("[data-dock]")?.focus();
		return;
	}
	btn.disabled = true;
	try {
		if (act === "cancel") await getJSON(`/api/library/jobs/${btn.dataset.id}/cancel`, { method: "POST" });
		else if (act === "clear") {
			const res = await getJSON("/api/library/jobs/clear", { method: "POST" });
			for (const j of res.cancelled || []) state.jobsSeenActive.delete(j.id);
			if (res.count) showToast(`Cleared ${plural(res.count, "queued download")}`);
		}
		await pollJobs();
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Action failed", 5e3);
		btn.disabled = false;
	}
}
async function refreshTitles(changed = []) {
	let list;
	try {
		const [cfr, usc] = await Promise.all([fetchInstalledTitles(), fetchInstalledUscTitles().catch(() => state.installedUscTitles)]);
		list = cfr;
		state.installedUscTitles = usc;
	} catch {
		return;
	}
	const hadNone = state.noTitles;
	state.installedTitles = list;
	state.noTitles = list.length === 0;
	emit("titles:refreshed", {
		hadNone,
		changed,
		list
	});
	if (hadNone && list.length) {
		await switchTitle(list[0].title);
		if (Boolean(document.getElementById("welcome-list"))) {
			const target = titleHref(list[0].title);
			if (window.location.hash === target) emit("route:refresh");
			else window.location.hash = target;
		}
		return;
	}
	if (!list.some((t) => t.title === state.currentTitle) && list.length) await switchTitle(list[0].title);
	else if (changed.includes(state.currentTitle)) {
		state.treeData = null;
		const meta = list.find((t) => t.title === state.currentTitle);
		if (meta) state.metaInfo = meta;
		await switchTitle(state.currentTitle);
	}
}
registerTitleRefresher(refreshTitles);
on("jobs:updated", () => updateDock());
// src/components/cfr_resolver.ts
var titleInfoCache = /* @__PURE__ */ new Map();
var INFO_TTL_MS = 3e5;
var citePopEl = dom.citePop;
var citePop = createPopover({
	el: dom.citePop,
	scrollContainer: dom.main,
	padding: 12
});
function normalizeCfrTarget(raw = {}) {
	const title = Number(raw.title || raw.cfrTitle) || 0;
	const section = raw.section ? String(raw.section).trim() : null;
	const part = raw.part ? String(raw.part).trim() : section && section.includes(".") ? section.split(".", 1)[0] : null;
	return {
		title,
		part,
		section,
		para: raw.para ? String(raw.para).trim() : null,
		kind: raw.kind === "appendix" ? "appendix" : section ? "section" : "part",
		ecfrUrl: raw.ecfrUrl || (section ? `https://www.ecfr.gov/current/title-${title}/section-${encodeURIComponent(section)}` : part ? `https://www.ecfr.gov/current/title-${title}/part-${encodeURIComponent(part)}` : `https://www.ecfr.gov/current/title-${title}`)
	};
}
async function fetchTitleInfo(title) {
	const cached = titleInfoCache.get(title);
	if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.info;
	const info = await getJSON(`/api/library/${title}`);
	titleInfoCache.set(title, {
		info,
		at: Date.now()
	});
	return info;
}
async function checkLocalCfrTarget(target) {
	const meta = state.installedTitles.find((t) => t.title === target.title) || null;
	if (!meta) return {
		installed: false,
		meta: null
	};
	if (target.section) try {
		if ((await fetchSectionRaw(target.title, target.section, "?unit=")).ok) return {
			installed: true,
			meta,
			kind: "section"
		};
		return {
			installed: false,
			meta,
			partialMissing: true
		};
	} catch {
		return {
			installed: false,
			meta,
			partialMissing: true
		};
	}
	if (target.part) try {
		if ((await fetchPartFull(target.title, target.part)).ok) return {
			installed: true,
			meta,
			kind: "part"
		};
		return {
			installed: false,
			meta,
			partialMissing: true
		};
	} catch {
		return {
			installed: false,
			meta,
			partialMissing: true
		};
	}
	return {
		installed: true,
		meta,
		kind: "title"
	};
}
function activeJobForTarget(target) {
	if (target.section) return jobFor(target.title, "section", target.section) || (target.part ? jobFor(target.title, "part", target.part) : null) || jobFor(target.title, "title") || null;
	if (target.part) return jobFor(target.title, "part", target.part) || jobFor(target.title, "title") || null;
	return jobFor(target.title, "title") || null;
}
function targetDisplayTitle(target) {
	if (target.section) return `${target.title} CFR § ${target.section}`;
	if (target.part) return `${target.title} CFR Part ${target.part}`;
	return `Title ${target.title}`;
}
function targetHashFor(target) {
	if (target.section) return `#/title/${target.title}/section/${encodeURIComponent(target.section)}` + (target.para ? `?p=${encodeURIComponent(target.para)}` : "");
	if (target.part) return `#/title/${target.title}/part/${encodeURIComponent(target.part)}`;
	return `#/title/${target.title}/`;
}
function resolverBodyHtml(target, { info = null, error = null, loading = false, openInSplit = false, isPage = false } = {}) {
	const titleNum = target.title;
	const installedMeta = state.installedTitles.find((t) => t.title === titleNum);
	const job = activeJobForTarget(target);
	const reserved = Boolean(info && info.reserved);
	const titleName = info && info.name || installedMeta && installedMeta.name || `Title ${titleNum}`;
	const edition = info && info.latest ? ` · Edition ${fmtDate(info.latest)}` : "";
	const statusMsg = reserved ? `Title ${titleNum} is reserved on eCFR and contains no regulatory text.` : installedMeta?.partial ? `Title ${titleNum} is partially installed — this ${target.section ? "section" : "part"} hasn’t been downloaded yet.` : `Title ${titleNum} is not installed in the local reader.`;
	let jobHtml = "";
	if (job) {
		const m = dockModel(job);
		const pctText = m.pct == null ? "" : ` · ${m.pct}%`;
		const isQueued = job.state === "queued";
		const note = openInSplit ? "Downloading in background — will open side-by-side when ready." : "Downloading in background — will open automatically when ready.";
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
	let actionsHtml = "";
	if (!reserved && !job) {
		const primaryCls = isPage ? "btn btn-accent" : "btn btn-small btn-accent";
		const secCls = isPage ? "btn" : "btn btn-small";
		const btns = [];
		if (target.section) {
			btns.push(`<button type="button" class="${primaryCls}" data-res-dl="section">${icon("download")} Download § ${escapeHtml(target.section)}</button>`);
			if (target.part) btns.push(`<button type="button" class="${secCls}" data-res-dl="part">Download Part ${escapeHtml(target.part)}</button>`);
		} else if (target.part) {
			btns.push(`<button type="button" class="${primaryCls}" data-res-dl="part">${icon("download")} Download Part ${escapeHtml(target.part)}</button>`);
			btns.push(`<button type="button" class="${secCls}" data-res-dl="title">Download Title ${titleNum}</button>`);
		} else btns.push(`<button type="button" class="${primaryCls}" data-res-dl="title">${icon("download")} Download Title ${titleNum}</button>`);
		actionsHtml = `<div class="resolver-acts">
      ${btns.join("")}
      <a class="${secCls}" href="${escapeHtml(target.ecfrUrl)}" target="_blank" rel="noopener noreferrer">${icon("external")} View on eCFR</a>
    </div>`;
	} else actionsHtml = `<div class="resolver-acts">
      <a class="${isPage ? "btn" : "btn btn-small"}" href="${escapeHtml(target.ecfrUrl)}" target="_blank" rel="noopener noreferrer">${icon("external")} View on eCFR</a>
      ${isPage ? `<a class="btn" href="#/library/${titleNum}">Open in Library</a>` : ""}
    </div>`;
	return `
    <div class="resolver-meta">${escapeHtml(titleName)}${escapeHtml(edition)}${loading ? " · Checking eCFR…" : ""}</div>
    <p class="resolver-msg">${escapeHtml(error || statusMsg)}</p>
    ${jobHtml}
    ${actionsHtml}
  `;
}
var activeModalCtx = null;
var activePageCtx = null;
async function submitCfrDownload(scopeKind, target, openInSplit = false) {
	const body = {
		title: target.title,
		part: scopeKind === "section" || scopeKind === "part" ? target.part : null,
		section: scopeKind === "section" ? target.section : null,
		kind: target.kind === "appendix" ? "appendix" : "section"
	};
	const job = await getJSON("/api/library/download", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
	state.jobsSeenActive.add(job.id);
	state.pendingDownloads.set(job.id, {
		title: target.title,
		part: body.part,
		section: body.section,
		kind: body.section ? body.kind : body.part ? "part" : "title",
		para: target.para || null,
		openInSplit: Boolean(openInSplit && target.section),
		fromHash: window.location.hash || "#/"
	});
	await pollJobs();
	return job;
}
function renderPopResolver(ctx) {
	if (!citePopEl || !citePop.isOpen() || !citePop.isInteractive()) return;
	const { target, info, loading, error, openInSplit } = ctx;
	citePopEl.innerHTML = `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(targetDisplayTitle(target))}</div>
      <span class="peek-badge">UNINSTALLED</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close download prompt">${icon("close")}</button>
    </div>
    ${resolverBodyHtml(target, {
		info,
		loading,
		error,
		openInSplit,
		isPage: false
	})}
  `;
	citePop.reposition();
}
async function openCfrDownloadCard(anchorEl, rawTarget, { openInSplit = false } = {}) {
	const target = normalizeCfrTarget(rawTarget);
	const ctx = {
		target,
		info: null,
		loading: true,
		error: null,
		openInSplit
	};
	activeModalCtx = ctx;
	citePop.open(anchorEl, "", {
		interactive: true,
		returnFocus: anchorEl,
		refTier: "uninstalled"
	});
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
async function renderResolverPage(container, rawTarget) {
	if (!container) return;
	const target = normalizeCfrTarget(rawTarget);
	const ctx = {
		target,
		info: null,
		loading: true,
		error: null,
		container
	};
	activePageCtx = ctx;
	const draw = () => {
		if (activePageCtx !== ctx || !container.contains(container.querySelector(".resolver-card") || container)) return;
		container.innerHTML = `
      <div class="resolver-card">
        <div class="doc-kicker">External Regulatory Reference</div>
        <h1 class="doc-title">${escapeHtml(targetDisplayTitle(target))}</h1>
        ${resolverBodyHtml(target, {
			info: ctx.info,
			loading: ctx.loading,
			error: ctx.error,
			isPage: true
		})}
      </div>
    `;
	};
	document.title = `${targetDisplayTitle(target)} · FRAMEWORK`;
	container.innerHTML = `<div class="resolver-card">
    <div class="doc-kicker">External Regulatory Reference</div>
    <h1 class="doc-title">${escapeHtml(targetDisplayTitle(target))}</h1>
    ${resolverBodyHtml(target, {
		loading: true,
		isPage: true
	})}
  </div>`;
	enterView();
	try {
		ctx.info = await fetchTitleInfo(target.title);
		ctx.loading = false;
	} catch (err) {
		ctx.loading = false;
		ctx.error = err instanceof Error ? err.message : null;
	}
	if (activePageCtx === ctx && container.querySelector(".resolver-card")) draw();
}
async function handleResolverActionClick(btn, ctx, redraw) {
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
		ctx.error = err instanceof Error ? err.message : "Download failed";
		showToast(ctx.error, 5e3);
		redraw();
	}
}
if (dom.citePop) dom.citePop.addEventListener("click", (e) => {
	const t = e.target;
	if (t?.closest("[data-pop-close]")) {
		activeModalCtx = null;
		citePop.close(true);
		return;
	}
	const dlBtn = t?.closest("[data-res-dl]");
	if (dlBtn && activeModalCtx) handleResolverActionClick(dlBtn, activeModalCtx, () => {
		if (activeModalCtx) renderPopResolver(activeModalCtx);
	});
});
onView("click", (e) => {
	const dlBtn = e.target?.closest(".resolver-card [data-res-dl]");
	if (dlBtn && activePageCtx && dom.view.contains(dlBtn)) handleResolverActionClick(dlBtn, activePageCtx, () => {
		const card = dom.view.querySelector(".resolver-card");
		if (activePageCtx && card) card.innerHTML = `
          <div class="doc-kicker">External Regulatory Reference</div>
          <h1 class="doc-title">${escapeHtml(targetDisplayTitle(activePageCtx.target))}</h1>
          ${resolverBodyHtml(activePageCtx.target, {
			info: activePageCtx.info,
			loading: activePageCtx.loading,
			error: activePageCtx.error,
			isPage: true
		})}
        `;
	});
});
on("jobs:updated", () => {
	if (activeModalCtx && citePop.isOpen() && citePop.isInteractive() && citePopEl?.querySelector("[data-res-dl], [data-res-job]")) renderPopResolver(activeModalCtx);
	const card = dom.view?.querySelector(".resolver-card");
	if (activePageCtx && card) card.innerHTML = `
      <div class="doc-kicker">External Regulatory Reference</div>
      <h1 class="doc-title">${escapeHtml(targetDisplayTitle(activePageCtx.target))}</h1>
      ${resolverBodyHtml(activePageCtx.target, {
		info: activePageCtx.info,
		loading: activePageCtx.loading,
		error: activePageCtx.error,
		isPage: true
	})}
    `;
});
async function upgradeDomExternalLinks(finishedTitles) {
	if (!finishedTitles.size) return;
	for (const key of [...state.peekCache.keys()]) {
		const tNum = Number(key.split("|", 1)[0]);
		if (finishedTitles.has(tNum)) state.peekCache.delete(key);
	}
	for (const tNum of finishedTitles) state.refsCache.delete(tNum);
	for (const key of [...state.graphCache.keys()]) {
		const tNum = Number(key.split("|", 1)[0]);
		if (finishedTitles.has(tNum)) state.graphCache.delete(key);
	}
	for (const root of [dom.view, dom.splitPane].filter(Boolean)) for (const a of root.querySelectorAll("a.xref-external[data-cfr-title]")) {
		const t = Number(a.dataset.cfrTitle);
		if (!finishedTitles.has(t)) continue;
		const target = normalizeCfrTarget({
			title: t,
			part: a.dataset.cfrPart,
			section: a.dataset.cfrSection,
			para: a.dataset.cfrPara
		});
		if (!(await checkLocalCfrTarget(target)).installed || !a.isConnected) continue;
		a.href = targetHashFor(target);
		a.className = "xref xref-cross";
		a.removeAttribute("target");
		a.removeAttribute("rel");
		a.removeAttribute("title");
		delete a.dataset.cfrTitle;
		delete a.dataset.cfrPart;
		delete a.dataset.cfrSection;
		delete a.dataset.cfrPara;
	}
}
on("jobs:finished", async ({ finished }) => {
	if (!finished.length) return;
	const doneJobs = finished.filter((j) => j.state === "done");
	await upgradeDomExternalLinks(new Set(doneJobs.map((j) => j.title).filter((t) => typeof t === "number")));
	for (const j of finished) {
		const entry = state.pendingDownloads.get(j.id);
		if (!entry) continue;
		state.pendingDownloads.delete(j.id);
		if (j.state !== "done") continue;
		const target = normalizeCfrTarget(entry);
		const label = targetDisplayTitle(target);
		if (entry.openInSplit && target.section) {
			if (activeModalCtx && citePop.isOpen()) {
				activeModalCtx = null;
				citePop.close(false);
			}
			emit("split:open", {
				title: target.title,
				sectionId: target.section,
				para: target.para,
				pushHistory: true
			});
			showToast(`Ready — opened ${label} side-by-side`);
			continue;
		}
		const onResolverPage = Boolean(dom.view.querySelector(".resolver-card"));
		if (window.location.hash === entry.fromHash || onResolverPage) {
			if (activeModalCtx && citePop.isOpen()) {
				activeModalCtx = null;
				citePop.close(false);
			}
			if (activePageCtx) activePageCtx = null;
			window.location.hash = targetHashFor(target);
			showToast(`Ready — opened ${label}`);
		} else showToast(`${label} ready in library`);
	}
});
if (typeof window !== "undefined") window.addEventListener("hashchange", () => {
	activeModalCtx = null;
	if (!dom.view?.querySelector(".resolver-card")) activePageCtx = null;
});
// src/components/view_head.ts
function setViewHead(html) {
	const head = dom.viewHead;
	if (!head) return;
	const activeEl = document.activeElement;
	const step = activeEl && head.contains(activeEl) ? activeEl.dataset.step : null;
	if (state.railObserver) {
		state.railObserver.disconnect();
		state.railObserver = null;
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
			if (c.t && LEAF_TYPES.has(c.t)) return c;
			const hit = find(c);
			if (hit) return hit;
		}
		return null;
	};
	const leaf = find(treeIdx.nodes[k]);
	return leaf ? {
		id: String(leaf.id),
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
	const partBtn = (node, dir) => node ? docStepBtn("part", dir, `#/part/${encodeURIComponent(String(node.id || ""))}`, `Part ${node.id || ""}`, node.d, `<span class="step-word">Part </span>${escapeHtml(node.id)}`) : "";
	const sectionBtn = (s, dir) => s ? docStepBtn("section", dir, `#/section/${encodeURIComponent(s.id)}`, s.label || s.id, s.title) : "";
	const sep = "<span class=\"doc-step-sep\" aria-hidden=\"true\"></span>";
	const left = [partBtn(prevPart, -1), sectionBtn(prevSection, -1)].filter(Boolean).join(sep);
	const right = [sectionBtn(nextSection, 1), partBtn(nextPart, 1)].filter(Boolean).join(sep);
	if (!left && !right) return "";
	return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}
// src/components/title_switcher.ts
var switcherDeskFilter = "all";
function activeRouteKind() {
	const p = (state.activeRoute || "/").split("?")[0] || "/";
	if (p.startsWith("/news")) return "fr";
	if (/^\/usc\/\d+(?:\/|$)/.test(p)) return "usc";
	if (/^\/constitution(?:\/|$)/.test(p)) return "corpus";
	if (/^\/law\/[^/]+/.test(p)) return "corpus";
	if (p.startsWith("/corpus/")) return state.activeCorpus?.tier === "federal-register" ? "fr" : "corpus";
	if (/^\/(?:title\/\d+(?:\/|$)|part\/|section\/)/.test(p)) return "cfr";
	return "platform";
}
function searchPlaceholderFor(on) {
	if (!on) return "Install a federal code or browse Federal Register…";
	if (window.matchMedia("(max-width: 600px)").matches) return "Search…";
	const kind = activeRouteKind();
	if (kind === "cfr") return `Search ${state.currentTitle} CFR or jump to a section…`;
	if (kind === "usc" && state.currentUscTitle) return `Search ${state.currentUscTitle} U.S.C. or federal codes…`;
	if (kind === "fr") return "Search federal codes, § sections, or > commands…";
	return "Search federal codes, § sections, or > commands…";
}
function setReaderEnabled(on) {
	dom.search.disabled = !on;
	dom.search.placeholder = searchPlaceholderFor(on);
	dom.chatToggle.disabled = !on;
	if (!on) {
		dom.edition.textContent = "";
		dom.tree.innerHTML = "<div class=\"side-empty\">No federal codes installed yet. <a href=\"#/\">Pick a profile</a> or open the <a href=\"#/library\">library</a>.</div>";
	}
}
window.matchMedia("(max-width: 600px)").addEventListener?.("change", () => {
	if (dom.search) dom.search.placeholder = searchPlaceholderFor(!state.noTitles);
});
on("title:switched", () => {
	fillTitleSelect();
	if (dom.search) dom.search.placeholder = searchPlaceholderFor(true);
});
on("route:changed", () => {
	fillTitleSelect();
	if (dom.search) dom.search.placeholder = searchPlaceholderFor(!state.noTitles);
});
on("titles:refreshed", ({ hadNone, list }) => {
	fillTitleSelect();
	if (hadNone && list.length) setReaderEnabled(true);
});
function switcherGroupsHtml(query = "", desk = switcherDeskFilter) {
	syncCorporaState();
	const corpora = allSystemFrameworks();
	const q = query.trim().toLowerCase();
	const filtered = corpora.filter((c) => {
		if (desk !== "all" && c.desk !== desk && c.desk !== "all") return false;
		if (!q) return true;
		return `${c.code} ${c.name} ${(c.agencies || []).join(" ")} ${deskLabel(c.desk || "ehs")}`.toLowerCase().includes(q);
	});
	if (!filtered.length) return "<div class=\"tm-empty\">No matching federal frameworks found.</div>";
	const kind = activeRouteKind();
	return TIER_ORDER.map((tier) => {
		const items = filtered.filter((c) => c.tier === tier);
		if (!items.length) return "";
		const meta = TIER_META[tier];
		if (!meta) return "";
		return `
      <div class="tm-group" data-ref-tier="${meta.refTier}">
        <div class="tm-group-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(meta.label)}</span><span class="tm-group-count">${items.length}</span></div>
        ${items.map((c) => {
			const isCurrent = c.tier === "federal-reg" ? kind === "cfr" && c.title_num === state.currentTitle : c.tier === "federal-register" ? kind === "fr" : c.tier === "federal-statute" && kind === "usc" ? c.title_num === state.currentUscTitle : kind === "corpus" && state.activeCorpus?.corpus_id === c.corpus_id;
			const numText = c.tier === "federal-reg" ? `${c.code} CFR` : c.code;
			const tag = c.partial ? "Partial" : c.status_label || c.agencies?.[0] || "";
			return `<button type="button" class="tm-item${isCurrent ? " is-current" : ""}" role="menuitemradio" aria-checked="${isCurrent}" data-ref-tier="${meta.refTier}" ${c.tier === "federal-reg" ? `data-title="${c.title_num}"` : `data-corpus-hash="${escapeHtml(corpusHashFor(c))}"`} tabindex="-1">
            <span class="tier-pip${c.installed === false ? " is-hollow" : ""}" aria-hidden="true"></span>
            <span class="tm-num">${escapeHtml(numText)}</span><span class="tm-name">${escapeHtml(c.name)}</span>
            ${tag ? `<span class="tm-meta">${escapeHtml(tag)}</span>` : ""}
            ${isCurrent ? icon("check", "tm-check") : "<span class=\"tm-check\" aria-hidden=\"true\"></span>"}
          </button>`;
		}).join("")}
      </div>
    `;
	}).join("");
}
function fillTitleSelect() {
	if (!dom.titleSelect) return;
	const corpora = syncCorporaState();
	const kind = activeRouteKind();
	const numEl = document.getElementById("title-select-num");
	const nameEl = document.getElementById("title-select-name");
	if (kind === "fr") {
		if (numEl) numEl.textContent = "FR";
		if (nameEl) nameEl.textContent = "Federal Register";
		dom.titleSelect.dataset.refTier = "fr";
		dom.titleSelect.title = "Federal Register · Switch federal framework";
		if (dom.edition) {
			const frDate = state.navNewsStatus?.sources?.federal_register?.last_ok_at?.slice(0, 10) || "";
			dom.edition.textContent = frDate ? `FR ${frDate}` : "Federal Register";
			dom.edition.title = "Federal Register feed";
		}
	} else if (kind === "usc" && state.currentUscTitle) {
		const curUsc = state.installedUscTitles.find((u) => u.title === state.currentUscTitle);
		const name = curUsc?.title_name || state.activeCorpus?.name || `Title ${state.currentUscTitle}`;
		if (numEl) numEl.textContent = uscCite(state.currentUscTitle);
		if (nameEl) nameEl.textContent = name;
		dom.titleSelect.dataset.refTier = "usc";
		dom.titleSelect.title = `${uscCite(state.currentUscTitle)}: ${name} · Switch federal framework`;
		if (dom.edition) {
			dom.edition.textContent = curUsc?.release_point ? `Release ${curUsc.release_point}` : "U.S. Code";
			dom.edition.title = `${uscCite(state.currentUscTitle)} release point`;
		}
	} else if (kind === "corpus" && state.activeCorpus) {
		const shortCode = state.activeCorpus.tier === "federal-statute" ? state.activeCorpus.code.split("§§")[0].trim() : state.activeCorpus.code;
		if (numEl) numEl.textContent = shortCode;
		if (nameEl) nameEl.textContent = state.activeCorpus.name;
		dom.titleSelect.dataset.refTier = refTierForCorpus(state.activeCorpus);
		dom.titleSelect.title = `${state.activeCorpus.code}: ${state.activeCorpus.name} · Switch federal framework`;
		if (dom.edition) {
			dom.edition.textContent = state.activeCorpus.edition || (state.activeCorpus.tier === "federal-statute" ? "U.S. Code" : "");
			dom.edition.title = `${state.activeCorpus.code} edition`;
		}
	} else if (kind === "cfr" && !state.noTitles) {
		const cur = state.installedTitles.find((t) => t.title === state.currentTitle);
		const name = cur ? cur.name : state.metaInfo.name || "";
		const ed = cur?.edition || state.metaInfo.edition || "";
		if (numEl) numEl.textContent = `${state.currentTitle} CFR`;
		if (nameEl) nameEl.textContent = name;
		dom.titleSelect.dataset.refTier = "cfr";
		dom.titleSelect.title = `${state.currentTitle} CFR${name ? ": " + name : ""} · Switch federal framework`;
		if (dom.edition) {
			dom.edition.textContent = ed ? `eCFR ${ed}` : "";
			dom.edition.title = "eCFR edition loaded for this title";
		}
	} else {
		if (numEl) numEl.textContent = "Federal";
		if (nameEl) nameEl.textContent = state.noTitles ? "Frameworks" : "All Frameworks";
		dom.titleSelect.dataset.refTier = "local";
		dom.titleSelect.title = "Switch federal framework (U.S.C., CFR, Federal Register)";
		if (dom.edition) {
			dom.edition.textContent = "";
			dom.edition.title = "";
		}
	}
	const desks = [...new Set(corpora.map((c) => c.desk).filter((d) => Boolean(d) && d !== "all"))];
	const showDesks = corpora.length > 6 || desks.length > 1;
	const showSearch = corpora.length >= 3;
	const deskPillsHtml = showDesks ? `
    <div class="tm-desks" role="group" aria-label="Filter frameworks by topic">
      <button type="button" class="tm-desk-pill${switcherDeskFilter === "all" ? " is-on" : ""}" data-tm-desk="all">All</button>
      ${desks.map((d) => `<button type="button" class="tm-desk-pill${switcherDeskFilter === d ? " is-on" : ""}" data-tm-desk="${escapeHtml(d)}">${escapeHtml(deskLabel(d).split(" ")[0])}</button>`).join("")}
    </div>` : "";
	dom.titlePop.innerHTML = `
    <div class="tm-head">
      ${showSearch ? "<input type=\"search\" class=\"tm-search\" id=\"title-pop-q\" placeholder=\"Filter federal frameworks (CFR, FR, U.S.C.)…\" aria-label=\"Filter federal frameworks\" autocomplete=\"off\" spellcheck=\"false\">" : ""}
      ${deskPillsHtml}
    </div>
    <div id="tm-groups">${switcherGroupsHtml()}</div>
    <div class="tm-sep" role="separator"></div>
    <a class="tm-item tm-download" role="menuitem" href="#/library" tabindex="-1">${icon("download")}<span class="tm-name">Browse Federal Library &amp; Downloads…</span></a>`;
}
var titleMenuItems = () => [...dom.titlePop.querySelectorAll(".tm-item")];
function openTitleMenu(focusWhich = "current") {
	if (!dom.titlePop.hidden) return;
	closeAllPopovers(closeTitleMenu, false);
	fillTitleSelect();
	dom.titlePop.hidden = false;
	dom.titleSelect.setAttribute("aria-expanded", "true");
	const searchEl = document.getElementById("title-pop-q");
	const items = titleMenuItems();
	(focusWhich === "first" ? items[0] : focusWhich === "last" ? items[items.length - 1] : searchEl || dom.titlePop.querySelector(".is-current") || items[0])?.focus({ preventScroll: true });
	document.addEventListener("pointerdown", onTitleMenuOutside, true);
}
function closeTitleMenu(returnFocus = false) {
	if (dom.titlePop.hidden) return;
	dom.titlePop.hidden = true;
	dom.titleSelect.setAttribute("aria-expanded", "false");
	document.removeEventListener("pointerdown", onTitleMenuOutside, true);
	if (returnFocus) dom.titleSelect.focus();
}
registerPopoverCloser(closeTitleMenu);
function onTitleMenuOutside(e) {
	const menu = document.getElementById("title-menu");
	if (menu && !menu.contains(e.target)) closeTitleMenu(false);
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
dom.titlePop.addEventListener("input", (e) => {
	const target = e.target;
	if (!target || target.id !== "title-pop-q") return;
	const groups = document.getElementById("tm-groups");
	if (groups) groups.innerHTML = switcherGroupsHtml(target.value, switcherDeskFilter);
});
dom.titlePop.addEventListener("keydown", (e) => {
	if (e.target?.id === "title-pop-q") {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			titleMenuItems()[0]?.focus();
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			closeTitleMenu(true);
		}
		return;
	}
	const items = titleMenuItems();
	const i = items.indexOf(document.activeElement);
	const go = (n) => {
		e.preventDefault();
		items[(n + items.length) % items.length]?.focus();
	};
	if (e.key === "ArrowDown") go(i + 1);
	else if (e.key === "ArrowUp") {
		if (i <= 0) {
			const qEl = document.getElementById("title-pop-q");
			if (qEl) {
				e.preventDefault();
				qEl.focus();
				return;
			}
		}
		go(i - 1);
	} else if (e.key === "Home") go(0);
	else if (e.key === "End") go(items.length - 1);
	else if (e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		closeTitleMenu(true);
	} else if (e.key === "Tab") closeTitleMenu(false);
});
dom.titlePop.addEventListener("click", async (e) => {
	const t = e.target;
	const deskBtn = t?.closest("[data-tm-desk]");
	if (deskBtn) {
		switcherDeskFilter = deskBtn.dataset.tmDesk || "all";
		dom.titlePop.querySelectorAll("[data-tm-desk]").forEach((b) => b.classList.toggle("is-on", b === deskBtn));
		const qVal = document.getElementById("title-pop-q")?.value || "";
		const groups = document.getElementById("tm-groups");
		if (groups) groups.innerHTML = switcherGroupsHtml(qVal, switcherDeskFilter);
		return;
	}
	const item = t?.closest(".tm-item");
	if (!item) return;
	closeTitleMenu(false);
	if (item.classList.contains("tm-download")) return;
	if (item.dataset.corpusHash) {
		window.location.hash = item.dataset.corpusHash;
		return;
	}
	const newTitle = parseInt(item.dataset.title || "", 10);
	if (newTitle && newTitle !== state.currentTitle) {
		await switchTitle(newTitle);
		window.location.hash = `#/title/${newTitle}/`;
	} else dom.titleSelect.focus();
});
function renderCorpusStaging(corpus) {
	const meta = TIER_META[corpus.tier] || TIER_META["federal-statute"];
	const refTier = refTierForCorpus(corpus);
	const linked = (corpus.linked_titles || []).map((n) => state.installedTitles.find((t) => t.title === n)).filter((t) => Boolean(t));
	const extUrl = safeHttpUrl(corpus.external_url);
	const dolOn = Boolean(state.navNewsStatus?.dol_configured);
	const frQuick = corpus.tier === "federal-register" ? `
    <div class="hm-title-parts" style="margin-top:16px">
      <a class="hm-part-chip" href="#/news?cat=rules"><span class="hm-part-num">Final Rules</span></a>
      <a class="hm-part-chip" href="#/news?cat=rulemaking"><span class="hm-part-num">Proposed Rules</span></a>
      <a class="hm-part-chip" href="#/news?cat=notices"><span class="hm-part-num">Notices</span></a>
      <a class="hm-part-chip" href="#/news?cat=public_inspection"><span class="hm-part-num">Public Inspection</span></a>
      ${dolOn ? "<a class=\"hm-part-chip\" href=\"#/news?cat=enforcement\"><span class=\"hm-part-num\">Enforcement</span></a>" : ""}
    </div>` : "";
	const linkedChips = linked.length ? `
    <div class="hm-title-parts" style="margin-top:14px">
      ${linked.map((t) => `<a class="citation-chip" data-ref-tier="cfr" href="#/title/${t.title}/">${t.title} CFR · ${escapeHtml(t.name)}</a>`).join("")}
    </div>` : "";
	const auth = authorityForCorpus(corpus);
	const authDetailHtml = auth ? `
    <div class="hm-usc-dossier" style="margin-top:18px">
      <div class="hm-usc-sec-lbl">Principal Enacted Acts</div>
      <div class="hm-usc-acts">
        ${auth.acts.map((a) => `<span class="hm-usc-act">${escapeHtml(a)}</span>`).join("")}
      </div>
      <div class="hm-usc-sec-lbl" style="margin-top:14px">Key Enabling Provisions &amp; Implementing CFR Rules</div>
      <div class="hm-usc-provs">
        ${auth.provisions.map((p) => {
		const isInst = state.installedTitles.some((x) => x.title === p.cfrTitle);
		const cfrHref = isInst ? p.cfrSection ? `#/title/${p.cfrTitle}/section/${encodeURIComponent(p.cfrSection)}` : `#/title/${p.cfrTitle}/part/${encodeURIComponent(p.cfrPart || "")}` : `#/library/${p.cfrTitle}`;
		const cfrLabel = p.cfrSection ? `${p.cfrTitle} CFR § ${p.cfrSection}` : `${p.cfrTitle} CFR Part ${p.cfrPart}`;
		return `
            <div class="hm-usc-prov-row">
              <div class="hm-usc-prov-main">
                <span class="hm-usc-prov-cite">${escapeHtml(p.cite)}</span>
                <span class="hm-usc-prov-title">${escapeHtml(p.title)}</span>
              </div>
              <a class="citation-chip${isInst ? "" : " is-dim"}" data-ref-tier="${isInst ? "cfr" : "uninstalled"}" href="${cfrHref}">${escapeHtml(cfrLabel)}</a>
            </div>`;
	}).join("")}
      </div>
    </div>` : "";
	const jurText = corpus.jurisdiction_label || "Federal";
	document.title = `${corpus.code} · ${corpus.name} · FRAMEWORK`;
	dom.view.innerHTML = `
    <div class="resolver-card has-tier-bar" data-ref-tier="${refTier}">
      <div class="doc-kicker"><span class="ref-badge">${escapeHtml(meta.tag)}</span> <span class="sep" aria-hidden="true">·</span> ${escapeHtml(jurText)}${corpus.status_label ? ` <span class="sep" aria-hidden="true">·</span> ${escapeHtml(corpus.status_label)}` : ""}</div>
      <h1 class="doc-title">${escapeHtml(corpus.code)} — ${escapeHtml(corpus.name)}</h1>
      <p class="resolver-msg">${escapeHtml(corpus.summary || `This ${meta.label.toLowerCase()} framework is integrated into FRAMEWORK’s federal navigation and authority chain.`)}</p>
      ${frQuick}
      ${linkedChips}
      ${authDetailHtml}
      <div class="resolver-acts">
        ${corpus.tier === "federal-register" ? `<a class="btn btn-accent" href="#/news">Open Newsroom ${icon("chevronRight")}</a>` : ""}
        ${extUrl ? `<a class="btn btn-accent" href="${escapeHtml(extUrl)}" target="_blank" rel="noopener noreferrer">Open Official U.S.C. ${icon("external")}</a>` : ""}
        <a class="btn" href="#/library">Browse Library</a>
        <a class="btn" href="#/">Back to Home</a>
      </div>
    </div>
  `;
	enterView();
}
function renderNotFound() {
	clearTreeSelection();
	document.title = "Not found · FRAMEWORK";
	setViewHead("");
	const onTitleRoute = /^\/title\/\d+/.test(state.activeRoute || "");
	dom.view.innerHTML = `
    <div class="empty-state">
      <h2>Page not found</h2>
      <p>${onTitleRoute ? `That section or part isn’t in ${state.currentTitle} CFR.` : "That federal framework or provision could not be found."}</p>
      <a href="${onTitleRoute ? `#/title/${state.currentTitle}/` : "#/"}" class="btn">${onTitleRoute ? `Back to ${state.currentTitle} CFR` : "Back to Home"}</a>
    </div>
  `;
	enterView();
}
// src/components/reader_tabs.ts
var SESSION_TABS_KEY = "framework_session_tabs_v1";
var splitRestorer = null;
var splitCloser = null;
function registerSplitTabHandlers({ restore, close } = {}) {
	if (restore) splitRestorer = restore;
	if (close) splitCloser = close;
}
function buildReaderHref(entry) {
	if (!entry) return "#/";
	const t = Number(entry.title) || state.currentTitle || 29;
	if (entry.kind === "part" && entry.partId) return `#/title/${t}/part/${encodeURIComponent(String(entry.partId))}${entry.full ? "/full" : ""}`;
	let h = `#/title/${t}/section/${encodeURIComponent(String(entry.sectionId || ""))}`;
	if (entry.unit === "full") h += "/full";
	else if (entry.unit) h += `/${encodeURIComponent(String(entry.unit))}`;
	if (entry.para) h += `?p=${encodeURIComponent(String(entry.para))}`;
	return h;
}
function tabIdentityMatch(a, b) {
	if (!a || !b) return false;
	const ka = a.kind || (a.partId && !a.sectionId ? "part" : "section");
	if (ka !== (b.kind || (b.partId && !b.sectionId ? "part" : "section")) || Number(a.title) !== Number(b.title)) return false;
	if (ka === "part") return String(a.partId) === String(b.partId) && Boolean(a.full) === Boolean(b.full);
	return String(a.sectionId) === String(b.sectionId);
}
function formatTabLabel(entry) {
	if (entry.label) return entry.label;
	const t = Number(entry.title) || state.currentTitle || 29;
	if (entry.kind === "part" && entry.partId) return `${t} CFR Part ${entry.partId}${entry.full ? " · Full" : ""}`;
	return `${t} CFR § ${entry.sectionId || ""}`;
}
function persistSessionTabs() {
	try {
		sessionStorage.setItem(SESSION_TABS_KEY, JSON.stringify({
			mainTabs: state.mainTabs,
			activeMainTabId: state.activeMainTabId,
			splitTabs: state.splitTabs,
			activeSplitTabId: state.activeSplitTabId,
			splitWide: state.splitWide
		}));
	} catch {}
}
function restoreSessionTabsSnapshot() {
	try {
		const raw = sessionStorage.getItem(SESSION_TABS_KEY);
		if (!raw) return null;
		const data = JSON.parse(raw);
		if (data && Array.isArray(data.mainTabs)) {
			state.mainTabs = data.mainTabs;
			state.activeMainTabId = data.activeMainTabId || data.mainTabs[0]?.id || null;
		}
		return data;
	} catch {
		return null;
	}
}
function makeMainTabEntry(meta) {
	const kind = meta.kind || (meta.partId && !meta.sectionId ? "part" : "section");
	const title = Number(meta.title) || state.currentTitle || 29;
	return {
		id: meta.id || `mtab_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
		kind,
		title,
		sectionId: meta.sectionId ? String(meta.sectionId) : void 0,
		partId: meta.partId ? String(meta.partId) : void 0,
		unit: meta.unit || null,
		full: Boolean(meta.full),
		para: meta.para || null,
		label: cleanInlineLabel(meta.label || "") || formatTabLabel({
			kind,
			title,
			sectionId: meta.sectionId,
			partId: meta.partId,
			full: meta.full
		}),
		heading: cleanInlineLabel(meta.heading || ""),
		tier: meta.tier || "cfr",
		href: meta.href || buildReaderHref({
			kind,
			title,
			sectionId: meta.sectionId,
			partId: meta.partId,
			unit: meta.unit,
			full: meta.full,
			para: meta.para
		})
	};
}
function syncMainTabFromRoute(meta) {
	const next = makeMainTabEntry(meta);
	const openAsNew = state.pendingNewMainTab;
	state.pendingNewMainTab = false;
	if (openAsNew) {
		const existing = state.mainTabs.find((t) => tabIdentityMatch(t, next));
		if (existing) {
			Object.assign(existing, {
				...next,
				id: existing.id
			});
			state.activeMainTabId = existing.id;
		} else {
			state.mainTabs.push(next);
			state.activeMainTabId = next.id;
		}
	} else {
		const active = state.mainTabs.find((t) => t.id === state.activeMainTabId);
		if (active) Object.assign(active, {
			...next,
			id: active.id
		});
		else {
			const same = state.mainTabs.find((t) => tabIdentityMatch(t, next));
			if (same) {
				Object.assign(same, {
					...next,
					id: same.id
				});
				state.activeMainTabId = same.id;
			} else {
				state.mainTabs.push(next);
				state.activeMainTabId = next.id;
			}
		}
	}
	persistSessionTabs();
	renderMainTabs();
}
function hideMainTabs() {
	if (dom.mainTabs) dom.mainTabs.hidden = true;
}
function renderMainTabs() {
	if (!dom.mainTabs) return;
	const show = Boolean(state.currentSection || state.currentPart) && (state.mainTabs.length > 1 || state.mainTabs.length >= 1 && state.splitTabs.length > 0);
	dom.mainTabs.hidden = !show;
	if (!show) {
		dom.mainTabs.innerHTML = "";
		return;
	}
	const canClose = state.mainTabs.length > 1;
	const pillsHtml = state.mainTabs.map((t) => {
		const active = t.id === state.activeMainTabId;
		const tier = Number(t.title) !== Number(state.currentTitle) ? "cross" : t.tier || "cfr";
		const titleAttr = `${formatTabLabel(t)}${t.heading ? ` — ${t.heading}` : ""}`;
		return `
      <div class="reader-tab${active ? " is-active" : ""}" data-ref-tier="${tier}" role="presentation">
        <button type="button" class="reader-tab-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-tab-switch="${escapeHtml(t.id)}" title="${escapeHtml(titleAttr)}">
          <span class="tier-pip" aria-hidden="true"></span>
          <span class="reader-tab-label">${escapeHtml(formatTabLabel(t))}</span>
        </button>
        ${canClose ? `<button type="button" class="reader-tab-close" data-tab-close="${escapeHtml(t.id)}" aria-label="Close ${escapeHtml(formatTabLabel(t))}" title="Close tab">${icon("close")}</button>` : ""}
      </div>`;
	}).join("");
	dom.mainTabs.innerHTML = `
    <div class="reader-tabs-strip">${pillsHtml}</div>
    <div class="reader-tabs-acts">
      <button type="button" class="btn btn-small reader-tabs-save" data-tabs-act="save-group" title="Save current main & side-by-side tabs as a workspace tab group">${icon("folder")} <span>Save group</span></button>
    </div>`;
}
function openMainReaderTab(opts = {}) {
	const kind = opts.kind || (opts.partId && !opts.sectionId ? "part" : "section");
	const title = Number(opts.title) || state.currentTitle || 29;
	const target = {
		kind,
		title,
		sectionId: opts.sectionId || opts.section || void 0,
		partId: opts.partId || opts.part || void 0,
		unit: opts.unit || null,
		full: Boolean(opts.full),
		para: opts.para || null,
		label: opts.label || formatTabLabel({
			kind,
			title,
			sectionId: opts.sectionId || opts.section,
			partId: opts.partId || opts.part,
			full: opts.full
		}),
		heading: opts.heading || "",
		tier: opts.tier || (title !== state.currentTitle ? "cross" : "cfr")
	};
	const href = opts.href || buildReaderHref(target);
	target.href = href;
	if (state.mainTabs.length === 0 && (state.currentSection || state.currentPart)) syncMainTabFromRoute(state.currentSection ? {
		kind: "section",
		title: state.currentTitle,
		sectionId: state.currentSection.id,
		unit: state.currentSection.unit,
		label: `${state.currentTitle} CFR ${cleanInlineLabel(state.currentSection.label)}`,
		heading: state.currentSection.section_title || "",
		href: window.location.hash || buildReaderHref({
			kind: "section",
			title: state.currentTitle,
			sectionId: state.currentSection.id,
			unit: state.currentSection.unit
		})
	} : {
		kind: "part",
		title: state.currentTitle,
		partId: state.currentPart || void 0,
		full: state.activeRoute.endsWith("/full"),
		label: `${state.currentTitle} CFR Part ${state.currentPart}`,
		href: window.location.hash || buildReaderHref({
			kind: "part",
			title: state.currentTitle,
			partId: state.currentPart || void 0,
			full: state.activeRoute.endsWith("/full")
		})
	});
	const existing = state.mainTabs.find((t) => tabIdentityMatch(t, target));
	if (existing) {
		existing.href = href;
		existing.para = target.para || null;
		existing.unit = target.unit || null;
		state.activeMainTabId = existing.id;
		persistSessionTabs();
		renderMainTabs();
		if (window.location.hash !== href) window.location.hash = href;
		else showToast(`${formatTabLabel(existing)} focused`);
		return existing;
	}
	state.pendingNewMainTab = true;
	if (window.location.hash === href) {
		syncMainTabFromRoute(target);
		return state.mainTabs.find((t) => t.id === state.activeMainTabId) || null;
	}
	window.location.hash = href;
	return null;
}
function switchMainTab(tabId) {
	const tab = state.mainTabs.find((t) => t.id === tabId);
	if (!tab) return;
	state.activeMainTabId = tab.id;
	persistSessionTabs();
	renderMainTabs();
	if (tab.href && window.location.hash !== tab.href) window.location.hash = tab.href;
}
function closeMainTab(tabId) {
	if (state.mainTabs.length <= 1) return;
	const idx = state.mainTabs.findIndex((t) => t.id === tabId);
	if (idx < 0) return;
	const wasActive = state.mainTabs[idx].id === state.activeMainTabId;
	state.mainTabs.splice(idx, 1);
	if (wasActive) {
		const next = state.mainTabs[Math.min(idx, state.mainTabs.length - 1)] || state.mainTabs[0];
		state.activeMainTabId = next?.id || null;
		persistSessionTabs();
		if (next?.href && window.location.hash !== next.href) window.location.hash = next.href;
		else renderMainTabs();
	} else {
		persistSessionTabs();
		renderMainTabs();
	}
}
function suggestTabGroupName() {
	const m = state.mainTabs.find((t) => t.id === state.activeMainTabId) || state.mainTabs[0];
	const s = state.splitTabs.find((t) => t.id === state.activeSplitTabId) || state.splitTabs[0];
	const mLabel = m ? formatTabLabel(m) : "";
	const sLabel = s ? formatTabLabel(s) : "";
	if (mLabel && sLabel) return `${mLabel} + ${sLabel}`;
	const total = state.mainTabs.length + state.splitTabs.length;
	return mLabel ? `${mLabel}${total > 1 ? ` (${total} tabs)` : ""}` : `Research tabs (${total})`;
}
function buildTabGroupSnapshot(customName = "") {
	const activeMainIdx = Math.max(0, state.mainTabs.findIndex((t) => t.id === state.activeMainTabId));
	const activeSplitIdx = Math.max(0, state.splitTabs.findIndex((t) => t.id === state.activeSplitTabId));
	return {
		id: `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
		name: (customName || "").trim() || suggestTabGroupName(),
		saved_at: (/* @__PURE__ */ new Date()).toISOString(),
		mainTabs: state.mainTabs.map((t) => ({
			id: t.id,
			kind: t.kind,
			title: Number(t.title),
			sectionId: t.sectionId,
			partId: t.partId,
			unit: t.unit || null,
			full: Boolean(t.full),
			para: t.para || null,
			label: formatTabLabel(t),
			heading: t.heading || "",
			tier: t.tier || "cfr",
			href: t.href || buildReaderHref(t)
		})),
		activeMainIdx,
		splitTabs: state.splitTabs.map((s) => ({
			id: s.id,
			kind: s.kind || (s.partId && !s.sectionId ? "part" : "section"),
			title: Number(s.title),
			sectionId: s.sectionId,
			partId: s.partId,
			unit: s.unit || null,
			full: Boolean(s.full),
			para: s.para || null,
			label: s.label || formatTabLabel(s),
			heading: s.heading || ""
		})),
		activeSplitIdx,
		splitWide: Boolean(state.splitWide)
	};
}
function restoreTabGroup(group) {
	if (!group) return;
	const restoredMain = (group.mainTabs || []).map((t) => makeMainTabEntry(t));
	state.mainTabs = restoredMain;
	const activeMain = restoredMain[Math.min(group.activeMainIdx || 0, Math.max(0, restoredMain.length - 1))] || null;
	state.activeMainTabId = activeMain?.id || null;
	state.splitWide = Boolean(group.splitWide);
	const restoredSplit = Array.isArray(group.splitTabs) ? group.splitTabs : [];
	if (restoredSplit.length > 0 && splitRestorer) splitRestorer(restoredSplit, group.activeSplitIdx || 0, group.splitWide);
	else if (splitCloser) splitCloser();
	persistSessionTabs();
	renderMainTabs();
	const total = restoredMain.length + restoredSplit.length;
	showToast(`Restored “${group.name}” (${total} ${total === 1 ? "tab" : "tabs"})`);
	if (activeMain?.href && window.location.hash !== activeMain.href) window.location.hash = activeMain.href;
}
if (dom.mainTabs) dom.mainTabs.addEventListener("click", (e) => {
	const t = e.target;
	const closeBtn = t?.closest("[data-tab-close]");
	if (closeBtn?.dataset.tabClose) {
		e.preventDefault();
		e.stopPropagation();
		closeMainTab(closeBtn.dataset.tabClose);
		return;
	}
	const switchBtn = t?.closest("[data-tab-switch]");
	if (switchBtn?.dataset.tabSwitch) {
		switchMainTab(switchBtn.dataset.tabSwitch);
		return;
	}
	const saveBtn = t?.closest("[data-tabs-act=\"save-group\"]");
	if (saveBtn) emit("tabs:save-group", { anchor: saveBtn });
});
// src/core/chat_context.ts
/**
* What Claude should know is open when the reader is on a non-CFR page (TL-09).
*
* `openItemFromHash` reads the current hash route and returns the unit on screen as the
* store keys it: `{corpus, key, collection?}`. The server (`chat.open_ref`) turns that into
* a canonical id and ignores anything that is not one, so this module never needs the full
* ID grammar. A CFR section is not handled here: it still travels as `section_id`.
*
* Pure (no DOM, no state) so it is unit-tested in `tests/unit.test.ts`.
*/
var MAX_KEY = 240;
function dec(s) {
	try {
		return decodeURIComponent(s);
	} catch {
		return null;
	}
}
function clean(s) {
	if (!s) return null;
	const t = s.trim();
	return t && t.length <= MAX_KEY ? t : null;
}
function openItemFromHash(hash) {
	const raw = (hash || "").replace(/^#/, "");
	const qi = raw.indexOf("?");
	const path = qi >= 0 ? raw.slice(0, qi) : raw;
	const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : "");
	let m = /^\/usc\/(\d{1,3})\/section\/([^/?]+)/.exec(path);
	if (m) {
		const key = clean(dec(m[2]));
		const title = parseInt(m[1], 10);
		if (!key) return null;
		return {
			corpus: "usc",
			key,
			collection: String(title),
			label: `${uscCite(title)} § ${key}`
		};
	}
	m = /^\/constitution\/([^/]+)\/?$/.exec(path);
	if (m) {
		const key = clean(dec(m[1]));
		if (!key) return null;
		return {
			corpus: "constitution",
			key,
			label: `U.S. Constitution · ${key}`
		};
	}
	m = /^\/law\/([^/]+)/.exec(path);
	if (m) {
		const key = clean(dec(m[1]));
		if (!key) return null;
		const pvt = /^(\d+)-pvt-(\d+)$/.exec(key);
		return {
			corpus: "plaw",
			key,
			label: pvt ? `Private Law ${pvt[1]}-${pvt[2]}` : `Pub. L. ${key}`
		};
	}
	m = /^\/news\/fr\/([^/]+)\/?$/.exec(path);
	if (m) {
		const key = clean(dec(m[1]));
		if (!key) return null;
		return {
			corpus: "fr",
			key,
			label: `FR Doc. ${key}`
		};
	}
	m = /^\/news\/agenda\/([0-9A-Za-z-]{4,20})\/?$/.exec(path);
	if (m) {
		const edition = params.get("edition");
		const item = {
			corpus: "agenda",
			key: m[1].toUpperCase(),
			label: `RIN ${m[1].toUpperCase()}`
		};
		if (edition && /^\d{6}$/.test(edition)) item.collection = edition;
		return item;
	}
	return null;
}
// src/components/chat.ts
var chatAbort = null;
var chatGenSeq = 0;
function abortActiveChat() {
	if (chatAbort) {
		try {
			chatAbort.abort();
		} catch {}
		chatAbort = null;
	}
	chatGenSeq++;
}
function toggleChat() {
	if (state.noTitles) return;
	if (dom.chat.hidden) openChat();
	else closeChat();
}
function openChat() {
	dom.chat.hidden = false;
	dom.layout.classList.add("chat-open");
	applyNav();
	dom.chatToggle.classList.add("is-active");
	dom.chatToggle.setAttribute("aria-expanded", "true");
	if (state.chatHistory.length === 0) renderChatWelcome();
	dom.chatText.focus();
}
function closeChat() {
	abortActiveChat();
	const hadFocus = dom.chat.contains(document.activeElement);
	dom.chat.hidden = true;
	dom.layout.classList.remove("chat-open");
	applyNav();
	dom.chatToggle.classList.remove("is-active");
	dom.chatToggle.setAttribute("aria-expanded", "false");
	if (hadFocus) dom.chatToggle.focus();
}
/** The non-CFR unit on screen (U.S.C., Constitution, law, FR document, Agenda rule), if any. */
function currentOpenItem() {
	if (state.currentSection) return null;
	return openItemFromHash(location.hash);
}
function updateChatContext() {
	const open = currentOpenItem();
	if (state.currentSection) {
		dom.chatContext.hidden = false;
		dom.contextLabel.textContent = `${state.currentSection.label} (Title ${state.currentTitle})`;
	} else if (open) {
		dom.chatContext.hidden = false;
		dom.contextLabel.textContent = open.label;
	} else dom.chatContext.hidden = true;
	if (!dom.chat.hidden && state.chatHistory.length === 0 && !state.isGenerating) renderChatWelcome();
}
on("route:changed", () => updateChatContext());
var HOME_PROMPTS = {
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
function renderChatWelcome() {
	if (!state.chatConfig.configured) {
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
	if (state.chatConfig.error) {
		dom.chatMessages.innerHTML = `
      <div class="setup-card">
        <h3>Claude isn’t available</h3>
        <p class="setup-error">${escapeHtml(state.chatConfig.error)}</p>
        <p>Reading and search still work in the meantime.</p>
      </div>
    `;
		return;
	}
	let prompts = [
		"What are the key requirements in this section?",
		"Who is exempt and who is covered?",
		"Draft an audit and compliance checklist for this rule."
	];
	const open = currentOpenItem();
	if (open) prompts = [
		"Explain this in plain English.",
		"Which regulations or statutes connect to this?",
		"What are the key dates and obligations here?"
	];
	else if (!state.currentSection) prompts = HOME_PROMPTS[state.currentTitle] || [
		"What does this title cover, at a high level?",
		"What are the most important definitions in this title?",
		"Find the penalty and enforcement provisions in this title."
	];
	const titleList = state.installedTitles.map((t) => "Title " + t.title).join(", ") || `Title ${state.currentTitle}`;
	dom.chatMessages.innerHTML = `
    <div class="chat-empty">
      <h3>Ask Claude about ${state.currentSection ? escapeHtml(state.currentSection.label) : open ? escapeHtml(open.label) : "Title " + state.currentTitle}</h3>
      <p>Claude searches and reads every installed federal framework: the Constitution, the U.S. Code, Public Laws, the CFR (${escapeHtml(titleList)}), the Federal Register and the Unified Agenda. Select any passage to ask about it.</p>
      <div class="suggestions">
        ${prompts.map((p) => `<button type="button" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join("")}
      </div>
    </div>
  `;
	dom.chatMessages.querySelectorAll(".suggestions button").forEach((b) => {
		b.addEventListener("click", () => {
			dom.chatText.value = b.dataset.prompt || "";
			submitChat();
		});
	});
}
var TOOL_LABELS = {
	search_regulations: "Searching the regulations…",
	read_section: "Reading a section…",
	list_part: "Looking through a part…"
};
async function submitChat() {
	const text = dom.chatText.value.trim();
	if (!text || state.isGenerating) return;
	if (!state.chatConfig.configured) {
		openChat();
		return;
	}
	if (!(dom.modelSelect.value || state.chatConfig.default)) {
		showToast(state.chatConfig.error || "Claude isn’t available right now.", 5e3);
		return;
	}
	dom.chatText.value = "";
	dom.chatText.style.height = "auto";
	state.chatHistory.push({
		role: "user",
		content: text
	});
	appendChatMessage("user", text);
	const assistantMsgEl = appendChatMessage("assistant", "");
	state.isGenerating = true;
	dom.chatSend.disabled = true;
	const model = dom.modelSelect.value || state.chatConfig.default;
	const includeContext = dom.contextToggle.checked;
	const sectionId = includeContext && state.currentSection ? state.currentSection.id : null;
	const openItem = includeContext ? currentOpenItem() : null;
	const open = openItem ? {
		corpus: openItem.corpus,
		key: openItem.key,
		...openItem.collection ? { collection: openItem.collection } : {}
	} : null;
	let replyText = "";
	let renderRaf = 0;
	let contentDiv = null;
	abortActiveChat();
	chatAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
	const seq = chatGenSeq;
	const flushMarkdown = () => {
		renderRaf = 0;
		if (seq !== chatGenSeq || !assistantMsgEl.isConnected) return;
		if (!contentDiv) {
			contentDiv = document.createElement("div");
			contentDiv.className = "md";
			assistantMsgEl.appendChild(contentDiv);
		}
		contentDiv.innerHTML = renderMarkdown(replyText);
		dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
	};
	const scheduleMarkdown = () => {
		if (!renderRaf) renderRaf = requestAnimationFrame(flushMarkdown);
	};
	try {
		const res = await fetch("/api/" + state.currentTitle + "/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: chatAbort?.signal,
			body: JSON.stringify({
				messages: state.chatHistory,
				section_id: sectionId,
				open,
				model
			})
		});
		if (!res.ok) {
			assistantMsgEl.innerHTML = `<div class="msg-error">${escapeHtml((await res.json()).detail || "Request failed")}</div>`;
			return;
		}
		const reader = res.body?.getReader();
		if (!reader) return;
		const decoder = new TextDecoder();
		let buffer = "";
		let toolsEl = null;
		while (true) {
			const { done, value } = await reader.read();
			if (done || seq !== chatGenSeq) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n\n");
			buffer = lines.pop() ?? "";
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
					chip.textContent = ev.name && TOOL_LABELS[ev.name] || `Using ${ev.name || "tool"}…`;
					toolsEl.appendChild(chip);
				} else if (ev.type === "tool_result") {
					if (toolsEl && toolsEl.lastElementChild) {
						toolsEl.lastElementChild.className = "tool-chip";
						toolsEl.lastElementChild.textContent = ev.summary || `Finished ${ev.name || "tool"}`;
					}
				} else if (ev.type === "text") {
					replyText += ev.text || "";
					scheduleMarkdown();
				} else if (ev.type === "error") {
					const errDiv = document.createElement("div");
					errDiv.className = "msg-error";
					errDiv.textContent = ev.message || "Chat error";
					assistantMsgEl.appendChild(errDiv);
				}
			}
		}
		if (renderRaf) {
			cancelAnimationFrame(renderRaf);
			flushMarkdown();
		}
	} catch (err) {
		if (renderRaf) cancelAnimationFrame(renderRaf);
		if (err instanceof Error && err.name === "AbortError") return;
		assistantMsgEl.innerHTML = `<div class="msg-error">Chat error: ${escapeHtml(err instanceof Error ? err.message : "Unexpected error")}</div>`;
	} finally {
		if (seq === chatGenSeq) {
			if (replyText) state.chatHistory.push({
				role: "assistant",
				content: replyText
			});
			else state.chatHistory.pop();
		}
		chatAbort = null;
		state.isGenerating = false;
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
dom.chatText?.addEventListener("input", () => {
	dom.chatText.style.height = "auto";
	dom.chatText.style.height = Math.min(dom.chatText.scrollHeight, 180) + "px";
});
dom.chatText?.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		submitChat();
	}
});
dom.chatForm?.addEventListener("submit", (e) => {
	e.preventDefault();
	submitChat();
});
dom.chatNew?.addEventListener("click", () => {
	abortActiveChat();
	state.chatHistory = [];
	renderChatWelcome();
});
dom.chatToggle?.addEventListener("click", toggleChat);
dom.chatClose?.addEventListener("click", closeChat);
on("models:updated", () => {
	if (!dom.chat.hidden && state.chatHistory.length === 0 && !state.isGenerating) renderChatWelcome();
});
// src/components/env_modal.ts
var envModalEl = typeof document !== "undefined" ? document.getElementById("env-modal") : null;
var envModalDialog = envModalEl ? envModalEl.querySelector(".modal-dialog") : null;
state.envModalReturnFocus = null;
state.envModalSnapshot = null;
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
	const model = String(keys.ANTHROPIC_MODEL && keys.ANTHROPIC_MODEL.value || "");
	const modelDefault = keys.ANTHROPIC_MODEL && keys.ANTHROPIC_MODEL.default || "claude-sonnet-5-5";
	const newsSync = keys.NEWS_SYNC ? Boolean(keys.NEWS_SYNC.value) : true;
	const retDays = Number(keys.NEWS_RETENTION_DAYS && keys.NEWS_RETENTION_DAYS.value || 365);
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
	if (!form) return;
	const syncPreview = () => {
		if (preview) preview.textContent = envPreviewText(form, state.envModalSnapshot);
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
	state.envModalReturnFocus = document.activeElement;
	envModalDialog.innerHTML = `<div class="modal-head"><h2 id="env-modal-title" class="modal-title">Configure reader/.env</h2>
    <button type="button" class="icon-btn" data-env-close aria-label="Close modal">${icon("close")}</button></div>
    <div class="modal-body"><div class="loading">Loading current configuration…</div></div>`;
	envModalEl.hidden = false;
	setModalBackgroundInert(true);
	try {
		state.envModalSnapshot = await getJSON("/api/settings/env");
		state.navEnvStatus = state.envModalSnapshot;
		renderEnvModal(state.envModalSnapshot, focusKey);
	} catch {
		state.envModalSnapshot = {
			env_exists: false,
			env_file: "reader/.env",
			keys: {}
		};
		renderEnvModal(state.envModalSnapshot, focusKey);
	}
}
function closeEnvModal(restoreFocus = true) {
	if (!envModalEl || envModalEl.hidden) return;
	envModalEl.hidden = true;
	setModalBackgroundInert(false);
	if (restoreFocus && state.envModalReturnFocus && document.contains(state.envModalReturnFocus)) state.envModalReturnFocus.focus?.();
	state.envModalReturnFocus = null;
}
async function refreshModelsConfig() {
	if (state.noTitles) return;
	try {
		const cfg = await fetchTitleModels(state.currentTitle);
		if (!cfg) return;
		state.chatConfig = cfg;
		const modelSelect = dom.modelSelect;
		if (state.chatConfig.configured && state.chatConfig.models.length > 0) {
			modelSelect.innerHTML = state.chatConfig.models.map((m) => `
        <option value="${escapeHtml(m.id)}" ${m.id === state.chatConfig.default ? "selected" : ""}>
          ${escapeHtml(m.name)}
        </option>
      `).join("");
			modelSelect.hidden = false;
		} else {
			modelSelect.innerHTML = "";
			modelSelect.hidden = true;
		}
		emit("models:updated");
	} catch {}
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
	const val = (name) => form.elements.namedItem(name);
	const payload = {
		dol_api_key: val("dol_api_key")?.value ?? null,
		clear_dol_api_key: Boolean(val("clear_dol_api_key")?.checked),
		anthropic_api_key: val("anthropic_api_key")?.value ?? null,
		clear_anthropic_api_key: Boolean(val("clear_anthropic_api_key")?.checked),
		anthropic_model: val("anthropic_model")?.value ?? null,
		news_sync: Boolean(val("news_sync")?.checked),
		news_retention_days: val("news_retention_days") ? Number(val("news_retention_days").value) || 365 : 365
	};
	try {
		const res = await getJSON("/api/settings/env", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
		state.navEnvStatus = res.status;
		state.envModalSnapshot = res.status;
		const [newsSt] = await Promise.all([getJSON("/api/news/status").catch(() => null), refreshModelsConfig()]);
		if (newsSt) state.navNewsStatus = newsSt;
		closeEnvModal(true);
		showToast((res.news_sync_queued || []).length > 0 ? "Saved to reader/.env · Syncing DOL enforcement data…" : "Saved to reader/.env — active immediately");
		emit("env:saved");
	} catch (err) {
		if (errEl) {
			errEl.textContent = (err instanceof Error ? err.message : "") || "Could not save reader/.env";
			errEl.hidden = false;
		}
		if (saveBtn) saveBtn.disabled = false;
	}
}
if (envModalEl) envModalEl.addEventListener("click", (e) => {
	const t = e.target;
	if (t === envModalEl || t?.closest("[data-env-close]")) {
		closeEnvModal(true);
		return;
	}
	const rev = t?.closest("[data-env-reveal]");
	if (rev?.dataset.envReveal) {
		const inp = document.getElementById(rev.dataset.envReveal);
		if (inp) {
			const show = inp.type === "password";
			inp.type = show ? "text" : "password";
			rev.innerHTML = icon(show ? "eyeOff" : "eye");
		}
	}
});
if (typeof document !== "undefined") document.addEventListener("keydown", (e) => {
	if (!envModalEl || envModalEl.hidden) return;
	if (e.key === "Escape") {
		e.preventDefault();
		closeEnvModal(true);
		return;
	}
	trapFocusKeydown(envModalDialog, e);
});
if (typeof document !== "undefined") document.addEventListener("click", (e) => {
	const t = e.target;
	const trigger = t?.closest("[data-open-env]");
	if (trigger) {
		e.preventDefault();
		openEnvModal(trigger.dataset.openEnv || "");
		return;
	}
	const copyBtn = t?.closest("[data-copy-url]");
	if (copyBtn?.dataset.copyUrl) {
		const url = copyBtn.dataset.copyUrl;
		if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => showToast("RSS feed URL copied")).catch(() => showToast(url, 5e3));
		else showToast(url, 5e3);
		return;
	}
	const jump = t?.closest("[data-help-jump]");
	if (jump?.dataset.helpJump) {
		const el = document.getElementById("help-" + jump.dataset.helpJump);
		if (el) el.scrollIntoView({
			behavior: reduceMotion.matches ? "auto" : "smooth",
			block: "start"
		});
	}
});
async function loadStorage() {
	try {
		state.navStorage = await getJSON("/api/library/storage");
	} catch {
		state.navStorage = {
			titles: [],
			legacy_bytes: 0,
			temp_files: 0,
			temp_bytes: 0,
			total_bytes: 0
		};
	}
	emit("env:saved");
}
on("titles:refreshed", ({ hadNone, list }) => {
	if (hadNone && list.length) refreshModelsConfig();
});
// src/core/constitution_text.ts
var ARTICLE_NAMES = {
	1: "The Legislative Branch",
	2: "The Executive Branch",
	3: "The Judicial Branch",
	4: "The States",
	5: "Amending the Constitution",
	6: "Debts, Supremacy and Oaths",
	7: "Ratification"
};
var SECTION_NAMES = {
	"art1-s1": "Legislative powers vested in Congress",
	"art1-s2": "The House of Representatives",
	"art1-s3": "The Senate",
	"art1-s4": "Elections and meetings of Congress",
	"art1-s5": "Rules and proceedings of each House",
	"art1-s6": "Pay, privileges and limits on other offices",
	"art1-s7": "How bills become law",
	"art1-s8": "Powers of Congress",
	"art1-s9": "Limits on Congress",
	"art1-s10": "Limits on the States",
	"art2-s1": "The President and Vice President",
	"art2-s2": "Powers of the President",
	"art2-s3": "Duties of the President",
	"art2-s4": "Impeachment",
	"art3-s1": "The federal courts",
	"art3-s2": "Judicial power and jurisdiction",
	"art3-s3": "Treason",
	"art4-s1": "Full faith and credit",
	"art4-s2": "Privileges and immunities; extradition",
	"art4-s3": "New States and federal property",
	"art4-s4": "A republican form of government"
};
var AMENDMENT_NAMES = {
	1: "Freedom of religion, speech, press, assembly and petition",
	2: "Right to keep and bear arms",
	3: "Quartering of soldiers",
	4: "Searches and seizures",
	5: "Grand jury, double jeopardy, self-incrimination, due process, takings",
	6: "Rights in criminal prosecutions",
	7: "Jury trial in civil cases",
	8: "Bail, fines and punishments",
	9: "Rights kept by the people",
	10: "Powers reserved to the States and the people",
	11: "Suits against States",
	12: "Electing the President and Vice President",
	13: "Abolition of slavery",
	14: "Citizenship, due process and equal protection",
	15: "Voting rights regardless of race",
	16: "Income tax",
	17: "Direct election of Senators",
	18: "Prohibition of alcohol",
	19: "Women’s right to vote",
	20: "Terms of office and succession",
	21: "Repeal of Prohibition",
	22: "Two-term limit for the President",
	23: "Presidential electors for the District of Columbia",
	24: "No poll tax in federal elections",
	25: "Presidential disability and succession",
	26: "Voting age of eighteen",
	27: "Changes to Congress’s pay"
};
function toRoman(n) {
	let out = "";
	for (const [v, r] of [
		[100, "C"],
		[90, "XC"],
		[50, "L"],
		[40, "XL"],
		[10, "X"],
		[9, "IX"],
		[5, "V"],
		[4, "IV"],
		[1, "I"]
	]) while (n >= v) {
		out += r;
		n -= v;
	}
	return out;
}
var articleName = (n) => ARTICLE_NAMES[n] || "";
var amendmentName = (n) => AMENDMENT_NAMES[n] || "";
/** A plain-English heading for a unit: "Powers of Congress", "Citizenship, due process…". */
function constUnitName(u) {
	if (u.kind === "preamble") return "Purposes of the Constitution";
	if (SECTION_NAMES[u.id]) return SECTION_NAMES[u.id];
	if (u.amendment) return amendmentName(u.amendment);
	if (u.article) return articleName(u.article);
	return "";
}
/** Bluebook form: "U.S. Const. art. I, § 8", "U.S. Const. amend. XIV, § 1", "U.S. Const. pmbl.". */
function constCitation(label) {
	const l = (label || "").trim();
	if (/^preamble$/i.test(l)) return "U.S. Const. pmbl.";
	return `U.S. Const. ${l.replace(/^Art\.\s*/i, "art. ").replace(/^Amdt\.\s*/i, "amend. ")}`;
}
/** The outline grouped the way the document reads: Preamble, Articles I–VII, Amendments I–XXVII. */
function constGroups(outline) {
	let preamble = null;
	const articles = /* @__PURE__ */ new Map();
	const amendments = /* @__PURE__ */ new Map();
	for (const u of outline) if (u.kind === "preamble") preamble = {
		key: "preamble",
		label: "Preamble",
		name: constUnitName(u),
		units: [u]
	};
	else if (u.amendment) {
		const g = amendments.get(u.amendment) || {
			key: `amdt${u.amendment}`,
			label: `Amendment ${toRoman(u.amendment)}`,
			name: amendmentName(u.amendment),
			units: []
		};
		g.units.push(u);
		amendments.set(u.amendment, g);
	} else if (u.article) {
		const g = articles.get(u.article) || {
			key: `art${u.article}`,
			label: `Article ${toRoman(u.article)}`,
			name: articleName(u.article),
			units: []
		};
		g.units.push(u);
		articles.set(u.article, g);
	}
	return {
		preamble,
		articles: [...articles.values()],
		amendments: [...amendments.values()]
	};
}
/** Split "1 The House … Year. 2 No Person …" into numbered clauses; one block when it isn't numbered. */
function splitClauses(text) {
	const t = (text || "").trim();
	const first = /^\[?1\]?\s+(?=\S)/.exec(t);
	if (!first) return [{
		n: null,
		text: t
	}];
	const out = [];
	let rest = t.slice(first[0].length);
	let n = 1;
	for (;;) {
		const next = new RegExp(`(?<=[.;:])\\s+\\[?${n + 1}\\]?\\s+(?=[A-Z“"])`).exec(rest);
		if (!next) {
			out.push({
				n,
				text: rest.trim()
			});
			break;
		}
		out.push({
			n,
			text: rest.slice(0, next.index).trim()
		});
		rest = rest.slice(next.index + next[0].length);
		n += 1;
	}
	return out.length > 1 ? out : [{
		n: null,
		text: out[0]?.text || t
	}];
}
// src/views/doc_utils.ts
var figModal = typeof document !== "undefined" ? document.getElementById("figure-modal") : null;
var figReturnFocus = null;
function closeFigureModal() {
	if (!figModal || figModal.hidden) return;
	figModal.hidden = true;
	setModalBackgroundInert(false);
	const dialog = figModal.querySelector(".modal-dialog");
	if (dialog) dialog.innerHTML = "";
	if (figReturnFocus && "focus" in figReturnFocus && typeof figReturnFocus.focus === "function") figReturnFocus.focus();
	figReturnFocus = null;
}
function openFigureModal(figLink) {
	if (!figModal || !figLink) return;
	const img = figLink.querySelector(".reg-img");
	const fullSrc = safeHttpUrl(figLink.getAttribute("href") || img && img.src || "");
	if (!fullSrc) return;
	figReturnFocus = document.activeElement;
	const caption = figLink.previousElementSibling?.classList.contains("reg-label") ? (figLink.previousElementSibling.textContent || "").trim() : "Regulatory Figure";
	const dialog = figModal.querySelector(".modal-dialog");
	if (!dialog) return;
	dialog.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="doc-kicker">Figure preview</div>
        <h2 class="modal-title" id="fig-modal-title">${escapeHtml(caption)}</h2>
      </div>
      <div class="fig-modal-acts">
        <button type="button" class="btn btn-sm" id="fig-invert-btn" aria-pressed="false">Invert contrast</button>
        <a class="btn btn-sm" href="${escapeHtml(fullSrc)}" target="_blank" rel="noopener noreferrer">${icon("external")} Full image</a>
        <button type="button" class="icon-btn" id="fig-close-btn" aria-label="Close preview">${icon("close")}</button>
      </div>
    </div>
    <div class="fig-modal-stage">
      <img src="${escapeHtml(fullSrc)}" alt="${escapeHtml(caption)}" id="fig-modal-img">
    </div>
  `;
	figModal.hidden = false;
	setModalBackgroundInert(true);
	document.getElementById("fig-close-btn")?.focus();
}
if (figModal) {
	figModal.addEventListener("click", (e) => {
		const t = e.target;
		if (e.target === figModal || t?.closest("#fig-close-btn")) {
			closeFigureModal();
			return;
		}
		const inv = t?.closest("#fig-invert-btn");
		if (inv) {
			const stage = figModal.querySelector(".fig-modal-stage");
			if (!stage) return;
			const on = !stage.classList.contains("is-inverted");
			stage.classList.toggle("is-inverted", on);
			inv.setAttribute("aria-pressed", String(on));
		}
	});
	figModal.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			closeFigureModal();
			return;
		}
		trapFocusKeydown(figModal.querySelector(".modal-dialog"), e);
	});
	window.addEventListener("hashchange", closeFigureModal);
}
function findParagraphElement(root, pText) {
	if (!root) return null;
	const clean = (pText || "").trim();
	if (!clean) return null;
	const paras = [...root.querySelectorAll(".reg-p")];
	for (const p of paras) {
		const pm = p.querySelector(".pmark");
		if (pm && (pm.textContent || "").includes(clean)) return p;
	}
	const tokens = clean.match(/\([a-zA-Z0-9]{1,4}\)/g);
	if (!tokens || !tokens.length) return null;
	let ti = 0;
	let lastMatched = null;
	let minLevel = 0;
	for (const p of paras) {
		const lvlMatch = /\blvl-(\d+)\b/.exec(p.className);
		const lvl = lvlMatch ? Number(lvlMatch[1]) : 0;
		const pm = p.querySelector(".pmark");
		if (!pm) continue;
		const pTokens = (pm.textContent || "").match(/\([a-zA-Z0-9]{1,4}\)/g) || [];
		if (!pTokens.length) continue;
		if (ti > 0 && lvl > 0 && lvl <= minLevel) {
			if (lvl === 1 && tokens[0].toLowerCase() !== (pTokens[0] || "").toLowerCase()) {
				ti = 0;
				minLevel = 0;
			}
		}
		let matchedHere = 0;
		let tempIdx = ti;
		for (const pt of pTokens) if (tempIdx < tokens.length && pt.toLowerCase() === tokens[tempIdx].toLowerCase()) {
			tempIdx++;
			matchedHere++;
		} else break;
		if (matchedHere > 0 && (ti === 0 || lvl > minLevel)) {
			ti = tempIdx;
			minLevel = lvl;
			lastMatched = p;
			if (ti === tokens.length) return p;
		}
	}
	return lastMatched;
}
function findParagraphRange(root, pText) {
	const clean = (pText || "").trim();
	if (!clean || !root) return [];
	const rangeM = /^\s*((?:\([a-zA-Z0-9]{1,4}\))+)\s*(?:-|–|through|to)\s*((?:\([a-zA-Z0-9]{1,4}\))+)\s*$/i.exec(clean);
	if (rangeM) {
		const startEl = findParagraphElement(root, rangeM[1]);
		const endEl = findParagraphElement(root, rangeM[2]);
		if (startEl && endEl) {
			const paras = [...root.querySelectorAll(".reg-p")];
			const i1 = paras.indexOf(startEl);
			const i2 = paras.indexOf(endEl);
			if (i1 >= 0 && i2 >= i1 && i2 - i1 < 16) return paras.slice(i1, i2 + 1);
			return [startEl];
		}
		if (startEl) return [startEl];
	}
	const hit = findParagraphElement(root, clean);
	return hit ? [hit] : [];
}
function resolveAnchorTargets(root, target) {
	if (!root || !target) return [];
	const clean = String(target).trim();
	if (!clean) return [];
	const bareId = clean.startsWith("#") ? clean.slice(1) : clean;
	if (/^(table|fig|figure|appendix|fn|ftref|sec|p)-?[a-zA-Z0-9_.\-]+$/i.test(bareId)) try {
		const el = root.querySelector(`#${CSS.escape(bareId)}`);
		if (el) return [el];
	} catch {}
	return findParagraphRange(root, clean);
}
function flashElements(els, scroll = true) {
	if (!els || !els.length) return;
	for (const el of els) {
		el.classList.remove("flash");
		el.offsetWidth;
		el.classList.add("flash");
	}
	if (scroll) smoothScrollToTarget(els[0], { block: "center" });
}
function highlightTarget(root, target, delay = 120) {
	setTimeout(() => {
		flashElements(resolveAnchorTargets(root, target), true);
	}, delay);
}
function slugifyAnchor(raw) {
	return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function enhanceDomAnchors(root = dom.view) {
	if (!root) return;
	const targets = /* @__PURE__ */ new Map();
	let figSeq = 0;
	for (const fig of root.querySelectorAll(".reg-figure")) {
		const cap = fig.previousElementSibling?.classList.contains("reg-label") ? (fig.previousElementSibling.textContent || "").trim() : "";
		const m = /^\s*(Figure\s+[A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\b/i.exec(cap);
		if (!fig.id) {
			figSeq++;
			const base = m ? `fig-${slugifyAnchor(m[1].replace(/^figure\s+/i, ""))}` : `fig-${figSeq}`;
			let id = base;
			let n = 2;
			while (root.querySelector(`#${CSS.escape(id)}`)) id = `${base}-${n++}`;
			fig.id = id;
		}
		if (m) targets.set(m[1].toLowerCase(), {
			label: m[1],
			id: fig.id
		});
	}
	for (const w of root.querySelectorAll(".table-wrap[id^=\"table-\"]")) {
		const cap = w.querySelector("caption")?.textContent || "";
		const m = /^\s*(Table\s+[A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\b/i.exec(cap);
		if (m) targets.set(m[1].toLowerCase(), {
			label: m[1],
			id: w.id
		});
	}
	for (const appEl of root.querySelectorAll(".reg-appendix[id^=\"appendix-\"]")) {
		const head = appEl.querySelector(".reg-subhead, .reg-label, .reg-p")?.textContent || "";
		const m = /^\s*(Appendix\s+[A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\b/i.exec(head);
		if (m) targets.set(m[1].toLowerCase(), {
			label: m[1],
			id: appEl.id
		});
	}
	if (!targets.size) return;
	const pattern = [...targets.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	const re = new RegExp(`\\b(${pattern})\\b`, "gi");
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
		const parent = node.parentElement;
		if (!parent || !parent.closest(".reg-body") || parent.closest("a, button, caption, .reg-table")) return NodeFilter.FILTER_REJECT;
		const txt = node.nodeValue || "";
		return /(?:table|figure|appendix)/i.test(txt) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	} });
	const nodes = [];
	let n;
	while (n = walker.nextNode()) nodes.push(n);
	for (const textNode of nodes) {
		const val = textNode.nodeValue || "";
		re.lastIndex = 0;
		if (!re.test(val)) continue;
		re.lastIndex = 0;
		const frag = document.createDocumentFragment();
		let last = 0;
		let match;
		while ((match = re.exec(val)) !== null) {
			if (match.index > last) frag.appendChild(document.createTextNode(val.slice(last, match.index)));
			const hit = targets.get(match[1].toLowerCase());
			if (hit) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "xref xref-anchor";
				btn.dataset.anchor = hit.id;
				btn.textContent = match[0];
				frag.appendChild(btn);
			} else frag.appendChild(document.createTextNode(match[0]));
			last = match.index + match[0].length;
		}
		if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
		textNode.parentNode?.replaceChild(frag, textNode);
	}
}
function resolveParagraphPath(root, paraEl) {
	if (!root || !paraEl) return "";
	const paras = [...root.querySelectorAll(".reg-p")];
	const idx = paras.indexOf(paraEl);
	const levelOf = (el) => Number(/\blvl-(\d+)\b/.exec(el.className)?.[1] || 0);
	const marksOf = (el) => el.querySelector(".pmark")?.textContent || "";
	if (idx < 0) return paragraphPathFrom([{
		lvl: 1,
		marks: marksOf(paraEl)
	}], 0);
	return paragraphPathFrom(paras.map((p) => ({
		lvl: levelOf(p),
		marks: marksOf(p)
	})), idx);
}
function formatCfrCitation(title, sectionLabelOrId, para = "") {
	const cleanLabel = String(sectionLabelOrId || "").trim();
	return `${title} C.F.R. ${cleanLabel.startsWith("§") ? cleanLabel : `§ ${cleanLabel}`}${para || ""}`;
}
/** The citation for a workspace reference: "29 U.S.C. § 655(b)(1)" for a statute, else CFR form. */
function formatRefCitation(ref, para = "") {
	if (ref.tier === "federal-statute") return `${uscCite(ref.title)} § ${ref.id}${para || ""}`;
	if (ref.tier === "federal-constitution") return constCitation(ref.label);
	return formatCfrCitation(ref.title, cleanInlineLabel(ref.label), para);
}
function wrapIbrMentions(root, ibrList) {
	if (!root || !Array.isArray(ibrList) || !ibrList.length) return;
	const byMatch = /* @__PURE__ */ new Map();
	for (const item of ibrList) {
		if (!item || !item.match_text) continue;
		byMatch.set(item.match_text.toLowerCase(), item);
		if (item.code) byMatch.set(item.code.toLowerCase(), item);
	}
	if (!byMatch.size) return;
	const escaped = [...byMatch.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	const re = new RegExp(`(${escaped})`, "gi");
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
		const parent = node.parentElement;
		if (!parent || !parent.closest(".reg-body") || parent.closest("a, button, .pmark, .runin")) return NodeFilter.FILTER_REJECT;
		return NodeFilter.FILTER_ACCEPT;
	} });
	const nodes = [];
	let n;
	while (n = walker.nextNode()) nodes.push(n);
	for (const textNode of nodes) {
		const val = textNode.nodeValue || "";
		re.lastIndex = 0;
		if (!re.test(val)) continue;
		re.lastIndex = 0;
		const frag = document.createDocumentFragment();
		let last = 0;
		let match;
		while ((match = re.exec(val)) !== null) {
			if (match.index > last) frag.appendChild(document.createTextNode(val.slice(last, match.index)));
			const item = byMatch.get(match[1].toLowerCase());
			if (item) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "xref xref-ibr";
				btn.dataset.ibrCode = item.code;
				btn.title = item.approved_in ? `${item.code} — IBR approved in ${item.approved_in.label}${item.approved_in.para || ""}` : `${item.code} (${item.org_name || item.org})`;
				btn.textContent = match[0];
				frag.appendChild(btn);
			} else frag.appendChild(document.createTextNode(match[0]));
			last = match.index + match[0].length;
		}
		if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
		textNode.parentNode?.replaceChild(frag, textNode);
	}
}
function renderViewError(container, title, message, { retryLabel = "Try again", onRetry = null } = {}) {
	if (!container) return;
	container.innerHTML = emptyStateHtml({
		title,
		body: escapeHtml(message),
		actionsHtml: onRetry ? `<button type="button" class="btn" id="view-err-retry">${escapeHtml(retryLabel)}</button>` : ""
	});
	if (onRetry) document.getElementById("view-err-retry")?.addEventListener("click", onRetry);
}
function parseCfrHref(href, fallbackTitle = 29) {
	if (!href) return null;
	if (href.startsWith("#")) {
		const [pathPart, qs] = href.slice(1).split("?");
		const params = new URLSearchParams(qs || "");
		const mCorpusSec = /^\/corpus\/(?:federal-reg|cfr)\/[^/]+\/(\d+)\/section\/([^/]+)(?:\/([^/]+))?$/.exec(pathPart);
		if (mCorpusSec) return {
			kind: "section",
			title: parseInt(mCorpusSec[1], 10),
			section: decodeURIComponent(mCorpusSec[2]),
			unit: mCorpusSec[3] ? decodeURIComponent(mCorpusSec[3]) : null,
			para: params.get("p") || null
		};
		const mTitleSec = /^\/title\/(\d+)\/section\/([^/]+)(?:\/([^/]+))?$/.exec(pathPart);
		if (mTitleSec) return {
			kind: "section",
			title: parseInt(mTitleSec[1], 10),
			section: decodeURIComponent(mTitleSec[2]),
			unit: mTitleSec[3] ? decodeURIComponent(mTitleSec[3]) : null,
			para: params.get("p") || null
		};
		const mSec = /^\/section\/([^/]+)(?:\/([^/]+))?$/.exec(pathPart);
		if (mSec) return {
			kind: "section",
			title: fallbackTitle,
			section: decodeURIComponent(mSec[1]),
			unit: mSec[2] ? decodeURIComponent(mSec[2]) : null,
			para: params.get("p") || null
		};
		const mCorpusPart = /^\/corpus\/(?:federal-reg|cfr)\/[^/]+\/(\d+)\/part\/([^/]+)$/.exec(pathPart);
		if (mCorpusPart) return {
			kind: "part",
			title: parseInt(mCorpusPart[1], 10),
			part: decodeURIComponent(mCorpusPart[2])
		};
		const mTitlePart = /^\/title\/(\d+)\/part\/([^/]+)$/.exec(pathPart);
		if (mTitlePart) return {
			kind: "part",
			title: parseInt(mTitlePart[1], 10),
			part: decodeURIComponent(mTitlePart[2])
		};
		const mPart = /^\/part\/([^/]+)$/.exec(pathPart);
		if (mPart) return {
			kind: "part",
			title: fallbackTitle,
			part: decodeURIComponent(mPart[1])
		};
	}
	return null;
}
function bindBrokenImageFallback(root, getEcfrUrl) {
	if (!root) return;
	root.addEventListener("error", (e) => {
		const img = e.target;
		if (!(img instanceof HTMLImageElement) || !img.classList.contains("reg-img")) return;
		const fig = img.closest(".reg-figure");
		if (!fig || fig.classList.contains("is-broken")) return;
		fig.classList.add("is-broken");
		const url = safeHttpUrl(getEcfrUrl?.() || "");
		if (url) fig.href = url;
		fig.title = "This figure is only available on eCFR";
		fig.innerHTML = `${icon("external")}<span>Figure — view on eCFR</span>`;
	}, true);
}
function createParaToolsController({ root, bodySelector = ".reg-body", paraSelector = ".reg-body .reg-p[id]", isActive, getSectionRef, formatCite = formatRefCitation, citeTitle = "Copy legal citation" }) {
	let bar = null;
	let target = null;
	const hide = () => {
		if (bar) bar.hidden = true;
		target = null;
	};
	const show = (pEl) => {
		if (!root?.querySelector(bodySelector) || !pEl?.querySelector(".pmark")) {
			hide();
			return;
		}
		if (!bar || !bar.isConnected) {
			bar = document.createElement("div");
			bar.className = "para-tools";
			bar.setAttribute("aria-label", "Paragraph actions");
			bar.innerHTML = `
        <button type="button" class="para-tool-btn" data-para-act="copy" title="${escapeHtml(citeTitle)}">${icon("link")} Cite</button>
        <button type="button" class="para-tool-btn" data-para-act="clip" title="Clip clause to workspace">${icon("bookmark")} Clip</button>
      `;
		}
		target = pEl;
		bar.hidden = false;
		pEl.appendChild(bar);
	};
	if (root) {
		root.addEventListener("mouseover", (e) => {
			if (!isActive()) return;
			const t = e.target;
			if (bar && t && bar.contains(t)) return;
			const p = t?.closest(paraSelector);
			if (p && p.querySelector(".pmark")) {
				if (p !== target) show(p);
			} else hide();
		});
		root.addEventListener("mouseleave", hide);
	}
	const handleClick = async (e) => {
		const btn = e.target?.closest(".para-tool-btn[data-para-act]");
		if (!btn || !target || !isActive()) return false;
		e.preventDefault();
		e.stopPropagation();
		const ref = getSectionRef();
		if (!ref) return true;
		const para = resolveParagraphPath(root, target);
		const cite = formatCite(ref, para);
		if (btn.dataset.paraAct === "copy") await copyText(cite, `Copied ${cite}`, "Couldn’t copy citation");
		else if (btn.dataset.paraAct === "clip") {
			const clone = target.cloneNode(true);
			clone.querySelectorAll(".para-tools").forEach((x) => x.remove());
			clipToWorkspace(ref, {
				para,
				quote: (clone.textContent || "").trim().slice(0, 320),
				cite
			});
		}
		return true;
	};
	return {
		hide,
		handleClick
	};
}
// src/components/rail.ts
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
var UNIT_KIND_MAP = {
	clause: "clause",
	chapter: "part",
	appendix: "appendix"
};
function unitKind(u) {
	return u.kind && UNIT_KIND_MAP[u.kind] || "part";
}
/** `hrefFor(key)` builds a unit link in units mode; the CFR's section route by default. */
function railHtml(data, mode, hrefFor = (key) => sectionHref(data.id, key)) {
	const units = data.outline || [];
	if (units.length < 2 || mode !== "units" && units.length < 4) return "";
	const maxChars = Math.max(1, ...units.map((u) => Number(u.chars) || 0));
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
		const href = mode === "units" ? hrefFor(u.key) : `#u-${u.key}`;
		const name = unitName(u);
		const ratio = Math.sqrt((Number(u.chars) || 0) / maxChars);
		const barPx = Math.round(7 + ratio * 7);
		html += `<a class="rail-item${current ? " is-current" : ""}" href="${href}" data-unit="${escapeHtml(u.key)}"${mode === "units" ? "" : ` data-anchor="u-${escapeHtml(u.key)}"`}${current ? " aria-current=\"true\"" : ""} data-label="${escapeHtml(u.label || "")}" data-name="${escapeHtml(name)}" aria-label="${escapeHtml(`${u.label ? u.label + " " : ""}${name}`)}"><span class="rail-bar" style="--w:${barPx}px" aria-hidden="true"></span></a>`;
	});
	return `<nav class="rail" style="--rows:${rows}" aria-label="Contents of this section">${html}<a class="rail-pop" tabindex="-1" aria-hidden="true"><span class="rail-pop-label"></span><span class="rail-pop-name"></span></a></nav>`;
}
function bindRail() {
	const rail = dom.viewHead?.querySelector(".rail");
	if (!rail) return;
	const pop = rail.querySelector(".rail-pop");
	if (!pop) return;
	const items = [...rail.querySelectorAll(".rail-item")];
	let active = null;
	let hideTimer;
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
		const lbl = pop.querySelector(".rail-pop-label");
		const nm = pop.querySelector(".rail-pop-name");
		if (lbl) lbl.textContent = item.dataset.label || "";
		if (nm) nm.textContent = item.dataset.name || "";
		pop.href = item.getAttribute("href") || "#";
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
		const it = e.target?.closest(".rail-item");
		if (it) show(it);
	});
	rail.addEventListener("focusout", hide);
}
function unitStepHtml(data) {
	const sectionBtn = (s, dir) => s ? docStepBtn("section", dir, sectionHref(s.id), s.label || s.id, s.title) : "";
	const unitBtn = (u, dir) => {
		if (!u) return "";
		return docStepBtn(unitKind(u), dir, sectionHref(data.id, u.key), unitShort(u), unitName(u));
	};
	const sep = "<span class=\"doc-step-sep\" aria-hidden=\"true\"></span>";
	return `<nav class="doc-step" aria-label="Previous and next">${[sectionBtn(data.prev, -1), unitBtn(data.unit_prev, -1)].filter(Boolean).join(sep)}<span class="spacer"></span>${[unitBtn(data.unit_next, 1), sectionBtn(data.next, 1)].filter(Boolean).join(sep)}</nav>`;
}
state.railObserver = null;
function watchRail() {
	if (state.railObserver) {
		state.railObserver.disconnect();
		state.railObserver = null;
	}
	const rail = dom.viewHead?.querySelector(".rail");
	const sections = [...dom.view.querySelectorAll(".reg-unit")];
	if (!rail || !sections.length) return;
	let lit;
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
	state.railObserver = { disconnect: () => {
		dom.main.removeEventListener("scroll", onScroll);
		dom.view.removeEventListener("load", onScroll, true);
		if (frame) cancelAnimationFrame(frame);
	} };
	update();
}
function scrollToAnchor(id, rootOrOpts = {}) {
	const isNode = rootOrOpts && "querySelector" in rootOrOpts && typeof rootOrOpts.querySelector === "function";
	const root = isNode ? rootOrOpts : rootOrOpts.root || dom.view;
	const flash = isNode ? true : rootOrOpts.flash !== false;
	let target = null;
	try {
		target = root && root.querySelector(`#${CSS.escape(id)}`) || document.getElementById(id);
	} catch {
		target = document.getElementById(id);
	}
	if (!target) return false;
	smoothScrollToTarget(target, { block: target.matches(".reg-footnote, .reg-p, .reg-figure") ? "center" : "start" });
	if (flash && target.matches(".reg-footnote, .reg-p, .table-wrap, .reg-appendix, .reg-figure")) {
		target.classList.remove("flash");
		target.offsetWidth;
		target.classList.add("flash");
	}
	return true;
}
for (const rootEl of [dom.viewHead, dom.view].filter(Boolean)) rootEl.addEventListener("click", (e) => {
	const a = e.target?.closest("[data-anchor]");
	if (!a || !a.dataset.anchor) return;
	e.preventDefault();
	scrollToAnchor(a.dataset.anchor, dom.view);
});
bindBrokenImageFallback(dom.view, () => state.currentSection?.ecfr_url || "");
function applyFontSize(v) {
	const size = Math.max(13, Math.min(24, Number(v) || 16));
	lsSet("fontSize", String(size));
	document.documentElement.style.setProperty("--reader-size", size + "px");
	for (const out of document.querySelectorAll("[data-size-val]")) out.textContent = `${size} px`;
	const range = document.getElementById("set-size");
	if (range && Number(range.value) !== size) range.value = String(size);
}
function adjustFontSize(delta) {
	applyFontSize((parseInt(lsGet("fontSize") || "", 10) || 16) + delta);
}
// src/panels/shared.ts
var drLabel = (text, extra = "") => `<h3 class="dr-label"><span>${text}</span>${extra}</h3>`;
var drEmpty = (title, body) => `<div class="dr-empty"><div class="dr-empty-title">${title}</div><p>${body}</p></div>`;
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
// src/components/page_shell.ts
function pageMastheadHtml({ folioLeftHtml, folioRightHtml = "", title, subHtml = "", actionsHtml = "", tabsHtml = "" }) {
	return `<header class="pg-masthead">
      <div class="pg-folio">
        <div class="pg-folio-left">${folioLeftHtml}</div>
        ${folioRightHtml ? `<div class="pg-folio-right">${folioRightHtml}</div>` : ""}
      </div>
      <div class="pg-head">
        <div class="pg-title-copy">
          <h1 class="doc-title pg-display">${escapeHtml(title)}</h1>
          ${subHtml ? `<p class="pg-sub">${subHtml}</p>` : ""}
        </div>
        ${actionsHtml ? `<div class="pg-head-acts">${actionsHtml}</div>` : ""}
      </div>
      ${tabsHtml}
    </header>`;
}
function switchboardHtml({ id, idPrefix, dataAttr, panelId, label, tabs, active }) {
	return `
    <nav class="pg-tabs" id="${escapeHtml(id)}" role="tablist" aria-label="${escapeHtml(label)}" style="--pg-tab-count:${tabs.length}">
      ${tabs.map((t) => {
		const on = active === t.id;
		const tag = t.href ? "a" : "button";
		return `<${tag} ${t.href ? `href="${escapeHtml(t.href)}"` : "type=\"button\""} class="pg-tab${on ? " is-active" : ""}" id="${escapeHtml(`${idPrefix}-${t.id}`)}" role="tab" aria-selected="${on}" aria-controls="${escapeHtml(panelId)}" tabindex="${on ? "0" : "-1"}" data-${dataAttr}="${escapeHtml(t.id)}"${t.refTier ? ` data-ref-tier="${escapeHtml(t.refTier)}"` : ""}>
          <span class="pg-tab-top">
            <span class="pg-tab-abbr">${t.refTier ? "<span class=\"tier-pip\" aria-hidden=\"true\"></span>" : ""}${escapeHtml(t.abbr)}</span>
            <span class="pg-tab-right">
              ${t.alert ? `<span class="stat-dot is-stale" title="${escapeHtml(t.alertTitle || "Update or sync due")}" aria-hidden="true"></span>` : ""}
              ${t.countLabel ? `<span class="pg-tab-count">${escapeHtml(t.countLabel)}</span>` : ""}
            </span>
          </span>
          <span class="pg-tab-label">${escapeHtml(t.label)}</span>
          <span class="pg-tab-sub">${escapeHtml(t.sub)}</span>
        </${tag}>`;
	}).join("")}
    </nav>`;
}
/**
* WAI-ARIA tablist keys for a switchboard: ←/→ wrap, Home/End jump. `activate` receives the
* next tab id and must move focus to it once the tabs are re-rendered.
*/
function bindSwitchboardKeys(tablistSelector, dataAttr, order, activate) {
	const key = dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	onView("keydown", (ev) => {
		const e = ev;
		const tab = e.target?.closest(`${tablistSelector} [data-${dataAttr}]`);
		if (!tab) return;
		const ids = order();
		const idx = ids.indexOf(tab.dataset[key] || "");
		if (idx < 0) return;
		let next = -1;
		if (e.key === "ArrowRight") next = (idx + 1) % ids.length;
		else if (e.key === "ArrowLeft") next = (idx - 1 + ids.length) % ids.length;
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = ids.length - 1;
		if (next < 0) return;
		e.preventDefault();
		activate(ids[next]);
	});
}
function tabLeadHtml({ refTier, kickerHtml, title, subHtml = "", actionsHtml = "", id }) {
	return `<div class="pg-lead"${id ? ` id="${escapeHtml(id)}"` : ""}${refTier ? ` data-ref-tier="${escapeHtml(refTier)}"` : ""}>
      <div class="pg-lead-copy">
        <div class="pg-lead-kicker">${kickerHtml}</div>
        <h2 class="pg-lead-title">${escapeHtml(title)}</h2>
        ${subHtml ? `<p class="pg-lead-sub">${subHtml}</p>` : ""}
      </div>
      ${actionsHtml ? `<div class="pg-lead-acts">${actionsHtml}</div>` : ""}
    </div>`;
}
function kpiStripHtml(cells, { label, refTier, cls = "" }) {
	return `<section class="pg-kpi-strip${cls ? ` ${cls}` : ""}"${refTier ? ` data-ref-tier="${escapeHtml(refTier)}"` : ""} aria-label="${escapeHtml(label)}">
      ${cells.map((c) => `<div class="pg-kpi-cell${c.alert ? " is-alert" : ""}">
        <span class="pg-kpi-lbl">${c.labelHtml}</span>
        <span class="pg-kpi-val">${c.valueHtml}</span>
        ${c.subHtml ? `<span class="pg-kpi-sub">${c.subHtml}</span>` : ""}
      </div>`).join("")}
    </section>`;
}
function flagHtml(title, metaHtml = "", id = "") {
	return `<header class="pg-flag"${id ? ` id="${escapeHtml(id)}"` : ""}><h2 class="pg-flag-title">${escapeHtml(title)}</h2>${metaHtml ? `<span class="pg-flag-meta">${metaHtml}</span>` : ""}</header>`;
}
// src/views/data_sources.ts
var ds = {
	data: null,
	templates: [],
	draft: null,
	dirty: false,
	plan: null,
	planFor: null,
	removeUnselected: false,
	busy: false,
	open: /* @__PURE__ */ new Set(),
	search: {},
	templateId: "",
	saving: false,
	planSeq: 0,
	templateName: null
};
var clone = (v) => JSON.parse(JSON.stringify(v));
var SOURCES_URL = "/api/sources";
var jsonPost = (body, method = "POST") => ({
	method,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body)
});
function sizeLabel(e) {
	if (!e || !e.bytes) return "";
	return `${e.approximate ? "~" : ""}${fmtBytes(e.bytes)}`;
}
async function loadDataSources() {
	const [data, tpl] = await Promise.all([getJSON(SOURCES_URL), getJSON(`${SOURCES_URL}/templates`)]);
	ds.data = data;
	ds.templates = tpl.templates || [];
	if (!ds.dirty || !ds.draft) {
		ds.draft = clone(data.selection);
		ds.dirty = false;
	}
	if (!ds.templateId) ds.templateId = data.default_preset;
}
function choiceFor(id) {
	const d = ds.draft;
	if (!d.sources[id]) d.sources[id] = {
		enabled: false,
		schedule: "",
		scope: {}
	};
	return d.sources[id];
}
function templateBarHtml() {
	const groups = /* @__PURE__ */ new Map();
	for (const t of ds.templates) {
		const g = t.builtin ? t.group || "Presets" : "My templates";
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g).push(t);
	}
	const opts = [...groups].map(([g, list]) => `<optgroup label="${escapeHtml(g)}">${list.map((t) => `<option value="${escapeHtml(t.id)}"${t.id === ds.templateId ? " selected" : ""}>${escapeHtml(t.name)}${t.default ? " (default)" : ""}</option>`).join("")}</optgroup>`).join("");
	const cur = ds.templates.find((t) => t.id === ds.templateId);
	const desc = cur?.description ? escapeHtml(cur.description) : "";
	const needs = cur?.needs_keys?.length ? ` <span class="ds-key-note">${icon("key")} Needs a free key for ${escapeHtml(cur.needs_keys.join(", ").toUpperCase())}</span>` : "";
	return tabLeadHtml({
		kickerHtml: "Templates",
		title: "Start from a template, then tick your own boxes",
		subHtml: "A template fills in the whole checklist below. Nothing downloads until you review the changes and apply them. Unticking only stops updates; your data stays until you choose to remove it.",
		actionsHtml: `<button type="button" class="btn" data-ds-act="export"${ds.templates.filter((t) => !t.builtin).length ? "" : " disabled"}>Export my templates</button>
      <button type="button" class="btn" data-ds-act="import">Import</button>
      <input type="file" accept="application/json,.json" data-ds-import hidden tabindex="-1" aria-hidden="true">`,
		id: "ds-templates"
	}) + `<div class="ds-tpl-row">
      <label class="ds-tpl-pick"><span class="set-name">Template</span>
        <select class="set-select" data-ds-template aria-label="Template">${opts}</select></label>
      <button type="button" class="btn btn-accent" data-ds-act="use-template">Use this template</button>
      ${cur && !cur.builtin ? `<button type="button" class="btn" data-ds-act="delete-template" data-id="${escapeHtml(cur.id)}">Delete</button>` : ""}
    </div>
    ${desc || needs ? `<p class="dr-note ds-tpl-desc">${desc}${needs}</p>` : ""}
    <div class="ds-tpl-row">
      <input type="text" class="set-input" data-ds-template-name maxlength="80" placeholder="Name for your checklist, e.g. My EPA desk" aria-label="Template name">
      <button type="button" class="btn" data-ds-act="save-template">Save my checklist as a template</button>
    </div>`;
}
function statusLine(s) {
	const st = s.status || {};
	const bits = [];
	if (st.installed) {
		if (st.items?.length) bits.push(`${st.items.length} on this computer`);
		if (st.documents) bits.push(`${st.documents.toLocaleString()} documents`);
		if (st.bytes) bits.push(fmtBytes(st.bytes));
	} else bits.push("Nothing downloaded yet");
	if (st.last_refresh) bits.push(`updated ${timeAgo(Date.parse(st.last_refresh))}`);
	if (st.jobs?.length) bits.push("download in progress");
	return `<p class="ds-status">${escapeHtml(bits.join(" · "))}${st.last_error ? ` <span class="ds-err">Last update failed: ${escapeHtml(st.last_error)}</span>` : ""}</p>`;
}
var MODAL_KEYS = /* @__PURE__ */ new Set(["dol_api_key", "anthropic_api_key"]);
function addKeyHtml(env) {
	const k = (env || "").toLowerCase();
	if (MODAL_KEYS.has(k)) return `<button type="button" class="btn btn-sm" data-open-env="${escapeHtml(k)}">Add key</button>`;
	return env ? `<span class="ds-key-how">Add <code>${escapeHtml(env)}=…</code> to <code>reader/.env</code>, then restart.</span>` : "";
}
function keyHtml(s) {
	const parts = [];
	if (s.needs_key) parts.push(s.key_present ? `<p class="ds-key ok">${icon("key")}<span class="ds-key-text">${escapeHtml(s.key_label || "Key")} is set.</span></p>` : `<p class="ds-key">${icon("key")}<span class="ds-key-text">Needs a free ${escapeHtml(s.key_label || "key")}. Ticked boxes wait until it's added.</span>
          ${s.get_key_url ? `<a href="${escapeHtml(s.get_key_url)}" target="_blank" rel="noopener">Get a key</a>` : ""}
          ${addKeyHtml(s.key_env)}</p>`);
	const ok = s.optional_key;
	if (ok && !ok.key_present) parts.push(`<p class="ds-key opt">${icon("key")}<span class="ds-key-text">Optional: ${escapeHtml(ok.key_label)}${ok.purpose ? `. ${escapeHtml(ok.purpose.replace(/\.+$/, ""))}` : ""}.</span>
      <a href="${escapeHtml(ok.get_key_url)}" target="_blank" rel="noopener">Get a key</a>
      ${addKeyHtml(ok.key_env)}</p>`);
	return parts.join("");
}
var optHay = (o) => `${o.label} ${o.desk || ""} ${o.value}`.toLowerCase();
function pickOptions(f, value) {
	const opts = (f.options || []).filter((o) => !o.reserved);
	const known = new Set(opts.map((o) => String(o.value)));
	const extra = (Array.isArray(value) ? value : []).filter((v) => !known.has(String(v))).map((v) => ({
		value: v,
		label: String(v),
		description: "Added outside this list"
	}));
	return [...opts, ...extra];
}
function multiHtml(s, f, value) {
	const key = `${s.id}.${f.id}`;
	const mode = value === "all" ? "all" : value === "installed" ? "installed" : "some";
	const picked = new Set((Array.isArray(value) ? value : []).map(String));
	const modes = [];
	if (f.allow_all) modes.push(["all", "All"]);
	if (f.allow_installed) modes.push(["installed", "The ones on this computer"]);
	modes.push(["some", modes.length ? "Only the ones I tick" : "Pick"]);
	const opts = pickOptions(f, value);
	const q = (ds.search[key] || "").toLowerCase();
	const list = mode === "some" ? `
      <div class="ds-pick-tools">
        <input type="search" class="set-input ds-pick-q" data-ds-search="${escapeHtml(key)}" value="${escapeHtml(ds.search[key] || "")}" placeholder="Filter ${escapeHtml(f.label.toLowerCase())}" aria-label="Filter ${escapeHtml(f.label)}">
        <button type="button" class="btn btn-sm" data-ds-all="${escapeHtml(key)}" data-on="1">Tick all</button>
        <button type="button" class="btn btn-sm" data-ds-all="${escapeHtml(key)}" data-on="0">Clear</button>
        <span class="ds-count">${picked.size} of ${opts.length} ticked</span>
      </div>
      <ul class="ds-pick" role="list">${opts.map((o) => {
		const hay = optHay(o);
		const hidden = q && !hay.includes(q) ? " hidden" : "";
		const sz = sizeLabel(o.estimate);
		return `<li data-hay="${escapeHtml(hay)}"${hidden}><label class="ds-check" title="${escapeHtml(o.description || "")}">
          <input type="checkbox" data-ds-opt="${escapeHtml(key)}" value="${escapeHtml(String(o.value))}"${picked.has(String(o.value)) ? " checked" : ""}>
          <span class="ds-check-label">${escapeHtml(o.label)}</span>${sz ? `<span class="ds-size">${sz}</span>` : ""}</label></li>`;
	}).join("")}</ul>` : "";
	return `<fieldset class="ds-filter">
      <legend class="set-name">${escapeHtml(f.label)}</legend>
      ${f.description ? `<p class="dr-note">${escapeHtml(f.description)}</p>` : ""}
      ${modes.length > 1 ? `<div class="ds-modes" role="radiogroup" aria-label="${escapeHtml(f.label)}">${modes.map(([v, l]) => `<label class="ds-radio"><input type="radio" name="ds-${escapeHtml(key)}" data-ds-mode="${escapeHtml(key)}" value="${v}"${v === mode ? " checked" : ""}> ${escapeHtml(l)}</label>`).join("")}</div>` : ""}
      ${list}
    </fieldset>`;
}
function filterHtml(s, f, choice) {
	const key = `${s.id}.${f.id}`;
	const value = choice.scope[f.id] ?? s.default_scope[f.id];
	if (f.type === "multi") return multiHtml(s, f, value);
	if (f.type === "toggle") return `<label class="ds-check ds-toggle-row"><input type="checkbox" data-ds-toggle="${escapeHtml(key)}"${value ? " checked" : ""}>
      <span><span class="set-name">${escapeHtml(f.label)}</span>${f.description ? `<span class="set-sub">${escapeHtml(f.description)}</span>` : ""}</span></label>`;
	if (f.type === "number") return `<label class="ds-filter ds-number"><span class="set-name">${escapeHtml(f.label)}</span>
      <span class="ds-number-in"><input type="number" class="set-input" data-ds-number="${escapeHtml(key)}" min="${f.min ?? ""}" max="${f.max ?? ""}" value="${escapeHtml(String(value ?? ""))}"> ${escapeHtml(f.unit || "")}</span>
      ${f.description ? `<span class="dr-note">${escapeHtml(f.description)}</span>` : ""}</label>`;
	return `<label class="ds-filter"><span class="set-name">${escapeHtml(f.label)}</span>
    <select class="set-select" data-ds-choice="${escapeHtml(key)}">${(f.options || []).map((o) => `<option value="${escapeHtml(String(o.value))}"${String(o.value) === String(value) ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}</select></label>`;
}
function sourceCardHtml(s) {
	if (!s.available) return `<section class="set-card ds-card is-soon" data-ds-source="${escapeHtml(s.id)}">
      <div class="ds-card-head"><span class="ds-abbr">${escapeHtml(s.short || s.id)}</span>
        <h3 class="ds-title">${escapeHtml(s.label)}</h3><span class="ds-soon">Coming soon</span></div>
      <p class="ds-desc">${escapeHtml(s.description)}</p></section>`;
	const c = choiceFor(s.id);
	const open = ds.open.has(s.id);
	const sched = s.schedule_options.find((o) => o.value === c.schedule);
	return `<section class="set-card ds-card${c.enabled ? "" : " is-off"}" data-ds-source="${escapeHtml(s.id)}">
      <div class="ds-card-head">
        <label class="ds-switch"><input type="checkbox" role="switch" data-ds-enable="${escapeHtml(s.id)}"${c.enabled ? " checked" : ""} aria-label="Keep ${escapeHtml(s.label)} up to date"><span class="ds-switch-ui" aria-hidden="true"></span></label>
        <span class="ds-abbr">${escapeHtml(s.short || s.id)}</span>
        <h3 class="ds-title">${escapeHtml(s.label)}</h3>
      </div>
      <p class="ds-desc">${escapeHtml(s.description)} <span class="ds-provider">From ${escapeHtml(s.provider)}.</span></p>
      ${statusLine(s)}
      ${keyHtml(s)}
      <div class="ds-row">
        <label class="ds-sched"><span class="set-name">Check for updates</span>
          <select class="set-select" data-ds-schedule="${escapeHtml(s.id)}"${c.enabled ? "" : " disabled"}>${s.schedule_options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === c.schedule ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}</select></label>
        ${sched?.description ? `<span class="dr-note">${escapeHtml(sched.description)}</span>` : ""}
      </div>
      ${s.filters.length ? `<button type="button" class="ds-more" data-ds-toggle-open="${escapeHtml(s.id)}" aria-expanded="${open}">${open ? "Hide" : "Choose"} what to collect ${icon("chevronRight")}</button>
        ${open ? `<div class="ds-filters">${s.filters.map((f) => filterHtml(s, f, c)).join("")}</div>` : ""}` : ""}
    </section>`;
}
function reviewHtml() {
	const p = ds.plan;
	if (p) {
		const title = ds.planFor?.templateName ? `Use “${ds.planFor.templateName}”` : "Review your changes";
		const est = p.estimate?.bytes_label ? `<p class="ds-est">Download about ${escapeHtml(p.estimate.bytes_label)}, ${escapeHtml(p.estimate.time_label || "")}.</p>` : "";
		const list = (items, cls) => items.length ? `<ul class="ds-plan-list ${cls}">${items.map((i) => `<li>${escapeHtml(i.label)}${sizeLabel(i.estimate) ? ` <span class="ds-size">${sizeLabel(i.estimate)}</span>` : ""}${i.get_key_url ? ` <a href="${escapeHtml(i.get_key_url)}" target="_blank" rel="noopener">Get a key</a>` : ""}</li>`).join("")}</ul>` : "";
		return `<section class="ds-review" id="ds-review" role="region" aria-label="${escapeHtml(title)}">
        <h3 class="ds-title">${escapeHtml(title)}</h3>
        <p class="ds-summary">${escapeHtml(p.summary)}</p>
        ${est}
        ${list(p.actions, "is-actions")}
        ${list(p.changes, "is-changes")}
        ${p.keeps.length ? `<p class="dr-note">Kept on this computer without updates: ${escapeHtml(p.keeps.join(", "))}.</p>` : ""}
        <label class="ds-check ds-remove"><input type="checkbox" data-ds-remove${ds.removeUnselected ? " checked" : ""}> Also delete the data for anything I unticked</label>
        <div class="ds-review-acts">
          <button type="button" class="btn" data-ds-act="cancel-review">Back</button>
          <button type="button" class="btn btn-accent" data-ds-act="apply"${ds.busy || !ds.planFor ? " disabled" : ""}>${p.needs_confirm || ds.planFor?.remove ? "Yes, apply these changes" : "Apply"}</button>
        </div>
      </section>`;
	}
	if (ds.busy && ds.dirty) return "<div class=\"ds-bar\" role=\"status\"><span>Preparing the review…</span></div>";
	return ds.dirty ? `<div class="ds-bar" role="region" aria-label="Unsaved changes">
      <span>You have changes that aren't applied yet.</span>
      <button type="button" class="btn" data-ds-act="discard">Discard</button>
      <button type="button" class="btn btn-accent" data-ds-act="review"${ds.busy ? " disabled" : ""}>Review changes</button>
    </div>` : "";
}
function dataSourcesHtml() {
	if (!ds.data || !ds.draft) return "<p class=\"dr-note\">Loading data sources…</p>";
	const cats = ds.data.categories;
	const byCat = (c) => ds.data.sources.filter((s) => s.category === c);
	return `<div class="ds" id="ds-root">
      ${templateBarHtml()}
      ${!ds.data.saved && !ds.dirty ? "<p class=\"dr-note ds-derived\">You haven't saved a checklist yet, so the app follows what is already on this computer. Pick a template or tick boxes, then apply.</p>" : ""}
      ${cats.map((c) => byCat(c).length ? `${flagHtml(c)}<div class="ds-grid">${byCat(c).map(sourceCardHtml).join("")}</div>` : "").join("")}
      <div id="ds-review-slot">${reviewHtml()}</div>
    </div>`;
}
function rerender(focusSel) {
	const root = document.getElementById("ds-root");
	if (!root) return;
	const active = document.activeElement;
	const sel = focusSel || (active?.dataset.dsSearch ? `[data-ds-search="${active.dataset.dsSearch}"]` : "");
	const caret = active?.selectionStart ?? null;
	const top = dom.main.scrollTop;
	root.outerHTML = dataSourcesHtml();
	dom.main.scrollTop = top;
	if (sel) {
		const el = document.querySelector(sel);
		if (el) {
			el.focus();
			if (caret != null && el.setSelectionRange) try {
				el.setSelectionRange(caret, caret);
			} catch {}
		}
	}
}
function markDirty() {
	ds.dirty = true;
	dropPlan();
}
function dropPlan() {
	ds.plan = null;
	ds.planFor = null;
	ds.planSeq++;
	ds.busy = false;
}
async function review() {
	if (!ds.draft) return;
	dropPlan();
	const seq = ds.planSeq;
	const snapshot = {
		selection: clone(ds.draft),
		remove: ds.removeUnselected,
		templateName: ds.templateName
	};
	ds.busy = true;
	rerender();
	try {
		const plan = await getJSON(`${SOURCES_URL}/selection/preview`, jsonPost({
			selection: snapshot.selection,
			remove_unselected: snapshot.remove
		}));
		if (seq !== ds.planSeq) return;
		ds.plan = plan;
		ds.planFor = snapshot;
	} catch (err) {
		if (seq !== ds.planSeq) return;
		showToast(err instanceof Error ? err.message : "Could not prepare the changes", 5e3);
	} finally {
		if (seq === ds.planSeq) ds.busy = false;
	}
	rerender();
	document.getElementById("ds-review")?.scrollIntoView({ block: "nearest" });
}
function useTemplate() {
	const t = ds.templates.find((x) => x.id === ds.templateId);
	if (!t) return;
	ds.draft = clone(t.selection);
	ds.templateName = t.name;
	ds.dirty = true;
	review();
}
async function apply() {
	const snap = ds.planFor;
	if (!snap || ds.busy) return;
	ds.busy = true;
	rerender();
	try {
		const res = await getJSON(`${SOURCES_URL}/selection/apply`, jsonPost({
			selection: snap.selection,
			remove_unselected: snap.remove,
			confirm: true
		}));
		const queued = res.queued || [];
		for (const j of queued) state.jobsSeenActive.add(j.id);
		const skipped = res.skipped || [];
		if (res.applied === false) showToast("Nothing was changed");
		else if (skipped.length) showToast(`Saved, but ${skipped.length} step${skipped.length === 1 ? " was" : "s were"} skipped: ${skipped.map((x) => `${x.label} (${x.reason || "skipped"})`).join("; ")}`, 9e3);
		else showToast(queued.length ? "Data sources updated. Downloads run in the transfer dock." : "Data sources updated.");
		ds.dirty = false;
		dropPlan();
		ds.removeUnselected = false;
		ds.templateName = null;
		if (queued.length) pollJobs();
		await loadDataSources();
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Could not apply the changes", 5e3);
	}
	ds.busy = false;
	rerender();
}
async function saveTemplate() {
	const input = document.querySelector("[data-ds-template-name]");
	const name = (input?.value || "").trim();
	if (!name) {
		input?.focus();
		showToast("Give the template a name first");
		return;
	}
	try {
		const t = await getJSON(`${SOURCES_URL}/templates`, jsonPost({
			name,
			selection: ds.draft
		}));
		ds.templates = (await getJSON(`${SOURCES_URL}/templates`)).templates || [];
		ds.templateId = t.id;
		showToast(`Saved “${t.name}”`);
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Could not save the template", 5e3);
	}
	rerender();
}
async function deleteTemplate(id, btn) {
	if (btn.dataset.confirm !== "1") {
		btn.dataset.confirm = "1";
		btn.textContent = "Click again to delete";
		return;
	}
	try {
		await getJSON(`${SOURCES_URL}/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
		ds.templates = ds.templates.filter((t) => t.id !== id);
		ds.templateId = ds.data?.default_preset || "";
		showToast("Template deleted");
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Could not delete the template", 5e3);
	}
	rerender();
}
async function exportTemplates() {
	try {
		const data = await getJSON(`${SOURCES_URL}/templates/export`);
		const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "framework-data-source-templates.json";
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1e3);
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Could not export", 5e3);
	}
}
async function importTemplates(file) {
	try {
		const body = JSON.parse(await file.text());
		const res = await getJSON(`${SOURCES_URL}/templates/import`, jsonPost(body));
		ds.templates = (await getJSON(`${SOURCES_URL}/templates`)).templates || [];
		showToast(res.count ? `Imported ${res.count} template${res.count === 1 ? "" : "s"}` : "No templates found in that file");
	} catch (err) {
		showToast(err instanceof Error && !(err instanceof SyntaxError) ? err.message : "That file isn’t a template export", 5e3);
	}
	rerender();
}
function splitKey(key) {
	const [sid, fid] = key.split(".");
	const s = ds.data?.sources.find((x) => x.id === sid);
	return [s, s?.filters.find((f) => f.id === fid)];
}
function optValue(f, raw) {
	const o = (f.options || []).find((x) => String(x.value) === raw);
	return o ? o.value : raw;
}
var inDs = (t) => Boolean(t?.closest("#ds-root"));
onView("click", (e) => {
	const t = e.target;
	if (!inDs(t)) return;
	const act = t?.closest("[data-ds-act]");
	if (act) {
		const a = act.dataset.dsAct;
		if (a === "review") review();
		else if (a === "use-template") useTemplate();
		else if (a === "apply") apply();
		else if (a === "cancel-review") {
			dropPlan();
			rerender();
		} else if (a === "discard") {
			ds.draft = clone(ds.data.selection);
			ds.dirty = false;
			ds.templateName = null;
			dropPlan();
			rerender();
		} else if (a === "import") document.querySelector("[data-ds-import]")?.click();
		else if (a === "save-template") saveTemplate();
		else if (a === "delete-template") deleteTemplate(act.dataset.id || "", act);
		else if (a === "export") exportTemplates();
		return;
	}
	const more = t?.closest("[data-ds-toggle-open]");
	if (more) {
		const id = more.dataset.dsToggleOpen || "";
		if (ds.open.has(id)) ds.open.delete(id);
		else ds.open.add(id);
		rerender(`[data-ds-toggle-open="${id}"]`);
		return;
	}
	const all = t?.closest("[data-ds-all]");
	if (all) {
		const key = all.dataset.dsAll || "";
		const [s, f] = splitKey(key);
		if (!s || !f) return;
		const q = (ds.search[key] || "").toLowerCase();
		const cur = choiceFor(s.id).scope[f.id];
		const visible = pickOptions(f, cur).filter((o) => !q || optHay(o).includes(q));
		const set = new Set((Array.isArray(cur) ? cur : []).map(String));
		for (const o of visible) if (all.dataset.on === "1") set.add(String(o.value));
		else set.delete(String(o.value));
		choiceFor(s.id).scope[f.id] = [...set].map((v) => optValue(f, v));
		markDirty();
		rerender();
	}
});
onView("change", (e) => {
	const t = e.target;
	if (!t || !inDs(t)) return;
	const d = t.dataset;
	if (d.dsTemplate !== void 0 && t instanceof HTMLSelectElement) {
		ds.templateId = t.value;
		rerender("[data-ds-template]");
		return;
	}
	if (t instanceof HTMLInputElement && t.hasAttribute("data-ds-import")) {
		const file = t.files?.[0];
		if (file) importTemplates(file);
		t.value = "";
		return;
	}
	if (t instanceof HTMLInputElement && t.hasAttribute("data-ds-remove")) {
		ds.removeUnselected = t.checked;
		review();
		return;
	}
	if (d.dsEnable) {
		choiceFor(d.dsEnable).enabled = t.checked;
		markDirty();
		rerender(`[data-ds-enable="${d.dsEnable}"]`);
		return;
	}
	if (d.dsSchedule) {
		choiceFor(d.dsSchedule).schedule = t.value;
		markDirty();
		rerender(`[data-ds-schedule="${d.dsSchedule}"]`);
		return;
	}
	const key = d.dsMode || d.dsOpt || d.dsToggle || d.dsNumber || d.dsChoice;
	if (!key) return;
	const [s, f] = splitKey(key);
	if (!s || !f) return;
	const scope = choiceFor(s.id).scope;
	if (d.dsMode) {
		const prev = scope[f.id];
		scope[f.id] = t.value === "some" ? Array.isArray(prev) ? prev : [] : t.value;
	} else if (d.dsOpt) {
		const cur = scope[f.id];
		const set = new Set((Array.isArray(cur) ? cur : []).map(String));
		if (t.checked) set.add(t.value);
		else set.delete(t.value);
		scope[f.id] = [...set].map((v) => optValue(f, v));
	} else if (d.dsToggle) scope[f.id] = t.checked;
	else if (d.dsNumber) {
		const n = parseInt(t.value, 10);
		if (Number.isNaN(n)) return;
		scope[f.id] = Math.min(f.max ?? n, Math.max(f.min ?? n, n));
	} else if (d.dsChoice) scope[f.id] = optValue(f, t.value);
	markDirty();
	rerender(d.dsOpt ? `[data-ds-opt="${key}"][value="${CSS.escape(t.value)}"]` : d.dsMode ? `[data-ds-mode="${key}"][value="${t.value}"]` : `[data-ds-${d.dsToggle ? "toggle" : d.dsNumber ? "number" : "choice"}="${key}"]`);
});
onView("input", (e) => {
	const t = e.target;
	if (!t?.dataset.dsSearch) return;
	ds.search[t.dataset.dsSearch] = t.value;
	const q = t.value.toLowerCase();
	(t.closest(".ds-filter")?.querySelector(".ds-pick"))?.querySelectorAll("li").forEach((li) => {
		li.hidden = Boolean(q) && !(li.dataset.hay || "").includes(q);
	});
});
// src/panels/settings_panel.ts
state.navStorage = null;
state.navNewsStatus = null;
state.navEnvStatus = null;
async function loadEnvStatus() {
	try {
		state.navEnvStatus = await getJSON("/api/settings/env");
	} catch {
		state.navEnvStatus = null;
	}
	if (state.navEnvStatus) refreshSettingsViews();
}
function timeUntil(iso) {
	if (!iso) return "";
	const s = (Date.parse(iso) - Date.now()) / 1e3;
	if (Number.isNaN(s)) return "";
	if (s <= 60) return "any moment";
	if (s < 3600) return `in ${Math.round(s / 60)}m`;
	if (s < 86400) return `in ${Math.round(s / 3600)}h`;
	return `in ${Math.round(s / 86400)}d`;
}
function newsSettingsHtml() {
	const ns = state.navNewsStatus;
	if (!ns) return "<div class=\"loading\">Checking…</div>";
	if (!ns.sync_enabled) return "<p class=\"dr-note\">News sync is off (<code>NEWS_SYNC=0</code> in <code>reader/.env</code>).</p>";
	const enabled = Object.entries(ns.sources || {}).filter(([, s]) => s.enabled);
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
		state.navNewsStatus = await getJSON("/api/news/status");
	} catch {
		state.navNewsStatus = {
			sync_enabled: false,
			sources: {},
			dol_configured: false
		};
	}
	refreshSettingsViews();
}
var settingSeg = (name, value, opts, disabled = false) => segmentedHtml({
	label: name,
	value,
	cls: "seg",
	dataAttr: `data-set="${escapeHtml(name)}" data-value`,
	items: opts.map(([v, label]) => ({
		value: v,
		label,
		attrs: disabled ? "disabled" : ""
	}))
});
function settingsClaudeHtml() {
	return state.chatConfig.configured && state.chatConfig.models.length ? `<select class="set-select" data-set-model aria-label="Claude model">${state.chatConfig.models.map((m) => `<option value="${escapeHtml(m.id)}"${(dom.modelSelect.value || state.chatConfig.default) === m.id ? " selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}</select>` : "<p class=\"dr-note\">Claude requires an <code>ANTHROPIC_API_KEY</code>. <a class=\"dr-inline-link\" href=\"#/help\">Open setup guide</a> or <button type=\"button\" class=\"dr-inline-btn\" data-open-env=\"anthropic_api_key\">enter key</button>.</p>";
}
function settingsStorageHtml() {
	const st = state.navStorage;
	if (!st) return "<div class=\"loading\">Measuring…</div>";
	return `
    <div class="set-total"><span class="set-total-val">${fmtBytes(st.total_bytes) || "0 KB"}</span><span class="set-total-sub">on disk in ${plural(st.titles.length, "title")}</span></div>
    ${st.titles.map((t) => {
		const meta = state.installedTitles.find((x) => x.title === t.title);
		return `<div class="dr-row is-static"><span class="dr-num">${t.title}</span><span class="dr-name">${escapeHtml(meta ? meta.name : `Title ${t.title}`)}</span><span class="dr-time">${fmtBytes(t.bytes)}</span></div>`;
	}).join("")}
    ${st.legacy_bytes ? `<div class="dr-row is-static"><span class="dr-num"></span><span class="dr-name">Title 29 legacy copy</span><span class="dr-time">${fmtBytes(st.legacy_bytes)}</span></div>` : ""}
    <div class="set-row">
      <span class="set-name">Temporary files<span class="set-sub">${st.temp_files ? `${plural(st.temp_files, "file")} from unfinished downloads` : "None left over"}</span></span>
      <button type="button" class="btn btn-sm" data-set-act="prune"${st.temp_files ? "" : " disabled"}>${st.temp_files ? `Clean up ${fmtBytes(st.temp_bytes)}` : "Clean"}</button>
    </div>`;
}
function settingsKeysHtml() {
	const mod = isMac ? "⌘" : "Ctrl ";
	return `<dl class="set-keys">${[
		[`${mod} K`, "Search or jump to a section"],
		["/", "Search"],
		[">", "Commands, in search"],
		[`${mod} B`, "Toggle sidebar or framework drawer"],
		[`${mod} J`, "Ask Claude"],
		[`${mod} D`, "Pin section to a workspace"],
		["G H", "Home"],
		["G P", "Workspaces"],
		["G N", "Newsroom"],
		["G L", "Library"],
		["G S", "Settings"],
		["G T", "Framework start"],
		["G C", "Framework contents"],
		[isMac ? "⌥ 1–7" : "Alt 1–7", "Main pages & framework shortcuts"],
		["Esc", "Close the floating drawer"]
	].map(([k, v]) => `<div><dt>${k.split(" ").map((x) => `<kbd>${escapeHtml(x)}</kbd>`).join("")}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>`;
}
function renderSettingsPanel() {
	const size = parseInt(lsGet("fontSize") || "", 10) || 16;
	const envKeys = state.navEnvStatus && state.navEnvStatus.keys;
	const configuredKeysCount = envKeys ? (envKeys.DOL_API_KEY?.configured ? 1 : 0) + (envKeys.ANTHROPIC_API_KEY?.configured ? 1 : 0) : null;
	const settingsMeta = configuredKeysCount == null ? "Claude · News · Storage · Keyboard" : `${configuredKeysCount} of 2 optional keys set`;
	setPanel("settings", `
    <section class="dr-sec">${drLabel("Quick settings")}
      <div class="set-row"><span class="set-name">Reading text</span>
        <span class="set-quick-size" role="group" aria-label="Reading text size">
          <button type="button" data-set-act="font-dec" aria-label="Smaller text">A−</button>
          <span class="set-val" data-size-val>${size} px</span>
          <button type="button" data-set-act="font-inc" aria-label="Larger text">A+</button>
        </span></div>
      <div class="set-row"><span class="set-name">Drawer${mqMobile.matches ? "<span class=\"set-sub\">Overlay on narrow screens</span>" : ""}</span>${settingSeg("mode", mqMobile.matches ? "flyout" : navState.mode, [["pinned", "Pinned"], ["flyout", "Overlay"]], mqMobile.matches)}</div>
      <div class="set-row"><span class="set-name">Motion</span>${settingSeg("motion", getMotionLevel(), [
		["none", "No"],
		["less", "Less"],
		["full", "Full"]
	])}</div>
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
	if (!state.navEnvStatus) loadEnvStatus();
}
var settingsTab = "general";
function settingsTabsHtml() {
	return switchboardHtml({
		id: "set-tabs",
		idPrefix: "set-tab",
		dataAttr: "set-tab",
		panelId: "set-tab-body",
		label: "Settings sections",
		active: settingsTab,
		tabs: [{
			id: "general",
			label: "General",
			abbr: "GEN",
			sub: "Appearance, Claude, news, storage, keys",
			href: "#/settings"
		}, {
			id: "sources",
			label: "Data sources",
			abbr: "DATA",
			sub: "What to download and keep up to date",
			href: "#/settings/sources"
		}]
	});
}
async function renderDataSourcesPage(opts = {}) {
	settingsTab = "sources";
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	document.title = "Data sources · Settings · FRAMEWORK";
	const paint = () => {
		dom.view.innerHTML = `<div class="settings-front pg">
      ${pageMastheadHtml({
			folioLeftHtml: `<a href="#/">Home</a>${SEP}<span>Settings</span>`,
			title: "Data sources",
			subHtml: "Choose, in plain checkboxes, what FRAMEWORK downloads and keeps up to date from each federal source.",
			tabsHtml: settingsTabsHtml()
		})}
      <div id="set-tab-body" class="pg-tab-body" role="tabpanel" aria-labelledby="set-tab-sources">${dataSourcesHtml()}</div>
    </div>`;
	};
	paint();
	if (opts.enter) enterView();
	try {
		await loadDataSources();
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Could not load data sources", 5e3);
	}
	if (settingsTab === "sources" && state.activeRoute.startsWith("/settings/sources")) {
		const body = document.getElementById("set-tab-body");
		if (body) body.innerHTML = dataSourcesHtml();
	}
}
function renderSettingsPage(opts = {}) {
	settingsTab = "general";
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	document.title = "Settings · FRAMEWORK";
	const size = parseInt(lsGet("fontSize") || "", 10) || 16;
	const top = dom.main.scrollTop;
	dom.view.innerHTML = `
    <div class="settings-front pg">
      ${pageMastheadHtml({
		folioLeftHtml: `<a href="#/">Home</a>${SEP}<span>Settings</span>`,
		title: "Settings",
		subHtml: "Appearance, Claude, news sync, storage and keyboard shortcuts. What gets downloaded lives under <a href=\"#/settings/sources\">Data sources</a>.",
		actionsHtml: `<button type="button" class="btn" data-open-env="">${icon("key")} Edit API keys</button>`,
		tabsHtml: settingsTabsHtml()
	})}
      <div id="set-tab-body" class="pg-tab-body" role="tabpanel" aria-labelledby="set-tab-general">
      <div class="settings-grid">
        <section class="set-card">
          <h2 class="set-card-label">Appearance</h2>
          <div class="set-row set-col">
            <div class="set-row-head"><label class="set-name" for="set-size">Reading text</label><span class="set-val" id="set-size-val" data-size-val>${size} px</span></div>
            <input type="range" class="set-range" id="set-size" min="13" max="24" step="1" value="${size}">
          </div>
          <div class="set-row"><span class="set-name">Drawer${mqMobile.matches ? "<span class=\"set-sub\">Overlay on narrow screens</span>" : ""}</span>${settingSeg("mode", mqMobile.matches ? "flyout" : navState.mode, [["pinned", "Pinned"], ["flyout", "Overlay"]], mqMobile.matches)}</div>
          <p class="dr-note">Pinned sits beside the page. Overlay slides over it and closes once you pick something.</p>
          <div class="set-row"><span class="set-name">Motion</span>${settingSeg("motion", getMotionLevel(), [
		["none", "No"],
		["less", "Less"],
		["full", "Full"]
	])}</div>
          <p class="dr-note">Full uses slow, soothing glides and tactile settling. Less keeps quiet fades without movement. No turns motion off.</p>
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
      </div>
    </div>`;
	if (opts.enter) enterView();
	else dom.main.scrollTop = top;
	if (!state.navStorage) loadStorage();
	if (!state.navNewsStatus) loadNewsSettings();
	if (!state.navEnvStatus) loadEnvStatus();
}
var onSettingsPage = () => state.activeRoute === "/settings" || state.activeRoute === "/settings/";
var onDataSourcesPage = () => /^\/settings\/sources\/?$/.test(state.activeRoute);
function refreshSettingsViews() {
	if (navState.panel === "settings") renderSettingsPanel();
	if (onSettingsPage()) renderSettingsPage();
	else if (onDataSourcesPage()) renderDataSourcesPage();
}
function setMotionSetting(level) {
	applyMotionLevel(level);
	refreshSettingsViews();
}
async function runSettingsAction(btn) {
	const act = btn.dataset.setAct;
	if (act === "font-dec") adjustFontSize(-1);
	else if (act === "font-inc") adjustFontSize(1);
	else if (act === "news-refresh") emit("news:refresh");
	else if (act === "prune") {
		btn.disabled = true;
		try {
			const res = await getJSON("/api/library/storage/prune", { method: "POST" });
			showToast(res.removed ? `Removed ${plural(res.removed, "temporary file")} (${fmtBytes(res.freed_bytes)})` : "Nothing to clean up");
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Prune failed", 5e3);
		}
		state.navStorage = null;
		refreshSettingsViews();
	}
}
function handleSettingsClick(e) {
	const t = e.target;
	const set = t?.closest("[data-set]");
	if (set) {
		if (set.dataset.set === "mode" && set.dataset.value) setNavMode(set.dataset.value);
		else if (set.dataset.set === "motion") setMotionSetting(set.dataset.value);
		return;
	}
	const setAct = t?.closest("[data-set-act]");
	if (setAct) runSettingsAction(setAct);
}
onView("click", handleSettingsClick);
onView("input", (e) => {
	const t = e.target;
	if (t?.id === "set-size") applyFontSize(t.value);
});
onView("change", (e) => {
	const t = e.target;
	if (t?.matches("[data-set-model]")) {
		dom.modelSelect.value = t.value;
		dom.modelSelect.dispatchEvent(new Event("change"));
	}
});
dom.sidebar?.addEventListener("click", handleSettingsClick);
dom.sidebar?.addEventListener("input", (e) => {
	const t = e.target;
	if (t?.id === "set-size") applyFontSize(t.value);
});
dom.sidebar?.addEventListener("change", (e) => {
	const t = e.target;
	if (t?.matches("[data-set-model]")) {
		dom.modelSelect.value = t.value;
		dom.modelSelect.dispatchEvent(new Event("change"));
	}
});
registerDrawerPanel("settings", renderSettingsPanel);
bindSwitchboardKeys("#set-tabs", "set-tab", () => ["general", "sources"], (id) => {
	window.location.hash = id === "sources" ? "#/settings/sources" : "#/settings";
	requestAnimationFrame(() => document.getElementById(`set-tab-${id}`)?.focus());
});
on("nav:mode-changed", () => refreshSettingsViews());
on("env:saved", () => refreshSettingsViews());
on("jobs:finished", () => {
	if (drawerShown() || onSettingsPage()) refreshSettingsViews();
});
// src/views/ref_almanac.ts
var REF_CATS = [
	["all", "All Web"],
	["ibr", "IBR Standards"],
	["standards", "Standards Bodies"],
	["portals", "Federal Portals"],
	["agencies", "Agencies & Guidance"],
	["technical", "Technical & Other"],
	["legacy", "Retired URLs"]
];
var CAT_LABELS = {
	standards: "Standards",
	portals: "Portal",
	agencies: "Agency",
	technical: "Technical"
};
var refUi = {
	title: null,
	beat: "front",
	cat: "all",
	q: "",
	expanded: false
};
function filterWebEntries(data, cat, q) {
	const ql = q.trim().toLowerCase();
	const hosts = data.hosts && data.hosts.length ? data.hosts : null;
	const rawItems = data.items || [];
	let filtered = (hosts || rawItems).filter((it) => {
		if (cat === "legacy") {
			if (!it.legacy) return false;
		} else if (cat !== "all" && it.category !== cat) return false;
		if (!ql) return true;
		const subUrls = (it.urls || []).map((u) => `${u.url} ${u.display}`).join(" ");
		const cites = (it.cited_in || []).map((c) => `${c.id} ${c.label} ${c.title} ${c.part}`).join(" ");
		return `${it.host} ${it.url} ${it.display} ${subUrls} ${it.legacy?.replacement_url || ""} ${cites}`.toLowerCase().includes(ql);
	});
	if (hosts && ql && !filtered.length) filtered = rawItems.filter((it) => {
		if (cat === "legacy" && !it.legacy) return false;
		if (cat !== "all" && cat !== "legacy" && it.category !== cat) return false;
		const cites = (it.cited_in || []).map((c) => `${c.id} ${c.label} ${c.title} ${c.part}`).join(" ");
		return `${it.host} ${it.url} ${it.display} ${it.legacy?.replacement_url || ""} ${cites}`.toLowerCase().includes(ql);
	});
	return filtered;
}
function filterIbrEntries(data, q) {
	const list = data.ibr_standards || [];
	const ql = q.trim().toLowerCase();
	if (!ql) return list;
	return list.filter((s) => {
		const secs = (s.approved_in || []).map((a) => `${a.id} ${a.label} ${a.part} ${a.para || ""}`).join(" ");
		return `${s.code} ${s.org} ${s.org_name || ""} ${s.excerpt} ${secs}`.toLowerCase().includes(ql);
	});
}
function renderWebItemHtml(item, titleNum) {
	const citesHtml = (item.cited_in || []).slice(0, 4).map((c) => `<a class="citation-chip" data-ref-tier="cfr" href="#/title/${titleNum}/section/${encodeURIComponent(c.id)}" title="${escapeHtml(c.title)}">${escapeHtml(c.label)}</a>`).join("");
	const moreCites = item.cite_count > 4 ? `<span class="ref-cite-more">+${item.cite_count - 4}</span>` : "";
	const href = safeHttpUrl(item.url);
	const leg = item.legacy;
	const replHref = leg ? safeHttpUrl(leg.replacement_url) : "";
	const legacyHtml = leg ? `
    <div class="ref-legacy">
      <span class="stat-pill is-stale is-bare"><span class="stat-dot is-stale" aria-hidden="true"></span>Retired URL</span>
      <span class="ref-legacy-note">${escapeHtml(leg.note)}</span>
      ${replHref ? `<a class="citation-chip" href="${escapeHtml(replHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(leg.replacement_label)} ↗</a>` : ""}
    </div>` : "";
	const pageCount = (item.url_count || 0) > 1 ? `<span class="ref-subpages">${item.url_count} URLs</span>` : "";
	return `
    <article class="ref-item">
      <div class="ref-item-top">
        <span class="ref-host">${escapeHtml(item.host)}</span>
        <span class="ref-cat-pill">${escapeHtml(CAT_LABELS[item.category] || item.category)}</span>
        ${pageCount}
        <span class="ref-count">${plural(item.cite_count, "section")}</span>
      </div>
      ${href ? `<a class="ref-url" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.display)}</a>` : `<span class="ref-url">${escapeHtml(item.display)}</span>`}
      ${legacyHtml}
      ${citesHtml ? `<div class="ref-cites"><span class="ref-cites-lbl">Cited in</span>${citesHtml}${moreCites}</div>` : ""}
    </article>`;
}
function renderIbrItemHtml(std, titleNum) {
	const approved = (std.approved_in || []).slice(0, 4).map((a) => `<a class="citation-chip" data-ref-tier="ibr" href="#/title/${titleNum}/section/${encodeURIComponent(a.id)}${a.para ? "?p=" + encodeURIComponent(a.para) : ""}">${escapeHtml(a.label)}${a.para ? escapeHtml(a.para) : ""}</a>`).join("");
	const extra = (std.section_count || 0) - 4;
	const orgHref = safeHttpUrl(std.org_url);
	return `
    <article class="ref-item is-ibr has-tier-bar" data-ref-tier="ibr">
      <div class="ref-item-top">
        <span class="ref-host">${escapeHtml(std.code)}</span>
        ${orgHref ? `<a class="ref-cat-pill is-link" href="${escapeHtml(orgHref)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(std.org_name || std.org)}">${escapeHtml(std.org)} ↗</a>` : `<span class="ref-cat-pill">${escapeHtml(std.org)}</span>`}
        <span class="ref-count">${plural(std.section_count || 1, "section")}</span>
      </div>
      <div class="ref-ibr-excerpt">${escapeHtml(std.excerpt)}</div>
      <div class="ref-cites">
        <span class="ref-cites-lbl">Approved in</span>
        ${approved}
        ${extra > 0 ? `<span class="ref-cite-more">+${extra}</span>` : ""}
      </div>
    </article>`;
}
function renderRefListHtml(data, titleNum) {
	if (refUi.cat === "ibr") {
		const filtered = filterIbrEntries(data, refUi.q);
		if (!filtered.length) return "<div class=\"ref-empty\">No matching references for the current filter.</div>";
		const showLimit = refUi.expanded || refUi.q.trim() ? filtered.length : 12;
		const shown = filtered.slice(0, showLimit);
		return `<div class="ref-grid">${shown.map((item) => renderIbrItemHtml(item, titleNum)).join("")}</div>${filtered.length > shown.length ? `<div class="ref-more"><button type="button" class="btn btn-sm" id="ref-show-all">Show all ${filtered.length} matching entries</button></div>` : ""}`;
	}
	const filtered = filterWebEntries(data, refUi.cat, refUi.q);
	if (!filtered.length) return "<div class=\"ref-empty\">No matching references for the current filter.</div>";
	const showLimit = refUi.expanded || refUi.q.trim() ? filtered.length : 12;
	const shown = filtered.slice(0, showLimit);
	return `<div class="ref-grid">${shown.map((item) => renderWebItemHtml(item, titleNum)).join("")}</div>${filtered.length > shown.length ? `<div class="ref-more"><button type="button" class="btn btn-sm" id="ref-show-all">Show all ${filtered.length} matching entries</button></div>` : ""}`;
}
function updateRefHubDom(data, titleNum) {
	const hubEl = document.getElementById("ts-almanac");
	const catsEl = document.getElementById("ref-cats-slot");
	const listEl = document.getElementById("ref-list-slot");
	const countEl = document.getElementById("ref-total-count");
	if (!hubEl || !catsEl || !listEl) return;
	const webTotal = data.host_total ?? data.total ?? 0;
	const ibrTotal = data.ibr_total ?? (data.ibr_standards || []).length;
	const catCounts = data.host_category_counts || data.category_counts || {};
	const legacyCount = (data.hosts || data.items || []).filter((it) => it.legacy).length;
	if (!webTotal && !ibrTotal) {
		const count = Number(state.metaInfo.section_count || 0);
		hubEl.innerHTML = `
      <div class="ts-colophon">
        Edition Colophon · Title ${titleNum}${count ? ` · ${fmt(count)} sections` : ""} · No external web portals or incorporated consensus standards cited.
      </div>`;
		return;
	}
	if (countEl) {
		const parts = [];
		if (webTotal) parts.push(plural(webTotal, data.host_total ? "host" : "resource"));
		if (ibrTotal) parts.push(plural(ibrTotal, "IBR standard"));
		countEl.textContent = parts.join(" · ");
	}
	if (refUi.cat === "ibr" && !ibrTotal) refUi.cat = "all";
	if (refUi.cat === "legacy" && !legacyCount) refUi.cat = "all";
	catsEl.innerHTML = REF_CATS.map(([k, label]) => {
		const n = k === "all" ? webTotal : k === "ibr" ? ibrTotal : k === "legacy" ? legacyCount : catCounts[k] || 0;
		if (k !== "all" && !n) return "";
		return `<button type="button" class="sf-pill${refUi.cat === k ? " is-active" : ""}" data-ref-cat="${k}" aria-pressed="${refUi.cat === k}">${escapeHtml(label)} <span class="sf-pill-count">${n}</span></button>`;
	}).join("");
	listEl.innerHTML = renderRefListHtml(data, titleNum);
}
// src/views/core.ts
var titleNewsCache = /* @__PURE__ */ new Map();
function countLeafSections(node) {
	if (!node) return 0;
	if (node.t === "section" || node.t === "appendix") return node.r ? 0 : 1;
	let total = 0;
	for (const ch of node.c || []) total += countLeafSections(ch);
	return total;
}
function findChapterLabel(partNode) {
	let k = treeIdx.parts.get(String(partNode.id || ""));
	while (k !== void 0 && k !== null && k >= 0) {
		const n = treeIdx.nodes[k];
		if (n && (n.t === "chapter" || n.t === "subtitle")) {
			const meta = agencyMeta(n);
			if (meta) return meta.code;
			return cleanInlineLabel(n.l || n.d || "");
		}
		k = treeIdx.parent[k];
	}
	return `Title ${state.currentTitle}`;
}
function firstLeafSection(node) {
	if (!node) return null;
	if ((node.t === "section" || node.t === "appendix") && !node.r) return node;
	for (const ch of node.c || []) {
		const hit = firstLeafSection(ch);
		if (hit) return hit;
	}
	return null;
}
function listSubparts(partNode) {
	return (partNode?.c || []).filter((ch) => (ch.t === "subpart" || ch.t === "subject_group") && !ch.r && countLeafSections(ch) > 0);
}
function listDirectLeaves(partNode) {
	const out = [];
	const walk = (n) => {
		if (!n) return;
		if ((n.t === "section" || n.t === "appendix") && !n.r) {
			out.push(n);
			return;
		}
		for (const ch of n.c || []) {
			walk(ch);
			if (out.length >= 6) return;
		}
	};
	walk(partNode);
	return out;
}
function describePartNode(partNode, secCount) {
	if (!partNode) return secCount ? `${plural(secCount, "section")} in this part` : "";
	const cleanPhrase = (s) => cleanInlineLabel(s).replace(/\.+$/, "");
	const subparts = listSubparts(partNode);
	if (subparts.length) {
		const names = subparts.slice(0, 3).map((s) => cleanPhrase(s.d || s.l || "")).filter(Boolean);
		if (names.length) {
			const rest = subparts.length - names.length;
			const tail = rest > 0 ? `, and ${plural(rest, "more subpart")}` : "";
			return `Covers ${names.join(", ")}${tail}.`;
		}
	}
	const leaves = listDirectLeaves(partNode);
	if (leaves.length) {
		const names = leaves.slice(0, 3).map((s) => cleanPhrase(s.d || s.l || "")).filter(Boolean);
		if (names.length) return `Includes ${names.join("; ")}.`;
	}
	return `${plural(secCount, "section")} in this part.`;
}
function buildDynamicCard(partNode, kickerOverride = "") {
	const secCount = countLeafSections(partNode);
	const titleText = cleanInlineLabel(partNode.d || "");
	const idStr = String(partNode.id || "");
	return {
		part: idStr,
		kicker: kickerOverride || findChapterLabel(partNode),
		title: `Part ${idStr}${titleText ? " — " + titleText : ""}`,
		desc: describePartNode(partNode, secCount),
		secCount
	};
}
function collectDynamicCards(limit = 6) {
	if (!treeIdx.partList || !treeIdx.partList.length) return [];
	const scored = [];
	for (const k of treeIdx.partList) {
		const p = treeIdx.nodes[k];
		if (!p || p.r) continue;
		if (!countLeafSections(p)) continue;
		scored.push(buildDynamicCard(p));
	}
	if (!scored.length) return [];
	const bySize = [...scored].sort((a, b) => b.secCount - a.secCount);
	const lead = bySize[0];
	const topIds = new Set(bySize.slice(0, limit).map((c) => c.part));
	return [lead, ...scored.filter((c) => topIds.has(c.part) && c.part !== lead.part)].slice(0, limit);
}
function collectAgencyParts(agencyNode) {
	const out = [];
	const walk = (n) => {
		if (!n || n.r) return;
		if (n.t === "part") {
			out.push(n);
			return;
		}
		for (const ch of n.c || []) walk(ch);
	};
	walk(agencyNode);
	return out;
}
function agencyBeatsList() {
	return (treeIdx.agencyList || []).map((k) => ({
		k,
		node: treeIdx.nodes[k],
		key: agencyKeyForNode(treeIdx.nodes[k]),
		info: agencyInfo(treeIdx.nodes[k])
	})).filter((x) => x.node && (x.node.n || 0) > 0);
}
function cardsForBeat(titleNum, beat) {
	if (beat && beat !== "front") {
		const k = treeIdx.agencies.get(beat);
		const agNode = k != null ? treeIdx.nodes[k] : null;
		if (agNode) {
			const info = agencyInfo(agNode);
			const curatedByPart = new Map(((HOME_CONTENT[titleNum] || { cards: [] }).cards || []).map((c) => [c.part, c]));
			return collectAgencyParts(agNode).map((p) => ({
				node: p,
				secCount: countLeafSections(p)
			})).filter((x) => x.secCount > 0).sort((a, b) => b.secCount - a.secCount).slice(0, 7).map(({ node }) => {
				const curated = curatedByPart.get(String(node.id || ""));
				return curated ? {
					...curated,
					secCount: countLeafSections(node)
				} : buildDynamicCard(node, info.code);
			});
		}
	}
	const curated = HOME_CONTENT[titleNum];
	if (curated && curated.cards) {
		if (treeIdx.parts && treeIdx.parts.size > 0) {
			const present = curated.cards.filter((c) => treeIdx.parts.has(c.part));
			if (present.length >= 2) return present;
		} else return curated.cards;
	}
	return collectDynamicCards(6);
}
function leadInsideLinksHtml(titleNum, partId, partNode) {
	if (!partNode) return "";
	const subparts = listSubparts(partNode);
	const items = [];
	if (subparts.length) for (const sp of subparts.slice(0, 4)) {
		const target = firstLeafSection(sp);
		if (!target) continue;
		const spLabel = cleanInlineLabel(sp.l || `Subpart ${sp.id}`);
		const spName = cleanInlineLabel(sp.d || "");
		items.push({
			href: titleHref(titleNum, `section/${encodeURIComponent(String(target.id || ""))}`),
			code: spLabel,
			text: spName && spName !== spLabel ? spName : cleanInlineLabel(target.d || target.l || "")
		});
	}
	else for (const sec of listDirectLeaves(partNode).slice(0, 4)) items.push({
		href: titleHref(titleNum, `section/${encodeURIComponent(String(sec.id || ""))}`),
		code: cleanInlineLabel(sec.l || `§ ${sec.id}`),
		text: cleanInlineLabel(sec.d || "")
	});
	if (!items.length) return "";
	return `
    <div class="ts-lead-inside">
      <div class="ts-inside-label">Inside Part ${escapeHtml(partId)}</div>
      <div class="ts-inside-grid">
        ${items.map((it) => `
          <a class="ts-inside-item" href="${it.href}">
            <span class="ts-inside-code">${escapeHtml(it.code)}</span>
            ${it.text ? `<span class="ts-inside-text">${escapeHtml(it.text)}</span>` : ""}
          </a>`).join("")}
      </div>
    </div>`;
}
function mainBroadsheetHtml(titleNum, beat) {
	const cards = cardsForBeat(titleNum, beat);
	const beatKey = beat !== "front" ? treeIdx.agencies.get(beat) : void 0;
	const beatInfo = beatKey !== void 0 ? agencyInfo(treeIdx.nodes[beatKey]) : null;
	const beatK = beatKey ?? null;
	const flagHtml = beatInfo ? `
      <div class="ts-sec-flag">
        <span class="ts-flag-label">${escapeHtml(beatInfo.code)} Beat${beatInfo.name ? ` · ${escapeHtml(beatInfo.name)}` : ""}</span>
        <span class="ts-flag-acts">
          <button type="button" class="hm-inline-link" data-ts-open-agency="${beatK}">Open in Contents ${icon("chevronRight")}</button>
          <button type="button" class="hm-inline-link" data-ts-beat="front">All beats</button>
        </span>
      </div>` : `
      <div class="ts-sec-flag">
        <span class="ts-flag-label">The Lead Beat</span>
        <span class="ts-flag-meta">${cards.length ? plural(cards.length, "key part") : "Title overview"}</span>
      </div>`;
	if (!cards.length) return `
      <div class="ts-main-col">
        ${flagHtml}
        <div class="ts-lead"><p class="ts-lead-dek">Open the Contents drawer to browse sections in Title ${titleNum}.</p></div>
      </div>`;
	const lead = cards[0];
	const leadNode = state.treeData ? findPartInTree(state.treeData, lead.part) : null;
	const leadSecCount = leadNode ? countLeafSections(leadNode) : lead.secCount || 0;
	const subCount = leadNode ? listSubparts(leadNode).length : 0;
	const leadHref = titleHref(titleNum, `part/${encodeURIComponent(lead.part)}`);
	const leadFullHref = titleHref(titleNum, `part/${encodeURIComponent(lead.part)}/full`);
	const briefs = cards.slice(1);
	const briefsHtml = briefs.length ? `
    <div class="ts-briefs">
      ${briefs.map((c) => {
		const pNode = state.treeData ? findPartInTree(state.treeData, c.part) : null;
		const cCount = pNode ? countLeafSections(pNode) : c.secCount || 0;
		const cSubs = pNode ? listSubparts(pNode).length : 0;
		const pHref = titleHref(titleNum, `part/${encodeURIComponent(c.part)}`);
		return `
          <article class="ts-brief">
            <div class="ts-brief-top">
              <span class="ts-brief-kicker">${escapeHtml(c.kicker)} · Part ${escapeHtml(c.part)}</span>
              ${cCount ? `<span class="ts-brief-count">${fmt(cCount)} §</span>` : ""}
            </div>
            <h3 class="ts-brief-title"><a href="${pHref}">${escapeHtml(c.title)}</a></h3>
            <p class="ts-brief-dek">${escapeHtml(c.desc)}</p>
            <div class="ts-brief-foot">
              <span>${cSubs ? plural(cSubs, "subpart") : cCount ? plural(cCount, "section") : "Open part"}</span>
              <span class="ts-brief-go" aria-hidden="true">Read ${icon("chevronRight")}</span>
            </div>
          </article>`;
	}).join("")}
    </div>` : "";
	return `
    <div class="ts-main-col">
      ${flagHtml}
      <article class="ts-lead has-tier-bar" data-ref-tier="cfr">
        <div class="ts-lead-top">
          <span class="ts-lead-kicker"><span class="ref-badge">LEAD BEAT</span> · ${escapeHtml(lead.kicker)} · Part ${escapeHtml(lead.part)}</span>
          ${leadSecCount ? `<span class="ts-lead-stat">${fmt(leadSecCount)} ${leadSecCount === 1 ? "section" : "sections"}${subCount ? ` · ${plural(subCount, "subpart")}` : ""}</span>` : ""}
        </div>
        <h2 class="ts-lead-title"><a href="${leadHref}">${escapeHtml(lead.title)}</a></h2>
        <p class="ts-lead-dek">${escapeHtml(lead.desc)}</p>
        ${leadInsideLinksHtml(titleNum, lead.part, leadNode)}
        <div class="ts-lead-foot">
          <a class="btn btn-sm btn-accent" href="${leadHref}">Open Part ${escapeHtml(lead.part)} ${icon("chevronRight")}</a>
          <a class="hm-inline-link" href="${leadFullHref}">See full part</a>
        </div>
      </article>
      ${briefsHtml}
    </div>`;
}
function titleDeskRailHtml(titleNum) {
	const usage = loadUsage();
	const entries = Object.entries(usage.s || {}).map(([key, e]) => {
		const pipe = key.indexOf("|");
		if (pipe < 0 || !e) return null;
		return {
			title: Number(key.slice(0, pipe)),
			id: key.slice(pipe + 1),
			...e
		};
	}).filter((e) => Boolean(e && e.title === titleNum && e.id)).sort((a, b) => (b.t || 0) - (a.t || 0));
	let resumeHtml;
	if (entries.length) {
		const last = entries[0];
		const href = titleHref(titleNum, "section/" + encodeURIComponent(last.id) + (last.u ? "/" + encodeURIComponent(last.u) : ""));
		const trail = entries.slice(1, 3);
		resumeHtml = `
      <div class="ts-rail-block title-resume">
        <div class="ts-rail-head">
          <span class="hm-kicker">Continue in Title ${titleNum}</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t || 0))}</span>
        </div>
        <a class="ts-resume-link" href="${href}">${escapeHtml(last.l || "§ " + last.id)}${last.h ? " " + escapeHtml(last.h) : ""}</a>
        <div class="ts-resume-meta">
          ${last.p ? `<a href="${titleHref(titleNum, "part/" + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ""}
          ${last.ul ? `<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ""}
        </div>
        <div class="ts-resume-acts">
          <a class="btn btn-sm btn-accent" href="${href}">Resume reading ${icon("chevronRight")}</a>
        </div>
        ${trail.length ? `
          <div class="ts-rail-trail">
            ${trail.map((e) => `
              <a class="hm-trail-row" href="${titleHref(titleNum, "section/" + encodeURIComponent(e.id) + (e.u ? "/" + encodeURIComponent(e.u) : ""))}">
                <span class="hm-row-num">${escapeHtml(String(e.l || e.id).replace(/^§\s*/, ""))}</span>
                <span class="hm-row-text">${escapeHtml(e.h || "")}</span>
                <span class="hm-row-val">${escapeHtml(timeAgo(e.t || 0))}</span>
              </a>`).join("")}
          </div>` : ""}
      </div>`;
	} else {
		const firstPart = cardsForBeat(titleNum, "front")[0]?.part;
		resumeHtml = `
      <div class="ts-rail-block">
        <div class="ts-rail-head"><span class="hm-kicker">At your desk</span></div>
        <p class="ts-rail-empty">No recent reading history in Title ${titleNum} yet.</p>
        ${firstPart ? `<a class="hm-inline-link" href="${titleHref(titleNum, "part/" + encodeURIComponent(firstPart))}">Start at Part ${escapeHtml(firstPart)} ${icon("chevronRight")}</a>` : ""}
      </div>`;
	}
	const matchingProjects = loadProjects().filter((p) => (p.sections || []).some((s) => s.title === titleNum)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, 3);
	const wsHtml = `
    <div class="ts-rail-block">
      <div class="ts-rail-head">
        <span class="hm-kicker">Workspaces in Title ${titleNum}</span>
        <a class="hm-inline-link" href="#/projects">All</a>
      </div>
      ${matchingProjects.length ? `
        <div class="ts-rail-ws-list">
          ${matchingProjects.map((p) => {
		const pins = (p.sections || []).filter((s) => s.title === titleNum).slice(0, 3);
		return `
              <div class="ts-rail-ws">
                <a class="hm-ws-name" href="#/projects/${encodeURIComponent(p.id)}">${projDot(p)}<span>${escapeHtml(p.name)}</span></a>
                <div class="ts-rail-ws-chips">
                  ${pins.map((s) => `<a class="citation-chip" data-ref-tier="cfr" href="${titleHref(titleNum, "section/" + encodeURIComponent(s.id))}">${escapeHtml(s.label || "§ " + s.id)}</a>`).join("")}
                </div>
              </div>`;
	}).join("")}
        </div>` : `<p class="ts-rail-empty">Pin any Title ${titleNum} section with <kbd>⌘D</kbd> to build an audit or compliance workspace.</p>`}
    </div>`;
	const wireSlotHtml = titleNum === 29 ? (() => {
		const cached = titleNewsCache.get(29);
		const fresh = cached && Date.now() - cached.at < 3e5 ? cached.articles : null;
		return `<div class="ts-rail-block" id="ts-wire-slot"${fresh && fresh.length ? "" : " hidden"}>${fresh && fresh.length ? renderTitleWireHtml(fresh) : ""}</div>`;
	})() : "";
	const citedSlotHtml = `
    <div class="ts-rail-block" id="ts-cited-slot">
      <div class="ts-rail-head"><span class="hm-kicker">Most-cited in Title ${titleNum}</span></div>
      ${skeletonHtml("lines")}
    </div>`;
	return `
    <aside class="ts-rail" data-ref-tier="cfr" aria-label="Title desk and regulatory index">
      ${resumeHtml}
      ${wsHtml}
      ${wireSlotHtml}
      ${citedSlotHtml}
    </aside>`;
}
function renderTitleWireHtml(articles) {
	if (!articles || !articles.length) return "";
	return `
    <div class="ts-rail-head">
      <span class="hm-kicker">Federal Register wire</span>
      <a class="hm-inline-link" href="#/news">Newsroom ${icon("chevronRight")}</a>
    </div>
    <ol class="wire-items ts-wire-items">
      ${articles.slice(0, 3).map((a) => {
		const actNr = inspectionActivityNr(a);
		const sec = (a.sections || [])[0];
		const partRef = (a.cfr_parts || [])[0];
		return `
          <li class="wire-entry">
            <a href="${actNr ? `#/news/inspection/${actNr}` : sec ? newsSectionHref(29, sec) : partRef ? newsPartHref(partRef.title, partRef.part) : `#/news?cat=${encodeURIComponent(a.category || "all")}`}">
              <span class="wire-entry-head">
                <span class="wire-entry-title">${escapeHtml(newsKicker(a))}</span>
                <time class="wire-entry-date">${escapeHtml(shortDate(a.published_at))}</time>
              </span>
              <span class="wire-entry-name">${escapeHtml(a.title)}</span>
              ${a.penalty_usd ? `<span class="wire-entry-summary">${escapeHtml(fmtMoney(a.penalty_usd))} penalty</span>` : ""}
            </a>
          </li>`;
	}).join("")}
    </ol>`;
}
function renderMostCitedHtml(data, titleNum) {
	const list = data && data.most_cited || [];
	if (!list.length) return "";
	return `
    <div class="ts-rail-head">
      <span class="hm-kicker">Most-cited in Title ${titleNum}</span>
      <span class="ts-rail-count">${fmt(data.most_cited_total || list.length)} hubs</span>
    </div>
    <ol class="ts-cited-list">
      ${list.slice(0, 5).map((s, idx) => `
        <li>
          <a class="ts-cited-row" href="${titleHref(titleNum, "section/" + encodeURIComponent(s.id))}">
            <span class="ts-cited-rank">${idx + 1}</span>
            <span class="ts-cited-body">
              <span class="ts-cited-num">${escapeHtml(s.label || "§ " + s.id)}</span>
              <span class="ts-cited-name">${escapeHtml(s.title || "")}</span>
            </span>
            <span class="ts-cited-cites">${plural(s.cited_by_count, "cite")}</span>
          </a>
        </li>`).join("")}
    </ol>`;
}
function beatsRibbonHtml() {
	const beats = agencyBeatsList();
	if (beats.length < 2) return "";
	const top = [...beats].sort((a, b) => (b.node.n || 0) - (a.node.n || 0)).slice(0, 6);
	const pill = (key, label) => {
		return `<button type="button" aria-pressed="${refUi.beat === key}" data-ts-beat="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
	};
	return `
    <div class="ts-beats-bar">
      <div class="lib-seg ts-beats" role="group" aria-label="Filter edition by department">
        ${pill("front", "Front Page")}
        ${top.map((b) => pill(b.key, b.info.code)).join("")}
      </div>
      <div class="ts-beats-jumps">
        <button type="button" class="hm-inline-link" data-ts-scroll="ts-depts">${plural(beats.length, "department")}</button>
        <button type="button" class="hm-inline-link" data-ts-scroll="ts-almanac">Almanac</button>
      </div>
    </div>`;
}
function departmentsDirectoryHtml() {
	const beats = agencyBeatsList();
	if (beats.length < 2) return "";
	return `
    <section class="ts-depts" id="ts-depts" aria-label="Departments and agencies">
      <div class="ts-sec-flag">
        <span class="ts-flag-label">Departments &amp; Agencies</span>
        <span class="ts-flag-meta">${plural(beats.length, "chapter")} · Select a beat to focus the front page</span>
      </div>
      <div class="ts-dept-grid">
        ${beats.map((b) => {
		const on = refUi.beat === b.key;
		return `
            <div class="ts-dept-item${on ? " is-active" : ""}">
              <button type="button" class="ts-dept-btn" data-ts-beat="${escapeHtml(b.key)}" aria-pressed="${on}">
                <span class="ts-dept-top">
                  <span class="ts-dept-code">${escapeHtml(b.info.code)}</span>
                  ${b.info.range ? `<span class="ts-dept-range">Parts ${escapeHtml(b.info.range)}</span>` : ""}
                </span>
                <span class="ts-dept-name">${escapeHtml(b.info.name)}</span>
                <span class="ts-dept-meta">${plural(b.node.partCount || 0, "part")} · ${fmt(b.node.n)} sections</span>
              </button>
              <button type="button" class="ts-dept-drawer" data-ts-open-agency="${b.k}" title="Browse ${escapeHtml(b.info.code)} in Contents" aria-label="Browse ${escapeHtml(b.info.code)} in Contents">Contents ${icon("chevronRight")}</button>
            </div>`;
	}).join("")}
      </div>
    </section>`;
}
function authorityStackHtml(titleNum) {
	return `<div class="ts-auth-stack" aria-label="Legal authority hierarchy">
    ${jurisdictionStackForTitle(titleNum).nodes.map((node, idx) => {
		const meta = tierMetaFor(node.tier);
		const inner = `
        <span class="tier-pip" aria-hidden="true"></span>
        <span class="ts-auth-code">${escapeHtml(node.code)}</span>
        <span class="ts-auth-meta">${escapeHtml(node.current ? "Current" : node.meta || meta.short)}</span>`;
		const item = node.external && node.href ? `<a class="ts-auth-node${node.current ? " is-current" : ""}" data-ref-tier="${escapeHtml(node.ref_tier)}" href="${escapeHtml(node.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(node.label)}">${inner}</a>` : node.href ? `<a class="ts-auth-node${node.current ? " is-current" : ""}" data-ref-tier="${escapeHtml(node.ref_tier)}" href="${escapeHtml(node.href)}" title="${escapeHtml(node.label)}">${inner}</a>` : `<span class="ts-auth-node${node.current ? " is-current" : ""}" data-ref-tier="${escapeHtml(node.ref_tier)}" title="${escapeHtml(node.label)}">${inner}</span>`;
		return `${idx > 0 ? "<span class=\"ts-auth-arrow\" aria-hidden=\"true\">›</span>" : ""}${item}`;
	}).join("")}
  </div>`;
}
function renderMastheadStatusHtml(titleNum) {
	const libRow = (state.navLibData && state.navLibData.titles || []).find((x) => x.title === titleNum);
	if (libRow && isStale(libRow)) return statPill("stale", "Update available", { bare: true });
	if (state.metaInfo.partial) return statPill("partial", "Partial install", { bare: true });
	return statPill("synced", "Installed", { bare: true });
}
function hydrateTitleWire(titleNum, seq, signal) {
	if (titleNum !== 29) return;
	const applyWire = (articles) => {
		const slot = document.getElementById("ts-wire-slot");
		if (!slot || seq !== state.routeSeq) return;
		if (!articles || !articles.length) {
			slot.hidden = true;
			return;
		}
		slot.hidden = false;
		slot.innerHTML = renderTitleWireHtml(articles);
	};
	const cached = titleNewsCache.get(29);
	if (cached && Date.now() - cached.at < 3e5) {
		applyWire(cached.articles);
		return;
	}
	fetchNewsPreview(3, { signal }).then((data) => {
		if (!data || seq !== state.routeSeq) return;
		const articles = data.articles || [];
		titleNewsCache.set(29, {
			at: Date.now(),
			articles
		});
		applyWire(articles);
	}).catch(() => {});
}
async function renderHome() {
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	const titleNum = state.currentTitle;
	const seq = state.routeSeq;
	if (refUi.title !== titleNum) {
		refUi.title = titleNum;
		refUi.beat = "front";
		refUi.cat = "all";
		refUi.q = "";
		refUi.expanded = false;
	}
	document.title = `Title ${titleNum} · FRAMEWORK`;
	setViewHead("");
	const snapRow = state.homeSnapshot?.titles?.find((x) => x.title === titleNum);
	const name = state.metaInfo.name || snapRow?.name || "";
	const content = HOME_CONTENT[titleNum];
	const tagline = content?.tagline || snapRow?.summary || `Read, search, and research Title ${titleNum} of the Code of Federal Regulations.`;
	const count = Number(state.metaInfo.section_count || 0);
	const readCount = visitedCountFor(titleNum);
	const folioMeta = joinSep([
		state.metaInfo.edition ? `Edition ${shortDate(state.metaInfo.edition) || state.metaInfo.edition}` : "",
		count ? `${fmt(count)} sections` : "",
		readCount ? `${fmt(readCount)} read` : ""
	]);
	dom.view.innerHTML = `
    <div class="ts-front">
      <header class="home-hero ts-masthead">
        <div class="ts-folio">
          <div class="doc-kicker" data-ref-tier="cfr">
            <span class="ref-badge">FEDERAL CFR</span><span class="sep" aria-hidden="true">·</span><a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><span>${titleNum} CFR${snapRow?.desk ? ` · ${escapeHtml(snapRow.desk)}` : ""}</span>
          </div>
          <div class="ts-folio-right">
            ${folioMeta ? `<span class="ts-folio-meta">${folioMeta}</span>` : ""}
            ${renderMastheadStatusHtml(titleNum)}
          </div>
        </div>
        <div class="ts-title-row">
          <div class="ts-title-copy">
            <h1>Title ${titleNum}${name ? " — " + escapeHtml(name) : ""}</h1>
            <p>${escapeHtml(tagline)}</p>
          </div>
          <div class="home-hero-acts">
            <button type="button" class="btn btn-sm" id="home-open-contents">${icon("book")} Browse contents</button>
            <a class="btn btn-sm" href="#/library/${titleNum}">Manage in Library</a>
          </div>
        </div>
        <div class="ts-double-rule" aria-hidden="true"></div>
        ${authorityStackHtml(titleNum)}
        <div id="ts-beats-slot">${beatsRibbonHtml()}</div>
      </header>

      <div class="ts-broadsheet">
        <div id="ts-main-slot">${mainBroadsheetHtml(titleNum, refUi.beat)}</div>
        ${titleDeskRailHtml(titleNum)}
      </div>

      <div id="ts-depts-slot">${departmentsDirectoryHtml()}</div>

      <section class="ref-hub ts-almanac" id="ts-almanac" aria-label="References and authorities">
        <div class="ts-sec-flag">
          <span class="ts-flag-label">Almanac · References &amp; Authorities</span>
          <span class="ref-total-pill" id="ref-total-count">Indexing…</span>
        </div>
        <p class="ref-hub-sub">Standards organizations, incorporated consensus standards, federal portals, and external authorities cited across Title ${titleNum}.</p>
        <div class="ref-controls">
          <div class="ref-cats" id="ref-cats-slot" role="group" aria-label="Filter by category"></div>
          <input type="search" class="search-filter-input ref-search" id="ref-filter" value="${escapeHtml(refUi.q)}" placeholder="Filter domains, standards, or citing sections…" aria-label="Filter references" autocomplete="off" spellcheck="false">
        </div>
        <div id="ref-list-slot">${skeletonHtml("list", "Indexing references…")}</div>
      </section>
    </div>`;
	enterView();
	const signal = state.routeAbort?.signal;
	hydrateTitleWire(titleNum, seq, signal);
	if (!state.treeData) try {
		await ensureTreeLoaded();
		if (seq !== state.routeSeq) return;
		const beatsSlot = document.getElementById("ts-beats-slot");
		const mainSlot = document.getElementById("ts-main-slot");
		const deptsSlot = document.getElementById("ts-depts-slot");
		if (beatsSlot) beatsSlot.innerHTML = beatsRibbonHtml();
		if (mainSlot) mainSlot.innerHTML = mainBroadsheetHtml(titleNum, refUi.beat);
		if (deptsSlot) deptsSlot.innerHTML = departmentsDirectoryHtml();
	} catch {}
	if (!snapRow) fetchTitlesSnapshot({ signal }).then((snap) => {
		if (!snap || seq !== state.routeSeq) return;
		state.homeSnapshot = snap;
		const row = snap.titles?.find((x) => x.title === titleNum);
		if (!row) return;
		const pEl = dom.view.querySelector(".ts-title-copy > p");
		if (!content && row.summary && pEl) pEl.textContent = row.summary;
		const crumbSpan = dom.view.querySelector(".ts-folio .doc-kicker > span:last-child");
		if (row.desk && crumbSpan) crumbSpan.textContent = `${titleNum} CFR · ${row.desk}`;
	}).catch(() => {});
	let refData = null;
	try {
		refData = await fetchTitleReferences(titleNum, { signal });
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return;
	}
	if (seq !== state.routeSeq) return;
	const citedSlot = document.getElementById("ts-cited-slot");
	if (refData) {
		if (citedSlot) {
			const citedHtml = renderMostCitedHtml(refData, titleNum);
			if (citedHtml) citedSlot.innerHTML = citedHtml;
			else citedSlot.hidden = true;
		}
		updateRefHubDom(refData, titleNum);
	} else {
		if (citedSlot) citedSlot.hidden = true;
		const listEl = document.getElementById("ref-list-slot");
		if (listEl) listEl.innerHTML = "<div class=\"ref-empty\">Couldn’t load references for this title.</div>";
	}
}
onView("input", (e) => {
	const inp = e.target;
	if (!inp || inp.id !== "ref-filter" || !dom.view.querySelector(".ref-hub")) return;
	refUi.q = inp.value;
	refUi.expanded = false;
	const data = state.refsCache.get(state.currentTitle);
	if (data) updateRefHubDom(data, state.currentTitle);
});
onView("click", (e) => {
	if (!dom.view.querySelector(".ts-front")) return;
	const t = e.target;
	if (!t) return;
	if (t.closest("#home-open-contents")) {
		openPanel("reader", { focus: true });
		return;
	}
	const beatEl = t.closest("[data-ts-beat]");
	if (beatEl) {
		refUi.beat = beatEl.dataset.tsBeat || "front";
		const beatsSlot = document.getElementById("ts-beats-slot");
		const mainSlot = document.getElementById("ts-main-slot");
		const deptsSlot = document.getElementById("ts-depts-slot");
		if (beatsSlot) beatsSlot.innerHTML = beatsRibbonHtml();
		if (mainSlot) mainSlot.innerHTML = mainBroadsheetHtml(state.currentTitle, refUi.beat);
		if (deptsSlot) deptsSlot.innerHTML = departmentsDirectoryHtml();
		if (beatEl.closest(".ts-depts") && mainSlot) mainSlot.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
		return;
	}
	const agencyBtn = t.closest("[data-ts-open-agency]");
	if (agencyBtn) {
		const k = Number(agencyBtn.dataset.tsOpenAgency);
		if (!Number.isNaN(k)) showAgencyView(k);
		openPanel("reader", { focus: true });
		return;
	}
	const jumpBtn = t.closest("[data-ts-scroll]");
	if (jumpBtn && jumpBtn.dataset.tsScroll) {
		const target = document.getElementById(jumpBtn.dataset.tsScroll);
		if (target) target.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
		return;
	}
	if (!dom.view.querySelector(".ref-hub")) return;
	const catBtn = t.closest("[data-ref-cat]");
	if (catBtn && catBtn.dataset.refCat) {
		refUi.cat = catBtn.dataset.refCat;
		refUi.expanded = false;
		const data = state.refsCache.get(state.currentTitle);
		if (data) updateRefHubDom(data, state.currentTitle);
		return;
	}
	if (t.closest("#ref-show-all")) {
		refUi.expanded = true;
		const data = state.refsCache.get(state.currentTitle);
		if (data) updateRefHubDom(data, state.currentTitle);
	}
});
// src/panels/library_panel.ts
var navLib = {
	data: null,
	at: 0,
	loading: null
};
async function ensureNavLibrary(force = false) {
	if (!force && navLib.data && Date.now() - navLib.at < 6e4) return navLib.data;
	if (!navLib.loading) navLib.loading = getJSON("/api/library").then((d) => {
		navLib.data = d;
		navLib.at = Date.now();
		state.navLibData = d;
		return d;
	}).finally(() => {
		navLib.loading = null;
	});
	return navLib.loading;
}
function transferHtml() {
	const j = state.jobs.current;
	if (!j && !state.jobs.queued.length) return "<p class=\"dr-note\">Nothing downloading.</p>";
	const m = dockModel(j);
	return (!j ? "" : `<div class="dr-job">
      <div class="dr-job-head"><span class="stat-dot is-busy" aria-hidden="true"></span><span class="dr-job-title">${escapeHtml(j.label)}</span><span class="dr-job-pct" data-f="pct">${m.pct == null ? "" : m.pct + "%"}</span></div>
      <div class="dr-job-phase" data-f="phase">${escapeHtml(j.cancelling ? "Cancelling…" : m.label)}</div>
      ${transferTrackHtml(m.pct, { bindFill: true })}
      <div class="dock-tele"><span data-f="left">${escapeHtml(m.left)}</span><span data-f="right">${escapeHtml(m.right)}</span></div>
      <div class="dr-job-acts"><button type="button" class="lib-act is-danger" data-dock="cancel" data-id="${j.id}"${j.cancelling || j.phase === "Installing" ? " disabled" : ""}>Cancel</button></div>
    </div>`) + state.jobs.queued.map((q) => `<div class="dr-row is-static"><span class="stat-dot is-busy" aria-hidden="true"></span><span class="dr-name">${escapeHtml(q.label)}</span><span class="dr-time">Queued</span></div>`).join("") + (state.jobs.queued.length ? "<button type=\"button\" class=\"dr-link\" data-dock=\"clear\">Clear queue</button>" : "");
}
state.navTransferKey = "";
function updateNavTransfers() {
	updateRailBadge();
	if (navState.panel !== "library" || !drawerShown()) return;
	const box = document.getElementById("dr-transfers");
	if (!box) return;
	const j = state.jobs.current;
	const m = dockModel(j);
	const key = [
		j && j.id,
		j && j.cancelling,
		j && j.phase === "Installing",
		m.pct == null,
		state.jobs.queued.map((q) => q.id).join(".")
	].join("|");
	if (key !== state.navTransferKey) {
		state.navTransferKey = key;
		box.innerHTML = transferHtml();
		const count = document.getElementById("dr-transfers-count");
		const n = (j ? 1 : 0) + state.jobs.queued.length;
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
	state.navTransferKey = "";
	const active = (state.jobs.current ? 1 : 0) + state.jobs.queued.length;
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
        <span class="dr-suite-meta">${joinSep([`${have} of ${st.total} installed`, fmtMB(s.size_mb)])}</span></div>
      ${st.label ? `<button type="button" class="icon-btn drawer-icon" data-act="download-suite" data-suite="${escapeHtml(s.id)}" title="${escapeHtml(st.label)}" aria-label="${escapeHtml(st.label)}: ${escapeHtml(s.name)}">${icon("download")}</button>` : st.busy.length ? "<span class=\"stat-dot is-busy\" title=\"In progress\" aria-hidden=\"true\"></span>" : st.ts.length ? "<span class=\"stat-dot is-synced\" title=\"Installed\" aria-hidden=\"true\"></span>" : "<span class=\"stat-dot is-uninstalled\" title=\"Not installed\" aria-hidden=\"true\"></span>"}
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
registerDrawerPanel("library", renderLibraryPanel);
on("jobs:updated", () => updateNavTransfers());
on("jobs:finished", () => {
	navLib.at = 0;
	if (drawerShown() && navState.panel === "library") ensureNavLibrary(true).then(renderLibraryPanel).catch(() => {});
});
dom.sidebar.addEventListener("click", async (e) => {
	const t = e.target;
	const dockBtn = t?.closest("[data-dock]");
	if (dockBtn) {
		onDockAction(dockBtn);
		return;
	}
	const act = t?.closest("button[data-act]");
	if (act && (act.dataset.act === "download-suite" || act.dataset.act === "update-all")) {
		act.disabled = true;
		try {
			if (act.dataset.act === "download-suite") await queueBatch("/api/library/batch-download", { suite: act.dataset.suite }, "Every title in this suite is installed and current");
			else await queueBatch("/api/library/update-all", null, "Every installed title is already current");
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Download failed", 5e3);
			act.disabled = false;
		}
	}
});
var CONST_START_HREF = "#/constitution/";
var CONST_LIB_HREF = "#/library/constitution";
var constHref = (id) => `#/constitution/${encodeURIComponent(id)}`;
var cache = null;
var TTL_MS = 6e4;
var constCached = () => cache?.data || null;
/** `GET /api/constitution` (status + outline), cached for a minute; `force` refetches. */
async function fetchConstitution({ force = false } = {}) {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const data = await getJSON("/api/constitution");
		cache = {
			at: Date.now(),
			data
		};
		return data;
	} catch {
		return cache?.data || null;
	}
}
var isConstJob = (j) => Boolean(j && (j.title === 2e3 || String(j.kind || "").startsWith("constitution")));
var constJob = () => [state.jobs?.current, ...state.jobs?.queued || []].find(isConstJob) || null;
on("jobs:finished", () => {
	cache = null;
});
// src/views/projects.ts
var armedTimers = /* @__PURE__ */ new WeakMap();
var projectRouteId$1 = () => {
	const m = /\/projects\/([^/?]+)/.exec(state.activeRoute || "");
	return m ? decodeURIComponent(m[1]) : null;
};
var importInput = document.getElementById("projects-import");
importInput.addEventListener("change", async () => {
	const file = importInput.files && importInput.files[0];
	importInput.value = "";
	if (!file) return;
	try {
		const raw = JSON.parse(await file.text());
		const incoming = (Array.isArray(raw) ? raw : raw?.projects || []).filter(validProject);
		if (!incoming.length) throw new Error("No workspaces in that file");
		const list = loadProjects();
		for (const p of incoming) {
			const i = list.findIndex((x) => x.id === p.id);
			if (i < 0) list.push(p);
			else if ((p.updated_at || "") >= (list[i].updated_at || "")) list[i] = p;
		}
		saveProjects(list);
		showToast(`Imported ${plural(incoming.length, "workspace")}`);
	} catch (err) {
		showToast(`Couldn’t import: ${err instanceof Error ? err.message : "Invalid file"}`, 5e3);
	}
});
function startNewWorkspace() {
	const p = createProject("Untitled workspace");
	window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
	requestAnimationFrame(() => setTimeout(() => {
		const n = dom.view.querySelector(".proj-name");
		if (n) {
			n.focus();
			n.select();
		}
	}, 60));
}
function onProjectAction(btn) {
	const act = btn.dataset.projAct;
	if (act === "export") exportProjects(loadProjects());
	else if (act === "import") importInput.click();
	else if (act === "new") startNewWorkspace();
	else if (act === "export-one") {
		const p = loadProjects().find((x) => x.id === btn.dataset.id);
		if (p) exportProjects([p], `${p.name.replace(/[^\w-]+/g, "-").toLowerCase() || "workspace"}.json`);
	} else if (act === "delete" || act === "unpin" || act === "tabgroup-delete") {
		if (!btn.classList.contains("is-armed")) {
			const label = btn.textContent || "Remove";
			btn.classList.add("is-armed");
			btn.textContent = act === "delete" ? "Delete workspace?" : "Remove?";
			announce(act === "delete" ? "Press again to delete workspace" : "Press again to confirm removal");
			const prevT = armedTimers.get(btn);
			if (prevT) clearTimeout(prevT);
			armedTimers.set(btn, setTimeout(() => {
				btn.classList.remove("is-armed");
				btn.textContent = label;
			}, 4e3));
			return;
		}
		if (act === "delete") {
			const list = loadProjects().filter((x) => x.id !== btn.dataset.id);
			window.location.hash = "#/projects";
			saveProjects(list);
			showToast("Workspace deleted");
		} else if (act === "unpin") {
			const [title, ...rest] = (btn.dataset.sec || "").split("|");
			updateProject(projectRouteId$1(), (p) => {
				p.sections = p.sections.filter((s) => !(s.title === Number(title) && s.id === rest.join("|")));
			});
		} else if (act === "tabgroup-delete") {
			const gid = btn.dataset.groupId;
			updateProject(projectRouteId$1(), (p) => {
				p.tab_groups = (p.tab_groups || []).filter((g) => g.id !== gid);
			});
		}
	} else if (act === "tabgroup-restore") {
		const grp = loadProjects().find((x) => x.id === projectRouteId$1())?.tab_groups?.find((g) => g.id === btn.dataset.groupId);
		if (grp) restoreTabGroup(grp);
	} else if (act === "tabgroup-save-active") {
		if (!state.mainTabs.length && !state.splitTabs.length) {
			showToast("No open reader tabs to save");
			return;
		}
		addTabGroupToWorkspace(projectRouteId$1(), buildTabGroupSnapshot());
	} else if (act === "task-cycle") {
		const taskId = btn.dataset.taskId;
		const order = [
			"open",
			"in_progress",
			"done"
		];
		updateProject(projectRouteId$1(), (p) => {
			const item = (p.projects || []).find((x) => x.id === taskId);
			if (item) item.status = order[(order.indexOf(item.status) + 1) % order.length];
		});
	} else if (act === "task-remove") {
		const taskId = btn.dataset.taskId;
		updateProject(projectRouteId$1(), (p) => {
			p.projects = (p.projects || []).filter((x) => x.id !== taskId);
		});
	} else if (act === "task-add") {
		const inp = btn.closest(".proj-detail")?.querySelector("#proj-task-input");
		const title = inp?.value.trim() || "";
		if (!title) {
			inp?.focus();
			return;
		}
		updateProject(projectRouteId$1(), (p) => {
			if (!Array.isArray(p.projects)) p.projects = [];
			p.projects.unshift({
				id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
				title,
				status: "open",
				created_at: nowIso()
			});
		});
		showToast("Action project added");
	}
}
dom.sidebar.addEventListener("click", (e) => {
	const b = e.target?.closest("[data-proj-act]");
	if (b) onProjectAction(b);
});
onView("click", (e) => {
	const b = e.target?.closest("[data-proj-act]");
	if (b && dom.view.querySelector(".proj-page, .hm")) onProjectAction(b);
});
var TASK_STATUS_LABEL = {
	open: "Open",
	in_progress: "In Progress",
	done: "Done"
};
function renderWorkspaceTasksHtml(p) {
	const tasks = p.projects || [];
	const rows = tasks.map((t) => `
    <div class="proj-task-row is-${escapeHtml(t.status || "open")}">
      <button type="button" class="proj-task-status" data-proj-act="task-cycle" data-task-id="${escapeHtml(t.id)}" title="Click to advance status">${escapeHtml(TASK_STATUS_LABEL[t.status] || "Open")}</button>
      <span class="proj-task-title">${escapeHtml(t.title)}</span>
      <button type="button" class="icon-btn proj-task-del" data-proj-act="task-remove" data-task-id="${escapeHtml(t.id)}" aria-label="Remove action project">${icon("close")}</button>
    </div>
  `).join("");
	return `
    <div class="lib-desk proj-actions-sec">
      <header class="lib-desk-header"><h2 class="lib-desk-name">Action projects</h2><span class="lib-desk-count">${plural(tasks.length, "project")}</span></header>
      <div class="proj-task-add">
        <input type="text" class="ui-input proj-task-input" id="proj-task-input" placeholder="Add an action project (e.g. Audit GHS SDS binder for Line 4)…" aria-label="New action project title" autocomplete="off">
        <button type="button" class="btn btn-sm btn-accent" data-proj-act="task-add">${icon("plus")} Add project</button>
      </div>
      ${rows ? `<div class="proj-task-list">${rows}</div>` : "<p class=\"proj-task-empty\">Action projects turn the legal authorities pinned below into checklists and deliverables.</p>"}
    </div>`;
}
function renderWorkspaceTabGroupsHtml(p) {
	const groups = p.tab_groups || [];
	const activeCount = state.mainTabs.length + state.splitTabs.length;
	const rows = groups.map((g) => {
		const mainPills = (g.mainTabs || []).map((t) => `<span class="proj-tabgroup-pill" data-ref-tier="${t.tier || "cfr"}"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(formatTabLabel(t))}</span>`).join("");
		const splitPills = (g.splitTabs || []).map((s) => `<span class="proj-tabgroup-pill is-split" data-ref-tier="${s.title !== g.mainTabs?.[0]?.title ? "cross" : "cfr"}"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(s.label || formatTabLabel(s))}</span>`).join("");
		const total = (g.mainTabs?.length || 0) + (g.splitTabs?.length || 0);
		return `
      <article class="proj-tabgroup has-tier-bar" data-ref-tier="cfr">
        <div class="proj-tabgroup-head">
          <div class="proj-tabgroup-meta">
            <h3 class="proj-tabgroup-name">${escapeHtml(g.name)}</h3>
            <span class="proj-tabgroup-time">${plural(total, "tab")}${SEP}Saved ${escapeHtml(timeAgo(Date.parse(g.saved_at) || Date.now()))}</span>
          </div>
          <div class="proj-tabgroup-acts">
            <button type="button" class="btn btn-sm btn-accent" data-proj-act="tabgroup-restore" data-group-id="${escapeHtml(g.id)}">Open tabs</button>
            <button type="button" class="lib-act is-danger" data-proj-act="tabgroup-delete" data-group-id="${escapeHtml(g.id)}">Remove</button>
          </div>
        </div>
        ${mainPills ? `<div class="proj-tabgroup-row"><span class="proj-tabgroup-lane">Main</span><div class="proj-tabgroup-pills">${mainPills}</div></div>` : ""}
        ${splitPills ? `<div class="proj-tabgroup-row"><span class="proj-tabgroup-lane">Side-by-side</span><div class="proj-tabgroup-pills">${splitPills}</div></div>` : ""}
      </article>`;
	}).join("");
	return `
    <div class="lib-desk proj-tabgroups-sec">
      <header class="lib-desk-header">
        <h2 class="lib-desk-name">Saved tab groups</h2>
        <span class="lib-desk-count">${plural(groups.length, "group")}</span>
        ${activeCount > 0 ? `<button type="button" class="btn btn-sm" data-proj-act="tabgroup-save-active">${icon("plus")} Save active (${activeCount})</button>` : ""}
      </header>
      ${rows ? `<div class="proj-tabgroup-list">${rows}</div>` : "<p class=\"proj-task-empty\">Open multiple sections in reader tabs or side-by-side panes, then click <strong>Save group</strong> to snapshot your research path here.</p>"}
    </div>`;
}
function titlesOf(p) {
	const ts = [...new Set(p.sections.filter((s) => s.tier !== CONST_TIER).map((s) => s.title))].sort((a, b) => a - b);
	const titles = ts.length ? `${ts.length === 1 ? "Title" : "Titles"} ${ts.join(", ")}` : "";
	return p.sections.some((s) => s.tier === "federal-constitution") ? [titles, "Constitution"].filter(Boolean).join(", ") : titles;
}
function renderProjects(id) {
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	const list = loadProjects();
	const sections = list.reduce((a, p) => a + p.sections.length, 0);
	const fresh = !dom.view.querySelector(`.proj-page[data-id="${id || ""}"]`);
	if (!id) {
		document.title = "Workspaces · FRAMEWORK";
		const cards = list.map((p) => {
			const topTier = refTierForCorpus(p.sections[0]?.tier || "federal-reg");
			const taskCount = (p.projects || []).length;
			const grpCount = (p.tab_groups || []).length;
			return `<article class="lib-story proj-card has-tier-bar" data-ref-tier="${topTier}">
        <div class="story-top"><span class="story-kicker">${projDot(p)}Workspace${SEP}Updated ${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</span></div>
        <h3 class="story-name"><a href="#/projects/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a></h3>
        ${p.description ? `<p class="story-dek">${escapeHtml(p.description)}</p>` : ""}
        ${p.tags && p.tags.length ? `<div class="proj-tags">${p.tags.map((t) => `<span class="proj-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        <div class="story-foot"><span class="story-date">${joinSep([
				plural(p.sections.length, "section"),
				taskCount ? plural(taskCount, "project") : "",
				grpCount ? plural(grpCount, "tab group") : "",
				escapeHtml(titlesOf(p))
			])}</span></div>
      </article>`;
		}).join("");
		const mod = isMac ? "⌘" : "Ctrl ";
		dom.view.innerHTML = `<div class="lib lib-front proj-page" data-id="">
      <div class="doc-kicker"><a href="#/">Home</a></div>
      <div class="lib-head">
        <div class="lib-head-text"><h1 class="doc-title">Workspaces</h1>
          <p class="lib-sub">${joinSep([
			"Subject-based workspaces of pinned sections and projects",
			plural(list.length, "workspace"),
			plural(sections, "section")
		])}</p></div>
        <button type="button" class="btn" data-proj-act="new">${icon("plus")} New workspace</button>
      </div>
      ${list.length ? `<div class="lib-desk"><header class="lib-desk-header"><h2 class="lib-desk-name">All workspaces</h2><span class="lib-desk-count">${plural(list.length, "workspace")}</span></header>
        <div class="lib-stories">${cards}</div></div>` : `<div class="proj-empty"><div class="dr-empty-title">Start a workspace</div>
            <p>Collect the sections a compliance program, audit, or permit review turns on, with a note on each. Open any section and press <strong>Pin</strong> or <kbd>${mod}D</kbd>, or start an empty workspace here.</p>
            <span class="proj-empty-acts"><button type="button" class="btn btn-accent" data-proj-act="new">${icon("plus")} New workspace</button><button type="button" class="btn" data-proj-act="import">Import file</button></span></div>`}
    </div>`;
		if (fresh) enterView();
		return;
	}
	const p = list.find((x) => x.id === id);
	if (!p) {
		document.title = "Workspaces · FRAMEWORK";
		dom.view.innerHTML = emptyStateHtml({
			title: "No such workspace",
			body: "It may have been deleted, or it lives in another browser.",
			actionsHtml: "<a class=\"btn\" href=\"#/projects\">All workspaces</a>",
			cls: "proj-page"
		});
		return;
	}
	document.title = `${p.name} · Workspaces · FRAMEWORK`;
	const installed = new Set(state.installedTitles.map((t) => t.title));
	const installedUsc = new Set((state.installedUscTitles || []).map((t) => t.title));
	const constInstalled = constCached()?.installed !== false;
	const groupedHtml = TIER_ORDER.map((tier) => {
		const tierSecs = p.sections.filter((s) => (s.tier || "federal-reg") === tier);
		if (!tierSecs.length) return "";
		const tMeta = TIER_META[tier] || TIER_META["federal-reg"];
		const rTier = tMeta.refTier;
		const rows = tierSecs.map((s) => {
			const isUsc = s.tier === USC_TIER;
			const isConst = s.tier === CONST_TIER;
			const href = isConst ? constHref(s.id) : isUsc ? `#/usc/${s.title}/section/${encodeURIComponent(s.id)}` : `#/title/${s.title}/section/${encodeURIComponent(s.id)}`;
			const have = isConst ? constInstalled : isUsc ? installedUsc.has(s.title) : installed.has(s.title);
			const libHref = isConst ? CONST_LIB_HREF : isUsc ? `#/library/usc/${s.title}` : `#/library/${s.title}`;
			const where = isConst ? "U.S. Constitution" : `Title ${s.title}`;
			return `<article class="proj-item has-tier-bar" data-ref-tier="${rTier}">
        <div class="story-top"><span class="story-kicker"><span class="ref-badge">${escapeHtml(tMeta.tag)}</span>${SEP}${where}${s.part ? `${SEP}Part ${escapeHtml(s.part)}` : ""}</span>
          <span class="proj-item-date">Pinned ${escapeHtml(shortDate((s.pinned_at || "").slice(0, 10)))}</span></div>
        <h3 class="story-name">${have ? `<a href="${href}">${escapeHtml(s.label || "§ " + s.id)} ${escapeHtml(s.heading || "")}</a>` : `${escapeHtml(s.label || "§ " + s.id)} ${escapeHtml(s.heading || "")}`}</h3>
        ${have ? "" : `<p class="proj-missing">${isConst ? "The Constitution" : isUsc ? uscCite(s.title) : `Title ${s.title}`} isn’t installed. <a href="${libHref}">Download it</a> to read this section.</p>`}
        <textarea class="proj-note" rows="1" data-sec="${escapeHtml(secKey(s.title, s.id))}" placeholder="Add a note…" aria-label="Note on ${escapeHtml(s.label || s.id)}">${escapeHtml(s.note || "")}</textarea>
        <div class="proj-item-acts"><button type="button" class="lib-act is-danger" data-proj-act="unpin" data-sec="${escapeHtml(secKey(s.title, s.id))}">Remove</button></div>
      </article>`;
		}).join("");
		return `<div class="proj-tier-group" data-ref-tier="${rTier}">
      <div class="proj-tier-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(tMeta.label)}</span><span class="proj-tier-count">${tierSecs.length}</span></div>
      ${rows}
    </div>`;
	}).join("");
	const mod = isMac ? "⌘" : "Ctrl ";
	dom.view.innerHTML = `<div class="lib proj-page proj-detail" data-id="${escapeHtml(p.id)}">
    <div class="doc-kicker"><a href="#/projects">Workspaces</a></div>
    <div class="proj-head">
      <span class="proj-icon" style="--hue: var(${projectHue(p)})" aria-hidden="true">${icon("folder")}</span>
      <input class="proj-name" value="${escapeHtml(p.name)}" maxlength="80" aria-label="Workspace name" spellcheck="false">
      <span class="proj-head-acts">
        <button type="button" class="btn btn-sm" data-proj-act="export-one" data-id="${escapeHtml(p.id)}">Export</button>
        <button type="button" class="btn btn-sm is-danger" data-proj-act="delete" data-id="${escapeHtml(p.id)}">Delete</button>
      </span>
    </div>
    <textarea class="proj-desc" rows="1" placeholder="Add a description…" aria-label="Description">${escapeHtml(p.description || "")}</textarea>
    <dl class="proj-props">
      <div><dt>Tags</dt><dd><input class="proj-tags-input" value="${escapeHtml((p.tags || []).join(", "))}" placeholder="Add tags, separated by commas" aria-label="Tags"></dd></div>
      <div><dt>Sections</dt><dd>${joinSep([plural(p.sections.length, "section"), escapeHtml(titlesOf(p))]) || "0 sections"}</dd></div>
      <div><dt>Created</dt><dd>${escapeHtml(fmtDate((p.created_at || "").slice(0, 10)))}</dd></div>
      <div><dt>Updated</dt><dd data-f="updated">${escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))}</dd></div>
    </dl>
    ${renderWorkspaceTasksHtml(p)}
    ${renderWorkspaceTabGroupsHtml(p)}
    <div class="lib-desk">
      <header class="lib-desk-header"><h2 class="lib-desk-name">Pinned sections</h2><span class="lib-desk-count">${plural(p.sections.length, "section")}</span></header>
      ${groupedHtml || `<div class="proj-empty is-inline"><p>Nothing pinned yet. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd> to add it here.</p></div>`}
    </div>
  </div>`;
	for (const t of dom.view.querySelectorAll(".proj-desc, .proj-note")) autosize(t);
	if (fresh) enterView();
}
function autosize(t) {
	t.style.height = "auto";
	t.style.height = `${t.scrollHeight}px`;
}
state.projEditT = null;
onView("input", (e) => {
	const page = e.target?.closest(".proj-detail");
	if (!page) return;
	const id = page.dataset.id;
	const t = e.target;
	if (t.matches("textarea")) autosize(t);
	if (state.projEditT) clearTimeout(state.projEditT);
	state.projEditT = setTimeout(() => {
		updateProject(id, (p) => {
			if (t.matches(".proj-name")) p.name = t.value.trim() || "Untitled workspace";
			else if (t.matches(".proj-desc")) p.description = t.value;
			else if (t.matches(".proj-tags-input")) p.tags = t.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
			else if (t.matches(".proj-note")) {
				const s = p.sections.find((x) => secKey(x.title, x.id) === t.dataset.sec);
				if (s) s.note = t.value;
			}
		}, { quiet: true });
		const upd = page.querySelector("[data-f=\"updated\"]");
		if (upd) upd.textContent = "just now";
		if (t.matches(".proj-name")) document.title = `${t.value.trim() || "Untitled workspace"} · Workspaces · FRAMEWORK`;
	}, 300);
});
onView("keydown", (e) => {
	const ke = e;
	const target = ke.target;
	if (ke.key === "Enter" && target?.id === "proj-task-input") {
		ke.preventDefault();
		const btn = target.closest(".proj-task-add")?.querySelector("[data-proj-act=\"task-add\"]");
		if (btn) onProjectAction(btn);
		return;
	}
	if (ke.key === "Enter" && target?.matches(".proj-name, .proj-tags-input")) {
		ke.preventDefault();
		target.blur();
	}
});
on("projects:changed", ({ quiet }) => {
	if (!quiet && routeTarget() === "projects") renderProjects(projectRouteId$1());
});
// src/views/library_constitution.ts
var SOURCE_LINE = "GovInfo · House Rules and Manual (official GPO XML)";
function constEdition(c) {
	const cong = c?.meta?.congress;
	return cong ? `House Manual, ${ordinal$1(Number(cong))} Congress` : "";
}
function ordinal$1(n) {
	const s = [
		"th",
		"st",
		"nd",
		"rd"
	];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function constStatusPill(c) {
	const j = constJob();
	if (j) return statPill("busy", j.state === "running" ? j.phase || "Working…" : "Queued");
	return c?.installed ? statPill("synced", "Installed") : statPill("uninstalled", "Not installed");
}
/** The switchboard tab's count and sub line. */
function constTabCounts(c) {
	if (!c?.installed) return {
		countLabel: "Not installed",
		sub: "Articles, amendments and annotations"
	};
	return {
		countLabel: `${new Set(c.outline.filter((u) => u.amendment).map((u) => u.amendment)).size} amendments`,
		sub: constEdition(c) || "Installed"
	};
}
function rowHtml$1(u) {
	const name = constUnitName(u);
	const status = u.note_count ? `${u.note_count} ${u.note_count === 1 ? "annotation" : "annotations"}` : "";
	const hay = `${u.label} ${name} ${u.amendment ? `amendment ${u.amendment} ${toRoman(u.amendment)}` : ""} ${u.article ? `article ${u.article}` : ""}`;
	return `<a class="lib-row" href="${constHref(u.id)}" data-hay="${escapeHtml(hay.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(u.label)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${escapeHtml(status)}</span>
    </a>`;
}
function constContentsHtml(c) {
	const g = constGroups(c.outline);
	const parts = [];
	if (g.preamble) parts.push(`<div class="lib-label">Preamble</div>${g.preamble.units.map(rowHtml$1).join("")}`);
	for (const a of g.articles) parts.push(`<div class="lib-label">${escapeHtml(`${a.label} · ${a.name}`)}</div>${a.units.map(rowHtml$1).join("")}`);
	if (g.amendments.length) parts.push(`<div class="lib-label">Amendments</div>${g.amendments.flatMap((a) => a.units).map(rowHtml$1).join("")}`);
	return parts.join("");
}
/** What the Constitution holds, shown before it is installed (names only, no download needed). */
function previewHtml() {
	return `<div class="const-preview" aria-label="What the Constitution contains">
      <section><h3 class="const-pv-head">The seven articles</h3><ul class="const-pv-list">${[
		1,
		2,
		3,
		4,
		5,
		6,
		7
	].map((n) => `<li><span class="const-pv-num">Article ${toRoman(n)}</span><span class="const-pv-name">${escapeHtml(articleName(n))}</span></li>`).join("")}</ul></section>
      <section><h3 class="const-pv-head">The 27 amendments</h3><ul class="const-pv-list is-cols">${Array.from({ length: 27 }, (_, i) => i + 1).map((n) => `<li><span class="const-pv-num">${toRoman(n)}</span><span class="const-pv-name">${escapeHtml(amendmentName(n))}</span></li>`).join("")}</ul></section>
    </div>`;
}
function constTabHtml(c, filter) {
	const job = constJob();
	if (!c) return `<div class="empty-state"><h2>The Constitution’s status didn’t load</h2><p>Reload the page to try again.</p></div>`;
	const kicker = `<span class="ref-badge" data-ref-tier="const">CONST. · THE SUPREME LAW</span><span>${escapeHtml(SOURCE_LINE)}</span>`;
	if (!c.installed) return `
      ${tabLeadHtml({
		refTier: "const",
		kickerHtml: kicker,
		title: "The Constitution of the United States",
		subHtml: "The full text of the Preamble, the seven articles and all 27 amendments, with the House Parliamentarian’s annotations kept apart from the text. It is a small download (well under 1 MB) and needs no key.",
		actionsHtml: job ? constStatusPill(c) : `<button type="button" class="btn btn-accent" data-act="const-download">${icon("download")} Download the Constitution</button>`
	})}
      ${previewHtml()}`;
	const g = constGroups(c.outline);
	const latest = Math.max(0, ...c.outline.map((u) => u.amendment || 0));
	const sections = c.outline.filter((u) => u.kind === "section" || u.kind === "article").length;
	const built = c.meta.built_at ? shortDate(c.meta.built_at.slice(0, 10)) : "";
	const checked = c.meta.checked_at ? shortDate(c.meta.checked_at.slice(0, 10)) : "";
	const bytes = Number(c.meta.xml_bytes || 0);
	const actions = job ? constStatusPill(c) : `<a class="btn btn-accent" href="${CONST_START_HREF}">${icon("book")} Open in reader</a><button type="button" class="btn" data-act="const-update">${icon("refresh")} Check for a new edition</button><button type="button" class="btn" data-act="const-remove">Remove</button>`;
	return `
    ${tabLeadHtml({
		refTier: "const",
		kickerHtml: kicker,
		title: "The Constitution of the United States",
		subHtml: escapeHtml([
			constEdition(c) || "Installed",
			built ? `installed ${built}` : "",
			checked ? `checked for updates ${checked}` : ""
		].filter(Boolean).join(" · ")) + ".<br>Annotations are the House Parliamentarian’s notes, shown below the text and never mixed into it.",
		actionsHtml: actions
	})}
    ${kpiStripHtml([
		{
			labelHtml: "Articles",
			valueHtml: String(g.articles.length),
			subHtml: `${sections} sections`
		},
		{
			labelHtml: "Amendments",
			valueHtml: String(g.amendments.length),
			subHtml: latest ? `Latest: ${escapeHtml(amendmentName(latest))}` : ""
		},
		{
			labelHtml: "Annotations",
			valueHtml: escapeHtml(fmt(c.note_count)),
			subHtml: "Parliamentarian’s notes"
		},
		{
			labelHtml: "Edition",
			valueHtml: escapeHtml(c.meta.edition || "—"),
			subHtml: bytes ? `${escapeHtml(fmtBytes(bytes))} of source XML` : "GovInfo bulk data"
		}
	], {
		label: "The Constitution at a glance",
		refTier: "const"
	})}
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter articles, amendments or topics…" aria-label="Filter the Constitution" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}">
    </div>
    <div class="lib-list" id="lib-list">${constContentsHtml(c)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>Nothing matches. Try a topic (“speech”, “taxes”) or a number (“14”).</div>`;
}
// src/views/home.ts
var HOME_NEWS_CACHE = "newsCache:v1:all";
var HOME_STATUS_CACHE = "newsCache:v1:status";
var HOME_TAB_ORDER = [
	"overview",
	"usc",
	"cfr",
	"fr"
];
var FEATURED_CATALOG_FALLBACK = [
	{
		title: 21,
		name: "Food and Drugs",
		agencies: ["FDA", "DEA"],
		sections: 8404,
		size_mb: 21.2,
		summary: "FDA rules for food, drugs, biologics, medical devices, cosmetics and tobacco, plus controlled substances."
	},
	{
		title: 26,
		name: "Internal Revenue",
		agencies: ["IRS"],
		sections: 6018,
		size_mb: 83.8,
		summary: "Federal tax regulations: income, estate, excise and employment taxes."
	},
	{
		title: 48,
		name: "Federal Acquisition Regulations System",
		agencies: [
			"GSA",
			"DOD",
			"NASA"
		],
		sections: 11185,
		size_mb: 21.3,
		summary: "How the government buys: the Federal Acquisition Regulation and agency supplements."
	},
	{
		title: 10,
		name: "Energy",
		agencies: ["NRC", "DOE"],
		sections: 5330,
		size_mb: 20.1,
		summary: "Nuclear licensing and safety (NRC), Department of Energy programs, efficiency standards and nuclear facility oversight."
	},
	{
		title: 12,
		name: "Banks and Banking",
		agencies: [
			"OCC",
			"FRS",
			"FDIC",
			"CFPB"
		],
		sections: 7193,
		size_mb: 38,
		summary: "Rules for banks, credit unions and lenders: capital, consumer lending, deposit insurance and the Federal Reserve."
	},
	{
		title: 14,
		name: "Aeronautics and Space",
		agencies: ["FAA", "NASA"],
		sections: 6382,
		size_mb: 16.2,
		summary: "Aviation safety: aircraft certification, pilots, airports and air carriers, plus commercial space and NASA."
	}
];
function installedFallbackList() {
	const base = state.installedTitles.length ? state.installedTitles : state.metaInfo.edition ? [{
		title: state.currentTitle,
		name: state.metaInfo.name || `Title ${state.currentTitle}`,
		section_count: state.metaInfo.section_count,
		edition: state.metaInfo.edition
	}] : [];
	const cachedByTitle = new Map((state.homeSnapshot && state.homeSnapshot.titles || []).map((x) => [x.title, x]));
	return base.map((t) => {
		const cached = cachedByTitle.get(t.title) || {};
		return {
			agencies: cached.agencies || [],
			summary: cached.summary || "",
			scope_parts: cached.scope_parts ?? null,
			scope_sections_count: cached.scope_sections_count || 0,
			unreadable: Boolean(cached.unreadable),
			news: cached.news || {
				count: 0,
				latest_title: null,
				latest_date: null
			},
			...t
		};
	});
}
function sectionLinkHref(e) {
	return titleHref(e.ti, "section/" + encodeURIComponent(e.id) + (e.u ? "/" + encodeURIComponent(e.u) : ""));
}
function recentSectionsFor(usage, installedSet) {
	const split = (key) => {
		const i = key.indexOf("|");
		return [parseInt(key.slice(0, i), 10), key.slice(i + 1)];
	};
	return Object.entries(usage.s).map(([k, e]) => {
		const [ti, id] = split(k);
		return {
			...e,
			ti,
			id
		};
	}).filter((e) => installedSet.has(e.ti)).sort((a, b) => (b.t || 0) - (a.t || 0));
}
function readCountForTitle(title, usage) {
	const fromVisited = visitedCountFor(title);
	const prefix = `${title}|`;
	let fromUsage = 0;
	for (const k of Object.keys(usage.s)) if (k.startsWith(prefix)) fromUsage += 1;
	return Math.max(fromVisited, fromUsage);
}
function cachedNewsStatus() {
	const cachedNews = lsGetJSON(HOME_NEWS_CACHE);
	const fallbackTotal = Number(cachedNews?.data?.total ?? cachedNews?.data?.articles?.length ?? 0);
	if (state.navNewsStatus) {
		if (!state.navNewsStatus.articles && fallbackTotal > 0) return {
			...state.navNewsStatus,
			articles: fallbackTotal
		};
		return state.navNewsStatus;
	}
	const cached = lsGetJSON(HOME_STATUS_CACHE);
	if (!cached?.data) return null;
	return !cached.data.articles && fallbackTotal > 0 ? {
		...cached.data,
		articles: fallbackTotal
	} : cached.data;
}
function libRowByTitle() {
	return new Map((state.navLibData?.titles || []).map((r) => [r.title, r]));
}
function frAttentionReason(status) {
	if (!status || !status.sync_enabled) return null;
	const srcs = Object.values(status.sources || {}).filter((s) => s && s.enabled);
	const errored = srcs.find((s) => s.retry_after || s.last_error);
	if (errored) return errored.last_error || "Last sync failed";
	const now = Date.now();
	if (srcs.find((s) => s.next_due_at && Date.parse(s.next_due_at) <= now)) return "New filings due for sync";
	return null;
}
function collectAttentionItems(titles, status) {
	const items = [];
	const libMap = libRowByTitle();
	for (const t of titles) {
		if (jobFor(t.title, "title")) continue;
		if (t.unreadable) {
			items.push({
				id: `cfr-rebuild-${t.title}`,
				tier: "cfr",
				code: `${t.title} CFR`,
				name: t.name,
				detail: "Database unreadable — rebuild required",
				actionLabel: "Rebuild",
				act: "update-title",
				titleNum: t.title
			});
			continue;
		}
		const row = libMap.get(t.title);
		if (row && isStale(row)) {
			const fromEd = shortDate(row.installed?.edition || t.edition) || "Installed";
			const toEd = shortDate(row.latest) || "Latest";
			items.push({
				id: `cfr-stale-${t.title}`,
				tier: "cfr",
				code: `${t.title} CFR`,
				name: t.name,
				detail: `${fromEd} → eCFR ${toEd}`,
				actionLabel: "Update",
				act: "update-title",
				titleNum: t.title
			});
		}
	}
	const frReason = frAttentionReason(status);
	if (frReason) {
		const isSyncing = Boolean(status?.syncing);
		const isErr = Object.values(status?.sources || {}).some((s) => s && s.enabled && (s.retry_after || s.last_error));
		items.push({
			id: "fr-sync",
			tier: "fr",
			code: "FR",
			name: "Federal Register",
			detail: isSyncing ? "Syncing latest filings…" : frReason,
			actionLabel: isSyncing ? "Syncing…" : isErr ? "Retry sync" : "Sync now",
			act: "sync-fr"
		});
	}
	return items;
}
function activeTransfersHtml() {
	const j = state.jobs.current;
	const queued = state.jobs.queued || [];
	if (!j && !queued.length) return "";
	const pill = statPill("busy", j ? j.state === "running" ? j.phase || "Downloading" : "Queued" : "Queued");
	const text = j ? j.label : "Preparing download";
	const more = queued.length ? ` · +${queued.length} queued` : "";
	return `
    <a class="hm-transfer" href="#/library">
      ${pill}
      <span class="hm-transfer-text">${escapeHtml(text)}${escapeHtml(more)}</span>
      <span class="hm-transfer-cta">Watch in Library ${icon("chevronRight")}</span>
    </a>`;
}
function cachedNewsArticles() {
	const cachedNews = lsGetJSON(HOME_NEWS_CACHE);
	return Array.isArray(cachedNews?.data?.articles) ? cachedNews.data.articles : [];
}
function frCategoryLabel(cat) {
	if (cat === "public_inspection") return "Public Inspection";
	if (cat === "rules") return "Final Rule";
	if (cat === "rulemaking") return "Proposed Rule";
	if (cat === "notices") return "Notice";
	return "Filing";
}
function articlePrimaryHref(a) {
	const docNum = frDocumentNumber(a);
	if (docNum) return `#/news/fr/${encodeURIComponent(docNum)}`;
	const actNr = inspectionActivityNr(a);
	if (actNr) return `#/news/inspection/${encodeURIComponent(actNr)}`;
	return `#/news?cat=${encodeURIComponent(a.category || "all")}`;
}
function articleDateNoteHtml(a) {
	if (a.comments_close_on) return `<span class="hm-fr-date-badge is-deadline">Comments close ${escapeHtml(shortDate(a.comments_close_on))}</span>`;
	if (a.effective_on) return `<span class="hm-fr-date-badge is-effective">Effective ${escapeHtml(shortDate(a.effective_on))}</span>`;
	if (a.scheduled_on) return `<span class="hm-fr-date-badge">Publishes ${escapeHtml(shortDate(a.scheduled_on))}</span>`;
	return "";
}
function systemsStripHtml(allFrameworks, titles, status, attention, articles) {
	const activeTier = state.homeTierFilter || "all";
	const cfrAttention = attention.filter((a) => a.tier === "cfr");
	const cfrStaleCount = cfrAttention.length;
	const frNeedsSync = attention.some((a) => a.tier === "fr");
	const busy = Boolean(state.jobs.current || state.jobs.queued.length);
	const frArticles = (articles || []).filter((a) => a && a.category !== "enforcement").sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
	const libTitles = state.navLibData?.titles || [];
	const week = libTitles.length ? amendedWeek({ titles: libTitles }) : {
		newest: "",
		cut: "",
		recent: 0
	};
	const amendedSorted = libTitles.filter((t) => !t.reserved && t.amended).sort((a, b) => String(b.amended || "").localeCompare(String(a.amended || "")));
	const latestEdition = week.newest || titles.reduce((m, t) => t.edition && t.edition > m ? t.edition : m, "") || state.metaInfo.edition || "";
	const cards = SYSTEM_TIERS.map((tier) => {
		const meta = TIER_META[tier];
		const list = allFrameworks.filter((c) => c.tier === tier);
		const isSelected = activeTier === tier;
		let headline = "";
		let detail = "";
		let footer = "";
		let statusHtml = "";
		if (tier === "federal-statute") {
			const latestUsc = list.filter((c) => c.installed && c.edition).sort((a, b) => String(b.edition || "").localeCompare(String(a.edition || "")))[0];
			const linkedCfrSet = new Set(list.flatMap((c) => c.linked_titles || []));
			const linkedRules = frArticles.filter((a) => (a.category === "rules" || a.category === "rulemaking") && (a.cfr_parts || []).some((p) => linkedCfrSet.has(p.title)));
			const latestLinked = linkedRules[0];
			const linkedUsc = latestLinked ? list.find((c) => (c.linked_titles || []).some((n) => (latestLinked.cfr_parts || []).some((p) => p.title === n))) : null;
			if (latestUsc) {
				statusHtml = statPill("synced", "Current", { bare: true });
				headline = `Updated ${shortDate(latestUsc.edition)}`;
				detail = `${latestUsc.code} · ${latestUsc.name}`;
				footer = "Local U.S.C. edition verified";
			} else if (latestLinked && linkedUsc) {
				const shortUsc = linkedUsc.code.split("§§")[0].trim();
				const touchedParts = [...new Set(linkedRules.flatMap((a) => (a.cfr_parts || []).map((p) => `${p.title} CFR Part ${p.part}`)))].slice(0, 2);
				statusHtml = `<span class="hm-sys-note">${escapeHtml(shortDate(latestLinked.published_at))}</span>`;
				headline = `${shortUsc} · ${plural(linkedRules.length, "related rule")}`;
				detail = touchedParts.length ? `Implementing rulemaking active in ${touchedParts.join(" & ")}` : latestLinked.title;
				footer = "USLM public-law diffing next";
			} else {
				const codes = list.slice(0, 3).map((c) => c.code.split("§§")[0].trim()).join(" · ");
				statusHtml = "<span class=\"hm-sys-note\">Feed planned</span>";
				headline = "No statutory changes";
				detail = codes ? `Tracking statutory authority for ${codes}` : "Federal enabling statutes ready for public-law tracking";
				footer = "USLM public-law sync planned";
			}
		} else if (tier === "federal-reg") {
			const cfrFrLead = frArticles.find((a) => (a.category === "rules" || a.category === "rulemaking") && a.cfr_parts && a.cfr_parts.length > 0) || frArticles.find((a) => a.cfr_parts && a.cfr_parts.length > 0);
			statusHtml = busy ? statPill("busy", "Updating", { bare: true }) : cfrStaleCount > 0 ? statPill("stale", `${cfrStaleCount} ${cfrStaleCount === 1 ? "update" : "updates"}`, { bare: true }) : statPill("synced", "Up to date", { bare: true });
			if (cfrStaleCount > 0) {
				headline = `${plural(cfrStaleCount, "edition update")} available`;
				detail = cfrAttention.slice(0, 2).map((a) => `${a.code} (${a.detail})`).join(" · ");
				footer = "Newer eCFR edition ready to sync";
			} else if (week.recent > 0) {
				const recentTitles = amendedSorted.filter((t) => t.amended && t.amended >= week.cut);
				headline = `${plural(week.recent, "title")} amended this week`;
				detail = recentTitles.slice(0, 2).map((t) => `${t.title} CFR ${t.name || ""}`.trim()).join(" · ");
				footer = recentTitles[0]?.amended ? `Latest amendment ${shortDate(recentTitles[0].amended)}` : `eCFR ${shortDate(latestEdition)}`;
			} else if (amendedSorted.length > 0) {
				const top = amendedSorted[0];
				headline = `Amended ${shortDate(top.amended)}`;
				detail = `${top.title} CFR · ${top.name || `Title ${top.title}`}`;
				footer = latestEdition ? `eCFR edition ${shortDate(latestEdition)}` : "Checked against eCFR";
			} else if (cfrFrLead) {
				const ref = cfrFrLead.cfr_parts?.[0];
				headline = ref ? `${ref.title} CFR Part ${ref.part} · ${frCategoryLabel(cfrFrLead.category)}` : `CFR rulemaking · ${shortDate(cfrFrLead.published_at)}`;
				detail = cfrFrLead.title;
				footer = latestEdition ? `eCFR ${shortDate(latestEdition)} · No pending updates` : "No pending eCFR updates";
			} else {
				headline = "No recent amendments";
				detail = latestEdition ? `All tracked CFR editions match eCFR ${shortDate(latestEdition)}` : "Checked against latest eCFR edition";
				footer = "No pending eCFR updates";
			}
		} else if (tier === "federal-register") {
			const lead = frArticles[0];
			const second = frArticles[1];
			const lastOk = status?.sources?.federal_register?.last_ok_at;
			statusHtml = Boolean(status?.syncing) ? statPill("busy", "Syncing…", { bare: true }) : frNeedsSync ? statPill("stale", "Update due", { bare: true }) : lead ? statPill("synced", lastOk ? timeAgo(Date.parse(lastOk)) : "Current", { bare: true }) : "<span class=\"hm-sys-note\">Ready</span>";
			if (lead) {
				headline = `${frCategoryLabel(lead.category)} · ${shortDate(lead.published_at)}`;
				detail = lead.title;
				footer = second ? `Also: ${frCategoryLabel(second.category)} · ${shortDate(second.published_at)}` : lastOk ? `Synced ${timeAgo(Date.parse(lastOk))}` : "Federal Register API v1";
			} else {
				headline = "No recent filings";
				detail = "Final rules, proposed rules, notices, and public inspection filings appear here after sync";
				footer = lastOk ? `Checked ${timeAgo(Date.parse(lastOk))}` : "Federal Register API v1";
			}
		}
		return `
      <button type="button" class="hm-sys-card${isSelected ? " is-selected" : ""}" data-ref-tier="${meta.refTier}" data-hm-tier="${escapeHtml(tier)}" aria-pressed="${isSelected}">
        <div class="hm-sys-top">
          <span class="hm-sys-kicker">${escapeHtml(meta.short)}</span>
          ${statusHtml}
        </div>
        <div class="hm-sys-val">${escapeHtml(headline)}</div>
        <div class="hm-sys-sub">${escapeHtml(detail)}</div>
        <div class="hm-sys-meta">${escapeHtml(footer)}</div>
      </button>`;
	}).join("");
	return `
    <section class="hm-systems" id="hm-systems" aria-label="Recent changes across federal frameworks">
      <div class="hm-sys-grid">${constSysCardHtml()}${cards}</div>
    </section>`;
}
/** The Constitution beside the three codes: a link into the reader (or its Library tab before install). */
function constSysCardHtml(c = constCached()) {
	const job = constJob();
	const installed = Boolean(c?.installed);
	const amend = installed ? new Set(c.outline.filter((u) => u.amendment).map((u) => u.amendment)).size : 0;
	const statusHtml = job ? statPill("busy", job.state === "running" ? "Downloading" : "Queued", { bare: true }) : installed ? statPill("synced", "Installed", { bare: true }) : `<span class="hm-sys-note">${c ? "Not installed" : "Checking…"}</span>`;
	const headline = installed ? `${amend} amendments · ${constGroups(c.outline).articles.length} articles` : "The supreme law";
	const detail = installed ? `Preamble, articles and amendments with ${c.note_count.toLocaleString()} Parliamentarian’s annotations` : "Download the full text, with the House Parliamentarian’s annotations kept apart";
	const footer = installed ? constEdition(c) || "Installed" : "GovInfo · no key needed";
	return `
      <a class="hm-sys-card" id="hm-sys-const" href="${installed ? CONST_START_HREF : CONST_LIB_HREF}" data-ref-tier="const">
        <div class="hm-sys-top">
          <span class="hm-sys-kicker">Constitution</span>
          ${statusHtml}
        </div>
        <div class="hm-sys-val">${escapeHtml(headline)}</div>
        <div class="hm-sys-sub">${escapeHtml(detail)}</div>
        <div class="hm-sys-meta">${escapeHtml(footer)}</div>
      </a>`;
}
function updatesBannerHtml(attention, titles) {
	const checkedAt = state.navLibData?.checked_at;
	const frSyncing = Boolean(cachedNewsStatus()?.syncing);
	if (attention.length) return `
      <section class="hm-updates is-attention" id="hm-updates" aria-label="Frameworks needing updates">
        <div class="hm-upd-head">
          <div class="hm-upd-title-wrap">
            <span class="stat-dot is-stale" aria-hidden="true"></span>
            <h2 class="hm-upd-title">${escapeHtml(plural(attention.length, "framework"))} need${attention.length === 1 ? "s" : ""} updating</h2>
            <span class="hm-upd-sub">Keep offline editions and Federal Register filings current</span>
          </div>
          <div class="hm-upd-head-acts">
            ${attention.length > 1 ? `<button type="button" class="btn btn-sm btn-accent" data-hm-act="update-all-attention">Update all (${attention.length})</button>` : ""}
            <button type="button" class="btn btn-sm" data-hm-act="check-updates">${icon("refresh")} Recheck</button>
          </div>
        </div>
        <div class="hm-upd-list">
          ${attention.map((item) => `
            <div class="hm-upd-row" data-ref-tier="${item.tier}">
              <span class="tier-pip" aria-hidden="true"></span>
              <span class="hm-upd-code">${escapeHtml(item.code)}</span>
              <span class="hm-upd-name">${escapeHtml(item.name)}</span>
              <span class="hm-upd-detail">${escapeHtml(item.detail)}</span>
              <button type="button" class="btn btn-sm" data-hm-act="${item.act}"${item.titleNum ? ` data-title="${item.titleNum}"` : ""}${item.act === "sync-fr" && frSyncing ? " disabled" : ""}>${escapeHtml(item.actionLabel)}</button>
            </div>`).join("")}
        </div>
      </section>`;
	return `
    <section class="hm-updates is-synced" id="hm-updates" aria-label="Framework update status">
      <div class="hm-upd-calm">
        <div class="hm-upd-calm-left">
          <span class="stat-dot is-synced" aria-hidden="true"></span>
          <span class="hm-upd-calm-title">All editions current</span>
          ${SEP}
          <span class="hm-upd-calm-meta">${escapeHtml(checkedAt ? `Checked ${timeAgo(checkedAt * 1e3)}` : titles.length ? `${plural(titles.length, "CFR title")} & FR feed ready on this device` : "Federal Register feed ready")}</span>
        </div>
        <div class="hm-upd-calm-acts">
          <button type="button" class="hm-inline-link" data-hm-act="check-updates">${icon("refresh")} Check for updates</button>
          <a class="hm-inline-link" href="#/library">Browse library ${icon("chevronRight")}</a>
        </div>
      </div>
    </section>`;
}
function workFootprintHtml(titles, usage, projects, totalRead) {
	const installedSet = new Set(titles.map((t) => t.title));
	const visitsByTitle = /* @__PURE__ */ new Map();
	let totalVisits = 0;
	for (const [k, e] of Object.entries(usage.s)) {
		const ti = parseInt(k.slice(0, k.indexOf("|")), 10);
		if (!installedSet.has(ti)) continue;
		const n = Number(e.n || 1);
		visitsByTitle.set(ti, (visitsByTitle.get(ti) || 0) + n);
		totalVisits += n;
	}
	const partsExplored = Object.keys(usage.p).filter((k) => installedSet.has(parseInt(k.slice(0, k.indexOf("|")), 10))).length;
	const totalPinned = projects.reduce((sum, p) => sum + (p.sections?.length || 0) + (p.cases?.length || 0), 0);
	const openTasks = projects.reduce((sum, p) => sum + (p.projects || []).filter((t) => t.status !== "done").length, 0);
	const slices = [...visitsByTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([ti, visits], idx) => ({
		ti,
		visits,
		pct: totalVisits ? Math.max(4, Math.round(visits / totalVisits * 100)) : 0,
		tone: idx === 0 ? "cfr" : idx === 1 ? "usc" : idx === 2 ? "fr" : "ibr"
	}));
	const distHtml = slices.length ? `
    <div class="hm-fp-dist">
      <div class="hm-fp-bar" role="img" aria-label="Reading activity distribution across frameworks">
        ${slices.map((s) => `<span class="hm-fp-seg" data-ref-tier="${s.tone}" style="width:${s.pct}%" title="${s.ti} CFR: ${s.pct}% of study sessions"></span>`).join("")}
      </div>
      <div class="hm-fp-legend">
        ${slices.map((s) => `<span class="hm-fp-leg-item" data-ref-tier="${s.tone}"><span class="hm-fp-swatch" aria-hidden="true"></span>${s.ti} CFR <strong>${s.pct}%</strong></span>`).join("")}
      </div>
    </div>` : "";
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
function resumeCardHtml(recent, titles, usage, projects, totalRead) {
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
          ${last.p ? `${SEP}<a href="${titleHref(last.ti, "part/" + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ""}
          ${last.ul ? `${SEP}<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ""}
        </div>
        <a class="hm-resume-title" href="${href}">${escapeHtml(last.l)} ${escapeHtml(last.h || "")}</a>
        <div class="hm-resume-acts">
          <a class="btn btn-sm btn-accent" href="${href}">Resume reading ${icon("chevronRight")}</a>
          ${last.p ? `<a class="hm-inline-link hm-part-link" href="${titleHref(last.ti, "part/" + encodeURIComponent(last.p))}">Open Part ${escapeHtml(last.p)} ${icon("chevronRight")}</a>` : ""}
          <button type="button" class="hm-inline-link" data-hm-act="resume-split" data-title="${last.ti}" data-section="${escapeHtml(last.id)}"${last.u ? ` data-unit="${escapeHtml(last.u)}"` : ""}>${icon("stack")} Side-by-side</button>
        </div>
        ${footprint}
        ${trail.length ? `
          <div class="hm-trail">
            <div class="hm-trail-head">
              <span class="hm-kicker">Recently opened</span>
              ${hasMore ? `<button type="button" class="hm-inline-link" data-hm-act="toggle-history">${expanded ? "Show less" : `Show all (${recent.length - 1})`}</button>` : ""}
            </div>
            <div class="hm-trail-list">
              ${trail.map((e) => `
                <a class="hm-trail-row" href="${sectionLinkHref(e)}">
                  <span class="hm-tag" data-ref-tier="cfr">${e.ti} CFR</span>
                  <span class="hm-row-num">${escapeHtml(String(e.l || e.id).replace(/^§\s*/, ""))}</span>
                  <span class="hm-row-text">${escapeHtml(e.h || "")}</span>
                  <span class="hm-row-val">${escapeHtml(timeAgo(e.t || 0))}</span>
                </a>`).join("")}
            </div>
          </div>` : ""}
      </section>`;
	}
	const starters = [];
	for (const t of titles) {
		if (t.partial && t.scope_parts && t.scope_parts.length) for (const p of t.scope_parts.slice(0, 2)) {
			starters.push({
				ti: t.title,
				part: p,
				kicker: `${t.title} CFR`,
				title: `Part ${p}`
			});
			if (starters.length >= 4) break;
		}
		else {
			const c = HOME_CONTENT[t.title];
			if (c) for (const card of c.cards.slice(0, 2)) {
				starters.push({
					ti: t.title,
					part: card.part,
					kicker: `${t.title} CFR · ${card.kicker}`,
					title: card.title
				});
				if (starters.length >= 4) break;
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
          ${starters.map((s) => `
            <a class="hm-starter" href="${titleHref(s.ti, "part/" + encodeURIComponent(s.part))}">
              <span class="hm-starter-kicker">${escapeHtml(s.kicker)}</span>
              <span class="hm-starter-name">${escapeHtml(s.title)}</span>
            </a>`).join("")}
        </div>` : ""}
      ${footprint}
    </section>`;
}
function workspacesCardHtml(projects) {
	const sorted = [...projects].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")).slice(0, 3);
	const body = sorted.length ? `
    <div class="hm-ws-list">
      ${sorted.map((p) => {
		const chips = (p.sections || []).slice(0, 3).map((s) => {
			const ok = titleInstalled(s.title);
			const href = ok ? `#/title/${s.title}/section/${encodeURIComponent(s.id)}` : `#/library/${s.title}`;
			const tip = ok ? "" : ` title="Title ${s.title} isn’t installed. Open Library"`;
			return `<a class="citation-chip${ok ? "" : " is-dim"}" data-ref-tier="${ok ? "cfr" : "uninstalled"}" href="${href}"${tip}>${escapeHtml(s.label || "§ " + s.id)}</a>`;
		}).join("");
		const extra = (p.sections || []).length - 3;
		const tasks = p.projects || [];
		const openTasks = tasks.filter((x) => x.status !== "done").length;
		const cases = (p.cases || []).length;
		const tabGroups = p.tab_groups || [];
		const firstGroup = tabGroups[0];
		const metaParts = [
			plural(p.sections.length, "section"),
			tasks.length ? `${openTasks}/${tasks.length} open tasks` : "",
			cases ? plural(cases, "case") : "",
			tabGroups.length ? plural(tabGroups.length, "tab group") : "",
			escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))
		];
		return `
          <article class="hm-ws-item">
            <div class="hm-ws-top">
              <a class="hm-ws-name" href="#/projects/${encodeURIComponent(p.id)}">${projDot(p)}<span>${escapeHtml(p.name)}</span></a>
              <span class="hm-ws-meta">${joinSep(metaParts)}</span>
            </div>
            ${p.description ? `<p class="hm-ws-desc">${escapeHtml(p.description)}</p>` : ""}
            ${chips || firstGroup ? `<div class="hm-ws-chips">
              ${chips}
              ${extra > 0 ? `<a class="hm-more-chip" href="#/projects/${encodeURIComponent(p.id)}">+${extra}</a>` : ""}
              ${firstGroup ? `<button type="button" class="hm-more-chip is-action" data-hm-act="restore-tabgroup" data-proj-id="${escapeHtml(p.id)}" data-group-id="${escapeHtml(firstGroup.id)}" title="Restore saved reader tab group: ${escapeHtml(firstGroup.name)}">Restore tabs ${icon("chevronRight")}</button>` : ""}
            </div>` : ""}
          </article>`;
	}).join("")}
    </div>` : `
    <div class="hm-empty-block">
      <div class="hm-empty-title">Organize your federal research</div>
      <p class="hm-muted">Curate pinned provisions, Federal Register filings, notes, and side-by-side reading sets in one place.</p>
      <div class="hm-empty-acts">
        <button type="button" class="btn btn-sm" data-hm-act="new-workspace">${icon("plus")} Create workspace</button>
      </div>
    </div>`;
	return `
    <section class="hm-ws" aria-label="Workspaces">
      <div class="hm-panel-head">
        <h2 class="hm-panel-title">Workspaces${projects.length ? ` <span class="hm-count">${projects.length}</span>` : ""}</h2>
        <div class="hm-panel-acts">
          <button type="button" class="hm-inline-link" data-hm-act="new-workspace">+ New</button>
          <a class="hm-inline-link" href="#/projects">View all</a>
        </div>
      </div>
      ${body}
    </section>`;
}
function titleLivingSignalHtml(t, recent, projects) {
	const lastInTitle = recent.find((e) => e.ti === t.title);
	if (lastInTitle) return `<a class="hm-signal-link" href="${sectionLinkHref(lastInTitle)}">Last read ${escapeHtml(lastInTitle.l)}${SEP}${escapeHtml(timeAgo(lastInTitle.t || 0))}</a>`;
	const ws = projects.find((p) => (p.sections || []).some((s) => s.title === t.title));
	if (ws) return `<a class="hm-signal-link" href="#/projects/${encodeURIComponent(ws.id)}">${projDot(ws)}In ${escapeHtml(ws.name)}</a>`;
	if (t.news && t.news.count > 0) return `<a class="hm-signal-link" href="#/news">${escapeHtml(plural(t.news.count, "recent update"))}</a>`;
	return `<span class="hm-signal-muted">${t.section_count ? `${fmt(t.section_count)} sections ready` : "Ready offline"}</span>`;
}
function titleStatusHtml(t, staleSet) {
	if (t.unreadable) return statPill("stale", "Needs rebuild", { bare: true });
	const j = jobFor(t.title, "title");
	if (j) return statPill("busy", j.state === "running" ? "Updating" : "Queued", { bare: true });
	if (staleSet.has(t.title)) return statPill("stale", "Update available", { bare: true });
	if (t.partial) {
		const parts = (t.scope_parts || []).length;
		return statPill("partial", parts ? `Partial · ${plural(parts, "part")}` : "Partial", { bare: true });
	}
	return `<span class="hm-title-ed">${escapeHtml(shortDate(t.edition) || "Ready")}</span>`;
}
function titlePartsHtml(t) {
	if (t.partial && t.scope_parts && t.scope_parts.length) return `
      <div class="hm-title-parts">
        ${t.scope_parts.slice(0, 3).map((p) => `<a class="hm-part-chip" href="${titleHref(t.title, "part/" + encodeURIComponent(p))}"><span class="hm-part-num">Part ${escapeHtml(p)}</span></a>`).join("")}
        ${t.scope_parts.length > 3 ? `<span class="hm-part-more">+${t.scope_parts.length - 3} more</span>` : ""}
      </div>`;
	const parts = ((HOME_CONTENT[t.title] || { cards: [] }).cards || []).slice(0, 3);
	if (parts.length) return `
      <div class="hm-title-parts">
        ${parts.map((c) => {
		const label = c.title.replace(/^Part\s+\d+\s*[—–-]\s*/, "");
		return `<a class="hm-part-chip" href="${titleHref(t.title, "part/" + encodeURIComponent(c.part))}"><span class="hm-part-num">${escapeHtml(c.part)}</span><span>${escapeHtml(label)}</span></a>`;
	}).join("")}
      </div>`;
	return `
    <div class="hm-title-parts">
      <a class="hm-part-chip" href="${titleHref(t.title)}">Browse contents</a>
    </div>`;
}
function cfrCardHtml(t, staleSet, recent, projects, usage) {
	const read = readCountForTitle(t.title, usage);
	const count = Number(t.section_count || 0);
	const pct = count ? Math.min(100, read / count * 100) : 0;
	const agencies = (t.agencies || []).slice(0, 2);
	const pinnedInTitle = projects.reduce((sum, p) => sum + (p.sections || []).filter((s) => s.title === t.title).length, 0);
	const isTitleStale = staleSet.has(t.title) || Boolean(t.unreadable);
	const busy = Boolean(jobFor(t.title, "title"));
	return `
    <article class="hm-title-card has-tier-bar" data-ref-tier="cfr">
      <div class="hm-title-top">
        <span class="hm-title-kicker">${t.title} CFR${agencies.length ? `${SEP}<span class="hm-title-ag">${agencies.map(escapeHtml).join(" · ")}</span>` : ""}</span>
        ${titleStatusHtml(t, staleSet)}
      </div>
      <h3 class="hm-title-name"><a href="${titleHref(t.title)}">${escapeHtml(t.name)}</a></h3>
      ${t.summary ? `<p class="hm-title-desc">${escapeHtml(t.summary)}</p>` : !(state.homeSnapshot && Array.isArray(state.homeSnapshot.titles)) ? skeletonHtml("summary") : ""}
      ${titlePartsHtml(t)}
      <div class="hm-title-foot">
        <div class="hm-title-signal-row">
          ${titleLivingSignalHtml(t, recent, projects)}
          ${isTitleStale && !busy ? `<button type="button" class="hm-inline-link is-warn" data-hm-act="update-title" data-title="${t.title}">${t.unreadable ? "Rebuild" : "Update"}</button>` : t.partial ? `<a class="hm-inline-link" href="#/library/${t.title}">Add parts</a>` : `<a class="hm-inline-link" href="${titleHref(t.title)}">Open ${icon("chevronRight")}</a>`}
        </div>
        <div class="hm-prog-meta">
          <span>${fmt(read)} of ${fmt(count)} read</span>
          ${pinnedInTitle ? `<span>${plural(pinnedInTitle, "saved")}</span>` : ""}
        </div>
        <div class="hm-prog-track" title="${fmt(read)} of ${fmt(count)} sections read" aria-hidden="true"><span style="width:${read ? Math.max(3, Math.round(pct)) : 0}%"></span></div>
      </div>
    </article>`;
}
function extraFrameworkCardHtml(c, projects, status) {
	const refTier = refTierForCorpus(c);
	const meta = TIER_META[c.tier] || TIER_META["federal-statute"];
	const href = corpusHashFor(c);
	const isInstalled = c.installed !== false;
	let statusPill = "";
	let chipsHtml = "";
	let footLeft = "";
	let footRight = `<a class="hm-inline-link" href="${escapeHtml(href)}">Open framework ${icon("chevronRight")}</a>`;
	if (c.tier === "federal-register") {
		const frReason = frAttentionReason(status);
		const frSyncing = Boolean(status?.syncing);
		const articles = Number(status?.articles || c.section_count || 0);
		statusPill = frSyncing ? statPill("busy", "Syncing…", { bare: true }) : frReason ? statPill("stale", "Sync due", { bare: true }) : articles > 0 ? statPill("synced", "Synced", { bare: true }) : statPill("partial", "Ready", { bare: true });
		chipsHtml = `
      <div class="hm-title-parts">
        <a class="hm-part-chip" href="#/news?cat=rules"><span class="hm-part-num">Final Rules</span></a>
        <a class="hm-part-chip" href="#/news?cat=rulemaking"><span class="hm-part-num">Proposed</span></a>
        <a class="hm-part-chip" href="#/news?cat=notices"><span class="hm-part-num">Notices</span></a>
      </div>`;
		footLeft = `<span class="hm-signal-muted">${escapeHtml(articles ? `${fmt(articles)} filings cached` : "Federal Register API v1")}</span>`;
		footRight = frSyncing ? "<span class=\"hm-signal-muted\">Syncing…</span>" : frReason ? "<button type=\"button\" class=\"hm-inline-link is-warn\" data-hm-act=\"sync-fr\">Sync now</button>" : `<a class="hm-inline-link" href="#/news">Newsroom ${icon("chevronRight")}</a>`;
	} else {
		statusPill = isInstalled ? statPill("synced", "Installed", { bare: true }) : statPill("partial", c.status_label || "Statutory", { bare: true });
		const ext = safeHttpUrl(c.external_url);
		const provChips = (authorityForCorpus(c)?.provisions || []).slice(0, 2).map((p) => {
			const targetHref = titleInstalled(p.cfrTitle) ? p.cfrSection ? `#/title/${p.cfrTitle}/section/${encodeURIComponent(p.cfrSection)}` : `#/title/${p.cfrTitle}/part/${encodeURIComponent(p.cfrPart || "")}` : `#/library/${p.cfrTitle}`;
			const label = p.cfrSection ? `${p.cfrTitle} CFR § ${p.cfrSection}` : `${p.cfrTitle} CFR Part ${p.cfrPart}`;
			return `<a class="hm-part-chip" href="${targetHref}"><span class="hm-part-num">${escapeHtml(p.cite.replace(/^\d+\s+U\.S\.C\.\s*/, ""))}</span><span>→ ${escapeHtml(label)}</span></a>`;
		}).join("");
		const linked = !provChips ? (c.linked_titles || []).filter((n) => titleInstalled(n)).slice(0, 2).map((n) => `<a class="hm-part-chip" href="#/title/${n}/"><span class="hm-part-num">${n} CFR</span><span>Implementing rules</span></a>`).join("") : "";
		chipsHtml = `
      <div class="hm-title-parts">
        ${provChips || linked}
        ${ext ? `<a class="hm-part-chip" href="${escapeHtml(ext)}" target="_blank" rel="noopener noreferrer">Official U.S.C. ${icon("external")}</a>` : ""}
      </div>`;
		footLeft = `<span class="hm-signal-muted">${escapeHtml(c.status_label || "Federal statutory authority")}</span>`;
	}
	return `
    <article class="hm-title-card has-tier-bar" data-ref-tier="${refTier}">
      <div class="hm-title-top">
        <span class="hm-title-kicker">${escapeHtml(c.tier === "federal-register" ? "Federal Register" : c.tier === "federal-statute" ? c.code : `${c.code} · ${meta.short}`)}${c.tier !== "federal-statute" && c.agencies.length ? `${SEP}<span class="hm-title-ag">${c.agencies.slice(0, 2).map(escapeHtml).join(" · ")}</span>` : ""}</span>
        ${statusPill}
      </div>
      <h3 class="hm-title-name"><a href="${escapeHtml(href)}">${escapeHtml(c.name)}</a></h3>
      ${c.summary ? `<p class="hm-title-desc">${escapeHtml(c.summary)}</p>` : ""}
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
function titlesBandHtml(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage) {
	const staleSet = new Set((state.navLibData && state.navLibData.titles || []).filter(isStale).map((t) => t.title));
	syncCorporaState();
	const deskId = state.activeDesk || "all";
	const tierFilter = state.homeTierFilter || "all";
	const snapByTitle = new Map(titles.map((t) => [t.title, t]));
	const filteredByTier = tierFilter === "all" ? allFrameworks : allFrameworks.filter((c) => c.tier === tierFilter);
	const filtered = deskId === "all" ? filteredByTier : filteredByTier.filter((c) => c.tier === "federal-register" || mapRawDeskToId(c.desk, c.title_num ?? null) === deskId);
	const shown = filtered.length ? filtered : filteredByTier;
	const tierCounts = /* @__PURE__ */ new Map([["all", allFrameworks.length]]);
	for (const c of allFrameworks) tierCounts.set(c.tier, (tierCounts.get(c.tier) || 0) + 1);
	const tierTabsHtml = `
    <div class="hm-tier-tabs" role="group" aria-label="Filter by legal framework system">
      <button type="button" class="hm-tier-tab${tierFilter === "all" ? " is-active" : ""}" data-hm-tier="all" aria-pressed="${tierFilter === "all"}">
        <span>All</span><span class="hm-tier-count">${tierCounts.get("all") || 0}</span>
      </button>
      ${SYSTEM_TIERS.map((t) => {
		const m = TIER_META[t];
		const cnt = tierCounts.get(t) || 0;
		const on = tierFilter === t;
		return `<button type="button" class="hm-tier-tab${on ? " is-active" : ""}" data-ref-tier="${m.refTier}" data-hm-tier="${escapeHtml(t)}" aria-pressed="${on}">
          <span>${escapeHtml(m.short)}</span><span class="hm-tier-count">${cnt}</span>
        </button>`;
	}).join("")}
    </div>`;
	const ribbonHtml = deskFilterRibbonHtml(deskId, filteredByTier);
	const orderRank = {
		"federal-statute": 0,
		"federal-reg": 1,
		"federal-register": 2,
		"standard": 3
	};
	const cards = [...shown].sort((a, b) => (orderRank[a.tier] ?? 9) - (orderRank[b.tier] ?? 9)).map((c) => {
		if (c.tier === "federal-reg" && c.title_num != null) {
			const snap = snapByTitle.get(c.title_num);
			if (snap) return cfrCardHtml(snap, staleSet, recent, projects, usage);
		}
		return extraFrameworkCardHtml(c, projects, status);
	}).join("");
	return `
    <section class="hm-titles" id="hm-titles" aria-label="Federal frameworks">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Federal Frameworks</h2>
          <span class="hm-sec-meta">${joinSep([
		plural(shown.length, "framework"),
		totalSections ? `${fmt(totalSections)} offline sections` : "",
		totalRead ? `${fmt(totalRead)} read` : ""
	])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add or update frameworks ${icon("chevronRight")}</a>
      </div>
      <div class="hm-filters">
        ${tierTabsHtml}
        ${ribbonHtml}
      </div>
      <div class="hm-title-grid">${cards}</div>
    </section>`;
}
function pulseChipsHtml(a) {
	const chips = [];
	for (const r of (a.cfr_parts || []).slice(0, 2)) {
		const ok = titleInstalled(r.title);
		chips.push(`<a class="citation-chip${ok ? "" : " is-dim"}" data-ref-tier="${ok ? "cfr" : "uninstalled"}" href="${newsPartHref(r.title, r.part)}">${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
	}
	for (const s of (a.sections || []).slice(0, Math.max(0, 3 - chips.length))) {
		const ok = titleInstalled(29);
		chips.push(`<a class="citation-chip${ok ? "" : " is-dim"}" data-ref-tier="${ok ? "cfr" : "uninstalled"}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`);
	}
	return chips.length ? `<div class="hm-news-chips">${chips.join("")}</div>` : "";
}
function newsSkeletonHtml(heading = "Federal Register Pulse") {
	return `
    <div class="hm-panel-head">
      <h2 class="hm-panel-title">${icon("news")} ${escapeHtml(heading)}</h2>
      <div class="hm-panel-acts">
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon("chevronRight")}</a>
      </div>
    </div>
    <div class="hm-news-skel" aria-busy="true" aria-label="Loading Federal Register updates…">
      ${[
		1,
		2,
		3
	].map(() => `<div class="hm-news-skel-item">${skeletonHtml("pulse")}</div>`).join("")}
    </div>`;
}
function newsDispatchCardHtml(a) {
	const href = articlePrimaryHref(a);
	const docNum = frDocumentNumber(a);
	const dateBadge = articleDateNoteHtml(a);
	const takeaway = a.takeaways?.[0]?.text || a.action || "";
	return `
    <article class="hm-news-item">
      <div class="hm-news-top">
        <span class="hm-news-kicker">${escapeHtml(newsKicker(a))}</span>
        <span class="hm-news-right">
          ${a.penalty_usd ? `<span class="hm-news-fig">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : ""}
          <time class="hm-news-date">${escapeHtml(shortDate(a.published_at))}</time>
        </span>
      </div>
      <a class="hm-news-title" href="${href}">${escapeHtml(a.title)}</a>
      ${takeaway ? `<p class="hm-news-summary">${linkifyNewsText(takeaway)}</p>` : ""}
      <div class="hm-news-foot">
        ${pulseChipsHtml(a)}
        <div class="hm-news-meta-row">
          ${dateBadge}
          <a class="hm-inline-link hm-news-open" href="${href}">${docNum ? "Read preamble" : "Open filing"} ${icon("chevronRight")}</a>
        </div>
      </div>
    </article>`;
}
function newsSectionHtml(data, status, opts = {}) {
	const articles = data && data.articles || [];
	const pill = newsStatusPillHtml(status);
	const limit = opts.limit || 3;
	const heading = opts.heading || "Federal Register Pulse";
	if (!articles.length) {
		const canSync = status?.sync_enabled !== false;
		const syncing = Boolean(status?.syncing);
		return `
      <div class="hm-news-quiet">
        <span class="hm-news-quiet-label">${icon("news")} No Federal Register filings cached yet</span>
        <div class="hm-panel-acts">
          ${canSync ? `<button type="button" class="btn btn-sm" data-hm-act="sync-fr"${syncing ? " disabled" : ""}>${syncing ? "Syncing…" : "Sync now"}</button>` : ""}
          <a class="hm-inline-link" href="#/news">Open Newsroom ${icon("chevronRight")}</a>
        </div>
      </div>`;
	}
	const items = articles.slice(0, limit).map(newsDispatchCardHtml).join("");
	return `
    <div class="hm-panel-head">
      <h2 class="hm-panel-title">${escapeHtml(heading)}</h2>
      <div class="hm-panel-acts">
        <span id="hm-news-pill">${pill}</span>
        <a class="hm-inline-link" href="#/news">Open Newsroom ${icon("chevronRight")}</a>
      </div>
    </div>
    <div class="hm-news-grid">${items}</div>`;
}
function homeTabsHtml(allFrameworks, titles, status, attention, totalSections, totalRead, projectsCount) {
	const tab = state.homeTab || "overview";
	const uscCount = allFrameworks.filter((c) => c.tier === "federal-statute").length;
	const cfrCount = titles.length;
	const frCount = Number(status?.articles || 0);
	const cfrAlert = attention.some((a) => a.tier === "cfr");
	const frAlert = attention.some((a) => a.tier === "fr");
	return switchboardHtml({
		id: "hm-tabs",
		idPrefix: "hm-tab",
		dataAttr: "hm-tab",
		panelId: "hm-tab-body",
		label: "Home sections",
		tabs: [
			{
				id: "overview",
				label: "Overview",
				abbr: "DESK",
				countLabel: `${allFrameworks.length} frameworks`,
				sub: totalRead ? `${fmt(totalRead)} sections studied · ${plural(projectsCount, "workspace")}` : "All systems, reading desk & workspaces",
				alert: attention.length > 0
			},
			{
				id: "usc",
				label: "United States Code",
				abbr: "U.S.C.",
				refTier: "usc",
				countLabel: plural(uscCount, "statute"),
				sub: "Enabling acts & CFR delegation"
			},
			{
				id: "cfr",
				label: "Code of Federal Regulations",
				abbr: "CFR",
				refTier: "cfr",
				countLabel: plural(cfrCount, "title"),
				sub: totalSections ? `${fmt(totalSections)} offline sections & key parts` : "Codified rules & offline editions",
				alert: cfrAlert
			},
			{
				id: "fr",
				label: "Federal Register",
				abbr: "FR",
				refTier: "fr",
				countLabel: frCount ? `${fmt(frCount)} filings` : "Daily feed",
				sub: "Daily rules, deadlines & dockets",
				alert: frAlert
			}
		],
		active: tab
	});
}
function uscDossierCardHtml(c, titles, recent, projects, usage, articles) {
	const auth = authorityForCorpus(c);
	const href = corpusHashFor(c);
	const ext = safeHttpUrl(c.external_url);
	const linkedTitleNum = (c.linked_titles || [])[0];
	const linkedTitle = linkedTitleNum ? titles.find((t) => t.title === linkedTitleNum) : null;
	const linkedInstalled = Boolean(linkedTitle);
	const relatedRules = linkedTitleNum ? articles.filter((a) => a && a.category !== "enforcement" && (a.cfr_parts || []).some((p) => p.title === linkedTitleNum)) : [];
	const readInLinked = linkedTitleNum ? readCountForTitle(linkedTitleNum, usage) : 0;
	const pinnedInLinked = linkedTitleNum ? projects.reduce((sum, p) => sum + (p.sections || []).filter((s) => s.title === linkedTitleNum).length, 0) : 0;
	const lastInLinked = linkedTitleNum ? recent.find((e) => e.ti === linkedTitleNum) : null;
	const statusPill = linkedInstalled ? statPill("synced", `Linked · ${linkedTitleNum} CFR`, { bare: true }) : statPill("partial", c.status_label || "Statutory", { bare: true });
	const chainHtml = `
    <div class="hm-chain-bar" aria-label="Federal authority delegation chain">
      <span class="hm-chain-node is-usc" data-ref-tier="usc"><span class="tier-pip" aria-hidden="true"></span>${escapeHtml(c.code.split("§§")[0].trim())}</span>
      <span class="hm-chain-arrow" aria-hidden="true">→</span>
      ${linkedTitleNum ? `<a class="hm-chain-node is-cfr" data-ref-tier="cfr" href="${linkedInstalled ? titleHref(linkedTitleNum) : `#/library/${linkedTitleNum}`}"><span class="tier-pip" aria-hidden="true"></span>${linkedTitleNum} CFR ${escapeHtml(linkedTitle?.name || "")}</a>` : "<span class=\"hm-chain-node is-cfr\" data-ref-tier=\"cfr\">Implementing CFR</span>"}
      <span class="hm-chain-arrow" aria-hidden="true">→</span>
      <a class="hm-chain-node is-fr" data-ref-tier="fr" href="${linkedTitleNum ? `#/news?cfr_title=${linkedTitleNum}` : "#/news"}"><span class="tier-pip" aria-hidden="true"></span>${relatedRules.length ? plural(relatedRules.length, "FR filing") : "FR Rulemaking"}</a>
    </div>`;
	const actsHtml = auth && auth.acts.length ? `
    <div class="hm-usc-block">
      <div class="hm-usc-sec-lbl">Principal Enacted Acts</div>
      <div class="hm-usc-acts">
        ${auth.acts.map((act) => `<span class="hm-usc-act">${escapeHtml(act)}</span>`).join("")}
      </div>
    </div>` : "";
	const provsHtml = auth && auth.provisions.length ? `
    <div class="hm-usc-block">
      <div class="hm-usc-sec-lbl">Enabling Provisions → Implementing CFR</div>
      <div class="hm-usc-provs">
        ${auth.provisions.map((p) => {
		const ok = titleInstalled(p.cfrTitle);
		const cfrHref = ok ? p.cfrSection ? `#/title/${p.cfrTitle}/section/${encodeURIComponent(p.cfrSection)}` : `#/title/${p.cfrTitle}/part/${encodeURIComponent(p.cfrPart || "")}` : `#/library/${p.cfrTitle}`;
		const cfrLabel = p.cfrSection ? `${p.cfrTitle} CFR § ${p.cfrSection}` : `${p.cfrTitle} CFR Part ${p.cfrPart}`;
		return `
            <div class="hm-usc-prov-row">
              <div class="hm-usc-prov-main">
                <span class="hm-usc-prov-cite">${escapeHtml(p.cite)}</span>
                <span class="hm-usc-prov-title">${escapeHtml(p.title)}</span>
              </div>
              <a class="citation-chip${ok ? "" : " is-dim"}" data-ref-tier="${ok ? "cfr" : "uninstalled"}" href="${cfrHref}">${escapeHtml(cfrLabel)}</a>
            </div>`;
	}).join("")}
      </div>
    </div>` : "";
	const footprintSignal = lastInLinked ? `<a class="hm-signal-link" href="${sectionLinkHref(lastInLinked)}">Studied ${escapeHtml(lastInLinked.l)} under this mandate${SEP}${escapeHtml(timeAgo(lastInLinked.t || 0))}</a>` : readInLinked || pinnedInLinked ? `<span class="hm-signal-muted">${joinSep([readInLinked ? `${fmt(readInLinked)} implementing sections read` : "", pinnedInLinked ? `${plural(pinnedInLinked, "provision")} saved` : ""])}</span>` : `<span class="hm-signal-muted">${escapeHtml(auth?.frNote || "Federal statutory authority")}</span>`;
	return `
    <article class="hm-title-card hm-usc-card has-tier-bar" data-ref-tier="usc">
      <div class="hm-title-top">
        <span class="hm-title-kicker">${escapeHtml(c.code)}${SEP}<span class="hm-title-ag">U.S. Congress</span></span>
        ${statusPill}
      </div>
      <h3 class="hm-title-name"><a href="${escapeHtml(href)}">${escapeHtml(c.name)}</a></h3>
      ${c.summary ? `<p class="hm-title-desc">${escapeHtml(c.summary)}</p>` : ""}
      ${chainHtml}
      ${actsHtml}
      ${provsHtml}
      <div class="hm-title-foot">
        <div class="hm-title-signal-row">
          ${footprintSignal}
          <div class="hm-usc-foot-acts">
            ${ext ? `<a class="hm-inline-link" href="${escapeHtml(ext)}" target="_blank" rel="noopener noreferrer">Official U.S.C. ${icon("external")}</a>` : ""}
            <a class="hm-inline-link" href="${escapeHtml(href)}">Authority overview ${icon("chevronRight")}</a>
          </div>
        </div>
      </div>
    </article>`;
}
function renderUscTabHtml(allFrameworks, titles, recent, projects, status, usage, articles) {
	const uscList = allFrameworks.filter((c) => c.tier === "federal-statute");
	const deskId = state.activeDesk || "all";
	const filtered = deskId === "all" ? uscList : uscList.filter((c) => mapRawDeskToId(c.desk, (c.linked_titles || [])[0] ?? null) === deskId);
	const shown = filtered.length ? filtered : uscList;
	const ribbonHtml = deskFilterRibbonHtml(deskId, uscList);
	const linkedCfrSet = new Set(uscList.flatMap((c) => c.linked_titles || []));
	const relatedRules = (articles || []).filter((a) => a && a.category !== "enforcement" && (a.cfr_parts || []).some((p) => linkedCfrSet.has(p.title)));
	let totalActs = 0;
	let totalProvs = 0;
	for (const c of uscList) {
		const auth = authorityForCorpus(c);
		totalActs += auth?.acts.length || 1;
		totalProvs += auth?.provisions.length || 0;
	}
	const cards = shown.map((c) => uscDossierCardHtml(c, titles, recent, projects, usage, articles)).join("");
	return `
    <div class="pg-lead" data-ref-tier="usc">
      <div class="pg-lead-copy">
        <div class="pg-lead-kicker"><span class="ref-badge" data-ref-tier="usc">U.S.C. · STATUTORY AUTHORITY</span><span>Acts of Congress &amp; Regulatory Delegation</span></div>
        <h2 class="pg-lead-title">United States Code</h2>
        <p class="pg-lead-sub">Enabling federal statutes enacted by Congress, their major statutory mandates, and direct delegation chains into your installed CFR titles and active Federal Register rulemaking.</p>
      </div>
      <div class="pg-lead-acts">
        <a class="btn btn-sm" href="https://uscode.house.gov/" target="_blank" rel="noopener noreferrer">Official U.S.C. Portal ${icon("external")}</a>
        <button type="button" class="btn btn-sm btn-accent" data-hm-tab="cfr">Implementing CFR Desk ${icon("chevronRight")}</button>
      </div>
    </div>
    <div class="pg-kpi-strip" data-ref-tier="usc" aria-label="United States Code telemetry">
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Tracked Statutes</span>
        <span class="pg-kpi-val">${fmt(uscList.length)} U.S.C. titles</span>
        <span class="pg-kpi-sub">Linked to ${plural(linkedCfrSet.size || titles.length, "CFR title")}</span>
      </div>
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Principal Enacted Acts</span>
        <span class="pg-kpi-val">${fmt(totalActs)} organic acts</span>
        <span class="pg-kpi-sub">OSH Act, FLSA, RCRA, CAA, CWA, HMTA</span>
      </div>
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Enabling Mandates Mapped</span>
        <span class="pg-kpi-val">${fmt(totalProvs)} provisions</span>
        <span class="pg-kpi-sub">Deep-linked to implementing CFR parts</span>
      </div>
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Implementing Rulemaking</span>
        <span class="pg-kpi-val">${fmt(relatedRules.length)} FR dockets</span>
        <span class="pg-kpi-sub">${relatedRules[0] ? `Latest ${escapeHtml(shortDate(relatedRules[0].published_at))}` : "Synced via Federal Register API"}</span>
      </div>
    </div>
    <section class="hm-titles" id="hm-titles" data-snapshot-loaded="1" aria-label="United States Code statutory dossiers">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Statutory Delegation &amp; Implementing Regulations</h2>
          <span class="hm-sec-meta">${joinSep([plural(shown.length, "statutory title"), `${fmt(totalProvs)} mapped provisions`])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add CFR titles to expand statutory coverage ${icon("chevronRight")}</a>
      </div>
      ${ribbonHtml ? `<div class="hm-filters">${ribbonHtml}</div>` : ""}
      <div class="hm-title-grid is-usc-grid">${cards || "<p class=\"hm-muted\">No U.S.C. titles configured.</p>"}</div>
    </section>
    <section class="hm-usc-foundations" aria-label="Foundational federal administrative statutes">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Cross-Agency Rulemaking &amp; Administrative Law Bedrock</h2>
          <span class="hm-sec-meta">Title 5 &amp; Title 44 U.S.C. · Governing all federal agency rulemaking and enforcement</span>
        </div>
      </div>
      <div class="hm-found-grid">
        ${FOUNDATIONAL_ADMIN_STATUTES.map((st) => {
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
              ${safeHref ? `<a class="hm-inline-link hm-found-link" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">Read on uscode.house.gov ${icon("external")}</a>` : ""}
            </article>`;
	}).join("")}
      </div>
    </section>
    <section class="hm-news" id="hm-news" data-news-loaded="1" aria-label="Implementing Federal Register rulemaking">
      ${newsSectionHtml({ articles: relatedRules }, status, {
		limit: 3,
		heading: "Implementing Federal Register Rulemaking"
	})}
    </section>`;
}
function cfrCatalogDiscoveryHtml(titles) {
	const installedSet = new Set(titles.map((t) => t.title));
	const libRows = (state.navLibData?.titles || []).filter((r) => !r.reserved && !installedSet.has(r.title));
	const candidates = libRows.length ? libRows.slice(0, 6).map((r) => ({
		title: r.title,
		name: r.name || `Title ${r.title}`,
		agencies: (r.agencies || []).slice(0, 3),
		sections: Number(r.sections || 0),
		size_mb: Number(r.size_mb || 0),
		summary: r.summary || ""
	})) : FEATURED_CATALOG_FALLBACK.filter((f) => !installedSet.has(f.title)).slice(0, 6);
	if (!candidates.length) return "";
	return `
    <section class="hm-cfr-catalog" aria-label="Available in eCFR catalog">
      <div class="hm-sec-flag">
        <div class="hm-sec-head-left">
          <h2 class="hm-flag-label">Available in eCFR Catalog</h2>
          <span class="hm-sec-meta">Download full titles or individual parts for instant offline indexing</span>
        </div>
        <a class="hm-inline-link" href="#/library">Explore all 50 CFR titles ${icon("chevronRight")}</a>
      </div>
      <div class="hm-catalog-grid">
        ${candidates.map((c) => {
		const busy = Boolean(jobFor(c.title, "title"));
		return `
            <article class="hm-catalog-card" data-ref-tier="uninstalled">
              <div class="hm-title-top">
                <span class="hm-title-kicker">${c.title} CFR${c.agencies.length ? `${SEP}<span class="hm-title-ag">${c.agencies.map(escapeHtml).join(" · ")}</span>` : ""}</span>
                ${busy ? statPill("busy", "Queued", { bare: true }) : statPill("uninstalled", "Available", { bare: true })}
              </div>
              <h3 class="hm-catalog-name"><a href="#/library/${c.title}">${escapeHtml(c.name)}</a></h3>
              ${c.summary ? `<p class="hm-title-desc">${escapeHtml(c.summary)}</p>` : ""}
              <div class="hm-catalog-foot">
                <span class="hm-signal-muted">${joinSep([c.sections ? fmtSections(c.sections) : "", c.size_mb ? fmtMB(c.size_mb) : ""])}</span>
                <div class="hm-catalog-acts">
                  <a class="hm-inline-link" href="#/library/${c.title}">Parts</a>
                  <button type="button" class="btn btn-sm" data-hm-act="download-title" data-title="${c.title}"${busy ? " disabled" : ""}>${icon("download")} ${busy ? "Queued" : "Install"}</button>
                </div>
              </div>
            </article>`;
	}).join("")}
      </div>
    </section>`;
}
function renderCfrTabHtml(titles, recent, projects, totalSections, totalRead, status, usage, attention) {
	const cfrAttention = attention.filter((a) => a.tier === "cfr");
	const staleSet = new Set((state.navLibData && state.navLibData.titles || []).filter(isStale).map((t) => t.title));
	syncCorporaState();
	const deskId = state.activeDesk || "all";
	const cfrFrameworks = allSystemFrameworks(titles, titles, status).filter((c) => c.tier === "federal-reg");
	const filtered = deskId === "all" ? titles : titles.filter((t) => {
		return mapRawDeskToId(cfrFrameworks.find((c) => c.title_num === t.title)?.desk, t.title) === deskId;
	});
	const shown = filtered.length ? filtered : titles;
	const ribbonHtml = deskFilterRibbonHtml(deskId, cfrFrameworks);
	const installedSet = new Set(titles.map((t) => t.title));
	const partsExplored = Object.keys(usage.p).filter((k) => installedSet.has(parseInt(k.slice(0, k.indexOf("|")), 10))).length;
	const totalPinnedCfr = projects.reduce((sum, p) => sum + (p.sections || []).length, 0);
	const cfrWorkspaces = projects.filter((p) => (p.sections || []).length > 0).length;
	const libTitles = state.navLibData?.titles || [];
	const week = libTitles.length ? amendedWeek({ titles: libTitles }) : {
		newest: "",
		cut: "",
		recent: 0
	};
	const latestEdition = week.newest || titles.reduce((m, t) => t.edition && t.edition > m ? t.edition : m, "") || state.metaInfo.edition || "";
	const keyParts = [];
	for (const t of titles) {
		const curated = HOME_CONTENT[t.title]?.cards || [];
		for (const c of curated.slice(0, 2)) {
			keyParts.push({
				ti: t.title,
				part: c.part,
				kicker: `${t.title} CFR · ${c.kicker}`,
				title: c.title,
				desc: c.desc
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
        ${last.p ? `${SEP}<a href="${titleHref(last.ti, "part/" + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ""}
        ${last.ul ? `${SEP}<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ""}
      </div>
      <a class="hm-resume-title" href="${sectionLinkHref(last)}">${escapeHtml(last.l)} ${escapeHtml(last.h || "")}</a>
      <div class="hm-resume-acts">
        <a class="btn btn-sm btn-accent" href="${sectionLinkHref(last)}">Resume section ${icon("chevronRight")}</a>
        ${last.p ? `<a class="btn btn-sm" href="${titleHref(last.ti, "part/" + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)} Atlas</a>` : ""}
        ${last.p ? `<a class="hm-inline-link" href="${titleHref(last.ti, "part/" + encodeURIComponent(last.p) + "/full")}">Full Part text ${icon("chevronRight")}</a>` : ""}
        <button type="button" class="hm-inline-link" data-hm-act="resume-split" data-title="${last.ti}" data-section="${escapeHtml(last.id)}"${last.u ? ` data-unit="${escapeHtml(last.u)}"` : ""}>${icon("stack")} Side-by-side</button>
      </div>
      ${recent.length > 1 ? `
        <div class="hm-trail">
          <div class="hm-trail-head"><span class="hm-kicker">Recent CFR trail</span></div>
          <div class="hm-trail-list">
            ${recent.slice(1, 5).map((e) => `
              <a class="hm-trail-row" href="${sectionLinkHref(e)}">
                <span class="hm-tag" data-ref-tier="cfr">${e.ti} CFR</span>
                <span class="hm-row-num">${escapeHtml(String(e.l || e.id).replace(/^§\s*/, ""))}</span>
                <span class="hm-row-text">${escapeHtml(e.h || "")}</span>
                <span class="hm-row-val">${escapeHtml(timeAgo(e.t || 0))}</span>
              </a>`).join("")}
          </div>
        </div>` : ""}
    </div>` : `
    <div class="hm-cfr-study">
      <div class="hm-card-top"><span class="hm-kicker">CFR Reading Modes</span></div>
      <div class="hm-resume-title is-static">Clause-by-clause, full section, or full part</div>
      <p class="hm-muted">Open any installed title or high-frequency part to read unitized clauses with inline citation peeks, IBR consensus standards, and side-by-side comparison tabs.</p>
      ${titles[0] ? `<div class="hm-resume-acts"><a class="btn btn-sm btn-accent" href="${titleHref(titles[0].title)}">Open ${titles[0].title} CFR Start ${icon("chevronRight")}</a></div>` : ""}
    </div>`;
	const keyPartsBenchHtml = keyParts.length ? `
    <div class="hm-cfr-parts-bench">
      <div class="hm-panel-head">
        <h3 class="hm-panel-title">High-Frequency Regulatory Parts</h3>
        <span class="hm-count">${plural(keyParts.length, "core part")}</span>
      </div>
      <div class="hm-cfr-parts-list">
        ${keyParts.map((kp) => `
          <div class="hm-cfr-part-row">
            <div class="hm-cfr-part-main">
              <span class="hm-cfr-part-kicker" data-ref-tier="cfr">${escapeHtml(kp.kicker)}</span>
              <a class="hm-cfr-part-name" href="${titleHref(kp.ti, "part/" + encodeURIComponent(kp.part))}">${escapeHtml(kp.title)}</a>
              <span class="hm-cfr-part-desc">${escapeHtml(kp.desc)}</span>
            </div>
            <div class="hm-cfr-part-acts">
              <a class="hm-part-chip" href="${titleHref(kp.ti, "part/" + encodeURIComponent(kp.part))}"><span class="hm-part-num">Atlas</span></a>
              <a class="hm-part-chip" href="${titleHref(kp.ti, "part/" + encodeURIComponent(kp.part) + "/full")}"><span class="hm-part-num">Full</span></a>
            </div>
          </div>`).join("")}
      </div>
    </div>` : "";
	const cards = shown.map((t) => cfrCardHtml(t, staleSet, recent, projects, usage)).join("");
	return `
    ${activeTransfersHtml()}
    ${updatesBannerHtml(cfrAttention, titles)}
    <div class="pg-lead" data-ref-tier="cfr">
      <div class="pg-lead-copy">
        <div class="pg-lead-kicker"><span class="ref-badge" data-ref-tier="cfr">CFR · CODIFIED REGULATIONS</span><span>Local SQLite FTS5 &amp; Citation Graph</span></div>
        <h2 class="pg-lead-title">Code of Federal Regulations</h2>
        <p class="pg-lead-sub">Locally indexed eCFR editions with clause-by-clause unit reading, Part TOC Atlases, deterministic cross-reference graphs, and incorporation-by-reference (IBR) standards.</p>
      </div>
      <div class="pg-lead-acts">
        <button type="button" class="btn btn-sm" data-hm-act="check-updates">${icon("refresh")} Check eCFR</button>
        <a class="btn btn-sm btn-accent" href="#/library">${icon("download")} Manage Library ${icon("chevronRight")}</a>
      </div>
    </div>
    <div class="pg-kpi-strip" data-ref-tier="cfr" aria-label="CFR archive telemetry">
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Installed Editions</span>
        <span class="pg-kpi-val">${plural(titles.length, "CFR title")}</span>
        <span class="pg-kpi-sub">${fmt(totalSections)} offline sections indexed</span>
      </div>
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">eCFR Currency</span>
        <span class="pg-kpi-val">${cfrAttention.length > 0 ? `${plural(cfrAttention.length, "update")} ready` : latestEdition ? `Edition ${escapeHtml(shortDate(latestEdition))}` : "Verified current"}</span>
        <span class="pg-kpi-sub">${week.recent > 0 ? `${plural(week.recent, "title")} amended this week` : "Checked against eCFR Versioner"}</span>
      </div>
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Study Coverage</span>
        <span class="pg-kpi-val">${fmt(totalRead)} sections</span>
        <span class="pg-kpi-sub">${fmt(partsExplored)} regulatory parts explored</span>
      </div>
      <div class="pg-kpi-cell">
        <span class="pg-kpi-lbl">Workspace Citations</span>
        <span class="pg-kpi-val">${fmt(totalPinnedCfr)} pinned</span>
        <span class="pg-kpi-sub">${cfrWorkspaces ? `Across ${plural(cfrWorkspaces, "active workspace")}` : "Pin any section with ⌘D"}</span>
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
          <span class="hm-sec-meta">${joinSep([
		plural(shown.length, "title"),
		totalSections ? `${fmt(totalSections)} offline sections` : "",
		totalRead ? `${fmt(totalRead)} read` : ""
	])}</span>
        </div>
        <a class="hm-inline-link" href="#/library">Add or update CFR titles ${icon("chevronRight")}</a>
      </div>
      ${ribbonHtml ? `<div class="hm-filters">${ribbonHtml}</div>` : ""}
      ${cards ? `<div class="hm-title-grid">${cards}</div>` : "<p class=\"hm-muted\">No CFR titles installed yet. <a href=\"#/library\">Browse the Library</a> to download one.</p>"}
    </section>
    ${cfrCatalogDiscoveryHtml(titles)}`;
}
function frLeadSpotlightHtml(filteredArticles, allFrArticles) {
	if (!allFrArticles.length) return "";
	const lead = filteredArticles.find((a) => a.category === "rules") || filteredArticles[0] || allFrArticles[0];
	if (!lead) return "";
	const leadHref = articlePrimaryHref(lead);
	const docNum = frDocumentNumber(lead);
	const firstPart = lead.cfr_parts?.[0];
	const dateBadge = articleDateNoteHtml(lead);
	const docket = lead.docket_ids?.[0] || "";
	const takeawaysHtml = lead.takeaways && lead.takeaways.length ? `
    <dl class="hm-fr-takeaways">
      ${lead.takeaways.slice(0, 3).map((t) => `
        <div class="hm-fr-takeaway-row">
          <dt>${escapeHtml(t.label)}</dt>
          <dd>${linkifyNewsText(t.text)}</dd>
        </div>`).join("")}
    </dl>` : lead.action || lead.snippet ? `
    <p class="hm-fr-lead-dek">${linkifyNewsText(lead.action || lead.snippet || "")}</p>` : "";
	const datedFilings = allFrArticles.filter((a) => a.effective_on || a.comments_close_on || a.scheduled_on).slice(0, 4);
	const partMap = /* @__PURE__ */ new Map();
	for (const a of allFrArticles) for (const p of a.cfr_parts || []) {
		const k = `${p.title}|${p.part}`;
		const cur = partMap.get(k);
		if (cur) cur.count += 1;
		else partMap.set(k, {
			title: p.title,
			part: p.part,
			count: 1
		});
	}
	const sectionSet = [...new Set(allFrArticles.flatMap((a) => a.sections || []))].slice(0, 5);
	const touchedParts = [...partMap.values()].sort((a, b) => b.count - a.count).slice(0, 6);
	return `
    <div class="hm-fr-desk" aria-label="Lead rulemaking dispatch and deadlines watchlist">
      <article class="hm-fr-lead" data-ref-tier="fr">
        <div class="hm-fr-lead-top">
          <div class="hm-fr-lead-kicker-wrap">
            <span class="ref-badge" data-ref-tier="fr">${escapeHtml(frCategoryLabel(lead.category).toUpperCase())}</span>
            ${lead.citation ? `<span class="hm-fr-cite">${escapeHtml(lead.citation)}</span>` : ""}
            ${docket ? `<span class="hm-fr-docket">${escapeHtml(docket)}</span>` : ""}
          </div>
          <time class="hm-news-date">${escapeHtml(shortDate(lead.published_at))}</time>
        </div>
        <h3 class="hm-fr-lead-title"><a href="${leadHref}">${escapeHtml(lead.title)}</a></h3>
        ${dateBadge ? `<div class="hm-fr-lead-dates">${dateBadge}${lead.agency ? `<span class="hm-fr-agency">${escapeHtml(lead.agency)}</span>` : ""}</div>` : ""}
        ${takeawaysHtml}
        ${pulseChipsHtml(lead)}
        <div class="hm-fr-lead-acts">
          <a class="btn btn-sm btn-accent" href="${leadHref}">${docNum ? "Read in-app preamble" : "Open filing"} ${icon("chevronRight")}</a>
          ${firstPart ? `<a class="btn btn-sm" href="${newsPartHref(firstPart.title, firstPart.part)}">Open ${firstPart.title} CFR Part ${escapeHtml(String(firstPart.part))}</a>` : ""}
          <a class="hm-inline-link" href="#/news?cat=${encodeURIComponent(lead.category)}">All ${escapeHtml(frCategoryLabel(lead.category).toLowerCase())}s ${icon("chevronRight")}</a>
        </div>
      </article>
      <aside class="hm-fr-rail" aria-label="Effective dates, comment deadlines, and affected CFR provisions">
        <div class="hm-fr-rail-block">
          <div class="hm-trail-head">
            <span class="hm-kicker">Effective Dates &amp; Comment Deadlines</span>
            <a class="hm-inline-link" href="#/news">Calendar ${icon("chevronRight")}</a>
          </div>
          ${datedFilings.length ? `
            <div class="hm-fr-date-list">
              ${datedFilings.map((a) => {
		const isDeadline = Boolean(a.comments_close_on);
		const dateVal = a.comments_close_on || a.effective_on || a.scheduled_on || a.published_at;
		const kindLbl = a.comments_close_on ? "Comments close" : a.effective_on ? "Effective" : "Publishes";
		return `
                  <a class="hm-fr-date-row" href="${articlePrimaryHref(a)}">
                    <span class="hm-fr-date-pill${isDeadline ? " is-deadline" : " is-effective"}">${escapeHtml(kindLbl)} ${escapeHtml(shortDate(dateVal))}</span>
                    <span class="hm-fr-date-title">${escapeHtml(a.title)}</span>
                  </a>`;
	}).join("")}
            </div>` : "<p class=\"hm-muted\">Effective dates and comment deadlines from synced rules appear here.</p>"}
        </div>
        <div class="hm-fr-rail-block">
          <div class="hm-trail-head">
            <span class="hm-kicker">Affected CFR Parts &amp; Sections</span>
          </div>
          ${touchedParts.length || sectionSet.length ? `
            <div class="hm-news-chips">
              ${touchedParts.map((p) => {
		const ok = titleInstalled(p.title);
		return `<a class="citation-chip${ok ? "" : " is-dim"}" data-ref-tier="${ok ? "cfr" : "uninstalled"}" href="${newsPartHref(p.title, p.part)}">${p.title} CFR Part ${escapeHtml(String(p.part))}${p.count > 1 ? ` · ${p.count}` : ""}</a>`;
	}).join("")}
              ${sectionSet.map((s) => {
		const ok = titleInstalled(29);
		return `<a class="citation-chip${ok ? "" : " is-dim"}" data-ref-tier="${ok ? "cfr" : "uninstalled"}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`;
	}).join("")}
            </div>` : "<p class=\"hm-muted\">CFR citations extracted from Federal Register dockets appear here.</p>"}
        </div>
      </aside>
    </div>`;
}
function renderFrTabHtml(allFrameworks, projects, status, articles, attention, hasCachedNews) {
	const frAttention = attention.filter((a) => a.tier === "fr");
	const frArticles = (articles || []).filter((a) => a && a.category !== "enforcement");
	const activeCat = state.homeFrCat || "all";
	const filteredArticles = activeCat === "all" ? frArticles : frArticles.filter((a) => a.category === activeCat);
	const shownArticles = filteredArticles.length ? filteredArticles : frArticles;
	const frSyncing = Boolean(status?.syncing);
	const lastOk = status?.sources?.federal_register?.last_ok_at;
	const totalCached = Number(status?.articles || frArticles.length || 0);
	const frReason = frAttentionReason(status);
	const pill = frSyncing ? statPill("busy", "Syncing…") : frReason ? statPill("stale", "Sync due") : totalCached > 0 ? statPill("synced", lastOk ? `Synced ${timeAgo(Date.parse(lastOk))}` : "Synced") : statPill("partial", "Ready");
	const cats = [
		{
			cat: "all",
			label: "All Filings",
			desc: "Complete daily Federal Register stream",
			count: frArticles.length
		},
		{
			cat: "rules",
			label: "Final Rules",
			desc: "Codified CFR amendments & effective dates",
			count: frArticles.filter((a) => a.category === "rules").length
		},
		{
			cat: "rulemaking",
			label: "Proposed Rules",
			desc: "Open dockets & comment deadlines",
			count: frArticles.filter((a) => a.category === "rulemaking").length
		},
		{
			cat: "notices",
			label: "Notices",
			desc: "Agency guidance, meetings & dockets",
			count: frArticles.filter((a) => a.category === "notices").length
		},
		{
			cat: "public_inspection",
			label: "Public Inspection",
			desc: "Pre-publication filings scheduled next",
			count: frArticles.filter((a) => a.category === "public_inspection").length
		}
	];
	const activeCatMeta = cats.find((c) => c.cat === activeCat) || cats[0];
	const feedHeading = activeCat === "all" ? "Recent Federal Register Dispatches" : `${activeCatMeta.label} Dispatches`;
	const feedHtml = hasCachedNews || frArticles.length ? newsSectionHtml({ articles: shownArticles }, status, {
		limit: 6,
		heading: feedHeading
	}) : newsSkeletonHtml(feedHeading);
	return `
    ${frAttention.length ? updatesBannerHtml(frAttention, []) : ""}
    <div class="pg-lead" data-ref-tier="fr">
      <div class="pg-lead-copy">
        <div class="pg-lead-kicker"><span class="ref-badge" data-ref-tier="fr">FR · DAILY RULEMAKING</span><span>Federal Register API v1 &amp; In-App Preamble Reader</span></div>
        <h2 class="pg-lead-title">Federal Register</h2>
        <p class="pg-lead-sub">Daily Final Rules, Proposed Rules, Notices, and Public Inspection filings across configured federal agencies and installed CFR titles, with sanitized in-app preamble reading.</p>
      </div>
      <div class="pg-lead-acts">
        <span id="hm-news-pill">${pill}</span>
        ${status?.sync_enabled !== false ? `<button type="button" class="btn btn-sm btn-accent" data-hm-act="sync-fr"${frSyncing ? " disabled" : ""}>${icon("refresh")} ${frSyncing ? "Syncing…" : "Sync now"}</button>` : ""}
        <a class="btn btn-sm" href="#/news">Open Newsroom ${icon("chevronRight")}</a>
      </div>
    </div>
    <div class="hm-fr-cats" role="group" aria-label="Filter Federal Register categories">
      ${cats.map((c) => {
		const isOn = activeCat === c.cat;
		return `
          <button type="button" class="hm-fr-cat${isOn ? " is-active" : ""}" data-hm-fr-cat="${c.cat}" aria-pressed="${isOn}">
            <span class="hm-fr-cat-top">
              <span class="hm-fr-cat-label">${escapeHtml(c.label)}</span>
              <span class="hm-fr-cat-count">${fmt(c.count)}</span>
            </span>
            <span class="hm-fr-cat-meta">${escapeHtml(c.desc)}</span>
          </button>`;
	}).join("")}
    </div>
    ${frLeadSpotlightHtml(shownArticles, frArticles)}
    <section class="hm-news" id="hm-news" data-news-loaded="1" aria-label="Federal Register filings">
      ${feedHtml}
    </section>`;
}
function renderHomeTabBody(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage, attention, articles, hasCachedNews) {
	const tab = state.homeTab || "overview";
	if (tab === "usc") return renderUscTabHtml(allFrameworks, titles, recent, projects, status, usage, articles);
	if (tab === "cfr") return renderCfrTabHtml(titles, recent, projects, totalSections, totalRead, status, usage, attention);
	if (tab === "fr") return renderFrTabHtml(allFrameworks, projects, status, articles, attention, hasCachedNews);
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
function patchHomeDynamicBands(titles, status, articles = cachedNewsArticles(), replaceBody = false) {
	const usage = loadUsage();
	const recent = recentSectionsFor(usage, new Set(titles.map((t) => t.title)));
	const projects = loadProjects();
	const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
	const totalRead = titles.reduce((a, t) => a + readCountForTitle(t.title, usage), 0);
	const allFrameworks = allSystemFrameworks(titles, titles, status);
	const attention = collectAttentionItems(titles, status);
	const tabEl = document.getElementById("hm-tabs");
	if (tabEl) tabEl.outerHTML = homeTabsHtml(allFrameworks, titles, status, attention, totalSections, totalRead, projects.length);
	const activeTab = state.homeTab || "overview";
	const tabBody = document.getElementById("hm-tab-body");
	if (tabBody) tabBody.setAttribute("aria-labelledby", `hm-tab-${activeTab}`);
	if (replaceBody || activeTab !== "overview" || !document.getElementById("hm-systems")) {
		if (tabBody) {
			const prevSnapLoaded = document.getElementById("hm-titles")?.dataset.snapshotLoaded;
			const prevNewsLoaded = document.getElementById("hm-news")?.dataset.newsLoaded;
			tabBody.innerHTML = renderHomeTabBody(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage, attention, articles, true);
			const nextTitles = document.getElementById("hm-titles");
			if (nextTitles && prevSnapLoaded) nextTitles.dataset.snapshotLoaded = prevSnapLoaded;
			const nextNews = document.getElementById("hm-news");
			if (nextNews && prevNewsLoaded) nextNews.dataset.newsLoaded = prevNewsLoaded;
		}
		return;
	}
	const sysEl = document.getElementById("hm-systems");
	if (sysEl) sysEl.outerHTML = systemsStripHtml(allFrameworks, titles, status, attention, articles);
	const updEl = document.getElementById("hm-updates");
	if (updEl) updEl.outerHTML = updatesBannerHtml(attention, titles);
	const box = document.getElementById("hm-titles");
	if (box) {
		const loaded = box.dataset.snapshotLoaded;
		box.outerHTML = titlesBandHtml(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage);
		const nextBox = document.getElementById("hm-titles");
		if (nextBox && loaded) nextBox.dataset.snapshotLoaded = loaded;
	}
}
async function hydrateHome(seq) {
	const titlesPromise = getJSON("/api/titles/snapshot").then((snap) => {
		if (seq !== state.routeSeq) return;
		if (snap && Array.isArray(snap.titles)) {
			state.homeSnapshot = snap;
			patchHomeDynamicBands(snap.titles, cachedNewsStatus());
		}
	}).catch(() => {}).finally(() => {
		const el = document.getElementById("hm-titles");
		if (el && seq === state.routeSeq) el.dataset.snapshotLoaded = "1";
	});
	const newsPromise = Promise.all([getJSON("/api/news?limit=12"), getJSON("/api/news/status")]).then(([data, status]) => {
		if (seq !== state.routeSeq) return;
		const totalArticles = Number(data?.total ?? data?.articles?.length ?? 0);
		const enrichedStatus = status ? {
			...status,
			articles: status.articles || totalArticles
		} : null;
		if (enrichedStatus) {
			state.navNewsStatus = enrichedStatus;
			lsSetJSON(HOME_STATUS_CACHE, {
				t: Date.now(),
				data: enrichedStatus
			});
			updateRailBadge();
		}
		const freshArticles = Array.isArray(data?.articles) ? data.articles : [];
		if (freshArticles.length) lsSetJSON(HOME_NEWS_CACHE, {
			t: Date.now(),
			data: {
				articles: freshArticles.slice(0, 30),
				total: data.total,
				offset: 0
			}
		});
		const box = document.getElementById("hm-news");
		if (box && (state.homeTab || "overview") === "overview") box.innerHTML = newsSectionHtml(data, enrichedStatus);
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), enrichedStatus, freshArticles);
		if (enrichedStatus?.syncing) watchHomeNewsSync(seq);
	}).catch(() => {
		if (seq !== state.routeSeq) return;
		const box = document.getElementById("hm-news");
		if (box) box.innerHTML = newsSectionHtml({ articles: [] }, null);
	}).finally(() => {
		const el = document.getElementById("hm-news");
		if (el && seq === state.routeSeq) el.dataset.newsLoaded = "1";
	});
	const libPromise = ensureNavLibrary().then(() => {
		if (seq !== state.routeSeq) return;
		updateRailBadge();
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), cachedNewsStatus());
	}).catch(() => {});
	const constPromise = fetchConstitution().then((c) => {
		if (seq !== state.routeSeq) return;
		const card = document.getElementById("hm-sys-const");
		if (card) card.outerHTML = constSysCardHtml(c);
	}).catch(() => {});
	await Promise.allSettled([
		titlesPromise,
		newsPromise,
		libPromise,
		constPromise
	]);
}
function renderHomeScreen({ enter = true } = {}) {
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	document.title = "Home · FRAMEWORK";
	setViewHead("");
	const usage = loadUsage();
	const titles = installedFallbackList();
	const recent = recentSectionsFor(usage, new Set(titles.map((t) => t.title)));
	const projects = loadProjects();
	const totalSections = titles.reduce((a, t) => a + Number(t.section_count || 0), 0);
	const totalRead = titles.reduce((a, t) => a + readCountForTitle(t.title, usage), 0);
	const cachedNews = lsGetJSON(HOME_NEWS_CACHE);
	const status = cachedNewsStatus();
	const allFrameworks = allSystemFrameworks(titles, titles, status);
	const attention = collectAttentionItems(titles, status);
	const activeTab = state.homeTab || "overview";
	const sub = joinSep([
		"Federal codes, statutes & daily rulemaking",
		totalRead ? `${fmt(totalRead)} ${totalRead === 1 ? "section" : "sections"} studied` : "",
		projects.length ? escapeHtml(plural(projects.length, "active workspace")) : ""
	]);
	const scrollTop = dom.main.scrollTop;
	const edText = state.metaInfo.edition ? `Edition ${escapeHtml(shortDate(state.metaInfo.edition))}` : "Local Archive";
	dom.view.innerHTML = `
    <div class="hm pg">
      ${pageMastheadHtml({
		folioLeftHtml: `<span class="pg-folio-brand">FRAMEWORK</span>${SEP}<span>${edText}</span>`,
		folioRightHtml: `<span>${escapeHtml(plural(allFrameworks.length, "federal framework"))}</span>${SEP}<span>U.S.C. · CFR · FR</span>`,
		title: "Home",
		subHtml: sub,
		actionsHtml: `<button type="button" class="btn btn-sm" data-hm-act="new-workspace">${icon("plus")} New workspace</button>
            <a class="btn btn-sm" href="#/library">${icon("download")} Library</a>`,
		tabsHtml: homeTabsHtml(allFrameworks, titles, status, attention, totalSections, totalRead, projects.length)
	})}
      <div id="hm-tab-body" role="tabpanel" aria-labelledby="hm-tab-${activeTab}">
        ${renderHomeTabBody(titles, allFrameworks, recent, projects, totalSections, totalRead, status, usage, attention, cachedNews?.data?.articles || [], Boolean(cachedNews && cachedNews.data))}
      </div>
    </div>`;
	if (enter) enterView();
	else dom.main.scrollTop = scrollTop;
	hydrateHome(state.routeSeq);
}
function watchHomeNewsSync(seq) {
	const token = ++state.homeSyncToken;
	const started = Date.now();
	const tick = async () => {
		if (seq !== state.routeSeq || token !== state.homeSyncToken || Date.now() - started > 6e4) return;
		let status;
		try {
			status = await getJSON("/api/news/status");
		} catch {
			return;
		}
		if (seq !== state.routeSeq || token !== state.homeSyncToken) return;
		if (status.syncing) {
			setTimeout(tick, 2e3);
			return;
		}
		let data = { articles: [] };
		try {
			data = await getJSON("/api/news?limit=12");
		} catch {}
		if (seq !== state.routeSeq || token !== state.homeSyncToken) return;
		const totalArticles = Number(data?.total ?? data?.articles?.length ?? 0);
		const enrichedStatus = {
			...status,
			articles: status.articles || totalArticles
		};
		state.navNewsStatus = enrichedStatus;
		lsSetJSON(HOME_STATUS_CACHE, {
			t: Date.now(),
			data: enrichedStatus
		});
		const freshArticles = Array.isArray(data?.articles) ? data.articles : [];
		if (freshArticles.length) lsSetJSON(HOME_NEWS_CACHE, {
			t: Date.now(),
			data: {
				articles: freshArticles.slice(0, 30),
				total: data.total,
				offset: 0
			}
		});
		updateRailBadge();
		const box = document.getElementById("hm-news");
		if (box && (state.homeTab || "overview") === "overview") box.innerHTML = newsSectionHtml(data, enrichedStatus);
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), enrichedStatus, freshArticles);
		const errReason = Object.values(enrichedStatus.sources || {}).find((s) => s && s.enabled && s.last_error)?.last_error;
		if (errReason) showToast(errReason, 5e3);
		else showToast("Federal Register updated");
	};
	setTimeout(tick, 2e3);
}
async function syncFrOnHome(force) {
	const seq = state.routeSeq;
	const prev = cachedNewsStatus();
	const optimistic = {
		sync_enabled: prev?.sync_enabled ?? true,
		syncing: true,
		dol_configured: prev?.dol_configured ?? false,
		articles: prev?.articles,
		sources: prev?.sources || {}
	};
	state.navNewsStatus = optimistic;
	patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), optimistic);
	const pillSlot = document.getElementById("hm-news-pill");
	if (pillSlot) pillSlot.innerHTML = newsStatusPillHtml(optimistic);
	try {
		const res = await getJSON("/api/news/refresh", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ force })
		});
		if (res && Array.isArray(res.queued) && res.queued.length === 0) {
			await hydrateHome(seq);
			return false;
		}
		watchHomeNewsSync(seq);
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Sync failed";
		if (/already running/i.test(msg)) {
			watchHomeNewsSync(seq);
			return true;
		}
		state.navNewsStatus = prev;
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), prev);
		throw err;
	}
}
function refreshHomeIfActive() {
	if (routeTarget() === "overview" && dom.view.querySelector(".hm")) renderHomeScreen({ enter: false });
}
function activateHomeTab(nextTab, focusTab = false) {
	if (!HOME_TAB_ORDER.includes(nextTab)) return;
	if (nextTab !== state.homeTab) {
		state.homeTab = nextTab;
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), cachedNewsStatus(), cachedNewsArticles(), true);
	}
	if (focusTab) document.getElementById(`hm-tab-${nextTab}`)?.focus();
}
onView("keydown", (ev) => {
	const e = ev;
	const tabBtn = e.target?.closest("#hm-tabs [data-hm-tab]");
	if (!tabBtn) return;
	const cur = tabBtn.dataset.hmTab || "overview";
	const idx = HOME_TAB_ORDER.indexOf(cur);
	if (idx < 0) return;
	let nextIdx = -1;
	if (e.key === "ArrowRight") nextIdx = (idx + 1) % HOME_TAB_ORDER.length;
	else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + HOME_TAB_ORDER.length) % HOME_TAB_ORDER.length;
	else if (e.key === "Home") nextIdx = 0;
	else if (e.key === "End") nextIdx = HOME_TAB_ORDER.length - 1;
	if (nextIdx >= 0) {
		e.preventDefault();
		activateHomeTab(HOME_TAB_ORDER[nextIdx], true);
	}
});
onView("click", async (e) => {
	if (!dom.view.querySelector(".hm")) return;
	const t = e.target;
	const tabBtn = t?.closest("[data-hm-tab]");
	if (tabBtn) {
		activateHomeTab(tabBtn.dataset.hmTab || "overview", false);
		return;
	}
	const frCatBtn = t?.closest("[data-hm-fr-cat]");
	if (frCatBtn) {
		const nextCat = frCatBtn.dataset.hmFrCat || "all";
		state.homeFrCat = state.homeFrCat === nextCat && nextCat !== "all" ? "all" : nextCat;
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), cachedNewsStatus(), cachedNewsArticles(), true);
		return;
	}
	const tierBtn = t?.closest("[data-hm-tier]");
	if (tierBtn) {
		const nextTier = tierBtn.dataset.hmTier || "all";
		state.homeTierFilter = state.homeTierFilter === nextTier && nextTier !== "all" ? "all" : nextTier;
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), cachedNewsStatus());
		return;
	}
	const deskBtn = t?.closest("[data-desk]");
	if (deskBtn) {
		setActiveDesk(deskBtn.dataset.desk || "all");
		patchHomeDynamicBands(state.homeSnapshot?.titles || installedFallbackList(), cachedNewsStatus());
		return;
	}
	const actEl = t?.closest("[data-hm-act]");
	if (!actEl) return;
	const act = actEl.dataset.hmAct;
	if (act === "new-workspace") startNewWorkspace();
	else if (act === "toggle-history") {
		state.homeHistoryExpanded = !state.homeHistoryExpanded;
		renderHomeScreen({ enter: false });
	} else if (act === "resume-split") {
		const titleNum = Number(actEl.dataset.title) || state.currentTitle;
		const secId = actEl.dataset.section || "";
		const unit = actEl.dataset.unit || null;
		if (secId) emit("split:open", {
			title: titleNum,
			sectionId: secId,
			unit,
			pushHistory: true
		});
	} else if (act === "restore-tabgroup") {
		const projId = actEl.dataset.projId;
		const groupId = actEl.dataset.groupId;
		const grp = loadProjects().find((p) => p.id === projId)?.tab_groups?.find((g) => g.id === groupId);
		if (grp) restoreTabGroup(grp);
	} else if (act === "open-contents") {
		const titleNum = Number(actEl.dataset.title);
		if (titleNum && titleNum !== state.currentTitle) await switchTitle(titleNum);
		window.location.hash = `#/title/${titleNum || state.currentTitle}/`;
	} else if (act === "download-title") {
		const titleNum = Number(actEl.dataset.title);
		if (!titleNum) return;
		actEl.disabled = true;
		try {
			const job = await getJSON("/api/library/download", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: titleNum,
					kind: "section"
				})
			});
			setJobs(await getJSON("/api/library/jobs"));
			pollJobsIfActive();
			showToast(job?.label ? `Queued download for ${job.label}` : `Queued download for Title ${titleNum}`);
			refreshHomeIfActive();
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Download failed", 5e3);
			actEl.disabled = false;
		}
	} else if (act === "update-title") {
		const titleNum = Number(actEl.dataset.title);
		if (!titleNum) return;
		actEl.disabled = true;
		try {
			const job = await getJSON(`/api/library/${titleNum}/update`, { method: "POST" });
			setJobs(await getJSON("/api/library/jobs"));
			pollJobsIfActive();
			showToast(job?.label ? `Queued update for ${job.label}` : `Queued update for Title ${titleNum}`);
			refreshHomeIfActive();
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Update failed", 5e3);
			actEl.disabled = false;
		}
	} else if (act === "update-all" || act === "update-all-attention") {
		actEl.disabled = true;
		try {
			const attention = collectAttentionItems(state.homeSnapshot?.titles || installedFallbackList(), cachedNewsStatus());
			const hasCfr = attention.some((a) => a.tier === "cfr");
			const hasFr = attention.some((a) => a.tier === "fr");
			if (hasCfr || act === "update-all") await queueBatch("/api/library/update-all", null, "Every installed title is already current");
			if (hasFr && act === "update-all-attention") await syncFrOnHome(true);
			refreshHomeIfActive();
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Update failed", 5e3);
			actEl.disabled = false;
		}
	} else if (act === "check-updates") {
		const btn = actEl;
		const prevHtml = btn.innerHTML;
		btn.disabled = true;
		btn.textContent = "Checking…";
		try {
			const [, newsStatus] = await Promise.all([ensureNavLibrary(true), getJSON("/api/news/status").catch(() => cachedNewsStatus())]);
			if (newsStatus) {
				state.navNewsStatus = newsStatus;
				lsSetJSON(HOME_STATUS_CACHE, {
					t: Date.now(),
					data: newsStatus
				});
			}
			updateRailBadge();
			const titles = state.homeSnapshot?.titles || installedFallbackList();
			patchHomeDynamicBands(titles, newsStatus || cachedNewsStatus());
			const attention = collectAttentionItems(titles, newsStatus || cachedNewsStatus());
			if (newsStatus?.sync_enabled && !newsStatus.syncing && frAttentionReason(newsStatus)) await syncFrOnHome(false).catch(() => false);
			showToast(attention.length ? `${plural(attention.length, "update")} available` : "All frameworks are up to date");
		} catch {
			showToast("Couldn’t reach update services right now", 4e3);
		} finally {
			if (btn.isConnected) {
				btn.disabled = false;
				btn.innerHTML = prevHtml;
			}
		}
	} else if (act === "sync-fr") {
		actEl.disabled = true;
		try {
			showToast(await syncFrOnHome(true) ? "Syncing Federal Register…" : "Federal Register is already up to date");
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Sync failed", 4e3);
			if (actEl.isConnected) actEl.disabled = false;
		}
	}
});
on("projects:changed", ({ quiet }) => {
	if (!quiet) refreshHomeIfActive();
});
on("env:saved", () => refreshHomeIfActive());
on("jobs:updated", () => {
	if (routeTarget() === "overview" && dom.view.querySelector(".hm")) {
		const existing = dom.view.querySelector(".hm-transfer");
		const html = activeTransfersHtml();
		if (Boolean(existing) !== Boolean(html)) refreshHomeIfActive();
	}
});
on("jobs:finished", () => {
	refreshHomeIfActive();
});
// src/views/help.ts
var HELP_LOGOS = {
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
var FR_RSS_FEEDS = [{
	label: "OSHA Published Documents RSS",
	desc: "Final Rules, Proposed Rules, and Notices from the Federal Register.",
	url: "https://www.federalregister.gov/api/v1/documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration"
}, {
	label: "OSHA Public Inspection RSS",
	desc: "Pre-publication filings scheduled to appear in tomorrow’s Federal Register.",
	url: "https://www.federalregister.gov/api/v1/public-inspection-documents.rss?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration"
}];
async function loadHelp() {
	const seq = state.routeSeq;
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	document.title = "Connections & API Keys · FRAMEWORK";
	if (!state.navEnvStatus) {
		dom.view.innerHTML = skeletonHtml("cards", "Loading setup guide…");
		enterView();
	}
	try {
		const [env, newsSt] = await Promise.all([getJSON("/api/settings/env"), getJSON("/api/news/status").catch(() => null)]);
		if (seq !== state.routeSeq) return;
		state.navEnvStatus = env;
		if (newsSt) state.navNewsStatus = newsSt;
		renderHelp(env, { enter: true });
	} catch {
		if (seq !== state.routeSeq) return;
		renderHelp(state.navEnvStatus || {
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
	const syncOn = keys.NEWS_SYNC ? Boolean(keys.NEWS_SYNC.value) : true;
	const retDays = Number(keys.NEWS_RETENTION_DAYS ? keys.NEWS_RETENTION_DAYS.value : 365);
	const titleCount = state.installedTitles.length;
	const titlesWord = `${titleCount} ${titleCount === 1 ? "title" : "titles"}`;
	const chip = (target, chipState, label) => `
    <button type="button" class="help-status-chip" data-help-jump="${target}">
      <span class="stat-dot is-${chipState}" aria-hidden="true"></span>${escapeHtml(label)}</button>`;
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
on("env:saved", () => {
	if (state.activeRoute === "/help" || state.activeRoute === "/help/") renderHelp(state.navEnvStatus);
});
// src/views/library_usc.ts
var USC_JOB_BASE = 1e3;
var uscLibHref = (title) => `#/library/usc${title ? `/${title}` : ""}`;
var uscSectionHref = (title, id) => `#/usc/${title}/section/${encodeURIComponent(id)}`;
var uscNodeLibHref = (title, id) => `#/usc/${title}/node/${encodeURIComponent(id)}`;
function uscJobFor(title) {
	return [state.jobs.current, ...state.jobs.queued].filter(Boolean).find((j) => j.title === USC_JOB_BASE + title);
}
function uscStatus(t) {
	if (t.reserved) return {
		state: "uninstalled",
		text: "Reserved"
	};
	const j = uscJobFor(t.title);
	if (j) return {
		state: "busy",
		text: j.state === "running" ? j.kind === "usc-update" ? "Updating" : "Downloading" : "Queued"
	};
	const inst = t.installed;
	if (!inst) return {
		state: "uninstalled",
		text: "Not installed"
	};
	if (inst.stale) return {
		state: "stale",
		text: "Update available",
		title: "The OLRC has a newer release point"
	};
	return {
		state: "synced",
		text: "Installed",
		title: inst.release_point ? `Release point ${inst.release_point}` : ""
	};
}
function uscStatusPill(t, bare = false) {
	const s = uscStatus(t);
	return statPill(s.state, s.text, {
		bare,
		title: s.title
	});
}
function uscAct(act, label, title, cls = "") {
	return `<button type="button" class="lib-act${cls ? " " + cls : ""}" data-act="${act}" data-usc-title="${title}">${label}</button>`;
}
/** Hover actions on a U.S. Code brief or row. */
function uscActions(t) {
	if (t.reserved || uscJobFor(t.title)) return "";
	if (!t.installed) return uscAct("usc-download", `${icon("download")}Download`, t.title, "is-primary");
	return `<a class="lib-act" href="${uscLibHref(t.title)}">Open</a>` + (t.installed.stale ? uscAct("usc-update", "Update", t.title) : "") + uscAct("usc-remove", "Remove", t.title, "is-danger");
}
/** CFR chips: installed titles open their start page, others their Library page. */
function cfrChipsHtml(titles, installedCfr) {
	return titles.map((n) => installedCfr.has(n) ? `<a class="citation-chip" data-ref-tier="cfr" href="#/title/${n}/">${n} CFR</a>` : `<a class="citation-chip is-dim" data-ref-tier="uninstalled" href="#/library/cfr/${n}" title="Not installed">${n} CFR</a>`).join("");
}
/** U.S. Code chips for a CFR title ("Authorized by"). */
function uscChipsHtml(titles) {
	return titles.map((u) => `<a class="citation-chip${u.installed ? "" : " is-dim"}" data-ref-tier="${u.installed ? "usc" : "uninstalled"}" href="${uscLibHref(u.title)}"${u.installed ? "" : " title=\"Not installed\""}>${uscCite(u.title)}</a>`).join("");
}
function authorizedBy(cfrTitle, cat) {
	return (cat?.titles || []).filter((u) => !u.reserved && u.cfr.includes(cfrTitle));
}
function uscStory(t, installedCfr) {
	const inst = t.installed;
	const kicker = `${uscCite(t.title)}${t.positive_law ? `${SEP}Positive law` : ""}`;
	const name = escapeHtml(t.name);
	const headline = t.reserved ? name : `<a href="${uscLibHref(t.title)}">${name}</a>`;
	const dateline = joinSep([
		inst?.release_point ? `Release ${escapeHtml(inst.release_point)}` : "",
		inst ? fmtSections(inst.section_count) : "",
		inst && inst.bytes ? `${fmtBytes(inst.bytes)} on disk` : "",
		!inst && !t.reserved ? "Installs the whole title" : ""
	]);
	const acts = uscActions(t);
	const hay = `${isUscAppendix(t.title) ? `${uscCite(t.title)} appendix app.` : t.title} usc u.s.c. title ${t.name} ${t.desk} ${t.positive_law ? "positive law" : ""} ${t.cfr.map((n) => `${n} cfr`).join(" ")}`.toLowerCase();
	return `<article class="lib-story has-tier-bar${t.reserved ? " is-dim" : ""}" data-ref-tier="usc" data-hay="${escapeHtml(hay)}">
    <div class="story-top"><span class="story-kicker">${kicker}</span>${uscStatusPill(t, !inst)}</div>
    <h3 class="story-name">${headline}</h3>
    ${t.cfr.length ? `<div class="story-links"><span class="story-links-lbl">Implemented by</span>${cfrChipsHtml(t.cfr, installedCfr)}</div>` : ""}
    <div class="story-foot"><span class="story-date">${dateline}</span>${acts ? `<div class="story-actions">${acts}</div>` : ""}</div>
  </article>`;
}
function uscTitleList(cat, installedCfr) {
	const live = cat.titles.filter((t) => !t.reserved);
	const reserved = cat.titles.filter((t) => t.reserved);
	const desk = (name, ts) => `<section class="lib-desk" aria-label="${escapeHtml(name)}">
      <header class="lib-desk-header"><h3 class="lib-desk-name">${escapeHtml(name)}</h3><span class="lib-desk-count">${plural(ts.length, "title")}</span></header>
      <div class="lib-stories">${ts.map((t) => uscStory(t, installedCfr)).join("")}</div></section>`;
	const main = live.filter((t) => !isUscAppendix(t.title));
	const appendices = live.filter((t) => isUscAppendix(t.title));
	const names = [...cat.desks];
	for (const t of main) if (!names.includes(t.desk)) names.push(t.desk);
	return names.map((n) => {
		const ts = main.filter((t) => t.desk === n);
		return ts.length ? desk(n, ts) : "";
	}).join("") + (appendices.length ? desk("Appendices", appendices) : "") + (reserved.length ? desk("Reserved", reserved) : "");
}
function uscStats(cat) {
	const live = (cat?.titles || []).filter((t) => !t.reserved);
	const inst = live.filter((t) => t.installed);
	return {
		live,
		/** Titles 1–54 only: the "of 53" counts leave the four appendix titles out. */
		main: live.filter((t) => !isUscAppendix(t.title)),
		inst,
		stale: inst.filter((t) => t.installed.stale),
		sections: inst.reduce((a, t) => a + (t.installed?.section_count || 0), 0),
		notes: inst.reduce((a, t) => a + (t.installed?.note_count || 0), 0),
		bytes: inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0)
	};
}
function releaseLine(cat) {
	const r = cat?.release;
	if (!r) return "Release point not checked yet";
	return `Release point ${r.release_point}${r.current_through ? `, current through ${r.current_through}` : ""}`;
}
function uscCheckBusy() {
	return state.jobs.current?.kind === "usc-update" || state.jobs.queued.some((j) => j.kind === "usc-update");
}
/** The U.S. Code tab: lead card, KPI strip, filter, and every title under its desk. */
function uscTabHtml(cat, filter, installedCfr) {
	if (!cat) return `<div class="empty-state"><h2>The U.S. Code catalog didn’t load</h2><p>Reload the page to try again.</p></div>`;
	const s = uscStats(cat);
	const updateAll = s.stale.length && !uscCheckBusy() ? `<button type="button" class="btn btn-accent" data-act="usc-update-all">${icon("download")} Update ${plural(s.stale.length, "title")}</button>` : "";
	return `
    ${tabLeadHtml({
		refTier: "usc",
		kickerHtml: `<span class="ref-badge" data-ref-tier="usc">U.S.C. · STATUTES</span><span>Office of the Law Revision Counsel · USLM XML</span>`,
		title: "United States Code",
		subHtml: `${escapeHtml(releaseLine(cat))}. Each title installs whole and updates when the OLRC publishes a new release point. Notes stay apart from the statutory text.`,
		actionsHtml: `<button type="button" class="btn" data-act="usc-check">${icon("refresh")} Check for updates</button>${updateAll}`
	})}
    ${kpiStripHtml([
		{
			labelHtml: "Installed",
			valueHtml: `${s.inst.length} <span class="pg-kpi-of">of ${s.main.length}</span>`,
			subHtml: s.bytes ? `${escapeHtml(fmtBytes(s.bytes))} on disk` : "No titles yet"
		},
		{
			labelHtml: "Sections",
			valueHtml: escapeHtml(fmt(s.sections)),
			subHtml: s.sections ? `${escapeHtml(fmt(s.notes))} notes kept apart` : "Install a title to read it"
		},
		{
			labelHtml: "Positive law",
			valueHtml: `${s.inst.filter((t) => t.positive_law).length} installed`,
			subHtml: `${s.live.filter((t) => t.positive_law).length} titles are legal evidence of the law`
		},
		s.stale.length ? {
			labelHtml: "<span class=\"stat-dot is-stale\" aria-hidden=\"true\"></span>Release point",
			valueHtml: `${s.stale.length} behind`,
			subHtml: escapeHtml(cat.release?.release_point || ""),
			alert: true
		} : {
			labelHtml: "Release point",
			valueHtml: escapeHtml(cat.release?.release_point || "Not checked"),
			subHtml: s.inst.length ? cat.release ? "Every installed title is current" : "Use Check for updates" : "Nothing installed yet"
		}
	], {
		label: "U.S. Code at a glance",
		refTier: "usc"
	})}
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter titles, topics or CFR titles…" aria-label="Filter U.S. Code titles" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}">
    </div>
    <div class="lib-list" id="lib-list">${uscTitleList(cat, installedCfr)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>No title matches. Try a topic (“labor”) or a CFR title (“29 cfr”).</div>`;
}
function leafStats(n) {
	if (n.t === "section") return {
		total: 1,
		inactive: n.s ? 1 : 0,
		first: n.s ? null : n.id
	};
	let total = 0, inactive = 0, first = null;
	for (const c of n.c || []) {
		const s = leafStats(c);
		total += s.total;
		inactive += s.inactive;
		first = first || s.first;
	}
	return {
		total,
		inactive,
		first
	};
}
function uscChaptersHtml(title, tree) {
	if (!tree) return "";
	return (tree.c || []).map((n) => {
		const s = leafStats(n);
		const num = n.t === "section" ? (n.l || n.id).replace(/^§\s*/, "§ ") : n.l || n.id;
		const name = n.d || "";
		const dim = s.total > 0 && s.inactive === s.total;
		const status = s.total ? `${escapeHtml(fmtSections(s.total - s.inactive) || "No active sections")}${s.inactive ? `<span class="lib-row-note">${s.inactive} repealed or omitted</span>` : ""}` : "";
		const open = s.first ? `<a class="lib-act" href="${uscSectionHref(title, s.first)}">Read</a>` : "";
		const rowHref = n.t === "section" ? uscSectionHref(title, n.id) : uscNodeLibHref(title, n.id);
		return `<div class="lib-row${dim ? " is-dim" : ""}${open ? " has-actions" : ""}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}">
      <a class="lib-main" href="${rowHref}"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></a>
      <span class="lib-status">${status}</span><span class="lib-actions">${open}</span></div>`;
	}).join("");
}
function uscDetailBodyHtml(t, tree, installedCfr) {
	const inst = t.installed;
	const implemented = t.cfr.length ? `<section class="lib-links-band" aria-label="Implementing regulations">
        <span class="story-links-lbl">Implemented by</span>${cfrChipsHtml(t.cfr, installedCfr)}
      </section>` : "";
	if (!inst) return `${implemented}
      <div class="empty-state"><h2>${escapeHtml(`${uscCite(t.title)} isn’t installed`)}</h2>
        <p>Download the whole title from the Office of the Law Revision Counsel to see its chapters and read its sections offline.</p>
        ${t.reserved || uscJobFor(t.title) ? "" : `<p><button type="button" class="btn btn-accent" data-act="usc-download" data-usc-title="${t.title}">${icon("download")} Download Title ${uscTitleLabel(t.title)}</button></p>`}
      </div>`;
	return `${implemented}
    <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter chapters…" aria-label="Filter chapters" autocomplete="off" spellcheck="false">
    <div class="lib-list" id="lib-list">${tree ? uscChaptersHtml(t.title, tree) : "<p class=\"lib-none\">Couldn’t read this title’s contents.</p>"}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>Nothing matches.</div>`;
}
function uscDetailSub(t) {
	const inst = t.installed;
	if (!inst) return joinSep([
		"Not installed",
		t.positive_law ? "Positive law" : "",
		escapeHtml(t.desk)
	]);
	return joinSep([
		inst.stale ? "Update available" : "Installed",
		inst.release_point ? `Release ${escapeHtml(inst.release_point)}` : "",
		fmtSections(inst.section_count),
		inst.note_count ? `${fmt(inst.note_count)} notes` : "",
		t.positive_law ? "Positive law" : ""
	]);
}
function uscDetailActions(t, tree) {
	if (uscJobFor(t.title)) return uscStatusPill(t);
	if (t.reserved) return "";
	if (!t.installed) return `<button type="button" class="btn btn-accent" data-act="usc-download" data-usc-title="${t.title}">${icon("download")} Download title</button>`;
	const first = tree ? leafStats(tree).first : null;
	return `<a class="btn btn-accent" href="#/usc/${t.title}/">${icon("book")} Open in reader</a>` + (first ? `<a class="btn" href="${uscSectionHref(t.title, first)}">First section</a>` : "") + (t.installed.stale ? `<button type="button" class="btn" data-act="usc-update" data-usc-title="${t.title}">Update</button>` : "") + `<button type="button" class="btn" data-act="usc-remove" data-usc-title="${t.title}">Remove</button>`;
}
var PLAW_LIB_HREF = "#/library/plaw";
var plawLibHref = (congress) => `${PLAW_LIB_HREF}${congress ? `/${congress}` : ""}`;
var lawHref = (id, view) => `#/law/${encodeURIComponent(id)}${view ? `/${encodeURIComponent(view)}` : ""}`;
function ordinal(n) {
	const s = [
		"th",
		"st",
		"nd",
		"rd"
	];
	const v = n % 100;
	return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
/** The two calendar years a Congress sits: the 118th is 2023–2024. */
var congressYears = (c) => `${1789 + (c - 1) * 2}–${1790 + (c - 1) * 2}`;
/** "Pub. L. 118-5" (short, for lists and headings); private laws are "Priv. L.". */
var lawShort = (l) => `${l.law_type === "private" ? "Priv." : "Pub."} L. ${l.congress}-${l.number}`;
/** Bluebook form: "Pub. L. No. 118-5, 137 Stat. 50 (2023)". */
function lawCitation(l) {
	const year = (l.approved_date || "").slice(0, 4);
	return `${l.law_type === "private" ? "Priv." : "Pub."} L. No. ${l.congress}-${l.number}` + (l.statute ? `, ${l.statute}` : "") + (year ? ` (${year})` : "");
}
function plawScope(st) {
	try {
		const s = JSON.parse(st?.meta?.scope || "null");
		return s && Array.isArray(s.congresses) ? s : null;
	} catch {
		return null;
	}
}
/** Law counts per Congress (public and private laws together, FT-25), newest first. */
function plawCounts(st) {
	const m = /* @__PURE__ */ new Map();
	for (const r of st?.congresses || []) m.set(r.congress, (m.get(r.congress) || 0) + r.laws);
	return m;
}
/** How many installed laws are private laws (0 when none were downloaded). */
function plawPrivateCount(st) {
	return (st?.congresses || []).reduce((n, r) => n + (r.law_type === "private" ? r.laws : 0), 0);
}
/** One Congress's laws split by type, each in the order the API gave them. */
function splitLawTypes(rows) {
	return {
		public: rows.filter((r) => r.law_type !== "private"),
		private: rows.filter((r) => r.law_type === "private")
	};
}
async function fetchPlawStatus() {
	try {
		return (await getJSON("/api/plaw?limit=1")).status;
	} catch {
		return null;
	}
}
/** Every law of one Congress, public and private (the API pages at 200). */
async function fetchCongressLaws(congress, signal) {
	const out = [];
	for (let offset = 0; offset < 5e3; offset += 200) {
		const d = await getJSON(`/api/plaw?congress=${congress}&limit=200&offset=${offset}`, { signal });
		out.push(...d.results);
		if (out.length >= d.total || !d.results.length) break;
	}
	return out;
}
var isPlawJob = (j) => Boolean(j && (j.title === 3e3 || String(j.kind || "").startsWith("plaw")));
var plawJob = () => [state.jobs?.current, ...state.jobs?.queued || []].find(isPlawJob) || null;
// src/views/library_plaw.ts
var MB_PER_CONGRESS = 32;
function jobLine() {
	const j = plawJob();
	return j ? statPill("busy", j.state === "running" ? j.phase || "Downloading" : "Queued") : "";
}
function plawTabCounts(st) {
	if (!st?.installed) return {
		countLabel: "Not installed",
		sub: "Laws as Congress passed them"
	};
	const n = plawCounts(st).size;
	return {
		countLabel: `${fmt(st.law_count)} laws`,
		sub: n ? `${n} ${n === 1 ? "Congress" : "Congresses"} · since the ${ordinal(Math.min(...plawCounts(st).keys()))}` : "No laws yet"
	};
}
function congressTiles(st, selected) {
	const counts = plawCounts(st);
	const tiles = [];
	for (let c = st.current_congress; c >= st.first_congress; c--) {
		const n = counts.get(c);
		const on = c === selected;
		tiles.push(`<a class="plaw-cong${on ? " is-on" : ""}${n == null ? " is-missing" : ""}" href="${plawLibHref(c)}"${on ? " aria-current=\"page\"" : ""}>
        <span class="plaw-cong-num">${ordinal(c)}</span>
        <span class="plaw-cong-years">${congressYears(c)}</span>
        <span class="plaw-cong-count">${n == null ? "Not downloaded" : `${fmt(n)} ${n === 1 ? "law" : "laws"}`}</span>
      </a>`);
	}
	return `<nav class="plaw-congs" aria-label="Congresses">${tiles.join("")}</nav>`;
}
function lawRow(l) {
	const hay = `${lawShort(l)} ${l.congress}-${l.number} ${l.title || ""} ${l.bill || ""} ${l.statute || ""}`.toLowerCase();
	return `<a class="lib-row" href="${lawHref(l.id)}" data-hay="${escapeHtml(hay)}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(lawShort(l))}</span><span class="lib-name">${escapeHtml(l.title || "Untitled law")}</span></span>
      <span class="lib-status">${escapeHtml([l.bill, l.approved_date ? shortDate(l.approved_date) : ""].filter(Boolean).join(" · "))}</span>
    </a>`;
}
/** The selected Congress's laws: public laws, then private laws under their own label. */
function lawListHtml(sel, laws) {
	if (!laws.length) return "<p class=\"lib-none\">No laws yet in this Congress.</p>";
	const { public: pub, private: pvt } = splitLawTypes(laws);
	const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
	const head = `${ordinal(sel)} Congress · ${congressYears(sel)} · ${count(pub.length, "public law", "public laws")}`;
	return (pub.length ? `<div class="lib-label">${escapeHtml(head)}</div>${pub.map(lawRow).join("")}` : "") + (pvt.length ? `<div class="lib-label">${escapeHtml(`Private laws · ${count(pvt.length, "law", "laws")} for named people or entities`)}</div>${pvt.map(lawRow).join("")}` : "");
}
function plawTabHtml(st, congress, laws, filter) {
	if (!st) return `<div class="empty-state"><h2>Public Laws didn’t load</h2><p>Reload the page to try again.</p></div>`;
	const kicker = `<span class="ref-badge" data-ref-tier="usc">PUB. L. · SESSION LAWS</span><span>GovInfo bulk data · USLM XML · no key needed</span>`;
	const job = jobLine();
	const span = st.current_congress - st.first_congress + 1;
	if (!st.installed) return `
      ${tabLeadHtml({
		refTier: "usc",
		kickerHtml: kicker,
		title: "Public Laws",
		subHtml: `Each law as Congress passed it, with the places it changed in the U.S. Code. GovInfo publishes them in this format from the ${ordinal(st.first_congress)} Congress (2013) on. One Congress is about ${MB_PER_CONGRESS} MB.`,
		actionsHtml: job || `<button type="button" class="btn btn-accent" data-act="plaw-download" data-congresses="${st.current_congress}">${icon("download")} Download the ${ordinal(st.current_congress)} Congress</button><button type="button" class="btn" data-act="plaw-download" data-congresses="all">Every Congress since 2013 (about ${span * MB_PER_CONGRESS} MB)</button>`
	})}
      <div class="plaw-explain">
        <p><strong>What you get.</strong> Every public law: its title, the bill it came from, the date it was signed, its Statutes at Large page and the full text, read a section at a time.</p>
        <p><strong>Why it helps.</strong> The U.S. Code shows the law as it stands today. A Public Law shows what Congress actually changed and when, and each U.S. Code section you open lists the laws that enacted or amended it.</p>
      </div>`;
	const counts = plawCounts(st);
	const sel = plawSelected(st, congress);
	const scope = plawScope(st);
	const missing = !counts.has(sel);
	const pvt = plawPrivateCount(st);
	const newest = st.meta.built_at ? shortDate(st.meta.built_at.slice(0, 10)) : "";
	const lead = tabLeadHtml({
		refTier: "usc",
		kickerHtml: kicker,
		title: "Public Laws",
		subHtml: escapeHtml([
			`${fmt(st.law_count)} laws`,
			`${counts.size} ${counts.size === 1 ? "Congress" : "Congresses"}`,
			scope?.follow ? "new Congresses added automatically" : "",
			newest ? `updated ${newest}` : ""
		].filter(Boolean).join(" · ")) + ". Open a law to read it a section at a time and see where it went in the U.S. Code.",
		actionsHtml: job || `<button type="button" class="btn" data-act="plaw-update">${icon("refresh")} Check for new laws</button><button type="button" class="btn" data-act="plaw-remove">Remove</button>`
	});
	const kpis = kpiStripHtml([
		{
			labelHtml: "Laws",
			valueHtml: escapeHtml(fmt(st.law_count)),
			subHtml: pvt ? `Including ${fmt(pvt)} private ${pvt === 1 ? "law" : "laws"}` : "Public laws installed"
		},
		{
			labelHtml: "Congresses",
			valueHtml: `${counts.size} <span class="pg-kpi-of">of ${span}</span>`,
			subHtml: `${ordinal(st.first_congress)} to ${ordinal(st.current_congress)}`
		},
		{
			labelHtml: "U.S. Code links",
			valueHtml: escapeHtml(fmt(st.usc_link_count)),
			subHtml: "Places these laws changed or cite"
		},
		{
			labelHtml: "Source",
			valueHtml: "GovInfo",
			subHtml: "Official GPO slip laws"
		}
	], {
		label: "Public Laws at a glance",
		refTier: "usc"
	});
	const body = missing ? `<div class="empty-state"><h2>The ${ordinal(sel)} Congress isn’t downloaded</h2>
        <p>Add it to read its laws (about ${MB_PER_CONGRESS} MB). Public Laws rebuild with it included.</p>
        ${job || `<p><button type="button" class="btn btn-accent" data-act="plaw-add" data-congress="${sel}">${icon("download")} Add the ${ordinal(sel)} Congress</button></p>`}</div>` : `<div class="lib-tools">
        <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter laws by title, number or bill…" aria-label="Filter laws" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}">
      </div>
      <div class="lib-list" id="lib-list">${laws ? lawListHtml(sel, laws) : "<p class=\"lib-none\">Loading laws…</p>"}</div>
      <div class="lib-none" id="lib-none" aria-live="polite" hidden>No law matches. Try words from its title, a number (“118-5”) or a bill (“H.R. 3746”).</div>`;
	return `${lead}${kpis}${congressTiles(st, sel)}${body}`;
}
/** The congresses a rebuild should hold once `add` is included (the stored scope plus it). */
function plawScopeWith(st, add) {
	const have = /* @__PURE__ */ new Set([...plawScope(st)?.congresses || [], ...plawCounts(st).keys()]);
	have.add(add);
	return [...have].sort((a, b) => a - b);
}
/** The Congress the tab shows: the one asked for when it's in range, else the newest installed. */
function plawSelected(st, congress) {
	if (!st) return congress || 0;
	if (congress && congress >= st.first_congress && congress <= st.current_congress) return congress;
	const counts = plawCounts(st);
	return counts.size ? Math.max(...counts.keys()) : st.current_congress;
}
// src/views/library.ts
var LIB_TAB_ORDER = [
	"overview",
	"constitution",
	"usc",
	"plaw",
	"cfr"
];
var LIB_TAB_HREF = {
	overview: "#/library",
	constitution: CONST_LIB_HREF,
	usc: "#/library/usc",
	plaw: PLAW_LIB_HREF,
	cfr: "#/library/cfr"
};
var lib = {
	view: null,
	data: null,
	usc: null,
	constitution: null,
	plaw: null,
	plawCongress: null,
	plawLaws: null,
	uscTree: null,
	filter: "",
	sort: "desk",
	wire: null,
	focusTab: false
};
var savedSort = lsGet("libSort");
if (savedSort === "desk" || savedSort === "number" || savedSort === "updated") lib.sort = savedSort;
state.jobs = {
	current: null,
	queued: [],
	recent: []
};
state.jobsTimer = null;
state.jobsSeenActive = /* @__PURE__ */ new Set();
state.lastJobsKey = "";
var removeTimers = /* @__PURE__ */ new WeakMap();
var fetchUscCatalog = () => getJSON("/api/usc/catalog?appendix=true").catch(() => null);
var installedCfrSet = () => new Set((state.installedTitles || []).map((t) => t.title));
async function fetchView(tab, title, part) {
	if (tab === "usc" && title) {
		const [cat, jobs] = await Promise.all([fetchUscCatalog(), getJSON("/api/library/jobs").catch(() => null)]);
		const tree = (cat?.titles.find((t) => t.title === title))?.installed ? await getJSON(`/api/usc/${title}/tree`).catch(() => null) : null;
		if (jobs) setJobs(jobs);
		lib.usc = cat;
		lib.uscTree = {
			title,
			tree
		};
		return;
	}
	if (!title) {
		const [data, cat, constitution, plaw] = await Promise.all([
			getJSON("/api/library"),
			fetchUscCatalog(),
			fetchConstitution({ force: true }),
			fetchPlawStatus()
		]);
		setJobs(data.jobs);
		lib.data = data;
		lib.usc = cat;
		lib.constitution = constitution;
		lib.plaw = plaw;
		if (tab === "plaw" && plaw?.installed) {
			const sel = plawSelected(plaw, lib.plawCongress);
			if (plawCounts(plaw).has(sel) && lib.plawLaws?.congress !== sel) lib.plawLaws = {
				congress: sel,
				rows: await fetchCongressLaws(sel).catch(() => [])
			};
		}
		return;
	}
	const url = part ? `/api/library/${title}/part/${encodeURIComponent(part)}` : `/api/library/${title}`;
	const [data, cat] = await Promise.all([getJSON(url), lib.usc ? Promise.resolve(lib.usc) : fetchUscCatalog()]);
	lib.data = data;
	lib.usc = cat;
}
async function loadLibrary(tab = "overview", title, part) {
	const normTitle = title ?? null;
	const normPart = part ?? null;
	const seq = state.routeSeq;
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	const prev = lib.view;
	const sameView = Boolean(prev && prev.tab === tab && prev.title === normTitle && prev.part === normPart);
	const frontSwitch = Boolean(!normTitle && prev && !prev.title && lib.data && dom.view.querySelector(".lib-front"));
	if (!sameView) {
		lib.filter = "";
		if (!frontSwitch) dom.view.innerHTML = skeletonHtml(normTitle ? "list" : "cards", "Loading the library…");
	}
	lib.view = {
		tab,
		title: normTitle,
		part: normPart
	};
	if (frontSwitch && !sameView) renderLibrary(false);
	try {
		await fetchView(tab, normTitle, normPart);
		if (seq !== state.routeSeq) return;
		renderLibrary(!sameView && !frontSwitch);
		pollJobsIfActive();
		if (!normTitle && tab === "cfr") loadWire();
	} catch (err) {
		if (seq !== state.routeSeq) return;
		const message = err instanceof Error ? err.message : String(err);
		dom.view.innerHTML = emptyStateHtml({
			title: "Couldn’t load the library",
			body: escapeHtml(message),
			actionsHtml: "<button type=\"button\" class=\"btn\" id=\"lib-retry\">Try again</button>"
		});
		document.getElementById("lib-retry")?.addEventListener("click", () => loadLibrary(tab, normTitle, normPart));
	}
}
/** #/library/plaw[/{congress}]: the Public Laws tab, showing one Congress's laws. */
function loadPlawTab(congress) {
	if (lib.plawCongress !== congress) lib.filter = "";
	lib.plawCongress = congress;
	return loadLibrary("plaw", null, null);
}
async function refreshLibrary() {
	if (!lib.view || !dom.view.querySelector(".lib")) return;
	const { tab, title, part } = lib.view;
	try {
		await fetchView(tab, title, part);
		renderLibrary(false);
	} catch {}
}
function actBtn(act, label, attrs, cls = "") {
	return `<button type="button" class="lib-act${cls ? " " + cls : ""}" data-act="${act}" ${attrs}>${label}</button>`;
}
function libRow({ href, num, name, status, actions, dim, key }) {
	const main = href ? `<a class="lib-main" href="${href}"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></a>` : `<span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>`;
	return `<div class="lib-row${dim ? " is-dim" : ""}${actions ? " has-actions" : ""}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}"${key ? ` data-key="${escapeHtml(key)}"` : ""}>
    ${main}<span class="lib-status">${status || ""}</span><span class="lib-actions">${actions || ""}</span></div>`;
}
var libHref = (title, part) => (title ? `#/library/cfr/${title}` : "#/library") + (part ? `/part/${encodeURIComponent(part)}` : "");
function renderStatusPill(t, opts = {}) {
	const s = titleStatus(t);
	return statPill(s.state, s.text, {
		title: s.title,
		...opts
	});
}
function relTime(ms) {
	const s = Math.max(0, (Date.now() - ms) / 1e3);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return shortDate(new Date(ms).toISOString().slice(0, 10));
}
var LIB_SORTS = [
	["desk", "By desk"],
	["number", "By number"],
	["updated", "Recently amended"]
];
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
	const name = escapeHtml(t.name || "");
	const headline = t.reserved ? name : `<a href="${libHref(t.title)}">${name}</a>`;
	const sections = inst ? inst.section_count : t.sections;
	const dateline = joinSep([
		t.amended ? `Amended ${escapeHtml(shortDate(t.amended))}` : "",
		t.reserved ? "" : fmtSections(sections),
		t.reserved || !t.size_mb ? "" : `<span title="Size of the title's text on eCFR">${fmtMB(t.size_mb)}</span>`
	]);
	const acts = titleActions(t);
	const auth = t.reserved ? [] : authorizedBy(t.title, lib.usc);
	const hay = `${t.title} title cfr ${t.name || ""} ${t.summary || ""} ${t.desk || ""} ${(t.agencies || []).join(" ")} ${auth.map((u) => `${u.title} usc`).join(" ")}`.toLowerCase();
	return `<article class="lib-story has-tier-bar${t.reserved ? " is-dim" : ""}" data-ref-tier="cfr" data-hay="${escapeHtml(hay)}">
    <div class="story-top"><span class="story-kicker">${kicker}</span>${renderStatusPill(t, { bare: !inst })}</div>
    <h3 class="story-name">${headline}</h3>
    ${t.summary ? `<p class="story-dek">${escapeHtml(t.summary)}</p>` : ""}
    ${auth.length ? `<div class="story-links"><span class="story-links-lbl">Authorized by</span>${uscChipsHtml(auth)}</div>` : ""}
    <div class="story-foot"><span class="story-date">${dateline}</span>${acts ? `<div class="story-actions">${acts}</div>` : ""}</div>
  </article>`;
}
function libMetrics(d) {
	const live = d.titles.filter((t) => !t.reserved);
	const inst = live.filter((t) => t.installed);
	const sections = inst.reduce((a, t) => a + (t.installed?.section_count || 0), 0);
	const bytes = inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0);
	const stale = live.filter(isStale);
	const { cut, recent } = amendedWeek(d);
	const updating = [state.jobs.current, ...state.jobs.queued].some((j) => j && j.kind === "update");
	return kpiStripHtml([
		{
			labelHtml: "<span class=\"stat-dot is-synced\" aria-hidden=\"true\"></span>eCFR",
			valueHtml: "Online",
			subHtml: d.checked_at ? `Title list checked ${escapeHtml(relTime(d.checked_at * 1e3))}` : `${live.length} titles tracked`
		},
		{
			labelHtml: "Installed",
			valueHtml: `${inst.length} <span class="pg-kpi-of">of ${live.length}</span>`,
			subHtml: joinSep([fmtSections(sections) || "No sections yet", bytes ? `${fmtBytes(bytes)} on disk` : ""])
		},
		{
			labelHtml: "Amended this week",
			valueHtml: String(recent),
			subHtml: cut ? `Since ${escapeHtml(shortDate(cut))}${recent ? `${SEP}<button type="button" class="metric-link" data-sort="updated">Show</button>` : ""}` : "No edition date"
		},
		stale.length ? {
			labelHtml: "<span class=\"stat-dot is-stale\" aria-hidden=\"true\"></span>Editions",
			valueHtml: `${stale.length} outdated`,
			subHtml: updating ? statPill("busy", "Updating", { bare: true }) : `<button type="button" class="metric-link is-strong" data-act="update-all">Update all ${icon("chevronRight")}</button>`,
			alert: true
		} : {
			labelHtml: "Editions",
			valueHtml: inst.length ? "Current" : "—",
			subHtml: inst.length ? "Every installed title is up to date" : "Nothing installed yet"
		}
	], {
		label: "CFR at a glance",
		refTier: "cfr",
		cls: "lib-metrics"
	});
}
function suiteHero(s, d) {
	const st = suiteState(s, d);
	const rows = st.ts.map((t) => {
		const parts = (HOME_CONTENT[t.title]?.cards || []).slice(0, 3);
		const partHref = (p) => t.installed && t.installed.whole ? `#/title/${t.title}/part/${encodeURIComponent(p)}` : libHref(t.title, p);
		return `<li class="suite-row">
      <span class="suite-num">${t.title}</span>
      <div class="suite-row-body">
        <a class="suite-name" href="${libHref(t.title)}">${escapeHtml(t.name || "")}</a>
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
		].map((x) => x && `<span>${x}</span>`).filter(Boolean))}</div>
      </div>
      ${renderStatusPill(t, { bare: true })}
    </li>`;
	}).join("");
	const action = st.label ? `<button type="button" class="btn btn-accent" data-act="download-suite" data-suite="${escapeHtml(s.id)}">${icon("download")}${escapeHtml(st.label)}</button>` : st.busy.length ? "" : `<a class="btn" href="#/title/${st.ts[0] ? st.ts[0].title : ""}/">Open in reader</a>`;
	return `<article class="suite-hero has-tier-bar" data-ref-tier="cfr" aria-labelledby="suite-${escapeHtml(s.id)}">
    <div class="story-top"><span class="story-kicker"><span class="ref-badge">FEATURED BUNDLE</span>${s.badge ? `${SEP}${escapeHtml(s.badge)}` : ""}</span>${st.pill}</div>
    <h2 class="suite-title" id="suite-${escapeHtml(s.id)}">${escapeHtml(s.name)}</h2>
    <p class="suite-dek">${escapeHtml(s.summary)}</p>
    <ul class="suite-rows">${rows}</ul>
    ${(s.usc_titles || []).length ? `<div class="story-links suite-usc"><span class="story-links-lbl">Also installs the statutes</span>${uscChipsHtml((s.usc_titles || []).map((n) => lib.usc?.titles.find((u) => u.title === n)).filter((u) => Boolean(u)))}</div>` : ""}
    <div class="suite-foot">
      <span class="suite-telemetry">${joinSep([
		plural(st.total, "title"),
		fmtSections(s.sections),
		s.size_mb ? `${fmtMB(s.size_mb)} of text` : ""
	])}</span>
      ${action}
    </div>
  </article>`;
}
function wireSummary(c) {
	if (!c) return "<span class=\"wire-pending\" aria-hidden=\"true\"></span>";
	if (!c.count) return "";
	if (c.removed === c.count) return escapeHtml(`${plural(c.count, "section")} removed`);
	const verb = c.kind === "revised" ? "revised" : "amended";
	const parts = (c.parts || []).slice(0, 3);
	const more = (c.parts || []).length - parts.length;
	const where = parts.length ? ` in ${parts.length + more === 1 ? "Part" : "Parts"} ${parts.join(", ")}${more > 0 ? ` +${more}` : ""}` : "";
	return `${escapeHtml(`${plural(c.count, "section")} ${verb}${where}`)}${c.first && c.first.name ? `<span class="wire-first">${escapeHtml(c.first.name)}</span>` : ""}`;
}
function libWire(d) {
	const top = d.titles.filter((t) => !t.reserved && Boolean(t.amended)).sort((a, b) => (b.amended || "").localeCompare(a.amended || "") || a.title - b.title).slice(0, 5);
	const byTitle = new Map((lib.wire?.items || []).map((c) => [c.title, c]));
	const failed = Boolean(lib.wire && lib.wire.failed);
	const listHtml = top.length ? `<ol class="wire-items">${top.map((t) => {
		const c = byTitle.get(t.title);
		const summary = !lib.wire ? wireSummary(null) : failed || !c || c.amended !== t.amended ? "" : wireSummary(c);
		return `<li class="wire-entry"><a href="${libHref(t.title)}">
          <span class="wire-entry-head"><span class="wire-entry-title">Title ${t.title}${(t.agencies || [])[0] ? `${SEP}${escapeHtml(t.agencies[0])}` : ""}</span>
            <time class="wire-entry-date" datetime="${escapeHtml(t.amended || "")}">${escapeHtml(shortDate(t.amended))}</time></span>
          <span class="wire-entry-name">${escapeHtml(t.name || "")}</span>
          ${summary ? `<span class="wire-entry-summary">${summary}</span>` : ""}
        </a></li>`;
	}).join("")}</ol>
      <div class="wire-foot"><button type="button" class="wire-link" data-sort="updated">All titles by last amendment ${icon("chevronRight")}</button></div>` : "<p class=\"wire-empty\">No recent eCFR amendment dates in this catalog slice.</p>";
	return `<aside class="reg-wire${top.length ? "" : " is-empty"}" id="lib-wire" aria-labelledby="wire-title">
    <div class="wire-head">
      <h2 class="wire-title" id="wire-title">${icon("activity")}The Regulatory Wire</h2>
      <span class="wire-badge">Live eCFR</span>
    </div>
    <p class="wire-sub">Latest amendments, newest first</p>
    ${listHtml}
  </aside>`;
}
async function loadWire() {
	if (lib.wire && Date.now() - lib.wire.at < 18e5 && !lib.wire.failed) return;
	try {
		lib.wire = {
			at: Date.now(),
			items: await getJSON("/api/library/wire")
		};
	} catch {
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
	for (const t of live) if (t.desk && !names.includes(t.desk)) names.push(t.desk);
	return names.map((name) => {
		const ts = live.filter((t) => t.desk === name);
		return ts.length ? desk(name, ts) : "";
	}).join("") + (reserved.length ? desk("Reserved", reserved) : "");
}
function cfrLive(d) {
	return d.titles.filter((t) => !t.reserved);
}
function anyUpdating() {
	return [state.jobs.current, ...state.jobs.queued].some((j) => j && (j.kind === "update" || j.kind === "usc-update"));
}
function libTabsHtml(d, cat, tab) {
	const live = cfrLive(d);
	const inst = live.filter((t) => t.installed);
	const stale = live.filter(isStale);
	const u = uscStats(cat);
	const total = inst.length + u.inst.length;
	const bytes = inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0) + u.bytes;
	const due = stale.length + u.stale.length;
	const { newest } = amendedWeek(d);
	return switchboardHtml({
		id: "lib-tabs",
		idPrefix: "lib-tab",
		dataAttr: "lib-tab",
		panelId: "lib-tab-body",
		label: "Library sections",
		active: tab,
		tabs: [
			{
				id: "overview",
				label: "Overview",
				abbr: "Desk",
				href: LIB_TAB_HREF.overview,
				countLabel: `${total} installed`,
				sub: [bytes ? `${fmtBytes(bytes)} on disk` : "Nothing installed yet", due ? `${due} ${due === 1 ? "update" : "updates"} due` : ""].filter(Boolean).join(" · "),
				alert: due > 0
			},
			{
				id: "constitution",
				label: "U.S. Constitution",
				abbr: "Const.",
				refTier: "const",
				href: LIB_TAB_HREF.constitution,
				...constTabCounts(lib.constitution)
			},
			{
				id: "usc",
				label: "United States Code",
				abbr: "U.S.C.",
				refTier: "usc",
				href: LIB_TAB_HREF.usc,
				countLabel: `${u.inst.filter((t) => t.title < 100).length} of ${u.main.length || 53} titles`,
				sub: releaseLine(cat),
				alert: u.stale.length > 0,
				alertTitle: "Behind the current release point"
			},
			{
				id: "plaw",
				label: "Public Laws",
				abbr: "Pub. L.",
				refTier: "usc",
				href: LIB_TAB_HREF.plaw,
				...plawTabCounts(lib.plaw)
			},
			{
				id: "cfr",
				label: "Code of Federal Regulations",
				abbr: "CFR",
				refTier: "cfr",
				href: LIB_TAB_HREF.cfr,
				countLabel: `${inst.length} of ${live.length} titles`,
				sub: newest ? `eCFR edition ${shortDate(newest)}` : "eCFR Versioner",
				alert: stale.length > 0,
				alertTitle: "eCFR has a newer edition"
			}
		]
	});
}
function updateRows(d, cat) {
	const rows = [];
	for (const t of uscStats(cat).stale) {
		const j = uscJobFor(t.title);
		rows.push(libRow({
			href: uscLibHref(t.title),
			num: uscCite(t.title),
			name: t.name,
			status: j ? jobStatus(j) : statPill("stale", `Behind ${cat?.release?.release_point || "the OLRC"}`, { bare: true }),
			actions: j ? "" : `<button type="button" class="lib-act" data-act="usc-update" data-usc-title="${t.title}">Update</button>`
		}));
	}
	for (const t of cfrLive(d).filter(isStale)) {
		const j = jobFor(t.title, "title");
		rows.push(libRow({
			href: libHref(t.title),
			num: `${t.title} CFR`,
			name: t.name || "",
			status: j ? jobStatus(j) : statPill("stale", `Edition ${shortDate(t.latest)} available`, { bare: true }),
			actions: j ? "" : actBtn("update", "Update", `data-title="${t.title}"`)
		}));
	}
	return rows.join("");
}
function bundleCard(s, d, cat) {
	const st = suiteState(s, d);
	const us = (s.usc_titles || []).map((n) => cat?.titles.find((t) => t.title === n)).filter((t) => Boolean(t));
	const uBusy = us.filter((t) => uscJobFor(t.title));
	const uNeeds = us.filter((t) => !uscJobFor(t.title) && (!t.installed || t.installed.stale));
	const cfrTs = st.ts;
	const cfrWhole = cfrTs.filter((t) => t.installed && t.installed.whole);
	const total = us.length + cfrTs.length;
	const installed = us.filter((t) => t.installed).length + cfrWhole.length;
	const stale = us.filter((t) => t.installed?.stale).length + cfrTs.filter(isStale).length;
	let pill;
	if (st.busy.length || uBusy.length) pill = statPill("busy", `${st.busy.length + uBusy.length} of ${total} in progress`);
	else if (total && installed === total && !stale) pill = statPill("synced", "Installed");
	else if (total && installed === total) pill = statPill("stale", "Update available");
	else if (installed) pill = statPill("partial", `${installed} of ${total} installed`);
	else pill = statPill("uninstalled", "Not installed", { bare: true });
	const onlyUpdates = Boolean(st.label.startsWith("Update") || !st.label) && uNeeds.every((t) => t.installed);
	const action = st.label || uNeeds.length ? actBtn("download-suite", `${icon("download")}${onlyUpdates ? "Update bundle" : "Download bundle"}`, `data-suite="${escapeHtml(s.id)}"`, "is-primary") : "";
	const cfrInst = installedCfrSet();
	return `<article class="suite-card lib-bundle has-tier-bar" data-ref-tier="usc">
    <div class="story-top"><span class="story-kicker"><span class="ref-badge">BUNDLE</span>${s.badge ? `${SEP}${escapeHtml(s.badge)}` : ""}</span>${pill}</div>
    <h3 class="story-name">${escapeHtml(s.name)}</h3>
    <p class="story-dek">${escapeHtml(s.summary)}</p>
    <div class="lib-bundle-chain">
      ${us.length ? `<div class="story-links"><span class="story-links-lbl">Statutes</span>${uscChipsHtml(us)}</div>` : ""}
      <div class="story-links"><span class="story-links-lbl">Regulations</span>${cfrChipsHtml(s.titles, cfrInst)}</div>
    </div>
    <div class="story-foot"><span class="story-date">${joinSep([
		us.length ? plural(us.length, "statute title") : "",
		plural(s.titles.length, "CFR title"),
		s.size_mb ? `${fmtMB(s.size_mb)} of CFR text` : ""
	])}</span>${action}</div>
  </article>`;
}
function overviewHtml(d, cat) {
	const live = cfrLive(d);
	const inst = live.filter((t) => t.installed);
	const u = uscStats(cat);
	const cfrSections = inst.reduce((a, t) => a + (t.installed?.section_count || 0), 0);
	const cfrBytes = inst.reduce((a, t) => a + (t.installed?.bytes || 0), 0);
	const due = live.filter(isStale).length + u.stale.length;
	const updating = anyUpdating();
	const cells = [
		{
			labelHtml: "Installed",
			valueHtml: `${inst.length + u.inst.length} titles`,
			subHtml: joinSep([`${u.inst.length} U.S.C.`, `${inst.length} CFR`])
		},
		{
			labelHtml: "Sections",
			valueHtml: escapeHtml(fmt(cfrSections + u.sections)),
			subHtml: joinSep([`${fmt(u.sections)} statutory`, `${fmt(cfrSections)} regulatory`])
		},
		{
			labelHtml: "On disk",
			valueHtml: escapeHtml(fmtBytes(cfrBytes + u.bytes) || "0 B"),
			subHtml: "Local SQLite, readable offline"
		},
		due ? {
			labelHtml: "<span class=\"stat-dot is-stale\" aria-hidden=\"true\"></span>Updates",
			valueHtml: `${due} due`,
			alert: true,
			subHtml: updating ? statPill("busy", "Updating", { bare: true }) : `<button type="button" class="metric-link is-strong" data-act="update-everything">Update all ${icon("chevronRight")}</button>`
		} : {
			labelHtml: "Updates",
			valueHtml: inst.length + u.inst.length ? "All current" : "—",
			subHtml: cat?.release || !u.inst.length ? "Against eCFR and the OLRC" : "U.S. Code not checked yet"
		}
	];
	const rows = updateRows(d, cat);
	const unchecked = u.inst.length && !cat?.release ? `<div class="lib-row has-note"><span class="lib-main"><span class="lib-num">U.S.C.</span><span class="lib-name">The OLRC release point hasn’t been checked yet</span></span><span class="lib-status"><button type="button" class="lib-act" data-act="usc-check">Check now</button></span><span class="lib-actions"></span></div>` : "";
	const updates = rows || unchecked ? `<section class="lib-band" aria-label="Updates due">${flagHtml("Updates due", due ? plural(due, "title") : "")}<div class="lib-list lib-updates">${rows}${unchecked}</div></section>` : "";
	const suites = Object.values(d.suites || {});
	const bundles = suites.length ? `<section class="lib-band" aria-label="Bundles">${flagHtml("Bundles", "Statutes with the regulations that implement them")}<div class="lib-suite-grid">${suites.map((s) => bundleCard(s, d, cat)).join("")}</div></section>` : "";
	const cfrInst = installedCfrSet();
	const shelf = u.inst.map((t) => uscStory(t, cfrInst)).join("") + inst.map(libStory).join("");
	const installed = `<section class="lib-band" aria-label="Installed titles">${flagHtml("On this computer", plural(inst.length + u.inst.length, "title"))}
    ${shelf ? `<div class="lib-stories">${shelf}</div>` : emptyStateHtml({
		title: "Nothing installed yet",
		body: "Install U.S. Code titles for the statutes, CFR titles for the regulations, or a bundle above for both.",
		actionsHtml: `<a class="btn" href="${LIB_TAB_HREF.usc}">Browse the U.S. Code</a><a class="btn" href="${LIB_TAB_HREF.cfr}">Browse the CFR</a>`
	})}</section>`;
	return `${kpiStripHtml(cells, {
		label: "Library at a glance",
		cls: "lib-metrics"
	})}${updates}${bundles}${installed}`;
}
function cfrTabHtml(d) {
	const suites = Object.values(d.suites || {});
	const lead = suites.find((s) => s.featured) || suites[0];
	const stale = cfrLive(d).filter(isStale);
	const updating = [state.jobs.current, ...state.jobs.queued].some((j) => j && j.kind === "update");
	return `
    ${tabLeadHtml({
		refTier: "cfr",
		kickerHtml: "<span class=\"ref-badge\" data-ref-tier=\"cfr\">CFR · REGULATIONS</span><span>eCFR Versioner API</span>",
		title: "Code of Federal Regulations",
		subHtml: "Download whole titles, single parts or sections. Installed editions are checked against eCFR’s daily updates.",
		actionsHtml: stale.length && !updating ? `<button type="button" class="btn btn-accent" data-act="update-all">${icon("download")} Update ${plural(stale.length, "title")}</button>` : ""
	})}
    ${libMetrics(d)}
    <div class="lib-broadsheet${lead ? "" : " is-wire-only"}">${lead ? suiteHero(lead, d) : ""}${libWire(d)}</div>
    <div class="lib-tools">
      <input class="lib-filter" id="lib-filter" type="search" placeholder="Filter titles or agencies…" aria-label="Filter titles or agencies" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
      <div class="lib-seg" role="group" aria-label="Order titles">${LIB_SORTS.map(([k, label]) => `<button type="button" data-sort="${k}" aria-pressed="${lib.sort === k}">${label}</button>`).join("")}</div>
    </div>
    <div class="lib-list" id="lib-list">${libTitleList(d, lib.sort)}</div>
    <div class="lib-none" id="lib-none" aria-live="polite" hidden>No title matches. Try an agency (“OSHA”) or a topic.</div>`;
}
function libFrontHtml(d, cat = lib.usc, tab = lib.view?.tab || "overview") {
	const live = cfrLive(d);
	const inst = live.filter((t) => t.installed);
	const u = uscStats(cat);
	const due = live.filter(isStale).length + u.stale.length;
	const { newest } = amendedWeek(d);
	return `<div class="lib lib-front pg" data-lib-tab="${tab}">
    ${pageMastheadHtml({
		folioLeftHtml: `<a href="#/">Home</a>${SEP}<span>Library</span>`,
		folioRightHtml: joinSep([cat?.release ? `OLRC release ${escapeHtml(cat.release.release_point)}` : "OLRC release not checked", newest ? `eCFR edition ${escapeHtml(shortDate(newest))}` : ""]),
		title: "Library",
		subHtml: joinSep([
			"Federal statutes and regulations on this computer",
			plural(inst.length + u.inst.length, "title") + " installed",
			due ? `${plural(due, "update")} due` : ""
		]),
		actionsHtml: (due && !anyUpdating() ? `<button type="button" class="btn btn-sm" data-act="update-everything">${icon("download")} Update all</button>` : "") + `<a class="btn btn-sm" href="#/news">${icon("news")} Federal Register in the Newsroom</a>`,
		tabsHtml: libTabsHtml(d, cat, tab)
	})}
    <div id="lib-tab-body" class="pg-tab-body" role="tabpanel" aria-labelledby="lib-tab-${tab}">${tab === "constitution" ? constTabHtml(lib.constitution, lib.filter) : tab === "usc" ? uscTabHtml(cat, lib.filter, installedCfrSet()) : tab === "plaw" ? plawTabHtml(lib.plaw, lib.plawCongress, lib.plawLaws && lib.plawLaws.congress === plawSelected(lib.plaw, lib.plawCongress) ? lib.plawLaws.rows : null, lib.filter) : tab === "cfr" ? cfrTabHtml(d) : overviewHtml(d, cat)}</div>
  </div>`;
}
function renderFront(fresh) {
	const d = lib.data;
	const tab = lib.view?.tab || "overview";
	const tabTitle = {
		overview: "",
		constitution: "Constitution · ",
		usc: "U.S. Code · ",
		plaw: "Public Laws · ",
		cfr: "CFR · "
	}[tab];
	document.title = `${tabTitle}Library · FRAMEWORK`;
	const scrollTop = dom.main.scrollTop;
	const keepTabFocus = lib.focusTab || Boolean(document.activeElement?.closest("#lib-tabs"));
	const html = libFrontHtml(d, lib.usc, tab);
	const shell = !fresh && dom.view.querySelector(`.lib-front[data-lib-tab="${tab}"]`);
	if (shell) {
		const tmp = document.createElement("div");
		tmp.innerHTML = html;
		const next = tmp.firstElementChild;
		shell.querySelector(".pg-masthead")?.replaceWith(next.querySelector(".pg-masthead"));
		const body = shell.querySelector("#lib-tab-body");
		const nextBody = next.querySelector("#lib-tab-body");
		const tools = body?.querySelector(":scope > .lib-tools");
		if (body && nextBody) {
			const nodes = [...nextBody.children].map((n) => tools && n.classList.contains("lib-tools") ? tools : n);
			body.replaceChildren(...nodes);
		}
		for (const btn of shell.querySelectorAll(".lib-seg [data-sort]")) btn.setAttribute("aria-pressed", String(btn.dataset.sort === lib.sort));
		applyLibraryFilter();
		dom.main.scrollTop = scrollTop;
	} else {
		dom.view.innerHTML = html;
		applyLibraryFilter();
		if (fresh) enterView();
		else dom.main.scrollTop = scrollTop;
	}
	if (keepTabFocus) {
		lib.focusTab = false;
		document.getElementById(`lib-tab-${tab}`)?.focus();
	}
}
function renderUscDetail(fresh) {
	const title = lib.view?.title || 0;
	const t = lib.usc?.titles.find((x) => x.title === title);
	const tree = lib.uscTree && lib.uscTree.title === title ? lib.uscTree.tree : null;
	if (!t) {
		dom.view.innerHTML = emptyStateHtml({
			title: `U.S. Code Title ${title} isn’t in the catalog`,
			body: "Titles are numbered 1 to 54, and 53 is reserved.",
			actionsHtml: `<a class="btn" href="${LIB_TAB_HREF.usc}">All U.S. Code titles</a>`
		});
		return;
	}
	document.title = `${uscCite(title)} · Library · FRAMEWORK`;
	const scrollTop = dom.main.scrollTop;
	const html = `<div class="lib lib-usc-title pg" data-lib-view="usc|${title}">
    ${pageMastheadHtml({
		folioLeftHtml: `<a href="#/">Home</a>${SEP}<a href="#/library">Library</a>${SEP}<a href="${LIB_TAB_HREF.usc}">U.S. Code</a>`,
		folioRightHtml: `<span>${escapeHtml(uscCite(title))}</span>${SEP}${uscStatusPill(t, true)}`,
		title: `Title ${uscTitleLabel(title)} — ${t.name}`,
		subHtml: uscDetailSub(t),
		actionsHtml: uscDetailActions(t, tree)
	})}
    <div class="pg-tab-body">${uscDetailBodyHtml(t, tree, installedCfrSet())}</div>
  </div>`;
	const filterEl = document.getElementById("lib-filter");
	const keep = !fresh && filterEl && dom.view.querySelector(`.lib[data-lib-view="usc|${title}"]`);
	dom.view.innerHTML = html;
	if (keep) {
		const next = document.getElementById("lib-filter");
		if (next) next.value = lib.filter;
	}
	applyLibraryFilter();
	if (fresh) enterView();
	else dom.main.scrollTop = scrollTop;
}
bindSwitchboardKeys("#lib-tabs", "lib-tab", () => LIB_TAB_ORDER, (id) => {
	lib.focusTab = true;
	window.location.hash = LIB_TAB_HREF[id] || LIB_TAB_HREF.overview;
});
function renderLibrary(fresh) {
	if (!lib.view) return;
	const { tab, title, part } = lib.view;
	if (tab === "usc" && title) {
		renderUscDetail(fresh);
		return;
	}
	if (!lib.data) return;
	if (!title) {
		renderFront(fresh);
		return;
	}
	const scrollTop = dom.main.scrollTop;
	let crumbs, heading, sub, head = "", body = "", placeholder;
	if (!part) {
		const d = lib.data;
		document.title = `Title ${title} · Library · FRAMEWORK`;
		const inst = d.installed;
		crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${LIB_TAB_HREF.cfr}">CFR</a>`;
		heading = `Title ${title} — ${d.name || ""}`;
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
		const d = lib.data;
		document.title = `Part ${part} · Library · FRAMEWORK`;
		crumbs = `<a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><a href="${libHref()}">Library</a><span class="sep" aria-hidden="true">›</span><a href="${LIB_TAB_HREF.cfr}">CFR</a><span class="sep" aria-hidden="true">›</span><a href="${libHref(title)}">Title ${title}</a>`;
		heading = `${d.l} — ${d.d || ""}`;
		const countText = fmtSections(d.groups.reduce((a, g) => a + g.sections.filter((s) => !s.r).length, 0)) || "0 sections";
		sub = d.installed === "all" ? `Installed · ${countText}` : d.installed === "some" ? `Partly installed · ${countText}` : countText;
		placeholder = "Filter sections";
		const j = jobFor(title, "part", part);
		head = j ? `<span class="lib-head-status">${jobStatus(j)}</span>` : d.installed === "all" ? `<a class="btn" href="#/title/${title}/part/${encodeURIComponent(part)}">Open in reader</a>` : `<button type="button" class="btn" data-act="download" data-title="${title}" data-part="${escapeHtml(part)}">${icon("download")} Download part</button>`;
		body = d.groups.map((g) => `
      ${g.label ? `<div class="lib-label">${escapeHtml(g.label)}</div>` : ""}
      ${g.sections.map((s) => {
			const num = s.t === "appendix" ? s.l : s.l.replace(/^§\s*/, "");
			const name = s.t === "appendix" ? s.d && s.d !== s.l ? s.d.replace(s.l, "").replace(/^\s*[—–-]\s*/, "") : "" : s.d || "";
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
	const viewKey = `${title}|${part || ""}`;
	if (!fresh && dom.view.querySelector(`.lib[data-lib-view="${CSS.escape(viewKey)}"]`)) {
		const subEl = document.getElementById("lib-sub-slot");
		const headEl = document.getElementById("lib-head-act-slot");
		const listEl = document.getElementById("lib-list");
		if (subEl) subEl.textContent = sub;
		if (headEl) headEl.innerHTML = head;
		if (listEl) listEl.innerHTML = body;
		applyLibraryFilter();
		dom.main.scrollTop = scrollTop;
		return;
	}
	dom.view.innerHTML = `
    <div class="lib" data-lib-view="${escapeHtml(viewKey)}">
      <div class="doc-kicker">${crumbs}</div>
      <div class="lib-head">
        <div class="lib-head-text">
          <h1 class="doc-title">${escapeHtml(heading)}</h1>
          <p class="lib-sub" id="lib-sub-slot">${escapeHtml(sub)}</p>
        </div>
        <span id="lib-head-act-slot">${head}</span>
      </div>
      ${!part && authorizedBy(title, lib.usc).length ? `<section class="lib-links-band" aria-label="Authorizing statutes"><span class="story-links-lbl">Authorized by</span>${uscChipsHtml(authorizedBy(title, lib.usc))}</section>` : ""}
      <input class="lib-filter" id="lib-filter" type="search" placeholder="${placeholder}…" aria-label="${placeholder}" autocomplete="off" spellcheck="false" value="${escapeHtml(lib.filter)}">
      <div class="lib-list" id="lib-list">${body}</div>
      <div class="lib-none" id="lib-none" aria-live="polite" hidden>Nothing matches.</div>
    </div>`;
	applyLibraryFilter();
	if (fresh) enterView();
	else dom.main.scrollTop = scrollTop;
}
function applyLibraryFilter() {
	const words = lib.filter.toLowerCase().split(/\s+/).filter(Boolean);
	const list = document.getElementById("lib-list");
	const noneEl = document.getElementById("lib-none");
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
		if (noneEl) noneEl.hidden = n > 0;
		return;
	}
	let shown = 0;
	let label = null;
	let labelHas = false;
	const closeLabel = () => {
		if (label) label.hidden = !labelHas;
	};
	for (const child of list.children) {
		const el = child;
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
	if (noneEl) noneEl.hidden = shown > 0;
}
onView("input", (e) => {
	const target = e.target;
	if (!target || target.id !== "lib-filter") return;
	lib.filter = target.value;
	applyLibraryFilter();
});
onView("click", (e) => {
	const sortBtn = e.target?.closest("button[data-sort]");
	if (!sortBtn || !dom.view.querySelector(".lib")?.contains(sortBtn)) return;
	const fromSeg = Boolean(sortBtn.closest(".lib-seg"));
	const nextSort = sortBtn.dataset.sort;
	if ((nextSort === "desk" || nextSort === "number" || nextSort === "updated") && nextSort !== lib.sort) {
		lib.sort = nextSort;
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
on("jobs:updated", (snap) => {
	if (!dom.view.querySelector(".lib")) return;
	const key = [snap.current, ...snap.queued || []].filter((j) => Boolean(j)).map((j) => `${j.id}${j.state[0]}`).join(",");
	if (key !== state.lastJobsKey) {
		state.lastJobsKey = key;
		renderLibrary(false);
	}
});
on("jobs:finished", () => {
	if (dom.view.querySelector(".lib")) refreshLibrary();
});
onView("click", async (e) => {
	const btn = e.target?.closest("button[data-act]");
	if (!btn || !dom.view.querySelector(".lib")?.contains(btn)) return;
	const isUsc = btn.dataset.uscTitle !== void 0;
	const title = parseInt((isUsc ? btn.dataset.uscTitle : btn.dataset.title) || "", 10);
	const act = btn.dataset.act;
	if (act === "remove" || act === "usc-remove" || act === "const-remove" || act === "plaw-remove") {
		const what = act === "usc-remove" ? uscCite(title) : act === "const-remove" ? "the Constitution" : act === "plaw-remove" ? "Public Laws" : `Title ${title}`;
		if (!btn.classList.contains("is-armed")) {
			btn.classList.add("is-armed");
			btn.textContent = "Confirm remove";
			announce(`Press again to confirm removing ${what}`);
			clearTimeout(removeTimers.get(btn));
			removeTimers.set(btn, setTimeout(() => {
				btn.classList.remove("is-armed");
				btn.textContent = "Remove";
			}, 4e3));
			return;
		}
		btn.disabled = true;
		try {
			if (act === "usc-remove") {
				await getJSON(`/api/usc/${title}`, { method: "DELETE" });
				showToast(`Removed ${what}`);
			} else if (act === "const-remove") {
				await getJSON("/api/constitution", { method: "DELETE" });
				showToast("Removed the Constitution");
			} else if (act === "plaw-remove") {
				await getJSON("/api/plaw", { method: "DELETE" });
				lib.plawLaws = null;
				showToast("Removed Public Laws");
			} else {
				await getJSON(`/api/library/${title}`, { method: "DELETE" });
				invalidateTitleCaches([title]);
				showToast(`Removed ${what}`);
				await refreshTitles();
			}
			await refreshLibrary();
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 5e3);
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
		if (act === "usc-check") {
			try {
				const r = await getJSON("/api/usc/release?refresh=true");
				const behind = r.titles.filter((t) => t.stale).length;
				showToast(behind ? `${behind} U.S. Code ${behind === 1 ? "title is" : "titles are"} behind release point ${r.release_point}` : `U.S. Code is current (release point ${r.release_point})`);
			} finally {
				await refreshLibrary();
			}
			return;
		}
		if (act === "usc-update-all") {
			await queueBatch("/api/usc/update-all", null, "Every installed U.S. Code title is already current");
			return;
		}
		if (act === "update-everything") {
			const cfr = await getJSON("/api/library/update-all", { method: "POST" });
			const usc = await getJSON("/api/usc/update-all", { method: "POST" }).catch(() => ({ queued: [] }));
			const queued = [...cfr.queued || [], ...usc.queued || []];
			for (const j of queued) state.jobsSeenActive.add(j.id);
			if (!queued.length) {
				showToast("Everything installed is already current");
				btn.disabled = false;
			}
			await pollJobs();
			return;
		}
		if (act === "plaw-download" || act === "plaw-add" || act === "plaw-update") {
			const all = btn.dataset.congresses === "all";
			const congresses = act === "plaw-add" ? plawScopeWith(lib.plaw, parseInt(btn.dataset.congress || "0", 10)) : act === "plaw-download" && !all ? [parseInt(btn.dataset.congresses || "0", 10)] : null;
			const res = act === "plaw-update" ? await getJSON("/api/plaw/update", { method: "POST" }) : await getJSON("/api/plaw/build", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(congresses ? { congresses } : {})
			});
			state.jobsSeenActive.add(res.job.id);
			lib.plawLaws = null;
			await pollJobs();
			return;
		}
		if (act === "const-download" || act === "const-update") {
			const res = await getJSON(`/api/constitution/${act === "const-update" ? "update" : "build"}`, { method: "POST" });
			state.jobsSeenActive.add(res.job.id);
			await pollJobs();
			return;
		}
		if (act === "usc-download" || act === "usc-update") {
			const job = await getJSON("/api/usc/download", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title })
			});
			state.jobsSeenActive.add(job.job.id);
			await pollJobs();
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
		state.jobsSeenActive.add(job.id);
		await pollJobs();
	} catch (err) {
		showToast(err instanceof Error ? err.message : String(err), 5e3);
		btn.disabled = false;
	}
});
// src/views/news_case.ts
var autoEnrichedCases = /* @__PURE__ */ new Set();
var lastCaseData = null;
function clipCurrentInspection() {
	if (!lastCaseData) return;
	const d = lastCaseData.detail || {};
	const art = lastCaseData.article || {};
	const loc = [d.site_city || art.city, d.site_state || art.state].filter(Boolean).join(", ");
	const secs = [...new Set((lastCaseData.violations || []).map((v) => v.section_id).filter((s) => Boolean(s)))];
	clipCaseToWorkspace({
		activity_nr: lastCaseData.activity_nr,
		estab_name: d.estab_name || art.company || `Inspection #${lastCaseData.activity_nr}`,
		location: loc || void 0,
		penalty_usd: d.current_penalty_usd ?? art.penalty_usd ?? void 0,
		open_date: d.open_date || art.opened_on || void 0,
		sections: secs.length ? secs : art.sections || []
	});
}
function citationStatusText(v) {
	const bits = [];
	if (v.contest_date) bits.push(`Contested ${fmtDate(v.contest_date)}`);
	if (v.final_order_date) bits.push(`Final ${fmtDate(v.final_order_date)}`);
	if (v.abate_complete === "X" || v.abate_complete === "3") bits.push("Abated");
	else if (v.abate_date) bits.push(`Abate due ${fmtDate(v.abate_date)}`);
	return bits.join(" · ") || "Issued";
}
function violationStandardHtml(v) {
	if (v.section_id) {
		const dim = !titleInstalled(29);
		const href = dim ? "#/library/29" : titleHref(29, "section/" + encodeURIComponent(v.section_id) + (v.para ? "?p=" + encodeURIComponent(v.para) : ""));
		return `<a class="citation-link ins-std-link${dim ? " is-dim" : ""}" href="${href}">${escapeHtml(v.standard_display)}</a>`;
	}
	if (v.is_general_duty) return `<span class="ins-std-gdc">${escapeHtml(v.standard_display)}</span>`;
	return `<span class="ins-std-state">${escapeHtml(v.standard_display || v.raw_standard || "Unlisted")}</span>` + (v.is_state_plan ? "<span class=\"ins-tag\">State plan</span>" : "");
}
function inspectionViolationsHtml(data) {
	const viols = data.violations || [];
	if (!viols.length) {
		if (data.dol_configured) return `
        <div class="ins-panel-empty">
          <p class="ins-muted">Individual citation rows have not been cached locally for this inspection yet.</p>
          <button type="button" class="btn btn-sm btn-accent" data-ins-act="enrich" data-act-nr="${data.activity_nr}">${icon("activity")} Load citations from DOL</button>
        </div>`;
		return "<div class=\"ins-panel-empty\"><p class=\"ins-muted\">Add a free DOL API key in Settings to load per-citation details on demand.</p></div>";
	}
	const eventsByCit = /* @__PURE__ */ new Map();
	for (const ev of data.events || []) {
		if (!ev.citation_id) continue;
		const arr = eventsByCit.get(ev.citation_id) || [];
		arr.push(ev);
		eventsByCit.set(ev.citation_id, arr);
	}
	const todayIso = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	return `
    <div class="ins-table-wrap">
      <table class="ins-table">
        <thead>
          <tr>
            <th>Cit.</th>
            <th>Standard</th>
            <th>Type</th>
            <th>Exposed</th>
            <th>Status</th>
            <th class="is-num">Penalty</th>
          </tr>
        </thead>
        <tbody>
          ${viols.map((v) => {
		const tagHtml = [];
		const pushTag = (txt, cls = "") => tagHtml.push(`<span class="ins-tag${cls ? " " + cls : ""}">${escapeHtml(txt)}</span>`);
		if (v.gravity) pushTag(`Grav ${v.gravity}`);
		if (v.emphasis) pushTag(`NEP ${v.emphasis}`);
		if (v.hazcat) pushTag(v.hazcat);
		if (v.contest_date) pushTag("Contested", "is-warn");
		const abDone = v.abate_complete === "X" || v.abate_complete === "3" || v.abate_complete === "Y";
		if (v.abate_date && !abDone) pushTag(v.abate_date < todayIso ? "Abatement overdue" : "Abatement open", v.abate_date < todayIso ? "is-danger" : "is-warn");
		if (v.fta_penalty || v.fta_insp_nr) {
			const ftaTxt = v.fta_penalty ? `FTA +${fmtMoney(v.fta_penalty)}` : "FTA";
			if (v.fta_insp_nr) tagHtml.push(`<a class="ins-tag is-danger ins-tag-link" href="#/news/inspection/${v.fta_insp_nr}">${escapeHtml(ftaTxt)}</a>`);
			else pushTag(ftaTxt, "is-danger");
		}
		if ((v.hazsubs || []).length) pushTag(`HazSub ${v.hazsubs.join(", ")}`);
		const modEv = [...v.citation_id && eventsByCit.get(v.citation_id) || []].reverse().find((e) => e.event_label && e.event_label !== "Issued");
		const penChanged = v.initial_penalty != null && v.current_penalty != null && v.initial_penalty !== v.current_penalty;
		const deltaUsd = penChanged ? v.current_penalty - v.initial_penalty : 0;
		const expBits = [v.nr_instances ? plural(v.nr_instances, "inst") : "", v.nr_exposed ? `${v.nr_exposed} exp` : ""].filter(Boolean).join(" · ");
		return `
              <tr>
                <td class="ins-cit-id">${escapeHtml(v.citation_id || "—")}</td>
                <td>
                  <div class="ins-std-cell">
                    ${violationStandardHtml(v)}
                    ${tagHtml.length ? `<div class="ins-tags">${tagHtml.join("")}</div>` : ""}
                    ${modEv ? `<div class="ins-ev-inline">${escapeHtml(modEv.event_label)}${penChanged ? ` (${deltaUsd > 0 ? "+" : "-"}${escapeHtml(fmtMoney(Math.abs(deltaUsd)))})` : ""}</div>` : ""}
                  </div>
                </td>
                <td><span class="ins-viol-pill is-${escapeHtml((v.viol_type || "O").toLowerCase())}">${escapeHtml(v.viol_label || v.viol_type)}</span></td>
                <td class="ins-mono-col">${escapeHtml(expBits || "—")}</td>
                <td class="ins-status-col">${escapeHtml(citationStatusText(v))}</td>
                <td class="is-num">
                  <div class="ins-pen-cur">${v.current_penalty ? escapeHtml(fmtMoney(v.current_penalty)) : "$0"}</div>
                  ${penChanged ? `<div class="ins-pen-init">Initial ${escapeHtml(fmtMoney(v.initial_penalty))}</div>` : ""}
                </td>
              </tr>`;
	}).join("")}
        </tbody>
      </table>
    </div>`;
}
function inspectionSectionsHtml(data) {
	const secs = (data.article || {}).sections || [];
	if (!secs.length) return "";
	return `
    <div class="ins-cfr-chips">
      ${secs.map((s) => {
		return `<a class="citation-chip${!titleInstalled(29) ? " is-dim" : ""}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`;
	}).join("")}
    </div>`;
}
function inspectionRelatedHtml(data) {
	const related = data.related || [];
	if (!related.length) return "";
	return `
    <section class="ins-panel" aria-label="Related OSHA inspections">
      <div class="ins-panel-head">
        <h2 class="ins-panel-title">Related Inspections</h2>
        <span class="ins-panel-meta">${escapeHtml(plural(related.length, "linked inspection"))}</span>
      </div>
      <div class="ins-related-list">
        ${related.map((r) => {
		const scopes = [r.safety ? "Safety" : "", r.health ? "Health" : ""].filter(Boolean);
		const metaBits = [
			r.rel_label || r.rel_type || "Related",
			...scopes,
			r.cached && r.estab_name ? r.estab_name : "",
			r.cached && r.site_state ? r.site_state : "",
			r.cached && r.penalty_usd ? fmtMoney(r.penalty_usd) : ""
		].filter(Boolean);
		return `
            <a class="ins-related-row" href="#/news/inspection/${r.rel_act_nr}">
              <div class="ins-related-main">
                <span class="ins-related-nr">Inspection #${r.rel_act_nr}</span>
                <span class="ins-related-meta">${escapeHtml(metaBits.join(" · "))}</span>
              </div>
              <span class="ins-related-arrow">${icon("chevronRight")}</span>
            </a>`;
	}).join("")}
      </div>
    </section>`;
}
function renderInspectionCase(data, { enter = true, enriching = false, enrichError = "" } = {}) {
	lastCaseData = data;
	const actNr = data.activity_nr;
	const art = data.article || {};
	const d = data.detail || {};
	const company = d.estab_name || art.company || `Inspection #${actNr}`;
	const docType = d.insp_type_label || art.doc_type || "OSHA inspection";
	const addrParts = [
		d.site_address,
		[d.site_city || art.city, d.site_state || art.state].filter(Boolean).join(", "),
		d.site_zip
	].filter(Boolean);
	const naicsCode = d.naics_code || art.naics;
	const subLine = joinSep([
		escapeHtml(docType),
		addrParts.length ? escapeHtml(addrParts.join(" · ")) : "",
		naicsCode ? `<a class="citation-link" href="#/news?cat=enforcement&naics=${encodeURIComponent(naicsCode)}">NAICS ${escapeHtml(naicsCode)}</a>` : ""
	]);
	const curPen = d.current_penalty_usd ?? art.penalty_usd ?? 0;
	const initPen = d.initial_penalty_usd ?? curPen;
	const deltaUsd = curPen - initPen;
	const deltaPct = initPen > 0 && curPen !== initPen ? Math.round(deltaUsd / initPen * 100) : 0;
	const penSub = deltaPct ? `Initial ${fmtMoney(initPen)} · ${deltaUsd < 0 ? "-" : "+"}${fmtMoney(Math.abs(deltaUsd))} (${deltaPct > 0 ? "+" : ""}${deltaPct}%)` : initPen ? `Initial ${fmtMoney(initPen)}` : "No penalty assessed";
	const violCount = (data.violations || []).length || d.citation_count || 0;
	const vCounts = (data.violations || []).reduce((m, v) => {
		const k = v.viol_label || v.viol_type;
		if (k) m[k] = (m[k] || 0) + 1;
		return m;
	}, {});
	const violSummary = Object.entries(vCounts).map(([k, n]) => `${n} ${k}`).join(", ") || (art.violation_types || []).join(", ") || "Recorded in summary";
	const oshaUrl = safeHttpUrl(art.link || `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${actNr}`);
	const openDt = d.open_date || art.opened_on;
	const modDt = d.case_mod_date;
	const closeDt = d.close_case_date;
	const presentFacts = [
		["Activity #", String(actNr)],
		["Safety / Health", d.safety_hlth_label],
		["Inspection scope", d.insp_scope_label],
		["Ownership", d.owner_type_label],
		["Union status", d.union_status_label],
		["Advance notice", d.adv_notice === "Y" ? "Yes" : d.adv_notice === "N" ? "No" : null],
		["Employees at site", d.nr_in_estab != null ? fmt(d.nr_in_estab) : null],
		["SIC / NAICS", [d.sic_code && `SIC ${d.sic_code}`, (d.naics_code || art.naics) && `NAICS ${d.naics_code || art.naics}`].filter(Boolean).join(" · ") || null],
		["Reporting ID", d.reporting_id]
	].filter((entry) => Boolean(entry[1]));
	const gdcList = data.gdc || [];
	const accidents = data.accidents || [];
	const events = data.events || [];
	const takeaways = art.takeaways || [];
	const statusPill = enriching ? statPill("busy", "Loading DOL case details…") : enrichError ? statPill("stale", enrichError) : data.enriched_at ? statPill("synced", `DOL synced ${timeAgo(Date.parse(data.enriched_at))}`) : "";
	document.title = `${company} · Inspection #${actNr} · FRAMEWORK`;
	dom.view.innerHTML = `
    <div class="news-front ins-front">
      <div class="ins-top-nav">
        <a class="hm-inline-link" href="#/news?cat=enforcement">${icon("chevronLeft")} Back to Enforcement</a>
        <div class="ins-top-status" id="ins-status-slot">${statusPill}</div>
      </div>

      <header class="ins-head">
        <div class="ins-head-copy">
          <div class="doc-kicker">OSHA Enforcement Case File${SEP}Inspection #${actNr}</div>
          <h1 class="doc-title">${escapeHtml(company)}</h1>
          ${subLine ? `<p class="ins-sub">${subLine}</p>` : ""}
        </div>
        <div class="ins-head-acts">
          <button type="button" class="btn btn-sm" data-ins-act="clip">${icon("bookmark")} Clip to Workspace</button>
          ${data.dol_configured ? `<button type="button" class="btn btn-sm" data-ins-act="enrich" data-act-nr="${actNr}"${enriching ? " disabled" : ""}>${icon("activity")} Refresh from DOL</button>` : ""}
          ${oshaUrl ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(oshaUrl)}" title="Opens OSHA.gov (may prompt human verification)">${icon("external")} OSHA.gov</a>` : ""}
        </div>
      </header>

      <section class="ins-metrics" aria-label="Inspection summary">
        ${metricCardHtml({
		label: "Current penalty",
		value: curPen ? escapeHtml(fmtMoney(curPen)) : "$0",
		sub: escapeHtml([penSub, d.fta_total_usd ? `FTA ${fmtMoney(d.fta_total_usd)}` : ""].filter(Boolean).join(" · "))
	})}
        ${metricCardHtml({
		label: "Citations",
		value: violCount ? escapeHtml(plural(violCount, "citation")) : "Summary only",
		sub: escapeHtml(violSummary)
	})}
        ${metricCardHtml({
		label: "Case dates",
		value: art.published_at ? escapeHtml(fmtDate(art.published_at)) : "—",
		sub: escapeHtml([openDt && `Opened ${fmtDate(openDt)}`, closeDt ? `Closed ${fmtDate(closeDt)}` : modDt ? `Modified ${fmtDate(modDt)}` : "Open"].filter(Boolean).join(" · "))
	})}
        ${metricCardHtml({
		label: "Exposure",
		value: d.max_exposed ? escapeHtml(`${fmt(d.max_exposed)} exposed`) : d.nr_in_estab ? escapeHtml(`${fmt(d.nr_in_estab)} at site`) : "—",
		sub: escapeHtml([d.total_instances ? plural(d.total_instances, "instance") : "", d.nr_in_estab && d.max_exposed ? `${fmt(d.nr_in_estab)} at site` : ""].filter(Boolean).join(" · ") || "Site exposure data")
	})}
      </section>

      ${takeaways.length && !(data.violations || []).length ? `
        <section class="ins-panel" aria-label="Cached summary">
          <h2 class="ins-panel-title">Cached Summary</h2>
          <dl class="news-takeaways">${takeaways.map((t) => `<dt>${escapeHtml(t.label)}</dt><dd>${linkifyNewsText(t.text)}</dd>`).join("")}</dl>
          ${inspectionSectionsHtml(data)}
        </section>` : ""}

      <section class="ins-panel" aria-label="Citations and violated standards">
        <div class="ins-panel-head">
          <h2 class="ins-panel-title">Citations &amp; Violated Standards</h2>
          <span class="ins-panel-meta">${violCount ? escapeHtml(plural(violCount, "item")) : "On-demand DOL lookup"}</span>
        </div>
        ${inspectionViolationsHtml(data)}
      </section>

      ${gdcList.length ? `
        <section class="ins-panel" aria-label="General Duty Clause narrative">
          <div class="ins-panel-head">
            <h2 class="ins-panel-title">General Duty Clause — Section 5(a)(1)</h2>
            <span class="ins-panel-meta">${escapeHtml(plural(gdcList.length, "narrative"))}</span>
          </div>
          ${gdcList.map((g) => `
            <div class="ins-narrative">
              <div class="ins-narrative-kicker">Citation ${escapeHtml(g.citation_id)}</div>
              <p>${escapeHtml(g.text)}</p>
            </div>`).join("")}
        </section>` : ""}

      ${inspectionRelatedHtml(data)}

      ${accidents.length ? `
        <section class="ins-panel" aria-label="Accident investigation abstract">
          <div class="ins-panel-head">
            <h2 class="ins-panel-title">Accident / Fatality Investigation</h2>
            <span class="ins-panel-meta">${escapeHtml(plural(accidents.length, "summary"))}</span>
          </div>
          ${accidents.map((ac) => `
            <div class="ins-narrative">
              <div class="ins-narrative-kicker">${escapeHtml([
		ac.event_date && fmtDate(ac.event_date),
		ac.fatality ? "Fatality" : "",
		ac.event_desc
	].filter(Boolean).join(" · "))}</div>
              ${ac.abstract ? `<p>${escapeHtml(ac.abstract)}</p>` : ""}
              ${ac.keywords ? `<div class="ins-keywords">${escapeHtml(ac.keywords)}</div>` : ""}
            </div>`).join("")}
        </section>` : ""}

      ${presentFacts.length || events.length ? `
        <div class="ins-split">
          ${presentFacts.length ? `
            <section class="ins-panel" aria-label="Establishment details">
              <h2 class="ins-panel-title">Establishment &amp; Case File</h2>
              <dl class="ins-meta-list">
                ${presentFacts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}
              </dl>
            </section>` : ""}
          ${events.length ? `
            <section class="ins-panel" aria-label="Penalty and contest history">
              <h2 class="ins-panel-title">Citation Revision Timeline</h2>
              <ol class="ins-events">
                ${events.map((ev) => `
                  <li>
                    <span class="ins-ev-date">${escapeHtml(ev.date ? fmtDate(ev.date) : "—")}</span>
                    <span class="ins-ev-body">
                      <strong>${escapeHtml(ev.event_label)}</strong> · Cit. ${escapeHtml(ev.citation_id)}
                      ${ev.penalty != null ? ` · ${escapeHtml(fmtMoney(ev.penalty))}` : ""}
                    </span>
                  </li>`).join("")}
              </ol>
            </section>` : ""}
        </div>` : ""}
    </div>`;
	if (enter) enterView();
}
async function enrichInspection(activityNr, seq, force = false) {
	try {
		const res = await getJSON(`/api/news/inspection/${activityNr}/enrich${force ? "?force=true" : ""}`, { method: "POST" });
		if (seq !== state.routeSeq) return;
		renderInspectionCase(res, { enter: false });
	} catch (err) {
		if (seq !== state.routeSeq) return;
		const slot = document.getElementById("ins-status-slot");
		if (slot) slot.innerHTML = statPill("stale", (err instanceof Error ? err.message : "") || "Could not enrich from DOL");
		const btn = dom.view.querySelector("[data-ins-act=\"enrich\"]");
		if (btn) btn.disabled = false;
	}
}
async function loadInspection(activityNr) {
	const seq = state.routeSeq;
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	document.title = `Inspection #${activityNr} · FRAMEWORK`;
	dom.view.innerHTML = skeletonHtml("cards", `Loading inspection #${activityNr}…`);
	enterView();
	let data;
	try {
		data = await getJSON(`/api/news/inspection/${activityNr}`);
	} catch (err) {
		if (seq !== state.routeSeq) return;
		dom.view.innerHTML = `
      <div class="news-front ins-front">
        <div class="ins-top-nav"><a class="hm-inline-link" href="#/news?cat=enforcement">${icon("chevronLeft")} Back to Enforcement</a></div>
        <div class="empty-state">
          <h2>Inspection #${activityNr} not found</h2>
          <p>${escapeHtml(err instanceof Error ? err.message : "Not found")}</p>
        </div>
      </div>`;
		return;
	}
	if (seq !== state.routeSeq) return;
	const auto = Boolean(data.needs_enrichment && data.dol_configured && !autoEnrichedCases.has(activityNr));
	renderInspectionCase(data, {
		enter: false,
		enriching: auto
	});
	if (auto) {
		autoEnrichedCases.add(activityNr);
		await enrichInspection(activityNr, seq);
	}
}
// src/views/news.ts
var NEWS_SCOPES = { 29: {
	title: 29,
	agency: "OSHA",
	agencySourceLabel: "OSHA.gov",
	exampleSection: "1910.1030"
} };
function newsScope(titleNum) {
	return NEWS_SCOPES[titleNum && NEWS_SCOPES[titleNum] ? titleNum : 29];
}
function articleNewsTitle(a) {
	if (typeof a.title_num === "number" && a.title_num > 0) return a.title_num;
	const firstPart = a.cfr_parts?.[0]?.title;
	return typeof firstPart === "number" && firstPart > 0 ? firstPart : 29;
}
var NEWS_CATEGORIES = [
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
	},
	{
		key: "agenda",
		label: "Unified Agenda"
	}
];
function newsSnippetHtml(snippet) {
	return escapeHtml(snippet || "").replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
}
var newsState = {
	view: null,
	data: null,
	status: null,
	facets: null,
	summary: null,
	naicsSummary: null,
	dolArchive: {
		loading: false,
		error: "",
		data: null
	},
	watchToken: 0
};
function newsViewFromParams(params) {
	const get = (k) => (params?.get(k) || "").trim();
	const cat = NEWS_CATEGORIES.some((c) => c.key === get("cat")) ? get("cat") : "all";
	const jur = get("jurisdiction");
	const dm = get("dol_mode");
	const ctRaw = get("cfr_title");
	const ctNum = /^\d{1,2}$/.test(ctRaw) ? parseInt(ctRaw, 10) : 0;
	return {
		cat,
		q: get("q"),
		cfr_title: ctNum >= 1 && ctNum <= 50 ? String(ctNum) : "",
		section: get("section"),
		part: get("part"),
		state: /^[A-Za-z]{2}$/.test(get("state")) ? get("state").toUpperCase() : "",
		min_penalty: /^\d+$/.test(get("min_penalty")) ? get("min_penalty") : "",
		gravity: /^[WRSOU]$/.test(get("gravity")) ? get("gravity") : "",
		naics: /^\d{2,6}$/.test(get("naics")) ? get("naics") : "",
		gdc: get("gdc") === "1" || get("gdc") === "true" ? "1" : "",
		fatality: get("fatality") === "1" || get("fatality") === "true" ? "1" : "",
		jurisdiction: jur === "federal" || jur === "state_plan" ? jur : "",
		emphasis: /^[A-Za-z0-9_-]{1,24}$/.test(get("emphasis")) ? get("emphasis").toUpperCase() : "",
		dol_q: get("dol_q"),
		dol_mode: [
			"employer",
			"naics",
			"standard",
			"hazsub"
		].includes(dm) ? dm : get("dol_q") ? "employer" : ""
	};
}
function isDefaultNewsView(view) {
	return !view.q && !view.cfr_title && !view.section && !view.part && !view.state && !view.min_penalty && !view.gravity && !view.naics && !view.gdc && !view.fatality && !view.jurisdiction && !view.emphasis && !view.dol_q;
}
var NEWS_QUERY_KEYS = [
	"q",
	"cfr_title",
	"section",
	"part",
	"state",
	"min_penalty",
	"gravity",
	"naics",
	"gdc",
	"fatality",
	"jurisdiction",
	"emphasis",
	"dol_q",
	"dol_mode"
];
function newsHash(view) {
	const p = new URLSearchParams();
	if (view.cat && view.cat !== "all") p.set("cat", view.cat);
	for (const k of NEWS_QUERY_KEYS) if (view[k]) p.set(k, view[k]);
	const qs = p.toString();
	return "#/news" + (qs ? "?" + qs : "");
}
function newsApiUrl(view, offset = 0) {
	const p = new URLSearchParams();
	if (view.cat && view.cat !== "all") p.set("category", view.cat);
	for (const k of NEWS_QUERY_KEYS) {
		if (k === "dol_q" || k === "dol_mode") continue;
		if (view[k]) p.set(k, view[k]);
	}
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
	const guids = (d) => (d?.articles || []).map((a) => a.guid || "").join("|");
	const oks = (s) => s?.sources ? Object.values(s.sources).map((x) => x.last_ok_at || "").join("|") : "";
	return guids(oldData) !== guids(newData) || oks(oldStatus) !== oks(newStatus);
}
function preservingNewsScroll(fn) {
	const mainRect = dom.main.getBoundingClientRect();
	let anchor = null;
	let offset = 0;
	for (const el of dom.view.querySelectorAll("[data-guid]")) {
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
			dom.main.scrollTop += r.top - dom.main.getBoundingClientRect().top - offset;
			return;
		}
	}
	dom.main.scrollTop = top;
}
async function loadNews(params) {
	const seq = state.routeSeq;
	state.currentSection = null;
	state.currentPart = null;
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
		dom.view.innerHTML = skeletonHtml("cards", "Loading news…");
		if (firstPaint) enterView();
	}
	let data;
	let status;
	try {
		const wantEnf = view.cat === "enforcement";
		const [feedRes, statusRes] = await Promise.all([getJSON(newsApiUrl(view)), getJSON("/api/news/status")]);
		data = feedRes;
		status = statusRes;
		if (wantEnf) {
			const extras = [];
			if (status.dol_configured && !newsState.facets) extras.push(getJSON("/api/news/facets").then((f) => {
				newsState.facets = f;
			}).catch(() => {}));
			if (view.naics) {
				const fed = view.jurisdiction === "federal" ? "?federal_only=true" : "";
				extras.push(getJSON(`/api/news/enforcement/naics/${encodeURIComponent(view.naics)}${fed}`).then((n) => {
					newsState.naicsSummary = n;
				}).catch(() => {
					newsState.naicsSummary = null;
				}));
			} else newsState.naicsSummary = null;
			extras.push(getJSON("/api/news/enforcement/summary").then((s) => {
				newsState.summary = s;
			}).catch(() => {}));
			await Promise.all(extras);
		} else newsState.naicsSummary = null;
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
			showToast("Could not reach the news service");
		}
		return;
	}
	if (seq !== state.routeSeq) return;
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
	if (!cached || !cached.data || !cachedStatus || !cachedStatus.data || newsChanged(cached.data, data, cachedStatus.data, status) || view.cat === "enforcement") preservingNewsScroll(() => renderNews(view, data, status, { enter: firstPaint && !(cached && cached.data) }));
	else {
		newsState.view = view;
		newsState.data = data;
		newsState.status = status;
	}
	let watch = Boolean(status.syncing);
	if (status.sync_enabled && status.due && !status.syncing) {
		try {
			watch = ((await getJSON("/api/news/refresh", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ force: false })
			})).queued || []).length > 0;
		} catch {
			try {
				watch = Boolean((await getJSON("/api/news/status")).syncing);
			} catch {
				watch = false;
			}
		}
		if (seq !== state.routeSeq) return;
	}
	if (watch) watchNewsSync(seq, view);
	if (view.cat === "enforcement" && view.dol_q && status.dol_configured) runDolArchiveSearch({
		q: view.dol_q,
		mode: view.dol_mode || "employer",
		state: view.state
	}, seq, false);
	else if (!view.dol_q) newsState.dolArchive = {
		loading: false,
		error: "",
		data: null
	};
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
		if (seq !== state.routeSeq || token !== newsState.watchToken || Date.now() - started > 12e4) return;
		let status;
		try {
			status = await getJSON("/api/news/status");
		} catch {
			return;
		}
		if (seq !== state.routeSeq || token !== newsState.watchToken) return;
		if (status.syncing) {
			setTimeout(tick, 3e3);
			return;
		}
		let data;
		try {
			data = await getJSON(newsApiUrl(view));
		} catch {
			return;
		}
		if (seq !== state.routeSeq || token !== newsState.watchToken) return;
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
		if (routeTarget() === "news" && newsState.view) watchNewsSync(state.routeSeq, newsState.view);
	} catch (err) {
		const m = err instanceof Error ? err.message : String(err);
		showToast(/already running/i.test(m) ? "Already checking for news" : /sync is off/i.test(m) ? "News sync is off" : m);
	}
}
function newsHeadStatusHtml(status) {
	if (!status) return "";
	const pill = newsStatusPillHtml(status);
	if (!status.sync_enabled || status.syncing) return pill;
	const enabled = Object.values(status.sources || {}).filter((s) => s.enabled);
	const lastOk = enabled.map((s) => s.last_ok_at).filter(Boolean).sort().pop();
	if (enabled.find((s) => s.last_error) && lastOk) return `${pill} <button type="button" class="btn btn-sm" data-news-act="refresh">Retry</button>`;
	return `${pill} <button type="button" class="btn btn-sm" data-news-act="refresh">Refresh</button>`;
}
function newsBreakingHtml(articles) {
	const today = Date.now();
	const daysAgo = (iso) => (today - Date.parse(iso + "T00:00:00")) / 864e5;
	const pi = articles.find((a) => a.category === "public_inspection" && daysAgo(a.published_at) <= 3);
	const fine = articles.find((a) => a.category === "enforcement" && (a.penalty_usd || 0) >= 5e4 && daysAgo(a.published_at) <= 14);
	const hit = pi || fine;
	if (!hit) return "";
	const tag = pi ? "Public inspection" : "Enforcement";
	const actNr = !pi ? inspectionActivityNr(hit) : null;
	const href = pi ? safeHttpUrl(hit.link) : actNr ? `#/news/inspection/${actNr}` : "#/news?cat=enforcement";
	const ext = pi && href ? " target=\"_blank\" rel=\"noopener\"" : "";
	if (!href) return "";
	return `<a class="news-breaking" href="${escapeHtml(href)}"${ext}>
    <span class="news-breaking-tag">${icon("activity")} ${escapeHtml(tag.toUpperCase())} · ${escapeHtml(fmtDate(hit.published_at))}</span>
    <span class="news-breaking-text">${escapeHtml(hit.title)}</span>${icon("chevronRight")}</a>`;
}
function newsChipsHtml(a) {
	const chips = [];
	const defaultTitle = articleNewsTitle(a);
	for (const r of a.cfr_parts || []) {
		const href = newsPartHref(r.title, r.part);
		const dim = !titleInstalled(r.title);
		chips.push(`<a class="citation-chip${dim ? " is-dim" : ""}" data-ref-tier="${dim ? "uninstalled" : "cfr"}" href="${href}"${dim ? ` title="Title ${r.title} isn’t installed. Open the library"` : ""}>${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
	}
	for (const s of a.sections || []) {
		const dim = !titleInstalled(defaultTitle);
		chips.push(`<a class="citation-chip${dim ? " is-dim" : ""}" data-ref-tier="${dim ? "uninstalled" : "cfr"}" href="${newsSectionHref(defaultTitle, s)}"${dim ? ` title="Title ${defaultTitle} isn’t installed. Open the library"` : ""}>§ ${escapeHtml(s)}</a>`);
	}
	if (!chips.length) return "";
	const extra = chips.length - 6;
	return `<div class="news-chips">${extra > 0 ? chips.slice(0, 6).join("") + chips.slice(6).map((c) => c.replace("citation-chip", "citation-chip is-extra")).join("") + `<button type="button" class="citation-chip news-chip-more" data-news-act="expand-chips">+${extra}</button>` : chips.join("")}</div>`;
}
function newsActionsHtml(a) {
	const out = [];
	const defaultTitle = articleNewsTitle(a);
	const scope = newsScope(defaultTitle);
	const actNr = inspectionActivityNr(a);
	const frDoc = !actNr ? frDocumentNumber(a) : null;
	if (actNr) out.push(`<a class="btn btn-sm btn-accent" href="#/news/inspection/${actNr}">${icon("file")} Case file</a>`);
	else if (frDoc) out.push(`<a class="btn btn-sm btn-accent" href="#/news/fr/${encodeURIComponent(frDoc)}">${icon("file")} Full text</a>`);
	const srcLabel = a.source === "dol_osha" ? scope.agencySourceLabel : "Federal Register";
	const link = safeHttpUrl(a.link);
	if (link) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(link)}">${icon("external")} ${escapeHtml(srcLabel)}</a>`);
	const pdf = safeHttpUrl(a.pdf_url || "");
	if (pdf) out.push(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(pdf)}">${icon("external")} PDF</a>`);
	const sec = (a.sections || [])[0];
	const partRef = (a.cfr_parts || [])[0];
	const secCls = actNr || frDoc ? "btn btn-sm" : "btn btn-sm btn-accent";
	if (sec) out.push(`<a class="${secCls}" href="${newsSectionHref(defaultTitle, sec)}">${icon("book")} Open § ${escapeHtml(sec)}</a>`);
	else if (partRef) out.push(`<a class="${secCls}" href="${newsPartHref(partRef.title, partRef.part)}">${icon("book")} Open Part ${escapeHtml(String(partRef.part))}</a>`);
	return out.join("");
}
function newsCardHtml(a, { hero = false } = {}) {
	const tag = hero ? "section" : "article";
	const figure = a.penalty_usd ? `<span class="news-figure">${escapeHtml(fmtMoney(a.penalty_usd))}</span>` : "";
	const rows = (a.takeaways || []).map((t, i) => {
		const text = i === 0 && a.snippet ? newsSnippetHtml(a.snippet) : linkifyNewsText(t.text);
		return `<dt>${escapeHtml(t.label)}</dt><dd>${text}</dd>`;
	}).join("");
	const actNr = inspectionActivityNr(a);
	const frDoc = !actNr ? frDocumentNumber(a) : null;
	const titleHtml = actNr ? `<a href="#/news/inspection/${actNr}">${escapeHtml(a.title)}</a>` : frDoc ? `<a href="#/news/fr/${encodeURIComponent(frDoc)}">${escapeHtml(a.title)}</a>` : extLink(a.link, escapeHtml(a.title));
	return `
    <${tag} class="news-card${hero ? " news-hero" : ""}" data-guid="${escapeHtml(a.guid || "")}" data-cat="${escapeHtml(a.category)}">
      <div class="news-card-top"><span class="news-kicker">${escapeHtml(newsKicker(a))}</span>${figure}</div>
      <h3 class="news-card-title">${titleHtml}</h3>
      ${newsBylineHtml(a)}
      ${rows ? `<dl class="news-takeaways">${rows}</dl>` : ""}
      ${newsChipsHtml(a)}
      <div class="news-card-foot">${newsActionsHtml(a)}</div>
    </${tag}>`;
}
function newsTabsHtml(view, status) {
	const counts = status?.counts || {};
	return `<div class="lib-seg news-tabs" role="tablist" aria-label="News categories">${NEWS_CATEGORIES.map((c) => {
		const on = view.cat === c.key;
		const n = counts[c.key];
		return `<button type="button" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-pressed="${on}" data-news-cat="${c.key}">${escapeHtml(c.label)}${n ? ` <span class="news-tab-count">${n}</span>` : ""}</button>`;
	}).join("")}</div>`;
}
function newsFilterChipsHtml(view) {
	const chips = [];
	const chip = (key, label) => chips.push(`<button type="button" class="news-filter-chip" data-news-act="clear-filter" data-filter-key="${key}" aria-label="Remove filter: ${escapeHtml(label)}">${escapeHtml(label)}${icon("close")}</button>`);
	if (view.cfr_title) chip("cfr_title", `${view.cfr_title} CFR`);
	if (view.section) chip("section", `Citing § ${view.section}`);
	if (view.part) chip("part", `Citing Part ${view.part}`);
	if (view.state) chip("state", stateName(view.state));
	if (view.min_penalty) chip("min_penalty", `Over ${fmtMoney(Number(view.min_penalty))}`);
	if (view.gravity) chip("gravity", {
		W: "Willful",
		R: "Repeat",
		S: "Serious",
		O: "Other-than-Serious",
		U: "Unclassified"
	}[view.gravity] || view.gravity);
	if (view.naics) chip("naics", `NAICS ${view.naics}`);
	if (view.gdc) chip("gdc", "General Duty 5(a)(1)");
	if (view.fatality) chip("fatality", "Fatality / Accident");
	if (view.jurisdiction === "federal") chip("jurisdiction", "Federal OSHA");
	else if (view.jurisdiction === "state_plan") chip("jurisdiction", "State Plan");
	if (view.emphasis) chip("emphasis", `Emphasis ${view.emphasis}`);
	return chips.length ? `<div class="news-filter-chips">${chips.join("")}</div>` : "";
}
function newsFacetsHtml(view, status) {
	if (view.cat !== "enforcement" || !status || !status.dol_configured) return "";
	const states = newsState.facets?.states || [];
	const naicsList = newsState.facets?.top_naics || [];
	const emphList = newsState.facets?.emphasis_codes || [];
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
    <select data-news-facet="jurisdiction" aria-label="Jurisdiction">
      <option value="">Federal &amp; State Plan</option>
      <option value="federal"${sel("federal", view.jurisdiction)}>Federal OSHA</option>
      <option value="state_plan"${sel("state_plan", view.jurisdiction)}>State Plan</option>
    </select>
    ${naicsList.length ? `<select data-news-facet="naics" aria-label="Industry NAICS">
      <option value="">All industries (NAICS)</option>
      ${naicsList.map((n) => `<option value="${escapeHtml(n.code)}"${sel(n.code, view.naics)}>NAICS ${escapeHtml(n.code)} (${n.count})</option>`).join("")}
    </select>` : ""}
    ${emphList.length ? `<select data-news-facet="emphasis" aria-label="Emphasis program">
      <option value="">All emphasis programs</option>
      ${emphList.map((e) => `<option value="${escapeHtml(e.code)}"${sel(e.code, view.emphasis)}>${escapeHtml(e.code)} (${e.count})</option>`).join("")}
    </select>` : ""}
    <button type="button" class="btn btn-sm${view.gdc ? " is-active" : ""}" data-news-toggle="gdc" aria-pressed="${Boolean(view.gdc)}">5(a)(1) General Duty</button>
    <button type="button" class="btn btn-sm${view.fatality ? " is-active" : ""}" data-news-toggle="fatality" aria-pressed="${Boolean(view.fatality)}">Fatality / Accident</button>
  </div>`;
}
function newsEmptyHtml(view, status) {
	const s = status || {};
	if (!s.sync_enabled && !(s.counts && s.counts.all)) return `<div class="empty-state"><h2>News sync is off</h2>
      <p>Set <code>NEWS_SYNC=1</code> in <code>reader/.env</code> and restart FRAMEWORK.</p></div>`;
	if (view.cat === "enforcement" && !view.q && !s.dol_configured) return `<div class="news-setup">
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
      <p>${escapeHtml(failed.last_error || "")}</p>${retry}
      <button type="button" class="btn" data-news-act="refresh">Retry</button></div>`;
	}
	if (neverSynced) return `<div class="empty-state">${statPill("busy", "Fetching from the Federal Register…")}
      <p class="dr-note">The first sync takes a few seconds.</p></div>`;
	return "<div class=\"empty-state\"><h2>Nothing here yet</h2><p>No items in this view.</p></div>";
}
function enforcementSummaryHtml(view) {
	const s = newsState.summary;
	if (view.cat !== "enforcement" || !isDefaultNewsView(view) || !s || !s.total_cases) return "";
	const scope = newsScope(state.currentTitle);
	const g = s.gravity_counts || {};
	const highGrav = (g.W || 0) + (g.R || 0);
	const topSec = (s.top_sections || [])[0];
	const topState = (s.top_states || [])[0];
	return `
    <section class="ins-summary-strip" aria-label="Enforcement telemetry">
      ${metricCardHtml({
		label: "Tracked penalties",
		value: escapeHtml(fmtMoney(s.total_penalty_usd || 0)),
		sub: escapeHtml([
			`${plural(s.total_cases, "case")} · avg ${fmtMoney(s.avg_penalty_usd || 0)}`,
			s.contested_cases ? `${s.contested_cases} contested` : "",
			s.fta_cases ? `${s.fta_cases} FTA` : ""
		].filter(Boolean).join(" · "))
	})}
      ${metricCardHtml({
		label: "High gravity",
		value: fmt(highGrav),
		of: "cases",
		sub: joinSep([g.W ? `<button type="button" class="metric-link" data-news-quick-gravity="W">${g.W} Willful</button>` : "0 Willful", g.R ? `<button type="button" class="metric-link" data-news-quick-gravity="R">${g.R} Repeat</button>` : "0 Repeat"])
	})}
      ${topSec ? metricCardHtml({
		label: "Top cited standard",
		value: `<a class="ins-tile-link" href="${newsSectionHref(scope.title, topSec.section_id)}">§ ${escapeHtml(topSec.section_id)}</a>`,
		sub: `<button type="button" class="metric-link" data-news-quick-sec="${escapeHtml(topSec.section_id)}">Filter ${plural(topSec.count, "case")} ${icon("chevronRight")}</button>`
	}) : metricCardHtml({
		label: "Top cited standard",
		value: "—",
		sub: "No CFR mappings yet"
	})}
      ${topState ? metricCardHtml({
		label: "Top state",
		value: escapeHtml(stateName(topState.code)),
		sub: `<button type="button" class="metric-link" data-news-quick-state="${escapeHtml(topState.code)}">${escapeHtml(fmtMoney(topState.total_penalty_usd))} · ${plural(topState.count, "case")} ${icon("chevronRight")}</button>`
	}) : metricCardHtml({
		label: "Top state",
		value: "—",
		sub: "No state data"
	})}
    </section>`;
}
function naicsBenchmarkHtml(view) {
	const n = newsState.naicsSummary;
	if (view.cat !== "enforcement" || !view.naics || !n || !n.case_count) return "";
	const scope = newsScope(state.currentTitle);
	const secs = (n.top_sections || []).slice(0, 6);
	return `
    <section class="ins-panel ins-naics-bench" aria-label="NAICS industry benchmark">
      <div class="ins-panel-head">
        <h2 class="ins-panel-title">Industry Benchmark · NAICS ${escapeHtml(n.naics)}</h2>
        <span class="ins-panel-meta">${escapeHtml([
		plural(n.case_count, "case"),
		fmtMoney(n.total_penalty_usd),
		n.gdc_count ? `${n.gdc_count} GDC` : "",
		n.fatality_count ? `${n.fatality_count} fatality` : ""
	].filter(Boolean).join(" · "))}</span>
      </div>
      ${secs.length ? `<div class="news-chips">${secs.map((s) => `<a class="citation-chip" href="${newsSectionHref(scope.title, s.section_id)}">§ ${escapeHtml(s.section_id)} (${s.count})</a>`).join("")}</div>` : "<p class=\"ins-muted\">No Federal 29 CFR sections mapped yet for this NAICS.</p>"}
    </section>`;
}
function dolArchiveHtml(view, status) {
	if (view.cat !== "enforcement" || !status?.dol_configured) return "";
	const d = newsState.dolArchive;
	const mode = view.dol_mode || d.data?.mode || "employer";
	const sel = (v) => v === mode ? " selected" : "";
	let bodyHtml = "";
	if (d.loading) bodyHtml = `<div class="dol-archive-status">${statPill("busy", "Searching DOL Open Data API v4…")}</div>`;
	else if (d.error) bodyHtml = `<div class="dol-archive-status">${statPill("stale", d.error)}</div>`;
	else if (d.data) {
		const rows = d.data.results || [];
		if (!rows.length) bodyHtml = `<p class="ins-muted">No live DOL inspections matched “${escapeHtml(d.data.query)}”.</p>`;
		else bodyHtml = `
        <div class="dol-archive-meta">${escapeHtml(`${rows.length} live ${rows.length === 1 ? "result" : "results"}`)}${d.data.cached ? " · cached" : ""}</div>
        <div class="dol-archive-list">
          ${rows.map((r) => {
			const loc = [r.site_city, r.site_state].filter(Boolean).join(", ");
			const meta = [
				r.insp_type_label || "OSHA inspection",
				loc,
				r.naics_code ? `NAICS ${r.naics_code}` : "",
				r.open_date ? fmtDate(r.open_date) : "",
				r.matched_standard || "",
				r.current_penalty ? fmtMoney(r.current_penalty) : "",
				(r.hazsubs || []).length ? r.hazsubs.join(", ") : ""
			].filter(Boolean).join(" · ");
			return `
              <a class="ins-related-row" href="#/news/inspection/${r.activity_nr}">
                <div class="ins-related-main">
                  <span class="ins-related-nr">${escapeHtml(r.estab_name)} <span class="dol-act-id">#${r.activity_nr}</span></span>
                  <span class="ins-related-meta">${escapeHtml(meta)}</span>
                </div>
                <span class="ins-related-arrow">${icon("chevronRight")}</span>
              </a>`;
		}).join("")}
        </div>
        ${d.data.has_more ? `<div class="dol-archive-more"><button type="button" class="btn btn-sm" data-news-act="dol-more">Load next 25</button></div>` : ""}`;
	}
	return `
    <section class="ins-panel dol-archive-panel" aria-label="Search full DOL archive">
      <div class="ins-panel-head">
        <h2 class="ins-panel-title">Search Full DOL Archive</h2>
        <span class="ins-panel-meta">Explicit submit only · cached 10m</span>
      </div>
      <form class="dol-archive-form" data-dol-search>
        <select name="mode" aria-label="DOL search mode">
          <option value="employer"${sel("employer")}>Employer</option>
          <option value="naics"${sel("naics")}>NAICS</option>
          <option value="standard"${sel("standard")}>29 CFR Section</option>
          <option value="hazsub"${sel("hazsub")}>Hazard Substance</option>
        </select>
        <input type="search" name="q" class="news-q dol-q-input" value="${escapeHtml(view.dol_q)}"
          placeholder="e.g. Amazon, 238160, 1910.147, or Silica…" aria-label="DOL archive query" autocomplete="off">
        <button type="submit" class="btn btn-sm btn-accent">Search DOL</button>
      </form>
      <div id="dol-archive-body">${bodyHtml}</div>
    </section>`;
}
async function runDolArchiveSearch(opts, seq, append = false) {
	const q = opts.q.trim();
	if (!q) return;
	newsState.dolArchive = {
		loading: !append,
		error: "",
		data: append ? newsState.dolArchive.data : null
	};
	const body = document.getElementById("dol-archive-body");
	if (body && !append) body.innerHTML = `<div class="dol-archive-status">${statPill("busy", "Searching DOL Open Data API v4…")}</div>`;
	try {
		const p = new URLSearchParams({
			q,
			mode: opts.mode || "employer",
			limit: "25"
		});
		if (opts.state) p.set("state", opts.state);
		if (opts.offset) p.set("offset", String(opts.offset));
		const res = await getJSON(`/api/news/dol/search?${p.toString()}`);
		if (seq !== state.routeSeq) return;
		if (append && newsState.dolArchive.data) {
			const seen = new Set(newsState.dolArchive.data.results.map((r) => r.activity_nr));
			const merged = newsState.dolArchive.data.results.concat(res.results.filter((r) => !seen.has(r.activity_nr)));
			newsState.dolArchive = {
				loading: false,
				error: "",
				data: {
					...res,
					results: merged
				}
			};
		} else newsState.dolArchive = {
			loading: false,
			error: "",
			data: res
		};
	} catch (err) {
		if (seq !== state.routeSeq) return;
		newsState.dolArchive = {
			loading: false,
			error: err instanceof Error ? err.message : "DOL search failed",
			data: append ? newsState.dolArchive.data : null
		};
	}
	if (newsState.view && newsState.status) {
		const panel = dom.view.querySelector(".dol-archive-panel");
		if (panel) panel.outerHTML = dolArchiveHtml(newsState.view, newsState.status);
	}
}
function renderNews(view, data, status, opts = {}) {
	newsState.view = view;
	newsState.data = data;
	newsState.status = status;
	const scope = newsScope(state.currentTitle);
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
		start: qEl.selectionStart ?? qEl.value.length,
		end: qEl.selectionEnd ?? qEl.value.length
	} : null;
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
      ${dolArchiveHtml(view, status)}
      ${naicsBenchmarkHtml(view)}
      ${enforcementSummaryHtml(view)}
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
			} catch {}
		}
	}
}
async function loadMoreNews() {
	const seq = state.routeSeq;
	const { view, data } = newsState;
	if (!view || !data) return;
	let page;
	try {
		page = await getJSON(newsApiUrl(view, data.articles.length));
	} catch {
		return;
	}
	if (seq !== state.routeSeq || newsState.data !== data) return;
	data.articles = data.articles.concat(page.articles || []);
	data.total = page.total;
	const grid = document.getElementById("news-grid");
	if (grid) {
		const shown = new Set([...dom.view.querySelectorAll("[data-guid]")].map((el) => el.dataset.guid));
		grid.insertAdjacentHTML("beforeend", (page.articles || []).filter((a) => !shown.has(a.guid)).map((a) => newsCardHtml(a)).join(""));
	}
	const moreBtn = dom.view.querySelector("[data-news-act=\"more\"]");
	if (moreBtn && data.articles.length >= data.total) moreBtn.closest(".news-more")?.remove();
}
onView("click", (e) => {
	const target = e.target;
	if (!target) return;
	const tab = target.closest("[data-news-cat]");
	if (tab && newsState.view) {
		setNewsView({
			...newsState.view,
			cat: tab.dataset.newsCat || "all"
		});
		return;
	}
	const qGrav = target.closest("[data-news-quick-gravity]");
	if (qGrav && newsState.view) {
		setNewsView({
			...newsState.view,
			cat: "enforcement",
			gravity: qGrav.dataset.newsQuickGravity || ""
		}, { replace: true });
		return;
	}
	const qSec = target.closest("[data-news-quick-sec]");
	if (qSec && newsState.view) {
		setNewsView({
			...newsState.view,
			cat: "enforcement",
			section: qSec.dataset.newsQuickSec || ""
		}, { replace: true });
		return;
	}
	const qState = target.closest("[data-news-quick-state]");
	if (qState && newsState.view) {
		setNewsView({
			...newsState.view,
			cat: "enforcement",
			state: qState.dataset.newsQuickState || ""
		}, { replace: true });
		return;
	}
	const tog = target.closest("[data-news-toggle]");
	if (tog && newsState.view && tog.dataset.newsToggle) {
		const k = tog.dataset.newsToggle;
		setNewsView({
			...newsState.view,
			cat: "enforcement",
			[k]: newsState.view[k] ? "" : "1"
		}, { replace: true });
		return;
	}
	const insAct = target.closest("[data-ins-act=\"enrich\"]");
	if (insAct) {
		const actNr = parseInt(insAct.dataset.actNr || "", 10);
		if (!Number.isNaN(actNr)) {
			insAct.disabled = true;
			const slot = document.getElementById("ins-status-slot");
			if (slot) slot.innerHTML = statPill("busy", "Refreshing from DOL…");
			enrichInspection(actNr, state.routeSeq, true);
		}
		return;
	}
	if (target.closest("[data-ins-act=\"clip\"]")) {
		clipCurrentInspection();
		return;
	}
	const act = target.closest("[data-news-act]");
	if (!act) return;
	const kind = act.dataset.newsAct;
	if (kind === "refresh") refreshNewsCommand();
	else if (kind === "reload") emit("route:refresh");
	else if (kind === "more") loadMoreNews();
	else if (kind === "dol-more" && newsState.dolArchive.data && newsState.view) {
		const prev = newsState.dolArchive.data;
		runDolArchiveSearch({
			q: prev.query,
			mode: prev.mode,
			state: newsState.view.state,
			offset: prev.offset + prev.limit
		}, state.routeSeq, true);
	} else if (kind === "search-all" && newsState.view) setNewsView({
		...newsState.view,
		cat: "all"
	});
	else if (kind === "clear-filter" && newsState.view && act.dataset.filterKey) setNewsView({
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
state.newsQTimer = null;
onView("input", (e) => {
	const target = e.target;
	if (!target || target.id !== "news-q" || !newsState.view) return;
	clearTimeout(state.newsQTimer);
	const q = target.value.trim();
	state.newsQTimer = setTimeout(() => {
		if (newsState.view && q !== newsState.view.q) setNewsView({
			...newsState.view,
			q
		}, { replace: true });
	}, 250);
});
onView("keydown", (e) => {
	const ke = e;
	const target = e.target;
	if (!target) return;
	if (target.id === "news-q" && ke.key === "Escape" && target.value) {
		target.value = "";
		if (newsState.view && newsState.view.q) setNewsView({
			...newsState.view,
			q: ""
		}, { replace: true });
		return;
	}
	const tab = target.closest(".news-tabs [role=\"tab\"]");
	if (!tab) return;
	if (![
		"ArrowLeft",
		"ArrowRight",
		"Home",
		"End"
	].includes(ke.key)) return;
	ke.preventDefault();
	const tabs = [...dom.view.querySelectorAll(".news-tabs [role=\"tab\"]")];
	const i = tabs.indexOf(tab);
	tabs[ke.key === "Home" ? 0 : ke.key === "End" ? tabs.length - 1 : (i + (ke.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length].focus();
});
onView("change", (e) => {
	const facet = e.target?.closest("[data-news-facet]");
	if (!facet || !newsState.view || !facet.dataset.newsFacet) return;
	setNewsView({
		...newsState.view,
		[facet.dataset.newsFacet]: facet.value
	}, { replace: true });
});
onView("submit", (e) => {
	const form = e.target?.closest("[data-dol-search]");
	if (!form || !newsState.view) return;
	e.preventDefault();
	const fd = new FormData(form);
	const q = String(fd.get("q") || "").trim();
	const mode = String(fd.get("mode") || "employer").trim();
	if (!q) return;
	const next = {
		...newsState.view,
		cat: "enforcement",
		dol_q: q,
		dol_mode: mode
	};
	history.replaceState(null, "", newsHash(next));
	newsState.view = next;
	runDolArchiveSearch({
		q,
		mode,
		state: next.state
	}, state.routeSeq, false);
});
on("news:refresh", () => refreshNewsCommand());
on("env:saved", () => {
	if (routeTarget() === "news") emit("route:refresh");
});
// src/views/news_fr.ts
function articleTitleNum(a) {
	if (!a) return 29;
	if (typeof a.title_num === "number" && a.title_num > 0) return a.title_num;
	const firstPart = a.cfr_parts?.[0]?.title;
	return typeof firstPart === "number" && firstPart > 0 ? firstPart : 29;
}
function frDocChipsHtml(a) {
	if (!a) return "";
	const chips = [];
	const defaultTitle = articleTitleNum(a);
	for (const r of a.cfr_parts || []) {
		const dim = !titleInstalled(r.title);
		chips.push(`<a class="citation-chip${dim ? " is-dim" : ""}" data-ref-tier="${dim ? "uninstalled" : "cfr"}" href="${newsPartHref(r.title, r.part)}">${r.title} CFR Part ${escapeHtml(String(r.part))}</a>`);
	}
	for (const s of a.sections || []) {
		const dim = !titleInstalled(defaultTitle);
		chips.push(`<a class="citation-chip${dim ? " is-dim" : ""}" data-ref-tier="${dim ? "uninstalled" : "cfr"}" href="${newsSectionHref(defaultTitle, s)}">§ ${escapeHtml(s)}</a>`);
	}
	return chips.length ? `<div class="news-chips fr-doc-chips">${chips.join("")}</div>` : "";
}
function renderFrDocument(data) {
	const art = data.article;
	const docNum = data.document_number;
	const title = art?.title || `Federal Register Document ${docNum}`;
	document.title = `${title} · Federal Register · FRAMEWORK`;
	const kicker = art ? newsKicker(art) : `FEDERAL REGISTER · ${docNum}`;
	const link = safeHttpUrl(art?.link);
	const pdf = safeHttpUrl(art?.pdf_url || "");
	const metaBits = [];
	if (art?.published_at) metaBits.push(`Published ${fmtDate(art.published_at)}`);
	if (art?.effective_on) metaBits.push(`Effective ${fmtDate(art.effective_on)}`);
	if (art?.comments_close_on) metaBits.push(`Comments close ${fmtDate(art.comments_close_on)}`);
	if (art?.docket_ids?.length) metaBits.push(`Docket ${art.docket_ids[0]}`);
	if (art?.agency) metaBits.push(art.agency.replace(/-/g, " "));
	const actionsHtml = [
		`<a class="btn btn-sm" href="#/news">${icon("chevronLeft")} All news</a>`,
		link ? `<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${escapeHtml(link)}">${icon("external")} Federal Register</a>` : "",
		pdf ? `<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${escapeHtml(pdf)}">${icon("external")} PDF</a>` : ""
	].filter(Boolean).join("");
	const bodySection = data.body_html ? `<div class="fr-doc-body reg-prose">${sanitizeHtml(data.body_html)}</div>` : `<div class="empty-state"><h2>Full preamble unavailable</h2><p>The Federal Register did not provide inline HTML for document <code>${escapeHtml(docNum)}</code>.${link ? ` <a target="_blank" rel="noopener noreferrer" href="${escapeHtml(link)}">Read on FederalRegister.gov</a>.` : ""}</p></div>`;
	dom.view.innerHTML = `<div class="fr-doc-page">
    <header class="fr-doc-head">
      <div class="news-kicker">${escapeHtml(kicker)}</div>
      <h1 class="fr-doc-title">${escapeHtml(title)}</h1>
      ${art ? newsBylineHtml(art) : ""}
      ${metaBits.length ? `<div class="fr-doc-meta">${joinSep(metaBits.map((b) => escapeHtml(b)))}</div>` : ""}
      ${art?.action ? `<p class="fr-doc-action">${escapeHtml(art.action)}</p>` : ""}
      ${frDocChipsHtml(art)}
      <div class="fr-doc-actions">${actionsHtml}</div>
    </header>
    ${bodySection}
  </div>`;
	enterView();
}
async function loadFrDocument(documentNumber) {
	const seq = state.routeSeq;
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
	document.title = `Federal Register ${documentNumber} · FRAMEWORK`;
	dom.view.innerHTML = skeletonHtml("doc", `Loading ${documentNumber}…`);
	dom.main.scrollTop = 0;
	try {
		const data = await getJSON(`/api/news/fr/${encodeURIComponent(documentNumber)}`, { signal: state.routeAbort?.signal });
		if (seq !== state.routeSeq) return;
		renderFrDocument(data);
	} catch (err) {
		if (err?.name === "AbortError" || seq !== state.routeSeq) return;
		const msg = err instanceof Error ? err.message : "Could not load Federal Register document.";
		dom.view.innerHTML = emptyStateHtml({
			title: "Document unavailable",
			body: msg,
			actionsHtml: "<a class=\"btn btn-sm\" href=\"#/news\">Back to News</a>"
		});
	}
}
var AGENDA_TAB_HREF = "#/news?cat=agenda";
var agendaHref = (rin, edition) => `#/news/agenda/${encodeURIComponent(rin)}${edition ? `?edition=${encodeURIComponent(edition)}` : ""}`;
/** The stages, in the order a rule moves through them, with short names for chips. */
var AGENDA_STAGES = [
	{
		key: "prerule",
		label: "Prerule Stage",
		short: "Prerule"
	},
	{
		key: "proposed",
		label: "Proposed Rule Stage",
		short: "Proposed rule"
	},
	{
		key: "final",
		label: "Final Rule Stage",
		short: "Final rule"
	},
	{
		key: "long_term",
		label: "Long-Term Actions",
		short: "Long-term"
	},
	{
		key: "completed",
		label: "Completed Actions",
		short: "Completed"
	}
];
var stageShort = (label) => AGENDA_STAGES.find((s) => s.label === label)?.short || label || "";
var stageKey = (label) => AGENDA_STAGES.find((s) => s.label === label)?.key || "";
/** "202510" → "Fall 2025", "202504" → "Spring 2025", "201200" (annual) → "2012". */
function editionLabel(ed) {
	const m = /^(\d{4})(\d{2})$/.exec(ed || "");
	if (!m) return ed || "";
	const month = parseInt(m[2], 10);
	if (!month) return m[1];
	return `${month >= 7 ? "Fall" : "Spring"} ${m[1]}`;
}
var MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
/** Timetable dates: "10/00/2025" (month only) → "Oct 2025", "03/15/2026" → "Mar 15, 2026"; else as given ("To Be Determined"). */
function agendaDate(d) {
	const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((d || "").trim());
	if (!m) return (d || "").trim();
	const mon = MONTHS[parseInt(m[1], 10) - 1];
	if (!mon) return d || "";
	const day = parseInt(m[2], 10);
	return day ? `${mon} ${day}, ${m[3]}` : `${mon} ${m[3]}`;
}
/** "29 CFR 1910" / "40 CFR 261.3" → {title, part, section?}; anything else null. */
function parseAgendaCfr(s) {
	const m = /^\s*(\d{1,2})\s+CFR\s+(\d+[A-Z]?)(?:\.(\d+[a-z]?))?\b/i.exec(s);
	if (!m) return null;
	return {
		title: parseInt(m[1], 10),
		part: m[2],
		section: m[3] ? `${m[2]}.${m[3]}` : null
	};
}
/** "29 U.S.C. 655" / "42 USC 7401 et seq" → {title, section}; anything else null. */
function parseAgendaUsc(s) {
	const m = /^\s*(\d{1,2})\s+U\.?\s?S\.?\s?C\.?\s+(?:§+\s*)?(\d+[a-z]?(?:-\d+)?)/i.exec(s);
	return m ? {
		title: parseInt(m[1], 10),
		section: m[2]
	} : null;
}
var reginfoHref = (rin, edition) => `https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=${encodeURIComponent(edition)}&RIN=${encodeURIComponent(rin)}`;
var isAgendaJob = (j) => Boolean(j && (j.title === 4e3 || String(j.kind || "").startsWith("agenda")));
var agendaJob = () => [state.jobs?.current, ...state.jobs?.queued || []].find(isAgendaJob) || null;
// src/views/news_agenda.ts
var PAGE = 50;
var ag = {
	view: null,
	list: null,
	facets: null,
	status: null,
	newsStatus: null
};
function viewFromParams(params) {
	const get = (k) => (params?.get(k) || "").trim();
	return {
		edition: /^\d{6}$/.test(get("edition")) ? get("edition") : "",
		agency: /^\d{4}$/.test(get("agency")) ? get("agency") : "",
		stage: AGENDA_STAGES.some((s) => s.key === get("stage")) ? get("stage") : "",
		q: get("q").slice(0, 200)
	};
}
function agendaTabHash(v) {
	const p = new URLSearchParams({ cat: "agenda" });
	for (const k of [
		"edition",
		"agency",
		"stage",
		"q"
	]) if (v[k]) p.set(k, v[k]);
	return `#/news?${p.toString()}`;
}
function listUrl(v, offset = 0) {
	const p = new URLSearchParams({ limit: String(PAGE) });
	for (const k of [
		"edition",
		"agency",
		"stage",
		"q"
	]) if (v[k]) p.set(k, v[k]);
	if (offset) p.set("offset", String(offset));
	return `/api/agenda?${p.toString()}`;
}
function jobPill() {
	const j = agendaJob();
	return j ? statPill("busy", j.state === "running" ? j.phase || "Downloading the Unified Agenda" : "Queued") : "";
}
function headActionsHtml(st) {
	const job = jobPill();
	if (job) return job;
	if (!st?.installed) return "";
	return `${statPill("synced", `${editionLabel(st.editions[0]?.edition)} edition`)}
    <button type="button" class="btn btn-sm" data-agenda-act="update">${icon("refresh")} Check for a new edition</button>
    <button type="button" class="btn btn-sm" data-agenda-act="remove">Remove</button>`;
}
function frontHtml(view, body) {
	const nv = newsViewFromParams(new URLSearchParams(agendaTabHash(view).split("?")[1]));
	const ns = ag.newsStatus;
	const entries = ag.status?.installed ? ag.status.editions.find((e) => e.edition === (ag.list?.edition || ""))?.entries ?? ag.status.editions[0]?.entries : 0;
	const tabStatus = ns ? {
		...ns,
		counts: {
			...ns.counts || {},
			agenda: entries || 0
		}
	} : null;
	return `
    <div class="news-front agenda-front">
      <div class="news-head">
        <div>
          <div class="doc-kicker">FRAMEWORK Newsroom · reginfo.gov</div>
          <h1 class="doc-title">Regulatory News</h1>
        </div>
        <div class="news-head-status" id="agenda-head-status" aria-live="polite">${headActionsHtml(ag.status)}</div>
      </div>
      <div class="news-bar">
        ${newsTabsHtml(nv, tabStatus)}
        ${ag.status?.installed ? `<input type="search" class="news-q" id="agenda-q" value="${escapeHtml(view.q)}"
          placeholder="Filter planned rules or a RIN (1218-AD39)…" aria-label="Search the Unified Agenda" autocomplete="off" spellcheck="false">` : ""}
      </div>
      ${body}
    </div>`;
}
function notInstalledHtml() {
	return `<div class="agenda-intro">
      <h2>The Unified Agenda</h2>
      <p>Twice a year, every federal agency publishes the rules it plans to propose, finish or review: the
        <strong>Unified Agenda of Regulatory and Deregulatory Actions</strong>. Each planned rule has a RIN
        (Regulation Identifier Number), a stage, a timetable and the CFR parts it would change.</p>
      <p>Download the last two years of editions from reginfo.gov (about 22 MB, no key needed). Planned rules then link to
        the Federal Register documents they became and into the CFR and U.S. Code readers.</p>
      <div class="agenda-intro-acts">${jobPill() || `<button type="button" class="btn btn-accent" data-agenda-act="download">${icon("download")} Download the Unified Agenda</button>`}</div>
    </div>`;
}
function filtersHtml(view, f, st) {
	const sel = (a, b) => a === b ? " selected" : "";
	const agencies = f?.agencies || [];
	const stages = f?.stages || [];
	return `<div class="news-facets agenda-facets">
      <select data-agenda-filter="edition" aria-label="Edition">
        ${st.editions.map((e, i) => `<option value="${i === 0 ? "" : escapeHtml(e.edition)}"${sel(view.edition || st.editions[0].edition, e.edition)}>${escapeHtml(editionLabel(e.edition))} edition (${fmt(e.entries)})</option>`).join("")}
      </select>
      <select data-agenda-filter="agency" aria-label="Agency">
        <option value="">All agencies</option>
        ${agencies.map((a) => `<option value="${escapeHtml(a.code)}"${sel(a.code, view.agency)}>${escapeHtml(a.acronym || a.name || a.code)} (${fmt(a.entries)})</option>`).join("")}
      </select>
    </div>
    <div class="lib-seg agenda-stages" role="group" aria-label="Stage">
      <button type="button" data-agenda-stage="" aria-pressed="${!view.stage}">All stages</button>
      ${stages.map((s) => `<button type="button" data-agenda-stage="${escapeHtml(s.key)}" aria-pressed="${view.stage === s.key}">${escapeHtml(stageShort(s.label))} <span class="news-tab-count">${fmt(s.entries)}</span></button>`).join("")}
    </div>`;
}
function rowHtml(r) {
	const who = [r.parent_acronym, r.agency_acronym && r.agency_acronym !== r.parent_acronym ? r.agency_acronym : ""].filter(Boolean).join(" · ");
	return `<a class="agenda-row has-tier-bar" data-ref-tier="fr" data-stage="${escapeHtml(stageKey(r.stage))}" href="${agendaHref(r.rin, r.edition)}">
      <span class="agenda-rin">${escapeHtml(r.rin)}</span>
      <span class="agenda-main">
        <span class="agenda-title">${escapeHtml(r.title)}</span>
        <span class="agenda-meta">${escapeHtml([who, r.priority].filter(Boolean).join(" · "))}</span>
      </span>
      <span class="agenda-tags">${/^yes/i.test(r.major || "") ? "<span class=\"agenda-major\">Major</span>" : ""}<span class="agenda-stage">${escapeHtml(stageShort(r.stage))}</span></span>
    </a>`;
}
function listBodyHtml(view) {
	const st = ag.status;
	const list = ag.list;
	const rows = list?.results || [];
	const label = `${editionLabel(list?.edition)} edition · ${fmt(list?.total || 0)} planned ${list?.total === 1 ? "rule" : "rules"}`;
	const more = list && list.total > rows.length ? `<div class="news-more"><button type="button" class="btn" data-agenda-act="more">Load more (${fmt(list.total - rows.length)} left)</button></div>` : "";
	const none = view.q ? `No planned rule matches “${escapeHtml(view.q)}”. Try other words or a RIN such as 1218-AD39.` : "No planned rules match these filters.";
	return `${filtersHtml(view, ag.facets, st)}
    <div class="lib-label agenda-count" aria-live="polite">${escapeHtml(label)}</div>
    ${rows.length ? `<div class="agenda-list" id="agenda-list">${rows.map(rowHtml).join("")}</div>${more}` : `<div class="empty-state"><h2>Nothing here</h2><p>${none}</p></div>`}`;
}
function paintTab(view, opts = {}) {
	const qEl = document.getElementById("agenda-q");
	const qFocus = qEl && document.activeElement === qEl ? { start: qEl.selectionStart ?? qEl.value.length } : null;
	const body = ag.status?.installed ? listBodyHtml(view) : notInstalledHtml();
	dom.view.innerHTML = frontHtml(view, body);
	if (opts.enter) enterView();
	if (qFocus) {
		const q = document.getElementById("agenda-q");
		if (q) {
			q.focus();
			try {
				q.setSelectionRange(qFocus.start, qFocus.start);
			} catch {}
		}
	}
}
function resetPage() {
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	setViewHead("");
}
/** #/news?cat=agenda[&edition&agency&stage&q] */
async function loadAgendaTab(params) {
	const seq = state.routeSeq;
	resetPage();
	document.title = "Unified Agenda · News · FRAMEWORK";
	const view = viewFromParams(params);
	newsState.view = newsViewFromParams(params);
	const firstPaint = !dom.view.querySelector(".agenda-front");
	if (firstPaint) {
		dom.view.innerHTML = skeletonHtml("cards", "Loading the Unified Agenda…");
		enterView();
	}
	try {
		const [list, facets, newsStatus] = await Promise.all([
			getJSON(listUrl(view)),
			getJSON(`/api/agenda/facets${view.edition ? `?edition=${view.edition}` : ""}`),
			getJSON("/api/news/status").catch(() => null)
		]);
		if (seq !== state.routeSeq) return;
		ag.view = view;
		ag.list = list;
		ag.facets = facets;
		ag.status = list.status;
		ag.newsStatus = newsStatus;
		paintTab(view, { enter: firstPaint });
	} catch (err) {
		if (seq !== state.routeSeq) return;
		dom.view.innerHTML = emptyStateHtml({
			title: "The Unified Agenda didn’t load",
			body: escapeHtml(err instanceof Error ? err.message : String(err)),
			actionsHtml: `<a class="btn" href="#/news">${icon("chevronLeft")} All news</a>`
		});
	}
}
function setAgendaView(next) {
	history.replaceState(null, "", agendaTabHash(next));
	loadAgendaTab(new URLSearchParams(agendaTabHash(next).split("?")[1]));
}
async function loadMore() {
	const seq = state.routeSeq;
	const { view, list } = ag;
	if (!view || !list) return;
	let page;
	try {
		page = await getJSON(listUrl(view, list.results.length));
	} catch {
		return;
	}
	if (seq !== state.routeSeq || ag.list !== list) return;
	list.results = list.results.concat(page.results);
	list.total = page.total;
	const box = document.getElementById("agenda-list");
	if (box) box.insertAdjacentHTML("beforeend", page.results.map(rowHtml).join(""));
	const more = dom.view.querySelector("[data-agenda-act=\"more\"]");
	if (more) {
		if (list.total > list.results.length) more.textContent = `Load more (${fmt(list.total - list.results.length)} left)`;
		else more.closest(".news-more")?.remove();
	}
}
function cfrChip(s) {
	const c = parseAgendaCfr(s);
	if (!c) return `<span class="citation-chip is-dim">${escapeHtml(s)}</span>`;
	const dim = !titleInstalled(c.title);
	const href = c.section ? newsSectionHref(c.title, c.section) : newsPartHref(c.title, c.part);
	return `<a class="citation-chip${dim ? " is-dim" : ""}" data-ref-tier="${dim ? "uninstalled" : "cfr"}" href="${href}">${escapeHtml(s)}</a>`;
}
function uscChip$1(s) {
	const u = parseAgendaUsc(s);
	const installed = u && (state.installedUscTitles || []).some((t) => t.title === u.title);
	if (!u) return `<span class="citation-chip is-dim">${escapeHtml(s)}</span>`;
	return installed ? `<a class="citation-chip" data-ref-tier="usc" href="#/usc/${u.title}/section/${encodeURIComponent(u.section)}">${escapeHtml(s)}</a>` : `<a class="citation-chip is-dim" data-ref-tier="uninstalled" href="#/library/usc/${u.title}">${escapeHtml(s)}</a>`;
}
function timetableHtml(e) {
	if (!e.timetable.length) return "";
	const byCite = new Map(e.fr_documents.filter((d) => d.citation).map((d) => [d.citation, d]));
	return `<section class="agenda-sec" aria-labelledby="agenda-tt-h">
      <h2 class="agenda-sec-head" id="agenda-tt-h">Timetable</h2>
      <div class="table-wrap"><table class="reg-table agenda-tt"><thead><tr><th>Action</th><th>Date</th><th>Federal Register</th></tr></thead><tbody>${e.timetable.map((t) => {
		const doc = t.fr_citation ? byCite.get(t.fr_citation) : null;
		const cite = t.fr_citation ? doc ? `<a href="#/news/fr/${encodeURIComponent(doc.document_number)}">${escapeHtml(t.fr_citation)}</a>` : escapeHtml(t.fr_citation) : "";
		return `<tr><td>${escapeHtml(t.action)}</td><td class="num">${escapeHtml(agendaDate(t.date))}</td><td>${cite}</td></tr>`;
	}).join("")}</tbody></table></div>
    </section>`;
}
function frDocsHtml(e) {
	const docs = e.fr_documents;
	const body = docs.length ? `<div class="agenda-frdocs">${docs.map((d) => `<a class="agenda-frdoc has-tier-bar" data-ref-tier="fr" href="#/news/fr/${encodeURIComponent(d.document_number)}">
          <span class="agenda-frdoc-kicker">${escapeHtml(joinPlain([
		d.type,
		d.citation,
		d.publication_date ? fmtDate(d.publication_date) : ""
	]))}</span>
          <span class="agenda-frdoc-title">${escapeHtml(d.title || d.document_number)}</span></a>`).join("")}</div>` : `<p class="dr-note">None in your Federal Register archive yet. ${e.timetable.some((t) => t.fr_citation) ? "The timetable cites Federal Register pages that aren’t downloaded; the archive is set up under Settings → Data sources." : "This rule hasn’t been published in the Federal Register."}</p>`;
	return `<section class="agenda-sec" aria-labelledby="agenda-fr-h">
      <h2 class="agenda-sec-head" id="agenda-fr-h">In the Federal Register <span class="usc-notes-count">${docs.length}</span></h2>
      ${body}
    </section>`;
}
var joinPlain = (xs) => xs.filter(Boolean).join(" · ");
function renderEntry(e) {
	document.title = `${e.rin} ${e.title} · Unified Agenda · FRAMEWORK`;
	const reginfo = safeHttpUrl(reginfoHref(e.rin, e.edition));
	const comment = safeHttpUrl(e.comment_url || "");
	const facts = [
		["RIN", `<span class="agenda-rin">${escapeHtml(e.rin)}</span>`],
		["Stage", escapeHtml(e.stage || "—")],
		["Agency", escapeHtml(joinPlain([e.agency, e.parent && e.parent !== e.agency ? e.parent : ""]) || "—")],
		["Priority", escapeHtml(e.priority || "—")],
		["Major rule", escapeHtml(e.major || "—")],
		["Status", escapeHtml(e.rin_status || "—")]
	];
	const history = e.history.length > 1 ? `<section class="agenda-sec" aria-labelledby="agenda-hist-h"><h2 class="agenda-sec-head" id="agenda-hist-h">Earlier editions</h2>
        <ul class="agenda-hist">${e.history.map((h) => `<li>${h.edition === e.edition ? `<strong>${escapeHtml(editionLabel(h.edition))}</strong>` : `<a href="${agendaHref(e.rin, h.edition)}">${escapeHtml(editionLabel(h.edition))}</a>`} · ${escapeHtml(stageShort(h.stage))}</li>`).join("")}</ul></section>` : "";
	const related = e.related.length ? `<section class="agenda-sec"><h2 class="agenda-sec-head">Related rules</h2><div class="story-links">${e.related.map((r) => `<a class="citation-chip" data-ref-tier="fr" href="${agendaHref(r)}">${escapeHtml(r)}</a>`).join("")}</div></section>` : "";
	dom.view.innerHTML = `
    <article class="agenda-rule">
      <div class="doc-kicker" data-ref-tier="fr">
        <a href="${AGENDA_TAB_HREF}">Unified Agenda</a><span class="sep" aria-hidden="true">·</span><span>${escapeHtml(editionLabel(e.edition))} edition</span>${e.parent_acronym ? `<span class="sep" aria-hidden="true">·</span><a href="${AGENDA_TAB_HREF}&agency=${encodeURIComponent(e.parent_code || "")}">${escapeHtml(e.parent_acronym)}</a>` : ""}
      </div>
      <h1 class="doc-title">${escapeHtml(e.title)}</h1>
      <div class="doc-actions">
        <a class="btn" href="${AGENDA_TAB_HREF}">${icon("chevronLeft")} Unified Agenda</a>
        <button type="button" class="btn" id="agenda-copy-rin" data-rin="${escapeHtml(e.rin)}">${icon("link")} Copy RIN</button>
        ${reginfo ? `<a class="btn" href="${escapeHtml(reginfo)}" target="_blank" rel="noopener noreferrer">${icon("external")} reginfo.gov</a>` : ""}
        ${comment ? `<a class="btn" href="${escapeHtml(comment)}" target="_blank" rel="noopener noreferrer">${icon("external")} Comment</a>` : ""}
      </div>
      <dl class="agenda-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
      ${e.abstract ? `<div class="agenda-abstract reg-body"><p class="reg-p">${escapeHtml(e.abstract)}</p></div>` : ""}
      ${e.cfr.length || e.authority.length ? `<section class="agenda-sec"><h2 class="agenda-sec-head">What it would change</h2>
        ${e.cfr.length ? `<p class="agenda-chips-label">CFR</p><div class="story-links">${e.cfr.map(cfrChip).join("")}</div>` : ""}
        ${e.authority.length ? `<p class="agenda-chips-label">Legal authority</p><div class="story-links">${e.authority.map(uscChip$1).join("")}</div>` : ""}
      </section>` : ""}
      ${timetableHtml(e)}
      ${frDocsHtml(e)}
      ${history}
      ${related}
    </article>`;
}
/** #/news/agenda/{RIN}[?edition=YYYYMM] */
async function loadAgendaRule(rin, params) {
	const seq = state.routeSeq;
	resetPage();
	const edition = (params?.get("edition") || "").trim();
	dom.view.innerHTML = skeletonHtml("doc", "Loading the planned rule…");
	enterView();
	try {
		const q = /^\d{6}$/.test(edition) ? `?edition=${edition}` : "";
		const e = await getJSON(`/api/agenda/rin/${encodeURIComponent(rin)}${q}`);
		if (seq !== state.routeSeq) return;
		renderEntry(e);
	} catch (err) {
		if (seq !== state.routeSeq) return;
		const msg = err instanceof Error ? err.message : String(err);
		document.title = "Unified Agenda · FRAMEWORK";
		dom.view.innerHTML = emptyStateHtml({
			title: /No such RIN/i.test(msg) ? `${rin} isn’t in your Unified Agenda` : "Couldn’t open this planned rule",
			body: /No such RIN/i.test(msg) ? "Download the Unified Agenda, or a newer edition, from the Newsroom’s Unified Agenda tab." : escapeHtml(msg),
			actionsHtml: `<a class="btn btn-accent" href="${AGENDA_TAB_HREF}">${icon("chevronLeft")} Unified Agenda</a>`
		});
	}
}
var qTimer;
var removeTimer;
async function startJob(url) {
	const res = await getJSON(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}"
	});
	state.jobsSeenActive.add(res.job.id);
	const slot = document.getElementById("agenda-head-status");
	if (slot) slot.innerHTML = statPill("busy", "Queued");
	const intro = dom.view.querySelector(".agenda-intro-acts");
	if (intro) intro.innerHTML = statPill("busy", "Queued");
	await pollJobs();
}
onView("click", async (e) => {
	const t = e.target;
	if (!t) return;
	const copy = t.closest("#agenda-copy-rin");
	if (copy) {
		await copyText(copy.dataset.rin || "", `Copied ${copy.dataset.rin}`, "Couldn’t copy the RIN");
		return;
	}
	if (!dom.view.querySelector(".agenda-front")) return;
	const stage = t.closest("[data-agenda-stage]");
	if (stage && ag.view) {
		setAgendaView({
			...ag.view,
			stage: stage.dataset.agendaStage || ""
		});
		return;
	}
	const btn = t.closest("button[data-agenda-act]");
	if (!btn) return;
	const act = btn.dataset.agendaAct;
	try {
		if (act === "more") await loadMore();
		else if (act === "download") {
			btn.disabled = true;
			await startJob("/api/agenda/build");
		} else if (act === "update") {
			btn.disabled = true;
			await startJob("/api/agenda/update");
		} else if (act === "remove") {
			if (!btn.classList.contains("is-armed")) {
				btn.classList.add("is-armed");
				btn.textContent = "Confirm remove";
				clearTimeout(removeTimer);
				removeTimer = setTimeout(() => {
					btn.classList.remove("is-armed");
					btn.textContent = "Remove";
				}, 4e3);
				return;
			}
			btn.disabled = true;
			await getJSON("/api/agenda", { method: "DELETE" });
			showToast("Removed the Unified Agenda");
			loadAgendaTab(new URLSearchParams("cat=agenda"));
		}
	} catch (err) {
		btn.disabled = false;
		showToast(err instanceof Error ? err.message : "That didn’t work");
	}
});
onView("change", (e) => {
	const sel = e.target?.closest("[data-agenda-filter]");
	if (!sel || !ag.view) return;
	const key = sel.dataset.agendaFilter;
	setAgendaView(key === "edition" ? {
		...ag.view,
		edition: sel.value,
		agency: "",
		stage: ""
	} : {
		...ag.view,
		[key]: sel.value
	});
});
onView("input", (e) => {
	const el = e.target;
	if (!el || el.id !== "agenda-q" || !ag.view) return;
	clearTimeout(qTimer);
	qTimer = setTimeout(() => {
		if (ag.view) setAgendaView({
			...ag.view,
			q: el.value.trim()
		});
	}, 250);
});
on("jobs:finished", () => {
	if (dom.view.querySelector(".agenda-front")) loadAgendaTab(new URLSearchParams(location.hash.split("?")[1] || "cat=agenda"));
});
// src/components/news_activity.ts
var newsPop = document.getElementById("news-pop");
var newsActivityCache = /* @__PURE__ */ new Map();
state.newsActivityCtx = null;
function newsActivityButtonHtml() {
	return `<button type="button" class="btn" id="btn-news-activity" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("news")} <span>Activity</span></button>`;
}
async function fetchNewsActivity(titleNum, kind, id) {
	if (!titleNum || titleNum < 1 || titleNum > 50) return null;
	const key = `${titleNum}|${kind === "part" ? "part:" : ""}${id}`;
	let data = newsActivityCache.get(key);
	if (!data) {
		try {
			data = await getJSON(kind === "part" ? `/api/news/part/${encodeURIComponent(id)}?title=${titleNum}` : `/api/news/section/${encodeURIComponent(id)}?title=${titleNum}`);
		} catch {
			return null;
		}
		newsActivityCache.set(key, data);
	}
	return data;
}
async function fillNewsActivity(kind, id, seq) {
	state.newsActivityCtx = null;
	const titleNum = state.currentTitle;
	if (!titleNum) return;
	const data = await fetchNewsActivity(titleNum, kind, id);
	if (!data || seq !== state.routeSeq) return;
	const btn = document.getElementById("btn-news-activity");
	if (!btn || !data.count) return;
	state.newsActivityCtx = {
		title: titleNum,
		kind,
		id,
		data
	};
	const label = btn.querySelector("span");
	if (label) label.textContent = data.count === 1 ? "1 rule or citation" : `${data.count} rules & citations`;
	btn.hidden = false;
}
function newsTimelineHtml(ctx) {
	const titleNum = ctx.title || state.currentTitle || 29;
	const label = ctx.kind === "part" ? `Part ${ctx.id}` : `§ ${ctx.id}`;
	const articles = ctx.data.articles || [];
	const nodes = articles.map((a) => {
		let meta = fmtDate(a.published_at);
		let second = "";
		if (a.category === "rules") meta += ` · Final rule${a.citation ? " · " + a.citation : ""}`;
		else if (a.category === "rulemaking") meta += " · Proposed rule" + (a.comments_close_on ? ` · comments close ${fmtDate(a.comments_close_on)}` : "");
		else if (a.category === "public_inspection") meta += " · Public inspection" + (a.scheduled_on ? ` · publishes ${fmtDate(a.scheduled_on)}` : "");
		else if (a.category === "enforcement") {
			meta += " · Citation" + (a.penalty_usd ? ` · ${fmtMoney(a.penalty_usd)}` : "");
			second = [a.company, [a.city, a.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
		} else meta += " · Notice";
		const title = a.category === "enforcement" && second ? second : a.title || "";
		const hay = `${meta} ${title} ${a.citation || ""}`.toLowerCase();
		const actNr = inspectionActivityNr(a);
		const frDoc = !actNr ? frDocumentNumber(a) : null;
		const titleHtml = actNr ? `<a href="#/news/inspection/${actNr}" data-pop-nav><span class="tl-title">${escapeHtml(title)}</span></a>` : frDoc ? `<a href="#/news/fr/${encodeURIComponent(frDoc)}" data-pop-nav><span class="tl-title">${escapeHtml(title)}</span></a>` : extLink(a.link, `<span class="tl-title">${escapeHtml(title)}</span>`);
		return `<li class="tl-node" data-kind="${escapeHtml(a.category)}" data-hay="${escapeHtml(hay)}">
      <span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-meta">${escapeHtml(meta)}</div>
      ${titleHtml}
    </li>`;
	}).join("");
	const titleQuery = titleNum !== 29 ? `&cfr_title=${titleNum}` : "";
	const allHref = ctx.kind === "part" ? `#/news?part=${encodeURIComponent(ctx.id)}${titleQuery}` : `#/news?section=${encodeURIComponent(ctx.id)}${titleQuery}`;
	const filterHtml = articles.length >= 6 ? `<input type="search" class="pop-filter" id="news-pop-filter" placeholder="Filter ${articles.length} events…" aria-label="Filter activity events" autocomplete="off">` : "";
	const stats = ctx.data.stats;
	let statsHtml = "";
	if (stats && stats.citation_count > 0) {
		const bits = [
			`${stats.citation_count} ${stats.citation_count === 1 ? "citation" : "citations"}`,
			stats.avg_penalty ? `Avg ${fmtMoney(stats.avg_penalty)}` : "",
			stats.fta_count ? `${stats.fta_count} FTA` : ""
		].filter(Boolean);
		const paras = (stats.top_paragraphs || []).slice(0, 3);
		const paraHtml = paras.length ? `<div class="news-pop-paras">Top cited: ${paras.map((p) => {
			const cnt = p.share_pct != null ? `${p.share_pct}%` : `${p.count}`;
			const text = `${p.para} (${cnt})`;
			if (ctx.kind === "section") return `<a class="citation-chip" href="${titleHref(titleNum, "section/" + encodeURIComponent(ctx.id) + "?p=" + encodeURIComponent(p.para))}" data-pop-nav>${escapeHtml(text)}</a>`;
			return `<span class="citation-chip">${escapeHtml(text)}</span>`;
		}).join("")}</div>` : "";
		statsHtml = `<div class="news-pop-stats"><div class="news-pop-stats-line">${escapeHtml(bits.join(" · "))}</div>${paraHtml}</div>`;
	}
	return `<div class="news-pop-head-row">
      <div class="news-pop-head">${escapeHtml(titleNum === 29 ? `Federal Register & OSHA activity · ${label}` : `Federal Register activity · ${titleNum} CFR ${label}`)}</div>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close activity">${icon("close")}</button>
    </div>
    ${statsHtml}
    ${filterHtml}
    <ol class="reg-timeline">${nodes}</ol>
    <a class="news-pop-foot" href="${allHref}">${icon("news")} See all in News</a>`;
}
var newsCtrl = createPopover({
	el: newsPop,
	triggerSelector: "#btn-news-activity, #split-btn-news"
});
var activeNewsAnchor = null;
function openNewsActivityFor(btn, ctx) {
	if (!btn || !ctx) return;
	if (!newsPop.hidden && activeNewsAnchor === btn) {
		closeNewsActivity(true);
		return;
	}
	activeNewsAnchor = btn;
	newsPop.setAttribute("aria-label", `Federal Register and OSHA activity for ${ctx.kind === "part" ? "Part " : "§ "}${ctx.id}`);
	newsCtrl.open(btn, newsTimelineHtml(ctx), {
		focusSelector: "#news-pop-filter, a, button",
		returnFocus: btn
	});
}
function openNewsActivity() {
	openNewsActivityFor(document.getElementById("btn-news-activity"), state.newsActivityCtx);
}
function closeNewsActivity(returnFocus = true) {
	newsCtrl.close(returnFocus);
}
newsPop.addEventListener("click", (e) => {
	const t = e.target;
	if (t?.closest("[data-pop-close]")) closeNewsActivity(true);
	else if (t?.closest("[data-pop-nav]")) closeNewsActivity(false);
});
newsPop.addEventListener("input", (e) => {
	const t = e.target;
	if (!t || t.id !== "news-pop-filter") return;
	const q = t.value.trim().toLowerCase();
	for (const li of newsPop.querySelectorAll(".tl-node")) {
		const hay = li.dataset.hay || "";
		li.hidden = Boolean(q && !hay.includes(q));
	}
	newsCtrl.reposition(activeNewsAnchor?.isConnected ? activeNewsAnchor : document.getElementById("btn-news-activity"));
});
onView("click", (e) => {
	if (e.target?.closest("#btn-news-activity")) openNewsActivity();
});
newsPop.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		closeNewsActivity(true);
	}
});
// src/components/pin_pop.ts
var pinPop = document.getElementById("pin-pop");
var pinTargetOverride = null;
var pinAnchorOverride = null;
var pinPopMode = "pin";
function activePinSection() {
	return pinTargetOverride || currentSectionRef();
}
function pinButtonHtml(secRef = null, id = "btn-pin") {
	const ref = secRef || currentSectionRef();
	const n = ref ? projectsWith(ref.title, ref.id).length : 0;
	return `<button type="button" class="${id === "btn-pin" ? "btn" : "btn btn-small"}${n ? " is-pinned" : ""}" id="${id}" aria-haspopup="dialog" aria-expanded="false" title="Pin to a workspace (${isMac ? "⌘" : "Ctrl "}D)">${icon(n ? "bookmarkFilled" : "bookmark")} ${n ? "Pinned" : "Pin"}</button>`;
}
function updatePinButton() {
	const b = document.getElementById("btn-pin");
	if (b) b.outerHTML = pinButtonHtml();
	const sb = document.getElementById("split-btn-pin");
	if (sb && state.splitState?.sectionId) sb.outerHTML = pinButtonHtml({
		title: state.splitState.title,
		id: state.splitState.sectionId
	}, "split-btn-pin");
}
function renderPinMenu() {
	const sec = activePinSection();
	if (!sec) return;
	const list = loadProjects();
	pinPop.innerHTML = `<div class="pin-head">
      <span>Pin <strong>${escapeHtml(sec.label)}</strong> to</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close pin menu">${icon("close")}</button>
    </div>
    ${list.length ? `<div class="pin-list" role="group" aria-label="Workspaces">${list.map((p) => {
		const on = p.sections.some((s) => s.title === sec.title && s.id === sec.id);
		return `<button type="button" class="pin-opt" role="menuitemcheckbox" aria-checked="${on}" data-proj="${escapeHtml(p.id)}">
        <span class="pin-check">${on ? icon("check") : ""}</span>${projDot(p)}<span class="pin-name">${escapeHtml(p.name)}</span><span class="pin-count">${p.sections.length}</span></button>`;
	}).join("")}</div>` : "<p class=\"pin-none\">No workspaces yet. Name one to start.</p>"}
    <form class="pin-new"><input class="dr-input" name="name" placeholder="New workspace…" maxlength="80" autocomplete="off" aria-label="New workspace name"></form>`;
}
var pinCtrl = createPopover({
	el: pinPop,
	triggerSelector: "#btn-pin, #split-btn-pin, [data-tabs-act=\"save-group\"], [data-split-tabs-act=\"save-group\"]",
	onClose: () => {
		pinTargetOverride = null;
		pinAnchorOverride = null;
		pinPopMode = "pin";
	}
});
function renderSaveGroupMenu(initialName = "") {
	const list = loadProjects();
	const mainCount = state.mainTabs.length;
	const splitCount = state.splitTabs.length;
	const counts = `${mainCount} main${splitCount ? ` + ${splitCount} side-by-side` : ""}`;
	const groupName = initialName || suggestTabGroupName();
	pinPop.innerHTML = `<div class="pin-head">
      <span>Save <strong>${escapeHtml(counts)}</strong> tab group</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close save tab group menu">${icon("close")}</button>
    </div>
    <div class="pin-group-field">
      <input class="dr-input" id="pin-group-name" value="${escapeHtml(groupName)}" placeholder="Research path name…" maxlength="80" autocomplete="off" aria-label="Tab group name">
    </div>
    ${list.length ? `<div class="pin-list" role="group" aria-label="Choose workspace">${list.map((p) => {
		const grpCount = (p.tab_groups || []).length;
		return `<button type="button" class="pin-opt" data-save-group-proj="${escapeHtml(p.id)}">
        <span class="pin-check">${icon("folder")}</span>${projDot(p)}<span class="pin-name">${escapeHtml(p.name)}</span><span class="pin-count">${grpCount ? `${grpCount} grp` : p.sections.length}</span></button>`;
	}).join("")}</div>` : "<p class=\"pin-none\">No workspaces yet. Name one below to save this research path.</p>"}
    <form class="pin-new"><input class="dr-input" name="name" placeholder="New workspace…" maxlength="80" autocomplete="off" aria-label="New workspace name and save"></form>`;
}
function openSaveTabGroupMenu(anchorEl) {
	if (!anchorEl) return;
	if (!pinPop.hidden && pinPopMode === "tabgroup" && pinAnchorOverride === anchorEl) {
		closePinMenu(true);
		return;
	}
	pinPopMode = "tabgroup";
	pinTargetOverride = null;
	pinAnchorOverride = anchorEl;
	renderSaveGroupMenu();
	pinCtrl.open(anchorEl, null, {
		focusSelector: "#pin-group-name, .pin-opt",
		returnFocus: anchorEl
	});
}
function openPinMenu(anchorEl = null, customRef = null) {
	if (!(customRef || currentSectionRef())) return;
	pinPopMode = "pin";
	pinTargetOverride = customRef || null;
	const btn = anchorEl || document.getElementById("btn-pin");
	pinAnchorOverride = btn;
	renderPinMenu();
	pinCtrl.open(btn, null, {
		focusSelector: ".pin-opt, .pin-new input",
		returnFocus: btn || document.activeElement
	});
}
function toggleSplitPinMenu(anchorEl, customRef) {
	if (!pinPop.hidden && pinTargetOverride?.id === customRef?.id && pinTargetOverride?.title === customRef?.title) closePinMenu(true);
	else openPinMenu(anchorEl, customRef);
}
function closePinMenu(returnFocus = true) {
	pinCtrl.close(returnFocus);
}
pinPop.addEventListener("click", (e) => {
	const t = e.target;
	if (t?.closest("[data-pop-close]")) {
		closePinMenu(true);
		return;
	}
	const saveProjBtn = t?.closest("[data-save-group-proj]");
	if (saveProjBtn && pinPopMode === "tabgroup") {
		const snapshot = buildTabGroupSnapshot(pinPop.querySelector("#pin-group-name")?.value || "");
		if (saveProjBtn.dataset.saveGroupProj) addTabGroupToWorkspace(saveProjBtn.dataset.saveGroupProj, snapshot);
		closePinMenu(true);
		return;
	}
	const opt = t?.closest(".pin-opt");
	if (!opt || !opt.dataset.proj) return;
	const sec = activePinSection();
	if (!sec) return;
	const targetAnchor = pinAnchorOverride?.isConnected ? pinAnchorOverride : document.getElementById(pinAnchorOverride?.id || "btn-pin");
	togglePin(opt.dataset.proj, sec);
	const focusId = opt.dataset.proj;
	renderPinMenu();
	pinCtrl.reposition(targetAnchor);
	pinPop.querySelector(`.pin-opt[data-proj="${focusId}"]`)?.focus();
});
pinPop.addEventListener("submit", (e) => {
	e.preventDefault();
	const name = e.target.elements.namedItem("name")?.value.trim() || "";
	if (!name) return;
	if (pinPopMode === "tabgroup") {
		const grpName = pinPop.querySelector("#pin-group-name")?.value || "";
		addTabGroupToWorkspace(createProject(name).id, buildTabGroupSnapshot(grpName));
		closePinMenu(true);
		return;
	}
	const sec = activePinSection();
	if (!sec) return;
	const targetAnchor = pinAnchorOverride?.isConnected ? pinAnchorOverride : document.getElementById(pinAnchorOverride?.id || "btn-pin");
	const p = createProject(name);
	togglePin(p.id, sec);
	renderPinMenu();
	pinCtrl.reposition(targetAnchor);
	pinPop.querySelector(`.pin-opt[data-proj="${p.id}"]`)?.focus();
});
pinPop.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		closePinMenu(true);
		return;
	}
	if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
	const items = [...pinPop.querySelectorAll(".pin-opt, input")];
	if (!items.length) return;
	const i = items.indexOf(document.activeElement);
	e.preventDefault();
	items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
});
onView("click", (e) => {
	if (e.target?.closest("#btn-pin")) pinPop.hidden ? openPinMenu() : closePinMenu();
});
on("pin:open", () => openPinMenu());
on("tabs:save-group", ({ anchor }) => openSaveTabGroupMenu(anchor));
on("projects:changed", () => updatePinButton());
// src/components/refs_popovers.ts
var LEDGER_GROUPS = [
	{
		tier: "usc",
		label: "Federal Statutes · U.S.C."
	},
	{
		tier: "cfr",
		label: "Current Title CFR"
	},
	{
		tier: "cross",
		label: "Cross-Title CFR"
	},
	{
		tier: "state",
		label: "State Authorities"
	},
	{
		tier: "county",
		label: "County & Municipal"
	},
	{
		tier: "ibr",
		label: "IBR Standards"
	},
	{
		tier: "fr",
		label: "Federal Register"
	},
	{
		tier: "uninstalled",
		label: "Uninstalled Corpora"
	},
	{
		tier: "local",
		label: "Clauses, Tables & Figures"
	},
	{
		tier: "web",
		label: "External Portals"
	}
];
var activeLedgerItems = [];
function renderCitedByListHtml(graphData, targetTitle = state.currentTitle, filter = "") {
	const q = filter.trim().toLowerCase();
	const rows = (graphData.cited_by || []).filter((c) => {
		if (!q) return true;
		return `${c.id} ${c.label} ${c.title} ${c.part}`.toLowerCase().includes(q);
	});
	if (!rows.length) return "<p class=\"peek-text is-empty\">No matching citing sections.</p>";
	return `<div class="cited-list">${rows.slice(0, 50).map((c) => {
		return `
      <div class="cited-row">
        <a class="cited-link" href="${`#/title/${targetTitle}/section/${encodeURIComponent(c.id)}`}">
          <span class="cited-num">${escapeHtml(c.label)}</span>
          <span class="cited-title">${escapeHtml(c.title)}</span>
        </a>
        <button type="button" class="lib-act cited-split" data-cited-tab="${escapeHtml(c.id)}" data-cited-title="${targetTitle}" title="Open in reader tab">Tab</button>
        <button type="button" class="lib-act cited-split" data-cited-split="${escapeHtml(c.id)}" data-cited-title="${targetTitle}" title="Open side-by-side">Split</button>
      </div>`;
	}).join("")}</div>`;
}
function openCitedByPopover(btn, graphData, targetTitle = state.currentTitle) {
	const total = graphData.cited_by_count || 0;
	const filterHtml = total >= 6 ? `<input type="search" class="pop-filter" id="cited-pop-filter" placeholder="Filter ${total} citing sections…" aria-label="Filter citing sections" autocomplete="off">` : "";
	citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Cited by ${plural(total, "section")} in Title ${targetTitle}</div>
      <span class="peek-badge">CITED BY</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close citing sections">${icon("close")}</button>
    </div>
    ${filterHtml}
    <div id="cited-pop-list">${renderCitedByListHtml(graphData, targetTitle)}</div>
  `, {
		interactive: true,
		returnFocus: btn,
		focusSelector: "#cited-pop-filter, .cited-link",
		refTier: "cfr"
	});
	const filterEl = document.getElementById("cited-pop-filter");
	if (filterEl) filterEl.addEventListener("input", () => {
		const slot = document.getElementById("cited-pop-list");
		if (slot) slot.innerHTML = renderCitedByListHtml(graphData, targetTitle, filterEl.value);
		citePop.reposition(btn);
	});
}
function classifyDomRef(el) {
	if (el.classList.contains("xref-usc")) return "usc";
	if (el.classList.contains("xref-fr")) return "fr";
	if (el.classList.contains("xref-ibr")) return "ibr";
	if (el.classList.contains("xref-state")) return "state";
	if (el.classList.contains("xref-county")) return "county";
	if (el.classList.contains("xref-external")) return "uninstalled";
	if (el.classList.contains("xref-cross")) return "cross";
	if (el.classList.contains("xref-local") || el.classList.contains("xref-anchor") || el.classList.contains("ftref")) return "local";
	if (el.classList.contains("xref-web")) return "web";
	return "cfr";
}
function collectSectionReferences(root = dom.view, fallbackTitle = state.currentTitle) {
	const bodies = root ? [...root.querySelectorAll(".reg-body, .front-matter, .split-body")] : [];
	const scopes = bodies.length ? bodies : root ? [root] : [];
	if (!scopes.length) return [];
	const seen = /* @__PURE__ */ new Map();
	for (const scope of scopes) {
		const nodes = scope.querySelectorAll("a.xref, button.xref-anchor, button.xref-ibr, .ftref[data-anchor]");
		for (const el of nodes) {
			const tier = classifyDomRef(el);
			const label = cleanInlineLabel(el.textContent);
			if (!label) continue;
			const rawHref = el.getAttribute("href") || "";
			const uscLocal = /^\/usc\/(\d+)\/([^?#]+)$/.exec(rawHref);
			const href = uscLocal ? `#/usc/${uscLocal[1]}/section/${uscLocal[2]}` : rawHref;
			const anchor = el.dataset.anchor || "";
			const ibrCode = el.dataset.ibrCode || "";
			const localPara = el.dataset.localPara || "";
			const dedupKey = `${tier}|${href || anchor || ibrCode || localPara || label.toLowerCase()}`;
			if (seen.has(dedupKey)) continue;
			let sub = "";
			if (tier === "usc") sub = el.getAttribute("title")?.replace(/^View\s+|\s+at Cornell LII$/g, "") || "United States Code";
			else if (tier === "fr") sub = "Federal Register";
			else if (tier === "ibr") sub = el.getAttribute("title") || "Incorporated consensus standard";
			else if (tier === "uninstalled") sub = `Title ${el.dataset.cfrTitle || ""} CFR (click to download)`;
			else if (tier === "local") sub = el.classList.contains("ftref") ? "Footnote in section" : localPara ? "Clause in section" : "Table / Figure / Appendix";
			else if (tier === "web") sub = href.replace(/^https?:\/\//i, "").split("/")[0];
			else {
				const parsed = parseCfrHref(href, fallbackTitle);
				sub = parsed?.kind === "section" ? `${parsed.title} CFR § ${parsed.section}${parsed.para || ""}` : parsed?.kind === "part" ? `${parsed.title} CFR Part ${parsed.part}` : "CFR Reference";
			}
			const parsed = href.startsWith("#") ? parseCfrHref(href, fallbackTitle) : null;
			const canSplit = Boolean(parsed?.kind === "section" || parsed?.kind === "part");
			seen.set(dedupKey, {
				idx: seen.size,
				tier,
				code: label,
				sub,
				href,
				external: el.getAttribute("target") === "_blank",
				splitHref: canSplit ? href : "",
				splitTitle: parsed?.title || fallbackTitle,
				el
			});
		}
	}
	return [...seen.values()];
}
function renderRefsLedgerHtml(items, filter = "") {
	const q = filter.trim().toLowerCase();
	const filtered = q ? items.filter((x) => `${x.code} ${x.sub} ${x.tier}`.toLowerCase().includes(q)) : items;
	if (!filtered.length) return "<p class=\"peek-text is-empty\">No matching references in this section.</p>";
	const byTier = /* @__PURE__ */ new Map();
	for (const item of filtered) {
		let bucket = byTier.get(item.tier);
		if (!bucket) {
			bucket = [];
			byTier.set(item.tier, bucket);
		}
		bucket.push(item);
	}
	return `<div class="refs-ledger-wrap">${LEDGER_GROUPS.filter((g) => byTier.has(g.tier)).map((g) => {
		const groupItems = byTier.get(g.tier) || [];
		return `
      <div class="refs-ledger-group" data-ref-tier="${g.tier}">
        <div class="refs-ledger-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(g.label)}</span><span class="refs-ledger-count">${groupItems.length}</span></div>
        ${groupItems.slice(0, 25).map((item) => `
          <div class="refs-ledger-row">
            ${item.external && item.href ? `<a class="refs-ledger-link" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer"><span class="refs-ledger-code">${escapeHtml(item.code)}</span><span class="refs-ledger-sub">${escapeHtml(item.sub)}</span></a>` : `<button type="button" class="refs-ledger-link" data-ledger-idx="${item.idx}"><span class="refs-ledger-code">${escapeHtml(item.code)}</span><span class="refs-ledger-sub">${escapeHtml(item.sub)}</span></button>`}
            ${item.splitHref ? `<button type="button" class="lib-act cited-split" data-ledger-tab="${escapeHtml(item.splitHref)}" data-ledger-title="${item.splitTitle}" title="Open in reader tab">Tab</button><button type="button" class="lib-act cited-split" data-ledger-split="${escapeHtml(item.splitHref)}" data-ledger-title="${item.splitTitle}" title="Open side-by-side">Split</button>` : ""}
          </div>
        `).join("")}
      </div>`;
	}).join("")}</div>`;
}
function openRefsLedgerPopover(btn, root = dom.view, fallbackTitle = state.currentTitle) {
	activeLedgerItems = collectSectionReferences(root, fallbackTitle);
	const total = activeLedgerItems.length;
	const topTier = activeLedgerItems[0]?.tier || "cfr";
	const filterHtml = total >= 8 ? `<input type="search" class="pop-filter" id="refs-ledger-filter" placeholder="Filter ${total} outgoing references…" aria-label="Filter section references" autocomplete="off">` : "";
	citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Outgoing References (${total})</div>
      <span class="peek-badge">LEDGER</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close reference ledger">${icon("close")}</button>
    </div>
    ${filterHtml}
    <div id="refs-ledger-list">${renderRefsLedgerHtml(activeLedgerItems)}</div>
  `, {
		interactive: true,
		returnFocus: btn,
		focusSelector: "#refs-ledger-filter, .refs-ledger-link",
		refTier: topTier
	});
	const filterEl = document.getElementById("refs-ledger-filter");
	if (filterEl) filterEl.addEventListener("input", () => {
		const slot = document.getElementById("refs-ledger-list");
		if (slot) slot.innerHTML = renderRefsLedgerHtml(activeLedgerItems, filterEl.value);
		citePop.reposition(btn);
	});
}
if (dom.citePop) dom.citePop.addEventListener("click", (e) => {
	const t = e.target;
	const sp = t?.closest("[data-cited-split]");
	if (sp) {
		const secId = sp.dataset.citedSplit;
		const tNum = Number(sp.dataset.citedTitle) || state.currentTitle;
		citePop.close(false);
		if (secId) emit("split:open", {
			title: tNum,
			sectionId: secId,
			pushHistory: true
		});
		return;
	}
	const ctab = t?.closest("[data-cited-tab]");
	if (ctab) {
		const secId = ctab.dataset.citedTab;
		const tNum = Number(ctab.dataset.citedTitle) || state.currentTitle;
		citePop.close(false);
		if (secId) openMainReaderTab({
			kind: "section",
			title: tNum,
			sectionId: secId
		});
		return;
	}
	const lsp = t?.closest("[data-ledger-split]");
	if (lsp) {
		const baseTitle = Number(lsp.dataset.ledgerTitle) || state.currentTitle;
		const parsed = parseCfrHref(lsp.dataset.ledgerSplit || "", baseTitle);
		citePop.close(false);
		if (parsed?.kind === "section") emit("split:open", {
			title: parsed.title,
			sectionId: parsed.section,
			para: parsed.para,
			unit: parsed.unit,
			pushHistory: true
		});
		else if (parsed?.kind === "part") emit("split:open", {
			kind: "part",
			title: parsed.title,
			partId: parsed.part,
			pushHistory: true
		});
		return;
	}
	const ltab = t?.closest("[data-ledger-tab]");
	if (ltab) {
		const baseTitle = Number(ltab.dataset.ledgerTitle) || state.currentTitle;
		const parsed = parseCfrHref(ltab.dataset.ledgerTab || "", baseTitle);
		citePop.close(false);
		if (parsed?.kind === "section") openMainReaderTab({
			kind: "section",
			title: parsed.title,
			sectionId: parsed.section,
			para: parsed.para,
			unit: parsed.unit
		});
		else if (parsed?.kind === "part") openMainReaderTab({
			kind: "part",
			title: parsed.title,
			partId: parsed.part
		});
		return;
	}
	const ljmp = t?.closest("[data-ledger-idx]");
	if (ljmp) {
		const idx = Number(ljmp.dataset.ledgerIdx);
		const item = activeLedgerItems[idx];
		if (!item) return;
		if (item.el?.isConnected && (item.tier === "local" || item.tier === "ibr" || item.tier === "uninstalled")) {
			citePop.close(false);
			flashElements([item.el], true);
		} else if (item.href && item.href.startsWith("#")) {
			citePop.close(false);
			window.location.hash = item.href;
		}
	}
});
// src/views/reader.ts
var READING_MODE_KEY = "readingModeByPart:v1";
function loadReadingModePrefs() {
	try {
		const obj = JSON.parse(lsGet(READING_MODE_KEY) || "{}");
		return obj && typeof obj === "object" ? obj : {};
	} catch {
		return {};
	}
}
function getPreferredPartMode(title, part) {
	if (!part) return null;
	return loadReadingModePrefs()[`${title}|${part}`] || null;
}
function savePreferredPartMode(title, part, mode) {
	if (!part) return;
	const prefs = loadReadingModePrefs();
	prefs[`${title}|${part}`] = mode;
	lsSet(READING_MODE_KEY, JSON.stringify(prefs));
}
function highlightParagraph(pText, delay = 120) {
	highlightTarget(dom.view, pText, delay);
}
var mainParaTools = createParaToolsController({
	root: dom.view,
	bodySelector: ".reg-body",
	paraSelector: ".reg-body .reg-p[id]",
	isActive: () => Boolean(state.currentSection),
	getSectionRef: currentSectionRef
});
onView("click", async (e) => {
	if (await mainParaTools.handleClick(e)) return;
	const t = e.target;
	if (!t) return;
	if (t.closest("#btn-copy-link")) {
		await copyText(window.location.href, "Link copied", "Couldn’t copy the link");
		return;
	}
	if (t.closest("#font-dec")) {
		adjustFontSize(-1);
		return;
	}
	if (t.closest("#font-inc")) {
		adjustFontSize(1);
		return;
	}
	const modeBtn = t.closest("a[data-mode-pref]");
	if (modeBtn && state.currentSection?.part && modeBtn.dataset.modePref) savePreferredPartMode(state.currentTitle, state.currentSection.part, modeBtn.dataset.modePref);
	const citedBtn = t.closest("#btn-cited-by");
	if (citedBtn && state.currentSection) {
		const graphData = state.graphCache.get(`${state.currentTitle}|${state.currentSection.id}`);
		if (graphData) openCitedByPopover(citedBtn, graphData);
		return;
	}
	const refsBtn = t.closest("#btn-refs-ledger");
	if (refsBtn && state.currentSection) {
		openRefsLedgerPopover(refsBtn);
		return;
	}
	if (e.altKey) return;
	const localPara = t.closest("a.xref-local[data-local-para]");
	if (localPara?.dataset.localPara) {
		e.preventDefault();
		highlightParagraph(localPara.dataset.localPara, 0);
		return;
	}
	const figLink = t.closest("a.reg-figure:not(.is-broken)");
	if (figLink && dom.view.contains(figLink)) {
		e.preventDefault();
		openFigureModal(figLink);
	}
});
function updateRefsLedgerButton() {
	const btn = document.getElementById("btn-refs-ledger");
	if (!btn) return;
	const items = collectSectionReferences();
	const span = btn.querySelector("span");
	if (span) span.textContent = items.length ? `Refs ${items.length}` : "Refs";
	btn.hidden = items.length === 0;
}
async function fillSectionGraph(titleNum, sectionId, seq, signal) {
	let data;
	try {
		data = await fetchSectionGraph(titleNum, sectionId, { signal });
	} catch {
		return;
	}
	if (!data || seq !== state.routeSeq || !state.currentSection || state.currentSection.id !== sectionId) return;
	if (data.cited_by_count > 0) {
		const btn = document.getElementById("btn-cited-by");
		if (btn) {
			const span = btn.querySelector("span");
			if (span) span.textContent = `Cited by ${data.cited_by_count}`;
			btn.hidden = false;
		}
	}
	if (data.ibr && data.ibr.length) {
		wrapIbrMentions(dom.view, data.ibr);
		updateRefsLedgerButton();
	}
}
async function loadSection(sectionId, params, view) {
	mainParaTools.hide();
	citePop.close(false);
	const knownPart = partForSection(sectionId);
	const prefMode = !view && !params?.get("p") && knownPart ? getPreferredPartMode(state.currentTitle, knownPart) : null;
	const full = view === "full" || prefMode === "full";
	const pClause = params && /^\(([a-z])\)/.exec(params.get("p") || "");
	const unit = full ? null : view || (pClause ? pClause[1] : "");
	const sameSection = Boolean(state.currentSection && state.currentSection.id === sectionId && !dom.view.querySelector(".loading"));
	if (!sameSection) dom.view.innerHTML = skeletonHtml("doc", "Loading section " + sectionId + "…");
	try {
		const qs = unit === null ? "" : "?unit=" + encodeURIComponent(unit);
		const seq = state.routeSeq;
		const signal = state.routeAbort?.signal;
		const res = await fetchSectionRaw(state.currentTitle, sectionId, qs, { signal });
		if (seq !== state.routeSeq) return;
		if (!res.ok) {
			if (state.metaInfo?.partial && /^\d+[a-z]?(?:\.\d+.*)?$/i.test(sectionId)) {
				clearTreeSelection();
				setViewHead("");
				await renderResolverPage(dom.view, {
					title: state.currentTitle,
					section: sectionId,
					para: params ? params.get("p") : null
				});
				return;
			}
			renderNotFound();
			return;
		}
		const data = await res.json();
		if (seq !== state.routeSeq) return;
		state.currentSection = data;
		state.currentPart = data.part;
		updateChatContext();
		const reading = data.mode === "units" && data.unit ? "units" : "scroll";
		const outline = data.outline || [];
		const unitIdx = reading === "units" ? outline.findIndex((u) => u.key === data.unit) : -1;
		const current = unitIdx >= 0 ? outline[unitIdx] : null;
		const heading = cleanInlineLabel(data.section_title || data.title_label || "");
		const label = cleanInlineLabel(data.label);
		document.title = `${label}${current ? " " + unitShort(current) : ""} · Title ${state.currentTitle}`;
		setViewHead((reading === "units" ? unitStepHtml(data) : docStepHtml(data.part || "", data.prev, data.next)) + railHtml(data, reading));
		const partLink = data.part ? `<a href="#/part/${encodeURIComponent(data.part)}">Part ${escapeHtml(data.part)}</a>` : "";
		let unitBannerHtml = "";
		if (current) unitBannerHtml = `<div class="unit-context"><span>${escapeHtml(current.group && current.kind === "chapter" ? `${current.group_label} · ${current.group_title || ""}` : `${current.label ? `Clause ${current.label}` : current.title || ""}`)}</span><span class="sep" aria-hidden="true">·</span><span class="unit-pos">Unit ${unitIdx + 1} of ${outline.length}</span></div>`;
		const fullPart = data.part ? `<a class="btn" href="#/part/${encodeURIComponent(data.part)}/full?from=${encodeURIComponent(data.id)}">${icon("list")} See full part</a>` : "";
		const toggle = data.mode !== "units" ? "" : full ? `<a class="btn" href="${sectionHref(data.id)}" data-mode-pref="units">${icon("stack")} Read in parts</a>` : `<a class="btn" href="${sectionHref(data.id, "full")}" data-mode-pref="full">${icon("expand")} See full section</a>`;
		const ecfrHref = safeHttpUrl(data.ecfr_url);
		dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${partLink}</div>
      <h1 class="doc-title">${escapeHtml(label)} ${escapeHtml(heading)}</h1>

      <div class="doc-actions">
        ${toggle}
        ${fullPart}
        ${pinButtonHtml()}
        ${newsActivityButtonHtml()}
        <button type="button" class="btn" id="btn-cited-by" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("link")} <span>Cited by</span></button>
        <button type="button" class="btn" id="btn-refs-ledger" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("list")} <span>Refs</span></button>
        <div class="spacer"></div>
        <div class="doc-actions-util">
          ${ecfrHref ? `<a class="btn" href="${escapeHtml(ecfrHref)}" target="_blank" rel="noopener" title="Open official text on eCFR">${icon("external")} eCFR</a>` : ""}
          <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon("link")} Copy link</button>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>
      </div>

      ${data.reserved ? "<div class=\"reserved-note\">This section is reserved.</div>" : ""}
      ${unitBannerHtml}

      ${data.html || ""}
    `;
		enhanceDomAnchors(dom.view);
		updateRefsLedgerButton();
		syncMainTabFromRoute({
			kind: "section",
			title: state.currentTitle,
			sectionId: data.id,
			unit: data.unit || (full ? "full" : null),
			para: params?.get("p") || null,
			label: `${state.currentTitle} CFR ${label}`,
			heading,
			href: window.location.hash || sectionHref(data.id, data.unit || (full ? "full" : null))
		});
		const swapX = state.swapMotionX || 0;
		state.swapMotionX = 0;
		enterView({
			subtle: sameSection && !swapX,
			fromX: swapX
		});
		bindRail();
		if (reading === "scroll") watchRail();
		else if (state.railObserver) {
			state.railObserver.disconnect();
			state.railObserver = null;
		}
		const pTarget = params?.get("p");
		if (pTarget) highlightParagraph(pTarget);
		selectTreeNode("s-" + data.id);
		const unitInfo = reading === "units" && current ? {
			key: current.key,
			label: unitShort(current)
		} : null;
		if (!sameSection) recordSectionVisit(data, unitInfo);
		else recordSectionUnit(data.id, unitInfo);
		fillNewsActivity("section", data.id, seq);
		fillSectionGraph(state.currentTitle, data.id, seq, signal);
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return;
		console.error(err);
		setViewHead("");
		renderViewError(dom.view, "Failed to load section", (err instanceof Error ? err.message : "") || "Unexpected error", { onRetry: () => loadSection(sectionId, params, view) });
	}
}
// src/components/part_toc.ts
var TOC_VIEW_KEY = "tocViewMode";
function getTocViewMode() {
	return lsGet("tocViewMode") === "compact" ? "compact" : "cards";
}
function shortSubpartCode(label = "", idx = 0) {
	const m = /Subpart\s+([A-Z0-9\-]+)/i.exec(label);
	if (m) return m[1];
	const m2 = /Subject Group\s+([A-Z0-9\-]+)/i.exec(label);
	if (m2) return m2[1];
	return String(idx + 1);
}
function buildPartTocView({ partNode, front = {
	part: "",
	subparts: {}
}, titleNum = state.currentTitle, tier = "cfr", isSplit = false }) {
	const usage = loadUsage();
	const projects = loadProjects();
	const pinnedMap = /* @__PURE__ */ new Map();
	for (const p of projects) for (const s of p.sections || []) if (Number(s.title) === Number(titleNum)) pinnedMap.set(String(s.id), (pinnedMap.get(String(s.id)) || 0) + 1);
	let sectionCount = 0;
	let activeCount = 0;
	let reservedCount = 0;
	let appendixCount = 0;
	let readCount = 0;
	let pinnedCount = 0;
	const subparts = [];
	const rawBlocks = [];
	const prefix = isSplit ? "sp-toc-grp-" : "toc-grp-";
	const hrefFor = (secId) => `#/title/${titleNum}/section/${encodeURIComponent(secId)}`;
	const countNode = (s) => {
		sectionCount++;
		if (s.r) reservedCount++;
		else activeCount++;
		if (s.t === "appendix") appendixCount++;
		if (usage.s?.[`${titleNum}|${s.id}`]) readCount++;
		if (pinnedMap.has(String(s.id))) pinnedCount++;
	};
	let flatRun = [];
	const flushFlat = () => {
		if (!flatRun.length) return;
		rawBlocks.push({
			type: "flat",
			children: flatRun
		});
		flatRun = [];
	};
	for (const child of partNode.c || []) if (child.t === "subpart" || child.t === "subject_group") {
		flushFlat();
		const children = child.c || [];
		children.forEach(countNode);
		const spIdx = subparts.length;
		const anchorId = `${prefix}${spIdx}`;
		const rawLabel = cleanInlineLabel(child.l || "");
		const rawDesc = cleanInlineLabel(child.d || "");
		const fullTitle = rawDesc && rawDesc !== rawLabel ? rawDesc : rawLabel;
		const code = shortSubpartCode(rawLabel, spIdx);
		subparts.push({
			code,
			rawLabel,
			fullTitle,
			anchorId,
			count: children.length
		});
		rawBlocks.push({
			type: "subpart",
			child,
			children,
			anchorId,
			code,
			rawLabel,
			fullTitle,
			spIdx
		});
	} else if (child.t === "section" || child.t === "appendix") {
		countNode(child);
		flatRun.push(child);
	}
	flushFlat();
	const totalSecs = Math.max(1, sectionCount);
	const itemHtml = (s, idx = 0) => {
		const tTitle = tocTitle(s);
		const uEntry = usage.s?.[`${titleNum}|${s.id}`];
		const isPinned = pinnedMap.has(String(s.id));
		const pinCount = pinnedMap.get(String(s.id)) || 0;
		const isApp = s.t === "appendix";
		const isRes = Boolean(s.r);
		const badges = [
			isApp ? "<span class=\"toc-pill is-app\">Appendix</span>" : "",
			isRes ? "<span class=\"toc-pill is-res\">Reserved</span>" : "",
			uEntry && !isRes ? `<span class="toc-pill is-read">${uEntry.u ? escapeHtml(uEntry.ul || uEntry.u) : "Visited"}</span>` : "",
			isPinned ? `<span class="toc-pill is-pin">${pinCount > 1 ? `Pinned ×${pinCount}` : "Pinned"}</span>` : ""
		].filter(Boolean).join("");
		const hay = `${s.l || ""} ${s.id || ""} ${tTitle} ${isPinned ? "pinned" : ""} ${uEntry ? "read" : ""}`.toLowerCase();
		const seqStr = String(idx + 1).padStart(2, "0");
		const initialMode = isApp ? "Appendix" : isRes ? "Reserved" : "CFR Section";
		const initialInfo = isRes ? "<span class=\"toc-fact is-muted\">No active text</span>" : (uEntry?.n || 0) > 1 ? `<span class="toc-fact">${uEntry.n} reads</span>` : "<span class=\"toc-fact is-loading\" data-sec-info-loading>Loading preview…</span>";
		return `
      <li class="toc-item toc-slide${isRes ? " reserved" : ""}${isApp ? " is-appendix" : ""}${uEntry ? " is-read" : ""}${isPinned ? " is-pinned" : ""}" data-slide-idx="${idx}" data-sec-id="${escapeHtml(s.id)}" data-hay="${escapeHtml(hay)}">
        <article class="toc-card">
          <div class="toc-card-top">
            <span class="toc-card-eyebrow">
              <span class="toc-seq">${seqStr}</span>
              <span class="toc-num">${escapeHtml(s.l)}</span>
            </span>
            ${badges ? `<span class="toc-card-badges">${badges}</span>` : ""}
          </div>
          <h4 class="toc-title"><a class="toc-card-link" href="${hrefFor(String(s.id))}">${escapeHtml(tTitle)}</a></h4>
          <div class="toc-thumb-sheet">
            <p class="toc-card-excerpt" data-sec-excerpt="${escapeHtml(s.id)}">${isRes ? "This section is reserved." : ""}</p>
            <div class="toc-thumb-facts">
              <span class="toc-fact toc-card-meta" data-sec-meta="${escapeHtml(s.id)}">${initialMode}</span>
              <span class="toc-thumb-info" data-sec-info="${escapeHtml(s.id)}">${initialInfo}</span>
            </div>
          </div>
          <div class="toc-card-foot">
            <div class="toc-card-acts">
              ${!isSplit && !isRes ? `<button type="button" class="btn btn-small toc-card-split" data-toc-split="${escapeHtml(s.id)}" title="Open ${escapeHtml(s.l)} side-by-side" aria-label="Open ${escapeHtml(s.l)} side-by-side">Side-by-side</button>` : ""}
              <a class="btn btn-small toc-card-read" href="${hrefFor(String(s.id))}">Read ${icon("arrowRight")}</a>
            </div>
          </div>
        </article>
      </li>`;
	};
	const carouselCtrlHtml = (label, count) => `
    <div class="toc-car-ctrl" aria-label="${escapeHtml(label)} carousel controls">
      <button type="button" class="icon-btn toc-cbtn" data-car-dir="-1" title="Previous sections" aria-label="Previous sections" disabled>${icon("chevronLeft")}</button>
      <span class="toc-ccnt">01–03 / ${String(count).padStart(2, "0")}</span>
      <button type="button" class="icon-btn toc-cbtn" data-car-dir="1" title="Next sections" aria-label="Next sections">${icon("chevronRight")}</button>
    </div>`;
	let groupsHtml = "";
	for (const blk of rawBlocks) {
		const count = blk.children.length;
		const isCarousel = count > 3;
		if (blk.type === "subpart") {
			const sharePct = Math.max(4, Math.round(count / totalSecs * 100));
			const subpartFront = front.subparts?.[String(blk.child.id)] || "";
			const headingText = blk.rawLabel && blk.fullTitle !== blk.rawLabel ? `<span class="toc-group-code">${escapeHtml(blk.rawLabel)}</span><span class="toc-group-name">${escapeHtml(blk.fullTitle)}</span>` : `<span class="toc-group-name">${escapeHtml(blk.fullTitle)}</span>`;
			groupsHtml += `
        <section class="toc-group" id="${escapeHtml(blk.anchorId)}" data-ref-tier="${tier}">
          <header class="toc-group-head">
            <div class="toc-group-titles">${headingText}</div>
            <div class="toc-group-right">
              <span class="toc-group-bar" title="${sharePct}% of part"><span style="width:${sharePct}%"></span></span>
              <span class="toc-group-count">${count}</span>
              ${isCarousel ? carouselCtrlHtml(blk.fullTitle, count) : ""}
            </div>
          </header>
          ${subpartFront ? `<div class="front-matter"><details><summary>Subpart notes</summary>${subpartFront}</details></div>` : ""}
          <div class="toc-carousel${isCarousel ? " is-carousel" : " is-static"}" data-count="${count}" data-active-idx="0">
            <div class="toc-viewport" tabindex="${isCarousel ? "0" : "-1"}" role="region" aria-label="${escapeHtml(blk.fullTitle)} thumbnails">
              <ul class="toc-list toc-carousel-track">${blk.children.map((c, idx) => itemHtml(c, idx)).join("")}</ul>
            </div>
            ${isCarousel ? `<div class="toc-cpips" role="tablist" aria-label="Jump to page in ${escapeHtml(blk.fullTitle)}"></div>` : ""}
          </div>
        </section>`;
		} else {
			const flatHead = isCarousel ? `<header class="toc-group-head">
            <div class="toc-group-titles"><span class="toc-group-name">Sections</span></div>
            <div class="toc-group-right">
              <span class="toc-group-count">${count}</span>
              ${carouselCtrlHtml("Sections", count)}
            </div>
          </header>` : "";
			groupsHtml += `
        <section class="toc-group is-flat" data-ref-tier="${tier}">
          ${flatHead}
          <div class="toc-carousel${isCarousel ? " is-carousel" : " is-static"}" data-count="${count}" data-active-idx="0">
            <div class="toc-viewport" tabindex="${isCarousel ? "0" : "-1"}" role="region" aria-label="Part sections thumbnails">
              <ul class="toc-list toc-carousel-track">${blk.children.map((c, idx) => itemHtml(c, idx)).join("")}</ul>
            </div>
            ${isCarousel ? `<div class="toc-cpips" role="tablist" aria-label="Jump to page in sections"></div>` : ""}
          </div>
        </section>`;
		}
	}
	const statItems = [
		subparts.length ? `<div class="toc-stat"><span class="toc-stat-val">${subparts.length}</span><span class="toc-stat-lbl">${subparts.length === 1 ? "Subpart" : "Subparts"}</span></div>` : "",
		`<div class="toc-stat"><span class="toc-stat-val">${activeCount}</span><span class="toc-stat-lbl">${activeCount === 1 ? "Active §" : "Active §§"}</span></div>`,
		appendixCount ? `<div class="toc-stat is-app"><span class="toc-stat-val">${appendixCount}</span><span class="toc-stat-lbl">${appendixCount === 1 ? "Appendix" : "Appendices"}</span></div>` : "",
		reservedCount ? `<div class="toc-stat is-muted"><span class="toc-stat-val">${reservedCount}</span><span class="toc-stat-lbl">Reserved</span></div>` : "",
		readCount ? `<div class="toc-stat is-read"><span class="toc-stat-val">${readCount}</span><span class="toc-stat-lbl">Visited</span></div>` : "",
		pinnedCount ? `<div class="toc-stat is-pin"><span class="toc-stat-val">${pinnedCount}</span><span class="toc-stat-lbl">Pinned</span></div>` : ""
	].filter(Boolean).join("");
	const mapBarHtml = subparts.length >= 2 ? `<div class="toc-map-bar" role="navigation" aria-label="Part structure map">
        ${subparts.map((sp, i) => {
		const pct = Math.max(2, Math.round(sp.count / totalSecs * 100));
		return `<button type="button" class="toc-map-seg" style="flex:${Math.max(1, sp.count)} 1 0;--seg-i:${i % 6}" data-toc-jump="${escapeHtml(sp.anchorId)}" title="${escapeHtml(sp.rawLabel)}: ${escapeHtml(sp.fullTitle)} (${plural(sp.count, "section")}, ${pct}%)"><span class="toc-map-code">${escapeHtml(sp.code)}</span></button>`;
	}).join("")}
      </div>
      <div class="toc-subpart-chips">
        ${subparts.map((sp) => `<button type="button" class="toc-sub-chip" data-toc-jump="${escapeHtml(sp.anchorId)}"><span class="toc-sub-code">${escapeHtml(sp.code)}</span><span class="toc-sub-name">${escapeHtml(sp.fullTitle)}</span><span class="toc-sub-cnt">${sp.count}</span></button>`).join("")}
      </div>` : "";
	const atlasHtml = sectionCount > 0 ? `<section class="toc-atlas surface-card has-tier-bar" data-ref-tier="${tier}" aria-label="Part visual overview">
        <div class="toc-atlas-stats">${statItems}</div>
        ${mapBarHtml}
      </section>` : "";
	return {
		sectionCount,
		subpartCount: subparts.length,
		atlasHtml,
		groupsHtml
	};
}
var MAX_CONCURRENT_HYDRATE = 4;
var activeHydrates = 0;
var hydrateQueue = [];
var tocResizeObservers = /* @__PURE__ */ new WeakMap();
function pumpHydrateQueue() {
	while (activeHydrates < MAX_CONCURRENT_HYDRATE && hydrateQueue.length > 0) {
		const task = hydrateQueue.shift();
		if (!task || task.signal?.aborted || !task.slide.isConnected || task.slide.dataset.hydrated === "1") continue;
		activeHydrates++;
		hydrateSlideExcerptNow(task.slide, task.titleNum, task.signal).finally(() => {
			activeHydrates--;
			pumpHydrateQueue();
		});
	}
}
function hydrateSlideExcerpt(slide, titleNum, signal) {
	if (!slide || slide.dataset.hydrated === "1" || slide.dataset.queued === "1" || slide.classList.contains("reserved")) return;
	if (signal?.aborted) return;
	slide.dataset.queued = "1";
	hydrateQueue.push({
		slide,
		titleNum,
		signal
	});
	pumpHydrateQueue();
}
async function hydrateSlideExcerptNow(slide, titleNum, signal) {
	if (!slide || slide.dataset.hydrated === "1" || slide.classList.contains("reserved")) return;
	if (signal?.aborted) return;
	const secId = slide.dataset.secId;
	if (!secId) return;
	const cacheKey = `${titleNum}|${secId}|`;
	let data = state.peekCache.get(cacheKey) || state.peekCache.get(`${titleNum}|${secId}|full`) || null;
	if (!data) try {
		data = await fetchSectionCached(titleNum, secId, "?unit=", cacheKey, { signal });
		if (!data) return;
	} catch {
		delete slide.dataset.queued;
		return;
	}
	if (!slide.isConnected || signal?.aborted) return;
	slide.dataset.hydrated = "1";
	const exEl = slide.querySelector("[data-sec-excerpt]");
	const metaEl = slide.querySelector("[data-sec-meta]");
	const infoEl = slide.querySelector("[data-sec-info]");
	const { excerpt, refCount, docLen } = data.reserved ? {
		excerpt: "This section is reserved.",
		refCount: 0,
		docLen: 0
	} : extractDocExcerpt(data.html || "", {
		maxChars: 240,
		maxParas: 3
	});
	if (exEl && excerpt) exEl.textContent = excerpt;
	const outline = Array.isArray(data.outline) ? data.outline : [];
	if (metaEl) {
		if (outline.length > 1) metaEl.textContent = `${outline.length} units`;
		else if (data.kind === "appendix") metaEl.textContent = "Appendix";
		else metaEl.textContent = "Single page";
	}
	if (infoEl) {
		const totalChars = outline.reduce((acc, u) => acc + (Number(u.chars) || 0), 0) || docLen;
		const mins = totalChars > 0 ? Math.max(1, Math.round(totalChars / 1200)) : 0;
		const appGroups = new Set(outline.filter((u) => u.kind === "appendix").map((u) => u.group || u.key));
		const facts = [];
		if (totalChars > 0) facts.push(`<span class="toc-fact">${totalChars < 700 ? "<1 min" : `~${mins} min`}</span>`);
		if (appGroups.size > 0) facts.push(`<span class="toc-fact is-app">+${appGroups.size} app.</span>`);
		if (refCount > 0) facts.push(`<span class="toc-fact">${refCount} ${refCount === 1 ? "ref" : "refs"}</span>`);
		infoEl.innerHTML = facts.join("");
	}
}
function getColsPerView(carousel) {
	if (!carousel) return 3;
	const raw = parseInt(getComputedStyle(carousel).getPropertyValue("--toc-cols"), 10);
	return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 3) : 3;
}
function buildCarouselPipList(totalSlides, perView) {
	const maxIdx = Math.max(0, totalSlides - perView);
	if (maxIdx <= 0) return [];
	const indices = [0];
	for (let i = perView; i < maxIdx; i += perView) indices.push(i);
	if (indices[indices.length - 1] !== maxIdx) indices.push(maxIdx);
	return indices;
}
function positionCarousel(carousel) {
	if (!carousel) return;
	const viewport = carousel.querySelector(".toc-viewport");
	const track = carousel.querySelector(".toc-carousel-track");
	const wrap = carousel.closest(".toc-groups-wrap");
	const grp = carousel.closest(".toc-group") || carousel;
	if (!viewport || !track) return;
	if (wrap && (wrap.classList.contains("is-compact") || wrap.classList.contains("is-filtering")) || !carousel.classList.contains("is-carousel")) {
		track.style.transform = "none";
		return;
	}
	const slides = [...track.querySelectorAll(".toc-slide:not([hidden])")];
	const perView = getColsPerView(carousel);
	const maxIdx = Math.max(0, slides.length - perView);
	const rawIdx = Number(carousel.dataset.activeIdx) || 0;
	const clamped = Math.max(0, Math.min(rawIdx, maxIdx));
	carousel.dataset.activeIdx = String(clamped);
	if (slides.length <= perView || !slides[0]) track.style.transform = "none";
	else {
		const targetSlide = slides[clamped] || slides[0];
		const offsetX = Math.max(0, Math.round(targetSlide.offsetLeft - slides[0].offsetLeft));
		track.style.transform = `translate3d(${-offsetX}px, 0, 0)`;
	}
	slides.forEach((s, i) => {
		const visible = i >= clamped && i < clamped + perView;
		s.classList.toggle("is-visible", visible);
		s.setAttribute("aria-hidden", String(!visible));
	});
	const prevBtn = grp.querySelector("[data-car-dir=\"-1\"]");
	const nextBtn = grp.querySelector("[data-car-dir=\"1\"]");
	if (prevBtn) prevBtn.disabled = clamped <= 0;
	if (nextBtn) nextBtn.disabled = clamped >= maxIdx;
	const cntEl = grp.querySelector(".toc-ccnt");
	if (cntEl) cntEl.textContent = `${String(clamped + 1).padStart(2, "0")}–${String(Math.min(slides.length, clamped + perView)).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
	const pipRow = carousel.querySelector(".toc-cpips");
	if (pipRow) {
		const pages = buildCarouselPipList(slides.length, perView);
		const activePage = pages.reduce((best, pIdx) => pIdx <= clamped ? pIdx : best, 0);
		pipRow.innerHTML = pages.map((pIdx, pageNo) => {
			const on = pIdx === activePage;
			const endP = Math.min(slides.length, pIdx + perView);
			return `<button type="button" role="tab" class="toc-cpip${on ? " is-active" : ""}" data-car-idx="${pIdx}" title="Show ${pIdx + 1}–${endP}" aria-label="Page ${pageNo + 1}: items ${pIdx + 1} to ${endP}" aria-selected="${on}"></button>`;
		}).join("");
	}
}
function setCarouselIndex(carousel, nextIdx, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
	if (!carousel) return;
	const track = carousel.querySelector(".toc-carousel-track");
	if (!track) return;
	const slides = [...track.querySelectorAll(".toc-slide:not([hidden])")];
	if (!slides.length) return;
	const perView = getColsPerView(carousel);
	const maxIdx = Math.max(0, slides.length - perView);
	const clamped = Math.max(0, Math.min(nextIdx, maxIdx));
	carousel.dataset.activeIdx = String(clamped);
	positionCarousel(carousel);
	const endIdx = Math.min(slides.length, clamped + perView + 1);
	for (let i = clamped; i < endIdx; i++) hydrateSlideExcerpt(slides[i], titleNum, signal);
}
function initPartTocCarousels(container, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
	if (!container) return;
	requestAnimationFrame(() => {
		if (signal?.aborted) return;
		const cars = [...container.querySelectorAll(".toc-carousel")];
		for (const car of cars) if (car.classList.contains("is-carousel")) positionCarousel(car);
		const observeAndHydrate = (car) => {
			if (car.classList.contains("is-carousel")) setCarouselIndex(car, Number(car.dataset.activeIdx) || 0, {
				titleNum,
				signal
			});
			else for (const slide of car.querySelectorAll(".toc-slide:not([hidden])")) hydrateSlideExcerpt(slide, titleNum, signal);
		};
		if (typeof IntersectionObserver !== "undefined") {
			const scrollRoot = container.closest(".split-body") || container.closest("#main, .main") || null;
			const io = new IntersectionObserver((entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					io.unobserve(entry.target);
					observeAndHydrate(entry.target);
				}
			}, {
				root: scrollRoot,
				rootMargin: "600px 0px"
			});
			for (const car of cars) io.observe(car);
			if (signal) signal.addEventListener("abort", () => io.disconnect(), { once: true });
		} else for (const car of cars) observeAndHydrate(car);
		const wrap = container.querySelector(".toc-groups-wrap");
		if (wrap && typeof ResizeObserver !== "undefined") {
			const prevRo = tocResizeObservers.get(wrap);
			if (prevRo) try {
				prevRo.disconnect();
			} catch {}
			const ro = new ResizeObserver(() => {
				for (const car of wrap.querySelectorAll(".toc-carousel.is-carousel")) positionCarousel(car);
			});
			tocResizeObservers.set(wrap, ro);
			ro.observe(wrap);
			if (signal) signal.addEventListener("abort", () => {
				ro.disconnect();
				tocResizeObservers.delete(wrap);
			}, { once: true });
		}
	});
}
function handlePartTocCarouselClick(e, root, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
	const t = e.target;
	const dirBtn = t?.closest("[data-car-dir]");
	if (dirBtn) {
		const car = dirBtn.closest(".toc-group")?.querySelector(".toc-carousel");
		if (car) setCarouselIndex(car, (Number(car.dataset.activeIdx) || 0) + Number(dirBtn.dataset.carDir) * getColsPerView(car), {
			titleNum,
			signal
		});
		return true;
	}
	const pipBtn = t?.closest("[data-car-idx]");
	if (pipBtn) {
		const car = pipBtn.closest(".toc-carousel");
		if (car) setCarouselIndex(car, Number(pipBtn.dataset.carIdx) || 0, {
			titleNum,
			signal
		});
		return true;
	}
	const jumpBtn = t?.closest("[data-toc-jump]");
	if (jumpBtn && jumpBtn.dataset.tocJump) {
		const id = jumpBtn.dataset.tocJump;
		const target = root ? root.querySelector(`#${CSS.escape(id)}`) : document.getElementById(id);
		if (target) {
			target.hidden = false;
			smoothScrollToTarget(target, { block: "start" });
			target.classList.remove("flash");
			target.offsetWidth;
			target.classList.add("flash");
		}
		return true;
	}
	return false;
}
function handlePartTocCarouselKeydown(e, { titleNum = state.currentTitle, signal = state.routeAbort?.signal } = {}) {
	if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return false;
	const car = e.target?.closest(".toc-carousel.is-carousel");
	if (!car) return false;
	const wrap = car.closest(".toc-groups-wrap");
	if (wrap?.classList.contains("is-compact") || wrap?.classList.contains("is-filtering")) return false;
	e.preventDefault();
	setCarouselIndex(car, (Number(car.dataset.activeIdx) || 0) + (e.key === "ArrowRight" ? 1 : -1) * getColsPerView(car), {
		titleNum,
		signal
	});
	return true;
}
// src/views/reader_part.ts
async function loadPart(partId) {
	dom.view.innerHTML = skeletonHtml("list", "Loading Part " + partId + "…");
	state.currentSection = null;
	state.currentPart = partId;
	updateChatContext();
	try {
		const seq = state.routeSeq;
		const signal = state.routeAbort?.signal;
		const [frontRes] = await Promise.all([fetchPartFront(state.currentTitle, partId, { signal }), ensureTreeLoaded()]);
		const front = frontRes.ok ? await frontRes.json() : {
			part: "",
			subparts: {}
		};
		if (seq !== state.routeSeq) return;
		const partNode = findPartInTree(state.treeData, partId);
		if (!partNode) {
			if (state.metaInfo?.partial && /^\d+[a-z]?(?:-\d+)?$/i.test(partId)) {
				clearTreeSelection();
				setViewHead("");
				await renderResolverPage(dom.view, {
					title: state.currentTitle,
					part: partId
				});
				return;
			}
			renderNotFound();
			return;
		}
		const toc = buildPartTocView({
			partNode,
			front,
			titleNum: state.currentTitle,
			tier: "cfr",
			isSplit: false
		});
		const viewMode = getTocViewMode();
		document.title = `Part ${partId} · Title ${state.currentTitle}`;
		setViewHead(docStepHtml(partId, null, firstSectionOf(partId)));
		const sep = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
		const toolsHtml = toc.sectionCount >= 2 ? `<div class="part-toc-tools">
          ${toc.sectionCount >= 6 ? `<input type="search" id="part-toc-filter" class="ui-input part-toc-filter" placeholder="Filter ${plural(toc.sectionCount, "section")} in Part ${escapeHtml(partId)}…" aria-label="Filter sections in part" autocomplete="off" spellcheck="false">` : "<span class=\"toc-tools-label\">Sections index</span>"}
          <span class="toc-filter-meta" id="part-toc-matches" aria-live="polite"></span>
          ${segmentedHtml({
			label: "Table of contents layout",
			value: viewMode,
			cls: "seg toc-view-toggle",
			dataAttr: "data-toc-view",
			items: [{
				value: "cards",
				label: "Thumbnails"
			}, {
				value: "compact",
				label: "Index"
			}]
		})}
        </div>` : "";
		dom.view.innerHTML = `
      <div class="doc-kicker" data-ref-tier="cfr">
        <span class="ref-badge">FEDERAL REG</span>${sep}<span>${state.currentTitle} CFR ${escapeHtml(partNode.l)}</span>
        ${toc.sectionCount ? `${sep}<span>${plural(toc.sectionCount, "section")}</span>` : ""}
        ${toc.subpartCount ? `${sep}<span>${plural(toc.subpartCount, "subpart")}</span>` : ""}
      </div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn btn-accent" href="#/part/${encodeURIComponent(partId)}/full">${icon("list")} See full part</a>
        ${newsActivityButtonHtml()}
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <button type="button" class="btn" id="btn-part-copy" title="Copy part link">${icon("link")} Copy link</button>
        </div>
      </div>
      ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ""}
      ${toc.atlasHtml}
      ${toolsHtml}
      <div class="toc-groups-wrap${viewMode === "compact" ? " is-compact" : ""}">
        ${toc.groupsHtml || "<p class=\"muted\">No sections listed in this part.</p>"}
      </div>
      <p class="part-toc-empty muted" id="part-toc-empty" hidden>No matching sections in Part ${escapeHtml(partId)}.</p>
    `;
		syncMainTabFromRoute({
			kind: "part",
			title: state.currentTitle,
			partId,
			full: false,
			label: `${state.currentTitle} CFR Part ${partId}`,
			heading: partNode.d || partNode.l || "",
			href: window.location.hash || `#/title/${state.currentTitle}/part/${encodeURIComponent(partId)}`
		});
		const swapX = state.swapMotionX || 0;
		state.swapMotionX = 0;
		enterView({ fromX: swapX });
		initPartTocCarousels(dom.view, {
			titleNum: state.currentTitle,
			signal
		});
		selectTreeNode("p-" + partId);
		recordPartVisit(partId, partNode.d);
		fillNewsActivity("part", partId, seq);
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return;
		console.error(err);
		setViewHead("");
		renderViewError(dom.view, "Failed to load part", (err instanceof Error ? err.message : "") || "Unexpected error", { onRetry: () => loadPart(partId) });
	}
}
async function loadPartFull(partId, params) {
	dom.view.innerHTML = skeletonHtml("doc", "Loading Part " + partId + "…");
	state.currentSection = null;
	state.currentPart = partId;
	updateChatContext();
	try {
		const seq = state.routeSeq;
		const signal = state.routeAbort?.signal;
		await ensureTreeLoaded();
		if (seq !== state.routeSeq) return;
		const partNode = findPartInTree(state.treeData, partId);
		if (!partNode) {
			if (state.metaInfo?.partial && /^\d+[a-z]?(?:-\d+)?$/i.test(partId)) {
				clearTreeSelection();
				setViewHead("");
				await renderResolverPage(dom.view, {
					title: state.currentTitle,
					part: partId
				});
				return;
			}
			renderNotFound();
			return;
		}
		const res = await fetchPartFull(state.currentTitle, partId, { signal });
		if (seq !== state.routeSeq) return;
		if (!res.ok) {
			renderNotFound();
			return;
		}
		const data = await res.json();
		if (seq !== state.routeSeq) return;
		const from = params && params.get("from");
		const anchorId = (id) => "sec-" + String(id).replace(/[^a-zA-Z0-9.\-]/g, "_");
		const sections = data.sections || [];
		const sectionsHtml = sections.map((s) => {
			const num = escapeHtml(s.label);
			const title = escapeHtml(s.title || "");
			const body = s.reserved ? "<div class=\"reserved-note\">This section is reserved.</div>" : s.html || "";
			return `<article class="full-section${s.id === from ? " is-from" : ""}" id="${anchorId(s.id)}">
        <header class="full-section-head has-tier-bar" data-ref-tier="cfr">
          <a class="full-section-anchor" href="${sectionHref(s.id)}" title="Open this section on its own">
            <span class="full-section-num">${num}</span>
            <span class="full-section-title">${title}</span>
          </a>
          <button type="button" class="lib-act full-section-split" data-full-split="${escapeHtml(s.id)}" title="Open ${num} side-by-side">Split</button>
        </header>
        ${body}
      </article>`;
		}).join("");
		document.title = `Part ${partId} (full) · Title ${state.currentTitle}`;
		const [prevPart, nextPart] = partNeighbors(partId);
		const partBtn = (node, dir) => node ? docStepBtn("part", dir, `#/part/${encodeURIComponent(String(node.id || ""))}/full`, `Part ${node.id || ""}`, node.d, `<span class="step-word">Part </span>${escapeHtml(node.id)}`) : "";
		setViewHead(prevPart || nextPart ? `<nav class="doc-step" aria-label="Previous and next part">${partBtn(prevPart, -1)}<span class="spacer"></span>${partBtn(nextPart, 1)}</nav>` : "");
		const sep = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
		dom.view.innerHTML = `
      <div class="doc-kicker" data-ref-tier="cfr">
        <span class="ref-badge">FULL PART</span>${sep}<span>${state.currentTitle} CFR ${escapeHtml(partNode.l)}</span>${sep}<span>${plural(sections.length, "section")}</span>${sep}<a href="#/part/${encodeURIComponent(partId)}">Table of contents</a>
      </div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn" href="#/part/${encodeURIComponent(partId)}">${icon("list")} Table of contents</a>
        ${newsActivityButtonHtml()}
        <button type="button" class="btn" id="btn-part-refs-ledger" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("list")} <span>Refs</span></button>
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <button type="button" class="btn" id="btn-part-copy" title="Copy direct link">${icon("link")} Copy link</button>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button type="button" id="part-font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button type="button" id="part-font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>
      </div>
      ${sectionsHtml || "<p class=\"muted\">No sections in this part.</p>"}
    `;
		enhanceDomAnchors(dom.view);
		state.swapMotionX = 0;
		syncMainTabFromRoute({
			kind: "part",
			title: state.currentTitle,
			partId,
			full: true,
			label: `${state.currentTitle} CFR Part ${partId} · Full`,
			heading: partNode.d || partNode.l || "",
			href: window.location.hash || `#/title/${state.currentTitle}/part/${encodeURIComponent(partId)}/full`
		});
		const refs = collectSectionReferences(dom.view);
		const ledgerBtn = document.getElementById("btn-part-refs-ledger");
		if (ledgerBtn && refs.length) {
			const span = ledgerBtn.querySelector("span");
			if (span) span.textContent = `Refs ${refs.length}`;
			ledgerBtn.hidden = false;
		}
		recordPartVisit(partId, partNode.d);
		fillNewsActivity("part", partId, seq);
		if (from) {
			const el = document.getElementById(anchorId(from));
			if (el) {
				let userScrolled = false;
				let lastSet = -1;
				const align = () => {
					if (userScrolled || signal?.aborted || !el.isConnected) return;
					if (lastSet >= 0 && Math.abs(dom.main.scrollTop - lastSet) > 4) {
						userScrolled = true;
						return;
					}
					const r = el.getBoundingClientRect();
					const m = dom.main.getBoundingClientRect();
					const rel = r.top - m.top;
					if (rel < 60 || rel > 100) {
						el.scrollIntoView({ block: "start" });
						lastSet = dom.main.scrollTop;
					}
				};
				requestAnimationFrame(align);
				document.fonts?.ready?.then(align);
				const onImgLoad = () => align();
				dom.view.addEventListener("load", onImgLoad, true);
				const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(align) : null;
				if (ro) ro.observe(dom.view);
				const stop = () => {
					dom.view.removeEventListener("load", onImgLoad, true);
					ro?.disconnect();
				};
				setTimeout(stop, 2600);
				signal?.addEventListener("abort", stop, { once: true });
			}
		} else dom.main.scrollTop = 0;
		selectTreeNode("s-" + (from || sections[0] && sections[0].id));
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return;
		console.error(err);
		setViewHead("");
		renderViewError(dom.view, "Failed to load part", (err instanceof Error ? err.message : "") || "Unexpected error", { onRetry: () => loadPartFull(partId, params) });
	}
}
onView("input", (e) => {
	const input = e.target;
	if (!input || input.id !== "part-toc-filter") return;
	const q = input.value.trim().toLowerCase();
	const wrap = dom.view.querySelector(".toc-groups-wrap");
	if (wrap) wrap.classList.toggle("is-filtering", Boolean(q));
	let visible = 0;
	let total = 0;
	for (const grp of dom.view.querySelectorAll(".toc-group")) {
		let grpShown = 0;
		for (const li of grp.querySelectorAll("li[data-hay]")) {
			total++;
			const show = !q || (li.dataset.hay || "").includes(q);
			li.hidden = !show;
			if (show) {
				grpShown++;
				visible++;
			}
		}
		grp.hidden = grpShown === 0;
		const cnt = grp.querySelector(".toc-group-count");
		if (cnt) cnt.textContent = String(grpShown);
	}
	if (!q) initPartTocCarousels(dom.view, { titleNum: state.currentTitle });
	else for (const car of dom.view.querySelectorAll(".toc-carousel")) positionCarousel(car);
	const metaEl = document.getElementById("part-toc-matches");
	if (metaEl) metaEl.textContent = q ? `${visible} of ${total} shown` : "";
	const emptyEl = document.getElementById("part-toc-empty");
	if (emptyEl) emptyEl.hidden = visible > 0 || !q;
});
onView("click", async (e) => {
	if (handlePartTocCarouselClick(e, dom.view)) return;
	const t = e.target;
	if (!t) return;
	const viewBtn = t.closest("[data-toc-view]");
	if (viewBtn) {
		const mode = viewBtn.dataset.tocView === "compact" ? "compact" : "cards";
		lsSet(TOC_VIEW_KEY, mode);
		const wrap = dom.view.querySelector(".toc-groups-wrap");
		if (wrap) wrap.classList.toggle("is-compact", mode === "compact");
		for (const b of dom.view.querySelectorAll("[data-toc-view]")) b.setAttribute("aria-pressed", String(b.dataset.tocView === mode));
		initPartTocCarousels(dom.view, { titleNum: state.currentTitle });
		return;
	}
	const tocSplit = t.closest("[data-toc-split]");
	if (tocSplit) {
		e.preventDefault();
		e.stopPropagation();
		emit("split:open", {
			title: state.currentTitle,
			sectionId: tocSplit.dataset.tocSplit,
			pushHistory: true
		});
		return;
	}
	const ledgerBtn = t.closest("#btn-part-refs-ledger");
	if (ledgerBtn) {
		openRefsLedgerPopover(ledgerBtn);
		return;
	}
	if (t.closest("#btn-part-copy")) {
		await copyText(window.location.href, "Link copied", "Couldn’t copy the link");
		return;
	}
	if (t.closest("#part-font-dec")) {
		adjustFontSize(-1);
		return;
	}
	if (t.closest("#part-font-inc")) {
		adjustFontSize(1);
		return;
	}
	const splitBtn = t.closest("[data-full-split]");
	if (splitBtn) emit("split:open", {
		title: state.currentTitle,
		sectionId: splitBtn.dataset.fullSplit,
		pushHistory: true
	});
});
onView("keydown", (e) => {
	handlePartTocCarouselKeydown(e);
});
// src/views/reader_usc.ts
var uscTitleHref = (title) => `#/usc/${title}/`;
var uscNodeHref = (title, nodeId) => `#/usc/${title}/node/${encodeURIComponent(nodeId)}`;
function findNodeAndParent(root, targetId, ancestors = []) {
	if (!root) return null;
	const kids = root.c || [];
	for (let i = 0; i < kids.length; i++) {
		const child = kids[i];
		if (child.id === targetId) return {
			node: child,
			ancestors,
			siblings: kids,
			index: i
		};
		const hit = findNodeAndParent(child, targetId, [...ancestors, child]);
		if (hit) return hit;
	}
	return null;
}
function nodeStats(n) {
	if (n.t === "section") return {
		total: 1,
		inactive: n.s ? 1 : 0,
		first: n.s ? null : n.id
	};
	let total = 0;
	let inactive = 0;
	let first = null;
	for (const c of n.c || []) {
		const s = nodeStats(c);
		total += s.total;
		inactive += s.inactive;
		if (!first && s.first) first = s.first;
	}
	return {
		total,
		inactive,
		first
	};
}
function nodeDisplayLabel(n) {
	const raw = (n.l || n.id || "").trim();
	return n.t === "section" ? raw.replace(/^§\s*/, "§ ") : raw;
}
function setUscActiveCorpus(titleNum, meta) {
	const id = `us:usc:${titleNum}-u.s.c.`;
	state.activeCorpusId = id;
	state.activeCorpus = {
		corpus_id: id,
		tier: "federal-statute",
		jurisdiction: "US",
		jurisdiction_label: "Federal",
		code: uscCite(titleNum),
		title_num: titleNum,
		name: meta?.title_name || `Title ${titleNum}`,
		desk: "all",
		agencies: ["U.S. Congress"],
		edition: meta?.release_point || null,
		section_count: meta?.section_count || 0,
		installed: true,
		status_label: "Installed"
	};
}
async function ensureUscTitleData(titleNum, signal) {
	let meta = state.installedUscTitles.find((t) => t.title === titleNum) || null;
	let tree = state.uscTrees.get(titleNum) || null;
	const [fetchedMeta, fetchedTree] = await Promise.all([meta ? Promise.resolve(meta) : fetchUscMeta(titleNum, { signal }), tree ? Promise.resolve(tree) : fetchUscTree(titleNum, { signal })]);
	if (fetchedMeta) meta = fetchedMeta;
	if (fetchedTree) {
		tree = fetchedTree;
		state.uscTrees.set(titleNum, fetchedTree);
	}
	return {
		meta,
		tree
	};
}
function renderUscTitleStart(titleNum, meta, tree) {
	setViewHead("");
	const top = tree?.c || [];
	const firstActive = tree ? nodeStats(tree).first : null;
	const installedCfr = new Set(state.installedTitles.map((t) => t.title));
	const linkedCfr = state.corpora.find((c) => c.tier === "federal-statute" && c.title_num === titleNum)?.linked_titles || [];
	const rows = top.map((n) => {
		const s = nodeStats(n);
		const num = nodeDisplayLabel(n);
		const name = n.d || "";
		const dim = s.total > 0 && s.inactive === s.total;
		const href = n.t === "section" ? uscSectionHref(titleNum, n.id) : uscNodeHref(titleNum, n.id);
		const status = n.t === "section" ? n.s ? `<span class="lib-row-note">${escapeHtml(n.s)}</span>` : "" : `${escapeHtml(fmtSections(s.total - s.inactive) || "No active sections")}${s.inactive ? `<span class="lib-row-note">${s.inactive} repealed or omitted</span>` : ""}`;
		return `<a class="lib-row${dim ? " is-dim" : ""}" href="${href}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${status}</span>
    </a>`;
	}).join("");
	const subParts = [
		meta?.release_point ? `Release ${meta.release_point}` : "",
		meta?.current_through ? `Current through ${meta.current_through}` : "",
		meta?.section_count ? `${meta.section_count.toLocaleString()} sections` : "",
		meta?.note_count ? `${meta.note_count.toLocaleString()} notes` : ""
	].filter(Boolean);
	dom.view.innerHTML = `<div class="ts-front">
    <header class="ts-masthead">
      <div class="ts-kicker">
        <span class="ref-badge" data-ref-tier="usc">U.S.C. · TITLE ${escapeHtml(uscTitleLabel(titleNum).toUpperCase())}${isUscAppendix(titleNum) ? " APPENDIX" : ""}</span>
        ${meta?.positive_law ? "<span class=\"ts-kicker-tag\">Positive law</span>" : ""}
        ${statPill("synced", "Installed")}
      </div>
      <h1 class="ts-title">${escapeHtml(meta?.title_name || `Title ${titleNum}`)}</h1>
      <p class="ts-sub">${escapeHtml(subParts.join(" · ") || "United States Code")}</p>
      <div class="ts-actions">
        ${firstActive ? `<a class="btn btn-accent" href="${uscSectionHref(titleNum, firstActive)}">${icon("book")}<span>Start reading</span></a>` : ""}
        <a class="btn" href="${uscLibHref(titleNum)}">${icon("grid")}<span>Title in Library</span></a>
      </div>
      ${linkedCfr.length ? `<div class="story-links" style="margin-top:12px"><span class="story-links-lbl">Implemented by</span>${cfrChipsHtml(linkedCfr, installedCfr)}</div>` : ""}
    </header>
    <section class="ts-section" aria-label="Contents">
      <div class="ts-sec-head">
        <h2 class="ts-sec-title">Chapters &amp; Divisions</h2>
        <input class="lib-filter" id="usc-node-filter" type="search" placeholder="Filter chapters…" aria-label="Filter chapters" autocomplete="off" spellcheck="false">
      </div>
      <div class="lib-list" id="usc-node-list">${rows || "<p class=\"lib-none\">No contents found in this title.</p>"}</div>
      <div class="lib-none" id="usc-node-none" aria-live="polite" hidden>Nothing matches that filter.</div>
    </section>
  </div>`;
	enterView();
}
function renderUscNode(titleNum, meta, tree, nodeId) {
	const hit = findNodeAndParent(tree, nodeId);
	if (!hit) {
		renderViewError(dom.view, "Chapter not found", `${uscCite(titleNum)} does not contain “${nodeId}”.`);
		return;
	}
	const { node, ancestors, siblings, index } = hit;
	const prevSib = index > 0 ? siblings[index - 1] : null;
	const nextSib = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
	setViewHead(prevSib || nextSib ? `<div class="doc-step">${prevSib ? docStepBtn("part", -1, uscNodeHref(titleNum, prevSib.id), nodeDisplayLabel(prevSib), prevSib.d || "") : "<span class=\"doc-step-spacer\"></span>"}<span class="doc-step-cur">${escapeHtml(nodeDisplayLabel(node))}</span>${nextSib ? docStepBtn("part", 1, uscNodeHref(titleNum, nextSib.id), nodeDisplayLabel(nextSib), nextSib.d || "") : "<span class=\"doc-step-spacer\"></span>"}</div>` : "");
	const crumbs = [`<a href="${uscTitleHref(titleNum)}">${escapeHtml(uscCite(titleNum))}</a>`, ...ancestors.map((a) => `<a href="${uscNodeHref(titleNum, a.id)}">${escapeHtml(nodeDisplayLabel(a))}</a>`)].join("<span class=\"sep\" aria-hidden=\"true\">›</span>");
	const rows = (node.c || []).map((c) => {
		const num = nodeDisplayLabel(c);
		const name = c.d || "";
		const href = c.t === "section" ? uscSectionHref(titleNum, c.id) : uscNodeHref(titleNum, c.id);
		const s = c.t === "section" ? null : nodeStats(c);
		const dim = c.t === "section" ? Boolean(c.s) : Boolean(s && s.total > 0 && s.inactive === s.total);
		const status = c.t === "section" ? c.s ? `<span class="lib-row-note">${escapeHtml(c.s)}</span>` : "" : `${escapeHtml(fmtSections((s?.total || 0) - (s?.inactive || 0)) || "No active sections")}`;
		return `<a class="lib-row${dim ? " is-dim" : ""}" href="${href}" data-hay="${escapeHtml(`${num} ${name}`.toLowerCase())}">
      <span class="lib-main"><span class="lib-num">${escapeHtml(num)}</span><span class="lib-name">${escapeHtml(name)}</span></span>
      <span class="lib-status">${status}</span>
    </a>`;
	}).join("");
	const sep = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
	const counts = nodeStats(node);
	dom.view.innerHTML = `<div class="usc-node-page">
    <div class="doc-kicker" data-ref-tier="usc">
      <span class="ref-badge">U.S. CODE</span>${sep}${crumbs}
      ${counts.total ? `${sep}<span>${plural(counts.total - counts.inactive, "active section")}</span>` : ""}
    </div>
    <h1 class="doc-title">${escapeHtml(nodeDisplayLabel(node))}${node.d ? ` — ${escapeHtml(node.d)}` : ""}</h1>
    <div class="doc-actions">
      ${counts.first ? `<a class="btn btn-accent" href="${uscSectionHref(titleNum, counts.first)}">${icon("book")} Start reading</a>` : ""}
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon("link")} Copy link</button>
      </div>
    </div>
    <div class="usc-node-tools">
      <input class="lib-filter" id="usc-node-filter" type="search" placeholder="Filter sections and subchapters…" aria-label="Filter sections" autocomplete="off" spellcheck="false">
    </div>
    <div class="lib-list" id="usc-node-list">${rows || "<p class=\"lib-none\">No sections in this division.</p>"}</div>
    <div class="lib-none" id="usc-node-none" aria-live="polite" hidden>Nothing matches that filter.</div>
  </div>`;
	enterView();
}
var uscUnitHref = (title, id, view) => `${uscSectionHref(title, id)}/${encodeURIComponent(view)}`;
/** The pinned header, as the CFR builds it: ‹ section | ‹ unit … unit › | section › in units mode. */
function uscStepHtml(titleNum, d, reading) {
	const secBtn = (s, dir) => s ? docStepBtn("section", dir, uscSectionHref(titleNum, s.id), s.label, s.heading || "") : "";
	const unitBtn = (u, dir) => u ? docStepBtn(unitKind(u), dir, uscUnitHref(titleNum, d.id, u.key), unitShort(u), unitName(u)) : "";
	const sep = "<span class=\"doc-step-sep\" aria-hidden=\"true\"></span>";
	const units = reading === "units";
	const left = [secBtn(d.prev, -1), units ? unitBtn(d.unit_prev, -1) : ""].filter(Boolean).join(sep);
	const right = [units ? unitBtn(d.unit_next, 1) : "", secBtn(d.next, 1)].filter(Boolean).join(sep);
	if (!left && !right) return "";
	return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}
function renderUscSection(titleNum, meta, d, full) {
	const outline = d.outline || [];
	const reading = d.mode === "units" && d.unit ? "units" : "scroll";
	const unitIdx = reading === "units" ? outline.findIndex((u) => u.key === d.unit) : -1;
	const current = unitIdx >= 0 ? outline[unitIdx] : null;
	setViewHead(uscStepHtml(titleNum, d, reading) + railHtml({
		id: d.id,
		outline,
		unit: d.unit || ""
	}, reading, (key) => uscUnitHref(titleNum, d.id, key)));
	const chapter = [...d.path || []].reverse().find((p) => p.t === "chapter") || (d.path || [])[0] || null;
	const chapterLabel = chapter ? [chapter.l, chapter.d].filter(Boolean).join(" — ").trim() : "";
	const chapterLink = chapter && chapterLabel ? chapter.id ? `<a href="${uscNodeHref(titleNum, chapter.id)}">${escapeHtml(chapterLabel)}</a>` : escapeHtml(chapterLabel) : "";
	const label = (d.label || `§ ${d.id}`).replace(/\.\s*$/, "");
	document.title = `${uscCite(titleNum)} ${label}${current ? " " + unitShort(current) : ""} · FRAMEWORK`;
	const toggle = d.mode !== "units" ? "" : full ? `<a class="btn" href="${uscSectionHref(titleNum, d.id)}">${icon("stack")} Read in parts</a>` : `<a class="btn" href="${uscUnitHref(titleNum, d.id, "full")}">${icon("expand")} See full section</a>`;
	const unitBanner = current ? `<div class="unit-context"><span>${escapeHtml(current.label ? `Subdivision ${current.label}` : current.title || "")}</span><span class="sep" aria-hidden="true">·</span><span class="unit-pos">Unit ${unitIdx + 1} of ${outline.length}</span></div>` : "";
	const notes = d.notes || [];
	let notesHtml = "";
	if (notes.length) {
		const groups = /* @__PURE__ */ new Map();
		for (const n of notes) {
			const cat = (n.category || "editorial").toLowerCase();
			if (!groups.has(cat)) groups.set(cat, []);
			groups.get(cat).push(n);
		}
		const blocks = [...groups.entries()].map(([cat, items]) => `
      <div class="usc-note-group">
        <h3 class="usc-note-cat">${escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1))} notes</h3>
        ${items.map((n) => `<div class="usc-note-card">${n.html}</div>`).join("")}
      </div>
    `).join("");
		notesHtml = `<section class="usc-notes" id="usc-notes" aria-label="Statutory and editorial notes">
      <h2 class="usc-notes-head">Notes <span class="usc-notes-count">${notes.length}</span></h2>
      ${blocks}
    </section>`;
	}
	dom.view.innerHTML = `
    <div class="doc-kicker" data-ref-tier="usc">
      <a href="${uscTitleHref(titleNum)}">${escapeHtml(uscCite(titleNum))}</a> ${chapterLink}
      ${meta?.release_point ? `<span class="sep" aria-hidden="true">·</span><span>Release ${escapeHtml(meta.release_point)}</span>` : ""}
    </div>
    <h1 class="doc-title">${escapeHtml(label)} ${escapeHtml(d.heading)}</h1>

    <div class="doc-actions">
      ${toggle}
      ${chapter?.id ? `<a class="btn" href="${uscNodeHref(titleNum, chapter.id)}">${icon("list")} Chapter contents</a>` : ""}
      ${pinButtonHtml(uscSectionRef(titleNum, d))}
      ${notes.length ? `<button type="button" class="btn" id="usc-jump-notes">${icon("stack")} Notes (${notes.length})</button>` : ""}
      <button type="button" class="btn" id="usc-btn-cited" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("link")} <span>Cited by</span></button>
      <button type="button" class="btn" id="usc-btn-refs" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("list")} <span>Refs</span></button>
      <button type="button" class="btn" id="usc-btn-laws" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("stack")} <span>Enacted by</span></button>
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <a class="btn" href="/usc/${titleNum}/${encodeURIComponent(d.id)}" target="_blank" rel="noopener" title="Open a printable standalone page">${icon("external")} Standalone</a>
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon("link")} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>

    ${d.status ? `<div class="reserved-note">This section is ${escapeHtml(d.status.toLowerCase())}.</div>` : ""}
    ${unitBanner}
    <div class="reg-body usc-body" id="reg-body">${d.html}</div>
    ${notesHtml}`;
	enhanceDomAnchors(dom.view);
	updateUscRefsButton();
	enterView();
	bindRail();
	if (reading === "scroll") watchRail();
}
function updateUscRefsButton() {
	const btn = document.getElementById("usc-btn-refs");
	if (!btn) return;
	const n = collectSectionReferences(dom.view).length;
	const span = btn.querySelector("span");
	if (span) span.textContent = n ? `Refs ${n}` : "Refs";
	btn.hidden = n === 0;
}
var citedCache = /* @__PURE__ */ new Map();
async function fillUscCitedBy(titleNum, sectionId, seq, signal) {
	const key = `${titleNum}|${sectionId}`;
	let data = citedCache.get(key) || null;
	if (!data) {
		try {
			data = await fetchUscCitations(titleNum, sectionId, { signal });
		} catch {
			return;
		}
		if (data) citedCache.set(key, data);
	}
	if (!data || !data.count || seq !== state.routeSeq || state.currentUscSection?.id !== sectionId) return;
	const btn = document.getElementById("usc-btn-cited");
	if (!btn) return;
	const span = btn.querySelector("span");
	if (span) span.textContent = `Cited by ${data.count}`;
	btn.hidden = false;
}
var lawsCache = /* @__PURE__ */ new Map();
async function fillUscLaws(titleNum, sectionId, seq, signal) {
	const key = `${titleNum}|${sectionId}`;
	let rows = lawsCache.get(key) || null;
	if (!rows) try {
		const d = await getJSON(`/api/plaw/usc/${titleNum}/${encodeURIComponent(sectionId)}`, { signal });
		if (!d.installed) return;
		rows = d.results;
		lawsCache.set(key, rows);
	} catch {
		return;
	}
	if (!rows.length || seq !== state.routeSeq || state.currentUscSection?.id !== sectionId) return;
	const btn = document.getElementById("usc-btn-laws");
	if (!btn) return;
	const span = btn.querySelector("span");
	if (span) span.textContent = `Enacted by ${rows.length}`;
	btn.hidden = false;
}
var LAW_KIND = {
	codified: "placed it here",
	note: "added a note here",
	reference: "amends or cites it"
};
function openUscLaws(btn, rows) {
	const html = rows.slice(0, 60).map((l) => {
		const how = (l.kinds || "").split(",").map((k) => LAW_KIND[k]).filter(Boolean).join(", ");
		return citedRow(lawHref(l.id), lawShort(l), [
			l.title || "",
			l.approved_date ? shortDate(l.approved_date) : "",
			how
		].filter(Boolean).join(" · "));
	}).join("");
	citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">${plural(rows.length, "Public Law")} touch this section</div>
      <span class="peek-badge">ENACTED BY</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close Public Laws">${icon("close")}</button>
    </div>
    <div class="refs-ledger-wrap"><div class="refs-ledger-group" data-ref-tier="usc">${html}</div></div>
    <p class="peek-text">From the Public Laws installed on this computer (GovInfo has them from the 113th Congress, 2013, on).</p>
  `, {
		interactive: true,
		returnFocus: btn,
		focusSelector: ".refs-ledger-link",
		refTier: "usc"
	});
}
function citedRow(href, code, sub) {
	return `<div class="refs-ledger-row"><a class="refs-ledger-link" href="${href}"><span class="refs-ledger-code">${escapeHtml(code)}</span><span class="refs-ledger-sub">${escapeHtml(sub)}</span></a></div>`;
}
function openUscCitedBy(btn, d) {
	const group = (tier, label, rows) => rows.length ? `<div class="refs-ledger-group" data-ref-tier="${tier}"><div class="refs-ledger-head"><span class="tier-pip" aria-hidden="true"></span><span>${escapeHtml(label)}</span><span class="refs-ledger-count">${rows.length}</span></div>${rows.slice(0, 60).join("")}</div>` : "";
	const html = `<div class="refs-ledger-wrap">${[
		group("cfr", "Regulations written under it (Authority)", d.authority.map((a) => citedRow(`#/title/${a.title}/part/${encodeURIComponent(a.part)}`, `${a.title} CFR Part ${a.part}`, "Authority line cites this section"))),
		group("cross", "CFR sections citing it", d.cfr.map((c) => citedRow(`#/title/${c.title}/section/${encodeURIComponent(c.id)}`, `${c.title} CFR ${c.label}`, c.heading + (c.paragraphs.length ? ` · cites ${c.paragraphs.join(", ")}` : "")))),
		group("usc", "U.S. Code sections citing it", d.usc.map((u) => citedRow(uscSectionHref(u.title, u.id), `${u.title} U.S.C. ${u.label}`, u.heading)))
	].join("")}</div>`;
	citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Cited by ${plural(d.count, "item")} in your library</div>
      <span class="peek-badge">CITED BY</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close citing sections">${icon("close")}</button>
    </div>
    ${html}
    <p class="peek-text">Only titles installed on this computer are searched.</p>
  `, {
		interactive: true,
		returnFocus: btn,
		focusSelector: ".refs-ledger-link",
		refTier: "usc"
	});
}
function renderUscDrawerHtml(titleNum) {
	const top = state.uscTrees.get(titleNum)?.c || [];
	const curSection = state.currentUscSection?.id || null;
	const curNode = state.currentUscNode || null;
	const isStart = !curSection && !curNode;
	const chapters = top.map((n) => {
		const href = n.t === "section" ? uscSectionHref(titleNum, n.id) : uscNodeHref(titleNum, n.id);
		const active = curNode === n.id || curSection && n.t === "section" && curSection === n.id;
		const label = nodeDisplayLabel(n);
		const title = n.d ? ` · ${n.d}` : "";
		return `<a class="dr-row${active ? " is-current" : ""}" href="${href}"${active ? " aria-current=\"page\"" : ""} title="${escapeHtml(label + title)}">
      <span class="tier-pip" data-ref-tier="usc" aria-hidden="true"></span>
      <span class="dr-name">${escapeHtml(label)}${n.d ? ` — ${escapeHtml(n.d)}` : ""}</span>
    </a>`;
	}).join("");
	return `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>Framework Navigation</span></h3>
      <a class="dr-row${isStart ? " is-current" : ""}" href="${uscTitleHref(titleNum)}"${isStart ? " aria-current=\"page\"" : ""}>
        <span class="tier-pip" data-ref-tier="usc" aria-hidden="true"></span>
        <span class="dr-name">Title ${uscTitleLabel(titleNum)} start page</span>
      </a>
      <a class="dr-row" href="${uscLibHref(titleNum)}">
        <span class="dr-name">Manage in Library</span>${icon("chevronRight")}
      </a>
    </section>
    <section class="dr-sec">
      <h3 class="dr-label"><span>Chapters &amp; Divisions</span><span class="dr-count">${top.length}</span></h3>
      ${chapters || "<p class=\"dr-note\">Loading contents…</p>"}
    </section>
    <div class="dr-foot">
      <a class="dr-link" href="#/library/usc">U.S. Code catalog</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}
async function loadUscRoute(titleNum, opts = {}) {
	const seq = state.routeSeq;
	const signal = state.routeAbort?.signal;
	state.currentUscTitle = titleNum;
	state.currentUscNode = opts.nodeId || null;
	state.currentUscSection = null;
	state.currentSection = null;
	const { meta, tree } = await ensureUscTitleData(titleNum, signal);
	if (seq !== state.routeSeq) return;
	if (!meta && !tree) {
		setViewHead("");
		renderViewError(dom.view, `${uscCite(titleNum)} is not installed`, "Download this U.S. Code title in the Library to read it inside FRAMEWORK.");
		return;
	}
	setUscActiveCorpus(titleNum, meta);
	const drawerPanel = document.getElementById("panel-corpus");
	if (drawerPanel) drawerPanel.innerHTML = renderUscDrawerHtml(titleNum);
	if (opts.sectionId) {
		try {
			const full = opts.view === "full";
			const pTok = /^\(([0-9A-Za-z]{1,8})\)/.exec(opts.para || "");
			const unit = full ? null : opts.view || (pTok ? pTok[1].toLowerCase() : "");
			let sec;
			try {
				sec = await fetchUscSection(titleNum, opts.sectionId, { signal }, unit);
			} catch (err) {
				if (!pTok || opts.view || err?.name === "AbortError") throw err;
				sec = await fetchUscSection(titleNum, opts.sectionId, { signal }, null);
			}
			if (seq !== state.routeSeq) return;
			uscParaTools.hide();
			state.currentUscSection = sec;
			renderUscSection(titleNum, meta, sec, full);
			if (opts.para) highlightTarget(dom.view, opts.para);
			fillUscCitedBy(titleNum, sec.id, seq, signal);
			fillUscLaws(titleNum, sec.id, seq, signal);
			if (drawerPanel) drawerPanel.innerHTML = renderUscDrawerHtml(titleNum);
		} catch (err) {
			if (err?.name === "AbortError" || seq !== state.routeSeq) return;
			setViewHead("");
			renderViewError(dom.view, "Section not found", `${uscCite(titleNum)} § ${opts.sectionId} could not be loaded.`);
		}
		return;
	}
	if (opts.nodeId) {
		renderUscNode(titleNum, meta, tree, opts.nodeId);
		return;
	}
	renderUscTitleStart(titleNum, meta, tree);
}
var uscParaTools = createParaToolsController({
	root: dom.view,
	bodySelector: ".usc-body",
	paraSelector: ".usc-body .reg-p[id]",
	isActive: () => Boolean(state.currentUscSection && !state.currentSection),
	getSectionRef: currentSectionRef,
	citeTitle: "Copy U.S. Code citation"
});
onView("click", async (e) => {
	if (await uscParaTools.handleClick(e)) return;
	const t = e.target;
	if (!t) return;
	if (t.closest("#usc-jump-notes")) {
		document.getElementById("usc-notes")?.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
		return;
	}
	const refsBtn = t.closest("#usc-btn-refs");
	if (refsBtn && state.currentUscSection) {
		openRefsLedgerPopover(refsBtn, dom.view);
		return;
	}
	const lawsBtn = t.closest("#usc-btn-laws");
	if (lawsBtn && state.currentUscSection && state.currentUscTitle) {
		const rows = lawsCache.get(`${state.currentUscTitle}|${state.currentUscSection.id}`);
		if (rows) openUscLaws(lawsBtn, rows);
		return;
	}
	const citedBtn = t.closest("#usc-btn-cited");
	if (citedBtn && state.currentUscSection && state.currentUscTitle) {
		const data = citedCache.get(`${state.currentUscTitle}|${state.currentUscSection.id}`);
		if (data) openUscCitedBy(citedBtn, data);
	}
});
onView("input", (e) => {
	const inp = e.target?.closest("#usc-node-filter");
	if (!inp) return;
	const list = document.getElementById("usc-node-list");
	const none = document.getElementById("usc-node-none");
	if (!list) return;
	const q = inp.value.trim().toLowerCase();
	let shown = 0;
	for (const row of list.querySelectorAll(".lib-row")) {
		const hay = row.dataset.hay || "";
		const match = !q || hay.includes(q);
		row.hidden = !match;
		if (match) shown++;
	}
	if (none) none.hidden = shown > 0;
});
// src/views/reader_constitution.ts
function setConstActiveCorpus(c) {
	state.activeCorpusId = "us:constitution";
	state.activeCorpus = {
		corpus_id: "us:constitution",
		tier: "federal-constitution",
		jurisdiction: "US",
		jurisdiction_label: "Federal",
		code: "U.S. Const.",
		name: "Constitution of the United States",
		desk: "all",
		agencies: [],
		edition: c.meta.edition || null,
		section_count: c.unit_count,
		installed: true,
		status_label: "Installed"
	};
}
function bodyHtml(u) {
	const cite = constCitation(u.label);
	return splitClauses(u.text).map((c) => c.n == null ? `<p class="const-p">${escapeHtml(c.text)}</p>` : `<p class="const-p const-clause" id="cl${c.n}"><button type="button" class="const-cl" data-const-cite="${escapeHtml(`${cite}, cl. ${c.n}`)}" title="Copy ${escapeHtml(`${cite}, cl. ${c.n}`)}" aria-label="Clause ${c.n}: copy citation">${c.n}</button>${escapeHtml(c.text)}</p>`).join("");
}
function stepHtml$1(u, c) {
	const byId = new Map(c.outline.map((o) => [o.id, o]));
	const btn = (id, dir) => {
		const o = id ? byId.get(id) : null;
		return o ? docStepBtn("section", dir, constHref(o.id), o.label, constUnitName(o)) : "";
	};
	const left = btn(u.prev, -1);
	const right = btn(u.next, 1);
	if (!left && !right) return "";
	return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}
function groupLabel(u) {
	if (u.amendment) return {
		text: `Amendment ${toRoman(u.amendment)}`,
		href: CONST_START_HREF
	};
	if (u.article) return {
		text: `Article ${toRoman(u.article)} · ${articleName(u.article)}`,
		href: CONST_START_HREF
	};
	return {
		text: "Preamble",
		href: CONST_START_HREF
	};
}
function renderStart(c) {
	setViewHead("");
	document.title = "U.S. Constitution · FRAMEWORK";
	const g = constGroups(c.outline);
	const first = c.outline[0];
	dom.view.innerHTML = `<div class="ts-front const-front">
    <header class="ts-masthead">
      <div class="ts-kicker">
        <span class="ref-badge" data-ref-tier="const">CONST. · U.S. CONSTITUTION</span>
        ${statPill("synced", "Installed")}
      </div>
      <h1 class="ts-title">The Constitution of the United States</h1>
      <p class="ts-sub">${escapeHtml([
		constEdition(c),
		`${g.articles.length} articles`,
		`${g.amendments.length} amendments`,
		`${c.note_count.toLocaleString()} annotations`
	].filter(Boolean).join(" · "))}</p>
      <div class="ts-actions">
        ${first ? `<a class="btn btn-accent" href="${constHref(first.id)}">${icon("book")}<span>Start reading</span></a>` : ""}
        <a class="btn" href="${CONST_LIB_HREF}">${icon("grid")}<span>Constitution in Library</span></a>
      </div>
    </header>
    <section class="ts-section" aria-label="Contents">
      <div class="ts-sec-head">
        <h2 class="ts-sec-title">Articles &amp; Amendments</h2>
        <input class="lib-filter" id="const-filter" type="search" placeholder="Filter articles, amendments or topics…" aria-label="Filter the Constitution" autocomplete="off" spellcheck="false">
      </div>
      <div class="lib-list" id="const-list">${constContentsHtml(c)}</div>
      <div class="lib-none" id="const-none" aria-live="polite" hidden>Nothing matches. Try a topic (“speech”, “taxes”) or a number (“14”).</div>
    </section>
  </div>`;
	const amend = [...dom.view.querySelectorAll("#const-list .lib-label")].find((el) => el.textContent === "Amendments");
	if (amend) amend.id = "const-amendments";
	enterView();
}
function renderUnit(u, c) {
	setViewHead(stepHtml$1(u, c));
	const name = constUnitName(u);
	const cite = constCitation(u.label);
	const grp = groupLabel(u);
	document.title = `${cite} · FRAMEWORK`;
	const sep = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
	const notes = u.notes || [];
	const notesHtml = notes.length ? `<section class="usc-notes const-notes" id="const-notes" aria-label="Annotations">
      <h2 class="usc-notes-head">Annotations <span class="usc-notes-count">${notes.length}</span></h2>
      <p class="const-notes-src">Notes by the Parliamentarian of the House, from the House Rules and Manual. They explain how the text has been read; they are not part of it.</p>
      ${notes.map((n) => `<div class="usc-note-card"><p>${escapeHtml(n)}</p></div>`).join("")}
    </section>` : "";
	dom.view.innerHTML = `
    <div class="doc-kicker" data-ref-tier="const">
      <a href="${CONST_START_HREF}">U.S. Constitution</a>${sep}<a href="${grp.href}">${escapeHtml(grp.text)}</a>
      ${c.meta.edition ? `${sep}<span>${escapeHtml(constEdition(c))}</span>` : ""}
    </div>
    <h1 class="doc-title">${escapeHtml(u.label)}${name ? ` ${escapeHtml(name)}` : ""}</h1>
    <div class="doc-actions">
      ${pinButtonHtml(constSectionRef(u))}
      <button type="button" class="btn" id="const-btn-cite" data-const-cite="${escapeHtml(cite)}" title="Copy ${escapeHtml(cite)}">${icon("link")} Cite</button>
      ${notes.length ? `<button type="button" class="btn" id="const-jump-notes">${icon("stack")} Annotations (${notes.length})</button>` : ""}
      <a class="btn" href="${CONST_START_HREF}">${icon("list")} Contents</a>
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon("link")} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>
    <div class="reg-body const-body" id="reg-body">${bodyHtml(u)}</div>
    ${notesHtml}`;
	enterView();
}
function renderConstDrawerHtml(c) {
	const cur = state.currentConstUnit?.id || null;
	const g = constGroups(c?.outline || []);
	const row = (href, label, name, active) => `<a class="dr-row${active ? " is-current" : ""}" href="${href}"${active ? " aria-current=\"page\"" : ""} title="${escapeHtml(`${label}${name ? ` · ${name}` : ""}`)}">
      <span class="tier-pip" data-ref-tier="const" aria-hidden="true"></span>
      <span class="dr-name">${escapeHtml(label)}${name ? ` — ${escapeHtml(name)}` : ""}</span>
    </a>`;
	const arts = g.articles.map((a) => {
		const active = Boolean(cur && a.units.some((u) => u.id === cur));
		return row(constHref(a.units[0].id), a.label, a.name, active);
	}).join("");
	const amds = g.amendments.map((a) => {
		const active = Boolean(cur && a.units.some((u) => u.id === cur));
		return row(constHref(a.units[0].id), a.label.replace("Amendment", "Amdt."), a.name, active);
	}).join("");
	return `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>Framework Navigation</span></h3>
      ${row(CONST_START_HREF, "Contents", "", !cur)}
      ${g.preamble ? row(constHref("preamble"), "Preamble", "", cur === "preamble") : ""}
      <a class="dr-row" href="${CONST_LIB_HREF}"><span class="dr-name">Manage in Library</span>${icon("chevronRight")}</a>
    </section>
    <section class="dr-sec">
      <h3 class="dr-label"><span>Articles</span><span class="dr-count">${g.articles.length}</span></h3>
      ${arts || "<p class=\"dr-note\">Loading contents…</p>"}
    </section>
    <section class="dr-sec">
      <h3 class="dr-label"><span>Amendments</span><span class="dr-count">${g.amendments.length}</span></h3>
      ${amds}
    </section>
    <div class="dr-foot">
      <a class="dr-link" href="${CONST_LIB_HREF}">Constitution in Library</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}
async function loadConstitutionRoute(unitId) {
	const seq = state.routeSeq;
	const signal = state.routeAbort?.signal;
	state.currentSection = null;
	state.currentUscSection = null;
	state.currentConstUnit = null;
	const c = await fetchConstitution();
	if (seq !== state.routeSeq) return;
	if (!c?.installed) {
		setViewHead("");
		document.title = "U.S. Constitution · FRAMEWORK";
		dom.view.innerHTML = emptyStateHtml({
			title: "The Constitution isn’t installed",
			body: "Download it from the Constitution tab in the Library (it takes a few seconds), then come back here.",
			actionsHtml: `<a class="btn btn-accent" href="${CONST_LIB_HREF}">${icon("download")} Open the Constitution tab</a>`
		});
		return;
	}
	setConstActiveCorpus(c);
	const drawer = document.getElementById("panel-corpus");
	if (!unitId) {
		if (drawer) drawer.innerHTML = renderConstDrawerHtml(c);
		renderStart(c);
		return;
	}
	try {
		const u = await getJSON(`/api/constitution/unit/${encodeURIComponent(unitId)}`, { signal });
		if (seq !== state.routeSeq) return;
		state.currentConstUnit = u;
		if (drawer) drawer.innerHTML = renderConstDrawerHtml(c);
		renderUnit(u, c);
	} catch (err) {
		if (err?.name === "AbortError" || seq !== state.routeSeq) return;
		setViewHead("");
		if (drawer) drawer.innerHTML = renderConstDrawerHtml(c);
		renderViewError(dom.view, "Not found", `The Constitution has no part called “${unitId}”.`);
	}
}
onView("click", async (e) => {
	const t = e.target;
	if (!t) return;
	const citeBtn = t.closest("[data-const-cite]");
	if (citeBtn && state.currentConstUnit) {
		const cite = citeBtn.dataset.constCite || "";
		await copyText(cite, `Copied ${cite}`, "Couldn’t copy the citation");
		return;
	}
	if (t.closest("#const-jump-notes")) document.getElementById("const-notes")?.scrollIntoView({
		behavior: "smooth",
		block: "start"
	});
});
onView("input", (e) => {
	const inp = e.target?.closest("#const-filter");
	if (!inp) return;
	const list = document.getElementById("const-list");
	if (!list) return;
	const words = inp.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
	let shown = 0;
	let label = null;
	let labelHas = false;
	const close = () => {
		if (label) label.hidden = !labelHas;
	};
	for (const el of list.children) {
		if (el.classList.contains("lib-label")) {
			close();
			label = el;
			labelHas = false;
			continue;
		}
		const ok = words.every((w) => (el.dataset.hay || "").includes(w));
		el.hidden = !ok;
		if (ok) {
			shown++;
			labelHas = true;
		}
	}
	close();
	const none = document.getElementById("const-none");
	if (none) none.hidden = shown > 0;
});
// src/views/reader_plaw.ts
var LINK_GROUPS = [
	{
		kind: "codified",
		label: "Placed in the U.S. Code at",
		hint: "Its margin notes say these sections now hold its text."
	},
	{
		kind: "note",
		label: "Added as notes to",
		hint: "Provisions printed as statutory notes under these sections."
	},
	{
		kind: "reference",
		label: "Amends or cites",
		hint: "U.S. Code sections its text refers to, usually the ones it amends."
	}
];
function setLawActiveCorpus(law) {
	state.activeCorpusId = `us:plaw:${law.id}`;
	state.activeCorpus = {
		corpus_id: `us:plaw:${law.id}`,
		tier: "federal-statute",
		jurisdiction: "US",
		jurisdiction_label: "Federal",
		code: lawShort(law),
		name: law.title || "Public Law",
		desk: "all",
		agencies: ["U.S. Congress"],
		edition: law.statute || null,
		installed: true,
		status_label: "Installed"
	};
}
function uscChip(l, installed) {
	const label = `${uscCite(l.title)} § ${l.section}`;
	return installed.has(l.title) ? `<a class="citation-chip" data-ref-tier="usc" href="#/usc/${l.title}/section/${encodeURIComponent(l.section)}">${escapeHtml(label)}</a>` : `<a class="citation-chip is-dim" data-ref-tier="uninstalled" href="#/library/usc/${l.title}" title="${escapeHtml(`${uscCite(l.title)} isn’t installed`)}">${escapeHtml(label)}</a>`;
}
function plawUscPanelHtml(links) {
	if (!links.length) return "";
	const installed = new Set((state.installedUscTitles || []).map((t) => t.title));
	return `<section class="usc-notes plaw-usc" id="plaw-usc" aria-label="Where it went in the U.S. Code">
      <h2 class="usc-notes-head">Where it went in the U.S. Code</h2>
      ${LINK_GROUPS.map((g) => {
		const ls = links.filter((l) => l.kind === g.kind);
		if (!ls.length) return "";
		const shown = ls.slice(0, 80);
		return `<div class="plaw-usc-group">
        <h3 class="plaw-usc-head">${escapeHtml(g.label)} <span class="usc-notes-count">${ls.length}</span></h3>
        <p class="plaw-usc-hint">${escapeHtml(g.hint)}</p>
        <div class="story-links">${shown.map((l) => uscChip(l, installed)).join("")}${ls.length > shown.length ? `<span class="plaw-usc-more">and ${ls.length - shown.length} more</span>` : ""}</div>
      </div>`;
	}).join("")}
    </section>`;
}
var unitHref = (id, key) => lawHref(id, key);
function stepHtml(law, t) {
	const btn = (u, dir) => u ? docStepBtn("section", dir, unitHref(law.id, u.key), unitShort(u), unitName(u)) : "";
	const left = btn(t.unit_prev, -1);
	const right = btn(t.unit_next, 1);
	if (!left && !right) return "";
	return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}
function renderLaw(law, t, full) {
	const reading = t.mode === "units" && t.unit ? "units" : "scroll";
	const outline = t.outline || [];
	const idx = reading === "units" ? outline.findIndex((u) => u.key === t.unit) : -1;
	const cur = idx >= 0 ? outline[idx] : null;
	setViewHead(stepHtml(law, t) + railHtml({
		id: law.id,
		outline,
		unit: t.unit || ""
	}, reading, (key) => unitHref(law.id, key)));
	const short = lawShort(law);
	const cite = lawCitation(law);
	document.title = `${short}${cur ? ` ${unitShort(cur)}` : ""} · FRAMEWORK`;
	const sep = "<span class=\"sep\" aria-hidden=\"true\">·</span>";
	const toggle = t.mode !== "units" ? "" : full ? `<a class="btn" href="${lawHref(law.id)}">${icon("stack")} Read in parts</a>` : `<a class="btn" href="${lawHref(law.id, "full")}">${icon("expand")} See full law</a>`;
	const banner = cur ? `<div class="unit-context"><span>${escapeHtml(cur.group_label || short)}</span>${sep}<span class="unit-pos">Section ${idx + 1} of ${outline.length}</span></div>` : "";
	const head = cur && cur.key !== "preamble" && cur.label ? `<h2 class="plaw-sec-head">${escapeHtml(cur.label)}${cur.title ? ` <span class="plaw-sec-title">${escapeHtml(cur.title)}</span>` : ""}</h2>` : "";
	const links = law.usc || [];
	dom.view.innerHTML = `
    <div class="doc-kicker" data-ref-tier="usc">
      <a href="${plawLibHref(law.congress)}">Public Laws</a>${sep}<a href="${plawLibHref(law.congress)}">${ordinal(law.congress)} Congress (${congressYears(law.congress)})</a>
      ${law.approved_date ? `${sep}<span>Signed ${escapeHtml(shortDate(law.approved_date))}</span>` : ""}
      ${law.statute ? `${sep}<span>${escapeHtml(law.statute)}</span>` : ""}
      ${law.bill ? `${sep}<span>${escapeHtml(law.bill)}</span>` : ""}
    </div>
    <h1 class="doc-title">${escapeHtml(short)} ${escapeHtml(law.title || "")}</h1>
    <div class="doc-actions">
      ${toggle}
      <button type="button" class="btn" id="plaw-btn-cite" data-plaw-cite="${escapeHtml(cite)}" title="Copy ${escapeHtml(cite)}">${icon("link")} Cite</button>
      ${links.length ? `<button type="button" class="btn" id="plaw-jump-usc">${icon("list")} U.S. Code (${links.length})</button>` : ""}
      <div class="spacer"></div>
      <div class="doc-actions-util">
        <button type="button" class="btn" id="btn-copy-link" title="Copy direct link">${icon("link")} Copy link</button>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button type="button" id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button type="button" id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>
    </div>
    ${banner}
    <div class="reg-body usc-body plaw-body" id="reg-body">${head}${t.html}</div>
    ${plawUscPanelHtml(links)}
    <p class="plaw-prov">Source: GovInfo, ${escapeHtml(law.provenance?.source_url?.split("#")[0] || "bulk data")} · SHA-256 ${escapeHtml((law.provenance?.sha256 || "").slice(0, 12))}…</p>`;
	enhanceDomAnchors(dom.view);
	enterView();
	bindRail();
	if (reading === "scroll") watchRail();
}
function renderPlawDrawerHtml(law, t) {
	const outline = t?.outline || [];
	const cur = t?.unit || null;
	let lastGroup = null;
	const rows = outline.slice(0, 400).map((u) => {
		const groupHead = u.group_label && u.group_label !== lastGroup ? `<h3 class="dr-label"><span>${escapeHtml(u.group_label)}</span></h3>` : "";
		lastGroup = u.group_label || lastGroup;
		const active = cur === u.key;
		const label = [u.label, u.title].filter(Boolean).join(" — ");
		return `${groupHead}<a class="dr-row${active ? " is-current" : ""}" href="${unitHref(law.id, u.key)}"${active ? " aria-current=\"page\"" : ""} title="${escapeHtml(label)}">
        <span class="tier-pip" data-ref-tier="usc" aria-hidden="true"></span><span class="dr-name">${escapeHtml(label || u.key)}</span></a>`;
	}).join("");
	return `<div class="dr-scroll">
    <section class="dr-sec">
      <h3 class="dr-label"><span>${escapeHtml(lawShort(law))}</span><span class="dr-count">${outline.length}</span></h3>
      ${rows || "<p class=\"dr-note\">This law is one page.</p>"}
    </section>
    <div class="dr-foot">
      <a class="dr-link" href="${plawLibHref(law.congress)}">${ordinal(law.congress)} Congress</a>
      <a class="dr-link" href="#/">Back to Home</a>
    </div>
  </div>`;
}
async function loadLawRoute(id, view) {
	const seq = state.routeSeq;
	const signal = state.routeAbort?.signal;
	state.currentSection = null;
	state.currentUscSection = null;
	state.currentConstUnit = null;
	const full = view === "full";
	const unitQ = full ? "" : `?unit=${encodeURIComponent(view || "")}`;
	try {
		const [law, text] = await Promise.all([getJSON(`/api/plaw/law/${encodeURIComponent(id)}?text=false`, { signal }), getJSON(`/api/plaw/law/${encodeURIComponent(id)}/text${unitQ}`, { signal })]);
		if (seq !== state.routeSeq) return;
		setLawActiveCorpus(law);
		const drawer = document.getElementById("panel-corpus");
		if (drawer) drawer.innerHTML = renderPlawDrawerHtml(law, text);
		renderLaw(law, text, full);
	} catch (err) {
		if (err?.name === "AbortError" || seq !== state.routeSeq) return;
		setViewHead("");
		const msg = err instanceof Error ? err.message : String(err);
		if (/isn't installed|No such law/i.test(msg)) {
			document.title = "Public Law · FRAMEWORK";
			dom.view.innerHTML = emptyStateHtml({
				title: "This law isn’t in your library",
				body: "Public Laws download by Congress from the Library’s Public Laws tab.",
				actionsHtml: `<a class="btn btn-accent" href="#/library/plaw">${icon("download")} Open the Public Laws tab</a>`
			});
			return;
		}
		renderViewError(dom.view, "Couldn’t open this law", msg);
	}
}
onView("click", async (e) => {
	const t = e.target;
	if (!t) return;
	const cite = t.closest("#plaw-btn-cite");
	if (cite) {
		const text = cite.dataset.plawCite || "";
		await copyText(text, `Copied ${text}`, "Couldn’t copy the citation");
		return;
	}
	if (t.closest("#plaw-jump-usc")) document.getElementById("plaw-usc")?.scrollIntoView({
		behavior: "smooth",
		block: "start"
	});
});
// src/core/search_frameworks.ts
/** Every block the search page asks for. */
var SEARCH_INCLUDE = "fr,usc,constitution,plaw,agenda";
/** Display order: the authority chain, Constitution → statutes → regulations → rulemaking. */
var FRAMEWORK_ORDER = [
	"const",
	"usc",
	"plaw",
	"cfr",
	"fr",
	"agenda"
];
var FRAMEWORK_LABELS = {
	const: {
		label: "U.S. Constitution",
		short: "Constitution"
	},
	usc: {
		label: "United States Code",
		short: "U.S.C."
	},
	plaw: {
		label: "Public Laws",
		short: "Public Laws"
	},
	cfr: {
		label: "Code of Federal Regulations",
		short: "CFR"
	},
	fr: {
		label: "Federal Register",
		short: "Federal Register"
	},
	agenda: {
		label: "Unified Agenda",
		short: "Unified Agenda"
	}
};
var SEARCH_FRAMEWORKS = new Set(FRAMEWORK_ORDER);
var parseFrameworkFilter = (v) => v && SEARCH_FRAMEWORKS.has(v) ? v : "all";
/** The installed non-CFR frameworks of a response, in display order, rows normalized. */
function frameworkGroups(data) {
	const out = [];
	const add = (key, tier, total, rows) => {
		out.push({
			key,
			tier,
			...FRAMEWORK_LABELS[key],
			total: Math.max(Number(total) || 0, rows.length),
			rows
		});
	};
	const c = data.constitution;
	if (c?.installed) add("const", "const", c.total, c.results.map((r) => ({
		href: `#/constitution/${encodeURIComponent(r.id)}`,
		num: r.label || r.id,
		name: r.kind === "annotation" ? "Annotation" : "",
		meta: "",
		snippet: r.snippet || ""
	})));
	const u = data.usc;
	if (u?.installed) add("usc", "usc", u.total, u.results.map((r) => ({
		href: `#/usc/${r.usc_title}/section/${encodeURIComponent(r.id)}`,
		num: `${uscCite(r.usc_title)} § ${r.id}`,
		name: r.heading || "",
		meta: r.status || "",
		snippet: r.snippet || ""
	})));
	const p = data.plaw;
	if (p?.installed) add("plaw", "usc", p.total, p.results.map((r) => ({
		href: lawHref(r.id),
		num: lawShort(r),
		name: r.title || "",
		meta: [r.statute, r.approved_date].filter(Boolean).join(" · "),
		snippet: r.snippet || ""
	})));
	const f = data.fr;
	if (f?.installed) add("fr", "fr", f.total, f.results.map((r) => ({
		href: `#/news/fr/${encodeURIComponent(r.document_number)}`,
		num: r.citation || r.document_number,
		name: r.title || "",
		meta: [r.type, r.publication_date].filter(Boolean).join(" · "),
		snippet: r.snippet || r.abstract || ""
	})));
	const a = data.agenda;
	if (a?.installed) add("agenda", "fr", a.total, a.results.map((r) => ({
		href: agendaHref(r.rin, r.edition),
		num: `RIN ${r.rin}`,
		name: r.title || "",
		meta: [
			r.parent_acronym,
			stageShort(r.stage),
			editionLabel(r.edition)
		].filter(Boolean).join(" · "),
		snippet: r.snippet || ""
	})));
	return out;
}
// src/views/search.ts
state.searchState = null;
function renderResultRow(r, showTitleInPart) {
	let snippet = (r.snippet || "").replace(/^[\s.…]+|[\s.…]+$/g, "");
	snippet = escapeHtml(snippet).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
	const rTitle = r.title || state.currentTitle;
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
function buildFacetData(rawResults, filters) {
	const qText = filters.text.trim().toLowerCase();
	const applyFilters = (list, { ignoreTitle = false, ignorePart = false } = {}) => list.filter((r) => {
		const rTitle = r.title || state.currentTitle;
		if (!ignoreTitle && filters.title !== null && rTitle !== filters.title) return false;
		if (!ignorePart && filters.part !== null && (r.part || "") !== filters.part) return false;
		if (filters.kind !== "all" && (r.kind || "section") !== filters.kind) return false;
		if (qText) {
			if (!`${r.label || ""} ${r.title_label || ""} ${r.part || ""} ${r.snippet || ""} title ${rTitle}`.toLowerCase().includes(qText)) return false;
		}
		return true;
	});
	const filtered = applyFilters(rawResults);
	const titleCounts = /* @__PURE__ */ new Map();
	for (const r of applyFilters(rawResults, {
		ignoreTitle: true,
		ignorePart: true
	})) {
		const t = r.title || state.currentTitle;
		titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
	}
	const partCounts = /* @__PURE__ */ new Map();
	for (const r of applyFilters(rawResults, { ignorePart: true })) {
		const p = r.part || "";
		if (p) partCounts.set(p, (partCounts.get(p) || 0) + 1);
	}
	return {
		filtered,
		hasActiveFilter: filters.title !== null || filters.part !== null || filters.kind !== "all" || qText !== "",
		sortedTitleFacets: [...titleCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
		sortedPartFacets: [...partCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], void 0, { numeric: true })),
		hasAppendices: rawResults.some((r) => r.kind === "appendix")
	};
}
function renderGroupedResults(filtered, collapsed) {
	if (!filtered.length) return emptyStateHtml({
		title: "No matching results",
		body: "None of the loaded results match your current filters."
	});
	const byTitle = /* @__PURE__ */ new Map();
	for (const r of filtered) {
		const t = r.title || state.currentTitle;
		let bucket = byTitle.get(t);
		if (!bucket) {
			bucket = [];
			byTitle.set(t, bucket);
		}
		bucket.push(r);
	}
	return `<div class="search-groups">${[...byTitle.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).map(([t, tItems]) => {
		const tMeta = state.installedTitles.find((x) => x.title === t);
		const tLabel = tMeta ? `Title ${t} — ${tMeta.name}` : `Title ${t}`;
		const isCollapsed = collapsed.has(t);
		const byPart = /* @__PURE__ */ new Map();
		for (const r of tItems) {
			const p = r.part || "";
			let pBucket = byPart.get(p);
			if (!pBucket) {
				pBucket = [];
				byPart.set(p, pBucket);
			}
			pBucket.push(r);
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
      <section class="search-title-group has-tier-bar${isCollapsed ? " is-collapsed" : ""}" data-ref-tier="cfr" data-tgroup="${t}">
        <button type="button" class="search-title-head" aria-expanded="${!isCollapsed}">
          <span class="search-title-caret" aria-hidden="true">${icon("chevronDown")}</span>
          <span class="tier-pip" aria-hidden="true"></span>
          <span class="search-title-name">${escapeHtml(tLabel)}</span>
          <span class="ref-badge">FEDERAL CFR</span>
          <span class="search-title-count">${tItems.length} ${tItems.length === 1 ? "result" : "results"}</span>
        </button>
        <div class="search-title-body">${partsHtml}</div>
      </section>
    `;
	}).join("")}</div>`;
}
var hlSnippet = (raw) => {
	const html = escapeHtml(raw.replace(/^[\s.…]+|[\s.…]+$/g, "")).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
	return raw.includes("") ? `…${html}…` : html;
};
function frameworkRowHtml(r) {
	return `
    <div class="result">
      <a class="result-title" href="${escapeHtml(r.href)}">
        <span class="result-num">${escapeHtml(r.num)}</span>
        <span class="result-name">${escapeHtml(r.name)}</span>
        ${r.meta ? `<span class="result-part">${escapeHtml(r.meta)}</span>` : ""}
      </a>
      ${r.snippet ? `<div class="result-snippet">${hlSnippet(r.snippet)}</div>` : ""}
    </div>`;
}
var nResults = (n) => `${n.toLocaleString()} ${n === 1 ? "result" : "results"}`;
/** One framework's block: every row it returned, or a preview with "Show all" on the All view. */
function frameworkSectionHtml(key, tier, total, rowsHtml, preview) {
	const shown = preview ? rowsHtml.slice(0, 5) : rowsHtml;
	const more = preview && total > shown.length ? `<button type="button" class="search-fw-more" data-sfw="${key}">Show all ${total.toLocaleString()}</button>` : "";
	const capped = !preview && total > shown.length ? `<p class="search-fw-note">Showing the ${shown.length} best matches of ${total.toLocaleString()}. Add a word to narrow the search.</p>` : "";
	return `
    <section class="search-title-group has-tier-bar" data-ref-tier="${tier}" data-fwgroup="${key}">
      <div class="search-title-head is-static">
        <span class="tier-pip" aria-hidden="true"></span>
        <h2 class="search-title-name">${escapeHtml(FRAMEWORK_LABELS[key].label)}</h2>
        <span class="search-title-count">${nResults(total)}</span>
        ${more}
      </div>
      <div class="search-title-body"><div class="results-list">${shown.join("")}</div>${capped}</div>
    </section>`;
}
function frameworkPillsHtml(active, cfrTotal, groups) {
	const byKey = new Map(groups.map((g) => [g.key, g]));
	const grand = cfrTotal + groups.reduce((n, g) => n + g.total, 0);
	const pill = (key, label, n, tier) => `<button type="button" class="sf-pill${active === key ? " is-active" : ""}" data-sfw="${key}" aria-pressed="${active === key}"${tier ? ` data-ref-tier="${tier}"` : ""}>${tier ? "<span class=\"tier-pip\" aria-hidden=\"true\"></span>" : ""}${escapeHtml(label)} <span class="sf-pill-count">${n.toLocaleString()}</span></button>`;
	const pills = FRAMEWORK_ORDER.map((k) => {
		if (k === "cfr") return pill("cfr", FRAMEWORK_LABELS.cfr.short, cfrTotal, "cfr");
		const g = byKey.get(k);
		return g ? pill(g.key, g.short, g.total, g.tier) : "";
	}).join("");
	return `<span class="search-filter-label" id="search-fw-label">Framework</span>
    <div class="search-filter-pills" role="group" aria-labelledby="search-fw-label">${pill("all", "All", grand)}${pills}</div>`;
}
function searchHash(query, allTitles, framework) {
	return `#/search?q=${encodeURIComponent(query)}${allTitles ? "&scope=all" : ""}${framework !== "all" ? `&in=${framework}` : ""}`;
}
function patchSearchDynamicSlots() {
	if (!state.searchState) return;
	const { query, allTitles, data, view, filters, collapsed } = state.searchState;
	const rawResults = data.results || [];
	const total = Number(data.total || 0);
	const groups = frameworkGroups(data);
	const fwSlot = document.getElementById("search-fw-slot");
	const viewToggle = dom.view.querySelector(".search-view-toggle");
	let framework = groups.length ? state.searchState.framework : "cfr";
	if (framework !== "all" && framework !== "cfr" && !groups.some((g) => g.key === framework)) framework = "all";
	if (fwSlot) {
		fwSlot.hidden = !groups.length;
		fwSlot.innerHTML = groups.length ? frameworkPillsHtml(framework, total, groups) : "";
	}
	if (viewToggle) viewToggle.hidden = framework !== "cfr";
	if (framework !== "cfr") {
		const filtersEl = document.getElementById("search-filters-box");
		const count = document.getElementById("search-count-slot");
		const body = document.getElementById("search-results-slot");
		if (!body) return;
		if (filtersEl) filtersEl.hidden = true;
		const grand = total + groups.reduce((n, g) => n + g.total, 0);
		const one = groups.find((g) => g.key === framework);
		if (one) {
			if (count) count.textContent = `${nResults(one.total)} in ${one.label}`;
			body.innerHTML = one.rows.length ? `<div class="search-groups">${frameworkSectionHtml(one.key, one.tier, one.total, one.rows.map(frameworkRowHtml), false)}</div>` : emptyStateHtml({
				title: "No results",
				body: `Nothing in ${escapeHtml(one.label)} matches “${escapeHtml(query)}”.`
			});
			return;
		}
		if (count) count.textContent = `${nResults(grand)} across ${groups.length + 1} frameworks`;
		if (!grand) {
			body.innerHTML = emptyStateHtml({
				title: "No results",
				body: `Nothing in the installed frameworks matches “${escapeHtml(query)}”. Try fewer or different words.`
			});
			return;
		}
		const byKey = new Map(groups.map((g) => [g.key, g]));
		body.innerHTML = `<div class="search-groups">${FRAMEWORK_ORDER.map((k) => {
			if (k === "cfr") return rawResults.length ? frameworkSectionHtml("cfr", "cfr", total, rawResults.map((r) => renderResultRow(r, true)), true) : "";
			const g = byKey.get(k);
			return g && g.rows.length ? frameworkSectionHtml(g.key, g.tier, g.total, g.rows.map(frameworkRowHtml), true) : "";
		}).join("")}</div>`;
		return;
	}
	const countSlot = document.getElementById("search-count-slot");
	const facetsBar = document.getElementById("search-facets-slot");
	const kindSlot = document.getElementById("search-kind-slot");
	const clearSlot = document.getElementById("search-clear-slot");
	const filtersBox = document.getElementById("search-filters-box");
	const bodySlot = document.getElementById("search-results-slot");
	if (!bodySlot) return;
	for (const btn of dom.view.querySelectorAll("[data-sview]")) {
		const on = btn.dataset.sview === view;
		btn.classList.toggle("is-on", on);
		btn.setAttribute("aria-pressed", String(on));
	}
	if (!rawResults.length) {
		if (filtersBox) filtersBox.hidden = true;
		if (countSlot) countSlot.textContent = `0 results · ${data.ms} ms`;
		bodySlot.innerHTML = emptyStateHtml({
			title: "No results",
			body: `Nothing in ${allTitles ? "the installed titles" : "Title " + state.currentTitle} matches “${escapeHtml(query)}”. Try fewer or different words.`
		});
		return;
	}
	const { filtered, hasActiveFilter, sortedTitleFacets, sortedPartFacets, hasAppendices } = buildFacetData(rawResults, filters);
	const countText = view === "grouped" && hasActiveFilter ? `${filtered.length.toLocaleString()} of ${rawResults.length.toLocaleString()} shown (${total.toLocaleString()} total)` : `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`;
	if (countSlot) countSlot.textContent = `${countText} · ${data.ms} ms`;
	if (filtersBox) filtersBox.hidden = view !== "grouped";
	if (view === "grouped") {
		if (kindSlot) kindSlot.innerHTML = hasAppendices ? `
        <button type="button" class="sf-pill${filters.kind === "all" ? " is-active" : ""}" data-fkind="all">All types</button>
        <button type="button" class="sf-pill${filters.kind === "section" ? " is-active" : ""}" data-fkind="section">Sections</button>
        <button type="button" class="sf-pill${filters.kind === "appendix" ? " is-active" : ""}" data-fkind="appendix">Appendices</button>
      ` : "";
		if (clearSlot) clearSlot.innerHTML = hasActiveFilter ? "<button type=\"button\" class=\"sf-clear\" id=\"sf-clear\">Clear filters</button>" : "";
		if (facetsBar) facetsBar.innerHTML = (sortedTitleFacets.length > 1 ? `
        <div class="search-filter-row">
          <span class="search-filter-label">Titles</span>
          <div class="search-filter-pills">
            <button type="button" class="sf-pill${filters.title === null ? " is-active" : ""}" data-ftitle="">All <span class="sf-pill-count">${rawResults.length}</span></button>
            ${sortedTitleFacets.map(([t, c]) => `<button type="button" class="sf-pill${filters.title === t ? " is-active" : ""}" data-ftitle="${t}">Title ${t} <span class="sf-pill-count">${c}</span></button>`).join("")}
          </div>
        </div>` : "") + (sortedPartFacets.length > 1 ? `
        <div class="search-filter-row">
          <span class="search-filter-label">Parts</span>
          <div class="search-filter-pills">
            <button type="button" class="sf-pill${filters.part === null ? " is-active" : ""}" data-fpart="">All</button>
            ${sortedPartFacets.slice(0, 14).map(([p, c]) => `<button type="button" class="sf-pill${filters.part === p ? " is-active" : ""}" data-fpart="${escapeHtml(p)}">Part ${escapeHtml(p)} <span class="sf-pill-count">${c}</span></button>`).join("")}
          </div>
        </div>` : "");
		bodySlot.innerHTML = renderGroupedResults(filtered, collapsed);
	} else bodySlot.innerHTML = `<div class="results-list">${rawResults.map((r) => renderResultRow(r, allTitles)).join("")}</div>`;
}
function renderSearchView() {
	if (!state.searchState) return;
	const { query, allTitles, data, view, filters, framework } = state.searchState;
	const rawResults = data.results || [];
	let scopeHtml = "";
	if (state.installedTitles.length > 1) scopeHtml = `<span class="search-scope" role="group" aria-label="CFR search scope">
      <a class="${allTitles ? "" : "scope-on"}" href="${searchHash(query, false, framework)}"${allTitles ? "" : " aria-current=\"true\""}>Title ${state.currentTitle}</a>
      <a class="${allTitles ? "scope-on" : ""}" href="${searchHash(query, true, framework)}"${allTitles ? " aria-current=\"true\"" : ""}>All ${state.installedTitles.length} titles</a>
    </span>`;
	const viewToggleHtml = rawResults.length ? `<span class="search-view-toggle" role="group" aria-label="Results layout">
    <button type="button" class="${view === "compact" ? "is-on" : ""}" data-sview="compact" aria-pressed="${view === "compact"}">Compact</button>
    <button type="button" class="${view === "grouped" ? "is-on" : ""}" data-sview="grouped" aria-pressed="${view === "grouped"}">Grouped</button>
  </span>` : "";
	dom.view.innerHTML = `
    <div class="search-page">
      <div class="doc-kicker">Search</div>
      <h1 class="doc-title">${escapeHtml(query)}</h1>
      <div class="search-meta">
        <span id="search-count-slot" aria-live="polite"></span>
        <div class="search-controls">${viewToggleHtml}${scopeHtml}</div>
      </div>
      <div class="search-fw" id="search-fw-slot" hidden></div>
      <div class="search-filters" id="search-filters-box" role="region" aria-label="Filter search results" hidden>
        <div class="search-filter-row">
          <input type="search" id="sf-text" class="search-filter-input" value="${escapeHtml(filters.text)}" placeholder="Filter these results by section, part, or phrase…" autocomplete="off" spellcheck="false">
          <div class="search-filter-pills" id="search-kind-slot"></div>
          <span id="search-clear-slot"></span>
        </div>
        <div id="search-facets-slot"></div>
      </div>
      <div id="search-results-slot"></div>
    </div>
  `;
	patchSearchDynamicSlots();
}
onView("input", (e) => {
	const input = e.target;
	if (!input || input.id !== "sf-text" || !state.searchState || !dom.view.querySelector(".search-page")) return;
	state.searchState.filters.text = input.value;
	patchSearchDynamicSlots();
});
onView("click", (e) => {
	if (!state.searchState || !dom.view.querySelector(".search-page")) return;
	const t = e.target;
	if (!t) return;
	const fwBtn = t.closest("[data-sfw]");
	if (fwBtn) {
		const next = parseFrameworkFilter(fwBtn.dataset.sfw);
		if (next !== state.searchState.framework) {
			state.searchState.framework = next;
			history.replaceState(null, "", searchHash(state.searchState.query, state.searchState.allTitles, next));
			const wasPill = fwBtn.classList.contains("sf-pill");
			renderSearchView();
			const target = wasPill ? `.search-fw [data-sfw="${next}"]` : ".search-fw .sf-pill.is-active";
			dom.view.querySelector(target)?.focus();
		}
		return;
	}
	const viewBtn = t.closest("[data-sview]");
	if (viewBtn) {
		const next = viewBtn.dataset.sview === "grouped" ? "grouped" : "compact";
		if (next !== state.searchState.view) {
			state.searchState.view = next;
			lsSet("searchView", next);
			patchSearchDynamicSlots();
		}
		return;
	}
	const titlePill = t.closest("[data-ftitle]");
	if (titlePill) {
		const val = titlePill.dataset.ftitle === "" ? null : Number(titlePill.dataset.ftitle);
		state.searchState.filters.title = state.searchState.filters.title === val ? null : val;
		state.searchState.filters.part = null;
		patchSearchDynamicSlots();
		return;
	}
	const partPill = t.closest("[data-fpart]");
	if (partPill) {
		const val = partPill.dataset.fpart === "" ? null : partPill.dataset.fpart || null;
		state.searchState.filters.part = state.searchState.filters.part === val ? null : val;
		patchSearchDynamicSlots();
		return;
	}
	const kindPill = t.closest("[data-fkind]");
	if (kindPill) {
		const k = kindPill.dataset.fkind;
		if (k === "all" || k === "section" || k === "appendix") {
			state.searchState.filters.kind = k;
			patchSearchDynamicSlots();
		}
		return;
	}
	if (t.closest("#sf-clear")) {
		state.searchState.filters = {
			title: null,
			part: null,
			kind: "all",
			text: ""
		};
		const sfInput = document.getElementById("sf-text");
		if (sfInput) sfInput.value = "";
		patchSearchDynamicSlots();
		return;
	}
	const titleHead = t.closest(".search-title-head");
	if (titleHead) {
		const grp = titleHead.closest(".search-title-group");
		const tNum = Number(grp?.dataset.tgroup);
		if (!Number.isNaN(tNum)) {
			if (state.searchState.collapsed.has(tNum)) state.searchState.collapsed.delete(tNum);
			else state.searchState.collapsed.add(tNum);
			patchSearchDynamicSlots();
		}
	}
});
async function loadSearchPage(query, scope, framework) {
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	document.title = "Search · FRAMEWORK";
	setViewHead("");
	if (!query.trim()) {
		state.searchState = null;
		dom.view.innerHTML = "<div class=\"empty-state\"><h2>Search</h2><p>Type a word, phrase or section number in the search box above.</p></div>";
		return;
	}
	const allTitles = scope === "all" && state.installedTitles.length > 1;
	dom.view.innerHTML = skeletonHtml("list", `Searching for “${query}”…`);
	try {
		const seq = state.routeSeq;
		const signal = state.routeAbort?.signal;
		const data = await fetchSearchResults(allTitles ? "all" : state.currentTitle, query, 100, { signal }, SEARCH_INCLUDE);
		if (seq !== state.routeSeq) return;
		state.searchState = {
			query,
			allTitles,
			data,
			view: lsGet("searchView") === "grouped" ? "grouped" : "compact",
			framework: parseFrameworkFilter(framework),
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
		if (err instanceof Error && err.name === "AbortError") return;
		renderViewError(dom.view, "Search failed", (err instanceof Error ? err.message : "") || "Unexpected error", { onRetry: () => loadSearchPage(query, scope, framework) });
	}
}
// src/views/welcome.ts
state.profilesData = void 0;
function profileSummary(p, names) {
	const groups = [];
	for (const d of p.downloads || []) {
		let g = groups.find((x) => x.title === d.title);
		if (!g) {
			g = {
				title: d.title,
				parts: []
			};
			groups.push(g);
		}
		if (d.part) g.parts.push(String(d.part));
	}
	const partsText = (parts) => {
		if (!parts.length) return "";
		if (parts.length === 1) return `Part ${parts[0]}`;
		const nums = parts.map(Number);
		return nums.every((n) => !Number.isNaN(n)) && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1) ? `Parts ${parts[0]}–${parts[parts.length - 1]}` : `Parts ${parts.join(", ")}`;
	};
	return groups.map((g) => {
		const name = names[g.title] ? ` ${escapeHtml(names[g.title])}` : "";
		const parts = partsText(g.parts);
		return `<span class="welcome-item"><span class="welcome-item-num">${g.title}</span>${name}${parts ? `, ${parts}` : ""}</span>`;
	}).join("<span class=\"sep\" aria-hidden=\"true\">·</span>");
}
function welcomeProgressHtml() {
	const j = state.jobs.current;
	const queued = state.jobs.queued || [];
	if (!j && !queued.length) return "";
	const m = dockModel(j);
	const pctText = m.pct == null ? "" : `${m.pct}%`;
	const title = j ? escapeHtml(j.label) : "Preparing download";
	const steps = DOCK_STEPS.map((_, i) => `<span class="${i < m.step ? "is-done" : i === m.step ? "is-now" : ""}"></span>`).join("");
	const queueText = queued.length ? `+${queued.length} queued (${queued.map((q) => q.label).join(", ")})` : "Nothing else queued";
	return `
    <div class="welcome-progress">
      <section class="dock-card welcome-job" aria-label="Profile download progress">
        <div class="dock-head">
          <span class="stat-dot is-busy" aria-hidden="true"></span>
          <span class="dock-title">${title}</span>
          <span class="dock-pct">${pctText}</span>
        </div>
        <div class="dock-phase">
          <span class="dock-phase-text">${escapeHtml(j && j.cancelling ? "Cancelling…" : m.label)}</span>
          ${m.step >= 0 ? `<span class="dock-steps" aria-hidden="true">${steps}</span>` : ""}
        </div>
        ${transferTrackHtml(m.pct)}
        <div class="dock-tele"><span>${escapeHtml(m.left)}</span><span>${escapeHtml(m.right)}</span></div>
        <div class="dock-foot"><span class="dock-queue">${escapeHtml(queueText)}</span></div>
      </section>
      <p class="welcome-note">The reader opens as soon as the first title is ready; the rest keep downloading in the background. <a href="#/library">Open the library</a> to watch or add more.</p>
    </div>`;
}
async function renderWelcome() {
	const seq = state.routeSeq;
	state.currentSection = null;
	state.currentPart = null;
	clearTreeSelection();
	updateChatContext();
	document.title = "Welcome · FRAMEWORK";
	setViewHead("");
	if (!state.profilesData) {
		dom.view.innerHTML = skeletonHtml("list", "Loading…");
		try {
			state.profilesData = await getJSON("/api/profiles");
		} catch (err) {
			if (seq !== state.routeSeq) return;
			dom.view.innerHTML = emptyStateHtml({
				title: "Couldn’t load the profiles",
				body: escapeHtml(err instanceof Error ? err.message : "Failed to load profiles"),
				actionsHtml: "<button type=\"button\" class=\"btn\" id=\"welcome-retry\">Try again</button>"
			});
			document.getElementById("welcome-retry")?.addEventListener("click", () => renderWelcome());
			return;
		}
		if (seq !== state.routeSeq) return;
	}
	const names = state.profilesData.title_names || {};
	const busy = Boolean(state.jobs.current || state.jobs.queued && state.jobs.queued.length);
	dom.view.innerHTML = `
    <div class="welcome">
      <div class="doc-kicker">Welcome</div>
      <div class="welcome-head">
        <h1 class="doc-title">What do you work in?</h1>
        <p>Nothing is installed yet. Pick a profile and FRAMEWORK downloads those regulations from eCFR, one title at a time. You can add or remove titles later from the library.</p>
      </div>
      <div id="welcome-job-slot">${welcomeProgressHtml()}</div>
      <div class="welcome-list" id="welcome-list"${busy ? " hidden" : ""}>
        ${state.profilesData.profiles.map((p) => `
          <button type="button" class="welcome-card" data-profile="${escapeHtml(p.id)}">
            <span class="welcome-card-name">${escapeHtml(p.name)}</span>
            <span class="welcome-card-desc">${escapeHtml(p.description)}</span>
            <span class="welcome-card-meta">${profileSummary(p, names)}</span>
          </button>`).join("")}
        <a class="welcome-card welcome-own" href="#/library">
          <span class="welcome-card-name">Choose my own</span>
          <span class="welcome-card-desc">Browse all 50 titles and download whole titles, parts or single sections.</span>
        </a>
      </div>
    </div>`;
	enterView();
}
function refreshWelcome() {
	const slot = document.getElementById("welcome-job-slot");
	const list = document.getElementById("welcome-list");
	if (!slot || !list) return;
	slot.innerHTML = welcomeProgressHtml();
	const busy = Boolean(state.jobs.current || state.jobs.queued && state.jobs.queued.length);
	list.hidden = busy;
	if (!busy) for (const b of list.querySelectorAll("button")) b.disabled = false;
}
async function installProfile(p) {
	for (const d of p.downloads || []) {
		const job = await getJSON("/api/library/download", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: d.title,
				part: d.part ? String(d.part) : null,
				section: null,
				kind: "section"
			})
		});
		state.jobsSeenActive.add(job.id);
	}
	await pollJobs();
}
onView("click", async (e) => {
	const btn = e.target?.closest("button[data-profile]");
	if (!btn || !dom.view.querySelector(".welcome")?.contains(btn)) return;
	const profile = (state.profilesData?.profiles)?.find((x) => x.id === btn.dataset.profile);
	if (!profile) return;
	const list = document.getElementById("welcome-list");
	if (list) for (const b of list.querySelectorAll("button")) b.disabled = true;
	try {
		await installProfile(profile);
	} catch (err) {
		showToast(err instanceof Error ? err.message : "Install failed", 6e3);
	}
	refreshWelcome();
});
on("jobs:updated", () => refreshWelcome());
on("jobs:finished", () => refreshWelcome());
// src/router.ts
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
	state.activeRoute = path;
	const seq = ++state.routeSeq;
	if (state.routeAbort) try {
		state.routeAbort.abort();
	} catch {}
	state.routeAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
	syncNavToRoute(path);
	if (state.noTitles && !/^\/(library|news|projects|settings|help|corpus|usc|constitution|law)(\/|$)/.test(path)) {
		emit("route:changed", { path });
		await renderWelcome();
		return;
	}
	const uscMatch = /^\/usc\/(\d+)(?:\/(.*))?$/.exec(path);
	if (uscMatch) {
		hideMainTabs();
		clearTreeSelection();
		const uscTitle = parseInt(uscMatch[1], 10);
		const rest = (uscMatch[2] || "").replace(/^\/+/, "");
		const decodeUsc = (s) => {
			try {
				return decodeURIComponent(s);
			} catch {
				return s;
			}
		};
		if (rest.startsWith("section/")) {
			const [rawId, rawView] = rest.slice(8).split("/");
			await loadUscRoute(uscTitle, {
				sectionId: decodeUsc(rawId),
				view: rawView ? decodeUsc(rawView) : null,
				para: params.get("p")
			});
		} else if (rest.startsWith("node/")) await loadUscRoute(uscTitle, { nodeId: decodeUsc(rest.slice(5)) });
		else await loadUscRoute(uscTitle);
		applyNav();
		emit("route:changed", { path });
		return;
	}
	state.currentUscTitle = null;
	state.currentUscNode = null;
	state.currentUscSection = null;
	const constMatch = /^\/constitution(?:\/([^/]*))?\/?$/.exec(path);
	if (constMatch) {
		hideMainTabs();
		clearTreeSelection();
		let unitId = null;
		try {
			unitId = constMatch[1] ? decodeURIComponent(constMatch[1]) : null;
		} catch {
			unitId = constMatch[1] || null;
		}
		await loadConstitutionRoute(unitId);
		applyNav();
		emit("route:changed", { path });
		return;
	}
	state.currentConstUnit = null;
	const lawMatch = /^\/law\/([^/]+)(?:\/([^/]+))?\/?$/.exec(path);
	if (lawMatch) {
		hideMainTabs();
		clearTreeSelection();
		const dec = (s) => {
			try {
				return decodeURIComponent(s);
			} catch {
				return s;
			}
		};
		await loadLawRoute(dec(lawMatch[1]), lawMatch[2] ? dec(lawMatch[2]) : null);
		applyNav();
		emit("route:changed", { path });
		return;
	}
	let checkPath = path;
	let titleMatch = path.match(/^\/title\/(\d+)(\/.*)?$/);
	const corpusMatch = !titleMatch ? parseCorpusPath(path) : null;
	if (corpusMatch) {
		syncCorporaState();
		const isCfr = corpusMatch.tier === "federal-reg" || corpusMatch.tier === "cfr";
		const cfrTitleNum = isCfr ? parseInt(corpusMatch.code, 10) : NaN;
		if (isCfr && Number.isFinite(cfrTitleNum)) titleMatch = [
			path,
			String(cfrTitleNum),
			corpusMatch.subPath
		];
		else if (corpusMatch.tier === "state" || corpusMatch.tier === "county") {
			state.activeCorpus = null;
			emit("route:changed", { path });
			renderNotFound();
			return;
		} else {
			const matchedCorpus = findSystemFramework(corpusMatch.tier, corpusMatch.jurisdiction, corpusMatch.code) || state.corpora.find((c) => c.tier === corpusMatch.tier && c.jurisdiction.toLowerCase() === corpusMatch.jurisdiction.toLowerCase() && String(c.code).toLowerCase() === String(corpusMatch.code).toLowerCase());
			clearTreeSelection();
			setViewHead("");
			const fallbackCorpus = matchedCorpus || {
				corpus_id: `${corpusMatch.jurisdiction}:${corpusMatch.tier}:${corpusMatch.code}`,
				tier: corpusMatch.tier,
				jurisdiction: corpusMatch.jurisdiction,
				jurisdiction_label: "Federal",
				code: corpusMatch.code,
				name: corpusMatch.code,
				desk: "all",
				agencies: [],
				installed: false
			};
			state.activeCorpus = fallbackCorpus;
			renderCorpusDrawer(fallbackCorpus);
			applyNav();
			emit("route:changed", { path });
			renderCorpusStaging(fallbackCorpus);
			return;
		}
	}
	state.activeCorpus = null;
	emit("route:changed", { path });
	if (titleMatch) {
		const targetTitle = parseInt(titleMatch[1], 10);
		const subPath = titleMatch[2] || "/";
		const installed = state.installedTitles.some((t) => t.title === targetTitle);
		if (!installed && targetTitle >= 1 && targetTitle <= 50) {
			let section = null;
			let part = null;
			if (subPath.startsWith("/section/")) {
				const rest = subPath.slice(9);
				const slash = rest.indexOf("/");
				try {
					section = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
				} catch {
					section = rest;
				}
			} else if (subPath.startsWith("/part/")) {
				part = subPath.slice(6).replace(/\/full$/, "");
				try {
					part = decodeURIComponent(part);
				} catch {}
			}
			clearTreeSelection();
			setViewHead("");
			await renderResolverPage(dom.view, {
				title: targetTitle,
				section,
				part,
				para: params.get("p")
			});
			return;
		}
		if (!installed) {
			renderNotFound();
			return;
		}
		if (targetTitle && targetTitle !== state.currentTitle) {
			await switchTitle(targetTitle);
			if (seq !== state.routeSeq) return;
		}
		checkPath = subPath;
	}
	const decode = (s) => {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	};
	if (checkPath === "/" || checkPath === "") {
		hideMainTabs();
		if (titleMatch) renderHome();
		else renderHomeScreen();
	} else if (checkPath.startsWith("/section/")) {
		const rest = checkPath.slice(9);
		const slash = rest.indexOf("/");
		await loadSection(decode(slash < 0 ? rest : rest.slice(0, slash)), params, slash < 0 ? null : decode(rest.slice(slash + 1)) || null);
	} else if (checkPath.startsWith("/part/")) {
		const rest = checkPath.replace("/part/", "");
		const fullMatch = rest.match(/^(.+?)\/full$/);
		if (fullMatch) await loadPartFull(fullMatch[1], params);
		else await loadPart(rest);
	} else if (checkPath === "/library" || checkPath.startsWith("/library/")) {
		hideMainTabs();
		const legacy = /^\/library\/(\d+)((?:\/part\/.+)?)\/?$/.exec(checkPath);
		const usc = /^\/library\/usc(?:\/(\d+))?\/?$/.exec(checkPath);
		const constTab = /^\/library\/constitution\/?$/.test(checkPath);
		const plawTab = /^\/library\/plaw(?:\/(\d+))?\/?$/.exec(checkPath);
		const cfr = /^\/library\/cfr(?:\/(\d+)(?:\/part\/(.+))?)?\/?$/.exec(checkPath);
		if (legacy) {
			history.replaceState(null, "", `#/library/cfr/${legacy[1]}${legacy[2]}`);
			const m = /^\/part\/(.+)$/.exec(legacy[2]);
			await loadLibrary("cfr", parseInt(legacy[1], 10), m ? decode(m[1]) : null);
		} else if (constTab) await loadLibrary("constitution", null, null);
		else if (plawTab) await loadPlawTab(plawTab[1] ? parseInt(plawTab[1], 10) : null);
		else if (usc) await loadLibrary("usc", usc[1] ? parseInt(usc[1], 10) : null, null);
		else if (cfr) await loadLibrary("cfr", cfr[1] ? parseInt(cfr[1], 10) : null, cfr[2] ? decode(cfr[2]) : null);
		else if (/^\/library\/?$/.test(checkPath)) await loadLibrary("overview", null, null);
		else renderNotFound();
	} else if (!titleMatch && (checkPath === "/projects" || checkPath.startsWith("/projects/"))) {
		hideMainTabs();
		const id = checkPath.slice(10);
		renderProjects(id ? decodeURIComponent(id) : null);
	} else if (!titleMatch && (checkPath === "/news" || checkPath === "/news/")) {
		hideMainTabs();
		if (params?.get("cat") === "agenda") await loadAgendaTab(params);
		else await loadNews(params);
	} else if (!titleMatch && /^\/news\/agenda\/[0-9A-Za-z-]{4,20}\/?$/.test(checkPath)) {
		hideMainTabs();
		await loadAgendaRule(decodeURIComponent(checkPath.split("/")[3]).toUpperCase(), params);
	} else if (!titleMatch && /^\/news\/inspection\/\d+\/?$/.test(checkPath)) {
		hideMainTabs();
		await loadInspection(parseInt(checkPath.split("/")[3], 10));
	} else if (!titleMatch && /^\/news\/fr\/([A-Za-z0-9._-]+)\/?$/.test(checkPath)) {
		hideMainTabs();
		await loadFrDocument(checkPath.replace(/^\/news\/fr\//, "").replace(/\/$/, ""));
	} else if (!titleMatch && (checkPath === "/help" || checkPath === "/help/")) {
		hideMainTabs();
		await loadHelp();
	} else if (!titleMatch && (checkPath === "/settings" || checkPath === "/settings/")) {
		hideMainTabs();
		renderSettingsPage({ enter: true });
	} else if (!titleMatch && /^\/settings\/sources\/?$/.test(checkPath)) {
		hideMainTabs();
		await renderDataSourcesPage({ enter: true });
	} else if (checkPath.startsWith("/search")) {
		hideMainTabs();
		const q = params.get("q") || "";
		dom.search.value = q;
		await loadSearchPage(q, params.get("scope"), params.get("in"));
	} else {
		hideMainTabs();
		renderNotFound();
	}
}
if (typeof window !== "undefined") window.addEventListener("hashchange", () => {
	handleRoute();
});
on("route:refresh", () => {
	handleRoute();
});
// src/components/palette.ts
function commandList() {
	const mod = isMac ? "⌘" : "Ctrl ";
	const uscCommands = allSystemFrameworks().filter((c) => c.tier === "federal-statute").slice(0, 4).map((c) => [
		`Open ${c.code} · ${c.name}`,
		corpusHashFor(c),
		""
	]);
	const cfrCommands = state.installedTitles.map((t) => [
		`Open ${t.title} CFR · ${t.name}`,
		`#/title/${t.title}/`,
		""
	]);
	return [
		[
			"Go to Home",
			"#/",
			"G H"
		],
		[
			"Go to Workspaces",
			"#/projects",
			"G P"
		],
		[
			"Go to Newsroom (Federal Register)",
			"#/news",
			"G N"
		],
		[
			"Go to Library",
			"#/library",
			"G L"
		],
		[
			"Go to Settings",
			"#/settings",
			"G S"
		],
		...!state.noTitles ? [[
			`Open ${state.currentTitle} CFR start`,
			`#/title/${state.currentTitle}/`,
			"G T"
		]] : [],
		[
			"Open framework contents",
			"cmd:reader",
			"G C"
		],
		[
			"Federal Register framework",
			"#/corpus/federal-register/US/FR/",
			""
		],
		...uscCommands,
		[
			"Refresh Federal Register feed",
			"cmd:news-refresh",
			""
		],
		[
			"New workspace",
			"cmd:new-project",
			""
		],
		[
			"Data sources & API keys",
			"#/help",
			""
		],
		[
			"Edit API keys",
			"cmd:env-modal",
			""
		],
		[
			"Toggle sidebar / framework drawer",
			"cmd:drawer",
			`${mod}B`
		],
		[
			"Ask Claude",
			"cmd:chat",
			`${mod}J`
		],
		...loadProjects().map((p) => [
			`Workspace: ${p.name}`,
			`#/projects/${encodeURIComponent(p.id)}`,
			""
		]),
		...cfrCommands
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
	if (cmd === "drawer") toggleDrawer();
	else if (cmd === "chat") toggleChat();
	else if (cmd === "new-project") emit("nav:new-project");
	else if (cmd === "news-refresh") emit("news:refresh");
	else if (cmd === "env-modal") openEnvModal();
	else openPanel(cmd, { focus: true });
}
// src/components/search_bar.ts
state.searchTimer = null;
state.sdActive = -1;
var searchAbort = null;
function setDropdownOpen(open) {
	dom.searchDropdown.hidden = !open;
	dom.search.setAttribute("aria-expanded", String(Boolean(open)));
	if (!open) {
		dom.search.removeAttribute("aria-activedescendant");
		state.sdActive = -1;
	}
}
function moveSdActive(delta) {
	const items = [...dom.searchDropdown.querySelectorAll(".sd-item")];
	if (dom.searchDropdown.hidden || !items.length) return;
	state.sdActive = ((state.sdActive ?? -1) + delta + items.length) % items.length;
	items.forEach((el, i) => {
		const on = i === state.sdActive;
		el.classList.toggle("active", on);
		if (on) {
			if (!el.id) el.id = `sd-opt-${i}`;
			dom.search.setAttribute("aria-activedescendant", el.id);
		}
	});
	items[state.sdActive].scrollIntoView({ block: "nearest" });
}
dom.search.addEventListener("input", () => {
	if (state.searchTimer) clearTimeout(state.searchTimer);
	if (searchAbort) {
		try {
			searchAbort.abort();
		} catch {}
		searchAbort = null;
	}
	state.sdActive = -1;
	const q = dom.search.value.trim();
	if (!q) {
		setDropdownOpen(false);
		return;
	}
	if (q.startsWith(">")) {
		dom.searchDropdown.innerHTML = commandItemsHtml(q.slice(1));
		setDropdownOpen(true);
		moveSdActive(1);
		return;
	}
	if (/^dol:/i.test(q)) {
		const term = q.slice(4).trim();
		dom.searchDropdown.innerHTML = term ? `<a class="sd-item sd-dol-hint" href="#/news?cat=enforcement&dol_q=${encodeURIComponent(term)}">
           <div class="sd-item-top">
             <span class="sd-label">DOL Archive</span>
             <span class="sd-item-title">Search live OSHA inspections for “${escapeHtml(term)}”</span>
           </div>
           <span class="sd-snippet">Press <kbd>Enter</kbd> to query DOL Open Data API v4 (no network calls while typing)</span>
         </a>` : `<div class="sd-footer">Type an employer, NAICS, or 29 CFR section after <code>dol:</code> and press <kbd>Enter</kbd>.</div>`;
		setDropdownOpen(true);
		return;
	}
	state.searchTimer = setTimeout(async () => {
		searchAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
		const ctrl = searchAbort;
		try {
			const data = await fetchSearchResults(state.currentTitle, q, 6, { signal: ctrl?.signal });
			if (ctrl?.signal?.aborted || dom.search.value.trim() !== q) return;
			if (!data.results || data.results.length === 0) dom.searchDropdown.innerHTML = `<div class="sd-footer">No quick matches. Press <kbd>Enter</kbd> to search the full text.</div>`;
			else {
				const items = data.results.map((r, i) => {
					const snip = (r.snippet || "").replace(/[\x02\x03]/g, "");
					const rTitle = r.title || state.currentTitle;
					return `
            <a class="sd-item" id="sd-opt-${i}" role="option" data-ref-tier="cfr" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
              <div class="sd-item-top">
                <span class="sd-label">${escapeHtml(r.label)}</span>
                <span class="sd-item-title">${escapeHtml(r.title_label || r.title)}</span>
                <span class="ref-badge">${rTitle} CFR</span>
              </div>
              ${snip ? `<span class="sd-snippet">${escapeHtml(snip)}</span>` : ""}
            </a>
          `;
				}).join("");
				dom.searchDropdown.innerHTML = items + `<div class="sd-footer"><kbd>Enter</kbd> All ${Number(data.total).toLocaleString()} results<span class="sd-hint">Type <kbd>&gt;</kbd> for commands</span></div>`;
			}
			setDropdownOpen(true);
		} catch (e) {
			if (e instanceof Error && e.name === "AbortError") return;
			setDropdownOpen(false);
		}
	}, 180);
});
dom.search.addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault();
		const items = dom.searchDropdown.querySelectorAll(".sd-item");
		const active = state.sdActive ?? -1;
		if (!dom.searchDropdown.hidden && active >= 0 && items[active]) {
			const cmd = items[active].dataset.cmd;
			setDropdownOpen(false);
			dom.search.blur();
			if (cmd || dom.search.value.trim().startsWith(">")) dom.search.value = "";
			if (cmd) {
				runCommand(cmd);
				return;
			}
			const href = items[active].getAttribute("href");
			if (href) window.location.hash = href;
			setDropdownOpen(false);
			dom.search.blur();
			return;
		}
		setDropdownOpen(false);
		const q = dom.search.value.trim();
		if (/^dol:/i.test(q)) {
			const term = q.slice(4).trim();
			if (term) {
				const mode = /^\d{4}\.\d+/.test(term) ? "standard" : /^\d{2,6}$/.test(term) ? "naics" : "employer";
				dom.search.blur();
				window.location.hash = `#/news?cat=enforcement&dol_q=${encodeURIComponent(term)}&dol_mode=${mode}`;
			}
			return;
		}
		if (q && !q.startsWith(">")) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
	} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		if (!dom.searchDropdown.hidden) {
			e.preventDefault();
			moveSdActive(e.key === "ArrowDown" ? 1 : -1);
		}
	} else if (e.key === "Escape") setDropdownOpen(false);
});
dom.searchDropdown.addEventListener("click", (e) => {
	const item = e.target?.closest(".sd-cmd");
	if (!item) return;
	setDropdownOpen(false);
	dom.search.value = "";
	if (item.dataset.cmd) {
		e.preventDefault();
		runCommand(item.dataset.cmd);
	}
});
document.addEventListener("click", (e) => {
	const t = e.target;
	if (!dom.search.contains(t) && !dom.searchDropdown.contains(t)) setDropdownOpen(false);
});
document.addEventListener("keydown", (e) => {
	const active = document.activeElement;
	const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
	if (e.key === "/" && !typing || (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
		if (state.noTitles) return;
		e.preventDefault();
		dom.search.focus();
		dom.search.select();
	} else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "j" || e.shiftKey && e.key.toLowerCase() === "k")) {
		e.preventDefault();
		toggleChat();
	}
});
// src/panels/projects_panel.ts
state.newProjectOpen = false;
function showNewProjectForm() {
	const p = createProject("New workspace");
	window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
}
var projectRouteId = () => {
	const m = /\/projects\/([^/?]+)/.exec(state.activeRoute || "");
	return m ? decodeURIComponent(m[1]) : null;
};
function renderProjectsPanel() {
	const list = loadProjects();
	const current = projectRouteId();
	const form = state.newProjectOpen ? `<form class="dr-new" id="dr-new-project">
      <input class="dr-input" id="dr-new-name" name="name" placeholder="Workspace name" maxlength="80" autocomplete="off" aria-label="New workspace name">
      <button type="submit" class="lib-act is-primary">Create</button></form>` : "";
	const rows = list.map((p) => `<a class="dr-proj${p.id === current ? " is-current" : ""}" href="#/projects/${encodeURIComponent(p.id)}"${p.id === current ? " aria-current=\"page\"" : ""}>
      ${projDot(p)}<span class="dr-proj-text"><span class="dr-name">${escapeHtml(p.name)}</span>
      <span class="dr-proj-meta">${joinSep([plural(p.sections.length, "section"), escapeHtml(timeAgo(Date.parse(p.updated_at) || Date.now()))])}</span></span></a>`).join("");
	const mod = isMac ? "⌘" : "Ctrl ";
	setPanel("projects", `${form}
    ${list.length ? `<section class="dr-sec">${drLabel("Workspaces", `<span class="dr-count">${list.length}</span>`)}${rows}</section>` : drEmpty("No workspaces yet", `Organize sections for program compliance, an audit, or a review. Open a section and press <strong>Pin</strong> or <kbd>${mod}D</kbd>.`) + (state.newProjectOpen ? "" : "<button type=\"button\" class=\"btn dr-empty-btn\" data-nav-act=\"new-project\">New workspace</button>")}
    <div class="dr-foot">
      <a class="dr-link" href="#/projects">All workspaces</a>
      <span class="dr-foot-acts"><button type="button" class="dr-link" data-proj-act="export"${list.length ? "" : " disabled"}>Export</button><button type="button" class="dr-link" data-proj-act="import">Import</button></span>
    </div>`);
}
dom.sidebar.addEventListener("submit", (e) => {
	const form = e.target;
	if (!form || form.id !== "dr-new-project") return;
	e.preventDefault();
	const name = form.elements.namedItem("name")?.value.trim() || "";
	if (!name) return;
	state.newProjectOpen = false;
	const p = createProject(name);
	window.location.hash = `#/projects/${encodeURIComponent(p.id)}`;
});
dom.sidebar.addEventListener("keydown", (e) => {
	const t = e.target;
	if (e.key === "Escape" && t?.id === "dr-new-name") {
		e.preventDefault();
		state.newProjectOpen = false;
		renderProjectsPanel();
	}
});
dom.sidebar.addEventListener("click", (e) => {
	const navAct = e.target?.closest("[data-nav-act]");
	if (navAct && navAct.dataset.navAct === "new-project") showNewProjectForm();
});
registerDrawerPanel("projects", renderProjectsPanel);
on("nav:new-project", () => showNewProjectForm());
// src/panels/recent_panel.ts
function renderHistoryPanel() {
	const u = loadUsage();
	const rows = Object.entries(u.s).map(([key, e]) => ({
		key,
		title: Number(key.split("|")[0]),
		id: key.slice(key.indexOf("|") + 1),
		...e
	})).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 24);
	const dayOf = (ms) => {
		const d = new Date(ms || 0);
		const days = Math.floor((new Date((/* @__PURE__ */ new Date()).toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
		return days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
	};
	let lastDay = "";
	const list = rows.map((r) => {
		const day = dayOf(r.t);
		const label = day !== lastDay ? `<div class="dr-day">${day}</div>` : "";
		lastDay = day;
		return `${label}<a class="dr-item" href="#/title/${r.title}/section/${encodeURIComponent(r.id)}">
      <span class="dr-item-top"><span class="dr-item-kicker">${escapeHtml(r.l || "§ " + r.id)}<span class="sep" aria-hidden="true">·</span>Title ${r.title}</span><span class="dr-time">${escapeHtml(timeAgo(r.t || 0))}</span></span>
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
registerDrawerPanel("history", renderHistoryPanel);
// src/panels/drawer_width.ts
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
// src/components/split_pane.ts
var splitAbort = null;
var splitSeq = 0;
var activeSplitDoc = null;
var activeSplitGraph = null;
var activeSplitNewsCtx = null;
var splitParaTools = createParaToolsController({
	root: dom.splitPane,
	bodySelector: ".split-body",
	paraSelector: ".split-body .reg-p[id]",
	isActive: () => Boolean(activeSplitDoc),
	getSectionRef: activeSplitSectionRef
});
function activeSplitTab() {
	return state.splitTabs.find((t) => t.id === state.activeSplitTabId) || state.splitTabs[0] || null;
}
function unitQueryFor(view, para) {
	if (view === "full") return "";
	if (view) return "?unit=" + encodeURIComponent(view);
	const pClause = para && /^\(([a-z])\)/i.exec(para.trim());
	return "?unit=" + encodeURIComponent(pClause ? pClause[1].toLowerCase() : "");
}
function buildSplitHash(entry = state.splitState) {
	return buildReaderHref(entry);
}
function makeSplitTab(entry) {
	return {
		id: entry.id || `stab_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
		kind: entry.kind || (entry.partId && !entry.sectionId ? "part" : "section"),
		title: Number(entry.title) || state.currentTitle || 29,
		sectionId: entry.sectionId ? String(entry.sectionId) : void 0,
		partId: entry.partId ? String(entry.partId) : void 0,
		full: Boolean(entry.full),
		para: entry.para || null,
		unit: entry.unit || null,
		label: entry.label || formatTabLabel(entry),
		heading: entry.heading || "",
		history: Array.isArray(entry.history) && entry.history.length ? entry.history : [{ ...entry }]
	};
}
function syncSplitTabStripInPlace() {
	const host = dom.splitPane?.querySelector("#split-tabs");
	if (host) host.outerHTML = splitTabsBarHtml();
}
function splitTabsBarHtml() {
	if (!state.splitTabs.length) return "";
	return `
    <div id="split-tabs" class="reader-tabs is-split-tabs" role="tablist" aria-label="Side-by-side reader tabs">
      <div class="reader-tabs-strip">${state.splitTabs.map((tab) => {
		const active = tab.id === state.activeSplitTabId;
		const tier = Number(tab.title) !== Number(state.currentTitle) ? "cross" : "cfr";
		const label = tab.label || formatTabLabel(tab);
		const titleAttr = `${label}${tab.heading ? ` — ${tab.heading}` : ""}`;
		return `
      <div class="reader-tab${active ? " is-active" : ""}" data-ref-tier="${tier}" role="presentation">
        <button type="button" class="reader-tab-btn" role="tab" aria-selected="${active ? "true" : "false"}" data-split-tab="${escapeHtml(tab.id)}" title="${escapeHtml(titleAttr)}">
          <span class="tier-pip" aria-hidden="true"></span>
          <span class="reader-tab-label">${escapeHtml(label)}</span>
        </button>
        <button type="button" class="reader-tab-close" data-split-tab-close="${escapeHtml(tab.id)}" aria-label="Close ${escapeHtml(label)}" title="Close tab">${icon("close")}</button>
      </div>`;
	}).join("")}</div>
      <div class="reader-tabs-acts">
        <button type="button" class="btn btn-small reader-tabs-save" data-split-tabs-act="save-group" title="Save current main & side-by-side tabs as a workspace tab group">${icon("folder")} <span>Save group</span></button>
      </div>
    </div>`;
}
function splitHeaderHtml({ splitTier = "cfr", kickerHtml, titleText, hasBack = false, isLoading = false }) {
	const acts = isLoading ? `<button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon("close")}</button>` : `<button type="button" class="icon-btn" data-split-act="swap" title="Swap with main reader" aria-label="Swap panes">${icon("stack")}</button>
       <button type="button" class="icon-btn${state.splitWide ? " is-active" : ""}" data-split-act="wide" title="Toggle split width" aria-label="Toggle width">${icon("expand")}</button>
       <button type="button" class="btn btn-small" data-split-act="to-main-tab" title="Move into a main reader tab">${icon("plus")} Main tab</button>
       <button type="button" class="btn btn-small" data-split-act="promote" title="Open in main reading pane">Open</button>
       <button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon("close")}</button>`;
	return `
    <header class="split-head" data-ref-tier="${splitTier}">
      ${hasBack ? `<button type="button" class="icon-btn" data-split-act="back" title="Back in split pane" aria-label="Back">${icon("chevronLeft")}</button>` : ""}
      <div class="split-head-meta">
        <div class="doc-kicker"><span class="tier-pip" aria-hidden="true"></span> ${kickerHtml}</div>
        <h2 class="split-head-title">${escapeHtml(titleText)}</h2>
      </div>
      <div class="split-head-acts">${acts}</div>
    </header>`;
}
function closeSplitPane() {
	splitParaTools.hide();
	if (splitAbort) {
		try {
			splitAbort.abort();
		} catch {}
		splitAbort = null;
	}
	splitSeq++;
	activeSplitDoc = null;
	activeSplitGraph = null;
	activeSplitNewsCtx = null;
	state.splitState = null;
	state.splitTabs = [];
	state.activeSplitTabId = null;
	persistSessionTabs();
	renderMainTabs();
	if (dom.splitPane) {
		dom.splitPane.hidden = true;
		dom.splitPane.innerHTML = "";
	}
	if (dom.mainStage) dom.mainStage.classList.remove("is-split", "is-split-wide");
}
function closeSplitTab(tabId) {
	const idx = state.splitTabs.findIndex((t) => t.id === tabId);
	if (idx < 0) return;
	if (state.splitTabs.length <= 1) {
		closeSplitPane();
		return;
	}
	const wasActive = state.splitTabs[idx].id === state.activeSplitTabId;
	state.splitTabs.splice(idx, 1);
	if (wasActive) {
		const next = state.splitTabs[Math.min(idx, state.splitTabs.length - 1)] || state.splitTabs[0];
		state.activeSplitTabId = next.id || null;
		persistSessionTabs();
		openSplitPane({
			...next,
			tabId: next.id,
			newTab: false,
			pushHistory: false
		});
	} else {
		persistSessionTabs();
		syncSplitTabStripInPlace();
	}
}
function promoteSplitToMain() {
	if (!state.splitState) return;
	const target = buildSplitHash(state.splitState);
	closeSplitPane();
	window.location.hash = target;
}
function moveActiveSplitToMainTab() {
	const active = activeSplitTab() || state.splitState;
	if (!active) return;
	const target = {
		kind: active.kind || (active.partId && !active.sectionId ? "part" : "section"),
		title: active.title,
		sectionId: active.sectionId,
		partId: active.partId,
		unit: active.unit || null,
		full: Boolean(active.full),
		para: active.para || null,
		label: active.label || formatTabLabel(active),
		heading: active.heading || "",
		href: buildSplitHash(active)
	};
	if (active.id && state.splitTabs.length > 1) closeSplitTab(active.id);
	else closeSplitPane();
	openMainReaderTab(target);
}
function activeSplitSectionRef() {
	if (!activeSplitDoc || !state.splitState || state.splitState.kind === "part") return null;
	return {
		title: state.splitState.title,
		id: activeSplitDoc.id,
		label: cleanInlineLabel(activeSplitDoc.label) || `§ ${activeSplitDoc.id}`,
		heading: cleanInlineLabel(activeSplitDoc.section_title || activeSplitDoc.title_label || ""),
		part: activeSplitDoc.part || "",
		tier: "federal-reg",
		jurisdiction: "US"
	};
}
function swapSplitWithMain() {
	if (!state.splitState) return;
	const splitHref = buildSplitHash(state.splitState);
	const mainSec = currentSectionRef();
	const mainPart = !mainSec && state.currentPart ? {
		kind: "part",
		title: state.currentTitle,
		partId: state.currentPart
	} : null;
	if (!mainSec && !mainPart) {
		promoteSplitToMain();
		return;
	}
	const nextSplit = mainSec ? {
		kind: "section",
		title: mainSec.title,
		sectionId: mainSec.id,
		unit: state.currentSection?.unit || null,
		label: `${mainSec.title} CFR ${mainSec.label}`,
		heading: mainSec.heading
	} : {
		kind: "part",
		title: mainPart.title,
		partId: mainPart.partId,
		label: `${mainPart.title} CFR Part ${mainPart.partId}`
	};
	state.swapMotionX = 36;
	window.location.hash = splitHref;
	openSplitPane({
		...nextSplit,
		newTab: false,
		pushHistory: true,
		fromX: -36
	});
}
async function loadTreeForTitle(tNum, signal) {
	if (tNum === state.currentTitle && state.treeData) return state.treeData;
	if (titleTreeCache.has(tNum)) return titleTreeCache.get(tNum) || null;
	try {
		return await fetchTitleTree(tNum, { signal });
	} catch {
		return null;
	}
}
function renderSplitLoading(tNum, labelText) {
	dom.splitPane.innerHTML = `
    ${splitTabsBarHtml()}
    ${splitHeaderHtml({
		splitTier: tNum !== state.currentTitle ? "cross" : "cfr",
		kickerHtml: `${tNum} CFR · ${escapeHtml(labelText)}`,
		titleText: "Loading…",
		isLoading: true
	})}
    <div class="split-body">${skeletonHtml("doc", `Loading ${labelText}…`)}</div>
  `;
}
function renderSplitUnavailable(tNum, titleLabel, bodyMsg) {
	dom.splitPane.innerHTML = `
    ${splitTabsBarHtml()}
    ${splitHeaderHtml({
		splitTier: "uninstalled",
		kickerHtml: `${tNum} CFR`,
		titleText: titleLabel,
		hasBack: (activeSplitTab()?.history?.length || 0) > 1
	})}
    <div class="split-body"><p class="muted">${escapeHtml(bodyMsg)}</p></div>
  `;
}
function updateSplitRefsBtn() {
	const btn = document.getElementById("split-btn-refs");
	if (!btn || !state.splitState) return;
	const refs = collectSectionReferences(dom.splitPane, state.splitState.title);
	const span = btn.querySelector("span");
	if (span) span.textContent = refs.length ? `Refs ${refs.length}` : "Refs";
	btn.hidden = refs.length === 0;
}
function splitActionsBarHtml({ pinRef = null, partId = null, ecfrUrl = "", partFull = false } = {}) {
	return `
    <div class="split-tools">
      ${partId ? `<button type="button" class="btn btn-small" data-split-part="${escapeHtml(partId)}" data-split-full="${partFull ? "1" : "0"}" title="${partFull ? "View Full Part text" : `View Part ${escapeHtml(partId)} TOC`}">${icon("list")} ${partFull ? "Full part" : `Part ${escapeHtml(partId)}`}</button>` : ""}
      ${pinRef ? pinButtonHtml(pinRef, "split-btn-pin") : ""}
      <button type="button" class="btn btn-small" id="split-btn-refs" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("list")} <span>Refs</span></button>
      <button type="button" class="btn btn-small" id="split-btn-cited" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("link")} <span>Cited by</span></button>
      <button type="button" class="btn btn-small" id="split-btn-news" aria-haspopup="dialog" aria-expanded="false" hidden>${icon("news")} <span>Activity</span></button>
      <div class="spacer"></div>
      <button type="button" class="btn btn-small" data-split-act="copy" title="Copy link">${icon("link")} Copy</button>
      ${ecfrUrl ? `<a class="btn btn-small" href="${escapeHtml(ecfrUrl)}" target="_blank" rel="noopener noreferrer" title="View on eCFR">${icon("external")} eCFR</a>` : ""}
      <div class="size-ctl split-size-ctl" role="group" aria-label="Text size">
        <button type="button" data-split-act="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
        <button type="button" data-split-act="font-inc" title="Larger text" aria-label="Larger text">A+</button>
      </div>
    </div>`;
}
async function openSplitPart(nextEntry, seq, signal, { fromX = 0 } = {}) {
	const tNum = nextEntry.title;
	const partId = nextEntry.partId || "";
	const full = Boolean(nextEntry.full);
	const tab = activeSplitTab();
	const hasBack = (tab?.history?.length || 0) > 1;
	if (full) {
		const [tree, fullRes] = await Promise.all([loadTreeForTitle(tNum, signal), fetchPartFull(tNum, partId, { signal })]);
		if (seq !== splitSeq) return;
		if (!fullRes.ok) {
			renderSplitUnavailable(tNum, `Part ${partId}`, `Couldn’t load full text for Title ${tNum} Part ${partId}.`);
			return;
		}
		const data = await fullRes.json();
		if (seq !== splitSeq) return;
		const partNode = tree ? findPartInTree(tree, partId) : null;
		const heading = cleanInlineLabel(partNode?.d || partNode?.l || `Part ${partId}`);
		const splitTier = tNum !== state.currentTitle ? "cross" : "cfr";
		if (tab) {
			tab.label = `${tNum} CFR Part ${partId} · Full`;
			tab.heading = heading;
			persistSessionTabs();
		}
		const sectionsHtml = (data.sections || []).map((s) => `
      <article class="full-section" id="split-sec-${escapeHtml(String(s.id).replace(/[^a-zA-Z0-9.\-]/g, "_"))}">
        <header class="full-section-head has-tier-bar" data-ref-tier="${splitTier}">
          <a class="full-section-anchor" href="#/title/${tNum}/section/${encodeURIComponent(s.id)}">
            <span class="full-section-num">${escapeHtml(s.label)}</span>
            <span class="full-section-title">${escapeHtml(s.title || "")}</span>
          </a>
        </header>
        ${s.reserved ? "<div class=\"reserved-note\">This section is reserved.</div>" : s.html || ""}
      </article>`).join("");
		dom.splitPane.innerHTML = `
      ${splitTabsBarHtml()}
      ${splitHeaderHtml({
			splitTier,
			kickerHtml: `${tNum} CFR · Full Part ${escapeHtml(partId)}`,
			titleText: heading,
			hasBack
		})}
      ${splitActionsBarHtml({
			partId,
			partFull: false
		})}
      <div class="split-body">${sectionsHtml || "<p class=\"muted\">No sections in this part.</p>"}</div>
    `;
		const bodyEl = dom.splitPane.querySelector(".split-body");
		if (bodyEl) {
			enhanceDomAnchors(bodyEl);
			animateCalm(bodyEl, {
				fromY: fromX ? 0 : 14,
				fromX,
				fromScale: .992,
				duration: 640
			});
		}
		updateSplitRefsBtn();
		hydrateSplitNews(tNum, "part", partId, seq);
		dom.splitPane.scrollTop = 0;
		return;
	}
	const [tree, frontRes] = await Promise.all([loadTreeForTitle(tNum, signal), fetchPartFront(tNum, partId, { signal })]);
	if (seq !== splitSeq) return;
	const partNode = tree ? findPartInTree(tree, partId) : null;
	if (!partNode) {
		renderSplitUnavailable(tNum, `Part ${partId}`, `Title ${tNum} Part ${partId} isn’t installed yet.`);
		return;
	}
	const front = frontRes.ok ? await frontRes.json() : {
		part: "",
		subparts: {}
	};
	const splitTier = tNum !== state.currentTitle ? "cross" : "cfr";
	if (tab) {
		tab.label = `${tNum} CFR Part ${partId}`;
		tab.heading = cleanInlineLabel(partNode.d || partNode.l);
		persistSessionTabs();
	}
	const toc = buildPartTocView({
		partNode,
		front,
		titleNum: tNum,
		tier: splitTier,
		isSplit: true
	});
	dom.splitPane.innerHTML = `
    ${splitTabsBarHtml()}
    ${splitHeaderHtml({
		splitTier,
		kickerHtml: `${tNum} CFR · ${escapeHtml(partNode.l)}`,
		titleText: partNode.d || partNode.l || `Part ${partId}`,
		hasBack
	})}
    ${splitActionsBarHtml({
		partId,
		partFull: true
	})}
    <div class="split-body">
      ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ""}
      ${toc.atlasHtml}
      <div class="toc-groups-wrap">
        ${toc.groupsHtml || "<p class=\"muted\">No sections listed in this part.</p>"}
      </div>
    </div>
  `;
	animateCalm(dom.splitPane.querySelector(".split-body"), {
		fromY: fromX ? 0 : 14,
		fromX,
		fromScale: .992,
		duration: 640
	});
	initPartTocCarousels(dom.splitPane, {
		titleNum: tNum,
		signal
	});
	updateSplitRefsBtn();
	hydrateSplitNews(tNum, "part", partId, seq);
	dom.splitPane.scrollTop = 0;
}
async function hydrateSplitNews(tNum, kind, id, seq) {
	if (tNum !== 29) return;
	const data = await fetchNewsActivity(tNum, kind, id);
	if (!data || !data.count || seq !== splitSeq) return;
	activeSplitNewsCtx = {
		kind,
		id,
		data
	};
	const btn = document.getElementById("split-btn-news");
	if (btn) {
		const span = btn.querySelector("span");
		if (span) span.textContent = `${data.count} ${data.count === 1 ? "rule" : "rules"}`;
		btn.hidden = false;
	}
}
async function openSplitPane({ kind = null, title, sectionId = null, partId = null, full = false, para = null, unit = null, label = "", heading = "", pushHistory = true, newTab = true, tabId = null, fromX = 0 }) {
	if (!dom.splitPane || !dom.mainStage) return;
	const resolvedKind = kind || (partId && !sectionId ? "part" : "section");
	if (resolvedKind === "section" && !sectionId) return;
	if (resolvedKind === "part" && !partId) return;
	splitParaTools.hide();
	activeSplitGraph = null;
	activeSplitNewsCtx = null;
	const tNum = Number(title) || state.currentTitle || 29;
	const nextEntry = resolvedKind === "part" ? {
		kind: "part",
		title: tNum,
		partId: String(partId),
		full: Boolean(full),
		label: label || `${tNum} CFR Part ${partId}${full ? " · Full" : ""}`,
		heading
	} : {
		kind: "section",
		title: tNum,
		sectionId: String(sectionId),
		para: para || null,
		unit: unit || null,
		label: label || `${tNum} CFR § ${sectionId}`,
		heading
	};
	let targetTab = tabId ? state.splitTabs.find((t) => t.id === tabId) || null : null;
	if (!targetTab && newTab) {
		targetTab = state.splitTabs.find((t) => tabIdentityMatch(t, nextEntry)) || null;
		if (targetTab) Object.assign(targetTab, {
			...nextEntry,
			id: targetTab.id,
			history: targetTab.history || []
		});
		else {
			targetTab = makeSplitTab(nextEntry);
			state.splitTabs.push(targetTab);
		}
	} else if (!targetTab) {
		targetTab = activeSplitTab();
		if (!targetTab) {
			targetTab = makeSplitTab(nextEntry);
			state.splitTabs.push(targetTab);
		} else Object.assign(targetTab, {
			...nextEntry,
			id: targetTab.id,
			history: targetTab.history || []
		});
	}
	state.activeSplitTabId = targetTab.id || null;
	if (pushHistory) {
		const hist = targetTab.history || (targetTab.history = []);
		const top = hist[hist.length - 1];
		if (!(top && top.kind === nextEntry.kind && top.title === nextEntry.title && top.sectionId === nextEntry.sectionId && top.partId === nextEntry.partId && Boolean(top.full) === Boolean(nextEntry.full) && top.unit === nextEntry.unit && top.para === nextEntry.para)) hist.push({ ...nextEntry });
	}
	if (splitAbort) try {
		splitAbort.abort();
	} catch {}
	splitAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
	const seq = ++splitSeq;
	const wasClosed = dom.splitPane.hidden;
	dom.splitPane.hidden = false;
	if (wasClosed) {
		dom.mainStage.classList.remove("is-split");
		dom.mainStage.offsetWidth;
	}
	dom.mainStage.classList.add("is-split");
	dom.mainStage.classList.toggle("is-split-wide", Boolean(state.splitWide));
	state.splitState = nextEntry;
	persistSessionTabs();
	renderMainTabs();
	if (wasClosed) {
		renderSplitLoading(tNum, resolvedKind === "part" ? `Part ${partId}` : `§ ${sectionId}`);
		animateCalm(dom.splitPane, {
			fromX: 34,
			fromY: 0,
			fromScale: .985,
			duration: 740
		});
	} else {
		syncSplitTabStripInPlace();
		const prevBody = dom.splitPane.querySelector(".split-body");
		if (prevBody) {
			prevBody.style.transition = "opacity var(--t-quick) var(--ease-calm)";
			prevBody.style.opacity = "0.35";
		}
	}
	try {
		if (resolvedKind === "part") {
			await openSplitPart(nextEntry, seq, splitAbort?.signal, { fromX });
			return;
		}
		const res = await fetchSectionRaw(tNum, sectionId, unitQueryFor(unit, para), { signal: splitAbort?.signal });
		if (seq !== splitSeq) return;
		if (!res.ok) {
			renderSplitUnavailable(tNum, `§ ${sectionId}`, `Couldn’t load § ${sectionId} from Title ${tNum}.`);
			return;
		}
		const data = await res.json();
		if (seq !== splitSeq) return;
		activeSplitDoc = data;
		state.peekCache.set(`${tNum}|${sectionId}|${data.unit || "full"}`, data);
		const docHeading = cleanInlineLabel(data.section_title || data.title_label || "");
		const docLabel = cleanInlineLabel(data.label);
		targetTab.label = `${tNum} CFR ${docLabel}`;
		targetTab.heading = docHeading;
		persistSessionTabs();
		const hasBack = (targetTab.history?.length || 0) > 1;
		const outline = data.outline || [];
		const unitsHtml = data.mode === "units" && outline.length > 1 ? `<div class="split-units" role="navigation" aria-label="Section parts">
          ${outline.map((u) => `<button type="button" class="split-unit-chip${data.unit === u.key ? " is-active" : ""}" data-split-unit="${escapeHtml(u.key)}">${escapeHtml(unitShort(u))}</button>`).join("")}
          <button type="button" class="split-unit-chip${!data.unit ? " is-active" : ""}" data-split-unit="full">Full</button>
        </div>` : "";
		const partKicker = data.part ? ` · <button type="button" class="split-kicker-link" data-split-part="${escapeHtml(data.part)}" data-split-full="0">Part ${escapeHtml(data.part)}</button>` : "";
		const splitTier = tNum !== state.currentTitle ? "cross" : "cfr";
		const pinRef = activeSplitSectionRef();
		dom.splitPane.innerHTML = `
      ${splitTabsBarHtml()}
      ${splitHeaderHtml({
			splitTier,
			kickerHtml: `${tNum} CFR${partKicker}`,
			titleText: `${docLabel} ${docHeading}`,
			hasBack
		})}
      ${splitActionsBarHtml({
			pinRef,
			partId: data.part,
			ecfrUrl: data.ecfr_url || "",
			partFull: false
		})}
      ${unitsHtml}
      <div class="split-body">
        ${data.reserved ? "<div class=\"reserved-note\">This section is reserved.</div>" : ""}
        ${data.html || ""}
      </div>
    `;
		const bodyEl = dom.splitPane.querySelector(".split-body");
		if (bodyEl) {
			enhanceDomAnchors(bodyEl);
			animateCalm(bodyEl, {
				fromY: fromX ? 0 : 14,
				fromX,
				fromScale: .992,
				duration: wasClosed ? 680 : 600,
				delay: wasClosed ? 110 : 0
			});
			updateSplitRefsBtn();
			const applyGraph = (g) => {
				if (!g || seq !== splitSeq || !bodyEl.isConnected) return;
				activeSplitGraph = g;
				if (g.cited_by_count > 0) {
					const citedBtn = document.getElementById("split-btn-cited");
					if (citedBtn) {
						const span = citedBtn.querySelector("span");
						if (span) span.textContent = `Cited by ${g.cited_by_count}`;
						citedBtn.hidden = false;
					}
				}
				if (g.ibr?.length) {
					wrapIbrMentions(bodyEl, g.ibr);
					updateSplitRefsBtn();
				}
			};
			fetchSectionGraph(tNum, data.id, { signal: splitAbort?.signal }).then(applyGraph).catch(() => {});
			hydrateSplitNews(tNum, "section", data.id, seq);
			if (para) highlightTarget(bodyEl, para, 60);
			else dom.splitPane.scrollTop = 0;
		}
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") return;
		if (seq !== splitSeq) return;
		renderSplitUnavailable(tNum, resolvedKind === "part" ? `Part ${partId}` : `§ ${sectionId}`, (err instanceof Error ? err.message : "") || "Error");
	}
}
function restoreSplitTabs(entries, activeIdx = 0, wide = false) {
	if (!entries || !entries.length) {
		closeSplitPane();
		return;
	}
	state.splitWide = Boolean(wide);
	state.splitTabs = entries.map((e) => makeSplitTab(e));
	const active = state.splitTabs[Math.min(activeIdx, state.splitTabs.length - 1)] || state.splitTabs[0];
	state.activeSplitTabId = active.id || null;
	persistSessionTabs();
	openSplitPane({
		...active,
		tabId: active.id,
		newTab: false,
		pushHistory: false
	});
}
registerSplitTabHandlers({
	restore: restoreSplitTabs,
	close: closeSplitPane
});
function getActiveSplitDoc() {
	return activeSplitDoc;
}
if (dom.splitPane) {
	dom.splitPane.addEventListener("click", async (e) => {
		if (await splitParaTools.handleClick(e)) return;
		const t = e.target;
		const splitTabClose = t?.closest("[data-split-tab-close]");
		if (splitTabClose?.dataset.splitTabClose) {
			e.preventDefault();
			e.stopPropagation();
			closeSplitTab(splitTabClose.dataset.splitTabClose);
			return;
		}
		const splitTabBtn = t?.closest("[data-split-tab]");
		if (splitTabBtn) {
			const tab = state.splitTabs.find((x) => x.id === splitTabBtn.dataset.splitTab);
			if (tab) openSplitPane({
				...tab,
				tabId: tab.id,
				newTab: false,
				pushHistory: false
			});
			return;
		}
		const saveSplitGroupBtn = t?.closest("[data-split-tabs-act=\"save-group\"]");
		if (saveSplitGroupBtn) {
			openSaveTabGroupMenu(saveSplitGroupBtn);
			return;
		}
		const splitPin = t?.closest("#split-btn-pin");
		if (splitPin) {
			const ref = activeSplitSectionRef();
			if (ref) toggleSplitPinMenu(splitPin, ref);
			return;
		}
		const splitRefs = t?.closest("#split-btn-refs");
		if (splitRefs && state.splitState) {
			openRefsLedgerPopover(splitRefs, dom.splitPane, state.splitState.title);
			return;
		}
		const splitCited = t?.closest("#split-btn-cited");
		if (splitCited && activeSplitGraph && state.splitState) {
			openCitedByPopover(splitCited, activeSplitGraph, state.splitState.title);
			return;
		}
		const splitNews = t?.closest("#split-btn-news");
		if (splitNews && activeSplitNewsCtx) {
			openNewsActivityFor(splitNews, activeSplitNewsCtx);
			return;
		}
		const partBtn = t?.closest("[data-split-part]");
		if (partBtn && state.splitState) {
			openSplitPane({
				kind: "part",
				title: state.splitState.title,
				partId: partBtn.dataset.splitPart,
				full: partBtn.dataset.splitFull === "1",
				newTab: false,
				pushHistory: true
			});
			return;
		}
		const actBtn = t?.closest("[data-split-act]");
		if (actBtn) {
			const act = actBtn.dataset.splitAct;
			if (act === "close") closeSplitPane();
			else if (act === "promote") promoteSplitToMain();
			else if (act === "to-main-tab") moveActiveSplitToMainTab();
			else if (act === "swap") swapSplitWithMain();
			else if (act === "wide") {
				state.splitWide = !state.splitWide;
				dom.mainStage?.classList.toggle("is-split-wide", state.splitWide);
				actBtn.classList.toggle("is-active", state.splitWide);
				persistSessionTabs();
			} else if (act === "copy") {
				const url = new URL(buildSplitHash(), window.location.href).href;
				await copyText(url, "Link copied", "Couldn’t copy the link");
			} else if (act === "font-dec") adjustFontSize(-1);
			else if (act === "font-inc") adjustFontSize(1);
			else if (act === "back") {
				const tab = activeSplitTab();
				if (tab && tab.history && tab.history.length > 1) {
					tab.history.pop();
					const prev = tab.history[tab.history.length - 1];
					if (prev) openSplitPane({
						...prev,
						tabId: tab.id,
						newTab: false,
						pushHistory: false
					});
				}
			}
			return;
		}
		const unitBtn = t?.closest("[data-split-unit]");
		if (unitBtn && state.splitState) {
			openSplitPane({
				kind: "section",
				title: state.splitState.title,
				sectionId: state.splitState.sectionId,
				para: null,
				unit: unitBtn.dataset.splitUnit,
				newTab: false,
				pushHistory: false
			});
			return;
		}
		if (handlePartTocCarouselClick(e, dom.splitPane, {
			titleNum: state.splitState?.title || state.currentTitle,
			signal: splitAbort?.signal
		})) return;
		const anchorTrigger = t?.closest("[data-anchor]");
		if (anchorTrigger?.dataset.anchor) {
			e.preventDefault();
			scrollToAnchor(anchorTrigger.dataset.anchor, dom.splitPane);
			return;
		}
		const localPara = t?.closest("a.xref-local[data-local-para]");
		if (localPara) {
			e.preventDefault();
			highlightTarget(dom.splitPane, localPara.dataset.localPara || "", 0);
			return;
		}
		const figLink = t?.closest("a.reg-figure:not(.is-broken)");
		if (figLink && dom.splitPane.contains(figLink)) {
			e.preventDefault();
			openFigureModal(figLink);
			return;
		}
		const link = t?.closest("a[href^=\"#\"]");
		if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && link.getAttribute("target") !== "_blank") {
			if (!link.classList.contains("xref-local") && Boolean(link.closest(".reg-body, .full-section .reg-body, .front-matter")) && link.classList.contains("xref")) return;
			const parsed = parseCfrHref(link.getAttribute("href"), state.splitState?.title || state.currentTitle);
			if (parsed && parsed.kind === "section") {
				e.preventDefault();
				openSplitPane({
					kind: "section",
					title: parsed.title,
					sectionId: parsed.section,
					para: parsed.para,
					unit: parsed.unit,
					newTab: false,
					pushHistory: true
				});
			} else if (parsed && parsed.kind === "part") {
				e.preventDefault();
				openSplitPane({
					kind: "part",
					title: parsed.title,
					partId: parsed.part,
					newTab: false,
					pushHistory: true
				});
			}
		}
	});
	dom.splitPane.addEventListener("keydown", (e) => {
		handlePartTocCarouselKeydown(e, {
			titleNum: state.splitState?.title || state.currentTitle,
			signal: splitAbort?.signal
		});
	});
	bindBrokenImageFallback(dom.splitPane, () => activeSplitDoc?.ecfr_url || "");
}
on("split:open", (opts) => openSplitPane(opts));
// src/components/selection_tool.ts
state.selectedText = "";
var selectedPara = "";
var selectedFromSplit = false;
document.addEventListener("mouseup", () => {
	const sel = window.getSelection();
	if (!sel) {
		dom.askFloat.hidden = true;
		selectedPara = "";
		selectedFromSplit = false;
		return;
	}
	const str = sel.toString().trim();
	const inMain = dom.view.contains(sel.anchorNode);
	const inSplit = Boolean(dom.splitPane && dom.splitPane.contains(sel.anchorNode));
	if (str.length > 10 && (inMain || inSplit) && sel.rangeCount > 0) {
		state.selectedText = str;
		selectedFromSplit = inSplit;
		const paraEl = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest?.(".reg-p");
		const paneRoot = inSplit ? dom.splitPane : dom.view;
		selectedPara = paraEl ? resolveParagraphPath(paneRoot, paraEl) : "";
		const rect = sel.getRangeAt(0).getBoundingClientRect();
		dom.askFloat.hidden = false;
		positionPopover(dom.askFloat, rect, {
			offset: 8,
			placement: "auto",
			padding: 10
		});
	} else {
		dom.askFloat.hidden = true;
		selectedPara = "";
		selectedFromSplit = false;
	}
});
for (const scroller of [dom.main, dom.splitPane]) if (scroller) scroller.addEventListener("scroll", () => {
	if (!dom.askFloat.hidden) dom.askFloat.hidden = true;
}, { passive: true });
dom.askFloat.addEventListener("click", (e) => {
	const action = (e.target?.closest("[data-ask]"))?.dataset.ask;
	if (!action || !state.selectedText) return;
	if (action === "clip") {
		const splitDoc = selectedFromSplit ? getActiveSplitDoc() : null;
		const ref = splitDoc ? {
			title: splitDoc.title,
			id: splitDoc.id,
			label: splitDoc.label || `§ ${splitDoc.id}`,
			heading: splitDoc.section_title || splitDoc.title_label || "",
			part: splitDoc.part || ""
		} : currentSectionRef();
		if (ref) clipToWorkspace(ref, {
			para: selectedPara,
			quote: state.selectedText,
			cite: formatRefCitation(ref, selectedPara)
		});
		dom.askFloat.hidden = true;
		window.getSelection()?.removeAllRanges();
		return;
	}
	openChat();
	if (action === "explain") dom.chatText.value = `Can you explain what this clause means in plain English?\n\n"${state.selectedText}"`;
	else dom.chatText.value = `Regarding this provision: "${state.selectedText}"\n\n`;
	dom.askFloat.hidden = true;
	dom.chatText.focus();
});
// src/components/peek.ts
var hoverTimer = null;
var closeTimer = null;
var hoverTarget = null;
var hoverAbort = null;
var lastHoverContext = null;
function cancelHoverTimers() {
	if (hoverTimer !== null) clearTimeout(hoverTimer);
	hoverTimer = null;
	if (closeTimer !== null) clearTimeout(closeTimer);
	closeTimer = null;
}
function scheduleCloseHover() {
	if (closeTimer !== null) clearTimeout(closeTimer);
	closeTimer = setTimeout(() => {
		if (citePop.isOpen() && !citePop.isInteractive()) citePop.close(false);
		hoverTarget = null;
	}, 180);
}
function clipText(txt, max = 380) {
	const s = (txt || "").replace(/\s+/g, " ").trim();
	return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
function extractBranchSnippet(root, paraEl) {
	if (!paraEl) return "";
	const all = [...root.querySelectorAll(".reg-p")];
	const idx = all.indexOf(paraEl);
	const lvlM = /\blvl-(\d+)\b/.exec(paraEl.className);
	const baseLvl = lvlM ? Number(lvlM[1]) : 0;
	const parts = [paraEl.textContent || ""];
	if (idx >= 0 && baseLvl > 0 && (paraEl.textContent || "").trim().length < 220) for (let i = idx + 1; i < Math.min(all.length, idx + 3); i++) {
		const next = all[i];
		const m = /\blvl-(\d+)\b/.exec(next.className);
		if ((m ? Number(m[1]) : 0) <= baseLvl) break;
		parts.push(next.textContent || "");
	}
	return clipText(parts.join(" "), 440);
}
function renderLocalParaPeek(trigger, root) {
	const para = trigger.dataset.localPara || "";
	const hit = findParagraphElement(root, para);
	if (!hit) return null;
	const sec = root === dom.splitPane ? null : state.currentSection;
	const t = root === dom.splitPane ? state.splitState?.title || state.currentTitle : state.currentTitle;
	const secId = root === dom.splitPane ? state.splitState?.sectionId || "" : sec?.id || "";
	const snippet = extractBranchSnippet(root, hit);
	lastHoverContext = {
		root,
		jumpPara: para,
		split: secId ? {
			title: t,
			sectionId: secId,
			para
		} : null
	};
	return `
    <div class="pop-head-row">
      <div class="pop-kicker">${secId ? `${t} CFR § ${escapeHtml(secId)} ` : ""}${escapeHtml(para)}</div>
      <span class="peek-badge">CLAUSE</span>
    </div>
    <p class="peek-text">${escapeHtml(snippet)}</p>
    <div class="peek-foot">
      <button type="button" class="btn btn-small" data-peek-jump="para">Jump to clause</button>
      ${secId ? "<button type=\"button\" class=\"btn btn-small\" data-peek-split=\"1\">Open side-by-side</button>" : ""}
    </div>
  `;
}
function renderFootnotePeek(trigger, root) {
	const fnId = trigger.dataset.anchor;
	if (!fnId) return null;
	const fnEl = root.querySelector(`#${CSS.escape(fnId)}`) || document.getElementById(fnId);
	if (!fnEl) return null;
	const clone = fnEl.cloneNode(true);
	clone.querySelectorAll(".fn-back").forEach((b) => b.remove());
	const txt = clipText(clone.textContent, 500);
	lastHoverContext = {
		root,
		jumpAnchor: fnId
	};
	return `
    <div class="pop-head-row">
      <div class="pop-kicker">Footnote ${escapeHtml((trigger.textContent || "").trim())}</div>
      <span class="peek-badge">FOOTNOTE</span>
    </div>
    <p class="peek-text">${escapeHtml(txt)}</p>
    <div class="peek-foot">
      <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to footnote</button>
    </div>
  `;
}
function renderAnchorPeek(trigger, root) {
	const anchorId = trigger.dataset.anchor;
	if (!anchorId) return null;
	const el = root.querySelector(`#${CSS.escape(anchorId)}`) || document.getElementById(anchorId);
	if (!el) return null;
	lastHoverContext = {
		root,
		jumpAnchor: anchorId
	};
	if (el.classList.contains("table-wrap")) {
		const caption = el.querySelector("caption")?.textContent?.trim() || (trigger.textContent || "").trim();
		const table = el.querySelector("table");
		const headRows = [...table?.querySelectorAll("thead tr") || []].slice(0, 2);
		const bodyRows = [...table?.querySelectorAll("tbody tr") || table?.querySelectorAll("tr") || []].filter((r) => !r.closest("thead")).slice(0, 4);
		const rowHtml = (r) => "<tr>" + [...r.children].slice(0, 4).map((cell) => {
			const tag = cell.tagName.toLowerCase() === "th" ? "th" : "td";
			return `<${tag}>${escapeHtml(clipText(cell.textContent, 48))}</${tag}>`;
		}).join("") + (r.children.length > 4 ? "<td>…</td>" : "") + "</tr>";
		return `
      <div class="pop-head-row">
        <div class="pop-kicker">${escapeHtml(clipText(caption, 90))}</div>
        <span class="peek-badge">TABLE</span>
      </div>
      <div class="peek-table-box">
        <table class="peek-table">
          ${headRows.length ? `<thead>${headRows.map(rowHtml).join("")}</thead>` : ""}
          <tbody>${bodyRows.map(rowHtml).join("")}</tbody>
        </table>
      </div>
      <div class="peek-foot">
        <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to table</button>
      </div>
    `;
	}
	if (el.classList.contains("reg-figure")) {
		const img = el.querySelector(".reg-img");
		const caption = el.previousElementSibling?.classList.contains("reg-label") ? (el.previousElementSibling.textContent || "").trim() : (trigger.textContent || "").trim();
		return `
      <div class="pop-head-row">
        <div class="pop-kicker">${escapeHtml(caption)}</div>
        <span class="peek-badge">FIGURE</span>
      </div>
      ${img?.src ? `<div class="peek-fig-mat"><img class="peek-fig-img" src="${escapeHtml(img.src)}" alt="${escapeHtml(caption)}"></div>` : ""}
      <div class="peek-foot">
        <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to figure</button>
      </div>
    `;
	}
	if (el.classList.contains("reg-appendix")) {
		const head = el.querySelector(".reg-subhead, .reg-label")?.textContent?.trim() || (trigger.textContent || "").trim();
		const para = clipText(el.querySelector(".reg-p")?.textContent || el.textContent, 360);
		return `
      <div class="pop-head-row">
        <div class="pop-kicker">${escapeHtml(clipText(head, 80))}</div>
        <span class="peek-badge">APPENDIX</span>
      </div>
      <p class="peek-text">${escapeHtml(para)}</p>
      <div class="peek-foot">
        <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to appendix</button>
      </div>
    `;
	}
	return null;
}
function renderExternalHintPeek(trigger) {
	const target = normalizeCfrTarget({
		title: trigger.dataset.cfrTitle,
		part: trigger.dataset.cfrPart,
		section: trigger.dataset.cfrSection,
		para: trigger.dataset.cfrPara,
		ecfrUrl: trigger.getAttribute("href")
	});
	const label = target.section ? `${target.title} CFR § ${target.section}${target.para || ""}` : target.part ? `${target.title} CFR Part ${target.part}` : `Title ${target.title}`;
	const sub = state.installedTitles.some((t) => t.title === target.title) ? `This ${target.section ? "section" : "part"} isn’t in your partial Title ${target.title} download yet.` : `Title ${target.title} is not installed yet.`;
	return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(label)}</div>
      <span class="peek-badge">UNINSTALLED</span>
    </div>
    <p class="peek-text">${escapeHtml(sub)} Click to download into the reader or open on eCFR.</p>
  `;
}
function renderUscPeek(trigger) {
	const href = trigger.getAttribute("href") || "";
	const m = /\/uscode\/text\/(\d+)\/([^/?#]+)/i.exec(href);
	const uscTitle = m ? m[1] : "";
	const uscSec = m ? m[2] : "";
	const titleAttr = trigger.getAttribute("title") || "";
	return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(uscTitle && uscSec ? `${uscTitle} U.S.C. § ${uscSec}` : cleanInlineLabel(trigger.textContent))}</div>
      <span class="peek-badge">U.S. CODE</span>
    </div>
    <div class="peek-title">${escapeHtml(titleAttr || `Title ${uscTitle || ""} United States Code`)}</div>
    <p class="peek-text">Statutory authority codified in the United States Code. Click to inspect the enacted text on Cornell LII.</p>
  `;
}
function renderFrPeek(trigger) {
	const href = trigger.getAttribute("href") || "";
	const m = /\/citation\/(\d+)-FR-(\d+)/i.exec(href);
	const vol = m ? m[1] : "";
	const page = m ? m[2] : "";
	return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(vol && page ? `${vol} FR ${page}` : cleanInlineLabel(trigger.textContent))}</div>
      <span class="peek-badge">FED. REGISTER</span>
    </div>
    <div class="peek-title">Federal Register Publication</div>
    <p class="peek-text">Rulemaking history, preamble, and final rule publication at Volume ${escapeHtml(vol || "—")}, page ${escapeHtml(page || "—")}.</p>
  `;
}
function peekActionsHtml({ href, isSplitRoot = false, interactive = false }) {
	if (isSplitRoot) return `
      <button type="button" class="btn btn-small${interactive ? " btn-accent" : ""}" data-peek-split="1">Open side-by-side tab</button>
      <button type="button" class="btn btn-small" data-peek-tab="1">Open in main tab</button>
      <button type="button" class="btn btn-small" data-peek-replace-split="1">Open in this pane</button>
    `;
	return `
    <button type="button" class="btn btn-small${interactive ? " btn-accent" : ""}" data-peek-split="1">Open side-by-side</button>
    <button type="button" class="btn btn-small" data-peek-tab="1">Open in reader tab</button>
    <a class="btn btn-small" href="${escapeHtml(href)}">${interactive ? "Open here" : "Open"}</a>
  `;
}
async function openSectionHrefPeek(trigger, root, parsed, rootTitle, { interactive = false } = {}) {
	const pClause = parsed.para && /^\(([a-z])\)/i.exec(parsed.para.trim());
	const unitKey = parsed.unit === "full" ? null : parsed.unit || (pClause ? pClause[1].toLowerCase() : "");
	const cacheKey = `${parsed.title}|${parsed.section}|${unitKey || "full"}`;
	if (hoverAbort) try {
		hoverAbort.abort();
	} catch {}
	hoverAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
	const sig = hoverAbort?.signal;
	const isCross = Number(parsed.title) !== Number(rootTitle) || trigger.classList.contains("xref-cross");
	const tier = isCross ? "cross" : "cfr";
	const isSplitRoot = root === dom.splitPane;
	const href = trigger.getAttribute("href") || targetHashFor({
		title: parsed.title,
		section: parsed.section,
		para: parsed.para ?? null,
		part: null
	});
	lastHoverContext = {
		root,
		split: {
			kind: "section",
			title: parsed.title,
			sectionId: parsed.section,
			para: parsed.para,
			unit: parsed.unit
		}
	};
	let data = state.peekCache.get(cacheKey);
	const waitedForFetch = !data;
	if (!data && interactive) citePop.open(trigger, `
      <div class="pop-head-row">
        <div class="pop-kicker">${parsed.title} CFR § ${escapeHtml(parsed.section)}${parsed.para ? " " + escapeHtml(parsed.para) : ""}</div>
        <span class="peek-badge">${isCross ? `CROSS-TITLE · ${parsed.title} CFR` : `${parsed.title} CFR`}</span>
        <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close reference actions">${icon("close")}</button>
      </div>
      <div class="peek-foot is-compact">
        ${peekActionsHtml({
		href,
		isSplitRoot,
		interactive
	})}
      </div>
    `, {
		interactive: true,
		returnFocus: trigger,
		focusSelector: "[data-peek-split]",
		refTier: tier
	});
	if (!data) {
		const qs = unitKey === null ? "" : "?unit=" + encodeURIComponent(unitKey);
		try {
			const res = await fetchSectionRaw(parsed.title, parsed.section, qs, { signal: sig });
			if (!res.ok) return;
			data = await res.json();
			cachePeekSection(cacheKey, data);
		} catch {
			return;
		}
	}
	if (!interactive && (hoverTarget !== trigger || citePop.isOpen() && citePop.isInteractive())) return;
	if (interactive && waitedForFetch && citePop.getAnchor() !== trigger) return;
	const doc = new DOMParser().parseFromString(data.html || "", "text/html");
	let snippet = "";
	if (parsed.para) {
		const hit = findParagraphElement(doc.body, parsed.para);
		if (hit) snippet = extractBranchSnippet(doc.body, hit);
	}
	if (!snippet) snippet = clipText([...doc.body.querySelectorAll(".reg-p, .reg-callout")].slice(0, 2).map((p) => p.textContent).join(" "), 420) || (data.reserved ? "This section is reserved." : "");
	const label = cleanInlineLabel(data.label);
	const titleText = cleanInlineLabel(data.section_title || data.title_label || "");
	lastHoverContext = {
		root,
		split: {
			kind: "section",
			title: parsed.title,
			sectionId: parsed.section,
			para: parsed.para,
			unit: parsed.unit,
			label: `${parsed.title} CFR ${label}`,
			heading: titleText
		}
	};
	citePop.open(trigger, `
    <div class="pop-head-row">
      <div class="pop-kicker">${parsed.title} CFR ${escapeHtml(label)}${parsed.para ? " " + escapeHtml(parsed.para) : ""}</div>
      <span class="peek-badge">${isCross ? `CROSS-TITLE · ${parsed.title} CFR` : `${parsed.title} CFR`}</span>
      ${interactive ? `<button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close reference actions">${icon("close")}</button>` : ""}
    </div>
    ${titleText ? `<div class="peek-title">${escapeHtml(titleText)}</div>` : ""}
    ${snippet ? `<p class="peek-text">${escapeHtml(snippet)}</p>` : ""}
    <div class="peek-foot">
      ${peekActionsHtml({
		href,
		isSplitRoot,
		interactive
	})}
    </div>
  `, interactive ? {
		interactive: true,
		returnFocus: trigger,
		focusSelector: "[data-peek-split]",
		refTier: tier
	} : {
		interactive: false,
		refTier: tier
	});
}
function openPartHrefPeek(trigger, root, parsed, rootTitle, { interactive = false } = {}) {
	const isCross = Number(parsed.title) !== Number(rootTitle) || trigger.classList.contains("xref-cross");
	const tier = isCross ? "cross" : "cfr";
	const isSplitRoot = root === dom.splitPane;
	const href = trigger.getAttribute("href") || targetHashFor({
		title: parsed.title,
		part: parsed.part,
		section: null,
		para: null
	});
	lastHoverContext = {
		root,
		split: {
			kind: "part",
			title: parsed.title,
			partId: parsed.part
		}
	};
	citePop.open(trigger, `
    <div class="pop-head-row">
      <div class="pop-kicker">${parsed.title} CFR Part ${escapeHtml(parsed.part)}</div>
      <span class="peek-badge">${isCross ? `CROSS-TITLE · PART` : `PART ${escapeHtml(parsed.part)}`}</span>
      ${interactive ? `<button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close reference actions">${icon("close")}</button>` : ""}
    </div>
    <p class="peek-text">Open Part ${escapeHtml(parsed.part)} of Title ${parsed.title} CFR side-by-side or in a reader tab.</p>
    <div class="peek-foot">
      ${peekActionsHtml({
		href,
		isSplitRoot,
		interactive
	})}
    </div>
  `, interactive ? {
		interactive: true,
		returnFocus: trigger,
		focusSelector: "[data-peek-split]",
		refTier: tier
	} : {
		interactive: false,
		refTier: tier
	});
}
function renderIbrPeek(trigger, root) {
	const code = trigger.dataset.ibrCode;
	if (!code) return null;
	const t = root === dom.splitPane ? state.splitState?.title || state.currentTitle : state.currentTitle;
	const secId = root === dom.splitPane ? state.splitState?.sectionId || "" : state.currentSection?.id || "";
	const item = (secId ? state.graphCache.get(`${t}|${secId}`) : null)?.ibr?.find((x) => x.code === code);
	if (!item) return null;
	const app = item.approved_in;
	const appHref = app ? `#/title/${t}/section/${encodeURIComponent(app.section_id)}${app.para ? "?p=" + encodeURIComponent(app.para) : ""}` : "";
	lastHoverContext = app ? {
		root,
		split: {
			kind: "section",
			title: t,
			sectionId: app.section_id,
			para: app.para || null
		}
	} : null;
	return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(item.code)}</div>
      <span class="peek-badge">IBR · ${escapeHtml(item.org)}</span>
    </div>
    ${item.org_name ? `<div class="peek-title">${escapeHtml(item.org_name)}</div>` : ""}
    ${app ? `<p class="peek-text"><strong>${item.exact ? "IBR approved" : "Closest approved edition"} in ${escapeHtml(app.label)}${escapeHtml(app.para || "")}:</strong> ${escapeHtml(app.excerpt)}</p>` : `<p class="peek-text">Consensus technical standard published by ${escapeHtml(item.org_name || item.org)}.</p>`}
    <div class="peek-foot">
      ${app ? `<button type="button" class="btn btn-small" data-peek-split="1">Open side-by-side</button>` : ""}
      ${app ? `<button type="button" class="btn btn-small" data-peek-tab="1">Open in reader tab</button>` : ""}
      ${app ? `<a class="btn btn-small" href="${escapeHtml(appHref)}">Open ${escapeHtml(app.label)}</a>` : ""}
      ${safeHttpUrl(item.org_url) ? `<a class="btn btn-small" href="${escapeHtml(safeHttpUrl(item.org_url))}" target="_blank" rel="noopener noreferrer">${icon("external")} ${escapeHtml(item.org)}</a>` : ""}
    </div>
  `;
}
function getPeekTrigger(el) {
	return el?.closest("a.xref-local[data-local-para], .ftref[data-anchor], button.xref-anchor[data-anchor], button.xref-ibr[data-ibr-code], a.xref-external[data-cfr-title], a.xref-usc, a.xref-fr, a.xref[href], a.xref-cross[href], a.citation-chip[href*=\"/section/\"]") || null;
}
function handleHoverOver(e, root) {
	if (citePop.isOpen() && citePop.isInteractive()) return;
	if (e.sourceCapabilities?.firesTouchEvents) return;
	if ((window.getSelection()?.toString() || "").trim().length > 0) return;
	const trigger = getPeekTrigger(e.target);
	if (!trigger || !root.contains(trigger)) return;
	if (trigger === hoverTarget) {
		if (closeTimer !== null) clearTimeout(closeTimer);
		closeTimer = null;
		return;
	}
	cancelHoverTimers();
	hoverTarget = trigger;
	const rootTitle = root === dom.splitPane ? state.splitState?.title || state.currentTitle : state.currentTitle;
	hoverTimer = setTimeout(() => {
		if (hoverTarget !== trigger || citePop.isOpen() && citePop.isInteractive()) return;
		if (trigger.matches("a.xref-local[data-local-para]")) {
			const html = renderLocalParaPeek(trigger, root);
			if (html) citePop.open(trigger, html, {
				interactive: false,
				refTier: "local"
			});
			return;
		}
		if (trigger.matches(".ftref[data-anchor]")) {
			const html = renderFootnotePeek(trigger, root);
			if (html) citePop.open(trigger, html, {
				interactive: false,
				refTier: "local"
			});
			return;
		}
		if (trigger.matches("button.xref-anchor[data-anchor]")) {
			const html = renderAnchorPeek(trigger, root);
			if (html) citePop.open(trigger, html, {
				interactive: false,
				refTier: "local"
			});
			return;
		}
		if (trigger.matches("button.xref-ibr[data-ibr-code]")) {
			const html = renderIbrPeek(trigger, root);
			if (html) citePop.open(trigger, html, {
				interactive: false,
				refTier: "ibr"
			});
			return;
		}
		if (trigger.matches("a.xref-external[data-cfr-title]")) {
			lastHoverContext = null;
			citePop.open(trigger, renderExternalHintPeek(trigger), {
				interactive: false,
				refTier: "uninstalled"
			});
			return;
		}
		if (trigger.matches("a.xref-usc")) {
			lastHoverContext = null;
			citePop.open(trigger, renderUscPeek(trigger), {
				interactive: false,
				refTier: "usc"
			});
			return;
		}
		if (trigger.matches("a.xref-fr")) {
			lastHoverContext = null;
			citePop.open(trigger, renderFrPeek(trigger), {
				interactive: false,
				refTier: "fr"
			});
			return;
		}
		if (trigger.matches("a[href^=\"#\"]")) {
			const parsed = parseCfrHref(trigger.getAttribute("href"), rootTitle);
			if (parsed && parsed.kind === "section") openSectionHrefPeek(trigger, root, parsed, rootTitle);
			else if (parsed && parsed.kind === "part" && trigger.classList.contains("xref")) openPartHrefPeek(trigger, root, parsed, rootTitle);
		}
	}, 250);
}
function handleHoverOut(e) {
	if (!hoverTarget) return;
	const related = e.relatedTarget;
	if (related && (hoverTarget.contains(related) || citePopEl?.contains(related))) return;
	if (hoverTimer !== null) clearTimeout(hoverTimer);
	hoverTimer = null;
	if (!citePop.isInteractive()) scheduleCloseHover();
}
for (const root of [dom.view, dom.splitPane].filter(Boolean)) {
	root.addEventListener("mouseover", (e) => handleHoverOver(e, root));
	root.addEventListener("mouseout", handleHoverOut);
	root.addEventListener("click", (e) => {
		const ibrBtn = e.target?.closest("button.xref-ibr[data-ibr-code]");
		if (!ibrBtn || !root.contains(ibrBtn)) return;
		const html = renderIbrPeek(ibrBtn, root);
		if (html) {
			e.preventDefault();
			cancelHoverTimers();
			citePop.open(ibrBtn, html, {
				interactive: true,
				returnFocus: ibrBtn,
				refTier: "ibr"
			});
		}
	});
}
if (dom.citePop) {
	dom.citePop.addEventListener("mouseenter", () => {
		if (closeTimer !== null) clearTimeout(closeTimer);
		closeTimer = null;
	});
	dom.citePop.addEventListener("mouseleave", () => {
		if (!citePop.isInteractive()) scheduleCloseHover();
	});
	dom.citePop.addEventListener("click", (e) => {
		const t = e.target;
		const jumpBtn = t?.closest("[data-peek-jump]");
		if (jumpBtn && lastHoverContext) {
			const ctx = lastHoverContext;
			citePop.close(false);
			if (jumpBtn.dataset.peekJump === "para" && ctx.jumpPara) highlightTarget(ctx.root, ctx.jumpPara, 0);
			else if (jumpBtn.dataset.peekJump === "anchor" && ctx.jumpAnchor) scrollToAnchor(ctx.jumpAnchor, ctx.root);
			return;
		}
		if (t?.closest("[data-peek-split]") && lastHoverContext?.split) {
			const sp = lastHoverContext.split;
			citePop.close(false);
			openSplitPane({
				...sp,
				newTab: true,
				pushHistory: true
			});
			return;
		}
		if (t?.closest("[data-peek-replace-split]") && lastHoverContext?.split) {
			const sp = lastHoverContext.split;
			citePop.close(false);
			openSplitPane({
				...sp,
				newTab: false,
				pushHistory: true
			});
			return;
		}
		if (t?.closest("[data-peek-tab]") && lastHoverContext?.split) {
			const sp = lastHoverContext.split;
			citePop.close(false);
			openMainReaderTab({ ...sp });
			return;
		}
		if (t?.closest("a[href^=\"#\"]")) citePop.close(false);
	});
}
async function handleCfrLinkClick(e, root) {
	if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
	const link = e.target?.closest("a");
	if (!link || !root.contains(link)) return;
	const isSplitChild = root === dom.splitPane;
	const rootTitle = isSplitChild ? state.splitState?.title || state.currentTitle : state.currentTitle;
	if (link.matches("a.xref-usc-local[href^=\"/usc/\"]")) {
		const m = /^\/usc\/(\d+)\/(.+)$/.exec(link.getAttribute("href") || "");
		if (m) {
			e.preventDefault();
			cancelHoverTimers();
			window.location.hash = `#/usc/${m[1]}/section/${m[2]}`;
			return;
		}
	}
	if (link.matches("a.xref-external[data-cfr-title]")) {
		e.preventDefault();
		cancelHoverTimers();
		const target = normalizeCfrTarget({
			title: link.dataset.cfrTitle,
			part: link.dataset.cfrPart,
			section: link.dataset.cfrSection,
			para: link.dataset.cfrPara,
			ecfrUrl: link.getAttribute("href")
		});
		if ((await checkLocalCfrTarget(target)).installed) {
			if ((e.altKey || isSplitChild) && (target.section || target.part)) openSplitPane(target.section ? {
				kind: "section",
				title: target.title,
				sectionId: target.section,
				para: target.para,
				pushHistory: true
			} : {
				kind: "part",
				title: target.title,
				partId: target.part || void 0,
				pushHistory: true
			});
			else if (target.section) await openSectionHrefPeek(link, root, {
				kind: "section",
				title: target.title,
				section: target.section,
				para: target.para,
				unit: null
			}, rootTitle, { interactive: true });
			else if (target.part) openPartHrefPeek(link, root, {
				kind: "part",
				title: target.title,
				part: target.part
			}, rootTitle, { interactive: true });
			else window.location.hash = targetHashFor(target);
			return;
		}
		openCfrDownloadCard(link, target, { openInSplit: e.altKey || isSplitChild });
		return;
	}
	if ((root === dom.view || root === dom.splitPane) && !link.classList.contains("xref-local") && link.matches(".reg-body a.xref[href^=\"#\"], .full-section a.xref[href^=\"#\"], .front-matter a.xref[href^=\"#\"], .fr-doc-body a.xref[href^=\"#\"]") && !e.altKey) {
		const parsed = parseCfrHref(link.getAttribute("href"), rootTitle);
		if (parsed && parsed.kind === "section") {
			e.preventDefault();
			cancelHoverTimers();
			openSectionHrefPeek(link, root, parsed, rootTitle, { interactive: true });
			return;
		}
		if (parsed && parsed.kind === "part") {
			e.preventDefault();
			cancelHoverTimers();
			openPartHrefPeek(link, root, parsed, rootTitle, { interactive: true });
			return;
		}
	}
	if (!e.altKey) return;
	if (link.matches("a.xref-local[data-local-para]")) {
		const secId = isSplitChild ? state.splitState?.sectionId : state.currentSection?.id;
		if (secId) {
			e.preventDefault();
			cancelHoverTimers();
			openSplitPane({
				title: rootTitle,
				sectionId: secId,
				para: link.dataset.localPara,
				pushHistory: true
			});
		}
		return;
	}
	const parsed = parseCfrHref(link.getAttribute("href"), rootTitle);
	if (parsed && parsed.kind === "section") {
		e.preventDefault();
		cancelHoverTimers();
		openSplitPane({
			kind: "section",
			title: parsed.title,
			sectionId: parsed.section,
			para: parsed.para,
			unit: parsed.unit,
			pushHistory: true
		});
	} else if (parsed && parsed.kind === "part") {
		e.preventDefault();
		cancelHoverTimers();
		openSplitPane({
			kind: "part",
			title: parsed.title,
			partId: parsed.part,
			pushHistory: true
		});
	}
}
for (const root of [
	dom.view,
	dom.splitPane,
	dom.tree
].filter(Boolean)) root.addEventListener("click", (e) => handleCfrLinkClick(e, root));
// src/main.js
var chatKbd = document.getElementById("chat-kbd");
if (chatKbd) chatKbd.textContent = isMac ? "⌘J" : "Ctrl J";
async function init() {
	try {
		const [cfrTitles, uscTitles] = await Promise.all([fetchInstalledTitles(), fetchInstalledUscTitles().catch(() => [])]);
		state.installedTitles = cfrTitles;
		state.installedUscTitles = uscTitles;
		state.noTitles = state.installedTitles.length === 0;
		syncCorporaState();
		if (state.installedTitles.length && !state.installedTitles.some((t) => t.title === state.currentTitle)) await switchTitle(state.installedTitles[0].title);
		fillTitleSelect();
		updateRailHome();
		updateRailBadge();
		if (state.noTitles) setReaderEnabled(false);
		else {
			const [meta] = await Promise.all([
				fetchTitleMeta(state.currentTitle).catch(() => null),
				refreshModelsConfig(),
				ensureTreeLoaded()
			]);
			if (meta) {
				state.metaInfo = meta;
				dom.edition.textContent = `eCFR ${state.metaInfo.edition || ""}`;
			}
			setReaderEnabled(true);
		}
	} catch (e) {
		console.warn("Initialization warnings:", e);
	}
	const sessionSnap = restoreSessionTabsSnapshot();
	await handleRoute();
	if (sessionSnap?.splitTabs?.length && (state.currentSection || state.currentPart)) {
		const idx = Math.max(0, sessionSnap.splitTabs.findIndex((t) => t.id === sessionSnap.activeSplitTabId));
		restoreSplitTabs(sessionSnap.splitTabs, idx, sessionSnap.splitWide);
	}
	getJSON("/api/library/jobs").then((snap) => {
		setJobs(snap);
		pollJobsIfActive();
	}).catch(() => {});
}
init();
