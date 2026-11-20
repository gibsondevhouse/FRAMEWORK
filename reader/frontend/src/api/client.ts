import { state } from '../state';
import type {
  ChatConfig,
  EnvStatusSnapshot,
  HomeSnapshot,
  InstalledTitleMeta,
  JobsSnapshot,
  NewsArticle,
  ProfileInfo,
  ReferencesResponse,
  SearchResponse,
  SectionDocData,
  SectionGraphData,
  StorageSnapshot,
  TreeNode,
  UscSectionData,
  UscTitleSummary,
  UscTreeNodeData,
} from '../state';

// Centralized HTTP client, bounded LRU caches, and cache invalidation.

const MAX_PEEK_CACHE = 40;
const MAX_GRAPH_CACHE = 80;
const MAX_REFS_CACHE = 24;
const MAX_TREE_CACHE = 16;

export const titleTreeCache = new Map<number, TreeNode>();

export function setBoundedCache<K, V>(cache: Map<K, V>, key: K, val: V, max: number): V {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return val;
}

export function cachePeekSection(key: string, data: SectionDocData): SectionDocData {
  return setBoundedCache(state.peekCache, key, data, MAX_PEEK_CACHE);
}

export function cacheSectionGraph(key: string, data: SectionGraphData): SectionGraphData {
  return setBoundedCache(state.graphCache, key, data, MAX_GRAPH_CACHE);
}

export function cacheTitleRefs(titleNum: number, data: ReferencesResponse): ReferencesResponse {
  return setBoundedCache(state.refsCache, titleNum, data, MAX_REFS_CACHE);
}

export function cacheTitleTree(titleNum: number, tree: TreeNode): TreeNode {
  return setBoundedCache(titleTreeCache, titleNum, tree, MAX_TREE_CACHE);
}

export function invalidateTitleCaches(titles?: Iterable<number>): void {
  if (!titles) {
    state.peekCache.clear();
    state.graphCache.clear();
    state.refsCache.clear();
    titleTreeCache.clear();
    return;
  }
  const set = new Set<number>();
  for (const t of titles) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) set.add(n);
  }
  if (!set.size) return;

  for (const key of [...state.peekCache.keys()]) {
    if (set.has(Number(key.split('|', 1)[0]))) state.peekCache.delete(key);
  }
  for (const key of [...state.graphCache.keys()]) {
    if (set.has(Number(key.split('|', 1)[0]))) state.graphCache.delete(key);
  }
  for (const t of set) {
    state.refsCache.delete(t);
    titleTreeCache.delete(t);
  }
}

export async function getJSON<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  let body: { detail?: string } | null = null;
  try {
    body = await res.json() as { detail?: string };
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    throw new Error((body && body.detail) || `Request failed (${res.status})`);
  }
  return body as T;
}

export async function tryGetJSON<T = unknown>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export function fetchInstalledTitles(opts?: RequestInit): Promise<InstalledTitleMeta[]> {
  return getJSON<InstalledTitleMeta[]>('/api/titles', opts);
}

export async function fetchInstalledUscTitles(opts?: RequestInit): Promise<UscTitleSummary[]> {
  const res = await tryGetJSON<{ titles?: UscTitleSummary[] }>('/api/usc/titles', opts);
  return res?.titles || [];
}

export function fetchUscMeta(titleNum: number, opts?: RequestInit): Promise<UscTitleSummary | null> {
  return tryGetJSON<UscTitleSummary>(`/api/usc/${titleNum}/meta`, opts);
}

export function fetchUscTree(titleNum: number, opts?: RequestInit): Promise<UscTreeNodeData | null> {
  return tryGetJSON<UscTreeNodeData>(`/api/usc/${titleNum}/tree`, opts);
}

export function fetchUscSection(titleNum: number, sectionId: string, opts?: RequestInit): Promise<UscSectionData> {
  return getJSON<UscSectionData>(`/api/usc/${titleNum}/section/${encodeURIComponent(sectionId)}`, opts);
}

export function fetchTitlesSnapshot(opts?: RequestInit): Promise<HomeSnapshot | null> {
  return tryGetJSON<HomeSnapshot>('/api/titles/snapshot', opts);
}

export function fetchProfiles(opts?: RequestInit): Promise<{ profiles: ProfileInfo[]; title_names: Record<string, string> }> {
  return getJSON('/api/profiles', opts);
}

export function fetchTitleMeta(titleNum: number, opts?: RequestInit): Promise<InstalledTitleMeta> {
  return getJSON(`/api/${titleNum}/meta`, opts);
}

export async function fetchTitleTree(titleNum: number, opts?: RequestInit): Promise<TreeNode> {
  const res = await fetch(`/api/${titleNum}/tree`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tree = await res.json() as TreeNode;
  cacheTitleTree(titleNum, tree);
  return tree;
}

export function fetchSectionRaw(titleNum: number, sectionId: string, unitQs = '', opts?: RequestInit): Promise<Response> {
  return fetch(`/api/${titleNum}/section/${encodeURIComponent(sectionId)}${unitQs}`, opts);
}

export async function fetchSectionCached(
  titleNum: number,
  sectionId: string,
  unitQs = '?unit=',
  cacheKey?: string,
  opts?: RequestInit,
): Promise<SectionDocData | null> {
  const key = cacheKey ?? `${titleNum}|${sectionId}|${unitQs === '' ? 'full' : unitQs.replace(/^\?unit=/, '')}`;
  const hit = state.peekCache.get(key);
  if (hit) return hit;
  const res = await fetchSectionRaw(titleNum, sectionId, unitQs, opts);
  if (!res.ok) return null;
  const data = await res.json() as SectionDocData;
  cachePeekSection(key, data);
  return data;
}

export async function fetchSectionGraph(titleNum: number, sectionId: string, opts?: RequestInit): Promise<SectionGraphData | null> {
  const key = `${titleNum}|${sectionId}`;
  const hit = state.graphCache.get(key);
  if (hit) return hit;
  const data = await tryGetJSON<SectionGraphData>(`/api/${titleNum}/citations/${encodeURIComponent(sectionId)}`, opts);
  if (data) cacheSectionGraph(key, data);
  return data;
}

export async function fetchTitleReferences(titleNum: number, opts?: RequestInit): Promise<ReferencesResponse | null> {
  const hit = state.refsCache.get(titleNum);
  if (hit) return hit;
  const data = await tryGetJSON<ReferencesResponse>(`/api/${titleNum}/references`, opts);
  if (data) cacheTitleRefs(titleNum, data);
  return data;
}

export function fetchPartFront(titleNum: number, partId: string, opts?: RequestInit): Promise<Response> {
  return fetch(`/api/${titleNum}/part/${encodeURIComponent(partId)}`, opts);
}

export function fetchPartFull(titleNum: number, partId: string, opts?: RequestInit): Promise<Response> {
  return fetch(`/api/${titleNum}/part/${encodeURIComponent(partId)}/full`, opts);
}

export function fetchSearchResults(
  titleNum: number | 'all',
  query: string,
  limit = 100,
  opts?: RequestInit,
): Promise<SearchResponse> {
  const url = titleNum === 'all'
    ? `/api/search?q=${encodeURIComponent(query)}&title=all&limit=${limit}`
    : `/api/${titleNum}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  return getJSON<SearchResponse>(url, opts);
}

export function fetchLibraryCatalog(title?: number | null, part?: string | null, opts?: RequestInit): Promise<unknown> {
  const url = part && title
    ? `/api/library/${title}/part/${encodeURIComponent(part)}`
    : title
      ? `/api/library/${title}`
      : '/api/library';
  return getJSON(url, opts);
}

export function fetchLibraryJobs(opts?: RequestInit): Promise<JobsSnapshot> {
  return getJSON<JobsSnapshot>('/api/library/jobs', opts);
}

export function fetchLibraryStorage(opts?: RequestInit): Promise<StorageSnapshot> {
  return getJSON<StorageSnapshot>('/api/library/storage', opts);
}

export function fetchEnvSettings(opts?: RequestInit): Promise<EnvStatusSnapshot> {
  return getJSON<EnvStatusSnapshot>('/api/settings/env', opts);
}

export function fetchTitleModels(titleNum: number, opts?: RequestInit): Promise<ChatConfig | null> {
  return tryGetJSON<ChatConfig>(`/api/${titleNum}/models`, opts);
}

export function fetchNewsPreview(limit = 3, opts?: RequestInit): Promise<{ articles?: NewsArticle[] } | null> {
  return tryGetJSON<{ articles?: NewsArticle[] }>(`/api/news?limit=${limit}`, opts);
}
