import { state } from '../state';
import type { JobsSnapshot } from '../state';
import { emit } from '../core/events';
import { plural, showToast } from '../dom';
import { fetchLibraryJobs, getJSON, invalidateTitleCaches } from './client';

// Background library download job polling & queue actions.

let titleRefresher: ((changed: number[]) => Promise<void>) | null = null;

export function registerTitleRefresher(fn: (changed: number[]) => Promise<void>): void {
  titleRefresher = fn;
}

export function setJobs(snapshot: JobsSnapshot | null | undefined): void {
  if (!snapshot) return;
  state.jobs = snapshot;
  for (const j of [state.jobs.current, ...state.jobs.queued]) {
    if (j) state.jobsSeenActive.add(j.id);
  }
  emit('jobs:updated', snapshot);
  document.dispatchEvent(new CustomEvent('framework:jobs-updated', { detail: { snap: snapshot } }));
}

export function pollJobsIfActive(): void {
  if ((state.jobs.current || state.jobs.queued.length) && !state.jobsTimer) {
    state.jobsTimer = setTimeout(pollJobs, 700);
  }
}

export async function pollJobs(): Promise<void> {
  if (state.jobsTimer) {
    clearTimeout(state.jobsTimer);
    state.jobsTimer = null;
  }
  let snap: JobsSnapshot;
  try {
    snap = await fetchLibraryJobs();
  } catch {
    state.jobsTimer = setTimeout(pollJobs, 3000);
    return;
  }
  const before = new Set(state.jobsSeenActive);
  setJobs(snap);
  const finished = snap.recent.filter(j => before.has(j.id));
  for (const j of finished) {
    state.jobsSeenActive.delete(j.id);
    if (j.state === 'error') showToast(`${j.label}: ${j.error}`, 6000);
    else if (j.state === 'cancelled') showToast(`Cancelled ${j.label}`);
    else showToast(j.phase === 'Already installed' ? `${j.label} is already installed` : `Downloaded ${j.label}`);
  }
  const doneTitles = finished.filter(j => j.state === 'done').map(j => j.title);
  if (doneTitles.length) {
    invalidateTitleCaches(doneTitles);
    if (titleRefresher) await titleRefresher(doneTitles);
  }
  if (finished.length) {
    state.navStorage = null;
    emit('jobs:finished', { finished, snap });
    document.dispatchEvent(new CustomEvent('framework:jobs-finished', { detail: { finished, snap } }));
  }
  pollJobsIfActive();
}

export async function queueBatch(url: string, body: unknown, emptyMsg: string): Promise<void> {
  const res = await getJSON<{ queued?: Array<{ id: number }>; count?: number }>(
    url,
    body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'POST' },
  );
  for (const j of res.queued || []) state.jobsSeenActive.add(j.id);
  showToast(res.count ? `Queued ${plural(res.count, 'title')}` : emptyMsg);
  await pollJobs();
}
