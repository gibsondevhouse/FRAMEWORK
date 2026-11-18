// Shared mutable app state + strict TypeScript DTO boundaries.
// Zero `any` fields: every API response and UI state container carries a typed shape.

export type AuthorityTier =
  | 'federal-statute'
  | 'federal-reg'
  | 'state'
  | 'county'
  | 'standard';

export type RefTier =
  | 'local'
  | 'cfr'
  | 'cross'
  | 'uninstalled'
  | 'usc'
  | 'fr'
  | 'ibr'
  | 'state'
  | 'county';

export type DeskId =
  | 'all'
  | 'ehs'
  | 'env'
  | 'transport'
  | 'fire-building'
  | 'labor-employment'
  | 'commerce-govcon';

export interface CorpusSummary {
  corpus_id: string;
  tier: AuthorityTier;
  jurisdiction: string;
  jurisdiction_label: string;
  code: string;
  title_num?: number;
  name: string;
  desk: DeskId;
  agencies: string[];
  edition?: string | null;
  section_count?: number;
  partial?: boolean;
  summary?: string;
  installed?: boolean;
}

export interface JurisdictionStackNode {
  tier: AuthorityTier;
  ref_tier: RefTier;
  code: string;
  label: string;
  href?: string;
  installed?: boolean;
  meta?: string;
}

export interface JurisdictionStack {
  corpus_id: string;
  nodes: JurisdictionStackNode[];
}

export interface ActionProjectItem {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done';
  due?: string;
  linked_sections?: string[];
  created_at?: string;
}

export interface InstalledTitleMeta {
  title: number;
  name: string;
  edition?: string | null;
  built_at?: string | null;
  section_count?: number;
  partial?: boolean;
  ai_configured?: boolean;
}

export interface TitleSnapshotRow extends InstalledTitleMeta {
  unreadable?: boolean;
  scope_parts?: string[] | null;
  scope_sections_count?: number;
  desk?: string;
  agencies?: string[];
  summary?: string;
  news?: { count: number; latest_title?: string | null; latest_date?: string | null };
}

export interface HomeSnapshot {
  ai_configured: boolean;
  titles: TitleSnapshotRow[];
}

export interface ProfileInfo {
  id: string;
  name: string;
  description?: string;
  titles?: number[];
}

export interface TreeNode {
  t?: string;
  id?: string;
  l?: string;
  d?: string;
  r?: boolean;
  c?: TreeNode[];
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

export interface ChatConfig {
  configured: boolean;
  models: string[];
  default: string | null;
  selected?: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SearchResultItem {
  id: string;
  kind?: string;
  part?: string;
  label?: string;
  title: number;
  title_label?: string;
  snippet?: string;
  exact?: boolean;
  score?: number;
}

export interface SearchResponse {
  query: string;
  title: number | string;
  total: number;
  results: SearchResultItem[];
  ms: number;
}

export interface SearchViewState {
  query: string;
  allTitles: boolean;
  data: SearchResponse;
  view: 'compact' | 'grouped';
  filters: {
    title: number | null;
    part: string | null;
    kind: 'all' | 'section' | 'appendix';
    text: string;
  };
  collapsed: Set<number>;
}

export interface NewsArticle {
  guid?: string;
  category: string;
  title: string;
  link: string;
  published_at: string;
  citation?: string;
  comments_close_on?: string;
  scheduled_on?: string;
  penalty_usd?: number;
  company?: string;
  city?: string;
  state?: string;
}

export interface NewsActivityCtx {
  kind: 'section' | 'part';
  id: string;
  data: { count: number; articles: NewsArticle[] };
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

export interface LegacyRefHint {
  replacement_url: string;
  replacement_label: string;
  note: string;
}

export interface RefCiter {
  id: string;
  part: string;
  label: string;
  title: string;
}

export interface ReferenceItem {
  url: string;
  display: string;
  host: string;
  category: 'standards' | 'portals' | 'agencies' | 'technical';
  legacy: LegacyRefHint | null;
  cite_count: number;
  cited_in: RefCiter[];
}

export interface ReferencesResponse {
  title: number;
  total: number;
  category_counts: Record<string, number>;
  items: ReferenceItem[];
}

export interface IbrCatalogEntry {
  code: string;
  base_code: string;
  org: string;
  section_id: string;
  part: string;
  label: string;
  para: string;
  excerpt: string;
  urls: string[];
}

export interface IbrMatch {
  code: string;
  match_text: string;
  org: string;
  org_name: string;
  org_url: string;
  exact: boolean;
  approved_in: IbrCatalogEntry | null;
}

export interface SectionGraphData {
  title: number;
  section_id: string;
  cited_by_count: number;
  cited_by: RefCiter[];
  ibr: IbrMatch[];
}

export interface AppState {
  currentTitle: number;
  activeCorpusId: string;
  activeDesk: DeskId;
  corpora: CorpusSummary[];
  extraCorpora: CorpusSummary[];
  installedTitles: InstalledTitleMeta[];
  homeSnapshot: HomeSnapshot | undefined;
  noTitles: boolean;
  profilesData: { profiles: ProfileInfo[]; title_names: Record<string, string> } | undefined;
  treeData: TreeNode | null;
  currentSection: SectionDocData | null;
  currentPart: string | null;
  activeRoute: string;
  metaInfo: Partial<InstalledTitleMeta> & { scope?: string };
  chatConfig: ChatConfig;
  chatHistory: ChatMessage[];
  isGenerating: boolean;
  routeSeq: number;
  jobs: JobsSnapshot;
  jobsTimer: ReturnType<typeof setTimeout> | null | undefined;
  jobsSeenActive: Set<number>;
  lastJobsKey: string;
  railObserver: IntersectionObserver | { disconnect: () => void } | null;
  searchState: SearchViewState | null;
  searchTimer: ReturnType<typeof setTimeout> | null | undefined;
  sdActive: number | undefined;
  visited: Set<string>;
  treePromise: Promise<void> | null;
  currentTreeKey: number | null | undefined;
  currentPartKey: number | null | undefined;
  currentAgencyKey: number | null | undefined;
  rootViewMode: 'agencies' | 'all-parts' | undefined;
  sideView: 'agencies' | 'all-parts' | 'agency' | 'part' | undefined;
  treeFilterState: unknown;
  foldedGroups: Set<string> | undefined;
  filterTimer: ReturnType<typeof setTimeout> | null | undefined;
  newProjectOpen: boolean | undefined;
  projEditT: ReturnType<typeof setTimeout> | null | undefined;
  newsQTimer: ReturnType<typeof setTimeout> | null | undefined;
  newsActivityCtx: NewsActivityCtx | null;
  navRetracted: boolean | undefined;
  historyFor: string | undefined;
  goPending: boolean | undefined;
  navTransferKey: string | undefined;
  navStorage: unknown;
  navNewsStatus: unknown;
  navEnvStatus: unknown;
  envModalReturnFocus: Element | null | undefined;
  envModalSnapshot: unknown;
  selectedText: string;
  routeAbort: AbortController | null;
  splitState: SplitState | null;
  pendingDownloads: Map<number, PendingDownloadEntry>;
  peekCache: Map<string, SectionDocData>;
  graphCache: Map<string, SectionGraphData>;
  refsCache: Map<number, ReferencesResponse>;
}

export const state: AppState = {
  currentTitle: 29,
  activeCorpusId: 'us:cfr:29',
  activeDesk: 'all',
  corpora: [],
  extraCorpora: [],
  installedTitles: [],
  homeSnapshot: undefined,
  noTitles: false,
  profilesData: undefined,
  treeData: null,
  currentSection: null,
  currentPart: null,
  activeRoute: '',
  metaInfo: {},
  chatConfig: { configured: false, models: [], default: null },
  chatHistory: [],
  isGenerating: false,
  routeSeq: 0,
  jobs: { current: null, queued: [], recent: [] },
  jobsTimer: undefined,
  jobsSeenActive: new Set(),
  lastJobsKey: '',
  railObserver: null,
  searchState: null,
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
  newsActivityCtx: null,
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
  graphCache: new Map(),
  refsCache: new Map(),
};
