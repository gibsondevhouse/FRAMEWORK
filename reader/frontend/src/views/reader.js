import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { pinButtonHtml } from '../components/pin_pop';
import { adjustFontSize, bindRail, railHtml, sectionHref, unitShort, unitStepHtml, watchRail } from '../components/rail';
import { selectTreeNode } from '../components/sidebar';
import { renderNotFound } from '../components/title_switcher';
import { docStepHtml, setViewHead } from '../components/view_head';
import { enterView, escapeHtml, icon, showToast, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { recordSectionUnit, recordSectionVisit } from '../usage';

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
    const res = await fetch('/api/' + state.currentTitle + '/section/' + encodeURIComponent(sectionId) + qs);
    if (seq !== state.routeSeq) return;
    if (!res.ok) {
      renderNotFound();
      return;
    }
    const data = await res.json();
    if (seq !== state.routeSeq) return;
    state.currentSection = data;
    state.currentPart = data.part;
    updateChatContext();

    const reading = data.mode === 'units' && data.unit ? 'units' : 'scroll';
    const current = reading === 'units' ? (data.outline || []).find(u => u.key === data.unit) : null;
    const heading = data.section_title || data.title_label || '';
    document.title = `${data.label}${current ? ' ' + unitShort(current) : ''} · Title ${state.currentTitle}`;
    setViewHead((reading === 'units' ? unitStepHtml(data) : docStepHtml(data.part, data.prev, data.next)) + railHtml(data, reading));

    // The line above the title places the section (title and part) and links up to its part.
    const partLink = data.part ? `<a href="#/part/${encodeURIComponent(data.part)}">Part ${escapeHtml(data.part)}</a>` : '';
    // Inside an appendix, every chapter after the first says which appendix it belongs to.
    const i = current ? data.outline.indexOf(current) : -1;
    const showContext = current && current.group && current.kind === 'chapter' && i > 0 && data.outline[i - 1].group === current.group;
    const fullPart = data.part ? `<a class="btn" href="#/part/${encodeURIComponent(data.part)}/full?from=${encodeURIComponent(data.id)}">${icon('list')} See full part</a>` : '';
    const toggle = data.mode !== 'units' ? ''
      : full ? `<a class="btn" href="${sectionHref(data.id)}">${icon('stack')} Read in parts</a>`
      : `<a class="btn" href="${sectionHref(data.id, 'full')}">${icon('expand')} See full section</a>`;
    dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${partLink}</div>
      <h1 class="doc-title">${escapeHtml(data.label)} ${escapeHtml(heading)}</h1>

      <div class="doc-actions">
        ${toggle}
        ${fullPart}
        <a class="btn" href="${escapeHtml(data.ecfr_url)}" target="_blank" rel="noopener">${icon('external')} eCFR</a>
        <button class="btn" id="btn-copy-link">${icon('link')} Copy link</button>
        ${pinButtonHtml()}
        ${newsActivityButtonHtml()}
        <div class="spacer"></div>
        <div class="size-ctl" role="group" aria-label="Text size">
          <button id="font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
          <button id="font-inc" title="Larger text" aria-label="Larger text">A+</button>
        </div>
      </div>

      ${data.reserved ? '<div class="reserved-note">This section is reserved.</div>' : ''}
      ${showContext ? `<div class="unit-context">${escapeHtml(current.group_label)}<span class="sep" aria-hidden="true">·</span>${escapeHtml(current.group_title || '')}</div>` : ''}

      ${data.html || ''}
    `;

    enterView();
    bindRail();
    if (reading === 'scroll') watchRail();
    else if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }

    // Bind actions
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

    // Handle highlight param if present
    if (params && params.get('p')) {
      highlightParagraph(params.get('p'));
    }

    // Highlight in sidebar tree
    selectTreeNode('s-' + data.id);
    // Stepping between clauses of one section is one visit, not many, while remembering the active unit.
    const unitInfo = reading === 'units' && current ? { key: current.key, label: unitShort(current) } : null;
    if (!sameSection) recordSectionVisit(data, unitInfo);
    else recordSectionUnit(data.id, unitInfo);
    // Not awaited: the activity button fills in after the text has painted, and the
    // session cache means stepping clause to clause makes no extra requests.
    fillNewsActivity('section', data.id, seq);

  } catch (err) {
    console.error(err);
    setViewHead('');
    dom.view.innerHTML = `<div class="msg-error">Failed to load section: ${escapeHtml(err.message)}</div>`;
  }
}


export function highlightParagraph(pText) {
  setTimeout(() => {
    // Find matching paragraph
    const clean = pText.trim();
    const pmarks = document.querySelectorAll('.reg-p .pmark');
    for (const el of pmarks) {
      if (el.textContent.includes(clean)) {
        const p = el.closest('.reg-p');
        p.classList.add('flash');
        p.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }, 150);
}
