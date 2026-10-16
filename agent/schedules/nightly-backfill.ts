import { defineSchedule } from "eve/schedules";
import { runBackfill } from "../lib/pipeline/backfill";

// eve 0.80.0 deploys the schedule consumer with Vercel `maxDuration: "max"`
// (node_modules/eve/dist/src/internal/nitro/host/vercel-build-output-config.js); the number behind "max" depends on
// the Vercel plan and is not documented by eve. 240 s stays under the smallest "max" we know of (Hobby, 300 s), and
// runBackfill stops claiming new items at 70% of it. Raise this once the deployed plan's limit is confirmed (M2-T2).
const BUDGET_MS = 240_000;

// FR-02: the Bee stream is at-most-once, so re-read the last 48 h every night. 08:00 UTC = 03:00 Central.
// Handler form (run): no model session is started; the pipeline calls the models itself.
export default defineSchedule({
  cron: "0 8 * * *",
  async run() {
    const result = await runBackfill({ budgetMs: BUDGET_MS });
    console.log("[backfill] done", result);
  },
});
