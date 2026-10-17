// M5-T12: first real episode preview. Reads the real data (select only), writes the script through the real guard,
// voices it with real Polly, and saves the MP3 to a LOCAL file. No Blob upload, no database write.
//   pnpm tsx --env-file=.env.local scripts/episode-preview.ts <out.mp3>
// Prints stats only; the script text is never printed.
import { writeFile } from "node:fs/promises";
import { gatherEpisodeData } from "../agent/lib/episode/data";
import { checkText } from "../agent/lib/episode/guard";
import { ownerFirstName } from "../agent/lib/env";
import { wordCount, writeEpisodeScript } from "../agent/lib/episode/script";
import { chunkForPolly, synthesize } from "../agent/lib/episode/voice";
import { weekOfSunday } from "../agent/lib/time";
import { generateText } from "ai";

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: episode-preview.ts <out.mp3>");
  const now = new Date();
  const weekOf = weekOfSunday(now);
  const data = await gatherEpisodeData(now);
  const items = Object.values(data).reduce((n, rows) => n + rows.length, 0);
  let attempts = 0;
  const { title, script } = await writeEpisodeScript(data, weekOf, generateText, ownerFirstName(), (a) => { attempts = a.attempt; });
  const words = wordCount(script);
  const postCheckPassed = checkText(script, data, ownerFirstName()).length === 0 && checkText(title, data, ownerFirstName()).length === 0;
  const audio = await synthesize(chunkForPolly(script));
  await writeFile(out, audio);
  console.log(`week_of=${weekOf} items=${items} words=${words} est_minutes=${(words / 150).toFixed(1)} attempts=${attempts} post_check_passed=${postCheckPassed} mp3_bytes=${audio.byteLength} path=${out}`);
}

main().catch((e) => {
  console.error(`episode preview failed err=${e instanceof Error ? e.name : "unknown"}`);
  process.exit(1);
});
