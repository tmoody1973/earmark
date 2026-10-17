import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishState, spaceUrl } from "@/agent/lib/spaces/publish";
import { requireOwner } from "@/app/gardeners/owner";
import { PublishPanel } from "./PublishPanel";
import "@/app/receipts/receipts.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Publish a Space · Earmark", robots: { index: false, follow: false } };

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOwner();
  } catch {
    notFound(); // non-owners get a 404, as on /receipts
  }
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const state = await getPublishState(id);
  if (!state) notFound();
  return (
    <main className="receipts">
      <p><Link href={`/spaces/${id}`}>Back to {state.name}</Link></p>
      <h1>Publish “{state.name}”</h1>
      <p className="lede">
        Publishing gives this Space a private link that anyone can open on a phone, with no account. Only the tips you
        kept appear there, never ideas, and never anything anyone said. Unpublish and the link stops working.
      </p>
      <PublishPanel
        spaceId={id}
        url={state.token ? spaceUrl(state.token) : null}
        published={state.token !== null}
        indexable={state.indexable}
        people={state.people}
      />
    </main>
  );
}
