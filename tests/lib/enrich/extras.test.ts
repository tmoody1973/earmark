import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookFromOpenLibrary, EXTRAS_TEXT_MAX, fetchExtras, latestEpisodes, pickItunesPreview, readExtras, trimText, wikiExtract,
  youtubeId, type ExtrasRec,
} from "../../../agent/lib/enrich/extras";
import { ProviderHttpError } from "../../../agent/lib/enrich/types";
import { isBackOffSignal } from "../../../agent/lib/recs/lane";

// Shapes recorded from real keyless calls (2026-10-18), trimmed: iTunes search/lookup, Song Exploder's RSS, Open Library
// work + search, Wikipedia page summary. Tests never call the network.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PREVIEW = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/b4/mzaf_1.plus.aac.p.m4a";
const ALBUM_PREVIEW = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/a2/mzaf_2.plus.aac.p.m4a";
const songHit = {
  wrapperType: "track", kind: "song", trackName: "Movement 1 (feat. London Symphony Orchestra)",
  artistName: "Floating Points & Pharoah Sanders", collectionName: "Promises (feat. London Symphony Orchestra)",
  previewUrl: PREVIEW, trackViewUrl: "https://music.apple.com/us/album/movement-1/1550697816?i=1550697824&uo=4",
};
const albumHit = {
  wrapperType: "collection", collectionType: "Album", collectionId: 1518680087, artistName: "Sault",
  collectionName: "Untitled (Black Is)", collectionViewUrl: "https://music.apple.com/us/album/untitled-black-is/1518680087?uo=4",
};
const albumLookup = { resultCount: 2, results: [albumHit, { wrapperType: "track", kind: "song", trackName: "Out the Lies",
  previewUrl: ALBUM_PREVIEW, trackViewUrl: "https://music.apple.com/us/album/out-the-lies/1518680087?i=1518680089&uo=4" }] };

const rec = (over: Partial<ExtrasRec>): ExtrasRec => ({
  type: "song", canonical_name: "Movement 1", creator: "Floating Points", apple_music_id: null, links: {}, about_url: null, ...over,
});

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>Song Exploder</title>
<item><title>Older &amp; wiser</title><pubDate>Wed, 01 Oct 2026 19:00:00 -0000</pubDate>
  <enclosure url="http://dts.podtrac.com/redirect.mp3/a.mp3" type="audio/mpeg" length="1"/></item>
<item><title><![CDATA[DJ Shadow - <em>Mutual</em> Slump]]></title><itunes:title>ignored</itunes:title>
  <pubDate>Wed, 14 Oct 2026 19:00:00 -0000</pubDate>
  <enclosure url="https://dts.podtrac.com/redirect.mp3/b.mp3" type="audio/mpeg" length="2"/></item>
<item><title>A video episode</title><pubDate>Thu, 15 Oct 2026 19:00:00 -0000</pubDate>
  <enclosure url="https://cdn.example/v.mp4" type="video/mp4"/></item>
<item><title>No date</title><enclosure url="https://cdn.example/c.mp3"/></item>
<item><title>Mid</title><pubDate>Wed, 07 Oct 2026 19:00:00 -0000</pubDate><enclosure type="audio/mpeg" url="https://cdn.example/m.mp3"/></item>
<item><title>Script</title><pubDate>Wed, 16 Oct 2026 19:00:00 -0000</pubDate><enclosure url="javascript:alert(1)"/></item>
</channel></rss>`;

// Music cases must never reach Discogs, even when the shell has the keys set (Discogs is tested in discogs.test.ts).
beforeEach(() => { vi.stubEnv("DISCOGS_KEY", ""); vi.stubEnv("DISCOGS_SECRET", ""); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("trimText", () => {
  it("keeps short text, and cuts long text at a word with an ellipsis, within the cap", () => {
    expect(trimText("  A  short\r\n\r\nline. ")).toBe("A short line.");
    const long = trimText("word ".repeat(200));
    expect(long!.length).toBeLessThanOrEqual(EXTRAS_TEXT_MAX);
    expect(long).toMatch(/word…$/);
    expect(trimText("   ")).toBeNull();
  });
});

describe("pickItunesPreview", () => {
  it("a song search: its preview and Apple Music link (tracking param dropped) when the name and artist fit", () => {
    expect(pickItunesPreview({ resultCount: 1, results: [songHit] }, rec({}), "song"))
      .toEqual({ audioUrl: PREVIEW, appleUrl: "https://music.apple.com/us/album/movement-1/1550697816?i=1550697824" });
  });
  it("never a different record: a name or artist that doesn't fit gives nothing", () => {
    expect(pickItunesPreview({ results: [songHit] }, rec({ canonical_name: "Promises" }), "song")).toBeNull();
    expect(pickItunesPreview({ results: [songHit] }, rec({ creator: "Bonobo" }), "song")).toBeNull();
    expect(pickItunesPreview({ results: [] }, rec({}), "song")).toBeNull();
    expect(pickItunesPreview(null, rec({}), "song")).toBeNull();
  });
  it("an album lookup (collection first, then its first track): the collection's link and the track's preview", () => {
    expect(pickItunesPreview(albumLookup, rec({ type: "album", canonical_name: "Untitled (Black Is)", creator: "SAULT" }), "album"))
      .toEqual({ audioUrl: ALBUM_PREVIEW, appleUrl: "https://music.apple.com/us/album/untitled-black-is/1518680087" });
  });
  it("an album search hit has no preview of its own: the collection id is returned for the track lookup", () => {
    expect(pickItunesPreview({ results: [albumHit] }, rec({ type: "album", canonical_name: "Untitled (Black Is)", creator: "Sault" }), "album"))
      .toEqual({ audioUrl: null, appleUrl: "https://music.apple.com/us/album/untitled-black-is/1518680087", collectionId: 1518680087 });
  });
  it("only web (https) URLs survive", () => {
    expect(pickItunesPreview({ results: [{ ...songHit, previewUrl: "javascript:alert(1)" }] }, rec({}), "song")).toBeNull();
  });
});

describe("latestEpisodes", () => {
  it("the newest 3 audio episodes by date, titles decoded and stripped, enclosures as https; video and non-web skipped", () => {
    expect(latestEpisodes(RSS)).toEqual([
      { title: "DJ Shadow - Mutual Slump", date: "2026-10-14T19:00:00.000Z", audioUrl: "https://dts.podtrac.com/redirect.mp3/b.mp3" },
      { title: "Mid", date: "2026-10-07T19:00:00.000Z", audioUrl: "https://cdn.example/m.mp3" },
      { title: "Older & wiser", date: "2026-10-01T19:00:00.000Z", audioUrl: "https://dts.podtrac.com/redirect.mp3/a.mp3" },
    ]);
  });
  it("tolerates junk and a feed cut off mid-item (the byte cap)", () => {
    expect(latestEpisodes("not xml")).toEqual([]);
    expect(latestEpisodes(RSS.slice(0, RSS.indexOf("<item><title>Mid")) + "<item><title>Cut")).toHaveLength(3);
  });
});

describe("bookFromOpenLibrary", () => {
  it("reads a description given as {type, value} or as a plain string, the first publish date and the median page count", () => {
    const work = { title: "The Hunger Games", description: { type: "/type/text", value: "The Hunger Games is a 2008 novel.\r\n\r\nIt won." } };
    expect(bookFromOpenLibrary(work, { docs: [{ number_of_pages_median: 397, first_publish_year: 2008 }] }))
      .toEqual({ description: "The Hunger Games is a 2008 novel. It won.", firstPublished: "2008", pages: 397 });
    expect(bookFromOpenLibrary({ description: "Plain.", first_publish_date: "September 14, 2008" }, null))
      .toEqual({ description: "Plain.", firstPublished: "September 14, 2008", pages: null });
  });
  it("nothing useful is null", () => {
    expect(bookFromOpenLibrary({ description: 42 }, { docs: [] })).toBeNull();
    expect(bookFromOpenLibrary(null, null)).toBeNull();
  });
});

describe("wikiExtract", () => {
  it("the summary's extract, capped, only from a standard page", () => {
    const url = "https://en.wikipedia.org/wiki/Sault_(band)";
    expect(wikiExtract({ type: "standard", extract: "Sault are a British music group. They formed in London." }, url))
      .toEqual({ text: "Sault are a British music group. They formed in London.", url });
    expect(wikiExtract({ type: "standard", extract: "x ".repeat(500) }, url)!.text.length).toBeLessThanOrEqual(EXTRAS_TEXT_MAX);
    expect(wikiExtract({ type: "disambiguation", extract: "Sault may refer to" }, url)).toBeNull();
    expect(wikiExtract({}, url)).toBeNull();
  });
});

describe("youtubeId", () => {
  it("reads the 11-character id from watch, youtu.be, shorts and live links", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=6avJHaC3C2U&t=3")).toBe("6avJHaC3C2U");
    expect(youtubeId("https://youtu.be/6avJHaC3C2U?t=3")).toBe("6avJHaC3C2U");
    expect(youtubeId("https://www.youtube.com/shorts/6avJHaC3C2U")).toBe("6avJHaC3C2U");
    expect(youtubeId("https://www.youtube.com/watch?v=bad")).toBeNull();
    expect(youtubeId(null)).toBeNull();
  });
});

describe("readExtras (what the page trusts from the stored jsonb)", () => {
  it("keeps well-formed parts and drops anything that isn't a web URL or the right shape", () => {
    expect(readExtras({
      preview: { audioUrl: PREVIEW, appleUrl: "https://music.apple.com/x" },
      episodes: [{ title: "Ep", date: null, audioUrl: "https://a/b.mp3" }, { title: "Bad", date: null, audioUrl: "javascript:x" }],
      videoId: "6avJHaC3C2U",
      wiki: { text: "Long.", url: "https://evil.example/wiki/x" },
    })).toEqual({
      preview: { audioUrl: PREVIEW, appleUrl: "https://music.apple.com/x" },
      episodes: [{ title: "Ep", date: null, audioUrl: "https://a/b.mp3" }],
      videoId: "6avJHaC3C2U",
    });
    expect(readExtras({ videoId: "\"><script>" })).toEqual({});
    expect(readExtras(null)).toEqual({});
  });
});

describe("fetchExtras (fetch mocked)", () => {
  it("a song with an Apple Music id: one lookup by id", async () => {
    const f = vi.fn(async () => json({ results: [songHit] }));
    expect(await fetchExtras(rec({ apple_music_id: "1550697824" }), f as never)).toEqual({ preview: expect.objectContaining({ audioUrl: PREVIEW }) });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe("https://itunes.apple.com/lookup?id=1550697824&entity=song&limit=1&country=us");
  });
  it("an album found by search with no preview: the first track via lookup?id=<collectionId>", async () => {
    const f = vi.fn(async (url: string) => json(url.includes("/search?") ? { results: [albumHit] } : albumLookup));
    const x = await fetchExtras(rec({ type: "album", canonical_name: "Untitled (Black Is)", creator: "Sault" }), f as never);
    expect(x.preview).toEqual({ audioUrl: ALBUM_PREVIEW, appleUrl: "https://music.apple.com/us/album/untitled-black-is/1518680087" });
    expect(f.mock.calls.map(([u]) => u)).toEqual([
      "https://itunes.apple.com/search?term=Untitled%20(Black%20Is)%20Sault&entity=album&limit=1&country=us",
      "https://itunes.apple.com/lookup?id=1518680087&entity=song&limit=1&country=us",
    ]);
  });
  it("a podcast: lookup by its Apple Podcasts id → feedUrl → the RSS's latest 3", async () => {
    const f = vi.fn(async (url: string) => (url.startsWith("https://itunes.apple.com/lookup")
      ? json({ results: [{ kind: "podcast", collectionName: "Song Exploder", feedUrl: "https://feed.songexploder.net/SongExploder" }] })
      : new Response(RSS, { status: 200 })));
    const x = await fetchExtras(rec({ type: "podcast", canonical_name: "Song Exploder", creator: null,
      links: { apple_podcasts: "https://podcasts.apple.com/us/podcast/song-exploder/id788236947" } }), f as never);
    expect(x.episodes).toHaveLength(3);
    expect(f.mock.calls.map(([u]) => u)).toEqual(["https://itunes.apple.com/lookup?id=788236947&country=us", "https://feed.songexploder.net/SongExploder"]);
  });
  it("a video: the id from its stored link, no request", async () => {
    const f = vi.fn();
    expect(await fetchExtras(rec({ type: "video", links: { youtube: "https://www.youtube.com/watch?v=6avJHaC3C2U" } }), f as never))
      .toEqual({ videoId: "6avJHaC3C2U" });
    expect(f).not.toHaveBeenCalled();
  });
  it("a book: the Open Library work, its page count, and the Wikipedia extract for its about_url", async () => {
    const f = vi.fn(async (url: string) => {
      if (url === "https://openlibrary.org/works/OL5735363W.json") return json({ description: { type: "/type/text", value: "A novel." } });
      if (url.startsWith("https://openlibrary.org/search.json")) return json({ docs: [{ number_of_pages_median: 397, first_publish_year: 2008 }] });
      if (url === "https://en.wikipedia.org/api/rest_v1/page/summary/Suzanne_Collins") return json({ type: "standard", extract: "Suzanne Collins is an American writer." });
      return json({}, 404);
    });
    const x = await fetchExtras(rec({ type: "book", canonical_name: "The Hunger Games", creator: "Suzanne Collins",
      links: { openlibrary: "https://openlibrary.org/works/OL5735363W" }, about_url: "https://en.wikipedia.org/wiki/Suzanne_Collins" }), f as never);
    expect(x).toEqual({
      book: { description: "A novel.", firstPublished: "2008", pages: 397 },
      wiki: { text: "Suzanne Collins is an American writer.", url: "https://en.wikipedia.org/wiki/Suzanne_Collins" },
    });
  });
  it("a place: nothing to fetch (its address is already on the tip)", async () => {
    const f = vi.fn();
    expect(await fetchExtras(rec({ type: "place" }), f as never)).toEqual({});
    expect(f).not.toHaveBeenCalled();
  });
  it("a 429 or a 5xx throws for the lane (which backs off or counts a try)", async () => {
    const f = vi.fn(async () => json({}, 429));
    await expect(fetchExtras(rec({ apple_music_id: "1" }), f as never)).rejects.toBeInstanceOf(ProviderHttpError);
  });
});

// Review round 1 (PR #40): a feed is someone else's server, not a shared service; and it must stay a public https host.
describe("podcast feeds: never a back-off, never a private host", () => {
  const podcast = rec({ type: "podcast", canonical_name: "Song Exploder", creator: null,
    links: { apple_podcasts: "https://podcasts.apple.com/us/podcast/song-exploder/id788236947" } });
  const lookup = (feedUrl: string) => json({ results: [{ kind: "podcast", collectionName: "Song Exploder", feedUrl }] });
  const feedFetch = (feedUrl: string, feed: (url: string) => Response) =>
    vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => (url.startsWith("https://itunes.apple.com/") ? lookup(feedUrl) : feed(url)));
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  const urls = (f: ReturnType<typeof feedFetch>) => f.mock.calls.map(([u]) => u);

  it("a feed answering 503 throws an error that is NOT a back-off signal (it counts a try)", async () => {
    const f = feedFetch("https://feed.example.com/rss", () => new Response("busy", { status: 503 }));
    const err = await fetchExtras(podcast, f as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProviderHttpError);
    expect(isBackOffSignal(err)).toBe(false);
  });
  it("refuses a plain-http feed without fetching it", async () => {
    const f = feedFetch("http://feed.example.com/rss", () => new Response(RSS));
    expect(await fetchExtras(podcast, f as never)).toEqual({});
    expect(urls(f)).toHaveLength(1); // the iTunes lookup only
  });
  it.each(["https://127.0.0.1/rss", "https://10.0.0.5/rss", "https://[::1]/rss", "https://2130706433/rss", "https://localhost/rss",
    "https://printer.local/rss", "https://intranet/rss"])("refuses %s without fetching it", async (feedUrl) => {
    const f = feedFetch(feedUrl, () => new Response(RSS));
    expect(await fetchExtras(podcast, f as never)).toEqual({});
    expect(urls(f)).toHaveLength(1);
  });
  it("follows a redirect to a public https host, re-checking it, and asks fetch not to follow redirects itself", async () => {
    const f = feedFetch("https://feed.example.com/rss",
      (url) => (url === "https://feed.example.com/rss" ? redirect("https://cdn.example.org/rss") : new Response(RSS)));
    expect((await fetchExtras(podcast, f as never)).episodes).toHaveLength(3);
    expect(urls(f).slice(1)).toEqual(["https://feed.example.com/rss", "https://cdn.example.org/rss"]);
    expect(f.mock.calls[1]![1]).toMatchObject({ redirect: "manual" });
  });
  it("refuses a redirect to a private host or to http, and gives up after 3 redirects", async () => {
    for (const to of ["https://169.254.169.254/latest", "https://192.168.1.1/rss", "https://172.16.0.1/rss", "http://cdn.example.org/rss"]) {
      const f = feedFetch("https://feed.example.com/rss", (url) => (url === "https://feed.example.com/rss" ? redirect(to) : new Response(RSS)));
      expect(await fetchExtras(podcast, f as never)).toEqual({});
      expect(urls(f).slice(1)).toEqual(["https://feed.example.com/rss"]); // the refused hop is never fetched
    }
    let n = 0;
    const loop = feedFetch("https://feed.example.com/rss", () => redirect(`https://feed.example.com/rss${++n}`));
    expect(await fetchExtras(podcast, loop as never)).toEqual({});
    expect(urls(loop).slice(1)).toHaveLength(4); // the feed plus 3 redirects, then no more
  });
});

describe("iTunes rate limiting", () => {
  it("an iTunes 403 is a back-off signal (stop the step, no try counted); another host's 403 is not", async () => {
    const f = vi.fn(async () => json({}, 403));
    const err = await fetchExtras(rec({ apple_music_id: "1" }), f as never).catch((e: unknown) => e);
    expect(isBackOffSignal(err)).toBe(true);
    expect(isBackOffSignal(new ProviderHttpError("openlibrary.org", 403))).toBe(false);
  });
});

describe("readExtras dates", () => {
  it("drops an episode whose date isn't a date (the page formats it)", () => {
    expect(readExtras({ episodes: [{ title: "Bad", date: "not a date", audioUrl: "https://a/b.mp3" },
      { title: "Ok", date: "2026-10-14T19:00:00.000Z", audioUrl: "https://a/c.mp3" }] }).episodes)
      .toEqual([{ title: "Ok", date: "2026-10-14T19:00:00.000Z", audioUrl: "https://a/c.mp3" }]);
  });
});
