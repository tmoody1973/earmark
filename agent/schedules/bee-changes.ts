import { defineSchedule } from "eve/schedules";
import { draftBlooms } from "../lib/ideas/one-pager";
import { runBeeChangesSync } from "../lib/sync/bee-changes";

// FR-02 catch-up: the Bee stream is at-most-once, so every 10 minutes ask /v1/changes what moved since the saved cursor.
// Sub-daily cron: needs the Pro team (M2-T2). Handler form (run): no model session; the pipelines call the models.
// Tail (M2-T7): draft any bloomed cluster still without a one-pager (blooms from this sync, the nightly backfill, or a
// failed/crashed post-bloom draft), whether or not the sync itself succeeded.
// Logs ids + error names only (no transcript text).
export default defineSchedule({
  cron: "*/10 * * * *",
  async run() {
    try {
      console.log("[bee-changes] done", await runBeeChangesSync());
    } catch (err) {
      console.error(`[bee-changes] failed; cursor not advanced error=${err instanceof Error ? err.name : "unknown"}`);
      throw err;
    } finally {
      const drafted = await draftBlooms().catch((err: unknown) => {
        console.error(`[draft] tail failed error=${err instanceof Error ? err.name : "unknown"}`);
        return [];
      });
      if (drafted.length) console.log(`[draft] tail drafted clusters=${drafted.map((r) => r.clusterId).join(",")}`);
    }
  },
});
