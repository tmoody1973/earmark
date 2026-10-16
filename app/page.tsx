import Link from "next/link";
import { after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getGardenView, getGardenVisit, saveGardenVisit } from "@/agent/lib/garden/queries";
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

export default async function Garden() {
  // Defence in depth: proxy.ts already refuses non-owners, but the data read must not depend on the matcher alone.
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const visit = nextVisit(await getGardenVisit(), new Date());
  const view = await getGardenView(visit.since);
  after(() => saveGardenVisit(visit.next)); // "last time" moves only once this render is on its way
  const plants = view.plants.slice(0, IDEAS_ON_HOME);
  const shelf = view.shelf.slice(0, SHELF_ON_HOME);
  const index = [
    ...plants.map((p) => ({ key: `idea-${p.id}`, fields: [p.title] })),
    ...shelf.map((c) => ({ key: `rec-${c.id}`, fields: [c.name, c.recommender?.firstName] })),
    ...view.newChips.map((c) => ({ key: c.key, fields: [c.title, c.meta] })),
  ];
  return (
    <>
      <main className="garden garden--home" id="garden">
        <GardenLive initialSince={view.serverTime} onPage={plants.map((p) => [p.id, p.level] as const)}>
          <header className="garden-head">
            <div>
              <h1>Earmark</h1>
              <p>Small moments. A bigger mind.</p>
            </div>
            <Icon name="sprout" size={30} className="garden-mark" />
          </header>
          <SearchField index={index} />
          <NewRow chips={view.newChips} />

          {/* Zone 1 — the garden of ideas: bloomed and newly grown first (gardenOrder). */}
          <section className="zone" aria-labelledby="ideas-h">
            <div className="zone-head">
              <h2 id="ideas-h">Ideas</h2>
              {view.plants.length > IDEAS_ON_HOME && <Link href="/garden">See all</Link>}
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
              {view.shelf.length > SHELF_ON_HOME && <Link href="/shelf">See all</Link>}
            </div>
            <Shelf cards={shelf} />
          </section>
        </GardenLive>
      </main>
      <TabBar />
    </>
  );
}
