import type { RecType } from "../types";
import { appleAccess } from "./apple-music";
import { pickMatch } from "./match";
import { enrichMusic } from "./music";
import { providerFor } from "./registry";
import { runProvider, type EnrichmentMatch, type EnrichQuery } from "./types";
import { enrichVideo, youtubeVideoUrl } from "./youtube";

export interface RecToEnrich {
  id: number;
  type: RecType;
  canonical_name: string;
  creator: string | null;
  excerpt: string;
  lat: number | null;
  lng: number | null;
  links?: unknown; // read for a video tip's YouTube URL
}
export interface EnrichDeps { env?: Record<string, string | undefined>; pick?: typeof pickMatch; fetchImpl?: typeof fetch }

const MUSIC = new Set<RecType>(["album", "song", "artist"]);

// One tip → its type's provider → Jev picks the same item or abstains. null = no match.
// Throws on provider/Jev failure (ProviderHttpError, TimeoutError…) so the lane can back off and retry.
// Call only from the rec-lane sweep (decision 012: MusicBrainz never from a request path).
export async function enrichRec(rec: RecToEnrich, deps: EnrichDeps = {}): Promise<EnrichmentMatch | null> {
  const env = deps.env ?? process.env;
  const pick = deps.pick ?? pickMatch;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const query: EnrichQuery = { type: rec.type, name: rec.canonical_name, creator: rec.creator, lat: rec.lat, lng: rec.lng };
  const described = rec.creator ? `${rec.canonical_name} by ${rec.creator}` : rec.canonical_name;
  if (MUSIC.has(rec.type)) {
    return enrichMusic({ recId: rec.id, query, described, excerpt: rec.excerpt }, { fetchImpl, pick, apple: appleAccess(env) });
  }
  if (rec.type === "video") return enrichVideo({ ...query, url: youtubeVideoUrl(rec.links) }, fetchImpl);
  const provider = providerFor(rec.type, env);
  if (!provider) throw new Error(`enrich: no provider configured for ${rec.type}`);
  return pick({ described, excerpt: rec.excerpt }, await runProvider(provider.def, query, fetchImpl));
}
