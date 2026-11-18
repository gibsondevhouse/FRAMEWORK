import { state } from '../state';
import { cleanInlineLabel, escapeHtml, icon } from '../dom';
import { dom } from '../state_init';
import { scrollToAnchor } from './rail';
import { citePop, citePopEl, checkLocalCfrTarget, normalizeCfrTarget, openCfrDownloadCard, targetHashFor } from './cfr_resolver';
import { closeSplitPane, openSplitPane } from './split_pane';
import { findParagraphElement, highlightTarget, parseCfrHref } from '../views/doc_utils';

// --- Inline citation hover peeks + Alt+Click split & uninstalled link interception ---
const MAX_PEEK_CACHE = 40;
let hoverTimer = null;
let closeTimer = null;
let hoverTarget = null;
let hoverAbort = null;
let lastHoverContext = null; // { root, target, cfr }

function cancelHoverTimers() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  clearTimeout(closeTimer);
  closeTimer = null;
}

function scheduleCloseHover() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (citePop.isOpen() && !citePop.isInteractive()) {
      citePop.close(false);
    }
    hoverTarget = null;
  }, 180);
}

function cacheSet(key, val) {
  if (state.peekCache.has(key)) state.peekCache.delete(key);
  state.peekCache.set(key, val);
  if (state.peekCache.size > MAX_PEEK_CACHE) {
    const oldest = state.peekCache.keys().next().value;
    if (oldest !== undefined) state.peekCache.delete(oldest);
  }
}

function clipText(txt, max = 380) {
  const s = (txt || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

function extractBranchSnippet(root, paraEl) {
  if (!paraEl) return '';
  const all = [...root.querySelectorAll('.reg-p')];
  const idx = all.indexOf(paraEl);
  const lvlM = /\blvl-(\d+)\b/.exec(paraEl.className);
  const baseLvl = lvlM ? Number(lvlM[1]) : 0;
  const parts = [paraEl.textContent];
  if (idx >= 0 && baseLvl > 0 && paraEl.textContent.trim().length < 220) {
    for (let i = idx + 1; i < Math.min(all.length, idx + 3); i++) {
      const next = all[i];
      const m = /\blvl-(\d+)\b/.exec(next.className);
      const lvl = m ? Number(m[1]) : 0;
      if (lvl <= baseLvl) break;
      parts.push(next.textContent);
    }
  }
  return clipText(parts.join(' '), 440);
}

function renderLocalParaPeek(trigger, root) {
  const para = trigger.dataset.localPara || '';
  const hit = findParagraphElement(root, para);
  if (!hit) return null;
  const sec = root === dom.splitPane ? null : state.currentSection;
  const t = root === dom.splitPane ? (state.splitState?.title || state.currentTitle) : state.currentTitle;
  const secId = root === dom.splitPane ? (state.splitState?.sectionId || '') : (sec?.id || '');
  const snippet = extractBranchSnippet(root, hit);
  lastHoverContext = {
    root,
    jumpPara: para,
    split: secId ? { title: t, sectionId: secId, para } : null,
  };
  return `
    <div class="pop-head-row">
      <div class="pop-kicker">${secId ? `${t} CFR § ${escapeHtml(secId)} ` : ''}${escapeHtml(para)}</div>
      <span class="peek-badge">CLAUSE</span>
    </div>
    <p class="peek-text">${escapeHtml(snippet)}</p>
    <div class="peek-foot">
      <button type="button" class="btn btn-small" data-peek-jump="para">Jump to clause</button>
      ${secId ? '<button type="button" class="btn btn-small" data-peek-split="1">Open side-by-side</button>' : ''}
    </div>
  `;
}

function renderFootnotePeek(trigger, root) {
  const fnId = trigger.dataset.anchor;
  if (!fnId) return null;
  const fnEl = root.querySelector(`#${CSS.escape(fnId)}`) || document.getElementById(fnId);
  if (!fnEl) return null;
  const clone = fnEl.cloneNode(true);
  clone.querySelectorAll('.fn-back').forEach(b => b.remove());
  const txt = clipText(clone.textContent, 500);
  lastHoverContext = { root, jumpAnchor: fnId };
  return `
    <div class="pop-head-row">
      <div class="pop-kicker">Footnote ${escapeHtml(trigger.textContent.trim())}</div>
      <span class="peek-badge">FOOTNOTE</span>
    </div>
    <p class="peek-text">${escapeHtml(txt)}</p>
    <div class="peek-foot">
      <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to footnote</button>
    </div>
  `;
}

function renderAnchorPeek(trigger, root) {
  const anchorId = trigger.dataset.anchor;
  if (!anchorId) return null;
  const el = root.querySelector(`#${CSS.escape(anchorId)}`) || document.getElementById(anchorId);
  if (!el) return null;
  lastHoverContext = { root, jumpAnchor: anchorId };

  if (el.classList.contains('table-wrap')) {
    const caption = el.querySelector('caption')?.textContent?.trim() || trigger.textContent.trim();
    const table = el.querySelector('table');
    const headRows = [...(table?.querySelectorAll('thead tr') || [])].slice(0, 2);
    const bodyRows = [...(table?.querySelectorAll('tbody tr') || table?.querySelectorAll('tr') || [])]
      .filter(r => !r.closest('thead'))
      .slice(0, 4);
    const rowHtml = (r) => '<tr>' + [...r.children].slice(0, 4).map(cell => {
      const tag = cell.tagName.toLowerCase() === 'th' ? 'th' : 'td';
      return `<${tag}>${escapeHtml(clipText(cell.textContent, 48))}</${tag}>`;
    }).join('') + (r.children.length > 4 ? '<td>…</td>' : '') + '</tr>';

    return `
      <div class="pop-head-row">
        <div class="pop-kicker">${escapeHtml(clipText(caption, 90))}</div>
        <span class="peek-badge">TABLE</span>
      </div>
      <div class="peek-table-box">
        <table class="peek-table">
          ${headRows.length ? `<thead>${headRows.map(rowHtml).join('')}</thead>` : ''}
          <tbody>${bodyRows.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      <div class="peek-foot">
        <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to table</button>
      </div>
    `;
  }

  if (el.classList.contains('reg-figure')) {
    const img = el.querySelector('.reg-img');
    const caption = el.previousElementSibling?.classList.contains('reg-label')
      ? el.previousElementSibling.textContent.trim()
      : trigger.textContent.trim();
    return `
      <div class="pop-head-row">
        <div class="pop-kicker">${escapeHtml(caption)}</div>
        <span class="peek-badge">FIGURE</span>
      </div>
      ${img?.src ? `<div class="peek-fig-mat"><img class="peek-fig-img" src="${escapeHtml(img.src)}" alt="${escapeHtml(caption)}"></div>` : ''}
      <div class="peek-foot">
        <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to figure</button>
      </div>
    `;
  }

  if (el.classList.contains('reg-appendix')) {
    const head = el.querySelector('.reg-subhead, .reg-label')?.textContent?.trim() || trigger.textContent.trim();
    const para = clipText(el.querySelector('.reg-p')?.textContent || el.textContent, 360);
    return `
      <div class="pop-head-row">
        <div class="pop-kicker">${escapeHtml(clipText(head, 80))}</div>
        <span class="peek-badge">APPENDIX</span>
      </div>
      <p class="peek-text">${escapeHtml(para)}</p>
      <div class="peek-foot">
        <button type="button" class="btn btn-small" data-peek-jump="anchor">Jump to appendix</button>
      </div>
    `;
  }
  return null;
}

function renderExternalHintPeek(trigger) {
  const target = normalizeCfrTarget({
    title: trigger.dataset.cfrTitle,
    part: trigger.dataset.cfrPart,
    section: trigger.dataset.cfrSection,
    para: trigger.dataset.cfrPara,
    ecfrUrl: trigger.getAttribute('href'),
  });
  const label = target.section
    ? `${target.title} CFR § ${target.section}${target.para || ''}`
    : target.part
      ? `${target.title} CFR Part ${target.part}`
      : `Title ${target.title}`;
  const isPartial = state.installedTitles.some(t => t.title === target.title);
  const sub = isPartial
    ? `This ${target.section ? 'section' : 'part'} isn’t in your partial Title ${target.title} download yet.`
    : `Title ${target.title} is not installed yet.`;
  return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(label)}</div>
      <span class="peek-badge">UNINSTALLED</span>
    </div>
    <p class="peek-text">${escapeHtml(sub)} Click to download into the reader or open on eCFR.</p>
  `;
}

function renderUscPeek(trigger) {
  const href = trigger.getAttribute('href') || '';
  const m = /\/uscode\/text\/(\d+)\/([^/?#]+)/i.exec(href);
  const uscTitle = m ? m[1] : '';
  const uscSec = m ? m[2] : '';
  const titleAttr = trigger.getAttribute('title') || '';
  const kicker = uscTitle && uscSec ? `${uscTitle} U.S.C. § ${uscSec}` : cleanInlineLabel(trigger.textContent);
  return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(kicker)}</div>
      <span class="peek-badge">U.S. CODE</span>
    </div>
    <div class="peek-title">${escapeHtml(titleAttr || `Title ${uscTitle || ''} United States Code`)}</div>
    <p class="peek-text">Statutory authority codified in the United States Code. Click to inspect the enacted text on Cornell LII.</p>
  `;
}

function renderFrPeek(trigger) {
  const href = trigger.getAttribute('href') || '';
  const m = /\/citation\/(\d+)-FR-(\d+)/i.exec(href);
  const vol = m ? m[1] : '';
  const page = m ? m[2] : '';
  const kicker = vol && page ? `${vol} FR ${page}` : cleanInlineLabel(trigger.textContent);
  return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(kicker)}</div>
      <span class="peek-badge">FED. REGISTER</span>
    </div>
    <div class="peek-title">Federal Register Publication</div>
    <p class="peek-text">Rulemaking history, preamble, and final rule publication at Volume ${escapeHtml(vol || '—')}, page ${escapeHtml(page || '—')}.</p>
  `;
}

async function openSectionHrefPeek(trigger, root, parsed, rootTitle) {
  const pClause = parsed.para && /^\(([a-z])\)/i.exec(parsed.para.trim());
  const unitKey = parsed.unit === 'full' ? null : (parsed.unit || (pClause ? pClause[1].toLowerCase() : ''));
  const cacheKey = `${parsed.title}|${parsed.section}|${unitKey || 'full'}`;

  if (hoverAbort) {
    try { hoverAbort.abort(); } catch (e) { /* ignore */ }
  }
  hoverAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const sig = hoverAbort?.signal;

  let data = state.peekCache.get(cacheKey);
  if (!data) {
    const qs = unitKey === null ? '' : '?unit=' + encodeURIComponent(unitKey);
    try {
      const res = await fetch(`/api/${parsed.title}/section/${encodeURIComponent(parsed.section)}${qs}`, { signal: sig });
      if (!res.ok) return;
      data = await res.json();
      cacheSet(cacheKey, data);
    } catch (e) {
      return;
    }
  }
  if (hoverTarget !== trigger || (citePop.isOpen() && citePop.isInteractive())) return;

  const doc = new DOMParser().parseFromString(data.html || '', 'text/html');
  let snippet = '';
  if (parsed.para) {
    const hit = findParagraphElement(doc.body, parsed.para);
    if (hit) snippet = extractBranchSnippet(doc.body, hit);
  }
  if (!snippet) {
    const firstParas = [...doc.body.querySelectorAll('.reg-p, .reg-callout')].slice(0, 2);
    snippet = clipText(firstParas.map(p => p.textContent).join(' '), 420)
      || (data.reserved ? 'This section is reserved.' : '');
  }

  const label = cleanInlineLabel(data.label);
  const titleText = cleanInlineLabel(data.section_title || data.title_label || '');
  const href = trigger.getAttribute('href') || targetHashFor({ title: parsed.title, section: parsed.section, para: parsed.para });
  lastHoverContext = {
    root,
    split: { title: parsed.title, sectionId: parsed.section, para: parsed.para, unit: parsed.unit },
  };

  const isCross = Number(parsed.title) !== Number(rootTitle) || trigger.classList.contains('xref-cross');
  const tier = isCross ? 'cross' : 'cfr';
  citePop.open(trigger, `
    <div class="pop-head-row">
      <div class="pop-kicker">${parsed.title} CFR ${escapeHtml(label)}${parsed.para ? ' ' + escapeHtml(parsed.para) : ''}</div>
      <span class="peek-badge">${isCross ? `CROSS-TITLE · ${parsed.title} CFR` : `${parsed.title} CFR`}</span>
    </div>
    ${titleText ? `<div class="peek-title">${escapeHtml(titleText)}</div>` : ''}
    ${snippet ? `<p class="peek-text">${escapeHtml(snippet)}</p>` : ''}
    <div class="peek-foot">
      <a class="btn btn-small" href="${escapeHtml(href)}">Open</a>
      <button type="button" class="btn btn-small" data-peek-split="1">Open side-by-side</button>
    </div>
  `, { interactive: false, refTier: tier });
}

function renderIbrPeek(trigger, root) {
  const code = trigger.dataset.ibrCode;
  if (!code) return null;
  const t = root === dom.splitPane ? (state.splitState?.title || state.currentTitle) : state.currentTitle;
  const secId = root === dom.splitPane ? (state.splitState?.sectionId || '') : (state.currentSection?.id || '');
  const graph = secId ? state.graphCache.get(`${t}|${secId}`) : null;
  const item = graph?.ibr?.find(x => x.code === code);
  if (!item) return null;

  const app = item.approved_in;
  const appHref = app
    ? `#/title/${t}/section/${encodeURIComponent(app.section_id)}${app.para ? '?p=' + encodeURIComponent(app.para) : ''}`
    : '';
  lastHoverContext = app
    ? { root, split: { title: t, sectionId: app.section_id, para: app.para || null } }
    : null;

  return `
    <div class="pop-head-row">
      <div class="pop-kicker">${escapeHtml(item.code)}</div>
      <span class="peek-badge">IBR · ${escapeHtml(item.org)}</span>
    </div>
    ${item.org_name ? `<div class="peek-title">${escapeHtml(item.org_name)}</div>` : ''}
    ${app
      ? `<p class="peek-text"><strong>${item.exact ? 'IBR approved' : 'Closest approved edition'} in ${escapeHtml(app.label)}${escapeHtml(app.para || '')}:</strong> ${escapeHtml(app.excerpt)}</p>`
      : `<p class="peek-text">Consensus technical standard published by ${escapeHtml(item.org_name || item.org)}.</p>`}
    <div class="peek-foot">
      ${app ? `<a class="btn btn-small" href="${escapeHtml(appHref)}">Open ${escapeHtml(app.label)}</a>` : ''}
      ${app ? '<button type="button" class="btn btn-small" data-peek-split="1">Open side-by-side</button>' : ''}
      ${item.org_url ? `<a class="btn btn-small" href="${escapeHtml(item.org_url)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${escapeHtml(item.org)}</a>` : ''}
    </div>
  `;
}


function getPeekTrigger(el) {
  return el.closest?.('a.xref-local[data-local-para], .ftref[data-anchor], button.xref-anchor[data-anchor], button.xref-ibr[data-ibr-code], a.xref-external[data-cfr-title], a.xref-usc, a.xref-fr, a.xref[href], a.xref-cross[href], a.citation-chip[href*="/section/"]') || null;
}

function handleHoverOver(e, root) {
  if (citePop.isOpen() && citePop.isInteractive()) return;
  if (e.sourceCapabilities?.firesTouchEvents) return;
  if ((window.getSelection()?.toString() || '').trim().length > 0) return;
  const trigger = getPeekTrigger(e.target);
  if (!trigger || !root.contains(trigger)) return;
  if (trigger === hoverTarget) {
    clearTimeout(closeTimer);
    closeTimer = null;
    return;
  }

  cancelHoverTimers();
  hoverTarget = trigger;
  const rootTitle = root === dom.splitPane ? (state.splitState?.title || state.currentTitle) : state.currentTitle;

  hoverTimer = setTimeout(() => {
    if (hoverTarget !== trigger || (citePop.isOpen() && citePop.isInteractive())) return;

    if (trigger.matches('a.xref-local[data-local-para]')) {
      const html = renderLocalParaPeek(trigger, root);
      if (html) citePop.open(trigger, html, { interactive: false, refTier: 'local' });
      return;
    }
    if (trigger.matches('.ftref[data-anchor]')) {
      const html = renderFootnotePeek(trigger, root);
      if (html) citePop.open(trigger, html, { interactive: false, refTier: 'local' });
      return;
    }
    if (trigger.matches('button.xref-anchor[data-anchor]')) {
      const html = renderAnchorPeek(trigger, root);
      if (html) citePop.open(trigger, html, { interactive: false, refTier: 'local' });
      return;
    }
    if (trigger.matches('button.xref-ibr[data-ibr-code]')) {
      const html = renderIbrPeek(trigger, root);
      if (html) citePop.open(trigger, html, { interactive: false, refTier: 'ibr' });
      return;
    }
    if (trigger.matches('a.xref-external[data-cfr-title]')) {
      lastHoverContext = null;
      citePop.open(trigger, renderExternalHintPeek(trigger), { interactive: false, refTier: 'uninstalled' });
      return;
    }
    if (trigger.matches('a.xref-usc')) {
      lastHoverContext = null;
      citePop.open(trigger, renderUscPeek(trigger), { interactive: false, refTier: 'usc' });
      return;
    }
    if (trigger.matches('a.xref-fr')) {
      lastHoverContext = null;
      citePop.open(trigger, renderFrPeek(trigger), { interactive: false, refTier: 'fr' });
      return;
    }
    if (trigger.matches('a[href^="#"]')) {
      const parsed = parseCfrHref(trigger.getAttribute('href'), rootTitle);
      if (parsed && parsed.kind === 'section') {
        openSectionHrefPeek(trigger, root, parsed, rootTitle);
      }
    }
  }, 250);
}

function handleHoverOut(e) {
  if (!hoverTarget) return;
  const related = e.relatedTarget;
  if (related && (hoverTarget.contains(related) || citePopEl?.contains(related))) return;
  clearTimeout(hoverTimer);
  hoverTimer = null;
  if (!citePop.isInteractive()) scheduleCloseHover();
}

for (const root of [dom.view, dom.splitPane].filter(Boolean)) {
  root.addEventListener('mouseover', (e) => handleHoverOver(e, root));
  root.addEventListener('mouseout', handleHoverOut);
  root.addEventListener('click', (e) => {
    const ibrBtn = e.target.closest('button.xref-ibr[data-ibr-code]');
    if (!ibrBtn || !root.contains(ibrBtn)) return;
    const html = renderIbrPeek(ibrBtn, root);
    if (html) {
      e.preventDefault();
      cancelHoverTimers();
      citePop.open(ibrBtn, html, { interactive: true, returnFocus: ibrBtn, refTier: 'ibr' });
    }
  });
}

if (dom.citePop) {
  dom.citePop.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    closeTimer = null;
  });
  dom.citePop.addEventListener('mouseleave', () => {
    if (!citePop.isInteractive()) scheduleCloseHover();
  });
  dom.citePop.addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('[data-peek-jump]');
    if (jumpBtn && lastHoverContext) {
      const ctx = lastHoverContext;
      citePop.close(false);
      if (jumpBtn.dataset.peekJump === 'para' && ctx.jumpPara) {
        highlightTarget(ctx.root, ctx.jumpPara, 0);
      } else if (jumpBtn.dataset.peekJump === 'anchor' && ctx.jumpAnchor) {
        scrollToAnchor(ctx.jumpAnchor, ctx.root);
      }
      return;
    }
    const splitBtn = e.target.closest('[data-peek-split]');
    if (splitBtn && lastHoverContext?.split) {
      const sp = lastHoverContext.split;
      citePop.close(false);
      openSplitPane({ ...sp, pushHistory: true });
      return;
    }
    if (e.target.closest('a[href^="#"]')) {
      citePop.close(false);
    }
  });
}

// Click interception on main view, split pane, and sidebar tree:
// - Normal click on uninstalled CFR links (`a.xref-external[data-cfr-title]`) opens Download Micro-Card
// - Alt/Option+Click on any section link or local paragraph opens Side-by-Side Split View
async function handleCfrLinkClick(e, root) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const link = e.target.closest('a');
  if (!link || !root.contains(link)) return;

  const isSplitChild = root === dom.splitPane;
  const rootTitle = isSplitChild ? (state.splitState?.title || state.currentTitle) : state.currentTitle;

  if (link.matches('a.xref-external[data-cfr-title]')) {
    e.preventDefault();
    cancelHoverTimers();
    const target = normalizeCfrTarget({
      title: link.dataset.cfrTitle,
      part: link.dataset.cfrPart,
      section: link.dataset.cfrSection,
      para: link.dataset.cfrPara,
      ecfrUrl: link.getAttribute('href'),
    });
    const status = await checkLocalCfrTarget(target);
    if (status.installed) {
      if ((e.altKey || isSplitChild) && target.section) {
        openSplitPane({ title: target.title, sectionId: target.section, para: target.para, pushHistory: true });
      } else {
        if (isSplitChild && !e.altKey) closeSplitPane();
        window.location.hash = targetHashFor(target);
      }
      return;
    }
    openCfrDownloadCard(link, target, { openInSplit: e.altKey || isSplitChild });
    return;
  }

  if (!e.altKey) return;

  if (link.matches('a.xref-local[data-local-para]')) {
    const secId = isSplitChild ? state.splitState?.sectionId : state.currentSection?.id;
    if (secId) {
      e.preventDefault();
      cancelHoverTimers();
      openSplitPane({ title: rootTitle, sectionId: secId, para: link.dataset.localPara, pushHistory: true });
    }
    return;
  }

  const parsed = parseCfrHref(link.getAttribute('href'), rootTitle);
  if (parsed && parsed.kind === 'section') {
    e.preventDefault();
    cancelHoverTimers();
    openSplitPane({
      title: parsed.title,
      sectionId: parsed.section,
      para: parsed.para,
      unit: parsed.unit,
      pushHistory: true,
    });
  }
}

for (const root of [dom.view, dom.splitPane, dom.tree].filter(Boolean)) {
  root.addEventListener('click', (e) => handleCfrLinkClick(e, root));
}
