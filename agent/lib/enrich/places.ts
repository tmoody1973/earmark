import { MAX_CANDIDATES, type Candidate, type ProviderDef } from "./types";

// Google Places API (New) Text Search (keyed: GOOGLE_PLACES_API_KEY). POST /v1/places:searchText {textQuery, pageSize,
// locationBias.circle}; X-Goog-FieldMask is required (no default). Only Essentials/Pro fields: no photos, ratings or
// hours, which bill at the Enterprise tier. Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
export const PLACES_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri";
const BIAS_RADIUS_M = 20_000; // where it was said, roughly the metro area

export function placesProvider(apiKey: string): ProviderDef {
  return {
    async build(q) {
      const body: Record<string, unknown> = { textQuery: [q.name, q.creator].filter(Boolean).join(" "), pageSize: MAX_CANDIDATES };
      if (q.lat !== null && q.lng !== null) {
        body.locationBias = { circle: { center: { latitude: q.lat, longitude: q.lng }, radius: BIAS_RADIUS_M } };
      }
      return {
        url: "https://places.googleapis.com/v1/places:searchText",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK },
          body: JSON.stringify(body),
        },
      };
    },
    /* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
    parse(json) {
      const places: any[] = (json as any)?.places ?? [];
      return places.filter((p) => p?.displayName?.text).map((p): Candidate => ({
        canonicalName: p.displayName.text,
        creator: null,
        yearOrAddress: p.formattedAddress ?? null,
        imageUrl: null, // the card shows an OpenStreetMap tile from lat/lng (decision 020)
        links: p.googleMapsUri ? { google_maps: p.googleMapsUri } : {},
        ...(typeof p.location?.latitude === "number" ? { lat: p.location.latitude, lng: p.location.longitude } : {}),
      }));
    },
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
}
