import { state } from '../state';
import { getJSON } from '../api/client';
import { AccidentInjury, accidentInjuryLine, fmtMoney, linkifyNewsText, newsSectionHref, titleInstalled } from '../core/news_format';
import { clipCaseToWorkspace } from '../core/projects_store';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection, plural } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { SEP, fmtDate, joinSep, metricCardHtml, statPill } from '../components/ui';
import { enterView, escapeHtml, icon, safeHttpUrl, skeletonHtml } from '../dom';
import { dom } from '../state_init';
import { fmt, timeAgo, titleHref } from '../usage';

export interface InspectionViolation {
  citation_id?: string;
  section_id?: string | null;
  para?: string | null;
  standard_display?: string;
  raw_standard?: string;
  is_general_duty?: boolean;
  is_state_plan?: boolean;
  viol_type?: string;
  viol_label?: string;
  gravity?: string;
  emphasis?: string;
  hazcat?: string;
  fta_insp_nr?: number | null;
  fta_issuance_date?: string | null;
  fta_penalty?: number;
  hazsubs?: string[];
  initial_penalty?: number;
  current_penalty?: number;
  nr_instances?: number;
  nr_exposed?: number;
  contest_date?: string;
  final_order_date?: string;
  abate_complete?: string;
  abate_date?: string;
}

export interface RelatedInspection {
  rel_act_nr: number;
  rel_type?: string;
  rel_label?: string;
  direction?: string;
  safety?: boolean;
  health?: boolean;
  cached?: boolean;
  estab_name?: string | null;
  site_state?: string | null;
  penalty_usd?: number | null;
  open_date?: string | null;
}

export interface InspectionCaseData {
  activity_nr: number;
  dol_configured?: boolean;
  enriched_at?: string;
  enrich_ver?: number;
  needs_enrichment?: boolean;
  article?: {
    company?: string;
    doc_type?: string;
    city?: string;
    state?: string;
    naics?: string;
    penalty_usd?: number;
    violation_types?: string[];
    link?: string;
    opened_on?: string;
    published_at?: string;
    sections?: string[];
    takeaways?: Array<{ label: string; text: string }>;
  };
  detail?: {
    estab_name?: string;
    insp_type_label?: string;
    site_address?: string;
    site_city?: string;
    site_state?: string;
    site_zip?: string;
    naics_code?: string;
    sic_code?: string;
    current_penalty_usd?: number;
    initial_penalty_usd?: number;
    reduction_usd?: number;
    reduction_pct?: number;
    contested_count?: number;
    fta_count?: number;
    fta_total_usd?: number;
    open_abate_count?: number;
    overdue_abate_count?: number;
    citation_count?: number;
    open_date?: string;
    case_mod_date?: string;
    close_case_date?: string;
    safety_hlth_label?: string;
    insp_scope_label?: string;
    owner_type_label?: string;
    union_status_label?: string;
    adv_notice?: string;
    nr_in_estab?: number;
    reporting_id?: string;
    max_exposed?: number;
    total_instances?: number;
  };
  violations?: InspectionViolation[];
  gdc?: Array<{ citation_id?: string; text: string }>;
  accidents?: Array<{ event_date?: string; fatality?: boolean; event_desc?: string; abstract?: string; keywords?: string; injuries?: AccidentInjury[] }>;
  events?: Array<{ date?: string; event_label?: string; citation_id?: string; penalty?: number | null }>;
  related?: RelatedInspection[];
}

const autoEnrichedCases = new Set<number>();
let lastCaseData: InspectionCaseData | null = null;

export function clipCurrentInspection(): void {
  if (!lastCaseData) return;
  const d = lastCaseData.detail || {};
  const art = lastCaseData.article || {};
  const loc = [d.site_city || art.city, d.site_state || art.state].filter(Boolean).join(', ');
  const secs = [...new Set((lastCaseData.violations || []).map(v => v.section_id).filter((s): s is string => Boolean(s)))];
  clipCaseToWorkspace({
    activity_nr: lastCaseData.activity_nr,
    estab_name: d.estab_name || art.company || `Inspection #${lastCaseData.activity_nr}`,
    location: loc || undefined,
    penalty_usd: d.current_penalty_usd ?? art.penalty_usd ?? undefined,
    open_date: d.open_date || art.opened_on || undefined,
    sections: secs.length ? secs : (art.sections || []),
  });
}

function citationStatusText(v: InspectionViolation): string {
  const bits: string[] = [];
  if (v.contest_date) bits.push(`Contested ${fmtDate(v.contest_date)}`);
  if (v.final_order_date) bits.push(`Final ${fmtDate(v.final_order_date)}`);
  if (v.abate_complete === 'X' || v.abate_complete === '3') bits.push('Abated');
  else if (v.abate_date) bits.push(`Abate due ${fmtDate(v.abate_date)}`);
  return bits.join(' · ') || 'Issued';
}

function violationStandardHtml(v: InspectionViolation): string {
  if (v.section_id) {
    const dim = !titleInstalled(29);
    const href = dim
      ? '#/library/29'
      : titleHref(29, 'section/' + encodeURIComponent(v.section_id) + (v.para ? '?p=' + encodeURIComponent(v.para) : ''));
    return `<a class="citation-link ins-std-link${dim ? ' is-dim' : ''}" href="${href}">${escapeHtml(v.standard_display)}</a>`;
  }
  if (v.is_general_duty) {
    return `<span class="ins-std-gdc">${escapeHtml(v.standard_display)}</span>`;
  }
  return `<span class="ins-std-state">${escapeHtml(v.standard_display || v.raw_standard || 'Unlisted')}</span>`
    + (v.is_state_plan ? '<span class="ins-tag">State plan</span>' : '');
}

function inspectionViolationsHtml(data: InspectionCaseData): string {
  const viols = data.violations || [];
  if (!viols.length) {
    if (data.dol_configured) {
      return `
        <div class="ins-panel-empty">
          <p class="ins-muted">Individual citation rows have not been cached locally for this inspection yet.</p>
          <button type="button" class="btn btn-sm btn-accent" data-ins-act="enrich" data-act-nr="${data.activity_nr}">${icon('activity')} Load citations from DOL</button>
        </div>`;
    }
    return '<div class="ins-panel-empty"><p class="ins-muted">Add a free DOL API key in Settings to load per-citation details on demand.</p></div>';
  }

  const eventsByCit = new Map<string, Array<{ date?: string; event_label?: string; penalty?: number | null }>>();
  for (const ev of data.events || []) {
    if (!ev.citation_id) continue;
    const arr = eventsByCit.get(ev.citation_id) || [];
    arr.push(ev);
    eventsByCit.set(ev.citation_id, arr);
  }
  const todayIso = new Date().toISOString().slice(0, 10);

  return `
    <div class="ins-table-wrap">
      <table class="ins-table">
        <thead>
          <tr>
            <th>Cit.</th>
            <th>Standard</th>
            <th>Type</th>
            <th>Exposed</th>
            <th>Status</th>
            <th class="is-num">Penalty</th>
          </tr>
        </thead>
        <tbody>
          ${viols.map(v => {
            const tagHtml: string[] = [];
            const pushTag = (txt: string, cls = '') =>
              tagHtml.push(`<span class="ins-tag${cls ? ' ' + cls : ''}">${escapeHtml(txt)}</span>`);
            if (v.gravity) pushTag(`Grav ${v.gravity}`);
            if (v.emphasis) pushTag(`NEP ${v.emphasis}`);
            if (v.hazcat) pushTag(v.hazcat);
            if (v.contest_date) pushTag('Contested', 'is-warn');
            const abDone = v.abate_complete === 'X' || v.abate_complete === '3' || v.abate_complete === 'Y';
            if (v.abate_date && !abDone) {
              pushTag(v.abate_date < todayIso ? 'Abatement overdue' : 'Abatement open', v.abate_date < todayIso ? 'is-danger' : 'is-warn');
            }
            if (v.fta_penalty || v.fta_insp_nr) {
              const ftaTxt = v.fta_penalty ? `FTA +${fmtMoney(v.fta_penalty)}` : 'FTA';
              if (v.fta_insp_nr) {
                tagHtml.push(`<a class="ins-tag is-danger ins-tag-link" href="#/news/inspection/${v.fta_insp_nr}">${escapeHtml(ftaTxt)}</a>`);
              } else {
                pushTag(ftaTxt, 'is-danger');
              }
            }
            if ((v.hazsubs || []).length) pushTag(`HazSub ${v.hazsubs!.join(', ')}`);
            const citEvents = (v.citation_id && eventsByCit.get(v.citation_id)) || [];
            const modEv = [...citEvents].reverse().find(e => e.event_label && e.event_label !== 'Issued');
            const penChanged = v.initial_penalty != null && v.current_penalty != null && v.initial_penalty !== v.current_penalty;
            const deltaUsd = penChanged ? v.current_penalty! - v.initial_penalty! : 0;
            const expBits = [
              v.nr_instances ? plural(v.nr_instances, 'inst') : '',
              v.nr_exposed ? `${v.nr_exposed} exp` : '',
            ].filter(Boolean).join(' · ');
            return `
              <tr>
                <td class="ins-cit-id">${escapeHtml(v.citation_id || '—')}</td>
                <td>
                  <div class="ins-std-cell">
                    ${violationStandardHtml(v)}
                    ${tagHtml.length ? `<div class="ins-tags">${tagHtml.join('')}</div>` : ''}
                    ${modEv ? `<div class="ins-ev-inline">${escapeHtml(modEv.event_label)}${penChanged ? ` (${deltaUsd > 0 ? '+' : '-'}${escapeHtml(fmtMoney(Math.abs(deltaUsd)))})` : ''}</div>` : ''}
                  </div>
                </td>
                <td><span class="ins-viol-pill is-${escapeHtml((v.viol_type || 'O').toLowerCase())}">${escapeHtml(v.viol_label || v.viol_type)}</span></td>
                <td class="ins-mono-col">${escapeHtml(expBits || '—')}</td>
                <td class="ins-status-col">${escapeHtml(citationStatusText(v))}</td>
                <td class="is-num">
                  <div class="ins-pen-cur">${v.current_penalty ? escapeHtml(fmtMoney(v.current_penalty)) : '$0'}</div>
                  ${penChanged ? `<div class="ins-pen-init">Initial ${escapeHtml(fmtMoney(v.initial_penalty!))}</div>` : ''}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function inspectionSectionsHtml(data: InspectionCaseData): string {
  const art = data.article || {};
  const secs = art.sections || [];
  if (!secs.length) return '';
  return `
    <div class="ins-cfr-chips">
      ${secs.map(s => {
        const dim = !titleInstalled(29);
        return `<a class="citation-chip${dim ? ' is-dim' : ''}" href="${newsSectionHref(29, s)}">§ ${escapeHtml(s)}</a>`;
      }).join('')}
    </div>`;
}

function inspectionRelatedHtml(data: InspectionCaseData): string {
  const related = data.related || [];
  if (!related.length) return '';
  return `
    <section class="ins-panel" aria-label="Related OSHA inspections">
      <div class="ins-panel-head">
        <h2 class="ins-panel-title">Related Inspections</h2>
        <span class="ins-panel-meta">${escapeHtml(plural(related.length, 'linked inspection'))}</span>
      </div>
      <div class="ins-related-list">
        ${related.map(r => {
          const scopes = [r.safety ? 'Safety' : '', r.health ? 'Health' : ''].filter(Boolean);
          const metaBits = [
            r.rel_label || r.rel_type || 'Related',
            ...scopes,
            r.cached && r.estab_name ? r.estab_name : '',
            r.cached && r.site_state ? r.site_state : '',
            r.cached && r.penalty_usd ? fmtMoney(r.penalty_usd) : '',
          ].filter(Boolean);
          return `
            <a class="ins-related-row" href="#/news/inspection/${r.rel_act_nr}">
              <div class="ins-related-main">
                <span class="ins-related-nr">Inspection #${r.rel_act_nr}</span>
                <span class="ins-related-meta">${escapeHtml(metaBits.join(' · '))}</span>
              </div>
              <span class="ins-related-arrow">${icon('chevronRight')}</span>
            </a>`;
        }).join('')}
      </div>
    </section>`;
}

export function renderInspectionCase(
  data: InspectionCaseData,
  { enter = true, enriching = false, enrichError = '' }: { enter?: boolean; enriching?: boolean; enrichError?: string } = {},
): void {
  lastCaseData = data;
  const actNr = data.activity_nr;
  const art = data.article || {};
  const d = data.detail || {};
  const company = d.estab_name || art.company || `Inspection #${actNr}`;
  const docType = d.insp_type_label || art.doc_type || 'OSHA inspection';
  const addrParts = [d.site_address, [d.site_city || art.city, d.site_state || art.state].filter(Boolean).join(', '), d.site_zip].filter(Boolean);
  const naicsCode = d.naics_code || art.naics;
  const subLine = joinSep([
    escapeHtml(docType),
    addrParts.length ? escapeHtml(addrParts.join(' · ')) : '',
    naicsCode ? `<a class="citation-link" href="#/news?cat=enforcement&naics=${encodeURIComponent(naicsCode)}">NAICS ${escapeHtml(naicsCode)}</a>` : '',
  ]);
  const curPen = d.current_penalty_usd ?? art.penalty_usd ?? 0;
  const initPen = d.initial_penalty_usd ?? curPen;
  const deltaUsd = curPen - initPen;
  const deltaPct = initPen > 0 && curPen !== initPen ? Math.round(deltaUsd / initPen * 100) : 0;
  const penSub = deltaPct
    ? `Initial ${fmtMoney(initPen)} · ${deltaUsd < 0 ? '-' : '+'}${fmtMoney(Math.abs(deltaUsd))} (${deltaPct > 0 ? '+' : ''}${deltaPct}%)`
    : initPen ? `Initial ${fmtMoney(initPen)}` : 'No penalty assessed';
  const violCount = (data.violations || []).length || d.citation_count || 0;
  const vCounts = (data.violations || []).reduce<Record<string, number>>((m, v) => {
    const k = v.viol_label || v.viol_type;
    if (k) m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const violSummary = Object.entries(vCounts).map(([k, n]) => `${n} ${k}`).join(', ')
    || (art.violation_types || []).join(', ') || 'Recorded in summary';

  const oshaUrl = safeHttpUrl(art.link || `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${actNr}`);
  const openDt = d.open_date || art.opened_on;
  const modDt = d.case_mod_date;
  const closeDt = d.close_case_date;

  const metaFacts: Array<[string, string | null | undefined]> = [
    ['Activity #', String(actNr)],
    ['Safety / Health', d.safety_hlth_label],
    ['Inspection scope', d.insp_scope_label],
    ['Ownership', d.owner_type_label],
    ['Union status', d.union_status_label],
    ['Advance notice', d.adv_notice === 'Y' ? 'Yes' : d.adv_notice === 'N' ? 'No' : null],
    ['Employees at site', d.nr_in_estab != null ? fmt(d.nr_in_estab) : null],
    ['SIC / NAICS', [d.sic_code && `SIC ${d.sic_code}`, (d.naics_code || art.naics) && `NAICS ${d.naics_code || art.naics}`].filter(Boolean).join(' · ') || null],
    ['Reporting ID', d.reporting_id],
  ];
  const presentFacts = metaFacts.filter((entry): entry is [string, string] => Boolean(entry[1]));

  const gdcList = data.gdc || [];
  const accidents = data.accidents || [];
  const events = data.events || [];
  const takeaways = art.takeaways || [];

  const statusPill = enriching
    ? statPill('busy', 'Loading DOL case details…')
    : enrichError
      ? statPill('stale', enrichError)
      : data.enriched_at
        ? statPill('synced', `DOL synced ${timeAgo(Date.parse(data.enriched_at))}`)
        : '';

  document.title = `${company} · Inspection #${actNr} · FRAMEWORK`;
  dom.view.innerHTML = `
    <div class="news-front ins-front">
      <div class="ins-top-nav">
        <a class="hm-inline-link" href="#/news?cat=enforcement">${icon('chevronLeft')} Back to Enforcement</a>
        <div class="ins-top-status" id="ins-status-slot">${statusPill}</div>
      </div>

      <header class="ins-head">
        <div class="ins-head-copy">
          <div class="doc-kicker">OSHA Enforcement Case File${SEP}Inspection #${actNr}</div>
          <h1 class="doc-title">${escapeHtml(company)}</h1>
          ${subLine ? `<p class="ins-sub">${subLine}</p>` : ''}
        </div>
        <div class="ins-head-acts">
          <button type="button" class="btn btn-sm" data-ins-act="clip">${icon('bookmark')} Clip to Workspace</button>
          ${data.dol_configured ? `<button type="button" class="btn btn-sm" data-ins-act="enrich" data-act-nr="${actNr}"${enriching ? ' disabled' : ''}>${icon('activity')} Refresh from DOL</button>` : ''}
          ${oshaUrl ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="${escapeHtml(oshaUrl)}" title="Opens OSHA.gov (may prompt human verification)">${icon('external')} OSHA.gov</a>` : ''}
        </div>
      </header>

      <section class="ins-metrics" aria-label="Inspection summary">
        ${metricCardHtml({
          label: 'Current penalty',
          value: curPen ? escapeHtml(fmtMoney(curPen)) : '$0',
          sub: escapeHtml([penSub, d.fta_total_usd ? `FTA ${fmtMoney(d.fta_total_usd)}` : ''].filter(Boolean).join(' · ')),
        })}
        ${metricCardHtml({
          label: 'Citations',
          value: violCount ? escapeHtml(plural(violCount, 'citation')) : 'Summary only',
          sub: escapeHtml(violSummary),
        })}
        ${metricCardHtml({
          label: 'Case dates',
          value: art.published_at ? escapeHtml(fmtDate(art.published_at)) : '—',
          sub: escapeHtml([openDt && `Opened ${fmtDate(openDt)}`, closeDt ? `Closed ${fmtDate(closeDt)}` : modDt ? `Modified ${fmtDate(modDt)}` : 'Open'].filter(Boolean).join(' · ')),
        })}
        ${metricCardHtml({
          label: 'Exposure',
          value: d.max_exposed ? escapeHtml(`${fmt(d.max_exposed)} exposed`) : (d.nr_in_estab ? escapeHtml(`${fmt(d.nr_in_estab)} at site`) : '—'),
          sub: escapeHtml([d.total_instances ? plural(d.total_instances, 'instance') : '', d.nr_in_estab && d.max_exposed ? `${fmt(d.nr_in_estab)} at site` : ''].filter(Boolean).join(' · ') || 'Site exposure data'),
        })}
      </section>

      ${takeaways.length && !(data.violations || []).length ? `
        <section class="ins-panel" aria-label="Cached summary">
          <h2 class="ins-panel-title">Cached Summary</h2>
          <dl class="news-takeaways">${takeaways.map(t => `<dt>${escapeHtml(t.label)}</dt><dd>${linkifyNewsText(t.text)}</dd>`).join('')}</dl>
          ${inspectionSectionsHtml(data)}
        </section>` : ''}

      <section class="ins-panel" aria-label="Citations and violated standards">
        <div class="ins-panel-head">
          <h2 class="ins-panel-title">Citations &amp; Violated Standards</h2>
          <span class="ins-panel-meta">${violCount ? escapeHtml(plural(violCount, 'item')) : 'On-demand DOL lookup'}</span>
        </div>
        ${inspectionViolationsHtml(data)}
      </section>

      ${gdcList.length ? `
        <section class="ins-panel" aria-label="General Duty Clause narrative">
          <div class="ins-panel-head">
            <h2 class="ins-panel-title">General Duty Clause — Section 5(a)(1)</h2>
            <span class="ins-panel-meta">${escapeHtml(plural(gdcList.length, 'narrative'))}</span>
          </div>
          ${gdcList.map(g => `
            <div class="ins-narrative">
              <div class="ins-narrative-kicker">Citation ${escapeHtml(g.citation_id)}</div>
              <p>${escapeHtml(g.text)}</p>
            </div>`).join('')}
        </section>` : ''}

      ${inspectionRelatedHtml(data)}

      ${accidents.length ? `
        <section class="ins-panel" aria-label="Accident investigation abstract">
          <div class="ins-panel-head">
            <h2 class="ins-panel-title">Accident / Fatality Investigation</h2>
            <span class="ins-panel-meta">${escapeHtml(plural(accidents.length, 'summary'))}</span>
          </div>
          ${accidents.map(ac => `
            <div class="ins-narrative">
              <div class="ins-narrative-kicker">${escapeHtml([ac.event_date && fmtDate(ac.event_date), ac.fatality ? 'Fatality' : '', ac.event_desc].filter(Boolean).join(' · '))}</div>
              ${ac.abstract ? `<p>${escapeHtml(ac.abstract)}</p>` : ''}
              ${ac.injuries?.length ? `<ul class="ins-injuries" aria-label="People injured">${ac.injuries.map(inj => `<li>${escapeHtml(accidentInjuryLine(inj))}</li>`).join('')}</ul>` : ''}
              ${ac.keywords ? `<div class="ins-keywords">${escapeHtml(ac.keywords)}</div>` : ''}
            </div>`).join('')}
        </section>` : ''}

      ${presentFacts.length || events.length ? `
        <div class="ins-split">
          ${presentFacts.length ? `
            <section class="ins-panel" aria-label="Establishment details">
              <h2 class="ins-panel-title">Establishment &amp; Case File</h2>
              <dl class="ins-meta-list">
                ${presentFacts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}
              </dl>
            </section>` : ''}
          ${events.length ? `
            <section class="ins-panel" aria-label="Penalty and contest history">
              <h2 class="ins-panel-title">Citation Revision Timeline</h2>
              <ol class="ins-events">
                ${events.map(ev => `
                  <li>
                    <span class="ins-ev-date">${escapeHtml(ev.date ? fmtDate(ev.date) : '—')}</span>
                    <span class="ins-ev-body">
                      <strong>${escapeHtml(ev.event_label)}</strong> · Cit. ${escapeHtml(ev.citation_id)}
                      ${ev.penalty != null ? ` · ${escapeHtml(fmtMoney(ev.penalty))}` : ''}
                    </span>
                  </li>`).join('')}
              </ol>
            </section>` : ''}
        </div>` : ''}
    </div>`;

  if (enter) enterView();
}

export async function enrichInspection(activityNr: number, seq: number, force = false): Promise<void> {
  try {
    const url = `/api/news/inspection/${activityNr}/enrich${force ? '?force=true' : ''}`;
    const res = await getJSON<InspectionCaseData>(url, { method: 'POST' });
    if (seq !== state.routeSeq) return;
    renderInspectionCase(res, { enter: false });
  } catch (err) {
    if (seq !== state.routeSeq) return;
    const slot = document.getElementById('ins-status-slot');
    if (slot) slot.innerHTML = statPill('stale', (err instanceof Error ? err.message : '') || 'Could not enrich from DOL');
    const btn = dom.view.querySelector<HTMLButtonElement>('[data-ins-act="enrich"]');
    if (btn) btn.disabled = false;
  }
}

export async function loadInspection(activityNr: number): Promise<void> {
  const seq = state.routeSeq;
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  setViewHead('');
  document.title = `Inspection #${activityNr} · FRAMEWORK`;
  dom.view.innerHTML = skeletonHtml('cards', `Loading inspection #${activityNr}…`);
  enterView();

  let data: InspectionCaseData;
  try {
    data = await getJSON<InspectionCaseData>(`/api/news/inspection/${activityNr}`);
  } catch (err) {
    if (seq !== state.routeSeq) return;
    dom.view.innerHTML = `
      <div class="news-front ins-front">
        <div class="ins-top-nav"><a class="hm-inline-link" href="#/news?cat=enforcement">${icon('chevronLeft')} Back to Enforcement</a></div>
        <div class="empty-state">
          <h2>Inspection #${activityNr} not found</h2>
          <p>${escapeHtml(err instanceof Error ? err.message : 'Not found')}</p>
        </div>
      </div>`;
    return;
  }
  if (seq !== state.routeSeq) return;

  const auto = Boolean(data.needs_enrichment && data.dol_configured && !autoEnrichedCases.has(activityNr));
  renderInspectionCase(data, { enter: false, enriching: auto });
  if (auto) {
    autoEnrichedCases.add(activityNr);
    await enrichInspection(activityNr, seq);
  }
}
