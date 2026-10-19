import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { enrichRec } from "../../agent/lib/enrich/enrich";

// "Link" on Fix this tip (decision 049) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when
// absent. The page, DNS and Apple are fakes: no real network. Sweeps are scoped to this file's rows (onlyIds).
const AT = "2026-10-01T15:00:00Z";
const METTASUN = "https://jimettarose.bandcamp.com/album/mettasun";
const ART = "https://f4.bcbits.com/img/a1803787050_5.jpg";
const BANDCAMP_HTML = `<!DOCTYPE html><html><head><title>MettaSun | Jimetta Rose</title>
<meta property="og:title" content="MettaSun, by Jimetta Rose"><meta property="og:type" content="album">
<meta property="og:image" content="${ART}"></head><body>…</body></html>`;
const PUBLIC = async () => ["93.184.216.34"];
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

describe.skipIf(!process.env.TEST_DATABASE_URL)("Link on Fix this tip, on the Neon test branch (decision 049)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})) };
  const sweep = async (d: Parameters<typeof import("../../agent/lib/recs/lane").sweepRecLane>[0]) =>
    (await import("../../agent/lib/recs/lane")).sweepRecLane({ ...quiet, env: {}, ...d });
  const link = async (...a: Parameters<typeof import("../../agent/lib/recs/tip-link").applyTipLink>) =>
    (await import("../../agent/lib/recs/tip-link")).applyTipLink(...a);

  const addRec = async (o: { type?: string; creator?: string | null; status?: string; set?: string } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence)
       values ($1, 'it link', 'Jimetta Rose new one', $2, 'it link', $3, 'ambient', $4, 0.9) returning id`,
      [o.type ?? "album", o.creator ?? null, AT, o.status ?? "new"]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (o.set) await c.query(`update recommendations set ${o.set} where id = $1`, [id]);
    return id;
  };
  const row = async (id: number) => (await c.query(
    `select canonical_name, creator, image_url, apple_music_id, links, enrichment_status, match_source, review_reason,
            extras, extras_at, about_at, art_retry_mbid, updated_at
     from recommendations where id = $1`, [id])).rows[0];

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

  it("a Bandcamp page settles a tip nobody could find: its art, its link, and (no creator yet) its name and creator", async () => {
    const id = await addRec({ set: `enrichment_status = 'no_match', review_reason = 'no_match', match_candidates = '[{"canonicalName":"Wrong"}]'::jsonb,
      candidates_at = now(), extras = '{"wiki":{}}'::jsonb, extras_at = now(), about_at = now(), art_retry_mbid = 'rg-1',
      links = '{"url":"https://example.com/heard"}'::jsonb` });
    const fetchImpl = vi.fn(async () => html(BANDCAMP_HTML));
    expect(await link(id, METTASUN, { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: PUBLIC, apple: null }))
      .toEqual({ status: "saved", art: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toMatchObject([METTASUN, { redirect: "manual" }]);
    const r = await row(id);
    expect(r).toMatchObject({
      canonical_name: "MettaSun", creator: "Jimetta Rose", image_url: ART, enrichment_status: "matched", match_source: "owner",
      review_reason: null, extras: null, extras_at: null, art_retry_mbid: null,
    });
    expect(r.about_at).toBeNull(); // the name changed: the lane writes a fresh note for it
    expect(r.links).toEqual({ url: "https://example.com/heard", bandcamp: METTASUN }); // the capture's own link stays

    // The owner said where it is: the lane never looks it up again, even when it is due.
    await c.query(`update recommendations set enrichment_status = 'pending', enrich_next_at = now() where id = $1`, [id]);
    const enrich = vi.fn(async () => { throw new Error("must not look up"); }) as unknown as typeof enrichRec;
    await sweep({ enrich, onlyIds: [id] });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("any other page: the owner's name and creator stay, the page gives art and the link", async () => {
    const id = await addRec({ type: "place", creator: "Mama", set: `enrichment_status = 'matched', about_at = now()` });
    const page = `<html><head><title>Mama’s Diner, by The Sea</title><meta property="og:image" content="https://mamasdiner.com/front.jpg"></head></html>`;
    const fetchImpl = vi.fn(async () => html(page)) as unknown as typeof fetch;
    expect(await link(id, "https://mamasdiner.com/", { fetchImpl, lookup: PUBLIC, apple: null })).toEqual({ status: "saved", art: true });
    const r = await row(id);
    expect(r).toMatchObject({ canonical_name: "Jimetta Rose new one", creator: "Mama", image_url: "https://mamasdiner.com/front.jpg",
      match_source: "owner", enrichment_status: "matched" });
    expect(r.about_at).not.toBeNull(); // same name: the note stays
    expect(r.links).toEqual({ web: "https://mamasdiner.com/" });
  });

  it("an Apple Music link is looked up by its id: name, creator, art, Apple id and link, exactly", async () => {
    const id = await addRec({ set: `links = '{"bandcamp":"${METTASUN}","musicbrainz":"https://musicbrainz.org/wrong"}'::jsonb,
      image_url = '${ART}', apple_music_id = '9'` });
    const apple = { token: async () => "dev-token", storefront: "us" };
    const appleJson = { data: [{ id: "1234567899", attributes: { name: "Sun Song", artistName: "Jimetta Rose", releaseDate: "2024-05-03",
      url: "https://music.apple.com/gb/album/mettasun/1234567890?i=1234567899", artwork: { url: "https://is1.mzstatic.com/s/{w}x{h}bb.jpg" } } }] };
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify(appleJson), { status: 200 }));
    expect(await link(id, "https://music.apple.com/gb/album/mettasun/1234567890?i=1234567899",
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: PUBLIC, apple })).toEqual({ status: "saved", art: true });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.music.apple.com/v1/catalog/gb/songs/1234567899");
    const r = await row(id);
    expect(r).toMatchObject({ canonical_name: "Sun Song", creator: "Jimetta Rose", image_url: "https://is1.mzstatic.com/s/600x600bb.jpg",
      apple_music_id: "1234567899", match_source: "owner", enrichment_status: "matched" });
    // One owner link at a time; the old match's provider links go with the old identity.
    expect(r.links).toEqual({ apple_music: "https://music.apple.com/gb/album/mettasun/1234567890?i=1234567899" });
  });

  it("the fetch guard: a host that resolves to a private address is refused and never fetched", async () => {
    const id = await addRec();
    const before = await row(id);
    const fetchImpl = vi.fn(async () => html(BANDCAMP_HTML)) as unknown as typeof fetch;
    expect(await link(id, "https://sneaky.example.com/", { fetchImpl, lookup: async () => ["10.0.0.5"], apple: null }))
      .toEqual({ status: "refused", reason: "private" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await row(id)).toEqual(before);
  });

  it("the fetch guard: a redirect to a private address is not followed; the link is still saved, with no art", async () => {
    const id = await addRec({ creator: "Jimetta Rose" });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://internal.example.com/admin" } }));
    const lookup = async (host: string) => (host === "internal.example.com" ? ["127.0.0.1"] : ["93.184.216.34"]);
    expect(await link(id, "https://shortener.example.com/x", { fetchImpl: fetchImpl as unknown as typeof fetch, lookup, apple: null }))
      .toEqual({ status: "saved", art: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the private hop was never asked
    expect((await row(id))).toMatchObject({ image_url: null, links: { web: "https://shortener.example.com/x" }, match_source: "owner" });
  });

  it("clearing the link removes only what the owner added (bandcamp, web), never a provider's link", async () => {
    const id = await addRec({ set: `match_source = 'owner', enrichment_status = 'matched',
      links = '{"url":"https://example.com/heard","bandcamp":"${METTASUN}","web":"https://a.example.com/","apple_music":"https://music.apple.com/x"}'::jsonb` });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await link(id, null, { fetchImpl, lookup: PUBLIC, apple: null })).toEqual({ status: "cleared" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await row(id)).links).toEqual({ url: "https://example.com/heard", apple_music: "https://music.apple.com/x" });
  });

  it("a cleared tip takes no link", async () => {
    const id = await addRec({ status: "dismissed" });
    const fetchImpl = vi.fn(async () => html(BANDCAMP_HTML)) as unknown as typeof fetch;
    expect(await link(id, METTASUN, { fetchImpl, lookup: PUBLIC, apple: null })).toEqual({ status: "refused", reason: "gone" });
    expect(await link(id, null, { fetchImpl, lookup: PUBLIC, apple: null })).toEqual({ status: "refused", reason: "gone" });
    expect((await row(id)).links).toEqual({});
  });
});
