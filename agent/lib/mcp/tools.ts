// MCP tool bodies. Each returns { text }: short, speakable sentences (Alexa+ reads them aloud).
// Privacy: results may carry first names (the product); nothing here logs queries, names or excerpts.
import { db } from "../db";
import { searchEarmarks, type PlaceNear } from "../search/memory-cue";
import { parseWhen } from "../search/when";
import { addRecToPlaylist } from "./playlist-seam";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const PERIOD_DAYS = { week: 7, month: 30, all: 36500 } as const;
const PERIOD_WORDS = { week: "the last week", month: "the last month", all: "all time" } as const;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export async function whatDidTheyRecommend({ person, period }: { person: string; period: keyof typeof PERIOD_DAYS }) {
  const since = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString();
  const name = cap(person.trim());
  const rows = (await db()`
    select r.canonical_name, r.creator, r.type from recommendations r
    join recommenders rc on rc.id = r.recommender_id
    where rc.first_name_key = lower(${person.trim()}) and r.said_at >= ${since} and r.status not in ('dismissed', 'composted', 'overheard')
    order by r.said_at desc limit 10`) as { canonical_name: string; creator: string | null; type: string }[];
  if (!rows.length) return { text: `No recommendations from ${name} in ${PERIOD_WORDS[period]}.` };
  const list = rows.map((r) => `${r.canonical_name}${r.creator ? ` by ${r.creator}` : ""} (${r.type.replace("_", "/")})`).join("; ");
  return { text: `${name} recommended ${rows.length} ${plural(rows.length, "thing", "things")}: ${list}.` };
}

export async function readyIdeas() {
  const rows = (await db()`
    select title, mention_count from idea_clusters where stage in ('ready', 'drafted')
    order by last_mentioned_at desc nulls last limit 5`) as { title: string; mention_count: number }[];
  if (!rows.length) return { text: "No ideas are ready yet." };
  const list = rows.map((r) => `${r.title} (${r.mention_count} ${plural(r.mention_count, "mention", "mentions")})`).join("; ");
  return { text: `${rows.length} ${plural(rows.length, "idea is", "ideas are")} ready: ${list}.` };
}

// searchEarmarks silently ignores an invalid coordinate cue, which would widen the search; refuse it instead.
const validPlace = (p: PlaceNear) => [p.lat, p.lng, p.radiusM].every(Number.isFinite) && p.radiusM > 0;

export async function searchEarmarksTool(input: { who?: string; where?: string | PlaceNear; when?: string; query?: string }) {
  if (typeof input.where === "object" && input.where !== null && !validPlace(input.where)) {
    return { text: "I didn't understand that place. Try a name or address instead." };
  }
  const range = input.when ? parseWhen(input.when) : null;
  if (input.when && !range) return { text: `I didn't understand "${input.when}". Try "in September" or "last week".` };
  // Alexa+ needs < 500 ms; Bee neural search takes ~3 s, so MCP uses store filters only.
  const res = await searchEarmarks({ who: input.who, where: input.where, when: range ?? undefined, query: input.query }, { useNeural: false });
  const items = [
    ...res.recs.slice(0, 5).map((r) => `${r.name}${r.recommender ? ` from ${r.recommender.firstName}` : ""}`),
    ...res.ideas.slice(0, 3).map((i) => `your idea "${i.title}"`),
  ];
  return { text: items.length ? `I found: ${items.join("; ")}.` : "Nothing matched those clues." };
}

export async function addToEarmarkedPlaylist({ item }: { item: string }) {
  const like = `%${item.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const [rec] = (await db()`
    select id, canonical_name from recommendations
    where type in ('album', 'song', 'artist') and canonical_name ilike ${like} and status not in ('dismissed', 'composted', 'overheard')
    order by said_at desc limit 1`) as { id: number; canonical_name: string }[];
  if (!rec) return { text: `I couldn't find a music recommendation called "${item}".` };
  const name = rec.canonical_name;
  switch (await addRecToPlaylist(Number(rec.id))) {
    case "added": return { text: `Added ${name} to your Earmarked playlist.` };
    case "already": return { text: `${name} is already in your Earmarked playlist.` };
    case "no_auth": return { text: "Apple Music needs to be reconnected in the garden first." };
    case "no_match": return { text: `I couldn't find ${name} in Apple Music.` };
    case "not_music": return { text: `${name} isn't a music recommendation.` };
    default: return { text: "Your Earmarked playlist isn't connected yet." };
  }
}

const MAX_OPENING = 300;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10-12" -> "October 12" (week_of arrives as text, so no timezone shift). */
function spokenDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : iso;
}

/** Script body without its title line or Markdown marks, cut at a sentence (else a word) boundary. */
export function spokenOpening(script: string): string {
  const body = script.split("\n").slice(1).join("\n")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/[*_`>~]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ").trim();
  if (body.length <= MAX_OPENING) return body;
  const head = body.slice(0, MAX_OPENING);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= 80) return head.slice(0, sentence + 1);
  return `${head.slice(0, head.lastIndexOf(" ")).trimEnd()}\u2026`;
}

// No audio address here: decision 035 keeps it out of everything except the secret-token feed.
export async function latestEpisode() {
  // week_of is a Postgres date: cast to text or the driver hands back a JS Date.
  const [ep] = (await db()`
    select week_of::text as week_of, left(script_md, 2000) as script from episodes
    where published_at is not null order by week_of desc limit 1`) as { week_of: string | Date; script: string }[];
  if (!ep) return { text: "There's no published episode yet." };
  return { text: `This week's Earmark episode (the week of ${spokenDate(ep.week_of)}) starts: ${spokenOpening(ep.script)}` };
}
