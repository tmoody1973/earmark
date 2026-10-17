"use client";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { stableOrder, type DrawnPlant } from "@/agent/lib/garden/live";
import type { PlantView } from "@/agent/lib/garden/queries";
import { isBloomed, stageLabel } from "@/agent/lib/garden/plant";
import { PlantArt } from "./PlantArt";
import { FLOWER_OPENS_MS, playBloom, prefersReducedMotion } from "./bloom-motion";
import { Findable, useLive, usePlantPatch } from "./live";
import "./cards/cards.css"; // the shared "Unconfirmed" pill
import "./ideas.css";

export interface IdeaPlantProps { plant: PlantView; href: string }

/** One idea in the garden: its plant, its title in the serif, the stage and count, and the newest timeline line. */
export function IdeaPlant({ plant: served, href }: IdeaPlantProps) {
  const patch = usePlantPatch(served.id);
  const settle = useLive()?.settle;
  const svg = useRef<SVGSVGElement>(null);
  const plant = patch
    ? { ...served, stage: patch.stage, level: patch.level, mentionCount: patch.mentionCount, bloomed: isBloomed(patch.stage) }
    : served;
  const bloomFrom = patch?.bloomFrom ?? null;
  // During a bloom the card keeps saying what it said ("Sprouting · 2 mentions") until the flower starts to open.
  const [revealed, setRevealed] = useState<DrawnPlant | null>(null);
  const meta = bloomFrom && revealed !== bloomFrom ? { ...bloomFrom, bloomed: false } : plant;

  // Before paint, so the first frame is the old plant, not the finished bloom. Reduced motion: the final state at once.
  useLayoutEffect(() => {
    if (!bloomFrom || !svg.current || !settle) return;
    if (prefersReducedMotion()) return settle(served.id);
    let live = true;
    const reveal = window.setTimeout(() => setRevealed(bloomFrom), FLOWER_OPENS_MS);
    void playBloom(svg.current).then(() => live && settle(served.id));
    return () => {
      live = false;
      window.clearTimeout(reveal);
    };
  }, [bloomFrom, settle, served.id]);

  const titleId = `idea-${plant.id}-title`;
  const classes = ["idea-card", !plant.confirmed && "idea-card--unconfirmed", bloomFrom && "idea-card--blooming"];
  return (
    <article className={classes.filter(Boolean).join(" ")} aria-labelledby={titleId}>
      <PlantArt plant={plant} size="sm" decorative bloomFrom={bloomFrom?.level ?? null} svgRef={svg} />
      <div className="idea-card-body">
        <h3 className="idea-title" id={titleId}>
          <Link className="idea-link" href={href}>{plant.title}</Link>
        </h3>
        <p className="idea-meta">
          {meta.bloomed && <span className="bloom-dot" aria-hidden="true" />}
          <span className="idea-stage">{stageLabel(meta.stage)}</span>
          {` · ${meta.mentionCount} ${meta.mentionCount === 1 ? "mention" : "mentions"}`}
        </p>
        {plant.latestLine && <p className="idea-line">{plant.latestLine}</p>}
        {/* TODO(M3): Keep / Dismiss for unconfirmed ideas once an idea review action exists. */}
        {!plant.confirmed && <span className="rec-unconfirmed">Unconfirmed</span>}
      </div>
    </article>
  );
}

/** The garden of ideas, in garden order; on the live home page, in the order this visit began with (stableOrder). */
export function IdeaBed({ plants }: { plants: PlantView[] }) {
  const shown = useLive()?.shown;
  const byId = new Map(plants.map((p) => [p.id, p]));
  const ordered = shown ? stableOrder(plants.map((p) => p.id), shown).map((id) => byId.get(id)!) : plants;
  return (
    <ul className="idea-bed">
      {ordered.map((p) => (
        <Findable key={p.id} fields={[p.title]}>
          <IdeaPlant plant={p} href={`/ideas/${p.id}`} />
        </Findable>
      ))}
    </ul>
  );
}
