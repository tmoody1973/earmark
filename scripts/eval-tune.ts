// scripts/eval-tune.ts — usage: pnpm eval:tune [report.json]
// Reads a committed triage report (ids, labels, probabilities only) and prints suggested thresholds per model. No model calls.
import { readFile } from "node:fs/promises";
import { pickAcceptThreshold, pickDropThreshold } from "../agent/lib/evals/tune";
import type { TriageReport } from "../agent/lib/evals/report";

const path = process.argv[2] ?? "evals/triage/reports/latest.json";
const report = JSON.parse(await readFile(path, "utf8")) as TriageReport;
for (const m of Object.values(report.models)) {
  const accept = pickAcceptThreshold(m.predictions, { rec: 0.85, idea: 0.75 });
  const drop = pickDropThreshold(m.predictions, accept.threshold);
  console.log(JSON.stringify({
    model: m.model, accuracy: m.accuracy, recPrecision: m.recPrecision, ideaPrecision: m.ideaPrecision,
    workTalkAccuracy: m.subsets.work_talk?.accuracy ?? null, ece: m.ece, brier: m.brier, flipRate: m.flipRate, costUsd: m.costUsd,
    suggestedAcceptAbove: accept.threshold, recPrecisionAbove: accept.recPrecision, recAccepted: accept.recAccepted,
    ideaPrecisionAbove: accept.ideaPrecision, ideaAccepted: accept.ideaAccepted, acceptedShareOfPositives: accept.acceptedShare,
    suggestedDropBelow: drop,
  }, null, 2));
}
