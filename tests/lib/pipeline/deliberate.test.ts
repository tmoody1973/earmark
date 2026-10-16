import { describe, expect, it } from "vitest";
import { splitDeliberate } from "../../../agent/lib/pipeline/deliberate";
import type { Utterance } from "../../../agent/lib/types";

const u = (text: string, id?: number): Utterance => ({ text, speaker: "Unknown", spokenAt: new Date(Date.UTC(2026, 9, 16, 18, 23, id ?? 0)), id });

describe("splitDeliberate", () => {
  it("finds the four real 'Earmark that' lines, each alone, and removes them from the transcript", () => {
    const lines = [
      u("so anyway that was the meeting", 1),
      u("Earmark that spot as known for Omakase called 1033 here in Walker's Point.", 2),
      u("Earmark that I should listen to Jemetta Rose's new albums as a tribute to Sun Raw Records.", 3),
      u("Remark that Chris says to try that Notion calendar app.", 4),
      u("Earmark that the syntax guys told me to check out this new repo called PyPI Durable.", 5),
      u("okay back to work", 6),
    ];
    const { earmarks, rest } = splitDeliberate(lines);
    expect(earmarks.map((e) => e.key)).toEqual(["u2", "u3", "u4", "u5"]);
    expect(earmarks[2]!.body).toBe("Chris says to try that Notion calendar app");
    expect(earmarks[0]!.spokenAt).toEqual(lines[1]!.spokenAt);
    expect(rest.map((x) => x.id)).toEqual([1, 6]);
  });

  it("a short or unpunctuated trigger utterance takes up to 2 following utterances", () => {
    const { earmarks, rest } = splitDeliberate([
      u("Earmark that", 1), u("Ann's ramen spot", 2), u("Kawa Ramen on Brady Street", 3), u("unrelated chatter", 4),
    ]);
    expect(earmarks).toHaveLength(1);
    expect(earmarks[0]!.body).toBe("Ann's ramen spot Kawa Ramen on Brady Street");
    expect(rest.map((x) => x.id)).toEqual([4]);
  });

  it("punctuated but under 6 words still continues; 6+ words without end punctuation also continues", () => {
    const short = splitDeliberate([u("Earmark that Notion calendar.", 1), u("by the way it syncs with Google", 2), u("fine", 3), u("tail", 4)]);
    expect(short.earmarks[0]!.body).toBe("Notion calendar by the way it syncs with Google fine");
    expect(short.rest.map((x) => x.id)).toEqual([4]);
    const noPunct = splitDeliberate([u("Earmark that the new album from Khruangbin", 1), u("it is great", 2)]);
    expect(noPunct.earmarks[0]!.body).toBe("the new album from Khruangbin it is great");
    expect(noPunct.rest).toEqual([]);
  });

  it("a long punctuated trigger utterance (6+ words) stands alone", () => {
    const { earmarks, rest } = splitDeliberate([u("Earmark that Marcus says listen to Sault.", 1), u("next thing", 2)]);
    expect(earmarks[0]!.body).toBe("Marcus says listen to Sault");
    expect(rest.map((x) => x.id)).toEqual([2]);
  });

  it("the continuation stops at the next triggered utterance", () => {
    const { earmarks, rest } = splitDeliberate([
      u("Earmark that", 1), u("Ann's ramen spot", 2), u("Earmark that Marcus says listen to Sault.", 3), u("tail", 4),
    ]);
    expect(earmarks.map((e) => e.body)).toEqual(["Ann's ramen spot", "Marcus says listen to Sault"]);
    expect(rest.map((x) => x.id)).toEqual([4]);
  });

  it("a bare trigger at the very end has nothing to save and is dropped from the transcript without an earmark", () => {
    const { earmarks, rest } = splitDeliberate([u("hello there", 1), u("Earmark that.", 2)]);
    expect(earmarks).toEqual([]);
    expect(rest.map((x) => x.id)).toEqual([1]);
  });

  it("ignores blank utterances when counting the continuation, and falls back to the position when there is no id", () => {
    const { earmarks, rest } = splitDeliberate([u("filler"), u("Earmark that"), u("   "), u("Ann's ramen spot"), u("tail")]);
    expect(earmarks.map((e) => e.key)).toEqual(["i1"]);
    expect(earmarks[0]!.body).toBe("Ann's ramen spot tail");
    expect(rest.map((x) => x.text)).toEqual(["filler", "   "]);
  });

  it("mid-sentence mentions are not triggers; no triggers leaves the transcript untouched", () => {
    const lines = [u("I'd remark that the weather is strange.", 1), u("we should earmark that budget for the studio.", 2)];
    const { earmarks, rest } = splitDeliberate(lines);
    expect(earmarks).toEqual([]);
    expect(rest).toEqual(lines);
  });
});
