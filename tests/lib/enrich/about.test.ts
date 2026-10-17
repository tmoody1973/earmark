import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  aboutFromSummary, aboutSubject, cleanAbout, confirmsSubject, fetchAbout, musicBrainzRef, pickAboutPage, wikidataAskQuery,
} from "../../../agent/lib/enrich/about";
import { ProviderHttpError, USER_AGENT } from "../../../agent/lib/enrich/types";

// Recorded from real keyless calls (M3-T4b): the search for "SAULT" (no hint: only the disambiguation page and two
// cities come back), the REST summary of Sault_(band), and the Wikidata SPARQL ASK that Sault's item (Q104771175) has
// MusicBrainz artist id 23b19bc5-… (P434).
const fx = (name: string) => JSON.parse(readFileSync(`tests/fixtures/enrich/${name}`, "utf8")) as unknown;
const SEARCH_SAULT = fx("wikipedia-about-search-sault.json");
const SUMMARY_SAULT = fx("wikipedia-about-summary-sault-band.json");
const ASK_SAULT = fx("wikidata-ask-sault-p434.json");
const SAULT_MB = "https://musicbrainz.org/artist/23b19bc5-813e-4456-bbae-ac3ca118f535";
// The real top three for "SAULT music" (same call shape, copied from the live response).
const SEARCH_SAULT_MUSIC = { pages: [
  { key: "Sault_(band)", title: "Sault (band)", description: "British R&B group" },
  { key: "Sault", title: "Sault", description: "Topics referred to by the same term" },
  { key: "Cleo_Sol", title: "Cleo Sol", description: "English musical artist (born 1990)" },
] };
type Rec = Parameters<typeof aboutSubject>[0];
const rec = (type: string, name: string, creator: string | null = null, over: Partial<Rec> = {}) =>
  ({ type, canonical_name: name, creator, year_or_address: null, links: {}, ...over }) as Rec;

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
  it("no subject → no lookup: 'other', a video (add-on: store nothing), or an album or book with no known maker", () => {
    expect(aboutSubject(rec("other", "Theremin"))).toBeNull();
    expect(aboutSubject(rec("video", "The Art of Code", "NDC Conferences"))).toBeNull();
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
  it("kind words are whole words: a martial artist, a film producer, a musical film or a talk show host don't count", () => {
    const one = (title: string, description: string) => ({ pages: [{ key: title, title, description }] });
    expect(pickAboutPage(one("Cleo Sol", "English musical artist (born 1990)"), "Cleo Sol", "artist")).toBe("Cleo Sol");
    expect(pickAboutPage(one("Low", "American martial artist"), "Low", "artist")).toBeNull();
    expect(pickAboutPage(one("Low", "American film producer"), "Low", "artist")).toBeNull();
    expect(pickAboutPage(one("Low", "1965 musical film"), "Low", "artist")).toBeNull();
    expect(pickAboutPage(one("Low", "1965 musical film"), "Low", "film_tv")).toBe("Low");
    expect(pickAboutPage(one("Low", "American talk show host"), "Low", "film_tv")).toBeNull();
    expect(pickAboutPage(one("Low", "American television presenter (born 1970)"), "Low", "film_tv")).toBeNull();
    expect(pickAboutPage(one("Ann Lee", "American neuroscientist and author"), "Ann Lee", "book")).toBe("Ann Lee");
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

describe("confirmsSubject: the page must also be about this tip, not a namesake", () => {
  const page = (description: string, extract: string, excerpt = "") => ({ description, extract, excerpt });
  it("a place needs a venue word, or the tip's town in the summary; a city or a tree never stands in for a restaurant", () => {
    const rome = rec("place", "Rome", null, { year_or_address: "1200 N Water St, Milwaukee, WI 53202, USA" });
    expect(confirmsSubject(rome, page("Capital and largest city of Italy", "Rome is the capital city of Italy."))).toBe(false);
    expect(confirmsSubject(rec("place", "Birch"), page("Genus of trees", "Birch is a deciduous hardwood tree."))).toBe(false);
    expect(confirmsSubject(rec("place", "Kopp's Frozen Custard"), page("Fast food restaurant", "Kopp's is a chain."))).toBe(true);
    expect(confirmsSubject(rome, page("Italian eatery", "Rome is an Italian eatery in Milwaukee, Wisconsin."))).toBe(true);
    // the tip's own name is never its "town"
    const lagos = rec("place", "Lagos", null, { year_or_address: "Lagos, 1 Main St, Chicago" });
    expect(confirmsSubject(lagos, page("City in Nigeria", "Lagos is the largest city in Nigeria."))).toBe(false);
  });
  it("a book's author page must mention the book (summary or search excerpt)", () => {
    const book = rec("book", "The Overstory: A Novel", "Richard Powers");
    expect(confirmsSubject(book, page("American novelist", "Powers won the Pulitzer Prize for The Overstory."))).toBe(true);
    expect(confirmsSubject(book, page("American novelist", "Powers writes novels.", "author of <span class=\"searchmatch\">The Overstory</span>"))).toBe(true);
    expect(confirmsSubject(book, page("American novelist", "Powers writes novels."))).toBe(false);
  });
  it("film/TV and podcasts need the year or the maker to match, and nothing when we know neither", () => {
    const bear = (over: Partial<Rec>) => rec("film_tv", "The Bear", null, over);
    const p = page("American comedy-drama television series", "The Bear is a series created by Christopher Storer that premiered in 2022.");
    expect(confirmsSubject(bear({ year_or_address: "2022" }), p)).toBe(true);
    expect(confirmsSubject(bear({ year_or_address: "1988" }), p)).toBe(false);
    expect(confirmsSubject(bear({ creator: "Christopher Storer" }), p)).toBe(true);
    expect(confirmsSubject(bear({}), p)).toBe(false);
    const pod = rec("podcast", "Song Exploder", "Hrishikesh Hirway");
    expect(confirmsSubject(pod, page("Music podcast", "Song Exploder is a music podcast hosted by Hrishikesh Hirway."))).toBe(true);
    expect(confirmsSubject(rec("podcast", "Song Exploder", "Someone Else"), page("Music podcast", "Hosted by Hrishikesh Hirway."))).toBe(false);
  });
});

describe("musicBrainzRef and the Wikidata check (P434)", () => {
  it("reads the matched MusicBrainz entity from the tip's links", () => {
    expect(musicBrainzRef({ musicbrainz: SAULT_MB })).toEqual({ kind: "artist", id: "23b19bc5-813e-4456-bbae-ac3ca118f535" });
    expect(musicBrainzRef({ musicbrainz: "https://musicbrainz.org/release-group/0b2d4ec0-0000-4000-8000-000000000001" }))
      .toEqual({ kind: "release-group", id: "0b2d4ec0-0000-4000-8000-000000000001" });
    expect(musicBrainzRef({ musicbrainz: "https://musicbrainz.org/artist/not-an-id\"}" })).toBeNull();
    expect(musicBrainzRef({ apple_music: "https://music.apple.com/x" })).toBeNull();
    expect(musicBrainzRef(null)).toBeNull();
  });
  it("asks whether the page's item is that artist (P434), or performs that release group (P436) or recording (P4404)", () => {
    const id = "23b19bc5-813e-4456-bbae-ac3ca118f535";
    expect(wikidataAskQuery("Q104771175", { kind: "artist", id })).toBe(`ASK { wd:Q104771175 wdt:P434 "${id}" }`);
    expect(wikidataAskQuery("Q1", { kind: "release-group", id })).toBe(`ASK { ?x wdt:P436 "${id}" ; wdt:P175 wd:Q1 }`);
    expect(wikidataAskQuery("Q1", { kind: "recording", id })).toBe(`ASK { ?x wdt:P4404 "${id}" ; wdt:P175 wd:Q1 }`);
    expect(wikidataAskQuery("Q1 } DELETE", { kind: "artist", id })).toBeNull();
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

describe("fetchAbout: search, one summary, and for music one Wikidata check, keyless", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const route = (ask: unknown) => vi.fn(async (url: string | URL | Request) =>
    ok(String(url).includes("/search/page") ? SEARCH_SAULT_MUSIC : String(url).includes("query.wikidata.org") ? ask : SUMMARY_SAULT));
  const sault = (type = "artist") => type === "artist"
    ? rec("artist", "SAULT", null, { links: { musicbrainz: SAULT_MB } })
    : rec(type, "Untitled (Rise)", "SAULT", { links: { musicbrainz: SAULT_MB } });

  it("searches with a kind hint, fetches the summary, and confirms the artist on Wikidata, with the User-Agent and a timeout", async () => {
    const fetchImpl = route(ASK_SAULT);
    const about = await fetchAbout(sault(), fetchImpl as unknown as typeof fetch);
    expect(about?.url).toBe("https://en.wikipedia.org/wiki/Sault_(band)");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [[searchUrl, init], [summaryUrl], [askUrl]] = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(searchUrl).toBe("https://en.wikipedia.org/w/rest.php/v1/search/page?q=SAULT%20music&limit=3");
    expect(summaryUrl).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Sault_(band)");
    expect(new URL(askUrl).searchParams.get("query")).toBe('ASK { wd:Q104771175 wdt:P434 "23b19bc5-813e-4456-bbae-ac3ca118f535" }');
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("music: Wikidata says no, or the tip has no MusicBrainz match → nothing (no call at all without one)", async () => {
    expect(await fetchAbout(sault("album"), route({ boolean: false }) as unknown as typeof fetch)).toBeNull();
    const noMb = route(ASK_SAULT);
    expect(await fetchAbout(rec("artist", "SAULT"), noMb as unknown as typeof fetch)).toBeNull();
    expect(noMb).toHaveBeenCalledTimes(0);
  });
  it("no fitting page → no summary call; a 404 summary → nothing; a 503 is thrown for the lane", async () => {
    const none = vi.fn(async () => ok(SEARCH_SAULT));
    expect(await fetchAbout(sault(), none as unknown as typeof fetch)).toBeNull();
    expect(none).toHaveBeenCalledTimes(1);
    const gone = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/search/page") ? ok(SEARCH_SAULT_MUSIC) : new Response("", { status: 404 }));
    expect(await fetchAbout(sault(), gone as unknown as typeof fetch)).toBeNull();
    const busy = vi.fn(async () => new Response("", { status: 503 }));
    await expect(fetchAbout(sault(), busy as unknown as typeof fetch)).rejects.toBeInstanceOf(ProviderHttpError);
  });
  it("a tip with no subject makes no call", async () => {
    const f = vi.fn();
    expect(await fetchAbout(rec("other", "Theremin"), f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
