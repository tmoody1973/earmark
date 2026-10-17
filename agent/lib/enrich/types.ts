import type { RecType } from "../types";

// recommendations.links (jsonb): service name → https URL. cardLink() prefers apple_music, then any https value.
export type RecLinks = Partial<Record<"apple_music" | "musicbrainz" | "discogs" | "url", string>>;

export interface Candidate {
  canonicalName: string;
  creator: string | null;
  yearOrAddress: string | null;
  detail?: string | null; // what tells look-alikes apart (MusicBrainz disambiguation, "Album, Live"); shown to Jev
  imageUrl: string | null;
  links: RecLinks;
  mbid?: string; // MusicBrainz id of the matched entity: release group (album), recording (song) or artist
  releaseGroupId?: string; // where cover art comes from (album: itself; song: its first release's group)
  appleMusicId?: string;
  lat?: number;
  lng?: number;
}
export interface EnrichmentMatch extends Candidate { matchConfidence: number }
export interface EnrichQuery { type: RecType; name: string; creator: string | null; lat: number | null; lng: number | null }
export interface ProviderDef {
  build(q: EnrichQuery): Promise<{ url: string; init: RequestInit }>;
  parse(json: unknown, q: EnrichQuery): Candidate[];
}

// MusicBrainz requires "Application/<version> ( contact-url )": https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
export const USER_AGENT = "Earmark/0.1 ( https://github.com/tmoody1973/earmark )";
export const PROVIDER_TIMEOUT_MS = 8_000;
export const MAX_CANDIDATES = 3;

// Status only: response bodies never reach errors or logs (they can echo the query, i.e. what was said).
export class ProviderHttpError extends Error {
  override name = "ProviderHttpError";
  constructor(readonly host: string, readonly status: number) {
    super(`enrich ${host} ${status}`);
  }
}

// One request, no retries (a failed rec is retried by the lane's sweep, not here). 404 = nothing found, not an error.
export async function getJson(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<unknown | null> {
  const res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new ProviderHttpError(new URL(url).host, res.status);
  return res.json();
}

export async function runProvider(def: ProviderDef, q: EnrichQuery, fetchImpl: typeof fetch = fetch): Promise<Candidate[]> {
  const { url, init } = await def.build(q);
  const json = await getJson(url, init, fetchImpl);
  return json === null ? [] : def.parse(json, q).slice(0, MAX_CANDIDATES);
}

// The only log shape for enrichment failures: stage, ids, error name (+ HTTP status). Never text or payloads.
export function logEnrichError(stage: string, ids: Record<string, string | number | null | undefined>, err: unknown): void {
  const idPart = Object.entries(ids).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(" ");
  const name = err instanceof Error ? err.name : "unknown";
  const status = err instanceof ProviderHttpError ? ` status=${err.status}` : "";
  console.error(`[enrich] ${stage} failed ${idPart} error=${name}${status}`);
}
