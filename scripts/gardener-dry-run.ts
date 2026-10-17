// M5-T12: no-writes dry run of the custom-gardener path, against the real database (read-only) and the real model.
//   pnpm tsx --env-file=.env.local scripts/gardener-dry-run.ts
// Prints counts and a boolean only. The draft itself is never printed, logged or stored.
import { draftCustom, loadGardenerData } from "../agent/lib/gardeners/run";

const TASK = "Turn my ready ideas into Intersection pitches.";

async function main() {
  const data = await loadGardenerData(["ideas"]); // select only
  const sourceItems = Object.values(data).reduce((n, rows) => n + (rows?.length ?? 0), 0);
  const text = await draftCustom(TASK, data);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  console.log(`source_items=${sourceItems} output_words=${words} non_empty=${words > 0}`);
}

main().catch((e) => {
  console.error(`gardener dry run failed err=${e instanceof Error ? e.name : "unknown"}`);
  process.exit(1);
});
