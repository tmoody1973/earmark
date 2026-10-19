import { defineSchedule } from "eve/schedules";
import { skipInDemo } from "../lib/demo";
import { proposeIdeaFacts, proposeTasteFacts, writePendingProposals } from "../lib/facts/proposals";

// FR-19, weekly. Mondays 14:00 UTC = 9:00 Central (CDT). Logs counts, ids and error names only (never fact text:
// a BeeApiError message can include Bee's response body). Each step is isolated so one failure doesn't block the rest.
async function step<T>(name: string, fallback: T, fn: () => Promise<T>, failed: string[]): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    failed.push(name);
    console.error("[earmark] fact-proposals step failed", { step: name, error: err instanceof Error ? err.name : "unknown" });
    return fallback;
  }
}

export default defineSchedule({
  cron: "0 14 * * 1",
  async run() {
    if (skipInDemo("fact-proposals")) return; // the judge demo is read-only (decision 053)
    const failed: string[] = [];
    const tastes = await step("tastes", [] as string[], proposeTasteFacts, failed);
    const ideas = await step("ideas", 0, proposeIdeaFacts, failed);
    const written = await step("write", 0, writePendingProposals, failed);
    console.info("[earmark] fact-proposals", { tastes: tastes.length, ideas, written });
    if (failed.length) throw new Error(`fact-proposals: ${failed.length} step(s) failed`); // marks the run failed; no fact text
  },
});
