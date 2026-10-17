// Memory-cue search (FR-36): "the place Ann mentioned at dinner in September". One function for the garden's
// /search page and the MCP server (M5-T9). Code turns who / where / when into store filters; Bee neural search adds
// the conversations that *mean* the query, mapped to items through bee_conversation_id.
import { createBeeClient, type BeeClient } from "../bee/client";
import { db } from "../db";
import { toPlant, toRecCard, type GardenRecRow, type PlantRow, type PlantView, type RecCardData } from "../garden/queries";

// ponytail: `where` is place text only for now. Coordinate cues ({lat, lng, radiusM}) wait for the shared
// distanceMeters (agent/lib/geo.ts, M5-T1) to land on main.
export interface MemoryCue {
  who?: string;
  where?: string;
  when?: { since?: Date; until?: Date };
  query?: string;
}
export interface SearchResult {
  recs: RecCardData[];
  ideas: PlantView[];
  /** Conversations Bee neural search returned (0 when it was off or failed). */
  neuralMatches: number;
  /** True when neural search was asked for but Bee did not answer: the results are store matches only. */
  neuralFailed: boolean;
}

const LIMIT = 20;
const NEURAL_TIMEOUT_MS = 6_000;

const likePattern = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export async function searchEarmarks(
  cue: MemoryCue,
  opts: { useNeural?: boolean; bee?: Pick<BeeClient, "neuralSearch"> } = {},
): Promise<SearchResult> {
  const who = cue.who?.trim() || null;
  const whereText = cue.where?.trim().toLowerCase() || null;
  const since = cue.when?.since?.toISOString() ?? null;
  const until = cue.when?.until?.toISOString() ?? null;
  const q = cue.query?.trim() || null;
  const like = q ? likePattern(q) : null;
  const whereLike = whereText ? likePattern(whereText) : null;

  // Optional because it takes about 3 s: the MCP tool turns it off to answer Alexa+ in under 500 ms.
  let neuralIds: number[] = [];
  let whereIds: number[] = [];
  let neuralFailed = false;
  if (q && opts.useNeural !== false) {
    try {
      const bee = opts.bee ?? createBeeClient();
      const res = await bee.neuralSearch(
        q, { since: cue.when?.since?.getTime(), until: cue.when?.until?.getTime(), limit: LIMIT }, AbortSignal.timeout(NEURAL_TIMEOUT_MS),
      );
      neuralIds = res.results.map((r) => r.id);
      if (whereText) whereIds = res.results.filter((r) => r.locations.some((l) => l.toLowerCase().includes(whereText))).map((r) => r.id);
    } catch (err) {
      neuralFailed = true;
      console.error(`[search] neural search failed error=${err instanceof Error ? err.name : "unknown"}`);
    }
  }
  const neuralJson = JSON.stringify(neuralIds);
  const whereJson = JSON.stringify(whereIds);

  // Same columns as the shelf (getShelf): raw_text is searched but never selected.
  const recRows = (await db()`
    select r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links,
      p.id as recommender_id, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.status not in ('dismissed','composted')
      and (${who}::text is null or p.first_name_key = lower(${who}::text))
      and (${since}::timestamptz is null or r.said_at >= ${since}::timestamptz)
      and (${until}::timestamptz is null or r.said_at < ${until}::timestamptz)
      and (${whereLike}::text is null
           or r.year_or_address ilike ${whereLike}
           or r.bee_conversation_id in (select jsonb_array_elements_text(${whereJson}::jsonb)::bigint))
      and (${like}::text is null
           or r.canonical_name ilike ${like} or r.creator ilike ${like}
           or r.context_summary ilike ${like} or r.raw_text ilike ${like}
           or r.bee_conversation_id in (select jsonb_array_elements_text(${neuralJson}::jsonb)::bigint))
    order by r.said_at desc
    limit ${LIMIT}`) as GardenRecRow[];
  const recs = recRows.map(toRecCard);

  // Ideas are the owner's own, so a named recommender rules them out. They have no address: a place cue
  // matches an idea only through a mention in a conversation Bee placed there.
  if (who) return { recs, ideas: [], neuralMatches: neuralIds.length, neuralFailed };
  // Mentions that count (decision 004: review-band ones too); a dismissed mention never matches.
  const ideaRows = (await db()`
    select c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.pinned, c.timeline,
      (c.flagged_at is not null and (c.last_viewed_at is null or c.flagged_at > c.last_viewed_at)) as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed,
      array(select m.spoken_at from idea_mentions m where m.cluster_id = c.id and m.review_status = 'dismissed') as dismissed_at
    from idea_clusters c
    where c.stage <> 'dismissed' and c.mention_count > 0
      and exists (
        select 1 from idea_mentions m
        where m.cluster_id = c.id and m.review_status <> 'dismissed'
          and (${since}::timestamptz is null or m.spoken_at >= ${since}::timestamptz)
          and (${until}::timestamptz is null or m.spoken_at < ${until}::timestamptz)
          and (${whereLike}::text is null
               or m.bee_conversation_id in (select jsonb_array_elements_text(${whereJson}::jsonb)::bigint))
          and (${like}::text is null
               or c.title ilike ${like} or c.summary ilike ${like} or m.excerpt ilike ${like}
               or m.bee_conversation_id in (select jsonb_array_elements_text(${neuralJson}::jsonb)::bigint)))
    order by c.last_mentioned_at desc nulls last
    limit ${LIMIT}`) as PlantRow[];
  return { recs, ideas: ideaRows.map(toPlant), neuralMatches: neuralIds.length, neuralFailed };
}
