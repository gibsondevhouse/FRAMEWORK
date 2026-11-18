import test from 'node:test';
import assert from 'node:assert/strict';

import { NEWS_CITE_RE } from '../src/citations';
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
import { corpusHashFor, parseCorpusPath, refTierForCorpus } from '../src/components/corpora';
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

test('corpora helpers map paths, hashes, and authority tiers', () => {
  assert.equal(corpusHashFor({ corpus_id: 'us:cfr:29', tier: 'federal-reg', title_num: 29, jurisdiction: 'US', code: '29' }), '#/title/29/');
  assert.equal(corpusHashFor({ corpus_id: 'us-ca:state:8 CCR', tier: 'state', jurisdiction: 'US-CA', code: '8 CCR' }), '#/corpus/state/US-CA/8%20CCR/');
  assert.deepEqual(parseCorpusPath('/corpus/state/US-CA/8%20CCR/section/3203'), {
    tier: 'state',
    jurisdiction: 'US-CA',
    code: '8 CCR',
    subPath: '/section/3203',
  });
  assert.equal(refTierForCorpus('federal-statute'), 'usc');
});

test('news helpers parse queries, build URLs/hashes, detect changes, and format citations', () => {
  state.installedTitles = [{ title: 29, name: 'Labor' }];
  const view = newsViewFromParams(new URLSearchParams('cat=enforcement&state=ca&min_penalty=50000&gravity=W&q=silica'));
  assert.deepEqual(view, {
    cat: 'enforcement',
    q: 'silica',
    section: '',
    part: '',
    state: 'CA',
    min_penalty: '50000',
    gravity: 'W',
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
  assert.equal(newsKicker({ category: 'rules', citation: '91 FR 1234' }), 'FINAL RULE · 91 FR 1234');
  assert.equal(newsSectionHref(29, '1910.1200'), '#/title/29/section/1910.1200');
  assert.equal(newsPartHref(40, '261'), '#/library/40');
  assert.match(extLink('javascript:evil()', '<b>X</b>'), /^<b>X<\/b>$/);
  assert.match(linkifyNewsText('Violation of § 1910.134(a)(1)'), /href="#\/title\/29\/section\/1910\.134"/);
  assert.equal(articleNewsTitle({ category: 'rules', title: 'T', link: 'L', published_at: '2026-09-01', cfr_parts: [{ title: 40, part: 261 }] }), 40);
  NEWS_CITE_RE.lastIndex = 0;
  assert.ok(NEWS_CITE_RE.test('29 CFR 1910.1200'));
});
