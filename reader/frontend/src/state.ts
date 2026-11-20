// Shared mutable app state + strict TypeScript DTO boundaries.
// Zero `any` fields: every API response and UI state container carries a typed shape.

export type AuthorityTier =
  | 'federal-constitution'
  | 'federal-statute'
  | 'federal-reg'
  | 'federal-register'
  | 'state'
  | 'county'
  | 'standard';

export type HomeTab = 'overview' | 'usc' | 'cfr' | 'fr';

export type HomeFrCat = 'all' | 'rules' | 'rulemaking' | 'notices' | 'public_inspection';

export type RefTier =
  | 'local'
  | 'cfr'
  | 'cross'
  | 'uninstalled'
  | 'const'
  | 'usc'
  | 'fr'
  | 'ibr'
  | 'state'
  | 'county'
  | 'web';

export type MotionLevel = 'none' | 'less' | 'full';

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
  linked_titles?: number[];
  external_url?: string;
  status_label?: string;
  update_available?: boolean;
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
  /** Sections eCFR's table of contents listed that had no text in the download (FT-08); null = not recorded. */
  missing_sections?: number | null;
  missing_sample?: string[];
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
  range?: string;
  k?: number;
  n?: number;
  partCount?: number;
  hay?: string;
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

export interface ChatModelOption {
  id: string;
  name: string;
}

export interface ChatConfig {
  configured: boolean;
  models: ChatModelOption[];
  default: string | null;
  selected?: string | null;
  error?: string;
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

/** One optional corpus block of `GET /api/search?include=…`. */
export interface SearchBlock<T> { installed: boolean; total: number; results: T[] }
export interface UscSearchHit { id: string; label?: string; heading?: string; status?: string | null; usc_title: number; snippet?: string; exact?: boolean }
export interface FrSearchHit { document_number: string; type?: string | null; title?: string; abstract?: string | null; publication_date?: string | null; citation?: string | null; snippet?: string }
export interface ConstSearchHit { id: string; label?: string | null; snippet?: string; kind?: 'text' | 'annotation' }
export interface PlawSearchHit { id: string; congress: number; law_type: 'public' | 'private'; number: number; statute?: string | null; title?: string | null; approved_date?: string | null; snippet?: string | null }
export interface AgendaSearchHit { rin: string; edition: string; title?: string | null; stage?: string | null; parent_acronym?: string | null; snippet?: string }

export interface SearchResponse {
  query: string;
  title: number | string;
  total: number;
  results: SearchResultItem[];
  ms: number;
  usc?: SearchBlock<UscSearchHit>;
  fr?: SearchBlock<FrSearchHit>;
  constitution?: SearchBlock<ConstSearchHit>;
  plaw?: SearchBlock<PlawSearchHit>;
  agenda?: SearchBlock<AgendaSearchHit>;
}

export interface SearchViewState {
  query: string;
  allTitles: boolean;
  data: SearchResponse;
  view: 'compact' | 'grouped';
  /** Which framework's results are on screen; 'all' previews each one. */
  framework: 'all' | 'cfr' | 'const' | 'usc' | 'plaw' | 'fr' | 'agenda';
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
  source?: string;
  agency?: string;
  pdf_url?: string | null;
  doc_type?: string | null;
  citation?: string | null;
  action?: string | null;
  effective_on?: string | null;
  comments_close_on?: string | null;
  scheduled_on?: string | null;
  docket_ids?: string[];
  penalty_usd?: number;
  company?: string;
  city?: string;
  state?: string;
  snippet?: string;
  takeaways?: Array<{ label: string; text: string }>;
  cfr_parts?: Array<{ title: number; part: string | number }>;
  sections?: string[];
  title_num?: number;
}

export interface FrBodyResponse {
  document_number: string;
  article: NewsArticle | null;
  body_html: string | null;
  fetched_at: string | null;
  cached: boolean;
}

export interface EnforcementParaHotspot {
  para: string;
  count: number;
  share_pct?: number | null;
}

export interface EnforcementStats {
  case_count: number;
  citation_count: number;
  avg_penalty: number;
  fta_count: number;
  top_paragraphs?: EnforcementParaHotspot[];
}

export interface NewsActivityCtx {
  title?: number;
  kind: 'section' | 'part';
  id: string;
  data: { count: number; articles: NewsArticle[]; stats?: EnforcementStats };
}

export interface TransferJob {
  id: number;
  /** CFR titles 1–50; Federal Register corpus 0; U.S. Code title N is 1000 + N; the Constitution 2000. */
  title: number;
  kind: 'title' | 'part' | 'section' | 'update' | 'usc-title' | 'usc-update' | 'fr-build' | 'fr-update'
    | 'constitution-build' | 'constitution-update' | 'plaw-build' | 'plaw-update' | 'agenda-build' | 'agenda-update';
  target?: { t?: string; id?: string; part?: string; usc_title?: number } | null;
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
  id?: string;
  kind?: 'section' | 'part';
  title: number;
  sectionId?: string;
  partId?: string;
  full?: boolean;
  para?: string | null;
  unit?: string | null;
  label?: string;
  heading?: string;
  history?: SplitState[];
}

export interface ReaderTabEntry {
  id: string;
  kind: 'section' | 'part';
  title: number;
  sectionId?: string;
  partId?: string;
  unit?: string | null;
  full?: boolean;
  para?: string | null;
  label: string;
  heading?: string;
  tier?: RefTier;
  href: string;
}

export interface TabGroupRecord {
  id: string;
  name: string;
  saved_at: string;
  mainTabs: ReaderTabEntry[];
  activeMainIdx: number;
  splitTabs: SplitState[];
  activeSplitIdx: number;
  splitWide?: boolean;
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

export interface TreeFilterState {
  q: string;
  re: RegExp;
  results: number[];
}

export interface StorageSnapshot {
  titles: Array<{ title: number; bytes: number }>;
  legacy_bytes: number;
  temp_files: number;
  temp_bytes: number;
  total_bytes: number;
}

export interface NewsSourceStatus {
  enabled: boolean;
  last_ok_at?: string | null;
  next_due_at?: string | null;
  retry_after?: string | null;
  last_error?: string | null;
}

export interface NewsStatusSnapshot {
  sync_enabled: boolean;
  syncing?: boolean;
  sources: Record<string, NewsSourceStatus>;
  dol_configured: boolean;
  articles?: number;
  last_ok_at?: string | null;
}

export interface EnvKeyEntry {
  configured?: boolean;
  masked?: string;
  value?: string | number | boolean;
  default?: string;
}

export interface EnvStatusSnapshot {
  env_exists: boolean;
  env_file: string;
  keys: {
    DOL_API_KEY?: EnvKeyEntry;
    ANTHROPIC_API_KEY?: EnvKeyEntry;
    ANTHROPIC_MODEL?: EnvKeyEntry;
    NEWS_SYNC?: EnvKeyEntry;
    NEWS_RETENTION_DAYS?: EnvKeyEntry;
    [k: string]: EnvKeyEntry | undefined;
  };
}

export interface UscTitleSummary {
  title: number;
  title_name?: string;
  positive_law?: boolean;
  release_point?: string | null;
  current_through?: string | null;
  built_at?: string | null;
  section_count?: number;
  note_count?: number;
  bytes?: number;
}

export interface UscTreeNodeData {
  t: string;
  id: string;
  l?: string;
  d?: string;
  s?: string | null;
  c?: UscTreeNodeData[];
}

export interface UscNoteItem {
  category: string;
  topic?: string;
  heading?: string;
  html: string;
  text?: string;
}

export interface UscSectionData {
  id: string;
  title: number;
  label: string;
  heading: string;
  status?: string | null;
  citation: string;
  html: string;
  source_credit?: string | null;
  path: Array<{ t?: string; id?: string; l?: string; d?: string }>;
  notes: UscNoteItem[];
  prev?: { id: string; label: string; heading?: string } | null;
  next?: { id: string; label: string; heading?: string } | null;
  /** "units" for a long section read one top-level subsection at a time, else "page". */
  mode?: 'units' | 'page';
  outline?: SectionOutlineItem[];
  unit?: string | null;
  unit_prev?: SectionOutlineItem | null;
  unit_next?: SectionOutlineItem | null;
}

/** One row of `GET /api/constitution`'s outline (the Preamble, an article section, an amendment…). */
export interface ConstitutionOutlineItem {
  id: string;
  kind: 'preamble' | 'section' | 'article' | 'amendment';
  article: number | null;
  amendment: number | null;
  section: number | null;
  label: string;
  chars: number;
  note_count: number;
}

export interface ConstitutionStatus {
  installed: boolean;
  unit_count: number;
  note_count: number;
  meta: Record<string, string>;
  outline: ConstitutionOutlineItem[];
}

/** `GET /api/constitution/unit/{id}`: the text, the House Parliamentarian's annotations, prev/next ids. */
export interface ConstitutionUnitData extends Omit<ConstitutionOutlineItem, 'chars'> {
  ord: number;
  text: string;
  notes: string[];
  prev: string | null;
  next: string | null;
}

export interface UscCitedBy {
  title: number;
  section_id: string;
  citation: string;
  usc: Array<{ title: number; id: string; label: string; heading: string }>;
  cfr: Array<{ title: number; id: string; part: string; label: string; heading: string; paragraphs: string[] }>;
  authority: Array<{ title: number; part: string }>;
  count: number;
}

export interface AppState {
  currentTitle: number;
  activeCorpusId: string;
  activeCorpus: CorpusSummary | null;
  activeDesk: DeskId;
  homeTab: HomeTab;
  homeFrCat: HomeFrCat;
  homeTierFilter: 'all' | AuthorityTier;
  homeHistoryExpanded: boolean;
  homeSyncToken: number;
  corpora: CorpusSummary[];
  extraCorpora: CorpusSummary[];
  installedTitles: InstalledTitleMeta[];
  installedUscTitles: UscTitleSummary[];
  currentUscTitle: number | null;
  currentUscSection: UscSectionData | null;
  currentUscNode: string | null;
  /** The Constitution unit on screen (`#/constitution/{id}`), so Pin, ⌘D and Clip cite it. */
  currentConstUnit: ConstitutionUnitData | null;
  uscTrees: Map<number, UscTreeNodeData>;
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
  sideView: 'agencies' | 'all-parts' | number | undefined;
  treeFilterState: TreeFilterState | null | undefined;
  foldedGroups: Set<string> | undefined;
  filterTimer: ReturnType<typeof setTimeout> | null | undefined;
  newProjectOpen: boolean | undefined;
  projEditT: ReturnType<typeof setTimeout> | null | undefined;
  newsQTimer: ReturnType<typeof setTimeout> | null | undefined;
  newsActivityCtx: NewsActivityCtx | null;
  navRetracted: boolean | undefined;
  historyFor: string | undefined;
  goPending: number;
  navTransferKey: string | undefined;
  navStorage: StorageSnapshot | null | undefined;
  navNewsStatus: NewsStatusSnapshot | null | undefined;
  navEnvStatus: EnvStatusSnapshot | null | undefined;
  navLibData: { titles?: Array<{ title: number; name?: string; reserved?: boolean; latest?: string | null; amended?: string | null; installed?: { whole?: boolean; edition?: string | null } | null }> } | null;
  envModalReturnFocus: Element | null | undefined;
  envModalSnapshot: EnvStatusSnapshot | null | undefined;
  selectedText: string;
  motionLevel: MotionLevel;
  routeAbort: AbortController | null;
  splitState: SplitState | null;
  mainTabs: ReaderTabEntry[];
  activeMainTabId: string | null;
  splitTabs: SplitState[];
  activeSplitTabId: string | null;
  splitWide: boolean;
  pendingNewMainTab: boolean;
  swapMotionX: number;
  pendingDownloads: Map<number, PendingDownloadEntry>;
  peekCache: Map<string, SectionDocData>;
  graphCache: Map<string, SectionGraphData>;
  refsCache: Map<number, ReferencesResponse>;
}

export const state: AppState = {
  currentTitle: 29,
  activeCorpusId: 'us:cfr:29',
  activeCorpus: null,
  activeDesk: 'all',
  homeTab: 'overview',
  homeFrCat: 'all',
  homeTierFilter: 'all',
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
  uscTrees: new Map(),
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
  goPending: 0,
  navTransferKey: undefined,
  navStorage: undefined,
  navNewsStatus: undefined,
  navEnvStatus: undefined,
  navLibData: null,
  envModalReturnFocus: undefined,
  envModalSnapshot: undefined,
  selectedText: '',
  motionLevel: 'full',
  routeAbort: null,
  splitState: null,
  mainTabs: [],
  activeMainTabId: null,
  splitTabs: [],
  activeSplitTabId: null,
  splitWide: false,
  pendingNewMainTab: false,
  swapMotionX: 0,
  pendingDownloads: new Map(),
  peekCache: new Map(),
  graphCache: new Map(),
  refsCache: new Map(),
};
