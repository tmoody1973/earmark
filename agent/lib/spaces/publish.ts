import { db } from "../db";
import { HIDDEN_TIP_STATUSES, toRecCard, type GardenRecRow, type RecCardData } from "../garden/queries";
import { newShareToken } from "../privacy/tokens";

// Publishing a Space (FR-42, M5-T14): a link-only page at /s/<token>. The page reads live, so nothing here copies item text.

/** 1–40 items on the page (shape-space-page.md). */
export const PUBLIC_TIP_CAP = 40;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type TipRow = GardenRecRow & { consent: boolean };

/**
 * THE public-content rule, in one place: only tips Tarik explicitly kept (space_items.status = 'accepted'), never ideas,
 * never a hidden tip status. Columns are listed on purpose: no excerpt, raw_text or context_summary is selected.
 * The owner's publish page lists recommenders from this same query, so what he approves is what visitors see.
 */
async function acceptedTips(spaceId: number): Promise<TipRow[]> {
  return (await db()`
    select r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links,
      p.id as recommender_id, p.first_name, (p.public_name_consent_at is not null) as consent
    from space_items si join recommendations r on r.id = si.item_id
    left join recommenders p on p.id = r.recommender_id
    where si.space_id = ${spaceId} and si.item_type = 'rec' and si.status = 'accepted'
      and r.status <> all(${[...HIDDEN_TIP_STATUSES]}::text[])
    order by r.said_at desc, r.id desc
    limit ${PUBLIC_TIP_CAP}`) as TipRow[];
}

/** A tip as a stranger sees it: the name only with consent (and never the owner, via credit()), none of the owner's state. */
function toPublicTip(r: TipRow): RecCardData {
  const card = toRecCard({ ...r, first_name: r.consent ? r.first_name : null, context_summary: null });
  // lat/lng null: a place card then shows its designed no-image state, not the owner-only map tile
  return { ...card, why: null, rating: null, status: "new", lat: null, lng: null };
}

export interface PublishedSpace { id: number; name: string; ruleSentence: string; indexable: boolean; tips: RecCardData[]; dates: string[] }

export async function getPublishedSpace(token: string): Promise<PublishedSpace | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [space] = (await db()`
    select id, name, rule_sentence, indexable from spaces where published_token = ${token}`) as
    Array<{ id: number | string; name: string; rule_sentence: string; indexable: boolean }>;
  if (!space) return null;
  const rows = await acceptedTips(Number(space.id));
  return {
    id: Number(space.id), name: space.name, ruleSentence: space.rule_sentence, indexable: space.indexable,
    tips: rows.map(toPublicTip), dates: rows.map((r) => new Date(r.said_at).toISOString()),
  };
}

/** The same token on every re-publish; a new one only the first time (or after an unpublish). Null: no such Space. */
export async function publishSpace(id: number): Promise<string | null> {
  const [row] = (await db()`
    update spaces set published_token = coalesce(published_token, ${newShareToken()}), published_at = coalesce(published_at, now())
    where id = ${id} returning published_token`) as Array<{ published_token: string }>;
  return row?.published_token ?? null;
}

/** Nulls the token: the old link stops working at once. */
export async function unpublishSpace(id: number): Promise<boolean> {
  const rows = await db()`update spaces set published_token = null, published_at = null where id = ${id} returning id`;
  return rows.length > 0;
}

export async function setIndexable(id: number, on: boolean): Promise<boolean> {
  const rows = await db()`update spaces set indexable = ${on} where id = ${id} returning id`;
  return rows.length > 0;
}

/** Records (or clears) a recommender's OK to be named. Only for someone who gave a tip that is public in this Space. */
export async function setNameConsent(spaceId: number, recommenderId: number, on: boolean): Promise<boolean> {
  if (!(await acceptedTips(spaceId)).some((r) => Number(r.recommender_id) === recommenderId)) return false;
  const rows = await db()`
    update recommenders set public_name_consent_at = ${on ? new Date().toISOString() : null}::timestamptz
    where id = ${recommenderId} returning id`;
  return rows.length > 0;
}

export interface PublishState {
  id: number; name: string; token: string | null; indexable: boolean;
  people: Array<{ id: number; firstName: string; consent: boolean; tips: number }>;
}

/** What the owner's publish page shows: the state, and who gave the kept tips (the owner himself excluded). */
export async function getPublishState(id: number): Promise<PublishState | null> {
  const [s] = (await db()`select id, name, published_token, indexable from spaces where id = ${id}`) as
    Array<{ id: number | string; name: string; published_token: string | null; indexable: boolean }>;
  if (!s) return null;
  const people = new Map<number, PublishState["people"][number]>();
  for (const r of await acceptedTips(id)) {
    const who = toRecCard({ ...r, context_summary: null }).recommender; // credit(): the owner is never listed
    if (!who) continue;
    const seen = people.get(who.id);
    people.set(who.id, { id: who.id, firstName: who.firstName, consent: r.consent, tips: (seen?.tips ?? 0) + 1 });
  }
  return { id: Number(s.id), name: s.name, token: s.published_token, indexable: s.indexable, people: [...people.values()] };
}

const fmt = (d: Date, year: boolean) =>
  d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });

/** "Oct 2 – Oct 9, 2026" in Chicago time; one date alone; "" when there are none. */
export function rangeLabel(dates: readonly string[]): string {
  if (dates.length === 0) return "";
  const ms = dates.map((d) => new Date(d).getTime());
  const [a, b] = [new Date(Math.min(...ms)), new Date(Math.max(...ms))];
  const [from, to] = [fmt(a, true), fmt(b, true)];
  if (from === to) return from;
  return `${from.slice(-4) === to.slice(-4) ? fmt(a, false) : from} – ${to}`;
}

/** The absolute public URL, or null while EARMARK_PUBLIC_BASE_URL is unset (the owner page then says so). */
export function spaceUrl(token: string, base = process.env.EARMARK_PUBLIC_BASE_URL?.trim()): string | null {
  return base ? `${base.replace(/\/+$/, "")}/s/${token}` : null;
}
