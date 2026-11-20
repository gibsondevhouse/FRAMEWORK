import {
  AuthorityTier, CorpusSummary, DeskId, InstalledTitleMeta, NewsStatusSnapshot,
  RefTier, state, TitleSnapshotRow,
} from '../state';
import { escapeHtml, lsGet, lsSet } from '../dom';
import { uscCite } from '../core/usc_label';

const ACTIVE_DESK_KEY = 'framework_desk_v1';

export const TIER_ORDER = [
  'federal-constitution',
  'federal-statute',
  'federal-reg',
  'federal-register',
  'standard',
] as const;

export const SYSTEM_TIERS: AuthorityTier[] = [
  'federal-statute',
  'federal-reg',
  'federal-register',
];

export interface TierMeta {
  label: string;
  short: string;
  refTier: RefTier;
  tag: string;
  subtitle: string;
}

export const TIER_META: Record<string, TierMeta> = {
  'federal-constitution': {
    label: 'U.S. Constitution',
    short: 'Const.',
    refTier: 'const',
    tag: 'CONSTITUTION',
    subtitle: 'The supreme law',
  },
  'federal-statute': {
    label: 'U.S. Code (U.S.C.)',
    short: 'U.S.C.',
    refTier: 'usc',
    tag: 'U.S.C.',
    subtitle: 'Federal statutory law',
  },
  'federal-reg': {
    label: 'Code of Federal Regulations (CFR)',
    short: 'CFR',
    refTier: 'cfr',
    tag: 'FEDERAL REG',
    subtitle: 'Codified federal rules',
  },
  'federal-register': {
    label: 'Federal Register (FR)',
    short: 'FR',
    refTier: 'fr',
    tag: 'FED REGISTER',
    subtitle: 'Daily rulemaking & notices',
  },
  'standard': {
    label: 'Incorporated Standards (IBR)',
    short: 'IBR',
    refTier: 'ibr',
    tag: 'STANDARD',
    subtitle: 'Standards incorporated by reference',
  },
};

export const DESK_DEFS: Array<{ id: DeskId; label: string }> = [
  { id: 'all', label: 'All Topics' },
  { id: 'ehs', label: 'Labor & Workplace' },
  { id: 'env', label: 'Environmental' },
  { id: 'transport', label: 'Transportation' },
  { id: 'labor-employment', label: 'Health & Benefits' },
  { id: 'fire-building', label: 'Housing & Construction' },
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

export interface StatutoryProvision {
  cite: string;
  title: string;
  cfrTitle: number;
  cfrPart?: string;
  cfrSection?: string;
}

export interface KnownTitleAuthority {
  statuteCode: string;
  statuteLabel: string;
  statuteHref: string;
  frNote: string;
  summary: string;
  acts: string[];
  provisions: StatutoryProvision[];
}

export interface FoundationalStatute {
  code: string;
  name: string;
  act: string;
  summary: string;
  href: string;
  scope: string;
}

export const FOUNDATIONAL_ADMIN_STATUTES: FoundationalStatute[] = [
  {
    code: '5 U.S.C. §§ 551–559',
    name: 'Notice-and-Comment Rulemaking',
    act: 'Administrative Procedure Act (APA)',
    summary: 'Governs informal agency rulemaking (§ 553), public notice in the Federal Register, comment dockets, effective-date delays, and formal adjudications (§ 554).',
    href: 'https://uscode.house.gov/browse/prelim@title5/part1/chapter5/subchapter2&edition=prelim',
    scope: 'All CFR & FR Rules',
  },
  {
    code: '5 U.S.C. §§ 701–706',
    name: 'Judicial Review of Agency Action',
    act: 'APA Chapter 7',
    summary: 'Establishes the right of review, final agency action standards, and scope of judicial review over statutory authority and arbitrary-or-capricious rulemaking.',
    href: 'https://uscode.house.gov/browse/prelim@title5/part1/chapter7&edition=prelim',
    scope: 'Statutory Interpretation',
  },
  {
    code: '5 U.S.C. §§ 601–612',
    name: 'Small Entity Impact Analysis',
    act: 'Regulatory Flexibility Act (RFA)',
    summary: 'Requires agencies to publish initial and final regulatory flexibility analyses assessing compliance burdens on small businesses and organizations.',
    href: 'https://uscode.house.gov/browse/prelim@title5/part1/chapter6&edition=prelim',
    scope: 'Proposed & Final Rules',
  },
  {
    code: '44 U.S.C. §§ 3501–3521',
    name: 'Information Collection & OMB Control',
    act: 'Paperwork Reduction Act (PRA)',
    summary: 'Mandates OIRA review and OMB control numbers for reporting, recordkeeping, and disclosure requirements codified across CFR parts.',
    href: 'https://uscode.house.gov/browse/prelim@title44/chapter35/subchapter1&edition=prelim',
    scope: 'Recordkeeping & Forms',
  },
];

export const KNOWN_TITLE_AUTHORITIES: Record<number, KnownTitleAuthority> = {
  21: {
    statuteCode: '21 U.S.C. §§ 301–399i',
    statuteLabel: 'Federal Food, Drug, and Cosmetic Act',
    statuteHref: 'https://uscode.house.gov/browse/prelim@title21/chapter9&edition=prelim',
    frNote: 'FDA & DEA rulemaking and notices',
    summary: 'Statutory mandate governing food safety, pharmaceutical approval, medical devices, biologics, good manufacturing practices, and controlled substances.',
    acts: [
      'Federal Food, Drug, and Cosmetic Act (21 U.S.C. §§ 301–399i)',
      'Public Health Service Act § 351 (42 U.S.C. § 262)',
      'Controlled Substances Act (21 U.S.C. §§ 801–971)',
    ],
    provisions: [
      { cite: '21 U.S.C. § 342', title: 'Adulterated food & current good manufacturing practice', cfrTitle: 21, cfrPart: '117' },
      { cite: '21 U.S.C. § 355', title: 'New drug applications (NDA) & clinical investigations', cfrTitle: 21, cfrPart: '312' },
      { cite: '21 U.S.C. § 360c', title: 'Classification & premarket oversight of medical devices', cfrTitle: 21, cfrPart: '820' },
      { cite: '21 U.S.C. § 821', title: 'Registration & control of manufacture and distribution', cfrTitle: 21, cfrPart: '1301' },
    ],
  },
  26: {
    statuteCode: '26 U.S.C.',
    statuteLabel: 'Internal Revenue Code',
    statuteHref: 'https://uscode.house.gov/browse/prelim@title26&edition=prelim',
    frNote: 'Treasury & IRS regulations and notices',
    summary: 'Comprehensive statutory tax code enacted by Congress governing federal income, payroll, estate, gift, and excise taxation and Treasury enforcement procedure.',
    acts: [
      'Internal Revenue Code of 1986 (26 U.S.C. §§ 1–9834)',
      'Employee Retirement Income Security Act Tax Provisions (26 U.S.C. §§ 401–436)',
    ],
    provisions: [
      { cite: '26 U.S.C. § 61', title: 'Gross income defined & general income tax computation', cfrTitle: 26, cfrPart: '1' },
      { cite: '26 U.S.C. § 401', title: 'Qualified pension, profit-sharing, and stock bonus plans', cfrTitle: 26, cfrPart: '1' },
      { cite: '26 U.S.C. § 3101', title: 'Federal Insurance Contributions Act (FICA) employment taxes', cfrTitle: 26, cfrPart: '31' },
      { cite: '26 U.S.C. § 7805', title: 'Authorization for Treasury rules and regulations', cfrTitle: 26, cfrPart: '301' },
    ],
  },
  29: {
    statuteCode: '29 U.S.C. §§ 201–678',
    statuteLabel: 'Fair Labor Standards, NLRA & OSH Acts',
    statuteHref: 'https://uscode.house.gov/browse/prelim@title29&edition=prelim',
    frNote: 'Department of Labor & NLRB rulemaking',
    summary: 'Federal statutory framework governing occupational safety and health standards, minimum wage and overtime exemptions, family leave, and employee benefit plans.',
    acts: [
      'Occupational Safety and Health Act (29 U.S.C. §§ 651–678)',
      'Fair Labor Standards Act (29 U.S.C. §§ 201–219)',
      'Employee Retirement Income Security Act (29 U.S.C. §§ 1001–1461)',
      'Family and Medical Leave Act (29 U.S.C. §§ 2601–2654)',
    ],
    provisions: [
      { cite: '29 U.S.C. § 654', title: 'General Duty Clause & employer workplace safety duties', cfrTitle: 29, cfrPart: '1910', cfrSection: '1910.120' },
      { cite: '29 U.S.C. § 655', title: 'Promulgation of occupational safety & hazard standards', cfrTitle: 29, cfrPart: '1910', cfrSection: '1910.1200' },
      { cite: '29 U.S.C. § 657', title: 'Inspections, investigations & injury recordkeeping', cfrTitle: 29, cfrPart: '1904' },
      { cite: '29 U.S.C. § 213', title: 'FLSA executive, administrative & professional exemptions', cfrTitle: 29, cfrPart: '541' },
    ],
  },
  40: {
    statuteCode: '42 U.S.C. §§ 6901, 7401',
    statuteLabel: 'RCRA, Clean Air & Clean Water Acts',
    statuteHref: 'https://uscode.house.gov/browse/prelim@title42&edition=prelim',
    frNote: 'EPA final rules, proposals & notices',
    summary: 'Principal federal environmental statutes authorizing national ambient air standards, hazardous waste management, discharge permits, and emergency release reporting.',
    acts: [
      'Resource Conservation and Recovery Act (42 U.S.C. §§ 6901–6992k)',
      'Clean Air Act (42 U.S.C. §§ 7401–7671q)',
      'Clean Water Act (33 U.S.C. §§ 1251–1388)',
      'CERCLA / Superfund (42 U.S.C. §§ 9601–9675)',
    ],
    provisions: [
      { cite: '42 U.S.C. § 6921', title: 'Identification and listing of hazardous waste (RCRA Subtitle C)', cfrTitle: 40, cfrPart: '261', cfrSection: '261.3' },
      { cite: '42 U.S.C. § 7409', title: 'National primary & secondary ambient air quality standards', cfrTitle: 40, cfrPart: '50' },
      { cite: '33 U.S.C. § 1342', title: 'National Pollutant Discharge Elimination System (NPDES)', cfrTitle: 40, cfrPart: '122' },
      { cite: '42 U.S.C. § 9602', title: 'Hazardous substance designations & reportable quantities', cfrTitle: 40, cfrPart: '302' },
    ],
  },
  48: {
    statuteCode: '41 U.S.C. §§ 101–8707',
    statuteLabel: 'Public Contracts & Federal Procurement',
    statuteHref: 'https://uscode.house.gov/browse/prelim@title41&edition=prelim',
    frNote: 'FAR Council & agency acquisition rules',
    summary: 'Statutory procurement authority governing federal competition requirements, contract award and administration, socioeconomic clauses, and procurement integrity.',
    acts: [
      'Public Contracts Act / Title 41 Codification (41 U.S.C. §§ 101–8707)',
      'Competition in Contracting Act (41 U.S.C. §§ 3301–3312)',
      'Contract Disputes Act (41 U.S.C. §§ 7101–7109)',
    ],
    provisions: [
      { cite: '41 U.S.C. § 1303', title: 'Federal Acquisition Regulatory Council & single government-wide regulation', cfrTitle: 48, cfrPart: '1' },
      { cite: '41 U.S.C. § 3301', title: 'Full and open competition in federal solicitation and award', cfrTitle: 48, cfrPart: '6' },
      { cite: '41 U.S.C. § 3502', title: 'Truthful cost or pricing data & audit disclosures', cfrTitle: 48, cfrPart: '15' },
      { cite: '41 U.S.C. § 7103', title: 'Contracting officer decision & claims resolution procedure', cfrTitle: 48, cfrPart: '33' },
    ],
  },
  49: {
    statuteCode: '49 U.S.C. §§ 5101–5128',
    statuteLabel: 'Transportation & HazMat Statutes',
    statuteHref: 'https://uscode.house.gov/browse/prelim@title49&edition=prelim',
    frNote: 'DOT, FAA, FMCSA & PHMSA rulemaking',
    summary: 'Congressional mandates for hazardous materials transportation, commercial motor carrier safety, driver qualification and CDL standards, and motor vehicle safety.',
    acts: [
      'Federal Hazardous Materials Transportation Law (49 U.S.C. §§ 5101–5128)',
      'Motor Carrier Safety Act (49 U.S.C. §§ 31131–31151)',
      'Commercial Motor Vehicle Safety Act (49 U.S.C. §§ 31301–31317)',
      'National Traffic and Motor Vehicle Safety Act (49 U.S.C. §§ 30101–30183)',
    ],
    provisions: [
      { cite: '49 U.S.C. § 5103', title: 'Designation of hazardous materials & transport regulations', cfrTitle: 49, cfrPart: '172', cfrSection: '172.101' },
      { cite: '49 U.S.C. § 5104', title: 'Representation, marking, labeling & packaging of hazmat', cfrTitle: 49, cfrPart: '173' },
      { cite: '49 U.S.C. § 31136', title: 'Minimum safety standards for commercial motor vehicles', cfrTitle: 49, cfrPart: '390' },
      { cite: '49 U.S.C. § 31308', title: 'Commercial driver’s license (CDL) testing & standards', cfrTitle: 49, cfrPart: '383' },
    ],
  },
};

export function authorityForCorpus(corpus: CorpusSummary | null | undefined): KnownTitleAuthority | null {
  if (!corpus || corpus.tier !== 'federal-statute') return null;
  for (const tNum of corpus.linked_titles || []) {
    if (KNOWN_TITLE_AUTHORITIES[tNum]) return KNOWN_TITLE_AUTHORITIES[tNum];
  }
  const code = String(corpus.code || '').toLowerCase();
  for (const auth of Object.values(KNOWN_TITLE_AUTHORITIES)) {
    if (auth.statuteCode.toLowerCase() === code || auth.statuteCode.toLowerCase().startsWith(code.split('§§')[0].trim())) {
      return auth;
    }
  }
  return null;
}

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

export function corpusHashFor(corpus: Pick<CorpusSummary, 'tier' | 'title_num' | 'jurisdiction' | 'code' | 'corpus_id' | 'installed'>, subPath = '/'): string {
  const cleanSub = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (corpus.tier === 'federal-reg' && corpus.title_num) {
    return `#/title/${corpus.title_num}${cleanSub}`;
  }
  if (corpus.tier === 'federal-statute' && corpus.installed && corpus.title_num) {
    return `#/usc/${corpus.title_num}${cleanSub}`;
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
    if (raw.tier === 'state' || raw.tier === 'county') continue;
    byId.set(raw.corpus_id, {
      ...raw,
      tier: raw.tier || 'federal-statute',
      jurisdiction: raw.jurisdiction || 'US',
      jurisdiction_label: raw.jurisdiction_label || 'Federal',
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

/**
 * Full federal framework catalog spanning U.S. Code (U.S.C.), Code of Federal Regulations (CFR),
 * and Federal Register (FR). Combines installed CFR titles, live FR status, any injected
 * federal corpora, and statutory U.S.C. frameworks. State and local codes are out of scope.
 */
export function allSystemFrameworks(
  titles: InstalledTitleMeta[] = state.installedTitles,
  snapshotRows: TitleSnapshotRow[] | undefined = state.homeSnapshot?.titles,
  newsStatus: NewsStatusSnapshot | null | undefined = state.navNewsStatus,
  extras: CorpusSummary[] = state.extraCorpora,
): CorpusSummary[] {
  const base = normalizeCorporaList(titles, snapshotRows, extras)
    .filter(c => c.tier !== 'state' && c.tier !== 'county');
  const byId = new Map<string, CorpusSummary>(base.map(c => [c.corpus_id, c]));
  const installedSet = new Set((titles || []).map(t => t.title));

  // 1. Federal Register (FR) — daily federal rulemaking, proposals & notices
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
      name: 'Federal Register',
      desk: 'all',
      agencies: ['OFR', 'Federal Agencies'],
      edition: frSrc?.last_ok_at ? frSrc.last_ok_at.slice(0, 10) : null,
      section_count: articles,
      summary: 'Daily Final Rules, Proposed Rules, Notices, and Public Inspection filings across federal agencies and CFR titles.',
      installed: true,
      linked_titles: frTitleNums,
      status_label: hasErr ? 'Sync issue' : articles > 0 ? `${articles} cached` : 'Ready to sync',
      update_available: hasErr,
    });
  }

  // 2. U.S. Code (U.S.C.) — installed titles first, then federal statutory references linked to installed CFR titles
  for (const u of state.installedUscTitles || []) {
    const id = `us:usc:${u.title}-u.s.c.`;
    if (byId.has(id)) continue;
    byId.set(id, {
      corpus_id: id,
      tier: 'federal-statute',
      jurisdiction: 'US',
      jurisdiction_label: 'Federal',
      code: uscCite(u.title),
      title_num: u.title,
      name: u.title_name || `Title ${u.title}`,
      desk: mapRawDeskToId('', u.title),
      agencies: ['U.S. Congress'],
      edition: u.release_point || null,
      section_count: u.section_count || 0,
      summary: `${u.section_count || 0} sections${u.positive_law ? ' · Positive law' : ''}`,
      installed: true,
      linked_titles: [],
      status_label: 'Installed',
    });
  }
  const hasCustomUsc = [...byId.values()].some(c => c.tier === 'federal-statute' && !c.installed);
  if (!hasCustomUsc) {
    const matchedTitles = [...installedSet].filter(n => KNOWN_TITLE_AUTHORITIES[n]);
    const uscSourceTitles = matchedTitles.length ? matchedTitles : [29, 40, 49];
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
        summary: auth.summary || `Federal statutory authority underlying ${tNum} CFR rulemaking and federal agency mandate.`,
        installed: false,
        linked_titles: installedSet.has(tNum) ? [tNum] : [],
        external_url: auth.statuteHref,
        status_label: installedSet.has(tNum) ? `Linked · ${tNum} CFR` : 'Statutory reference',
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
  const nodes: JurisdictionStackNode[] = [];
  if (known) {
    nodes.push({
      tier: 'federal-statute',
      ref_tier: 'usc',
      code: known.statuteCode,
      label: known.statuteLabel,
      href: corpusHashFor({
        corpus_id: `us:usc:${known.statuteCode.split('§§')[0].trim().replace(/\s+/g, '-').toLowerCase()}`,
        tier: 'federal-statute',
        jurisdiction: 'US',
        code: known.statuteCode,
      }),
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
    meta: 'Codified regulation',
  });
  nodes.push({
    tier: 'federal-register',
    ref_tier: 'fr',
    code: 'Federal Register',
    label: known?.frNote || `Daily rulemaking & amendments for ${t} CFR`,
    href: '#/news',
    meta: 'Daily rulemaking',
  });
  return { corpus_id: corpusIdForTitle(t), nodes };
}

export function deskFilterRibbonHtml(activeDesk = state.activeDesk, corpora = state.corpora): string {
  const counts = new Map<string, number>([['all', corpora.length]]);
  for (const c of corpora) {
    const d = c.desk || 'ehs';
    if (d !== 'all') counts.set(d, (counts.get(d) || 0) + 1);
  }
  const visibleDesks = DESK_DEFS.filter(d => d.id === 'all' || (counts.get(d.id) || 0) > 0);
  if (visibleDesks.length <= 2 && corpora.length < 2) return '';
  return `<div class="desk-ribbon" role="group" aria-label="Filter by federal topic">${visibleDesks.map(d => {
    const on = activeDesk === d.id;
    const count = counts.get(d.id) || 0;
    return `<button type="button" class="desk-pill${on ? ' is-active' : ''}" data-desk="${escapeHtml(d.id)}" aria-pressed="${on}">
      <span>${escapeHtml(d.label)}</span>${count ? `<span class="desk-pill-count">${count}</span>` : ''}
    </button>`;
  }).join('')}</div>`;
}
