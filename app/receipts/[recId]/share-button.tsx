"use client";
import { useState } from "react";
import { approveAction } from "./actions";

export function ShareButton({ recId, receiptId, initial, name }: { recId: number; receiptId: number; initial: string; name: string }) {
  const [message, setMessage] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function share() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await approveAction(recId, receiptId, message);
      if ("error" in res) return setStatus(res.error);
      const data = { title: `A thank-you for ${name}`, text: message, url: res.url };
      if (navigator.share) {
        try {
          await navigator.share(data);
          return setStatus("Shared.");
        } catch {
          // the share sheet was closed; the note is approved, so fall through to copying the link
        }
      }
      await navigator.clipboard.writeText(`${message} ${res.url}`);
      setStatus("Link copied.");
    } catch {
      setStatus("Approved, but the link could not be shared; try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="r-form">
      <label htmlFor="receipt-message">Your note</label>
      <textarea id="receipt-message" value={message} maxLength={280} rows={5} onChange={(e) => setMessage(e.target.value)} />
      <p className="r-meta">{message.length} of 280</p>
      <button type="button" onClick={share} disabled={busy || !message.trim()}>Approve and share</button>
      <p role="status" aria-live="polite" className="r-status">{status}</p>
    </div>
  );
}
