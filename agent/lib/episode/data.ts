import { db } from "../db";
import { ownerFirstName } from "../env";

export interface EpisodeData {
  growing: unknown[]; ready: unknown[]; newInCrate: unknown[]; dontForget: unknown[]; thanksOwed: unknown[];
}

type Row = Record<string, unknown>;

// The owner is never credited as a recommender: a matching first name becomes null (the script then says "you").
export function withoutOwner<T extends Row>(rows: T[], owner = ownerFirstName()): T[] {
  if (!owner) return rows;
  return rows.map((r) => (String(r.first_name ?? "").toLowerCase() === owner.toLowerCase() ? { ...r, first_name: null } : r));
}

export async function gatherEpisodeData(now: Date): Promise<EpisodeData> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [growing, ready, newInCrate, dontForget, thanksOwed] = await Promise.all([
    db()`select title, mention_count, timeline from idea_clusters where stage in ('compost','sprouting') and last_mentioned_at >= ${weekAgo}
         and not idea_is_quiet(id) order by last_mentioned_at desc limit 6`,
    db()`select title, mention_count, draft_format from idea_clusters where stage in ('ready','drafted') order by last_mentioned_at desc limit 4`,
    db()`select r.canonical_name, r.type, r.creator, r.excerpt, rc.first_name from recommendations r left join recommenders rc on rc.id = r.recommender_id
         where r.created_at >= ${weekAgo} and r.status not in ('dismissed','composted','needs_review','overheard') order by r.created_at desc limit 8`,
    db()`select r.canonical_name, r.type, rc.first_name from recommendations r left join recommenders rc on rc.id = r.recommender_id
         where r.status in ('new','queued') and r.created_at < ${twoWeeksAgo} order by r.created_at asc limit 3`,
    db()`select r.canonical_name, rc.first_name from recommendations r join recommenders rc on rc.id = r.recommender_id
         where r.rating = 'loved' and r.status <> 'thanked' limit 5`,
  ]);
  return {
    growing, ready,
    newInCrate: withoutOwner(newInCrate as Row[]),
    dontForget: withoutOwner(dontForget as Row[]),
    thanksOwed: withoutOwner(thanksOwed as Row[]),
  };
}
