import { state } from '../state';
import { renderResolverPage } from '../components/cfr_resolver';
import { updateChatContext } from '../components/chat';
import { fillNewsActivity, newsActivityButtonHtml } from '../components/news_activity';
import { sectionHref } from '../components/rail';
import { clearTreeSelection, ensureTreeLoaded, selectTreeNode } from '../components/sidebar';
import { renderNotFound } from '../components/title_switcher';
import { docStepBtn, docStepHtml, firstSectionOf, partNeighbors, setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, icon, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { recordPartVisit } from '../usage';
import { enhanceDomAnchors } from './doc_utils';

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
    if (partNode.c) {
      for (const child of partNode.c) {
        if (child.t === 'subpart' || child.t === 'subject_group') {
          const subpartFront = front.subparts[child.id] || '';
          const sections = (child.c || []).map(s => `
            <li class="${s.r ? 'reserved' : ''}">
              <a href="#/section/${encodeURIComponent(s.id)}">
                <span class="toc-num">${escapeHtml(s.l)}</span>
                <span class="toc-title">${escapeHtml(tocTitle(s))}</span>
              </a>
            </li>
          `).join('');

          groupsHtml += `
            <div class="toc-group">
              <h3>${escapeHtml(child.d && child.d.trim() !== (child.l || '').trim() ? `${child.l}: ${child.d}` : child.l)}</h3>
              ${subpartFront ? `<div class="front-matter"><details><summary>Subpart notes</summary>${subpartFront}</details></div>` : ''}
              <ul class="toc-list">${sections}</ul>
            </div>
          `;
        } else if (child.t === 'section' || child.t === 'appendix') {
          groupsHtml += `
            <ul class="toc-list">
              <li class="${child.r ? 'reserved' : ''}">
                <a href="#/section/${encodeURIComponent(child.id)}">
                  <span class="toc-num">${escapeHtml(child.l)}</span>
                  <span class="toc-title">${escapeHtml(tocTitle(child))}</span>
                </a>
              </li>
            </ul>
          `;
        }
      }
    }

    document.title = `Part ${partId} · Title ${state.currentTitle}`;
    setViewHead(docStepHtml(partId, null, firstSectionOf(partId)));
    dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${escapeHtml(partNode.l)}</div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      <div class="doc-actions">
        <a class="btn" href="#/part/${encodeURIComponent(partId)}/full">${icon('list')} See full part</a>
        ${newsActivityButtonHtml()}
      </div>
      ${front.part ? `<div class="front-matter"><details><summary>Authority and source</summary>${front.part}</details></div>` : ''}
      ${groupsHtml || '<p class="muted">No sections listed in this part.</p>'}
    `;

    enterView();
    selectTreeNode('p-' + partId);
    recordPartVisit(partId, partNode.d);
    fillNewsActivity('part', partId, seq);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    dom.view.innerHTML = `<div class="msg-error">Failed to load part: ${escapeHtml(err.message)}</div>`;
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
    const sectionsHtml = (data.sections || []).map(s => {
      // The stored label on sections already begins with "§ "; appendices have "Appendix X".
      const num = escapeHtml(s.label);
      const title = escapeHtml(s.title || '');
      const body = s.reserved ? '<div class="reserved-note">This section is reserved.</div>' : (s.html || '');
      return `<article class="full-section${s.id === from ? ' is-from' : ''}" id="${anchorId(s.id)}">
        <header class="full-section-head">
          <a class="full-section-anchor" href="${sectionHref(s.id)}" title="Open this section on its own">
            <span class="full-section-num">${num}</span>
            <span class="full-section-title">${title}</span>
          </a>
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

    dom.view.innerHTML = `
      <div class="doc-kicker">${state.currentTitle} CFR ${escapeHtml(partNode.l)} · <a href="#/part/${encodeURIComponent(partId)}">Table of contents</a></div>
      <h1 class="doc-title">${escapeHtml(partNode.d || partNode.l)}</h1>
      ${sectionsHtml || '<p class="muted">No sections in this part.</p>'}
    `;
    enhanceDomAnchors(dom.view);
    recordPartVisit(partId, partNode.d);

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
    selectTreeNode('s-' + (from || (data.sections[0] && data.sections[0].id)));
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    console.error(err);
    setViewHead('');
    dom.view.innerHTML = `<div class="msg-error">Failed to load part: ${escapeHtml(err.message)}</div>`;
  }
}


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
