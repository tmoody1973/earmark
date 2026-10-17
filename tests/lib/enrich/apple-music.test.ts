import { describe, expect, it } from "vitest";
import { artworkUrl, parseAppleSearch } from "../../../agent/lib/enrich/apple-music";

// No Apple keys exist yet, so this is NOT a recorded response: it is the documented shape
// (docs/research/integrations.md §1, https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type)).
// Replace with a recorded fixture once APPLE_* keys land (scripts/record-enrichment-fixture.ts apple album ...).
const documented = {
  results: {
    albums: {
      data: [{
        id: "1549320040", type: "albums",
        attributes: { name: "Night Garden", artistName: "Mara Vell", releaseDate: "2021-03-26",
          url: "https://music.apple.com/us/album/night-garden/1549320040", artwork: { url: "https://is1.example/{w}x{h}bb.jpg" } },
      }],
    },
  },
};
const q = { type: "album" as const, name: "Night Garden", creator: "Mara Vell", lat: null, lng: null };

describe("parseAppleSearch", () => {
  it("reads name, artist, year, artwork and link from the documented search shape", () => {
    const [first] = parseAppleSearch(documented, q);
    expect(first).toMatchObject({ canonicalName: "Night Garden", creator: "Mara Vell", yearOrAddress: "2021",
      imageUrl: "https://is1.example/600x600bb.jpg", appleMusicId: "1549320040",
      links: { apple_music: "https://music.apple.com/us/album/night-garden/1549320040" } });
  });

  it("returns nothing for an empty result set", () => {
    expect(parseAppleSearch({ results: {} }, { ...q, type: "song" })).toEqual([]);
  });
});

describe("artworkUrl", () => {
  it("fills the size template", () => {
    expect(artworkUrl("https://a/{w}x{h}bb.jpg", 300)).toBe("https://a/300x300bb.jpg");
    expect(artworkUrl(undefined)).toBeNull();
  });
});
