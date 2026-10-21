import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Home's live tips on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// The branch is shared with other suites, so each claim uses a time only this file's rows can reach (far future).
describe.skipIf(!process.env.TEST_DATABASE_URL)("latestTipChangeSince on the Neon test branch", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const FUTURE = "now() + interval '2 days'"; // no other suite writes this far ahead
  const addRec = async (status: string, set = "") => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
       values ('book', 'it live tips', 'IT live tip', 'it live tips', now(), 'ambient', $1, 0.9) returning id`, [status]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (set) await c.query(`update recommendations set ${set} where id = $1`, [id]);
    return id;
  };
  const enrichedAt = async (id: number) =>
    new Date((await c.query(`select enriched_at from recommendations where id = $1`, [id])).rows[0].enriched_at).toISOString();
  const latest = async (since: Date) => (await import("../../agent/lib/store/garden-events")).latestTipChangeSince(since);
  const tomorrow = () => new Date(Date.now() + 24 * 3600_000);

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

  it("a visible tip's match filled in moves the time (a Maybe? too)", async () => {
    const tip = await addRec("new", `enriched_at = ${FUTURE}`);
    expect(await latest(tomorrow())).toBe(await enrichedAt(tip));
    const maybe = await addRec("needs_review", `enriched_at = ${FUTURE} + interval '1 minute'`);
    expect(await latest(tomorrow())).toBe(await enrichedAt(maybe));
  });

  it("cleared and overheard tips never move it", async () => {
    const seen = await latest(tomorrow());
    await addRec("dismissed", `enriched_at = ${FUTURE} + interval '1 hour'`);
    await addRec("composted", `enriched_at = ${FUTURE} + interval '1 hour'`);
    await addRec("overheard", `enriched_at = ${FUTURE} + interval '1 hour'`);
    expect(await latest(tomorrow())).toBe(seen);
  });

  it("nothing after the given time: null", async () => {
    expect(await latest(new Date(Date.now() + 30 * 24 * 3600_000))).toBeNull();
  });
});
