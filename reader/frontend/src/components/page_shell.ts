import { onView } from '../core/view_dispatch';
import { escapeHtml } from '../dom';

// The shared page system Home introduced (styles/05a_page_system.css): a masthead with a
// folio line, a serif display title, a sub line and actions; a cushioned tab switchboard;
// a tab lead card; and a KPI strip. Callers pass already-escaped HTML for the *Html fields
// and plain text for the rest.

export interface MastheadOptions {
  folioLeftHtml: string;
  folioRightHtml?: string;
  title: string;
  subHtml?: string;
  actionsHtml?: string;
  tabsHtml?: string;
}

export function pageMastheadHtml({
  folioLeftHtml, folioRightHtml = '', title, subHtml = '', actionsHtml = '', tabsHtml = '',
}: MastheadOptions): string {
  return `<header class="pg-masthead">
      <div class="pg-folio">
        <div class="pg-folio-left">${folioLeftHtml}</div>
        ${folioRightHtml ? `<div class="pg-folio-right">${folioRightHtml}</div>` : ''}
      </div>
      <div class="pg-head">
        <div class="pg-title-copy">
          <h1 class="doc-title pg-display">${escapeHtml(title)}</h1>
          ${subHtml ? `<p class="pg-sub">${subHtml}</p>` : ''}
        </div>
        ${actionsHtml ? `<div class="pg-head-acts">${actionsHtml}</div>` : ''}
      </div>
      ${tabsHtml}
    </header>`;
}

export interface SwitchboardTab {
  id: string;
  label: string;
  abbr: string;
  /** data-ref-tier for the tier hue and pip (usc, cfr, fr…); omit for a neutral tab. */
  refTier?: string;
  countLabel?: string;
  sub: string;
  alert?: boolean;
  alertTitle?: string;
  /** Render the tab as a link (route-driven tabs) instead of a button. */
  href?: string;
}

export interface SwitchboardOptions {
  /** Element id of the tablist; each tab gets `${idPrefix}-${tab.id}`. */
  id: string;
  idPrefix: string;
  /** The data attribute that carries a tab's id, e.g. 'hm-tab' → data-hm-tab. */
  dataAttr: string;
  /** The id of the tabpanel the tabs control. */
  panelId: string;
  label: string;
  tabs: SwitchboardTab[];
  active: string;
}

export function switchboardHtml({ id, idPrefix, dataAttr, panelId, label, tabs, active }: SwitchboardOptions): string {
  return `
    <nav class="pg-tabs" id="${escapeHtml(id)}" role="tablist" aria-label="${escapeHtml(label)}" style="--pg-tab-count:${tabs.length}">
      ${tabs.map(t => {
        const on = active === t.id;
        const tag = t.href ? 'a' : 'button';
        const attrs = t.href ? `href="${escapeHtml(t.href)}"` : 'type="button"';
        return `<${tag} ${attrs} class="pg-tab${on ? ' is-active' : ''}" id="${escapeHtml(`${idPrefix}-${t.id}`)}" role="tab" aria-selected="${on}" aria-controls="${escapeHtml(panelId)}" tabindex="${on ? '0' : '-1'}" data-${dataAttr}="${escapeHtml(t.id)}"${t.refTier ? ` data-ref-tier="${escapeHtml(t.refTier)}"` : ''}>
          <span class="pg-tab-top">
            <span class="pg-tab-abbr">${t.refTier ? '<span class="tier-pip" aria-hidden="true"></span>' : ''}${escapeHtml(t.abbr)}</span>
            <span class="pg-tab-right">
              ${t.alert ? `<span class="stat-dot is-stale" title="${escapeHtml(t.alertTitle || 'Update or sync due')}" aria-hidden="true"></span>` : ''}
              ${t.countLabel ? `<span class="pg-tab-count">${escapeHtml(t.countLabel)}</span>` : ''}
            </span>
          </span>
          <span class="pg-tab-label">${escapeHtml(t.label)}</span>
          <span class="pg-tab-sub">${escapeHtml(t.sub)}</span>
        </${tag}>`;
      }).join('')}
    </nav>`;
}

/**
 * WAI-ARIA tablist keys for a switchboard: ←/→ wrap, Home/End jump. `activate` receives the
 * next tab id and must move focus to it once the tabs are re-rendered.
 */
export function bindSwitchboardKeys(tablistSelector: string, dataAttr: string, order: () => string[], activate: (id: string) => void): void {
  const key = dataAttr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  onView('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const tab = (e.target as Element | null)?.closest<HTMLElement>(`${tablistSelector} [data-${dataAttr}]`);
    if (!tab) return;
    const ids = order();
    const idx = ids.indexOf(tab.dataset[key] || '');
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    activate(ids[next]);
  });
}

export interface TabLeadOptions {
  refTier?: string;
  kickerHtml: string;
  title: string;
  subHtml?: string;
  actionsHtml?: string;
  id?: string;
}

export function tabLeadHtml({ refTier, kickerHtml, title, subHtml = '', actionsHtml = '', id }: TabLeadOptions): string {
  return `<div class="pg-lead"${id ? ` id="${escapeHtml(id)}"` : ''}${refTier ? ` data-ref-tier="${escapeHtml(refTier)}"` : ''}>
      <div class="pg-lead-copy">
        <div class="pg-lead-kicker">${kickerHtml}</div>
        <h2 class="pg-lead-title">${escapeHtml(title)}</h2>
        ${subHtml ? `<p class="pg-lead-sub">${subHtml}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="pg-lead-acts">${actionsHtml}</div>` : ''}
    </div>`;
}

export interface KpiCell {
  labelHtml: string;
  valueHtml: string;
  subHtml?: string;
  alert?: boolean;
}

export function kpiStripHtml(cells: KpiCell[], { label, refTier, cls = '' }: { label: string; refTier?: string; cls?: string }): string {
  return `<section class="pg-kpi-strip${cls ? ` ${cls}` : ''}"${refTier ? ` data-ref-tier="${escapeHtml(refTier)}"` : ''} aria-label="${escapeHtml(label)}">
      ${cells.map(c => `<div class="pg-kpi-cell${c.alert ? ' is-alert' : ''}">
        <span class="pg-kpi-lbl">${c.labelHtml}</span>
        <span class="pg-kpi-val">${c.valueHtml}</span>
        ${c.subHtml ? `<span class="pg-kpi-sub">${c.subHtml}</span>` : ''}
      </div>`).join('')}
    </section>`;
}

export function flagHtml(title: string, metaHtml = '', id = ''): string {
  return `<header class="pg-flag"${id ? ` id="${escapeHtml(id)}"` : ''}><h2 class="pg-flag-title">${escapeHtml(title)}</h2>${metaHtml ? `<span class="pg-flag-meta">${metaHtml}</span>` : ''}</header>`;
}
