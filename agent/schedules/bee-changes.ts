import { defineSchedule } from "eve/schedules";
import { runBeeChangesSync } from "../lib/sync/bee-changes";

// FR-02 catch-up: the Bee stream is at-most-once, so every 10 minutes ask /v1/changes what moved since the saved cursor.
// Sub-daily cron: needs the Pro team (M2-T2). Handler form (run): no model session; the pipelines call the models.
// Logs ids + error names only (no transcript text).
export default defineSchedule({
  cron: "*/10 * * * *",
  async run() {
    try {
      console.log("[bee-changes] done", await runBeeChangesSync());
    } catch (err) {
      console.error(`[bee-changes] failed; cursor not advanced error=${err instanceof Error ? err.name : "unknown"}`);
      throw err;
    }
  },
});
