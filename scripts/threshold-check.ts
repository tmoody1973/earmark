// Read-only threshold check for backlinks and Spaces on the real garden (M4-T11).
//   pnpm thresholds:check
// One `begin transaction read only` on DATABASE_URL, selects only, always rolled back: a write is impossible.
// Prints ids and numbers only, never idea, tip or Space text (no titles, names or rule sentences are printed).
// Also the M4 done-condition evidence SQL can give (garden levels, People counts, pins, merges).
import { Pool } from "@neondatabase/serverless";
import { inTransaction } from "../agent/lib/db";
import { buildLedger } from "../agent/lib/garden/ledger";
import { plantLevel } from "../agent/lib/garden/plant";
import { credit, HIDDEN_TIP_STATUSES } from "../agent/lib/garden/queries";
import type { IdeaStage, Rating, RecStatus } from "../agent/lib/types";
import {
  IDEA_PAIR_MAX_DISTANCE, LINK_MIN, MERGE_MIN, NEIGHBOURS_PER_ITEM, REC_IDEA_MAX_DISTANCE,
} from "../agent/lib/links/criteria";
import { SPACE_MIN } from "../agent/lib/spaces/criteria";

const SWEEP_P = [0.5, 0.6, 0.7, 0.8, 0.9];
const SWEEP_D = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
const VIS = "stage <> 'dismissed' and mention_count > 0 and centroid is not null";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const pool = new Pool({ connectionString: url });
const c = await pool.connect();
const q = async (text: string, params: unknown[] = []) => (await c.query(text, params)).rows;
const show = (label: string, rows: unknown) => console.log(`\n## ${label}\n${JSON.stringify(rows, null, 0).replaceAll("},{", "},\n {")}`);

try {
  await inTransaction(c, true, async () => {
    show("knobs", { LINK_MIN, MERGE_MIN, IDEA_PAIR_MAX_DISTANCE, REC_IDEA_MAX_DISTANCE, NEIGHBOURS_PER_ITEM, SPACE_MIN });
    show("visible ideas / tips", await q(
      `select (select count(*)::int from idea_clusters where ${VIS}) as ideas,
              (select count(*)::int from recommendations where status <> all($1::text[])) as tips_visible,
              (select count(*)::int from recommendations where status <> all($1::text[]) and embedding is not null) as tips_embedded`,
      [HIDDEN_TIP_STATUSES]));

    // Every links row with Jev's confidence and the embedding distance between its two sides.
    show("links (id pair, kind, status, confidence, distance)", await q(
      `select l.kind, l.status, l.from_id, l.to_id, round(l.confidence::numeric, 3) as p,
              round((case when l.from_type = 'idea' then a.centroid <=> b.centroid else r.embedding <=> b.centroid end)::numeric, 3) as dist
       from links l
       left join idea_clusters a on l.from_type = 'idea' and a.id = l.from_id::bigint
       left join recommendations r on l.from_type = 'rec' and r.id = l.from_id::bigint
       left join idea_clusters b on l.to_type = 'idea' and b.id = l.to_id::bigint
       where l.kind in ('related', 'merge_suggestion', 'fits')
       order by l.kind, l.confidence desc nulls last`));

    show("links admitted per confidence floor (rows / distinct ideas / distinct tips)", await q(
      `select f.p as floor, l.kind,
              count(distinct (l.from_id, l.to_id)) filter (where l.confidence >= f.p)::int as rows,
              count(distinct x.idea) filter (where l.confidence >= f.p)::int as ideas,
              count(distinct l.from_id) filter (where l.confidence >= f.p and l.from_type = 'rec')::int as tips
       from unnest($1::real[]) f(p) cross join links l
       cross join lateral (values (case when l.from_type = 'idea' then l.from_id end), (l.to_id)) x(idea)
       where l.kind in ('related', 'merge_suggestion', 'fits') and l.status <> 'removed'
       group by 1, 2 order by 2, 1`, [SWEEP_P]));

    // The candidate stage: how many idea pairs / tip→idea pairs each distance knob lets through to Jev (kNN as in
    // candidates.ts) and how many distinct ideas / tips have at least one partner under it.
    show("idea-pair candidates per max distance (kNN " + NEIGHBOURS_PER_ITEM + ")", await q(
      `with vis as (select id, centroid from idea_clusters where ${VIS}),
       near as (select least(a.id, n.id) lo, greatest(a.id, n.id) hi, n.dist from vis a cross join lateral (
         select b.id, a.centroid <=> b.centroid as dist from vis b where b.id <> a.id order by 2 limit $2) n)
       select d.max as max_dist, count(distinct (lo, hi)) filter (where dist < d.max)::int as pairs,
              (select count(distinct v) from near n2, unnest(array[n2.lo, n2.hi]) v where n2.dist < d.max)::int as ideas
       from unnest($1::real[]) d(max) cross join near group by 1 order by 1`, [SWEEP_D, NEIGHBOURS_PER_ITEM]));

    show("tip→idea candidates per max distance (kNN " + NEIGHBOURS_PER_ITEM + ")", await q(
      `with vis as (select id, centroid from idea_clusters where ${VIS}),
       near as (select r.id rec_id, n.id idea_id, n.dist from recommendations r cross join lateral (
         select c.id, r.embedding <=> c.centroid as dist from vis c order by 2 limit $3) n
         where r.embedding is not null and r.status <> all($2::text[]))
       select d.max as max_dist, count(*) filter (where dist < d.max)::int as pairs,
              count(distinct rec_id) filter (where dist < d.max)::int as tips,
              count(distinct idea_id) filter (where dist < d.max)::int as ideas
       from unnest($1::real[]) d(max) cross join near group by 1 order by 1`, [SWEEP_D, HIDDEN_TIP_STATUSES, NEIGHBOURS_PER_ITEM]));

    show("nearest-neighbour distance percentiles", await q(
      `with vis as (select id, centroid from idea_clusters where ${VIS}),
       idea_nn as (select (select a.centroid <=> b.centroid from vis b where b.id <> a.id order by 1 limit 1) d from vis a),
       tip_nn as (select (select r.embedding <=> c.centroid from vis c order by 1 limit 1) d from recommendations r
                  where r.embedding is not null and r.status <> all($1::text[]))
       select 'idea→idea' as kind, count(d)::int as n, ${pct("d")} from idea_nn
       union all select 'tip→idea', count(d)::int, ${pct("d")} from tip_nn`, [HIDDEN_TIP_STATUSES]));

    show("spaces (id, items by status, confidence percentiles)", await q(
      `select s.id as space_id, count(si.*)::int as rows,
              count(*) filter (where si.status = 'accepted')::int as kept,
              count(*) filter (where si.status = 'removed')::int as removed,
              count(*) filter (where si.confidence is null)::int as unanswered,
              count(*) filter (where si.item_type = 'idea')::int as idea_rows,
              count(*) filter (where si.item_type = 'rec')::int as tip_rows,
              ${pct("si.confidence")}
       from spaces s left join space_items si on si.space_id = s.id group by s.id order by s.id`));

    show("space_items admitted per floor (per space: ideas / tips shown, kept always shown)", await q(
      `select si.space_id, f.p as floor,
              count(*) filter (where si.item_type = 'idea' and (si.status = 'accepted' or (si.status = 'suggested' and si.confidence >= f.p)))::int as ideas,
              count(*) filter (where si.item_type = 'rec' and (si.status = 'accepted' or (si.status = 'suggested' and si.confidence >= f.p)))::int as tips
       from unnest($1::real[]) f(p) cross join space_items si group by 1, 2 order by 1, 2`, [SWEEP_P]));

    show("space_items confidence histogram (all spaces, 0.1 buckets)", await q(
      `select width_bucket(confidence, 0, 1.0000001, 10) - 1 as decile, count(*)::int as n
       from space_items where confidence is not null group by 1 order by 1`));

    show("space_items near the floor (0.5 ≤ p < 0.9: space, type, item id, p)", await q(
      `select space_id, item_type, item_id, status, round(confidence::numeric, 3) as p from space_items
       where confidence >= 0.5 and confidence < 0.9 order by space_id, confidence desc`));
    // ---- M4 done-condition evidence (read-only) ----
    show("garden: visible ideas by stage → plant level", (await q(
      `select stage, count(*)::int as n, (array_agg(id order by last_mentioned_at desc nulls last))[1:2] as sample_ids
       from idea_clusters where stage <> 'dismissed' and mention_count > 0 group by stage order by stage`))
      .map((r) => ({ ...r, level: plantLevel(r.stage as IdeaStage) })));

    // People: the ledger the page builds (buildLedger over the shelf's rows, owner guard via credit) vs a plain SQL count.
    const tips = await q(
      `select r.said_at, r.status, r.rating, p.id as recommender_id, p.first_name
       from recommendations r left join recommenders p on p.id = r.recommender_id
       where r.status <> all($1::text[])`, [HIDDEN_TIP_STATUSES]);
    const ledger = buildLedger(tips.map((r) => ({
      name: "", saidAt: new Date(r.said_at).toISOString(), status: r.status as RecStatus, rating: r.rating as Rating | null,
      recommender: credit(r),
    })));
    const sqlCounts = new Map((await q(
      `select recommender_id as id, count(*)::int as given,
              count(*) filter (where status in ('tried', 'thanked') or rating is not null)::int as tried,
              count(*) filter (where rating = 'loved')::int as loved
       from recommendations where status <> all($1::text[]) and recommender_id is not null group by 1`, [HIDDEN_TIP_STATUSES]))
      .map((r) => [Number(r.id), r]));
    const mismatched = ledger.people.filter((p) => {
      const s = sqlCounts.get(p.id);
      return !s || s.given !== p.given || s.tried !== p.tried || s.loved !== p.loved;
    }).map((p) => p.id);
    show("people: ledger vs SQL", {
      people_on_page: ledger.people.length, recommenders_in_sql: sqlCounts.size, unknown_tips: ledger.unknown,
      mismatched_ids: mismatched,
      per_person: ledger.people.map((p) => ({ id: p.id, given: p.given, tried: p.tried, loved: p.loved })),
    });

    show("top of mind: pinned ideas and their idea facts", await q(
      `select c.id, c.stage, c.flagged_at is not null as flagged,
              (select count(*)::int from fact_proposals f where f.kind = 'idea' and f.status = 'pending' and f.evidence_ids @> jsonb_build_array(c.id)) as pending_facts,
              (select count(*)::int from fact_proposals f where f.kind = 'idea' and f.bee_fact_id is not null and f.evidence_ids @> jsonb_build_array(c.id)) as posted_facts
       from idea_clusters c where c.pinned order by c.id`));

    show("merges (M4-T6): ids, undone, Notion page present", await q(
      `select mg.id, mg.keep_id, mg.merged_id, mg.undone_at is not null as undone, m.stage as merged_stage,
              k.notion_page_id is not null as keep_has_notion, m.notion_page_id is not null as merged_has_notion
       from idea_merges mg join idea_clusters k on k.id = mg.keep_id join idea_clusters m on m.id = mg.merged_id order by mg.id`));
    show("links Tarik decided (accepted / removed)", await q(
      `select kind, status, count(*)::int as n from links where status <> 'suggested' group by 1, 2 order by 1, 2`));

    return { value: null, commit: false }; // always roll back
  });
} finally {
  c.release();
  await pool.end();
}

function pct(col: string): string {
  return `round(min(${col})::numeric, 3) as min,
          round((percentile_cont(0.25) within group (order by ${col}))::numeric, 3) as p25,
          round((percentile_cont(0.5) within group (order by ${col}))::numeric, 3) as p50,
          round((percentile_cont(0.75) within group (order by ${col}))::numeric, 3) as p75,
          round(max(${col})::numeric, 3) as max`;
}
