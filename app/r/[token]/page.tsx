import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cardArtworkUrl } from "@/agent/lib/garden/cards";
import { getPublicReceipt } from "@/agent/lib/recs/receipts";
import "../../receipts/receipts.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "A thank-you", robots: { index: false, follow: false } };

// Public, no account: the unguessable token is the only key. Shows the approved note and the item, never the excerpt.
export default async function ReceiptCard({ params }: { params: Promise<{ token: string }> }) {
  const receipt = await getPublicReceipt((await params).token);
  if (!receipt) notFound();
  const image = cardArtworkUrl(receipt.imageUrl, 320);
  return (
    <main className="receipt-card">
      <h1 className="visually-hidden">A thank-you note</h1>
      <p className="receipt-message">{receipt.message}</p>
      <figure>
        {image && <img src={image} alt="" referrerPolicy="no-referrer" width={160} height={160} />}
        <figcaption>
          <strong>{receipt.name}</strong>
          {receipt.creator && <span> · {receipt.creator}</span>}
        </figcaption>
      </figure>
      <p className="receipt-footer">Sent with Earmark</p>
    </main>
  );
}
