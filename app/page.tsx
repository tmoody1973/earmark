import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { listGardenItems, type GardenItem } from "@/agent/lib/store/garden";
import { BloomTicker } from "./bloom-ticker";

// M1 scaffold — replaced by the M4 Impeccable build.
export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = {
  compost: "compost",
  sprouting: "sprouting",
  ready: "ready to bloom",
  drafted: "drafted",
  used: "used",
};

type Idea = Extract<GardenItem, { kind: "idea" }>;
type Rec = Extract<GardenItem, { kind: "rec" }>;

export default async function Garden() {
  // Defence in depth: proxy.ts already refuses non-owners, but the data read must not depend on the matcher alone.
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const items = await listGardenItems(50);
  const ideas = items.filter((i): i is Idea => i.kind === "idea");
  const recs = items.filter((i): i is Rec => i.kind === "rec");
  return (
    <main className="garden">
      <header>
        <h1>Earmark</h1>
        <p>What you keep saying, and what people told you to try.</p>
      </header>
      <BloomTicker />

      <section aria-labelledby="ideas-h">
        <h2 id="ideas-h">Ideas</h2>
        {ideas.length === 0 ? (
          <p className="empty">
            Nothing has taken root yet. Once Earmark is listening, the things you keep saying will gather here.
          </p>
        ) : (
          <ul>
            {ideas.map((i) => (
              <li key={`idea-${i.id}`}>
                <strong>{i.title}</strong>
                <span className="meta">
                  {STAGE[i.stage] ?? i.stage} · {i.mentions} {i.mentions === 1 ? "mention" : "mentions"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recs-h">
        <h2 id="recs-h">Heard from friends</h2>
        {recs.length === 0 ? (
          <p className="empty">
            The shelf is empty for now. When someone tells you about something worth trying, it will land here with their name on it.
          </p>
        ) : (
          <ul>
            {recs.map((r) => (
              <li key={`rec-${r.id}`}>
                <strong>{r.name}</strong>
                <span className="meta">
                  {r.type.replace("_", "/")} · {r.recommender ? `from ${r.recommender}` : "from someone, not sure who"}
                  {r.status === "needs_review" && " · waiting for your say-so"}
                </span>
                <blockquote>{r.excerpt}</blockquote>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
