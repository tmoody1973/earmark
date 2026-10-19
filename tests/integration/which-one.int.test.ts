import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { enrichRec } from "../../agent/lib/enrich/enrich";
import { describeCandidate } from "../../agent/lib/enrich/match";
import type { Candidate, EnrichmentMatch } from "../../agent/lib/enrich/types";

// "Which one?" (decision 048) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// Providers, Jev and fetch are fakes: no real network. Sweeps are scoped to this file's rows (onlyIds).
const AT = "2026-10-01T15:00:00Z";
type Enrich = typeof enrichRec;

const cand = (name: string, over: Partial<Candidate> = {}): Candidate => ({
  canonicalName: name, creator: "Mara Vell", yearOrAddress: "2021", imageUrl: `https://covers.openlibrary.org/b/id/${name.length}-M.jpg`,
  links: { openlibrary: `https://openlibrary.org/works/${name.replace(/\W/g, "")}` }, ...over,
});
const A = cand("Night Garden");
const B = cand("Night Garden: Stories", { creator: "Ola Brandt", yearOrAddress: "1980" });
const C = cand("The Night Gardener", { creator: null, yearOrAddress: null, imageUrl: null });

// A fake enrich that asks the (counted) Jev pick once with these candidates, then returns what Jev returned.
const viaPick = (cands: Candidate[]): Enrich =>
  (async (r, deps) => deps!.pick!({ described: r.canonical_name, excerpt: r.excerpt }, cands)) as Enrich;
const key = describeCandidate;
const picks = (c: Candidate | null) => vi.fn(async () => (c ? ({ ...c, matchConfidence: 0.92 } as EnrichmentMatch) : null));

// An Open Library search answer (the book provider, keyless): only fields its parse() reads.
const olAnswer = (titles: string[]) => new Response(JSON.stringify({
  docs: titles.map((t, i) => ({ key: `/works/OL${i}W`, title: t, author_name: ["Mara Vell"], first_publish_year: 2000 + i })),
}), { status: 200, headers: { "content-type": "application/json" } });

describe.skipIf(!process.env.TEST_DATABASE_URL)("Which one? on the Neon test branch (decision 048)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})) };
  const sweep = async (d: Parameters<typeof import("../../agent/lib/recs/lane").sweepRecLane>[0]) =>
    (await import("../../agent/lib/recs/lane")).sweepRecLane({ ...quiet, env: {}, ...d });
  const whichOne = () => import("../../agent/lib/recs/which-one");

  const addRec = async (o: { type?: string; status?: string; name?: string; set?: string } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
       values ($1, 'it which', $2, 'it which', $3, 'ambient', $4, 0.9) returning id`,
      [o.type ?? "book", o.name ?? "IT which one", AT, o.status ?? "new"]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (o.set) await c.query(`update recommendations set ${o.set} where id = $1`, [id]);
    return id;
  };
  const stored = (cs: Candidate[]) => JSON.stringify(cs.map((x) => ({ provider: "openlibrary", ...x })));
  const row = async (id: number) => (await c.query(
    `select canonical_name, creator, year_or_address, image_url, links, enrichment_status, enrich_attempts, review_reason,
            match_candidates, candidates_at, match_source, auto_pick, owner_pick, owner_none_at, extras, extras_at, extras_tries,
            about, about_at, art_retry_mbid, lat, lng, enrich_next_at <= now() as due
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

  it("the lane keeps the candidates and Jev's pick on a match, a second look and a final no_match", async () => {
    const matched = await addRec();
    expect(await sweep({ enrich: viaPick([A, B, C]), pick: picks(A), onlyIds: [matched] })).toMatchObject({ matched: 1 });
    const m = await row(matched);
    expect(m).toMatchObject({ enrichment_status: "matched", match_source: "auto", auto_pick: describeCandidate(A) });
    expect(m.match_candidates.map((x: Candidate) => x.canonicalName)).toEqual([A.canonicalName, B.canonicalName, C.canonicalName]);
    expect(m.match_candidates[0]).toMatchObject({ provider: "openlibrary", creator: "Mara Vell", links: A.links });
    expect(m.candidates_at).not.toBeNull();

    const unsure = await addRec();
    expect(await sweep({ enrich: viaPick([A, B]), pick: picks(null), onlyIds: [unsure] })).toMatchObject({ secondLook: 1 });
    const s = await row(unsure);
    expect(s).toMatchObject({ enrichment_status: "pending", auto_pick: "none" });
    expect(s.match_candidates).toHaveLength(2);

    await c.query(`update recommendations set enrich_next_at = now() where id = $1`, [unsure]);
    expect(await sweep({ enrich: viaPick([C]), pick: picks(null), onlyIds: [unsure] })).toMatchObject({ noMatch: 1 });
    const f = await row(unsure);
    expect(f).toMatchObject({ enrichment_status: "no_match", auto_pick: "none" });
    expect(f.match_candidates.map((x: Candidate) => x.canonicalName)).toEqual([C.canonicalName]); // the latest look

    const nothing = await addRec(); // no candidates at all: nothing to keep
    await sweep({ enrich: vi.fn(async () => null) as unknown as Enrich, pick: picks(null), onlyIds: [nothing] });
    expect(await row(nothing)).toMatchObject({ enrichment_status: "no_match", match_candidates: null, auto_pick: null });
  });

  it("the lane never looks up an owner-settled tip", async () => {
    const id = await addRec({ set: "match_source = 'owner'" }); // pending, but the owner's
    const enrich = vi.fn(viaPick([A]));
    expect(await sweep({ enrich, pick: picks(A), onlyIds: [id] })).toMatchObject({ tried: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("picking applies the candidate through the match save path, marks it the owner's and resets extras", async () => {
    const { pickCandidate } = await whichOne();
    const id = await addRec({ set: `enrichment_status = 'no_match', review_reason = 'no_match', auto_pick = 'none',
      match_candidates = '${stored([A, B])}'::jsonb, candidates_at = now(), extras = '{"wiki":{"text":"x"}}'::jsonb,
      extras_at = now(), extras_tries = 2, about = 'old note', about_url = 'https://en.wikipedia.org/wiki/Old', about_at = now()` });

    expect(await pickCandidate(id, 2, key(B))).toEqual({ changed: false }); // outside the stored list
    expect(await pickCandidate(id, 1, key(A))).toEqual({ changed: false }); // the page showed another list: refused
    expect(await pickCandidate(id, 1, key(B))).toEqual({ changed: true });
    const r = await row(id);
    expect(r).toMatchObject({ canonical_name: B.canonicalName, creator: "Ola Brandt", year_or_address: "1980", image_url: B.imageUrl,
      enrichment_status: "matched", match_source: "owner", auto_pick: "none", owner_pick: describeCandidate(B),
      extras: null, extras_at: null, extras_tries: 0, about: null, about_at: null });
    expect(r.links).toEqual(B.links);
    expect(r.review_reason).not.toBe("no_match");

    expect(await pickCandidate(id, 0, key(A))).toEqual({ changed: false }); // the owner's choice is final
    await c.query(`update recommendations set enrichment_status = 'pending', enrich_next_at = now() where id = $1`, [id]);
    expect(await sweep({ enrich: viaPick([A]), pick: picks(A), onlyIds: [id] })).toMatchObject({ tried: 0 });
    expect((await row(id)).canonical_name).toBe(B.canonicalName);
  });

  it("correcting a confident wrong guess replaces the old match's art, links, year and place", async () => {
    const { pickCandidate } = await whichOne();
    const wrong = cand("Shogun", { creator: "Old Studio", yearOrAddress: "1980", links: { tmdb: "https://www.themoviedb.org/tv/1980" } });
    const right = cand("Shogun", { creator: null, yearOrAddress: "2024", imageUrl: null, links: { tmdb: "https://www.themoviedb.org/tv/2024" } });
    const id = await addRec({ type: "film_tv", set: `enrichment_status = 'matched', canonical_name = 'Shogun', creator = 'Old Studio', year_or_address = '1980',
      image_url = 'https://image.tmdb.org/t/p/w500/old.jpg', links = '{"tmdb":"https://www.themoviedb.org/tv/1980","url":"https://mine.example"}'::jsonb,
      match_candidates = '${stored([wrong, right])}'::jsonb, auto_pick = '${describeCandidate(wrong)}'` });
    expect(await pickCandidate(id, 1, key(right))).toEqual({ changed: true });
    const r = await row(id);
    expect(r).toMatchObject({ creator: null, year_or_address: "2024", image_url: null, match_source: "owner", auto_pick: describeCandidate(wrong) });
    expect(r.links).toEqual({ tmdb: "https://www.themoviedb.org/tv/2024", url: "https://mine.example" }); // the capture's own link stays

    // a music pick with no art: the lane's art-only tail fetches it (no provider call from the request)
    const blue = cand("Blue", { imageUrl: null, releaseGroupId: "rg-1", mbid: "rg-1" });
    const album = await addRec({ type: "album", set: `enrichment_status = 'no_match', match_candidates = '${stored([blue])}'::jsonb` });
    expect(await pickCandidate(album, 0, key(blue))).toEqual({ changed: true });
    expect(await row(album)).toMatchObject({ art_retry_mbid: "rg-1", enrichment_status: "matched" });
  });

  it("None of these is final: no_match stays, the chip goes, the lane leaves it alone", async () => {
    const { noneOfThese } = await whichOne();
    const { getShelf } = await import("../../agent/lib/garden/queries");
    const id = await addRec({ set: `enrich_attempts = 1, enrich_next_at = now(), match_candidates = '${stored([A, B])}'::jsonb, auto_pick = 'none'` });
    const chip = async () => (await getShelf(id)).find((x) => x.id === id)!.whichOne ?? false;
    expect(await chip()).toBe(true);

    expect(await noneOfThese(id)).toEqual({ changed: true });
    const r = await row(id);
    expect(r).toMatchObject({ enrichment_status: "no_match", match_source: "owner", review_reason: "no_match" });
    expect(r.owner_none_at).not.toBeNull();
    expect(await chip()).toBe(false);
    expect(await noneOfThese(id)).toEqual({ changed: false });
  });

  it("Search again stores the provider's candidates without picking, at most once per tip per 10 s", async () => {
    const { searchAgain } = await whichOne();
    const id = await addRec({ set: `enrichment_status = 'no_match', match_candidates = '${stored([C])}'::jsonb,
      candidates_at = now() - interval '1 minute', auto_pick = 'none'` });
    const fetchImpl = vi.fn(async () => olAnswer(["Night Garden", "Night Garden Again"]));
    expect(await searchAgain(id, "Night Garden", { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "ok", found: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("openlibrary.org/search.json");
    const r = await row(id);
    expect(r).toMatchObject({ enrichment_status: "no_match", match_source: "auto", auto_pick: "none" }); // nothing picked
    expect(r.match_candidates.map((x: Candidate) => x.canonicalName)).toEqual(["Night Garden", "Night Garden Again"]);
    expect(r.match_candidates[0].provider).toBe("openlibrary");

    expect(await searchAgain(id, "Night Garden", { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "refused", reason: "too_soon" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Search again refuses a provider that isn't set up, and a 429 is 'try again in a bit'", async () => {
    const { searchAgain } = await whichOne();
    const film = await addRec({ type: "film_tv", set: `enrichment_status = 'no_match', match_candidates = '[]'::jsonb` });
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    expect(await searchAgain(film, "Shogun", { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "refused", reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();

    const book = await addRec({ set: `enrichment_status = 'no_match', match_candidates = '${stored([C])}'::jsonb` });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await searchAgain(book, "Night Garden", { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "refused", reason: "busy" });
    expect((await row(book)).match_candidates.map((x: Candidate) => x.canonicalName)).toEqual([C.canonicalName]); // untouched
  });

  // Each capture owns different fields (capture/songs.ts, photos.ts, email.ts): a correction keeps only those.
  const capturedTip = (source: string, wrongPick: Candidate, right: Candidate) => addRec({ type: "album", set: `source = '${source}',
    enrichment_status = 'matched', apple_music_id = '999', image_url = 'https://is1-ssl.mzstatic.com/wrong.jpg',
    links = '{"apple_music":"https://music.apple.com/us/album/wrong/999","url":"https://mine.example"}'::jsonb,
    match_candidates = '${stored([wrongPick, right])}'::jsonb, auto_pick = '${key(wrongPick)}'` });
  const capRow = async (id: number) =>
    (await c.query(`select apple_music_id, image_url, links, art_retry_mbid from recommendations where id = $1`, [id])).rows[0];
  const wrongAlbum = cand("Blew", { appleMusicId: "999" });
  const rightAlbum = cand("Blue", { creator: "Joni Mitchell", imageUrl: null, releaseGroupId: "rg-right", mbid: "rg-right",
    links: { musicbrainz: "https://musicbrainz.org/release-group/rg-right" } });

  it("a song capture keeps its own Apple id and link through a correction, but not the wrong match's cover", async () => {
    const { pickCandidate } = await whichOne();
    const id = await capturedTip("song", wrongAlbum, rightAlbum);
    expect(await pickCandidate(id, 1, key(rightAlbum))).toEqual({ changed: true });
    const r = await capRow(id);
    expect(r).toMatchObject({ apple_music_id: "999", image_url: null, art_retry_mbid: "rg-right" });
    expect(r.links).toEqual({ apple_music: "https://music.apple.com/us/album/wrong/999", url: "https://mine.example",
      musicbrainz: "https://musicbrainz.org/release-group/rg-right" });
  });

  it("a photo capture keeps its own picture; an email capture keeps none of the wrong match's Apple details", async () => {
    const { pickCandidate } = await whichOne();
    const photo = await capturedTip("photo", wrongAlbum, rightAlbum);
    expect(await pickCandidate(photo, 1, key(rightAlbum))).toEqual({ changed: true });
    const p = await capRow(photo);
    expect(p).toMatchObject({ apple_music_id: null, image_url: "https://is1-ssl.mzstatic.com/wrong.jpg", art_retry_mbid: null });
    expect(p.links.apple_music).toBeUndefined();

    const email = await capturedTip("email", wrongAlbum, rightAlbum);
    expect(await pickCandidate(email, 1, key(rightAlbum))).toEqual({ changed: true });
    const e = await capRow(email);
    expect(e).toMatchObject({ apple_music_id: null, image_url: null, art_retry_mbid: "rg-right" }); // the lane fetches the right cover
    expect(e.links).toEqual({ url: "https://mine.example", musicbrainz: "https://musicbrainz.org/release-group/rg-right" });
  });

  it("the lane never overwrites candidates the owner searched for while it was looking", async () => {
    const { searchAgain } = await whichOne();
    const id = await addRec(); // pending: the sweep picks it up
    const fetchImpl = vi.fn(async () => olAnswer(["Owner Found"]));
    const enrich = (async (r, deps) => {
      await searchAgain(r.id, "Owner Found", { env: {}, fetchImpl: fetchImpl as unknown as typeof fetch }); // the owner, mid-sweep
      return deps!.pick!({ described: r.canonical_name, excerpt: r.excerpt }, [A]);
    }) as Enrich;
    await sweep({ enrich, pick: picks(null), onlyIds: [id] });
    const r = await row(id);
    expect(r.match_candidates.map((x: Candidate) => x.canonicalName)).toEqual(["Owner Found"]);
    expect(r).toMatchObject({ enrichment_status: "no_match", enrich_attempts: 0 });
  });

  it("a correction while the lane fetches art, the note or extras for the old item: those writes don't land", async () => {
    const { pickCandidate } = await whichOne();
    const setup = (extra = "") => addRec({ set: `enrichment_status = 'matched', enriched_at = now() - interval '1 hour',
      match_candidates = '${stored([A, B])}'::jsonb, auto_pick = '${key(A)}'${extra}` });
    const correct = (id: number) => pickCandidate(id, 1, key(B));

    const art = await setup(", image_url = null, art_retry_mbid = 'rg-old', about_at = now(), extras_at = now()");
    await sweep({ coverArt: async () => { await correct(art); return "https://coverartarchive.org/old.jpg"; }, onlyIds: [art] });
    expect(await row(art)).toMatchObject({ canonical_name: B.canonicalName, image_url: B.imageUrl, art_retry_mbid: null });

    const about = await setup();
    await sweep({ about: async () => { await correct(about); return { text: "about the old item", url: "https://en.wikipedia.org/wiki/Old" }; },
      onlyIds: [about] });
    expect(await row(about)).toMatchObject({ canonical_name: B.canonicalName, about: null, about_at: null });

    const extras = await setup(", about_at = now()");
    await sweep({ extras: async () => { await correct(extras); return { discogs: { url: "https://www.discogs.com/master/1" } } as never; },
      onlyIds: [extras] });
    const e = await row(extras);
    expect(e).toMatchObject({ canonical_name: B.canonicalName, extras: null, extras_at: null });
    expect(e.links).toEqual(B.links); // no links.discogs for the old item
  });

  // Decision 050: MusicBrainz and Apple searched together; MettaSun (tip 150) is only on Apple. Real enrichRec, fake HTTP and Jev.
  const APPLE_ENV = { APPLE_TEAM_ID: "T", APPLE_MUSIC_KEY_ID: "K",
    APPLE_MUSIC_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
  const METTA = { results: { albums: { data: [{ id: "1700", attributes: { name: "MettaSun", artistName: "Jimetta Rose", releaseDate: "2026-09-01",
    url: "https://music.apple.com/us/album/1700", artwork: { url: "https://is1-ssl.mzstatic.com/{w}x{h}.jpg" } } }] } } };
  const MB_TWO = { "release-groups": [{ id: "rg-other", title: "Metta Sun", "primary-type": "Album", "artist-credit": [{ name: "Someone Else", joinphrase: "" }] },
    { id: "rg-metta", title: "MettaSun", "primary-type": "Album", "artist-credit": [{ name: "Jimetta Rose", joinphrase: "" }] }] };
  const musicFetch = (mb: unknown) => vi.fn(async (u: string) => new Response(JSON.stringify(
    u.startsWith("https://musicbrainz.org/") ? mb : u.startsWith("https://api.music.apple.com/") ? METTA : {}),
  { status: u.includes("musicbrainz.org") || u.includes("api.music.apple.com") ? 200 : 404, headers: { "content-type": "application/json" } }));
  const realEnrich = (fetchImpl: ReturnType<typeof musicFetch>): Enrich => async (r, deps) =>
    (await import("../../agent/lib/enrich/enrich")).enrichRec(r, { ...deps, fetchImpl: fetchImpl as unknown as typeof fetch });
  const appleKey = "MettaSun — Jimetta Rose — 2026";

  it("a music tip MusicBrainz can't find ends matched from Apple, with Apple's id, link and art", async () => {
    const id = await addRec({ type: "album", name: "MettaSun" });
    await c.query(`update recommendations set creator = 'Jimetta Rose' where id = $1`, [id]);
    const pick = vi.fn(async (_i: unknown, cs: readonly Candidate[]) => (cs[0] ? { ...cs[0], matchConfidence: 0.92 } : null));
    expect(await sweep({ enrich: realEnrich(musicFetch({ "release-groups": [] })), pick, env: APPLE_ENV, onlyIds: [id] })).toMatchObject({ matched: 1 });
    const r = await row(id);
    expect(r).toMatchObject({ enrichment_status: "matched", canonical_name: "MettaSun", creator: "Jimetta Rose", year_or_address: "2026",
      image_url: "https://is1-ssl.mzstatic.com/600x600.jpg", auto_pick: appleKey, art_retry_mbid: null });
    expect(r.links).toEqual({ apple_music: "https://music.apple.com/us/album/1700" });
    expect((await c.query(`select apple_music_id from recommendations where id = $1`, [id])).rows[0].apple_music_id).toBe("1700");
    expect(r.match_candidates.map((x: Candidate) => x.provider)).toEqual(["apple"]);
  });

  it("Jev abstains: the options keep both catalogs, the same release merged first, each with its provider", async () => {
    const id = await addRec({ type: "album", name: "MettaSun" });
    expect(await sweep({ enrich: realEnrich(musicFetch(MB_TWO)), pick: picks(null), env: APPLE_ENV, onlyIds: [id] })).toMatchObject({ secondLook: 1 });
    const r = await row(id);
    expect(r).toMatchObject({ enrichment_status: "pending", auto_pick: "none" });
    expect(r.match_candidates.map((x: Candidate) => [x.provider, x.canonicalName])).toEqual([["musicbrainz+apple", "MettaSun"], ["musicbrainz", "Metta Sun"]]);
    expect(r.match_candidates[0]).toMatchObject({ mbid: "rg-metta", appleMusicId: "1700", links: { apple_music: "https://music.apple.com/us/album/1700" } });
  });

  it("the owner picks an Apple option: Apple's id, link and art are written; Search again falls back to Apple too", async () => {
    const { pickCandidate, searchAgain } = await whichOne();
    const id = await addRec({ type: "album", name: "Metta Sun", set: `enrichment_status = 'no_match', candidates_at = now() - interval '1 minute'` });
    const fetchImpl = musicFetch({ "release-groups": [] });
    expect(await searchAgain(id, "MettaSun", { env: APPLE_ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: "ok", found: 1 });
    expect((await row(id)).match_candidates[0]).toMatchObject({ provider: "apple", appleMusicId: "1700" });

    expect(await pickCandidate(id, 0, appleKey)).toEqual({ changed: true });
    const r = await row(id);
    expect(r).toMatchObject({ enrichment_status: "matched", match_source: "owner", canonical_name: "MettaSun", creator: "Jimetta Rose",
      image_url: "https://is1-ssl.mzstatic.com/600x600.jpg", art_retry_mbid: null, owner_pick: appleKey });
    expect(r.links).toEqual({ apple_music: "https://music.apple.com/us/album/1700" });
    expect((await c.query(`select apple_music_id from recommendations where id = $1`, [id])).rows[0].apple_music_id).toBe("1700");
  });

  it("requeue: a dry run only lists; --yes sends the automatic no-matches back to the lane", async () => {
    const { requeueUnmatched } = await import("../../scripts/requeue-unmatched");
    const auto = await addRec({ set: "enrichment_status = 'no_match', review_reason = 'no_match', enrich_attempts = 1, enrich_next_at = now() + interval '1 day'" });
    const owner = await addRec({ set: "enrichment_status = 'no_match', match_source = 'owner', owner_none_at = now()" });
    const dismissed = await addRec({ status: "dismissed", set: "enrichment_status = 'no_match'" });
    const matched = await addRec({ set: "enrichment_status = 'matched'" });
    const scope = { scopeRecIds: [auto, owner, dismissed, matched] };

    expect(await requeueUnmatched(c, { yes: false }, scope)).toEqual({ requeued: [auto] });
    expect(await row(auto)).toMatchObject({ enrichment_status: "no_match", enrich_attempts: 1, due: false });

    expect(await requeueUnmatched(c, { yes: true }, scope)).toEqual({ requeued: [auto] });
    expect(await row(auto)).toMatchObject({ enrichment_status: "pending", enrich_attempts: 0, review_reason: null, due: true });
    for (const id of [owner, dismissed]) expect((await row(id)).enrichment_status).toBe("no_match");
    expect((await row(matched)).enrichment_status).toBe("matched");
  });
});
