import { state } from '../state';
import { updateChatContext } from '../components/chat';
import {
  agencyInfo, agencyKeyForNode, agencyMeta, clearTreeSelection, ensureTreeLoaded,
  plural, showAgencyView, treeIdx,
} from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, icon, skeletonHtml } from '../dom';
import { openPanel } from '../nav';
import { navLib } from '../panels/library_panel';
import { dom } from '../state_init';
import { fmt, loadUsage, timeAgo, titleHref, visitedCountFor } from '../usage';
import { SEP, isStale, joinSep, shortDate, statPill } from '../views/library';
import { fmtMoney, inspectionActivityNr, newsKicker, newsPartHref, newsSectionHref, safeHttpUrl } from '../views/news';
import { loadProjects, projDot } from '../views/projects';
import { findPartInTree } from '../views/reader_part';

// --- Title Start (#/title/{n}/): Broadsheet Newsroom Front Page ---

// Curated starter card sets when installed parts exist; remaining 47 titles + partial installs
// derive key cards dynamically from treeData and title_blurbs metadata.
export const HOME_CONTENT = {
  29: {
    tagline: 'Federal labor regulations — workplace safety, wages and hours, leave, and employee benefits — with local search and Claude.',
    cards: [
      { part: '1910', kicker: 'OSHA Safety', title: 'Part 1910 — General Industry', desc: 'PPE, hazard communication, walking-working surfaces, fire protection, and machinery.' },
      { part: '1926', kicker: 'OSHA Safety', title: 'Part 1926 — Construction', desc: 'Scaffolds, fall protection, cranes, excavations, and electrical safety on sites.' },
      { part: '541', kicker: 'Wage & Hour', title: 'Part 541 — Overtime Exemptions', desc: 'Executive, administrative, professional, computer, and outside sales exemptions (FLSA).' },
      { part: '825', kicker: 'Leave & Family', title: 'Part 825 — Family & Medical Leave', desc: 'FMLA employee eligibility, employer notice obligations, leave duration, and certification.' },
      { part: '1904', kicker: 'Recordkeeping', title: 'Part 1904 — Injury Recording', desc: 'Recording and reporting occupational injuries, illnesses, and severe incidents.' },
      { part: '2560', kicker: 'Employee Benefits', title: 'Part 2560 — ERISA Administration', desc: 'Claims procedures, participant remedies, and retirement plan fiduciaries.' },
    ],
  },
  40: {
    tagline: 'EPA regulations — air and water quality, hazardous waste, permits, and chemical releases — with local search and Claude.',
    cards: [
      { part: '50', kicker: 'Air', title: 'Part 50 — Air Quality Standards', desc: 'National ambient air quality standards (NAAQS) for ozone, particulates, lead, and more.' },
      { part: '70', kicker: 'Air Permits', title: 'Part 70 — Operating Permits', desc: 'State operating permit programs for major stationary sources (Title V).' },
      { part: '122', kicker: 'Water', title: 'Part 122 — NPDES Permits', desc: 'The discharge permit program for point sources under the Clean Water Act.' },
      { part: '136', kicker: 'Water', title: 'Part 136 — Test Procedures', desc: 'Approved analytical methods for pollutant monitoring and compliance.' },
      { part: '261', kicker: 'Hazardous Waste', title: 'Part 261 — Waste Identification', desc: 'What counts as a solid and hazardous waste under RCRA: listings and characteristics.' },
      { part: '302', kicker: 'Emergencies', title: 'Part 302 — Reportable Quantities', desc: 'CERCLA hazardous substance designations and release notification thresholds.' },
    ],
  },
  49: {
    tagline: 'DOT regulations — hazardous materials, motor carriers, drivers, and vehicle safety — with local search and Claude.',
    cards: [
      { part: '172', kicker: 'Hazmat', title: 'Part 172 — Hazmat Table & Communication', desc: 'The hazardous materials table, shipping papers, marking, labeling, and placarding.' },
      { part: '173', kicker: 'Hazmat', title: 'Part 173 — Packaging Requirements', desc: 'General shipment and packaging requirements by hazard class.' },
      { part: '390', kicker: 'Motor Carriers', title: 'Part 390 — FMCSA General', desc: 'Who the federal motor carrier safety regulations apply to, and general duties.' },
      { part: '391', kicker: 'Drivers', title: 'Part 391 — Driver Qualifications', desc: 'Qualification files, medical certification, and disqualifying offenses.' },
      { part: '383', kicker: 'Drivers', title: 'Part 383 — Commercial Driver’s License', desc: 'CDL standards: who needs one, testing, endorsements, and disqualifications.' },
      { part: '571', kicker: 'Vehicles', title: 'Part 571 — Vehicle Safety Standards', desc: 'Federal motor vehicle safety standards (FMVSS) for cars, trucks, and buses.' },
    ],
  },
};

const REF_CATS = [
  ['all', 'All Web'],
  ['ibr', 'IBR Standards'],
  ['standards', 'Standards Bodies'],
  ['portals', 'Federal Portals'],
  ['agencies', 'Agencies & Guidance'],
  ['technical', 'Technical & Other'],
  ['legacy', 'Retired URLs'],
];

const CAT_LABELS = {
  standards: 'Standards',
  portals: 'Portal',
  agencies: 'Agency',
  technical: 'Technical',
};

const refUi = { title: null, beat: 'front', cat: 'all', q: '', expanded: false };
const titleNewsCache = new Map();

function countLeafSections(node) {
  if (!node) return 0;
  if (node.t === 'section' || node.t === 'appendix') return node.r ? 0 : 1;
  let total = 0;
  for (const ch of node.c || []) total += countLeafSections(ch);
  return total;
}

function findChapterLabel(partNode) {
  let k = treeIdx.parts.get(partNode.id);
  while (k !== undefined && k !== null) {
    const n = treeIdx.nodes[k];
    if (n && (n.t === 'chapter' || n.t === 'subtitle')) {
      const meta = agencyMeta(n);
      if (meta) return meta.code;
      return cleanInlineLabel(n.l || n.d || '');
    }
    k = treeIdx.parent[k];
  }
  return `Title ${state.currentTitle}`;
}

function firstLeafSection(node) {
  if (!node) return null;
  if ((node.t === 'section' || node.t === 'appendix') && !node.r) return node;
  for (const ch of node.c || []) {
    const hit = firstLeafSection(ch);
    if (hit) return hit;
  }
  return null;
}

function listSubparts(partNode) {
  return (partNode?.c || []).filter(
    ch => (ch.t === 'subpart' || ch.t === 'subject_group') && !ch.r && countLeafSections(ch) > 0
  );
}

function listDirectLeaves(partNode) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if ((n.t === 'section' || n.t === 'appendix') && !n.r) { out.push(n); return; }
    for (const ch of n.c || []) {
      walk(ch);
      if (out.length >= 6) return;
    }
  };
  walk(partNode);
  return out;
}

/** Synthesize a concise editorial dek from a part's subparts or top sections. */
function describePartNode(partNode, secCount) {
  if (!partNode) return secCount ? `${plural(secCount, 'section')} in this part` : '';
  const cleanPhrase = (s) => cleanInlineLabel(s).replace(/\.+$/, '');
  const subparts = listSubparts(partNode);
  if (subparts.length) {
    const names = subparts.slice(0, 3).map(s => cleanPhrase(s.d || s.l || '')).filter(Boolean);
    if (names.length) {
      const rest = subparts.length - names.length;
      const tail = rest > 0 ? `, and ${plural(rest, 'more subpart')}` : '';
      return `Covers ${names.join(', ')}${tail}.`;
    }
  }
  const leaves = listDirectLeaves(partNode);
  if (leaves.length) {
    const names = leaves.slice(0, 3).map(s => cleanPhrase(s.d || s.l || '')).filter(Boolean);
    if (names.length) return `Includes ${names.join('; ')}.`;
  }
  return `${plural(secCount, 'section')} in this part.`;
}

function buildDynamicCard(partNode, kickerOverride = '') {
  const secCount = countLeafSections(partNode);
  const titleText = cleanInlineLabel(partNode.d || '');
  return {
    part: partNode.id,
    kicker: kickerOverride || findChapterLabel(partNode),
    title: `Part ${partNode.id}${titleText ? ' — ' + titleText : ''}`,
    desc: describePartNode(partNode, secCount),
    secCount,
  };
}

function collectDynamicCards(limit = 6) {
  if (!treeIdx.partList || !treeIdx.partList.length) return [];
  const scored = [];
  for (const k of treeIdx.partList) {
    const p = treeIdx.nodes[k];
    if (!p || p.r) continue;
    const secCount = countLeafSections(p);
    if (!secCount) continue;
    scored.push(buildDynamicCard(p));
  }
  if (!scored.length) return [];
  const bySize = [...scored].sort((a, b) => b.secCount - a.secCount);
  const lead = bySize[0];
  const topIds = new Set(bySize.slice(0, limit).map(c => c.part));
  const rest = scored.filter(c => topIds.has(c.part) && c.part !== lead.part);
  return [lead, ...rest].slice(0, limit);
}

function collectAgencyParts(agencyNode) {
  const out = [];
  const walk = (n) => {
    if (!n || n.r) return;
    if (n.t === 'part') { out.push(n); return; }
    for (const ch of n.c || []) walk(ch);
  };
  walk(agencyNode);
  return out;
}

function agencyBeatsList() {
  return (treeIdx.agencyList || [])
    .map(k => ({ k, node: treeIdx.nodes[k], key: agencyKeyForNode(treeIdx.nodes[k]), info: agencyInfo(treeIdx.nodes[k]) }))
    .filter(x => x.node && x.node.n > 0);
}

function cardsForBeat(titleNum, beat) {
  if (beat && beat !== 'front') {
    const k = treeIdx.agencies.get(beat);
    const agNode = k != null ? treeIdx.nodes[k] : null;
    if (agNode) {
      const info = agencyInfo(agNode);
      const curatedByPart = new Map(((HOME_CONTENT[titleNum] || {}).cards || []).map(c => [c.part, c]));
      const parts = collectAgencyParts(agNode)
        .map(p => ({ node: p, secCount: countLeafSections(p) }))
        .filter(x => x.secCount > 0)
        .sort((a, b) => b.secCount - a.secCount)
        .slice(0, 7);
      return parts.map(({ node }) => {
        const curated = curatedByPart.get(node.id);
        return curated ? { ...curated, secCount: countLeafSections(node) } : buildDynamicCard(node, info.code);
      });
    }
  }

  const curated = HOME_CONTENT[titleNum];
  if (curated && curated.cards) {
    if (treeIdx.parts && treeIdx.parts.size > 0) {
      const present = curated.cards.filter(c => treeIdx.parts.has(c.part));
      if (present.length >= 2) return present;
    } else {
      return curated.cards;
    }
  }
  return collectDynamicCards(6);
}

function leadInsideLinksHtml(titleNum, partId, partNode) {
  if (!partNode) return '';
  const subparts = listSubparts(partNode);
  const items = [];
  if (subparts.length) {
    for (const sp of subparts.slice(0, 4)) {
      const target = firstLeafSection(sp);
      if (!target) continue;
      const spLabel = cleanInlineLabel(sp.l || `Subpart ${sp.id}`);
      const spName = cleanInlineLabel(sp.d || '');
      items.push({
        href: titleHref(titleNum, `section/${encodeURIComponent(target.id)}`),
        code: spLabel,
        text: spName && spName !== spLabel ? spName : cleanInlineLabel(target.d || target.l || ''),
      });
    }
  } else {
    for (const sec of listDirectLeaves(partNode).slice(0, 4)) {
      items.push({
        href: titleHref(titleNum, `section/${encodeURIComponent(sec.id)}`),
        code: cleanInlineLabel(sec.l || `§ ${sec.id}`),
        text: cleanInlineLabel(sec.d || ''),
      });
    }
  }
  if (!items.length) return '';
  return `
    <div class="ts-lead-inside">
      <div class="ts-inside-label">Inside Part ${escapeHtml(partId)}</div>
      <div class="ts-inside-grid">
        ${items.map(it => `
          <a class="ts-inside-item" href="${it.href}">
            <span class="ts-inside-code">${escapeHtml(it.code)}</span>
            ${it.text ? `<span class="ts-inside-text">${escapeHtml(it.text)}</span>` : ''}
          </a>`).join('')}
      </div>
    </div>`;
}

function mainBroadsheetHtml(titleNum, beat) {
  const cards = cardsForBeat(titleNum, beat);
  const beatInfo = beat !== 'front' && treeIdx.agencies.has(beat)
    ? agencyInfo(treeIdx.nodes[treeIdx.agencies.get(beat)])
    : null;
  const beatK = beat !== 'front' ? treeIdx.agencies.get(beat) : null;

  const flagHtml = beatInfo
    ? `
      <div class="ts-sec-flag">
        <span class="ts-flag-label">${escapeHtml(beatInfo.code)} Beat${beatInfo.name ? ` · ${escapeHtml(beatInfo.name)}` : ''}</span>
        <span class="ts-flag-acts">
          <button type="button" class="hm-inline-link" data-ts-open-agency="${beatK}">Open in Contents ${icon('chevronRight')}</button>
          <button type="button" class="hm-inline-link" data-ts-beat="front">All beats</button>
        </span>
      </div>`
    : `
      <div class="ts-sec-flag">
        <span class="ts-flag-label">The Lead Beat</span>
        <span class="ts-flag-meta">${cards.length ? plural(cards.length, 'key part') : 'Title overview'}</span>
      </div>`;

  if (!cards.length) {
    return `
      <div class="ts-main-col">
        ${flagHtml}
        <div class="ts-lead"><p class="ts-lead-dek">Open the Contents drawer to browse sections in Title ${titleNum}.</p></div>
      </div>`;
  }

  const lead = cards[0];
  const leadNode = state.treeData ? findPartInTree(state.treeData, lead.part) : null;
  const leadSecCount = leadNode ? countLeafSections(leadNode) : (lead.secCount || 0);
  const subCount = leadNode ? listSubparts(leadNode).length : 0;
  const leadHref = titleHref(titleNum, `part/${encodeURIComponent(lead.part)}`);
  const leadFullHref = titleHref(titleNum, `part/${encodeURIComponent(lead.part)}/full`);

  const briefs = cards.slice(1);
  const briefsHtml = briefs.length ? `
    <div class="ts-briefs">
      ${briefs.map(c => {
        const pNode = state.treeData ? findPartInTree(state.treeData, c.part) : null;
        const cCount = pNode ? countLeafSections(pNode) : (c.secCount || 0);
        const cSubs = pNode ? listSubparts(pNode).length : 0;
        const pHref = titleHref(titleNum, `part/${encodeURIComponent(c.part)}`);
        return `
          <article class="ts-brief">
            <div class="ts-brief-top">
              <span class="ts-brief-kicker">${escapeHtml(c.kicker)} · Part ${escapeHtml(c.part)}</span>
              ${cCount ? `<span class="ts-brief-count">${fmt(cCount)} §</span>` : ''}
            </div>
            <h3 class="ts-brief-title"><a href="${pHref}">${escapeHtml(c.title)}</a></h3>
            <p class="ts-brief-dek">${escapeHtml(c.desc)}</p>
            <div class="ts-brief-foot">
              <span>${cSubs ? plural(cSubs, 'subpart') : (cCount ? plural(cCount, 'section') : 'Open part')}</span>
              <span class="ts-brief-go" aria-hidden="true">Read ${icon('chevronRight')}</span>
            </div>
          </article>`;
      }).join('')}
    </div>` : '';

  return `
    <div class="ts-main-col">
      ${flagHtml}
      <article class="ts-lead">
        <div class="ts-lead-top">
          <span class="ts-lead-kicker">Lead Story · ${escapeHtml(lead.kicker)} · Part ${escapeHtml(lead.part)}</span>
          ${leadSecCount ? `<span class="ts-lead-stat">${fmt(leadSecCount)} ${leadSecCount === 1 ? 'section' : 'sections'}${subCount ? ` · ${plural(subCount, 'subpart')}` : ''}</span>` : ''}
        </div>
        <h2 class="ts-lead-title"><a href="${leadHref}">${escapeHtml(lead.title)}</a></h2>
        <p class="ts-lead-dek">${escapeHtml(lead.desc)}</p>
        ${leadInsideLinksHtml(titleNum, lead.part, leadNode)}
        <div class="ts-lead-foot">
          <a class="btn btn-sm" href="${leadHref}">Open Part ${escapeHtml(lead.part)} ${icon('chevronRight')}</a>
          <a class="hm-inline-link" href="${leadFullHref}">Read full part</a>
        </div>
      </article>
      ${briefsHtml}
    </div>`;
}

function titleDeskRailHtml(titleNum) {
  const usage = loadUsage();
  const entries = Object.entries(usage.s || {})
    .map(([key, e]) => {
      const pipe = key.indexOf('|');
      if (pipe < 0 || !e) return null;
      return { title: Number(key.slice(0, pipe)), id: key.slice(pipe + 1), ...e };
    })
    .filter(e => e && e.title === titleNum && e.id)
    .sort((a, b) => (b.t || 0) - (a.t || 0));

  let resumeHtml;
  if (entries.length) {
    const last = entries[0];
    const href = titleHref(titleNum, 'section/' + encodeURIComponent(last.id) + (last.u ? '/' + encodeURIComponent(last.u) : ''));
    const trail = entries.slice(1, 3);
    resumeHtml = `
      <div class="ts-rail-block title-resume">
        <div class="ts-rail-head">
          <span class="hm-kicker">Continue in Title ${titleNum}</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t))}</span>
        </div>
        <a class="ts-resume-link" href="${href}">${escapeHtml(last.l || '§ ' + last.id)}${last.h ? ' ' + escapeHtml(last.h) : ''}</a>
        <div class="ts-resume-meta">
          ${last.p ? `<a href="${titleHref(titleNum, 'part/' + encodeURIComponent(last.p))}">Part ${escapeHtml(last.p)}</a>` : ''}
          ${last.ul ? `<span class="hm-unit-badge">${escapeHtml(last.ul)}</span>` : ''}
        </div>
        <div class="ts-resume-acts">
          <a class="btn btn-sm btn-accent" href="${href}">Resume reading ${icon('chevronRight')}</a>
        </div>
        ${trail.length ? `
          <div class="ts-rail-trail">
            ${trail.map(e => `
              <a class="hm-trail-row" href="${titleHref(titleNum, 'section/' + encodeURIComponent(e.id) + (e.u ? '/' + encodeURIComponent(e.u) : ''))}">
                <span class="hm-row-num">${escapeHtml(String(e.l || e.id).replace(/^§\s*/, ''))}</span>
                <span class="hm-row-text">${escapeHtml(e.h || '')}</span>
                <span class="hm-row-val">${escapeHtml(timeAgo(e.t))}</span>
              </a>`).join('')}
          </div>` : ''}
      </div>`;
  } else {
    const firstPart = cardsForBeat(titleNum, 'front')[0]?.part;
    resumeHtml = `
      <div class="ts-rail-block">
        <div class="ts-rail-head"><span class="hm-kicker">At your desk</span></div>
        <p class="ts-rail-empty">No recent reading history in Title ${titleNum} yet.</p>
        ${firstPart ? `<a class="hm-inline-link" href="${titleHref(titleNum, 'part/' + encodeURIComponent(firstPart))}">Start at Part ${escapeHtml(firstPart)} ${icon('chevronRight')}</a>` : ''}
      </div>`;
  }

  const matchingProjects = loadProjects()
    .filter(p => (p.sections || []).some(s => s.title === titleNum))
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .slice(0, 3);

  const wsHtml = `
    <div class="ts-rail-block">
      <div class="ts-rail-head">
        <span class="hm-kicker">Workspaces in Title ${titleNum}</span>
        <a class="hm-inline-link" href="#/projects">All</a>
      </div>
      ${matchingProjects.length ? `
        <div class="ts-rail-ws-list">
          ${matchingProjects.map(p => {
            const pins = (p.sections || []).filter(s => s.title === titleNum).slice(0, 3);
            return `
              <div class="ts-rail-ws">
                <a class="hm-ws-name" href="#/projects/${encodeURIComponent(p.id)}">${projDot(p)}<span>${escapeHtml(p.name)}</span></a>
                <div class="ts-rail-ws-chips">
                  ${pins.map(s => `<a class="citation-chip" href="${titleHref(titleNum, 'section/' + encodeURIComponent(s.id))}">${escapeHtml(s.label || '§ ' + s.id)}</a>`).join('')}
                </div>
              </div>`;
          }).join('')}
        </div>` : `<p class="ts-rail-empty">Pin any Title ${titleNum} section with <kbd>⌘D</kbd> to build an audit or compliance workspace.</p>`}
    </div>`;

  const wireSlotHtml = titleNum === 29
    ? (() => {
      const cached = titleNewsCache.get(29);
      const fresh = cached && Date.now() - cached.at < 300000 ? cached.articles : null;
      return `<div class="ts-rail-block" id="ts-wire-slot"${fresh && fresh.length ? '' : ' hidden'}>${fresh && fresh.length ? renderTitleWireHtml(fresh) : ''}</div>`;
    })()
    : '';

  const citedSlotHtml = `
    <div class="ts-rail-block" id="ts-cited-slot">
      <div class="ts-rail-head"><span class="hm-kicker">Most-cited in Title ${titleNum}</span></div>
      <div class="skel-stack" style="gap:8px;margin-top:8px" aria-hidden="true">
        <span class="skel skel-line is-sm" style="width:86%"></span>
        <span class="skel skel-line is-sm" style="width:74%"></span>
        <span class="skel skel-line is-sm" style="width:68%"></span>
      </div>
    </div>`;

  return `
    <aside class="ts-rail" aria-label="Title desk and regulatory index">
      ${resumeHtml}
      ${wsHtml}
      ${wireSlotHtml}
      ${citedSlotHtml}
    </aside>`;
}

function renderTitleWireHtml(articles) {
  if (!articles || !articles.length) return '';
  return `
    <div class="ts-rail-head">
      <span class="hm-kicker">From the OSHA wire</span>
      <a class="hm-inline-link" href="#/news">Newsroom ${icon('chevronRight')}</a>
    </div>
    <ol class="wire-items ts-wire-items">
      ${articles.slice(0, 3).map(a => {
        const actNr = inspectionActivityNr(a);
        const sec = (a.sections || [])[0];
        const partRef = (a.cfr_parts || [])[0];
        const href = actNr ? `#/news/inspection/${actNr}`
          : sec ? newsSectionHref(29, sec)
          : partRef ? newsPartHref(partRef.title, partRef.part)
          : `#/news?cat=${encodeURIComponent(a.category || 'all')}`;
        return `
          <li class="wire-entry">
            <a href="${href}">
              <span class="wire-entry-head">
                <span class="wire-entry-title">${escapeHtml(newsKicker(a))}</span>
                <time class="wire-entry-date">${escapeHtml(shortDate(a.published_at))}</time>
              </span>
              <span class="wire-entry-name">${escapeHtml(a.title)}</span>
              ${a.penalty_usd ? `<span class="wire-entry-summary">${escapeHtml(fmtMoney(a.penalty_usd))} penalty</span>` : ''}
            </a>
          </li>`;
      }).join('')}
    </ol>`;
}

function renderMostCitedHtml(data, titleNum) {
  const list = (data && data.most_cited) || [];
  if (!list.length) return '';
  return `
    <div class="ts-rail-head">
      <span class="hm-kicker">Most-cited in Title ${titleNum}</span>
      <span class="ts-rail-count">${fmt(data.most_cited_total || list.length)} hubs</span>
    </div>
    <ol class="ts-cited-list">
      ${list.slice(0, 5).map((s, idx) => `
        <li>
          <a class="ts-cited-row" href="${titleHref(titleNum, 'section/' + encodeURIComponent(s.id))}">
            <span class="ts-cited-rank">${idx + 1}</span>
            <span class="ts-cited-body">
              <span class="ts-cited-num">${escapeHtml(s.label || '§ ' + s.id)}</span>
              <span class="ts-cited-name">${escapeHtml(s.title || '')}</span>
            </span>
            <span class="ts-cited-cites">${plural(s.cited_by_count, 'cite')}</span>
          </a>
        </li>`).join('')}
    </ol>`;
}

function beatsRibbonHtml() {
  const beats = agencyBeatsList();
  if (beats.length < 2) return '';
  const top = [...beats].sort((a, b) => b.node.n - a.node.n).slice(0, 6);
  const pill = (key, label) => {
    const on = refUi.beat === key;
    return `<button type="button" aria-pressed="${on}" data-ts-beat="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
  };
  return `
    <div class="ts-beats-bar">
      <div class="lib-seg ts-beats" role="group" aria-label="Filter edition by department">
        ${pill('front', 'Front Page')}
        ${top.map(b => pill(b.key, b.info.code)).join('')}
      </div>
      <div class="ts-beats-jumps">
        <button type="button" class="hm-inline-link" data-ts-scroll="ts-depts">${plural(beats.length, 'department')}</button>
        <button type="button" class="hm-inline-link" data-ts-scroll="ts-almanac">Almanac</button>
      </div>
    </div>`;
}

function departmentsDirectoryHtml() {
  const beats = agencyBeatsList();
  if (beats.length < 2) return '';
  return `
    <section class="ts-depts" id="ts-depts" aria-label="Departments and agencies">
      <div class="ts-sec-flag">
        <span class="ts-flag-label">Departments &amp; Agencies</span>
        <span class="ts-flag-meta">${plural(beats.length, 'chapter')} · Select a beat to focus the front page</span>
      </div>
      <div class="ts-dept-grid">
        ${beats.map(b => {
          const on = refUi.beat === b.key;
          return `
            <div class="ts-dept-item${on ? ' is-active' : ''}">
              <button type="button" class="ts-dept-btn" data-ts-beat="${escapeHtml(b.key)}" aria-pressed="${on}">
                <span class="ts-dept-top">
                  <span class="ts-dept-code">${escapeHtml(b.info.code)}</span>
                  ${b.info.range ? `<span class="ts-dept-range">Parts ${escapeHtml(b.info.range)}</span>` : ''}
                </span>
                <span class="ts-dept-name">${escapeHtml(b.info.name)}</span>
                <span class="ts-dept-meta">${plural(b.node.partCount || 0, 'part')} · ${fmt(b.node.n)} sections</span>
              </button>
              <button type="button" class="ts-dept-drawer" data-ts-open-agency="${b.k}" title="Browse ${escapeHtml(b.info.code)} in Contents" aria-label="Browse ${escapeHtml(b.info.code)} in Contents">Contents ${icon('chevronRight')}</button>
            </div>`;
        }).join('')}
      </div>
    </section>`;
}

// --- Almanac (Sources, Standards & Authorities) ---

function filterWebEntries(data, cat, q) {
  const ql = q.trim().toLowerCase();
  const hosts = data.hosts && data.hosts.length ? data.hosts : null;
  const rawItems = data.items || [];

  // When browsing without a narrow query, group by normalized host; if a query targets
  // a deep path not on the host summary, fall back to item-level rows so nothing is hidden.
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
      const cites = (it.cited_in || []).map(c => `${c.id} ${c.label} ${c.title} ${c.part}`).join(' ');
      return `${it.host} ${it.url} ${it.display} ${it.legacy?.replacement_url || ''} ${cites}`.toLowerCase().includes(ql);
    });
  }
  return filtered;
}

function filterIbrEntries(data, q) {
  const list = data.ibr_standards || [];
  const ql = q.trim().toLowerCase();
  if (!ql) return list;
  return list.filter(s => {
    const secs = (s.approved_in || []).map(a => `${a.id} ${a.label} ${a.part} ${a.para}`).join(' ');
    const hay = `${s.code} ${s.org} ${s.org_name} ${s.excerpt} ${secs}`.toLowerCase();
    return hay.includes(ql);
  });
}

function renderWebItemHtml(item, titleNum) {
  const citesHtml = (item.cited_in || []).slice(0, 4).map(c =>
    `<a class="citation-chip" href="#/title/${titleNum}/section/${encodeURIComponent(c.id)}" title="${escapeHtml(c.title)}">${escapeHtml(c.label)}</a>`
  ).join('');
  const moreCites = item.cite_count > 4 ? `<span class="ref-cite-more">+${item.cite_count - 4}</span>` : '';
  const href = safeHttpUrl(item.url);
  const replHref = item.legacy ? safeHttpUrl(item.legacy.replacement_url) : '';
  const legacyHtml = item.legacy ? `
    <div class="ref-legacy">
      <span class="stat-pill is-stale is-bare"><span class="stat-dot is-stale" aria-hidden="true"></span>Retired URL</span>
      <span class="ref-legacy-note">${escapeHtml(item.legacy.note)}</span>
      ${replHref ? `<a class="citation-chip" href="${escapeHtml(replHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.legacy.replacement_label)} ↗</a>` : ''}
    </div>` : '';
  const pageCount = item.url_count > 1 ? `<span class="ref-subpages">${item.url_count} URLs</span>` : '';

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

function renderIbrItemHtml(std, titleNum) {
  const approved = (std.approved_in || []).slice(0, 4).map(a =>
    `<a class="citation-chip" href="#/title/${titleNum}/section/${encodeURIComponent(a.id)}${a.para ? '?p=' + encodeURIComponent(a.para) : ''}">${escapeHtml(a.label)}${a.para ? escapeHtml(a.para) : ''}</a>`
  ).join('');
  const extra = (std.section_count || 0) - 4;
  const orgHref = safeHttpUrl(std.org_url);
  return `
    <article class="ref-item is-ibr">
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

function renderRefListHtml(data, titleNum) {
  const isIbr = refUi.cat === 'ibr';
  const filtered = isIbr ? filterIbrEntries(data, refUi.q) : filterWebEntries(data, refUi.cat, refUi.q);
  if (!filtered.length) {
    return '<div class="ref-empty">No matching references for the current filter.</div>';
  }
  const showLimit = refUi.expanded || refUi.q.trim() ? filtered.length : 12;
  const shown = filtered.slice(0, showLimit);
  const rows = shown.map(item => (isIbr ? renderIbrItemHtml(item, titleNum) : renderWebItemHtml(item, titleNum))).join('');
  const moreBtn = filtered.length > shown.length
    ? `<div class="ref-more"><button type="button" class="btn btn-sm" id="ref-show-all">Show all ${filtered.length} matching entries</button></div>`
    : '';
  return `<div class="ref-grid">${rows}</div>${moreBtn}`;
}

function updateRefHubDom(data, titleNum) {
  const hubEl = document.getElementById('ts-almanac');
  const catsEl = document.getElementById('ref-cats-slot');
  const listEl = document.getElementById('ref-list-slot');
  const countEl = document.getElementById('ref-total-count');
  if (!hubEl || !catsEl || !listEl) return;

  const webTotal = data.host_total ?? data.total ?? 0;
  const ibrTotal = data.ibr_total ?? (data.ibr_standards || []).length;
  const catCounts = data.host_category_counts || data.category_counts || {};
  const legacyCount = (data.hosts || data.items || []).filter(it => it.legacy).length;

  // Quiet colophon when a title cites neither external web URLs nor IBR standards.
  if (!webTotal && !ibrTotal) {
    const count = Number(state.metaInfo.section_count || 0);
    hubEl.innerHTML = `
      <div class="ts-colophon">
        Edition Colophon · Title ${titleNum}${count ? ` · ${fmt(count)} sections` : ''} · No external web portals or incorporated consensus standards cited.
      </div>`;
    return;
  }

  if (countEl) {
    const parts = [];
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

function renderMastheadStatusHtml(titleNum) {
  const libRow = (navLib.data && navLib.data.titles || []).find(x => x.title === titleNum);
  if (libRow && isStale(libRow)) return statPill('stale', 'Update available', { bare: true });
  if (state.metaInfo.partial) return statPill('partial', 'Partial install', { bare: true });
  return statPill('synced', 'Installed', { bare: true });
}

function hydrateTitleWire(titleNum, seq, signal) {
  if (titleNum !== 29) return;
  const applyWire = (articles) => {
    const slot = document.getElementById('ts-wire-slot');
    if (!slot || seq !== state.routeSeq) return;
    if (!articles || !articles.length) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = renderTitleWireHtml(articles);
  };
  const cached = titleNewsCache.get(29);
  if (cached && Date.now() - cached.at < 300000) {
    applyWire(cached.articles);
    return;
  }
  fetch('/api/news?limit=3', { signal })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data || seq !== state.routeSeq) return;
      const articles = data.articles || [];
      titleNewsCache.set(29, { at: Date.now(), articles });
      applyWire(articles);
    })
    .catch(() => {});
}

export async function renderHome() {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();

  const titleNum = state.currentTitle;
  const seq = state.routeSeq;
  if (refUi.title !== titleNum) {
    refUi.title = titleNum;
    refUi.beat = 'front';
    refUi.cat = 'all';
    refUi.q = '';
    refUi.expanded = false;
  }

  document.title = `Title ${titleNum} · FRAMEWORK`;
  setViewHead('');

  const snapRow = state.homeSnapshot?.titles?.find(x => x.title === titleNum);
  const name = state.metaInfo.name || snapRow?.name || '';
  const content = HOME_CONTENT[titleNum];
  const tagline = content?.tagline
    || snapRow?.summary
    || `Read, search, and research Title ${titleNum} of the Code of Federal Regulations.`;
  const count = Number(state.metaInfo.section_count || 0);
  const readCount = visitedCountFor(titleNum);
  const edLabel = state.metaInfo.edition ? `Edition ${shortDate(state.metaInfo.edition) || state.metaInfo.edition}` : '';
  const folioMeta = joinSep([
    edLabel,
    count ? `${fmt(count)} sections` : '',
    readCount ? `${fmt(readCount)} read` : '',
  ]);

  dom.view.innerHTML = `
    <div class="ts-front">
      <header class="home-hero ts-masthead">
        <div class="ts-folio">
          <div class="doc-kicker">
            <a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><span>${titleNum} CFR${snapRow?.desk ? ` · ${escapeHtml(snapRow.desk)}` : ''}</span>
          </div>
          <div class="ts-folio-right">
            ${folioMeta ? `<span class="ts-folio-meta">${folioMeta}</span>` : ''}
            ${renderMastheadStatusHtml(titleNum)}
          </div>
        </div>
        <div class="ts-title-row">
          <div class="ts-title-copy">
            <h1>Title ${titleNum}${name ? ' — ' + escapeHtml(name) : ''}</h1>
            <p>${escapeHtml(tagline)}</p>
          </div>
          <div class="home-hero-acts">
            <button type="button" class="btn btn-sm" id="home-open-contents">${icon('book')} Browse contents</button>
            <a class="btn btn-sm" href="#/library/${titleNum}">Manage in Library</a>
          </div>
        </div>
        <div class="ts-double-rule" aria-hidden="true"></div>
        <div id="ts-beats-slot">${beatsRibbonHtml()}</div>
      </header>

      <div class="ts-broadsheet">
        <div id="ts-main-slot">${mainBroadsheetHtml(titleNum, refUi.beat)}</div>
        ${titleDeskRailHtml(titleNum)}
      </div>

      <div id="ts-depts-slot">${departmentsDirectoryHtml()}</div>

      <section class="ref-hub ts-almanac" id="ts-almanac" aria-label="References and authorities">
        <div class="ts-sec-flag">
          <span class="ts-flag-label">Almanac · References &amp; Authorities</span>
          <span class="ref-total-pill" id="ref-total-count">Indexing…</span>
        </div>
        <p class="ref-hub-sub">Standards organizations, incorporated consensus standards, federal portals, and external authorities cited across Title ${titleNum}.</p>
        <div class="ref-controls">
          <div class="ref-cats" id="ref-cats-slot" role="group" aria-label="Filter by category"></div>
          <input type="search" class="search-filter-input ref-search" id="ref-filter" value="${escapeHtml(refUi.q)}" placeholder="Filter domains, standards, or citing sections…" aria-label="Filter references" autocomplete="off" spellcheck="false">
        </div>
        <div id="ref-list-slot">${skeletonHtml('list', 'Indexing references…')}</div>
      </section>
    </div>`;

  enterView();

  const signal = state.routeAbort?.signal;
  hydrateTitleWire(titleNum, seq, signal);

  // Fill tree-derived broadsheet leads, beats, and department index once treeData arrives.
  if (!state.treeData) {
    try {
      await ensureTreeLoaded();
      if (seq !== state.routeSeq) return;
      const beatsSlot = document.getElementById('ts-beats-slot');
      const mainSlot = document.getElementById('ts-main-slot');
      const deptsSlot = document.getElementById('ts-depts-slot');
      if (beatsSlot) beatsSlot.innerHTML = beatsRibbonHtml();
      if (mainSlot) mainSlot.innerHTML = mainBroadsheetHtml(titleNum, refUi.beat);
      if (deptsSlot) deptsSlot.innerHTML = departmentsDirectoryHtml();
    } catch (e) { /* keep graceful starter layout */ }
  }

  // Enrich tagline + desk metadata from local snapshot if not yet in memory.
  if (!snapRow) {
    fetch('/api/titles/snapshot', { signal }).then(r => (r.ok ? r.json() : null)).then(snap => {
      if (!snap || seq !== state.routeSeq) return;
      state.homeSnapshot = snap;
      const row = snap.titles?.find(x => x.title === titleNum);
      if (!row) return;
      const pEl = dom.view.querySelector('.ts-title-copy > p');
      if (!content && row.summary && pEl) pEl.textContent = row.summary;
      const crumbSpan = dom.view.querySelector('.ts-folio .doc-kicker > span:last-child');
      if (row.desk && crumbSpan) crumbSpan.textContent = `${titleNum} CFR · ${row.desk}`;
    }).catch(() => {});
  }

  // Hydrate References, IBR Standards & Most-Cited hubs (cached per title).
  let refData = state.refsCache.get(titleNum);
  if (!refData) {
    try {
      const res = await fetch(`/api/${titleNum}/references`, { signal });
      if (seq !== state.routeSeq) return;
      if (res.ok) {
        refData = await res.json();
        state.refsCache.set(titleNum, refData);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  if (seq !== state.routeSeq) return;

  const citedSlot = document.getElementById('ts-cited-slot');
  if (refData) {
    if (citedSlot) {
      const citedHtml = renderMostCitedHtml(refData, titleNum);
      if (citedHtml) citedSlot.innerHTML = citedHtml;
      else citedSlot.hidden = true;
    }
    updateRefHubDom(refData, titleNum);
  } else {
    if (citedSlot) citedSlot.hidden = true;
    const listEl = document.getElementById('ref-list-slot');
    if (listEl) listEl.innerHTML = '<div class="ref-empty">Couldn’t load references for this title.</div>';
  }
}

dom.view.addEventListener('input', (e) => {
  if (e.target.id !== 'ref-filter' || !dom.view.querySelector('.ref-hub')) return;
  refUi.q = e.target.value;
  refUi.expanded = false;
  const data = state.refsCache.get(state.currentTitle);
  if (data) updateRefHubDom(data, state.currentTitle);
});

dom.view.addEventListener('click', (e) => {
  if (!dom.view.querySelector('.ts-front')) return;

  if (e.target.closest('#home-open-contents')) {
    openPanel('reader', { focus: true });
    return;
  }

  const beatEl = e.target.closest('[data-ts-beat]');
  if (beatEl) {
    const nextBeat = beatEl.dataset.tsBeat || 'front';
    refUi.beat = nextBeat;
    const beatsSlot = document.getElementById('ts-beats-slot');
    const mainSlot = document.getElementById('ts-main-slot');
    const deptsSlot = document.getElementById('ts-depts-slot');
    if (beatsSlot) beatsSlot.innerHTML = beatsRibbonHtml();
    if (mainSlot) mainSlot.innerHTML = mainBroadsheetHtml(state.currentTitle, refUi.beat);
    if (deptsSlot) deptsSlot.innerHTML = departmentsDirectoryHtml();
    if (beatEl.closest('.ts-depts') && mainSlot) {
      mainSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }

  const agencyBtn = e.target.closest('[data-ts-open-agency]');
  if (agencyBtn) {
    const k = Number(agencyBtn.dataset.tsOpenAgency);
    if (!Number.isNaN(k)) showAgencyView(k);
    openPanel('reader', { focus: true });
    return;
  }

  const jumpBtn = e.target.closest('[data-ts-scroll]');
  if (jumpBtn) {
    const target = document.getElementById(jumpBtn.dataset.tsScroll);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (!dom.view.querySelector('.ref-hub')) return;
  const catBtn = e.target.closest('[data-ref-cat]');
  if (catBtn) {
    refUi.cat = catBtn.dataset.refCat;
    refUi.expanded = false;
    const data = state.refsCache.get(state.currentTitle);
    if (data) updateRefHubDom(data, state.currentTitle);
    return;
  }
  if (e.target.closest('#ref-show-all')) {
    refUi.expanded = true;
    const data = state.refsCache.get(state.currentTitle);
    if (data) updateRefHubDom(data, state.currentTitle);
  }
});
