import { NEWS_CITE_RE } from '../citations';
import { state } from '../state';
import { fmtDate, statPill } from '../components/ui';
import { escapeHtml, safeHttpUrl } from '../dom';
import { timeAgo } from '../usage';

// Shared News formatting, citation-link, and status-pill helpers (zero view dependencies).

export const NEWS_SOURCE_LABELS: Record<string, string> = {
  federal_register: 'Federal Register',
  federal_register_pi: 'Federal Register Public Inspection',
  dol_osha: 'DOL enforcement data',
};

export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  GU: 'Guam', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', VI: 'Virgin Islands', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export const stateName = (code?: string | null): string =>
  US_STATE_NAMES[(code || '').toUpperCase()] || (code || '');

export const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function fmtMoney(n: number): string {
  return moneyFmt.format(n);
}

export function extLink(url: string | undefined | null, html: string): string {
  const safe = safeHttpUrl(url);
  return safe ? `<a target="_blank" rel="noopener" href="${escapeHtml(safe)}">${html}</a>` : html;
}

export function titleInstalled(t: number): boolean {
  return state.installedTitles.some(x => x.title === t);
}

export function newsSectionHref(t: number, id: string): string {
  return titleInstalled(t) ? `#/title/${t}/section/${encodeURIComponent(id)}` : `#/library/${t}`;
}

export function newsPartHref(t: number, part: string | number): string {
  return titleInstalled(t) ? `#/title/${t}/part/${encodeURIComponent(String(part))}` : `#/library/${t}`;
}

export function inspectionActivityNr(a: { category?: string; guid?: string } | null | undefined): string | null {
  if (!a || a.category !== 'enforcement' || !a.guid) return null;
  const m = /^dol-insp:(\d+)$/.exec(String(a.guid));
  return m ? m[1] : null;
}

export function frDocumentNumber(a: { category?: string; guid?: string } | null | undefined): string | null {
  if (!a || a.category === 'enforcement' || a.category === 'public_inspection' || !a.guid) return null;
  const m = /^fr:([A-Za-z0-9._-]+)$/.exec(String(a.guid));
  return m ? m[1] : null;
}

export function newsKicker(a: { category?: string; state?: string | null; doc_type?: string | null; citation?: string | null }): string {
  if (a.category === 'enforcement') return ['ENFORCEMENT', a.state].filter(Boolean).join(' · ');
  if (a.category === 'public_inspection') {
    return ['PUBLIC INSPECTION', (a.doc_type || '').toUpperCase()].filter(Boolean).join(' · ');
  }
  const label = a.category === 'rules' ? 'FINAL RULE' : a.category === 'rulemaking' ? 'PROPOSED RULE' : 'NOTICE';
  return [label, a.citation].filter(Boolean).join(' · ');
}

export function newsBylineHtml(a: { published_at: string; source?: string }): string {
  const src = a.source || '';
  return `<div class="news-byline">${escapeHtml(fmtDate(a.published_at))}<span class="sep" aria-hidden="true">·</span>${escapeHtml(NEWS_SOURCE_LABELS[src] || src)}</div>`;
}

export interface NewsStatusSource {
  enabled?: boolean;
  last_ok_at?: string | null;
  last_error?: string | null;
}

export interface NewsStatusPayload {
  sync_enabled?: boolean;
  syncing?: boolean;
  sources?: Record<string, NewsStatusSource>;
}

export function newsStatusPillHtml(status: NewsStatusPayload | null | undefined): string {
  if (!status) return '';
  if (!status.sync_enabled) return statPill('stale', 'News sync is off');
  if (status.syncing) return statPill('busy', 'Checking for news…');
  const enabled = Object.values(status.sources || {}).filter(s => s.enabled);
  const lastOk = enabled.map(s => s.last_ok_at).filter(Boolean).sort().pop();
  const failed = enabled.find(s => s.last_error);
  if (failed && lastOk) {
    return statPill('stale', `Last update failed · showing data from ${fmtDate(lastOk.slice(0, 10))}`, { title: failed.last_error || '' });
  }
  return lastOk ? statPill('synced', `Updated ${timeAgo(Date.parse(lastOk))}`) : '';
}

export function linkifyNewsText(text: string | null | undefined): string {
  return escapeHtml(text || '').replace(NEWS_CITE_RE, (m: string, a: string, b: string) => {
    const id = a || b;
    return `<a class="citation-link" href="${newsSectionHref(29, id)}">${m}</a>`;
  });
}
