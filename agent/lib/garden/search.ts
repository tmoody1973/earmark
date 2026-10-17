// The garden's search field, for now: a filter over what is already on the page (titles and first names).
// SEAM (M5-T8): memory-cue search ("the ramen place Ann mentioned after the show") replaces this with a server query;
// the field, its label and the hidden-item behaviour stay, only the matcher behind them changes.

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True when every word of the query appears in at least one field. An empty query matches everything. */
export function matchesQuery(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter((f): f is string => !!f).map(fold);
  return words.every((w) => hay.some((h) => h.includes(w)));
}
