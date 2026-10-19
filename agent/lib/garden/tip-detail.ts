import { db } from "../db";
import { readExtras, type RecExtras } from "../enrich/extras";
import { LINK_MIN } from "../links/criteria";
import type { RecType } from "../types";
import { cardLink } from "./cards";
import { toRecCard, type GardenRecRow, type RecCardData } from "./queries";
import { whichOneView, type WhichOneRow, type WhichOneView } from "./which-one";

// The tip page (/tips/[id], decision 045): owner-only, so unlike every shelf path it reads the excerpt. Public pages
// (/s/, /r/) never call this.

export interface TipLink { label: string; url: string }
export interface TipDetail {
  card: RecCardData;
  /** What was said (<= 25 words, a DB check). Owner-only. */
  excerpt: string;
  /** The whole why line (the card's is cut to 30 words): what "Fix this tip" starts from (decision 049). */
  note: string | null;
  /** The link the owner pasted in "Fix this tip" (links.bandcamp / links.web), what its Link field starts from. */
  ownerLink: string | null;
  links: TipLink[];
  extras: RecExtras;
  /** Spaces Tarik kept it in (space_items 'accepted'). */
  spaces: { id: number; name: string }[];
  /** Ideas it fits (links kind 'fits'), by the idea page's own rule (backlinks.ts). */
  ideas: { id: number; title: string }[];
  /** "Which one?" (decision 048): ask when unsure, or offer a correction under an automatic match; null otherwise. */
  whichOne: WhichOneView | null;
}

const SERVICE: Record<string, string> = {
  apple_music: "Apple Music", apple_podcasts: "Apple Podcasts", podcast_index: "Podcast Index", musicbrainz: "MusicBrainz",
  discogs: "Discogs", openlibrary: "Open Library", wikipedia: "Wikipedia", tmdb: "TMDB", google_maps: "Google Maps", youtube: "YouTube",
  bandcamp: "Bandcamp", // links.web (an owner-pasted page, decision 049) is labelled by its site
};
const VERB: Record<RecType, string> = {
  album: "Listen", song: "Listen", artist: "Listen", podcast: "Listen", book: "Read", film_tv: "Watch", video: "Watch", place: "Map", other: "Open",
};
// Parseable too: an emailed link can keep trailing punctuation ("https://foo.com]"), and host() must never throw.
const https = (v: unknown) =>
  (typeof v === "string" && /^https?:\/\/\S+$/i.test(v) && URL.canParse(v) ? v.replace(/^http:/i, "https:") : null);
const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** The page's link buttons: the card's own link first ("Listen · Apple Music"), then the rest by service, each once. Pure. */
export function tipLinks(type: RecType, links: unknown): TipLink[] {
  if (!links || typeof links !== "object") return [];
  const all = Object.entries(links as Record<string, unknown>).flatMap(([key, v]) =>
    (Array.isArray(v) ? v : [v]).map(https).filter((u): u is string => !!u).map((url) => ({ key, url })));
  const primary = cardLink(links);
  const ordered = [...all.filter((l) => l.url === primary), ...all.filter((l) => l.url !== primary)];
  const seen = new Set<string>();
  return ordered.flatMap(({ key, url }) => {
    if (seen.has(url)) return [];
    seen.add(url);
    const service = SERVICE[key] ?? host(url);
    return [{ label: url === primary && key !== "web" ? `${VERB[type] ?? "Open"} · ${service}` : service, url }];
  });
}

export async function getTipDetail(id: number): Promise<TipDetail | null> {
  const sql = db();
  const [r] = (await sql`
    select r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links, r.about, r.about_url,
      r.excerpt, r.extras, r.enrichment_status, r.match_source, r.owner_none_at, r.match_candidates, r.auto_pick,
      r.candidates_at, r.enriched_at, p.id as recommender_id, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.id = ${id}`) as Array<GardenRecRow & WhichOneRow & { excerpt: string; extras: unknown }>;
  if (!r) return null;
  const spaces = (await sql`
    select s.id, s.name from space_items si join spaces s on s.id = si.space_id
    where si.item_type = 'rec' and si.item_id = ${id} and si.status = 'accepted'
    order by s.name, s.id`) as Array<{ id: number | string; name: string }>;
  const ideas = (await sql`
    select c.id, c.title from links l join idea_clusters c on c.id::text = l.to_id
    where l.from_type = 'rec' and l.from_id = ${String(id)} and l.to_type = 'idea' and l.kind = 'fits'
      and l.status <> 'removed' and (l.status = 'accepted' or l.confidence >= ${LINK_MIN})
      and c.stage <> 'dismissed' and c.mention_count > 0
    order by l.status = 'accepted' desc, l.confidence desc, c.id
    limit 12`) as Array<{ id: number | string; title: string }>;
  const card = toRecCard(r);
  return {
    card,
    excerpt: r.excerpt,
    note: r.context_summary,
    ownerLink: https((r.links as Record<string, unknown> | null)?.bandcamp) ?? https((r.links as Record<string, unknown> | null)?.web),
    links: tipLinks(card.type, r.links),
    extras: readExtras(r.extras),
    spaces: spaces.map((s) => ({ id: Number(s.id), name: s.name })),
    ideas: ideas.map((c) => ({ id: Number(c.id), title: c.title })),
    whichOne: whichOneView(r),
  };
}
