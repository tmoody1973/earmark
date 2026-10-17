"use client";
import { useActionState } from "react";
import { deferAction, draftAction, type ReceiptResult } from "./actions";

const none: ReceiptResult = {};

export function DraftForm({ recId }: { recId: number }) {
  const [state, action, pending] = useActionState(draftAction.bind(null, recId), none);
  return (
    <form action={action} className="r-form">
      <button type="submit" disabled={pending}>{pending ? "Drafting…" : "Draft a thank-you"}</button>
      <p role="status" aria-live="polite" className="r-status">{state.error}</p>
    </form>
  );
}

export function DeferForm({ recId, receiptId }: { recId: number; receiptId: number }) {
  const [state, action, pending] = useActionState(deferAction.bind(null, recId, receiptId), none);
  return (
    <form action={action} className="r-form">
      <label htmlFor="when">Remind me later (Chicago time)</label>
      <input id="when" name="when" type="datetime-local" required />
      <button type="submit" className="quiet" disabled={pending}>{pending ? "Setting…" : "Set a Bee reminder"}</button>
      <p role="status" aria-live="polite" className="r-status">{state.error ?? state.ok}</p>
    </form>
  );
}
