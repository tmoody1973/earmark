import { describe, expect, it } from "vitest";
import { appleMusicById } from "../../../agent/lib/enrich/apple-music";
import { addressIsPublic, resolvesToPublic } from "../../../agent/lib/enrich/extras";
import { classifyLink, readShareTags, splitBy, TipLinkSchema } from "../../../agent/lib/recs/tip-link";

// "Link" on Fix this tip (decision 049): the owner pastes where the thing lives. No network here.
const METTASUN = "https://jimettarose.bandcamp.com/album/mettasun";
const BANDCAMP_HTML = `<!DOCTYPE html><html><head>
<title>MettaSun | Jimetta Rose</title>
<meta property="og:title" content="MettaSun, by Jimetta Rose">
<meta property="og:type" content="album">
<meta property="og:site_name" content="Jimetta Rose">
<meta property="og:image" content="https://f4.bcbits.com/img/a1803787050_5.jpg">
<meta property="og:url" content="${METTASUN}">
</head><body>…</body></html>`;

describe("classifyLink", () => {
  it.each([
    ["https://music.apple.com/us/album/mettasun/1234567890", { kind: "apple", type: "album", id: "1234567890", storefront: "us" }],
    ["https://music.apple.com/gb/album/mettasun/1234567890?i=1234567899", { kind: "apple", type: "song", id: "1234567899", storefront: "gb" }],
    ["https://music.apple.com/us/song/sun-song/1234567899", { kind: "apple", type: "song", id: "1234567899", storefront: "us" }],
    ["https://music.apple.com/us/artist/jimetta-rose/42", { kind: "apple", type: "artist", id: "42", storefront: "us" }],
    ["https://music.apple.com/us/album/1234567890", { kind: "apple", type: "album", id: "1234567890", storefront: "us" }],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", { kind: "youtube" }],
    ["https://youtu.be/dQw4w9WgXcQ", { kind: "youtube" }],
    [METTASUN, { kind: "page", key: "bandcamp" }],
    ["https://bandcamp.com/EmbeddedPlayer/album=1", { kind: "page", key: "bandcamp" }],
    ["https://www.mamasdiner.com/menu", { kind: "page", key: "web" }],
    ["https://music.apple.com/us/playlist/sun/pl.u-123", { kind: "page", key: "web" }], // not an album, song or artist
  ])("%s", (url, kind) => {
    expect(classifyLink(url)).toEqual(kind);
  });

  it.each([
    ["http://jimettarose.bandcamp.com/album/mettasun"], // https only
    ["javascript:alert(1)"], ["data:text/html,hi"], ["ftp://example.com/x"], ["not a link"], [""],
    [`https://example.com/${"x".repeat(500)}`], // over 500 characters
    ["https://127.0.0.1/"], ["https://10.0.0.5/"], ["https://[::1]/"], ["https://localhost/"], ["https://printer.local/"], ["https://intranet/"],
  ])("refuses %s", (url) => {
    expect(classifyLink(url)).toBeNull();
  });
});

describe("TipLinkSchema", () => {
  it("trims; empty means clear it", () => {
    expect(TipLinkSchema.parse(`  ${METTASUN} `)).toBe(METTASUN);
    expect(TipLinkSchema.parse("")).toBeNull();
    expect(TipLinkSchema.parse("   ")).toBeNull();
    expect(TipLinkSchema.parse(null)).toBeNull();
  });

  it.each([["http://example.com"], ["javascript:alert(1)"], [`https://example.com/${"x".repeat(500)}`], [4]])("refuses %j", (v) => {
    expect(TipLinkSchema.safeParse(v).success).toBe(false);
  });

  it("takes a link of exactly 500 characters", () => {
    const url = `https://example.com/${"x".repeat(500 - "https://example.com/".length)}`;
    expect(url).toHaveLength(500);
    expect(TipLinkSchema.parse(url)).toBe(url);
  });
});

describe("readShareTags", () => {
  it("reads a Bandcamp album page's share tags", () => {
    expect(readShareTags(BANDCAMP_HTML)).toEqual({
      title: "MettaSun, by Jimetta Rose", image: "https://f4.bcbits.com/img/a1803787050_5.jpg",
    });
  });

  it("falls back to <title> when there is no og:title", () => {
    expect(readShareTags("<html><head><title>  Mama’s Diner &amp; Grill </title></head></html>"))
      .toEqual({ title: "Mama’s Diner & Grill", image: null });
  });

  it("reads attributes in either order, either quote, with apostrophes and entities", () => {
    const html = `<meta content="Sun Ra's &quot;Space&quot;" property="og:title"><meta name='og:image' content='https://x.com/a.jpg'>`;
    expect(readShareTags(html)).toMatchObject({ title: `Sun Ra's "Space"`, image: "https://x.com/a.jpg" });
  });

  it.each([["/img/cover.jpg"], ["http://f4.bcbits.com/img/a.jpg"], ["javascript:alert(1)"], ["//f4.bcbits.com/img/a.jpg"]])(
    "ignores og:image %s (not an absolute https URL)", (image) => {
      expect(readShareTags(`<meta property="og:image" content="${image}"><title>x</title>`).image).toBeNull();
    });

  it("nothing to read is all null", () => {
    expect(readShareTags("\u0000\u0001 binary")).toEqual({ title: null, image: null });
  });
});

describe("splitBy", () => {
  it("splits Bandcamp's \"X, by Y\"", () => {
    expect(splitBy("MettaSun, by Jimetta Rose")).toEqual({ name: "MettaSun", creator: "Jimetta Rose" });
    expect(splitBy("Hello, Goodbye, by The Band")).toEqual({ name: "Hello, Goodbye", creator: "The Band" });
  });

  it.each([["Mama’s Diner"], ["Stand by Me"], [", by Nobody"], ["Nothing, by "]])("leaves %s alone", (t) => {
    expect(splitBy(t)).toBeNull();
  });
});

describe("appleMusicById", () => {
  const access = { token: async () => "dev-token", storefront: "us" };
  it("asks the catalog for the one item by id, in the link's storefront", async () => {
    const def = appleMusicById(access, "1234567890", "gb");
    const { url, init } = await def.build({ type: "album", name: "", creator: null, lat: null, lng: null });
    expect(url).toBe("https://api.music.apple.com/v1/catalog/gb/albums/1234567890");
    expect(init.headers).toEqual({ Authorization: "Bearer dev-token" });
  });

  it("reads the item like a search result", () => {
    const json = { data: [{ id: "1234567890", attributes: { name: "MettaSun", artistName: "Jimetta Rose", releaseDate: "2024-05-03",
      url: "https://music.apple.com/us/album/mettasun/1234567890", artwork: { url: "https://is1.mzstatic.com/a/{w}x{h}bb.jpg" } } }] };
    const q = { type: "album" as const, name: "", creator: null, lat: null, lng: null };
    expect(appleMusicById(access, "1234567890").parse(json, q)).toEqual([{
      canonicalName: "MettaSun", creator: "Jimetta Rose", yearOrAddress: "2024", imageUrl: "https://is1.mzstatic.com/a/600x600bb.jpg",
      links: { apple_music: "https://music.apple.com/us/album/mettasun/1234567890" }, appleMusicId: "1234567890",
    }]);
    expect(appleMusicById(access, "1").parse({ data: [] }, q)).toEqual([]);
  });
});

describe("the fetch guard's address check (owner-supplied links)", () => {
  it.each([
    ["127.0.0.1"], ["10.1.2.3"], ["172.16.0.1"], ["192.168.1.1"], ["169.254.169.254"], ["100.64.0.1"], ["0.0.0.0"],
    ["::1"], ["::"], ["fe80::1"], ["fd00::1"], ["::ffff:127.0.0.1"], ["::ffff:7f00:1"], ["224.0.0.1"], ["not an ip"],
  ])("%s is not public", (ip) => {
    expect(addressIsPublic(ip)).toBe(false);
  });

  it.each([["93.184.216.34"], ["2606:2800:220:1:248:1893:25c8:1946"]])("%s is public", (ip) => {
    expect(addressIsPublic(ip)).toBe(true);
  });

  it("a host is public only when every address it resolves to is", async () => {
    const dns = (ips: string[]) => async () => ips;
    expect(await resolvesToPublic(METTASUN, dns(["93.184.216.34"]))).toBe(true);
    expect(await resolvesToPublic(METTASUN, dns(["93.184.216.34", "10.0.0.5"]))).toBe(false);
    expect(await resolvesToPublic(METTASUN, dns([]))).toBe(false);
    expect(await resolvesToPublic(METTASUN, async () => { throw Object.assign(new Error("x"), { name: "ENOTFOUND" }); })).toBe(false);
    expect(await resolvesToPublic("http://example.com/", dns(["93.184.216.34"]))).toBe(false); // the name check still applies
  });
});
