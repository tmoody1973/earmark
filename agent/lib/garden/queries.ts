import { db } from "../db";
import { ownerFirstName } from "../env";
import type { IdeaStage, Rating, RecStatus, RecType } from "../types";
import { cardArtworkUrl, cardLink, cardVariant, clampWhy, type CardVariant } from "./cards";
import { gardenOrder, isBloomed, plantLevel, type PlantLevel } from "./plant";
import { parseTimeline, type MentionRef, type TimelineEntry } from "./timeline";

export interface RecCardData {
  id: number;
  type: RecType;
  variant: CardVariant;
  name: string;
  creator: string | null;
  yearOrAddress: string | null;
  imageUrl: string | null;
  /** The context summary, clamped to 30 words; null when there is none. */
  why: string | null;
  recommender: { id: number; firstName: string } | null;
  saidAt: string;
  status: RecStatus;
  rating: Rating | null;
  lat: number | null;
  lng: number | null;
  link: string | null;
}

export interface PlantView {
  id: number;
  title: string;
  stage: IdeaStage;
  level: PlantLevel;
  bloomed: boolean;
  mentionCount: number;
  lastMentionedAt: string | null;
  pinned: boolean;
  flagged: boolean;
  /** false while every mention is still review-band (decision 004): the plant still grows, drawn lighter. */
  confirmed: boolean;
  /** The newest timeline line by date ("Oct 16: named three guests"), or null. */
  latestLine: string | null;
}

export interface GardenView { plants: PlantView[]; shelf: RecCardData[]; serverTime: string }

export type GardenRecRow = {
  id: number; type: string; canonical_name: string; creator: string | null;
  year_or_address: string | null; image_url: string | null; context_summary: string | null;
  said_at: Date | string; status: string; rating: string | null;
  lat: number | null; lng: number | null; links: unknown;
  recommender_id: number | null; first_name: string | null;
};

export type PlantRow = {
  id: number; title: string; stage: string; mention_count: number;
  last_mentioned_at: Date | string | null; pinned: boolean; flagged: boolean;
  confirmed?: boolean; timeline?: unknown;
};

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export function toRecCard(r: GardenRecRow): RecCardData {
  const firstName = r.first_name?.trim();
  // Read-time guard: the garden's owner is never credited, even if an old row slipped past the write-side check.
  const isOwnerName = !!firstName && firstName.toLowerCase() === ownerFirstName()?.toLowerCase();
  return {
    id: Number(r.id),
    type: r.type as RecType,
    variant: cardVariant(r.type as RecType),
    name: r.canonical_name,
    creator: r.creator,
    yearOrAddress: r.year_or_address,
    imageUrl: cardArtworkUrl(r.image_url, 600),
    why: clampWhy(r.context_summary),
    recommender: r.recommender_id && firstName && !isOwnerName ? { id: Number(r.recommender_id), firstName } : null,
    saidAt: iso(r.said_at)!,
    status: r.status as RecStatus,
    rating: r.rating as Rating | null,
    lat: r.lat,
    lng: r.lng,
    link: cardLink(r.links),
  };
}

export function toPlant(r: PlantRow): PlantView {
  const stage = r.stage as IdeaStage;
  return {
    id: Number(r.id),
    title: r.title,
    stage,
    level: plantLevel(stage) ?? "seed",
    bloomed: isBloomed(stage),
    mentionCount: Number(r.mention_count),
    lastMentionedAt: iso(r.last_mentioned_at),
    pinned: r.pinned,
    flagged: r.flagged,
    confirmed: r.confirmed ?? true,
    latestLine: parseTimeline(r.timeline).at(-1)?.line ?? null,
  };
}

// Explicit column lists on purpose: raw_text and excerpts never reach the shelf through this path.
// Unconfirmed (needs_review) tips stay visible: the card marks them (decision 021).
export async function getShelf(): Promise<RecCardData[]> {
  const recs = (await db()`
    select r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.status, r.rating, r.lat, r.lng, r.links,
      p.id as recommender_id, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.status not in ('dismissed','composted')
    order by r.said_at desc
    limit 60`) as GardenRecRow[];
  return recs.map(toRecCard);
}

// Every idea still growing (dismissed ones live only on their own page), in garden order.
// ponytail: limit 200 is a range guard (the brief plans for 0–60); page the /garden route if a garden outgrows it.
export async function getPlants(): Promise<PlantView[]> {
  const rows = (await db()`
    select c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.pinned, c.timeline,
      (c.flagged_at is not null and (c.last_viewed_at is null or c.flagged_at > c.last_viewed_at)) as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed
    from idea_clusters c
    where c.stage <> 'dismissed' and c.mention_count > 0
    order by c.last_mentioned_at desc nulls last
    limit 200`) as PlantRow[];
  return gardenOrder(rows.map(toPlant));
}

export async function getGardenView(): Promise<GardenView> {
  const plants = await getPlants();
  const shelf = await getShelf();
  return { plants, shelf, serverTime: new Date().toISOString() };
}

export interface IdeaDetail {
  plant: PlantView;
  firstMentionedAt: string | null;
  timeline: TimelineEntry[];
  mentions: MentionRef[];
  draftMd: string | null;
  draftFormat: string | null;
  notionPageId: string | null;
}

// Owner-only page data. Dismissed ideas are returned (the page shows them greyed); dismissed mentions come back
// without their excerpt, so it can never reach the page.
export async function getIdeaDetail(id: number): Promise<IdeaDetail | null> {
  const sql = db();
  const [c] = (await sql`
    select c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.first_mentioned_at, c.pinned, c.timeline,
      c.draft_md, c.draft_format, c.notion_page_id,
      (c.flagged_at is not null and (c.last_viewed_at is null or c.flagged_at > c.last_viewed_at)) as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed
    from idea_clusters c where c.id = ${id}`) as Array<PlantRow & Record<string, unknown>>;
  if (!c) return null;
  const mentions = (await sql`
    select id, spoken_at, source, review_status,
      case when review_status = 'dismissed' then null else excerpt end as excerpt
    from idea_mentions where cluster_id = ${id}
    order by spoken_at asc, id asc`) as Array<Record<string, unknown>>;
  return {
    plant: toPlant(c),
    firstMentionedAt: iso(c.first_mentioned_at as string | null),
    timeline: parseTimeline(c.timeline),
    mentions: mentions.map((m) => ({
      id: Number(m.id),
      spokenAt: iso(m.spoken_at as string)!,
      excerpt: m.excerpt === null ? null : String(m.excerpt),
      source: String(m.source),
      reviewStatus: String(m.review_status),
    })),
    draftMd: (c.draft_md as string | null) ?? null,
    draftFormat: (c.draft_format as string | null) ?? null,
    notionPageId: (c.notion_page_id as string | null) ?? null,
  };
}

// Runs in after() on the idea page: the page is owner-gated, and request APIs are off-limits inside after().
export async function markIdeaViewed(id: number): Promise<void> {
  await db()`update idea_clusters set last_viewed_at = now() where id = ${id}`;
}
