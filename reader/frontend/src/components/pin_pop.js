import { state } from '../state';
import { createPopover } from './popover';
import { escapeHtml, icon, isMac } from '../dom';
import { dom } from '../state_init';
import { createProject, currentSectionRef, loadProjects, projDot, projectsWith, togglePin } from '../views/projects';

// --- Pin popover (the section page's Pin button, or ⌘D) ---
export const pinPop = document.getElementById('pin-pop');

export function pinButtonHtml() {
  const n = state.currentSection ? projectsWith(state.currentTitle, state.currentSection.id).length : 0;
  return `<button type="button" class="btn${n ? ' is-pinned' : ''}" id="btn-pin" aria-haspopup="dialog" aria-expanded="false" title="Pin to a workspace (${isMac ? '⌘' : 'Ctrl '}D)">${icon(n ? 'bookmarkFilled' : 'bookmark')} ${n ? 'Pinned' : 'Pin'}</button>`;
}

export function updatePinButton() {
  const b = document.getElementById('btn-pin');
  if (b) b.outerHTML = pinButtonHtml();
}


export function renderPinMenu() {
  const sec = currentSectionRef();
  if (!sec) return;
  const list = loadProjects();
  pinPop.innerHTML = `<div class="pin-head">
      <span>Pin <strong>${escapeHtml(sec.label)}</strong> to</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close pin menu">${icon('close')}</button>
    </div>
    ${list.length ? `<div class="pin-list" role="group" aria-label="Workspaces">${list.map(p => {
      const on = p.sections.some(s => s.title === sec.title && s.id === sec.id);
      return `<button type="button" class="pin-opt" role="menuitemcheckbox" aria-checked="${on}" data-proj="${escapeHtml(p.id)}">
        <span class="pin-check">${on ? icon('check') : ''}</span>${projDot(p)}<span class="pin-name">${escapeHtml(p.name)}</span><span class="pin-count">${p.sections.length}</span></button>`;
    }).join('')}</div>` : '<p class="pin-none">No workspaces yet. Name one to start.</p>'}
    <form class="pin-new"><input class="dr-input" name="name" placeholder="New workspace…" maxlength="80" autocomplete="off" aria-label="New workspace name"></form>`;
}


const pinCtrl = createPopover({
  el: pinPop,
  triggerSelector: '#btn-pin',
});

export function openPinMenu() {
  if (!state.currentSection) return;
  renderPinMenu();
  const btn = document.getElementById('btn-pin');
  pinCtrl.open(btn, null, {
    focusSelector: '.pin-opt, .pin-new input',
    returnFocus: btn || document.activeElement,
  });
}

export function closePinMenu(returnFocus = true) {
  pinCtrl.close(returnFocus);
}


pinPop.addEventListener('click', (e) => {
  if (e.target.closest('[data-pop-close]')) {
    closePinMenu(true);
    return;
  }
  const opt = e.target.closest('.pin-opt');
  if (!opt) return;
  togglePin(opt.dataset.proj, currentSectionRef());
  const focusId = opt.dataset.proj;
  renderPinMenu();
  pinCtrl.reposition(document.getElementById('btn-pin'));
  pinPop.querySelector(`.pin-opt[data-proj="${focusId}"]`)?.focus();
});

pinPop.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  if (!name) return;
  const p = createProject(name);
  togglePin(p.id, currentSectionRef());
  renderPinMenu();
  pinCtrl.reposition(document.getElementById('btn-pin'));
  pinPop.querySelector(`.pin-opt[data-proj="${p.id}"]`)?.focus();
});

pinPop.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePinMenu(true); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...pinPop.querySelectorAll('.pin-opt, input')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  e.preventDefault();
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
});

dom.view.addEventListener('click', (e) => {
  if (e.target.closest('#btn-pin')) pinPop.hidden ? openPinMenu() : closePinMenu();
});
