import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// The tip page's data (/tips/[id]) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
describe.skipIf(!process.env.TEST_DATABASE_URL)("getTipDetail on the Neon test branch", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids = { recs: [] as number[], people: [] as number[], spaces: [] as number[], ideas: [] as number[] };
  const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    const recIds = ids.recs.map(String);
    await c.query(`delete from links where from_type = 'rec' and from_id = any($1::text[])`, [recIds]);
    await c.query(`delete from space_items where item_type = 'rec' and item_id = any($1::bigint[])`, [ids.recs]);
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids.recs]);
    await c.query(`delete from recommenders where id = any($1::bigint[])`, [ids.people]);
    await c.query(`delete from spaces where id = any($1::bigint[])`, [ids.spaces]);
    await c.query(`delete from idea_clusters where id = any($1::bigint[])`, [ids.ideas]);
    c.release();
    await pool.end();
  });

  it("returns the card, the excerpt, link buttons, stored extras, accepted Spaces and linked ideas", async () => {
    const { getTipDetail } = await import("../../agent/lib/garden/tip-detail");
    const ann = Number((await one(`insert into recommenders (first_name) values ('Annika') returning id`)).id);
    ids.people.push(ann);
    const extras = { preview: { audioUrl: "https://audio-ssl.itunes.apple.com/p.m4a", appleUrl: "https://music.apple.com/us/album/x/1" } };
    const rec = Number((await one(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, confidence, recommender_id,
         links, extras, extras_at, about, about_url)
       values ('album', 'it tip', 'IT Tip Album', 'IT Band', 'you have to hear this record', '2026-10-01T15:00:00Z', 'ambient', 0.9, $1,
         $2::jsonb, $3::jsonb, now(), 'IT Band are a band.', 'https://en.wikipedia.org/wiki/IT_Band') returning id`,
      [ann, JSON.stringify({ apple_music: "https://music.apple.com/us/album/x/1" }), JSON.stringify(extras)])).id);
    ids.recs.push(rec);
    const [kept, suggested] = [await one(`insert into spaces (name, rule_sentence) values ('IT kept', 'it') returning id`),
      await one(`insert into spaces (name, rule_sentence) values ('IT suggested', 'it') returning id`)].map((r) => Number(r.id));
    ids.spaces.push(kept, suggested);
    await c.query(`insert into space_items (space_id, item_type, item_id, confidence, status) values ($1, 'rec', $3, 0.9, 'accepted'),
      ($2, 'rec', $3, 0.95, 'suggested')`, [kept, suggested, rec]);
    const idea = async (title: string, stage = "sprouting") => {
      const id = Number((await one(`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at)
        values ($1, $2, 2, now(), now()) returning id`, [title, stage])).id);
      ids.ideas.push(id);
      return id;
    };
    const [fits, weak, removed, gone] = [await idea("IT fits"), await idea("IT weak"), await idea("IT removed"), await idea("IT gone", "dismissed")];
    const link = (to: number, confidence: number, status = "suggested") => c.query(`insert into links (from_type, from_id, to_type, to_id, kind,
      confidence, status) values ('rec', $1, 'idea', $2, 'fits', $3, $4)`, [String(rec), String(to), confidence, status]);
    await link(fits, 0.9);
    await link(weak, 0.3);
    await link(removed, 0.95, "removed");
    await link(gone, 0.95, "accepted");

    const tip = await getTipDetail(rec);
    expect(tip).toMatchObject({
      card: { id: rec, name: "IT Tip Album", creator: "IT Band", recommender: { id: ann, firstName: "Annika" },
        about: { text: "IT Band are a band.", url: "https://en.wikipedia.org/wiki/IT_Band" } },
      excerpt: "you have to hear this record",
      links: [{ label: "Listen · Apple Music", url: "https://music.apple.com/us/album/x/1" }],
      extras,
      spaces: [{ id: kept, name: "IT kept" }], // accepted only: a suggestion isn't "in" the Space yet
      ideas: [{ id: fits, title: "IT fits" }], // at or above the shown floor, not removed, idea not dismissed
    });
    expect(await getTipDetail(rec + 1_000_000)).toBeNull();
  });

  it("a tip the lane hasn't reached has no extras", async () => {
    const { getTipDetail } = await import("../../agent/lib/garden/tip-detail");
    const rec = Number((await one(`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, confidence)
      values ('book', 'it tip', 'IT Tip Book', 'read it', now(), 'voice', 0.9) returning id`)).id);
    ids.recs.push(rec);
    expect(await getTipDetail(rec)).toMatchObject({ extras: {}, links: [], spaces: [], ideas: [], card: { recommender: null } });
  });
});
