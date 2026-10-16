import Link from "next/link";
import type { PlantView } from "@/agent/lib/garden/queries";
import { stageLabel } from "@/agent/lib/garden/plant";
import { PlantArt } from "./PlantArt";
import "./cards/cards.css"; // the shared "Unconfirmed" pill
import "./ideas.css";

export interface IdeaPlantProps { plant: PlantView; href: string }

/** One idea in the garden: its plant, its title in the serif, the stage and count, and the newest timeline line. */
export function IdeaPlant({ plant, href }: IdeaPlantProps) {
  const titleId = `idea-${plant.id}-title`;
  const classes = ["idea-card", !plant.confirmed && "idea-card--unconfirmed"];
  return (
    <article className={classes.filter(Boolean).join(" ")} aria-labelledby={titleId}>
      <PlantArt plant={plant} size="sm" decorative />
      <div className="idea-card-body">
        <h3 className="idea-title" id={titleId}>
          <Link className="idea-link" href={href}>{plant.title}</Link>
        </h3>
        <p className="idea-meta">
          {plant.bloomed && <span className="bloom-dot" aria-hidden="true" />}
          <span className="idea-stage">{stageLabel(plant.stage)}</span>
          {` · ${plant.mentionCount} ${plant.mentionCount === 1 ? "mention" : "mentions"}`}
        </p>
        {plant.latestLine && <p className="idea-line">{plant.latestLine}</p>}
        {/* TODO(M3): Keep / Dismiss for unconfirmed ideas once an idea review action exists. */}
        {!plant.confirmed && <span className="rec-unconfirmed">Unconfirmed</span>}
      </div>
    </article>
  );
}

/** The garden of ideas, already in garden order (gardenOrder: bloomed and newly grown first). */
export function IdeaBed({ plants }: { plants: PlantView[] }) {
  return (
    <ul className="idea-bed">
      {plants.map((p) => (
        <li key={p.id}>
          <IdeaPlant plant={p} href={`/ideas/${p.id}`} />
        </li>
      ))}
    </ul>
  );
}
