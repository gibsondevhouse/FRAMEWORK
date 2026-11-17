import { state } from './state';
import { renderResolverPage } from './components/cfr_resolver';
import { clearTreeSelection, switchTitle } from './components/sidebar';
import { renderNotFound } from './components/title_switcher';
import { setViewHead } from './components/view_head';
import { syncNavToRoute } from './nav';
import { renderSettingsPage } from './panels/settings_panel';
import { dom } from './state_init';
import { renderHome } from './views/core';
import { renderHomeScreen } from './views/home';
import { loadHelp } from './views/help';
import { loadLibrary } from './views/library';
import { loadNews } from './views/news';
import { renderProjects } from './views/projects';
import { loadSection } from './views/reader';
import { loadPart, loadPartFull } from './views/reader_part';
import { loadSearchPage } from './views/search';
import { renderWelcome } from './views/welcome';

// --- Router ---
export function parseHash() {
  const hash = window.location.hash || '#/';
  const [pathPart, queryPart] = hash.slice(1).split('?');
  const params = new URLSearchParams(queryPart || '');
  return { path: pathPart || '/', params };
}


export async function handleRoute() {
  const { path, params } = parseHash();
  state.activeRoute = path;
  const seq = ++state.routeSeq;
  if (state.routeAbort) { try { state.routeAbort.abort(); } catch (e) {} }
  state.routeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;

  // Light the rail, put the drawer away where the page wants the width, close a floating one.
  syncNavToRoute(path);

  // Nothing installed: every reader/overview route gives way to the first-run profile picker,
  // while cross-title verticals (/library, /news, /projects, /settings, /help) stay reachable.
  if (state.noTitles && !/^\/(library|news|projects|settings|help)(\/|$)/.test(path)) {
    await renderWelcome();
    return;
  }

  let checkPath = path;
  const titleMatch = path.match(/^\/title\/(\d+)(\/.*)?$/);
  if (titleMatch) {
    const targetTitle = parseInt(titleMatch[1], 10);
    const subPath = titleMatch[2] || '/';
    const installed = state.installedTitles.some(t => t.title === targetTitle);
    if (!installed && targetTitle >= 1 && targetTitle <= 50) {
      let section = null;
      let part = null;
      if (subPath.startsWith('/section/')) {
        const rest = subPath.slice('/section/'.length);
        const slash = rest.indexOf('/');
        try { section = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash)); } catch (e) { section = rest; }
      } else if (subPath.startsWith('/part/')) {
        part = subPath.slice('/part/'.length).replace(/\/full$/, '');
        try { part = decodeURIComponent(part); } catch (e) { /* keep raw */ }
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

  if (checkPath === '/' || checkPath === '') {
    // `#/` is the FRAMEWORK Home screen across every title; `#/title/N/` is that title's start page.
    if (titleMatch) renderHome();
    else renderHomeScreen();
  } else if (checkPath.startsWith('/section/')) {
    // /section/{id}, /section/{id}/{unit}, /section/{id}/full. Ids never contain "/".
    const rest = checkPath.slice('/section/'.length);
    const slash = rest.indexOf('/');
    const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    const sectionId = decode(slash < 0 ? rest : rest.slice(0, slash));
    const view = slash < 0 ? null : decode(rest.slice(slash + 1)) || null;
    await loadSection(sectionId, params, view);
  } else if (checkPath.startsWith('/part/')) {
    const rest = checkPath.replace('/part/', '');
    // `/part/{id}` is the section index; `/part/{id}/full` is every section's text in order.
    const fullMatch = rest.match(/^(.+?)\/full$/);
    if (fullMatch) await loadPartFull(fullMatch[1], params);
    else await loadPart(rest);
  } else if (checkPath === '/library' || checkPath.startsWith('/library/')) {
    // /library, /library/{title}, /library/{title}/part/{part}
    const m = /^\/library(?:\/(\d+)(?:\/part\/(.+))?)?\/?$/.exec(checkPath);
    if (!m) renderNotFound();
    else {
      const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
      await loadLibrary(m[1] ? parseInt(m[1], 10) : null, m[2] ? decode(m[2]) : null);
    }
  } else if (!titleMatch && (checkPath === '/projects' || checkPath.startsWith('/projects/'))) {
    const id = checkPath.slice('/projects/'.length);
    renderProjects(id ? decodeURIComponent(id) : null);
  } else if (!titleMatch && (checkPath === '/news' || checkPath === '/news/')) {
    // Like projects, News is cross-title: #/title/29/news falls through to not-found.
    await loadNews(params);
  } else if (!titleMatch && (checkPath === '/help' || checkPath === '/help/')) {
    await loadHelp(params);
  } else if (!titleMatch && (checkPath === '/settings' || checkPath === '/settings/')) {
    renderSettingsPage({ enter: true });
  } else if (checkPath.startsWith('/search')) {
    const q = params.get('q') || '';
    dom.search.value = q;
    await loadSearchPage(q, params.get('scope'));
  } else {
    renderNotFound();
  }
}


window.addEventListener('hashchange', handleRoute);
