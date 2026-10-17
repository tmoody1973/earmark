import type { ForgetHook } from "./forget";

// Forgetters owned by other lanes, run by `pnpm forget --yes` after the Postgres commit and the Bee/Notion/Blob deletes.
// Lane C (M5, forget-m5.ts) adds its entries here, e.g.
//   { name: "episodes", run: async (ctx) => ctx.recommenderFirstName
//       ? `episodes ${(await forgetPersonInEpisodes(ctx.recommenderFirstName)).episodesDeleted}` : "episodes 0" }
export const FORGET_HOOKS: readonly ForgetHook[] = [];
