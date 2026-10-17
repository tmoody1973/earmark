import { defineSchedule } from "eve/schedules";
import { runDueGardeners } from "../lib/gardeners/run";

// Hourly; each gardener's own schedule decides whether it is due (once per period, tracked by last_run_at).
// Logs counts only: never gardener names, tasks or model output.
export default defineSchedule({
  cron: "5 * * * *",
  async run() {
    console.info("[gardeners] tick", await runDueGardeners(new Date()));
  },
});
