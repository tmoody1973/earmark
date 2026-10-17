import { describe, expect, it } from "vitest";
import {
  cardArtwork, cardArtworkUrl, cardLink, cardVariant, clampWhy, imageLoadFailed, lonLatToTile, osmTileUrl, spineHue,
} from "../../../agent/lib/garden/cards";

describe("cardVariant", () => {
  it("maps every rec type to its card", () => {
    expect(cardVariant("album")).toBe("cover");
    expect(cardVariant("song")).toBe("cover");
    expect(cardVariant("artist")).toBe("artist");
    expect(cardVariant("book")).toBe("spine");
    expect(cardVariant("place")).toBe("map");
    expect(cardVariant("podcast")).toBe("tile");
    expect(cardVariant("film_tv")).toBe("poster");
    expect(cardVariant("video")).toBe("screen");
    expect(cardVariant("other")).toBe("note");
  });
});

describe("cardArtworkUrl", () => {
  it("fills Apple Music {w}x{h} templates", () => {
    expect(cardArtworkUrl("https://is1.mzstatic.com/a/{w}x{h}bb.jpg", 300))
      .toBe("https://is1.mzstatic.com/a/300x300bb.jpg");
  });
  it("leaves plain URLs alone and passes null through", () => {
    expect(cardArtworkUrl("https://covers.openlibrary.org/b/id/1-M.jpg", 300))
      .toBe("https://covers.openlibrary.org/b/id/1-M.jpg");
    expect(cardArtworkUrl(null, 300)).toBeNull();
  });
  it("upgrades http artwork to https so a card never loads mixed content", () => {
    expect(cardArtworkUrl("http://is1.mzstatic.com/a/{w}x{h}bb.jpg", 300)).toBe("https://is1.mzstatic.com/a/300x300bb.jpg");
    expect(cardArtworkUrl("HTTP://covers.openlibrary.org/b/id/1-M.jpg", 300)).toBe("https://covers.openlibrary.org/b/id/1-M.jpg");
  });
  it("refuses anything that is not http(s), so a stored value can never become a script or data URL", () => {
    expect(cardArtworkUrl("javascript:alert(1)", 300)).toBeNull();
    expect(cardArtworkUrl("data:image/png;base64,AAAA", 300)).toBeNull();
    expect(cardArtworkUrl("", 300)).toBeNull();
  });
});

describe("cardArtwork (the no-image fallback)", () => {
  const base = { imageUrl: null, lat: null, lng: null };
  it("uses the image when one exists", () => {
    expect(cardArtwork({ ...base, variant: "cover", imageUrl: "https://x/a.jpg" })).toEqual({ kind: "image", src: "https://x/a.jpg" });
    expect(cardArtwork({ ...base, variant: "map", imageUrl: "https://x/venue.jpg", lat: 43, lng: -87 }))
      .toEqual({ kind: "image", src: "https://x/venue.jpg" });
  });
  it("gives a place without a photo its map tile, and one without coordinates the typographic state", () => {
    const art = cardArtwork({ ...base, variant: "map", lat: 43.0389, lng: -87.9065 });
    expect(art.kind).toBe("map");
    expect(cardArtwork({ ...base, variant: "map" })).toEqual({ kind: "none" });
    expect(cardArtwork({ ...base, variant: "map", lat: 43 })).toEqual({ kind: "none" });
  });
  it("never shows a photo on an artist card (no photos of people)", () => {
    expect(cardArtwork({ ...base, variant: "artist", imageUrl: "https://x/face.jpg" })).toEqual({ kind: "none" });
  });
  it("falls back to the typographic state for every other variant without an image", () => {
    for (const variant of ["cover", "spine", "tile", "poster", "screen", "note"] as const) {
      expect(cardArtwork({ ...base, variant })).toEqual({ kind: "none" });
    }
  });
});

describe("clampWhy", () => {
  it("keeps a summary of 30 words or fewer as written, trimmed", () => {
    expect(clampWhy("  play it loud, start to finish ")).toBe("play it loud, start to finish");
  });
  it("cuts a longer summary to 30 words and marks the cut", () => {
    const long = Array.from({ length: 34 }, (_, i) => `w${i + 1}`).join(" ");
    const out = clampWhy(long)!;
    expect(out.endsWith("…")).toBe(true);
    expect(out.replace("…", "").trim().split(/\s+/)).toHaveLength(30);
  });
  it("drops trailing punctuation before the ellipsis", () => {
    const long = `${Array.from({ length: 29 }, () => "a").join(" ")} end, more words here`;
    expect(clampWhy(long)).toBe(`${Array.from({ length: 29 }, () => "a").join(" ")} end…`);
  });
  it("omits a missing or blank summary rather than inventing one", () => {
    expect(clampWhy(null)).toBeNull();
    expect(clampWhy("   ")).toBeNull();
  });
});

describe("spineHue", () => {
  it("is deterministic and within 0–359", () => {
    const h = spineHue("The Overstory");
    expect(h).toBe(spineHue("The Overstory"));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(spineHue("Piranesi")).not.toBe(h);
  });
});

describe("lonLatToTile", () => {
  it("matches the slippy-map formula at the origin", () => {
    expect(lonLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1, z: 1, pinX: 0, pinY: 0 });
  });
  it("places downtown Milwaukee on the right z16 tile", () => {
    const t = lonLatToTile(43.0389, -87.9065, 16);
    expect(t.x).toBe(16765);
    expect(t.y).toBe(24071);
    expect(t.pinX).toBeCloseTo(28.17, 1);
    expect(t.pinY).toBeCloseTo(120.56, 1);
    expect(osmTileUrl(t)).toBe("https://tile.openstreetmap.org/16/16765/24071.png");
  });
});

describe("cardLink", () => {
  it("prefers apple_music, then url, then the first http string", () => {
    expect(cardLink({ url: "https://a.example", apple_music: "https://music.apple.com/x" }))
      .toBe("https://music.apple.com/x");
    expect(cardLink({ url: "https://a.example" })).toBe("https://a.example");
    expect(cardLink({ tmdb: "https://www.themoviedb.org/movie/1" }))
      .toBe("https://www.themoviedb.org/movie/1");
    expect(cardLink({ note: "not a link" })).toBeNull();
    expect(cardLink({ url: "http://a.example/x" })).toBe("https://a.example/x");
    expect(cardLink({ url: "javascript:alert(1)" })).toBeNull();
    expect(cardLink(null)).toBeNull();
  });
});

describe("imageLoadFailed (an image that failed before React hydrated)", () => {
  it("is true only for a finished load with no pixels", () => {
    expect(imageLoadFailed({ complete: true, naturalWidth: 0 })).toBe(true);
    expect(imageLoadFailed({ complete: true, naturalWidth: 600 })).toBe(false);
    expect(imageLoadFailed({ complete: false, naturalWidth: 0 })).toBe(false); // still loading: onError decides
  });
});
