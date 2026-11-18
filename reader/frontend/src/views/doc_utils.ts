import { IbrMatch } from '../state';
import {
  cleanInlineLabel, copyText, escapeHtml, icon, safeHttpUrl,
  setModalBackgroundInert, smoothScrollToTarget, trapFocusKeydown,
} from '../dom';
import { clipToWorkspace, WorkspaceSectionRef } from '../core/projects_store';
import { emptyStateHtml } from '../components/ui';
import { dom } from '../state_init';

const figModal = typeof document !== 'undefined' ? document.getElementById('figure-modal') : null;
let figReturnFocus: Element | null = null;

export function closeFigureModal(): void {
  if (!figModal || figModal.hidden) return;
  figModal.hidden = true;
  setModalBackgroundInert(false);
  const dialog = figModal.querySelector('.modal-dialog');
  if (dialog) dialog.innerHTML = '';
  if (figReturnFocus && 'focus' in figReturnFocus && typeof (figReturnFocus as HTMLElement).focus === 'function') {
    (figReturnFocus as HTMLElement).focus();
  }
  figReturnFocus = null;
}

export function openFigureModal(figLink: Element | null | undefined): void {
  if (!figModal || !figLink) return;
  const img = figLink.querySelector<HTMLImageElement>('.reg-img');
  const rawFullSrc = figLink.getAttribute('href') || (img && img.src) || '';
  const fullSrc = safeHttpUrl(rawFullSrc);
  if (!fullSrc) return;
  figReturnFocus = document.activeElement;
  const caption = figLink.previousElementSibling?.classList.contains('reg-label')
    ? (figLink.previousElementSibling.textContent || '').trim()
    : 'Regulatory Figure';
  const dialog = figModal.querySelector('.modal-dialog');
  if (!dialog) return;
  dialog.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="doc-kicker">Figure preview</div>
        <h2 class="modal-title" id="fig-modal-title">${escapeHtml(caption)}</h2>
      </div>
      <div class="fig-modal-acts">
        <button type="button" class="btn btn-sm" id="fig-invert-btn" aria-pressed="false">Invert contrast</button>
        <a class="btn btn-sm" href="${escapeHtml(fullSrc)}" target="_blank" rel="noopener noreferrer">${icon('external')} Full image</a>
        <button type="button" class="icon-btn" id="fig-close-btn" aria-label="Close preview">${icon('close')}</button>
      </div>
    </div>
    <div class="fig-modal-stage">
      <img src="${escapeHtml(fullSrc)}" alt="${escapeHtml(caption)}" id="fig-modal-img">
    </div>
  `;
  figModal.hidden = false;
  setModalBackgroundInert(true);
  document.getElementById('fig-close-btn')?.focus();
}

if (figModal) {
  figModal.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (e.target === figModal || t?.closest('#fig-close-btn')) {
      closeFigureModal();
      return;
    }
    const inv = t?.closest('#fig-invert-btn');
    if (inv) {
      const stage = figModal.querySelector('.fig-modal-stage');
      if (!stage) return;
      const on = !stage.classList.contains('is-inverted');
      stage.classList.toggle('is-inverted', on);
      inv.setAttribute('aria-pressed', String(on));
    }
  });
  figModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeFigureModal(); return; }
    trapFocusKeydown(figModal.querySelector('.modal-dialog'), e);
  });
  window.addEventListener('hashchange', closeFigureModal);
}

export function findParagraphElement(root: Element | null | undefined, pText: string | null | undefined): HTMLElement | null {
  if (!root) return null;
  const clean = (pText || '').trim();
  if (!clean) return null;
  const paras = [...root.querySelectorAll<HTMLElement>('.reg-p')];
  for (const p of paras) {
    const pm = p.querySelector('.pmark');
    if (pm && (pm.textContent || '').includes(clean)) return p;
  }
  const tokens = clean.match(/\([a-zA-Z0-9]{1,4}\)/g);
  if (!tokens || !tokens.length) return null;

  let ti = 0;
  let lastMatched: HTMLElement | null = null;
  let minLevel = 0;
  for (const p of paras) {
    const lvlMatch = /\blvl-(\d+)\b/.exec(p.className);
    const lvl = lvlMatch ? Number(lvlMatch[1]) : 0;
    const pm = p.querySelector('.pmark');
    if (!pm) continue;
    const pTokens = (pm.textContent || '').match(/\([a-zA-Z0-9]{1,4}\)/g) || [];
    if (!pTokens.length) continue;

    if (ti > 0 && lvl > 0 && lvl <= minLevel) {
      if (lvl === 1 && tokens[0].toLowerCase() !== (pTokens[0] || '').toLowerCase()) {
        ti = 0;
        minLevel = 0;
      }
    }
    let matchedHere = 0;
    let tempIdx = ti;
    for (const pt of pTokens) {
      if (tempIdx < tokens.length && pt.toLowerCase() === tokens[tempIdx].toLowerCase()) {
        tempIdx++;
        matchedHere++;
      } else {
        break;
      }
    }
    if (matchedHere > 0 && (ti === 0 || lvl > minLevel)) {
      ti = tempIdx;
      minLevel = lvl;
      lastMatched = p;
      if (ti === tokens.length) return p;
    }
  }
  return lastMatched;
}

export function findParagraphRange(root: Element | null | undefined, pText: string): HTMLElement[] {
  const clean = (pText || '').trim();
  if (!clean || !root) return [];
  const rangeM = /^\s*((?:\([a-zA-Z0-9]{1,4}\))+)\s*(?:-|–|through|to)\s*((?:\([a-zA-Z0-9]{1,4}\))+)\s*$/i.exec(clean);
  if (rangeM) {
    const startEl = findParagraphElement(root, rangeM[1]);
    const endEl = findParagraphElement(root, rangeM[2]);
    if (startEl && endEl) {
      const paras = [...root.querySelectorAll<HTMLElement>('.reg-p')];
      const i1 = paras.indexOf(startEl);
      const i2 = paras.indexOf(endEl);
      if (i1 >= 0 && i2 >= i1 && i2 - i1 < 16) return paras.slice(i1, i2 + 1);
      return [startEl];
    }
    if (startEl) return [startEl];
  }
  const hit = findParagraphElement(root, clean);
  return hit ? [hit] : [];
}

export function resolveAnchorTargets(root: Element | null | undefined, target: string): HTMLElement[] {
  if (!root || !target) return [];
  const clean = String(target).trim();
  if (!clean) return [];
  const bareId = clean.startsWith('#') ? clean.slice(1) : clean;
  if (/^(table|fig|figure|appendix|fn|ftref|sec|p)-?[a-zA-Z0-9_.\-]+$/i.test(bareId)) {
    try {
      const el = root.querySelector<HTMLElement>(`#${CSS.escape(bareId)}`);
      if (el) return [el];
    } catch { /* invalid selector fallback */ }
  }
  return findParagraphRange(root, clean);
}

export function flashElements(els: HTMLElement[], scroll = true): void {
  if (!els || !els.length) return;
  for (const el of els) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  if (scroll) {
    smoothScrollToTarget(els[0], { block: 'center' });
  }
}

export function highlightTarget(root: Element | null | undefined, target: string, delay = 120): void {
  setTimeout(() => {
    const hits = resolveAnchorTargets(root, target);
    flashElements(hits, true);
  }, delay);
}

function slugifyAnchor(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function enhanceDomAnchors(root: Element | null = dom.view): void {
  if (!root) return;
  const targets = new Map<string, { label: string; id: string }>();

  let figSeq = 0;
  for (const fig of root.querySelectorAll('.reg-figure')) {
    const cap = fig.previousElementSibling?.classList.contains('reg-label')
      ? (fig.previousElementSibling.textContent || '').trim()
      : '';
    const m = /^\s*(Figure\s+[A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\b/i.exec(cap);
    if (!fig.id) {
      figSeq++;
      const base = m ? `fig-${slugifyAnchor(m[1].replace(/^figure\s+/i, ''))}` : `fig-${figSeq}`;
      let id = base;
      let n = 2;
      while (root.querySelector(`#${CSS.escape(id)}`)) {
        id = `${base}-${n++}`;
      }
      fig.id = id;
    }
    if (m) targets.set(m[1].toLowerCase(), { label: m[1], id: fig.id });
  }

  for (const w of root.querySelectorAll('.table-wrap[id^="table-"]')) {
    const cap = w.querySelector('caption')?.textContent || '';
    const m = /^\s*(Table\s+[A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\b/i.exec(cap);
    if (m) targets.set(m[1].toLowerCase(), { label: m[1], id: w.id });
  }

  for (const appEl of root.querySelectorAll('.reg-appendix[id^="appendix-"]')) {
    const head = appEl.querySelector('.reg-subhead, .reg-label, .reg-p')?.textContent || '';
    const m = /^\s*(Appendix\s+[A-Z0-9]+(?:[.\-][A-Z0-9]+)*)\b/i.exec(head);
    if (m) targets.set(m[1].toLowerCase(), { label: m[1], id: appEl.id });
  }

  if (!targets.size) return;
  const pattern = [...targets.keys()].map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(${pattern})\\b`, 'gi');

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !parent.closest('.reg-body') || parent.closest('a, button, caption, .reg-table')) {
        return NodeFilter.FILTER_REJECT;
      }
      const txt = node.nodeValue || '';
      return /(?:table|figure|appendix)/i.test(txt) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const nodes: Node[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const textNode of nodes) {
    const val = textNode.nodeValue || '';
    re.lastIndex = 0;
    if (!re.test(val)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(val)) !== null) {
      if (match.index > last) frag.appendChild(document.createTextNode(val.slice(last, match.index)));
      const hit = targets.get(match[1].toLowerCase());
      if (hit) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xref xref-anchor';
        btn.dataset.anchor = hit.id;
        btn.textContent = match[0];
        frag.appendChild(btn);
      } else {
        frag.appendChild(document.createTextNode(match[0]));
      }
      last = match.index + match[0].length;
    }
    if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

export function resolveParagraphPath(root: Element | null | undefined, paraEl: Element | null | undefined): string {
  if (!root || !paraEl) return '';
  const pm = paraEl.querySelector('.pmark');
  if (!pm) return '';
  const firstTok = (pm.textContent || '').match(/\([a-zA-Z0-9]{1,4}\)/g) || [];
  if (!firstTok.length) return '';
  if (firstTok.length > 1) return firstTok.join('');
  const lvlMatch = /\blvl-(\d+)\b/.exec(paraEl.className);
  let targetLvl = lvlMatch ? Number(lvlMatch[1]) : 0;
  if (targetLvl <= 1) return firstTok[0] || '';

  const paras = [...root.querySelectorAll('.reg-p')];
  const idx = paras.indexOf(paraEl);
  if (idx < 0) return firstTok[0] || '';
  const chain: string[] = firstTok[0] ? [firstTok[0]] : [];
  for (let i = idx - 1; i >= 0 && targetLvl > 1; i--) {
    const p = paras[i];
    const lm = /\blvl-(\d+)\b/.exec(p.className);
    const lvl = lm ? Number(lm[1]) : 0;
    if (lvl > 0 && lvl < targetLvl) {
      const pMark = p.querySelector('.pmark')?.textContent || '';
      const toks = pMark.match(/\([a-zA-Z0-9]{1,4}\)/g);
      if (toks && toks.length) {
        chain.unshift(...toks);
        targetLvl = lvl;
      }
    }
  }
  return chain.join('');
}

export function formatCfrCitation(title: number | string, sectionLabelOrId: string, para = ''): string {
  const cleanLabel = String(sectionLabelOrId || '').trim();
  const numPart = cleanLabel.startsWith('§') ? cleanLabel : `§ ${cleanLabel}`;
  return `${title} C.F.R. ${numPart}${para || ''}`;
}

export function wrapIbrMentions(root: Element | null | undefined, ibrList: IbrMatch[]): void {
  if (!root || !Array.isArray(ibrList) || !ibrList.length) return;
  const byMatch = new Map<string, IbrMatch>();
  for (const item of ibrList) {
    if (!item || !item.match_text) continue;
    byMatch.set(item.match_text.toLowerCase(), item);
    if (item.code) byMatch.set(item.code.toLowerCase(), item);
  }
  if (!byMatch.size) return;
  const escaped = [...byMatch.keys()]
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(`(${escaped})`, 'gi');

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !parent.closest('.reg-body') || parent.closest('a, button, .pmark, .runin')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Node[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const textNode of nodes) {
    const val = textNode.nodeValue || '';
    re.lastIndex = 0;
    if (!re.test(val)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(val)) !== null) {
      if (match.index > last) frag.appendChild(document.createTextNode(val.slice(last, match.index)));
      const item = byMatch.get(match[1].toLowerCase());
      if (item) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'xref xref-ibr';
        btn.dataset.ibrCode = item.code;
        btn.title = item.approved_in
          ? `${item.code} — IBR approved in ${item.approved_in.label}${item.approved_in.para || ''}`
          : `${item.code} (${item.org_name || item.org})`;
        btn.textContent = match[0];
        frag.appendChild(btn);
      } else {
        frag.appendChild(document.createTextNode(match[0]));
      }
      last = match.index + match[0].length;
    }
    if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

export function renderViewError(
  container: Element | null | undefined,
  title: string,
  message: string,
  { retryLabel = 'Try again', onRetry = null }: { retryLabel?: string; onRetry?: (() => void) | null } = {},
): void {
  if (!container) return;
  container.innerHTML = emptyStateHtml({
    title,
    body: escapeHtml(message),
    actionsHtml: onRetry ? `<button type="button" class="btn" id="view-err-retry">${escapeHtml(retryLabel)}</button>` : '',
  });
  if (onRetry) {
    document.getElementById('view-err-retry')?.addEventListener('click', onRetry);
  }
}

export type ParsedCfrHref =
  | { kind: 'section'; title: number; section: string; unit: string | null; para: string | null }
  | { kind: 'part'; title: number; part: string };

export function parseCfrHref(href: string | null | undefined, fallbackTitle = 29): ParsedCfrHref | null {
  if (!href) return null;
  if (href.startsWith('#')) {
    const [pathPart, qs] = href.slice(1).split('?');
    const params = new URLSearchParams(qs || '');
    const mCorpusSec = /^\/corpus\/(?:federal-reg|cfr)\/[^/]+\/(\d+)\/section\/([^/]+)(?:\/([^/]+))?$/.exec(pathPart);
    if (mCorpusSec) {
      return {
        kind: 'section',
        title: parseInt(mCorpusSec[1], 10),
        section: decodeURIComponent(mCorpusSec[2]),
        unit: mCorpusSec[3] ? decodeURIComponent(mCorpusSec[3]) : null,
        para: params.get('p') || null,
      };
    }
    const mTitleSec = /^\/title\/(\d+)\/section\/([^/]+)(?:\/([^/]+))?$/.exec(pathPart);
    if (mTitleSec) {
      return {
        kind: 'section',
        title: parseInt(mTitleSec[1], 10),
        section: decodeURIComponent(mTitleSec[2]),
        unit: mTitleSec[3] ? decodeURIComponent(mTitleSec[3]) : null,
        para: params.get('p') || null,
      };
    }
    const mSec = /^\/section\/([^/]+)(?:\/([^/]+))?$/.exec(pathPart);
    if (mSec) {
      return {
        kind: 'section',
        title: fallbackTitle,
        section: decodeURIComponent(mSec[1]),
        unit: mSec[2] ? decodeURIComponent(mSec[2]) : null,
        para: params.get('p') || null,
      };
    }
    const mCorpusPart = /^\/corpus\/(?:federal-reg|cfr)\/[^/]+\/(\d+)\/part\/([^/]+)$/.exec(pathPart);
    if (mCorpusPart) {
      return {
        kind: 'part',
        title: parseInt(mCorpusPart[1], 10),
        part: decodeURIComponent(mCorpusPart[2]),
      };
    }
    const mTitlePart = /^\/title\/(\d+)\/part\/([^/]+)$/.exec(pathPart);
    if (mTitlePart) {
      return {
        kind: 'part',
        title: parseInt(mTitlePart[1], 10),
        part: decodeURIComponent(mTitlePart[2]),
      };
    }
    const mPart = /^\/part\/([^/]+)$/.exec(pathPart);
    if (mPart) {
      return {
        kind: 'part',
        title: fallbackTitle,
        part: decodeURIComponent(mPart[1]),
      };
    }
  }
  return null;
}

export function bindBrokenImageFallback(root: Element | null | undefined, getEcfrUrl?: () => string): void {
  if (!root) return;
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('reg-img')) return;
    const fig = img.closest<HTMLAnchorElement>('.reg-figure');
    if (!fig || fig.classList.contains('is-broken')) return;
    fig.classList.add('is-broken');
    const url = safeHttpUrl(getEcfrUrl?.() || '');
    if (url) fig.href = url;
    fig.title = 'This figure is only available on eCFR';
    fig.innerHTML = `${icon('external')}<span>Figure — view on eCFR</span>`;
  }, true);
}

export function createParaToolsController({
  root,
  bodySelector = '.reg-body',
  paraSelector = '.reg-body .reg-p[id]',
  isActive,
  getSectionRef,
}: {
  root: Element | null | undefined;
  bodySelector?: string;
  paraSelector?: string;
  isActive: () => boolean;
  getSectionRef: () => WorkspaceSectionRef | null;
}) {
  let bar: HTMLDivElement | null = null;
  let target: Element | null = null;

  const hide = () => {
    if (bar) bar.hidden = true;
    target = null;
  };

  const show = (pEl: Element) => {
    if (!root?.querySelector(bodySelector) || !pEl?.querySelector('.pmark')) {
      hide();
      return;
    }
    if (!bar || !bar.isConnected) {
      bar = document.createElement('div');
      bar.className = 'para-tools';
      bar.setAttribute('aria-label', 'Paragraph actions');
      bar.innerHTML = `
        <button type="button" class="para-tool-btn" data-para-act="copy" title="Copy legal CFR citation">${icon('link')} Cite</button>
        <button type="button" class="para-tool-btn" data-para-act="clip" title="Clip clause to workspace">${icon('bookmark')} Clip</button>
      `;
    }
    target = pEl;
    bar.hidden = false;
    pEl.appendChild(bar);
  };

  if (root) {
    root.addEventListener('mouseover', (e) => {
      if (!isActive()) return;
      const t = e.target as Element | null;
      if (bar && t && bar.contains(t)) return;
      const p = t?.closest(paraSelector);
      if (p && p.querySelector('.pmark')) {
        if (p !== target) show(p);
      } else {
        hide();
      }
    });
    root.addEventListener('mouseleave', hide);
  }

  const handleClick = async (e: Event): Promise<boolean> => {
    const btn = (e.target as Element | null)?.closest<HTMLElement>('.para-tool-btn[data-para-act]');
    if (!btn || !target || !isActive()) return false;
    e.preventDefault();
    e.stopPropagation();
    const ref = getSectionRef();
    if (!ref) return true;
    const para = resolveParagraphPath(root, target);
    const label = cleanInlineLabel(ref.label);
    const cite = formatCfrCitation(ref.title, label, para);
    if (btn.dataset.paraAct === 'copy') {
      await copyText(cite, `Copied ${cite}`, 'Couldn’t copy citation');
    } else if (btn.dataset.paraAct === 'clip') {
      const clone = target.cloneNode(true) as Element;
      clone.querySelectorAll('.para-tools').forEach(x => x.remove());
      clipToWorkspace(ref, { para, quote: (clone.textContent || '').trim().slice(0, 320), cite });
    }
    return true;
  };

  return { hide, handleClick };
}
