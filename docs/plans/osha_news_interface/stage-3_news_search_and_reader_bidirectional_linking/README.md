# Stage 3: Reader Linking, News Search & Facets

## Goal
Connect the News page and the reader in both directions:
- Title 29 section and part pages get an activity button (next to Pin) that opens a timeline of related FR rulemaking and OSHA enforcement.
- `#/news` gets full-text search and enforcement facets.

Search stays inside News (decision 5), and the timeline has no interpretations (decision 4).

## Phases & Parts

- **Phase 1: In-Reader Regulatory Context**
  - [Part 1: Reader Activity Button & Popover](phase-1_in_reader_news_context/part-1_section_news_badge_and_drawer.md)
  - [Part 2: Rulemaking & Enforcement Timeline](phase-1_in_reader_news_context/part-2_regulatory_timeline_view.md)
- **Phase 2: News Search & Facets**
  - [Part 1: News Full-Text Search](phase-2_fts_and_faceted_filtering/part-1_news_fts5_search_indexing.md)
  - [Part 2: State, Penalty & Gravity Facets](phase-2_fts_and_faceted_filtering/part-2_region_and_penalty_facets.md)

## Success Criteria
- Opening `§ 1910.1030` or Part 1910 shows "N rules & citations" when `article_citations` has matches, and nothing at all otherwise. It never delays the text.
- The popover timeline links out to sources and through to `#/news?section=…`.
- The News filter box finds records by keyword, company, `§` number and FR citation, highlighted with the `\x02`/`\x03` sentinels.
- Enforcement can be filtered by state (from the data), penalty and gravity, server-side and combinable.
- Docs updated: `CLAUDE.md` (the reader's actions row, the News search scope), `reader/API.md`.
