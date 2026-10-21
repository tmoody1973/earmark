import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fetchExtras } from "../../../agent/lib/enrich/extras";
import { fetchWebPlaceDetails, isSocialUrl, placeQuery } from "../../../agent/lib/enrich/place-web";
import { readPlace, type PlaceExtras } from "../../../agent/lib/enrich/place-details";
import { PlaceDetails } from "../../../app/tips/[id]/PlaceDetails";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SEARCH = [
  { title: "Diaspora on Facebook", snippet: "Bar in Riverwest", site_name: "Facebook", url: "https://www.facebook.com/diasporamke" },
  { title: "Diaspora MKE", snippet: "Open Tue-Sun 4pm-2am", site_name: "Diaspora MKE", url: "https://diasporamke.com/" },
];
/** TinyFish search + fetch fake. */
const tinyfish = (results = SEARCH, pageText = "Hours: Tue-Sun 16:00-02:00. Call 414-555-0100.") =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.search.tinyfish.ai")) return json({ results });
    if (u.startsWith("https://api.fetch.tinyfish.ai")) {
      const urls: string[] = JSON.parse(String(init?.body)).urls;
      return json({ results: urls.map((x) => ({ url: x, title: "Diaspora", text: pageText })) });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
const model = (output: object) => vi.fn(async () => ({ output })) as never;
const FILLED = { kind: "Bar", hours: "Tu-Su 16:00-02:00", phone: "+1 414 555 0100", website: "https://diasporamke.com", menu: null,
  reservation: null, reservationUrl: null, features: ["Outdoor seating"] };
const rec = { canonical_name: "Diaspora", year_or_address: "735 E Center St, Milwaukee", links: { web: "https://diasporamke.com/", lat: 1 } };
const fetchedUrls = (f: ReturnType<typeof tinyfish>): string[] =>
  f.mock.calls.filter(([u]) => String(u).includes("fetch.tinyfish")).flatMap(([, i]) => JSON.parse(String(i!.body)).urls);

describe("isSocialUrl", () => {
  it("skips the six networks and their subdomains, not lookalikes", () => {
    for (const u of ["https://www.facebook.com/x", "https://m.facebook.com/x", "https://instagram.com/x", "https://www.tiktok.com/@x",
      "https://x.com/x", "https://twitter.com/x", "https://threads.net/@x"]) expect(isSocialUrl(u), u).toBe(true);
    for (const u of ["https://diasporamke.com", "https://notfacebook.com", "https://box.com/x"]) expect(isSocialUrl(u), u).toBe(false);
  });
});

describe("fetchWebPlaceDetails", () => {
  it("searches name + address + hours, fetches a non-social page only, and maps the answer with its source", async () => {
    const fetchImpl = tinyfish();
    const p = await fetchWebPlaceDetails(rec, { key: "k", fetchImpl: fetchImpl as never, generateImpl: model(FILLED) });
    expect(decodeURIComponent(String(fetchImpl.mock.calls[0]![0]).replace(/\+/g, " "))).toContain("query=Diaspora 735 E Center St, Milwaukee hours");
    expect(fetchedUrls(fetchImpl)).toEqual(["https://diasporamke.com/"]);
    expect(p).toEqual({ kind: "Bar", hours: "Tu-Su 16:00-02:00", website: "https://diasporamke.com", phone: "+1 414 555 0100", menu: null,
      reservation: null, reservationUrl: null, features: ["Outdoor seating"], source: { site: "diasporamke.com", url: "https://diasporamke.com/" } });
  });

  it("a Facebook link is never fetched: the first non-social search result is read and cited instead", async () => {
    const fetchImpl = tinyfish();
    const p = await fetchWebPlaceDetails({ ...rec, links: { web: "https://www.facebook.com/diasporamke" } },
      { key: "k", fetchImpl: fetchImpl as never, generateImpl: model(FILLED) });
    expect(fetchedUrls(fetchImpl)).toEqual(["https://diasporamke.com/"]);
    expect(p?.source?.url).toBe("https://diasporamke.com/");
  });

  it("an address and no link at all (tip 130): the best non-social search result is read and cited", async () => {
    const fetchImpl = tinyfish();
    const p = await fetchWebPlaceDetails({ ...rec, links: {} }, { key: "k", fetchImpl: fetchImpl as never, generateImpl: model(FILLED) });
    expect(fetchedUrls(fetchImpl)).toEqual(["https://diasporamke.com/"]); // not the Facebook result ahead of it
    expect(p?.source).toEqual({ site: "diasporamke.com", url: "https://diasporamke.com/" });
  });

  it("neither link nor address: too ambiguous, null with no request", async () => {
    const fetchImpl = tinyfish();
    for (const year_or_address of [null, undefined, "  "]) {
      expect(await fetchWebPlaceDetails({ ...rec, year_or_address, links: {} }, { key: "k", fetchImpl: fetchImpl as never })).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("only social results exist: nothing is fetched and nothing is stored", async () => {
    const fetchImpl = tinyfish([SEARCH[0]!]);
    const p = await fetchWebPlaceDetails({ ...rec, links: { web: "https://www.facebook.com/diasporamke" } },
      { key: "k", fetchImpl: fetchImpl as never, generateImpl: model(FILLED) });
    expect(fetchedUrls(fetchImpl)).toEqual([]);
    expect(p).toBeNull();
  });

  it("a page that fails to fetch falls back to the snippets", async () => {
    const fetchImpl = tinyfish(SEARCH, "");
    const p = await fetchWebPlaceDetails(rec, { key: "k", fetchImpl: fetchImpl as never, generateImpl: model(FILLED) });
    expect(p?.kind).toBe("Bar");
  });

  it("drops hours that run over 16 hours or that parseHours cannot read; keeps the rest", async () => {
    const p = await fetchWebPlaceDetails(rec, { key: "k", fetchImpl: tinyfish() as never, generateImpl: model({ ...FILLED, hours: "Sa 11:30-09:30" }) });
    expect(p).toMatchObject({ hours: null, kind: "Bar" });
    const q = await fetchWebPlaceDetails(rec, { key: "k", fetchImpl: tinyfish() as never, generateImpl: model({ ...FILLED, hours: "whenever we feel like it" }) });
    expect(q?.hours).toBeNull();
  });

  it("junk links and phones from the model are dropped; http becomes https", async () => {
    const p = await fetchWebPlaceDetails(rec, { key: "k", fetchImpl: tinyfish() as never,
      generateImpl: model({ ...FILLED, website: "javascript:alert(1)", phone: "call us!", menu: "http://diasporamke.com/menu" }) });
    expect(p).toMatchObject({ website: null, phone: null, menu: "https://diasporamke.com/menu" });
  });

  it("nothing stated: null, not an empty card; no web link: null with no request", async () => {
    const empty = { kind: null, hours: null, phone: null, website: null, menu: null, reservation: null, reservationUrl: null, features: [] };
    expect(await fetchWebPlaceDetails(rec, { key: "k", fetchImpl: tinyfish() as never, generateImpl: model(empty) })).toBeNull();
    const fetchImpl = tinyfish();
    expect(await fetchWebPlaceDetails({ ...rec, year_or_address: null, links: {} }, { key: "k", fetchImpl: fetchImpl as never })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a TinyFish refusal throws for the lane to count or back off", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429));
    await expect(fetchWebPlaceDetails(rec, { key: "k", fetchImpl: fetchImpl as never })).rejects.toMatchObject({ status: 429 });
  });

  it("the search words are the name and address only", () => {
    expect(placeQuery(rec)).toBe("Diaspora 735 E Center St, Milwaukee hours");
    expect(placeQuery({ canonical_name: "Kopp's", links: {} })).toBe("Kopp's hours");
  });
});

describe("fetchExtras for a place", () => {
  const base = { type: "place" as const, canonical_name: "Diaspora", creator: null, apple_music_id: null, about_url: null, year_or_address: "735 E Center St" };
  it("web link, no OSM link: web details with a key; nothing and no request without one", async () => {
    const on = await fetchExtras({ ...base, links: { web: "https://diasporamke.com/" } }, tinyfish() as never, null, null,
      { key: "k", fetchImpl: tinyfish() as never, generateImpl: model(FILLED) });
    expect(on.place?.source?.site).toBe("diasporamke.com");
    const fetchImpl = vi.fn();
    expect(await fetchExtras({ ...base, links: { web: "https://diasporamke.com/" } }, fetchImpl as never)).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readPlace keeps a valid source only", () => {
  it("round-trips source; drops a non-https one", () => {
    expect(readPlace({ kind: "Bar", source: { site: "a.com", url: "https://a.com/x" } })?.source).toEqual({ site: "a.com", url: "https://a.com/x" });
    expect(readPlace({ kind: "Bar", source: { site: "a.com", url: "javascript:1" } })).not.toHaveProperty("source");
  });
});

describe("PlaceDetails credit", () => {
  const p: PlaceExtras = { kind: "Bar", hours: null, website: null, phone: null, menu: null, reservation: null, reservationUrl: null, features: [] };
  const html = (x: PlaceExtras) => renderToStaticMarkup(createElement(PlaceDetails, { place: x }));
  it("a web source is credited and linked; without one the OpenStreetMap credit stays", () => {
    const web = html({ ...p, source: { site: "diasporamke.com", url: "https://diasporamke.com/" } });
    expect(web).toContain('Details from <a href="https://diasporamke.com/"');
    expect(web).toContain(">diasporamke.com</a>");
    expect(web).not.toContain("OpenStreetMap");
    const osm = html(p);
    expect(osm).toContain("OpenStreetMap contributors");
    expect(osm).not.toContain("Details from");
  });
});
