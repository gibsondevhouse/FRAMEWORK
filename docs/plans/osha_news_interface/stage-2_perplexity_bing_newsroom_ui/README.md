# Stage 2: Newsroom UI (`#/news`)

## Goal
Build the News page and fit it into the app shell. It borrows a news-front layout (breaking banner, tabs, lead hero) and cards that state facts as fixed bullets with CFR chips. Everything uses the existing design tokens and components. The "Bing" and "Perplexity" names in the folder titles are layout inspiration only: nothing here is AI-generated.

## Phases & Parts

- **Phase 1: Newsroom Layout & Shell Integration**
  - [Part 1: Breaking Banner & Lead Story Hero](phase-1_bing_style_multicategory_newsroom/part-1_breaking_news_ticker_and_hero.md)
  - [Part 2: Category Tabs & Filter Box](phase-1_bing_style_multicategory_newsroom/part-2_category_tabs_and_deck_filters.md)
  - [Part 3: Route, Activity Rail & App-Shell Integration](phase-1_bing_style_multicategory_newsroom/part-3_route_rail_and_shell_integration.md)
- **Phase 2: Story Cards**
  - [Part 1: Fixed Takeaway Bullets & Card Anatomy](phase-2_perplexity_style_story_cards/part-1_structured_takeaways_card.md)
  - [Part 2: Citation Chips & Source Byline](phase-2_perplexity_style_story_cards/part-2_citation_chips_and_source_byline.md)

## Success Criteria
- News is a rail item between Projects and Library (**G N**, Alt/⌥+5), routed at `#/news` with tab and filter state in the URL.
- The breaking banner appears only when a recent PI filing or a ≥ $50,000 penalty qualifies.
- Tabs: *All*, *Final Rules*, *Proposed Rules*, *Enforcement & Penalties*, *Public Inspection*, *Notices*. Enforcement explains how to get a DOL key instead of failing.
- Every card shows three fixed bullets built from its fields, a byline, CFR chips into the reader, and source / PDF / reader actions.
- Empty, first-sync, error and sync-off states are all designed.
- Docs updated: `CLAUDE.md` (Navigation: the rail order, G N, Alt 1–7; a News paragraph), `README.md`, `reader/README.md`.
