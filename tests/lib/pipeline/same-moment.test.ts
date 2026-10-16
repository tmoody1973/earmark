import { describe, expect, it } from "vitest";
import { normalizeName, pairSameMoment, sameMoment, sameName, SAME_MOMENT_MS } from "../../../agent/lib/pipeline/same-moment";

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

describe("sameMoment / pairSameMoment", () => {
  const at = new Date("2026-10-16T20:24:44Z");
  const plus = (ms: number) => new Date(at.getTime() + ms);
  const voice = { id: 156, name: "Kawa Ramen", type: "place", firstName: "Ann", saidAt: plus(4_249), deliberate: true };
  type R = { name: string; type: string; firstName: string | null; saidAt: Date; deliberate: boolean };
  const rec = (over: Partial<R> = {}): R =>
    ({ name: "Kawa Ramen (ramen spot on Brady Street)", type: "place", firstName: "Anne", saidAt: at, deliberate: true, ...over });

  it("matches the same name within ±60 s, whoever is credited", () => {
    expect(sameMoment(rec(), [voice])?.id).toBe(156);
    expect(sameMoment(rec({ saidAt: plus(4_249 + SAME_MOMENT_MS) }), [voice])?.id).toBe(156); // exactly 60 s apart
    expect(sameMoment(rec({ saidAt: plus(4_249 - SAME_MOMENT_MS) }), [voice])?.id).toBe(156);
  });

  it("does not match outside the window", () => {
    expect(sameMoment(rec({ saidAt: plus(4_249 + SAME_MOMENT_MS + 1) }), [voice])).toBeUndefined();
    expect(sameMoment(rec({ saidAt: plus(4_249 - SAME_MOMENT_MS - 1) }), [voice])).toBeUndefined();
  });

  it("falls back to same recommender first name + same type only between two deliberate earmarks", () => {
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: "ann" }), [voice])?.id).toBe(156);
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: "ann", deliberate: false }), [voice])).toBeUndefined(); // ambient: name only
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: "ann" }), [{ ...voice, deliberate: false }])).toBeUndefined();
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: "Ann", type: "album" }), [voice])).toBeUndefined();
    expect(sameMoment(rec({ name: "Ann's ramen spot", firstName: null }), [{ ...voice, firstName: null }])).toBeUndefined();
  });

  it("the real neighbours of 11338188 stay apart (Dana's song, Sam's podcast)", () => {
    const voices = [
      voice,
      { id: 157, name: "Acts of Faith", type: "album", firstName: "Marcus", saidAt: new Date("2026-10-16T20:24:54.878Z"), deliberate: true },
      { id: 158, name: "Shogun", type: "film_tv", firstName: "Lena", saidAt: new Date("2026-10-16T20:25:16.469Z"), deliberate: true },
    ];
    const conv = (name: string, type: string, firstName: string, iso: string) => ({ name, type, firstName, saidAt: new Date(iso), deliberate: true });
    expect(pairSameMoment([
      conv("Kawa Ramen (ramen spot on Brady Street)", "place", "Anne", "2026-10-16T20:24:44Z"),
      conv("Acts of Faith", "album", "Marcus", "2026-10-16T20:24:51Z"),
      conv("A Little Dark Age", "song", "Dana", "2026-10-16T20:24:57Z"),
      conv("The Watchables", "podcast", "Sam", "2026-10-16T20:25:06Z"),
      conv("Shogun", "film_tv", "Lena", "2026-10-16T20:25:13Z"),
    ], voices).map((v) => v?.id ?? null)).toEqual([156, 157, null, null, 158]);
  });

  // I-2: one voice note pairs with at most one item, and a name match is preferred over the recommender fallback.
  it.each([
    {
      case: "Marcus's Acts of Faith (voice note saved), then a cut-off 'Blonde' (Marcus, album): Blonde is kept",
      recs: [["Blonde", "album", "Marcus", 6_000], ["Acts of Faith", "album", "Marcus", -3_000]],
      want: [null, 157],
    },
    {
      case: "two items, one voice note: only one pairs",
      recs: [["Acts of Faith", "album", "Marcus", -3_000], ["Acts of Faith (deluxe)", "album", "Marcus", 2_000]],
      want: [157, null],
    },
    {
      case: "the recommender fallback still pairs a renamed earmark when nothing else claims the note",
      recs: [["Marcus's record", "album", "Marcus", -3_000]],
      want: [157],
    },
  ] as const)("$case", ({ recs, want }) => {
    const voices = [{ id: 157, name: "Acts of Faith", type: "album", firstName: "Marcus", saidAt: at, deliberate: true }];
    const items = recs.map(([name, type, firstName, ms]) => ({ name, type, firstName, saidAt: plus(ms), deliberate: true }));
    expect(pairSameMoment(items, voices).map((v) => v?.id ?? null)).toEqual(want);
  });

  it("of two candidate notes, the nearest in time pairs", () => {
    const voices = [
      { id: 1, name: "Shogun", type: "film_tv", firstName: null, saidAt: plus(-50_000), deliberate: true },
      { id: 2, name: "Shogun", type: "film_tv", firstName: null, saidAt: plus(3_000), deliberate: true },
    ];
    expect(pairSameMoment([rec({ name: "Shogun", type: "film_tv" })], voices)[0]?.id).toBe(2);
  });
});
