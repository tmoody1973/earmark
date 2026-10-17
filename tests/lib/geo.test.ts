import { describe, expect, it } from "vitest";
import { distanceMeters, parseLatLng } from "../../agent/lib/geo";

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters({ lat: 43.0418, lng: -87.9097 }, { lat: 43.0418, lng: -87.9097 })).toBe(0);
  });
  it("measures Milwaukee City Hall to the Art Museum at about 1.04 km", () => {
    const d = distanceMeters({ lat: 43.0418, lng: -87.9097 }, { lat: 43.04, lng: -87.8971 });
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1090);
  });
});

describe("parseLatLng", () => {
  it("parses numbers and numeric strings", () => {
    expect(parseLatLng("43.04", -87.9)).toEqual({ lat: 43.04, lng: -87.9 });
  });
  it("rejects missing, empty, non-numeric and out-of-range values", () => {
    expect(parseLatLng(null, -87.9)).toBeNull();
    expect(parseLatLng("", "")).toBeNull();
    expect(parseLatLng("abc", 1)).toBeNull();
    expect(parseLatLng(91, 0)).toBeNull();
    expect(parseLatLng(0, 181)).toBeNull();
  });
});
