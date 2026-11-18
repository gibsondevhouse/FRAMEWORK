import { escapeHtml } from '../dom';
import { fmt } from '../usage';

// --- Shared UI Primitives & Formatting Helpers ---
// Canonical HTML builders and formatting utilities shared across views, panels,
// and components so cards, status pills, segmented controls, and transfer
// progress blocks stay visually identical everywhere.

export const SEP = '<span class="sep" aria-hidden="true">·</span>';

export const joinSep = (xs) => xs.filter(Boolean).join(SEP);

export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const shortDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const opts = d.getFullYear() === new Date().getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
};

export const fmtBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
};

export const fmtMB = (mb) => (mb ? fmtBytes(mb * 1048576) : '');

export const fmtSections = (n) => (n ? `${fmt(n)} ${n === 1 ? 'section' : 'sections'}` : '');

// Status: a 6px dot and a word (Linear's issue-status vocabulary).
// Strictly for sync/download state: synced | stale | busy | partial | uninstalled.
export function statPill(state, text, { bare = false, title = '' } = {}) {
  return `<span class="stat-pill is-${state}${bare ? ' is-bare' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>`
    + `<span class="stat-dot is-${state}" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}

// Metric tile used in Library, Enforcement briefing, and Inspection Case File.
export function metricCardHtml({ label, value, of = '', sub = '', alert = false }) {
  return `<div class="metric-card${alert ? ' is-alert' : ''}">`
    + `<div class="metric-label">${label}</div>`
    + `<div class="metric-val">${value}${of ? `<span class="metric-of">${escapeHtml(of)}</span>` : ''}</div>`
    + `<div class="metric-sub">${sub}</div></div>`;
}

// Empty / error state panel.
export function emptyStateHtml({ title, body = '', actionsHtml = '', cls = '' } = {}) {
  return `<div class="empty-state${cls ? ' ' + cls : ''}">`
    + `<h2>${escapeHtml(title)}</h2>`
    + (body ? `<p>${body}</p>` : '')
    + (actionsHtml || '')
    + '</div>';
}

// Segmented control builder (`items`: [{ value, label, attrs }]).
export function segmentedHtml({ label, items, value, cls = 'seg', role = 'group', dataAttr = 'data-value' }) {
  return `<div class="${cls}" role="${role}" aria-label="${escapeHtml(label)}">${items.map(it => {
    const on = it.value === value;
    return `<button type="button" ${dataAttr}="${escapeHtml(it.value)}" aria-pressed="${on}"${it.attrs ? ' ' + it.attrs : ''}>${it.label}</button>`;
  }).join('')}</div>`;
}

// Shared transfer progress track + fill (used by Transfer dock, Library panel, Welcome, CFR Resolver).
export function transferTrackHtml(pct, { bindFill = false } = {}) {
  const fillAttr = bindFill ? ' data-f="fill"' : '';
  return `<div class="dock-track"><span class="dock-fill${pct == null ? ' is-indeterminate' : ''}"${fillAttr} style="width:${pct == null ? 35 : pct}%"></span></div>`;
}
