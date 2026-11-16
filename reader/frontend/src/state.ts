// Shared mutable app state. One object so modules can freely read and write
// (ES module bindings are read-only across modules; properties of this object
// are not). Values are assigned at startup by the owning modules. Keys are
// typed loosely for now; tighten them as modules migrate to TypeScript.
export interface AppState {
  currentTitle: any;
  installedTitles: any;
  treeData: any;
  currentSection: any;
  currentPart: any;
  activeRoute: any;
  metaInfo: any;
  chatConfig: any;
  chatHistory: any;
  isGenerating: any;
  routeSeq: any;
  jobs: any;
  jobsTimer: any;
  jobsSeenActive: any;
  lastJobsKey: any;
  railObserver: any;
  searchState: any;
  searchTimer: any;
  sdActive: any;
  visited: any;
  treePromise: any;
  currentTreeKey: any;
  currentPartKey: any;
  currentAgencyKey: any;
  rootViewMode: any;
  sideView: any;
  treeFilterState: any;
  foldedGroups: any;
  filterTimer: any;
  newProjectOpen: any;
  projEditT: any;
  newsQTimer: any;
  newsActivityCtx: any;
  navRetracted: any;
  historyFor: any;
  goPending: any;
  navTransferKey: any;
  navStorage: any;
  navNewsStatus: any;
  navEnvStatus: any;
  envModalReturnFocus: any;
  envModalSnapshot: any;
  selectedText: any;
}

export const state: AppState = {
  currentTitle: undefined,
  installedTitles: undefined,
  treeData: undefined,
  currentSection: undefined,
  currentPart: undefined,
  activeRoute: undefined,
  metaInfo: undefined,
  chatConfig: undefined,
  chatHistory: undefined,
  isGenerating: undefined,
  routeSeq: undefined,
  jobs: undefined,
  jobsTimer: undefined,
  jobsSeenActive: undefined,
  lastJobsKey: undefined,
  railObserver: undefined,
  searchState: undefined,
  searchTimer: undefined,
  sdActive: undefined,
  visited: undefined,
  treePromise: undefined,
  currentTreeKey: undefined,
  currentPartKey: undefined,
  currentAgencyKey: undefined,
  rootViewMode: undefined,
  sideView: undefined,
  treeFilterState: undefined,
  foldedGroups: undefined,
  filterTimer: undefined,
  newProjectOpen: undefined,
  projEditT: undefined,
  newsQTimer: undefined,
  newsActivityCtx: undefined,
  navRetracted: undefined,
  historyFor: undefined,
  goPending: undefined,
  navTransferKey: undefined,
  navStorage: undefined,
  navNewsStatus: undefined,
  navEnvStatus: undefined,
  envModalReturnFocus: undefined,
  envModalSnapshot: undefined,
  selectedText: undefined,
};
