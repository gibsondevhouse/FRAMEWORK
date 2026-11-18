# Plan 24: Commercial Dark Newsroom ("Yakuza Editorial") & Multi-Jurisdiction UI Architecture

**Status:** Completed (macOS baselines recorded; Windows `win32` CI baseline dispatch pending merge)  
**Created:** 2026-11-17  
**Implemented:** 2026-11-17  

---

## 1. Summary of Implemented Scope

- **Dark-Mode-Only "Yakuza Editorial" Surface Ramp:** Removed `[data-theme="light"]`, `#theme-toggle`, `setTheme()`, and `LightDesktopScreens`, locking `:root` to obsidian surfaces (`--bg: #070708`, `--panel: #0B0B0D`, `--card: #111114`, `--pop: #151519`), calibrated dark-room figure matting (`--fig-mat: #D4D4D8`), and surgical `--editorial-crimson` (`#E11D48`) / `--editorial-gold` (`#EAB308`) editorial punctuation while preserving white-paper `@media print` output.
- **9-Tier Semantic Reference Chromatics & Reference Ledger:** Assigned calibrated hue + underline + hover wash tokens (`--ref-local`, `--ref-cfr`, `--ref-cross`, `--ref-uninstalled`, `--ref-usc`, `--ref-fr`, `--ref-ibr`, `--ref-state`, `--ref-county`) across inline `.xref*` links, `.citation-chip[data-ref-tier]`, `#cite-pop[data-ref-tier]` 2px colored top accent headers + authority stamps, `.split-head[data-ref-tier]`, and `#btn-refs-ledger` (outgoing citation inventory popover grouped by authority tier).
- **Pre-Emptive Multi-Jurisdiction & Multi-Desk Contracts:** Added `AuthorityTier`, `RefTier`, `DeskId`, `CorpusSummary`, `JurisdictionStack`, and `ActionProjectItem` TypeScript contracts in `reader/frontend/src/state.ts`, adapters in `reader/frontend/src/components/corpora.js`, `#/corpus/:tier/:jurisdiction/:code/...` routing in `router.js` / `doc_utils.js`, searchable tier-grouped `#title-pop` Corpus Switcher (`title_switcher.js`), Desk filter ribbon on `#/`, `ts-auth-stack` preemption strip on `#/title/{n}/`, Authority Tier tabs on `#/library` and `#/search`, tier-badged `⌘K` hits, and Yakuza editorial left-edge authority stripes on `#/news`.
- **Subject Workspaces → Action Projects:** Extended `framework_projects_v1` cleanly inside `views/projects.js` so pinned citations group by **Authority Tier Stack** (`Statutes → Federal CFR → State → County → IBR Standards`) and each Subject Workspace houses an interactive **Action Projects** checklist (`Open | In Progress | Done`).

---

## 2. Execution Checklist

### Phase 1: Dark-Mode-Only Lock & "Yakuza Editorial" Token Foundation
- [x] **Task 1.1:** Collapse `[data-theme="dark"]` into `:root` in `01_tokens.css`, delete `[data-theme="light"]`, refine obsidian surfaces, add `--editorial-crimson`, `--editorial-gold`, and all 9 `--ref-*` tokens.
- [x] **Task 1.2:** Remove `#theme-toggle` and theme switching from `index.html`, `state_init.js`, `main.js`, `settings_panel.js`, `recent_panel.js`, and `palette.js` (plus `'Open workspaces'`).
- [x] **Task 1.3:** Clean `[data-theme="dark"]` prefixes in `07_reader.css` and refine `.reg-figure` dark-room matte while keeping `@media print` intact.
- [x] **Task 1.4:** Remove `LightDesktopScreens` & `overview-light-desktop.png` from `test_browser_parity.py`.

### Phase 2: 9-Tier Semantic Reference Chromatics, Colored Peeks & Reference Ledger
- [x] **Task 2.1:** Add 9-tier `.xref*`, `.tier-pip`, `.ref-badge`, `.has-tier-bar`, and `.citation-chip[data-ref-tier]` rules to `02b_primitives.css` & `07_reader.css`.
- [x] **Task 2.2:** Export `SEMANTIC_XREF_CLASSES` in `app/render/linkifier.py` and add CSS/linkifier parity coverage in `tests/test_linkifier.py`.
- [x] **Task 2.3:** Upgrade `popover.js`, `peek.js`, `split_pane.js`, and `cfr_resolver.js` with `data-ref-tier` colored top borders, authority stamps, and U.S.C./FR peeks.
- [x] **Task 2.4:** Add `#btn-refs-ledger` and interactive tier-grouped outgoing reference ledger popover in `views/reader.js`.

### Phase 3: Multi-Jurisdiction Data Contracts, Corpus Switcher & Desk Context
- [x] **Task 3.1:** Add `AuthorityTier`, `DeskId`, `CorpusSummary`, `JurisdictionStack`, and `ActionProjectItem` to `state.ts` + normalizer adapter in `components/corpora.js`.
- [x] **Task 3.2:** Support `#/corpus/{tier}/{jurisdiction}/{code}/...` routing alongside `#/title/{n}/...` aliases in `router.js` and `doc_utils.js`.
- [x] **Task 3.3:** Rebuild `title_switcher.js` (`#title-pop`) as a searchable, tier-grouped Corpus & Jurisdiction Switcher with desk filter pills and `renderCorpusStaging`.
- [x] **Task 3.4:** Persist `state.activeDesk` (`framework_desk_v1`) and provide shared `deskFilterRibbonHtml`.

### Phase 4: Newsroom Broadsheet Elevation (`Home`, `Corpus Start`, `Library`, `Search`, `News`)
- [x] **Task 4.1:** Upgrade `views/home.js` with Desk Filter Ribbon, 3px left authority bars, and multi-jurisdiction kickers.
- [x] **Task 4.2:** Add Authority Stack / Preemption Strip & tier-colored Almanac cards to `views/core.js`.
- [x] **Task 4.3:** Add Authority Tier tabs (`All` · `U.S. Code` · `Federal CFR` · `States` · `Counties` · `Standards`) + tier-badged Compliance Packs to `views/library.js`.
- [x] **Task 4.4:** Add Authority facet pills, tier-badged grouped headers, and `⌘K` tier badges in `views/search.js` & `components/search_bar.js`.
- [x] **Task 4.5:** Apply crimson/gold Yakuza category stripes & tabular typography to `10_news.css` & `views/news.js` while preserving strict token-only rules.

### Phase 5: Subject Workspaces + Nested Action Projects & Visual Baselines
- [x] **Task 5.1:** Group pinned sections by Authority Tier Stack inside `#/projects/{id}` (`views/projects.js`).
- [x] **Task 5.2:** Add inline Action Projects (`Open | In Progress | Done`) persisted inside each Subject Workspace.
- [x] **Task 5.3:** Rebuild `reader/static/dist/`, expand `tests/test_browser_parity.py`, re-record macOS visual baselines, and synchronize `CLAUDE.md` and plan docs.
