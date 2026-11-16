import { state } from '../state';
import { updateChatContext } from '../components/chat';
import { clearTreeSelection } from '../components/sidebar';
import { setViewHead } from '../components/view_head';
import { enterView, escapeHtml, isMac } from '../dom';
import { dom } from '../state_init';

// --- Views ---

// Curated starting points per installed title. Titles without an entry get the generic hero.
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


export function renderHome() {
  state.currentSection = null;
  state.currentPart = null;
  clearTreeSelection();
  updateChatContext();
  document.title = `Title ${state.currentTitle} · FRAMEWORK`;
  setViewHead('');

  const name = state.metaInfo.name || '';
  const content = HOME_CONTENT[state.currentTitle];
  const tagline = content ? content.tagline
    : `Read, search, and ask questions about Title ${state.currentTitle} of the Code of Federal Regulations.`;
  const count = Number(state.metaInfo.section_count || 0);
  const metaLine = [
    count ? `${count.toLocaleString()} sections` : '',
    state.metaInfo.edition ? `current as of ${state.metaInfo.edition}` : '',
  ].filter(Boolean).join(' · ');

  const cardsHtml = content ? `
    <div class="card-grid">
      ${content.cards.map(c => `
        <a class="card" href="#/part/${encodeURIComponent(c.part)}">
          <span class="card-kicker">${escapeHtml(c.kicker)}</span>
          <div class="card-title">${escapeHtml(c.title)}</div>
          <div class="card-desc">${escapeHtml(c.desc)}</div>
        </a>
      `).join('')}
    </div>
  ` : '';

  dom.view.innerHTML = `
    <div class="home-hero">
      <h1>Title ${state.currentTitle}${name ? ' — ' + escapeHtml(name) : ''}</h1>
      <p>${escapeHtml(tagline)}</p>
      ${metaLine ? `<p class="home-meta">${escapeHtml(metaLine)}</p>` : ''}
    </div>

    ${cardsHtml}

    <div class="home">
      <h2>Getting around</h2>
      <ul class="tips">
        <li><span class="tip-keys"><kbd>/</kbd></span><span>Search the full text, or jump straight to a section number</span></li>
        <li><span class="tip-keys"><kbd>${isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span><span>Open Ask Claude</span></li>
        <li><span class="tip-keys"><kbd>↑</kbd><kbd>↓</kbd></span><span>Move through the contents list or search suggestions</span></li>
        <li><span class="tip-keys"><kbd>Esc</kbd></span><span>Clear the contents filter or close suggestions</span></li>
      </ul>
    </div>
  `;
  enterView();
}
