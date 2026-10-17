import { neon } from "@neondatabase/serverless";
import { formatTimelineDate, NOTE_FIRST } from "../agent/lib/ideas/timeline-format";

// Seeds SAMPLE ideas at every stage (compost, sprouting unconfirmed, bloomed without draft, drafted, used, dismissed)
// on the Neon `test` branch, for design screenshots. Never production: it only ever reads TEST_DATABASE_URL.
// Re-runnable: it replaces its own rows (marked summary = 'sample-ideas'). Titles, excerpts and drafts are invented.
// Timelines are stored out of date order on purpose: the page must sort them.
// Run: pnpm tsx --env-file=.env.local scripts/seed-sample-ideas.ts
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set");
const sql = neon(url);

type Mention = { at: string; note: string; excerpt: string; status?: "accepted" | "needs_review" | "dismissed"; source?: string };
type Sample = { title: string; stage: string; mentions: Mention[]; draft?: { md: string; format: string } };

const DRAFT = `Mentioned 3 times: Oct 2 · Oct 9 · Oct 14

# Record Store Saturdays

## The segment
A weekly five-minute visit to one independent record store, told by the person behind the counter. **Sample draft**: invented for the design screenshots.

## Why it works
- Every store has a story listeners have walked past.
- It gives local musicians a reason to call in.
- It fills the Saturday morning slot without a guest booking.

## Rundown
1. Cold open: the sound of the shop.
2. Two minutes with the owner.
3. One record they would put in a stranger's hands.

## Open questions
- Which stores say yes first?
- Recorded on site, or by phone?`;

const SAMPLES: Sample[] = [
  { title: "A field-recording walk along the river", stage: "compost", mentions: [
    { at: "2026-10-15T22:10:00Z", note: "first heard", excerpt: "what if we just recorded the river walk at dawn, no narration, only the city waking up" },
  ] },
  { title: "Listener voicemail wall", stage: "sprouting", mentions: [
    { at: "2026-10-12T14:00:00Z", note: "added playing them back on Fridays", excerpt: "and then we play the best ones back on Friday afternoons", status: "needs_review" },
    { at: "2026-10-04T16:30:00Z", note: "first heard", excerpt: "a wall of listener voicemails, just people telling us what song got them through the week", status: "needs_review" },
  ] },
  { title: "Newsletter issue on the station's first broadcast", stage: "ready", mentions: [
    { at: "2026-10-16T13:00:00Z", note: "found the original transmitter log", excerpt: "turns out the archive still has the original transmitter log from that first night", source: "voice" },
    { at: "2026-10-01T15:00:00Z", note: "first heard", excerpt: "someone should write up the story of the very first broadcast for the newsletter" },
    { at: "2026-10-08T18:20:00Z", note: "named two former hosts to interview", excerpt: "we could ask the two hosts from the eighties what they remember about it" },
  ] },
  { title: "Record Store Saturdays", stage: "drafted", draft: { md: DRAFT, format: "radio_segment" }, mentions: [
    { at: "2026-10-14T17:45:00Z", note: "suggested a record pick to close each visit", excerpt: "end every visit with the one record the owner would hand a stranger" },
    { at: "2026-10-02T15:10:00Z", note: "first heard", excerpt: "a weekly segment where we visit one record store and let the owner tell the story" },
    { at: "2026-10-09T20:30:00Z", note: "added recording the sound of the shop", excerpt: "open with just the sound of the shop, the bins, the bell on the door", status: "needs_review" },
  ] },
  { title: "A product brief for shared playlists", stage: "used", draft: { md: "Mentioned 3 times: Sep 20 · Sep 28 · Oct 5\n\n# Shared playlists\n\n## Problem\nSample draft, invented for the design screenshots.", format: "product_brief" }, mentions: [
    { at: "2026-09-20T15:00:00Z", note: "first heard", excerpt: "shared playlists where every song says who added it and why" },
    { at: "2026-09-28T15:00:00Z", note: "added a weekly digest", excerpt: "a little weekly digest of what everyone added" },
    { at: "2026-10-05T15:00:00Z", note: "chose to start with one team", excerpt: "start with just our team and see if anyone keeps using it" },
  ] },
  { title: "A podcast about parking lots", stage: "dismissed", mentions: [
    { at: "2026-10-03T15:00:00Z", note: "first heard", excerpt: "a whole podcast about parking lots, honestly" },
    { at: "2026-10-06T15:00:00Z", note: "joked about a second season", excerpt: "season two is the parking garages", status: "dismissed" },
  ] },
];

await sql`delete from idea_clusters where summary = 'sample-ideas'`;
for (const s of SAMPLES) {
  const times = s.mentions.filter((m) => m.status !== "dismissed").map((m) => m.at).sort();
  // Lines are built the way the writer builds them: the date by code, and the earliest mention is always "first heard".
  const earliest = [...s.mentions].sort((a, b) => a.at.localeCompare(b.at))[0]!;
  const [c] = await sql`insert into idea_clusters
    (title, summary, timeline, stage, mention_count, first_mentioned_at, last_mentioned_at, draft_md, draft_format)
    values (${s.title}, 'sample-ideas', '[]'::jsonb, ${s.stage},
      ${s.mentions.filter((m) => m.status !== "dismissed").length}, ${times[0]}, ${times.at(-1)},
      ${s.draft?.md ?? null}, ${s.draft?.format ?? null})
    returning id`;
  // each line names its mention (mention_id, M4-T6), as the save path writes it
  const timeline = [];
  for (const m of s.mentions) {
    const [row] = await sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
      values (${c!.id}, ${m.excerpt}, ${m.at}, 0.9, ${m.status ?? "accepted"}, ${m.source ?? "ambient"}) returning id`;
    timeline.push({
      date: new Date(m.at).toISOString(),
      line: `${formatTimelineDate(new Date(m.at))}: ${m === earliest ? NOTE_FIRST : m.note}`,
      mention_id: Number(row!.id),
    });
  }
  await sql`update idea_clusters set timeline = ${JSON.stringify(timeline)}::jsonb where id = ${c!.id}`;
  console.log(`${s.stage.padEnd(9)} /ideas/${c!.id}  ${s.title}`);
}
console.log(`seeded ${SAMPLES.length} sample ideas on the test branch`);
