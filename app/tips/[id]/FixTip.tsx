"use client";
import { useState, useTransition, type FormEvent } from "react";
import type { TipFix } from "@/agent/lib/recs/fix-tip";
import type { RecType } from "@/agent/lib/types";
import { fixTip } from "./actions";

// "Fix this tip" (decision 049): the owner's words for the name, maker, type and note. Only the fields changed here are
// sent, so an untouched field never starts a new lookup. What Bee heard (the quote) is not a field: it stays as said.

export interface FixTipValues { name: string; creator: string | null; type: RecType; note: string | null }

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
    setSaid(""); // clear first, so the same message twice is announced again
    if (Object.keys(fix).length === 0) return setSaid("Nothing to change.");
    startTransition(async () => {
      try {
        const r = await fixTip(tipId, fix);
        if ("refused" in r) return setSaid(r.refused);
        setSaid(r.requeued ? "Saved. Looking it up again — check back in about 10 minutes." : "Saved.");
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
        <button type="submit" className="idea-action" disabled={pending}>Save</button>
      </form>
      <p role="status" className="idea-action-status which-status">{pending ? "Working…" : said}</p>
    </details>
  );
}
