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
  const form = await req.formData();
  if (new URL(req.url).searchParams.get("dry") === "1") return Response.json({ fields: describeForm(form) });

  const image = form.get("image");
  const thumb = form.get("thumb");
  if (!(image instanceof File)) return fail("image file field required", 400);
  if (image.size > MAX_IMAGE_BYTES) return fail("image over 4 MB; resize to 1024 px in the Shortcut", 413);
  if (!["image/jpeg", "image/png"].includes(image.type)) return fail(`unsupported ${image.type}`, 415);

  const deps = { ...defaultDeps(), ...overrides };
  const takenAt = parseDate(form.get("taken_at")) ?? new Date();
  const where = parseLatLng(form.get("lat"), form.get("lng"));
  const bytes = new Uint8Array(await image.arrayBuffer());

  let thumbnailUrl: string | null = null;
  try {
    const [cls, read] = await Promise.all([deps.classify(bytes, image.type), deps.read(bytes, image.type)]);
    if (cls.itemProbability < ITEM_THRESHOLD || !read.title.trim()) {
      return Response.json({ status: "ignored", message: "Earmark didn't find a title in that photo." });
    }

    const linked = await deps.findConversation(takenAt, where);
    const label = read.creator ? `"${read.title}" by ${read.creator}` : `"${read.title}"`;
    const picked = linked ? await deps.pickWindow(label, linked.windows) : null;
    const who = picked && linked
      ? await deps.attribute(picked.window, linked.summary)
      : { firstName: null, source: "none" as AttributionSource, excerpt: "" };

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
      beeConversationId: linked?.conversationId ?? null,
      saidAt: takenAt,
      confidence: cls.itemProbability,
      source: "photo",
      photo: { takenAt, where, conversationId: linked?.conversationId ?? null, thumbnailUrl },
    });
    deps.afterCreated(saved.id);
    const from = !saved.upgraded && who.firstName ? ` (from ${who.firstName})` : "";
    return Response.json(
      { status: saved.upgraded ? "upgraded" : "created", id: saved.id, message: `${saved.upgraded ? "Updated" : "Earmarked"}: ${read.title}${from}` },
      { status: 201 },
    );
  } catch (e) {
    console.error(`[capture] photo failed err=${errName(e)}`);
    if (thumbnailUrl) await deps.deleteThumb(thumbnailUrl).catch((d) => console.error(`[capture] thumb cleanup failed err=${errName(d)}`));
    return fail("capture failed", 500);
  }
}
