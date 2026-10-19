import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { inTransaction } from "../agent/lib/db";
import { formatTimelineDate, NOTE_FIRST } from "../agent/lib/ideas/timeline-format";
import { GARDENER, IDEAS, NAME_CONSENT, PEOPLE, SPACES, TIPS } from "./demo-data";

// Seeds the judge demo's database (decision 053, docs/demo-mode.md) with invented sample data: wipe, then reseed, in
// one transaction. Run: EARMARK_DEMO_SEED_URL=<the demo database's owner URL> pnpm seed:demo
//
// Never production, never TEST. Three locks:
// 1. EARMARK_DEMO_SEED_URL must be set (the script reads no other URL to write to).
// 2. Its host must not be the host of DATABASE_URL or TEST_DATABASE_URL, from .env.local or the shell, nor
//    EARMARK_PROD_DB_HOST (seedTargetProblem).
// 3. The database itself: tips present but no demo marker (sync_cursors 'demo_seed') means it is not the demo, and
//    nothing is wiped (assertDemoTarget). A freshly migrated, empty database is the first seed.

const MARKER = "demo_seed";
const DAY = 86_400_000;

const hostOf = (v: string): string | null => {
  const host = URL.canParse(v) ? new URL(v).hostname : /^[a-z0-9.-]+$/i.test(v) ? v : null;
  return host ? host.toLowerCase().replace("-pooler.", ".") : null;
};

/** Why EARMARK_DEMO_SEED_URL must not be seeded (never naming a URL), or null. `forbidden`: URLs or hosts to refuse. */
export function seedTargetProblem(seedUrl: string | undefined, forbidden: ReadonlyArray<string | undefined>): string | null {
  if (!seedUrl) return "EARMARK_DEMO_SEED_URL is not set (the demo database's owner URL)";
  if (!/^postgres(ql)?:\/\//.test(seedUrl) || !URL.canParse(seedUrl)) return "EARMARK_DEMO_SEED_URL is not a postgres URL";
  const target = hostOf(seedUrl);
  const refused = forbidden.flatMap((f) => (f ? [hostOf(f)] : [])).includes(target);
  return refused ? "EARMARK_DEMO_SEED_URL is the production or TEST database (same host as a DATABASE_URL, TEST_DATABASE_URL or EARMARK_PROD_DB_HOST)" : null;
}

/** Refuses to wipe a database that has tips but no demo marker: that is someone's real (or TEST) garden. */
export async function assertDemoTarget(c: PoolClient): Promise<void> {
  const { rows: [r] } = await c.query(`select exists (select 1 from recommendations) as has_tips,
    exists (select 1 from sync_cursors where name = $1) as marked`, [MARKER]);
  if (r.has_tips && !r.marked) {
    throw new Error("refusing: this database has tips but was never seeded as the demo. Seed only an empty, migrated database or the demo itself.");
  }
}

/** Empties every app table (not schema_migrations) and restarts ids, so the demo's ids are the same after every reseed. */
async function wipe(c: PoolClient): Promise<void> {
  const { rows } = await c.query(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`);
  const tables = rows.map((r) => String(r.tablename));
  if (tables.some((t) => !/^[a-z0-9_]+$/.test(t))) throw new Error("refusing: unexpected table name");
  if (tables.length) await c.query(`truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
}

export interface SeededIds { recommenders: number[]; recs: number[]; ideas: number[]; spaces: number[]; gardeners: number[] }

const id = async (c: PoolClient, sql: string, params: unknown[]) => Number((await c.query(sql, params)).rows[0].id);

/** Writes the sample garden through `c` (no wipe, no commit: the caller owns the transaction). Dates are relative to `now`. */
export async function seedDemo(c: PoolClient, now: Date): Promise<SeededIds> {
  const ago = (days: number, minutes = 0) => new Date(now.getTime() - days * DAY - minutes * 60_000);
  const ids: SeededIds = { recommenders: [], recs: [], ideas: [], spaces: [], gardeners: [] };

  const person = new Map<string, number>();
  for (const name of PEOPLE) {
    const pid = await id(c, `insert into recommenders (first_name, public_name_consent_at) values ($1, $2) returning id`,
      [name, NAME_CONSENT.includes(name) ? ago(30) : null]);
    person.set(name, pid);
    ids.recommenders.push(pid);
  }

  const tip = new Map<string, number>();
  for (const [i, t] of TIPS.entries()) {
    const said = ago(t.daysAgo, 37 * i % 300); // spread across the day, so no two tips share a moment
    const caught = new Date(said.getTime() + 2 * 60_000);
    const unsure = !!t.candidates;
    const rid = await id(c, `insert into recommendations
      (type, raw_text, canonical_name, creator, year_or_address, image_url, links, context_summary, recommender_id,
       attribution_source, excerpt, said_at, created_at, updated_at, lat, lng, source, status, rating, confidence,
       enrichment_status, enriched_at, about, about_url, about_at, extras, extras_at, match_candidates, candidates_at, review_reason)
      values ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14, $15, $16, $17, $18,
       $19, $20, $21, $22, $20, $23, $20, $24, $20, $25) returning id`, [
      t.type, t.name, t.creator ?? null, t.addr ?? null, t.image ?? null, JSON.stringify(t.links ?? {}), t.why ?? null,
      t.from ? person.get(t.from) : null, t.from ? "second_person" : "none", t.excerpt, said, caught,
      t.lat ?? null, t.lng ?? null, t.source ?? "ambient", t.status, t.rating ?? null, t.status === "needs_review" ? 0.75 : 0.93,
      unsure ? "no_match" : "matched", caught, t.about?.text ?? null, t.about?.url ?? null,
      t.extras ? JSON.stringify(t.extras) : null, unsure ? JSON.stringify(t.candidates) : null,
      t.status === "needs_review" ? (t.from ? "confidence_band" : "no_recommender") : null,
    ]);
    tip.set(t.name, rid);
    ids.recs.push(rid);
    if (t.receipt) {
      await c.query(`insert into rec_receipts (recommendation_id, message, share_token, approved_at, sent_via) values ($1, $2, $3, $4, 'link')`,
        [rid, t.receipt.message, t.receipt.token, caught]);
    }
  }

  for (const idea of IDEAS) {
    const kept = idea.mentions.filter((m) => m.status !== "dismissed");
    const times = kept.map((m) => ago(m.daysAgo)).sort((a, b) => a.getTime() - b.getTime());
    const cid = await id(c, `insert into idea_clusters (title, timeline, stage, pinned, mention_count, first_mentioned_at,
        last_mentioned_at, draft_md, draft_format, created_at)
      values ($1, '[]'::jsonb, $2, $3, $4, $5, $6, $7, $8, $5) returning id`,
      [idea.title, idea.stage, idea.pinned ?? false, kept.length, times[0], times.at(-1), idea.draft?.md ?? null, idea.draft?.format ?? null]);
    ids.ideas.push(cid);
    // Timeline lines are written the way the writer writes them: the date by code, the earliest is always "first heard".
    const earliest = Math.max(...idea.mentions.map((m) => m.daysAgo));
    const timeline = [];
    for (const m of idea.mentions) {
      const at = ago(m.daysAgo);
      const mid = await id(c, `insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
        values ($1, $2, $3, 0.9, $4, $5) returning id`, [cid, m.excerpt, at, m.status ?? "accepted", m.source ?? "ambient"]);
      timeline.push({ date: at.toISOString(), line: `${formatTimelineDate(at)}: ${m.daysAgo === earliest ? NOTE_FIRST : m.note}`, mention_id: mid });
    }
    await c.query(`update idea_clusters set timeline = $2::jsonb where id = $1`, [cid, JSON.stringify(timeline)]);
    if (idea.stage === "ready" || idea.stage === "drafted") {
      await c.query(`insert into garden_events (kind, cluster_id, created_at) values ('bloom', $1, $2)`, [cid, times.at(-1)]);
    }
  }

  // Backlinks (decision 026): a tip that fits an idea, and two ideas that belong together.
  const idea = (title: string) => String(ids.ideas[IDEAS.findIndex((i) => i.title === title)]);
  await c.query(`insert into links (from_type, from_id, to_type, to_id, kind, confidence, status, judged_at) values
    ('rec', $1, 'idea', $2, 'fits', 0.9, 'accepted', $4), ('idea', $3, 'idea', $5, 'related', 0.85, 'suggested', $4)`,
    [String(tip.get("Riverwest 24")), idea("A zine about the Riverwest 24"), idea("Monthly listening party at the library"), ago(1),
     idea("A record store walk segment")]);

  for (const s of SPACES) {
    const sid = await id(c, `insert into spaces (name, rule_sentence, published_token, published_at, created_at)
      values ($1, $2, $3, $4, $5) returning id`, [s.name, s.rule, s.publishedToken ?? null, s.publishedToken ? ago(2) : null, ago(20)]);
    ids.spaces.push(sid);
    for (const name of s.tips) {
      await c.query(`insert into space_items (space_id, item_type, item_id, confidence, status, judged_at) values ($1, 'rec', $2, 0.9, 'accepted', $3)`,
        [sid, tip.get(name), ago(3)]);
    }
  }

  const gid = await id(c, `insert into gardeners (name, task, schedule, sources, needs_approval, last_run_at)
    values ($1, $2, $3::jsonb, $4::text[], true, $5) returning id`,
    [GARDENER.name, GARDENER.task, JSON.stringify(GARDENER.schedule), GARDENER.sources, ago(2)]);
  ids.gardeners.push(gid);
  await c.query(`insert into gardener_runs (gardener_id, output_md, status, created_at) values ($1, $2, 'draft', $3)`, [gid, GARDENER.draft, ago(2)]);
  return ids;
}

/** Removes exactly what seedDemo wrote (the e2e run commits the seed on TEST, then calls this). */
export async function removeDemoSeed(c: PoolClient, ids: SeededIds): Promise<void> {
  const text = (xs: number[]) => xs.map(String);
  await c.query(`delete from links where (from_type = 'rec' and from_id = any($1::text[])) or (to_type = 'idea' and to_id = any($2::text[]))
    or (from_type = 'idea' and from_id = any($2::text[]))`, [text(ids.recs), text(ids.ideas)]);
  await c.query(`delete from spaces where id = any($1::bigint[])`, [ids.spaces]); // space_items cascade
  await c.query(`delete from gardeners where id = any($1::bigint[])`, [ids.gardeners]); // runs cascade
  await c.query(`delete from garden_events where cluster_id = any($1::bigint[])`, [ids.ideas]);
  await c.query(`delete from idea_clusters where id = any($1::bigint[])`, [ids.ideas]); // mentions cascade
  await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids.recs]); // receipts cascade
  await c.query(`delete from recommenders where id = any($1::bigint[])`, [ids.recommenders]);
}

async function main() {
  const file = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};
  const env = process.env;
  const problem = seedTargetProblem(env.EARMARK_DEMO_SEED_URL,
    [env.DATABASE_URL, env.TEST_DATABASE_URL, file.DATABASE_URL, file.TEST_DATABASE_URL, env.EARMARK_PROD_DB_HOST, file.EARMARK_PROD_DB_HOST]);
  if (problem) throw new Error(`refusing: ${problem}`);
  const url = env.EARMARK_DEMO_SEED_URL!;
  console.log(`demo database ${new URL(url).hostname.split(".")[0]}`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const ids = await inTransaction(c, false, async () => {
      await assertDemoTarget(c);
      await wipe(c);
      const seeded = await seedDemo(c, new Date());
      await c.query(`insert into sync_cursors (name, cursor) values ($1, $2)`, [MARKER, new Date().toISOString()]);
      return { value: seeded, commit: true };
    });
    console.log(`seeded ${ids.recs.length} tips from ${ids.recommenders.length} people, ${ids.ideas.length} ideas, ${ids.spaces.length} Spaces`);
    const pub = SPACES.find((s) => s.publishedToken);
    if (pub) console.log(`published Space: /s/${pub.publishedToken}`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[seed-demo] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
