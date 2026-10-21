import { MAX_CANDIDATES, type Candidate, type ProviderDef } from "./types";

// OpenStreetMap Nominatim search, keyless: the default for place tips; Google Places wins when its key is set
// (registry.ts, decision 044). Usage policy: https://operations.osmfoundation.org/policies/nominatim/ -- an identifying
// User-Agent, absolute max 1 request/second, cache results (the lane stores lat/lng + links once, so a matched place is
// never asked again), and only the place name/address in the query (never the conversation or a person's name).
const BIAS_RADIUS_KM = 20; // where it was said, roughly the metro area; a bias (bounded=0), not a filter
const KM_PER_DEG_LAT = 111.32;
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
    parse(json) {
      if (!Array.isArray(json)) return [];
      return json.flatMap((r: any): Candidate[] => {
        const lat = Number(r?.lat), lng = Number(r?.lon);
        const display = typeof r?.display_name === "string" ? r.display_name : "";
        const name = display.split(",")[0]?.trim();
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !r.osm_type || r.osm_id == null) return [];
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
