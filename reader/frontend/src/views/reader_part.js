import { state } from '../state';
import { renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { adjustFontSize, sectionHref } from '../components/rail';
import { syncMainTabFromRoute } from '../components/reader_tabs';
import { clearTreeSelection, ensureTreeLoaded, plural, selectTreeNode } from '../components/sidebar';
import { openSplitPane } from '../components/split_pane';
import { renderNotFound } from '../components/title_switcher';
import { docStepBtn, docStepHtml, firstSectionOf, partNeighbors, setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, icon, showToast, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { recordPartVisit } from '../usage';
import { enhanceDomAnchors, renderViewError } from './doc_utils';
import { collectSectionReferences, openRefsLedgerPopover } from './reader';

// --- Load Part Table of Contents ---
export async function loadPart(partId) {
  dom.view.innerHTML = skeletonHtml('list', 'Loading Part ' + partId + '…');
  state.currentSection = null;
  state.currentPart = partId;
  updateChatContext();

  try {
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    // Fetch TOC tree nodes for this part and front matter
    const [frontRes] = await Promise.all([
      fetch('/api/' + state.currentTitle + '/part/' + encodeURIComponent(partId), { signal }),
      ensureTreeLoaded()
    ]);

    const front = frontRes.ok ? await frontRes.json() : { part: '', subparts: {} };
    if (seq !== state.routeSeq) return;

    // Find part node in tree
    const partNode = findPartInTree(state.treeData, partId);
    if (!partNode) {
      if (state.metaInfo?.partial && /^\d+[a-z]?(?:-\d+)?$/i.test(partId)) {
        clearTreeSelection();
        setViewHead('');
        await renderResolverPage(dom.view, { title: state.currentTitle, part: partId });
        return;
      }
      renderNotFound();
      return;
    }

    let groupsHtml = '';
    let sectionCount = 0;
    let subpartCount = 0;
    const secRowHtml = (s) => {
      sectionCount++;
      const tTitle = tocTitle(s);
      const hay = `${s.l || ''} ${s.id || ''} ${tTitle}`.toLowerCase();
      return `
        <li class="${s.r ? 'reserved' : ''}" data-hay="${escapeHtml(hay)}">
          <a href="#/section/${encodeURIComponent(s.id)}">
            <span class="toc-num">${escapeHtml(s.l)}</span>
            <span class="toc-title">${escapeHtml(tTitle)}</span>
          </a>
        </li>`;
    };
    if (partNode.c) {
      for (const child of partNode.c) {
        if (child.t === 'subpart' || child.t === 'subject_group') {
          subpartCount++;
          const subpartFront = front.subparts[child.id] || '';
          const children = child.c || [];
          const sections = children.map(secRowHtml).join('');
          const headingText = child.d && child.d.trim() !== (child.l || '').trim() ? `${child.l}: ${child.d}` : child.l;

          groupsHtml += `
            <div class="toc-group" data-ref-tier="cfr">
              <h3><span>${escapeHtml(headingText)}</span><span class="toc-group-count">${children.length}</span></h3>
              ${subpartFront ? `<div class="front-matter"><details><summary>Subpart notes</summary>${subpartFront}</details></div>` : ''}
              <ul class="toc-list">${sections}</ul>
            </div>
          `;
        } else if (child.t === 'section' || child.t === 'appendix') {
          groupsHtml += `<div class="toc-group is-flat" data-ref-tier="cfr"><ul class="toc-list">${secRowHtml(child)}</ul></div>`;
        }
      }
    }

    document.title = `Part ${partId} · Title ${state.currentTitle}`;
    setViewHead(docStepHtml(partId, null, firstSectionOf(partId)));
    const sep = '<span class="sep" aria-hidden="true">·</span>';
    const filterHtml = sectionCount >= 6
      ? `<div class="part-toc-tools">
          <input type="search" id="part-toc-filter" class="ui-input part-toc-filter" placeholder="Filter ${plural(sectionCount, 'section')} in Part ${escapeHtml(partId)}…" aria-label="Filter sections in part" autocomplete="off" spellcheck="false">
        </div>`
      : '';
    dom.view.innerHTML = `
      <div class="doc-kicker" data-ref-tier="cfr">
        <span class="ref-badge">FEDERAL REG</span>${sep}<span>${state.currentTitle} CFR ${escapeHtml(partNode.l)}</span>
        ${sectionCount ? `${sep}<span>${plural(sectionCount, 'section')}</span>` : ''}
        ${subpartCount ? `${sep}<span>${plural(subpartCount, 'subpart')}</span>` : ''}
      </div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn btn-accent" href="#/part/${encodeURIComponent(partId)}/full">${icon('list')} See full part</a>
        ${newsActivityButtonHtml()}
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <button type="button" class="btn" id="btn-part-copy" title="Copy part link">${icon('link')} Copy link</button>
        </div>
      </div>
      ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ''}
      ${filterHtml}
      ${groupsHtml || '<p class="muted">No sections listed in this part.</p>'}
      <p class="part-toc-empty muted" id="part-toc-empty" hidden>No matching sections in Part ${escapeHtml(partId)}.</p>
    `;

    syncMainTabFromRoute({
      kind: 'part',
      title: state.currentTitle,
      partId,
      full: false,
      label: `${state.currentTitle} CFR Part ${partId}`,
      heading: partNode.d || partNode.l || '',
      href: window.location.hash || `#/title/${state.currentTitle}/part/${encodeURIComponent(partId)}`,
    });
    const swapX = state.swapMotionX || 0;
    state.swapMotionX = 0;
    enterView({ fromX: swapX });
    selectTreeNode('p-' + partId);
    recordPartVisit(partId, partNode.d);
    fillNewsActivity('part', partId, seq);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load part', err?.message || 'Unexpected error', {
      onRetry: () => loadPart(partId),
    });
  }
}


// --- Load Part (full text) ---
// Every section of a part in reading order, each with its own anchor. Arriving from a
// section page scrolls that section into view; prev/next part in the header jump between
// parts without leaving the full-text view.
export async function loadPartFull(partId, params) {
  dom.view.innerHTML = skeletonHtml('doc', 'Loading Part ' + partId + '…');
  state.currentSection = null;
  state.currentPart = partId;
  updateChatContext();

  try {
    const seq = state.routeSeq;
    const signal = state.routeAbort?.signal;
    await ensureTreeLoaded();
    if (seq !== state.routeSeq) return;
    const partNode = findPartInTree(state.treeData, partId);
    if (!partNode) {
      if (state.metaInfo?.partial && /^\d+[a-z]?(?:-\d+)?$/i.test(partId)) {
        clearTreeSelection();
        setViewHead('');
        await renderResolverPage(dom.view, { title: state.currentTitle, part: partId });
        return;
      }
      renderNotFound();
      return;
    }

    const res = await fetch('/api/' + state.currentTitle + '/part/' + encodeURIComponent(partId) + '/full', { signal });
    if (seq !== state.routeSeq) return;
    if (!res.ok) { renderNotFound(); return; }
    const data = await res.json();
    if (seq !== state.routeSeq) return;

    const from = params && params.get('from');
    const anchorId = (id) => 'sec-' + String(id).replace(/[^a-zA-Z0-9.\-]/g, '_');
    const sections = data.sections || [];
    const sectionsHtml = sections.map(s => {
      // The stored label on sections already begins with "§ "; appendices have "Appendix X".
      const num = escapeHtml(s.label);
      const title = escapeHtml(s.title || '');
      const body = s.reserved ? '<div class="reserved-note">This section is reserved.</div>' : (s.html || '');
      return `<article class="full-section${s.id === from ? ' is-from' : ''}" id="${anchorId(s.id)}">
        <header class="full-section-head has-tier-bar" data-ref-tier="cfr">
          <a class="full-section-anchor" href="${sectionHref(s.id)}" title="Open this section on its own">
            <span class="full-section-num">${num}</span>
            <span class="full-section-title">${title}</span>
          </a>
          <button type="button" class="lib-act full-section-split" data-full-split="${escapeHtml(s.id)}" title="Open ${num} side-by-side">Split</button>
        </header>
        ${body}
      </article>`;
    }).join('');

    document.title = `Part ${partId} (full) · Title ${state.currentTitle}`;
    // Full-text mode steps between parts, not between sections.
    const [prevPart, nextPart] = partNeighbors(partId);
    const partBtn = (node, dir) => node
      ? docStepBtn('part', dir, `#/part/${encodeURIComponent(node.id)}/full`, `Part ${node.id}`, node.d,
        `<span class="step-word">Part </span>${escapeHtml(node.id)}`)
      : '';
    const headRow = (prevPart || nextPart)
      ? `<nav class="doc-step" aria-label="Previous and next part">${partBtn(prevPart, -1)}<span class="spacer"></span>${partBtn(nextPart, 1)}</nav>`
      : '';
    setViewHead(headRow);

    const sep = '<span class="sep" aria-hidden="true">·</span>';
    dom.view.innerHTML = `
      <div class="doc-kicker" data-ref-tier="cfr">
        <span class="ref-badge">FULL PART</span>${sep}<span>${state.currentTitle} CFR ${escapeHtml(partNode.l)}</span>${sep}<span>${plural(sections.length, 'section')}</span>${sep}<a href="#/part/${encodeURIComponent(partId)}">Table of contents</a>
      </div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn" href="#/part/${encodeURIComponent(partId)}">${icon('list')} Table of contents</a>
        ${newsActivityButtonHtml()}
        <button type="button" class="btn" id="btn-part-refs-ledger" aria-haspopup="dialog" aria-expanded="false" hidden>${icon('list')} <span>Refs</span></button>
        <div class="spacer"></div>
        <div class="doc-actions-util">
          <button type="button" class="btn" id="btn-part-copy" title="Copy direct link">${icon('link')} Copy link</button>
          <div class="size-ctl" role="group" aria-label="Text size">
            <button type="button" id="part-font-dec" title="Smaller text" aria-label="Smaller text">A−</button>
            <button type="button" id="part-font-inc" title="Larger text" aria-label="Larger text">A+</button>
          </div>
        </div>
      </div>
      ${sectionsHtml || '<p class="muted">No sections in this part.</p>'}
    `;
    enhanceDomAnchors(dom.view);
    syncMainTabFromRoute({
      kind: 'part',
      title: state.currentTitle,
      partId,
      full: true,
      label: `${state.currentTitle} CFR Part ${partId} · Full`,
      heading: partNode.d || partNode.l || '',
      href: window.location.hash || `#/title/${state.currentTitle}/part/${encodeURIComponent(partId)}/full`,
    });
    const refs = collectSectionReferences(dom.view);
    const ledgerBtn = document.getElementById('btn-part-refs-ledger');
    if (ledgerBtn && refs.length) {
      const span = ledgerBtn.querySelector('span');
      if (span) span.textContent = `Refs ${refs.length}`;
      ledgerBtn.hidden = false;
    }
    recordPartVisit(partId, partNode.d);
    fillNewsActivity('part', partId, seq);

    // No enterView() here: a fade-rise on hundreds of nodes is a jank parade, and the
    // scroll-to has to land on the right pixel. Images load after the render and push
    // content down, so re-anchor on each image load (and once fonts are ready) until the
    // user takes over scrolling. `.full-section`'s scroll-margin-top handles the offset
    // past the pinned header.
    if (from) {
      const el = document.getElementById(anchorId(from));
      if (el) {
        // Re-anchor each frame for ~2.5s. The browser re-measures everything on each call,
        // so as images and fonts settle, we stay locked on the target. The moment the user
        // scrolls away from our last set value we stop and leave them alone.
        const start = performance.now();
        let lastSet = -1;
        const anchor = () => {
          if (lastSet >= 0 && Math.abs(dom.main.scrollTop - lastSet) > 4) return;
          const r = el.getBoundingClientRect();
          const m = dom.main.getBoundingClientRect();
          const rel = r.top - m.top;
          if (rel < 60 || rel > 100) { // target is ~72 (scroll-margin), re-align only if off
            el.scrollIntoView({ block: 'start' });
            lastSet = dom.main.scrollTop;
          }
          if (performance.now() - start < 2500) requestAnimationFrame(anchor);
        };
        requestAnimationFrame(anchor);
      }
    } else {
      dom.main.scrollTop = 0;
    }
    selectTreeNode('s-' + (from || (sections[0] && sections[0].id)));
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    renderViewError(dom.view, 'Failed to load part', err?.message || 'Unexpected error', {
      onRetry: () => loadPartFull(partId, params),
    });
  }
}

dom.view.addEventListener('input', (e) => {
  if (e.target.id !== 'part-toc-filter') return;
  const q = e.target.value.trim().toLowerCase();
  let visible = 0;
  for (const grp of dom.view.querySelectorAll('.toc-group')) {
    let grpShown = 0;
    for (const li of grp.querySelectorAll('li[data-hay]')) {
      const show = !q || li.dataset.hay.includes(q);
      li.hidden = !show;
      if (show) { grpShown++; visible++; }
    }
    grp.hidden = grpShown === 0;
    const cnt = grp.querySelector('.toc-group-count');
    if (cnt) cnt.textContent = String(grpShown);
  }
  const emptyEl = document.getElementById('part-toc-empty');
  if (emptyEl) emptyEl.hidden = visible > 0 || !q;
});

dom.view.addEventListener('click', async (e) => {
  if (e.target.closest('#btn-part-refs-ledger')) {
    openRefsLedgerPopover(e.target.closest('#btn-part-refs-ledger'));
    return;
  }
  if (e.target.closest('#btn-part-copy')) {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied');
    } catch (err) {
      showToast('Couldn’t copy the link');
    }
    return;
  }
  if (e.target.closest('#part-font-dec')) { adjustFontSize(-1); return; }
  if (e.target.closest('#part-font-inc')) { adjustFontSize(1); return; }
  const splitBtn = e.target.closest('[data-full-split]');
  if (splitBtn) {
    openSplitPane({ title: state.currentTitle, sectionId: splitBtn.dataset.fullSplit, pushHistory: true });
  }
});


// Some entries repeat their own label in the heading: "§ 261.5 [Reserved]".
export function tocTitle(node) {
  const l = cleanInlineLabel(node.l || '');
  const d = cleanInlineLabel(node.d || '');
  return l && d.startsWith(l) && d.length > l.length ? d.slice(l.length).trim() : d;
}


export function findPartInTree(node, partId) {
  if (!node) return null;
  if (node.t === 'part' && String(node.id) === String(partId)) return node;
  if (node.c) {
    for (const ch of node.c) {
      const found = findPartInTree(ch, partId);
      if (found) return found;
    }
  }
  return null;
}
