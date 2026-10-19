"use client";
import { useOptimistic, useState, useTransition } from "react";
import type { TipFixCard } from "@/agent/lib/recs/spoken-fix";
import { applySpokenFix, ignoreSpokenFix } from "./actions";
import { TYPE_LABEL } from "./cards/RecCard";
import { Icon } from "./cards/icons";
import "./cards/cards.css";

type Choice = "apply" | "ignore";

// What the live region says after a tap. result null: the save failed and the card is back.
function said(choice: Choice, to: string, result: { changed: boolean } | { refused: string } | null): string {
  if (!result) return `Couldn't save that. The fix to ${to} is back; try again.`;
  if ("refused" in result) return result.refused;
  if (!result.changed) return `Already handled: ${to}`;
  return choice === "apply" ? `Fixed: ${to}. Earmark is looking it up again.` : `Ignored: ${to}`;
}

/**
 * "Fix this tip?" (decision 049, piece 3): corrections Tarik said out loud, each with Apply and Ignore. Earmark never
 * applies one by itself. Same look and behaviour as the Maybe? row: a tap removes the card at once (optimistic; it comes
 * back if the save fails), says so in a live region and moves focus on. Always mounted, with its live region; nothing
 * visible when there are none. No orange.
 */
export function FixRow({ fixes, emptyFocusId }: { fixes: TipFixCard[]; emptyFocusId: string }) {
  const [shown, hide] = useOptimistic(fixes, (list, id: number) => list.filter((f) => f.id !== id));
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function decide(fix: TipFixCard, choice: Choice) {
    const i = shown.findIndex((f) => f.id === fix.id);
    const next = shown[i + 1] ?? shown[i - 1];
    const target = next ? document.getElementById(`fix-${next.id}-apply`) : document.getElementById(emptyFocusId);
    if (target && !next) target.tabIndex = -1;
    target?.focus();
    setMessage(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      hide(fix.id);
      let result: { changed: boolean } | { refused: string } | null = null;
      try {
        result = await (choice === "apply" ? applySpokenFix : ignoreSpokenFix)(fix.id);
      } catch (err) {
        console.error("spoken fix failed", fix.id, (err as Error).name);
      }
      setMessage(said(choice, fix.to, result));
    });
  }

  return (
    <>
      <p role="status" className="visually-hidden">{message}</p>
      {shown.length > 0 && (
        <section className="zone maybe" id="fixes" aria-labelledby="fixes-h">
          <div className="zone-head">
            <h2 id="fixes-h">Fix these tips?</h2>
          </div>
          <p className="maybe-lede">You said these out loud. Nothing changes until you apply one.</p>
          <ul className="maybe-list">
            {shown.map((f) => (
              <li key={f.id}>
                <FixCard fix={f} onDecide={decide} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function FixCard({ fix, onDecide }: { fix: TipFixCard; onDecide: (fix: TipFixCard, choice: Choice) => void }) {
  const titleId = `fix-${fix.id}-title`;
  return (
    <article className="maybe-card" data-testid="fix-card" data-rec-id={fix.recId} aria-labelledby={titleId}>
      <p className="rec-type">
        <Icon name={fix.type} size={15} />
        {TYPE_LABEL[fix.type]}
      </p>
      <h3 className="maybe-title" id={titleId}>
        Fix <cite>{fix.from}</cite> <span aria-hidden="true">→</span><span className="visually-hidden">to</span>{" "}
        <cite>{fix.to}</cite>{fix.toType && ` (${TYPE_LABEL[fix.toType]})`}?
      </h3>
      <div className="maybe-actions">
        {/* Visible label = accessible name (WCAG 2.5.3); the fix rides along as the description. */}
        <button type="button" id={`fix-${fix.id}-apply`} className="maybe-btn maybe-btn--keep" aria-describedby={titleId} onClick={() => onDecide(fix, "apply")}>
          <Icon name="check" size={16} />
          Apply
        </button>
        <button type="button" className="maybe-btn" aria-describedby={titleId} onClick={() => onDecide(fix, "ignore")}>
          Ignore
        </button>
      </div>
    </article>
  );
}
