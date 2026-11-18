import { escapeHtml } from '../dom';
import { fmt } from '../usage';

// --- Shared UI Primitives & Formatting Helpers ---

export const SEP = '<span class="sep" aria-hidden="true">·</span>';

export const joinSep = (xs: Array<string | false | null | undefined>): string => xs.filter(Boolean).join(SEP);

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
};

export const fmtBytes = (bytes: number | null | undefined): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
};

export const fmtMB = (mb: number | null | undefined): string => (mb ? fmtBytes(mb * 1048576) : '');

export const fmtSections = (n: number | null | undefined): string => (n ? `${fmt(n)} ${n === 1 ? 'section' : 'sections'}` : '');

export type StatPillState = 'synced' | 'stale' | 'busy' | 'partial' | 'uninstalled';

export function statPill(
  stateName: StatPillState,
  text: string,
  { bare = false, title = '' }: { bare?: boolean; title?: string } = {},
): string {
  return `<span class="stat-pill is-${stateName}${bare ? ' is-bare' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>`
    + `<span class="stat-dot is-${stateName}" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}

export interface MetricCardOptions {
  label: string;
  value: string;
  of?: string;
  sub?: string;
  alert?: boolean;
}

export function metricCardHtml({ label, value, of = '', sub = '', alert = false }: MetricCardOptions): string {
  return `<div class="metric-card${alert ? ' is-alert' : ''}">`
    + `<div class="metric-label">${label}</div>`
    + `<div class="metric-val">${value}${of ? `<span class="metric-of">${escapeHtml(of)}</span>` : ''}</div>`
    + `<div class="metric-sub">${sub}</div></div>`;
}

export interface EmptyStateOptions {
  title?: string;
  body?: string;
  actionsHtml?: string;
  cls?: string;
}

export function emptyStateHtml({ title = '', body = '', actionsHtml = '', cls = '' }: EmptyStateOptions = {}): string {
  return `<div class="empty-state${cls ? ' ' + cls : ''}">`
    + `<h2>${escapeHtml(title)}</h2>`
    + (body ? `<p>${body}</p>` : '')
    + (actionsHtml || '')
    + '</div>';
}

export interface SegmentedItem {
  value: string;
  label: string;
  attrs?: string;
}

export interface SegmentedOptions {
  label: string;
  items: SegmentedItem[];
  value: string;
  cls?: string;
  role?: string;
  dataAttr?: string;
}

export function segmentedHtml({
  label, items, value, cls = 'seg', role = 'group', dataAttr = 'data-value',
}: SegmentedOptions): string {
  return `<div class="${cls}" role="${role}" aria-label="${escapeHtml(label)}">${items.map(it => {
    const on = it.value === value;
    return `<button type="button" ${dataAttr}="${escapeHtml(it.value)}" aria-pressed="${on}"${it.attrs ? ' ' + it.attrs : ''}>${it.label}</button>`;
  }).join('')}</div>`;
}

export function transferTrackHtml(pct: number | null | undefined, { bindFill = false }: { bindFill?: boolean } = {}): string {
  const fillAttr = bindFill ? ' data-f="fill"' : '';
  return `<div class="dock-track"><span class="dock-fill${pct == null ? ' is-indeterminate' : ''}"${fillAttr} style="width:${pct == null ? 35 : pct}%"></span></div>`;
}
