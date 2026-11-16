// The Title 29 citation pattern the newsroom linkifies. Kept in exact parity
// with app/news.py's extract_citations by test_news_frontend.py.
export const NEWS_CITE_RE: RegExp = /\b29\s*C\.?F\.?R\.?\s*(?:§§?\s*)?(\d{1,4}\.\d+)(?:\([a-z0-9]{1,4}\))*|§§?\s*(19\d{2}\.\d+)(?:\([a-z0-9]{1,4}\))*/gi;
