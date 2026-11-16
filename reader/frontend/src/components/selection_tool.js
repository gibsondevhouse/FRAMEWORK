import { state } from '../state';
import { openChat } from '../components/chat';
import { dom } from '../state_init';

// --- Selection Floating Tool ("Ask about this") ---
state.selectedText = '';

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const str = sel.toString().trim();
  if (str.length > 10 && dom.view.contains(sel.anchorNode)) {
    state.selectedText = str;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    dom.askFloat.hidden = false;
    // Keep the popover inside the viewport: flip above the selection near the bottom edge.
    const w = dom.askFloat.offsetWidth;
    const h = dom.askFloat.offsetHeight;
    const below = rect.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 8) : below;
    const left = Math.min(Math.max(10, rect.left), window.innerWidth - w - 10);
    dom.askFloat.style.top = `${window.scrollY + top}px`;
    dom.askFloat.style.left = `${window.scrollX + left}px`;
  } else {
    dom.askFloat.hidden = true;
  }
});


// The popover is positioned against the viewport; hide it once the text scrolls away.
dom.main.addEventListener('scroll', () => {
  if (!dom.askFloat.hidden) dom.askFloat.hidden = true;
}, { passive: true });


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
