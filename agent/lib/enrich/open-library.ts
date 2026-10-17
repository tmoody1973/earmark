import { escapeLucene } from "./musicbrainz";
import { MAX_CANDIDATES, USER_AGENT, type Candidate, type ProviderDef } from "./types";

// Open Library search, keyless. GET /search.json?q=&fields=&limit=; identify with a User-Agent (identified callers get
// 3 req/s instead of 1). Cover: https://covers.openlibrary.org/b/id/{cover_i}-M.jpg.
// Docs: https://openlibrary.org/dev/docs/api/search , https://openlibrary.org/dev/docs/api/covers , docs/research/integrations.md §7
// `q` is Solr (Lucene syntax) and ANDs plain words: "The Overstory Richard Pwers" finds nothing. Title OR author keeps
// both optional and ranks the book matching both first, so a misheard author still finds the title (tested live).
export const openLibraryProvider: ProviderDef = {
  async build(q) {
    const title = `title:(${escapeLucene(q.name)})`;
    const query = q.creator?.trim() ? `${title} OR author:(${escapeLucene(q.creator)})` : title;
    return {
      url: `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,first_publish_year,cover_i&limit=${MAX_CANDIDATES}`,
      init: { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    };
  },
  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
  parse(json) {
    const docs: any[] = (json as any)?.docs ?? [];
    return docs.filter((d) => d?.key && d.title).map((d): Candidate => ({
      canonicalName: d.title,
      creator: d.author_name?.[0] ?? null,
      yearOrAddress: d.first_publish_year ? String(d.first_publish_year) : null,
      imageUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      links: { openlibrary: `https://openlibrary.org${d.key}` },
    }));
  },
  /* eslint-enable @typescript-eslint/no-explicit-any */
};
