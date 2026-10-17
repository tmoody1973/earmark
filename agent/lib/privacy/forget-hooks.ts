import type { ForgetHook } from "./forget";

// Forgetters owned by other lanes, run by `pnpm forget --yes` INSIDE the locked Postgres transaction, after the item's
// rows are deleted and after the Bee/Notion/Blob deletes. Use `ctx.c` (a pg PoolClient: `ctx.c.query(text, values)`) for
// every query so a throw rolls the whole forget back and a re-run retries. Return one line of ids/counts, never text.
// Lane C (M5, forget-m5.ts) adds its entries here, e.g.
//   { name: "episodes", run: async (ctx) => ctx.recommenderFirstName
//       ? `episodes ${(await forgetPersonInEpisodes(ctx.recommenderFirstName, { sql: <tag over ctx.c>, del })).episodesDeleted}`
//       : "episodes 0" }
export const FORGET_HOOKS: readonly ForgetHook[] = [];
