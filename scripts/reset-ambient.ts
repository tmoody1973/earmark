// Ops: wipe ambient-derived items so the backfill can rebuild them from Bee. One transaction; prints counts only.
// Keeps voice items and processed_journals. Requires --yes.
import { db } from "../agent/lib/db";

if (!process.argv.includes("--yes")) {
  console.error("refusing to run without --yes (deletes ambient recs, ideas, and processed_conversations)");
  process.exit(1);
}

const sql = db();
const [recs, mentions, clusters, recommenders, convs] = await sql.transaction([
  sql`delete from recommendations where source = 'ambient' returning id`,
  sql`delete from idea_mentions where source = 'ambient' returning id`,
  sql`delete from idea_clusters c where not exists (select 1 from idea_mentions m where m.cluster_id = c.id) returning c.id`,
  sql`delete from recommenders p where not exists (select 1 from recommendations r where r.recommender_id = p.id) returning p.id`,
  // unconditional on purpose: processed_conversations only ever holds ambient (Bee conversation) claims; voice notes use processed_journals
  sql`delete from processed_conversations returning bee_conversation_id`,
]);
console.log({
  recommendations: recs.length, ideaMentions: mentions.length, ideaClusters: clusters.length,
  recommenders: recommenders.length, processedConversations: convs.length,
});
