import { state } from '../state';
import { escapeHtml, icon, isMac } from '../dom';
import { dom } from '../state_init';
import { createProject, currentSectionRef, loadProjects, projDot, projectsWith, togglePin } from '../views/projects';

// --- Pin popover (the section page's Pin button, or ⌘D) ---
export const pinPop = document.getElementById('pin-pop');

export function pinButtonHtml() {
  const n = state.currentSection ? projectsWith(state.currentTitle, state.currentSection.id).length : 0;
  return `<button type="button" class="btn${n ? ' is-pinned' : ''}" id="btn-pin" aria-haspopup="dialog" aria-expanded="false" title="Pin to a project (${isMac ? '⌘' : 'Ctrl '}D)">${icon(n ? 'bookmarkFilled' : 'bookmark')} ${n ? 'Pinned' : 'Pin'}</button>`;
}

export function updatePinButton() {
  const b = document.getElementById('btn-pin');
  if (b) b.outerHTML = pinButtonHtml();
}


export function renderPinMenu() {
  const sec = currentSectionRef();
  if (!sec) return;
  const list = loadProjects();
  pinPop.innerHTML = `<div class="pin-head">Pin <strong>${escapeHtml(sec.label)}</strong> to</div>
    ${list.length ? `<div class="pin-list" role="group" aria-label="Dossiers">${list.map(p => {
      const on = p.sections.some(s => s.title === sec.title && s.id === sec.id);
      return `<button type="button" class="pin-opt" role="menuitemcheckbox" aria-checked="${on}" data-proj="${escapeHtml(p.id)}">
        <span class="pin-check">${on ? icon('check') : ''}</span>${projDot(p)}<span class="pin-name">${escapeHtml(p.name)}</span><span class="pin-count">${p.sections.length}</span></button>`;
    }).join('')}</div>` : '<p class="pin-none">No dossiers yet. Name one to start.</p>'}
    <form class="pin-new"><input class="dr-input" name="name" placeholder="New dossier…" maxlength="80" autocomplete="off" aria-label="New dossier name"></form>`;
}


export function openPinMenu() {
  if (!state.currentSection) return;
  renderPinMenu();
  pinPop.hidden = false;
  const btn = document.getElementById('btn-pin');
  const r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth / 2 - 140, bottom: 120 };
  const w = pinPop.offsetWidth;
  pinPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pinPop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pinPop.offsetHeight - 8)}px`;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  (pinPop.querySelector('.pin-opt') || pinPop.querySelector('input'))?.focus();
  setTimeout(() => document.addEventListener('pointerdown', onPinOutside), 0);
}

export function closePinMenu(returnFocus = true) {
  if (pinPop.hidden) return;
  pinPop.hidden = true;
  document.removeEventListener('pointerdown', onPinOutside);
  const btn = document.getElementById('btn-pin');
  if (btn) { btn.setAttribute('aria-expanded', 'false'); if (returnFocus) btn.focus(); }
}

export function onPinOutside(e) {
  if (!pinPop.contains(e.target) && !e.target.closest('#btn-pin')) closePinMenu(false);
}


pinPop.addEventListener('click', (e) => {
  const opt = e.target.closest('.pin-opt');
  if (!opt) return;
  togglePin(opt.dataset.proj, currentSectionRef());
  const focusId = opt.dataset.proj;
  renderPinMenu();
  pinPop.querySelector(`.pin-opt[data-proj="${focusId}"]`)?.focus();
});

pinPop.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  if (!name) return;
  const p = createProject(name);
  togglePin(p.id, currentSectionRef());
  renderPinMenu();
  pinPop.querySelector(`.pin-opt[data-proj="${p.id}"]`)?.focus();
});

pinPop.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closePinMenu(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...pinPop.querySelectorAll('.pin-opt, input')];
  const i = items.indexOf(document.activeElement);
  e.preventDefault();
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
});

dom.view.addEventListener('click', (e) => {
  if (e.target.closest('#btn-pin')) pinPop.hidden ? openPinMenu() : closePinMenu();
});

window.addEventListener('hashchange', () => closePinMenu(false));
