import { describe, expect, it } from "vitest";
import { biasFor, roundBias } from "../../../agent/lib/enrich/bias";

const home = { EARMARK_HOME_LAT: "43.04", EARMARK_HOME_LNG: "-87.91" };
const none = { saidLat: null, saidLng: null, lat: null, lng: null };

describe("roundBias", () => {
  it("rounds to one decimal place (~11 km) so the exact spot never leaves Earmark", () => {
    expect(roundBias(43.04389, -87.90652)).toEqual({ lat: 43, lng: -87.9 });
    expect(roundBias(43.06, -87.96)).toEqual({ lat: 43.1, lng: -88 });
  });
});

describe("biasFor", () => {
  it("prefers where it was said", () => {
    expect(biasFor({ ...none, saidLat: 41.88, saidLng: -87.63, lat: 43.1, lng: -88.1 }, home)).toEqual({ lat: 41.9, lng: -87.6 });
  });
  it("then the rec's own place", () => {
    expect(biasFor({ ...none, lat: 43.12, lng: -88.14 }, home)).toEqual({ lat: 43.1, lng: -88.1 });
  });
  it("then the home default from env", () => {
    expect(biasFor(none, home)).toEqual({ lat: 43, lng: -87.9 });
  });
  it("then no bias at all", () => {
    expect(biasFor(none, {})).toBeNull();
    expect(biasFor(none, { EARMARK_HOME_LAT: "43.04" })).toBeNull();
    expect(biasFor(none, { EARMARK_HOME_LAT: "x", EARMARK_HOME_LNG: "-87.9" })).toBeNull();
  });
  it("ignores a half-set pair", () => {
    expect(biasFor({ ...none, saidLat: 41.88, lat: 43.12, lng: -88.14 }, home)).toEqual({ lat: 43.1, lng: -88.1 });
  });
});
