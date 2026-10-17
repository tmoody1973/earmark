import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/agent/lib/db";
import { credit } from "@/agent/lib/garden/queries";
import { requireOwner } from "@/app/gardeners/owner";
import { DeferForm, DraftForm } from "./forms";
import { ShareButton } from "./share-button";
import "../receipts.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thank-you · Earmark" };

export default async function ReceiptPage({ params }: { params: Promise<{ recId: string }> }) {
  try {
    await requireOwner();
  } catch {
    notFound(); // non-owners get a 404, as on /gardeners
  }
  const recId = Number((await params).recId);
  if (!Number.isSafeInteger(recId) || recId <= 0) notFound();
  const [rec] = (await db()`
    select r.canonical_name, r.rating, r.recommender_id, rc.first_name from recommendations r
    left join recommenders rc on rc.id = r.recommender_id where r.id = ${recId}`) as {
    canonical_name: string; rating: string | null; recommender_id: number | string | null; first_name: string | null;
  }[];
  if (!rec) notFound();
  const who = credit({ recommender_id: rec.recommender_id as never, first_name: rec.first_name }); // never the owner
  const canThank = rec.rating === "loved" && !!who;
  const [receipt] = canThank
    ? ((await db()`
        select id, message, approved_at, alarm_at from rec_receipts where recommendation_id = ${recId} order by id desc limit 1`) as {
        id: number | string; message: string; approved_at: string | null; alarm_at: string | null;
      }[])
    : [];
  const at = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  return (
    <main className="receipts">
      <p><Link href="/garden">Back to the garden</Link></p>
      <h1>{who ? `Thank ${who.firstName} for ${rec.canonical_name}` : rec.canonical_name}</h1>
      {!canThank ? (
        <p className="lede">Thank-yous are for loved tips that someone else gave you.</p>
      ) : !receipt ? (
        <>
          <p className="lede">Earmark drafts a short note. You edit it and decide whether to send it. Nothing is shared until you approve.</p>
          <DraftForm recId={recId} />
        </>
      ) : (
        <>
          <section aria-labelledby="r-note">
            <h2 id="r-note">The note</h2>
            <ShareButton recId={recId} receiptId={Number(receipt.id)} initial={receipt.message} name={who.firstName} />
            {receipt.approved_at && <p className="r-meta">Approved {at(receipt.approved_at)}.</p>}
          </section>
          <section aria-labelledby="r-later">
            <h2 id="r-later">Send it later</h2>
            {receipt.alarm_at && <p className="r-meta">Reminder set for {at(receipt.alarm_at)}. Check it off in Bee when you have sent it.</p>}
            <DeferForm recId={recId} receiptId={Number(receipt.id)} />
          </section>
        </>
      )}
    </main>
  );
}
