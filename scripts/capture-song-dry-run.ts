// Dry run of the song-capture linking chain on real data (M5-T4): NO database writes, no Blob writes.
// Run: node node_modules/tsx/dist/cli.mjs --env-file=.env.local scripts/capture-song-dry-run.ts
// Prints ids, probabilities and booleans only: never names, transcript text, excerpts, titles or model output.
import { createBeeClient, toDate } from "../agent/lib/bee/client";
import { findConversationNear, pickWindowForCapture } from "../agent/lib/capture/link";

const bee = createBeeClient();
const { conversations } = await bee.listConversations({ limit: 20 });
let chosen: { id: number; at: Date; where: { lat: number; lng: number } } | null = null;
for (const s of conversations) {
  const { conversation: c } = await bee.getConversation(s.id);
  const loc = c.primary_location;
  const spoken = (c.transcriptions ?? []).flatMap((t) => t.utterances).map((u) => toDate(u.spoken_at)).filter((d): d is Date => !!d);
  if (!loc || spoken.length < 5) continue;
  chosen = { id: c.id, at: spoken[Math.floor(spoken.length / 2)]!, where: { lat: loc.latitude, lng: loc.longitude } };
  break;
}
if (!chosen) throw new Error("no conversation with a location and dated utterances in the last 20");

const linked = await findConversationNear(bee, chosen.at, chosen.where);
// A well-known song that is (almost certainly) not in the conversation: the picker should correctly say no.
const picked = linked ? await pickWindowForCapture('the song "Bohemian Rhapsody" by Queen', linked.windows) : null;

console.log(JSON.stringify({
  conversationChosen: chosen.id,
  conversationMatched: linked?.conversationId ?? null,
  matchedIsChosen: linked?.conversationId === chosen.id,
  windowCount: linked?.windows.length ?? 0,
  pickedWindowIndex: picked && linked ? linked.windows.indexOf(picked.window) : null,
  pickProbability: picked?.probability ?? null,
}));
