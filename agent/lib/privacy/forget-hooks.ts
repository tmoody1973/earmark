import { del } from "@vercel/blob";
import type { PoolClient } from "@neondatabase/serverless";
import type { ForgetHook } from "./forget";
import { forgetPersonInEpisodes, forgetPersonInGardenerRuns, type Sql } from "./forget-m5";

// Forgetters owned by other lanes, run by `pnpm forget --yes` INSIDE the locked Postgres transaction, after the item's
// rows are deleted and after the Bee/Notion/Blob deletes. Use `ctx.c` (a pg PoolClient: `ctx.c.query(text, values)`) for
// every query so a throw rolls the whole forget back and a re-run retries. Return one line of ids/counts, never text.
// bee_sync contract: forget-rows.ts deletes bee_sync rows (and their Bee todos/facts) of entity_type 'rec' and 'idea'
// only (plus 'fact_proposal'). Every other entity type, e.g. M5's 'place_nudge' and 'rec_receipt' todos made with
// createEarmarkTodo (sync/bee-todos.ts), is deleted, Bee todo included, by its owner's hook below (lane C).

// Lane C's functions take a tagged-template `sql`; this one runs it on the forget transaction's client.
const sqlOver = (c: PoolClient): Sql => async (strings, ...values) =>
  (await c.query(strings.reduce((text, s, i) => `${text}$${i}${s}`), values)).rows as Record<string, unknown>[];
const ids = (xs: number[]) => (xs.length ? ` (ids ${xs.join(", ")})` : "");

// Lane C (M5). Only a forgotten rec carries a recommender first name; anything else is "… 0".
// Order matters: episodes is last because its Blob audio deletes cannot roll back if a later hook threw.
export const FORGET_HOOKS: readonly ForgetHook[] = [
  {
    name: "gardener_runs",
    run: async (ctx) => {
      if (!ctx.recommenderFirstName) return "gardener_runs 0";
      const { runIds } = await forgetPersonInGardenerRuns(ctx.recommenderFirstName, { sql: sqlOver(ctx.c) });
      return `gardener_runs ${runIds.length}${ids(runIds)}`;
    },
  },
  {
    name: "episodes",
    run: async (ctx) => {
      if (!ctx.recommenderFirstName) return "episodes 0";
      const r = await forgetPersonInEpisodes(ctx.recommenderFirstName, { sql: sqlOver(ctx.c), del: (url) => del(url) });
      return `episodes ${r.episodeIds.length}${ids(r.episodeIds)}, audio ${r.audioDeleted}`;
    },
  },
];
