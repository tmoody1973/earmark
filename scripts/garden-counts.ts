// Prints counts, titles of ideas with 2+ mentions, and the 10 newest recs' canonical names, types and recommender
// first names (local terminal only).
// No excerpts, raw_text or transcript text is ever selected.
import { db } from "../agent/lib/db";

const sql = db();
console.log("recs by type:", await sql`select type, count(*)::int as n from recommendations group by 1 order by 1`);
console.log("recs by status:", await sql`select status, count(*)::int as n from recommendations group by 1 order by 1`);
console.log("idea_clusters by stage:", await sql`select stage, count(*)::int as n from idea_clusters group by 1 order by 1`);
console.log(
  "idea_clusters by mention_count:",
  await sql`select mention_count, count(*)::int as n from idea_clusters group by 1 order by 1`,
);
console.log(
  "idea clusters with 2+ mentions (title, stage, mentions, distinct occasions, confirmed):",
  await sql`select c.title, c.stage, c.mention_count,
                   (select count(distinct coalesce(m.bee_conversation_id::text, m.bee_journal_id)) from idea_mentions m
                     where m.cluster_id = c.id and m.review_status <> 'dismissed')::int as occasions,
                   exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed
            from idea_clusters c where c.mention_count >= 2 order by c.mention_count desc, c.id`,
);
// Confirmed = at least one accepted mention (derived, decision 004); unconfirmed = review-band mentions only.
console.log(
  "idea clusters summary:",
  await sql`select count(*) filter (where mention_count >= 2)::int as with_2_plus,
                   count(*) filter (where mention_count >= 3)::int as with_3_plus,
                   count(*) filter (where confirmed)::int as confirmed,
                   count(*) filter (where not confirmed)::int as unconfirmed
            from (select c.mention_count,
                         exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed
                  from idea_clusters c) s`,
);
console.log("idea_mentions by review_status:", await sql`select review_status, count(*)::int as n from idea_mentions group by 1 order by 1`);
console.log("processed_conversations:", await sql`select count(*)::int as n from processed_conversations`);
console.log("processed_journals:", await sql`select count(*)::int as n from processed_journals`);
console.log(
  "newest recs:",
  await sql`select r.canonical_name, r.type, p.first_name as recommender
            from recommendations r left join recommenders p on p.id = r.recommender_id
            order by r.said_at desc limit 10`,
);
