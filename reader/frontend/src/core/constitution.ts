import { ConstitutionStatus, state, TransferJob } from '../state';
import { getJSON } from '../api/client';
import { on } from './events';

// --- The U.S. Constitution: shared data, names, links and citations ---
// One small corpus (`GET /api/constitution`): the Library tab, the reader (#/constitution/…),
// Home's framework strip and the rail all read the same cached status.

export const CONST_JOB_KEY = 2000;
export const CONST_START_HREF = '#/constitution/';
export const CONST_LIB_HREF = '#/library/constitution';
export const constHref = (id: string): string => `#/constitution/${encodeURIComponent(id)}`;

export * from './constitution_text';

let cache: { at: number; data: ConstitutionStatus } | null = null;
const TTL_MS = 60_000;

export const constCached = (): ConstitutionStatus | null => cache?.data || null;

/** `GET /api/constitution` (status + outline), cached for a minute; `force` refetches. */
export async function fetchConstitution({ force = false } = {}): Promise<ConstitutionStatus | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const data = await getJSON<ConstitutionStatus>('/api/constitution');
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data || null;
  }
}

export const isConstJob = (j: TransferJob | null | undefined): boolean =>
  Boolean(j && (j.title === CONST_JOB_KEY || String(j.kind || '').startsWith('constitution')));

export const constJob = (): TransferJob | null =>
  [state.jobs?.current, ...(state.jobs?.queued || [])].find(isConstJob) || null;

// A finished download or update changes the status; the next reader asks again.
on('jobs:finished', () => { cache = null; });
