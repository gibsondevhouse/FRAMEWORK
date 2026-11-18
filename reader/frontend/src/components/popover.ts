import type { RefTier } from '../state';

// Shared collision-aware popover engine: viewport clamping & flipping, outside-click,
// Escape dismissal, focus restoration, and mutual exclusion between floating popovers.

export type PopoverPlacement = 'auto' | 'top' | 'bottom';

export interface AnchorBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export type PopoverAnchor = Element | AnchorBox | null | undefined;

export interface PopoverOpenOptions {
  closeOthers?: boolean;
  interactive?: boolean;
  returnFocus?: Element | null;
  refTier?: RefTier | string;
  offset?: number;
  placement?: PopoverPlacement;
  padding?: number;
  focusSelector?: string;
}

export interface PopoverOptions {
  el?: HTMLElement | null;
  triggerSelector?: string | null;
  placement?: PopoverPlacement;
  offset?: number;
  padding?: number;
  closeOnRoute?: boolean;
  scrollContainer?: Element | null;
  onOpen?: ((el: HTMLElement, anchor: PopoverAnchor) => void) | null;
  onClose?: ((el: HTMLElement, anchor: PopoverAnchor) => void) | null;
}

export interface PopoverController {
  el: HTMLElement | null;
  isOpen: () => boolean;
  isInteractive: () => boolean;
  getAnchor: () => PopoverAnchor;
  setInteractive: (next: boolean) => void;
  reposition: (anchor?: PopoverAnchor) => void;
  open: (anchor: PopoverAnchor, content?: string | ((el: HTMLElement) => void) | null, opts?: PopoverOpenOptions) => void;
  close: (returnFocus?: boolean) => void;
}

const activePopovers = new Set<PopoverController>();
const customClosers = new Set<(returnFocus?: boolean) => void>();

export function registerPopoverCloser(fn: (returnFocus?: boolean) => void): () => boolean {
  customClosers.add(fn);
  return () => customClosers.delete(fn);
}

export function closeAllPopovers(except: PopoverController | ((returnFocus?: boolean) => void) | null = null, returnFocus = false): void {
  for (const ctrl of [...activePopovers]) {
    if (ctrl !== except && ctrl.isOpen()) ctrl.close(returnFocus);
  }
  for (const fn of [...customClosers]) {
    if (fn !== except) fn(false);
  }
}

function getAnchorRect(anchor: PopoverAnchor): AnchorBox {
  if (!anchor) {
    return {
      left: Math.max(8, window.innerWidth / 2 - 140),
      right: Math.min(window.innerWidth - 8, window.innerWidth / 2 + 140),
      top: 120,
      bottom: 120,
      width: 280,
      height: 0,
    };
  }
  if ('getBoundingClientRect' in anchor && typeof anchor.getBoundingClientRect === 'function') {
    return anchor.getBoundingClientRect();
  }
  return anchor as AnchorBox;
}

export function positionPopover(
  el: HTMLElement | null | undefined,
  anchor: PopoverAnchor,
  { offset = 6, placement = 'auto', padding = 10 }: { offset?: number; placement?: PopoverPlacement; padding?: number } = {},
): void {
  if (!el) return;
  const r = getAnchorRect(anchor);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const below = r.bottom + offset;
  const above = r.top - offset - h;
  const preferTop = placement === 'top'
    || (placement === 'auto' && below + h > vh - padding && (above >= padding || r.top > vh - r.bottom));

  const rawTop = preferTop ? above : below;
  const top = Math.max(padding, Math.min(rawTop, Math.max(padding, vh - h - padding)));
  const left = Math.max(padding, Math.min(r.left, Math.max(padding, vw - w - padding)));

  el.style.transformOrigin = preferTop ? 'bottom left' : 'top left';
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

export function createPopover({
  el = null,
  triggerSelector = null,
  placement = 'auto',
  offset = 6,
  padding = 10,
  closeOnRoute = true,
  scrollContainer = null,
  onOpen = null,
  onClose = null,
}: PopoverOptions = {}): PopoverController {
  let currentAnchor: PopoverAnchor = null;
  let returnFocusEl: Element | null = null;
  let interactive = true;
  let outsideBound = false;
  let bindTimer: ReturnType<typeof setTimeout> | null = null;

  function setExpanded(trigger: PopoverAnchor, expanded: boolean): void {
    if (trigger && trigger instanceof Element && trigger.hasAttribute('aria-expanded')) {
      trigger.setAttribute('aria-expanded', String(expanded));
    }
  }

  function onOutsidePointerDown(e: Event): void {
    if (!el || el.hidden) return;
    const t = e.target as Node | null;
    if (!t) return;
    if (el.contains(t)) return;
    if (triggerSelector && t instanceof Element && t.closest(triggerSelector)) return;
    if (currentAnchor instanceof Element && currentAnchor.contains(t)) return;
    ctrl.close(false);
  }

  function onDocumentKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && el && !el.hidden) {
      e.preventDefault();
      e.stopPropagation();
      ctrl.close(true);
    }
  }

  function onContainerScroll(): void {
    if (!el || el.hidden) return;
    if (!interactive) ctrl.close(false);
  }

  function cleanupListeners(): void {
    if (bindTimer !== null) clearTimeout(bindTimer);
    bindTimer = null;
    if (outsideBound) {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      if (scrollContainer) scrollContainer.removeEventListener('scroll', onContainerScroll);
      outsideBound = false;
    }
  }

  const ctrl: PopoverController = {
    el,
    isOpen: () => Boolean(el && !el.hidden),
    isInteractive: () => interactive,
    getAnchor: () => currentAnchor,
    setInteractive(next: boolean): void {
      interactive = Boolean(next);
    },
    reposition(anchor: PopoverAnchor = currentAnchor): void {
      if (!el || el.hidden) return;
      if (anchor) currentAnchor = anchor;
      positionPopover(el, currentAnchor, { offset, placement, padding });
    },
    open(anchor, content, opts = {}): void {
      if (!el) return;
      const closeOthers = opts.closeOthers !== false;
      if (closeOthers) closeAllPopovers(ctrl, false);

      interactive = opts.interactive !== false;
      currentAnchor = anchor || null;
      returnFocusEl = opts.returnFocus !== undefined
        ? opts.returnFocus
        : (anchor instanceof Element ? anchor : document.activeElement);

      if (typeof content === 'string') el.innerHTML = content;
      else if (typeof content === 'function') content(el);

      if (opts.refTier) el.dataset.refTier = opts.refTier;
      else delete el.dataset.refTier;
      el.hidden = false;
      el.classList.toggle('is-peek', !interactive);
      positionPopover(el, currentAnchor, {
        offset: opts.offset ?? offset,
        placement: opts.placement ?? placement,
        padding: opts.padding ?? padding,
      });

      if (currentAnchor instanceof Element) setExpanded(currentAnchor, true);

      cleanupListeners();
      bindTimer = setTimeout(() => {
        if (!el || el.hidden) return;
        document.addEventListener('pointerdown', onOutsidePointerDown, true);
        document.addEventListener('keydown', onDocumentKeydown, true);
        if (scrollContainer) scrollContainer.addEventListener('scroll', onContainerScroll, { passive: true });
        outsideBound = true;
      }, 0);

      if (opts.focusSelector) {
        el.querySelector<HTMLElement>(opts.focusSelector)?.focus?.({ preventScroll: true });
      }
      if (onOpen) onOpen(el, currentAnchor);
    },
    close(returnFocus = true): void {
      if (!el || el.hidden) return;
      el.hidden = true;
      delete el.dataset.refTier;
      el.classList.remove('is-peek');
      cleanupListeners();
      const prevAnchor = currentAnchor;
      const prevReturn = returnFocusEl;
      currentAnchor = null;
      returnFocusEl = null;
      if (prevAnchor instanceof Element) setExpanded(prevAnchor, false);
      if (onClose) onClose(el, prevAnchor);
      if (returnFocus && prevReturn && 'focus' in prevReturn && typeof (prevReturn as HTMLElement).focus === 'function') {
        (prevReturn as HTMLElement).focus({ preventScroll: true });
      }
    },
  };

  activePopovers.add(ctrl);
  if (closeOnRoute && typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => ctrl.close(false));
  }
  return ctrl;
}
