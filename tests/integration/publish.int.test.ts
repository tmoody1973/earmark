import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { getPublishedSpace, publishSpace, setNameConsent, unpublishSpace } from "../../agent/lib/spaces/publish";

// Real Neon test branch (needs TEST_DATABASE_URL; skipped otherwise). Synthetic rows only ("IT publish …"), all removed after.
describe.skipIf(!process.env.TEST_DATABASE_URL)("Publishing a Space on the Neon test branch (M5-T14)", { timeout: 60_000 }, () => {
  let pool: Pool;
  let c: PoolClient;
  let space = 0;
  let person = 0;
  const names = {} as Record<string, number>;

  const cleanup = async () => {
    await c.query(`delete from spaces where rule_sentence like 'IT publish%'`);
    await c.query(`delete from recommendations where raw_text = 'it publish'`);
    await c.query(`delete from idea_clusters where title like 'IT publish%'`);
    await c.query(`delete from recommenders where first_name = 'ITPublishAnn'`);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
    await cleanup();
    space = Number((await c.query(`insert into spaces (name, rule_sentence) values ('IT publish sample', 'IT publish sample') returning id`)).rows[0].id);
    person = Number((await c.query(`insert into recommenders (first_name, recs_given) values ('ITPublishAnn', 0) returning id`)).rows[0].id);
    const tip = async (key: string, status: string) => {
      const id = Number((await c.query(
        `insert into recommendations (type, raw_text, canonical_name, recommender_id, excerpt, context_summary, said_at, source, status, confidence)
         values ('book', 'it publish', $1, $2, 'EXCERPT-SECRET', 'SUMMARY-SECRET', now(), 'ambient', $3, 0.95) returning id`,
        [`IT publish ${key}`, person, status])).rows[0].id);
      names[key] = id;
      return id;
    };
    const member = (type: string, id: number, status: string) =>
      c.query(`insert into space_items (space_id, item_type, item_id, confidence, status) values ($1, $2, $3, 0.9, $4)`, [space, type, id, status]);
    await member("rec", await tip("kept", "new"), "accepted");
    await member("rec", await tip("suggested", "new"), "suggested");
    await member("rec", await tip("removed", "new"), "removed");
    await member("rec", await tip("hidden", "needs_review"), "accepted");
    const idea = Number((await c.query(
      `insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at) values ('IT publish idea', 'sprouting', 2, now(), now()) returning id`)).rows[0].id);
    await member("idea", idea, "accepted");
  });

  afterAll(async () => {
    await cleanup();
    c.release();
    await pool.end();
  });

  it("shows only kept tips, no ideas, no words, and names only with consent; unpublish kills the link", async () => {
    const token = await publishSpace(space);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await publishSpace(space)).toBe(token); // re-publish keeps the link

    const view = await getPublishedSpace(token!);
    expect(view?.tips.map((t) => t.name)).toEqual(["IT publish kept"]);
    expect(JSON.stringify(view)).not.toMatch(/SECRET|IT publish idea/);
    expect(view?.tips[0].recommender).toBeNull(); // no consent yet

    await setNameConsent(person, true);
    expect((await getPublishedSpace(token!))?.tips[0].recommender?.firstName).toBe("ITPublishAnn");
    await setNameConsent(person, false);
    expect((await getPublishedSpace(token!))?.tips[0].recommender).toBeNull();

    expect(await unpublishSpace(space)).toBe(true);
    expect(await getPublishedSpace(token!)).toBeNull();
  });
});
