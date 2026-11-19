import { state, TreeNode } from '../state';
import { fetchNewsPreview, fetchTitleReferences, fetchTitlesSnapshot } from '../api/client';
import { isStale } from '../core/library_meta';
import { fmtMoney, inspectionActivityNr, newsKicker, newsPartHref, newsSectionHref } from '../core/news_format';
import { loadProjects, projDot } from '../core/projects_store';
import { onView } from '../core/view_dispatch';
import { HOME_CONTENT, HomeStarterCard } from '../data/home_content';
import { updateChatContext } from '../components/chat';
import { jurisdictionStackForTitle, tierMetaFor } from '../components/corpora';
import {
  agencyInfo, agencyKeyForNode, agencyMeta, clearTreeSelection, ensureTreeLoaded,
  plural, showAgencyView, treeIdx,
} from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { cleanInlineLabel, enterView, escapeHtml, findPartInTree, icon, skeletonHtml } from '../dom';
import { openPanel } from '../nav';
import { dom } from '../state_init';
import { fmt, loadUsage, timeAgo, titleHref, visitedCountFor } from '../usage';
import { SEP, joinSep, shortDate, statPill } from '../components/ui';
import { AlmanacReferencesResponse, refUi, updateRefHubDom } from './ref_almanac';

export { HOME_CONTENT };

interface WireArticle {
  category?: string;
  title?: string;
  published_at?: string;
  penalty_usd?: number;
  guid?: string;
  link?: string;
  sections?: string[];
  cfr_parts?: Array<{ title: number; part: string | number }>;
}

interface MostCitedItem {
  id: string;
  label?: string;
  title?: string;
  cited_by_count: number;
}

interface TitleRefsExtended extends AlmanacReferencesResponse {
  most_cited?: MostCitedItem[];
  most_cited_total?: number;
}

interface BeatCard extends HomeStarterCard {
  secCount?: number;
}

const titleNewsCache = new Map<number, { at: number; articles: WireArticle[] }>();

function countLeafSections(node: TreeNode | null | undefined): number {
  if (!node) return 0;
  if (node.t === 'section' || node.t === 'appendix') return node.r ? 0 : 1;
  let total = 0;
  for (const ch of node.c || []) total += countLeafSections(ch);
  return total;
}

function findChapterLabel(partNode: TreeNode): string {
  let k: number | undefined = treeIdx.parts.get(String(partNode.id || ''));
  while (k !== undefined && k !== null && k >= 0) {
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

function firstLeafSection(node: TreeNode | null | undefined): TreeNode | null {
  if (!node) return null;
  if ((node.t === 'section' || node.t === 'appendix') && !node.r) return node;
  for (const ch of node.c || []) {
    const hit = firstLeafSection(ch);
    if (hit) return hit;
  }
  return null;
}

function listSubparts(partNode: TreeNode | null | undefined): TreeNode[] {
  return (partNode?.c || []).filter(
    ch => (ch.t === 'subpart' || ch.t === 'subject_group') && !ch.r && countLeafSections(ch) > 0,
  );
}

function listDirectLeaves(partNode: TreeNode | null | undefined): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode | null | undefined) => {
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

function describePartNode(partNode: TreeNode | null | undefined, secCount: number): string {
  if (!partNode) return secCount ? `${plural(secCount, 'section')} in this part` : '';
  const cleanPhrase = (s: string) => cleanInlineLabel(s).replace(/\.+$/, '');
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

function buildDynamicCard(partNode: TreeNode, kickerOverride = ''): BeatCard & { secCount: number } {
  const secCount = countLeafSections(partNode);
  const titleText = cleanInlineLabel(partNode.d || '');
  const idStr = String(partNode.id || '');
  return {
    part: idStr,
    kicker: kickerOverride || findChapterLabel(partNode),
    title: `Part ${idStr}${titleText ? ' — ' + titleText : ''}`,
    desc: describePartNode(partNode, secCount),
    secCount,
  };
}

function collectDynamicCards(limit = 6): BeatCard[] {
  if (!treeIdx.partList || !treeIdx.partList.length) return [];
  const scored: Array<BeatCard & { secCount: number }> = [];
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

function collectAgencyParts(agencyNode: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode | null | undefined) => {
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
    .filter(x => x.node && (x.node.n || 0) > 0);
}

function cardsForBeat(titleNum: number, beat: string): BeatCard[] {
  if (beat && beat !== 'front') {
    const k = treeIdx.agencies.get(beat);
    const agNode = k != null ? treeIdx.nodes[k] : null;
    if (agNode) {
      const info = agencyInfo(agNode);
      const curatedByPart = new Map(((HOME_CONTENT[titleNum] || { cards: [] }).cards || []).map(c => [c.part, c]));
      const parts = collectAgencyParts(agNode)
        .map(p => ({ node: p, secCount: countLeafSections(p) }))
        .filter(x => x.secCount > 0)
        .sort((a, b) => b.secCount - a.secCount)
        .slice(0, 7);
      return parts.map(({ node }) => {
        const curated = curatedByPart.get(String(node.id || ''));
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

function leadInsideLinksHtml(titleNum: number, partId: string, partNode: TreeNode | null | undefined): string {
  if (!partNode) return '';
  const subparts = listSubparts(partNode);
  const items: Array<{ href: string; code: string; text: string }> = [];
  if (subparts.length) {
    for (const sp of subparts.slice(0, 4)) {
      const target = firstLeafSection(sp);
      if (!target) continue;
      const spLabel = cleanInlineLabel(sp.l || `Subpart ${sp.id}`);
      const spName = cleanInlineLabel(sp.d || '');
      items.push({
        href: titleHref(titleNum, `section/${encodeURIComponent(String(target.id || ''))}`),
        code: spLabel,
        text: spName && spName !== spLabel ? spName : cleanInlineLabel(target.d || target.l || ''),
      });
    }
  } else {
    for (const sec of listDirectLeaves(partNode).slice(0, 4)) {
      items.push({
        href: titleHref(titleNum, `section/${encodeURIComponent(String(sec.id || ''))}`),
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

function mainBroadsheetHtml(titleNum: number, beat: string): string {
  const cards = cardsForBeat(titleNum, beat);
  const beatKey = beat !== 'front' ? treeIdx.agencies.get(beat) : undefined;
  const beatInfo = beatKey !== undefined ? agencyInfo(treeIdx.nodes[beatKey]) : null;
  const beatK = beatKey ?? null;

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
      <article class="ts-lead has-tier-bar" data-ref-tier="cfr">
        <div class="ts-lead-top">
          <span class="ts-lead-kicker"><span class="ref-badge">LEAD BEAT</span> · ${escapeHtml(lead.kicker)} · Part ${escapeHtml(lead.part)}</span>
          ${leadSecCount ? `<span class="ts-lead-stat">${fmt(leadSecCount)} ${leadSecCount === 1 ? 'section' : 'sections'}${subCount ? ` · ${plural(subCount, 'subpart')}` : ''}</span>` : ''}
        </div>
        <h2 class="ts-lead-title"><a href="${leadHref}">${escapeHtml(lead.title)}</a></h2>
        <p class="ts-lead-dek">${escapeHtml(lead.desc)}</p>
        ${leadInsideLinksHtml(titleNum, lead.part, leadNode)}
        <div class="ts-lead-foot">
          <a class="btn btn-sm btn-accent" href="${leadHref}">Open Part ${escapeHtml(lead.part)} ${icon('chevronRight')}</a>
          <a class="hm-inline-link" href="${leadFullHref}">See full part</a>
        </div>
      </article>
      ${briefsHtml}
    </div>`;
}

function titleDeskRailHtml(titleNum: number): string {
  const usage = loadUsage();
  const entries = Object.entries(usage.s || {})
    .map(([key, e]) => {
      const pipe = key.indexOf('|');
      if (pipe < 0 || !e) return null;
      return { title: Number(key.slice(0, pipe)), id: key.slice(pipe + 1), ...e };
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e && e.title === titleNum && e.id))
    .sort((a, b) => (b.t || 0) - (a.t || 0));

  let resumeHtml: string;
  if (entries.length) {
    const last = entries[0];
    const href = titleHref(titleNum, 'section/' + encodeURIComponent(last.id) + (last.u ? '/' + encodeURIComponent(last.u) : ''));
    const trail = entries.slice(1, 3);
    resumeHtml = `
      <div class="ts-rail-block title-resume">
        <div class="ts-rail-head">
          <span class="hm-kicker">Continue in Title ${titleNum}</span>
          <span class="hm-time">${escapeHtml(timeAgo(last.t || 0))}</span>
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
                <span class="hm-row-val">${escapeHtml(timeAgo(e.t || 0))}</span>
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
                  ${pins.map(s => `<a class="citation-chip" data-ref-tier="cfr" href="${titleHref(titleNum, 'section/' + encodeURIComponent(s.id))}">${escapeHtml(s.label || '§ ' + s.id)}</a>`).join('')}
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
      ${skeletonHtml('lines')}
    </div>`;

  return `
    <aside class="ts-rail" data-ref-tier="cfr" aria-label="Title desk and regulatory index">
      ${resumeHtml}
      ${wsHtml}
      ${wireSlotHtml}
      ${citedSlotHtml}
    </aside>`;
}

function renderTitleWireHtml(articles: WireArticle[]): string {
  if (!articles || !articles.length) return '';
  return `
    <div class="ts-rail-head">
      <span class="hm-kicker">Federal Register wire</span>
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

function renderMostCitedHtml(data: TitleRefsExtended, titleNum: number): string {
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

function beatsRibbonHtml(): string {
  const beats = agencyBeatsList();
  if (beats.length < 2) return '';
  const top = [...beats].sort((a, b) => (b.node.n || 0) - (a.node.n || 0)).slice(0, 6);
  const pill = (key: string, label: string) => {
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

function departmentsDirectoryHtml(): string {
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

function authorityStackHtml(titleNum: number): string {
  const stack = jurisdictionStackForTitle(titleNum);
  return `<div class="ts-auth-stack" aria-label="Legal authority hierarchy">
    ${stack.nodes.map((node, idx) => {
      const meta = tierMetaFor(node.tier);
      const inner = `
        <span class="tier-pip" aria-hidden="true"></span>
        <span class="ts-auth-code">${escapeHtml(node.code)}</span>
        <span class="ts-auth-meta">${escapeHtml(node.current ? 'Current' : (node.meta || meta.short))}</span>`;
      const item = node.external && node.href
        ? `<a class="ts-auth-node${node.current ? ' is-current' : ''}" data-ref-tier="${escapeHtml(node.ref_tier)}" href="${escapeHtml(node.href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(node.label)}">${inner}</a>`
        : node.href
          ? `<a class="ts-auth-node${node.current ? ' is-current' : ''}" data-ref-tier="${escapeHtml(node.ref_tier)}" href="${escapeHtml(node.href)}" title="${escapeHtml(node.label)}">${inner}</a>`
          : `<span class="ts-auth-node${node.current ? ' is-current' : ''}" data-ref-tier="${escapeHtml(node.ref_tier)}" title="${escapeHtml(node.label)}">${inner}</span>`;
      return `${idx > 0 ? '<span class="ts-auth-arrow" aria-hidden="true">›</span>' : ''}${item}`;
    }).join('')}
  </div>`;
}

function renderMastheadStatusHtml(titleNum: number): string {
  const libRow = (state.navLibData && state.navLibData.titles || []).find(x => x.title === titleNum);
  if (libRow && isStale(libRow)) return statPill('stale', 'Update available', { bare: true });
  if (state.metaInfo.partial) return statPill('partial', 'Partial install', { bare: true });
  return statPill('synced', 'Installed', { bare: true });
}

function hydrateTitleWire(titleNum: number, seq: number, signal?: AbortSignal): void {
  if (titleNum !== 29) return;
  const applyWire = (articles: WireArticle[]) => {
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
  fetchNewsPreview(3, { signal })
    .then(data => {
      if (!data || seq !== state.routeSeq) return;
      const articles = (data.articles || []) as WireArticle[];
      titleNewsCache.set(29, { at: Date.now(), articles });
      applyWire(articles);
    })
    .catch(() => {});
}

export async function renderHome(): Promise<void> {
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
          <div class="doc-kicker" data-ref-tier="cfr">
            <span class="ref-badge">FEDERAL CFR</span><span class="sep" aria-hidden="true">·</span><a href="#/">Home</a><span class="sep" aria-hidden="true">›</span><span>${titleNum} CFR${snapRow?.desk ? ` · ${escapeHtml(snapRow.desk)}` : ''}</span>
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
        ${authorityStackHtml(titleNum)}
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
    } catch { /* keep graceful starter layout */ }
  }

  if (!snapRow) {
    fetchTitlesSnapshot({ signal }).then(snap => {
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

  let refData: TitleRefsExtended | null = null;
  try {
    refData = (await fetchTitleReferences(titleNum, { signal })) as TitleRefsExtended;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
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

onView('input', (e) => {
  const inp = e.target as HTMLInputElement | null;
  if (!inp || inp.id !== 'ref-filter' || !dom.view.querySelector('.ref-hub')) return;
  refUi.q = inp.value;
  refUi.expanded = false;
  const data = state.refsCache.get(state.currentTitle) as AlmanacReferencesResponse | undefined;
  if (data) updateRefHubDom(data, state.currentTitle);
});

onView('click', (e) => {
  if (!dom.view.querySelector('.ts-front')) return;
  const t = e.target as Element | null;
  if (!t) return;

  if (t.closest('#home-open-contents')) {
    openPanel('reader', { focus: true });
    return;
  }

  const beatEl = t.closest<HTMLElement>('[data-ts-beat]');
  if (beatEl) {
    refUi.beat = beatEl.dataset.tsBeat || 'front';
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

  const agencyBtn = t.closest<HTMLElement>('[data-ts-open-agency]');
  if (agencyBtn) {
    const k = Number(agencyBtn.dataset.tsOpenAgency);
    if (!Number.isNaN(k)) showAgencyView(k);
    openPanel('reader', { focus: true });
    return;
  }

  const jumpBtn = t.closest<HTMLElement>('[data-ts-scroll]');
  if (jumpBtn && jumpBtn.dataset.tsScroll) {
    const target = document.getElementById(jumpBtn.dataset.tsScroll);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (!dom.view.querySelector('.ref-hub')) return;
  const catBtn = t.closest<HTMLElement>('[data-ref-cat]');
  if (catBtn && catBtn.dataset.refCat) {
    refUi.cat = catBtn.dataset.refCat;
    refUi.expanded = false;
    const data = state.refsCache.get(state.currentTitle) as AlmanacReferencesResponse | undefined;
    if (data) updateRefHubDom(data, state.currentTitle);
    return;
  }
  if (t.closest('#ref-show-all')) {
    refUi.expanded = true;
    const data = state.refsCache.get(state.currentTitle) as AlmanacReferencesResponse | undefined;
    if (data) updateRefHubDom(data, state.currentTitle);
  }
});
