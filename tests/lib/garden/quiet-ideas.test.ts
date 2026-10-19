import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { dismissIdea, heardOnceMessage, keepIdea, undoDismissIdea } from "../../../agent/lib/garden/quiet-ideas";

// The visibility rule itself is SQL (idea_is_quiet, migration 045); its cases run against the TEST branch in
// tests/integration/quiet-ideas.int.test.ts. Here: the words the page says, and the guards before any SQL runs.
describe("quiet ideas (decision 055)", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  it("says what happened in words, and that a failed save brings the row back", () => {
    expect(heardOnceMessage("keep", "A zine", { changed: true })).toBe("Kept: A zine. It’s in your garden now.");
    expect(heardOnceMessage("dismiss", "A zine", { changed: true })).toBe("Dismissed: A zine");
    expect(heardOnceMessage("keep", "A zine", { changed: false })).toBe("Already handled: A zine");
    expect(heardOnceMessage("dismiss", "A zine", null)).toBe("Couldn't save that. A zine is back in the list; try again.");
  });

  it("refuses a bad id or a bad previous stage before touching the database", async () => {
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(keepIdea(bad)).rejects.toThrow("invalid idea id");
      await expect(dismissIdea(bad)).rejects.toThrow("invalid idea id");
      await expect(undoDismissIdea(bad, "compost")).rejects.toThrow("invalid idea id");
    }
    await expect(undoDismissIdea(7, "dismissed" as never)).rejects.toThrow("invalid previous stage");
    expect(h.mock.calls).toEqual([]);
  });

  it("dismiss reports the stage it left; a repeat reports no change", async () => {
    h.mock.queue.push([{ previous: "sprouting" }], []);
    expect(await dismissIdea(7)).toEqual({ changed: true, previous: "sprouting" });
    expect(await dismissIdea(7)).toEqual({ changed: false, previous: null });
  });
});
