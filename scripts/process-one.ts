// Live check: process ONE real COMPLETED conversation twice (second run must skip).
// Usage: pnpm tsx --env-file=.env.local scripts/process-one.ts [conversationId]
// Without an id, picks the shortest COMPLETED conversation in the first 3 pages. Prints ids, counts and
// canonical names/types only: never transcript text, excerpts or raw_text.
import { createBeeClient, toDate } from "../agent/lib/bee/client";
import { db } from "../agent/lib/db";
import { processConversation } from "../agent/lib/pipeline/process-conversation";

const bee = createBeeClient();
const sql = db();

async function pickShortest(): Promise<number> {
  let cursor: string | undefined;
  let best: { id: number; ms: number } | null = null;
  for (let page = 0; page < 3; page += 1) {
    const r = await bee.listConversations({ limit: 50, ...(cursor ? { cursor } : {}) });
    for (const c of r.conversations) {
      const s = toDate(c.start_time)?.getTime();
      const e = toDate(c.end_time)?.getTime();
      if (c.state !== "COMPLETED" || s === undefined || e === undefined) continue;
      if (!best || e - s < best.ms) best = { id: c.id, ms: e - s };
    }
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  if (!best) throw new Error("no COMPLETED conversation found");
  return best.id;
}

const counts = async () => ({
  recs: (await sql`select count(*)::int as n from recommendations`)[0]!.n,
  mentions: (await sql`select count(*)::int as n from idea_mentions`)[0]!.n,
  clusters: (await sql`select count(*)::int as n from idea_clusters`)[0]!.n,
});

const id = process.argv[2] ? Number(process.argv[2]) : await pickShortest();
console.log("conversation", id);
console.log("rows before", await counts());
const first = await processConversation(id);
console.log("run 1", first);
const second = await processConversation(id);
console.log("run 2", second);
console.log("rows after", await counts());
console.log("saved recs", await sql`select r.id, r.canonical_name, r.type, r.status, p.first_name as recommender, r.attribution_source, r.source, r.deliberate_key
  from recommendations r left join recommenders p on p.id = r.recommender_id where r.bee_conversation_id = ${id}`);
console.log("saved ideas", await sql`select c.id, c.title, c.stage, m.review_status, m.source, m.deliberate_key
  from idea_mentions m join idea_clusters c on c.id = m.cluster_id where m.bee_conversation_id = ${id}`);
console.log("done flag", await sql`select done from processed_conversations where bee_conversation_id = ${id}`);
