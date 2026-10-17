import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { searchEarmarks, type MemoryCue } from "@/agent/lib/search/memory-cue";
import { parseWhen } from "@/agent/lib/search/when";
import { IdeaBed } from "../garden/IdeaPlant";
import { Shelf } from "../garden/Shelf";
import { TabBar } from "../garden/TabBar";
import "../garden/shell.css";
import "./search.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Look back · Earmark" };

type Params = Record<string, string | string[] | undefined>;
const FIELDS = [
  { name: "who", label: "Who said it", placeholder: "Ann" },
  { name: "where", label: "Where", placeholder: "Brady Street" },
  { name: "when", label: "When", placeholder: "in September, last week" },
  { name: "q", label: "What it was about", placeholder: "the ramen place" },
] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One search for a who / where / when / what cue (memory-cue search, FR-36). A plain GET form: the cue is in the
// URL, so it works without JavaScript and a result page can be shared with yourself.
export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const sp = await searchParams;
  const p = { who: one(sp.who), where: one(sp.where), when: one(sp.when), q: one(sp.q) };
  const asked = Boolean(p.who || p.where || p.when || p.q);
  const range = p.when ? parseWhen(p.when) : null;
  const badWhen = Boolean(p.when && !range);
  return (
    <>
      <TabBar />
      <main className="garden" id="search">
        <header className="garden-head">
          <h1>Look back</h1>
          <p>Who said it, where, when, or what it was about. One clue is enough.</p>
        </header>
        <form method="get" action="/search" className="search-form" role="search" aria-label="Look back through what you heard">
          {FIELDS.map((f) => (
            <label key={f.name}>
              <span>{f.label}</span>
              <input name={f.name} defaultValue={p[f.name]} placeholder={f.placeholder} autoComplete="off"
                aria-invalid={f.name === "when" && badWhen ? true : undefined} />
            </label>
          ))}
          <button type="submit">Look back</button>
        </form>
        {badWhen && (
          <p role="alert" className="search-note">
            Earmark did not understand “{p.when}”. Try “in September”, “last week”, “yesterday” or “2026-09”.
          </p>
        )}
        {asked && !badWhen && (
          <Suspense key={JSON.stringify(p)} fallback={<p role="status" className="search-note">Looking back through your conversations…</p>}>
            <Results cue={{ who: p.who, where: p.where, when: range ?? undefined, query: p.q }} />
          </Suspense>
        )}
      </main>
    </>
  );
}

async function Results({ cue }: { cue: MemoryCue }) {
  const { recs, ideas, neuralFailed } = await searchEarmarks(cue, { useNeural: true });
  return (
    <div>
      {neuralFailed && <p className="search-note">Bee&rsquo;s search did not answer, so these are only words Earmark saved.</p>}
      {recs.length === 0 && ideas.length === 0 ? (
        <p role="status" className="search-note">Nothing matched. Try fewer clues.</p>
      ) : (
        <p className="visually-hidden" role="status">{`Found ${plural(recs.length, "tip")} and ${plural(ideas.length, "idea")}.`}</p>
      )}
      {recs.length > 0 && (
        <section className="zone" aria-labelledby="search-tips-h">
          <div className="zone-head"><h2 id="search-tips-h">Tips</h2></div>
          <Shelf cards={recs} />
        </section>
      )}
      {ideas.length > 0 && (
        <section className="zone" aria-labelledby="search-ideas-h">
          <div className="zone-head"><h2 id="search-ideas-h">Ideas</h2></div>
          <IdeaBed plants={ideas} />
        </section>
      )}
    </div>
  );
}
