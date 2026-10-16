import { after } from "next/server";
import { z } from "zod";
import { createBeeClient } from "../bee/client";
import { getEnv } from "../env";
import { parseLatLng, type LatLng } from "../geo";
import type { AttributionSource, TranscriptWindow } from "../types";
import { afterCaptureSaved } from "./after-save";
import { bearerMatches } from "./auth";
import { attributeFromWindow, findConversationNear, pickWindowForCapture, type LinkedConversation } from "./link";
import { saveCaptureRec } from "./save";

const MAX_BODY_BYTES = 16 * 1024;
export const DUPLICATE_WINDOW_MS = 10 * 60_000; // a double press of the Action button saves once

export interface SongDeps {
  findConversation: (at: Date, where: LatLng | null) => Promise<LinkedConversation | null>;
  pickWindow: typeof pickWindowForCapture;
  attribute: (w: TranscriptWindow, summary: string | null) => Promise<{ firstName: string | null; source: AttributionSource; excerpt: string }>;
  save: typeof saveCaptureRec;
  afterCreated: (recId: number) => void;
}

function defaultDeps(): SongDeps {
  const bee = createBeeClient();
  return {
    findConversation: (at, where) => findConversationNear(bee, at, where),
    pickWindow: pickWindowForCapture,
    attribute: (w, s) => attributeFromWindow(w, s),
    save: saveCaptureRec,
    afterCreated: (recId) => after(() => afterCaptureSaved(recId)),
  };
}

function isAppleMusicUrl(u: URL): boolean {
  return u.protocol === "https:" && (u.hostname === "music.apple.com" || u.hostname.endsWith(".music.apple.com"));
}

// Song id from an Apple Music link: `?i=<id>` on an album URL, or the trailing id of a /song/ URL.
export function appleMusicSongId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isAppleMusicUrl(u)) return null;
  const i = u.searchParams.get("i");
  if (i && /^\d+$/.test(i)) return i;
  const m = u.pathname.match(/\/song\/[^/]+\/(\d+)\/?$/);
  return m ? m[1]! : null;
}

// Shortcuts sends "" for an empty variable: treat blank optional fields as absent.
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(t: T) => z.preprocess(blank, t.nullish());

const SongBody = z.object({
  title: z.string().trim().min(1, "title required").max(200),
  artist: optional(z.string().trim().max(200)),
  apple_music_url: optional(
    z.string().trim().max(500).refine((v) => {
      try { return isAppleMusicUrl(new URL(v)); } catch { return false; }
    }, "apple_music_url must be an https Apple Music link"),
  ),
  apple_music_id: optional(z.string().trim().regex(/^\d{1,20}$/, "apple_music_id must be digits")),
  captured_at: optional(z.string().refine((v) => !Number.isNaN(Date.parse(v)), "captured_at not parseable")),
  lat: optional(z.union([z.string(), z.number()])),
  lng: optional(z.union([z.string(), z.number()])),
}).superRefine((b, ctx) => {
  if ((b.lat != null || b.lng != null) && parseLatLng(b.lat ?? null, b.lng ?? null) === null) {
    ctx.addIssue({ code: "custom", message: "lat/lng must both be present and in range" });
  }
});

const fail = (error: string, status: number) => Response.json({ error }, { status });
const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

export async function handleSongCapture(req: Request, overrides: Partial<SongDeps> = {}): Promise<Response> {
  const token = getEnv().EARMARK_CAPTURE_TOKEN;
  if (!token || !bearerMatches(req, token)) return new Response("unauthorized", { status: 401 });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return fail("JSON body required", 415);
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return fail("body too large", 413);
    raw = JSON.parse(text);
  } catch {
    return fail("JSON body required", 415);
  }
  const parsed = SongBody.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "bad body", 400);
  const body = parsed.data;

  const deps = { ...defaultDeps(), ...overrides };
  const at = body.captured_at ? new Date(body.captured_at) : new Date();
  const where = parseLatLng(body.lat ?? null, body.lng ?? null);
  const artist = body.artist ?? null;
  const amUrl = body.apple_music_url ?? null;

  let saved: Awaited<ReturnType<SongDeps["save"]>>;
  let from = "";
  try {
    const linked = await deps.findConversation(at, where);
    const picked = linked ? await deps.pickWindow(artist ? `the song "${body.title}" by ${artist}` : `the song "${body.title}"`, linked.windows) : null;
    const who = picked && linked
      ? await deps.attribute(picked.window, linked.summary)
      : { firstName: null, source: "none" as AttributionSource, excerpt: "" };
    saved = await deps.save(
      {
        type: "song",
        rawText: artist ? `${body.title} — ${artist}` : body.title,
        canonicalName: body.title,
        creator: artist,
        imageUrl: null,
        links: amUrl ? { apple_music: amUrl } : {},
        appleMusicId: body.apple_music_id ?? appleMusicSongId(amUrl),
        recommenderName: who.firstName,
        evidence: [picked?.window.text ?? null, linked?.summary ?? null],
        attributionSource: who.source,
        excerpt: who.excerpt,
        // Tied to the conversation (and upgrade-checked against it) only when the picker found the song in it (decision 033).
        beeConversationId: picked && linked ? linked.conversationId : null,
        saidAt: at,
        confidence: 1, // explicit capture by the user
        source: "song",
      },
      { recentDuplicateMs: DUPLICATE_WINDOW_MS },
    );
    from = !saved.upgraded && who.firstName ? ` (from ${who.firstName})` : "";
  } catch (e) {
    console.error(`[capture] song failed err=${errName(e)}`);
    return fail("capture failed", 500);
  }

  if (saved.duplicate) {
    return Response.json({ status: "duplicate", duplicate: true, recId: saved.id, message: `Already earmarked: ${body.title}` });
  }
  try {
    deps.afterCreated(saved.id);
  } catch (e) {
    console.error(`[capture] schedule failed recId=${saved.id} err=${errName(e)}`);
  }
  const label = artist ? `${body.title} — ${artist}` : body.title;
  return Response.json(
    { status: saved.upgraded ? "upgraded" : "created", id: saved.id, message: `${saved.upgraded ? "Updated" : "Earmarked"}: ${label}${from}` },
    { status: 201 },
  );
}
