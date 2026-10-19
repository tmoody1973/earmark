import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getHeardNearby } from "@/agent/lib/garden/heard";
import { TabBar } from "../garden/TabBar";
import { HeardList } from "./HeardList";
import "../garden/shell.css";
import "../garden/cards/cards.css";
import "./heard.css";

export const dynamic = "force-dynamic";
// No count here or anywhere (decision 052): a quiet log, never a badge.
export const metadata: Metadata = { title: "Heard nearby · Earmark" };

// Owner only, like /tips/[id]: proxy.ts refuses strangers first; this is the backstop.
export default async function HeardPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const items = await getHeardNearby();
  return (
    <>
      <TabBar />
      <main className="garden heard-page" id="heard">
        <header className="garden-head">
          <h1 id="heard-title">Heard nearby</h1>
          <p>Things Earmark heard nearby with no one recommending them to you — videos, ads, podcasts. Keep one to put it on your shelf.</p>
        </header>
        <HeardList items={items} emptyFocusId="heard-title" />
      </main>
    </>
  );
}
