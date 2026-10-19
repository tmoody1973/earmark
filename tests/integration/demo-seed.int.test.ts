import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { IDEAS, NAME_CONSENT, PEOPLE, SPACES, TIPS } from "../../scripts/demo-data";
import { assertDemoTarget, seedDemo, type SeededIds } from "../../scripts/seed-demo";

// The judge demo's seed (decision 053) on the Neon `test` branch (TEST_DATABASE_URL, never production). Everything runs
// inside one transaction that is rolled back: the shared TEST branch never keeps a demo row.
describe.skipIf(!process.env.TEST_DATABASE_URL)("demo seed on the Neon test branch, rolled back", () => {
  let pool: Pool;
  let c: PoolClient;
  const count = async (sql: string, params: unknown[]) => Number((await c.query(sql, params)).rows[0].n);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  afterAll(async () => {
    c?.release();
    await pool?.end();
  });

  it("refuses to wipe a database that has tips but was never seeded as the demo (TEST is one)", async () => {
    await expect(assertDemoTarget(c)).rejects.toThrow(/never seeded as the demo/);
  });

  it("writes the whole sample garden, then leaves nothing behind", async () => {
    let ids: SeededIds | undefined;
    await c.query("begin");
    try {
      ids = await seedDemo(c, new Date());
      expect(ids.recs).toHaveLength(TIPS.length);
      expect(ids.recommenders).toHaveLength(PEOPLE.length);
      expect(ids.ideas).toHaveLength(IDEAS.length);
      expect(ids.spaces).toHaveLength(SPACES.length);

      const byStatus = (await c.query(
        `select status, count(*)::int as n from recommendations where id = any($1::bigint[]) group by status`, [ids.recs])).rows;
      expect(Object.fromEntries(byStatus.map((r) => [r.status, r.n]))).toMatchObject({
        new: expect.any(Number), queued: expect.any(Number), tried: expect.any(Number), thanked: 2, needs_review: 2, overheard: 3,
      });
      // Heard nearby shows the last two weeks; Serendipity needs tips older than three days (caught, not just said).
      expect(await count(`select count(*) as n from recommendations where id = any($1::bigint[]) and status = 'overheard'
        and said_at >= now() - interval '14 days' and recommender_id is null`, [ids.recs])).toBe(3);
      expect(await count(`select count(*) as n from recommendations where id = any($1::bigint[]) and status in ('new', 'queued')
        and greatest(said_at, created_at) < now() - interval '3 days'`, [ids.recs])).toBeGreaterThan(3);
      // "Which one?": Earmark's own guess, unmatched, with the options kept (agent/lib/garden/which-one.ts asksWhichOne).
      const asks = (await c.query(`select canonical_name, jsonb_array_length(match_candidates) as n from recommendations
        where id = any($1::bigint[]) and match_source = 'auto' and enrichment_status = 'no_match' and owner_none_at is null
          and match_candidates is not null order by canonical_name`, [ids.recs])).rows;
      expect(asks).toEqual([{ canonical_name: "Colectivo", n: 3 }, { canonical_name: "Heroes", n: 2 }]);
      expect(await count(`select count(*) as n from recommendations where id = any($1::bigint[]) and extras is not null`, [ids.recs]))
        .toBeGreaterThanOrEqual(2);
      // The owner is never a recommender; two people agreed to be named on a published Space.
      expect(await count(`select count(*) as n from recommenders where id = any($1::bigint[]) and first_name = 'Sam'`, [ids.recommenders])).toBe(0);
      expect(await count(`select count(*) as n from recommenders where id = any($1::bigint[]) and public_name_consent_at is not null`,
        [ids.recommenders])).toBe(NAME_CONSENT.length);
      expect(await count(`select count(*) as n from rec_receipts where recommendation_id = any($1::bigint[]) and approved_at is not null
        and share_token ~ '^[A-Za-z0-9_-]{43}$'`, [ids.recs])).toBe(2);

      // The garden: every idea but the dismissed one grows (getPlants), two bloomed with a bloom event, one pinned.
      expect(await count(`select count(*) as n from idea_clusters where id = any($1::bigint[]) and stage <> 'dismissed' and mention_count > 0`,
        [ids.ideas])).toBe(IDEAS.length - 1);
      expect(await count(`select count(*) as n from garden_events where cluster_id = any($1::bigint[]) and kind = 'bloom'`, [ids.ideas])).toBe(2);
      expect(await count(`select count(*) as n from idea_clusters where id = any($1::bigint[]) and pinned`, [ids.ideas])).toBe(1);
      expect(await count(`select count(*) as n from idea_clusters where id = any($1::bigint[]) and jsonb_array_length(timeline) = mention_count`,
        [ids.ideas])).toBe(IDEAS.length); // one timeline line per mention, as the save path writes them

      // One published Space at its fixed token, holding its tips.
      const pub = SPACES.find((s) => s.publishedToken)!;
      expect(await count(`select count(*) as n from space_items si join spaces s on s.id = si.space_id
        where s.published_token = $1 and si.status = 'accepted' and si.item_type = 'rec'`, [pub.publishedToken])).toBe(pub.tips.length);
      expect(await count(`select count(*) as n from gardener_runs where gardener_id = any($1::bigint[]) and status = 'draft'`, [ids.gardeners])).toBe(1);
    } finally {
      await c.query("rollback");
    }
    expect(await count(`select count(*) as n from recommendations where id = any($1::bigint[])`, [ids!.recs])).toBe(0);
    expect(await count(`select count(*) as n from idea_clusters where id = any($1::bigint[])`, [ids!.ideas])).toBe(0);
  });
});
