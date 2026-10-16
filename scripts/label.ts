// Claude proposes a label, Tarik confirms with one key. Enter = accept, s = skip, q = quit, or k= t= j= n= to override.
// Saves after every answer, so quitting and rerunning resumes where you stopped.
// Usage: pnpm label [unlabeled.jsonl] [labeled.jsonl]
import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { generateText, Output } from "ai";
import { getEnv } from "../agent/lib/env";
import { KIND_CRITERIA, REC_TYPE_CRITERIA } from "../agent/lib/pipeline/criteria";
import { LabelSchema, parseOverride, type Label } from "../agent/lib/evals/labels";

const IN = process.argv[2] ?? "evals/triage/data/unlabeled.jsonl";
const OUT = process.argv[3] ?? "evals/triage/data/labeled.jsonl";
type Row = { id: string; window: string };
const readJsonl = async <T>(p: string): Promise<T[]> =>
  existsSync(p) ? (await readFile(p, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

async function propose(window: string): Promise<Label> {
  const { output: label } = await generateText({
    model: getEnv().WRITE_MODEL,
    output: Output.object({ schema: LabelSchema }),
    prompt: [
      "Label this short window of a transcript recorded by the user's wearable. Speakers are all 'Unknown'; the user is one of them.",
      `kind options:\n${JSON.stringify(KIND_CRITERIA, null, 2)}`,
      `rec_type options (use "none" when kind is idea_by_user or neither):\n${JSON.stringify(REC_TYPE_CRITERIA, null, 2)}`,
      "joking: true only if the suggestion is clearly a joke or a hypothetical.",
      "notes: one short sentence explaining the label.",
      `Window:\n${window}`,
    ].join("\n\n"),
  });
  return label;
}

const labeledBefore = await readJsonl<Row>(OUT);
const done = new Set(labeledBefore.map((r) => r.id));
const all = await readJsonl<Row>(IN);
const todo = all.filter((r) => !done.has(r.id));
const total = all.length;
const rl = createInterface({ input, output });
// Lines are queued as they arrive, so input typed (or piped) while a proposal is loading is not lost.
const lines: string[] = [];
let waiting: ((line: string | null) => void) | undefined;
let closed = false;
rl.on("line", (l) => {
  const w = waiting;
  waiting = undefined;
  if (w) w(l);
  else lines.push(l);
});
rl.on("close", () => { closed = true; waiting?.(null); });
const ask = (prompt: string): Promise<string | null> => {
  output.write(prompt);
  const queued = lines.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return closed ? Promise.resolve(null) : new Promise((resolve) => { waiting = resolve; });
};

console.log(bold(`\n${todo.length} windows to label`) + dim(` (${done.size} already labeled, ${total} total). Enter = accept, s = skip, q = quit.`));
// Fetch the next proposal while the current one is being read, so there is no waiting between windows.
const proposals = new Map<string, Promise<Label>>();
const ahead = (i: number) => { const r = todo[i]; if (r && !proposals.has(r.id)) proposals.set(r.id, propose(r.window)); };
ahead(0);
ahead(1);

let savedNow = 0;
for (const [i, row] of todo.entries()) {
  ahead(i + 1);
  let proposal: Label;
  try { proposal = await proposals.get(row.id)!; } catch (err) {
    console.log(`\nCould not get a proposal for ${row.id} (${err instanceof Error ? err.name : "error"}); skipping.`);
    continue;
  }
  const position = total - todo.length + i + 1;
  console.log(`\n${bold(`── ${position} / ${total} ──`)} ${dim(row.id)}`);
  console.log(row.window.split("\n").map((l) => `  ${l}`).join("\n"));
  console.log(`\n${green("proposal:")} ${bold(proposal.kind)}  type=${proposal.rec_type}  joking=${proposal.joking ? "y" : "n"}`);
  console.log(dim(`  ${proposal.notes}`));
  let decision: ReturnType<typeof parseOverride> | undefined;
  while (decision === undefined) {
    const answer = await ask("Enter=accept  s=skip  q=quit  or k= t= j=y|n n=… > ");
    if (answer === null) { decision = "quit"; break; }
    try { decision = parseOverride(answer, proposal); }
    catch (err) { console.log(err instanceof Error ? err.message : String(err)); }
  }
  if (decision === "quit") break;
  if (decision === "skip") continue;
  await appendFile(OUT, JSON.stringify({ id: row.id, window: row.window, ...decision }) + "\n");
  savedNow++;
}
rl.close();
console.log(`\nsaved ${savedNow} this session; labeled total: ${(await readJsonl(OUT)).length}`);
process.exit(0);
