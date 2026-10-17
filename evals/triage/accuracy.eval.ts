// Grades the latest committed report against the PRD targets (FR-29). A red result is information for M2-T10, not a bug.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import type { TriageReport } from "../../agent/lib/evals/report";

export default defineEval({
  description: "Latest labeled triage report meets the PRD precision targets.",
  tags: ["triage"],
  async test(t) {
    const report = JSON.parse(readFileSync(join(process.cwd(), "evals/triage/reports/latest.json"), "utf8")) as TriageReport;
    t.check(report.labeledCount, satisfies((n: number) => n >= 30, "at least 30 labeled snippets"));
    const m = await t.require(report.models[report.triageModel], satisfies((x: unknown) => x !== undefined, "triage model in report"));
    t.score(m.recPrecision ?? 0).label("rec-precision").gate(0.85);
    t.score(m.ideaPrecision ?? 0).label("idea-precision").gate(0.75);
    t.score(1 - m.flipRate).label("order-stability").atLeast(0.9);
  },
});
