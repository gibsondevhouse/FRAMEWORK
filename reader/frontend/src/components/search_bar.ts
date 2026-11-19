import { state } from '../state';
import { fetchSearchResults } from '../api/client';
import { toggleChat } from '../components/chat';
import { commandItemsHtml, runCommand } from '../components/palette';
import { escapeHtml } from '../dom';
import { dom } from '../state_init';

// --- Live Search Dropdown ---
state.searchTimer = null;
state.sdActive = -1;
let searchAbort: AbortController | null = null;

function setDropdownOpen(open: boolean): void {
  dom.searchDropdown.hidden = !open;
  dom.search.setAttribute('aria-expanded', String(Boolean(open)));
  if (!open) {
    dom.search.removeAttribute('aria-activedescendant');
    state.sdActive = -1;
  }
}

export function moveSdActive(delta: number): void {
  const items = [...dom.searchDropdown.querySelectorAll<HTMLElement>('.sd-item')];
  if (dom.searchDropdown.hidden || !items.length) return;
  const active = state.sdActive ?? -1;
  state.sdActive = (active + delta + items.length) % items.length;
  items.forEach((el, i) => {
    const on = i === state.sdActive;
    el.classList.toggle('active', on);
    if (on) {
      if (!el.id) el.id = `sd-opt-${i}`;
      dom.search.setAttribute('aria-activedescendant', el.id);
    }
  });
  items[state.sdActive].scrollIntoView({ block: 'nearest' });
}

dom.search.addEventListener('input', () => {
  if (state.searchTimer) clearTimeout(state.searchTimer);
  if (searchAbort) { try { searchAbort.abort(); } catch { /* ignore */ } searchAbort = null; }
  state.sdActive = -1;
  const q = dom.search.value.trim();
  if (!q) {
    setDropdownOpen(false);
    return;
  }
  if (q.startsWith('>')) {
    dom.searchDropdown.innerHTML = commandItemsHtml(q.slice(1));
    setDropdownOpen(true);
    moveSdActive(1);
    return;
  }
  if (/^dol:/i.test(q)) {
    const term = q.slice(4).trim();
    dom.searchDropdown.innerHTML = term
      ? `<a class="sd-item sd-dol-hint" href="#/news?cat=enforcement&dol_q=${encodeURIComponent(term)}">
           <div class="sd-item-top">
             <span class="sd-label">DOL Archive</span>
             <span class="sd-item-title">Search live OSHA inspections for “${escapeHtml(term)}”</span>
           </div>
           <span class="sd-snippet">Press <kbd>Enter</kbd> to query DOL Open Data API v4 (no network calls while typing)</span>
         </a>`
      : `<div class="sd-footer">Type an employer, NAICS, or 29 CFR section after <code>dol:</code> and press <kbd>Enter</kbd>.</div>`;
    setDropdownOpen(true);
    return;
  }
  state.searchTimer = setTimeout(async () => {
    searchAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const ctrl = searchAbort;
    try {
      const data = await fetchSearchResults(state.currentTitle, q, 6, { signal: ctrl?.signal });
      if (ctrl?.signal?.aborted || dom.search.value.trim() !== q) return;
      if (!data.results || data.results.length === 0) {
        dom.searchDropdown.innerHTML = `<div class="sd-footer">No quick matches. Press <kbd>Enter</kbd> to search the full text.</div>`;
      } else {
        const items = data.results.map((r, i) => {
          const snip = (r.snippet || '').replace(/[\x02\x03]/g, '');
          const rTitle = r.title || state.currentTitle;
          return `
            <a class="sd-item" id="sd-opt-${i}" role="option" data-ref-tier="cfr" href="#/title/${rTitle}/section/${encodeURIComponent(r.id)}">
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
      setDropdownOpen(true);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setDropdownOpen(false);
    }
  }, 180);
});

dom.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const items = dom.searchDropdown.querySelectorAll<HTMLElement>('.sd-item');
    const active = state.sdActive ?? -1;
    if (!dom.searchDropdown.hidden && active >= 0 && items[active]) {
      const cmd = items[active].dataset.cmd;
      setDropdownOpen(false);
      dom.search.blur();
      if (cmd || dom.search.value.trim().startsWith('>')) dom.search.value = '';
      if (cmd) { runCommand(cmd); return; }
      const href = items[active].getAttribute('href');
      if (href) window.location.hash = href;
      setDropdownOpen(false);
      dom.search.blur();
      return;
    }
    setDropdownOpen(false);
    const q = dom.search.value.trim();
    if (/^dol:/i.test(q)) {
      const term = q.slice(4).trim();
      if (term) {
        const mode = /^\d{4}\.\d+/.test(term) ? 'standard' : /^\d{2,6}$/.test(term) ? 'naics' : 'employer';
        dom.search.blur();
        window.location.hash = `#/news?cat=enforcement&dol_q=${encodeURIComponent(term)}&dol_mode=${mode}`;
      }
      return;
    }
    if (q && !q.startsWith('>')) window.location.hash = `#/search?q=${encodeURIComponent(q)}`;
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!dom.searchDropdown.hidden) {
      e.preventDefault();
      moveSdActive(e.key === 'ArrowDown' ? 1 : -1);
    }
  } else if (e.key === 'Escape') {
    setDropdownOpen(false);
  }
});

dom.searchDropdown.addEventListener('click', (e) => {
  const item = (e.target as Element | null)?.closest<HTMLElement>('.sd-cmd');
  if (!item) return;
  setDropdownOpen(false);
  dom.search.value = '';
  if (item.dataset.cmd) { e.preventDefault(); runCommand(item.dataset.cmd); }
});

document.addEventListener('click', (e) => {
  const t = e.target as Node | null;
  if (!dom.search.contains(t) && !dom.searchDropdown.contains(t)) {
    setDropdownOpen(false);
  }
});

document.addEventListener('keydown', (e) => {
  const active = document.activeElement as HTMLElement | null;
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
