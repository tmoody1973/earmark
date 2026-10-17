"use client";
import { useState } from "react";
import { approveAction } from "./actions";

// After approval the /r/ link stays on screen as plain text with a Copy button, so a closed or failed share sheet
// (iOS, no clipboard permission) never loses it. initialUrl is computed by the page for receipts approved earlier.
export function ShareButton({ recId, receiptId, initial, name, initialUrl }: {
  recId: number; receiptId: number; initial: string; name: string; initialUrl: string | null;
}) {
  const [message, setMessage] = useState(initial);
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function copy(link: string, text: string) {
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      setStatus("Link copied.");
    } catch {
      setStatus("Could not copy; press and hold the link below to copy it.");
    }
  }
  async function share() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await approveAction(recId, receiptId, message);
      if ("error" in res) return setStatus(res.error);
      setUrl(res.url);
      if (navigator.share) {
        try {
          await navigator.share({ title: `A thank-you for ${name}`, text: message, url: res.url });
          return setStatus("Shared.");
        } catch {
          // the share sheet was closed or failed; the link is on screen below, so fall through to copying it
        }
      }
      await copy(res.url, message);
    } catch {
      setStatus("Could not approve the note; try again.");
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
      {url && (
        <div className="r-link">
          <p className="r-meta">Anyone with this link can read the note:</p>
          <p className="r-url"><a href={url}>{url}</a></p>
          <button type="button" className="quiet" onClick={() => copy(url, message)}>Copy link</button>
        </div>
      )}
    </div>
  );
}
