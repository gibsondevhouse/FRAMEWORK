import { state, TreeNode } from '../state';
import { LEAF_TYPES, treeIdx } from '../components/sidebar';
import { escapeHtml, icon, tocTitle } from '../dom';
import { dom } from '../state_init';

export interface SectionRefStep {
  id: string;
  label?: string;
  title?: string;
}

export function setViewHead(html?: string | null): void {
  const head = dom.viewHead;
  if (!head) return;
  const activeEl = document.activeElement as HTMLElement | null;
  const step = activeEl && head.contains(activeEl) ? activeEl.dataset.step : null;
  if (state.railObserver) { state.railObserver.disconnect(); state.railObserver = null; }
  head.innerHTML = html || '';
  head.hidden = !html;
  if (step) {
    (head.querySelector<HTMLElement>(`[data-step="${step}"]`) || head.querySelector<HTMLElement>('a'))?.focus({ preventScroll: true });
  }
}

export function firstSectionOf(partId: string | number): SectionRefStep | null {
  const k = treeIdx.parts.get(String(partId));
  if (k === undefined) return null;
  const find = (node: TreeNode): TreeNode | null => {
    for (const c of node.c || []) {
      if (c.t && LEAF_TYPES.has(c.t)) return c;
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  const leaf = find(treeIdx.nodes[k]);
  return leaf ? { id: String(leaf.id), label: (leaf.l || '').trim(), title: tocTitle(leaf) } : null;
}

export function docStepBtn(
  kind: 'part' | 'section' | 'clause' | 'appendix',
  dir: number,
  href: string,
  label: string,
  name?: string | null,
  labelHtml?: string,
): string {
  const prev = dir < 0;
  const what = `${prev ? 'Previous' : 'Next'} ${kind}`;
  const chevron = icon(prev ? 'chevronLeft' : 'chevronRight');
  const title = (name || '').trim();
  return `<a class="doc-step-btn is-${prev ? 'prev' : 'next'}" href="${href}" data-step="${kind}-${prev ? 'prev' : 'next'}" aria-label="${escapeHtml(`${what}: ${label}${title ? ' ' + title : ''}`)}">`
    + `${prev ? chevron : ''}<span class="step-label">${labelHtml || escapeHtml(label)}</span>${prev ? '' : chevron}`
    + `<span class="tip" aria-hidden="true"><span class="tip-kind">${what} · ${escapeHtml(label)}</span>${escapeHtml(title)}</span></a>`;
}

export function partNeighbors(partId: string | number): [TreeNode | null, TreeNode | null] {
  const list = treeIdx.partList as number[];
  const k = treeIdx.parts.get(String(partId));
  const i = k === undefined ? -1 : list.indexOf(k);
  if (i < 0) return [null, null];
  return [treeIdx.nodes[list[i - 1]] || null, treeIdx.nodes[list[i + 1]] || null];
}

export function docStepHtml(
  partId: string | number,
  prevSection: SectionRefStep | null | undefined,
  nextSection: SectionRefStep | null | undefined,
): string {
  const [prevPart, nextPart] = partNeighbors(partId);
  const partBtn = (node: TreeNode | null, dir: number) => node
    ? docStepBtn('part', dir, `#/part/${encodeURIComponent(String(node.id || ''))}`, `Part ${node.id || ''}`, node.d,
      `<span class="step-word">Part </span>${escapeHtml(node.id)}`)
    : '';
  const sectionBtn = (s: SectionRefStep | null | undefined, dir: number) => s
    ? docStepBtn('section', dir, `#/section/${encodeURIComponent(s.id)}`, s.label || s.id, s.title)
    : '';
  const sep = '<span class="doc-step-sep" aria-hidden="true"></span>';
  const left = [partBtn(prevPart, -1), sectionBtn(prevSection, -1)].filter(Boolean).join(sep);
  const right = [sectionBtn(nextSection, 1), partBtn(nextPart, 1)].filter(Boolean).join(sep);
  if (!left && !right) return '';
  return `<nav class="doc-step" aria-label="Previous and next">${left}<span class="spacer"></span>${right}</nav>`;
}
