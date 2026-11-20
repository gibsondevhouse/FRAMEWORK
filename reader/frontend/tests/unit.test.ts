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
  accidentInjuryLine,
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
import { openItemFromHash } from '../src/core/chat_context';

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

import { congressYears, lawCitation, lawShort, ordinal } from '../src/core/plaw';
import { isUscAppendix, uscCite, uscTitleLabel } from '../src/core/usc_label';

test('Public Law names, citations and Congress years', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 113, 118, 122].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '113th', '118th', '122nd']);
  assert.equal(congressYears(118), '2023–2024');
  assert.equal(congressYears(113), '2013–2014');
  const law = { congress: 118, number: 5, law_type: 'public' as const, statute: '137 Stat. 50', approved_date: '2023-06-03' };
  assert.equal(lawShort(law), 'Pub. L. 118-5');
  assert.equal(lawCitation(law), 'Pub. L. No. 118-5, 137 Stat. 50 (2023)');
  assert.equal(lawCitation({ ...law, law_type: 'private', statute: null, approved_date: null }), 'Priv. L. No. 118-5');
});

test('U.S. Code appendix titles are keyed 100 + N', () => {
  assert.equal(isUscAppendix(105), true);
  assert.equal(isUscAppendix(42), false);
  assert.equal(uscTitleLabel(105), '5a');
  assert.equal(uscTitleLabel(29), '29');
  assert.equal(uscCite(128), '28 U.S.C. App.');
  assert.equal(uscCite(29), '29 U.S.C.');
});

import { agendaDate, editionLabel, parseAgendaCfr, parseAgendaUsc, stageKey, stageShort } from '../src/core/agenda';

test('Unified Agenda editions, dates and stages read plainly', () => {
  assert.equal(editionLabel('202510'), 'Fall 2025');
  assert.equal(editionLabel('202504'), 'Spring 2025');
  assert.equal(editionLabel('201200'), '2012');
  assert.equal(agendaDate('10/00/2025'), 'Oct 2025');
  assert.equal(agendaDate('03/15/2026'), 'Mar 15, 2026');
  assert.equal(agendaDate('To Be Determined'), 'To Be Determined');
  assert.equal(stageShort('Final Rule Stage'), 'Final rule');
  assert.equal(stageKey('Long-Term Actions'), 'long_term');
  assert.equal(stageShort('Something new'), 'Something new');
});

test('Unified Agenda CFR and legal-authority strings become reader links', () => {
  assert.deepEqual(parseAgendaCfr('29 CFR 1910'), { title: 29, part: '1910', section: null });
  assert.deepEqual(parseAgendaCfr('40 CFR 261.3'), { title: 40, part: '261', section: '261.3' });
  assert.equal(parseAgendaCfr('Not Yet Determined'), null);
  assert.deepEqual(parseAgendaUsc('29 U.S.C. 655'), { title: 29, section: '655' });
  assert.deepEqual(parseAgendaUsc('42 USC 7401 et seq'), { title: 42, section: '7401' });
  assert.equal(parseAgendaUsc('Pub. L. 117-58'), null);
});

import { frameworkGroups, parseFrameworkFilter } from '../src/core/search_frameworks';

test('cross-framework search blocks become one row shape, installed frameworks only', () => {
  const groups = frameworkGroups({
    query: 'silica', title: 'all', total: 3, results: [], ms: 1,
    usc: { installed: true, total: 40, results: [
      { id: '655', heading: 'Standards', status: null, usc_title: 29, snippet: 'a \x02silica\x03 rule' },
      { id: '101', heading: 'Rules', status: 'repealed', usc_title: 105, snippet: '' },
    ] },
    fr: { installed: true, total: 1, results: [
      { document_number: '2026-00001', type: 'Rule', title: 'Silica', abstract: 'An abstract.', publication_date: '2026-01-05', citation: '91 FR 100', snippet: '' },
    ] },
    constitution: { installed: false, total: 0, results: [] },
    plaw: { installed: true, total: 1, results: [
      { id: '114-2', congress: 114, law_type: 'public', number: 2, statute: '129 Stat. 5', title: 'Second law', approved_date: '2015-02-01', snippet: null },
    ] },
    agenda: { installed: true, total: 3, results: [
      { rin: '1218-AD39', edition: '202510', title: 'Heat', stage: 'Final Rule Stage', parent_acronym: 'DOL', snippet: '' },
    ] },
  });
  assert.deepEqual(groups.map(g => g.key), ['usc', 'plaw', 'fr', 'agenda']);
  const [usc, plaw, fr, agenda] = groups;
  assert.equal(usc.total, 40);
  assert.deepEqual([usc.rows[0].href, usc.rows[0].num], ['#/usc/29/section/655', '29 U.S.C. § 655']);
  assert.deepEqual([usc.rows[1].num, usc.rows[1].meta], ['5 U.S.C. App. § 101', 'repealed']);
  assert.deepEqual([plaw.rows[0].href, plaw.rows[0].num], ['#/law/114-2', 'Pub. L. 114-2']);
  assert.deepEqual([fr.rows[0].href, fr.rows[0].num, fr.rows[0].snippet], ['#/news/fr/2026-00001', '91 FR 100', 'An abstract.']);
  assert.equal(agenda.total, 3);                             // the API's distinct-rule count, unchanged
  assert.equal(agenda.rows[0].href, '#/news/agenda/1218-AD39?edition=202510');
  assert.equal(agenda.rows[0].meta, 'DOL · Final rule · Fall 2025');
  assert.equal(parseFrameworkFilter('usc'), 'usc');
  assert.equal(parseFrameworkFilter('state'), 'all');
  assert.equal(parseFrameworkFilter(null), 'all');
});

test('openItemFromHash names the non-CFR unit on screen for Claude (TL-09)', () => {
  assert.deepEqual(openItemFromHash('#/usc/42/section/2000e%E2%80%932'),
    { corpus: 'usc', key: '2000e\u20132', collection: '42', label: '42 U.S.C. \u00a7 2000e\u20132' });
  assert.equal(openItemFromHash('#/usc/42/section/655/b?p=(b)(1)')?.key, '655');
  assert.equal(openItemFromHash('#/usc/105/section/App-rule1')?.label.startsWith('5 U.S.C. App.'), true);
  assert.equal(openItemFromHash('#/usc/42/'), null);
  assert.equal(openItemFromHash('#/usc/42/node/ch21'), null);
  assert.deepEqual(openItemFromHash('#/constitution/amdt14-s1'),
    { corpus: 'constitution', key: 'amdt14-s1', label: 'U.S. Constitution \u00b7 amdt14-s1' });
  assert.equal(openItemFromHash('#/constitution/'), null);
  assert.equal(openItemFromHash('#/law/117-58/s1')?.key, '117-58');
  assert.equal(openItemFromHash('#/law/118-pvt-3')?.label, 'Private Law 118-3');
  assert.deepEqual(openItemFromHash('#/news/fr/2026-20001'), { corpus: 'fr', key: '2026-20001', label: 'FR Doc. 2026-20001' });
  assert.deepEqual(openItemFromHash('#/news/agenda/1218-ad39?edition=202510'),
    { corpus: 'agenda', key: '1218-AD39', label: 'RIN 1218-AD39', collection: '202510' });
  assert.equal(openItemFromHash('#/news/agenda/1218-AD39?edition=bad')?.collection, undefined);
  assert.equal(openItemFromHash('#/title/29/section/1910.134'), null);
  assert.equal(openItemFromHash('#/news'), null);
  assert.equal(openItemFromHash('#/law/%E0%A4%A'), null);
  assert.equal(openItemFromHash('#/law/' + 'x'.repeat(300)), null);
});

test('Accident injury lines name the degree and the fall, skipping blanks (FT-28)', () => {
  assert.equal(accidentInjuryLine({ degree: 'Fatality', degree_code: '1', fall_distance_ft: 20, fall_height_ft: 25, fatality_cause_code: '4' }),
    'Fatality · fell 20 ft from a height of 25 ft · DOL cause code 4');
  assert.equal(accidentInjuryLine({ degree: 'Hospitalized injury', fall_height_ft: 12 }), 'Hospitalized injury · fall from a height of 12 ft');
  assert.equal(accidentInjuryLine({ degree: null, degree_code: '9' }), 'Injury degree code 9');
  assert.equal(accidentInjuryLine({}), 'Injury');
});
