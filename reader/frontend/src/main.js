import './state_init';
import './dom';
import './router';
import './views/core';
import './usage';
import './views/home';
import './views/welcome';
import './views/library';
import './components/transfer_dock';
import './components/title_switcher';
import './components/view_head';
import './views/reader';
import './components/rail';
import './views/reader_part';
import './views/search';
import './components/search_bar';
import './components/sidebar';
import './views/projects';
import './panels/projects_panel';
import './views/news';
import './components/news_activity';
import './components/pin_pop';
import './components/palette';
import './nav';
import './panels/shared';
import './panels/library_panel';
import './panels/settings_panel';
import './views/help';
import './components/env_modal';
import './panels/recent_panel';
import './panels/drawer_width';
import './components/chat';
import './components/selection_tool';
import './components/popover';
import './components/split_pane';
import './components/cfr_resolver';
import './components/peek';
import { state } from './state';
import { refreshModelsConfig } from './components/env_modal';
import { ensureTreeLoaded, switchTitle } from './components/sidebar';
import { fillTitleSelect, setReaderEnabled } from './components/title_switcher';
import { isMac } from './dom';
import { updateRailHome } from './nav';
import { setTheme } from './panels/settings_panel';
import { handleRoute } from './router';
import { dom } from './state_init';
import { getJSON, pollJobsIfActive, setJobs } from './views/library';

// --- Theme & Nav Toggles ---
dom.themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});


export const chatKbd = document.getElementById('chat-kbd');

if (chatKbd) chatKbd.textContent = isMac ? '⌘J' : 'Ctrl J';
 // ⌘K is search


// --- Init ---
export async function init() {
  try {
    const titlesRes = await fetch('/api/titles');
    if (titlesRes.ok) {
      state.installedTitles = await titlesRes.json();
      state.noTitles = state.installedTitles.length === 0;
      // Title 29 is the default, but it may have been removed in the library.
      if (state.installedTitles.length && !state.installedTitles.some(t => t.title === state.currentTitle)) {
        await switchTitle(state.installedTitles[0].title);
      }
      fillTitleSelect();
      updateRailHome();
    }

    if (state.noTitles) {
      // Fresh install: no contents, metadata or models to load. The router shows the
      // profile picker on reader/overview routes; cross-title pages stay reachable.
      setReaderEnabled(false);
    } else {
      const [metaRes] = await Promise.all([
        fetch('/api/' + state.currentTitle + '/meta'),
        refreshModelsConfig(),
        ensureTreeLoaded()
      ]);

      if (metaRes.ok) {
        state.metaInfo = await metaRes.json();
        dom.edition.textContent = `eCFR ${state.metaInfo.edition || ''}`;
      }
      setReaderEnabled(true);
    }
  } catch (e) {
    console.warn('Initialization warnings:', e);
  }

  handleRoute();
  // A download may already be running (started in another tab or before a reload).
  getJSON('/api/library/jobs').then(snap => { setJobs(snap); pollJobsIfActive(); }).catch(() => {});
}


init();
