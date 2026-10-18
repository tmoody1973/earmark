import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getGardenView, getGardenVisit, getMaybeTips } from "@/agent/lib/garden/queries";
import { getSerendipity } from "@/agent/lib/garden/serendipity";
import { nextVisit } from "@/agent/lib/garden/visit";
import { Icon } from "./garden/cards/icons";
import { IdeaBed } from "./garden/IdeaPlant";
import { GardenLive } from "./garden/live";
import { MaybeRow } from "./garden/MaybeRow";
import { NewRow } from "./garden/NewRow";
import { SearchField } from "./garden/SearchField";
import { Serendipity } from "./garden/Serendipity";
import { Shelf } from "./garden/Shelf";
import { TabBar } from "./garden/TabBar";
import "./garden/shell.css";

export const dynamic = "force-dynamic";

// The garden shows the first few of each zone; the tab pages hold the rest.
const SHELF_ON_HOME = 6;
const IDEAS_ON_HOME = 6;
const MAYBE_ON_HOME = 4;

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
  const [view, maybe] = await Promise.all([getGardenView(since), getMaybeTips()]);
  const plants = view.plants.slice(0, IDEAS_ON_HOME);
  const shelf = view.shelf.slice(0, SHELF_ON_HOME);
  // After the garden read, so Serendipity never repeats a card already on this page.
  // ponytail: one extra round trip (two indexed reads) after the Promise.all; fold it in if Home ever feels slow.
  const pick = await getSerendipity(new Date(), [
    ...plants.map((p) => ({ type: "idea" as const, id: p.id })),
    ...shelf.map((c) => ({ type: "rec" as const, id: c.id })),
  ]);
  const maybes = maybe.tips.slice(0, MAYBE_ON_HOME);
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
            <div className="garden-head-side">
              <Link className="garden-about" href="/about">About</Link>
              <Icon name="sprout" size={30} className="garden-mark" />
            </div>
          </header>
          <SearchField index={index} />
          <NewRow chips={view.newChips} />

          {/* Zone 1 — the garden of ideas: bloomed and newly grown first (gardenOrder). */}
          <section className="zone" aria-labelledby="ideas-h">
            <div className="zone-head">
              <h2 id="ideas-h">Garden</h2>
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

          {/* Below the sure tips: the ones Earmark wasn't sure about (decision 025). Hidden when there are none. */}
          {/* ponytail: maybes stay out of the search index; add them if he ever searches for one. */}
          <MaybeRow
            tips={maybes}
            more={maybe.tips.length - maybes.length + maybe.more}
            moreHref="/shelf#maybe"
            emptyFocusId="shelf-h"
          />

          {/* Last and quiet: one thing that has gone unheard for a while (decision 029). Hidden when there is none. */}
          <Serendipity pick={pick} />
        </GardenLive>
      </main>
    </>
  );
}
