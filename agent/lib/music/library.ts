// The "Earmarked" playlist (M3-T6, FR-15, decision 065). The owner signs in once on /music (Apple's MusicKit JS); his
// Music User Token is kept encrypted in music_auth (one row, id 1). Each rec-lane pass adds visible, matched song and
// album tips to a playlist named "Earmarked" in his library, once each (added_to_playlist_at). When Apple refuses the
// token (401/403) the row is marked revoked: nothing calls Apple again until he reconnects on /music.
// Apple Music API: GET/POST /v1/me/library/playlists, POST /v1/me/library/playlists/{id}/tracks ({data:[{id,type:"songs"}]}),
// GET /v1/catalog/{sf}/albums/{id}?include=tracks, GET /v1/catalog/{sf}/artists/{id}/view/top-songs.
// Logs carry ids and err.name only, never a token.
import { db } from "../db";
import { APPLE_BASE } from "../enrich/apple-music";
import { logEnrichError, PROVIDER_TIMEOUT_MS, ProviderHttpError } from "../enrich/types";
import { HIDDEN_TIP_STATUSES } from "../recs/status";
import type { RecType } from "../types";
import { decryptToken, encryptToken } from "./crypto";
import { appleMusicConfig, getDeveloperToken } from "./developer-token";

export const PLAYLIST_NAME = "Earmarked";
/** music_auth.user_token_enc once Apple refused the token: the /music page asks to reconnect. */
export const REVOKED = "revoked";
/** Added on their own by the lane. An artist's top song only when the owner asks (MCP/Alexa). */
export const PLAYLIST_TYPES: readonly RecType[] = ["song", "album"];
const MUSIC_TYPES: readonly RecType[] = ["song", "album", "artist"];
export const MAX_PLAYLIST_ADDS_PER_RUN = 5;
export const MAX_PLAYLIST_TRIES = 3; // failures (not 401/403, not 503/429) per tip, kept in extras.playlistTries
const HOST = "api.music.apple.com";

export class MusicAuthError extends Error { override name = "MusicAuthError"; }
export interface AppleCtx { devToken: string; userToken: string; storefront: string; fetchImpl?: typeof fetch }
export type MusicState = "not_connected" | "no_auth" | "connected";
export type PlaylistResult = "added" | "no_auth" | "not_music" | "already" | "no_match" | "not_connected";
type Env = Record<string, string | undefined>;
interface Opts { env?: Env; fetchImpl?: typeof fetch }

/** One Apple Music request with both tokens. 401/403 → MusicAuthError; any other failure → ProviderHttpError; 204 → null. */
export async function appleUserFetch(path: string, init: RequestInit, ctx: AppleCtx): Promise<unknown> {
  const res = await (ctx.fetchImpl ?? fetch)(`${APPLE_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${ctx.devToken}`, "Music-User-Token": ctx.userToken, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) throw new MusicAuthError(`Apple Music refused the sign-in (${res.status})`);
  if (!res.ok) throw new ProviderHttpError(HOST, res.status);
  return res.status === 204 ? null : res.json().catch(() => null);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
export const parseAlbumFirstSongId = (json: unknown): string | null => {
  const first = ((json as any)?.data?.[0]?.relationships?.tracks?.data ?? []).find((t: any) => t?.type === "songs");
  return first?.id ? String(first.id) : null;
};
export const parseTopSongId = (json: unknown): string | null => {
  const first = (json as any)?.data?.[0];
  return first?.id ? String(first.id) : null;
};

/** The catalog songs a tip adds: a song itself; an album its first song (one track per tip); an artist its top song. */
export async function songIdsForRec(rec: { type: RecType; apple_music_id: string | null }, ctx: AppleCtx): Promise<string[]> {
  const id = rec.apple_music_id;
  if (!id || !/^\d{1,20}$/.test(id)) return [];
  if (rec.type === "song") return [id];
  const sf = encodeURIComponent(ctx.storefront);
  const found = rec.type === "album" ? parseAlbumFirstSongId(await appleUserFetch(`/catalog/${sf}/albums/${id}?include=tracks`, {}, ctx))
    : rec.type === "artist" ? parseTopSongId(await appleUserFetch(`/catalog/${sf}/artists/${id}/view/top-songs?limit=1`, {}, ctx))
    : null;
  return found ? [found] : [];
}

/** The owner's "Earmarked" playlist: found by name (every page), else created once. */
export async function ensureEarmarkedPlaylist(ctx: AppleCtx): Promise<string> {
  let path: string | null = "/me/library/playlists?limit=100";
  for (let pages = 0; path && pages < 20; pages++) {
    const page = (await appleUserFetch(path, {}, ctx)) as any;
    const hit = (page?.data ?? []).find((p: any) => p?.attributes?.name === PLAYLIST_NAME);
    if (hit?.id) return String(hit.id);
    path = typeof page?.next === "string" ? page.next.replace(/^\/v1/, "") : null;
  }
  const created = (await appleUserFetch("/me/library/playlists", {
    method: "POST",
    body: JSON.stringify({ attributes: { name: PLAYLIST_NAME, description: "Music people recommended to me, kept by Earmark." } }),
  }, ctx)) as any;
  const id = created?.data?.[0]?.id;
  if (!id) throw new ProviderHttpError(HOST, 502);
  return String(id);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Auth = { state: "not_connected" | "no_auth" | "not_configured" } | { state: "connected"; ctx: AppleCtx; playlistId: string | null };

async function loadAuth(env: Env, fetchImpl?: typeof fetch): Promise<Auth> {
  const [row] = (await db()`select user_token_enc, playlist_id from music_auth where id = 1`) as { user_token_enc: string; playlist_id: string | null }[];
  if (!row) return { state: "not_connected" };
  if (row.user_token_enc === REVOKED) return { state: "no_auth" };
  const cfg = appleMusicConfig(env);
  const key = env.MUSIC_TOKEN_KEY?.trim();
  if (!cfg || !key) return { state: "not_configured" };
  const ctx = { devToken: await getDeveloperToken(cfg), userToken: decryptToken(row.user_token_enc, key), storefront: cfg.storefront, fetchImpl };
  return { state: "connected", ctx, playlistId: row.playlist_id };
}

/** For the /music page: no decryption, no Apple call. */
export async function musicState(): Promise<MusicState> {
  const [row] = (await db()`select user_token_enc from music_auth where id = 1`) as { user_token_enc: string }[];
  return !row ? "not_connected" : row.user_token_enc === REVOKED ? "no_auth" : "connected";
}

/**
 * The owner just signed in on /music. The token is checked first (finding or creating the playlist is its first use),
 * so a token Apple refuses is never stored: MusicAuthError. Reconnecting replaces the token and clears "revoked".
 */
export async function saveMusicUserToken(userToken: string, { env = process.env, fetchImpl }: Opts = {}): Promise<void> {
  const cfg = appleMusicConfig(env);
  const key = env.MUSIC_TOKEN_KEY?.trim();
  if (!cfg || !key) throw new Error("Apple Music is not set up (APPLE_* secrets and MUSIC_TOKEN_KEY)");
  const playlistId = await ensureEarmarkedPlaylist({ devToken: await getDeveloperToken(cfg), userToken, storefront: cfg.storefront, fetchImpl });
  await db()`insert into music_auth (id, user_token_enc, playlist_id, updated_at) values (1, ${encryptToken(userToken, key)}, ${playlistId}, now())
    on conflict (id) do update set user_token_enc = excluded.user_token_enc, playlist_id = excluded.playlist_id, updated_at = now()`;
}

const markRevoked = () => db()`update music_auth set user_token_enc = ${REVOKED}, updated_at = now() where id = 1`;

async function playlistFor(auth: Extract<Auth, { state: "connected" }>): Promise<string> {
  if (auth.playlistId) return auth.playlistId;
  const id = await ensureEarmarkedPlaylist(auth.ctx);
  await db()`update music_auth set playlist_id = ${id} where id = 1`;
  auth.playlistId = id;
  return id;
}

interface MusicRec { id: number | string; type: RecType; apple_music_id: string | null }

// Claimed before Apple is asked (added_to_playlist_at set only while still null), so a tip is never added twice; a
// failure gives the claim back. Apple has no "remove from a library playlist", which is why the claim comes first.
async function addOne(rec: MusicRec, auth: Extract<Auth, { state: "connected" }>): Promise<"added" | "already" | "no_match"> {
  const id = Number(rec.id);
  const claimed = await db()`update recommendations set added_to_playlist_at = now() where id = ${id} and added_to_playlist_at is null returning id`;
  if (claimed.length === 0) return "already";
  try {
    const songs = await songIdsForRec(rec, auth.ctx);
    if (songs.length === 0) {
      await giveBack(id, true);
      return "no_match";
    }
    await appleUserFetch(`/me/library/playlists/${encodeURIComponent(await playlistFor(auth))}/tracks`, {
      method: "POST", body: JSON.stringify({ data: songs.map((s) => ({ id: s, type: "songs" })) }),
    }, auth.ctx);
    return "added";
  } catch (err) {
    const counts = !(err instanceof MusicAuthError) && !isBusy(err) && !(err instanceof ProviderHttpError && err.status === 404);
    await giveBack(id, counts);
    if (err instanceof MusicAuthError) await markRevoked();
    // The playlist is gone (deleted in the Music app): forget it, the next run finds or creates it again.
    if (err instanceof ProviderHttpError && err.status === 404) await db()`update music_auth set playlist_id = null where id = 1`;
    throw err;
  }
}

async function giveBack(id: number, countTry: boolean): Promise<void> {
  if (!countTry) {
    await db()`update recommendations set added_to_playlist_at = null where id = ${id}`;
    return;
  }
  await db()`update recommendations set added_to_playlist_at = null,
      extras = coalesce(extras, '{}'::jsonb) || jsonb_build_object('playlistTries', coalesce((extras->>'playlistTries')::int, 0) + 1)
    where id = ${id}`;
}

const isBusy = (err: unknown) => err instanceof ProviderHttpError && (err.status === 503 || err.status === 429);

/**
 * The rec lane's playlist step. Visible tips only (never cleared, overheard or a maybe), newest first, at most
 * MAX_PLAYLIST_ADDS_PER_RUN. A song capture (Shazam, source 'song') carries Apple's own id, so it goes in even when the
 * catalogs didn't match it. Revoked or not set up: no Apple call at all.
 */
export async function addTipsToPlaylist(opts: Opts & { onlyIds?: readonly number[] | null; overBudget?: () => boolean } = {}):
  Promise<{ added: number; state: MusicState | "not_configured" }> {
  const auth = await loadAuth(opts.env ?? process.env, opts.fetchImpl);
  if (auth.state !== "connected") return { added: 0, state: auth.state };
  const onlyIds = opts.onlyIds ?? null;
  const due = (await db()`
    select id, type, apple_music_id from recommendations
    where added_to_playlist_at is null and apple_music_id is not null and type = any(${PLAYLIST_TYPES}::text[])
      and (enrichment_status = 'matched' or source = 'song') and status <> all(${HIDDEN_TIP_STATUSES}::text[])
      and coalesce((extras->>'playlistTries')::int, 0) < ${MAX_PLAYLIST_TRIES}
      and (${onlyIds}::bigint[] is null or id = any(${onlyIds}::bigint[]))
    order by id desc limit ${MAX_PLAYLIST_ADDS_PER_RUN}`) as MusicRec[];
  let added = 0;
  for (const rec of due) {
    if (opts.overBudget?.()) break;
    try {
      if ((await addOne(rec, auth)) === "added") added++;
    } catch (err) {
      logEnrichError("rec-lane playlist", { rec: Number(rec.id) }, err);
      if (err instanceof MusicAuthError) return { added, state: "no_auth" };
      if (isBusy(err) || (err instanceof ProviderHttpError && err.status === 404)) break; // not this tip's fault
    }
  }
  return { added, state: "connected" };
}

/** The MCP/Alexa "add <item> to my Earmarked playlist" (tools.ts, through mcp/playlist-seam.ts). */
export async function addRecToPlaylist(recId: number, opts: Opts = {}): Promise<PlaylistResult> {
  const [rec] = (await db()`select id, type, apple_music_id, added_to_playlist_at from recommendations where id = ${recId}`) as
    (MusicRec & { added_to_playlist_at: Date | null })[];
  if (!rec || !MUSIC_TYPES.includes(rec.type)) return "not_music";
  if (rec.added_to_playlist_at) return "already";
  if (!rec.apple_music_id) return "no_match";
  const auth = await loadAuth(opts.env ?? process.env, opts.fetchImpl);
  if (auth.state === "no_auth") return "no_auth";
  if (auth.state !== "connected") return "not_connected";
  try {
    return await addOne(rec, auth);
  } catch (err) {
    if (err instanceof MusicAuthError) return "no_auth";
    throw err;
  }
}
