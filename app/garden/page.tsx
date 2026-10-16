import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getPlants } from "@/agent/lib/garden/queries";
import { IdeaBed } from "./IdeaPlant";
import { TabBar } from "./TabBar";
import "./shell.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ideas · Earmark" };

// Every idea still growing, in garden order. Dismissed ideas are not listed; each keeps its own page.
export default async function GardenPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const plants = await getPlants();
  return (
    <>
      <main className="garden" id="ideas">
        <header className="garden-head">
          <h1>Ideas</h1>
          <p><Link href="/">Back to the garden</Link></p>
        </header>
        <section className="zone" aria-labelledby="all-ideas-h">
          <h2 id="all-ideas-h" className="visually-hidden">Every idea</h2>
          {plants.length === 0 ? <p className="empty">Nothing has taken root yet.</p> : <IdeaBed plants={plants} />}
        </section>
      </main>
      <TabBar />
    </>
  );
}
