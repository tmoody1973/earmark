import { z } from "zod";
import type { IdeaStage } from "../types";
import { plantLevel, type PlantLevel } from "./plant";
import { bloomChip, type NewChip } from "./visit";

// The garden's live layer (M4-T4): what the page does with each poll of GET /api/garden/blooms (M2-T6).
// Pure, so the client component only wires timers and the DOM to it.

export const BLOOM_POLL_MS = 5_000;
export const MAX_BACKOFF_MS = 60_000;

const FeedEventSchema = z.object({
  id: z.number().int(),
  kind: z.enum(["mention", "bloom"]),
  clusterId: z.number().int(),
  title: z.string(),
  stage: z.enum(["compost", "sprouting", "ready", "drafted", "used", "dismissed"]),
  mentionCount: z.number().int(),
  createdAt: z.string(),
});
// tipsAt: the newest visible tip change after `since` (a new tip, or its match filled in), so tips go live too.
const BloomsResponseSchema = z.object({ events: z.array(FeedEventSchema), now: z.string(), tipsAt: z.string().nullable().catch(null) });

export type FeedEvent = z.infer<typeof FeedEventSchema>;
export type BloomsResponse = z.infer<typeof BloomsResponseSchema>;

/** Client-side guard for `{ events, now }`; a drifted shape is an error, not an empty garden. */
export function parseBloomsResponse(json: unknown): BloomsResponse {
  const r = BloomsResponseSchema.safeParse(json);
  if (!r.success) throw new Error(`Unexpected blooms response: ${r.error.message}`);
  return r.data;
}

/** A tip changed after the last one the page refreshed for (ISO times compare as strings). Pure. */
export function newTipsSince(seen: string, tipsAt: string | null): boolean {
  return tipsAt !== null && tipsAt > seen;
}

/** 5 s while healthy; doubling after each failed poll, capped at a minute. */
export function pollDelay(failures: number): number {
  return Math.min(BLOOM_POLL_MS * 2 ** failures, MAX_BACKOFF_MS);
}

/** How a plant is drawn on the page right now: its level and what its card says. */
export interface DrawnPlant { level: PlantLevel; stage: IdeaStage; mentionCount: number }

/** A plant's live state. `bloomFrom` is set while it should play the bloom: how it was drawn before (the card keeps
 *  saying that until the flower starts to open). */
export interface PlantPatch { stage: IdeaStage; level: PlantLevel; mentionCount: number; bloomFrom: DrawnPlant | null }

export interface LiveState {
  seen: ReadonlySet<number>;
  patches: Readonly<Record<number, PlantPatch>>;
  /** Bloom chips that arrived while the page was open, newest first. */
  chips: readonly NewChip[];
  announcement: string;
}

export const emptyLive = (): LiveState => ({ seen: new Set(), patches: {}, chips: [], announcement: "" });

const UNOPENED: ReadonlySet<PlantLevel> = new Set(["seed", "sprout"]);

/**
 * Folds one poll into the live state. `onPage` maps each plant drawn on the page to the level the server drew it at.
 * `refresh` asks for a server re-render: a mention changes the newest timeline line, and an idea that is not on the
 * page must be brought in. A visible bloom does not refresh: the bed would re-sort and move the plant mid-bloom.
 */
export function reduceFeed(
  state: LiveState,
  events: readonly FeedEvent[],
  onPage: ReadonlyMap<number, DrawnPlant>,
): { state: LiveState; refresh: boolean } {
  const fresh = events.filter((e) => !state.seen.has(e.id));
  if (fresh.length === 0) return { state, refresh: false };
  const bloomed = new Set(fresh.filter((e) => e.kind === "bloom").map((e) => e.clusterId));
  const patches = { ...state.patches };
  let chips = [...state.chips];
  const lines: string[] = [];
  let refresh = false;

  for (const e of fresh) {
    const level = plantLevel(e.stage);
    const prev = patches[e.clusterId];
    // The plant on screen before this poll: the bloom's own mention event (same save, same poll) must not count.
    const before = state.patches[e.clusterId];
    const drawn: DrawnPlant | undefined = before
      ? { level: before.level, stage: before.stage, mentionCount: before.mentionCount }
      : onPage.get(e.clusterId);
    if (level) {
      const bloomFrom = e.kind === "bloom" && drawn && UNOPENED.has(drawn.level) ? drawn : (prev?.bloomFrom ?? null);
      patches[e.clusterId] = { stage: e.stage, level, mentionCount: e.mentionCount, bloomFrom };
    }
    if (e.kind === "bloom") {
      chips = [bloomChip({ clusterId: e.clusterId, title: e.title, mentionCount: e.mentionCount, at: e.createdAt }),
        ...chips.filter((c) => c.key !== `idea-${e.clusterId}`)];
      lines.push(`${e.title} bloomed — mentioned ${e.mentionCount} times.`);
      if (!onPage.has(e.clusterId)) refresh = true;
    } else if (!bloomed.has(e.clusterId)) {
      refresh = true;
    }
  }
  const seen = new Set(state.seen);
  for (const e of fresh) seen.add(e.id);
  return {
    state: { seen, patches, chips, announcement: lines.length ? lines.join(" ") : state.announcement },
    refresh,
  };
}

/** True while any plant is still playing its bloom (refreshes wait for it: no re-sort mid-bloom). */
export function isBlooming(state: LiveState): boolean {
  return Object.values(state.patches).some((p) => p.bloomFrom !== null);
}

/**
 * The bed in a stable order: ids already shown keep their relative places; ids new to the page go first, in the
 * server's order. GardenLive remembers the shown order until the next real visit, so a live refresh never re-sorts
 * the cards under his thumb.
 */
export function stableOrder(serverIds: readonly number[], shown: readonly number[]): number[] {
  const at = new Map(shown.map((id, i) => [id, i]));
  const fresh = serverIds.filter((id) => !at.has(id));
  const kept = serverIds.filter((id) => at.has(id)).sort((a, b) => at.get(a)! - at.get(b)!);
  return [...fresh, ...kept];
}

/** The bloom has played: keep the new state, drop the marker so a later re-render never replays it. */
export function settleBloom(state: LiveState, clusterId: number): LiveState {
  const p = state.patches[clusterId];
  if (!p?.bloomFrom) return state;
  return { ...state, patches: { ...state.patches, [clusterId]: { ...p, bloomFrom: null } } };
}
