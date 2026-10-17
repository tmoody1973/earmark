// evals/triage/run.ts — usage: pnpm eval:triage
// Runs the PRODUCTION triage call (triageWindow: same criteria, same experimental_decide) for the shipped model and the
// benchmark model over every labeled window, under 3 option orders (1 fixed, 2 seeded-shuffled). Reports carry ids,
// labels, probabilities and metrics only: never window text.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { experimental_decide } from "ai";
import { getEnv } from "../../agent/lib/env";
import { triageWindow } from "../../agent/lib/pipeline/triage";
import { parseJsonl, type LabeledSnippet } from "../../agent/lib/evals/labels";
import { buildModelReport, renderReportMarkdown, type RunResult, type SnippetRun, type SubsetTag, type TriageReport } from "../../agent/lib/evals/report";

const MIN_LABELS = 30;
const ORDERS = ["fixed", "shuffled", "shuffled"] as const;
const LABELED = "evals/triage/data/labeled.jsonl";
const UNLABELED = "evals/triage/data/unlabeled.jsonl";

// FNV-1a hash -> mulberry32: the same snippet + run index gets the same option order for every model.
function seeded(key: string): () => number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function readRows<T>(path: string): Promise<T[]> {
  try {
    return parseJsonl<T>(await readFile(path, "utf8")).rows;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

const snippets = await readRows<LabeledSnippet>(LABELED);
if (snippets.length < MIN_LABELS) {
  console.error(`Only ${snippets.length} labeled windows in ${LABELED} (need ${MIN_LABELS}). Run \`pnpm label\` first.`);
  process.exit(2);
}

// work_talk: Jev proposed an idea/rec but Tarik labeled neither. room_wide: a "you all should…" rec, flagged in the label notes.
const proposed = new Map((await readRows<{ id: string; triage_kind?: string }>(UNLABELED)).map((r) => [r.id, r.triage_kind]));
function tagsOf(s: LabeledSnippet): SubsetTag[] {
  const tags: SubsetTag[] = [];
  const was = proposed.get(s.id);
  if (s.kind === "neither" && (was === "idea_by_user" || was === "rec_to_user")) tags.push("work_talk");
  if (/room.?wide|you all|y'all/i.test(s.notes)) tags.push("room_wide");
  return tags;
}

const env = getEnv();

async function runModel(model: string) {
  let inputTokens = 0;
  let errors = 0;
  const counting = (async (opts: Parameters<typeof experimental_decide>[0]) => {
    const r = await experimental_decide(opts);
    inputTokens += r.usage.inputTokens ?? 0;
    return r;
  }) as typeof experimental_decide;

  const runs: SnippetRun[] = [];
  for (let i = 0; i < snippets.length; i += 5) {
    const batch = snippets.slice(i, i + 5);
    const done = await Promise.all(batch.map(async (s): Promise<SnippetRun | null> => {
      try {
        const results: RunResult[] = [];
        for (const [run, optionOrder] of ORDERS.entries()) {
          const t = await triageWindow(s.window, { model, optionOrder, random: seeded(`${s.id}:${run}`), decideImpl: counting });
          results.push({ kind: t.kind, kindProbability: t.kindProbability, recType: t.recType, jokingProbability: t.jokingProbability });
        }
        return { id: s.id, label: { kind: s.kind, rec_type: s.rec_type, joking: s.joking }, results, tags: tagsOf(s) };
      } catch (err) {
        errors++;
        console.error(`${model} ${s.id}: ${err instanceof Error ? err.name : "error"}`); // ids + err.name only: never window text
        return null;
      }
    }));
    runs.push(...done.filter((r): r is SnippetRun => r !== null));
  }
  if (errors) console.warn(`${model}: ${errors} snippet(s) errored and were excluded`);
  return buildModelReport(model, runs, inputTokens);
}

const report: TriageReport = { date: new Date().toISOString().slice(0, 10), labeledCount: snippets.length, triageModel: env.TRIAGE_MODEL, models: {} };
for (const m of [env.TRIAGE_MODEL, env.BENCHMARK_MODEL]) report.models[m] = await runModel(m);

await mkdir("evals/triage/reports", { recursive: true });
const json = JSON.stringify(report, null, 2);
await writeFile(`evals/triage/reports/${report.date}.json`, json);
await writeFile("evals/triage/reports/latest.json", json);
await writeFile(`evals/triage/reports/${report.date}.md`, renderReportMarkdown(report));
console.log(renderReportMarkdown(report));
