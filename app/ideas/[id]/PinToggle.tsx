"use client";
import { useOptimistic, useState, useTransition } from "react";
import { pinIdea } from "@/app/garden/actions";
import { Icon } from "@/app/garden/cards/icons";

/*
 * Top of Mind (FR-35): a pressed/unpressed button with its words, never an icon alone. The press shows at once and
 * comes back if the save fails or Top of Mind is full; the reason is said in words beside it. No orange: the accent
 * means only new and bloomed, so a pin is ink.
 */
export function PinToggle({ ideaId, pinned }: { ideaId: number; pinned: boolean }) {
  const [on, setOn] = useOptimistic(pinned);
  const [, startTransition] = useTransition();
  const [said, setSaid] = useState("");

  const toggle = () => {
    const next = !on;
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      setOn(next);
      try {
        const r = await pinIdea(ideaId, next);
        if (r.refused) setSaid(r.refused);
        else setSaid(next ? "On Top of Mind. Earmark listens for it more closely." : "Off Top of Mind.");
      } catch (err) {
        console.error("pin failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  };

  return (
    <div className="pin-row">
      <button type="button" className="idea-action pin-toggle" aria-pressed={on} onClick={toggle}>
        <Icon name="pin" size={18} />
        Top of mind
      </button>
      <p role="status" className="idea-action-status">{said}</p>
    </div>
  );
}
