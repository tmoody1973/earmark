// Memory-cue search (FR-36): "the place Ann mentioned at dinner in September". One function for the garden's
// /search page and the MCP server (M5-T9). Code turns who / where / when into store filters; Bee neural search adds
// the conversations that *mean* the query, mapped to items through bee_conversation_id.
import { createBeeClient, type BeeClient } from "../bee/client";
import { db } from "../db";
import { distanceMeters } from "../geo";
import { toPlant, toRecCard, type GardenRecRow, type PlantRow, type PlantView, type RecCardData } from "../garden/queries";

/** A place cue as coordinates: tips saved within `radiusM` meters of the point. */
export interface PlaceNear { lat: number; lng: number; radiusM: number }
export interface MemoryCue {
  who?: string;
  /** Place text (address / Bee location) or coordinates. Coordinates match tips only: ideas have no location. */
  where?: string | PlaceNear;
  when?: { since?: Date; until?: Date };
  query?: string;
}
/**
 * What a search returns, in the garden's own card shapes so /search and the MCP server (M5-T9) share them:
 * `recs` are shelf cards (RecCardData, recommender is `{ id, firstName } | null`), `ideas` are idea-bed plants (PlantView).
 * Both newest first, at most 20 each; no raw conversation text or excerpts are ever included.
 */
export interface SearchResult {
  recs: RecCardData[];
  ideas: PlantView[];
  /** Conversations Bee neural search returned (0 when it was off or failed). */
  neuralMatches: number;
  /** True when neural search was asked for but Bee did not answer: the results are store matches only. */
  neuralFailed: boolean;
}

const LIMIT = 20;
const COORD_SCAN_LIMIT = 500; // coordinate cues filter in code, so scan more rows than we return
const MAX_WHO = 40;
const MAX_WHERE = 80;
const MAX_QUERY = 120;
const NEURAL_TIMEOUT_MS = 6_000;

const clamp = (s: string | undefined, max: number) => s?.trim().slice(0, max).trim() || null;
const validPlace = (p: PlaceNear) => [p.lat, p.lng, p.radiusM].every(Number.isFinite) && p.radiusM > 0;
const likePattern = (s: string) => `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export async function searchEarmarks(
  cue: MemoryCue,
  opts: { useNeural?: boolean; bee?: Pick<BeeClient, "neuralSearch"> } = {},
): Promise<SearchResult> {
  const who = clamp(cue.who, MAX_WHO);
  const near = typeof cue.where === "object" && cue.where !== null && validPlace(cue.where) ? cue.where : null;
  const whereText = typeof cue.where === "string" ? clamp(cue.where, MAX_WHERE)?.toLowerCase() ?? null : null;
  const since = cue.when?.since?.toISOString() ?? null;
  const until = cue.when?.until?.toISOString() ?? null;
  const q = clamp(cue.query, MAX_QUERY);
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
  const rowLimit = near ? COORD_SCAN_LIMIT : LIMIT;
  const scanned = (await db()`
    select r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links,
      p.id as recommender_id, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.status not in ('dismissed','composted','overheard')
      and (${who}::text is null or p.first_name_key = lower(${who}::text))
      and (${since}::timestamptz is null or r.said_at >= ${since}::timestamptz)
      and (${until}::timestamptz is null or r.said_at < ${until}::timestamptz)
      and (${whereLike}::text is null
           or r.year_or_address ilike ${whereLike}
           or r.bee_conversation_id in (select jsonb_array_elements_text(${whereJson}::jsonb)::bigint))
      and (${near !== null}::boolean is false or (r.lat is not null and r.lng is not null))
      and (${like}::text is null
           or r.canonical_name ilike ${like} or r.creator ilike ${like}
           or r.context_summary ilike ${like} or r.raw_text ilike ${like}
           or r.bee_conversation_id in (select jsonb_array_elements_text(${neuralJson}::jsonb)::bigint))
    order by r.said_at desc
    limit ${rowLimit}`) as GardenRecRow[];
  const recRows = near
    ? scanned.filter((r) => r.lat != null && r.lng != null && distanceMeters(near, { lat: r.lat, lng: r.lng }) <= near.radiusM).slice(0, LIMIT)
    : scanned;
  const recs = recRows.map(toRecCard);

  // Ideas are the owner's own, so a named recommender rules them out. They have no address: a place-text cue
  // matches an idea only through a mention in a conversation Bee placed there (so only when there is a query for
  // Bee to search: a place-only cue finds tips, not ideas; documented limitation). A coordinate cue skips ideas.
  if (who || near) return { recs, ideas: [], neuralMatches: neuralIds.length, neuralFailed };
  // Mentions that count (decision 004: review-band ones too); a dismissed mention never matches.
  const ideaRows = (await db()`
    select c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.pinned, c.timeline,
      (c.flagged_at is not null and (c.last_viewed_at is null or c.flagged_at > c.last_viewed_at)) as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed,
      array(select m.spoken_at from idea_mentions m where m.cluster_id = c.id and m.review_status = 'dismissed') as dismissed_at
    from idea_clusters c
    where c.stage <> 'dismissed' and c.mention_count > 0 and not idea_is_quiet(c.id) -- heard once: decision 055
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
