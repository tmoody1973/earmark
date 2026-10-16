import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getGardenView } from "@/agent/lib/garden/queries";
import { BloomTicker } from "./bloom-ticker";
import { Shelf } from "./garden/Shelf";

export const dynamic = "force-dynamic";

// The garden shows the newest few of each zone; the tab pages hold the rest.
const SHELF_ON_HOME = 6;

const STAGE: Record<string, string> = {
  compost: "compost",
  sprouting: "sprouting",
  ready: "ready to bloom",
  drafted: "drafted",
  used: "used",
};

export default async function Garden() {
  // Defence in depth: proxy.ts already refuses non-owners, but the data read must not depend on the matcher alone.
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const renderedAt = new Date().toISOString(); // before the read: the ticker picks up anything saved after it
  const { plants, shelf } = await getGardenView();
  return (
    <main className="garden" id="garden">
      <header className="garden-head">
        <h1>Earmark</h1>
        <p>Small moments. A bigger mind.</p>
      </header>
      <BloomTicker since={renderedAt} />

      {/* Zone 1 — ideas. Plain list until the plant cards land (M4-T3). */}
      <section className="zone" aria-labelledby="ideas-h">
        <div className="zone-head"><h2 id="ideas-h">Ideas</h2></div>
        {plants.length === 0 ? (
          <p className="empty">
            Nothing has taken root yet. Once Earmark is listening, the things you keep saying will gather here.
          </p>
        ) : (
          <ul className="ideas">
            {plants.map((p) => (
              <li key={p.id}>
                <strong>{p.title}</strong>
                <span className="meta">
                  {STAGE[p.stage] ?? p.stage} · {p.mentionCount} {p.mentionCount === 1 ? "mention" : "mentions"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Zone 2 — the shelf of tips. */}
      <section className="zone" aria-labelledby="shelf-h">
        <div className="zone-head">
          <h2 id="shelf-h">Shelf</h2>
          {shelf.length > SHELF_ON_HOME && <Link href="/shelf">See all</Link>}
        </div>
        <Shelf cards={shelf.slice(0, SHELF_ON_HOME)} />
      </section>
    </main>
  );
}
