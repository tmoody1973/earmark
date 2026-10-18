import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { resetDiscogsThrottle } from "../../agent/lib/enrich/discogs";

// Decision 047, real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. Apple and Discogs are
// fake fetches; nothing leaves the machine. Every run is scoped to this file's rows.
const AT = "2026-10-01T15:00:00Z";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apple = { token: async () => "t", storefront: "us" };
const discogs = { key: "k", secret: "s" };

const APPLE_ALBUM = { results: { albums: { data: [{ id: "77", attributes: { name: "Promises", artistName: "Floating Points", url: "https://music.apple.com/us/album/promises/77",
  releaseDate: "2021-03-26", artwork: { url: "https://is1.example/{w}x{h}.jpg" } } }] } } };
const RELEASE = { id: 555, year: 2021, labels: [{ name: "Luaka Bop", catno: "LB001" }], formats: [{ name: "Vinyl", descriptions: ["LP"] }],
  genres: ["Electronic"], styles: ["Ambient"], extraartists: [{ name: "Pharoah Sanders", role: "Saxophone" }] };

// One router for both services; `discogsStatus` lets a test make Discogs fail.
function fakeFetch(opts: { discogsStatus?: number } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith("https://api.music.apple.com")) return json(APPLE_ALBUM);
    if (opts.discogsStatus) return json({ message: "no" }, opts.discogsStatus);
    if (u.includes("/database/search")) return json({ results: [{ id: 1, title: "Floating Points - Promises" }] });
    if (u.includes("/masters/")) return json({ id: 1, main_release: 555 });
    if (u.includes("/releases/")) return json(RELEASE);
    throw new Error(`unexpected ${u}`);
  });
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("refresh music add-ons (decision 047)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const mod = () => import("../../scripts/refresh-music-addons");
  const addRec = async (o: { type?: string; name?: string; creator?: string | null; status?: string; enrichment?: string; links?: object; extras?: object; image?: string | null } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence, enrichment_status, links, extras, image_url)
       values ($1, 'it said', $2, $3, 'it said', $4, 'ambient', $5, 0.9, $6, $7::jsonb, $8::jsonb, $9) returning id`,
      [o.type ?? "album", o.name ?? "Promises", o.creator === undefined ? "Floating Points" : o.creator, AT, o.status ?? "new", o.enrichment ?? "matched",
        JSON.stringify(o.links ?? {}), JSON.stringify(o.extras ?? {}), o.image === undefined ? null : o.image]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const row = async (id: number) => (await c.query(
    `select canonical_name, creator, image_url, apple_music_id, links, extras from recommendations where id = $1`, [id])).rows[0];
  const deps = (fetchImpl: ReturnType<typeof fakeFetch>, over: object = {}) =>
    ({ apple, discogs, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, scopeRecIds: ids, ...over });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  beforeEach(() => resetDiscogsThrottle());
  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    c.release();
    await pool.end();
  });

  it("dry run lists what is missing and touches neither the network nor the rows; --yes adds only the new keys", async () => {
    const { refreshMusicAddons } = await mod();
    const target = await addRec({ links: { musicbrainz: "https://musicbrainz.org/release-group/x" }, extras: { videoId: "dQw4w9WgXcQ" }, image: null });
    const done = await addRec({ name: "Done", links: { apple_music: "https://music.apple.com/x", discogs: "https://www.discogs.com/release/9" }, extras: { discogs: { url: "https://www.discogs.com/release/9" } } });
    const dismissed = await addRec({ status: "dismissed" });
    const composted = await addRec({ status: "composted" });
    const pending = await addRec({ enrichment: "pending" });
    const book = await addRec({ type: "book" });

    const dryFetch = fakeFetch();
    const dry = await refreshMusicAddons(c, { yes: false }, deps(dryFetch));
    expect(dry.candidates).toEqual([target]);
    expect(dry.missingApple).toEqual([target]);
    expect(dry.missingDiscogs).toEqual([target]);
    expect(dryFetch).not.toHaveBeenCalled();
    expect(await row(target)).toMatchObject({ links: { musicbrainz: "https://musicbrainz.org/release-group/x" }, extras: { videoId: "dQw4w9WgXcQ" }, apple_music_id: null });

    const fetchImpl = fakeFetch();
    const res = await refreshMusicAddons(c, { yes: true }, deps(fetchImpl));
    expect(res).toMatchObject({ appleAdded: [target], discogsAdded: [target], failed: 0, stoppedOn: null });
    const after = await row(target);
    expect(after.links).toEqual({ musicbrainz: "https://musicbrainz.org/release-group/x", apple_music: "https://music.apple.com/us/album/promises/77", discogs: "https://www.discogs.com/release/555" });
    expect(after.extras.videoId).toBe("dQw4w9WgXcQ"); // merged, not clobbered
    expect(after.extras.discogs).toMatchObject({ url: "https://www.discogs.com/release/555", year: 2021, labels: [{ name: "Luaka Bop", catno: "LB001" }], credits: [{ name: "Pharoah Sanders", role: "Saxophone" }] });
    expect(after).toMatchObject({ canonical_name: "Promises", creator: "Floating Points", apple_music_id: "77", image_url: "https://is1.example/600x600.jpg" }); // art only because it was null
    for (const id of [dismissed, composted, pending, book]) expect((await row(id)).links).toEqual({});
    expect((await row(done)).links.discogs).toBe("https://www.discogs.com/release/9");

    const again = await refreshMusicAddons(c, { yes: true }, deps(fakeFetch()));
    expect(again.candidates).toEqual([]); // nothing left to do
  });

  it("an existing picture is never replaced", async () => {
    const { refreshMusicAddons } = await mod();
    const id = await addRec({ name: "Promises", image: "https://mine.example/cover.jpg" });
    await refreshMusicAddons(c, { yes: true }, deps(fakeFetch(), { scopeRecIds: [id] }));
    expect((await row(id)).image_url).toBe("https://mine.example/cover.jpg");
  });

  it("no confident match writes nothing for that tip", async () => {
    const { refreshMusicAddons } = await mod();
    const id = await addRec({ name: "Some Other Album", creator: "Nobody" });
    const res = await refreshMusicAddons(c, { yes: true }, deps(fakeFetch(), { scopeRecIds: [id], apple: null }));
    expect(res).toMatchObject({ discogsAdded: [], noMatch: 1, failed: 0 });
    expect(await row(id)).toMatchObject({ links: {}, extras: {} });
  });

  it("429 stops the run; other Discogs errors count a failure and carry on", async () => {
    const { refreshMusicAddons } = await mod();
    const a = await addRec({ name: "Busy A" });
    const b = await addRec({ name: "Busy B" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const stopped = await refreshMusicAddons(c, { yes: true }, deps(fakeFetch({ discogsStatus: 429 }), { scopeRecIds: [a, b], apple: null }));
    expect(stopped).toMatchObject({ stoppedOn: "api.discogs.com 429", failed: 0, discogsAdded: [] });
    const failed = await refreshMusicAddons(c, { yes: true }, deps(fakeFetch({ discogsStatus: 500 }), { scopeRecIds: [a, b], apple: null }));
    expect(failed).toMatchObject({ stoppedOn: null, failed: 2 });
    expect(err.mock.calls.flat().join(" ")).toMatch(/rec=\d+ error=ProviderHttpError/);
    err.mockRestore();
  });

  it("with no add-on configured --yes changes nothing", async () => {
    const { refreshMusicAddons } = await mod();
    const id = await addRec({ name: "Quiet" });
    const f = fakeFetch();
    const res = await refreshMusicAddons(c, { yes: true }, deps(f, { scopeRecIds: [id], apple: null, discogs: null }));
    expect(res.candidates).toEqual([id]);
    expect(f).not.toHaveBeenCalled();
    expect((await row(id)).links).toEqual({});
  });
});
