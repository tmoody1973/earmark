import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getSpace } from "@/agent/lib/garden/spaces";
import { Icon } from "@/app/garden/cards/icons";
import { TabBar } from "@/app/garden/TabBar";
import { SpaceHead } from "./SpaceHead";
import { SpaceMembers } from "./SpaceMembers";
import "@/app/garden/shell.css";
import "@/app/garden/people.css";
import "@/app/garden/cards/cards.css";
import "@/app/garden/ideas.css";
import "../spaces.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// Owner only: a stranger gets the same answer as a missing Space (proxy.ts refuses them first; this is the backstop).
// cache(): the tab title and the page share one read per request.
const loadSpace = cache(async (id: string) => {
  const { userId } = await auth();
  if (!isOwner(userId)) return null;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return getSpace(n);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const view = await loadSpace((await params).id);
  return { title: `${view?.space.name ?? "Space"} · Earmark` };
}

// One Space (FR-32): what Earmark put in it, each with Keep / Remove. Jev suggests, Tarik decides; he never files.
export default async function SpacePage({ params }: Props) {
  const view = await loadSpace((await params).id);
  if (!view) notFound();
  return (
    <>
      <TabBar />
      <main className="garden" id="space">
        <Link href="/spaces" className="person-back">
          <Icon name="back" size={20} />
          Spaces
        </Link>
        <SpaceHead space={view.space} />
        <SpaceMembers spaceId={view.space.id} ideas={view.ideas} tips={view.tips} pending={view.space.pending} sortingNow={view.sortingNow} />
      </main>
    </>
  );
}
