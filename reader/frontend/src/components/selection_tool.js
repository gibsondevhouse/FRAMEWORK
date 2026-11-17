import { state } from '../state';
import { openChat } from '../components/chat';
import { positionPopover } from './popover';
import { dom } from '../state_init';

// --- Selection Floating Tool ("Ask about this") ---
state.selectedText = '';

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const str = sel.toString().trim();
  const inView = dom.view.contains(sel.anchorNode) || (dom.splitPane && dom.splitPane.contains(sel.anchorNode));
  if (str.length > 10 && inView && sel.rangeCount > 0) {
    state.selectedText = str;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    dom.askFloat.hidden = false;
    positionPopover(dom.askFloat, rect, { offset: 8, placement: 'auto', padding: 10 });
  } else {
    dom.askFloat.hidden = true;
  }
});


// Hide when either reading pane scrolls.
for (const scroller of [dom.main, dom.splitPane]) {
  if (scroller) {
    scroller.addEventListener('scroll', () => {
      if (!dom.askFloat.hidden) dom.askFloat.hidden = true;
    }, { passive: true });
  }
}


dom.askFloat.addEventListener('click', (e) => {
  const action = e.target.dataset.ask;
  if (!action || !state.selectedText) return;
  openChat();
  if (action === 'explain') {
    dom.chatText.value = `Can you explain what this clause means in plain English?\n\n"${state.selectedText}"`;
  } else {
    dom.chatText.value = `Regarding this provision: "${state.selectedText}"\n\n`;
  }
  dom.askFloat.hidden = true;
  dom.chatText.focus();
});
