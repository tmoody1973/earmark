import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getMaybeTips, getShelf } from "@/agent/lib/garden/queries";
import { MaybeRow } from "../garden/MaybeRow";
import { Shelf } from "../garden/Shelf";
import { TabBar } from "../garden/TabBar";
import "../garden/shell.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shelf · Earmark" };

// The tabs are the way home (no "Back to the garden" link), as on /garden.
// ?rec=<id>: a Bee todo's link (M3-T7) always shows that tip, even past the newest 60.
export default async function ShelfPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const rec = Number((await searchParams).rec);
  const focus = Number.isSafeInteger(rec) && rec > 0 ? rec : undefined;
  const [shelf, maybe] = await Promise.all([getShelf(focus), getMaybeTips()]);
  return (
    <>
      <TabBar />
      <main className="garden" id="shelf">
        <header className="garden-head">
          <h1 id="shelf-title">Shelf</h1>
        </header>
        <section className="zone" aria-labelledby="tips-h">
          <h2 id="tips-h" className="visually-hidden">Every tip</h2>
          <Shelf cards={shelf} />
        </section>
        <MaybeRow tips={maybe.tips} more={maybe.more} emptyFocusId="shelf-title" />
      </main>
    </>
  );
}
