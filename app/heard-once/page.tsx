import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getHeardOnce } from "@/agent/lib/garden/quiet-ideas";
import { TabBar } from "../garden/TabBar";
import { HeardOnceList } from "./HeardOnceList";
import "../garden/shell.css";
import "../garden/cards/cards.css";
import "../heard/heard.css";

export const dynamic = "force-dynamic";
// No count here or anywhere (decision 055, as 052): a quiet list, never a badge.
export const metadata: Metadata = { title: "Heard once · Earmark" };

// Owner only, like /heard: proxy.ts refuses strangers first; this is the backstop.
export default async function HeardOncePage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const items = await getHeardOnce();
  return (
    <>
      <TabBar />
      <main className="garden heard-page" id="heard-once">
        <header className="garden-head">
          <h1 id="heard-once-title">Heard once</h1>
          <p>Ideas Earmark heard just once, nearby — often a show, a video or an ad. If one comes up again, it grows in your garden on its own. Keep one to put it there now.</p>
        </header>
        <HeardOnceList items={items} emptyFocusId="heard-once-title" />
      </main>
    </>
  );
}
