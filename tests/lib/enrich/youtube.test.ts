import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichRec, type RecToEnrich } from "../../../agent/lib/enrich/enrich";
import { MATCH_ACCEPT } from "../../../agent/lib/enrich/match";
import { youtubeSearchUrl, youtubeVideoUrl } from "../../../agent/lib/enrich/youtube";

// Recorded fixture = one real keyless oEmbed call (2026-10-17) for https://www.youtube.com/watch?v=6avJHaC3C2U.
const fixture = JSON.parse(readFileSync("tests/fixtures/enrich/youtube-oembed-art-of-code.json", "utf8"));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const video = (over: Partial<RecToEnrich>): RecToEnrich => ({
  id: 4, type: "video", canonical_name: "The Art of Code", creator: "Dylan Beattie", excerpt: "watch the art of code talk",
  lat: null, lng: null, links: {}, ...over,
});
const neverPick = vi.fn(async () => { throw new Error("Jev is not asked about a video"); });

afterEach(() => vi.restoreAllMocks());

describe("youtubeVideoUrl", () => {
  it("finds the first YouTube watch, short or youtu.be link among a tip's links, as https", () => {
    expect(youtubeVideoUrl({ urls: ["https://example.com/a", "http://youtu.be/6avJHaC3C2U?t=3"] })).toBe("https://youtu.be/6avJHaC3C2U?t=3");
    expect(youtubeVideoUrl({ url: "https://m.youtube.com/watch?v=abc" })).toBe("https://m.youtube.com/watch?v=abc");
    expect(youtubeVideoUrl({ urls: ["https://www.youtube.com/shorts/xyz"] })).toBe("https://www.youtube.com/shorts/xyz");
  });
  it("ignores channel pages, look-alike hosts and anything that is not a web link", () => {
    expect(youtubeVideoUrl({ urls: ["https://www.youtube.com/@NDC", "https://notyoutube.com/watch?v=x", "javascript:alert(1)"] })).toBeNull();
    expect(youtubeVideoUrl(null)).toBeNull();
    expect(youtubeVideoUrl({ youtube: 42 })).toBeNull();
  });
});

describe("youtubeSearchUrl", () => {
  it("searches YouTube for the title and channel, encoded", () => {
    expect(youtubeSearchUrl("The Art of Code", "Dylan Beattie"))
      .toBe("https://www.youtube.com/results?search_query=The%20Art%20of%20Code%20Dylan%20Beattie");
    expect(youtubeSearchUrl("Q&A #1", null)).toBe("https://www.youtube.com/results?search_query=Q%26A%20%231");
  });
});

describe("enrichRec for a video (keyless)", () => {
  it("with only a spoken title: no request at all, a YouTube search link as links.primary and no image", async () => {
    const fetchImpl = vi.fn();
    const m = await enrichRec(video({}), { env: {}, pick: neverPick, fetchImpl: fetchImpl as never });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(neverPick).not.toHaveBeenCalled();
    expect(m).toMatchObject({
      canonicalName: "The Art of Code", creator: "Dylan Beattie", imageUrl: null,
      links: { primary: "https://www.youtube.com/results?search_query=The%20Art%20of%20Code%20Dylan%20Beattie" },
    });
    expect(m!.matchConfidence).toBeLessThan(MATCH_ACCEPT); // link only: the lane files it as no_match (review), never matched
  });

  it("a spoken TikTok links to a TikTok search instead of YouTube", async () => {
    const m = await enrichRec(video({ canonical_name: "the dancing goat", creator: null, excerpt: "you have to see this TikTok of the dancing goat" }),
      { env: {}, pick: neverPick, fetchImpl: vi.fn() as never });
    expect(m!.links).toEqual({ primary: "https://www.tiktok.com/search?q=the%20dancing%20goat" });
    expect(m!.matchConfidence).toBeLessThan(MATCH_ACCEPT);
  });

  it("with a known URL: oEmbed gives the title, the channel and the thumbnail; the card links to the video", async () => {
    const fetchImpl = vi.fn(async () => json(fixture));
    const url = "https://www.youtube.com/watch?v=6avJHaC3C2U";
    const m = await enrichRec(video({ links: { urls: [url] } }), { env: {}, pick: neverPick, fetchImpl: fetchImpl as never });
    expect(String(fetchImpl.mock.calls[0]![0 as never]))
      .toBe(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    expect(m).toMatchObject({
      canonicalName: "The Art of Code - Dylan Beattie", creator: "NDC Conferences",
      imageUrl: "https://i.ytimg.com/vi/6avJHaC3C2U/hqdefault.jpg", links: { youtube: url },
    });
    expect(m!.links).not.toHaveProperty("primary");
    expect(m!.matchConfidence).toBeGreaterThanOrEqual(MATCH_ACCEPT);
  });

  it("keeps a thumbnail only from i.ytimg.com", async () => {
    const m = await enrichRec(video({ links: { urls: ["https://youtu.be/x"] } }), { env: {}, pick: neverPick,
      fetchImpl: (async () => json({ ...fixture, thumbnail_url: "https://evil.example/i.ytimg.com/vi/x/hqdefault.jpg" })) as never });
    expect(m).toMatchObject({ canonicalName: "The Art of Code - Dylan Beattie", imageUrl: null });
  });

  it("reads at most 64 KB of an oEmbed body: a bigger one is treated as no data (link only), not parsed", async () => {
    const huge = JSON.stringify({ ...fixture, pad: "x".repeat(70 * 1024) });
    const m = await enrichRec(video({ links: { urls: ["https://youtu.be/x"] } }), { env: {}, pick: neverPick,
      fetchImpl: (async () => new Response(huge, { status: 200 })) as never });
    expect(m).toMatchObject({ canonicalName: "The Art of Code", imageUrl: null, links: { youtube: "https://youtu.be/x" } });
    expect(m!.matchConfidence).toBeLessThan(MATCH_ACCEPT);
  });

  it("a removed (400/404) or private (401/403) video still links to the URL, with no image and no retry", async () => {
    for (const status of [400, 401, 403, 404]) {
      const m = await enrichRec(video({ links: { urls: ["https://youtu.be/gone"] } }),
        { env: {}, pick: neverPick, fetchImpl: (async () => json({}, status)) as never });
      expect(m).toMatchObject({ canonicalName: "The Art of Code", imageUrl: null, links: { youtube: "https://youtu.be/gone" } });
      expect(m!.matchConfidence).toBeLessThan(MATCH_ACCEPT); // unconfirmed: no_match (review), link kept
    }
  });

  it("a busy YouTube (503) throws, so the lane backs off like any provider", async () => {
    await expect(enrichRec(video({ links: { urls: ["https://youtu.be/x"] } }),
      { env: {}, pick: neverPick, fetchImpl: (async () => json({}, 503)) as never })).rejects.toThrow(/503/);
  });
});
