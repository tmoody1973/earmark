import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOMINATIM_GAP_MS, nominatimProvider, resetNominatimThrottle } from "../../../agent/lib/enrich/nominatim";
import type { EnrichQuery } from "../../../agent/lib/enrich/types";

const env = { EARMARK_PUBLIC_BASE_URL: "https://earmark.example" };
const q = (name: string, creator: string | null = null, lat: number | null = null, lng: number | null = null): EnrichQuery =>
  ({ type: "place", name, creator, lat, lng });

beforeEach(() => resetNominatimThrottle());
afterEach(() => vi.useRealTimers());

describe("Nominatim provider", () => {
  it("builds a keyless search with an identifying User-Agent and only the name + address", async () => {
    const { url, init } = await nominatimProvider(env).build(q("Ramen-Ya", "1 Main St"));
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(u.searchParams.get("format")).toBe("jsonv2");
    expect(u.searchParams.get("q")).toBe("Ramen-Ya 1 Main St");
    expect(u.searchParams.get("limit")).toBe("3");
    expect(u.searchParams.get("addressdetails")).toBe("0");
    expect(u.searchParams.has("viewbox")).toBe(false);
    expect(u.searchParams.has("email")).toBe(false);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("Earmark/1.0 (+https://earmark.example)");
  });
  it("adds a ~20 km soft viewbox when a location was said, and the optional email", async () => {
    const { url } = await nominatimProvider({ ...env, NOMINATIM_EMAIL: "me@example.com" }).build(q("Ramen-Ya", null, 43.04, -87.91));
    const u = new URL(url);
    const [l, t, r, b] = u.searchParams.get("viewbox")!.split(",").map(Number);
    expect(t - b).toBeCloseTo(0.36, 1); // +-20 km of latitude
    expect(l).toBeLessThan(-87.91);
    expect(r).toBeGreaterThan(-87.91);
    expect(u.searchParams.get("bounded")).toBe("0");
    expect(u.searchParams.get("email")).toBe("me@example.com");
  });
  it("parses results into candidates with coordinates and an OpenStreetMap link", () => {
    const json = [{ osm_type: "node", osm_id: 123, lat: "43.0389", lon: "-87.9065", display_name: "Ramen-Ya, 1 Main St, Milwaukee, Wisconsin, USA" }];
    const [c] = nominatimProvider(env).parse(json, q("Ramen-Ya"));
    expect(c).toMatchObject({ canonicalName: "Ramen-Ya", creator: null, yearOrAddress: "Ramen-Ya, 1 Main St, Milwaukee, Wisconsin, USA",
      imageUrl: null, lat: 43.0389, lng: -87.9065, links: { openstreetmap: "https://www.openstreetmap.org/node/123" } });
  });
  it("returns no candidates for an empty or malformed response", () => {
    expect(nominatimProvider(env).parse([], q("x"))).toEqual([]);
    expect(nominatimProvider(env).parse({ error: "x" }, q("x"))).toEqual([]);
    expect(nominatimProvider(env).parse([{ osm_type: "node", osm_id: 1, lat: "nope", lon: "1", display_name: "A" }], q("x"))).toEqual([]);
  });
  it("spaces consecutive calls at least 1.1 s apart", async () => {
    vi.useFakeTimers();
    const p = nominatimProvider(env);
    await p.build(q("a"));
    let second = false;
    const pending = p.build(q("b")).then(() => { second = true; });
    await vi.advanceTimersByTimeAsync(NOMINATIM_GAP_MS - 1);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(second).toBe(true);
  });
});
