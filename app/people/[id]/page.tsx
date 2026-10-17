import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { tasteLine } from "@/agent/lib/garden/ledger";
import { getRecommenderPage } from "@/agent/lib/garden/queries";
import { RecCard } from "@/app/garden/cards/RecCard";
import { Icon } from "@/app/garden/cards/icons";
import { TabBar } from "@/app/garden/TabBar";
import "@/app/garden/shell.css";
import "@/app/garden/people.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// Owner only: a stranger gets the same answer as a missing person (proxy.ts refuses them first; this is the
// backstop). cache(): the tab title and the page share one read per request.
const loadPerson = cache(async (id: string) => {
  const { userId } = await auth();
  if (!isOwner(userId)) return null;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return getRecommenderPage(n);
});

// The tab says who: their first name, and nothing to anyone else.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadPerson((await params).id);
  return { title: `${page?.person.firstName ?? "Person"} · Earmark` };
}

// One recommender's tips as shelf cards, under a quiet summary of what became of them. First name only: no photo,
// no surname, no contact details. The owner and the unknown recommender have no page (getRecommenderPage → null).
export default async function PersonPage({ params }: Props) {
  const page = await loadPerson((await params).id);
  if (!page) notFound();
  const { person, recs } = page;

  return (
    <>
      <TabBar />
      <main className="garden" id="person">
        <Link href="/people" className="person-back">
          <Icon name="back" size={20} />
          People
        </Link>
        <header className="garden-head person-head">
          <h1>{person.firstName}</h1>
          <p>{tasteLine(person)}</p>
        </header>
        <section className="zone" aria-labelledby="person-tips-h">
          <h2 id="person-tips-h" className="visually-hidden">Tips from {person.firstName}</h2>
          <ul className="shelf-grid">
            {recs.map((c) => (
              <li key={c.id}>
                {/* On their own page every card is theirs: "from Ann" would only repeat the heading. */}
                <RecCard card={{ ...c, recommender: null }} />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
