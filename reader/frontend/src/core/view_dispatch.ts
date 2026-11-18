import { dom } from '../state_init';

export type ViewEventType = 'click' | 'input' | 'change' | 'keydown';
export type ViewHandler<E extends Event = Event> = (e: E) => void | Promise<void>;

const handlers: Record<ViewEventType, ViewHandler[]> = {
  click: [],
  input: [],
  change: [],
  keydown: [],
};

let initialized = false;

function ensureBound(): void {
  if (initialized || typeof document === 'undefined' || !dom.view) return;
  initialized = true;
  (Object.keys(handlers) as ViewEventType[]).forEach((type) => {
    dom.view!.addEventListener(type, (e) => {
      for (const fn of handlers[type]) fn(e);
    });
  });
}

/**
 * Register a delegated handler on `#view` backed by one shared root listener per event type.
 */
export function onView<E extends Event = Event>(
  type: ViewEventType,
  handler: ViewHandler<E>,
): () => void {
  ensureBound();
  const list = handlers[type];
  list.push(handler as ViewHandler);
  return () => {
    const idx = list.indexOf(handler as ViewHandler);
    if (idx !== -1) list.splice(idx, 1);
  };
}
