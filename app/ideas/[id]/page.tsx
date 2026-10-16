import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { isOwner } from "@/agent/lib/owner";
import { getIdeaDetail, markIdeaViewed } from "@/agent/lib/garden/queries";
import { toBloom } from "@/agent/lib/garden/plant";
import { growthSteps, heardLine } from "@/agent/lib/garden/timeline";
import { PlantArt } from "@/app/garden/PlantArt";
import { Icon } from "@/app/garden/cards/icons";
import { CopyButton } from "./CopyButton";
import { Draft } from "./Draft";
import "@/app/garden/cards/cards.css";
import "@/app/garden/ideas.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Idea · Earmark" };

const FORMAT_LABEL: Record<string, string> = {
  newsletter_pitch: "Newsletter pitch",
  radio_segment: "Radio segment",
  product_brief: "Product brief",
};

const notionUrl = (pageId: string) => `https://www.notion.so/${pageId.replaceAll("-", "")}`;

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  // Owner only: a stranger gets the same 404 as a missing idea (proxy.ts refuses them first; this is the backstop).
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const { id } = await params;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) notFound();
  const idea = await getIdeaDetail(n);
  if (!idea) notFound();
  after(() => markIdeaViewed(n));

  const { plant } = idea;
  const dismissed = plant.stage === "dismissed";
  const steps = growthSteps(idea.timeline, idea.mentions);
  const stillToBloom = plant.stage === "compost" || plant.stage === "sprouting" ? toBloom(plant.mentionCount) : 0;
  const [stageWord, ...meta] = heardLine({
    stage: plant.stage, mentionCount: plant.mentionCount, first: idea.firstMentionedAt, last: plant.lastMentionedAt,
  }).split(" · ");

  return (
    <main className={`idea-page${dismissed ? " idea-page--dismissed" : ""}`} id="idea">
      <Link href="/" className="idea-back">
        <Icon name="back" size={20} />
        Garden
      </Link>

      <header className="idea-head">
        <PlantArt plant={plant} size="lg" />
        <h1>{plant.title}</h1>
        <p className="idea-meta">
          {plant.bloomed && <span className="bloom-dot" aria-hidden="true" />}
          <span className="idea-stage">{stageWord}</span>
          {/* each part stays whole ("last Oct 16" never splits); lines break only at the separators */}
          {meta.map((m) => <Fragment key={m}>{" · "}<span className="idea-meta-part">{m}</span></Fragment>)}
        </p>
        {!plant.confirmed && <span className="rec-unconfirmed">Unconfirmed</span>}
        {/* TODO(M3): Restore (un-dismiss) once an idea action exists; until then the page only says so. */}
        {dismissed && <p className="idea-note">You dismissed this idea. It stays here, greyed out, so nothing is lost.</p>}
        {/* TODO(M4-T9): Top of Mind pin toggle. */}
      </header>

      <section className="idea-panel" aria-labelledby="grew-h">
        <h2 id="grew-h">How it grew</h2>
        {steps.length > 0 && (
          <ol className="growth">
            {steps.map((s) => (
              <li key={s.key} data-date={s.date} className={s.unconfirmed ? "is-unconfirmed" : undefined}>
                {s.excerpt ? (
                  <details>
                    <summary className="growth-step">
                      <Step step={s} expandable />
                    </summary>
                    <blockquote>“{s.excerpt}”</blockquote>
                  </details>
                ) : (
                  <div className="growth-step"><Step step={s} /></div>
                )}
              </li>
            ))}
          </ol>
        )}
        {stillToBloom > 0 && (
          <p className="idea-quiet">{stillToBloom === 1 ? "One more mention" : "Two more mentions"} and it blooms.</p>
        )}
      </section>

      {idea.draftMd ? (
        <section className="idea-panel" aria-labelledby="draft-h">
          <div className="draft-head">
            <h2 id="draft-h">The one-pager</h2>
            {idea.draftFormat && FORMAT_LABEL[idea.draftFormat] && (
              <span className="draft-format"><Icon name="other" size={15} />{FORMAT_LABEL[idea.draftFormat]}</span>
            )}
          </div>
          <Draft md={idea.draftMd} />
          <div className="draft-actions">
            <CopyButton text={idea.draftMd} />
            {idea.notionPageId && (
              <a className="idea-action" href={notionUrl(idea.notionPageId)} rel="noopener noreferrer" target="_blank">
                <Icon name="external" size={18} />
                Open in Notion
              </a>
            )}
            {/* TODO(M3): "Mark as used" once an action moves an idea to used; omitted rather than shown inert. */}
          </div>
        </section>
      ) : (
        plant.bloomed && (
          <section className="idea-panel" aria-labelledby="draft-h">
            <h2 id="draft-h">The one-pager</h2>
            <p className="idea-quiet">Earmark writes a one-page draft when an idea blooms. This one isn’t written yet.</p>
          </section>
        )
      )}
      {/* Backlinks (M4-T6) render here once the links table has rows for this idea. */}
    </main>
  );
}

function Step({ step, expandable = false }: { step: ReturnType<typeof growthSteps>[number]; expandable?: boolean }) {
  return (
    <>
      <time className="growth-date" dateTime={step.date}>{step.dateLabel}</time>
      <span className="growth-note">{step.note}</span>
      {(step.source || step.unconfirmed || expandable) && (
        <span className="growth-src">
          {[step.source, step.unconfirmed && "Unconfirmed"].filter(Boolean).join(" · ")}
          {expandable && <Icon name="chevron" size={16} />}
          {expandable && <span className="visually-hidden">, show what was said</span>}
        </span>
      )}
    </>
  );
}
