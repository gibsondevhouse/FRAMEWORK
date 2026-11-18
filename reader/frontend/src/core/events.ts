// Lightweight typed event bus breaking circular imports between router, nav, panels, and views.

export interface AppEvents {
  'route:refresh': undefined;
  'title:switched': { title: number };
  'titles:refreshed': { hadNone: boolean; changed: number[]; list: Array<{ title: number }> };
  'jobs:updated': { current: unknown; queued: unknown[]; recent: unknown[] };
  'jobs:finished': { finished: Array<{ id: number; title: number; state: string; label?: string }>; snap: unknown };
  'projects:changed': { quiet?: boolean };
  'nav:panel-opened': { panel: string };
  'nav:mode-changed': undefined;
  'nav:new-project': undefined;
  'pin:open': undefined;
  'tabs:save-group': { anchor: HTMLElement };
  'env:saved': undefined;
  'models:updated': undefined;
  'news:refresh': undefined;
  'split:open': {
    kind?: 'section' | 'part';
    title: number;
    sectionId?: string | null;
    partId?: string | null;
    full?: boolean;
    para?: string | null;
    unit?: string | null;
    pushHistory?: boolean;
    newTab?: boolean;
  };
}

type Handler<T> = (payload: T) => void;

const listeners = new Map<keyof AppEvents, Set<Handler<never>>>();

export function on<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as Handler<never>);
  return () => {
    set?.delete(handler as Handler<never>);
  };
}

export function emit<K extends keyof AppEvents>(
  event: K,
  ...args: AppEvents[K] extends undefined ? [] : [AppEvents[K]]
): void {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;
  const payload = args[0] as AppEvents[K];
  for (const fn of [...set]) {
    try {
      (fn as Handler<AppEvents[K]>)(payload);
    } catch (err) {
      console.error(`[events:${String(event)}]`, err);
    }
  }
}
