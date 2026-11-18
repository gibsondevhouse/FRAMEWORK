import { drawerEl, NavPanelKey, navState, panelMeta } from '../nav';

// --- Drawer panels: shared pieces ---
export const drLabel = (text: string, extra = ''): string => `<h3 class="dr-label"><span>${text}</span>${extra}</h3>`;

export const drEmpty = (title: string, body: string): string => `<div class="dr-empty"><div class="dr-empty-title">${title}</div><p>${body}</p></div>`;

export function setPanel(panel: NavPanelKey, html: string): void {
  const el = document.getElementById(`panel-${panel}`);
  if (!el) return;
  const scroller = el.querySelector('.dr-scroll');
  const top = scroller ? scroller.scrollTop : 0;
  el.innerHTML = `<div class="dr-scroll">${html}</div>`;
  const next = el.querySelector('.dr-scroll');
  if (next) next.scrollTop = top;
  if (navState.panel === panel) drawerEl.meta.textContent = panelMeta(panel);
}
