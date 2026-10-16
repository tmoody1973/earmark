import { describe, expect, it } from "vitest";
import { normalizeProposal, parseJsonl, parseOverride, type Label } from "../../../agent/lib/evals/labels";

describe("cross-field rule", () => {
  const p: Label = { kind: "rec_to_user", rec_type: "album", joking: false, notes: "" };
  const neither: Label = { ...p, kind: "neither", rec_type: "none" };
  it("rejects a rec kind with no rec type and a non-rec kind with a rec type, with a hint", () => {
    expect(() => parseOverride("k=rec_by_user t=none", p)).toThrow(/need a t=/);
    expect(() => parseOverride("k=neither t=song", p)).toThrow(/t=none/);
    expect(() => parseOverride("k=idea_by_user t=book", p)).toThrow();
  });
  it("rejects switching from a non-rec kind to a rec kind without t=", () => {
    expect(() => parseOverride("k=rec_to_user", neither)).toThrow();
    expect(parseOverride("k=rec_to_user t=book", neither)).toMatchObject({ rec_type: "book" });
  });
  it("normalizes a broken model proposal instead of showing it", () => {
    expect(normalizeProposal({ ...p, kind: "neither", rec_type: "song" }).rec_type).toBe("none");
    expect(normalizeProposal({ ...p, rec_type: "none" }).rec_type).toBe("other");
  });
});

describe("parseJsonl", () => {
  it("reads whole lines", () => {
    expect(parseJsonl('{"a":1}\n{"a":2}\n')).toEqual({ rows: [{ a: 1 }, { a: 2 }], skipped: 0 });
  });
  it("drops an unparseable trailing line and counts it", () => {
    expect(parseJsonl('{"a":1}\n{"a":2')).toEqual({ rows: [{ a: 1 }], skipped: 1 });
  });
  it("still throws on a corrupt line in the middle", () => {
    expect(() => parseJsonl('{"a":1}\nnope\n{"a":2}\n')).toThrow();
  });
});

const proposal: Label = { kind: "rec_to_user", rec_type: "album", joking: false, notes: "Ann suggests an album" };

describe("parseOverride", () => {
  it("accepts the proposal on Enter", () => {
    expect(parseOverride("", proposal)).toEqual(proposal);
  });
  it("skips and quits", () => {
    expect(parseOverride("s", proposal)).toBe("skip");
    expect(parseOverride("q", proposal)).toBe("quit");
  });
  it("overrides kind, rec type, joking and notes; notes take the rest of the line", () => {
    expect(parseOverride("k=neither t=none j=y n=just chatting about weather", proposal)).toEqual({
      kind: "neither", rec_type: "none", joking: true, notes: "just chatting about weather",
    });
  });
  it("keeps unspecified fields from the proposal", () => {
    expect(parseOverride("t=song", proposal)).toEqual({ ...proposal, rec_type: "song" });
  });
  it("throws on an invalid value so a typo cannot become a label", () => {
    expect(() => parseOverride("k=rec", proposal)).toThrow();
    expect(() => parseOverride("t=movie", proposal)).toThrow();
  });
  it("throws on an unknown field", () => {
    expect(() => parseOverride("x=1", proposal)).toThrow(/unknown field/);
  });
  it("notes alone keep every other field", () => {
    expect(parseOverride("n=fine as is", proposal)).toEqual({ ...proposal, notes: "fine as is" });
  });
  it("a kind with no rec to type forces none unless t= is given", () => {
    expect(parseOverride("k=neither", proposal)).toEqual({ ...proposal, kind: "neither", rec_type: "none" });
    expect(parseOverride("k=idea_by_user", proposal)).toEqual({ ...proposal, kind: "idea_by_user", rec_type: "none" });
  });
  it("accepts y/n for joking and rejects anything else", () => {
    expect(parseOverride("j=n", { ...proposal, joking: true })).toMatchObject({ joking: false });
    expect(() => parseOverride("j=maybe", proposal)).toThrow();
  });
});
