import { describe, expect, it } from "vitest";
import { isNewBloom, stageFor } from "../../../agent/lib/ideas/stage";

describe("stageFor", () => {
  it("maps mention counts to compost, sprouting, ready", () => {
    expect(stageFor("compost", 0)).toBe("compost");
    expect(stageFor("compost", 1)).toBe("compost");
    expect(stageFor("compost", 2)).toBe("sprouting");
    expect(stageFor("sprouting", 3)).toBe("ready");
    expect(stageFor("ready", 7)).toBe("ready");
  });
  it("never moves an idea out of drafted, used or dismissed", () => {
    expect(stageFor("drafted", 5)).toBe("drafted");
    expect(stageFor("used", 1)).toBe("used");
    expect(stageFor("dismissed", 3)).toBe("dismissed");
  });
});

describe("isNewBloom", () => {
  it("is true only on the transition into ready", () => {
    expect(isNewBloom("sprouting", "ready")).toBe(true);
    expect(isNewBloom("ready", "ready")).toBe(false);
    expect(isNewBloom("compost", "sprouting")).toBe(false);
  });
});
