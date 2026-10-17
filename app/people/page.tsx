import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { getTasteLedger } from "@/agent/lib/garden/queries";
import { LedgerRow, UnknownRow } from "../garden/LedgerRow";
import { TabBar } from "../garden/TabBar";
import "../garden/shell.css";
import "../garden/people.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "People · Earmark" };

// The taste ledger (M4-T5): everyone who gave Tarik a tip, most recent first. First names only, real counts only.
export default async function PeoplePage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const { people, unknown } = await getTasteLedger();
  return (
    <>
      <TabBar />
      <main className="garden" id="people">
        <header className="garden-head">
          <h1>People</h1>
        </header>
        <section className="zone" aria-labelledby="people-h">
          <h2 id="people-h" className="visually-hidden">Who gave you tips</h2>
          {people.length === 0 && (
            <p className="empty">
              No one here yet. When a friend gives you a tip, say “Earmark that, Ann’s ramen spot” to your Bee. Ann
              shows up here with everything she has recommended, and what you made of it.
            </p>
          )}
          {(people.length > 0 || unknown > 0) && (
            <ul className="ledger">
              {people.map((p) => <LedgerRow key={p.id} person={p} />)}
              {unknown > 0 && <UnknownRow count={unknown} />}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
