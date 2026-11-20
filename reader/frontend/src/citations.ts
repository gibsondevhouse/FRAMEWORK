// The Title 29 citation pattern the newsroom linkifies. Kept in exact parity
// with app/news.py's extract_citations by test_news_frontend.py.
export const NEWS_CITE_RE: RegExp = /\b29\s*C\.?F\.?R\.?\s*(?:§§?\s*)?(\d{1,4}\.\d+)(?:\([a-z0-9]{1,4}\))*|§§?\s*(19\d{2}\.\d+)(?:\([a-z0-9]{1,4}\))*/gi;

const PARA_TOKEN_RE = /\([a-zA-Z0-9]{1,4}\)/g;

/**
 * The paragraph path ("(a)(2)(i)") of paragraph `idx` in a reader body, from each paragraph's
 * nesting level (`lvl-N`, 0 = none) and marker text (`.pmark`). A folded marker such as
 * "(a)(1)" (CFR) or "(5)(A)" (U.S.C.) sits at its first token's level, so a later child
 * keeps only the tokens above its own level: "(2)" after "(a)(1)" is "(a)(2)".
 */
export function paragraphPathFrom(paras: ReadonlyArray<{ lvl: number; marks: string }>, idx: number): string {
  const tokens = (m: string): string[] => m.match(PARA_TOKEN_RE) || [];
  const own = paras[idx] ? tokens(paras[idx].marks) : [];
  if (!own.length) return '';
  let target = paras[idx].lvl;
  const chain = [...own];
  for (let i = idx - 1; i >= 0 && target > 1; i--) {
    const p = paras[i];
    if (p.lvl <= 0 || p.lvl >= target) continue;
    const t = tokens(p.marks);
    if (!t.length) continue;
    chain.unshift(...t.slice(0, Math.min(t.length, target - p.lvl)));
    target = p.lvl;
  }
  return chain.join('');
}
