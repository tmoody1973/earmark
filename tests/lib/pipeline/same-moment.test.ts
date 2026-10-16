import { describe, expect, it } from "vitest";
import { normalizeName, sameMoment, sameName, SAME_MOMENT_MS } from "../../../agent/lib/pipeline/same-moment";

describe("normalizeName", () => {
  it.each([
    ["Kawa Ramen (ramen spot on Brady Street)", "kawa ramen"],
    ["Kawa Ramen", "kawa ramen"],
    ["The Watchables", "watchables"],
    ["A Little Dark Age", "little dark age"],
    ["Shōgun!", "shōgun"],
    ["Jemetta Rose's new albums", "jemetta roses new albums"],
    ["  Acts   of Faith. ", "acts of faith"],
    ["Acts-of-Faith [deluxe]", "acts of faith"],
  ])("%s -> %s", (raw, want) => expect(normalizeName(raw)).toBe(want));
});

describe("sameName", () => {
  it.each([
    ["Kawa Ramen", "Kawa Ramen (ramen spot on Brady Street)", true], // the real 156 vs 163 pair
    ["kawa ramen", "KAWA RAMEN.", true],
    ["Shogun", "Shogun on Hulu", true], // whole-word containment
    ["The Watchables", "Watchables", true],
    ["Acts of Faith", "A Little Dark Age", false],
    ["Pi", "Pi Durable", false], // too short to contain-match
    ["Ramen", "Kawaramen", false], // not on a word boundary
    ["", "anything", false],
  ])("%s ~ %s = %s", (a, b, want) => {
    expect(sameName(a, b)).toBe(want);
    expect(sameName(b, a)).toBe(want);
  });
});

describe("sameMoment", () => {
  const at = new Date("2026-10-16T20:24:44Z");
  const plus = (ms: number) => new Date(at.getTime() + ms);
  const voice = { id: 156, name: "Kawa Ramen", type: "place", firstName: "Ann", saidAt: plus(4_249) };
  const rec = (over: Partial<{ name: string; type: string; firstName: string | null; saidAt: Date }> = {}) =>
    ({ name: "Kawa Ramen (ramen spot on Brady Street)", type: "place", firstName: "Anne", saidAt: at, ...over });

  it("matches the same name within ±60 s, whoever is credited", () => {
    expect(sameMoment(rec(), [voice])?.id).toBe(156);
    expect(sameMoment(rec({ saidAt: plus(4_249 + SAME_MOMENT_MS) }), [voice])?.id).toBe(156); // exactly 60 s apart
    expect(sameMoment(rec({ saidAt: plus(4_249 - SAME_MOMENT_MS) }), [voice])?.id).toBe(156);
  });

  it("does not match outside the window", () => {
    expect(sameMoment(rec({ saidAt: plus(4_249 + SAME_MOMENT_MS + 1) }), [voice])).toBeUndefined();
    expect(sameMoment(rec({ saidAt: plus(4_249 - SAME_MOMENT_MS - 1) }), [voice])).toBeUndefined();
  });

  it("matches the same recommender first name + same type even when the name differs", () => {
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: "ann" }), [voice])?.id).toBe(156);
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: "Ann", type: "album" }), [voice])).toBeUndefined();
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: null }), [{ ...voice, firstName: null }])).toBeUndefined();
  });

  it("the real neighbours of 11338188 stay apart (Dana's song, Sam's podcast)", () => {
    const voices = [
      voice,
      { id: 157, name: "Acts of Faith", type: "album", firstName: "Marcus", saidAt: new Date("2026-10-16T20:24:54.878Z") },
      { id: 158, name: "Shogun", type: "film_tv", firstName: "Lena", saidAt: new Date("2026-10-16T20:25:16.469Z") },
    ];
    expect(sameMoment({ name: "A Little Dark Age", type: "song", firstName: "Dana", saidAt: new Date("2026-10-16T20:24:57Z") }, voices)).toBeUndefined();
    expect(sameMoment({ name: "The Watchables", type: "podcast", firstName: "Sam", saidAt: new Date("2026-10-16T20:25:06Z") }, voices)).toBeUndefined();
    expect(sameMoment({ name: "Acts of Faith", type: "album", firstName: "Marcus", saidAt: new Date("2026-10-16T20:24:51Z") }, voices)?.id).toBe(157);
    expect(sameMoment({ name: "Shogun", type: "film_tv", firstName: "Lena", saidAt: new Date("2026-10-16T20:25:13Z") }, voices)?.id).toBe(158);
  });
});
