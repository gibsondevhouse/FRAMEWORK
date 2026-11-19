import { state } from '../state';
import { toggleChat } from '../components/chat';
import { openEnvModal } from '../components/env_modal';
import { allSystemFrameworks, corpusHashFor } from '../components/corpora';
import { emit } from '../core/events';
import { loadProjects } from '../core/projects_store';
import { escapeHtml, isMac } from '../dom';
import { NavPanelKey, openPanel, toggleDrawer } from '../nav';

// --- Commands in the search box: type ">" ---
export function commandList(): Array<[string, string, string]> {
  const mod = isMac ? '⌘' : 'Ctrl ';
  const uscCommands = allSystemFrameworks()
    .filter(c => c.tier === 'federal-statute')
    .slice(0, 4)
    .map((c): [string, string, string] => [`Open ${c.code} · ${c.name}`, corpusHashFor(c), '']);
  const cfrCommands = state.installedTitles.map((t): [string, string, string] => [`Open ${t.title} CFR · ${t.name}`, `#/title/${t.title}/`, '']);
  return [
    ['Go to Home', '#/', 'G H'],
    ['Go to Workspaces', '#/projects', 'G P'],
    ['Go to Newsroom (Federal Register)', '#/news', 'G N'],
    ['Go to Library', '#/library', 'G L'],
    ['Go to Settings', '#/settings', 'G S'],
    ...(!state.noTitles ? [[`Open ${state.currentTitle} CFR start`, `#/title/${state.currentTitle}/`, 'G T'] as [string, string, string]] : []),
    ['Open framework contents', 'cmd:reader', 'G C'],
    ['Federal Register framework', '#/corpus/federal-register/US/FR/', ''],
    ...uscCommands,
    ['Refresh Federal Register feed', 'cmd:news-refresh', ''],
    ['New workspace', 'cmd:new-project', ''],
    ['Data sources & API keys', '#/help', ''],
    ['Edit API keys', 'cmd:env-modal', ''],
    ['Toggle sidebar / framework drawer', 'cmd:drawer', `${mod}B`],
    ['Ask Claude', 'cmd:chat', `${mod}J`],
    ...loadProjects().map((p): [string, string, string] => [`Workspace: ${p.name}`, `#/projects/${encodeURIComponent(p.id)}`, '']),
    ...cfrCommands,
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
