import { state } from '../state';
import { citePop, citePopEl, renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { pinButtonHtml } from '../components/pin_pop';
import { adjustFontSize, bindRail, railHtml, sectionHref, unitShort, unitStepHtml, watchRail } from '../components/rail';
import { clearTreeSelection, partForSection, plural, selectTreeNode } from '../components/sidebar';
import { openSplitPane } from '../components/split_pane';
import { renderNotFound } from '../components/title_switcher';
import { docStepHtml, setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, icon, lsGet, lsSet, showToast, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { recordSectionUnit, recordSectionVisit } from '../usage';
import {
  enhanceDomAnchors, findParagraphElement, formatCfrCitation, highlightTarget,
  openFigureModal, renderViewError, resolveParagraphPath, wrapIbrMentions,
} from './doc_utils';
import { clipToWorkspace, currentSectionRef } from './projects';

const READING_MODE_KEY = 'readingModeByPart:v1';

function loadReadingModePrefs() {
  try {
    const obj = JSON.parse(lsGet(READING_MODE_KEY) || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function getPreferredPartMode(title, part) {
  if (!part) return null;
  const prefs = loadReadingModePrefs();
  return prefs[`${title}|${part}`] || null;
}

function savePreferredPartMode(title, part, mode) {
  if (!part) return;
  const prefs = loadReadingModePrefs();
  prefs[`${title}|${part}`] = mode;
  lsSet(READING_MODE_KEY, JSON.stringify(prefs));
}

export function highlightParagraph(pText, delay = 120) {
  highlightTarget(dom.view, pText, delay);
}


// --- Paragraph Action Bar ("Copy cite" + "Clip") ---
let paraBar = null;
let paraBarTarget = null;

function hideParaBar() {
  if (paraBar) paraBar.hidden = true;
  paraBarTarget = null;
}

function showParaBar(pEl) {
  if (!dom.view.querySelector('.reg-body') || !pEl?.querySelector('.pmark')) {
    hideParaBar();
    return;
  }
  if (!paraBar || !paraBar.isConnected) {
    paraBar = document.createElement('div');
    paraBar.className = 'para-tools';
    paraBar.setAttribute('aria-label', 'Paragraph actions');
    paraBar.innerHTML = `
      <button type="button" class="para-tool-btn" data-para-act="copy" title="Copy legal CFR citation">${icon('link')} Cite</button>
      <button type="button" class="para-tool-btn" data-para-act="clip" title="Clip clause to workspace">${icon('bookmark')} Clip</button>
    `;
  }
  paraBarTarget = pEl;
  paraBar.hidden = false;
  pEl.appendChild(paraBar);
}

dom.view.addEventListener('mouseover', (e) => {
  if (!state.currentSection) return;
  if (paraBar && paraBar.contains(e.target)) return;
  const p = e.target.closest('.reg-body .reg-p[id]');
  if (p && p.querySelector('.pmark')) {
    if (p !== paraBarTarget) showParaBar(p);
  } else {
    hideParaBar();
  }
});

dom.view.addEventListener('mouseleave', () => hideParaBar());

dom.view.addEventListener('click', async (e) => {
  const toolBtn = e.target.closest('.para-tool-btn[data-para-act]');
  if (toolBtn && paraBarTarget && state.currentSection) {
    e.preventDefault();
    e.stopPropagation();
    const para = resolveParagraphPath(dom.view, paraBarTarget);
    const label = cleanInlineLabel(state.currentSection.label);
    const cite = formatCfrCitation(state.currentTitle, label, para);
    if (toolBtn.dataset.paraAct === 'copy') {
      try {
        await navigator.clipboard.writeText(cite);
        showToast(`Copied ${cite}`);
      } catch (err) {
        showToast('Couldn’t copy citation');
      }
    } else if (toolBtn.dataset.paraAct === 'clip') {
      const clone = paraBarTarget.cloneNode(true);
      clone.querySelectorAll('.para-tools').forEach(x => x.remove());
      const ref = currentSectionRef();
      if (ref) clipToWorkspace(ref, { para, quote: clone.textContent.trim().slice(0, 320), cite });
    }
    return;
  }

  const modeBtn = e.target.closest('a[data-mode-pref]');
  if (modeBtn && state.currentSection?.part) {
    savePreferredPartMode(state.currentTitle, state.currentSection.part, modeBtn.dataset.modePref);
  }

  if (e.target.closest('#btn-cited-by') && state.currentSection) {
    const btn = e.target.closest('#btn-cited-by');
    const graphData = state.graphCache.get(`${state.currentTitle}|${state.currentSection.id}`);
    if (graphData) openCitedByPopover(btn, graphData);
    return;
  }

  if (e.altKey) return;
  const localPara = e.target.closest('a.xref-local[data-local-para]');
  if (localPara) {
    const hit = findParagraphElement(dom.view, localPara.dataset.localPara);
    if (hit) {
      e.preventDefault();
      highlightParagraph(localPara.dataset.localPara, 0);
    }
    return;
  }
  const figLink = e.target.closest('a.reg-figure:not(.is-broken)');
  if (figLink && dom.view.contains(figLink)) {
    e.preventDefault();
    openFigureModal(figLink);
  }
});


// --- Reverse Citations ("Cited By N") ---
function renderCitedByListHtml(graphData, filter = '') {
  const q = filter.trim().toLowerCase();
  const rows = (graphData.cited_by || []).filter(c => {
    if (!q) return true;
    return `${c.id} ${c.label} ${c.title} ${c.part}`.toLowerCase().includes(q);
  });
  if (!rows.length) return '<p class="peek-text" style="padding:8px 0">No matching citing sections.</p>';
  return `<div class="cited-list">${rows.slice(0, 50).map(c => `
    <div class="cited-row">
      <a class="cited-link" href="#/title/${state.currentTitle}/section/${encodeURIComponent(c.id)}">
        <span class="cited-num">${escapeHtml(c.label)}</span>
        <span class="cited-title">${escapeHtml(c.title)}</span>
      </a>
      <button type="button" class="lib-act cited-split" data-cited-split="${escapeHtml(c.id)}" title="Open side-by-side">Split</button>
    </div>
  `).join('')}</div>`;
}

function openCitedByPopover(btn, graphData) {
  const total = graphData.cited_by_count || 0;
  const filterHtml = total >= 6
    ? `<input type="search" class="pop-filter" id="cited-pop-filter" placeholder="Filter ${total} citing sections…" aria-label="Filter citing sections" autocomplete="off">`
    : '';
  citePop.open(btn, `
    <div class="pop-head-row">
      <div class="pop-kicker">Cited by ${plural(total, 'section')} in Title ${state.currentTitle}</div>
      <button type="button" class="icon-btn pop-close" data-pop-close aria-label="Close citing sections">${icon('close')}</button>
    </div>
    ${filterHtml}
    <div id="cited-pop-list">${renderCitedByListHtml(graphData)}</div>
  `, { interactive: true, returnFocus: btn, focusSelector: '#cited-pop-filter, .cited-link' });

  const filterEl = document.getElementById('cited-pop-filter');
  if (filterEl) {
    filterEl.addEventListener('input', () => {
      const slot = document.getElementById('cited-pop-list');
      if (slot) slot.innerHTML = renderCitedByListHtml(graphData, filterEl.value);
      citePop.reposition(btn);
    });
  }
}

if (citePopEl) {
  citePopEl.addEventListener('click', (e) => {
    const sp = e.target.closest('[data-cited-split]');
    if (!sp) return;
    const secId = sp.dataset.citedSplit;
    citePop.close(false);
    openSplitPane({ title: state.currentTitle, sectionId: secId, pushHistory: true });
  });
}

async function fillSectionGraph(titleNum, sectionId, seq, signal) {
  const key = `${titleNum}|${sectionId}`;
  let data = state.graphCache.get(key);
  if (!data) {
    try {
      const res = await fetch(`/api/${titleNum}/citations/${encodeURIComponent(sectionId)}`, { signal });
      if (!res.ok) return;
      data = await res.json();
      state.graphCache.set(key, data);
    } catch (e) {
      return;
    }
  }
  if (seq !== state.routeSeq || !state.currentSection || state.currentSection.id !== sectionId) return;

  if (data.cited_by_count > 0) {
    const btn = document.getElementById('btn-cited-by');
    if (btn) {
      const span = btn.querySelector('span');
      if (span) span.textContent = `Cited by ${data.cited_by_count}`;
      btn.hidden = false;
    }
  }
  if (data.ibr && data.ibr.length) {
    wrapIbrMentions(dom.view, data.ibr);
  }
}


// --- Load Section ---
// `view` is a unit key (read that unit), 'full' (the whole section), or null (the default:
// the first unit of a long section, or the page of a short one).
export async function loadSection(sectionId, params, view) {
  hideParaBar();
  const knownPart = partForSection(sectionId);
  const prefMode = !view && !params?.get('p') && knownPart ? getPreferredPartMode(state.currentTitle, knownPart) : null;
  const full = view === 'full' || prefMode === 'full';
  // A link to a paragraph, e.g. ?p=(f)(1), opens the clause that holds it.
  const pClause = params && /^\(([a-z])\)/.exec(params.get('p') || '');
  const unit = full ? null : (view || (pClause ? pClause[1] : ''));
  const sameSection = state.currentSection && state.currentSection.id === sectionId && !dom.view.querySelector('.loading');
  if (!sameSection) dom.view.innerHTML = skeletonHtml('doc', 'Loading section ' + sectionId + '…');
  try {
    const qs = unit === null ? '' : '?unit=' + encodeURIComponent(unit);
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    const res = await fetch('/api/' + state.currentTitle + '/section/' + encodeURIComponent(sectionId) + qs, { signal });
    if (seq !== state.routeSeq) return;
    if (!res.ok) {
      if (state.metaInfo?.partial && /^\d+[a-z]?(?:\.\d+.*)?$/i.test(sectionId)) {
        clearTreeSelection();
        setViewHead('');
        await renderResolverPage(dom.view, {
          title: state.currentTitle,
          section: sectionId,
          para: params ? params.get('p') : null,
        });
        return;
      }
      renderNotFound();
      return;
    }
    const data = await res.json();
    if (seq !== state.routeSeq) return;
    state.currentSection = data;
    state.currentPart = data.part;
    updateChatContext();

    const reading = data.mode === 'units' && data.unit ? 'units' : 'scroll';
    const outline = data.outline || [];
    const unitIdx = reading === 'units' ? outline.findIndex(u => u.key === data.unit) : -1;
    const current = unitIdx >= 0 ? outline[unitIdx] : null;
    const heading = cleanInlineLabel(data.section_title || data.title_label || '');
    const label = cleanInlineLabel(data.label);
    document.title = `${label}${current ? ' ' + unitShort(current) : ''} · Title ${state.currentTitle}`;
    setViewHead((reading === 'units' ? unitStepHtml(data) : docStepHtml(data.part, data.prev, data.next)) + railHtml(data, reading));

    const partLink = data.part ? `<a href="#/part/${encodeURIComponent(data.part)}">Part ${escapeHtml(data.part)}</a>` : '';
    let unitBannerHtml = '';
    if (current) {
      const unitLabel = current.group && current.kind === 'chapter'
        ? `${current.group_label} · ${current.group_title || ''}`
        : `${current.label ? `Clause ${current.label}` : current.title}`;
      unitBannerHtml = `<div class="unit-context"><span>${escapeHtml(unitLabel)}</span><span class="sep" aria-hidden="true">·</span><span class="unit-pos">Unit ${unitIdx + 1} of ${outline.length}</span></div>`;
    }

    const fullPart = data.part ? `<a class="btn" href="#/part/${encodeURIComponent(data.part)}/full?from=${encodeURIComponent(data.id)}">${icon('list')} See full part</a>` : '';
    const toggle = data.mode !== 'units' ? ''
      : full ? `<a class="btn" href="${sectionHref(data.id)}" data-mode-pref="units">${icon('stack')} Read in parts</a>`
      : `<a class="btn" href="${sectionHref(data.id, 'full')}" data-mode-pref="full">${icon('expand')} See full section</a>`;
    dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${partLink}</div>
      <h1 class="doc-title">${escapeHtml(label)} ${escapeHtml(heading)}</h1>

      <div class="doc-actions">
        ${toggle}
        ${fullPart}
        ${pinButtonHtml()}
        ${newsActivityButtonHtml()}
        <button type="button" class="btn" id="btn-cited-by" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('link')} <span>Cited by</span></button>
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <a class="btn" href="${escapeHtml(data.ecfr_url)}" target="_blank" rel="noopener" title="Open official text on eCFR">${icon('external')} eCFR</a>
          <button class="btn" id="btn-copy-link" title="Copy direct link">${icon('link')} Copy link</button>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>
      </div>

      ${data.reserved ? '<div class="reserved-note">This section is reserved.</div>' : ''}
      ${unitBannerHtml}

      ${data.html || ''}
    `;

    enhanceDomAnchors(dom.view);
    enterView();
    bindRail();
    if (reading === 'scroll') watchRail();
    else if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }

    document.getElementById('btn-copy-link')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Link copied');
      } catch (e) {
        showToast('Couldn’t copy the link');
      }
    });
    document.getElementById('font-dec')?.addEventListener('click', () => adjustFontSize(-1));
    document.getElementById('font-inc')?.addEventListener('click', () => adjustFontSize(1));

    if (params && params.get('p')) {
      highlightParagraph(params.get('p'));
    }

    selectTreeNode('s-' + data.id);
    const unitInfo = reading === 'units' && current ? { key: current.key, label: unitShort(current) } : null;
    if (!sameSection) recordSectionVisit(data, unitInfo);
    else recordSectionUnit(data.id, unitInfo);
    fillNewsActivity('section', data.id, seq);
    fillSectionGraph(state.currentTitle, data.id, seq, signal);

  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load section', err?.message || 'Unexpected error', {
      onRetry: () => loadSection(sectionId, params, view),
    });
  }
}
