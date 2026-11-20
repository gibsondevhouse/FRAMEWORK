import test from 'node:test';
import assert from 'node:assert/strict';

import { NEWS_CITE_RE, paragraphPathFrom } from '../src/citations';
import {
  cleanInlineLabel,
  escapeHtml,
  findPartInTree,
  plural,
  safeHttpUrl,
  tocTitle,
} from '../src/dom';
import { amendedWeek, isStale, suiteState, titleStatus } from '../src/core/library_meta';
import {
  extLink,
  fmtMoney,
  frDocumentNumber,
  inspectionActivityNr,
  linkifyNewsText,
  newsKicker,
  newsPartHref,
  newsSectionHref,
  stateName,
} from '../src/core/news_format';
import { dockModel, fmtEta } from '../src/components/transfer_dock';
import { normalizeCfrTarget, targetHashFor } from '../src/components/cfr_resolver';
import { buildReaderHref, formatTabLabel, tabIdentityMatch } from '../src/components/reader_tabs';
import {
  allSystemFrameworks, authorityForCorpus, corpusHashFor,
  FOUNDATIONAL_ADMIN_STATUTES, parseCorpusPath, refTierForCorpus,
} from '../src/components/corpora';
import { isFrameworkRoute } from '../src/nav';
import { formatCfrCitation, parseCfrHref } from '../src/views/doc_utils';
import {
  articleNewsTitle,
  isDefaultNewsView,
  newsApiUrl,
  newsChanged,
  newsHash,
  newsViewFromParams,
} from '../src/views/news';
import { state } from '../src/state';

test('escapeHtml & cleanInlineLabel sanitize inline HTML safely', () => {
  assert.equal(escapeHtml('<script>"a" & \'b\'</script>'), '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(cleanInlineLabel('<span>Part 1910</span> — <em>General</em>  Industry'), 'Part 1910 — General Industry');
  assert.equal(plural(1, 'section'), '1 section');
  assert.equal(plural(3, 'section'), '3 sections');
});

test('safeHttpUrl permits http/https and rejects javascript/data URIs', () => {
  assert.equal(safeHttpUrl('https://www.ecfr.gov/current/title-29'), 'https://www.ecfr.gov/current/title-29');
  assert.equal(safeHttpUrl('http://localhost:8000/test'), 'http://localhost:8000/test');
  assert.equal(safeHttpUrl('/api/library'), '/api/library');
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('data:text/html,<script>1</script>'), '');
  assert.equal(safeHttpUrl(undefined), '');
});

test('tocTitle & findPartInTree navigate tree hierarchy cleanly', () => {
  assert.equal(tocTitle({ l: '§ 1910.120', d: '§ 1910.120 Hazardous waste operations.' }), 'Hazardous waste operations.');
  assert.equal(tocTitle({ l: '§ 261.5', d: '[Reserved]' }), '[Reserved]');
  const tree = {
    t: 'title',
    c: [
      { t: 'chapter', c: [{ t: 'part', id: '1910', d: 'General Industry', c: [] }] },
      { t: 'part', id: 1926, d: 'Construction', c: [] },
    ],
  };
  assert.equal(findPartInTree(tree, '1910')?.d, 'General Industry');
  assert.equal(findPartInTree(tree, 1926)?.d, 'Construction');
  assert.equal(findPartInTree(tree, '9999'), null);
});

test('parseCfrHref handles standard title routes, fallback routes, and corpus routes', () => {
  assert.deepEqual(parseCfrHref('#/title/40/section/261.3/b?p=(b)(1)'), {
    kind: 'section',
    title: 40,
    section: '261.3',
    unit: 'b',
    para: '(b)(1)',
  });
  assert.deepEqual(parseCfrHref('#/section/1910.1200', 29), {
    kind: 'section',
    title: 29,
    section: '1910.1200',
    unit: null,
    para: null,
  });
  assert.deepEqual(parseCfrHref('#/corpus/federal-reg/US/29/part/1926'), {
    kind: 'part',
    title: 29,
    part: '1926',
  });
  assert.equal(parseCfrHref('https://example.com'), null);
});

test('normalizeCfrTarget & targetHashFor normalize parts, sections, appendices, and URLs', () => {
  const secTarget = normalizeCfrTarget({ cfrTitle: '29', section: '1910.134(a)', para: '(a)' });
  assert.equal(secTarget.title, 29);
  assert.equal(secTarget.part, '1910');
  assert.equal(secTarget.kind, 'section');
  assert.equal(targetHashFor(secTarget), '#/title/29/section/1910.134(a)?p=(a)');

  const appTarget = normalizeCfrTarget({ title: 29, part: '1910', section: '1910.134-app-a', kind: 'appendix' });
  assert.equal(appTarget.kind, 'appendix');
  assert.match(appTarget.ecfrUrl, /title-29\/section-1910\.134-app-a/);

  assert.equal(formatCfrCitation(29, '1910.120', '(q)(1)'), '29 C.F.R. § 1910.120(q)(1)');
});

test('reader_tabs helpers build hrefs, labels, and match tab identities', () => {
  assert.equal(
    buildReaderHref({ kind: 'section', title: 29, sectionId: '1910.120', unit: 'q', para: '(q)(1)' }),
    '#/title/29/section/1910.120/q?p=(q)(1)',
  );
  assert.equal(
    buildReaderHref({ kind: 'part', title: 40, partId: '261', full: true }),
    '#/title/40/part/261/full',
  );
  assert.equal(formatTabLabel({ kind: 'part', title: 40, partId: '261', full: true }), '40 CFR Part 261 · Full');
  assert.equal(
    tabIdentityMatch({ kind: 'part', title: 40, partId: '261', full: false }, { kind: 'part', title: 40, partId: '261', full: true }),
    false,
  );
  assert.equal(
    tabIdentityMatch({ kind: 'section', title: 29, sectionId: '1910.120', unit: 'a' }, { kind: 'section', title: 29, sectionId: '1910.120', unit: 'b' }),
    true,
  );
});

test('library_meta computes staleness, amendedWeek, status pills, and suite states', () => {
  state.jobs = { current: null, queued: [], recent: [] };
  const freshRow = { title: 29, latest: '2026-09-15', amended: '2026-09-12', installed: { whole: true, edition: '2026-09-15' } };
  const staleRow = { title: 40, latest: '2026-09-15', amended: '2026-09-01', installed: { whole: true, edition: '2026-08-01' } };
  const reservedRow = { title: 35, reserved: true };

  assert.equal(isStale(freshRow), false);
  assert.equal(isStale(staleRow), true);
  assert.equal(titleStatus(freshRow).state, 'synced');
  assert.equal(titleStatus(staleRow).state, 'stale');
  assert.equal(titleStatus(reservedRow).text, 'Reserved');

  const catalog = { titles: [freshRow, staleRow, reservedRow] };
  assert.deepEqual(amendedWeek(catalog), { newest: '2026-09-15', cut: '2026-09-08', recent: 1 });

  const suite = { id: 'ehs', name: 'EHS Pack', summary: 'Core pack', titles: [29, 40] };
  const st = suiteState(suite, catalog);
  assert.equal(st.total, 2);
  assert.equal(st.needs.length, 1);
  assert.equal(st.label, 'Update 1 title');
});

test('transfer_dock dockModel and fmtEta compute progress phases and ETAs', () => {
  assert.equal(fmtEta(45), '45s left');
  assert.equal(fmtEta(125), '2m 5s left');
  const dm = dockModel({
    id: 1,
    title: 29,
    kind: 'title',
    label: 'Title 29',
    state: 'running',
    phase: 'Downloading text',
    done: 200_000,
    total: 400_000,
  });
  assert.equal(dm.step, 2);
  assert.equal(dm.pct, 50);
  assert.match(dm.left, /of/);
});

test('corpora helpers map paths, hashes, and federal-only frameworks (U.S.C., CFR, FR)', () => {
  assert.equal(corpusHashFor({ corpus_id: 'us:cfr:29', tier: 'federal-reg', title_num: 29, jurisdiction: 'US', code: '29' }), '#/title/29/');
  assert.equal(corpusHashFor({ corpus_id: 'us:fr:daily', tier: 'federal-register', jurisdiction: 'US', code: 'FR' }), '#/corpus/federal-register/US/FR/');
  assert.deepEqual(parseCorpusPath('/corpus/federal-statute/US/29%20U.S.C./section/651'), {
    tier: 'federal-statute',
    jurisdiction: 'US',
    code: '29 U.S.C.',
    subPath: '/section/651',
  });
  assert.equal(refTierForCorpus('federal-statute'), 'usc');
  assert.equal(refTierForCorpus('federal-register'), 'fr');
  const systems = allSystemFrameworks([{ title: 29, name: 'Labor' }], undefined, null, []);
  const tiers = new Set(systems.map(s => s.tier));
  assert.ok(tiers.has('federal-reg'));
  assert.ok(tiers.has('federal-register'));
  assert.ok(tiers.has('federal-statute'));
  assert.equal(tiers.has('state'), false);
  assert.equal(tiers.has('county'), false);

  const usc29 = systems.find(s => s.tier === 'federal-statute' && s.code.startsWith('29'));
  assert.ok(usc29);
  const auth29 = authorityForCorpus(usc29);
  assert.ok(auth29);
  assert.ok(auth29.acts.some(a => a.includes('Occupational Safety and Health Act')));
  assert.ok(auth29.provisions.some(p => p.cite === '29 U.S.C. § 655' && p.cfrPart === '1910'));
  assert.equal(FOUNDATIONAL_ADMIN_STATUTES.length, 4);
  assert.ok(FOUNDATIONAL_ADMIN_STATUTES.some(f => f.code.includes('5 U.S.C.')));
});

test('isFrameworkRoute opens the secondary drawer only on start, TOC, reader, and federal corpus pages', () => {
  state.noTitles = false;
  for (const p of ['/title/29/', '/title/29', '/title/29/part/1910', '/title/29/part/1910/full', '/title/29/section/1910.1200/b', '/part/1910', '/section/1910.135', '/corpus/federal-register/US/FR/', '/corpus/federal-statute/US/29%20U.S.C./']) {
    assert.equal(isFrameworkRoute(p), true, `expected framework route: ${p}`);
  }
  for (const p of ['/', '/projects', '/projects/abc', '/news', '/news/inspection/123', '/news/fr/2026-1', '/library', '/library/29', '/settings', '/help', '/search', '/corpus/state/US-CA/8%20CCR/']) {
    assert.equal(isFrameworkRoute(p), false, `expected main page route: ${p}`);
  }
});

test('news helpers parse queries, build URLs/hashes, detect changes, and format citations', () => {
  state.installedTitles = [{ title: 29, name: 'Labor' }];
  const view = newsViewFromParams(new URLSearchParams('cat=enforcement&state=ca&min_penalty=50000&gravity=W&q=silica'));
  assert.deepEqual(view, {
    cat: 'enforcement',
    q: 'silica',
    cfr_title: '',
    section: '',
    part: '',
    state: 'CA',
    min_penalty: '50000',
    gravity: 'W',
    naics: '',
    gdc: '',
    fatality: '',
    jurisdiction: '',
    emphasis: '',
    dol_q: '',
    dol_mode: '',
  });
  assert.equal(isDefaultNewsView(view), false);
  assert.equal(newsHash(view), '#/news?cat=enforcement&q=silica&state=CA&min_penalty=50000&gravity=W');
  assert.equal(newsApiUrl(view, 25), '/api/news?category=enforcement&q=silica&state=CA&min_penalty=50000&gravity=W&offset=25');

  const d1 = { articles: [{ guid: 'a', category: 'rules', title: 'R', link: 'https://x', published_at: '2026-09-10' }], total: 1 };
  const d2 = { articles: [{ guid: 'b', category: 'rules', title: 'R', link: 'https://x', published_at: '2026-09-10' }], total: 1 };
  assert.equal(newsChanged(d1, d1, null, null), false);
  assert.equal(newsChanged(d1, d2, null, null), true);

  assert.equal(stateName('tx'), 'Texas');
  assert.equal(fmtMoney(125000), '$125,000');
  assert.equal(inspectionActivityNr({ category: 'enforcement', guid: 'dol-insp:307000001' }), '307000001');
  assert.equal(frDocumentNumber({ category: 'rules', guid: 'fr:2026-17726' }), '2026-17726');
  assert.equal(frDocumentNumber({ category: 'public_inspection', guid: 'fr:2026-22222' }), null);
  assert.equal(newsViewFromParams(new URLSearchParams('cfr_title=40')).cfr_title, '40');
  assert.equal(newsKicker({ category: 'rules', citation: '91 FR 1234' }), 'FINAL RULE · 91 FR 1234');
  assert.equal(newsSectionHref(29, '1910.1200'), '#/title/29/section/1910.1200');
  assert.equal(newsPartHref(40, '261'), '#/library/40');
  assert.match(extLink('javascript:evil()', '<b>X</b>'), /^<b>X<\/b>$/);
  assert.match(linkifyNewsText('Violation of § 1910.134(a)(1)'), /href="#\/title\/29\/section\/1910\.134"/);
  assert.equal(articleNewsTitle({ category: 'rules', title: 'T', link: 'L', published_at: '2026-09-01', cfr_parts: [{ title: 40, part: 261 }] }), 40);
  NEWS_CITE_RE.lastIndex = 0;
  assert.ok(NEWS_CITE_RE.test('29 CFR 1910.1200'));
});

test('paragraphPathFrom walks folded markers without repeating siblings', () => {
  const paras = [
    { lvl: 0, marks: '' },
    { lvl: 1, marks: '(a)(1)' },
    { lvl: 2, marks: '(2)' },
    { lvl: 3, marks: '(i)' },
    { lvl: 1, marks: '(5)(A)' },
    { lvl: 2, marks: '(B)' },
    { lvl: 1, marks: '(b)' },
    { lvl: 2, marks: '(2)(A)' },
    { lvl: 3, marks: '(B)' },
    { lvl: 2, marks: '' },
  ];
  assert.equal(paragraphPathFrom(paras, 0), '');
  assert.equal(paragraphPathFrom(paras, 1), '(a)(1)');
  assert.equal(paragraphPathFrom(paras, 2), '(a)(2)');
  assert.equal(paragraphPathFrom(paras, 3), '(a)(2)(i)');
  assert.equal(paragraphPathFrom(paras, 4), '(5)(A)');
  assert.equal(paragraphPathFrom(paras, 5), '(5)(B)');
  assert.equal(paragraphPathFrom(paras, 7), '(b)(2)(A)');
  assert.equal(paragraphPathFrom(paras, 8), '(b)(2)(B)');
  assert.equal(paragraphPathFrom(paras, 9), '');
});

import { constCitation, constGroups, splitClauses, toRoman } from '../src/core/constitution_text';

test('constCitation writes the Bluebook form of a Constitution unit', () => {
  assert.equal(constCitation('Art. I, § 8'), 'U.S. Const. art. I, § 8');
  assert.equal(constCitation('Art. V'), 'U.S. Const. art. V');
  assert.equal(constCitation('Amdt. XIV, § 1'), 'U.S. Const. amend. XIV, § 1');
  assert.equal(constCitation('Amdt. I'), 'U.S. Const. amend. I');
  assert.equal(constCitation('Preamble'), 'U.S. Const. pmbl.');
  assert.equal(toRoman(27), 'XXVII');
});

test('splitClauses splits numbered clauses and leaves plain text whole', () => {
  const two = splitClauses('1 The House shall be chosen every second Year. 2 No Person shall be a Representative under 25.');
  assert.deepEqual(two.map(c => c.n), [1, 2]);
  assert.equal(two[1].text, 'No Person shall be a Representative under 25.');
  assert.deepEqual(splitClauses('Congress shall make no law respecting religion.'), [{ n: null, text: 'Congress shall make no law respecting religion.' }]);
  // A "1" that never reaches a "2" is not a numbered list.
  assert.equal(splitClauses('1 Year after the ratification of this article.')[0].n, null);
  // A number inside a sentence (no closing punctuation before it) does not split.
  assert.equal(splitClauses('1 Each State shall have 2 Senators. 2 The Senate shall choose.').length, 2);
});

test('constGroups orders the Preamble, articles and amendments', () => {
  const u = (id: string, kind: 'preamble' | 'section' | 'article' | 'amendment', article: number | null, amendment: number | null, section: number | null, label: string) =>
    ({ id, kind, article, amendment, section, label, chars: 1, note_count: 0 });
  const g = constGroups([
    u('preamble', 'preamble', null, null, null, 'Preamble'),
    u('art1-s1', 'section', 1, null, 1, 'Art. I, § 1'),
    u('art1-s2', 'section', 1, null, 2, 'Art. I, § 2'),
    u('art5', 'article', 5, null, null, 'Art. V'),
    u('amdt14-s1', 'amendment', null, 14, 1, 'Amdt. XIV, § 1'),
  ]);
  assert.equal(g.preamble?.label, 'Preamble');
  assert.deepEqual(g.articles.map(a => [a.label, a.units.length]), [['Article I', 2], ['Article V', 1]]);
  assert.equal(g.amendments[0].name, 'Citizenship, due process and equal protection');
});
