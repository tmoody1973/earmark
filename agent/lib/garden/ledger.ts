import type { Rating, RecStatus } from "../types";

// The taste ledger (M4-T5): who gave Tarik tips, and what became of them. Counted live from the tips themselves
// (the recommenders.recs_* counter columns are never read, so the numbers cannot drift), from exactly the cards the
// pages show: the shelf's visibility rule, HIDDEN_TIP_STATUSES in queries.ts (decisions 024, 025: maybes never count).

type LedgerTip = {
  name: string;
  saidAt: string;
  status: RecStatus;
  rating: Rating | null;
  /** Already passed through toRecCard's owner guard: null for an unknown recommender and for the owner. */
  recommender: { id: number; firstName: string } | null;
};

export interface Taste { given: number; tried: number; loved: number }

export interface LedgerPerson extends Taste {
  id: number;
  firstName: string;
  /** When their most recent tip was said (ISO); the list is ordered by it, newest first. */
  lastTipAt: string;
  /** The name of that most recent tip. */
  latest: string;
  // Seam (ADD-ON 4, "stock" tips): a per-person stock-tip score (price change since the day it was said) joins here
  // as an optional field, filled from the stock tips' own data. Not built yet.
}

export interface TasteLedger {
  people: LedgerPerson[];
  /** Tips with no recommender: shown as one "not sure who" count, never as a person. */
  unknown: number;
}

/** Tried means he acted on it: marked tried or thanked, or rated it at all. */
export const isTried = (t: { status: RecStatus; rating: Rating | null }) =>
  t.status === "tried" || t.status === "thanked" || t.rating !== null;

export function buildLedger(tips: readonly LedgerTip[]): TasteLedger {
  const byId = new Map<number, LedgerPerson>();
  let unknown = 0;
  for (const t of tips) {
    if (!t.recommender) { unknown++; continue; }
    const p = byId.get(t.recommender.id) ?? {
      id: t.recommender.id, firstName: t.recommender.firstName, given: 0, tried: 0, loved: 0, lastTipAt: t.saidAt, latest: t.name,
    };
    const newer = t.saidAt > p.lastTipAt; // ISO strings from toRecCard sort as times
    byId.set(p.id, {
      ...p,
      given: p.given + 1,
      tried: p.tried + (isTried(t) ? 1 : 0),
      loved: p.loved + (t.rating === "loved" ? 1 : 0),
      lastTipAt: newer ? t.saidAt : p.lastTipAt,
      latest: newer ? t.name : p.latest,
    });
  }
  const people = [...byId.values()].sort(
    (a, b) => b.lastTipAt.localeCompare(a.lastTipAt) || a.firstName.localeCompare(b.firstName) || a.id - b.id,
  );
  return { people, unknown };
}

/** "4 tips · 2 tried · loved 1": real counts only, nothing inferred. */
export function tasteLine({ given, tried, loved }: Taste): string {
  const parts = [`${given} ${given === 1 ? "tip" : "tips"}`, tried > 0 ? `${tried} tried` : "not tried yet"];
  if (loved > 0) parts.push(`loved ${loved}`);
  return parts.join(" · ");
}
