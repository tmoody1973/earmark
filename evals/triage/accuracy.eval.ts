// Grades the latest committed report against the PRD targets (FR-29), on what production would AUTO-ACCEPT
// (confidence > ACCEPT_ABOVE). A red result is information, not a bug. Under MIN_GATE_N accepted predictions the
// precision is an anecdote: it is reported as "insufficient" and does not pass. Kept precision and coverage are tracked only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { gateStats, MIN_GATE_N } from "../../agent/lib/evals/gate";
import type { TriageReport } from "../../agent/lib/evals/report";

const TARGETS = [
  { cls: "rec_to_user", name: "rec", target: 0.85 },
  { cls: "idea_by_user", name: "idea", target: 0.75 },
] as const;

export default defineEval({
  description: "Latest labeled triage report: auto-accepted items meet the PRD precision targets.",
  tags: ["triage"],
  async test(t) {
    const path = join(process.cwd(), "evals/triage/reports/latest.json");
    if (!existsSync(path)) throw new Error("no triage report found: run pnpm eval:triage --yes first");
    const report = JSON.parse(readFileSync(path, "utf8")) as TriageReport;
    t.check(report.labeledCount, satisfies((n: number) => n >= 30, "at least 30 labeled snippets"));
    const m = await t.require(report.models[report.triageModel], satisfies((x: unknown) => x !== undefined, "triage model in report"));
    for (const { cls, name, target } of TARGETS) {
      const s = gateStats(m.predictions, cls);
      const label = `${name}-precision@accept (n=${s.accepted.n})`;
      if (s.accepted.sufficient) t.score(s.accepted.precision ?? 0).label(label).gate(target);
      else t.check(s.accepted.n, satisfies((n: number) => n >= MIN_GATE_N, `${label}: insufficient, need n>=${MIN_GATE_N}`));
      t.score(s.kept.precision ?? 0).label(`${name}-precision@kept (n=${s.kept.n})`).soft();
      const { labeled, kept, accepted } = s.coverage;
      t.score(labeled ? kept / labeled : 0).label(`${name}-labeled-kept (${kept}/${labeled})`).soft();
      t.score(labeled ? accepted / labeled : 0).label(`${name}-labeled-accepted (${accepted}/${labeled})`).soft();
    }
    t.score(1 - m.flipRate).label("order-stability").atLeast(0.9);
  },
});
