import { state } from '../state';
import { createPopover } from './popover';
import { escapeHtml, icon, isMac } from '../dom';
import { buildTabGroupSnapshot, suggestTabGroupName } from './reader_tabs';
import { dom } from '../state_init';
import { addTabGroupToWorkspace, createProject, currentSectionRef, loadProjects, projDot, projectsWith, togglePin } from '../views/projects';

// --- Pin popover (and Save Tab Group menu in #pin-pop) ---
export const pinPop = document.getElementById('pin-pop');
let pinTargetOverride = null;
let pinAnchorOverride = null;
let pinPopMode = 'pin'; // 'pin' | 'tabgroup'

function activePinSection() {
  return pinTargetOverride || currentSectionRef();
}

export function pinButtonHtml(secRef = null, id = 'btn-pin') {
  const t = secRef ? secRef.title : state.currentTitle;
  const sId = secRef ? secRef.id : state.currentSection?.id;
  const n = sId ? projectsWith(t, sId).length : 0;
  const cls = id === 'btn-pin' ? 'btn' : 'btn btn-small';
  return `<button type="button" class="${cls}${n ? ' is-pinned' : ''}" id="${id}" aria-haspopup="dialog" aria-expanded="false" title="Pin to a workspace (${isMac ? '⌘' : 'Ctrl '}D)">${icon(n ? 'bookmarkFilled' : 'bookmark')} ${n ? 'Pinned' : 'Pin'}</button>`;
}

export function updatePinButton() {
  const b = document.getElementById('btn-pin');
  if (b) b.outerHTML = pinButtonHtml();
  const sb = document.getElementById('split-btn-pin');
  if (sb && state.splitState?.sectionId) {
    sb.outerHTML = pinButtonHtml({ title: state.splitState.title, id: state.splitState.sectionId }, 'split-btn-pin');
  }
}


export function renderPinMenu() {
  const sec = activePinSection();
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
  triggerSelector: '#btn-pin, #split-btn-pin, [data-tabs-act="save-group"], [data-split-tabs-act="save-group"]',
  onClose: () => {
    pinTargetOverride = null;
    pinAnchorOverride = null;
    pinPopMode = 'pin';
  },
});

function renderSaveGroupMenu(initialName = '') {
  const list = loadProjects();
  const mainCount = state.mainTabs.length;
  const splitCount = state.splitTabs.length;
  const counts = `${mainCount} main${splitCount ? ` + ${splitCount} side-by-side` : ''}`;
  const groupName = initialName || suggestTabGroupName();
  pinPop.innerHTML = `<div class="pin-head">
      <span>Save <strong>${escapeHtml(counts)}</strong> tab group</span>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close save tab group menu">${icon('close')}</button>
    </div>
    <div class="pin-group-field">
      <input class="dr-input" id="pin-group-name" value="${escapeHtml(groupName)}" placeholder="Research path name…" maxlength="80" autocomplete="off" aria-label="Tab group name">
    </div>
    ${list.length ? `<div class="pin-list" role="group" aria-label="Choose workspace">${list.map(p => {
      const grpCount = (p.tab_groups || []).length;
      return `<button type="button" class="pin-opt" data-save-group-proj="${escapeHtml(p.id)}">
        <span class="pin-check">${icon('folder')}</span>${projDot(p)}<span class="pin-name">${escapeHtml(p.name)}</span><span class="pin-count">${grpCount ? `${grpCount} grp` : p.sections.length}</span></button>`;
    }).join('')}</div>` : '<p class="pin-none">No workspaces yet. Name one below to save this research path.</p>'}
    <form class="pin-new"><input class="dr-input" name="name" placeholder="New workspace…" maxlength="80" autocomplete="off" aria-label="New workspace name and save"></form>`;
}

export function openSaveTabGroupMenu(anchorEl) {
  if (!anchorEl) return;
  if (!pinPop.hidden && pinPopMode === 'tabgroup' && pinAnchorOverride === anchorEl) {
    closePinMenu(true);
    return;
  }
  pinPopMode = 'tabgroup';
  pinTargetOverride = null;
  pinAnchorOverride = anchorEl;
  renderSaveGroupMenu();
  pinCtrl.open(anchorEl, null, {
    focusSelector: '#pin-group-name, .pin-opt',
    returnFocus: anchorEl,
  });
}

export function openPinMenu(anchorEl = null, customRef = null) {
  const sec = customRef || currentSectionRef();
  if (!sec) return;
  pinPopMode = 'pin';
  pinTargetOverride = customRef || null;
  const btn = anchorEl || document.getElementById('btn-pin');
  pinAnchorOverride = btn;
  renderPinMenu();
  pinCtrl.open(btn, null, {
    focusSelector: '.pin-opt, .pin-new input',
    returnFocus: btn || document.activeElement,
  });
}

export function toggleSplitPinMenu(anchorEl, customRef) {
  if (!pinPop.hidden && pinTargetOverride?.id === customRef?.id && pinTargetOverride?.title === customRef?.title) {
    closePinMenu(true);
  } else {
    openPinMenu(anchorEl, customRef);
  }
}

export function closePinMenu(returnFocus = true) {
  pinCtrl.close(returnFocus);
}


pinPop.addEventListener('click', (e) => {
  if (e.target.closest('[data-pop-close]')) {
    closePinMenu(true);
    return;
  }
  const saveProjBtn = e.target.closest('[data-save-group-proj]');
  if (saveProjBtn && pinPopMode === 'tabgroup') {
    const grpName = pinPop.querySelector('#pin-group-name')?.value || '';
    const snapshot = buildTabGroupSnapshot(grpName);
    addTabGroupToWorkspace(saveProjBtn.dataset.saveGroupProj, snapshot);
    closePinMenu(true);
    return;
  }
  const opt = e.target.closest('.pin-opt');
  if (!opt) return;
  const sec = activePinSection();
  if (!sec) return;
  const targetAnchor = pinAnchorOverride?.isConnected ? pinAnchorOverride : document.getElementById(pinAnchorOverride?.id || 'btn-pin');
  togglePin(opt.dataset.proj, sec);
  const focusId = opt.dataset.proj;
  renderPinMenu();
  pinCtrl.reposition(targetAnchor);
  pinPop.querySelector(`.pin-opt[data-proj="${focusId}"]`)?.focus();
});

pinPop.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = e.target.elements.name.value.trim();
  if (!name) return;
  if (pinPopMode === 'tabgroup') {
    const grpName = pinPop.querySelector('#pin-group-name')?.value || '';
    const p = createProject(name);
    addTabGroupToWorkspace(p.id, buildTabGroupSnapshot(grpName));
    closePinMenu(true);
    return;
  }
  const sec = activePinSection();
  if (!sec) return;
  const targetAnchor = pinAnchorOverride?.isConnected ? pinAnchorOverride : document.getElementById(pinAnchorOverride?.id || 'btn-pin');
  const p = createProject(name);
  togglePin(p.id, sec);
  renderPinMenu();
  pinCtrl.reposition(targetAnchor);
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
