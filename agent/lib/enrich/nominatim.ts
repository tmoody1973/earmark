import { distanceMeters } from "../geo";
import type { Bias } from "./bias";
import { MAX_CANDIDATES, PROVIDER_TIMEOUT_MS, type Candidate, type ProviderDef } from "./types";

// OpenStreetMap Nominatim search, keyless: the default for place tips; Google Places wins when its key is set
// (registry.ts, decision 044). Usage policy: https://operations.osmfoundation.org/policies/nominatim/ -- an identifying
// User-Agent, absolute max 1 request/second, cache results (the lane stores lat/lng + links once, so a matched place is
// never asked again), and only the place name/address in the query (never the conversation or a person's name).
const BIAS_RADIUS_KM = 20; // where it was said, roughly the metro area; a bias (bounded=0), not a filter
const KM_PER_DEG_LAT = 111.32;
// Results farther than this from the hint are dropped (tip 130: OSM had no Diaspora near Milwaukee, so the bias alone
// offered Mexico and Kosovo). Covers Madison and Chicago from Milwaukee.
// ponytail: a place heard about at home but far away (a trip tip) is dropped too; the owner pastes its link instead.
export const FAR_KM = 150;
export const NOMINATIM_GAP_MS = 1_100; // policy says 1 req/s; keep a margin

// ponytail: per-instance gap only, not global across concurrent functions. Fine at a few lookups a day under the
// rec-lane lease (one sweep at a time). Upgrade: a DB-held "last call" timestamp.
let lastCallAt = 0;
/** Waits for this instance's next Nominatim slot: every Nominatim request (search and the place-details lookup) takes one. */
export async function nominatimSlot(): Promise<void> {
  const at = Math.max(Date.now(), lastCallAt + NOMINATIM_GAP_MS);
  lastCallAt = at;
  const wait = at - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
/** Test-only: forget the last request time. */
export function resetNominatimThrottle(): void {
  lastCallAt = 0;
}

/** The identifying User-Agent the usage policy asks for. */
export function nominatimHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const base = env.EARMARK_PUBLIC_BASE_URL?.trim();
  return { "User-Agent": `Earmark/1.0 (+${base || "https://github.com/tmoody1973/earmark"})` };
}

export function nominatimProvider(env: Record<string, string | undefined> = process.env): ProviderDef {
  const email = env.NOMINATIM_EMAIL?.trim();
  return {
    async build(q) {
      const params = new URLSearchParams({
        format: "jsonv2",
        q: [q.name, q.creator].filter(Boolean).join(" "),
        limit: String(MAX_CANDIDATES),
        addressdetails: "0",
      });
      if (q.lat !== null && q.lng !== null) {
        const dLat = BIAS_RADIUS_KM / KM_PER_DEG_LAT;
        const dLng = dLat / Math.max(Math.cos((q.lat * Math.PI) / 180), 0.01);
        params.set("viewbox", [q.lng - dLng, q.lat + dLat, q.lng + dLng, q.lat - dLat].map((n) => n.toFixed(5)).join(","));
        params.set("bounded", "0");
      }
      if (email) params.set("email", email);
      await nominatimSlot();
      return {
        url: `https://nominatim.openstreetmap.org/search?${params}`,
        init: { headers: nominatimHeaders(env) },
      };
    },
    /* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
    parse(json, q) {
      if (!Array.isArray(json)) return [];
      const hint = q.lat !== null && q.lng !== null ? { lat: q.lat, lng: q.lng } : null;
      return json.flatMap((r: any): Candidate[] => {
        const lat = Number(r?.lat), lng = Number(r?.lon);
        const display = typeof r?.display_name === "string" ? r.display_name : "";
        const name = display.split(",")[0]?.trim();
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !r.osm_type || r.osm_id == null) return [];
        if (hint && distanceMeters(hint, { lat, lng }) > FAR_KM * 1000) return [];
        return [{
          canonicalName: name,
          creator: null,
          yearOrAddress: display,
          imageUrl: null, // the card shows an OpenStreetMap tile from lat/lng (decision 020)
          links: { openstreetmap: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}` },
          lat,
          lng,
        }];
      });
    },
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
}

/**
 * The city around a location hint ("Milwaukee, Wisconsin"), for a place's web search (decision 059). One reverse lookup
 * at city zoom; the hint is already rounded to ~11 km (bias.ts). Null on no hint or any failure: the search runs without it.
 */
export async function nominatimCity(
  near: Bias | null, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!near) return null;
  const params = new URLSearchParams({ format: "jsonv2", lat: String(near.lat), lon: String(near.lng), zoom: "10", addressdetails: "1" });
  try {
    await nominatimSlot();
    const res = await fetchImpl(`https://nominatim.openstreetmap.org/reverse?${params}`,
      { headers: nominatimHeaders(env), signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!res.ok) return null;
    const j = (await res.json()) as { name?: unknown; address?: { state?: unknown } };
    const name = typeof j?.name === "string" ? j.name.trim() : "";
    const state = typeof j?.address?.state === "string" ? j.address.state.trim() : "";
    return name ? [name, state].filter(Boolean).join(", ") : null;
  } catch {
    return null;
  }
}
