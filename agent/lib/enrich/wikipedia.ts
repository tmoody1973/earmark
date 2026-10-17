import { MAX_CANDIDATES, USER_AGENT, type Candidate, type ProviderDef } from "./types";

// Wikipedia (MediaWiki REST) page search, keyless: GET /w/rest.php/v1/search/page?q=&limit= → pages[].{key,title,
// description,thumbnail.url}. Wikimedia asks for a descriptive User-Agent.
// Docs: https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages , https://meta.wikimedia.org/wiki/User-Agent_policy
// The fallback for type "other": the description ("Electronic musical instrument") becomes the card's second line.

// The search thumbnail is 60px and protocol-relative. Wikimedia serves fixed thumbnail widths, so ask for 330px.
// ponytail: an original narrower than 330px answers 400 (no art on that card); upgrade = the page-summary
// endpoint's thumbnail.source if that shows up in real data.
export function wikiThumb(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  const https = url.startsWith("//") ? `https:${url}` : url;
  return https.split("?")[0]!.replace(/\/\d+px-([^/]+)$/, "/330px-$1");
}

export const wikipediaProvider: ProviderDef = {
  async build(q) {
    return {
      url: `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q.name)}&limit=${MAX_CANDIDATES}`,
      init: { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    };
  },
  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
  parse(json) {
    const pages: any[] = (json as any)?.pages ?? [];
    return pages.filter((p) => p?.key && p.title).map((p): Candidate => ({
      canonicalName: p.title,
      creator: null,
      yearOrAddress: p.description ?? null,
      imageUrl: wikiThumb(p.thumbnail?.url),
      links: { wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}` },
    }));
  },
  /* eslint-enable @typescript-eslint/no-explicit-any */
};
