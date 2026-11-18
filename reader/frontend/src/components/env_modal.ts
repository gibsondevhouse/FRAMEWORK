import { EnvStatusSnapshot, NewsStatusSnapshot, state, StorageSnapshot } from '../state';
import { fetchTitleModels, getJSON } from '../api/client';
import { emit, on } from '../core/events';
import { statPill } from './ui';
import { escapeHtml, icon, reduceMotion, setModalBackgroundInert, showToast, trapFocusKeydown } from '../dom';
import { dom } from '../state_init';

// --- .env Editor Modal ---
export const envModalEl = typeof document !== 'undefined' ? (document.getElementById('env-modal') as HTMLElement | null) : null;
export const envModalDialog = envModalEl ? envModalEl.querySelector<HTMLElement>('.modal-dialog') : null;

state.envModalReturnFocus = null;
state.envModalSnapshot = null;

export function envPreviewText(form: HTMLFormElement, snapshot: EnvStatusSnapshot | null | undefined): string {
  const keys = (snapshot && snapshot.keys) || {};
  const dolInput = form.querySelector<HTMLInputElement>('#env-dol-key');
  const dolClear = form.querySelector<HTMLInputElement>('#env-dol-clear');
  const antInput = form.querySelector<HTMLInputElement>('#env-ant-key');
  const antClear = form.querySelector<HTMLInputElement>('#env-ant-clear');
  const modelInput = form.querySelector<HTMLInputElement>('#env-ant-model');
  const syncInput = form.querySelector<HTMLInputElement>('#env-news-sync');
  const retInput = form.querySelector<HTMLInputElement>('#env-news-retention');

  const dolVal = dolClear && dolClear.checked ? ''
    : (dolInput && dolInput.value.trim()) ? '••••(new key)'
    : (keys.DOL_API_KEY && keys.DOL_API_KEY.masked) || '';
  const antVal = antClear && antClear.checked ? ''
    : (antInput && antInput.value.trim()) ? '••••(new key)'
    : (keys.ANTHROPIC_API_KEY && keys.ANTHROPIC_API_KEY.masked) || '';
  const modelVal = (modelInput && modelInput.value.trim()) || '';
  const syncVal = syncInput && syncInput.checked ? '1' : '0';
  const retVal = (retInput && retInput.value.trim()) || '365';

  return [
    `ANTHROPIC_API_KEY=${antVal}`,
    `ANTHROPIC_MODEL=${modelVal}`,
    `DOL_API_KEY=${dolVal}`,
    `NEWS_SYNC=${syncVal}`,
    `NEWS_RETENTION_DAYS=${retVal}`,
  ].join('\n');
}

export function renderEnvModal(env: EnvStatusSnapshot | null | undefined, focusKey = ''): void {
  if (!envModalDialog) return;
  const keys = (env && env.keys) || {};
  const dol = keys.DOL_API_KEY || {};
  const ant = keys.ANTHROPIC_API_KEY || {};
  const model = String((keys.ANTHROPIC_MODEL && keys.ANTHROPIC_MODEL.value) || '');
  const modelDefault = (keys.ANTHROPIC_MODEL && keys.ANTHROPIC_MODEL.default) || 'claude-sonnet-5-5';
  const newsSync = keys.NEWS_SYNC ? Boolean(keys.NEWS_SYNC.value) : true;
  const retDays = Number((keys.NEWS_RETENTION_DAYS && keys.NEWS_RETENTION_DAYS.value) || 365);

  envModalDialog.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="doc-kicker">${env && env.env_exists ? 'Update local settings' : 'Create reader/.env'}</div>
        <h2 id="env-modal-title" class="modal-title">Configure API Keys &amp; Sync Settings</h2>
      </div>
      <button type="button" class="icon-btn" data-env-close aria-label="Close modal">${icon('close')}</button>
    </div>
    <form id="env-modal-form" class="modal-body" autocomplete="off">
      <p class="modal-intro">Keys are saved privately to <code>reader/.env</code> on your computer and take effect immediately—no restart needed. Leave an existing key blank to keep it unchanged.</p>

      <div class="env-field">
        <div class="env-field-head">
          <label for="env-dol-key">DOL API Key <code>DOL_API_KEY</code></label>
          ${dol.configured ? statPill('synced', `Saved (${dol.masked || 'set'})`) : statPill('uninstalled', 'Not set')}
        </div>
        <p class="env-field-help">Free key from <a href="https://dataportal.dol.gov/registration" target="_blank" rel="noopener">dataportal.dol.gov/registration</a> for OSHA inspections and penalties.</p>
        <div class="env-secret-row">
          <input id="env-dol-key" name="dol_api_key" type="password" placeholder="${dol.configured ? 'Leave blank to keep existing key, or paste new key' : 'Paste your DOL X-API-KEY'}" spellcheck="false" autocomplete="off">
          <button type="button" class="btn btn-sm" data-env-reveal="env-dol-key" aria-label="Show or hide DOL key">${icon('eye')}</button>
        </div>
        ${dol.configured ? `<label class="env-clear-check"><input type="checkbox" id="env-dol-clear" name="clear_dol_api_key"> Remove saved DOL key</label>` : ''}
      </div>

      <div class="env-field">
        <div class="env-field-head">
          <label for="env-ant-key">Anthropic API Key <code>ANTHROPIC_API_KEY</code></label>
          ${ant.configured ? statPill('synced', `Saved (${ant.masked || 'set'})`) : statPill('uninstalled', 'Not set')}
        </div>
        <p class="env-field-help">From <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> to enable the Ask Claude side panel.</p>
        <div class="env-secret-row">
          <input id="env-ant-key" name="anthropic_api_key" type="password" placeholder="${ant.configured ? 'Leave blank to keep existing key, or paste new key' : 'sk-ant-…'}" spellcheck="false" autocomplete="off">
          <button type="button" class="btn btn-sm" data-env-reveal="env-ant-key" aria-label="Show or hide Anthropic key">${icon('eye')}</button>
        </div>
        ${ant.configured ? `<label class="env-clear-check"><input type="checkbox" id="env-ant-clear" name="clear_anthropic_api_key"> Remove saved Anthropic key</label>` : ''}
      </div>

      <details class="env-advanced"${focusKey === 'news_sync' ? ' open' : ''}>
        <summary>Advanced options (Claude model &amp; News sync)</summary>
        <div class="env-advanced-body">
          <div class="env-field">
            <label for="env-ant-model">Preferred Claude Model <code>ANTHROPIC_MODEL</code></label>
            <input id="env-ant-model" name="anthropic_model" type="text" value="${escapeHtml(model)}" placeholder="${escapeHtml(modelDefault)}" spellcheck="false">
          </div>
          <div class="env-field-row">
            <label class="env-toggle-row"><input type="checkbox" id="env-news-sync" name="news_sync"${newsSync ? ' checked' : ''}> <span>Enable background news sync (<code>NEWS_SYNC</code>)</span></label>
            <div class="env-days-field">
              <label for="env-news-retention">Retention (days)</label>
              <input id="env-news-retention" name="news_retention_days" type="number" min="1" max="3650" value="${Number(retDays)}">
            </div>
          </div>
        </div>
      </details>

      <div class="env-preview-wrap">
        <span class="env-preview-label">Preview of <code>reader/.env</code></span>
        <pre class="env-preview" id="env-preview"></pre>
      </div>

      <p class="modal-error" id="env-modal-error" hidden></p>

      <div class="modal-foot">
        <button type="button" class="btn" data-env-close>Cancel</button>
        <button type="submit" class="btn btn-accent" id="env-modal-save">${icon('check')} Save to reader/.env</button>
      </div>
    </form>`;

  const form = document.getElementById('env-modal-form') as HTMLFormElement | null;
  const preview = document.getElementById('env-preview');
  if (!form) return;
  const syncPreview = () => { if (preview) preview.textContent = envPreviewText(form, state.envModalSnapshot); };
  syncPreview();
  form.addEventListener('input', syncPreview);
  form.addEventListener('change', syncPreview);
  form.addEventListener('submit', submitEnvModal);

  requestAnimationFrame(() => {
    const targetId = focusKey === 'dol_api_key' ? 'env-dol-key'
      : focusKey === 'anthropic_api_key' ? 'env-ant-key'
      : focusKey === 'news_sync' ? 'env-news-sync'
      : 'env-dol-key';
    (document.getElementById(targetId) || envModalDialog.querySelector<HTMLElement>('input, button'))?.focus();
  });
}

export async function openEnvModal(focusKey = ''): Promise<void> {
  if (!envModalEl || !envModalDialog) return;
  state.envModalReturnFocus = document.activeElement;
  envModalDialog.innerHTML = `<div class="modal-head"><h2 id="env-modal-title" class="modal-title">Configure reader/.env</h2>
    <button type="button" class="icon-btn" data-env-close aria-label="Close modal">${icon('close')}</button></div>
    <div class="modal-body"><div class="loading">Loading current configuration…</div></div>`;
  envModalEl.hidden = false;
  setModalBackgroundInert(true);
  try {
    state.envModalSnapshot = await getJSON<EnvStatusSnapshot>('/api/settings/env');
    state.navEnvStatus = state.envModalSnapshot;
    renderEnvModal(state.envModalSnapshot, focusKey);
  } catch {
    state.envModalSnapshot = { env_exists: false, env_file: 'reader/.env', keys: {} };
    renderEnvModal(state.envModalSnapshot, focusKey);
  }
}

export function closeEnvModal(restoreFocus = true): void {
  if (!envModalEl || envModalEl.hidden) return;
  envModalEl.hidden = true;
  setModalBackgroundInert(false);
  if (restoreFocus && state.envModalReturnFocus && document.contains(state.envModalReturnFocus)) {
    (state.envModalReturnFocus as HTMLElement).focus?.();
  }
  state.envModalReturnFocus = null;
}

export async function refreshModelsConfig(): Promise<void> {
  if (state.noTitles) return;
  try {
    const cfg = await fetchTitleModels(state.currentTitle);
    if (!cfg) return;
    state.chatConfig = cfg;
    const modelSelect = dom.modelSelect;
    if (state.chatConfig.configured && state.chatConfig.models.length > 0) {
      modelSelect.innerHTML = state.chatConfig.models.map(m => `
        <option value="${escapeHtml(m.id)}" ${m.id === state.chatConfig.default ? 'selected' : ''}>
          ${escapeHtml(m.name)}
        </option>
      `).join('');
      modelSelect.hidden = false;
    } else {
      modelSelect.innerHTML = '';
      modelSelect.hidden = true;
    }
    emit('models:updated');
  } catch { /* keep existing chatConfig */ }
}

export async function submitEnvModal(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const saveBtn = document.getElementById('env-modal-save') as HTMLButtonElement | null;
  const errEl = document.getElementById('env-modal-error');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  if (saveBtn) saveBtn.disabled = true;

  const val = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null);
  const payload = {
    dol_api_key: val('dol_api_key')?.value ?? null,
    clear_dol_api_key: Boolean(val('clear_dol_api_key')?.checked),
    anthropic_api_key: val('anthropic_api_key')?.value ?? null,
    clear_anthropic_api_key: Boolean(val('clear_anthropic_api_key')?.checked),
    anthropic_model: val('anthropic_model')?.value ?? null,
    news_sync: Boolean(val('news_sync')?.checked),
    news_retention_days: val('news_retention_days') ? Number(val('news_retention_days')!.value) || 365 : 365,
  };

  try {
    const res = await getJSON<{ status: EnvStatusSnapshot; news_sync_queued?: string[] }>('/api/settings/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    state.navEnvStatus = res.status;
    state.envModalSnapshot = res.status;
    const [newsSt] = await Promise.all([
      getJSON<NewsStatusSnapshot>('/api/news/status').catch(() => null),
      refreshModelsConfig(),
    ]);
    if (newsSt) state.navNewsStatus = newsSt;
    closeEnvModal(true);
    const queued = (res.news_sync_queued || []).length > 0;
    showToast(queued ? 'Saved to reader/.env · Syncing DOL enforcement data…' : 'Saved to reader/.env — active immediately');
    emit('env:saved');
  } catch (err) {
    if (errEl) { errEl.textContent = (err instanceof Error ? err.message : '') || 'Could not save reader/.env'; errEl.hidden = false; }
    if (saveBtn) saveBtn.disabled = false;
  }
}

if (envModalEl) {
  envModalEl.addEventListener('click', (e) => {
    const t = e.target as Element | null;
    if (t === envModalEl || t?.closest('[data-env-close]')) {
      closeEnvModal(true);
      return;
    }
    const rev = t?.closest<HTMLElement>('[data-env-reveal]');
    if (rev?.dataset.envReveal) {
      const inp = document.getElementById(rev.dataset.envReveal) as HTMLInputElement | null;
      if (inp) {
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        rev.innerHTML = icon(show ? 'eyeOff' : 'eye');
      }
    }
  });
}

if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
  if (!envModalEl || envModalEl.hidden) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeEnvModal(true);
    return;
  }
  trapFocusKeydown(envModalDialog, e);
});

if (typeof document !== 'undefined') document.addEventListener('click', (e) => {
  const t = e.target as Element | null;
  const trigger = t?.closest<HTMLElement>('[data-open-env]');
  if (trigger) {
    e.preventDefault();
    openEnvModal(trigger.dataset.openEnv || '');
    return;
  }
  const copyBtn = t?.closest<HTMLElement>('[data-copy-url]');
  if (copyBtn?.dataset.copyUrl) {
    const url = copyBtn.dataset.copyUrl;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => showToast('RSS feed URL copied')).catch(() => showToast(url, 5000));
    } else {
      showToast(url, 5000);
    }
    return;
  }
  const jump = t?.closest<HTMLElement>('[data-help-jump]');
  if (jump?.dataset.helpJump) {
    const el = document.getElementById('help-' + jump.dataset.helpJump);
    if (el) el.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
});

export async function loadStorage(): Promise<void> {
  try { state.navStorage = await getJSON<StorageSnapshot>('/api/library/storage'); } catch { state.navStorage = { titles: [], legacy_bytes: 0, temp_files: 0, temp_bytes: 0, total_bytes: 0 }; }
  emit('env:saved');
}

on('titles:refreshed', ({ hadNone, list }) => {
  if (hadNone && list.length) refreshModelsConfig();
});
