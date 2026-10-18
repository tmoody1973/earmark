import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { HIDDEN_TIP_STATUSES } from "@/agent/lib/garden/queries";
import { getTipDetail } from "@/agent/lib/garden/tip-detail";
import { TIMELINE_TZ } from "@/agent/lib/ideas/timeline-format";
import { Artwork } from "@/app/garden/cards/Artwork";
import { Icon } from "@/app/garden/cards/icons";
import { cardSubline, TYPE_LABEL } from "@/app/garden/cards/RecCard";
import { TipCard, TipMenu, TipTag } from "@/app/garden/cards/TipActions";
import { TabBar } from "@/app/garden/TabBar";
import { Credits } from "./Credits";
import { VideoPlayer } from "./VideoPlayer";
import "@/app/garden/shell.css";
import "@/app/garden/people.css";
import "@/app/garden/cards/cards.css";
import "@/app/garden/ideas.css";
import "../tips.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

// Owner only: a stranger gets the same answer as a missing tip (proxy.ts refuses them first; this is the backstop).
// cache(): the tab title and the page share one read per request.
const loadTip = cache(async (id: string) => {
  const { userId } = await auth();
  if (!isOwner(userId)) return null;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return getTipDetail(n);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tip = await loadTip((await params).id);
  return { title: `${tip?.card.name ?? "Tip"} · Earmark` };
}

const saidOn = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TIMELINE_TZ }).format(new Date(iso));
const published = (b: { firstPublished: string | null; pages: number | null }) =>
  [b.firstPublished && `First published ${b.firstPublished}`, b.pages && `${b.pages} pages`].filter(Boolean).join(" · ");

// One tip, on its own page (decision 045). Everything here was stored before the page loaded: the extras come from the
// rec lane, and the players load nothing until tapped (audio preload="none"; YouTube only after Play).
export default async function TipPage({ params }: Props) {
  const tip = await loadTip((await params).id);
  if (!tip) notFound();
  const { card, extras } = tip;
  const subline = cardSubline(card);
  // a place with coordinates shows where it is (the OSM tile and pin), not a photo
  const art = card.variant === "map" && card.lat !== null && card.lng !== null ? { ...card, imageUrl: null } : card;
  const note = extras.wiki ?? card.about; // the longer Wikipedia extract when the lane stored one
  const onShelf = !HIDDEN_TIP_STATUSES.includes(card.status);
  const from = card.recommender;

  return (
    <>
      <TabBar />
      <main className="garden tip-page" id="tip">
        <Link href="/shelf" className="person-back">
          <Icon name="back" size={20} />
          Shelf
        </Link>

        <header className="tip-head">
          {card.variant !== "note" && (
            <div className="tip-art">
              {extras.videoId ? (
                <VideoPlayer videoId={extras.videoId} title={card.name}><Artwork card={art} /></VideoPlayer>
              ) : (
                <Artwork card={art} />
              )}
            </div>
          )}
          <p className="rec-type">
            <Icon name={card.type} size={15} />
            {TYPE_LABEL[card.type]}
          </p>
          <h1>{card.name}</h1>
          {subline && <p className="tip-sub">{subline}</p>}
          {tip.links.length > 0 && (
            <ul className="tip-links">
              {tip.links.map((l) => (
                <li key={l.url}>
                  <a className="idea-action" href={l.url} rel="noopener noreferrer" target="_blank">
                    <Icon name="external" size={18} />
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </header>

        <section className="idea-panel" aria-labelledby="said-h">
          <h2 id="said-h" className="tip-said">
            {from ? `From ${from.firstName}, ${saidOn(card.saidAt)}` : `Heard ${saidOn(card.saidAt)}`}
          </h2>
          <blockquote className="tip-quote">“{tip.excerpt}”</blockquote>
          {card.why && <p className="tip-why">{card.why}</p>}
          {note && (
            <p className="tip-about">
              {note.text}{" "}
              <a href={note.url} rel="noopener noreferrer">Wikipedia</a>
            </p>
          )}
        </section>

        {/* The card's own state and "…" (decision 043), only while it's on the shelf: a maybe or a cleared tip can't be
            changed from a card. Thank follows RecCard's rule: loved, and someone (never the owner) to thank. */}
        {onShelf ? (
          <TipCard tip={{ id: card.id, name: card.name, status: card.status, rating: card.rating }} className="tip-status"
            aria-label="Where this tip stands">
            <TipTag status={card.status} rating={card.rating} />
            {card.rating === "loved" && from && <Link className="rec-thank" href={`/receipts/${card.id}`}>Thank {from.firstName}</Link>}
            <TipMenu />
          </TipCard>
        ) : (
          <p className="idea-note">
            {card.status === "needs_review" ? "A maybe: keep it or clear it on Home." : "You cleared this tip. It stays here, so nothing is lost."}
          </p>
        )}

        {(tip.spaces.length > 0 || tip.ideas.length > 0) && (
          <section className="idea-panel" aria-labelledby="conn-h">
            <h2 id="conn-h">Connected</h2>
            <ul className="tip-chips">
              {tip.spaces.map((s) => (
                <li key={`s${s.id}`}>
                  <Link className="link-btn" href={`/spaces/${s.id}`}><Icon name="spaces" size={18} />{s.name}</Link>
                </li>
              ))}
              {tip.ideas.map((i) => (
                <li key={`i${i.id}`}>
                  <Link className="link-btn" href={`/ideas/${i.id}`}><Icon name="sprout" size={18} />{i.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {extras.preview && (
          <section className="idea-panel" aria-labelledby="listen-h">
            <h2 id="listen-h">Have a listen</h2>
            {/* Apple's Search API terms: previews streamed only, next to a link to the store, credited to iTunes */}
            <figure className="tip-audio">
              <audio controls preload="none" src={extras.preview.audioUrl} aria-label={`30-second preview of ${card.name}`} />
              <figcaption>
                30-second preview, provided courtesy of iTunes.{" "}
                <a href={extras.preview.appleUrl} rel="noopener noreferrer" target="_blank">Listen on Apple Music</a>
              </figcaption>
            </figure>
          </section>
        )}

        {extras.episodes && (
          <section className="idea-panel" aria-labelledby="eps-h">
            <h2 id="eps-h">Latest episodes</h2>
            <ol className="tip-episodes">
              {extras.episodes.map((e) => (
                <li key={e.audioUrl}>
                  <p className="tip-episode-title">{e.title}</p>
                  {e.date && <time className="tip-episode-date" dateTime={e.date}>{saidOn(e.date)}</time>}
                  <audio controls preload="none" src={e.audioUrl} aria-label={`Play ${e.title}`} />
                </li>
              ))}
            </ol>
          </section>
        )}

        {extras.book && (
          <section className="idea-panel" aria-labelledby="book-h">
            <h2 id="book-h">The book</h2>
            {extras.book.description && <p className="tip-book">{extras.book.description}</p>}
            {(extras.book.firstPublished || extras.book.pages) && <p className="idea-quiet">{published(extras.book)} · Open Library</p>}
          </section>
        )}

        {extras.discogs && <Credits discogs={extras.discogs} />}

        {/* TMDB's terms: credit the source and say it isn't endorsed, wherever its film/TV data shows. */}
        {card.type === "film_tv" && (
          <p className="idea-quiet tip-source">
            Film and TV details from <a href="https://www.themoviedb.org/" rel="noopener noreferrer">TMDB</a>. This product
            uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        )}
      </main>
    </>
  );
}
