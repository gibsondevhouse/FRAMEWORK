// Curated starter card sets for primary CFR titles (used by Home, Title Start, and Library).

export interface HomeStarterCard {
  part: string;
  kicker: string;
  title: string;
  desc: string;
}

export interface HomeTitleContent {
  tagline: string;
  cards: HomeStarterCard[];
}

export const HOME_CONTENT: Record<number, HomeTitleContent> = {
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
