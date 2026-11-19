import {
  AuthorityTier, CorpusSummary, DeskId, InstalledTitleMeta, NewsStatusSnapshot,
  RefTier, state, TitleSnapshotRow,
} from '../state';
import { escapeHtml, lsGet, lsSet } from '../dom';

const ACTIVE_DESK_KEY = 'framework_desk_v1';

export const TIER_ORDER = [
  'federal-statute',
  'federal-reg',
  'federal-register',
  'state',
  'county',
  'standard',
] as const;

export const SYSTEM_TIERS: AuthorityTier[] = [
  'federal-statute',
  'federal-reg',
  'federal-register',
  'state',
];

export interface TierMeta {
  label: string;
  short: string;
  refTier: RefTier;
  tag: string;
  subtitle: string;
}

export const TIER_META: Record<string, TierMeta> = {
  'federal-statute': {
    label: 'U.S. Code (U.S.C.)',
    short: 'U.S.C.',
    refTier: 'usc',
    tag: 'STATUTE',
    subtitle: 'Enabling federal statutes',
  },
  'federal-reg': {
    label: 'Federal Regulations (CFR)',
    short: 'CFR',
    refTier: 'cfr',
    tag: 'FEDERAL REG',
    subtitle: 'Codified agency rules',
  },
  'federal-register': {
    label: 'Federal Register (FR)',
    short: 'FR',
    refTier: 'fr',
    tag: 'FED REGISTER',
    subtitle: 'Daily rulemaking & notices',
  },
  'state': {
    label: 'State Codes & Plans',
    short: 'State',
    refTier: 'state',
    tag: 'STATE',
    subtitle: 'State plans & delegated codes',
  },
  'county': {
    label: 'County & Municipal',
    short: 'County',
    refTier: 'county',
    tag: 'LOCAL CODE',
    subtitle: 'Local ordinances & overlays',
  },
  'standard': {
    label: 'Consensus Standards',
    short: 'Std',
    refTier: 'ibr',
    tag: 'STANDARD',
    subtitle: 'IBR technical standards',
  },
};

export const DESK_DEFS: Array<{ id: DeskId; label: string }> = [
  { id: 'all', label: 'All Desks' },
  { id: 'ehs', label: 'Safety & Labor' },
  { id: 'env', label: 'Environmental' },
  { id: 'transport', label: 'Transport & HazMat' },
  { id: 'labor-employment', label: 'Wage & Benefits' },
  { id: 'fire-building', label: 'Fire & Building' },
  { id: 'commerce-govcon', label: 'Commerce & GovCon' },
];

const DESK_BY_CFR_TITLE: Record<number, DeskId> = {
  10: 'env',
  14: 'transport',
  16: 'commerce-govcon',
  21: 'commerce-govcon',
  23: 'transport',
  24: 'fire-building',
  26: 'commerce-govcon',
  29: 'ehs',
  30: 'ehs',
  33: 'env',
  40: 'env',
  42: 'ehs',
  45: 'labor-employment',
  46: 'transport',
  48: 'commerce-govcon',
  49: 'transport',
};

interface KnownTitleAuthority {
  statuteCode: string;
  statuteLabel: string;
  statuteHref: string;
  stateHint: string;
  countyHint: string;
}

const KNOWN_TITLE_AUTHORITIES: Record<number, KnownTitleAuthority> = {
  29: {
    statuteCode: '29 U.S.C. §§ 651–678',
    statuteLabel: 'OSH Act / FLSA Statutory Base',
    statuteHref: 'https://www.law.cornell.edu/uscode/text/29/651',
    stateHint: 'Approved State Plans (e.g. Cal/OSHA Title 8, DOSH, MIOSHA)',
    countyHint: 'Municipal fire / health enforcement overlays',
  },
  40: {
    statuteCode: '42 U.S.C. §§ 6901, 7401',
    statuteLabel: 'RCRA / Clean Air / Clean Water Acts',
    statuteHref: 'https://www.law.cornell.edu/uscode/text/42/6901',
    stateHint: 'Delegated state environmental agencies & SIPs',
    countyHint: 'Air quality management districts & POTW ordinances',
  },
  49: {
    statuteCode: '49 U.S.C. §§ 5101–5128',
    statuteLabel: 'Hazardous Materials Transportation Act',
    statuteHref: 'https://www.law.cornell.edu/uscode/text/49/5101',
    stateHint: 'State DOT commercial motor vehicle adoptions',
    countyHint: 'Local hazmat routing & tunnel restrictions',
  },
};

const VALID_DESKS = new Set<string>(DESK_DEFS.map(d => d.id));

export function loadActiveDesk(): DeskId {
  const saved = lsGet(ACTIVE_DESK_KEY);
  const next: DeskId = saved && VALID_DESKS.has(saved) ? (saved as DeskId) : 'all';
  state.activeDesk = next;
  return next;
}

export function setActiveDesk(desk: string): DeskId {
  const next: DeskId = VALID_DESKS.has(desk) ? (desk as DeskId) : 'all';
  state.activeDesk = next;
  lsSet(ACTIVE_DESK_KEY, next);
  return next;
}

loadActiveDesk();

export function mapRawDeskToId(rawDesk: unknown, titleNum: number | null = null): DeskId {
  const txt = String(rawDesk || '').trim().toLowerCase();
  if (VALID_DESKS.has(txt)) return txt as DeskId;
  if (titleNum && DESK_BY_CFR_TITLE[titleNum]) return DESK_BY_CFR_TITLE[titleNum];
  if (txt.includes('safety') || txt.includes('osha') || txt.includes('health') || txt.includes('workplace')) return 'ehs';
  if (txt.includes('environ') || txt.includes('epa')) return 'env';
  if (txt.includes('transport') || txt.includes('dot') || txt.includes('hazmat')) return 'transport';
  if (txt.includes('fire') || txt.includes('build')) return 'fire-building';
  if (txt.includes('labor') || txt.includes('wage') || txt.includes('employ')) return 'labor-employment';
  if (txt.includes('commer') || txt.includes('trade') || txt.includes('gov') || txt.includes('tax')) return 'commerce-govcon';
  return 'ehs';
}

export function deskLabel(deskId: string): string {
  return DESK_DEFS.find(d => d.id === deskId)?.label || 'Regulatory';
}

export function tierMetaFor(tier: string): TierMeta {
  return TIER_META[tier] || TIER_META['federal-reg'];
}

export function refTierForCorpus(corpusOrTier: CorpusSummary | string | null | undefined): RefTier {
  const tier = typeof corpusOrTier === 'string' ? corpusOrTier : (corpusOrTier?.tier || 'federal-reg');
  return tierMetaFor(tier).refTier;
}

export function corpusIdForTitle(titleNum: number | string): string {
  return `us:cfr:${Number(titleNum) || 29}`;
}

export function corpusHashFor(corpus: Pick<CorpusSummary, 'tier' | 'title_num' | 'jurisdiction' | 'code' | 'corpus_id'>, subPath = '/'): string {
  const cleanSub = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (corpus.tier === 'federal-reg' && corpus.title_num) {
    return `#/title/${corpus.title_num}${cleanSub}`;
  }
  const tierSeg = encodeURIComponent(corpus.tier);
  const jurSeg = encodeURIComponent(corpus.jurisdiction || 'US');
  const codeSeg = encodeURIComponent(corpus.code || corpus.corpus_id);
  return `#/corpus/${tierSeg}/${jurSeg}/${codeSeg}${cleanSub === '/' ? '/' : cleanSub}`;
}

export function parseCorpusPath(path: string): { tier: string; jurisdiction: string; code: string; subPath: string } | null {
  const m = /^\/corpus\/([^/]+)\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path || '');
  if (!m) return null;
  const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  return {
    tier: decode(m[1]),
    jurisdiction: decode(m[2]),
    code: decode(m[3]),
    subPath: m[4] || '/',
  };
}

export function normalizeCorporaList(
  titles: InstalledTitleMeta[] = state.installedTitles,
  snapshotRows: TitleSnapshotRow[] | undefined = state.homeSnapshot?.titles,
  extras: CorpusSummary[] = state.extraCorpora,
): CorpusSummary[] {
  const snapByTitle = new Map((snapshotRows || []).map(r => [r.title, r]));
  const cfr: CorpusSummary[] = (titles || []).map(t => {
    const snap = snapByTitle.get(t.title);
    const desk = mapRawDeskToId(snap?.desk, t.title);
    return {
      corpus_id: corpusIdForTitle(t.title),
      tier: 'federal-reg',
      jurisdiction: 'US',
      jurisdiction_label: 'Federal',
      code: String(t.title),
      title_num: t.title,
      name: t.name || `Title ${t.title}`,
      desk,
      agencies: snap?.agencies || [],
      edition: t.edition || snap?.edition || null,
      section_count: t.section_count || snap?.section_count || 0,
      partial: Boolean(t.partial),
      summary: snap?.summary || '',
      installed: true,
    };
  });
  const byId = new Map<string, CorpusSummary>(cfr.map(c => [c.corpus_id, c]));
  const mockWin = (typeof window !== 'undefined'
    ? (window as unknown as { __FRAMEWORK_MOCK_CORPORA__?: CorpusSummary[] }).__FRAMEWORK_MOCK_CORPORA__
    : undefined) || [];
  const injected = Array.isArray(extras) && extras.length ? extras : mockWin;
  for (const raw of injected) {
    if (!raw || !raw.corpus_id) continue;
    byId.set(raw.corpus_id, {
      ...raw,
      tier: raw.tier || 'state',
      jurisdiction: raw.jurisdiction || 'US',
      jurisdiction_label: raw.jurisdiction_label || 'Jurisdiction',
      code: raw.code || raw.corpus_id,
      name: raw.name || raw.corpus_id,
      desk: mapRawDeskToId(raw.desk),
      agencies: Array.isArray(raw.agencies) ? raw.agencies : [],
      installed: raw.installed !== false,
    });
  }
  return [...byId.values()];
}

export function syncCorporaState(): CorpusSummary[] {
  state.corpora = normalizeCorporaList();
  state.activeCorpusId = corpusIdForTitle(state.currentTitle);
  return state.corpora;
}

const DEFAULT_STATE_OVERLAYS: Array<{
  title: number;
  corpus_id: string;
  jurisdiction: string;
  jurisdiction_label: string;
  code: string;
  name: string;
  desk: DeskId;
  agencies: string[];
  summary: string;
}> = [
  {
    title: 29,
    corpus_id: 'us-ca:state:8-CCR',
    jurisdiction: 'US-CA',
    jurisdiction_label: 'California',
    code: '8 CCR',
    name: 'Cal/OSHA Workplace Safety & Health',
    desk: 'ehs',
    agencies: ['Cal/OSHA', 'DIR'],
    summary: 'California State Plan workplace safety standards (Title 8 CCR) paralleling and extending 29 CFR 1910 & 1926.',
  },
  {
    title: 29,
    corpus_id: 'us-wa:state:WAC-296',
    jurisdiction: 'US-WA',
    jurisdiction_label: 'Washington',
    code: 'WAC 296',
    name: 'WA DOSH Safety & Health Rules',
    desk: 'ehs',
    agencies: ['L&I', 'DOSH'],
    summary: 'Washington Division of Occupational Safety and Health core rules and state-plan compliance overlays.',
  },
  {
    title: 40,
    corpus_id: 'us-state:state:EPA-SIP',
    jurisdiction: 'US-STATE',
    jurisdiction_label: 'State Plans',
    code: 'State EPA',
    name: 'Delegated Environmental & SIP Programs',
    desk: 'env',
    agencies: ['State DEQ', 'Air Districts'],
    summary: 'State Implementation Plans, NPDES delegated permits, and RCRA authorized hazardous waste regulations.',
  },
  {
    title: 49,
    corpus_id: 'us-state:state:DOT-CMV',
    jurisdiction: 'US-STATE',
    jurisdiction_label: 'State Plans',
    code: 'State DOT',
    name: 'State Commercial Motor & HazMat Adoptions',
    desk: 'transport',
    agencies: ['State DOT', 'HP'],
    summary: 'State intrastate hazmat routing, commercial motor carrier adoptions, and permit overlays.',
  },
];

/**
 * Full multi-framework catalog spanning CFR, Federal Register (FR), U.S. Code (U.S.C.),
 * and State Codes/Plans. Combines installed CFR titles, live FR status, any injected/installed
 * extra corpora, and authority-linked U.S.C. & State frameworks for installed titles.
 */
export function allSystemFrameworks(
  titles: InstalledTitleMeta[] = state.installedTitles,
  snapshotRows: TitleSnapshotRow[] | undefined = state.homeSnapshot?.titles,
  newsStatus: NewsStatusSnapshot | null | undefined = state.navNewsStatus,
  extras: CorpusSummary[] = state.extraCorpora,
): CorpusSummary[] {
  const base = normalizeCorporaList(titles, snapshotRows, extras);
  const byId = new Map<string, CorpusSummary>(base.map(c => [c.corpus_id, c]));
  const installedSet = new Set((titles || []).map(t => t.title));

  // 1. Federal Register (FR) — live rulemaking & daily filings framework
  if (![...byId.values()].some(c => c.tier === 'federal-register')) {
    const frSrc = newsStatus?.sources?.federal_register;
    const piSrc = newsStatus?.sources?.federal_register_pi;
    const hasErr = Boolean(frSrc?.retry_after || frSrc?.last_error || piSrc?.retry_after || piSrc?.last_error);
    const articles = Number(newsStatus?.articles || 0);
    const frTitleNums = [...installedSet].sort((a, b) => a - b);
    byId.set('us:fr:daily', {
      corpus_id: 'us:fr:daily',
      tier: 'federal-register',
      jurisdiction: 'US',
      jurisdiction_label: 'Federal',
      code: 'FR',
      name: 'Federal Register & Rulemaking',
      desk: 'ehs',
      agencies: ['OFR', 'OSHA', 'EPA', 'DOT'].slice(0, 3),
      edition: frSrc?.last_ok_at ? frSrc.last_ok_at.slice(0, 10) : null,
      section_count: articles,
      summary: 'Published Final Rules, Proposed Rules, Public Inspection filings, and DOL enforcement linked to installed CFR titles.',
      installed: true,
      linked_titles: frTitleNums,
      status_label: hasErr ? 'Sync issue' : articles > 0 ? `${articles} cached` : 'Ready to sync',
      update_available: hasErr,
    });
  }

  // 2. U.S. Code (U.S.C.) — enabling federal statutes for installed CFR titles
  const hasCustomUsc = [...byId.values()].some(c => c.tier === 'federal-statute');
  if (!hasCustomUsc) {
    const uscSourceTitles = installedSet.size ? [...installedSet].filter(n => KNOWN_TITLE_AUTHORITIES[n]) : [29];
    for (const tNum of uscSourceTitles) {
      const auth = KNOWN_TITLE_AUTHORITIES[tNum];
      if (!auth) continue;
      const shortCode = auth.statuteCode.split('§§')[0].trim();
      const id = `us:usc:${shortCode.replace(/\s+/g, '-').toLowerCase()}`;
      if (byId.has(id)) continue;
      byId.set(id, {
        corpus_id: id,
        tier: 'federal-statute',
        jurisdiction: 'US',
        jurisdiction_label: 'Federal',
        code: auth.statuteCode,
        name: auth.statuteLabel,
        desk: mapRawDeskToId('', tNum),
        agencies: ['U.S. Congress'],
        summary: `Enabling statutory authority underlying ${tNum} CFR rules, preemption scope, and agency rulemaking power.`,
        installed: false,
        linked_titles: [tNum],
        external_url: auth.statuteHref,
        status_label: `Linked · ${tNum} CFR`,
      });
    }
  }

  // 3. State Codes & Plans — delegated state frameworks mapped to installed titles
  const hasCustomState = [...byId.values()].some(c => c.tier === 'state');
  if (!hasCustomState) {
    const matching = DEFAULT_STATE_OVERLAYS.filter(s => !installedSet.size || installedSet.has(s.title));
    const list = matching.length ? matching : DEFAULT_STATE_OVERLAYS.slice(0, 2);
    for (const s of list) {
      if (byId.has(s.corpus_id)) continue;
      byId.set(s.corpus_id, {
        corpus_id: s.corpus_id,
        tier: 'state',
        jurisdiction: s.jurisdiction,
        jurisdiction_label: s.jurisdiction_label,
        code: s.code,
        name: s.name,
        desk: s.desk,
        agencies: s.agencies,
        summary: s.summary,
        installed: false,
        linked_titles: [s.title],
        status_label: `State overlay · ${s.title} CFR`,
      });
    }
  }

  return [...byId.values()];
}

export function findSystemFramework(tier: string, jurisdiction: string, code: string): CorpusSummary | null {
  const all = allSystemFrameworks();
  const t = tier.toLowerCase();
  const j = jurisdiction.toLowerCase();
  const cd = code.toLowerCase();
  return all.find(c =>
    c.tier.toLowerCase() === t
    && (c.jurisdiction || '').toLowerCase() === j
    && String(c.code || '').toLowerCase() === cd,
  ) || null;
}

export interface JurisdictionStackNode {
  tier: string;
  ref_tier: RefTier;
  code: string;
  label: string;
  href?: string;
  external?: boolean;
  current?: boolean;
  meta: string;
}

export function jurisdictionStackForTitle(titleNum?: number): { corpus_id: string; nodes: JurisdictionStackNode[] } {
  const t = Number(titleNum) || state.currentTitle;
  const known = KNOWN_TITLE_AUTHORITIES[t] || null;
  const stateMirrors = state.corpora.filter(c => c.tier === 'state' && c.installed !== false);
  const countyMirrors = state.corpora.filter(c => c.tier === 'county' && c.installed !== false);
  const nodes: JurisdictionStackNode[] = [];
  if (known) {
    nodes.push({
      tier: 'federal-statute',
      ref_tier: 'usc',
      code: known.statuteCode,
      label: known.statuteLabel,
      href: known.statuteHref,
      external: true,
      meta: 'Enabling statute',
    });
  }
  const cur = state.corpora.find(c => c.tier === 'federal-reg' && c.title_num === t);
  nodes.push({
    tier: 'federal-reg',
    ref_tier: 'cfr',
    code: `${t} CFR`,
    label: cur?.name || `Title ${t}`,
    current: true,
    meta: 'Active federal code',
  });
  nodes.push({
    tier: 'state',
    ref_tier: 'state',
    code: stateMirrors.length ? `${stateMirrors.length} State` : 'State Layer',
    label: stateMirrors.length
      ? stateMirrors.map(c => `${c.jurisdiction_label} ${c.code}`).join(' · ')
      : (known?.stateHint || 'State codes & delegated programs'),
    href: stateMirrors[0] ? corpusHashFor(stateMirrors[0]) : '#/library',
    meta: stateMirrors.length ? 'Installed' : 'Ready for state feeds',
  });
  nodes.push({
    tier: 'county',
    ref_tier: 'county',
    code: countyMirrors.length ? `${countyMirrors.length} County` : 'Local Layer',
    label: countyMirrors.length
      ? countyMirrors.map(c => `${c.jurisdiction_label} ${c.code}`).join(' · ')
      : (known?.countyHint || 'County & municipal ordinances'),
    href: countyMirrors[0] ? corpusHashFor(countyMirrors[0]) : '#/library',
    meta: countyMirrors.length ? 'Installed' : 'Pre-wired slot',
  });
  return { corpus_id: corpusIdForTitle(t), nodes };
}

export function deskFilterRibbonHtml(activeDesk = state.activeDesk, corpora = state.corpora): string {
  const counts = new Map<string, number>([['all', corpora.length]]);
  for (const c of corpora) {
    const d = c.desk || 'ehs';
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  const visibleDesks = DESK_DEFS.filter(d => d.id === 'all' || (counts.get(d.id) || 0) > 0);
  if (visibleDesks.length <= 2 && corpora.length < 2) return '';
  return `<div class="desk-ribbon" role="group" aria-label="Filter by regulatory desk">${visibleDesks.map(d => {
    const on = activeDesk === d.id;
    const count = counts.get(d.id) || 0;
    return `<button type="button" class="desk-pill${on ? ' is-active' : ''}" data-desk="${escapeHtml(d.id)}" aria-pressed="${on}">
      <span>${escapeHtml(d.label)}</span>${count ? `<span class="desk-pill-count">${count}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}
