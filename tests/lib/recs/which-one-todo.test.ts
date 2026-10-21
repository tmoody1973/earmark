import { describe, expect, it } from "vitest";
import { whichOneTodoText } from "../../../agent/lib/recs/which-one-todo";

describe("whichOneTodoText (decision 062)", () => {
  it("asks about the first option by name and points at Earmark", () => {
    expect(whichOneTodoText("Diaspora Sports Bar and Lounge")).toBe("Is this Diaspora Sports Bar and Lounge? Confirm in Earmark");
  });
  it("clips a very long name", () => {
    const t = whichOneTodoText("x".repeat(200));
    expect(t.length).toBeLessThan(120);
    expect(t).toContain("…");
  });
});
