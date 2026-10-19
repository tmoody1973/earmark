"use client";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IdeaResearch, ResearchStatus } from "@/agent/lib/ideas/research";
import { Markdown } from "@/app/gardeners/markdown";
import { Icon } from "@/app/garden/cards/icons";
import { researchIdea } from "./actions";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
const REFRESH_MS = 20_000; // while Earmark researches, the page looks again on its own

/*
 * Research (decision 057): what the web says about this idea, sourced. The brief is model text from fetched pages, so
 * it only ever reaches the page through the safe Markdown renderer (text nodes and https links, new tab), never as HTML.
 * The press shows "Researching…" at once; a refusal ("already researching") is said in words beside the button.
 */
export function Research({ ideaId, research, enabled }: { ideaId: number; research: IdeaResearch | null; enabled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useOptimistic<ResearchStatus | null>(research?.status ?? null);
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState("");
  const working = status === "requested" || status === "running";

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [working, router]);

  if (!enabled && !research) return null;

  const ask = () => {
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      setStatus("requested");
      try {
        const r = await researchIdea(ideaId);
        if (!r.requested) setSaid(r.note ?? "");
      } catch (err) {
        console.error("research request failed", (err as Error).name);
        setSaid("That didn’t go through. Try again.");
      }
    });
  };

  const brief = status === "done" && research?.briefMd ? research.briefMd.replace(/^## /gm, "# ") : null; // h3 under the panel's h2
  return (
    <section className="idea-panel" aria-labelledby="research-h">
      <h2 id="research-h">Research</h2>
      {working ? (
        <p className="idea-quiet research-working" role="status">Researching… usually a few minutes.</p>
      ) : brief ? (
        <>
          <div className="draft research-brief"><Markdown text={brief} /></div>
          {research?.doneAt && <p className="research-date">Researched {DAY.format(new Date(research.doneAt))}</p>}
        </>
      ) : status === "failed" ? (
        <p className="idea-quiet">Couldn’t research this. Try again.</p>
      ) : (
        <p className="idea-quiet">Earmark can search the web and write a short brief with sources: what already exists, who’s doing it, and what’s still open.</p>
      )}
      <div className="draft-actions research-actions">
        {!working && enabled && (
          <button type="button" className="idea-action" onClick={ask} disabled={pending}>
            <Icon name="search" size={18} />
            {status === "done" || status === "failed" ? "Research again" : "Research this"}
          </button>
        )}
        {/* always mounted, so a refusal is announced even as the button comes back */}
        <p role="status" className="idea-action-status">{said}</p>
      </div>
    </section>
  );
}
