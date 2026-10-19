"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { UndoStage } from "@/agent/lib/garden/quiet-ideas";
import { dismissIdeaAction, undoDismissIdeaAction } from "@/app/garden/actions";
import { Icon } from "@/app/garden/cards/icons";

/*
 * Dismiss an idea (decision 055): one tap, no confirm, and Undo for an hour, as Serendipity's compost. Always mounted
 * (like MergedNote), so the Undo outlives the re-render that greys the page. Drafted and used ideas can go too.
 */
export function DismissIdea({ ideaId, dismissed }: { ideaId: number; dismissed: boolean }) {
  const [undo, setUndo] = useState<UndoStage | null>(null);
  const [said, setSaid] = useState("");
  const [pending, startTransition] = useTransition();
  const undoBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (undo) undoBtn.current?.focus(); }, [undo]);

  const act = (work: () => Promise<string>) => {
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      try {
        setSaid(await work());
      } catch (err) {
        console.error("dismiss idea failed", ideaId, (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  };

  const dismiss = () => act(async () => {
    const r = await dismissIdeaAction(ideaId);
    if (!r.changed || !r.previous) return "It was already dismissed.";
    setUndo(r.previous);
    return "Dismissed. It stays here, greyed out.";
  });

  // The Undo stays until the answer, so the status line below is never unmounted mid-announcement.
  const undoIt = (previous: UndoStage) => act(async () => {
    const { changed } = await undoDismissIdeaAction({ id: ideaId, previous });
    setUndo(null);
    return changed ? "Undone. It’s back where it was." : "It can’t come back from here now.";
  });

  if (dismissed && !undo && !said) return null;
  return (
    <div className="pin-row">
      {undo ? (
        <button type="button" ref={undoBtn} className="idea-action" aria-label="Undo: bring this idea back" disabled={pending}
          onClick={() => undoIt(undo)}>
          <Icon name="undo" size={18} />
          Undo
        </button>
      ) : (
        !dismissed && (
          <button type="button" className="idea-action" disabled={pending} onClick={dismiss}>
            Dismiss
          </button>
        )
      )}
      <p role="status" className="idea-action-status">{said}</p>
    </div>
  );
}
