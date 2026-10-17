import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getGardenView, getGardenVisit } from "@/agent/lib/garden/queries";
import { nextVisit } from "@/agent/lib/garden/visit";
import { Icon } from "./garden/cards/icons";
import { IdeaBed } from "./garden/IdeaPlant";
import { GardenLive } from "./garden/live";
import { NewRow } from "./garden/NewRow";
import { SearchField } from "./garden/SearchField";
import { Shelf } from "./garden/Shelf";
import { TabBar } from "./garden/TabBar";
import "./garden/shell.css";

export const dynamic = "force-dynamic";

// The garden shows the first few of each zone; the tab pages hold the rest.
const SHELF_ON_HOME = 6;
const IDEAS_ON_HOME = 6;

function SeeAll({ href }: { href: string }) {
  return (
    <Link className="see-all" href={href}>
      See all
      <Icon name="chevron" size={16} />
    </Link>
  );
}

export default async function Garden() {
  // Defence in depth: proxy.ts already refuses non-owners, but the data read must not depend on the matcher alone.
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  // Read only: a look is recorded by GardenLive on mount / return to the tab (recordGardenVisit), never by a render.
  const { since } = nextVisit(await getGardenVisit(), new Date());
  const view = await getGardenView(since);
  const plants = view.plants.slice(0, IDEAS_ON_HOME);
  const shelf = view.shelf.slice(0, SHELF_ON_HOME);
  const index = [
    ...plants.map((p) => ({ key: `idea-${p.id}`, fields: [p.title] })),
    ...shelf.map((c) => ({ key: `rec-${c.id}`, fields: [c.name, c.recommender?.firstName] })),
    ...view.newChips.map((c) => ({ key: c.key, fields: [c.title, c.from] })),
  ];
  const onPage = plants.map((p) => [p.id, { level: p.level, stage: p.stage, mentionCount: p.mentionCount }] as const);
  return (
    <>
      <TabBar />
      <main className="garden garden--home" id="garden">
        <GardenLive initialSince={view.serverTime} onPage={onPage}>
          <header className="garden-head">
            <div>
              <h1>Earmark</h1>
              <p>Small moments. A bigger mind.</p>
              <Link className="garden-lookback" href="/search">
                <Icon name="search" size={16} />
                Look back by who, where or when
              </Link>
            </div>
            <Icon name="sprout" size={30} className="garden-mark" />
          </header>
          <SearchField index={index} />
          <NewRow chips={view.newChips} />

          {/* Zone 1 — the garden of ideas: bloomed and newly grown first (gardenOrder). */}
          <section className="zone" aria-labelledby="ideas-h">
            <div className="zone-head">
              <h2 id="ideas-h">Ideas</h2>
              {view.plants.length > IDEAS_ON_HOME && <SeeAll href="/garden" />}
            </div>
            {plants.length === 0 ? (
              <p className="empty">
                Nothing has taken root yet. Once Earmark is listening, the things you keep saying will gather here.
              </p>
            ) : (
              <IdeaBed plants={plants} />
            )}
          </section>

          {/* Zone 2 — the shelf of tips. */}
          <section className="zone" aria-labelledby="shelf-h">
            <div className="zone-head">
              <h2 id="shelf-h">Shelf</h2>
              {view.shelf.length > SHELF_ON_HOME && <SeeAll href="/shelf" />}
            </div>
            <Shelf cards={shelf} />
          </section>
        </GardenLive>
      </main>
    </>
  );
}
