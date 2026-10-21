import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { fetchExtras, type ExtrasRec } from "../../agent/lib/enrich/extras";

// Real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. TinyFish, the model and Nominatim are fakes.
const AT = "2026-10-01T15:00:00Z";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const DETAILS = { kind: "Bar", hours: "Tu-Su 16:00-02:00", phone: null, website: "https://diasporamke.com", menu: null,
  reservation: null, reservationUrl: null, features: [] };

describe.skipIf(!process.env.TEST_DATABASE_URL)("web place details in the rec lane (decision 063)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0), about: vi.fn(async () => null) };
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.search.tinyfish.ai")) return json({ results: [{ title: "Diaspora MKE", snippet: "x", site_name: "Diaspora", url: "https://diasporamke.com/" }] });
    if (u.startsWith("https://api.fetch.tinyfish.ai")) return json({ results: (JSON.parse(String(init?.body)).urls as string[]).map((x) => ({ url: x, text: "Tue-Sun 4pm-2am" })) });
    if (u.startsWith("https://nominatim.openstreetmap.org/lookup")) return json([{ category: "amenity", type: "bar", extratags: { opening_hours: "Mo-Fr 10:00-18:00" } }]);
    throw new Error(`unexpected fetch ${u}`);
  });
  const generateImpl = vi.fn(async () => ({ output: DETAILS })) as never;
  const extras = vi.fn((r: ExtrasRec) => fetchExtras(r, fetchImpl as never, null, null, { key: "k", fetchImpl: fetchImpl as never, generateImpl }));
  const calls = (host: string) => fetchImpl.mock.calls.filter(([u]) => String(u).includes(host)).length;

  const place = async (name: string, links: object, address: string | null = "735 E Center St, Milwaukee") => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, links, year_or_address,
         enrichment_status, summarized_at, about_at)
       values ('place', 'it web place', $1, 'it web place', $2, 'ambient', 'new', 0.9, $3::jsonb, $4, 'matched', now(), now()) returning id`,
      [name, AT, JSON.stringify(links), address]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const placeOf = async (id: number) => (await c.query(`select extras, extras_at is not null as looked from recommendations where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  it("a matched web_place tip gets extras.place with its source; an OSM-matched place keeps the OSM path; a tip with extras is not refetched", async () => {
    const { sweepRecLane } = await import("../../agent/lib/recs/lane");
    const web = await place("IT Diaspora", { web: "https://diasporamke.com/" });
    const osm = await place("IT Kopp's", { openstreetmap: "https://www.openstreetmap.org/node/123", web: "https://kopps.example/" });
    const onlyIds = [web, osm];

    await sweepRecLane({ ...quiet, extras, env: {}, onlyIds });
    const w = await placeOf(web);
    expect(w.looked).toBe(true);
    expect(w.extras.place).toMatchObject({ kind: "Bar", hours: "Tu-Su 16:00-02:00", source: { site: "diasporamke.com", url: "https://diasporamke.com/" } });
    const o = await placeOf(osm);
    expect(o.extras.place.hours).toBe("Mo-Fr 10:00-18:00");
    expect(o.extras.place).not.toHaveProperty("source"); // OpenStreetMap's, credited as before
    expect(calls("api.search.tinyfish.ai")).toBe(1); // the OSM place never asked the web
    expect(calls("nominatim")).toBe(1);

    extras.mockClear();
    await sweepRecLane({ ...quiet, extras, env: {}, onlyIds });
    expect(extras).not.toHaveBeenCalled(); // extras_at is set: never refetched
    expect(calls("api.search.tinyfish.ai")).toBe(1);
  });
});
