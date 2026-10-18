import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openLibraryProvider } from "../../../agent/lib/enrich/open-library";
import { placesProvider, PLACES_FIELD_MASK } from "../../../agent/lib/enrich/places";
import { itunesPodcastProvider, podcastIndexHeaders, podcastIndexProvider } from "../../../agent/lib/enrich/podcasts";
import { enabledTypes, providerFor } from "../../../agent/lib/enrich/registry";
import { tmdbProvider } from "../../../agent/lib/enrich/tmdb";
import type { EnrichQuery } from "../../../agent/lib/enrich/types";
import { wikipediaProvider } from "../../../agent/lib/enrich/wikipedia";
import type { RecType } from "../../../agent/lib/types";

// Recorded fixtures = one real keyless call each (Open Library, Wikipedia, iTunes). Keyed providers (TMDB, Places,
// Podcast Index) have no keys yet, so their parse tests use hand-built responses in the documented shape.
const fx = (f: string) => JSON.parse(readFileSync(`tests/fixtures/enrich/${f}`, "utf8"));
const q = (type: RecType, name: string, creator: string | null = null, lat: number | null = null, lng: number | null = null): EnrichQuery =>
  ({ type, name, creator, lat, lng });

describe("Open Library (recorded)", () => {
  it("parses works with author, year, cover and work link", () => {
    const [b] = openLibraryProvider.parse(fx("openlibrary-book-overstory.json"), q("book", "The Overstory"));
    expect(b).toMatchObject({ canonicalName: "The Overstory", creator: "Richard Powers", yearOrAddress: "2018",
      imageUrl: "https://covers.openlibrary.org/b/id/8758252-M.jpg", links: { openlibrary: "https://openlibrary.org/works/OL19074847W" } });
  });
  it("searches title OR author so a misheard author still finds the book; title only without one", async () => {
    const withAuthor = decodeURIComponent((await openLibraryProvider.build(q("book", "The Overstory", "Richard Pwers"))).url);
    expect(withAuthor).toContain("q=title:(The Overstory) OR author:(Richard Pwers)");
    const titleOnly = await openLibraryProvider.build(q("book", "Help! AND Me"));
    expect(decodeURIComponent(titleOnly.url)).toContain("q=title:(Help\\! and Me)&");
    expect((titleOnly.init.headers as Record<string, string>)["User-Agent"]).toMatch(/^Earmark\//);
  });
});

describe("Wikipedia (recorded)", () => {
  it("parses pages with description, a 330px https thumbnail and an article link", () => {
    const pages = wikipediaProvider.parse(fx("wikipedia-other-theremin.json"), q("other", "Theremin"));
    expect(pages[0]).toMatchObject({ canonicalName: "Theremin", yearOrAddress: "Electronic musical instrument",
      imageUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Etherwave_Theremin_Kit.jpg/330px-Etherwave_Theremin_Kit.jpg",
      links: { wikipedia: "https://en.wikipedia.org/wiki/Theremin" } });
    expect(pages[1]!.links.wikipedia).toBe("https://en.wikipedia.org/wiki/Leon_Theremin");
    expect(pages[2]!.imageUrl).toBeNull(); // no thumbnail
  });
});

describe("iTunes podcast search (recorded, keyless fallback)", () => {
  it("parses shows with host, art and Apple Podcasts link", () => {
    const [p] = itunesPodcastProvider.parse(fx("itunes-podcast-song-exploder.json"), q("podcast", "Song Exploder"));
    expect(p).toMatchObject({ canonicalName: "Song Exploder", creator: "Hrishikesh Hirway",
      links: { apple_podcasts: "https://podcasts.apple.com/us/podcast/song-exploder/id788236947" } });
    expect(p!.imageUrl).toMatch(/^https:\/\/.*600x600bb\.jpg$/);
  });
  it("asks for podcasts only", async () => {
    const { url } = await itunesPodcastProvider.build(q("podcast", "Song Exploder"));
    expect(url).toBe("https://itunes.apple.com/search?term=Song%20Exploder&media=podcast&entity=podcast&limit=3");
  });
});

describe("keyed providers (documented shapes)", () => {
  it("TMDB keeps only movies and TV, with year, poster and TMDB link", () => {
    const rows = tmdbProvider("tok").parse({ results: [
      { media_type: "person", id: 1, name: "Someone" },
      { media_type: "movie", id: 666277, title: "Night Garden", release_date: "2023-06-02", poster_path: "/p.jpg" },
      { media_type: "tv", id: 9, name: "Night Garden Show", first_air_date: "", poster_path: null },
    ] }, q("film_tv", "Night Garden"));
    expect(rows).toEqual([
      { canonicalName: "Night Garden", creator: null, yearOrAddress: "2023", imageUrl: "https://image.tmdb.org/t/p/w500/p.jpg",
        links: { tmdb: "https://www.themoviedb.org/movie/666277" } },
      { canonicalName: "Night Garden Show", creator: null, yearOrAddress: null, imageUrl: null, links: { tmdb: "https://www.themoviedb.org/tv/9" } },
    ]);
  });
  it("TMDB sends the read-access token as a Bearer header", async () => {
    const { url, init } = await tmdbProvider("tok").build(q("film_tv", "Night Garden"));
    expect(url).toBe("https://api.themoviedb.org/3/search/multi?query=Night%20Garden&include_adult=false&page=1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("Places: Essentials/Pro field mask only, biased to where it was said, parses address + coordinates + maps link", async () => {
    const { url, init } = await placesProvider("k").build(q("place", "Ramen-Ya", null, 43.04, -87.91));
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(PLACES_FIELD_MASK);
    expect(JSON.parse(String(init.body))).toEqual({ textQuery: "Ramen-Ya", pageSize: 3,
      locationBias: { circle: { center: { latitude: 43.04, longitude: -87.91 }, radius: 20000 } } });
    const [p] = placesProvider("k").parse({ places: [{ id: "x", displayName: { text: "Ramen-Ya" }, formattedAddress: "1 Main St, Milwaukee, WI",
      location: { latitude: 43.05, longitude: -87.9 }, googleMapsUri: "https://maps.google.com/?cid=1" }] }, q("place", "Ramen-Ya"));
    expect(p).toEqual({ canonicalName: "Ramen-Ya", creator: null, yearOrAddress: "1 Main St, Milwaukee, WI", imageUrl: null,
      links: { google_maps: "https://maps.google.com/?cid=1" }, lat: 43.05, lng: -87.9 });
  });
  it("Places without coordinates sends no location bias", async () => {
    const { init } = await placesProvider("k").build(q("place", "Ramen-Ya"));
    expect(JSON.parse(String(init.body))).toEqual({ textQuery: "Ramen-Ya", pageSize: 3 });
  });
  it("Podcast Index parses feeds", () => {
    const [p] = podcastIndexProvider("k", "s").parse({ feeds: [{ id: 7, title: "Night Garden Radio", author: "Mara Vell",
      artwork: "https://img/x.jpg", link: "" }] }, q("podcast", "Night Garden Radio"));
    expect(p).toEqual({ canonicalName: "Night Garden Radio", creator: "Mara Vell", yearOrAddress: null, imageUrl: "https://img/x.jpg",
      links: { podcast_index: "https://podcastindex.org/podcast/7" } });
  });
  it("Podcast Index hashes key + secret + epoch seconds with SHA-1", () => {
    const h = podcastIndexHeaders("k", "s", 1700000000);
    expect(h["X-Auth-Date"]).toBe("1700000000");
    expect(h.Authorization).toBe("e5b405233537c8825f2c365d91c7dec6669650de"); // printf 'ks1700000000' | shasum -a 1
  });
});

describe("registry: provider per type, keyed ones only when their env is set", () => {
  const none = {};
  it("keyless today: music → MusicBrainz, book → Open Library, other → Wikipedia, podcast → iTunes, video → YouTube oEmbed", () => {
    expect(providerFor("album", none)?.name).toBe("musicbrainz");
    expect(providerFor("book", none)?.name).toBe("openlibrary");
    expect(providerFor("other", none)?.name).toBe("wikipedia");
    expect(providerFor("podcast", none)?.name).toBe("itunes");
    expect(providerFor("film_tv", none)).toBeNull();
    expect(providerFor("place", none)?.name).toBe("nominatim");
    expect(providerFor("video", none)?.name).toBe("youtube");
    expect(enabledTypes(none)).toEqual(["album", "song", "artist", "book", "place", "podcast", "video", "other"]);
  });
  it("a Google key wins for places; a blank key falls back to Nominatim", () => {
    expect(providerFor("place", { GOOGLE_PLACES_API_KEY: "g" })?.name).toBe("places");
    expect(providerFor("place", { GOOGLE_PLACES_API_KEY: "  " })?.name).toBe("nominatim");
  });
  it("keys switch TMDB, Places and Podcast Index on", () => {
    const env = { TMDB_API_KEY: "t", GOOGLE_PLACES_API_KEY: "g", PODCAST_INDEX_KEY: "k", PODCAST_INDEX_SECRET: "s" };
    expect(providerFor("film_tv", env)?.name).toBe("tmdb");
    expect(providerFor("place", env)?.name).toBe("places");
    expect(providerFor("podcast", env)?.name).toBe("podcastindex");
    expect(providerFor("podcast", { PODCAST_INDEX_KEY: "k" })?.name).toBe("itunes"); // half a key pair = not configured
    expect(enabledTypes(env)).toHaveLength(9);
  });
});
