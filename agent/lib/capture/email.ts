import { after } from "next/server";
import { Resend } from "resend";
import { getEnv, ownerFirstName } from "../env";
import { firstNameOnly, validNameFor } from "../pipeline/attribution";
import { extractRecommendation } from "../pipeline/extract";
import { triageWindow } from "../pipeline/triage";
import type { AttributionSource, RecType, TriageResult } from "../types";
import { afterCaptureSaved } from "./after-save";
import { claimEmail, finishEmail, releaseEmail, type EmailOutcome } from "./email-claims";
import { saveCaptureRec } from "./save";

const MAX_BODY_BYTES = 256 * 1024; // webhook payloads are metadata only; this is a ceiling, not an expectation
const JOKING_REVIEW_AT = 0.5; // a forward that is probably a joke is kept, but for review

export interface ReceivedEmail {
  from: string;
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  created_at: string;
}

export interface EmailDeps {
  verify: (raw: string, headers: { id: string; timestamp: string; signature: string }) => { type: string; data?: { email_id?: unknown } };
  claim: (emailId: string) => Promise<boolean>;
  release: (emailId: string) => Promise<void>;
  finish: (emailId: string, outcome: EmailOutcome, recId: number | null) => Promise<void>;
  fetchEmail: (emailId: string) => Promise<ReceivedEmail>;
  triage: (text: string) => Promise<TriageResult>;
  extract: typeof extractRecommendation;
  save: typeof saveCaptureRec;
  afterCreated: (recId: number) => void;
}

// Fresh read of just the three email-in settings on every request (getEnv() caches the first parse).
// Missing any one refuses the request (fail closed); only the key NAME is ever logged.
function emailConfig(): { apiKey: string; secret: string; ownerEmail: string } | null {
  const env = getEnv({ ...process.env });
  const missing = (["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EARMARK_OWNER_EMAIL"] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`[capture] email-in not configured, missing: ${missing.join(", ")}`);
    return null;
  }
  return { apiKey: env.RESEND_API_KEY!, secret: env.RESEND_WEBHOOK_SECRET!, ownerEmail: env.EARMARK_OWNER_EMAIL!.trim().toLowerCase() };
}

class ResendFetchError extends Error {
  override name = "ResendFetchError";
}

function defaultDeps(cfg: { apiKey: string; secret: string }): EmailDeps {
  const resend = new Resend(cfg.apiKey);
  return {
    verify: (raw, headers) => resend.webhooks.verify({ payload: raw, headers, webhookSecret: cfg.secret }) as ReturnType<EmailDeps["verify"]>,
    claim: claimEmail,
    release: releaseEmail,
    finish: finishEmail,
    fetchEmail: async (id) => {
      // The webhook carries metadata only (no body), so the body is a second call.
      const { data, error } = await resend.emails.receiving.get(id);
      if (error || !data) throw new ResendFetchError(); // never carry Resend's message text
      return data;
    },
    triage: (text) => triageWindow(text),
    extract: extractRecommendation,
    save: saveCaptureRec,
    afterCreated: (recId) => after(() => afterCaptureSaved(recId)),
  };
}

export function forwardedSenderName(text: string): string | null {
  const m = text.match(/^[\s>]*From:\s*"?([^"<\n]+?)"?\s*<[^>\n]+>/m);
  return m ? m[1]!.trim() : null;
}

export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1]! : from).trim().toLowerCase();
}

// Resend exposes no structured SPF/DKIM field on a received email, only the raw headers. If those carry an
// Authentication-Results / Received-SPF line that says fail, the From address was forged or the mail was altered.
// Only a stated failure counts: a header saying "pass" proves nothing (the sender can write any header), and a
// missing header is not a failure. Decision 030.
export function hasAuthFailure(headers: Record<string, string> | null): boolean {
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (key === "authentication-results" && /\b(?:spf|dkim|dmarc)\s*=\s*fail\b/i.test(value)) return true;
    if (key === "received-spf" && /^\s*fail\b/i.test(value)) return true;
  }
  return false;
}

const stripHtml = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");
const respond = (status: string, code = 200, extra: Record<string, unknown> = {}) => Response.json({ status, ...extra }, { status: code });

type Outcome = { outcome: "ignored" } | { outcome: "saved" | "duplicate"; id: number; upgraded: boolean };

async function processEmail(emailId: string, ownerEmail: string, deps: EmailDeps): Promise<Outcome> {
  const email = await deps.fetchEmail(emailId);
  // The From address can be forged: the webhook signature proves the mail came through Resend, not who sent it.
  if (addressOf(email.from) !== ownerEmail || hasAuthFailure(email.headers)) return { outcome: "ignored" };
  const text = (email.text ?? (email.html ? stripHtml(email.html) : "")).trim().slice(0, 4000);
  const subject = (email.subject ?? "").trim();
  const body = `${subject}\n${text}`.trim().slice(0, 2000);
  if (!text && !subject) return { outcome: "ignored" };

  const triage = await deps.triage(body.slice(0, 1200));
  const ext = await deps.extract({ text: body, summary: null });
  const name = validNameFor(ownerFirstName(), forwardedSenderName(text) ?? ext.recommenderName, text, subject);
  const urls = [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])].slice(0, 3);
  // An explicit forward is save intent: doubt about it means "needs review", never a silent drop.
  const looksLikeRec = triage.kind === "rec_to_user" && !(triage.jokingProbability >= JOKING_REVIEW_AT);
  const p = triage.kind === "rec_to_user" ? triage.kindProbability : 1 - triage.kindProbability;
  const sent = Date.parse(email.created_at);
  const attribution: AttributionSource = name ? "email" : "none";

  const saved = await deps.save({
    type: (triage.recType === "none" ? "other" : triage.recType) as RecType,
    rawText: ext.excerpt || ext.canonicalName, // 25-word excerpt, never the whole email
    canonicalName: ext.canonicalName,
    creator: ext.creator,
    imageUrl: null,
    links: urls.length ? { urls } : {},
    appleMusicId: null,
    recommenderName: name ? firstNameOnly(name) : null,
    evidence: [text, subject],
    attributionSource: attribution,
    excerpt: ext.excerpt,
    beeConversationId: null,
    saidAt: Number.isNaN(sent) ? new Date() : new Date(sent),
    confidence: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0,
    source: "email",
    status: looksLikeRec ? "new" : "needs_review",
  });
  return { outcome: saved.duplicate ? "duplicate" : "saved", id: saved.id, upgraded: saved.upgraded };
}

export async function handleInboundEmail(req: Request, overrides: Partial<EmailDeps> = {}): Promise<Response> {
  const cfg = emailConfig();
  if (!cfg) return Response.json({ error: "email-in not configured" }, { status: 500 });
  const deps = { ...defaultDeps(cfg), ...overrides };

  const raw = await req.text(); // raw body first: re-serialized JSON breaks the signature
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "body too large" }, { status: 413 });
  let evt: ReturnType<EmailDeps["verify"]>;
  try {
    evt = deps.verify(raw, {
      id: req.headers.get("svix-id") ?? "",
      timestamp: req.headers.get("svix-timestamp") ?? "",
      signature: req.headers.get("svix-signature") ?? "",
    });
  } catch {
    return new Response("invalid signature", { status: 401 });
  }
  const emailId = evt.data?.email_id;
  if (evt.type !== "email.received" || typeof emailId !== "string" || !emailId) return respond("ignored");

  try {
    if (!(await deps.claim(emailId))) return respond("duplicate");
  } catch (e) {
    console.error(`[capture] email claim failed emailId=${emailId} err=${errName(e)}`);
    return Response.json({ error: "capture failed" }, { status: 500 });
  }

  let result: Outcome;
  try {
    result = await processEmail(emailId, cfg.ownerEmail, deps);
  } catch (e) {
    console.error(`[capture] email failed emailId=${emailId} err=${errName(e)}`);
    await deps.release(emailId).catch((r) => console.error(`[capture] email release failed emailId=${emailId} err=${errName(r)}`));
    return Response.json({ error: "capture failed" }, { status: 500 }); // Resend retries; the claim is free again
  }

  const recId = result.outcome === "ignored" ? null : result.id;
  await deps.finish(emailId, result.outcome, recId).catch((e) => console.error(`[capture] email finish failed emailId=${emailId} err=${errName(e)}`));
  if (result.outcome === "ignored") {
    console.warn(`[capture] email ignored emailId=${emailId}`);
    return respond("ignored");
  }
  if (result.outcome === "duplicate") return respond("duplicate", 200, { id: result.id });
  try {
    deps.afterCreated(result.id);
  } catch (e) {
    console.error(`[capture] schedule failed recId=${result.id} err=${errName(e)}`);
  }
  return respond(result.upgraded ? "upgraded" : "created", 201, { id: result.id });
}
