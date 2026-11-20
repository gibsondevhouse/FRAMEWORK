import { state } from '../state';
import { clipToWorkspace, currentSectionRef } from '../core/projects_store';
import { openChat } from '../components/chat';
import { positionPopover } from './popover';
import { getActiveSplitDoc } from './split_pane';
import { dom } from '../state_init';
import { formatRefCitation, resolveParagraphPath } from '../views/doc_utils';

// --- Selection Floating Tool ("Explain", "Ask about this", "Clip") ---
state.selectedText = '';
let selectedPara = '';
let selectedFromSplit = false;

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  if (!sel) {
    dom.askFloat.hidden = true;
    selectedPara = '';
    selectedFromSplit = false;
    return;
  }
  const str = sel.toString().trim();
  const inMain = dom.view.contains(sel.anchorNode);
  const inSplit = Boolean(dom.splitPane && dom.splitPane.contains(sel.anchorNode));
  if (str.length > 10 && (inMain || inSplit) && sel.rangeCount > 0) {
    state.selectedText = str;
    selectedFromSplit = inSplit;
    const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const paraEl = anchorEl?.closest?.('.reg-p');
    const paneRoot = inSplit ? dom.splitPane : dom.view;
    selectedPara = paraEl ? resolveParagraphPath(paneRoot, paraEl) : '';
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    dom.askFloat.hidden = false;
    positionPopover(dom.askFloat, rect, { offset: 8, placement: 'auto', padding: 10 });
  } else {
    dom.askFloat.hidden = true;
    selectedPara = '';
    selectedFromSplit = false;
  }
});

for (const scroller of [dom.main, dom.splitPane]) {
  if (scroller) {
    scroller.addEventListener('scroll', () => {
      if (!dom.askFloat.hidden) dom.askFloat.hidden = true;
    }, { passive: true });
  }
}

dom.askFloat.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest<HTMLElement>('[data-ask]');
  const action = btn?.dataset.ask;
  if (!action || !state.selectedText) return;
  if (action === 'clip') {
    const splitDoc = selectedFromSplit ? getActiveSplitDoc() : null;
    const ref = splitDoc
      ? {
        title: splitDoc.title,
        id: splitDoc.id,
        label: splitDoc.label || `§ ${splitDoc.id}`,
        heading: splitDoc.section_title || splitDoc.title_label || '',
        part: splitDoc.part || '',
      }
      : currentSectionRef();
    if (ref) {
      clipToWorkspace(ref, {
        para: selectedPara,
        quote: state.selectedText,
        cite: formatRefCitation(ref, selectedPara),
      });
    }
    dom.askFloat.hidden = true;
    window.getSelection()?.removeAllRanges();
    return;
  }
  openChat();
  if (action === 'explain') {
    dom.chatText.value = `Can you explain what this clause means in plain English?\n\n"${state.selectedText}"`;
  } else {
    dom.chatText.value = `Regarding this provision: "${state.selectedText}"\n\n`;
  }
  dom.askFloat.hidden = true;
  dom.chatText.focus();
});
