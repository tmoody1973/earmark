// What a shelf card can do with its tip (M3-T10, FR-22): Try this, Tried, a rating, Dismiss. Pure: the card's menu,
// its optimistic state and its live-region words, plus the status core's from-guards for each move.
import type { Rating, RecStatus } from "../types";
import { isTried } from "./ledger";

export type TipMove = "queue" | "tried" | "dismiss";
export type TipChoice = TipMove | Rating;

export const RATINGS: readonly Rating[] = ["loved", "fine", "not_for_me"];
export const TIP_CHOICES: readonly TipChoice[] = ["queue", "tried", "dismiss", ...RATINGS];
export const RATING_LABEL: Record<Rating, string> = { loved: "Loved it", fine: "It was fine", not_for_me: "Not for me" };
export const CHOICE_LABEL: Record<TipChoice, string> = { queue: "Try this", tried: "Tried it", dismiss: "Dismiss", ...RATING_LABEL };

/**
 * Each move's target and the statuses it may start from: only those the shelf shows (never a maybe, which has its own
 * row, nor a cleared tip). Queue is for a tip not yet acted on; a tried tip never goes back on the try list. Dismiss is
 * for untried tips only: dismissing a tried or rated tip would silently drop its giver's tried/loved counts
 * (decision 024), so a card never offers it.
 */
export const TIP_MOVES: Record<TipMove, { next: RecStatus; from: readonly RecStatus[] }> = {
  queue: { next: "queued", from: ["new"] },
  tried: { next: "tried", from: ["new", "queued"] },
  dismiss: { next: "dismissed", from: ["new", "queued"] },
};

type TipState = { status: RecStatus; rating: Rating | null };

/** The menu for a tip in this state, in order. Tried (or thanked, or rated) tips are only rated (decision 024). */
export function tipChoices(t: TipState): TipChoice[] {
  if (isTried(t)) return [...RATINGS];
  return [...(t.status === "new" ? ["queue" as const] : []), "tried", "dismiss"];
}

/** The card right after a tap, before the server answers. Mirrors setRecRating: rating an untried tip tries it. */
export function applyChoice<T extends TipState & { gone: boolean }>(t: T, choice: TipChoice): T {
  if (choice === "dismiss") return { ...t, gone: true };
  if (choice === "queue" || choice === "tried") return { ...t, status: TIP_MOVES[choice].next };
  const status = t.status === "new" || t.status === "queued" ? "tried" : t.status;
  return { ...t, status, rating: choice };
}

/** What the live region says after a tap. `result` null: the save failed and the card was put back. */
export function tipMessage(choice: TipChoice, name: string, result: { changed: boolean } | null): string {
  if (!result) return `Couldn't save that. ${name} is back as it was; try again.`;
  // the card never sends a repeat of the current rating, so false means the from-guard refused: changed elsewhere
  if (!result.changed) return "Nothing changed — it was updated elsewhere";
  const said: Record<TipChoice, string> = { ...RATING_LABEL, queue: "Marked to try", tried: "Marked tried", dismiss: "Dismissed" };
  return `${said[choice]}: ${name}`;
}
