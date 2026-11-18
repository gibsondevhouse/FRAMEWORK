import { LegacyRefHint, RefCiter, ReferenceItem, ReferencesResponse, state } from '../state';
import { escapeHtml, plural, safeHttpUrl } from '../dom';
import { fmt } from '../usage';

// --- References & Authorities Almanac (Title Start bottom hub) ---
export const REF_CATS: Array<[string, string]> = [
  ['all', 'All Web'],
  ['ibr', 'IBR Standards'],
  ['standards', 'Standards Bodies'],
  ['portals', 'Federal Portals'],
  ['agencies', 'Agencies & Guidance'],
  ['technical', 'Technical & Other'],
  ['legacy', 'Retired URLs'],
];

export const CAT_LABELS: Record<string, string> = {
  standards: 'Standards',
  portals: 'Portal',
  agencies: 'Agency',
  technical: 'Technical',
};

export interface RefUiState {
  title: number | null;
  beat: string;
  cat: string;
  q: string;
  expanded: boolean;
}

export const refUi: RefUiState = { title: null, beat: 'front', cat: 'all', q: '', expanded: false };

export interface RefHostItem extends ReferenceItem {
  urls?: Array<{ url: string; display: string }>;
  url_count?: number;
}

export interface IbrStandardItem {
  code: string;
  org: string;
  org_name?: string;
  org_url?: string;
  excerpt: string;
  section_count?: number;
  approved_in?: Array<{ id: string; label: string; part: string; para?: string }>;
}

export interface AlmanacReferencesResponse extends ReferencesResponse {
  hosts?: RefHostItem[];
  host_total?: number;
  host_category_counts?: Record<string, number>;
  ibr_standards?: IbrStandardItem[];
  ibr_total?: number;
}

function filterWebEntries(data: AlmanacReferencesResponse, cat: string, q: string): RefHostItem[] {
  const ql = q.trim().toLowerCase();
  const hosts = data.hosts && data.hosts.length ? data.hosts : null;
  const rawItems: RefHostItem[] = data.items || [];

  const sourceList = hosts || rawItems;
  let filtered = sourceList.filter(it => {
    if (cat === 'legacy') {
      if (!it.legacy) return false;
    } else if (cat !== 'all' && it.category !== cat) {
      return false;
    }
    if (!ql) return true;
    const subUrls = (it.urls || []).map(u => `${u.url} ${u.display}`).join(' ');
    const cites = (it.cited_in || []).map(c => `${c.id} ${c.label} ${c.title} ${c.part}`).join(' ');
    const hay = `${it.host} ${it.url} ${it.display} ${subUrls} ${it.legacy?.replacement_url || ''} ${cites}`.toLowerCase();
    return hay.includes(ql);
  });

  if (hosts && ql && !filtered.length) {
    filtered = rawItems.filter(it => {
      if (cat === 'legacy' && !it.legacy) return false;
      if (cat !== 'all' && cat !== 'legacy' && it.category !== cat) return false;
      const cites = (it.cited_in || []).map((c: RefCiter) => `${c.id} ${c.label} ${c.title} ${c.part}`).join(' ');
      return `${it.host} ${it.url} ${it.display} ${it.legacy?.replacement_url || ''} ${cites}`.toLowerCase().includes(ql);
    });
  }
  return filtered;
}

function filterIbrEntries(data: AlmanacReferencesResponse, q: string): IbrStandardItem[] {
  const list = data.ibr_standards || [];
  const ql = q.trim().toLowerCase();
  if (!ql) return list;
  return list.filter(s => {
    const secs = (s.approved_in || []).map(a => `${a.id} ${a.label} ${a.part} ${a.para || ''}`).join(' ');
    const hay = `${s.code} ${s.org} ${s.org_name || ''} ${s.excerpt} ${secs}`.toLowerCase();
    return hay.includes(ql);
  });
}

function renderWebItemHtml(item: RefHostItem, titleNum: number): string {
  const citesHtml = (item.cited_in || []).slice(0, 4).map(c =>
    `<a class="citation-chip" data-ref-tier="cfr" href="#/title/${titleNum}/section/${encodeURIComponent(c.id)}" title="${escapeHtml(c.title)}">${escapeHtml(c.label)}</a>`
  ).join('');
  const moreCites = item.cite_count > 4 ? `<span class="ref-cite-more">+${item.cite_count - 4}</span>` : '';
  const href = safeHttpUrl(item.url);
  const leg: LegacyRefHint | null = item.legacy;
  const replHref = leg ? safeHttpUrl(leg.replacement_url) : '';
  const legacyHtml = leg ? `
    <div class="ref-legacy">
      <span class="stat-pill is-stale is-bare"><span class="stat-dot is-stale" aria-hidden="true"></span>Retired URL</span>
      <span class="ref-legacy-note">${escapeHtml(leg.note)}</span>
      ${replHref ? `<a class="citation-chip" href="${escapeHtml(replHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(leg.replacement_label)} ↗</a>` : ''}
    </div>` : '';
  const pageCount = (item.url_count || 0) > 1 ? `<span class="ref-subpages">${item.url_count} URLs</span>` : '';

  return `
    <article class="ref-item">
      <div class="ref-item-top">
        <span class="ref-host">${escapeHtml(item.host)}</span>
        <span class="ref-cat-pill">${escapeHtml(CAT_LABELS[item.category] || item.category)}</span>
        ${pageCount}
        <span class="ref-count">${plural(item.cite_count, 'section')}</span>
      </div>
      ${href
        ? `<a class="ref-url" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.display)}</a>`
        : `<span class="ref-url">${escapeHtml(item.display)}</span>`}
      ${legacyHtml}
      ${citesHtml ? `<div class="ref-cites"><span class="ref-cites-lbl">Cited in</span>${citesHtml}${moreCites}</div>` : ''}
    </article>`;
}

function renderIbrItemHtml(std: IbrStandardItem, titleNum: number): string {
  const approved = (std.approved_in || []).slice(0, 4).map(a =>
    `<a class="citation-chip" data-ref-tier="ibr" href="#/title/${titleNum}/section/${encodeURIComponent(a.id)}${a.para ? '?p=' + encodeURIComponent(a.para) : ''}">${escapeHtml(a.label)}${a.para ? escapeHtml(a.para) : ''}</a>`
  ).join('');
  const extra = (std.section_count || 0) - 4;
  const orgHref = safeHttpUrl(std.org_url);
  return `
    <article class="ref-item is-ibr has-tier-bar" data-ref-tier="ibr">
      <div class="ref-item-top">
        <span class="ref-host">${escapeHtml(std.code)}</span>
        ${orgHref
          ? `<a class="ref-cat-pill is-link" href="${escapeHtml(orgHref)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(std.org_name || std.org)}">${escapeHtml(std.org)} ↗</a>`
          : `<span class="ref-cat-pill">${escapeHtml(std.org)}</span>`}
        <span class="ref-count">${plural(std.section_count || 1, 'section')}</span>
      </div>
      <div class="ref-ibr-excerpt">${escapeHtml(std.excerpt)}</div>
      <div class="ref-cites">
        <span class="ref-cites-lbl">Approved in</span>
        ${approved}
        ${extra > 0 ? `<span class="ref-cite-more">+${extra}</span>` : ''}
      </div>
    </article>`;
}

function renderRefListHtml(data: AlmanacReferencesResponse, titleNum: number): string {
  const isIbr = refUi.cat === 'ibr';
  if (isIbr) {
    const filtered = filterIbrEntries(data, refUi.q);
    if (!filtered.length) return '<div class="ref-empty">No matching references for the current filter.</div>';
    const showLimit = refUi.expanded || refUi.q.trim() ? filtered.length : 12;
    const shown = filtered.slice(0, showLimit);
    const rows = shown.map(item => renderIbrItemHtml(item, titleNum)).join('');
    const moreBtn = filtered.length > shown.length
      ? `<div class="ref-more"><button type="button" class="btn btn-sm" id="ref-show-all">Show all ${filtered.length} matching entries</button></div>`
      : '';
    return `<div class="ref-grid">${rows}</div>${moreBtn}`;
  }
  const filtered = filterWebEntries(data, refUi.cat, refUi.q);
  if (!filtered.length) return '<div class="ref-empty">No matching references for the current filter.</div>';
  const showLimit = refUi.expanded || refUi.q.trim() ? filtered.length : 12;
  const shown = filtered.slice(0, showLimit);
  const rows = shown.map(item => renderWebItemHtml(item, titleNum)).join('');
  const moreBtn = filtered.length > shown.length
    ? `<div class="ref-more"><button type="button" class="btn btn-sm" id="ref-show-all">Show all ${filtered.length} matching entries</button></div>`
    : '';
  return `<div class="ref-grid">${rows}</div>${moreBtn}`;
}

export function updateRefHubDom(data: AlmanacReferencesResponse, titleNum: number): void {
  const hubEl = document.getElementById('ts-almanac');
  const catsEl = document.getElementById('ref-cats-slot');
  const listEl = document.getElementById('ref-list-slot');
  const countEl = document.getElementById('ref-total-count');
  if (!hubEl || !catsEl || !listEl) return;

  const webTotal = data.host_total ?? data.total ?? 0;
  const ibrTotal = data.ibr_total ?? (data.ibr_standards || []).length;
  const catCounts = data.host_category_counts || data.category_counts || {};
  const legacyCount = (data.hosts || data.items || []).filter(it => it.legacy).length;

  if (!webTotal && !ibrTotal) {
    const count = Number(state.metaInfo.section_count || 0);
    hubEl.innerHTML = `
      <div class="ts-colophon">
        Edition Colophon · Title ${titleNum}${count ? ` · ${fmt(count)} sections` : ''} · No external web portals or incorporated consensus standards cited.
      </div>`;
    return;
  }

  if (countEl) {
    const parts: string[] = [];
    if (webTotal) parts.push(plural(webTotal, data.host_total ? 'host' : 'resource'));
    if (ibrTotal) parts.push(plural(ibrTotal, 'IBR standard'));
    countEl.textContent = parts.join(' · ');
  }

  if (refUi.cat === 'ibr' && !ibrTotal) refUi.cat = 'all';
  if (refUi.cat === 'legacy' && !legacyCount) refUi.cat = 'all';

  catsEl.innerHTML = REF_CATS.map(([k, label]) => {
    const n = k === 'all' ? webTotal
      : k === 'ibr' ? ibrTotal
      : k === 'legacy' ? legacyCount
      : (catCounts[k] || 0);
    if (k !== 'all' && !n) return '';
    return `<button type="button" class="sf-pill${refUi.cat === k ? ' is-active' : ''}" data-ref-cat="${k}" aria-pressed="${refUi.cat === k}">${escapeHtml(label)} <span class="sf-pill-count">${n}</span></button>`;
  }).join('');

  listEl.innerHTML = renderRefListHtml(data, titleNum);
}
