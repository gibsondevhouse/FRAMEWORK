import { state } from './state';

// --- State ---
state.currentTitle = 29;
state.activeCorpusId = 'us:cfr:29';
state.corpora = [];
state.extraCorpora = [];
state.installedTitles = [];
state.noTitles = false;
state.profilesData = undefined;
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

const docMotion = typeof document !== 'undefined' ? document.documentElement.dataset.motion : undefined;
state.motionLevel = (docMotion === 'none' || docMotion === 'less') ? docMotion : 'full';
state.splitState = null;
state.mainTabs = [];
state.activeMainTabId = null;
state.splitTabs = [];
state.activeSplitTabId = null;
state.splitWide = false;
state.pendingNewMainTab = false;
state.swapMotionX = 0;
state.pendingDownloads = new Map();
state.peekCache = new Map();
state.graphCache = new Map();
state.refsCache = new Map();

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return (typeof document !== 'undefined' ? document.getElementById(id) : null) as T;
}

function queryEl<T extends HTMLElement = HTMLElement>(sel: string): T {
  return (typeof document !== 'undefined' ? document.querySelector(sel) : null) as T;
}

export interface DomRefs {
  topbar: HTMLElement;
  titleSelect: HTMLButtonElement;
  titlePop: HTMLElement;
  navToggle: HTMLButtonElement;
  search: HTMLInputElement;
  searchDropdown: HTMLElement;
  edition: HTMLElement;
  chatToggle: HTMLButtonElement;
  layout: HTMLElement;
  sidebar: HTMLElement;
  sidebarResizer: HTMLElement;
  navBackdrop: HTMLElement;
  treeFilter: HTMLInputElement;
  tree: HTMLElement;
  mainStage: HTMLElement;
  main: HTMLElement;
  mainTabs: HTMLElement;
  splitPane: HTMLElement;
  view: HTMLElement;
  viewHead: HTMLElement;
  citePop: HTMLElement;
  chat: HTMLElement;
  modelSelect: HTMLSelectElement;
  chatNew: HTMLButtonElement;
  chatClose: HTMLButtonElement;
  chatContext: HTMLElement;
  contextToggle: HTMLInputElement;
  contextLabel: HTMLElement;
  chatMessages: HTMLElement;
  chatForm: HTMLFormElement;
  chatText: HTMLTextAreaElement;
  chatSend: HTMLButtonElement;
  askFloat: HTMLElement;
  toast: HTMLElement;
}

// Cache DOM
export const dom: DomRefs = {
  topbar: queryEl('.topbar'),
  titleSelect: byId<HTMLButtonElement>('title-select'),
  titlePop: byId('title-pop'),
  navToggle: byId<HTMLButtonElement>('nav-toggle'),
  search: byId<HTMLInputElement>('search'),
  searchDropdown: byId('search-dropdown'),
  edition: byId('edition'),
  chatToggle: byId<HTMLButtonElement>('chat-toggle'),
  layout: byId('layout'),
  sidebar: byId('sidebar'),
  sidebarResizer: byId('sidebar-resizer'),
  navBackdrop: byId('nav-backdrop'),
  treeFilter: byId<HTMLInputElement>('tree-filter'),
  tree: byId('tree'),
  mainStage: byId('main-stage'),
  main: byId('main'),
  mainTabs: byId('main-tabs'),
  splitPane: byId('split-pane'),
  view: byId('view'),
  viewHead: byId('view-head'),
  citePop: byId('cite-pop'),
  chat: byId('chat'),
  modelSelect: byId<HTMLSelectElement>('model-select'),
  chatNew: byId<HTMLButtonElement>('chat-new'),
  chatClose: byId<HTMLButtonElement>('chat-close'),
  chatContext: byId('chat-context'),
  contextToggle: byId<HTMLInputElement>('context-toggle'),
  contextLabel: byId('context-label'),
  chatMessages: byId('chat-messages'),
  chatForm: byId<HTMLFormElement>('chat-form'),
  chatText: byId<HTMLTextAreaElement>('chat-text'),
  chatSend: byId<HTMLButtonElement>('chat-send'),
  askFloat: byId('ask-float'),
  toast: byId('toast'),
};
