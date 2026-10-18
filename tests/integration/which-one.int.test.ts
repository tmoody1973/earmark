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

    expect(await pickCandidate(id, 2)).toEqual({ changed: false }); // outside the stored list
    expect(await pickCandidate(id, 1)).toEqual({ changed: true });
    const r = await row(id);
    expect(r).toMatchObject({ canonical_name: B.canonicalName, creator: "Ola Brandt", year_or_address: "1980", image_url: B.imageUrl,
      enrichment_status: "matched", match_source: "owner", auto_pick: "none", owner_pick: describeCandidate(B),
      extras: null, extras_at: null, extras_tries: 0, about: null, about_at: null });
    expect(r.links).toEqual(B.links);
    expect(r.review_reason).not.toBe("no_match");

    expect(await pickCandidate(id, 0)).toEqual({ changed: false }); // the owner's choice is final
    await c.query(`update recommendations set enrichment_status = 'pending', enrich_next_at = now() where id = $1`, [id]);
    expect(await sweep({ enrich: viaPick([A]), pick: picks(A), onlyIds: [id] })).toMatchObject({ tried: 0 });
    expect((await row(id)).canonical_name).toBe(B.canonicalName);
  });

  it("correcting a confident wrong guess replaces the old match's art, links, year and place", async () => {
    const { pickCandidate } = await whichOne();
    const wrong = cand("Shogun", { yearOrAddress: "1980", links: { tmdb: "https://www.themoviedb.org/tv/1980" } });
    const right = cand("Shogun", { yearOrAddress: "2024", imageUrl: null, links: { tmdb: "https://www.themoviedb.org/tv/2024" } });
    const id = await addRec({ type: "film_tv", set: `enrichment_status = 'matched', canonical_name = 'Shogun', year_or_address = '1980',
      image_url = 'https://image.tmdb.org/t/p/w500/old.jpg', links = '{"tmdb":"https://www.themoviedb.org/tv/1980","url":"https://mine.example"}'::jsonb,
      match_candidates = '${stored([wrong, right])}'::jsonb, auto_pick = '${describeCandidate(wrong)}'` });
    expect(await pickCandidate(id, 1)).toEqual({ changed: true });
    const r = await row(id);
    expect(r).toMatchObject({ year_or_address: "2024", image_url: null, match_source: "owner", auto_pick: describeCandidate(wrong) });
    expect(r.links).toEqual({ tmdb: "https://www.themoviedb.org/tv/2024", url: "https://mine.example" }); // the capture's own link stays

    // a music pick with no art: the lane's art-only tail fetches it (no provider call from the request)
    const album = await addRec({ type: "album", set: `enrichment_status = 'no_match',
      match_candidates = '${stored([cand("Blue", { imageUrl: null, releaseGroupId: "rg-1", mbid: "rg-1" })])}'::jsonb` });
    expect(await pickCandidate(album, 0)).toEqual({ changed: true });
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
