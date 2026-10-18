import { db } from "../db";
import { getEnv, ownerFirstName } from "../env";
import { distanceMeters, type LatLng } from "../geo";
import { credit } from "../garden/queries";
import { createEarmarkTodo } from "../sync/bee-todos"; // M3-T7 (generic Earmark todo, 10-open cap)
import { withLink } from "../sync/todo-text";

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
  claim: (recId: number, day: string) => Promise<number | null>; // the new place_nudges row id, null = already claimed
  release: (nudgeId: number) => Promise<void>;
  setTodoId: (nudgeId: number, todoId: number) => Promise<void>;
  createTodo: typeof createEarmarkTodo;
  now: () => Date;
  radiusM: number;
}

// Only tips not yet acted on: a tried or thanked place is not worth a daily "you're near" buzz.
export const NUDGE_STATUSES = ["new", "queued"] as const;

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
          and r.status = any(${NUDGE_STATUSES as unknown as string[]}::text[])
          and r.lat between ${at.lat - dLat} and ${at.lat + dLat}
          and r.lng between ${at.lng - dLng} and ${at.lng + dLng}`;
      return (rows as unknown as CandidateRow[]).map((r) => toCandidate(r));
    },
    claim: async (recId, day) => {
      const [row] = await db()`
        insert into place_nudges (recommendation_id, nudged_on) values (${recId}, ${day}::date)
        on conflict do nothing returning id`;
      return row ? Number(row.id) : null;
    },
    release: async (nudgeId) => {
      await db()`delete from place_nudges where id = ${nudgeId}`;
    },
    setTodoId: async (nudgeId, todoId) => {
      await db()`update place_nudges set bee_todo_id = ${todoId} where id = ${nudgeId}`;
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
  // ponytail: only the nearest place is tried; a second saved place in range waits for the next location event
  const hit = nearestWithin(await deps.candidates(at, deps.radiusM), at, deps.radiusM);
  if (!hit) return "none";
  const now = deps.now();
  const day = chicagoDate(now);
  const nudgeId = await deps.claim(hit.id, day);
  if (nudgeId === null) return "already";
  const text = withLink(`Earmark · You're near ${hit.canonicalName}${hit.recommenderName ? ` — ${hit.recommenderName} recommended it` : ""}`, "tips", hit.id);
  let result: Awaited<ReturnType<NudgeDeps["createTodo"]>>;
  try {
    // Each day's nudge is its own entity (place_nudges.id), so forget can find every day's Bee todo.
    result = await deps.createTodo({ entityType: "place_nudge", entityId: nudgeId, text, alarmAt: now.toISOString() });
  } catch (err) {
    // a failed write gives the day back so the next location event retries; a failing release must not hide `err`
    await deps.release(nudgeId).catch((e: unknown) => console.error(`[earmark] nudge release failed error=${e instanceof Error ? e.name : "unknown"}`));
    throw err;
  }
  if ("skipped" in result) {
    // ponytail: "cap"/"off" keep the claim, so a capped place is not retried all day. "locked" is transient (another
    // Bee todo writer is running), so its claim is released and the next location event can retry. Each day makes its
    // own todo, so an unfinished older nudge and today's both hold a cap slot.
    if (result.skipped === "locked") await deps.release(nudgeId);
    return "capped";
  }
  await deps.setTodoId(nudgeId, result.todoId);
  return "nudged";
}
