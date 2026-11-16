import { state } from '../state';
import { escapeHtml, icon, renderMarkdown, showToast } from '../dom';
import { applyNav } from '../nav';
import { dom } from '../state_init';

// --- Claude Chat Assistant ---
export function toggleChat() {
  if (dom.chat.hidden) {
    openChat();
  } else {
    closeChat();
  }
}


export function openChat() {
  dom.chat.hidden = false;
  dom.layout.classList.add('chat-open');
  applyNav();
  dom.chatToggle.classList.add('is-active');
  dom.chatToggle.setAttribute('aria-expanded', 'true');
  if (state.chatHistory.length === 0) {
    renderChatWelcome();
  }
  dom.chatText.focus();
}


export function closeChat() {
  const hadFocus = dom.chat.contains(document.activeElement);
  dom.chat.hidden = true;
  dom.layout.classList.remove('chat-open');
  applyNav();
  dom.chatToggle.classList.remove('is-active');
  dom.chatToggle.setAttribute('aria-expanded', 'false');
  if (hadFocus) dom.chatToggle.focus();
}


export function updateChatContext() {
  if (state.currentSection) {
    dom.chatContext.hidden = false;
    dom.contextLabel.textContent = `${state.currentSection.label} (Title ${state.currentTitle})`;
  } else {
    dom.chatContext.hidden = true;
  }
  // An open, unused chat keeps its starter prompts in step with the page.
  if (!dom.chat.hidden && state.chatHistory.length === 0 && !state.isGenerating) renderChatWelcome();
}


export function renderChatWelcome() {
  if (!state.chatConfig.configured) {
    dom.chatMessages.innerHTML = `
      <div class="setup-card">
        <h3>Connect Claude</h3>
        <p>Reading and search work without it. To ask questions and summarize sections, add an Anthropic API key:</p>
        <ol>
          <li>Create a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a></li>
          <li>Save it to <code>reader/.env</code> using the built-in key editor (no restart required).</li>
        </ol>
        <div class="setup-card-actions">
          <button type="button" class="btn btn-sm btn-accent" data-open-env="anthropic_api_key">${icon('key')} Enter Anthropic Key</button>
          <a class="btn btn-sm" href="#/help">${icon('help')} Setup Guide</a>
        </div>
      </div>
    `;
    return;
  }

  // A key is set but the model list couldn't be loaded (rejected key, no network).
  if (state.chatConfig.error) {
    dom.chatMessages.innerHTML = `
      <div class="setup-card">
        <h3>Claude isn’t available</h3>
        <p class="setup-error">${escapeHtml(state.chatConfig.error)}</p>
        <p>Reading and search still work in the meantime.</p>
      </div>
    `;
    return;
  }

  const HOME_PROMPTS = {
    29: [
      'How do overtime exemptions work under Part 541?',
      'What are OSHA’s main hazard communication rules?',
      'What are employer responsibilities under FMLA?',
    ],
    40: [
      'What makes a waste “hazardous” under RCRA?',
      'When does a facility need a Title V operating permit?',
      'What has to be reported after a chemical spill, and to whom?',
    ],
    49: [
      'What are the placarding rules for hazmat shipments?',
      'Who needs a CDL, and what disqualifies a driver?',
      'Which carriers are subject to the FMCSA safety regulations?',
    ],
  };

  let prompts = [
    'What are the key requirements in this section?',
    'Who is exempt and who is covered?',
    'Draft an audit and compliance checklist for this rule.'
  ];

  if (!state.currentSection) {
    prompts = HOME_PROMPTS[state.currentTitle] || [
      'What does this title cover, at a high level?',
      'What are the most important definitions in this title?',
      'Find the penalty and enforcement provisions in this title.',
    ];
  }

  const titleList = state.installedTitles.map(t => 'Title ' + t.title).join(', ') || `Title ${state.currentTitle}`;
  dom.chatMessages.innerHTML = `
    <div class="chat-empty">
      <h3>Ask Claude about ${state.currentSection ? escapeHtml(state.currentSection.label) : 'Title ' + state.currentTitle}</h3>
      <p>Claude searches and reads the full regulation text across ${escapeHtml(titleList)}. Select any passage in a section to ask about it.</p>
      <div class="suggestions">
        ${prompts.map(p => `<button type="button" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
      </div>
    </div>
  `;

  dom.chatMessages.querySelectorAll('.suggestions button').forEach(b => {
    b.addEventListener('click', () => {
      dom.chatText.value = b.dataset.prompt;
      submitChat();
    });
  });
}


export const TOOL_LABELS = {
  search_regulations: 'Searching the regulations…',
  read_section: 'Reading a section…',
  list_part: 'Looking through a part…',
};


export async function submitChat() {
  const text = dom.chatText.value.trim();
  if (!text || state.isGenerating) return;

  if (!state.chatConfig.configured) {
    openChat();
    return;
  }
  if (!(dom.modelSelect.value || state.chatConfig.default)) {
    showToast(state.chatConfig.error || 'Claude isn’t available right now.', 5000);
    return;
  }

  dom.chatText.value = '';
  dom.chatText.style.height = 'auto';

  // Add user message to UI and history
  state.chatHistory.push({ role: 'user', content: text });
  appendChatMessage('user', text);

  const assistantMsgEl = appendChatMessage('assistant', '');
  state.isGenerating = true;
  dom.chatSend.disabled = true;

  const model = dom.modelSelect.value || state.chatConfig.default;
  const includeContext = dom.contextToggle.checked && state.currentSection;
  const sectionId = includeContext ? state.currentSection.id : null;
  let replyText = '';

  try {
    const res = await fetch('/api/' + state.currentTitle + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.chatHistory,
        section_id: sectionId,
        model
      })
    });

    if (!res.ok) {
      const err = await res.json();
      assistantMsgEl.innerHTML = `<div class="msg-error">${escapeHtml(err.detail || 'Request failed')}</div>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolsEl = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const ev = JSON.parse(line.slice(6));

        if (ev.type === 'tool') {
          if (!toolsEl) {
            toolsEl = document.createElement('div');
            toolsEl.className = 'tool-activity';
            assistantMsgEl.prepend(toolsEl);
          }
          const chip = document.createElement('span');
          chip.className = 'tool-chip running';
          chip.id = `tool-${Date.now()}`;
          chip.textContent = TOOL_LABELS[ev.name] || `Using ${ev.name}…`;
          toolsEl.appendChild(chip);
        } else if (ev.type === 'tool_result') {
          if (toolsEl && toolsEl.lastElementChild) {
            toolsEl.lastElementChild.className = 'tool-chip';
            toolsEl.lastElementChild.textContent = ev.summary || `Finished ${ev.name}`;
          }
        } else if (ev.type === 'text') {
          replyText += ev.text;
          let contentDiv = assistantMsgEl.querySelector('.md');
          if (!contentDiv) {
            contentDiv = document.createElement('div');
            contentDiv.className = 'md';
            assistantMsgEl.appendChild(contentDiv);
          }
          contentDiv.innerHTML = renderMarkdown(replyText);
          dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
        } else if (ev.type === 'error') {
          const errDiv = document.createElement('div');
          errDiv.className = 'msg-error';
          errDiv.textContent = ev.message;
          assistantMsgEl.appendChild(errDiv);
        }
      }
    }

  } catch (err) {
    assistantMsgEl.innerHTML = `<div class="msg-error">Chat error: ${escapeHtml(err.message)}</div>`;
  } finally {
    // Keep history alternating user/assistant: a turn with no reply is dropped
    // so the next send doesn't carry an empty or unpaired message.
    if (replyText) state.chatHistory.push({ role: 'assistant', content: replyText });
    else state.chatHistory.pop();
    state.isGenerating = false;
    dom.chatSend.disabled = false;
  }
}


export function appendChatMessage(role, content) {
  // Clear welcome empty state if present
  const empty = dom.chatMessages.querySelector('.chat-empty, .setup-card');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `msg msg-${role}`;
  if (role === 'user') {
    msg.textContent = content;
  } else {
    if (content) {
      msg.innerHTML = `<div class="md">${renderMarkdown(content)}</div>`;
    }
  }
  dom.chatMessages.appendChild(msg);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  return msg;
}


// Auto-resize chat textarea
dom.chatText.addEventListener('input', () => {
  dom.chatText.style.height = 'auto';
  dom.chatText.style.height = Math.min(dom.chatText.scrollHeight, 180) + 'px';
});


dom.chatText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitChat();
  }
});


dom.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitChat();
});


dom.chatNew.addEventListener('click', () => {
  state.chatHistory = [];
  renderChatWelcome();
});


dom.chatToggle.addEventListener('click', toggleChat);

dom.chatClose.addEventListener('click', closeChat);
