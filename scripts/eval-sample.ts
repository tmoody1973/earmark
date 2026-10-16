// Writes evals/triage/data/unlabeled.jsonl from Tarik's real conversations (read-only Bee calls).
// PRIVACY: the windows are real speech. They go ONLY to that git-ignored folder on this Mac; logs print ids and counts.
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../agent/lib/db";
import { createBeeClient } from "../agent/lib/bee/client";
import { pickSample, type Candidate } from "../agent/lib/evals/sample";
import { splitDeliberate } from "../agent/lib/pipeline/deliberate";
import { mapLimit } from "../agent/lib/pipeline/map-limit";
import { utterancesOf } from "../agent/lib/pipeline/process-conversation";
import { triageWindow } from "../agent/lib/pipeline/triage";
import { toWindows } from "../agent/lib/pipeline/windows";

const TARGET_POSITIVE = 30;
const TARGET_NEGATIVE = 20;
const MAX_PER_CONVERSATION = 4;
// Stop reading conversations once there is enough to choose from.
const ENOUGH_POSITIVE = TARGET_POSITIVE * 2;
const ENOUGH_NEGATIVE = TARGET_NEGATIVE * 4;
const MAX_NEGATIVE_PER_CONVERSATION = 8;
const OUT_DIR = "evals/triage/data";

const bee = createBeeClient();
const rows = await db()`select bee_conversation_id from processed_conversations order by bee_conversation_id desc limit 300`;
const ids = rows.map((r) => Number(r.bee_conversation_id));

const candidates: Candidate[] = [];
const count = (pred: (c: Candidate) => boolean) => candidates.filter(pred).length;
let scanned = 0;
for (const convId of ids) {
  if (count((c) => c.kind !== "neither") >= ENOUGH_POSITIVE && count((c) => c.kind === "neither") >= ENOUGH_NEGATIVE) break;
  const { conversation } = await bee.getConversation(convId);
  if (conversation.state !== "COMPLETED") continue;
  scanned++;
  // The pipeline's own ambient path: utterances sorted by spoken_at, "Earmark that" lines removed, then 4-utterance windows.
  const { rest } = splitDeliberate(utterancesOf(conversation));
  const windows = toWindows(rest, { conversationId: convId, conversationUuid: null });
  let negatives = 0;
  const results = await mapLimit(windows, 4, async (w, i) => {
    try {
      return { id: `${convId}-${i}`, window: w.text, kind: (await triageWindow(w.text)).kind };
    } catch (err) {
      console.error(`[eval-sample] triage failed conversation=${convId} window=${i} error=${err instanceof Error ? err.name : "unknown"}`);
      return null;
    }
  });
  for (const r of results) {
    if (!r) continue;
    if (r.kind === "neither" && negatives++ >= MAX_NEGATIVE_PER_CONVERSATION) continue;
    candidates.push({ ...r, conv: convId });
  }
  console.log(`[eval-sample] conversation=${convId} windows=${windows.length} candidates=${candidates.length}`);
}

// ponytail: candidates are chosen partly by Jev, so recall is biased upward; precision (the PRD target) is not.
const { positives, negatives } = pickSample(candidates, { positives: TARGET_POSITIVE, negatives: TARGET_NEGATIVE, maxPerConversation: MAX_PER_CONVERSATION });
const bucket = (list: Candidate[], b: string) => list.map(({ id, window, kind }) => ({ id, window, triage_kind: kind, bucket: b }));
const out = [...bucket(positives, "positive"), ...bucket(negatives, "negative")];
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/unlabeled.jsonl`, out.map((r) => JSON.stringify(r)).join("\n") + "\n");

const tally = (list: Candidate[]) => Object.entries(list.reduce<Record<string, number>>((m, c) => ({ ...m, [c.kind]: (m[c.kind] ?? 0) + 1 }), {}));
console.log(`scanned ${scanned} conversations`);
console.log(`wrote ${positives.length} likely-positive ${JSON.stringify(tally(positives))} and ${negatives.length} likely-negative ${JSON.stringify(tally(negatives))} windows`);
if (positives.length < TARGET_POSITIVE * (2 / 3)) console.log(`WARNING: only ${positives.length} likely positives (target >= 20).`);
