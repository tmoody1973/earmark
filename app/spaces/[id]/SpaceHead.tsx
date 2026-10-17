"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { SpaceSummary } from "@/agent/lib/garden/spaces";
import { deleteSpace, renameSpace } from "@/app/garden/actions";

/*
 * A Space's name, the sentence it fills from, and its two tools: Rename (inline) and Delete (asks first, inline).
 * Each says what happened in a live region. Deleting a Space never touches its ideas and tips.
 */
export function SpaceHead({ space }: { space: SpaceSummary }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [said, setSaid] = useState("");
  const [pending, startTransition] = useTransition();
  const renameBtn = useRef<HTMLButtonElement>(null);
  const deleteBtn = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Back to the view; focus returns to the control that opened the panel (or the heading after a save). The buttons
  // are mounted again only after the re-render, so the focus waits for it.
  const focusTo = useRef<"rename" | "delete" | "heading" | null>(null);
  useEffect(() => {
    if (mode !== "view" || !focusTo.current) return;
    ({ rename: renameBtn, delete: deleteBtn, heading })[focusTo.current].current?.focus();
    focusTo.current = null;
  }, [mode]);
  const close = (to: "rename" | "delete" | "heading") => {
    focusTo.current = to;
    setMode("view");
  };

  function rename(form: FormData) {
    const name = String(form.get("name") ?? "").trim();
    setSaid("");
    startTransition(async () => {
      try {
        const { changed } = await renameSpace(space.id, name);
        setSaid(changed ? `Renamed to “${name}”.` : "The name is the same.");
        close("heading");
      } catch (err) {
        console.error("rename space failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  }

  function remove() {
    setSaid("");
    startTransition(async () => {
      try {
        const { changed } = await deleteSpace(space.id);
        if (changed) return router.replace("/spaces");
        setSaid("This Space was already deleted.");
      } catch (err) {
        console.error("delete space failed", (err as Error).name);
        setSaid("That didn’t delete. Try again.");
      }
    });
  }

  return (
    <header className="garden-head space-head">
      <h1 ref={heading} id="space-h" tabIndex={-1}>{space.name}</h1>
      {space.name !== space.sentence && <p className="space-sentence">Fills from “{space.sentence}”</p>}
      <p role="status" className="visually-hidden">{said}</p>

      {mode === "view" && (
        <div className="space-tools">
          <button ref={renameBtn} type="button" className="link-btn" onClick={() => setMode("rename")}>Rename</button>
          <button ref={deleteBtn} type="button" className="link-btn" onClick={() => setMode("delete")}>Delete</button>
        </div>
      )}

      {mode === "rename" && (
        <form
          className="space-rename"
          action={rename}
          onKeyDown={(e) => e.key === "Escape" && close("rename")}
        >
          <label htmlFor="space-name" className="visually-hidden">New name for this Space</label>
          <input id="space-name" name="name" defaultValue={space.name} required maxLength={200} autoComplete="off" autoFocus />
          <div className="space-tools">
            <button type="submit" className="link-btn link-btn--keep" disabled={pending}>Save name</button>
            <button type="button" className="link-btn" onClick={() => close("rename")}>Cancel</button>
          </div>
        </form>
      )}

      {mode === "delete" && (
        <div className="space-confirm" role="group" aria-labelledby="space-confirm-q">
          <p id="space-confirm-q">Delete this Space? Its ideas and tips stay in your garden.</p>
          <div className="space-tools">
            {/* focus lands on the safe choice */}
            <button type="button" className="link-btn" autoFocus onClick={() => close("delete")}>Cancel</button>
            <button type="button" className="link-btn space-btn--danger" disabled={pending} onClick={remove}>Delete Space</button>
          </div>
        </div>
      )}
    </header>
  );
}
