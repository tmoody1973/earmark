import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../app/garden/actions", () => ({ chooseTip: vi.fn() }));

import type { RecCardData } from "../../../agent/lib/garden/queries";
import { RecCard } from "../../../app/garden/cards/RecCard";

// The "Which one?" chip (decision 048) is the owner's: only on cards with actions (Shelf, Garden, People), never on a
// card someone else reads (a Space, a published page).
const card: RecCardData = {
  id: 9, type: "place", variant: "map", name: "Blue Door", creator: null, yearOrAddress: null, imageUrl: null, why: null,
  about: null, recommender: null, saidAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", status: "new",
  rating: null, lat: null, lng: null, link: null, whichOne: true,
};
const html = (c: RecCardData, actions: boolean) => renderToStaticMarkup(createElement(RecCard, { card: c, actions }));

describe("RecCard's Which one? chip", () => {
  it("shows on the owner's card when the tip asks", () => {
    expect(html(card, true)).toContain("Which one?");
  });
  it("never on a card someone else reads, and not when the tip doesn't ask", () => {
    expect(html(card, false)).not.toContain("Which one?");
    expect(html({ ...card, whichOne: false }, true)).not.toContain("Which one?");
  });
});
