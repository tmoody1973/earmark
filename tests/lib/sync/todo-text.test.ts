import { describe, expect, it } from "vitest";
import { formatTodoText, MAX_OPEN_TODOS, slotsAvailable, TODO_PREFIX, withLink } from "../../../agent/lib/sync/todo-text";

const rec = {
  id: 7, type: "album" as const, canonical_name: "Promises", creator: "Floating Points",
  recommender_first_name: "Ann", said_at: new Date("2026-10-12T18:00:00Z"),
};

describe("formatTodoText", () => {
  it("is prefix, verb, title, creator, who and day, then the garden link (never an excerpt)", () => {
    expect(formatTodoText(rec, "https://earmark.test"))
      .toBe("Earmark · Listen: Promises, Floating Points (Ann, Oct 12) https://earmark.test/tips/7");
  });

  it("uses the type's verb and omits a missing recommender and creator", () => {
    expect(formatTodoText({ ...rec, type: "place", creator: null, recommender_first_name: null }, "https://earmark.test/"))
      .toBe("Earmark · Visit: Promises (Oct 12) https://earmark.test/tips/7");
  });

  it("a video tip is watched", () => {
    expect(formatTodoText({ ...rec, type: "video", creator: null, recommender_first_name: null }, "https://earmark.test"))
      .toBe("Earmark · Watch: Promises (Oct 12) https://earmark.test/tips/7");
  });

  it("dates in Central time (a late-evening tip keeps its local day)", () => {
    expect(formatTodoText({ ...rec, said_at: new Date("2026-10-13T03:30:00Z") }, "x")).toContain("(Ann, Oct 12)");
  });

  it("always starts with the Earmark prefix", () => {
    expect(formatTodoText(rec, "x").startsWith(TODO_PREFIX)).toBe(true);
  });
});

describe("slotsAvailable", () => {
  it("caps open Earmark todos at 10", () => {
    expect(MAX_OPEN_TODOS).toBe(10);
    expect([0, 9, 10, 12].map(slotsAvailable)).toEqual([10, 1, 0, 0]);
  });
});

describe("withLink", () => {
  it("adds the page link when the base URL is known", () => {
    expect(withLink("Earmark · Thank Sam for the X tip", "receipts", 161, "https://earmark.test/"))
      .toBe("Earmark · Thank Sam for the X tip https://earmark.test/receipts/161");
    expect(withLink("Earmark · You're near Y", "tips", 149, "https://earmark.test")).toBe("Earmark · You're near Y https://earmark.test/tips/149");
  });
  it("leaves the text alone without a base URL", () => {
    expect(withLink("Earmark · You're near Y", "tips", 149, "")).toBe("Earmark · You're near Y");
  });
});
