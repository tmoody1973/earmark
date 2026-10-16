import { describe, expect, it } from "vitest";
import { APICallError, NoObjectGeneratedError, RetryError, TypeValidationError } from "ai";
import { isOutage, splitDeliberate } from "../../../agent/lib/pipeline/deliberate";
import { SystemicTriageError } from "../../../agent/lib/pipeline/triage";
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

// Real SDK instances: their names are prefixed ("AI_APICallError"), so classification must use the SDK's own guards.
// M2-T14: Bee's diarization split the trigger word itself across two utterances (two speakers, same second) in real
// conversation 11338188: "Earm" | "ark that." | "Anne's Ramen Spot, Kawa Ramen…". The matcher saw neither half, so the
// item went through ambient triage and was saved a second time (rec 163).
describe("splitDeliberate: a trigger split across two utterances", () => {
  it("the real 11338188 shape: fragment + rest of the trigger + body, then the next earmark", () => {
    const { earmarks, rest } = splitDeliberate([
      u("Done.", 1), u("Earm", 2), u("ark that.", 3), u("Anne's Ramen Spot, Kawa Ramen", 4), u("Earmark that.", 5), u("Marcus says, listen to Acts of Faith.", 6),
    ]);
    expect(earmarks.map((e) => [e.key, e.body])).toEqual([
      ["u2", "Anne's Ramen Spot, Kawa Ramen"],
      ["u5", "Marcus says, listen to Acts of Faith."],
    ]);
    expect(earmarks[0]!.spokenAt).toEqual(u("", 2).spokenAt);
    expect(rest.map((x) => x.id)).toEqual([1]);
  });

  it.each([
    [["Earm", "ark that."], true],
    [["Ear", "mark that"], true],
    [["Earmark", "that."], true],
    [["Okay, earm", "ark that"], true],
    [["Re", "mark that."], true],
    [["Earm", "arked that."], false], // "earmarked that" is never a trigger
    [["we earm", "arked that budget"], false],
    [["so I told him about the ear", "mark that"], false], // only a short fragment (≤ 3 words) can carry half a trigger
    [["Done.", "Earmark that."], true], // the second utterance triggers on its own; the first stays in the transcript
  ])("%j -> trigger %s", (parts, want) => {
    const lines = [...parts.map((p, i) => u(p, i + 1)), u("Kawa Ramen on Brady Street", 9)];
    const { earmarks } = splitDeliberate(lines);
    expect(earmarks.length > 0).toBe(want);
    if (want) expect(earmarks[0]!.body).toBe("Kawa Ramen on Brady Street");
  });

  it("an utterance that triggers on its own keeps its own key (never the filler before it)", () => {
    const { earmarks, rest } = splitDeliberate([u("Done.", 1), u("Earmark that.", 2), u("Kawa Ramen on Brady Street", 3)]);
    expect(earmarks.map((e) => e.key)).toEqual(["u2"]);
    expect(rest.map((x) => x.id)).toEqual([1]);
  });
});

describe("isOutage (real AI SDK errors)", () => {
  const api = new APICallError({ message: "down", url: "https://x", requestBodyValues: {}, statusCode: 503 });
  const noObject = new NoObjectGeneratedError({
    message: "bad", response: { id: "i", timestamp: new Date(), modelId: "m" }, usage: {} as never, finishReason: "stop" as never,
  });
  it.each([
    ["APICallError", api],
    ["RetryError", new RetryError({ message: "gave up", reason: "maxRetriesExceeded", errors: [api] })],
    ["SystemicTriageError", new SystemicTriageError("all_failed")],
    ["fetch failed", new TypeError("fetch failed")],
    ["AbortError", Object.assign(new Error("x"), { name: "AbortError" })],
    ["TimeoutError", Object.assign(new Error("x"), { name: "TimeoutError" })],
  ])("%s is an outage (retry later)", (_n, err) => expect(isOutage(err)).toBe(true));

  it.each([
    ["NoObjectGeneratedError", noObject],
    ["TypeValidationError", new TypeValidationError({ value: 1, cause: new Error("schema") })],
    ["plain Error", new Error("bad json")],
  ])("%s is not an outage (falls back to a raw review rec)", (_n, err) => expect(isOutage(err)).toBe(false));

  it("the real names are AI_-prefixed, which is why names are not matched", () => {
    expect(api.name).toBe("AI_APICallError");
  });
});
