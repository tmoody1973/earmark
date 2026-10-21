import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPlaceDetails, hoursNow, osmLookupId, parseHours, placeFromNominatim, readPlace, weekLines,
} from "../../../agent/lib/enrich/place-details";

// Recorded: one real Nominatim /lookup?extratags=1 answer (OpenStreetMap data, ODbL).
const kawa = JSON.parse(readFileSync("tests/fixtures/enrich/nominatim-lookup-kawa-ramen.json", "utf8"));
// 2026-10-20 is a Tuesday. America/Chicago is UTC-5 in October.
const chicago = (iso: string) => new Date(`${iso}-05:00`);

describe("placeFromNominatim (recorded Kawa Ramen)", () => {
  it("reads the kind, contacts, reservations and features; drops hours that run past 16 hours", () => {
    const p = placeFromNominatim(kawa[0])!;
    expect(p).toMatchObject({
      kind: "Japanese · Restaurant",
      website: "https://kawaramensushi.com",
      phone: "+1 414 800 7979",
      reservation: "yes",
      features: ["Takeaway", "Delivery", "Outdoor seating"],
    });
    expect(p.hours).toBeNull(); // OSM says "Sa 11:30-09:30": 22 hours, almost certainly a typo for 21:30
  });

  it("keeps good hours, a menu and a reservation page; http becomes https; junk links are dropped", () => {
    const p = placeFromNominatim({ category: "amenity", type: "fast_food", extratags: {
      cuisine: "dessert;coffee_shop", opening_hours: "Mo-Sa 10:00-20:00, Su 11:00-18:00", "website:menu": "http://x.com/menu",
      website: "javascript:alert(1)", reservation: "required", "reservation:website": "https://resy.com/v/1", wheelchair: "yes",
    } })!;
    expect(p).toEqual({ kind: "Dessert, coffee shop · Fast food", hours: "Mo-Sa 10:00-20:00, Su 11:00-18:00", website: null,
      phone: null, menu: "https://x.com/menu", reservation: "required", reservationUrl: "https://resy.com/v/1",
      features: ["Wheelchair accessible"] });
  });

  it("nothing worth showing → null", () => {
    expect(placeFromNominatim({ category: "highway", type: "residential", extratags: {} })).toBeNull();
    expect(placeFromNominatim(null)).toBeNull();
  });
});

describe("opening hours (the common OSM forms)", () => {
  it("parses day ranges, lists, several times, off, and later rules overriding earlier ones", () => {
    const w = parseHours("Mo-Fr 11:00-14:00,17:00-22:00; Sa,Su 12:00-23:00; We off")!;
    expect(w[1]).toEqual([[660, 840], [1020, 1320]]); // Monday
    expect(w[3]).toEqual([]); // Wednesday: off
    expect(w[0]).toEqual([[720, 1380]]); // Sunday
    expect(parseHours("24/7")!.every((d) => d.length === 1 && d[0]![1] - d[0]![0] === 1440)).toBe(true);
    expect(parseHours("11:00-21:00")!.every((d) => d.length === 1)).toBe(true); // no days = every day
  });

  it("anything it doesn't understand → null (the page then shows no hours)", () => {
    for (const raw of ["Mo-Fr 09:00-17:00; PH off", "sunrise-sunset", "Mo-Fr 9-5", "Jan-Mar Mo 10:00-12:00", ""]) {
      expect(parseHours(raw)).toBeNull();
    }
  });

  it("open now, closing soon, and past midnight from the day before", () => {
    const w = parseHours("Mo-Th 11:30-22:00; Fr,Sa 17:00-02:00")!;
    expect(hoursNow(w, chicago("2026-10-20T12:00:00"))).toEqual({ open: true, until: "10 PM" }); // Tue noon
    expect(hoursNow(w, chicago("2026-10-20T23:00:00"))).toEqual({ open: false }); // Tue 11 PM
    expect(hoursNow(w, chicago("2026-10-25T01:30:00"))).toEqual({ open: true, until: "2 AM" }); // Sun 1:30 AM, Saturday's late night
    expect(hoursNow(w, chicago("2026-10-25T03:00:00"))).toEqual({ open: false });
  });

  it("the week as lines, consecutive days with the same hours grouped", () => {
    expect(weekLines(parseHours("Mo-Th 11:30-22:00; Fr 11:30-22:30; Su 12:30-21:00")!)).toEqual([
      "Mon–Thu 11:30 AM–10 PM", "Fri 11:30 AM–10:30 PM", "Sat Closed", "Sun 12:30–9 PM",
    ]);
  });
});

describe("fetching", () => {
  it("the OSM link becomes a lookup id; anything else none", () => {
    expect(osmLookupId({ openstreetmap: "https://www.openstreetmap.org/node/1171650361" })).toBe("N1171650361");
    expect(osmLookupId({ openstreetmap: "https://www.openstreetmap.org/way/42" })).toBe("W42");
    expect(osmLookupId({ google_maps: "https://maps.google.com/?cid=1" })).toBeNull();
    expect(osmLookupId({ openstreetmap: "https://evil.example/node/1" })).toBeNull();
  });

  it("one Nominatim lookup with extratags and the identifying User-Agent", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(kawa), { status: 200 }));
    const p = await fetchPlaceDetails({ openstreetmap: "https://www.openstreetmap.org/node/1171650361" }, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://nominatim.openstreetmap.org/lookup?osm_ids=N1171650361&format=jsonv2&extratags=1&addressdetails=0");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^Earmark\//);
    expect(p?.kind).toBe("Japanese · Restaurant");
  });
});

describe("readPlace (the stored jsonb, as far as the page trusts it)", () => {
  it("keeps the right shapes, drops non-https links and hours it can't parse", () => {
    expect(readPlace({ kind: "Cafe", hours: "nonsense", website: "ftp://x", phone: "+1 (414) 555-0100", menu: null,
      reservation: "maybe", reservationUrl: null, features: ["Takeaway", 7] })).toEqual({ kind: "Cafe", hours: null, website: null,
      phone: "+1 (414) 555-0100", menu: null, reservation: null, reservationUrl: null, features: ["Takeaway"] });
    expect(readPlace("x")).toBeNull();
  });
});
