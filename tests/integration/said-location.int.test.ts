import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Decision 046, real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. Bee and providers are
// fakes. Every run is scoped to this file's rows. Coordinates are fakes.
const RUN = Date.now() % 100_000;
const CONV = 9_800_000_000 + RUN * 10;
const AT = "2026-10-01T15:00:00Z";

describe.skipIf(!process.env.TEST_DATABASE_URL)("said location: backfill, requeue and lane bias (decision 046)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const mod = () => import("../../scripts/backfill-said-location");
  const addRec = async (o: { type?: string; conv?: number | null; status?: string; lat?: number | null; enrichment?: string } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, bee_conversation_id, lat, lng,
                                    enrichment_status, enrich_attempts, review_reason, enrich_next_at)
       values ($1, 'it said', 'IT said', 'it said', $2, 'ambient', $3, 0.9, $4, $5, $5, $6, 3, $7, now() + interval '1 day') returning id`,
      [o.type ?? "place", AT, o.status ?? "new", o.conv === undefined ? CONV : o.conv, o.lat ?? null, o.enrichment ?? "no_match",
        (o.enrichment ?? "no_match") === "no_match" ? "no_match" : null]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const row = async (id: number) => (await c.query(
    `select said_lat, said_lng, enrichment_status, enrich_attempts, review_reason, enrich_next_at <= now() as due from recommendations where id = $1`, [id])).rows[0];

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

  it("dry run writes nothing; --yes sets said location only where Bee has one; requeue resets the lookup", async () => {
    const { backfillSaidLocation } = await mod();
    const located = await addRec();
    const sameConv = await addRec({ type: "book" });
    const noLoc = await addRec({ conv: CONV + 1 });
    const noConv = await addRec({ conv: null });
    const dismissed = await addRec({ status: "dismissed" });
    const hasPlace = await addRec({ lat: 43.1, enrichment: "matched" });
    const ownerNone = await addRec({ conv: null }); // the owner said "None of these" (decision 048): final
    await c.query(`update recommendations set match_source = 'owner', owner_none_at = now() where id = $1`, [ownerNone]);
    const getLocation = vi.fn(async (conv: number) => (conv === CONV ? { latitude: 43.04, longitude: -87.91 } : null));
    const deps = { getLocation, sleep: async () => {}, scopeRecIds: ids };

    const dry = await backfillSaidLocation(c, { yes: false, requeuePlaces: true }, deps);
    expect(dry.located.sort()).toEqual([located, sameConv, dismissed, hasPlace].sort());
    expect(dry.noLocation).toBe(1);
    expect(dry.requeued).toEqual([located, noLoc, noConv]); // never the owner-settled one
    expect(await row(located)).toMatchObject({ said_lat: null, enrichment_status: "no_match", enrich_attempts: 3, due: false });

    const done = await backfillSaidLocation(c, { yes: true, requeuePlaces: true }, deps);
    expect(done.located.sort()).toEqual(dry.located.sort());
    expect(await row(located)).toMatchObject({ said_lat: 43.04, said_lng: -87.91, enrichment_status: "pending", enrich_attempts: 0, review_reason: null, due: true });
    expect(await row(sameConv)).toMatchObject({ said_lat: 43.04, enrichment_status: "no_match", enrich_attempts: 3 }); // not a place: untouched
    expect(await row(noLoc)).toMatchObject({ said_lat: null, enrichment_status: "pending" }); // no location, but still re-queued
    expect(await row(noConv)).toMatchObject({ said_lat: null });
    expect(await row(dismissed)).toMatchObject({ enrichment_status: "no_match" }); // dismissed tips are never re-queued
    expect(await row(hasPlace)).toMatchObject({ enrichment_status: "matched", enrich_attempts: 3 }); // already has a place
    expect(await row(ownerNone)).toMatchObject({ enrichment_status: "no_match", enrich_attempts: 3 }); // owner-settled: never re-queued
  });

  it("a failing Bee call is counted and skipped, not fatal", async () => {
    const { backfillSaidLocation } = await mod();
    const id = await addRec({ conv: CONV + 2 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await backfillSaidLocation(c, { yes: true, requeuePlaces: false }, {
      getLocation: async () => { throw Object.assign(new Error("boom"), { name: "BeeApiError" }); }, sleep: async () => {}, scopeRecIds: [id] });
    expect(r).toMatchObject({ failed: 1, located: [] });
    expect((await row(id)).said_lat).toBeNull();
  });
});
