import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ownerDisplayName } from "@/agent/lib/env";
import { getPublishedSpace, rangeLabel } from "@/agent/lib/spaces/publish";
import { RecCard } from "@/app/garden/cards/RecCard";
import "@/app/garden/shell.css";
import "@/app/garden/cards/cards.css";
import "./public-space.css";

// A published Space (FR-42): link-only, read-only, no account, no audio, no tracking. Reads live on every request, so an
// unpublish or a removed tip takes effect at once. Who and what may appear is decided in agent/lib/spaces/publish.ts.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };
const load = cache(async (token: string) => {
  try {
    return await getPublishedSpace(token);
  } catch (err) {
    console.error("published space read failed", (err as Error).name); // never the token
    throw err;
  }
});

const picks = (n: number) => `${n} ${n === 1 ? "pick" : "picks"}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const space = await load((await params).token);
  if (!space) return { title: "No longer shared", robots: { index: false, follow: false } };
  const art = space.tips.find((t) => t.imageUrl)?.imageUrl;
  const description = picks(space.tips.length);
  return {
    title: space.name,
    description,
    robots: space.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: space.name, description, type: "website", ...(art ? { images: [{ url: art }] } : {}) },
    twitter: { card: art ? "summary_large_image" : "summary", title: space.name, description, ...(art ? { images: [art] } : {}) },
  };
}

export default async function PublishedSpacePage({ params }: Props) {
  const space = await load((await params).token);
  if (!space) notFound();
  const by = ownerDisplayName();
  const range = rangeLabel(space.dates);
  return (
    <main className="garden pub-space" id="space">
      <header className="garden-head">
        <h1>{space.name}</h1>
        {space.ruleSentence !== space.name && <p className="pub-sentence">{space.ruleSentence}</p>}
        {by && <p>Collected by {by}</p>}
        {space.tips.length > 0 && <p className="pub-meta">{[picks(space.tips.length), range].filter(Boolean).join(" · ")}</p>}
      </header>
      {space.tips.length === 0 ? (
        <p className="empty pub-empty">Nothing here yet</p>
      ) : (
        <>
          <h2 className="visually-hidden">Picks</h2>
          <ul className="shelf-grid">
            {space.tips.map((tip) => (
              <li key={tip.id} className="space-item">
                <RecCard card={tip} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
