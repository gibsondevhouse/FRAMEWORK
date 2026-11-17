import { escapeHtml, icon, reduceMotion } from '../dom';
import { dom } from '../state_init';

// --- Shared document helpers: figure lightbox, anchor resolution, paragraph highlighting, in-DOM auto-linking ---
const figModal = document.getElementById('figure-modal');
let figReturnFocus = null;

export function closeFigureModal() {
  if (!figModal || figModal.hidden) return;
  figModal.hidden = true;
  const dialog = figModal.querySelector('.modal-dialog');
  if (dialog) dialog.innerHTML = '';
  if (figReturnFocus && typeof figReturnFocus.focus === 'function') figReturnFocus.focus();
  figReturnFocus = null;
}

export function openFigureModal(figLink) {
  if (!figModal || !figLink) return;
  const img = figLink.querySelector('.reg-img');
  const fullSrc = figLink.getAttribute('href') || (img && img.src) || '';
  if (!fullSrc) return;
  figReturnFocus = document.activeElement;
  const caption = figLink.previousElementSibling?.classList.contains('reg-label')
    ? figLink.previousElementSibling.textContent.trim()
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
  document.getElementById('fig-close-btn')?.focus();
}

if (figModal) {
  figModal.addEventListener('click', (e) => {
    if (e.target === figModal || e.target.closest('#fig-close-btn')) {
      closeFigureModal();
      return;
    }
    const inv = e.target.closest('#fig-invert-btn');
    if (inv) {
      const stage = figModal.querySelector('.fig-modal-stage');
      if (!stage) return;
      const on = !stage.classList.contains('is-inverted');
      stage.classList.toggle('is-inverted', on);
      inv.setAttribute('aria-pressed', String(on));
    }
  });
  figModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeFigureModal(); }
  });
  window.addEventListener('hashchange', closeFigureModal);
}


export function findParagraphElement(root, pText) {
  if (!root) return null;
  const clean = (pText || '').trim();
  if (!clean) return null;
  const paras = [...root.querySelectorAll('.reg-p')];
  for (const p of paras) {
    const pm = p.querySelector('.pmark');
    if (pm && pm.textContent.includes(clean)) return p;
  }
  const tokens = clean.match(/\([a-zA-Z0-9]{1,4}\)/g);
  if (!tokens || !tokens.length) return null;

  let ti = 0;
  let lastMatched = null;
  let minLevel = 0;
  for (const p of paras) {
    const lvlMatch = /\blvl-(\d+)\b/.exec(p.className);
    const lvl = lvlMatch ? Number(lvlMatch[1]) : 0;
    const pm = p.querySelector('.pmark');
    if (!pm) continue;
    const pTokens = pm.textContent.match(/\([a-zA-Z0-9]{1,4}\)/g) || [];
    if (!pTokens.length) continue;

    if (ti > 0 && lvl > 0 && lvl <= minLevel) {
      if (lvl === 1 && tokens[0].toLowerCase() !== pTokens[0].toLowerCase()) {
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


export function findParagraphRange(root, pText) {
  const clean = (pText || '').trim();
  if (!clean || !root) return [];
  const rangeM = /^\s*((?:\([a-zA-Z0-9]{1,4}\))+)\s*(?:-|–|through|to)\s*((?:\([a-zA-Z0-9]{1,4}\))+)\s*$/i.exec(clean);
  if (rangeM) {
    const startEl = findParagraphElement(root, rangeM[1]);
    const endEl = findParagraphElement(root, rangeM[2]);
    if (startEl && endEl) {
      const paras = [...root.querySelectorAll('.reg-p')];
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


export function resolveAnchorTargets(root, target) {
  if (!root || !target) return [];
  const clean = String(target).trim();
  if (!clean) return [];
  const bareId = clean.startsWith('#') ? clean.slice(1) : clean;
  if (/^(table|fig|figure|appendix|fn|ftref|sec|p)-?[a-zA-Z0-9_.\-]+$/i.test(bareId)) {
    try {
      const el = root.querySelector(`#${CSS.escape(bareId)}`);
      if (el) return [el];
    } catch (e) { /* invalid selector fallback */ }
  }
  return findParagraphRange(root, clean);
}


export function flashElements(els, scroll = true) {
  if (!els || !els.length) return;
  for (const el of els) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  if (scroll) {
    els[0].scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
  }
}


export function highlightTarget(root, target, delay = 120) {
  setTimeout(() => {
    const hits = resolveAnchorTargets(root, target);
    flashElements(hits, true);
  }, delay);
}


function slugifyAnchor(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}


export function enhanceDomAnchors(root = dom.view) {
  if (!root) return;
  const targets = new Map();

  // Assign deterministic figure IDs when preceded by a "Figure X" caption label.
  let figSeq = 0;
  for (const fig of root.querySelectorAll('.reg-figure')) {
    const cap = fig.previousElementSibling?.classList.contains('reg-label')
      ? fig.previousElementSibling.textContent.trim()
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

  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const textNode of nodes) {
    const val = textNode.nodeValue || '';
    re.lastIndex = 0;
    if (!re.test(val)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match;
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
    textNode.parentNode.replaceChild(frag, textNode);
  }
}


export function resolveParagraphPath(root, paraEl) {
  if (!root || !paraEl) return '';
  const pm = paraEl.querySelector('.pmark');
  if (!pm) return '';
  const firstTok = (pm.textContent || '').match(/\([a-zA-Z0-9]{1,4}\)/g) || [];
  if (!firstTok.length) return '';
  // If pmark already starts at full hierarchical tuple (e.g. "(c)(1)(ii)"), keep it directly.
  if (firstTok.length > 1) return firstTok.join('');
  const lvlMatch = /\blvl-(\d+)\b/.exec(paraEl.className);
  let targetLvl = lvlMatch ? Number(lvlMatch[1]) : 0;
  if (targetLvl <= 1) return firstTok[0];

  const paras = [...root.querySelectorAll('.reg-p')];
  let idx = paras.indexOf(paraEl);
  if (idx < 0) return firstTok[0];
  const chain = [firstTok[0]];
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


export function formatCfrCitation(title, sectionLabelOrId, para = '') {
  const cleanLabel = String(sectionLabelOrId || '').trim();
  const numPart = cleanLabel.startsWith('§') ? cleanLabel : `§ ${cleanLabel}`;
  return `${title} C.F.R. ${numPart}${para || ''}`;
}


export function wrapIbrMentions(root, ibrList) {
  if (!root || !Array.isArray(ibrList) || !ibrList.length) return;
  const byMatch = new Map();
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
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  for (const textNode of nodes) {
    const val = textNode.nodeValue || '';
    re.lastIndex = 0;
    if (!re.test(val)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let match;
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
    textNode.parentNode.replaceChild(frag, textNode);
  }
}


export function renderViewError(container, title, message, { retryLabel = 'Try again', onRetry = null } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      ${onRetry ? `<button type="button" class="btn" id="view-err-retry">${escapeHtml(retryLabel)}</button>` : ''}
    </div>
  `;
  if (onRetry) {
    document.getElementById('view-err-retry')?.addEventListener('click', onRetry);
  }
}


export function parseCfrHref(href, fallbackTitle = 29) {
  if (!href) return null;
  if (href.startsWith('#')) {
    const [pathPart, qs] = href.slice(1).split('?');
    const params = new URLSearchParams(qs || '');
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
