import { describe, expect, it } from "vitest";
import { tipLinks } from "../../../agent/lib/garden/tip-detail";

describe("tipLinks (the tip page's link buttons)", () => {
  it("the card's own link first, named by what you do with it; the rest by service, each URL once", () => {
    expect(tipLinks("album", {
      musicbrainz: "https://musicbrainz.org/release-group/x",
      apple_music: "https://music.apple.com/us/album/x/1",
      url: "https://music.apple.com/us/album/x/1",
      discogs: "http://www.discogs.com/master/1",
    })).toEqual([
      { label: "Listen · Apple Music", url: "https://music.apple.com/us/album/x/1" },
      { label: "MusicBrainz", url: "https://musicbrainz.org/release-group/x" },
      { label: "Discogs", url: "https://www.discogs.com/master/1" },
    ]);
  });
  it("Read / Watch / Map by type; an unknown service is named by its host; lists (an email's urls) count too", () => {
    expect(tipLinks("book", { openlibrary: "https://openlibrary.org/works/OL1W" })).toEqual([{ label: "Read · Open Library", url: "https://openlibrary.org/works/OL1W" }]);
    expect(tipLinks("video", { youtube: "https://www.youtube.com/watch?v=6avJHaC3C2U", urls: ["https://www.example.com/a"] }))
      .toEqual([{ label: "Watch · YouTube", url: "https://www.youtube.com/watch?v=6avJHaC3C2U" }, { label: "example.com", url: "https://www.example.com/a" }]);
    expect(tipLinks("place", { google_maps: "https://maps.google.com/?cid=1" })).toEqual([{ label: "Map · Google Maps", url: "https://maps.google.com/?cid=1" }]);
  });
  it("a malformed stored link (email capture keeps trailing punctuation) never throws: unparseable dropped, odd kept", () => {
    expect(() => tipLinks("album", { url: "https://music.apple.com/x]" })).not.toThrow();
    expect(tipLinks("album", { url: "https://music.apple.com/x]" })).toEqual([{ label: "Listen · music.apple.com", url: "https://music.apple.com/x]" }]);
    expect(tipLinks("album", { urls: ["https://foo.com]", "https://ok.example/a"] })).toEqual([{ label: "ok.example", url: "https://ok.example/a" }]);
  });
  it("the owner's pasted link (decision 049): labelled like every other link, by verb and site", () => {
    expect(tipLinks("album", { bandcamp: "https://jimettarose.bandcamp.com/album/mettasun", musicbrainz: "https://musicbrainz.org/x" })).toEqual([
      { label: "Listen · Bandcamp", url: "https://jimettarose.bandcamp.com/album/mettasun" }, { label: "MusicBrainz", url: "https://musicbrainz.org/x" },
    ]);
    expect(tipLinks("place", { web: "https://www.mamasdiner.com/" })).toEqual([{ label: "mamasdiner.com", url: "https://www.mamasdiner.com/" }]);
  });
  it("never a non-web link", () => {
    expect(tipLinks("other", { url: "javascript:alert(1)", n: 4 })).toEqual([]);
    expect(tipLinks("other", null)).toEqual([]);
  });
});
