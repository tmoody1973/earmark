"use client";
import { useState, useTransition, type FormEvent } from "react";
import type { TipFix } from "@/agent/lib/recs/fix-tip";
import type { RecType } from "@/agent/lib/types";
import { fixTip, linkTip } from "./actions";
import { linkChanged as changedLink } from "./link-change";

// "Fix this tip" (decision 049): the owner's words for the name, maker, type and note, and a link to where the thing
// lives. Only the fields changed here are sent, so an untouched field never starts a new lookup (or clears the link).
// The words save first, then the link, which settles the tip as the owner's. What Bee heard (the quote) stays as said.

export interface FixTipValues { name: string; creator: string | null; type: RecType; note: string | null; link: string | null; ownLink: boolean }

const blankIsNull = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

export function FixTip({ tipId, was, types }: { tipId: number; was: FixTipValues; types: Record<RecType, string> }) {
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState("");

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const now = { name: String(form.get("name") ?? "").trim(), creator: blankIsNull(form.get("creator")), type: form.get("type"),
      note: blankIsNull(form.get("note")) };
    const before = { ...was, creator: was.creator?.trim() || null, note: was.note?.trim() || null };
    const fix = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== before[k as keyof FixTipValues])) as TipFix;
    const link = blankIsNull(form.get("link"));
    const linkChanged = changedLink(was, String(form.get("link") ?? ""));
    setSaid(""); // clear first, so the same message twice is announced again
    if (Object.keys(fix).length === 0 && !linkChanged) return setSaid("Nothing to change.");
    startTransition(async () => {
      try {
        let done = "Saved.";
        if (Object.keys(fix).length > 0) {
          const r = await fixTip(tipId, fix);
          if ("refused" in r) return setSaid(r.refused);
          if (r.requeued) done = "Saved. Looking it up again — check back in about 10 minutes.";
        }
        if (linkChanged) {
          const l = await linkTip(tipId, link);
          if ("refused" in l) return setSaid(l.refused);
          done = l.saved === "cleared" ? "Saved. The link is gone." : l.art ? "Saved." : "Saved. That page has no picture to show.";
        }
        setSaid(done);
      } catch (err) {
        console.error("fix-tip failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  };

  const id = (f: string) => `fix-${f}-${tipId}`;
  return (
    <details className="which-fix tip-fix">
      <summary>Fix this tip</summary>
      <form className="tip-fix-form" onSubmit={save}>
        <p className="idea-quiet">What Bee heard stays as it is. Changing the name, by or type looks the tip up again.</p>
        <label htmlFor={id("name")}>Name</label>
        <input id={id("name")} name="name" required maxLength={120} defaultValue={was.name} autoComplete="off" />
        <label htmlFor={id("creator")}>By</label>
        <input id={id("creator")} name="creator" maxLength={120} defaultValue={was.creator ?? ""} autoComplete="off" />
        <label htmlFor={id("type")}>Type</label>
        <select id={id("type")} name="type" defaultValue={was.type}>
          {Object.entries(types).map(([t, label]) => <option key={t} value={t}>{label}</option>)}
        </select>
        <label htmlFor={id("note")}>Note</label>
        <textarea id={id("note")} name="note" maxLength={280} rows={3} defaultValue={was.note ?? ""} />
        <label htmlFor={id("link")}>Link</label>
        <input id={id("link")} name="link" type="url" inputMode="url" maxLength={500} pattern="https://.*" placeholder="https://"
          defaultValue={was.link ?? ""} autoComplete="off" aria-describedby={id("link-hint")} />
        <p id={id("link-hint")} className="idea-quiet">Where it lives: Bandcamp, Apple Music, YouTube or its own website.
          Earmark shows its picture and a button to open it.</p>
        <button type="submit" className="idea-action" disabled={pending}>Save</button>
      </form>
      <p role="status" className="idea-action-status which-status">{pending ? "Working…" : said}</p>
    </details>
  );
}
