import { db } from "../db";
import { HIDDEN_TIP_STATUSES } from "../recs/status";
import type { IdeaStage } from "../types";

// Rows are written only by buildSaveQueries (pipeline/save-item.ts), in the same statement as the mention they record.
export type GardenEventKind = "mention" | "bloom";
export interface GardenEvent {
  id: number; kind: GardenEventKind; clusterId: number; title: string; stage: IdeaStage; mentionCount: number; createdAt: string;
}

// Events strictly after `since`, oldest first, with the cluster as it is now (title, stage, count). An idea overheard
// once (decision 055) has none until it recurs, so the live garden never refreshes for a plant it won't show.
export const GARDEN_EVENTS_LIMIT = 50;
export async function listGardenEventsSince(since: Date, limit = GARDEN_EVENTS_LIMIT): Promise<GardenEvent[]> {
  const rows = await db()`
    select e.id, e.kind, e.cluster_id, e.created_at, c.title, c.stage, c.mention_count
    from garden_events e join idea_clusters c on c.id = e.cluster_id
    where e.created_at > ${since.toISOString()}::timestamptz and not idea_is_quiet(c.id)
    order by e.created_at, e.id limit ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind as GardenEventKind, clusterId: Number(r.cluster_id), title: String(r.title),
    stage: r.stage as IdeaStage, mentionCount: Number(r.mention_count), createdAt: new Date(r.created_at).toISOString(),
  }));
}

// The live page's tips (Home's New and Maybe? rows): when a visible tip last appeared or had its match filled in after
// `since`, or null. Cleared and overheard tips never refresh the page.
const LIVE_TIP_HIDDEN = HIDDEN_TIP_STATUSES.filter((s) => s !== "needs_review");
export async function latestTipChangeSince(since: Date): Promise<string | null> {
  const [r] = await db()`
    select max(greatest(created_at, coalesce(enriched_at, created_at))) as at from recommendations
    where greatest(created_at, coalesce(enriched_at, created_at)) > ${since.toISOString()}::timestamptz
      and status <> all(${LIVE_TIP_HIDDEN}::text[])`;
  return r?.at ? new Date(r.at).toISOString() : null;
}
