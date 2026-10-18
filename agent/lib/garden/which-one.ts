// "Which one?" (decision 048): which stored candidates the owner sees, and when. Pure: the reads and writes live in
// agent/lib/recs/which-one.ts. Candidates are public catalog data (what a provider returned), never what was said.
import { z } from "zod";
import { describeCandidate, MAX_CANDIDATES, type Candidate } from "../enrich/types";
import { cardArtworkUrl } from "./cards";

export interface StoredCandidate extends Candidate { provider: string }

const Stored = z.object({
  provider: z.string(), canonicalName: z.string().min(1), creator: z.string().nullable(), yearOrAddress: z.string().nullable(),
  detail: z.string().nullish(), imageUrl: z.string().nullable(), links: z.record(z.string(), z.string()),
  mbid: z.string().optional(), releaseGroupId: z.string().optional(), appleMusicId: z.string().optional(),
  lat: z.number().optional(), lng: z.number().optional(),
});

/** match_candidates as stored (jsonb): the well-formed ones, at most MAX_CANDIDATES. */
export function readCandidates(raw: unknown): StoredCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const p = Stored.safeParse(c);
    return p.success ? [p.data as StoredCandidate] : [];
  }).slice(0, MAX_CANDIDATES);
}

/** auto_pick / owner_pick: a candidate named the way Jev read it. */
export const candidateKey = describeCandidate;

// The card's chip and the page's question share one rule: Earmark wasn't sure, kept options, and the owner hasn't answered.
export function asksWhichOne(r: {
  enrichment_status?: string; match_source?: string; owner_none_at?: unknown; has_candidates?: boolean;
}): boolean {
  return r.match_source === "auto" && !r.owner_none_at && r.has_candidates === true
    && (r.enrichment_status === "no_match" || r.enrichment_status === "pending");
}

export interface WhichOneRow {
  canonical_name: string; status: string; enrichment_status: string; match_source: string; owner_none_at: unknown;
  match_candidates: unknown; auto_pick: string | null; candidates_at: Date | string | null; enriched_at: Date | string | null;
}
export interface WhichOneOption {
  index: number; // position in match_candidates: what the pick action sends back
  name: string; creator: string | null; yearOrAddress: string | null; detail: string | null;
  imageUrl: string | null; lat: number | null; lng: number | null;
}
/** ask: "Which one did Ann mean?"; correct: "Not the right one?" under a confident automatic match. */
export interface WhichOneView { mode: "ask" | "correct"; options: WhichOneOption[]; query: string }

const RELEASE_GROUP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const time = (d: Date | string | null) => (d === null ? null : new Date(d).getTime());

// A music candidate has no image of its own until the lane's add-ons run; its Cover Art Archive thumbnail is a plain
// image URL the browser loads (Img falls back to the glyph on a 404). The server fetches nothing for it.
const optionArt = (c: StoredCandidate) => cardArtworkUrl(c.imageUrl, 120)
  ?? (c.releaseGroupId && RELEASE_GROUP.test(c.releaseGroupId) ? `https://coverartarchive.org/release-group/${c.releaseGroupId}/front-250` : null);

export function whichOneView(r: WhichOneRow): WhichOneView | null {
  if (r.status === "dismissed" || r.status === "composted" || r.match_source !== "auto" || r.owner_none_at) return null;
  if (!Array.isArray(r.match_candidates)) return null; // the lane kept nothing (no lookup yet, or nothing found)
  const cands = readCandidates(r.match_candidates);
  const all = cands.map((c, index): WhichOneOption => ({
    index, name: c.canonicalName, creator: c.creator, yearOrAddress: c.yearOrAddress, detail: c.detail ?? null,
    imageUrl: optionArt(c), lat: c.lat ?? null, lng: c.lng ?? null,
  }));
  if (asksWhichOne({ ...r, has_candidates: true })) return { mode: "ask", options: all, query: r.canonical_name };
  if (r.enrichment_status !== "matched") return null;
  // The owner searched after the match (candidates_at moved past enriched_at): keep the disclosure even if few came back.
  const searched = (time(r.candidates_at) ?? 0) > (time(r.enriched_at) ?? 0);
  if (all.length < 2 && !searched) return null;
  return { mode: "correct", options: all.filter((o) => candidateKey(cands[o.index]!) !== r.auto_pick), query: r.canonical_name };
}
