import { state } from '../state';
import { toggleChat } from '../components/chat';
import { openEnvModal } from '../components/env_modal';
import { emit } from '../core/events';
import { loadProjects } from '../core/projects_store';
import { escapeHtml, isMac } from '../dom';
import { NavPanelKey, openPanel, toggleDrawer } from '../nav';

// --- Commands in the search box: type ">" ---
export function commandList(): Array<[string, string, string]> {
  const mod = isMac ? '⌘' : 'Ctrl ';
  return [
    ['Go to Home', '#/', 'G H'], [`Go to Title ${state.currentTitle} start`, `#/title/${state.currentTitle}/`, 'G T'],
    ['Open contents', 'cmd:reader', 'G C'], ['Open workspaces', 'cmd:projects', 'G P'], ['All workspaces', '#/projects', ''],
    ['Go to News', '#/news', 'G N'], ['Refresh news', 'cmd:news-refresh', ''],
    ['New workspace', 'cmd:new-project', ''], ['Open the library', '#/library', ''], ['Library drawer', 'cmd:library', 'G L'],
    ['Settings', 'cmd:settings', 'G S'], ['All settings', '#/settings', ''],
    ['Connections & API keys', '#/help', ''], ['Edit API keys', 'cmd:env-modal', ''],
    ['Show or hide the drawer', 'cmd:drawer', `${mod}B`], ['Ask Claude', 'cmd:chat', `${mod}J`],
    ...loadProjects().map((p): [string, string, string] => [`Workspace: ${p.name}`, `#/projects/${encodeURIComponent(p.id)}`, '']),
    ...state.installedTitles.filter(t => t.title !== state.currentTitle).map((t): [string, string, string] => [`Switch to Title ${t.title} ${t.name}`, `#/title/${t.title}/`, '']),
  ];
}

export function commandItemsHtml(q: string): string {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = commandList().filter(([label]) => words.every(w => label.toLowerCase().includes(w))).slice(0, 12);
  if (!hits.length) return '<div class="sd-footer">No command matches.</div>';
  return hits.map(([label, to, keys]) => {
    const cmd = to.startsWith('cmd:') ? to.slice(4) : '';
    return `<a class="sd-item sd-cmd" href="${cmd ? '#' : escapeHtml(to)}"${cmd ? ` data-cmd="${cmd}"` : ''}>
      <span class="sd-cmd-label">${escapeHtml(label)}</span>${keys ? `<span class="sd-cmd-keys">${keys.split(' ').map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span>` : ''}</a>`;
  }).join('') + '<div class="sd-footer">Commands · <kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to run</div>';
}

export function runCommand(cmd: string): void {
  if (cmd === 'drawer') toggleDrawer();
  else if (cmd === 'chat') toggleChat();
  else if (cmd === 'new-project') emit('nav:new-project');
  else if (cmd === 'news-refresh') emit('news:refresh');
  else if (cmd === 'env-modal') openEnvModal();
  else openPanel(cmd as NavPanelKey, { focus: true });
}
