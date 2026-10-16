import { db } from "../db";
import type { IdeaStage, RecStatus, RecType } from "../types";

export type GardenItem =
  | { kind: "rec"; id: number; name: string; type: RecType; recommender: string | null; excerpt: string; status: RecStatus; at: Date }
  | { kind: "idea"; id: number; title: string; stage: IdeaStage; mentions: number; at: Date };

// Explicit column lists on purpose: raw_text never leaves the database through this path.
export async function listGardenItems(limit = 50): Promise<GardenItem[]> {
  const sql = db();
  const recs = await sql`
    select r.id, r.canonical_name, r.type, r.excerpt, r.status, r.said_at, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.status not in ('dismissed', 'composted')
    order by r.said_at desc nulls last limit ${limit}`;
  const ideas = await sql`
    select id, title, stage, mention_count, last_mentioned_at
    from idea_clusters where mention_count > 0 and stage <> 'dismissed'
    order by last_mentioned_at desc nulls last limit ${limit}`;
  const items: GardenItem[] = [
    ...recs.map((r): GardenItem => ({
      kind: "rec", id: Number(r.id), name: r.canonical_name, type: r.type, recommender: r.first_name ?? null,
      excerpt: r.excerpt, status: r.status, at: new Date(r.said_at),
    })),
    ...ideas.map((i): GardenItem => ({
      kind: "idea", id: Number(i.id), title: i.title, stage: i.stage, mentions: Number(i.mention_count), at: new Date(i.last_mentioned_at),
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
