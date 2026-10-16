import { describe, expect, it } from "vitest";
import { parseEarmarkTrigger } from "../../../agent/lib/bee/trigger";

describe("parseEarmarkTrigger", () => {
  it.each([
    ["Earmark that, Ann's ramen spot", "Ann's ramen spot"],
    ["ear mark that Ann's ramen spot", "Ann's ramen spot"],
    ["Okay, earmark that — the new Floating Points album", "the new Floating Points album"],
    ["Earmark this: The Overstory by Richard Powers.", "The Overstory by Richard Powers"],
    ["EARMARK THAT. Marcus says Sinners is worth it", "Marcus says Sinners is worth it"],
    ["  um, earmark that... newsletter idea about AI in public radio!", "newsletter idea about AI in public radio"],
    ["Ear-mark that Lake Park Bistro", "Lake Park Bistro"],
    ["Um, so, earmark that Ann's ramen spot", "Ann's ramen spot"],
    ["Okay so earmark that Ann's ramen spot", "Ann's ramen spot"],
    ["Hey Bee, earmark that Ann's ramen spot", "Ann's ramen spot"],
    ["Please earmark that Ann's ramen spot", "Ann's ramen spot"],
    ["Earmark, that Ann's ramen spot", "Ann's ramen spot"],
    ["Ear mark. That Ann's ramen spot", "Ann's ramen spot"],
  ])("captures %j", (input, body) => {
    expect(parseEarmarkTrigger(input)).toEqual({ matched: true, body });
  });

  it.each([
    "we earmarked that budget for next year",
    "I said earmark that thing yesterday",
    "I will earmark that Ann's ramen spot",
    "Earmark that's what I said",
    "Earmark that",
    "Earmark that.",
    "Earmark that — ",
    "remarkable, that",
    "",
  ])("ignores %j", (input) => {
    expect(parseEarmarkTrigger(input)).toEqual({ matched: false });
  });
});
