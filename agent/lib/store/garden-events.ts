import { db } from "../db";
import type { IdeaStage } from "../types";

// Rows are written only by buildSaveQueries (pipeline/save-item.ts), in the same statement as the mention they record.
export type GardenEventKind = "mention" | "bloom";
export interface GardenEvent {
  id: number; kind: GardenEventKind; clusterId: number; title: string; stage: IdeaStage; mentionCount: number; createdAt: string;
}

// Events strictly after `since`, oldest first, with the cluster as it is now (title, stage, count).
export async function listGardenEventsSince(since: Date, limit = 50): Promise<GardenEvent[]> {
  const rows = await db()`
    select e.id, e.kind, e.cluster_id, e.created_at, c.title, c.stage, c.mention_count
    from garden_events e join idea_clusters c on c.id = e.cluster_id
    where e.created_at > ${since.toISOString()}::timestamptz
    order by e.created_at, e.id limit ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind as GardenEventKind, clusterId: Number(r.cluster_id), title: String(r.title),
    stage: r.stage as IdeaStage, mentionCount: Number(r.mention_count), createdAt: new Date(r.created_at).toISOString(),
  }));
}
