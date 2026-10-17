import { describe, expect, it } from "vitest";
import { applyChoice, TIP_MOVES, tipChoices, tipMessage } from "../../../agent/lib/garden/tip";
import { buildLedger, isTried } from "../../../agent/lib/garden/ledger";
import { HIDDEN_TIP_STATUSES } from "../../../agent/lib/garden/queries";

// FR-22: a tip on the shelf can be queued ("Try this"), marked tried, rated, or dismissed from its card.
describe("tipChoices (what a card's menu offers)", () => {
  it("a new tip: try it later, say you tried it, or dismiss it", () => {
    expect(tipChoices({ status: "new", rating: null })).toEqual(["queue", "tried", "dismiss"]);
  });
  it("a queued tip: tried, or dismiss", () => {
    expect(tipChoices({ status: "queued", rating: null })).toEqual(["tried", "dismiss"]);
  });
  it.each(["tried", "thanked"] as const)("a %s tip is only rated: never dismissed from a card, so its giver keeps the count (decision 024)", (status) => {
    expect(tipChoices({ status, rating: null })).toEqual(["loved", "fine", "not_for_me"]);
  });
  it("a rated tip can be re-rated, and still not dismissed", () => {
    expect(tipChoices({ status: "tried", rating: "fine" })).toEqual(["loved", "fine", "not_for_me"]);
  });
});

describe("TIP_MOVES (the status core's from-guards)", () => {
  it("queues only a new tip; tried from new or queued; dismisses only an untried tip", () => {
    expect(TIP_MOVES.queue).toEqual({ next: "queued", from: ["new"] });
    expect(TIP_MOVES.tried).toEqual({ next: "tried", from: ["new", "queued"] });
    expect(TIP_MOVES.dismiss).toEqual({ next: "dismissed", from: ["new", "queued"] });
  });
  it("never starts from a status the shelf hides (maybes have their own row; cleared tips stay cleared)", () => {
    for (const m of Object.values(TIP_MOVES)) for (const s of m.from) expect(HIDDEN_TIP_STATUSES).not.toContain(s);
  });
});

describe("applyChoice (the card's optimistic state)", () => {
  const fresh = { status: "new", rating: null, gone: false } as const;
  it("moves status for queue and tried; hides on dismiss", () => {
    expect(applyChoice(fresh, "queue")).toEqual({ status: "queued", rating: null, gone: false });
    expect(applyChoice(fresh, "tried")).toEqual({ status: "tried", rating: null, gone: false });
    expect(applyChoice(fresh, "dismiss")).toEqual({ ...fresh, gone: true });
  });
  it("a rating on an untried tip also marks it tried, as setRecRating does", () => {
    expect(applyChoice({ ...fresh, status: "queued" }, "loved")).toEqual({ status: "tried", rating: "loved", gone: false });
    expect(applyChoice({ ...fresh, status: "thanked" }, "fine")).toEqual({ status: "thanked", rating: "fine", gone: false });
  });
  it("never mutates the state it was given", () => {
    const s = { ...fresh };
    applyChoice(s, "tried");
    expect(s).toEqual(fresh);
  });
  it("matches the taste ledger: tried after Tried or any rating, loved only for Loved", () => {
    const tip = (st: ReturnType<typeof applyChoice>) => ({ name: "x", saidAt: "2026-10-16T00:00:00Z", status: st.status, rating: st.rating, recommender: { id: 1, firstName: "Ann" } });
    const tried = applyChoice(fresh, "tried");
    const loved = applyChoice(tried, "loved");
    expect(isTried(tried)).toBe(true);
    expect(buildLedger([tip(tried), tip(loved), tip(applyChoice(fresh, "queue"))]).people[0]).toMatchObject({ given: 3, tried: 2, loved: 1 });
  });
});

describe("tipMessage (the live region)", () => {
  it("names what happened to which tip", () => {
    expect(tipMessage("queue", "Promises", { changed: true })).toBe("Marked to try: Promises");
    expect(tipMessage("tried", "Promises", { changed: true })).toBe("Marked tried: Promises");
    expect(tipMessage("loved", "Promises", { changed: true })).toBe("Loved it: Promises");
    expect(tipMessage("not_for_me", "Promises", { changed: true })).toBe("Not for me: Promises");
    expect(tipMessage("dismiss", "Promises", { changed: true })).toBe("Dismissed: Promises");
  });
  it("says when nothing changed, and when the save failed (the card is put back)", () => {
    expect(tipMessage("tried", "Promises", { changed: false })).toBe("Nothing changed — it was updated elsewhere");
    expect(tipMessage("dismiss", "Promises", null)).toBe("Couldn't save that. Promises is back as it was; try again.");
  });
});
