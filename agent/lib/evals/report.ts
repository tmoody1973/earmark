import { accuracy, brier, ece, flipRate, precisionFor, reliabilityTable, type Prediction } from "./metrics";
import type { Label } from "./labels";

export const PRICE_PER_M_INPUT: Record<string, number> = {
  "typesafe-ai/jev-1.13.0": 0.042, // docs/research/triage-models.md §2
  "openai/gpt-6-luna-decisions": 0.1, // §3
};

export const SUBSET_TAGS = ["work_talk", "room_wide"] as const;
export type SubsetTag = (typeof SUBSET_TAGS)[number];

export interface RunResult { kind: string; kindProbability: number; recType: string; jokingProbability: number }
// tags: work_talk = the sampler/Jev proposed an idea or rec but Tarik labeled neither; room_wide = a "you all should…" colleague rec.
export interface SnippetRun {
  id: string;
  label: Pick<Label, "kind" | "rec_type" | "joking">;
  results: RunResult[];
  tags?: SubsetTag[];
}

export interface SubsetReport { n: number; accuracy: number; predicted: Record<string, number> }

export interface ModelReport {
  model: string; n: number; accuracy: number; recPrecision: number | null; ideaPrecision: number | null;
  recTypeAccuracy: number | null; jokingAccuracy: number; flipRate: number; ece: number; brier: number;
  reliability: ReturnType<typeof reliabilityTable>; inputTokens: number; costUsd: number;
  subsets: Record<SubsetTag, SubsetReport | null>;
  // recType / labelRecType: traceable rec-type flips by snippet id (ids and labels only, never window text)
  predictions: Array<Prediction & { id: string; recType: string; labelRecType: string }>;
}

export interface TriageReport { date: string; labeledCount: number; triageModel: string; models: Record<string, ModelReport> }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function subsetReport(runs: SnippetRun[], tag: SubsetTag): SubsetReport | null {
  const tagged = runs.filter((r) => r.tags?.includes(tag));
  if (!tagged.length) return null;
  const preds = tagged.flatMap((r) => r.results.map((x) => ({ label: r.label.kind, predicted: x.kind, confidence: x.kindProbability })));
  const predicted: Record<string, number> = {};
  for (const p of preds) predicted[p.predicted] = (predicted[p.predicted] ?? 0) + 1;
  return { n: tagged.length, accuracy: accuracy(preds), predicted };
}

export function buildModelReport(model: string, runs: SnippetRun[], inputTokens: number): ModelReport {
  const predictions = runs.flatMap((r) =>
    r.results.map((x) => ({ id: r.id, label: r.label.kind, predicted: x.kind, confidence: x.kindProbability,
      recType: x.recType, labelRecType: r.label.rec_type })),
  );
  const recTyped = runs.filter((r) => r.label.rec_type !== "none").flatMap((r) => r.results.map((x) => (x.recType === r.label.rec_type ? 1 : 0)));
  const joking = runs.flatMap((r) => r.results.map((x) => ((x.jokingProbability >= 0.5) === r.label.joking ? 1 : 0)));
  return {
    model, n: runs.length,
    accuracy: accuracy(predictions),
    recPrecision: precisionFor(predictions, "rec_to_user").precision,
    ideaPrecision: precisionFor(predictions, "idea_by_user").precision,
    recTypeAccuracy: recTyped.length ? avg(recTyped) : null,
    jokingAccuracy: avg(joking),
    // results[0] is the fixed order; stability is judged across the shuffled runs only
    flipRate: flipRate(runs.map((r) => r.results.slice(1).map((x) => x.kind))),
    ece: ece(predictions), brier: brier(predictions), reliability: reliabilityTable(predictions),
    inputTokens, costUsd: (inputTokens / 1_000_000) * (PRICE_PER_M_INPUT[model] ?? 0),
    subsets: { work_talk: subsetReport(runs, "work_talk"), room_wide: subsetReport(runs, "room_wide") },
    predictions,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

export function renderReportMarkdown(r: TriageReport): string {
  const models = Object.values(r.models);
  const rows = models.map((m) =>
    `| ${m.model} | ${m.n} | ${pct(m.accuracy)} | ${pct(m.recPrecision)} | ${pct(m.ideaPrecision)} | ${pct(m.recTypeAccuracy)} | ${pct(m.flipRate)} | ${m.ece.toFixed(3)} | ${m.brier.toFixed(3)} | $${m.costUsd.toFixed(4)} |`);
  const subsetRows = models.flatMap((m) => SUBSET_TAGS.map((tag) => {
    const s = m.subsets[tag];
    const label = tag === "work_talk" ? "Work-talk (labeled neither)" : "Room-wide colleague rec";
    return `| ${m.model} | ${label} | ${s ? s.n : 0} | ${s ? pct(s.accuracy) : "n/a"} | ${s ? JSON.stringify(s.predicted) : "n/a"} |`;
  }));
  return [
    `# Triage eval — ${r.date}`,
    "",
    `${r.labeledCount} labeled windows from Tarik's real Bee conversations, each run under 3 option orders (1 fixed, 2 shuffled; flip rate compares the two shuffled). Targets (PRD): rec precision ≥ 85%, idea precision ≥ 75%.`,
    "Candidates were pre-selected partly by Jev, so recall is not measured; precision is.",
    "",
    "| Model | n | Accuracy | Rec precision | Idea precision | Rec-type acc. | Flip rate | ECE | Brier | Cost |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Subsets",
    "",
    "| Model | Subset | n | Accuracy | Predicted kinds (all runs) |",
    "|---|---|---|---|---|",
    ...subsetRows,
    "",
    ...models.flatMap((m) => [
      `## Reliability — ${m.model}`, "", "| Bin | Count | Mean confidence | Accuracy |", "|---|---|---|---|",
      ...m.reliability.map((b) => `| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.count} | ${b.meanConfidence.toFixed(2)} | ${pct(b.accuracy)} |`), "",
    ]),
  ].join("\n");
}
