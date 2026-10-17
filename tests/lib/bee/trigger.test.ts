import { describe, expect, it } from "vitest";
import { detectEarmarkTrigger, parseEarmarkTrigger } from "../../../agent/lib/bee/trigger";

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
    // The four real utterances from Tarik's conversation 11333494 (Bee misheard #3 as "Remark").
    ["Earmark that spot as known for Omakase called 1033 here in Walker's Point.", "spot as known for Omakase called 1033 here in Walker's Point"],
    ["Earmark that I should listen to Jemetta Rose's new albums as a tribute to Sun Raw Records.", "I should listen to Jemetta Rose's new albums as a tribute to Sun Raw Records"],
    ["Remark that Chris says to try that Notion calendar app.", "Chris says to try that Notion calendar app"],
    ["Earmark that the syntax guys told me to check out this new repo called PyPI Durable.", "the syntax guys told me to check out this new repo called PyPI Durable"],
    ["Earmark this one for later: a podcast", "one for later: a podcast"],
    ["Uh, okay, remark that Ann's ramen spot", "Ann's ramen spot"],
    ["Hey, earmark that Ann's ramen spot", "Ann's ramen spot"],
    ["REMARK THIS Ann's ramen spot", "Ann's ramen spot"],
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
    "I'd remark that the weather has been strange",
    "We should earmark that budget for the new studio.",
    "Chris said to remark that on the plan",
  ])("ignores %j", (input) => {
    expect(parseEarmarkTrigger(input)).toEqual({ matched: false });
    // detect differs from parse only for a bare trigger (matched, empty body).
    const d = detectEarmarkTrigger(input);
    expect(d.matched && d.body !== "").toBe(false);
  });

  // The completed-conversation pass needs the trigger even when the item itself is in the next utterance.
  it.each(["Earmark that.", "Um, earmark that", "Remark that —"])("detect: bare trigger %j matches with an empty body", (input) => {
    expect(detectEarmarkTrigger(input)).toEqual({ matched: true, body: "" });
  });
});
