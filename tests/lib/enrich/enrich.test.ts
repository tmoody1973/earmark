import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichRec, type RecToEnrich } from "../../../agent/lib/enrich/enrich";
import { resetMusicBrainzThrottle } from "../../../agent/lib/enrich/musicbrainz";
import type { Candidate, EnrichmentMatch } from "../../../agent/lib/enrich/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rec = (over: Partial<RecToEnrich>): RecToEnrich =>
  ({ id: 9, type: "book", canonical_name: "Night Garden", creator: "Mara Vell", excerpt: "you should read Night Garden", lat: null, lng: null, ...over });
const pickFirst = vi.fn(async (_i: unknown, cs: readonly Candidate[]): Promise<EnrichmentMatch | null> => (cs[0] ? { ...cs[0], matchConfidence: 0.9 } : null));

beforeEach(() => {
  resetMusicBrainzThrottle();
  pickFirst.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("enrichRec", () => {
  it("routes a book to Open Library and lets Jev pick from what was said", async () => {
    const fetchImpl = vi.fn<(u: string) => Promise<Response>>(async () => json({ docs: [{ key: "/works/OL1W", title: "Night Garden", author_name: ["Mara Vell"] }] }));
    const m = await enrichRec(rec({}), { env: {}, pick: pickFirst, fetchImpl: fetchImpl as never });
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/^https:\/\/openlibrary\.org\/search\.json\?/);
    expect(pickFirst).toHaveBeenCalledWith({ described: "Night Garden by Mara Vell", excerpt: "you should read Night Garden", name: "Night Garden", creator: "Mara Vell" }, expect.any(Array));
    expect(m).toMatchObject({ canonicalName: "Night Garden", links: { openlibrary: "https://openlibrary.org/works/OL1W" } });
  });

  it("routes music through enrichMusic (MusicBrainz first)", async () => {
    const fetchImpl = vi.fn(async (u: string) => (u.startsWith("https://musicbrainz.org/") ? json({ "release-groups": [] }) : json({})));
    expect(await enrichRec(rec({ type: "album" }), { env: {}, pick: pickFirst, fetchImpl: fetchImpl as never })).toBeNull();
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/^https:\/\/musicbrainz\.org\/ws\/2\/release-group\?/);
  });

  describe("place location bias", () => {
    const viewbox = async (r: Partial<RecToEnrich>, env: Record<string, string> = {}) => {
      const fetchImpl = vi.fn<(u: string) => Promise<Response>>(async () => json([]));
      await enrichRec(rec({ type: "place", ...r }), { env, pick: pickFirst, fetchImpl: fetchImpl as never });
      return new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.get("viewbox");
    };
    const center = (vb: string) => { const [l, t, r, b] = vb.split(",").map(Number); return [(t + b) / 2, (l + r) / 2].map((n) => Math.round(n * 10) / 10); };
    it("uses the rounded said location over the rec's own and the home default", async () => {
      const vb = await viewbox({ saidLat: 41.8781, saidLng: -87.6298, lat: 43.1, lng: -88.1 }, { EARMARK_HOME_LAT: "43.04", EARMARK_HOME_LNG: "-87.91" });
      expect(center(vb!)).toEqual([41.9, -87.6]);
    });
    it("falls back to the home default, and to no bias when unset", async () => {
      expect(center((await viewbox({}, { EARMARK_HOME_LAT: "43.04", EARMARK_HOME_LNG: "-87.91" }))!)).toEqual([43, -87.9]);
      expect(await viewbox({})).toBeNull();
    });
  });

  it("refuses a type whose keyed provider is not configured (the sweep never selects one)", async () => {
    await expect(enrichRec(rec({ type: "film_tv" }), { env: {}, pick: pickFirst })).rejects.toThrow(/film_tv/);
  });
});
