import './state_init';
import './core/events';
import './core/view_dispatch';
import './data/home_content';
import './dom';
import './api/client';
import './core/library_meta';
import './core/projects_store';
import './core/news_format';
import './api/jobs';
import './components/corpora';
import './components/ui';
import './router';
import './views/ref_almanac';
import './views/core';
import './usage';
import './views/home';
import './views/welcome';
import './views/library';
import './components/transfer_dock';
import './components/title_switcher';
import './components/view_head';
import './components/part_toc';
import './components/refs_popovers';
import './views/reader';
import './components/rail';
import './views/reader_part';
import './views/search';
import './components/search_bar';
import './components/sidebar';
import './views/projects';
import './panels/projects_panel';
import './views/news_case';
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
import './components/reader_tabs';
import './components/split_pane';
import './components/cfr_resolver';
import './components/peek';
import { state } from './state';
import { fetchInstalledTitles, fetchTitleMeta, getJSON } from './api/client';
import { pollJobsIfActive, setJobs } from './api/jobs';
import { refreshModelsConfig } from './components/env_modal';
import { ensureTreeLoaded, switchTitle } from './components/sidebar';
import { syncCorporaState } from './components/corpora';
import { fillTitleSelect, setReaderEnabled } from './components/title_switcher';
import { isMac } from './dom';
import { updateRailHome } from './nav';
import { restoreSessionTabsSnapshot } from './components/reader_tabs';
import { restoreSplitTabs } from './components/split_pane';
import { handleRoute } from './router';
import { dom } from './state_init';

export const chatKbd = document.getElementById('chat-kbd');

if (chatKbd) chatKbd.textContent = isMac ? '⌘J' : 'Ctrl J';
 // ⌘K is search


// --- Init ---
export async function init() {
  try {
    state.installedTitles = await fetchInstalledTitles();
    state.noTitles = state.installedTitles.length === 0;
    syncCorporaState();
    // Title 29 is the default, but it may have been removed in the library.
    if (state.installedTitles.length && !state.installedTitles.some(t => t.title === state.currentTitle)) {
      await switchTitle(state.installedTitles[0].title);
    }
    fillTitleSelect();
    updateRailHome();

    if (state.noTitles) {
      // Fresh install: no contents, metadata or models to load. The router shows the
      // profile picker on reader/overview routes; cross-title pages stay reachable.
      setReaderEnabled(false);
    } else {
      const [meta] = await Promise.all([
        fetchTitleMeta(state.currentTitle).catch(() => null),
        refreshModelsConfig(),
        ensureTreeLoaded()
      ]);

      if (meta) {
        state.metaInfo = meta;
        dom.edition.textContent = `eCFR ${state.metaInfo.edition || ''}`;
      }
      setReaderEnabled(true);
    }
  } catch (e) {
    console.warn('Initialization warnings:', e);
  }

  const sessionSnap = restoreSessionTabsSnapshot();
  await handleRoute();
  if (sessionSnap?.splitTabs?.length && (state.currentSection || state.currentPart)) {
    const idx = Math.max(0, sessionSnap.splitTabs.findIndex(t => t.id === sessionSnap.activeSplitTabId));
    restoreSplitTabs(sessionSnap.splitTabs, idx, sessionSnap.splitWide);
  }
  // A download may already be running (started in another tab or before a reload).
  getJSON('/api/library/jobs').then(snap => { setJobs(/** @type {import('./state').JobsSnapshot} */ (snap)); pollJobsIfActive(); }).catch(() => {});
}


init();
