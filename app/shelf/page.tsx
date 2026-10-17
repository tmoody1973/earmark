import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getShelf } from "@/agent/lib/garden/queries";
import { Shelf } from "../garden/Shelf";
import { TabBar } from "../garden/TabBar";
import "../garden/shell.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shelf · Earmark" };

// The tabs are the way home (no "Back to the garden" link), as on /garden.
export default async function ShelfPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const shelf = await getShelf();
  return (
    <>
      <TabBar />
      <main className="garden" id="shelf">
        <header className="garden-head">
          <h1>Shelf</h1>
        </header>
        <section className="zone" aria-labelledby="tips-h">
          <h2 id="tips-h" className="visually-hidden">Every tip</h2>
          <Shelf cards={shelf} />
        </section>
      </main>
    </>
  );
}
