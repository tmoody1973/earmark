// "Link" on Fix this tip (decision 049): the owner pastes where the thing lives, for what no lookup service has (an
// album only on Bandcamp, a diner's own site). A link SETTLES the tip as the owner's (match_source 'owner', matched): the
// lane never looks it up again and "Which one?" stops asking. By host:
//  - music.apple.com album / song (?i=) / artist: the catalog item by id (apple-music.ts appleMusicById): name, creator,
//    art, Apple id and link, exactly, no model.
//  - youtube.com / youtu.be: YouTube oEmbed (youtube.ts enrichVideo): the thumbnail and links.youtube; the words stay.
//  - anything else: the page's share tags. og:image (absolute https only) is the art; the link is links.bandcamp
//    (*.bandcamp.com) or links.web. Page text never replaces the owner's words, except Bandcamp's "X, by Y" (og:title,
//    else <title>) when the tip has no creator yet.
// New words (Apple, or "X, by Y") are a new item: the old match's provider links, art, Apple id, year, Wikipedia note
// and embedding go, as in a correction (lane.ts saveMatch). The extras always go, so the lane refills them from the new
// links (an Apple preview, a YouTube player).
// The page fetch is the podcast feed's guard (extras.ts getCappedText) plus where DNS sends the name, since a person
// pasted this URL: https to a public host whose every address is public, each redirect re-checked, 5 s, first 1 MB.
// Clearing the link removes links.bandcamp / links.web only (never a provider's link); the tip stays the owner's.
// Logs: the stage, the tip id and err.name only (logEnrichError), never the URL or the page.
import { z } from "zod";
import { db } from "../db";
import { appleAccess, appleMusicById, type AppleAccess } from "../enrich/apple-music";
import { attr, decode, getCappedText, isPublicHttpsUrl, resolvesToPublic, trimText, type LookupAddresses } from "../enrich/extras";
import { getJson, logEnrichError, type EnrichQuery } from "../enrich/types";
import { enrichVideo } from "../enrich/youtube";
import type { RecType } from "../types";
import { PROVIDER_LINK_KEYS, SONG_CAPTURE_STRIPS, SWEEP_SKIPS_STATUSES } from "./lane";

export const TIP_LINK_MAX = 500;
export const PAGE_TIMEOUT_MS = 5_000;
export const PAGE_MAX_BYTES = 1024 * 1024;
/** The links only the owner adds here: clearing the field removes these, and a new link replaces them. */
export const OWNER_LINK_KEYS = ["bandcamp", "web"];

export type LinkKind =
  | { kind: "apple"; type: "album" | "song" | "artist"; id: string; storefront: string }
  | { kind: "youtube" }
  | { kind: "page"; key: "bandcamp" | "web" };

const YOUTUBE = /^(?:(?:www\.|m\.)?youtube\.com|youtu\.be)$/;
const APPLE_KIND: Record<string, "album" | "song" | "artist"> = { album: "album", song: "song", artist: "artist" };

/** What a pasted link is, or null when it may not be stored or fetched: https, at most 500, a public host name. Pure. */
export function classifyLink(url: string): LinkKind | null {
  if (url.length > TIP_LINK_MAX || !isPublicHttpsUrl(url)) return null;
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (host === "music.apple.com") {
    // /{storefront}/{album|song|artist}/{slug?}/{id}; an album link with ?i= is that song
    const [storefront, kind, ...rest] = u.pathname.split("/").filter(Boolean);
    const id = rest.at(-1) ?? "";
    const song = u.searchParams.get("i") ?? "";
    if (/^[a-z]{2}$/.test(storefront ?? "") && APPLE_KIND[kind ?? ""] && /^\d+$/.test(id)) {
      return kind === "album" && /^\d+$/.test(song)
        ? { kind: "apple", type: "song", id: song, storefront: storefront! }
        : { kind: "apple", type: APPLE_KIND[kind!]!, id, storefront: storefront! };
    }
  }
  if (YOUTUBE.test(host)) return { kind: "youtube" };
  return { kind: "page", key: host === "bandcamp.com" || host.endsWith(".bandcamp.com") ? "bandcamp" : "web" };
}

/** Every way in parses with this: trimmed; empty (or null) clears the link. */
export const TipLinkSchema = z.string().trim().max(TIP_LINK_MAX).refine((s) => s === "" || classifyLink(s) !== null, "not a link")
  .transform((s) => s || null).nullable();

const httpsOnly = (v: string) => (/^https:\/\/\S+$/i.test(v) && URL.canParse(v) ? v : null);

/** A page's share tags: og:title (else <title>) and og:image when it is an absolute https URL. Regex, not a parser. Pure. */
export function readShareTags(html: string): { title: string | null; image: string | null } {
  const og: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if ((key === "og:title" || key === "og:image") && !og[key]) og[key] = attr(tag, "content").trim();
  }
  const title = og["og:title"] || decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  return { title: trimText(title, 200), image: og["og:image"] ? httpsOnly(og["og:image"]) : null };
}

/** Bandcamp's og:title shape, "MettaSun, by Jimetta Rose" → name and creator (at the last ", by "). Pure. */
export function splitBy(title: string): { name: string; creator: string } | null {
  const m = /^(.*\S),\s+by\s+(\S.*)$/.exec(title.trim());
  return m ? { name: m[1]!.slice(0, 120), creator: m[2]!.slice(0, 120) } : null;
}

export interface TipLinkDeps { fetchImpl?: typeof fetch; lookup?: LookupAddresses; apple?: AppleAccess | null }
export type TipLinkResult = { status: "saved"; art: boolean } | { status: "cleared" } | { status: "refused"; reason: "private" | "gone" };

interface Now { type: RecType; canonical_name: string; creator: string | null }
interface Found {
  links: Record<string, string>; imageUrl: string | null; name?: string; creator?: string | null; year?: string | null; appleMusicId?: string;
}

async function fromApple(link: Extract<LinkKind, { kind: "apple" }>, url: string, access: AppleAccess | null, fetchImpl: typeof fetch): Promise<Found> {
  const linkOnly = { links: { apple_music: url }, imageUrl: null };
  if (!access) return linkOnly; // not configured: the link alone
  const def = appleMusicById(access, link.id, link.storefront);
  const q: EnrichQuery = { type: link.type, name: "", creator: null, lat: null, lng: null };
  const { url: api, init } = await def.build(q);
  const json = await getJson(api, init, fetchImpl);
  const [hit] = json === null ? [] : def.parse(json, q);
  if (!hit) return linkOnly;
  return { links: { apple_music: hit.links.apple_music ?? url }, imageUrl: hit.imageUrl, name: hit.canonicalName, creator: hit.creator,
    year: hit.yearOrAddress, appleMusicId: hit.appleMusicId };
}

// What the link brings: "private" when its host isn't public (nothing fetched, nothing stored). A service that fails
// (Apple, YouTube, the page) leaves the link alone, with no art: the owner's link is still where the thing lives.
async function find(link: LinkKind, url: string, now: Now, id: number, deps: TipLinkDeps): Promise<Found | "private"> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const allowed = (u: string) => resolvesToPublic(u, deps.lookup);
  if (link.kind === "page" && !(await allowed(url))) return "private";
  try {
    if (link.kind === "apple") return await fromApple(link, url, deps.apple === undefined ? appleAccess() : deps.apple, fetchImpl);
    if (link.kind === "youtube") {
      const m = await enrichVideo({ type: now.type, name: now.canonical_name, creator: now.creator, lat: null, lng: null, url }, "", fetchImpl);
      return { links: { youtube: url }, imageUrl: m.imageUrl };
    }
    const html = await getCappedText(url, fetchImpl, { max: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS, allowed });
    const tags = html === null ? null : readShareTags(html);
    const by = now.creator === null && tags?.title ? splitBy(tags.title) : null;
    return { links: { [link.key]: url }, imageUrl: tags?.image ?? null, ...(by ?? {}) };
  } catch (err) {
    logEnrichError("tip-link", { rec: id }, err);
    return { links: link.kind === "page" ? { [link.key]: url } : { [link.kind === "apple" ? "apple_music" : "youtube"]: url }, imageUrl: null };
  }
}

/**
 * The owner's link for tip `id` (null clears it). gone: a cleared (dismissed, composted) or missing tip, or one whose
 * words changed between the read and the write. private: the host isn't public. Throws on a bad id or link.
 */
export async function applyTipLink(id: number, url: string | null, deps: TipLinkDeps = {}): Promise<TipLinkResult> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError("invalid tip id");
  const link = TipLinkSchema.parse(url);
  const [now] = (await db()`select type, canonical_name, creator from recommendations
    where id = ${id} and status <> all(${SWEEP_SKIPS_STATUSES}::text[])`) as Now[];
  if (!now) return { status: "refused", reason: "gone" };
  if (link === null) {
    const rows = await db()`update recommendations set links = links - ${OWNER_LINK_KEYS}::text[], updated_at = now()
      where id = ${id} and status <> all(${SWEEP_SKIPS_STATUSES}::text[]) returning id`;
    return rows.length > 0 ? { status: "cleared" } : { status: "refused", reason: "gone" };
  }
  const f = await find(classifyLink(link)!, link, now, id, deps);
  if (f === "private") return { status: "refused", reason: "private" };
  const name = f.name ?? now.canonical_name;
  const creator = f.creator === undefined ? now.creator : f.creator;
  const renamed = name !== now.canonical_name || creator !== now.creator;
  const img = f.imageUrl;
  // A capture's own picture (a photo) and Apple id and link (a shared song) stay through new words, as in saveMatch.
  const rows = await db()`
    update recommendations r set
      canonical_name = ${name}, creator = ${creator},
      year_or_address = case when g.renamed then ${f.year ?? null} else coalesce(${f.year ?? null}, r.year_or_address) end,
      image_url = case when g.renamed and r.source <> 'photo' then ${img} else coalesce(${img}, r.image_url) end,
      apple_music_id = case when ${f.appleMusicId ?? null}::text is not null then ${f.appleMusicId ?? null}
        when g.renamed and r.source <> 'song' then null else r.apple_music_id end,
      links = (r.links - ${OWNER_LINK_KEYS}::text[]
        - (case when not g.renamed then '{}' when r.source = 'song' then ${SONG_CAPTURE_STRIPS} else ${PROVIDER_LINK_KEYS} end)::text[])
        || ${JSON.stringify(f.links)}::jsonb,
      match_source = 'owner', owner_pick = null, enrichment_status = 'matched', enriched_at = now(), updated_at = now(),
      review_reason = case when r.review_reason = 'no_match' then null else r.review_reason end,
      art_retry_mbid = null, art_retries = 0,
      embedding = case when g.renamed then null else r.embedding end,
      about = case when g.renamed then null else r.about end, about_url = case when g.renamed then null else r.about_url end,
      about_at = case when g.renamed then null else r.about_at end, about_tries = case when g.renamed then 0 else r.about_tries end,
      extras = null, extras_at = null, extras_tries = 0
    from (select ${renamed}::boolean as renamed) g
    where r.id = ${id} and r.status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and r.canonical_name = ${now.canonical_name} and r.creator is not distinct from ${now.creator}
    returning r.id`;
  return rows.length > 0 ? { status: "saved", art: img !== null } : { status: "refused", reason: "gone" };
}
