// The garden's search field as you type: a filter over what is already on the page (titles and first names).
// Enter hands the words to memory-cue search (agent/lib/search/memory-cue.ts, the /search page), which looks further.

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True when every word of the query appears in at least one field. An empty query matches everything. */
export function matchesQuery(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter((f): f is string => !!f).map(fold);
  return words.every((w) => hay.some((h) => h.includes(w)));
}
