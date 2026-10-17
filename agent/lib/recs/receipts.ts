// Rec receipts (FR-24): when the owner loved a tip, draft a short thank-you, let him edit and approve it, then share a
// public card (/r/<token>) or set a Bee reminder to send it later. Checking that reminder off in Bee marks the tip thanked.
// Privacy: the model prompt and the public query never touch the conversation excerpt; the owner is never thanked.
// Logs: ids and err.name only (callers); never note text, names or tokens.
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Todo } from "../bee/client";
import { db } from "../db";
import { getEnv, ownerFirstName, requireEnv } from "../env";
import { credit } from "../garden/queries";
import { newShareToken } from "../privacy/tokens";
import { chicagoLocalToUtc as timeChicagoLocalToUtc } from "../time";
import { createEarmarkTodo } from "../sync/bee-todos";
import { setRecStatus } from "./status";

const NoteSchema = z.object({ message: z.string().min(10).max(280) });
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A refusal with plain-English text that is safe to show the owner. Anything else is logged and shown generically. */
export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptError";
  }
}

const SKIPPED = {
  cap: "10 open Earmark todos already; finish one first",
  off: "Bee reminders are switched off right now",
  locked: "Bee is busy; try again in a minute",
} as const;

interface RecRow {
  canonical_name: string; creator: string | null; type: string; rating: string | null;
  recommender_id: number | string | null; first_name: string | null;
}

export async function draftReceipt(recId: number, generateImpl: typeof generateText = generateText) {
  const [rec] = (await db()`
    select r.id, r.canonical_name, r.creator, r.type, r.rating, r.recommender_id, rc.first_name
    from recommendations r left join recommenders rc on rc.id = r.recommender_id
    where r.id = ${recId}`) as RecRow[];
  if (!rec) throw new ReceiptError(`rec ${recId} not found`);
  if (rec.rating !== "loved") throw new ReceiptError("receipts are only drafted for loved recs");
  const who = credit({ recommender_id: rec.recommender_id as never, first_name: rec.first_name });
  if (!who) throw new ReceiptError("rec has no recommender to thank"); // also the owner: never credited
  const cap = (t: string) => t.slice(0, 120); // names come from enrichment: keep the prompt small
  const name = cap(rec.canonical_name);
  const item = rec.creator ? `${name} by ${cap(rec.creator)}` : name;
  const me = ownerFirstName() ?? "the writer";
  const { output } = await generateImpl({
    model: getEnv().WRITE_MODEL,
    output: Output.object({ schema: NoteSchema }),
    // Privacy: the prompt never includes the conversation excerpt, so the card cannot quote it.
    prompt: `Write a short, warm thank-you text from ${me} to ${who.firstName}, who recommended ${item} (${cap(rec.type)}). ${me} tried it and loved it. One or two sentences, first person, plain words, no hashtags, no emoji, under 280 characters. Do not invent details about the conversation.`,
  });
  const [row] = (await db()`
    insert into rec_receipts (recommendation_id, message, share_token)
    values (${recId}, ${output.message}, ${newShareToken()})
    returning id, share_token`) as { id: number; share_token: string }[];
  return { receiptId: Number(row.id), token: row.share_token };
}

/** The public link for a receipt's share token. */
export const receiptUrl = (token: string) => `${requireEnv("EARMARK_PUBLIC_BASE_URL")}/r/${token}`;

export async function approveReceipt(recId: number, receiptId: number, message: string): Promise<string> {
  const clean = message.trim().slice(0, 280);
  if (!clean) throw new ReceiptError("The note is empty; write something first");
  const [row] = (await db()`
    update rec_receipts set message = ${clean}, approved_at = now(), sent_via = 'link'
    where id = ${receiptId} and recommendation_id = ${recId} returning share_token, recommendation_id`) as { share_token: string; recommendation_id: number | string }[];
  if (!row) throw new ReceiptError(`receipt ${receiptId} not found`);
  await setRecStatus(Number(row.recommendation_id), "thanked", "garden");
  return receiptUrl(row.share_token);
}

export async function deferReceipt(receiptId: number, alarmAt: Date, now: Date = new Date()): Promise<void> {
  const [r] = (await db()`
    select rr.id, rr.bee_todo_id, r.canonical_name, r.recommender_id, rc.first_name
    from rec_receipts rr join recommendations r on r.id = rr.recommendation_id
    left join recommenders rc on rc.id = r.recommender_id where rr.id = ${receiptId}`) as {
    canonical_name: string; bee_todo_id: number | string | null; recommender_id: number | string | null; first_name: string | null;
  }[];
  const who = r && credit({ recommender_id: r.recommender_id as never, first_name: r.first_name });
  if (!r || !who) throw new ReceiptError(`receipt ${receiptId} has no recommender`);
  if (!(alarmAt.getTime() > now.getTime())) throw new ReceiptError("Pick a time in the future");
  const result = await createEarmarkTodo({
    entityType: "rec_receipt",
    entityId: receiptId,
    text: `Earmark · Thank ${who.firstName} for the ${r.canonical_name} tip`,
    alarmAt: alarmAt.toISOString(),
  });
  if ("skipped" in result) throw new ReceiptError(SKIPPED[result.skipped]);
  // createEarmarkTodo reuses a todo that is still open; its alarm is the old one, so don't claim the new time
  if (r.bee_todo_id != null && Number(r.bee_todo_id) === result.todoId) throw new ReceiptError("A Bee reminder for this thank-you is already open");
  await db()`update rec_receipts set bee_todo_id = ${result.todoId}, alarm_at = ${alarmAt.toISOString()} where id = ${receiptId}`;
}

/** Chicago wall time ("2026-10-20T18:00") → UTC instant, DST-correct. */
export function chicagoLocalToUtc(local: string): Date {
  if (!LOCAL_RE.test(local)) throw new ReceiptError("Pick a date and time for the reminder");
  const guess = new Date(`${local}:00Z`);
  // V8 rolls Feb 30 into March, so compare the round trip as well as NaN
  if (Number.isNaN(guess.getTime()) || guess.toISOString().slice(0, 16) !== local) throw new ReceiptError("That date and time don't exist");
  return timeChicagoLocalToUtc(local); // two-pass, DST-correct, independent of the server zone
}

/** Idempotent: the reminder was checked off in Bee, so the note counts as sent and the tip as thanked. Never sets approved_at: an unreviewed draft must not become public. */
export async function markReceiptSentFromTodo(receiptId: number): Promise<void> {
  const [row] = (await db()`
    update rec_receipts set sent_via = coalesce(sent_via, 'text')
    where id = ${receiptId} returning recommendation_id`) as { recommendation_id: number | string }[];
  if (row) await setRecStatus(Number(row.recommendation_id), "thanked", "bee");
}

/** Bee todo changes for a `rec_receipt` todo. `todo` is null when Bee answered 404 (deleted there): nothing to do. */
export async function handleReceiptTodoChange(entityId: number, todo: Todo | null): Promise<void> {
  if (todo?.completed) await markReceiptSentFromTodo(entityId);
}

export interface PublicReceipt { message: string; name: string; creator: string | null; imageUrl: string | null; type: string }

export async function getPublicReceipt(token: string): Promise<PublicReceipt | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = (await db()`
    select rr.message, r.canonical_name, r.creator, r.image_url, r.type
    from rec_receipts rr join recommendations r on r.id = rr.recommendation_id
    where rr.share_token = ${token} and rr.approved_at is not null`) as {
    message: string; canonical_name: string; creator: string | null; image_url: string | null; type: string;
  }[];
  return row ? { message: row.message, name: row.canonical_name, creator: row.creator, imageUrl: row.image_url, type: row.type } : null;
}
