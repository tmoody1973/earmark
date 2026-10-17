import type { RecStatus } from "../types";

// Side effects of a tip's status change, owned by other tasks. setRecStatus (status.ts) runs them in this order after
// every real change, each on its own: a throw is logged (ids + error name) and never stops the next one or undoes the
// change. An effect sees only ids and statuses; load anything else itself (getRec in store/rec-rows.ts).
// Changes that came from a surface must not be echoed back to it: check `origin`.

export type StatusOrigin = "garden" | "notion" | "bee" | "slack" | "system";

export interface StatusChange {
  recId: number;
  previous: RecStatus;
  next: RecStatus;
  origin: StatusOrigin;
  recommenderId: number | null;
}

export interface StatusEffect {
  name: string;
  run: (change: StatusChange) => Promise<void>;
}

export const STATUS_EFFECTS: readonly StatusEffect[] = [
  // bee-todos: M3-T7 adds its entry here, e.g.
  //   { name: "bee-todos", run: beeTodoEffect } — complete or remove the rec's Bee todo when it leaves "queued"
  //   (skip origin "bee"), drain the todo queue when a slot opens or fills.
  // notion: M3-T2b when NOTION_TOKEN exists, e.g.
  //   { name: "notion", run: async (c) => { if (c.origin !== "notion") await pushRecToNotion(c.recId); } }
];
