// Where a place lookup should lean (decision 046): where the tip was said, else where the rec itself is, else the
// owner's home default (EARMARK_HOME_LAT / EARMARK_HOME_LNG), else nowhere. One helper, so Google and Nominatim agree.
export interface BiasInput { saidLat?: number | null; saidLng?: number | null; lat: number | null; lng: number | null }
export interface Bias { lat: number; lng: number }

// Privacy: ~11 km. The bias radius is ~20 km, so any finer value only tells the provider where the owner was.
export const roundBias = (lat: number, lng: number): Bias => ({ lat: Math.round(lat * 10) / 10, lng: Math.round(lng * 10) / 10 });

const pair = (lat: unknown, lng: unknown): Bias | null =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? roundBias(lat, lng) : null;

export function biasFor(rec: BiasInput, env: Record<string, string | undefined>): Bias | null {
  const home = env.EARMARK_HOME_LAT && env.EARMARK_HOME_LNG ? pair(Number(env.EARMARK_HOME_LAT), Number(env.EARMARK_HOME_LNG)) : null;
  return pair(rec.saidLat, rec.saidLng) ?? pair(rec.lat, rec.lng) ?? home;
}
