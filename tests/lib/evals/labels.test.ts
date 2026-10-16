import { describe, expect, it } from "vitest";
import { parseOverride, type Label } from "../../../agent/lib/evals/labels";

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
