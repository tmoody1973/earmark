import { defineSchedule } from "eve/schedules";
import { proposeIdeaFacts, proposeTasteFacts, writePendingProposals } from "../lib/facts/proposals";

// FR-19, weekly. Mondays 14:00 UTC = 9:00 Central (CDT). Logs counts only (never fact text).
export default defineSchedule({
  cron: "0 14 * * 1",
  async run() {
    const tastes = await proposeTasteFacts();
    const ideas = await proposeIdeaFacts();
    const written = await writePendingProposals();
    console.info("[earmark] fact-proposals", { tastes: tastes.length, ideas, written });
  },
});
