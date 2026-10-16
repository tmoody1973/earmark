"use client";

import { useState } from "react";
import { Icon } from "@/app/garden/cards/icons";

/** Copies the one-pager's markdown. The result is announced; a refused clipboard says so instead of failing quietly. */
export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch {
      setStatus("Couldn't copy. Select the text and copy it instead.");
    }
  }
  return (
    <>
      <button type="button" className="idea-action" onClick={copy}>
        <Icon name="copy" size={18} />
        Copy
      </button>
      <span className="idea-action-status" role="status" aria-live="polite">{status}</span>
    </>
  );
}
