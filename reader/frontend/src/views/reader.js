import { state } from '../state';
import { renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { pinButtonHtml } from '../components/pin_pop';
import { adjustFontSize, bindRail, railHtml, sectionHref, unitShort, unitStepHtml, watchRail } from '../components/rail';
import { selectTreeNode, clearTreeSelection } from '../components/sidebar';
import { renderNotFound } from '../components/title_switcher';
import { docStepHtml, setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, icon, showToast, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { recordSectionUnit, recordSectionVisit } from '../usage';
import { enhanceDomAnchors, findParagraphElement, highlightTarget, openFigureModal } from './doc_utils';

export function highlightParagraph(pText, delay = 120) {
  highlightTarget(dom.view, pText, delay);
}


// --- Delegated Section Interactions ---
dom.view.addEventListener('click', (e) => {
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


// --- Load Section ---
// `view` is a unit key (read that unit), 'full' (the whole section), or null (the default:
// the first unit of a long section, or the page of a short one).
export async function loadSection(sectionId, params, view) {
  const full = view === 'full';
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
      : full ? `<a class="btn" href="${sectionHref(data.id)}">${icon('stack')} Read in parts</a>`
      : `<a class="btn" href="${sectionHref(data.id, 'full')}">${icon('expand')} See full section</a>`;
    dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${partLink}</div>
      <h1 class="doc-title">${escapeHtml(label)} ${escapeHtml(heading)}</h1>

      <div class="doc-actions">
        ${toggle}
        ${fullPart}
        ${pinButtonHtml()}
        ${newsActivityButtonHtml()}
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

  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    dom.view.innerHTML = `<div class="msg-error">Failed to load section: ${escapeHtml(err.message)}</div>`;
  }
}
