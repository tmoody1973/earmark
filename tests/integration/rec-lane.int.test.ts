import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { enrichRec, RecToEnrich } from "../../agent/lib/enrich/enrich";
import { ProviderHttpError, type Candidate, type EnrichmentMatch } from "../../agent/lib/enrich/types";

// Real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. Providers and Jev are fakes.
// Every sweep is scoped to this file's rows (onlyIds), so other suites' rows on the branch are never touched.
const AT = "2026-10-01T15:00:00Z";
type Enrich = typeof enrichRec;

describe.skipIf(!process.env.TEST_DATABASE_URL)("rec lane sweep on the Neon test branch (M3-T4)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const lane = () => import("../../agent/lib/recs/lane");

  const addRec = async (o: { type?: string; status?: string; name?: string; image?: string | null; links?: object } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, image_url, links)
       values ($1, 'it lane', $2, 'it lane', $3, 'ambient', $4, 0.9, $5, $6::jsonb) returning id`,
      [o.type ?? "book", o.name ?? "IT lane", AT, o.status ?? "new", o.image ?? null, JSON.stringify(o.links ?? {})]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const row = async (id: number) => (await c.query(
    `select status, canonical_name, creator, image_url, links, enrichment_status, enrich_attempts,
            extract(epoch from (enrich_next_at - now())) / 60 as next_in_min
     from recommendations where id = $1`, [id])).rows[0];
  const match = (over: Partial<Candidate> = {}): EnrichmentMatch =>
    ({ canonicalName: "Night Garden", creator: "Mara Vell", yearOrAddress: "2021", imageUrl: "https://img/new.jpg",
      links: { openlibrary: "https://openlibrary.org/works/OL1W" }, matchConfidence: 0.9, ...over });
  // A fake enrich that asks the (counted) Jev pick once, like the real providers do when there are candidates.
  const viaPick = (result: (r: RecToEnrich) => EnrichmentMatch | null): Enrich =>
    (async (r, deps) => deps!.pick!({ described: r.canonical_name, excerpt: r.excerpt }, [match()]).then(() => result(r))) as Enrich;
  const pick = vi.fn(async () => match());

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    c.release();
    await pool.end();
  });

  it("enriches visible tips and maybes, never dismissed/composted, and waits on types without keys", async () => {
    const { sweepRecLane } = await lane();
    const book = await addRec({ name: "night garden", image: "https://photo/mine.jpg", links: { url: "https://mine.example" } });
    const maybe = await addRec({ type: "other", status: "needs_review" });
    const dismissed = await addRec({ status: "dismissed" });
    const composted = await addRec({ status: "composted" });
    const film = await addRec({ type: "film_tv" });
    const enrich = vi.fn(viaPick((r) => (r.type === "book" ? match() : null)));

    const res = await sweepRecLane({ enrich, pick, env: {}, onlyIds: ids });
    expect(res).toMatchObject({ status: "done", tried: 2, matched: 1, noMatch: 1, jevCalls: 2, waitingForKeys: ["place", "film_tv"] });
    expect(enrich.mock.calls.map(([r]) => r.id).sort()).toEqual([book, maybe].sort());

    const b = await row(book);
    expect(b).toMatchObject({ enrichment_status: "matched", canonical_name: "Night Garden", creator: "Mara Vell",
      image_url: "https://photo/mine.jpg" }); // a capture's own photo wins over provider art
    expect(b.links).toEqual({ openlibrary: "https://openlibrary.org/works/OL1W", url: "https://mine.example" });
    expect((await row(maybe)).enrichment_status).toBe("no_match");
    for (const id of [dismissed, composted, film]) expect((await row(id)).enrichment_status).toBe("pending");

    // Already enriched → never tried again.
    enrich.mockClear();
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [book, maybe] })).toMatchObject({ tried: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("a failed rec backs off, is skipped while waiting, and is given up after the last attempt", async () => {
    const { sweepRecLane, MAX_ATTEMPTS } = await lane();
    const id = await addRec();
    const enrich = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); }) as unknown as Enrich;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 1, retry: 1 });
    const r1 = await row(id);
    expect(r1).toMatchObject({ enrichment_status: "pending", enrich_attempts: 1 });
    expect(Number(r1.next_in_min)).toBeGreaterThan(14);
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 0 }); // still waiting

    await c.query(`update recommendations set enrich_attempts = $2, enrich_next_at = now() where id = $1`, [id, MAX_ATTEMPTS - 1]);
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 1, gaveUp: 1 });
    expect(await row(id)).toMatchObject({ enrichment_status: "failed", enrich_attempts: MAX_ATTEMPTS });
  });

  it("stops the whole sweep on the first 503 and leaves that rec's attempts alone", async () => {
    const { sweepRecLane } = await lane();
    const first = await addRec();
    const second = await addRec();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const enrich = vi.fn(async () => { throw new ProviderHttpError("musicbrainz.org", 503); }) as unknown as Enrich;

    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [first, second] }))
      .toMatchObject({ tried: 1, stoppedOn: "musicbrainz.org 503" });
    expect(enrich).toHaveBeenCalledTimes(1);
    for (const id of [first, second]) expect(await row(id)).toMatchObject({ enrichment_status: "pending", enrich_attempts: 0 });
    await c.query(`update recommendations set enrichment_status = 'no_match' where id = any($1::bigint[])`, [[first, second]]);
  });

  it("caps Jev calls and recs per run", async () => {
    const { sweepRecLane, MAX_JEV_CALLS_PER_RUN, MAX_RECS_PER_RUN } = await lane();
    const batch: number[] = [];
    for (let i = 0; i < MAX_RECS_PER_RUN + 1; i++) batch.push(await addRec());

    const viaJev = await sweepRecLane({ enrich: viaPick(() => null), pick, env: {}, onlyIds: batch });
    expect(viaJev).toMatchObject({ tried: MAX_JEV_CALLS_PER_RUN, jevCalls: MAX_JEV_CALLS_PER_RUN });

    await c.query(`update recommendations set enrichment_status = 'pending' where id = any($1::bigint[])`, [batch]);
    const noJev = vi.fn(async () => null) as unknown as Enrich; // e.g. no candidates: no Jev call
    expect(await sweepRecLane({ enrich: noJev, pick, env: {}, onlyIds: batch })).toMatchObject({ tried: MAX_RECS_PER_RUN, jevCalls: 0 });
  });

  it("skips the run when another sweep holds the lock", async () => {
    const { sweepRecLane, REC_LANE_LOCK } = await lane();
    const other = await pool.connect();
    try {
      await other.query("begin");
      await other.query("select pg_advisory_xact_lock(hashtext($1))", [REC_LANE_LOCK]);
      const enrich = vi.fn() as unknown as Enrich;
      expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: ids })).toEqual({ status: "locked" });
      expect(enrich).not.toHaveBeenCalled();
    } finally {
      await other.query("rollback");
      other.release();
    }
  });

  it("runRecLane queues a pending rec for the next sweep without calling any provider", async () => {
    const { runRecLane } = await lane();
    const id = await addRec();
    await c.query(`update recommendations set enrich_next_at = now() + interval '1 hour' where id = $1`, [id]);
    expect(await runRecLane(id)).toEqual({ queued: true });
    expect(Number((await row(id)).next_in_min)).toBeLessThanOrEqual(0);
    await c.query(`update recommendations set enrichment_status = 'matched' where id = $1`, [id]);
    expect(await runRecLane(id)).toEqual({ queued: false });
  });
});
