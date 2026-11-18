import { state } from '../state';
import { escapeHtml, lsGet, lsSet } from '../dom';

const ACTIVE_DESK_KEY = 'framework_desk_v1';

export const TIER_ORDER = ['federal-statute', 'federal-reg', 'state', 'county', 'standard'];

export const TIER_META = {
  'federal-statute': { label: 'Federal Statutes (U.S.C.)', short: 'U.S.C.', refTier: 'usc', tag: 'STATUTE' },
  'federal-reg': { label: 'Federal Regulations (CFR)', short: 'CFR', refTier: 'cfr', tag: 'FEDERAL REG' },
  'state': { label: 'State Codes', short: 'State', refTier: 'state', tag: 'STATE' },
  'county': { label: 'County & Municipal', short: 'County', refTier: 'county', tag: 'LOCAL CODE' },
  'standard': { label: 'Consensus Standards', short: 'Std', refTier: 'ibr', tag: 'STANDARD' },
};

export const DESK_DEFS = [
  { id: 'all', label: 'All Desks' },
  { id: 'ehs', label: 'Safety & Labor' },
  { id: 'env', label: 'Environmental' },
  { id: 'transport', label: 'Transport & HazMat' },
  { id: 'labor-employment', label: 'Wage & Benefits' },
  { id: 'fire-building', label: 'Fire & Building' },
  { id: 'commerce-govcon', label: 'Commerce & GovCon' },
];

const DESK_BY_CFR_TITLE = {
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

const KNOWN_TITLE_AUTHORITIES = {
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

const VALID_DESKS = new Set(DESK_DEFS.map(d => d.id));

export function loadActiveDesk() {
  const saved = lsGet(ACTIVE_DESK_KEY);
  const next = saved && VALID_DESKS.has(saved) ? saved : 'all';
  state.activeDesk = next;
  return next;
}

export function setActiveDesk(desk) {
  const next = VALID_DESKS.has(desk) ? desk : 'all';
  state.activeDesk = next;
  lsSet(ACTIVE_DESK_KEY, next);
  return next;
}

loadActiveDesk();

export function mapRawDeskToId(rawDesk, titleNum = null) {
  const txt = String(rawDesk || '').trim().toLowerCase();
  if (VALID_DESKS.has(txt)) return txt;
  if (titleNum && DESK_BY_CFR_TITLE[titleNum]) return DESK_BY_CFR_TITLE[titleNum];
  if (txt.includes('safety') || txt.includes('osha') || txt.includes('health') || txt.includes('workplace')) return 'ehs';
  if (txt.includes('environ') || txt.includes('epa')) return 'env';
  if (txt.includes('transport') || txt.includes('dot') || txt.includes('hazmat')) return 'transport';
  if (txt.includes('fire') || txt.includes('build')) return 'fire-building';
  if (txt.includes('labor') || txt.includes('wage') || txt.includes('employ')) return 'labor-employment';
  if (txt.includes('commer') || txt.includes('trade') || txt.includes('gov') || txt.includes('tax')) return 'commerce-govcon';
  return 'ehs';
}

export function deskLabel(deskId) {
  return DESK_DEFS.find(d => d.id === deskId)?.label || 'Regulatory';
}

export function tierMetaFor(tier) {
  return TIER_META[tier] || TIER_META['federal-reg'];
}

export function refTierForCorpus(corpusOrTier) {
  const tier = typeof corpusOrTier === 'string' ? corpusOrTier : corpusOrTier?.tier;
  return tierMetaFor(tier).refTier;
}

export function corpusIdForTitle(titleNum) {
  return `us:cfr:${Number(titleNum) || 29}`;
}

export function corpusHashFor(corpus, subPath = '/') {
  const cleanSub = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (corpus.tier === 'federal-reg' && corpus.title_num) {
    return `#/title/${corpus.title_num}${cleanSub}`;
  }
  const tierSeg = encodeURIComponent(corpus.tier);
  const jurSeg = encodeURIComponent(corpus.jurisdiction || 'US');
  const codeSeg = encodeURIComponent(corpus.code || corpus.corpus_id);
  return `#/corpus/${tierSeg}/${jurSeg}/${codeSeg}${cleanSub === '/' ? '/' : cleanSub}`;
}

export function parseCorpusPath(path) {
  const m = /^\/corpus\/([^/]+)\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path || '');
  if (!m) return null;
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  return {
    tier: decode(m[1]),
    jurisdiction: decode(m[2]),
    code: decode(m[3]),
    subPath: m[4] || '/',
  };
}

export function normalizeCorporaList(titles = state.installedTitles, snapshotRows = state.homeSnapshot?.titles, extras = state.extraCorpora) {
  const snapByTitle = new Map((snapshotRows || []).map(r => [r.title, r]));
  const cfr = (titles || []).map(t => {
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
  const byId = new Map(cfr.map(c => [c.corpus_id, c]));
  const injected = Array.isArray(extras) && extras.length ? extras : (window.__FRAMEWORK_MOCK_CORPORA__ || []);
  for (const raw of injected) {
    if (!raw || !raw.corpus_id) continue;
    byId.set(raw.corpus_id, {
      tier: 'state',
      jurisdiction: 'US',
      jurisdiction_label: 'Jurisdiction',
      code: raw.code || raw.corpus_id,
      name: raw.name || raw.corpus_id,
      desk: mapRawDeskToId(raw.desk),
      agencies: Array.isArray(raw.agencies) ? raw.agencies : [],
      installed: raw.installed !== false,
      ...raw,
    });
  }
  return [...byId.values()];
}

export function syncCorporaState() {
  state.corpora = normalizeCorporaList();
  state.activeCorpusId = corpusIdForTitle(state.currentTitle);
  return state.corpora;
}

export function jurisdictionStackForTitle(titleNum) {
  const t = Number(titleNum) || state.currentTitle;
  const known = KNOWN_TITLE_AUTHORITIES[t] || null;
  const stateMirrors = state.corpora.filter(c => c.tier === 'state' && c.installed !== false);
  const countyMirrors = state.corpora.filter(c => c.tier === 'county' && c.installed !== false);
  const nodes = [];
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

export function deskFilterRibbonHtml(activeDesk = state.activeDesk, corpora = state.corpora) {
  const counts = new Map([['all', corpora.length]]);
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
