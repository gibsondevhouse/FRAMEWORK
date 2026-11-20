import { CorpusSummary, state } from './state';
import { emit, on } from './core/events';
import { renderResolverPage } from './components/cfr_resolver';
import { findSystemFramework, parseCorpusPath, syncCorporaState } from './components/corpora';
import { clearTreeSelection, switchTitle } from './components/sidebar';
import { renderCorpusStaging, renderNotFound } from './components/title_switcher';
import { hideMainTabs } from './components/reader_tabs';
import { setViewHead } from './components/view_head';
import { applyNav, renderCorpusDrawer, syncNavToRoute } from './nav';
import { renderSettingsPage } from './panels/settings_panel';
import { dom } from './state_init';
import { renderHome } from './views/core';
import { renderHomeScreen } from './views/home';
import { loadHelp } from './views/help';
import { loadLibrary } from './views/library';
import { loadInspection, loadNews } from './views/news';
import { loadFrDocument } from './views/news_fr';
import { renderProjects } from './views/projects';
import { loadSection } from './views/reader';
import { loadPart, loadPartFull } from './views/reader_part';
import { loadUscRoute } from './views/reader_usc';
import { loadSearchPage } from './views/search';
import { renderWelcome } from './views/welcome';

// --- Router ---
export function parseHash(): { path: string; params: URLSearchParams } {
  const hash = window.location.hash || '#/';
  const [pathPart, queryPart] = hash.slice(1).split('?');
  const params = new URLSearchParams(queryPart || '');
  return { path: pathPart || '/', params };
}

export async function handleRoute(): Promise<void> {
  const { path, params } = parseHash();
  state.activeRoute = path;
  const seq = ++state.routeSeq;
  if (state.routeAbort) { try { state.routeAbort.abort(); } catch { /* ignore */ } }
  state.routeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;

  syncNavToRoute(path);

  if (state.noTitles && !/^\/(library|news|projects|settings|help|corpus|usc)(\/|$)/.test(path)) {
    emit('route:changed', { path });
    await renderWelcome();
    return;
  }

  const uscMatch = /^\/usc\/(\d+)(?:\/(.*))?$/.exec(path);
  if (uscMatch) {
    hideMainTabs();
    clearTreeSelection();
    const uscTitle = parseInt(uscMatch[1], 10);
    const rest = (uscMatch[2] || '').replace(/^\/+/, '');
    const decodeUsc = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };
    if (rest.startsWith('section/')) {
      const [rawId, rawView] = rest.slice('section/'.length).split('/');
      await loadUscRoute(uscTitle, { sectionId: decodeUsc(rawId), view: rawView ? decodeUsc(rawView) : null, para: params.get('p') });
    } else if (rest.startsWith('node/')) {
      const nodeId = decodeUsc(rest.slice('node/'.length));
      await loadUscRoute(uscTitle, { nodeId });
    } else {
      await loadUscRoute(uscTitle);
    }
    applyNav();
    emit('route:changed', { path });
    return;
  }
  state.currentUscTitle = null;
  state.currentUscNode = null;
  state.currentUscSection = null;

  let checkPath = path;
  let titleMatch: RegExpMatchArray | [string, string, string] | null = path.match(/^\/title\/(\d+)(\/.*)?$/);
  const corpusMatch = !titleMatch ? parseCorpusPath(path) : null;
  if (corpusMatch) {
    syncCorporaState();
    const isCfr = corpusMatch.tier === 'federal-reg' || corpusMatch.tier === 'cfr';
    const cfrTitleNum = isCfr ? parseInt(corpusMatch.code, 10) : NaN;
    if (isCfr && Number.isFinite(cfrTitleNum)) {
      titleMatch = [path, String(cfrTitleNum), corpusMatch.subPath];
    } else if (corpusMatch.tier === 'state' || corpusMatch.tier === 'county') {
      state.activeCorpus = null;
      emit('route:changed', { path });
      renderNotFound();
      return;
    } else {
      const matchedCorpus = findSystemFramework(corpusMatch.tier, corpusMatch.jurisdiction, corpusMatch.code)
        || state.corpora.find(c =>
          c.tier === corpusMatch.tier
          && c.jurisdiction.toLowerCase() === corpusMatch.jurisdiction.toLowerCase()
          && String(c.code).toLowerCase() === String(corpusMatch.code).toLowerCase(),
        );
      clearTreeSelection();
      setViewHead('');
      const fallbackCorpus: CorpusSummary = matchedCorpus || {
        corpus_id: `${corpusMatch.jurisdiction}:${corpusMatch.tier}:${corpusMatch.code}`,
        tier: corpusMatch.tier as CorpusSummary['tier'],
        jurisdiction: corpusMatch.jurisdiction,
        jurisdiction_label: 'Federal',
        code: corpusMatch.code,
        name: corpusMatch.code,
        desk: 'all',
        agencies: [],
        installed: false,
      };
      state.activeCorpus = fallbackCorpus;
      renderCorpusDrawer(fallbackCorpus);
      applyNav();
      emit('route:changed', { path });
      renderCorpusStaging(fallbackCorpus);
      return;
    }
  }
  state.activeCorpus = null;
  emit('route:changed', { path });
  if (titleMatch) {
    const targetTitle = parseInt(titleMatch[1], 10);
    const subPath = titleMatch[2] || '/';
    const installed = state.installedTitles.some(t => t.title === targetTitle);
    if (!installed && targetTitle >= 1 && targetTitle <= 50) {
      let section: string | null = null;
      let part: string | null = null;
      if (subPath.startsWith('/section/')) {
        const rest = subPath.slice('/section/'.length);
        const slash = rest.indexOf('/');
        try { section = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash)); } catch { section = rest; }
      } else if (subPath.startsWith('/part/')) {
        part = subPath.slice('/part/'.length).replace(/\/full$/, '');
        try { part = decodeURIComponent(part); } catch { /* keep raw */ }
      }
      clearTreeSelection();
      setViewHead('');
      await renderResolverPage(dom.view, { title: targetTitle, section, part, para: params.get('p') });
      return;
    }
    if (!installed) {
      renderNotFound();
      return;
    }
    if (targetTitle && targetTitle !== state.currentTitle) {
      await switchTitle(targetTitle);
      if (seq !== state.routeSeq) return;
    }
    checkPath = subPath;
  }

  const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

  if (checkPath === '/' || checkPath === '') {
    hideMainTabs();
    if (titleMatch) renderHome();
    else renderHomeScreen();
  } else if (checkPath.startsWith('/section/')) {
    const rest = checkPath.slice('/section/'.length);
    const slash = rest.indexOf('/');
    const sectionId = decode(slash < 0 ? rest : rest.slice(0, slash));
    const view = slash < 0 ? null : decode(rest.slice(slash + 1)) || null;
    await loadSection(sectionId, params, view);
  } else if (checkPath.startsWith('/part/')) {
    const rest = checkPath.replace('/part/', '');
    const fullMatch = rest.match(/^(.+?)\/full$/);
    if (fullMatch) await loadPartFull(fullMatch[1], params);
    else await loadPart(rest);
  } else if (checkPath === '/library' || checkPath.startsWith('/library/')) {
    hideMainTabs();
    // #/library (Overview) · #/library/usc[/{n}] · #/library/cfr[/{n}[/part/{p}]]; the older
    // #/library/{n}[/part/{p}] CFR links are rewritten to their /cfr/ form.
    const legacy = /^\/library\/(\d+)((?:\/part\/.+)?)\/?$/.exec(checkPath);
    const usc = /^\/library\/usc(?:\/(\d+))?\/?$/.exec(checkPath);
    const cfr = /^\/library\/cfr(?:\/(\d+)(?:\/part\/(.+))?)?\/?$/.exec(checkPath);
    if (legacy) {
      history.replaceState(null, '', `#/library/cfr/${legacy[1]}${legacy[2]}`);
      const m = /^\/part\/(.+)$/.exec(legacy[2]);
      await loadLibrary('cfr', parseInt(legacy[1], 10), m ? decode(m[1]) : null);
    } else if (usc) await loadLibrary('usc', usc[1] ? parseInt(usc[1], 10) : null, null);
    else if (cfr) await loadLibrary('cfr', cfr[1] ? parseInt(cfr[1], 10) : null, cfr[2] ? decode(cfr[2]) : null);
    else if (/^\/library\/?$/.test(checkPath)) await loadLibrary('overview', null, null);
    else renderNotFound();
  } else if (!titleMatch && (checkPath === '/projects' || checkPath.startsWith('/projects/'))) {
    hideMainTabs();
    const id = checkPath.slice('/projects/'.length);
    renderProjects(id ? decodeURIComponent(id) : null);
  } else if (!titleMatch && (checkPath === '/news' || checkPath === '/news/')) {
    hideMainTabs();
    await loadNews(params);
  } else if (!titleMatch && /^\/news\/inspection\/\d+\/?$/.test(checkPath)) {
    hideMainTabs();
    const actNr = parseInt(checkPath.split('/')[3], 10);
    await loadInspection(actNr);
  } else if (!titleMatch && /^\/news\/fr\/([A-Za-z0-9._-]+)\/?$/.test(checkPath)) {
    hideMainTabs();
    const docNum = checkPath.replace(/^\/news\/fr\//, '').replace(/\/$/, '');
    await loadFrDocument(docNum);
  } else if (!titleMatch && (checkPath === '/help' || checkPath === '/help/')) {
    hideMainTabs();
    await loadHelp();
  } else if (!titleMatch && (checkPath === '/settings' || checkPath === '/settings/')) {
    hideMainTabs();
    renderSettingsPage({ enter: true });
  } else if (checkPath.startsWith('/search')) {
    hideMainTabs();
    const q = params.get('q') || '';
    dom.search.value = q;
    await loadSearchPage(q, params.get('scope'));
  } else {
    hideMainTabs();
    renderNotFound();
  }
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', () => { handleRoute(); });
on('route:refresh', () => { handleRoute(); });
