import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isDemo } from "@/agent/lib/demo";
import { isOwner } from "@/agent/lib/owner";
import { getPlants } from "@/agent/lib/garden/queries";
import { IdeaBed } from "./IdeaPlant";
import { TabBar } from "./TabBar";
import "./shell.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Garden · Earmark" };

// Every idea still growing, in garden order. Dismissed ideas are not listed; each keeps its own page.
// The tabs are the way home (no "Back to the garden" link).
export default async function GardenPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const plants = await getPlants();
  return (
    <>
      <TabBar />
      <main className="garden" id="ideas">
        <header className="garden-head">
          <h1>Garden</h1>
          {/* Heard once (decision 055): ideas overheard once wait there, findable, never pushed. No count. */}
          <span className="garden-head-links">
            <Link href="/gardeners">Gardeners</Link><Link href="/alexa">Alexa+</Link>
            {!isDemo() && <Link href="/music">Apple Music</Link>}<Link href="/heard-once">Heard once</Link>
          </span>
        </header>
        <section className="zone" aria-labelledby="all-ideas-h">
          <h2 id="all-ideas-h" className="visually-hidden">Every idea</h2>
          {plants.length === 0 ? <p className="empty">Nothing has taken root yet.</p> : <IdeaBed plants={plants} />}
        </section>
      </main>
    </>
  );
}
