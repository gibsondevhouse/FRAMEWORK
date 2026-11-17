import { state } from '../state';
import { cleanInlineLabel, escapeHtml, icon, skeletonHtml } from '../dom';
import { scrollToAnchor, unitShort } from './rail';
import { dom } from '../state_init';
import { enhanceDomAnchors, highlightTarget, openFigureModal, parseCfrHref, wrapIbrMentions } from '../views/doc_utils';

// --- Secondary side-by-side reference pane inside .main-stage ---
let splitAbort = null;
let splitSeq = 0;
let splitHistory = [];
let activeSplitDoc = null;

function unitQueryFor(view, para) {
  if (view === 'full') return '';
  if (view) return '?unit=' + encodeURIComponent(view);
  const pClause = para && /^\(([a-z])\)/i.exec(para.trim());
  return '?unit=' + encodeURIComponent(pClause ? pClause[1].toLowerCase() : '');
}

function buildSectionHash(title, sectionId, para = null, unit = null) {
  let h = `#/title/${title}/section/${encodeURIComponent(sectionId)}`;
  if (unit === 'full') h += '/full';
  else if (unit) h += `/${encodeURIComponent(unit)}`;
  if (para) h += `?p=${encodeURIComponent(para)}`;
  return h;
}

export function isSplitOpen() {
  return Boolean(dom.splitPane && !dom.splitPane.hidden);
}

export function closeSplitPane() {
  if (splitAbort) {
    try { splitAbort.abort(); } catch (e) { /* ignore */ }
    splitAbort = null;
  }
  splitSeq++;
  splitHistory = [];
  activeSplitDoc = null;
  state.splitState = null;
  if (dom.splitPane) {
    dom.splitPane.hidden = true;
    dom.splitPane.innerHTML = '';
  }
  if (dom.mainStage) dom.mainStage.classList.remove('is-split');
}

export function promoteSplitToMain() {
  if (!state.splitState) return;
  const { title, sectionId, para, unit } = state.splitState;
  const target = buildSectionHash(title, sectionId, para, unit);
  closeSplitPane();
  window.location.hash = target;
}

function renderSplitLoading(title, sectionId) {
  dom.splitPane.innerHTML = `
    <div class="split-head">
      <div class="split-head-meta">
        <div class="doc-kicker">${title} CFR § ${escapeHtml(sectionId)}</div>
        <div class="split-head-title">Loading…</div>
      </div>
      <div class="split-head-acts">
        <button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon('close')}</button>
      </div>
    </div>
    <div class="split-body">${skeletonHtml('doc', `Loading § ${sectionId}…`)}</div>
  `;
}

export async function openSplitPane({ title, sectionId, para = null, unit = null, pushHistory = true }) {
  if (!dom.splitPane || !dom.mainStage || !sectionId) return;
  const tNum = Number(title) || state.currentTitle || 29;
  const nextEntry = { title: tNum, sectionId: String(sectionId), para: para || null, unit: unit || null };

  if (pushHistory) {
    const top = splitHistory[splitHistory.length - 1];
    if (!top || top.title !== nextEntry.title || top.sectionId !== nextEntry.sectionId || top.unit !== nextEntry.unit || top.para !== nextEntry.para) {
      splitHistory.push(nextEntry);
    }
  }

  if (splitAbort) {
    try { splitAbort.abort(); } catch (e) { /* ignore */ }
  }
  splitAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const seq = ++splitSeq;

  dom.mainStage.classList.add('is-split');
  dom.splitPane.hidden = false;
  state.splitState = nextEntry;
  renderSplitLoading(tNum, sectionId);

  try {
    const qs = unitQueryFor(unit, para);
    const res = await fetch(`/api/${tNum}/section/${encodeURIComponent(sectionId)}${qs}`, {
      signal: splitAbort?.signal,
    });
    if (seq !== splitSeq) return;
    if (!res.ok) {
      dom.splitPane.innerHTML = `
        <div class="split-head">
          <div class="split-head-meta">
            <div class="doc-kicker">${tNum} CFR § ${escapeHtml(sectionId)}</div>
            <div class="split-head-title">Unavailable</div>
          </div>
          <div class="split-head-acts">
            <button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon('close')}</button>
          </div>
        </div>
        <div class="split-body"><p class="muted">Couldn’t load § ${escapeHtml(sectionId)} from Title ${tNum}.</p></div>
      `;
      return;
    }

    let data = await res.json();
    if (seq !== splitSeq) return;
    activeSplitDoc = data;
    state.peekCache.set(`${tNum}|${sectionId}|${data.unit || 'full'}`, data);

    const heading = cleanInlineLabel(data.section_title || data.title_label || '');
    const label = cleanInlineLabel(data.label);
    const hasBack = splitHistory.length > 1;
    const outline = data.outline || [];
    const showUnits = data.mode === 'units' && outline.length > 1;
    const unitsHtml = showUnits
      ? `<div class="split-units" role="navigation" aria-label="Section parts">
          ${outline.map(u => `<button type="button" class="split-unit-chip${data.unit === u.key ? ' is-active' : ''}" data-split-unit="${escapeHtml(u.key)}">${escapeHtml(unitShort(u))}</button>`).join('')}
          <button type="button" class="split-unit-chip${!data.unit ? ' is-active' : ''}" data-split-unit="full">Full</button>
        </div>`
      : '';

    const partLabel = data.part ? ` · Part ${escapeHtml(data.part)}` : '';
    dom.splitPane.innerHTML = `
      <header class="split-head">
        ${hasBack ? `<button type="button" class="icon-btn" data-split-act="back" title="Back in split pane" aria-label="Back">${icon('chevronLeft')}</button>` : ''}
        <div class="split-head-meta">
          <div class="doc-kicker">${tNum} CFR${partLabel}</div>
          <h2 class="split-head-title">${escapeHtml(label)} ${escapeHtml(heading)}</h2>
        </div>
        <div class="split-head-acts">
          <button type="button" class="btn btn-small" data-split-act="promote" title="Open this section in the main reading pane">Open</button>
          <button type="button" class="icon-btn" data-split-act="close" title="Close split view" aria-label="Close split view">${icon('close')}</button>
        </div>
      </header>
      ${unitsHtml}
      <div class="split-body">
        ${data.reserved ? '<div class="reserved-note">This section is reserved.</div>' : ''}
        ${data.html || ''}
      </div>
    `;

    const bodyEl = dom.splitPane.querySelector('.split-body');
    if (bodyEl) {
      enhanceDomAnchors(bodyEl);
      const cachedGraph = state.graphCache.get(`${tNum}|${data.id}`);
      if (cachedGraph?.ibr?.length) wrapIbrMentions(bodyEl, cachedGraph.ibr);
      else {
        fetch(`/api/${tNum}/citations/${encodeURIComponent(data.id)}`, { signal: splitAbort?.signal })
          .then(r => (r.ok ? r.json() : null))
          .then(g => {
            if (!g || seq !== splitSeq || !bodyEl.isConnected) return;
            state.graphCache.set(`${tNum}|${data.id}`, g);
            if (g.ibr?.length) wrapIbrMentions(bodyEl, g.ibr);
          })
          .catch(() => {});
      }
      if (para) {
        highlightTarget(bodyEl, para, 60);
      } else {
        dom.splitPane.scrollTop = 0;
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (seq !== splitSeq) return;
    dom.splitPane.innerHTML = `
      <div class="split-head">
        <div class="split-head-meta">
          <div class="doc-kicker">${tNum} CFR § ${escapeHtml(sectionId)}</div>
          <div class="split-head-title">Load failed</div>
        </div>
        <div class="split-head-acts">
          <button type="button" class="icon-btn" data-split-act="close" aria-label="Close split view">${icon('close')}</button>
        </div>
      </div>
      <div class="split-body"><div class="msg-error">${escapeHtml(err?.message || 'Error')}</div></div>
    `;
  }
}

export function getActiveSplitDoc() {
  return activeSplitDoc;
}

if (dom.splitPane) {
  dom.splitPane.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-split-act]');
    if (actBtn) {
      const act = actBtn.dataset.splitAct;
      if (act === 'close') closeSplitPane();
      else if (act === 'promote') promoteSplitToMain();
      else if (act === 'back' && splitHistory.length > 1) {
        splitHistory.pop();
        const prev = splitHistory[splitHistory.length - 1];
        if (prev) openSplitPane({ ...prev, pushHistory: false });
      }
      return;
    }

    const unitBtn = e.target.closest('[data-split-unit]');
    if (unitBtn && state.splitState) {
      openSplitPane({
        title: state.splitState.title,
        sectionId: state.splitState.sectionId,
        para: null,
        unit: unitBtn.dataset.splitUnit,
        pushHistory: false,
      });
      return;
    }

    const anchorTrigger = e.target.closest('[data-anchor]');
    if (anchorTrigger) {
      e.preventDefault();
      scrollToAnchor(anchorTrigger.dataset.anchor, dom.splitPane);
      return;
    }

    const localPara = e.target.closest('a.xref-local[data-local-para]');
    if (localPara) {
      e.preventDefault();
      highlightTarget(dom.splitPane, localPara.dataset.localPara, 0);
      return;
    }

    const figLink = e.target.closest('a.reg-figure:not(.is-broken)');
    if (figLink && dom.splitPane.contains(figLink)) {
      e.preventDefault();
      openFigureModal(figLink);
      return;
    }

    // Navigating section links inside split keeps browsing inside the split pane unless Alt/Cmd pressed.
    const link = e.target.closest('a[href^="#"]');
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const parsed = parseCfrHref(link.getAttribute('href'), state.splitState?.title || state.currentTitle);
      if (parsed && parsed.kind === 'section') {
        e.preventDefault();
        openSplitPane({
          title: parsed.title,
          sectionId: parsed.section,
          para: parsed.para,
          unit: parsed.unit,
          pushHistory: true,
        });
      }
    }
  });

  dom.splitPane.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('reg-img')) return;
    const fig = img.closest('.reg-figure');
    if (!fig || fig.classList.contains('is-broken')) return;
    fig.classList.add('is-broken');
    if (activeSplitDoc?.ecfr_url) fig.href = activeSplitDoc.ecfr_url;
    fig.title = 'This figure is only available on eCFR';
    fig.innerHTML = `${icon('external')}<span>Figure — view on eCFR</span>`;
  }, true);
}
