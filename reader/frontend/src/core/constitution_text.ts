import type { ConstitutionOutlineItem } from '../state';

// Pure helpers for the U.S. Constitution (names, Bluebook citations, grouping, clause
// splitting). No DOM and no fetches, so the Node unit tests import them directly.

const ARTICLE_NAMES: Record<number, string> = {
  1: 'The Legislative Branch',
  2: 'The Executive Branch',
  3: 'The Judicial Branch',
  4: 'The States',
  5: 'Amending the Constitution',
  6: 'Debts, Supremacy and Oaths',
  7: 'Ratification',
};

const SECTION_NAMES: Record<string, string> = {
  'art1-s1': 'Legislative powers vested in Congress',
  'art1-s2': 'The House of Representatives',
  'art1-s3': 'The Senate',
  'art1-s4': 'Elections and meetings of Congress',
  'art1-s5': 'Rules and proceedings of each House',
  'art1-s6': 'Pay, privileges and limits on other offices',
  'art1-s7': 'How bills become law',
  'art1-s8': 'Powers of Congress',
  'art1-s9': 'Limits on Congress',
  'art1-s10': 'Limits on the States',
  'art2-s1': 'The President and Vice President',
  'art2-s2': 'Powers of the President',
  'art2-s3': 'Duties of the President',
  'art2-s4': 'Impeachment',
  'art3-s1': 'The federal courts',
  'art3-s2': 'Judicial power and jurisdiction',
  'art3-s3': 'Treason',
  'art4-s1': 'Full faith and credit',
  'art4-s2': 'Privileges and immunities; extradition',
  'art4-s3': 'New States and federal property',
  'art4-s4': 'A republican form of government',
};

const AMENDMENT_NAMES: Record<number, string> = {
  1: 'Freedom of religion, speech, press, assembly and petition',
  2: 'Right to keep and bear arms',
  3: 'Quartering of soldiers',
  4: 'Searches and seizures',
  5: 'Grand jury, double jeopardy, self-incrimination, due process, takings',
  6: 'Rights in criminal prosecutions',
  7: 'Jury trial in civil cases',
  8: 'Bail, fines and punishments',
  9: 'Rights kept by the people',
  10: 'Powers reserved to the States and the people',
  11: 'Suits against States',
  12: 'Electing the President and Vice President',
  13: 'Abolition of slavery',
  14: 'Citizenship, due process and equal protection',
  15: 'Voting rights regardless of race',
  16: 'Income tax',
  17: 'Direct election of Senators',
  18: 'Prohibition of alcohol',
  19: 'Women’s right to vote',
  20: 'Terms of office and succession',
  21: 'Repeal of Prohibition',
  22: 'Two-term limit for the President',
  23: 'Presidential electors for the District of Columbia',
  24: 'No poll tax in federal elections',
  25: 'Presidential disability and succession',
  26: 'Voting age of eighteen',
  27: 'Changes to Congress’s pay',
};

export function toRoman(n: number): string {
  let out = '';
  for (const [v, r] of [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as Array<[number, string]>) {
    while (n >= v) { out += r; n -= v; }
  }
  return out;
}

export const articleName = (n: number): string => ARTICLE_NAMES[n] || '';
export const amendmentName = (n: number): string => AMENDMENT_NAMES[n] || '';

/** A plain-English heading for a unit: "Powers of Congress", "Citizenship, due process…". */
export function constUnitName(u: Pick<ConstitutionOutlineItem, 'id' | 'kind' | 'article' | 'amendment'>): string {
  if (u.kind === 'preamble') return 'Purposes of the Constitution';
  if (SECTION_NAMES[u.id]) return SECTION_NAMES[u.id];
  if (u.amendment) return amendmentName(u.amendment);
  if (u.article) return articleName(u.article);
  return '';
}

/** Bluebook form: "U.S. Const. art. I, § 8", "U.S. Const. amend. XIV, § 1", "U.S. Const. pmbl.". */
export function constCitation(label: string): string {
  const l = (label || '').trim();
  if (/^preamble$/i.test(l)) return 'U.S. Const. pmbl.';
  const out = l.replace(/^Art\.\s*/i, 'art. ').replace(/^Amdt\.\s*/i, 'amend. ');
  return `U.S. Const. ${out}`;
}

export interface ConstGroup {
  key: string;
  label: string;
  name: string;
  units: ConstitutionOutlineItem[];
}

/** The outline grouped the way the document reads: Preamble, Articles I–VII, Amendments I–XXVII. */
export function constGroups(outline: ConstitutionOutlineItem[]): { preamble: ConstGroup | null; articles: ConstGroup[]; amendments: ConstGroup[] } {
  let preamble: ConstGroup | null = null;
  const articles = new Map<number, ConstGroup>();
  const amendments = new Map<number, ConstGroup>();
  for (const u of outline) {
    if (u.kind === 'preamble') {
      preamble = { key: 'preamble', label: 'Preamble', name: constUnitName(u), units: [u] };
    } else if (u.amendment) {
      const g = amendments.get(u.amendment) || { key: `amdt${u.amendment}`, label: `Amendment ${toRoman(u.amendment)}`, name: amendmentName(u.amendment), units: [] };
      g.units.push(u);
      amendments.set(u.amendment, g);
    } else if (u.article) {
      const g = articles.get(u.article) || { key: `art${u.article}`, label: `Article ${toRoman(u.article)}`, name: articleName(u.article), units: [] };
      g.units.push(u);
      articles.set(u.article, g);
    }
  }
  return { preamble, articles: [...articles.values()], amendments: [...amendments.values()] };
}

/** The short form shown inside a group: "§ 8" for a section, else the unit's own label. */
export const constShortLabel = (u: ConstitutionOutlineItem): string => (u.section ? `§ ${u.section}` : u.label);

/** Split "1 The House … Year. 2 No Person …" into numbered clauses; one block when it isn't numbered. */
export function splitClauses(text: string): Array<{ n: number | null; text: string }> {
  const t = (text || '').trim();
  const first = /^\[?1\]?\s+(?=\S)/.exec(t);
  if (!first) return [{ n: null, text: t }];
  const out: Array<{ n: number | null; text: string }> = [];
  let rest = t.slice(first[0].length);
  let n = 1;
  for (;;) {
    const next = new RegExp(`(?<=[.;:])\\s+\\[?${n + 1}\\]?\\s+(?=[A-Z“"])`).exec(rest);
    if (!next) { out.push({ n, text: rest.trim() }); break; }
    out.push({ n, text: rest.slice(0, next.index).trim() });
    rest = rest.slice(next.index + next[0].length);
    n += 1;
  }
  return out.length > 1 ? out : [{ n: null, text: out[0]?.text || t }];
}

