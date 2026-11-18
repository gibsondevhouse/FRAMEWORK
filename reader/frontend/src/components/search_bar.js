import { state } from '../state';
import { toggleChat } from '../components/chat';
import { commandItemsHtml, runCommand } from '../components/palette';
import { escapeHtml } from '../dom';
import { dom } from '../state_init';

// --- Live Search Dropdown ---
state.searchTimer = null;

state.sdActive = -1;
 // index of the keyboard-highlighted dropdown row

export function moveSdActive(delta) {
  const items = [...dom.searchDropdown.querySelectorAll('.sd-item')];
  if (dom.searchDropdown.hidden || !items.length) return;
  state.sdActive = (state.sdActive + delta + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('active', i === state.sdActive));
  items[state.sdActive].scrollIntoView({ block: 'nearest' });
}


dom.search.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.sdActive = -1;
  const q = dom.search.value.trim();
  if (!q) {
    dom.searchDropdown.hidden = true;
    return;
  }
  if (q.startsWith('>')) {
    // Commands: navigation, drawer panels, workspaces and corpora.
    dom.searchDropdown.innerHTML = commandItemsHtml(q.slice(1));
    dom.searchDropdown.hidden = false;
    moveSdActive(1);
    return;
  }
  state.searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/${state.currentTitle}/search?q=${encodeURIComponent(q)}&limit=6`);
      const data = await res.json();
      if (!data.results || data.results.length === 0) {
        dom.searchDropdown.innerHTML = `<div class="sd-footer">No quick matches. Press <kbd>Enter</kbd> to search the full text.</div>`;
      } else {
        const items = data.results.map(r => {
          let snip = (r.snippet || '').replace(/[\x02\x03]/g, '');
          const rTitle = r.title || state.currentTitle;
          return `
            <a class="sd-item" data-ref-tier="cfr" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
              <div class="sd-item-top">
                <span class="sd-label">${escapeHtml(r.label)}</span>
                <span class="sd-item-title">${escapeHtml(r.title_label || r.title)}</span>
                <span class="ref-badge">${rTitle} CFR</span>
              </div>
              ${snip ? `<span class="sd-snippet">${escapeHtml(snip)}</span>` : ''}
            </a>
          `;
        }).join('');
        dom.searchDropdown.innerHTML = items + `<div class="sd-footer"><kbd>Enter</kbd> All ${Number(data.total).toLocaleString()} results<span class="sd-hint">Type <kbd>&gt;</kbd> for commands</span></div>`;
      }
      dom.searchDropdown.hidden = false;
    } catch (e) {
      dom.searchDropdown.hidden = true;
    }
  }, 180);
});


dom.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const items = dom.searchDropdown.querySelectorAll('.sd-item');
    if (!dom.searchDropdown.hidden && state.sdActive >= 0 && items[state.sdActive]) {
      const cmd = items[state.sdActive].dataset.cmd;
      dom.searchDropdown.hidden = true;
      dom.search.blur();
      if (cmd || dom.search.value.trim().startsWith('>')) dom.search.value = '';
      if (cmd) { runCommand(cmd); return; }
      window.location.hash = items[state.sdActive].getAttribute('href');
      dom.searchDropdown.hidden = true;
      dom.search.blur();
      return;
    }
    dom.searchDropdown.hidden = true;
    const q = dom.search.value.trim();
    if (q && !q.startsWith('>')) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!dom.searchDropdown.hidden) {
      e.preventDefault();
      moveSdActive(e.key === 'ArrowDown' ? 1 : -1);
    }
  } else if (e.key === 'Escape') {
    dom.searchDropdown.hidden = true;
  }
});


dom.searchDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.sd-cmd');
  if (!item) return;
  dom.searchDropdown.hidden = true;
  dom.search.value = '';
  if (item.dataset.cmd) { e.preventDefault(); runCommand(item.dataset.cmd); }
});


document.addEventListener('click', (e) => {
  if (!dom.search.contains(e.target) && !dom.searchDropdown.contains(e.target)) {
    dom.searchDropdown.hidden = true;
  }
});


// Hotkey for search & command palette (and chat)
document.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
  if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k')) {
    if (state.noTitles) return;
    e.preventDefault();
    dom.search.focus();
    dom.search.select();
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'j' || (e.shiftKey && e.key.toLowerCase() === 'k'))) {
    e.preventDefault();
    toggleChat();
  }
});
