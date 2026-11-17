import { state } from './state';

// --- State ---
state.currentTitle = 29;

state.installedTitles = [];

state.noTitles = false;

state.profilesData = null;

state.treeData = null;

state.currentSection = null;

state.currentPart = null;

state.activeRoute = '';

state.metaInfo = {};

state.chatConfig = { configured: false, models: [], default: null };

state.chatHistory = [];

state.isGenerating = false;

// Bumped on every route change. A loader that awaited the network checks it before painting,
// so a slow page can't land on top of the one the reader has since moved to.
state.routeSeq = 0;
state.routeAbort = null;
state.splitState = null;
state.pendingDownloads = new Map();
state.peekCache = new Map();
state.graphCache = new Map();
state.refsCache = new Map();


// Cache DOM
export const dom = {
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
  mainStage: document.getElementById('main-stage'),
  main: document.getElementById('main'),
  splitPane: document.getElementById('split-pane'),
  view: document.getElementById('view'),
  viewHead: document.getElementById('view-head'),
  citePop: document.getElementById('cite-pop'),
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
