"use client";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import type { RecCardData } from "@/agent/lib/garden/queries";
import { keepTip, notATip } from "./actions";
import { cardSubline, TYPE_LABEL } from "./cards/RecCard";
import { Icon } from "./cards/icons";
import "./cards/cards.css";

type Choice = "keep" | "drop";
const ACTION = { keep: keepTip, drop: notATip } as const;
const SAID = { keep: "Kept", drop: "Removed" } as const;

interface Props {
  tips: RecCardData[];
  /** How many more maybes wait beyond these. */
  more: number;
  /** Where the rest can be seen (Home links to the Shelf); absent, the count is plain text. */
  moreHref?: string;
  /** The element focus moves to when the last maybe is cleared. */
  emptyFocusId: string;
}

/**
 * "Maybe?" (decision 025): tips Earmark wasn't sure about, each with Keep and Not a tip. A tap removes the card at
 * once (optimistic; it comes back if the save fails), says so in a live region, and moves focus to the next card.
 * Hidden entirely when there are none. No orange: that accent means only new and bloomed.
 */
export function MaybeRow({ tips, more, moreHref, emptyFocusId }: Props) {
  const [shown, hide] = useOptimistic(tips, (list, id: number) => list.filter((t) => t.id !== id));
  const [, startTransition] = useTransition();
  const [said, setSaid] = useState("");
  // Keep the live region mounted after the last card goes, so its announcement is still read.
  const [hadAny] = useState(tips.length > 0);
  if (!hadAny) return null;

  function decide(tip: RecCardData, choice: Choice) {
    const i = shown.findIndex((t) => t.id === tip.id);
    const next = shown[i + 1] ?? shown[i - 1];
    const target = next ? document.getElementById(`maybe-${next.id}-keep`) : document.getElementById(emptyFocusId);
    if (target && !next) target.tabIndex = -1;
    target?.focus();
    startTransition(async () => {
      hide(tip.id);
      try {
        await ACTION[choice](tip.id);
        setSaid(`${SAID[choice]}: ${tip.name}`);
      } catch (err) {
        console.error("maybe verdict failed", tip.id, (err as Error).name);
        setSaid(`Couldn't save that. ${tip.name} is back in Maybe; try again.`);
      }
    });
  }

  return (
    <>
      <p role="status" className="visually-hidden">{said}</p>
      {shown.length > 0 && (
        <section className="zone maybe" id="maybe" aria-labelledby="maybe-h">
          <div className="zone-head">
            <h2 id="maybe-h">Maybe?</h2>
          </div>
          <p className="maybe-lede">Earmark wasn’t sure about these.</p>
          <ul className="maybe-list">
            {shown.map((t) => (
              <li key={t.id}>
                <MaybeCard tip={t} onDecide={decide} />
              </li>
            ))}
          </ul>
          {more > 0 && (
            <p className="maybe-more">
              {moreHref ? <Link href={moreHref}>and {more} more</Link> : `and ${more} more after these`}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function MaybeCard({ tip, onDecide }: { tip: RecCardData; onDecide: (tip: RecCardData, choice: Choice) => void }) {
  const titleId = `maybe-${tip.id}-title`;
  const sub = cardSubline(tip);
  return (
    <article className="maybe-card" data-testid="maybe-card" data-rec-id={tip.id} aria-labelledby={titleId}>
      <p className="rec-type">
        <Icon name={tip.type} size={15} />
        {TYPE_LABEL[tip.type]}
      </p>
      <h3 className="maybe-title" id={titleId}>{tip.name}</h3>
      {sub && <p className="rec-sub">{sub}</p>}
      {tip.why && <p className="rec-why maybe-why">“{tip.why}”</p>}
      {tip.recommender && <p className="rec-from">from {tip.recommender.firstName}</p>}
      <div className="maybe-actions">
        {/* Visible label = accessible name (WCAG 2.5.3); the title rides along as the description. */}
        <button
          type="button"
          id={`maybe-${tip.id}-keep`}
          className="maybe-btn maybe-btn--keep"
          aria-describedby={titleId}
          onClick={() => onDecide(tip, "keep")}
        >
          <Icon name="check" size={16} />
          Keep
        </button>
        <button type="button" className="maybe-btn" aria-describedby={titleId} onClick={() => onDecide(tip, "drop")}>
          Not a tip
        </button>
      </div>
    </article>
  );
}
