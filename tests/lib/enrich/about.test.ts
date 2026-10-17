import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { aboutFromSummary, aboutSubject, cleanAbout, fetchAbout, pickAboutPage } from "../../../agent/lib/enrich/about";
import { ProviderHttpError, USER_AGENT } from "../../../agent/lib/enrich/types";

// Recorded from real keyless calls (M3-T4b): the search for "SAULT" (no hint: only the disambiguation page and two
// cities come back) and the REST summary of Sault_(band).
const fx = (name: string) => JSON.parse(readFileSync(`tests/fixtures/enrich/${name}`, "utf8")) as unknown;
const SEARCH_SAULT = fx("wikipedia-about-search-sault.json");
const SUMMARY_SAULT = fx("wikipedia-about-summary-sault-band.json");
// The real top three for "SAULT music" (same call shape, copied from the live response).
const SEARCH_SAULT_MUSIC = { pages: [
  { key: "Sault_(band)", title: "Sault (band)", description: "British R&B group" },
  { key: "Sault", title: "Sault", description: "Topics referred to by the same term" },
  { key: "Cleo_Sol", title: "Cleo Sol", description: "English musical artist (born 1990)" },
] };
const rec = (type: string, name: string, creator: string | null = null) =>
  ({ type, canonical_name: name, creator }) as Parameters<typeof aboutSubject>[0];

describe("aboutSubject: whose note a tip gets", () => {
  it("album and song → the artist; book → the author; artist, place, podcast, film → the thing itself", () => {
    expect(aboutSubject(rec("album", "Untitled (Black Is)", "SAULT"))).toBe("SAULT");
    expect(aboutSubject(rec("song", "Wildfires", "SAULT"))).toBe("SAULT");
    expect(aboutSubject(rec("book", "The Overstory", "Richard Powers"))).toBe("Richard Powers");
    expect(aboutSubject(rec("artist", "SAULT"))).toBe("SAULT");
    expect(aboutSubject(rec("place", "Kopp's Frozen Custard"))).toBe("Kopp's Frozen Custard");
    expect(aboutSubject(rec("podcast", "Song Exploder"))).toBe("Song Exploder");
    expect(aboutSubject(rec("film_tv", "The Bear"))).toBe("The Bear");
  });
  it("no subject → no lookup: 'other', or an album or book with no known maker", () => {
    expect(aboutSubject(rec("other", "Theremin"))).toBeNull();
    expect(aboutSubject(rec("album", "Night Garden"))).toBeNull();
    expect(aboutSubject(rec("book", "Night Garden", "  "))).toBeNull();
  });
});

describe("pickAboutPage: only a page that is clearly the subject", () => {
  it("takes the one page whose title is the name and whose description fits the kind of thing", () => {
    expect(pickAboutPage(SEARCH_SAULT_MUSIC, "SAULT", "artist")).toBe("Sault_(band)");
  });
  it("a disambiguation page or a same-named city is never the band (recorded search)", () => {
    expect(pickAboutPage(SEARCH_SAULT, "SAULT", "artist")).toBeNull();
  });
  it("a same-named page about the wrong kind of thing is refused (no wrong person's bio)", () => {
    const novelist = { pages: [{ key: "John_Smith_(writer)", title: "John Smith (writer)", description: "American novelist" }] };
    expect(pickAboutPage(novelist, "John Smith", "album")).toBeNull(); // the album's artist is not a novelist
    expect(pickAboutPage(novelist, "John Smith", "book")).toBe("John_Smith_(writer)");
    const person = { pages: [{ key: "Kopp", title: "Kopp", description: "American politician (born 1950)" }] };
    expect(pickAboutPage(person, "Kopp", "place")).toBeNull();
  });
  it("two pages that both fit: unsure, so nothing", () => {
    const two = { pages: [
      { key: "Low_(band)", title: "Low (band)", description: "American rock band" },
      { key: "Low_(British_band)", title: "Low (British band)", description: "British band" },
    ] };
    expect(pickAboutPage(two, "Low", "artist")).toBeNull();
  });
  it("a close but different title is not the subject", () => {
    const near = { pages: [{ key: "Sault_Ste._Marie", title: "Sault Ste. Marie", description: "City" }] };
    expect(pickAboutPage(near, "Sault", "place")).toBeNull();
    const accents = { pages: [{ key: "Beyoncé", title: "Beyoncé", description: "American singer (born 1981)" }] };
    expect(pickAboutPage(accents, "BEYONCE", "artist")).toBe("Beyoncé"); // case and accents don't matter
  });
  it("junk JSON → nothing", () => {
    expect(pickAboutPage(null, "SAULT", "artist")).toBeNull();
    expect(pickAboutPage({ pages: "x" }, "SAULT", "artist")).toBeNull();
  });
});

describe("aboutFromSummary: one plain sentence and its source", () => {
  it("the recorded summary → its first sentence and the page URL", () => {
    expect(aboutFromSummary(SUMMARY_SAULT, "Sault_(band)")).toEqual({
      text: "Sault are a British music group that make a mixture of R&B, urban contemporary gospel, house and disco.",
      url: "https://en.wikipedia.org/wiki/Sault_(band)",
    });
  });
  it("a disambiguation or a different page than the one picked → nothing", () => {
    expect(aboutFromSummary({ ...(SUMMARY_SAULT as object), type: "disambiguation" }, "Sault_(band)")).toBeNull();
    expect(aboutFromSummary(SUMMARY_SAULT, "Sault")).toBeNull(); // a redirect landed somewhere else
    expect(aboutFromSummary({ ...(SUMMARY_SAULT as object), extract: "  " }, "Sault_(band)")).toBeNull();
    expect(aboutFromSummary(null, "Sault_(band)")).toBeNull();
  });
});

describe("cleanAbout", () => {
  it("drops pronunciations, birth dates and other parentheticals, and keeps only the first sentence", () => {
    expect(cleanAbout("Richard Powers (born June 18, 1957) is an American novelist. His works explore science."))
      .toBe("Richard Powers is an American novelist.");
    expect(cleanAbout("Björk Guðmundsdóttir (/bjɜːrk/ (listen); Icelandic: [pjœr̥k]; born 1965) is an Icelandic singer."))
      .toBe("Björk Guðmundsdóttir is an Icelandic singer.");
  });
  it("an abbreviation or an initial does not end the sentence", () => {
    expect(cleanAbout("Kopp's is a custard stand in St. Louis, run by John F. Kennedy's cousin. It opened in 1950."))
      .toBe("Kopp's is a custard stand in St. Louis, run by John F. Kennedy's cousin.");
    expect(cleanAbout("Fort Bragg is a U.S. Army post in North Carolina. It is large.")).toBe("Fort Bragg is a U.S. Army post in North Carolina.");
  });
  it("clamps to 25 words", () => {
    const long = `${Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")}.`;
    const out = cleanAbout(long)!;
    expect(out.split(" ")).toHaveLength(25);
    expect(out.endsWith("…")).toBe(true);
  });
  it("nothing left → null", () => {
    expect(cleanAbout("(only a parenthetical)")).toBeNull();
  });
});

describe("fetchAbout: search, then one summary, keyless", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it("searches with a kind hint, then fetches the picked page's summary, with the User-Agent and a timeout", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/search/page") ? ok(SEARCH_SAULT_MUSIC) : ok(SUMMARY_SAULT));
    const about = await fetchAbout(rec("album", "Untitled (Rise)", "SAULT"), fetchImpl as unknown as typeof fetch);
    expect(about?.url).toBe("https://en.wikipedia.org/wiki/Sault_(band)");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [[searchUrl, init], [summaryUrl]] = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(searchUrl).toBe("https://en.wikipedia.org/w/rest.php/v1/search/page?q=SAULT%20music&limit=3");
    expect(summaryUrl).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Sault_(band)");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("no fitting page → no summary call; a 404 summary → nothing; a 503 is thrown for the lane to log", async () => {
    const none = vi.fn(async () => ok(SEARCH_SAULT));
    expect(await fetchAbout(rec("artist", "SAULT"), none as unknown as typeof fetch)).toBeNull();
    expect(none).toHaveBeenCalledTimes(1);
    const gone = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/search/page") ? ok(SEARCH_SAULT_MUSIC) : new Response("", { status: 404 }));
    expect(await fetchAbout(rec("artist", "SAULT"), gone as unknown as typeof fetch)).toBeNull();
    const busy = vi.fn(async () => new Response("", { status: 503 }));
    await expect(fetchAbout(rec("artist", "SAULT"), busy as unknown as typeof fetch)).rejects.toBeInstanceOf(ProviderHttpError);
  });
  it("a tip with no subject makes no call", async () => {
    const f = vi.fn();
    expect(await fetchAbout(rec("other", "Theremin"), f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
