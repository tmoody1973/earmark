import { describe, expect, it } from "vitest";
import { isWorkTalk, pickSample, type Candidate } from "../../../agent/lib/evals/sample";

const c = (id: string, conv: number, kind: Candidate["kind"], window = "Unknown: hello"): Candidate => ({ id, conv, kind, window });
const noShuffle = <T,>(xs: T[]) => xs;
const opts = { positives: 3, negatives: 3, maxPerConversation: 2, shuffle: noShuffle };

describe("isWorkTalk", () => {
  it("flags the shelf's known work-talk names, case-insensitively", () => {
    expect(isWorkTalk("Unknown: I read it in the new york times")).toBe(true);
    expect(isWorkTalk("Unknown: put it in Datawrapper")).toBe(true);
    expect(isWorkTalk("Unknown: Radio Milwaukee is hiring")).toBe(true);
    expect(isWorkTalk("Unknown: try Kopp's custard")).toBe(false);
  });
});

describe("pickSample", () => {
  it("caps positives per conversation so one long talk cannot fill the set", () => {
    const cands = [c("1-0", 1, "rec_to_user"), c("1-1", 1, "idea_by_user"), c("1-2", 1, "rec_to_user"), c("2-0", 2, "rec_to_user")];
    expect(pickSample(cands, opts).positives.map((x) => x.id)).toEqual(["1-0", "1-1", "2-0"]);
  });
  it("treats work-talk windows the model called positive as negatives to check, not positives", () => {
    const cands = [c("1-0", 1, "rec_to_user", "Unknown: you should read the New York Times piece"), c("2-0", 2, "rec_to_user")];
    const r = pickSample(cands, opts);
    expect(r.positives.map((x) => x.id)).toEqual(["2-0"]);
    expect(r.negatives.map((x) => x.id)).toEqual(["1-0"]);
  });
  it("puts checks first, then plain neither windows, up to the target", () => {
    const cands = [c("a", 1, "neither"), c("b", 2, "neither"), c("w", 3, "idea_by_user", "Unknown: datawrapper"), c("d", 4, "neither"), c("e", 5, "neither")];
    expect(pickSample(cands, opts).negatives.map((x) => x.id)).toEqual(["w", "a", "b"]);
  });
  it("returns fewer than the target rather than padding", () => {
    const r = pickSample([c("a", 1, "rec_to_user")], opts);
    expect(r.positives).toHaveLength(1);
    expect(r.negatives).toHaveLength(0);
  });
});
