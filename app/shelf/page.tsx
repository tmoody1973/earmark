import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getGardenView } from "@/agent/lib/garden/queries";
import { Shelf } from "../garden/Shelf";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shelf · Earmark" };

export default async function ShelfPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const { shelf } = await getGardenView();
  return (
    <main className="garden" id="shelf">
      <header className="garden-head">
        <h1>Shelf</h1>
        <p><Link href="/">Back to the garden</Link></p>
      </header>
      <section className="zone" aria-label="Tips">
        <Shelf cards={shelf} />
      </section>
    </main>
  );
}
