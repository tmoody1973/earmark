import { describe, expect, it } from "vitest";
import { verdictMessage } from "../../../agent/lib/garden/maybe";

// What the Maybe? row's live region says after a tap (decision 025).
describe("verdictMessage", () => {
  it("says what happened to the tip", () => {
    expect(verdictMessage("keep", "Promises", { changed: true })).toBe("Kept: Promises");
    expect(verdictMessage("drop", "Promises", { changed: true })).toBe("Removed: Promises");
  });

  it("says so when the tip was already handled elsewhere (no-op)", () => {
    expect(verdictMessage("keep", "Promises", { changed: false })).toBe("Already handled: Promises");
    expect(verdictMessage("drop", "Promises", { changed: false })).toBe("Already handled: Promises");
  });

  it("names the failure and the recovery", () => {
    expect(verdictMessage("keep", "Promises", null)).toBe("Couldn't save that. Promises is back in Maybe; try again.");
  });
});
