// Shared mutable app state + strict TypeScript DTO boundaries.
// Modules read and mutate fields here (ES module bindings themselves are read-only).

export interface InstalledTitleMeta {
  title: number;
  name: string;
  edition?: string | null;
  built_at?: string | null;
  section_count?: number;
  partial?: boolean;
  ai_configured?: boolean;
}

export interface SectionOutlineItem {
  key: string;
  label?: string | null;
  title?: string | null;
  kind?: string;
  group?: string | null;
  group_label?: string | null;
  group_title?: string | null;
  chars?: number;
}

export interface SectionNeighbor {
  id: string;
  label?: string;
  title?: string;
}

export interface SectionDocData {
  id: string;
  title: number;
  kind: string;
  part: string | null;
  label: string;
  section_title?: string;
  title_label?: string;
  reserved?: boolean;
  path?: Array<Record<string, unknown>>;
  ecfr_url?: string;
  html: string;
  mode: 'units' | 'page';
  outline: SectionOutlineItem[];
  unit: string | null;
  unit_prev?: SectionOutlineItem | null;
  unit_next?: SectionOutlineItem | null;
  prev?: SectionNeighbor | null;
  next?: SectionNeighbor | null;
}

export interface TransferJob {
  id: number;
  title: number;
  kind: 'title' | 'part' | 'section' | 'update';
  target?: { t?: string; id?: string; part?: string } | null;
  label: string;
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  phase?: string;
  done?: number | null;
  total?: number | null;
  error?: string | null;
  cancelling?: boolean;
}

export interface JobsSnapshot {
  current: TransferJob | null;
  queued: TransferJob[];
  recent: TransferJob[];
}

export interface SplitState {
  title: number;
  sectionId: string;
  para?: string | null;
  unit?: string | null;
}

export interface PendingDownloadEntry {
  title: number;
  part?: string | null;
  section?: string | null;
  kind?: 'section' | 'part' | 'title' | 'appendix';
  para?: string | null;
  openInSplit?: boolean;
  fromHash?: string;
}

export interface AppState {
  currentTitle: number;
  installedTitles: InstalledTitleMeta[];
  homeSnapshot: any;
  noTitles: boolean;
  profilesData: any;
  treeData: any;
  currentSection: SectionDocData | null;
  currentPart: string | null;
  activeRoute: string;
  metaInfo: Partial<InstalledTitleMeta> & Record<string, any>;
  chatConfig: any;
  chatHistory: any;
  isGenerating: boolean;
  routeSeq: number;
  jobs: JobsSnapshot;
  jobsTimer: any;
  jobsSeenActive: Set<number>;
  lastJobsKey: string;
  railObserver: IntersectionObserver | null;
  searchState: any;
  searchTimer: any;
  sdActive: any;
  visited: Set<string>;
  treePromise: Promise<void> | null;
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
  selectedText: string;
  routeAbort: AbortController | null;
  splitState: SplitState | null;
  pendingDownloads: Map<number, PendingDownloadEntry>;
  peekCache: Map<string, SectionDocData>;
}

export const state: AppState = {
  currentTitle: 29,
  installedTitles: [],
  homeSnapshot: undefined,
  noTitles: false,
  profilesData: undefined,
  treeData: undefined,
  currentSection: null,
  currentPart: null,
  activeRoute: '',
  metaInfo: {},
  chatConfig: undefined,
  chatHistory: undefined,
  isGenerating: false,
  routeSeq: 0,
  jobs: { current: null, queued: [], recent: [] },
  jobsTimer: undefined,
  jobsSeenActive: new Set(),
  lastJobsKey: '',
  railObserver: null,
  searchState: undefined,
  searchTimer: undefined,
  sdActive: undefined,
  visited: new Set(),
  treePromise: null,
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
  selectedText: '',
  routeAbort: null,
  splitState: null,
  pendingDownloads: new Map(),
  peekCache: new Map(),
};
