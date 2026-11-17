// Shared collision-aware popover engine: viewport clamping & flipping, outside-click,
// Escape dismissal, focus restoration, and mutual exclusion between floating popovers.
const activePopovers = new Set();
const customClosers = new Set();

export function registerPopoverCloser(fn) {
  customClosers.add(fn);
  return () => customClosers.delete(fn);
}

export function closeAllPopovers(except = null, returnFocus = false) {
  for (const ctrl of [...activePopovers]) {
    if (ctrl !== except && ctrl.isOpen()) ctrl.close(returnFocus);
  }
  for (const fn of [...customClosers]) {
    if (fn !== except) fn(false);
  }
}

function getAnchorRect(anchor) {
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
  return typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
}

export function positionPopover(el, anchor, { offset = 6, placement = 'auto', padding = 10 } = {}) {
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
  el,
  triggerSelector = null,
  placement = 'auto',
  offset = 6,
  padding = 10,
  closeOnRoute = true,
  scrollContainer = null,
  onOpen = null,
  onClose = null,
} = {}) {
  let currentAnchor = null;
  let returnFocusEl = null;
  let interactive = true;
  let outsideBound = false;
  let bindTimer = null;

  function setExpanded(trigger, expanded) {
    if (trigger && trigger instanceof Element && trigger.hasAttribute('aria-expanded')) {
      trigger.setAttribute('aria-expanded', String(expanded));
    }
  }

  function onOutsidePointerDown(e) {
    if (!el || el.hidden) return;
    if (el.contains(e.target)) return;
    if (triggerSelector && e.target.closest?.(triggerSelector)) return;
    if (currentAnchor instanceof Element && currentAnchor.contains(e.target)) return;
    ctrl.close(false);
  }

  function onDocumentKeydown(e) {
    if (e.key === 'Escape' && el && !el.hidden) {
      e.preventDefault();
      e.stopPropagation();
      ctrl.close(true);
    }
  }

  function onContainerScroll() {
    if (!el || el.hidden) return;
    if (!interactive) ctrl.close(false);
  }

  function cleanupListeners() {
    clearTimeout(bindTimer);
    bindTimer = null;
    if (outsideBound) {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      if (scrollContainer) scrollContainer.removeEventListener('scroll', onContainerScroll);
      outsideBound = false;
    }
  }

  const ctrl = {
    el,
    isOpen: () => Boolean(el && !el.hidden),
    isInteractive: () => interactive,
    getAnchor: () => currentAnchor,
    setInteractive(next) {
      interactive = Boolean(next);
    },
    reposition(anchor = currentAnchor) {
      if (!el || el.hidden) return;
      if (anchor) currentAnchor = anchor;
      positionPopover(el, currentAnchor, { offset, placement, padding });
    },
    open(anchor, content, opts = {}) {
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
        el.querySelector(opts.focusSelector)?.focus?.({ preventScroll: true });
      }
      if (onOpen) onOpen(el, currentAnchor);
    },
    close(returnFocus = true) {
      if (!el || el.hidden) return;
      el.hidden = true;
      el.classList.remove('is-peek');
      cleanupListeners();
      const prevAnchor = currentAnchor;
      const prevReturn = returnFocusEl;
      currentAnchor = null;
      returnFocusEl = null;
      if (prevAnchor instanceof Element) setExpanded(prevAnchor, false);
      if (onClose) onClose(el, prevAnchor);
      if (returnFocus && prevReturn && typeof prevReturn.focus === 'function') {
        prevReturn.focus({ preventScroll: true });
      }
    },
  };

  activePopovers.add(ctrl);
  if (closeOnRoute) {
    window.addEventListener('hashchange', () => ctrl.close(false));
  }
  return ctrl;
}
