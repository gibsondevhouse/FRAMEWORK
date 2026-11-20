// U.S. Code title labels. Appendix titles (5a, 11a, 18a, 28a; 50a is eliminated) are keyed
// 100 + N everywhere in the API (`usc_client.APPENDIX`), so title 105 is "5 U.S.C. App.".

export const USC_APPENDIX_BASE = 100;

export const isUscAppendix = (title: number): boolean => title > USC_APPENDIX_BASE;

/** "29", or "5a" for the Title 5 Appendix (105). */
export const uscTitleLabel = (title: number): string =>
  (isUscAppendix(title) ? `${title - USC_APPENDIX_BASE}a` : String(title));

/** "29 U.S.C.", or "5 U.S.C. App." for an appendix title. */
export const uscCite = (title: number): string =>
  (isUscAppendix(title) ? `${title - USC_APPENDIX_BASE} U.S.C. App.` : `${title} U.S.C.`);
