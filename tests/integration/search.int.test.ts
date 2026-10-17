import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// No Bee or model calls: neural search is an injected fake.
const RUN = Date.now() % 1_000_000_000;
const TOKEN = `zorbo${RUN}`; // scopes every query to rows this run seeded
const CONV = 7_000_000_000_000 + RUN * 10; // far from the other suites' conversation-id ranges
const SEPT = "2026-09-12T18:00:00Z";
const AUG = "2026-08-12T18:00:00Z";
const septRange = { since: new Date("2026-09-01T05:00:00Z"), until: new Date("2026-10-01T05:00:00Z") };

describe.skipIf(!process.env.TEST_DATABASE_URL)("memory-cue search on the Neon test branch", () => {
  const mods = async () => ({ ...(await import("../../agent/lib/db")), ...(await import("../../agent/lib/search/memory-cue")) });
  const ids = { ann: 0, bob: 0 };
  const fake = (hits: { id: number; locations?: string[] }[]) => ({
    neuralSearch: async () => ({
      total: hits.length,
      results: hits.map((h) => ({ id: h.id, started_at: 0, stopped_at: 0, link: "", locations: h.locations ?? [], short_summary: "", detailed_summary: "" })),
    }),
  });
  const names = (r: { recs: { name: string }[] }) => r.recs.map((x) => x.name).sort();
  const titles = (r: { ideas: { title: string }[] }) => r.ideas.map((x) => x.title).sort();

  async function rec(name: string, o: { rec?: number; at?: string; addr?: string; conv?: number; lat?: number; lng?: number; status?: string } = {}) {
    const { db } = await mods();
    await db()`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, confidence, recommender_id,
        year_or_address, bee_conversation_id, lat, lng, status)
      values ('place', 'raw', ${name}, 'short excerpt', ${o.at ?? SEPT}, 'ambient', 0.9, ${o.rec ?? null},
        ${o.addr ?? null}, ${o.conv ?? null}, ${o.lat ?? null}, ${o.lng ?? null}, ${o.status ?? "new"})`;
  }
  async function idea(title: string, o: { stage?: string; at?: string; conv?: number; status?: string; excerpt?: string } = {}) {
    const { db } = await mods();
    const [c] = await db()`insert into idea_clusters (title, stage, mention_count) values (${title}, ${o.stage ?? "sprouting"}, 1) returning id`;
    await db()`insert into idea_mentions (cluster_id, bee_conversation_id, excerpt, spoken_at, confidence, review_status, source)
      values (${c.id}, ${o.conv ?? null}, ${o.excerpt ?? "an excerpt"}, ${o.at ?? SEPT}, 0.9, ${o.status ?? "accepted"}, 'ambient')`;
  }

  beforeAll(async () => {
    const { db } = await mods();
    const sql = db();
    const [ann] = await sql`insert into recommenders (first_name) values (${`Ann${RUN}`}) returning id`;
    const [bob] = await sql`insert into recommenders (first_name) values (${`Bob${RUN}`}) returning id`;
    ids.ann = Number(ann.id);
    ids.bob = Number(bob.id);
    await rec(`${TOKEN} ann-sept`, { rec: ids.ann });
    await rec(`${TOKEN} ann-aug`, { rec: ids.ann, at: AUG });
    await rec(`${TOKEN} bob-sept`, { rec: ids.bob });
    await rec(`${TOKEN} dismissed`, { rec: ids.ann, status: "dismissed" });
    await rec(`neural-hit ${RUN}`, { conv: CONV + 1 }); // matches only through Bee's conversation id
    await rec(`neural-miss ${RUN}`, { conv: CONV + 2 });
    await rec(`brady-placed ${RUN}`, { conv: CONV + 3 }); // Bee says the conversation was on Brady Street
    await rec(`elsewhere-placed ${RUN}`, { conv: CONV + 4 });
    await rec(`${TOKEN} near`, { lat: 43.04, lng: -87.91 });
    await rec(`${TOKEN} far`, { lat: 41.88, lng: -87.63 });
    await rec(`${TOKEN} addr`, { addr: "1234 Brady Street" });
    await idea(`${TOKEN} idea-sept`);
    await idea(`${TOKEN} idea-aug`, { at: AUG });
    await idea(`${TOKEN} idea-dismissed-stage`, { stage: "dismissed" });
    await idea(`${TOKEN} idea-dismissed-mention`, { status: "dismissed" });
    await idea(`neural-idea ${RUN}`, { conv: CONV + 5 });
  });

  afterAll(async () => {
    const { db } = await mods();
    const sql = db();
    await sql`delete from recommendations where canonical_name like ${`%${TOKEN}%`} or canonical_name like ${`%${RUN}`}`;
    await sql`delete from idea_clusters where title like ${`%${TOKEN}%`} or title like ${`%${RUN}`}`; // mentions cascade
    await sql`delete from recommenders where id = any(${[ids.ann, ids.bob]}::bigint[])`;
  });

  it("who: only that recommender's tips, and no ideas", async () => {
    const { searchEarmarks } = await mods();
    const out = await searchEarmarks({ who: `ann${RUN}`, query: TOKEN }, { useNeural: false });
    expect(names(out)).toEqual([`${TOKEN} ann-aug`, `${TOKEN} ann-sept`]); // dismissed tip excluded
    expect(out.recs[0].recommender).toMatchObject({ id: ids.ann, firstName: `Ann${RUN}` });
    expect(out.ideas).toEqual([]);
  });

  it("when: only tips and idea mentions inside the range", async () => {
    const { searchEarmarks } = await mods();
    const out = await searchEarmarks({ when: septRange, query: TOKEN }, { useNeural: false });
    expect(names(out)).toEqual([`${TOKEN} addr`, `${TOKEN} ann-sept`, `${TOKEN} bob-sept`, `${TOKEN} far`, `${TOKEN} near`]);
    expect(titles(out)).toEqual([`${TOKEN} idea-sept`]); // not August, not a dismissed stage or mention
  });

  it("who + when together", async () => {
    const { searchEarmarks } = await mods();
    const out = await searchEarmarks({ who: `Ann${RUN}`, when: septRange, query: TOKEN }, { useNeural: false });
    expect(names(out)).toEqual([`${TOKEN} ann-sept`]);
  });

  it("neural ids match tips and ideas through bee_conversation_id (the jsonb_array_elements_text query)", async () => {
    const { searchEarmarks } = await mods();
    const bee = fake([{ id: CONV + 1 }, { id: CONV + 5 }]);
    const out = await searchEarmarks({ query: `no-text-match-${RUN}` }, { bee });
    expect(names(out)).toEqual([`neural-hit ${RUN}`]);
    expect(titles(out)).toEqual([`neural-idea ${RUN}`]);
    expect(out.neuralMatches).toBe(2);
    expect(out.neuralFailed).toBe(false);
  });

  it("where text: address ilike, plus conversations Bee placed at that location", async () => {
    const { searchEarmarks } = await mods();
    const bee = fake([{ id: CONV + 3, locations: ["Brady Street, Milwaukee"] }, { id: CONV + 4, locations: ["Downtown"] }]);
    const out = await searchEarmarks({ where: "brady", query: `${TOKEN}|${RUN}` }, { bee });
    expect(names(out)).toEqual([`brady-placed ${RUN}`]); // the address match has a different query text, so it needs its own search
    const byAddress = await searchEarmarks({ where: "brady street", query: TOKEN }, { useNeural: false });
    expect(names(byAddress)).toEqual([`${TOKEN} addr`]);
  });

  it("where coordinates: tips within the radius only", async () => {
    const { searchEarmarks } = await mods();
    const out = await searchEarmarks({ where: { lat: 43.04, lng: -87.91, radiusM: 1000 }, query: TOKEN }, { useNeural: false });
    expect(names(out)).toEqual([`${TOKEN} near`]);
    expect(out.ideas).toEqual([]);
  });

  it("falls back to store matches when neural search throws", async () => {
    const { searchEarmarks } = await mods();
    const bee = { neuralSearch: async () => { throw new Error("down"); } };
    const out = await searchEarmarks({ who: `Bob${RUN}`, query: TOKEN }, { bee });
    expect(out.neuralFailed).toBe(true);
    expect(names(out)).toEqual([`${TOKEN} bob-sept`]);
  });
});
