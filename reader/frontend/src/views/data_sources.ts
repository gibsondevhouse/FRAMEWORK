import { getJSON } from '../api/client';
import { pollJobs } from '../api/jobs';
import { state } from '../state';
import { onView } from '../core/view_dispatch';
import { escapeHtml, icon, showToast } from '../dom';
import { flagHtml, tabLeadHtml } from '../components/page_shell';
import { fmtBytes } from '../components/ui';
import { dom } from '../state_init';
import { timeAgo } from '../usage';

// Settings → Data sources: a plain-language checklist over the source registry
// (GET /api/sources, /api/sources/selection, /api/sources/templates; see API.md "Sources").
// Edits stay in a local draft until the person reviews the plan and applies it.

type ScopeValue = string | number | boolean | Array<string | number>;

interface Estimate { bytes?: number | null; seconds?: number | null; approximate?: boolean }
interface FilterOption { value: string | number; label: string; description?: string; desk?: string; reserved?: boolean; estimate?: Estimate | null }
interface SourceFilter {
  id: string; type: 'multi' | 'toggle' | 'number' | 'choice'; label: string; description?: string;
  allow_all?: boolean; allow_installed?: boolean; allow_custom?: boolean;
  options?: FilterOption[]; min?: number; max?: number; unit?: string;
}
interface ScheduleOption { value: string; label: string; description?: string }
interface OptionalKey { key_present: boolean; key_label: string; key_env: string; get_key_url: string; purpose?: string }
interface SourceStatus {
  installed?: boolean; bytes?: number | null; documents?: number; last_refresh?: string | null;
  last_error?: string | null; items?: Array<number | string>; jobs?: unknown[];
}
export interface SourceDecl {
  id: string; label: string; short: string; category: string; description: string; provider: string;
  available: boolean; needs_key: boolean; key_present: boolean | null; key_label: string | null;
  key_env: string | null; get_key_url: string | null; optional_key: OptionalKey | null;
  schedule_options: ScheduleOption[]; default_schedule: string; filters: SourceFilter[];
  default_scope: Record<string, ScopeValue>; status: SourceStatus;
}
interface SourceChoice { enabled: boolean; schedule: string; scope: Record<string, ScopeValue> }
export interface Selection { version: number; sources: Record<string, SourceChoice> }
interface SourcesResponse { categories: string[]; sources: SourceDecl[]; selection: Selection; saved: boolean; default_preset: string }
interface Template { id: string; name: string; description?: string; builtin: boolean; group?: string; default?: boolean; needs_keys?: string[]; selection: Selection }
interface PlanItem { source?: string; label: string; action?: string; change?: string; get_key_url?: string; estimate?: Estimate | null }
interface Plan {
  summary: string; needs_confirm: boolean; applied?: boolean;
  queued?: Array<{ id: number }>; removed?: PlanItem[]; skipped?: Array<PlanItem & { reason?: string }>;
  estimate?: { bytes_label?: string; time_label?: string };
  actions: PlanItem[]; changes: PlanItem[]; keeps: string[];
}

interface DsState {
  data: SourcesResponse | null;
  templates: Template[];
  draft: Selection | null;
  dirty: boolean;
  plan: Plan | null;
  // The exact selection + removal flag the plan on screen describes; Apply sends this
  // snapshot, never the live draft, so an edit after review can't slip through.
  planFor: { selection: Selection; remove: boolean; templateName: string | null } | null;
  planSeq: number;
  templateName: string | null;
  removeUnselected: boolean;
  busy: boolean;
  open: Set<string>;
  search: Record<string, string>;
  templateId: string;
  saving: boolean;
}

const ds: DsState = {
  data: null, templates: [], draft: null, dirty: false, plan: null, planFor: null,
  removeUnselected: false, busy: false, open: new Set(), search: {}, templateId: '', saving: false,
  planSeq: 0, templateName: null,
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const SOURCES_URL = '/api/sources';
const jsonPost = (body: unknown, method = 'POST'): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function sizeLabel(e?: Estimate | null): string {
  if (!e || !e.bytes) return '';
  return `${e.approximate ? '~' : ''}${fmtBytes(e.bytes)}`;
}

// ---------- Loading ----------

export async function loadDataSources(): Promise<void> {
  const [data, tpl] = await Promise.all([
    getJSON<SourcesResponse>(SOURCES_URL),
    getJSON<{ templates: Template[] }>(`${SOURCES_URL}/templates`),
  ]);
  ds.data = data;
  ds.templates = tpl.templates || [];
  if (!ds.dirty || !ds.draft) {
    ds.draft = clone(data.selection);
    ds.dirty = false;
  }
  if (!ds.templateId) ds.templateId = data.default_preset;
}

// ---------- Rendering ----------

function choiceFor(id: string): SourceChoice {
  const d = ds.draft as Selection;
  if (!d.sources[id]) d.sources[id] = { enabled: false, schedule: '', scope: {} };
  return d.sources[id];
}

function templateBarHtml(): string {
  const groups = new Map<string, Template[]>();
  for (const t of ds.templates) {
    const g = t.builtin ? (t.group || 'Presets') : 'My templates';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const opts = [...groups].map(([g, list]) => `<optgroup label="${escapeHtml(g)}">${list.map(t =>
    `<option value="${escapeHtml(t.id)}"${t.id === ds.templateId ? ' selected' : ''}>${escapeHtml(t.name)}${t.default ? ' (default)' : ''}</option>`).join('')}</optgroup>`).join('');
  const cur = ds.templates.find(t => t.id === ds.templateId);
  const desc = cur?.description ? escapeHtml(cur.description) : '';
  const needs = cur?.needs_keys?.length ? ` <span class="ds-key-note">${icon('key')} Needs a free key for ${escapeHtml(cur.needs_keys.join(', ').toUpperCase())}</span>` : '';
  const saved = ds.templates.filter(t => !t.builtin);
  return tabLeadHtml({
    kickerHtml: 'Templates',
    title: 'Start from a template, then tick your own boxes',
    subHtml: 'A template fills in the whole checklist below. Nothing downloads until you review the changes and apply them. Unticking only stops updates; your data stays until you choose to remove it.',
    actionsHtml: `<button type="button" class="btn" data-ds-act="export"${saved.length ? '' : ' disabled'}>Export my templates</button>
      <button type="button" class="btn" data-ds-act="import">Import</button>
      <input type="file" accept="application/json,.json" data-ds-import hidden tabindex="-1" aria-hidden="true">`,
    id: 'ds-templates',
  }) + `<div class="ds-tpl-row">
      <label class="ds-tpl-pick"><span class="set-name">Template</span>
        <select class="set-select" data-ds-template aria-label="Template">${opts}</select></label>
      <button type="button" class="btn btn-accent" data-ds-act="use-template">Use this template</button>
      ${cur && !cur.builtin ? `<button type="button" class="btn" data-ds-act="delete-template" data-id="${escapeHtml(cur.id)}">Delete</button>` : ''}
    </div>
    ${desc || needs ? `<p class="dr-note ds-tpl-desc">${desc}${needs}</p>` : ''}
    <div class="ds-tpl-row">
      <input type="text" class="set-input" data-ds-template-name maxlength="80" placeholder="Name for your checklist, e.g. My EPA desk" aria-label="Template name">
      <button type="button" class="btn" data-ds-act="save-template">Save my checklist as a template</button>
    </div>`;
}

function statusLine(s: SourceDecl): string {
  const st = s.status || {};
  const bits: string[] = [];
  if (st.installed) {
    if (st.items?.length) bits.push(`${st.items.length} on this computer`);
    if (st.documents) bits.push(`${st.documents.toLocaleString()} documents`);
    if (st.bytes) bits.push(fmtBytes(st.bytes));
  } else bits.push('Nothing downloaded yet');
  if (st.last_refresh) bits.push(`updated ${timeAgo(Date.parse(st.last_refresh))}`);
  if (st.jobs?.length) bits.push('download in progress');
  return `<p class="ds-status">${escapeHtml(bits.join(' · '))}${st.last_error ? ` <span class="ds-err">Last update failed: ${escapeHtml(st.last_error)}</span>` : ''}</p>`;
}

// Keys the in-app .env editor (env_modal.ts) can set; others get written guidance instead.
const MODAL_KEYS = new Set(['dol_api_key', 'anthropic_api_key']);
function addKeyHtml(env: string | null): string {
  const k = (env || '').toLowerCase();
  if (MODAL_KEYS.has(k)) return `<button type="button" class="btn btn-sm" data-open-env="${escapeHtml(k)}">Add key</button>`;
  return env ? `<span class="ds-key-how">Add <code>${escapeHtml(env)}=…</code> to <code>reader/.env</code>, then restart.</span>` : '';
}

function keyHtml(s: SourceDecl): string {
  const parts: string[] = [];
  if (s.needs_key) {
    parts.push(s.key_present
      ? `<p class="ds-key ok">${icon('key')}<span class="ds-key-text">${escapeHtml(s.key_label || 'Key')} is set.</span></p>`
      : `<p class="ds-key">${icon('key')}<span class="ds-key-text">Needs a free ${escapeHtml(s.key_label || 'key')}. Ticked boxes wait until it's added.</span>
          ${s.get_key_url ? `<a href="${escapeHtml(s.get_key_url)}" target="_blank" rel="noopener">Get a key</a>` : ''}
          ${addKeyHtml(s.key_env)}</p>`);
  }
  const ok = s.optional_key;
  if (ok && !ok.key_present) {
    parts.push(`<p class="ds-key opt">${icon('key')}<span class="ds-key-text">Optional: ${escapeHtml(ok.key_label)}${ok.purpose ? `. ${escapeHtml(ok.purpose.replace(/\.+$/, ''))}` : ''}.</span>
      <a href="${escapeHtml(ok.get_key_url)}" target="_blank" rel="noopener">Get a key</a>
      ${addKeyHtml(ok.key_env)}</p>`);
  }
  return parts.join('');
}

const optHay = (o: FilterOption): string => `${o.label} ${o.desk || ''} ${o.value}`.toLowerCase();

// The curated options plus any ticked value the registry doesn't list (a custom agency
// slug from an older or imported selection), so everything being saved can be seen and unticked.
function pickOptions(f: SourceFilter, value: ScopeValue | undefined): FilterOption[] {
  const opts = (f.options || []).filter(o => !o.reserved);
  const known = new Set(opts.map(o => String(o.value)));
  const extra = (Array.isArray(value) ? value : []).filter(v => !known.has(String(v)))
    .map(v => ({ value: v, label: String(v), description: 'Added outside this list' }));
  return [...opts, ...extra];
}

function multiHtml(s: SourceDecl, f: SourceFilter, value: ScopeValue): string {
  const key = `${s.id}.${f.id}`;
  const mode = value === 'all' ? 'all' : value === 'installed' ? 'installed' : 'some';
  const picked = new Set((Array.isArray(value) ? value : []).map(String));
  const modes: Array<[string, string]> = [];
  if (f.allow_all) modes.push(['all', 'All']);
  if (f.allow_installed) modes.push(['installed', 'The ones on this computer']);
  modes.push(['some', modes.length ? 'Only the ones I tick' : 'Pick']);
  const opts = pickOptions(f, value);
  const q = (ds.search[key] || '').toLowerCase();
  const list = mode === 'some' ? `
      <div class="ds-pick-tools">
        <input type="search" class="set-input ds-pick-q" data-ds-search="${escapeHtml(key)}" value="${escapeHtml(ds.search[key] || '')}" placeholder="Filter ${escapeHtml(f.label.toLowerCase())}" aria-label="Filter ${escapeHtml(f.label)}">
        <button type="button" class="btn btn-sm" data-ds-all="${escapeHtml(key)}" data-on="1">Tick all</button>
        <button type="button" class="btn btn-sm" data-ds-all="${escapeHtml(key)}" data-on="0">Clear</button>
        <span class="ds-count">${picked.size} of ${opts.length} ticked</span>
      </div>
      <ul class="ds-pick" role="list">${opts.map(o => {
        const hay = optHay(o);
        const hidden = q && !hay.includes(q) ? ' hidden' : '';
        const sz = sizeLabel(o.estimate);
        return `<li data-hay="${escapeHtml(hay)}"${hidden}><label class="ds-check" title="${escapeHtml(o.description || '')}">
          <input type="checkbox" data-ds-opt="${escapeHtml(key)}" value="${escapeHtml(String(o.value))}"${picked.has(String(o.value)) ? ' checked' : ''}>
          <span class="ds-check-label">${escapeHtml(o.label)}</span>${sz ? `<span class="ds-size">${sz}</span>` : ''}</label></li>`;
      }).join('')}</ul>` : '';
  return `<fieldset class="ds-filter">
      <legend class="set-name">${escapeHtml(f.label)}</legend>
      ${f.description ? `<p class="dr-note">${escapeHtml(f.description)}</p>` : ''}
      ${modes.length > 1 ? `<div class="ds-modes" role="radiogroup" aria-label="${escapeHtml(f.label)}">${modes.map(([v, l]) =>
        `<label class="ds-radio"><input type="radio" name="ds-${escapeHtml(key)}" data-ds-mode="${escapeHtml(key)}" value="${v}"${v === mode ? ' checked' : ''}> ${escapeHtml(l)}</label>`).join('')}</div>` : ''}
      ${list}
    </fieldset>`;
}

function filterHtml(s: SourceDecl, f: SourceFilter, choice: SourceChoice): string {
  const key = `${s.id}.${f.id}`;
  const value = choice.scope[f.id] ?? s.default_scope[f.id];
  if (f.type === 'multi') return multiHtml(s, f, value);
  if (f.type === 'toggle') {
    return `<label class="ds-check ds-toggle-row"><input type="checkbox" data-ds-toggle="${escapeHtml(key)}"${value ? ' checked' : ''}>
      <span><span class="set-name">${escapeHtml(f.label)}</span>${f.description ? `<span class="set-sub">${escapeHtml(f.description)}</span>` : ''}</span></label>`;
  }
  if (f.type === 'number') {
    return `<label class="ds-filter ds-number"><span class="set-name">${escapeHtml(f.label)}</span>
      <span class="ds-number-in"><input type="number" class="set-input" data-ds-number="${escapeHtml(key)}" min="${f.min ?? ''}" max="${f.max ?? ''}" value="${escapeHtml(String(value ?? ''))}"> ${escapeHtml(f.unit || '')}</span>
      ${f.description ? `<span class="dr-note">${escapeHtml(f.description)}</span>` : ''}</label>`;
  }
  return `<label class="ds-filter"><span class="set-name">${escapeHtml(f.label)}</span>
    <select class="set-select" data-ds-choice="${escapeHtml(key)}">${(f.options || []).map(o =>
      `<option value="${escapeHtml(String(o.value))}"${String(o.value) === String(value) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
}

function sourceCardHtml(s: SourceDecl): string {
  if (!s.available) {
    return `<section class="set-card ds-card is-soon" data-ds-source="${escapeHtml(s.id)}">
      <div class="ds-card-head"><span class="ds-abbr">${escapeHtml(s.short || s.id)}</span>
        <h3 class="ds-title">${escapeHtml(s.label)}</h3><span class="ds-soon">Coming soon</span></div>
      <p class="ds-desc">${escapeHtml(s.description)}</p></section>`;
  }
  const c = choiceFor(s.id);
  const open = ds.open.has(s.id);
  const sched = s.schedule_options.find(o => o.value === c.schedule);
  return `<section class="set-card ds-card${c.enabled ? '' : ' is-off'}" data-ds-source="${escapeHtml(s.id)}">
      <div class="ds-card-head">
        <label class="ds-switch"><input type="checkbox" role="switch" data-ds-enable="${escapeHtml(s.id)}"${c.enabled ? ' checked' : ''} aria-label="Keep ${escapeHtml(s.label)} up to date"><span class="ds-switch-ui" aria-hidden="true"></span></label>
        <span class="ds-abbr">${escapeHtml(s.short || s.id)}</span>
        <h3 class="ds-title">${escapeHtml(s.label)}</h3>
      </div>
      <p class="ds-desc">${escapeHtml(s.description)} <span class="ds-provider">From ${escapeHtml(s.provider)}.</span></p>
      ${statusLine(s)}
      ${keyHtml(s)}
      <div class="ds-row">
        <label class="ds-sched"><span class="set-name">Check for updates</span>
          <select class="set-select" data-ds-schedule="${escapeHtml(s.id)}"${c.enabled ? '' : ' disabled'}>${s.schedule_options.map(o =>
            `<option value="${escapeHtml(o.value)}"${o.value === c.schedule ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>
        ${sched?.description ? `<span class="dr-note">${escapeHtml(sched.description)}</span>` : ''}
      </div>
      ${s.filters.length ? `<button type="button" class="ds-more" data-ds-toggle-open="${escapeHtml(s.id)}" aria-expanded="${open}">${open ? 'Hide' : 'Choose'} what to collect ${icon('chevronRight')}</button>
        ${open ? `<div class="ds-filters">${s.filters.map(f => filterHtml(s, f, c)).join('')}</div>` : ''}` : ''}
    </section>`;
}

function reviewHtml(): string {
  const p = ds.plan;
  if (p) {
    const title = ds.planFor?.templateName ? `Use “${ds.planFor.templateName}”` : 'Review your changes';
    const est = p.estimate?.bytes_label ? `<p class="ds-est">Download about ${escapeHtml(p.estimate.bytes_label)}, ${escapeHtml(p.estimate.time_label || '')}.</p>` : '';
    const list = (items: PlanItem[], cls: string) => items.length ? `<ul class="ds-plan-list ${cls}">${items.map(i =>
      `<li>${escapeHtml(i.label)}${sizeLabel(i.estimate) ? ` <span class="ds-size">${sizeLabel(i.estimate)}</span>` : ''}${i.get_key_url ? ` <a href="${escapeHtml(i.get_key_url)}" target="_blank" rel="noopener">Get a key</a>` : ''}</li>`).join('')}</ul>` : '';
    return `<section class="ds-review" id="ds-review" role="region" aria-label="${escapeHtml(title)}">
        <h3 class="ds-title">${escapeHtml(title)}</h3>
        <p class="ds-summary">${escapeHtml(p.summary)}</p>
        ${est}
        ${list(p.actions, 'is-actions')}
        ${list(p.changes, 'is-changes')}
        ${p.keeps.length ? `<p class="dr-note">Kept on this computer without updates: ${escapeHtml(p.keeps.join(', '))}.</p>` : ''}
        <label class="ds-check ds-remove"><input type="checkbox" data-ds-remove${ds.removeUnselected ? ' checked' : ''}> Also delete the data for anything I unticked</label>
        <div class="ds-review-acts">
          <button type="button" class="btn" data-ds-act="cancel-review">Back</button>
          <button type="button" class="btn btn-accent" data-ds-act="apply"${ds.busy || !ds.planFor ? ' disabled' : ''}>${p.needs_confirm || ds.planFor?.remove ? 'Yes, apply these changes' : 'Apply'}</button>
        </div>
      </section>`;
  }
  if (ds.busy && ds.dirty) return '<div class="ds-bar" role="status"><span>Preparing the review…</span></div>';
  return ds.dirty ? `<div class="ds-bar" role="region" aria-label="Unsaved changes">
      <span>You have changes that aren't applied yet.</span>
      <button type="button" class="btn" data-ds-act="discard">Discard</button>
      <button type="button" class="btn btn-accent" data-ds-act="review"${ds.busy ? ' disabled' : ''}>Review changes</button>
    </div>` : '';
}

export function dataSourcesHtml(): string {
  if (!ds.data || !ds.draft) return '<p class="dr-note">Loading data sources…</p>';
  const cats = ds.data.categories;
  const byCat = (c: string) => ds.data!.sources.filter(s => s.category === c);
  return `<div class="ds" id="ds-root">
      ${templateBarHtml()}
      ${!ds.data.saved && !ds.dirty ? '<p class="dr-note ds-derived">You haven\'t saved a checklist yet, so the app follows what is already on this computer. Pick a template or tick boxes, then apply.</p>' : ''}
      ${cats.map(c => byCat(c).length ? `${flagHtml(c)}<div class="ds-grid">${byCat(c).map(sourceCardHtml).join('')}</div>` : '').join('')}
      <div id="ds-review-slot">${reviewHtml()}</div>
    </div>`;
}

function rerender(focusSel?: string): void {
  const root = document.getElementById('ds-root');
  if (!root) return;
  const active = document.activeElement as HTMLInputElement | null;
  const sel = focusSel || (active?.dataset.dsSearch ? `[data-ds-search="${active.dataset.dsSearch}"]` : '');
  const caret = active?.selectionStart ?? null;
  const top = dom.main.scrollTop;
  root.outerHTML = dataSourcesHtml();
  dom.main.scrollTop = top;
  if (sel) {
    const el = document.querySelector<HTMLInputElement>(sel);
    if (el) {
      el.focus();
      if (caret != null && el.setSelectionRange) try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ }
    }
  }
}

function markDirty(): void {
  ds.dirty = true;
  dropPlan();
}

// Forget the plan on screen and make any preview still in flight stale.
function dropPlan(): void {
  ds.plan = null;
  ds.planFor = null;
  ds.planSeq++;
  ds.busy = false;                           // a superseded preview no longer holds the page
}

// ---------- Actions ----------

async function review(): Promise<void> {
  if (!ds.draft) return;
  dropPlan();
  const seq = ds.planSeq;
  const snapshot = { selection: clone(ds.draft), remove: ds.removeUnselected, templateName: ds.templateName };
  ds.busy = true;
  rerender();
  try {
    const plan = await getJSON<Plan>(`${SOURCES_URL}/selection/preview`, jsonPost({ selection: snapshot.selection, remove_unselected: snapshot.remove }));
    if (seq !== ds.planSeq) return;           // edited while this preview was running
    ds.plan = plan;
    ds.planFor = snapshot;
  } catch (err) {
    if (seq !== ds.planSeq) return;
    showToast(err instanceof Error ? err.message : 'Could not prepare the changes', 5000);
  } finally {
    if (seq === ds.planSeq) ds.busy = false;
  }
  rerender();
  document.getElementById('ds-review')?.scrollIntoView({ block: 'nearest' });
}

// "Use this template" fills the checklist with the template, then reviews it like any edit,
// so the boxes on screen, later edits, Save as template and Apply all work on one selection.
function useTemplate(): void {
  const t = ds.templates.find(x => x.id === ds.templateId);
  if (!t) return;
  ds.draft = clone(t.selection);
  ds.templateName = t.name;
  ds.dirty = true;
  void review();
}

async function apply(): Promise<void> {
  const snap = ds.planFor;
  if (!snap || ds.busy) return;
  ds.busy = true;
  rerender();
  try {
    const res = await getJSON<Plan>(`${SOURCES_URL}/selection/apply`,
      jsonPost({ selection: snap.selection, remove_unselected: snap.remove, confirm: true }));
    const queued = res.queued || [];
    for (const j of queued) state.jobsSeenActive.add(j.id);
    const skipped = res.skipped || [];
    if (res.applied === false) showToast('Nothing was changed');
    else if (skipped.length) {
      showToast(`Saved, but ${skipped.length} step${skipped.length === 1 ? ' was' : 's were'} skipped: ${
        skipped.map(x => `${x.label} (${x.reason || 'skipped'})`).join('; ')}`, 9000);
    } else showToast(queued.length ? 'Data sources updated. Downloads run in the transfer dock.' : 'Data sources updated.');
    ds.dirty = false;
    dropPlan();
    ds.removeUnselected = false;
    ds.templateName = null;
    if (queued.length) void pollJobs();
    await loadDataSources();
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not apply the changes', 5000);
  }
  ds.busy = false;
  rerender();
}

async function saveTemplate(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('[data-ds-template-name]');
  const name = (input?.value || '').trim();
  if (!name) {
    input?.focus();
    showToast('Give the template a name first');
    return;
  }
  try {
    const t = await getJSON<Template>(`${SOURCES_URL}/templates`, jsonPost({ name, selection: ds.draft }));
    const tpl = await getJSON<{ templates: Template[] }>(`${SOURCES_URL}/templates`);
    ds.templates = tpl.templates || [];
    ds.templateId = t.id;
    showToast(`Saved “${t.name}”`);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not save the template', 5000);
  }
  rerender();
}

async function deleteTemplate(id: string, btn: HTMLButtonElement): Promise<void> {
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = 'Click again to delete';
    return;
  }
  try {
    await getJSON(`${SOURCES_URL}/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
    ds.templates = ds.templates.filter(t => t.id !== id);
    ds.templateId = ds.data?.default_preset || '';
    showToast('Template deleted');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not delete the template', 5000);
  }
  rerender();
}

async function exportTemplates(): Promise<void> {
  try {
    const data = await getJSON<unknown>(`${SOURCES_URL}/templates/export`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'framework-data-source-templates.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not export', 5000);
  }
}

async function importTemplates(file: File): Promise<void> {
  try {
    const body = JSON.parse(await file.text()) as unknown;
    const res = await getJSON<{ count: number }>(`${SOURCES_URL}/templates/import`, jsonPost(body));
    const tpl = await getJSON<{ templates: Template[] }>(`${SOURCES_URL}/templates`);
    ds.templates = tpl.templates || [];
    showToast(res.count ? `Imported ${res.count} template${res.count === 1 ? '' : 's'}` : 'No templates found in that file');
  } catch (err) {
    showToast(err instanceof Error && !(err instanceof SyntaxError) ? err.message : 'That file isn’t a template export', 5000);
  }
  rerender();
}

function splitKey(key: string): [SourceDecl | undefined, SourceFilter | undefined] {
  const [sid, fid] = key.split('.');
  const s = ds.data?.sources.find(x => x.id === sid);
  return [s, s?.filters.find(f => f.id === fid)];
}

function optValue(f: SourceFilter, raw: string): string | number {
  const o = (f.options || []).find(x => String(x.value) === raw);
  return o ? o.value : raw;
}

// ---------- Events ----------

const inDs = (t: Element | null) => Boolean(t?.closest('#ds-root'));

onView('click', (e) => {
  const t = e.target as Element | null;
  if (!inDs(t)) return;
  const act = t?.closest<HTMLButtonElement>('[data-ds-act]');
  if (act) {
    const a = act.dataset.dsAct;
    if (a === 'review') void review();
    else if (a === 'use-template') useTemplate();
    else if (a === 'apply') void apply();
    else if (a === 'cancel-review') { dropPlan(); rerender(); }
    else if (a === 'discard') { ds.draft = clone(ds.data!.selection); ds.dirty = false; ds.templateName = null; dropPlan(); rerender(); }
    else if (a === 'import') document.querySelector<HTMLInputElement>('[data-ds-import]')?.click();
    else if (a === 'save-template') void saveTemplate();
    else if (a === 'delete-template') void deleteTemplate(act.dataset.id || '', act);
    else if (a === 'export') void exportTemplates();
    return;
  }
  const more = t?.closest<HTMLElement>('[data-ds-toggle-open]');
  if (more) {
    const id = more.dataset.dsToggleOpen || '';
    if (ds.open.has(id)) ds.open.delete(id); else ds.open.add(id);
    rerender(`[data-ds-toggle-open="${id}"]`);
    return;
  }
  const all = t?.closest<HTMLElement>('[data-ds-all]');
  if (all) {
    const key = all.dataset.dsAll || '';
    const [s, f] = splitKey(key);
    if (!s || !f) return;
    const q = (ds.search[key] || '').toLowerCase();
    const cur = choiceFor(s.id).scope[f.id];
    const visible = pickOptions(f, cur).filter(o => !q || optHay(o).includes(q));
    const set = new Set((Array.isArray(cur) ? cur : []).map(String));
    for (const o of visible) {
      if (all.dataset.on === '1') set.add(String(o.value)); else set.delete(String(o.value));
    }
    choiceFor(s.id).scope[f.id] = [...set].map(v => optValue(f, v));
    markDirty();
    rerender();
  }
});

onView('change', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement | null;
  if (!t || !inDs(t)) return;
  const d = t.dataset;
  if (d.dsTemplate !== undefined && t instanceof HTMLSelectElement) {
    ds.templateId = t.value;
    rerender('[data-ds-template]');
    return;
  }
  if (t instanceof HTMLInputElement && t.hasAttribute('data-ds-import')) {
    const file = t.files?.[0];
    if (file) void importTemplates(file);
    t.value = '';
    return;
  }
  if (t instanceof HTMLInputElement && t.hasAttribute('data-ds-remove')) {
    ds.removeUnselected = t.checked;
    void review();                           // drops the current plan at once, then re-previews
    return;
  }
  if (d.dsEnable) { choiceFor(d.dsEnable).enabled = (t as HTMLInputElement).checked; markDirty(); rerender(`[data-ds-enable="${d.dsEnable}"]`); return; }
  if (d.dsSchedule) { choiceFor(d.dsSchedule).schedule = t.value; markDirty(); rerender(`[data-ds-schedule="${d.dsSchedule}"]`); return; }
  const key = d.dsMode || d.dsOpt || d.dsToggle || d.dsNumber || d.dsChoice;
  if (!key) return;
  const [s, f] = splitKey(key);
  if (!s || !f) return;
  const scope = choiceFor(s.id).scope;
  if (d.dsMode) {
    const prev = scope[f.id];
    scope[f.id] = t.value === 'some' ? (Array.isArray(prev) ? prev : []) : t.value;
  } else if (d.dsOpt) {
    const cur = scope[f.id];
    const set = new Set((Array.isArray(cur) ? cur : []).map(String));
    if ((t as HTMLInputElement).checked) set.add(t.value); else set.delete(t.value);
    scope[f.id] = [...set].map(v => optValue(f, v));
  } else if (d.dsToggle) {
    scope[f.id] = (t as HTMLInputElement).checked;
  } else if (d.dsNumber) {
    const n = parseInt(t.value, 10);
    if (Number.isNaN(n)) return;
    scope[f.id] = Math.min(f.max ?? n, Math.max(f.min ?? n, n));
  } else if (d.dsChoice) {
    scope[f.id] = optValue(f, t.value);
  }
  markDirty();
  const focus = d.dsOpt ? `[data-ds-opt="${key}"][value="${CSS.escape(t.value)}"]`
    : d.dsMode ? `[data-ds-mode="${key}"][value="${t.value}"]`
      : `[data-ds-${d.dsToggle ? 'toggle' : d.dsNumber ? 'number' : 'choice'}="${key}"]`;
  rerender(focus);
});

onView('input', (e) => {
  const t = e.target as HTMLInputElement | null;
  if (!t?.dataset.dsSearch) return;
  ds.search[t.dataset.dsSearch] = t.value;
  // Filter in place so typing never loses focus.
  const q = t.value.toLowerCase();
  const list = t.closest('.ds-filter')?.querySelector('.ds-pick');
  list?.querySelectorAll<HTMLLIElement>('li').forEach(li => {
    li.hidden = Boolean(q) && !(li.dataset.hay || '').includes(q);
  });
});
