import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { listSpaces, spaceCounts } from "@/agent/lib/garden/spaces";
import { Icon } from "../garden/cards/icons";
import { NewSpaceForm } from "../garden/NewSpaceForm";
import { TabBar } from "../garden/TabBar";
import "../garden/shell.css";
import "../garden/people.css";
import "./spaces.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spaces · Earmark" };

// Smart Spaces (M4-T7, FR-32): describe a collection in one sentence; Earmark fills it. A list like People: one
// surface, hairline rows, the name in the serif. No orange (it means new and bloomed).
export default async function SpacesPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const spaces = await listSpaces();
  return (
    <>
      <TabBar />
      <main className="garden" id="spaces">
        <header className="garden-head">
          <h1>Spaces</h1>
        </header>
        <NewSpaceForm />
        <section className="zone" aria-labelledby="spaces-h">
          <h2 id="spaces-h" className="visually-hidden">Your Spaces</h2>
          {spaces.length === 0 ? (
            <p className="empty">
              No Spaces yet. Describe one above, like “Books to give my dad” or “Radio segment ideas”, and Earmark
              gathers everything you’ve kept that fits.
            </p>
          ) : (
            <ul className="ledger">
              {spaces.map((s) => (
                <li key={s.id} className="ledger-row" data-testid="space-row">
                  <Link className="ledger-link" href={`/spaces/${s.id}`}>
                    <span className="ledger-text">
                      <span className="ledger-name">{s.name}</span>
                      <span className="ledger-taste">{spaceCounts(s)}</span>
                      {s.name !== s.sentence && <span className="ledger-latest">Fills from “{s.sentence}”</span>}
                    </span>
                    <Icon name="chevron" size={20} className="ledger-chev" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
