"use client";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import type { WhichOneOption, WhichOneView } from "@/agent/lib/garden/which-one";
import type { RecType } from "@/agent/lib/types";
import { Icon } from "@/app/garden/cards/icons";
import { Img } from "@/app/garden/cards/Img";
import { chooseWhichOne, noneOfTheseTip, searchWhichOne } from "./actions";

// "Which one?" (decision 048). Every string from a provider is React text; images are https-only (whichOneView) and
// fall back to the type's glyph. The pick, None and Search re-render the page through revalidatePath.

function Thumb({ option, type }: { option: WhichOneOption; type: RecType }) {
  const glyph = <span className="which-thumb which-thumb--glyph" aria-hidden="true"><Icon name={type} size={22} /></span>;
  if (!option.imageUrl) return glyph;
  return <span className="which-thumb"><Img src={option.imageUrl} alt="" width={56} height={56} fallback={glyph} /></span>;
}

const subline = (o: WhichOneOption) => [o.creator, o.yearOrAddress, o.detail].filter(Boolean).join(" · ");

export function WhichOne({ tipId, type, heading, view }: { tipId: number; type: RecType; heading: string; view: WhichOneView }) {
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState("");

  const run = (work: () => Promise<string>) => {
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      try {
        setSaid(await work());
      } catch (err) {
        console.error("which-one failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  };
  const pick = (index: number) => run(async () => ((await chooseWhichOne(tipId, index)).changed ? "Saved." : "Those options changed. Here are the latest."));
  const none = () => run(async () => ((await noneOfTheseTip(tipId)).changed ? "Got it. Earmark won’t ask again." : "This tip changed. Reload to see it."));
  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "");
    run(async () => {
      const r = await searchWhichOne(tipId, q);
      if (r.refused) return r.refused;
      return r.found ? `Found ${r.found}.` : "Nothing came up for that. Try other words.";
    });
  };

  const options = (
    <ul className="which-options">
      {view.options.map((o) => (
        <li key={o.index} className="which-option">
          <Thumb option={o} type={type} />
          <div className="which-text">
            <p className="which-name">{o.name}</p>
            {subline(o) && <p className="which-sub">{subline(o)}</p>}
          </div>
          <button type="button" className="idea-action which-pick" disabled={pending} onClick={() => pick(o.index)}
            aria-label={`This one: ${[o.name, subline(o)].filter(Boolean).join(", ")}`}>
            This one
          </button>
        </li>
      ))}
    </ul>
  );
  const searchForm: ReactNode = (
    <form className="which-search" onSubmit={search}>
      <label htmlFor={`which-q-${tipId}`} className="visually-hidden">Search with other words</label>
      <input id={`which-q-${tipId}`} name="q" type="search" required minLength={2} maxLength={120} defaultValue={view.query}
        autoComplete="off" enterKeyHint="search" />
      <button type="submit" className="link-btn" disabled={pending}>
        <Icon name="search" size={18} />
        Search again
      </button>
    </form>
  );
  const status = <p role="status" className="idea-action-status which-status">{pending ? "Working…" : said}</p>;

  if (view.mode === "correct") {
    return (
      <details className="which-fix">
        <summary>Not the right one?</summary>
        {view.options.length > 0 && options}
        {searchForm}
        {status}
      </details>
    );
  }
  return (
    <section className="idea-panel which-one" aria-labelledby="which-h">
      <h2 id="which-h">{heading}</h2>
      <p className="idea-quiet">
        {view.options.length > 0 ? "Earmark found more than one thing with this name." : "Nothing came up yet. Try other words."}
      </p>
      {view.options.length > 0 && options}
      <div className="which-more">
        <button type="button" className="link-btn" disabled={pending} onClick={none}>None of these</button>
      </div>
      {searchForm}
      {status}
    </section>
  );
}
