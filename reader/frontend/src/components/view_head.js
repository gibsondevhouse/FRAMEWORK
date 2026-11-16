import { state } from '../state';
import { LEAF_TYPES, treeIdx } from '../components/sidebar';
import { escapeHtml, icon } from '../dom';
import { dom } from '../state_init';
import { tocTitle } from '../views/reader_part';

// --- Main panel header: previous/next ---
//   ‹ part | ‹ section ……… section › | part ›
// Lives in #view-head, pinned to the top of the reading panel while the text scrolls
// under it. Buttons show only the number; the name appears in a small popup on hover or
// keyboard focus. A neighbour that doesn't exist leaves no button. A part page offers its
// own first section as "next section". Pages with nothing to step through hide the header.
export function setViewHead(html) {
  const head = dom.viewHead;
  if (!head) return;
  // A keyboard user stepping with Enter keeps their place on the same button.
  const step = head.contains(document.activeElement) ? document.activeElement.dataset.step : null;
  if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }
  head.innerHTML = html || '';
  head.hidden = !html;
  if (step) (head.querySelector(`[data-step="${step}"]`) || head.querySelector('a'))?.focus({ preventScroll: true });
}


export function firstSectionOf(partId) {
  const k = treeIdx.parts.get(String(partId));
  if (k === undefined) return null;
  const find = (node) => {
    for (const c of node.c || []) {
      if (LEAF_TYPES.has(c.t)) return c;
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  const leaf = find(treeIdx.nodes[k]);
  return leaf ? { id: leaf.id, label: (leaf.l || '').trim(), title: tocTitle(leaf) } : null;
}


export function docStepBtn(kind, dir, href, label, name, labelHtml) {
  const prev = dir < 0;
  const what = `${prev ? 'Previous' : 'Next'} ${kind}`;
  const chevron = icon(prev ? 'chevronLeft' : 'chevronRight');
  const title = (name || '').trim();
  return `<a class="doc-step-btn is-${prev ? 'prev' : 'next'}" href="${href}" data-step="${kind}-${prev ? 'prev' : 'next'}" aria-label="${escapeHtml(`${what}: ${label}${title ? ' ' + title : ''}`)}">`
    + `${prev ? chevron : ''}<span class="step-label">${labelHtml || escapeHtml(label)}</span>${prev ? '' : chevron}`
    + `<span class="tip" aria-hidden="true"><span class="tip-kind">${what} · ${escapeHtml(label)}</span>${escapeHtml(title)}</span></a>`;
}


export function partNeighbors(partId) {
  const list = treeIdx.partList;
  const k = treeIdx.parts.get(String(partId));
  const i = k === undefined ? -1 : list.indexOf(k);
  if (i < 0) return [null, null];
  return [treeIdx.nodes[list[i - 1]] || null, treeIdx.nodes[list[i + 1]] || null];
}


export function docStepHtml(partId, prevSection, nextSection) {
  const [prevPart, nextPart] = partNeighbors(partId);
  const partBtn = (node, dir) => node
    ? docStepBtn('part', dir, `#/part/${encodeURIComponent(node.id)}`, `Part ${node.id}`, node.d,
      `<span class="step-word">Part </span>${escapeHtml(node.id)}`)
    : '';
  const sectionBtn = (s, dir) => s
    ? docStepBtn('section', dir, `#/section/${encodeURIComponent(s.id)}`, s.label, s.title)
    : '';
  const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
  const left = [partBtn(prevPart, -1), sectionBtn(prevSection, -1)].filter(Boolean).join(sep);
  const right = [sectionBtn(nextSection, 1), partBtn(nextPart, 1)].filter(Boolean).join(sep);
  if (!left && !right) return '';
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}
