import { db } from "../db";
import { getEnv, ownerFirstName } from "../env";
import { distanceMeters, type LatLng } from "../geo";
import { credit, HIDDEN_TIP_STATUSES } from "../garden/queries";
import { createEarmarkTodo } from "../sync/bee-todos"; // M3-T7 (generic Earmark todo, 10-open cap)

// FR-16: Bee reports where the owner is; near a saved place tip, make one Bee todo, at most once per place per day.
// Logs elsewhere carry the outcome only, never coordinates or names.

export interface PlaceCandidate {
  id: number;
  canonicalName: string;
  recommenderName: string | null;
  lat: number;
  lng: number;
}

export interface NudgeDeps {
  candidates: (at: LatLng, radiusM: number) => Promise<PlaceCandidate[]>;
  claim: (recId: number, day: string) => Promise<boolean>;
  release: (recId: number, day: string) => Promise<void>;
  setTodoId: (recId: number, day: string, todoId: number) => Promise<void>;
  createTodo: typeof createEarmarkTodo;
  now: () => Date;
  radiusM: number;
}

export function nearestWithin(candidates: PlaceCandidate[], at: LatLng, radiusM: number) {
  let best: (PlaceCandidate & { distanceM: number }) | null = null;
  for (const c of candidates) {
    const d = distanceMeters(at, { lat: c.lat, lng: c.lng });
    if (d <= radiusM && (!best || d < best.distanceM)) best = { ...c, distanceM: d };
  }
  return best;
}

export function chicagoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now); // YYYY-MM-DD
}

interface CandidateRow {
  id: number | string;
  canonical_name: string;
  lat: number;
  lng: number;
  recommender_id: number | null;
  first_name: string | null;
}

// The garden's owner guard (credit) decides whether the recommender may be named: the owner never is.
export function toCandidate(r: CandidateRow, owner = ownerFirstName()): PlaceCandidate {
  return {
    id: Number(r.id),
    canonicalName: r.canonical_name,
    lat: r.lat,
    lng: r.lng,
    recommenderName: credit({ recommender_id: r.recommender_id, first_name: r.first_name }, owner)?.firstName ?? null,
  };
}

function defaultDeps(): NudgeDeps {
  return {
    // ponytail: bounding box in SQL, exact distance in nearestWithin; a spatial index if places ever reach thousands
    candidates: async (at, radiusM) => {
      const dLat = radiusM / 111_000;
      const dLng = dLat / Math.max(Math.cos((at.lat * Math.PI) / 180), 0.01);
      const rows = await db()`
        select r.id, r.canonical_name, r.lat, r.lng, p.id as recommender_id, p.first_name
        from recommendations r left join recommenders p on p.id = r.recommender_id
        where r.type = 'place' and r.lat is not null and r.lng is not null
          and r.status <> all(${HIDDEN_TIP_STATUSES}::text[])
          and r.lat between ${at.lat - dLat} and ${at.lat + dLat}
          and r.lng between ${at.lng - dLng} and ${at.lng + dLng}`;
      return (rows as unknown as CandidateRow[]).map((r) => toCandidate(r));
    },
    claim: async (recId, day) =>
      (await db()`
        insert into place_nudges (recommendation_id, nudged_on) values (${recId}, ${day}::date)
        on conflict do nothing returning recommendation_id`).length > 0,
    release: async (recId, day) => {
      await db()`delete from place_nudges where recommendation_id = ${recId} and nudged_on = ${day}::date`;
    },
    setTodoId: async (recId, day, todoId) => {
      await db()`update place_nudges set bee_todo_id = ${todoId} where recommendation_id = ${recId} and nudged_on = ${day}::date`;
    },
    createTodo: createEarmarkTodo,
    now: () => new Date(),
    radiusM: getEnv().NUDGE_RADIUS_M,
  };
}

export async function handleLocationUpdate(
  loc: { latitude: number; longitude: number },
  overrides: Partial<NudgeDeps> = {},
): Promise<"nudged" | "none" | "already" | "capped"> {
  const deps = { ...defaultDeps(), ...overrides };
  const at = { lat: loc.latitude, lng: loc.longitude };
  const hit = nearestWithin(await deps.candidates(at, deps.radiusM), at, deps.radiusM);
  if (!hit) return "none";
  const now = deps.now();
  const day = chicagoDate(now);
  if (!(await deps.claim(hit.id, day))) return "already";
  const text = `Earmark · You're near ${hit.canonicalName}${hit.recommenderName ? ` — ${hit.recommenderName} recommended it` : ""}`;
  const result = await deps.createTodo({ entityType: "place_nudge", entityId: hit.id, text, alarmAt: now.toISOString() });
  if ("skipped" in result) {
    // ponytail: "cap"/"off" keep the claim, so a capped place is not retried all day. "locked" is transient (another
    // Bee todo writer is running), so its claim is released and the next location event can retry.
    if (result.skipped === "locked") await deps.release(hit.id, day);
    return "capped";
  }
  await deps.setTodoId(hit.id, day, result.todoId);
  return "nudged";
}
