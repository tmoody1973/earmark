import type { Candidate, ProviderDef } from "./types";

// TMDB (keyed: TMDB_API_KEY = the v4 "API Read Access Token"). GET /3/search/multi?query= with Authorization: Bearer;
// results[].media_type is movie | tv | person (people dropped). Poster: https://image.tmdb.org/t/p/w500{poster_path}.
// Docs: https://developer.themoviedb.org/reference/search-multi , https://developer.themoviedb.org/docs/image-basics
export function tmdbProvider(token: string): ProviderDef {
  return {
    async build(q) {
      return {
        url: `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(q.name)}&include_adult=false&page=1`,
        init: { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      };
    },
    /* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
    parse(json) {
      const results: any[] = (json as any)?.results ?? [];
      return results.filter((r) => (r?.media_type === "movie" || r?.media_type === "tv") && r.id && (r.title || r.name)).map((r): Candidate => ({
        canonicalName: r.title ?? r.name,
        creator: null,
        yearOrAddress: String(r.release_date ?? r.first_air_date ?? "").slice(0, 4) || null,
        imageUrl: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
        links: { tmdb: `https://www.themoviedb.org/${r.media_type}/${r.id}` },
      }));
    },
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
}
