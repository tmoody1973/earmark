// Prints counts plus the 10 newest recs' canonical names, types and recommender first names (local terminal only).
// No excerpts, raw_text or transcript text is ever selected.
import { db } from "../agent/lib/db";

const sql = db();
console.log("recs by type:", await sql`select type, count(*)::int as n from recommendations group by 1 order by 1`);
console.log("recs by status:", await sql`select status, count(*)::int as n from recommendations group by 1 order by 1`);
console.log("idea_clusters by stage:", await sql`select stage, count(*)::int as n from idea_clusters group by 1 order by 1`);
console.log("idea_mentions by review_status:", await sql`select review_status, count(*)::int as n from idea_mentions group by 1 order by 1`);
console.log("processed_conversations:", await sql`select count(*)::int as n from processed_conversations`);
console.log("processed_journals:", await sql`select count(*)::int as n from processed_journals`);
console.log(
  "newest recs:",
  await sql`select r.canonical_name, r.type, p.first_name as recommender
            from recommendations r left join recommenders p on p.id = r.recommender_id
            order by r.said_at desc limit 10`,
);
