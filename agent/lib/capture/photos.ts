import { del, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { createBeeClient } from "../bee/client";
import { getEnv } from "../env";
import { parseLatLng, type LatLng } from "../geo";
import type { AttributionSource, RecType, TranscriptWindow } from "../types";
import { afterCaptureSaved } from "./after-save";
import { bearerMatches } from "./auth";
import { classifyPhoto, readPhoto } from "./classify-photo";
import { attributeFromWindow, findConversationNear, pickWindowForCapture, type LinkedConversation } from "./link";
import { saveCaptureRec } from "./save";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB
const MAX_THUMB_BYTES = 512 * 1024;
const ITEM_THRESHOLD = 0.5;
// ponytail: deliberately conservative: any real chance of a person discards the image (decision 032)
const PERSON_THRESHOLD = 0.2;

export interface PhotoDeps {
  classify: typeof classifyPhoto;
  read: typeof readPhoto;
  findConversation: (at: Date, where: LatLng | null) => Promise<LinkedConversation | null>;
  pickWindow: typeof pickWindowForCapture;
  attribute: (w: TranscriptWindow, summary: string | null) => Promise<{ firstName: string | null; source: AttributionSource; excerpt: string }>;
  save: typeof saveCaptureRec;
  putThumb: (file: File) => Promise<string>;
  deleteThumb: (url: string) => Promise<void>;
  afterCreated: (recId: number) => void;
}

function defaultDeps(): PhotoDeps {
  const bee = createBeeClient();
  return {
    classify: classifyPhoto,
    read: readPhoto,
    findConversation: (at, where) => findConversationNear(bee, at, where),
    pickWindow: pickWindowForCapture,
    attribute: (w, s) => attributeFromWindow(w, s),
    save: saveCaptureRec,
    // Public but unlisted: the random suffix makes the URL unguessable (decision 033).
    putThumb: async (file) =>
      (await put(`thumbs/${randomUUID()}.jpg`, file, { access: "public", addRandomSuffix: true, contentType: "image/jpeg" })).url,
    deleteThumb: (url) => del(url),
    afterCreated: (recId) => after(() => afterCaptureSaved(recId)),
  };
}

function describeForm(form: FormData) {
  return Object.fromEntries(
    [...form.entries()].map(([k, v]: [string, unknown]) =>
      v instanceof File
        ? [k, { type: "file", name: v.name, size: v.size, mediaType: v.type }]
        : [k, { type: "text", value: String(v).slice(0, 60) }],
    ),
  );
}

function parseDate(v: FormDataEntryValue | null): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fail = (error: string, status: number) => Response.json({ error }, { status });
const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

export async function handlePhotoCapture(req: Request, overrides: Partial<PhotoDeps> = {}): Promise<Response> {
  const token = getEnv().EARMARK_CAPTURE_TOKEN;
  if (!token || !bearerMatches(req, token)) return new Response("unauthorized", { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("multipart form required", 415);
  }
  if (new URL(req.url).searchParams.get("dry") === "1") return Response.json({ fields: describeForm(form) });

  const image = form.get("image");
  const thumb = form.get("thumb");
  if (!(image instanceof File)) return fail("image file field required", 400);
  if (image.size > MAX_IMAGE_BYTES) return fail("image over 4 MB; resize to 1024 px in the Shortcut", 413);
  if (!["image/jpeg", "image/png"].includes(image.type)) return fail(`unsupported ${image.type}`, 415);

  if (thumb instanceof File && thumb.size > 0) {
    if (thumb.size > MAX_THUMB_BYTES) return fail("thumb over 512 KB; resize to 256 px in the Shortcut", 413);
    if (!["image/jpeg", "image/png"].includes(thumb.type)) return fail(`unsupported thumb ${thumb.type}`, 400);
  }

  const deps = { ...defaultDeps(), ...overrides };
  const takenAt = parseDate(form.get("taken_at")) ?? new Date();
  const where = parseLatLng(form.get("lat"), form.get("lng"));
  const bytes = new Uint8Array(await image.arrayBuffer());

  let thumbnailUrl: string | null = null;
  let outcome: { id: number; upgraded: boolean; title: string; from: string };
  try {
    const [cls, read] = await Promise.all([deps.classify(bytes, image.type), deps.read(bytes, image.type)]);
    if (cls.itemProbability < ITEM_THRESHOLD || !read.title.trim()) {
      return Response.json({ status: "ignored", message: "Earmark didn't find a title in that photo." });
    }

    // Linking is best-effort: a Bee or model outage must not lose the capture. Fall through to an unlinked save.
    const label = read.creator ? `"${read.title}" by ${read.creator}` : `"${read.title}"`;
    let linked: LinkedConversation | null = null;
    let picked: Awaited<ReturnType<PhotoDeps["pickWindow"]>> = null;
    let who: { firstName: string | null; source: AttributionSource; excerpt: string } = { firstName: null, source: "none", excerpt: "" };
    try {
      const l = await deps.findConversation(takenAt, where);
      const p = l ? await deps.pickWindow(label, l.windows) : null;
      const w = p && l ? await deps.attribute(p.window, l.summary) : who;
      linked = l;
      picked = p;
      who = w;
    } catch (e) {
      console.error(`[capture] photo link failed err=${errName(e)}`);
    }

    // Person rule first: when it says no image, nothing is uploaded at all.
    const keepThumb = cls.personProbability < PERSON_THRESHOLD && thumb instanceof File && thumb.size > 0;
    thumbnailUrl = keepThumb ? await deps.putThumb(thumb) : null;

    const saved = await deps.save({
      type: cls.recType as RecType,
      rawText: [read.title, read.creator, read.visibleText].filter(Boolean).join(" · "),
      canonicalName: read.title.trim(),
      creator: read.creator,
      imageUrl: thumbnailUrl,
      links: {},
      appleMusicId: null,
      recommenderName: who.firstName,
      evidence: [picked?.window.text ?? null, linked?.summary ?? null],
      attributionSource: who.source,
      excerpt: who.excerpt,
      // The recommendation (and the upgrade lookup) is tied to the conversation only when the picker found the item in
      // it; the photos row keeps the time/place link, which is true either way (decision 033).
      beeConversationId: picked && linked ? linked.conversationId : null,
      saidAt: takenAt,
      confidence: cls.itemProbability,
      source: "photo",
      photo: { takenAt, where, conversationId: linked?.conversationId ?? null, thumbnailUrl },
    });
    outcome = { id: saved.id, upgraded: saved.upgraded, title: read.title, from: !saved.upgraded && who.firstName ? ` (from ${who.firstName})` : "" };
  } catch (e) {
    console.error(`[capture] photo failed err=${errName(e)}`);
    if (thumbnailUrl) await deps.deleteThumb(thumbnailUrl).catch((d) => console.error(`[capture] thumb cleanup failed err=${errName(d)}`));
    return fail("capture failed", 500);
  }

  // Saved: from here the thumbnail is referenced by the database and must never be deleted.
  try {
    deps.afterCreated(outcome.id);
  } catch (e) {
    console.error(`[capture] schedule failed recId=${outcome.id} err=${errName(e)}`);
  }
  return Response.json(
    { status: outcome.upgraded ? "upgraded" : "created", id: outcome.id, message: `${outcome.upgraded ? "Updated" : "Earmarked"}: ${outcome.title}${outcome.from}` },
    { status: 201 },
  );
}
