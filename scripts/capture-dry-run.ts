// Dry run of the photo-capture chain on real data (M5-T3): no database writes, no Blob writes.
// Run: node node_modules/tsx/dist/cli.mjs --env-file=.env.local scripts/capture-dry-run.ts
// Prints ids, probabilities and booleans only: never names, transcript text, excerpts or model output.
import { createBeeClient, toDate } from "../agent/lib/bee/client";
import { classifyPhoto } from "../agent/lib/capture/classify-photo";
import { attributeFromWindow, findConversationNear, pickWindowForCapture } from "../agent/lib/capture/link";

const COVER = "https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg";
const PORTRAIT = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Albert_Einstein_Head.jpg/330px-Albert_Einstein_Head.jpg";

async function image(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "earmark-dry-run/1.0 (personal project)" } });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

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

const cover = await image(COVER);
const cls = await classifyPhoto(cover, "image/jpeg");
const linked = await findConversationNear(bee, chosen.at, chosen.where);
const picked = linked ? await pickWindowForCapture('"Fantastic Mr. Fox" by Roald Dahl', linked.windows) : null;
// The cover is not in the conversation, so the picker should (correctly) say no. Attribution is exercised on the
// nearest window anyway so the end of the chain is checked on real text.
const target = picked?.window ?? linked?.windows[0] ?? null;
const who = target && linked ? await attributeFromWindow(target, linked.summary) : null;

console.log(JSON.stringify({
  conversationChosen: chosen.id,
  conversationMatched: linked?.conversationId ?? null,
  matchedIsChosen: linked?.conversationId === chosen.id,
  windowCount: linked?.windows.length ?? 0,
  pickedWindowIndex: picked && linked ? linked.windows.indexOf(picked.window) : null,
  pickProbability: picked?.probability ?? null,
  attributedWindow: picked ? "picked" : target ? "nearest (forced)" : "none",
  classify: { itemProbability: cls.itemProbability, isBook: cls.recType === "book", recTypeProbability: cls.recTypeProbability, personProbability: cls.personProbability },
  recommenderSource: who?.source ?? null,
  firstNameFound: who ? who.firstName !== null : null,
}));

const portrait = await classifyPhoto(await image(PORTRAIT), "image/jpeg");
console.log(JSON.stringify({ portraitPersonProbability: portrait.personProbability }));
