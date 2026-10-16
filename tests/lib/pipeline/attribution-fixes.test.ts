import { describe, expect, it } from "vitest";
import { chooseRecommender, hasSecondPersonCue, nameAppearsIn, validName, validNameFor } from "../../../agent/lib/pipeline/attribution";

describe("garden owner is never a recommender", () => {
  it("validNameFor rejects the owner's first name, case-insensitively", () => {
    expect(validNameFor("Tarik", "Tarik", "Tarik, try the ramen")).toBeNull();
    expect(validNameFor("Tarik", "tarik", "tarik try the ramen")).toBeNull();
    expect(validNameFor("tarik", "Tarik Moody", "Tarik, try the ramen")).toBeNull();
  });
  it("still accepts other names, and everyone when no owner is configured", () => {
    expect(validNameFor("Tarik", "Ann", "Ann says try it")).toBe("Ann");
    expect(validNameFor(undefined, "Tarik", "Tarik, try the ramen")).toBe("Tarik");
    expect(validName("Tarik", "Tarik, try the ramen")).toBe("Tarik");
  });
  it("chooseRecommender credits nobody when the only name is the owner", () => {
    const base = {
      triggerName: null, windowName: "Tarik", windowText: "Tarik, you have to try Ardent",
      summaryName: "Tarik", summaryText: "Tarik was told about Ardent", ownerFirstName: "Tarik",
    };
    expect(chooseRecommender(base)).toEqual({ firstName: null, source: "none" });
    expect(chooseRecommender({ ...base, triggerName: "Tarik" })).toEqual({ firstName: null, source: "none" });
    expect(chooseRecommender({ ...base, ownerFirstName: undefined }).firstName).toBe("Tarik");
  });
});

describe("validName", () => {
  it("rejects label and pronoun words", () => {
    for (const n of ["Unknown", "Speaker", "You", "Bee", "Earmark"]) expect(validName(n, `${n} said hi`)).toBeNull();
  });
  it("reduces to a first name present in the text", () => {
    expect(validName("Ann Smith", "Ann says try it")).toBe("Ann");
    expect(validName("Bob", "Ann says try it")).toBeNull();
    expect(validName(null, "Ann")).toBeNull();
  });
});

describe("nameAppearsIn (case and boundaries)", () => {
  it("does not match lowercase common words when the text has capitals", () => {
    expect(nameAppearsIn("Will", "Unknown: I will try it at Ardent")).toBe(false);
    expect(nameAppearsIn("Grace", "Unknown: she said it at Ardent with grace")).toBe(false);
    expect(nameAppearsIn("Will", "Unknown: Will says try it")).toBe(true);
  });
  it("handles hyphenated names and possessives", () => {
    expect(nameAppearsIn("Ann", "Ann-Marie said so")).toBe(false);
    expect(nameAppearsIn("Ann", "Ann's ramen")).toBe(true);
    expect(nameAppearsIn("Ann", "Ann’s ramen")).toBe(true);
  });
  it("is case-insensitive when the text has no capitals at all", () => {
    expect(nameAppearsIn("Ann", "ann said try it")).toBe(true);
  });
});

describe("nameAppearsIn (lowercase transcripts)", () => {
  it("counts lowercase names when only labels and sentence starts are capitalized", () => {
    expect(nameAppearsIn("Ann", "Unknown: earmark that, ann's ramen spot")).toBe(true);
    expect(nameAppearsIn("Ann", "Earmark that, ann's ramen spot")).toBe(true);
    expect(nameAppearsIn("Ann", "Unknown: Earmark that. Ann's ramen spot is good\nUnknown: yes, ann too")).toBe(true);
  });
  it("stays case-sensitive once a mid-sentence capital shows the text capitalizes names", () => {
    expect(nameAppearsIn("Will", "Unknown: I will try it. Then Grace said hi")).toBe(false);
    expect(nameAppearsIn("Ann", "Unknown: so I think ann said Marcus knows")).toBe(false);
  });
  // Accepted risk: with no capitals to go on, "Will"/"Grace" match the common words "will"/"grace".
  it("accepts the common-word risk in fully lowercase text", () => {
    expect(nameAppearsIn("Will", "Unknown: i will try it")).toBe(true);
  });
});

describe("curly apostrophes", () => {
  it("finds a cue with a curly apostrophe", () => {
    expect(hasSecondPersonCue("you’d love it")).toBe(true);
  });
});
