import { describe, expect, it } from "vitest";
import { chooseRecommender, firstNameOnly, hasSecondPersonCue, nameAppearsIn } from "../../../agent/lib/pipeline/attribution";

describe("hasSecondPersonCue", () => {
  it.each([
    "you have to try the ramen",
    "You'd love this record",
    "you should read The Overstory",
    "you gotta hear this",
    "have you heard the new Floating Points",
    "check it out sometime",
  ])("finds a cue in %j", (t) => expect(hasSecondPersonCue(t)).toBe(true));

  it.each(["I went there last week", "we should get lunch", "they have to close early"])(
    "finds none in %j",
    (t) => expect(hasSecondPersonCue(t)).toBe(false),
  );
});

describe("names", () => {
  it("reduces to a capitalized first name and strips possessives", () => {
    expect(firstNameOnly("ann's")).toBe("Ann");
    expect(firstNameOnly("Marcus Johnson")).toBe("Marcus");
    expect(firstNameOnly("  José ")).toBe("José");
  });

  it("matches a capitalized or lowercase name in a voice note whose only capital is the sentence start", () => {
    expect(nameAppearsIn("Ann", "Earmark that, ann's ramen spot")).toBe(true);
  });

  it("matches whole first names only", () => {
    expect(nameAppearsIn("Ann", "Earmark that, Ann's ramen spot")).toBe(true);
    expect(nameAppearsIn("Ann", "Unknown: Annie said it's great")).toBe(false);
    expect(nameAppearsIn("Ann", null, "Ann recommended ramen")).toBe(true);
  });
});

describe("chooseRecommender", () => {
  const none = { triggerName: null, windowName: null, windowText: "", summaryName: null, summaryText: null };

  it("prefers the voice trigger name when it appears in the voice note", () => {
    expect(chooseRecommender({ ...none, triggerName: "Ann", windowText: "Ann's ramen spot" })).toEqual({ firstName: "Ann", source: "voice_trigger" });
  });

  it("uses a window name only with a second-person cue", () => {
    const windowText = "Unknown: Ann says you have to try the tonkotsu";
    expect(chooseRecommender({ ...none, windowName: "Ann", windowText })).toEqual({ firstName: "Ann", source: "second_person" });
    expect(chooseRecommender({ ...none, windowName: "Ann", windowText: "Unknown: Ann went to Ardent" }).source).toBe("none");
  });

  it("falls back to a name found in Bee's summary", () => {
    expect(chooseRecommender({ ...none, summaryName: "Marcus", summaryText: "Marcus recommended a book." })).toEqual({ firstName: "Marcus", source: "summary" });
  });

  it("never invents a name that is not in any source text", () => {
    expect(chooseRecommender({ ...none, triggerName: "Bob", windowText: "Ann's ramen spot", summaryName: "Bob", summaryText: "Lunch chat." })).toEqual({ firstName: null, source: "none" });
  });

  it("ignores non-names like Earmark and Unknown", () => {
    expect(chooseRecommender({ ...none, triggerName: "Earmark", windowText: "Earmark that" }).source).toBe("none");
    expect(chooseRecommender({ ...none, windowName: "Unknown", windowText: "Unknown: you have to try it" }).source).toBe("none");
  });

  it("orders voice_trigger over second_person over summary", () => {
    const all = { triggerName: "Ann", windowName: "Bo", windowText: "Ann's spot. Bo says you have to try it", summaryName: "Cy", summaryText: "Cy said so" };
    expect(chooseRecommender(all).source).toBe("voice_trigger");
    expect(chooseRecommender({ ...all, triggerName: null }).source).toBe("second_person");
    expect(chooseRecommender({ ...all, triggerName: null, windowName: null }).source).toBe("summary");
  });
});
