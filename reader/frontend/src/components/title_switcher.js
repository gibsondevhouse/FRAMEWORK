import { state } from '../state';
import { clearTreeSelection, switchTitle } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon } from '../dom';
import { dom } from '../state_init';

// --- Title switcher (top bar) ---
// A Linear-style menu instead of a native select: "Download titles…" first (opens the
// library), then the installed titles, number in a muted column, a check on the current one.
// Keyboard: ↓/Enter/Space opens on the current title, ↑↓ Home End move, Enter picks,
// Esc closes and returns focus to the button, Tab closes.
// With nothing installed the search box, chat and contents list have nothing to work on;
// they wake back up when the first title lands.
export function setReaderEnabled(on) {
  dom.search.disabled = !on;
  dom.search.placeholder = on
    ? `Search Title ${state.currentTitle} or jump to a section…`
    : 'Download a title to search';
  dom.chatToggle.disabled = !on;
  if (!on) {
    dom.edition.textContent = '';
    dom.tree.innerHTML = '<div class="side-empty">No titles installed yet. <a href="#/">Pick a profile</a> or open the <a href="#/library">library</a>.</div>';
  }
}


export function fillTitleSelect() {
  if (!dom.titleSelect) return;
  const cur = state.installedTitles.find(t => t.title === state.currentTitle);
  const name = state.noTitles ? '' : cur ? cur.name : (state.metaInfo.name || '');
  document.getElementById('title-select-num').textContent = state.noTitles ? 'No titles' : `Title ${state.currentTitle}`;
  document.getElementById('title-select-name').textContent = name;
  dom.titleSelect.title = state.noTitles
    ? 'Nothing installed yet. Download titles'
    : `Title ${state.currentTitle}${name ? ': ' + name : ''}. Switch title`;
  dom.titlePop.innerHTML = `
    <a class="tm-item tm-download" role="menuitem" href="#/library" tabindex="-1">${icon('download')}<span class="tm-name">Download titles…</span></a>
    ${state.installedTitles.length ? '<div class="tm-sep" role="separator"></div>' : ''}
    ${state.installedTitles.map(t => {
      const on = t.title === state.currentTitle;
      return `<button type="button" class="tm-item${on ? ' is-current' : ''}" role="menuitemradio" aria-checked="${on}" data-title="${t.title}" tabindex="-1">
        <span class="tm-num">${t.title}</span><span class="tm-name">${escapeHtml(t.name)}</span>
        ${t.partial ? '<span class="tm-meta">Partial</span>' : ''}
        ${on ? icon('check', 'tm-check') : '<span class="tm-check" aria-hidden="true"></span>'}
      </button>`;
    }).join('')}`;
}


export const titleMenuItems = () => [...dom.titlePop.querySelectorAll('.tm-item')];


export function openTitleMenu(focusWhich = 'current') {
  if (!dom.titlePop.hidden) return;
  dom.titlePop.hidden = false;
  dom.titleSelect.setAttribute('aria-expanded', 'true');
  const items = titleMenuItems();
  const target = focusWhich === 'first' ? items[0]
    : focusWhich === 'last' ? items[items.length - 1]
    : dom.titlePop.querySelector('.is-current') || items[0];
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'nearest' });
  document.addEventListener('pointerdown', onTitleMenuOutside, true);
}


export function closeTitleMenu(returnFocus) {
  if (dom.titlePop.hidden) return;
  dom.titlePop.hidden = true;
  dom.titleSelect.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', onTitleMenuOutside, true);
  if (returnFocus) dom.titleSelect.focus();
}


export function onTitleMenuOutside(e) {
  if (!document.getElementById('title-menu').contains(e.target)) closeTitleMenu(false);
}


dom.titleSelect.addEventListener('click', () => {
  if (dom.titlePop.hidden) openTitleMenu();
  else closeTitleMenu(false);
});

dom.titleSelect.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    openTitleMenu(e.key === 'ArrowUp' ? 'last' : 'current');
  }
});

dom.titlePop.addEventListener('keydown', (e) => {
  const items = titleMenuItems();
  const i = items.indexOf(document.activeElement);
  const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length].focus(); };
  if (e.key === 'ArrowDown') go(i + 1);
  else if (e.key === 'ArrowUp') go(i - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTitleMenu(true); }
  else if (e.key === 'Tab') closeTitleMenu(false);
});

dom.titlePop.addEventListener('click', async (e) => {
  const item = e.target.closest('.tm-item');
  if (!item) return;
  closeTitleMenu(false);
  if (item.classList.contains('tm-download')) return; // the link navigates
  const newTitle = parseInt(item.dataset.title, 10);
  if (newTitle && newTitle !== state.currentTitle) {
    await switchTitle(newTitle);
    window.location.hash = `#/title/${newTitle}/`;
  } else {
    dom.titleSelect.focus();
  }
});


export function renderNotFound() {
  clearTreeSelection();
  document.title = 'Not found · FRAMEWORK';
  setViewHead('');
  dom.view.innerHTML = `
    <div class="empty-state">
      <h2>Page not found</h2>
      <p>That section or part isn’t in Title ${state.currentTitle}.</p>
      <a href="#/title/${state.currentTitle}/" class="btn">Back to Title ${state.currentTitle}</a>
    </div>
  `;
  enterView();
}
