import { db } from "../db";
import { ownerFirstName } from "../env";
import type { IdeaStage, Rating, RecStatus, RecType } from "../types";
import { cardArtworkUrl, cardLink, cardVariant, clampWhy, type CardVariant } from "./cards";
import { isBloomed, plantLevel, type PlantLevel } from "./plant";

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

export async function getGardenView(): Promise<GardenView> {
  const plants = (await db()`
    select id, title, stage, mention_count, last_mentioned_at, pinned,
      (flagged_at is not null and (last_viewed_at is null or flagged_at > last_viewed_at)) as flagged
    from idea_clusters
    where stage <> 'dismissed' and mention_count > 0
    order by pinned desc, last_mentioned_at desc nulls last
    limit 60`) as PlantRow[];
  const shelf = await getShelf();
  return { plants: plants.map(toPlant), shelf, serverTime: new Date().toISOString() };
}
