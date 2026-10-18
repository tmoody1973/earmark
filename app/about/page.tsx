import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentProps } from "react";
import { Icon } from "../garden/cards/icons";
import "./about.css";

// Public (isPublicPath) and static: nothing here is read from the database, so nobody's tips, ideas or names
// can appear on it. Keep it that way (tests/app/about.test.ts checks the imports).

export const metadata: Metadata = {
  title: "About Earmark",
  description:
    "Earmark listens through a Bee wearable and keeps the ideas you say out loud and the tips friends give you, in a private garden.",
  robots: { index: true, follow: true }, // the root layout says noindex; this page is meant to be found
};

type IconName = ComponentProps<typeof Icon>["name"];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "podcast", title: "Your Bee hears the day", body: "The Bee wearable listens to your conversations, as it already does." },
  { icon: "pin", title: "Earmark notices", body: "It picks out an idea you said out loud, or a tip someone gave you: an album, a book, a place." },
  { icon: "search", title: "It looks things up", body: "Each tip gets its cover, where to find it, and a line about what it is." },
  { icon: "sprout", title: "Into your garden", body: "Ideas grow with each mention and bloom at the third, with a one-page draft. Tips sit on a shelf, with who said them." },
  { icon: "check", title: "Back to your Bee", body: "Tips come back as Bee to-dos, and tastes you confirm become Bee facts." },
];

const KINDS: { icon: IconName; label: string }[] = [
  { icon: "album", label: "Music" },
  { icon: "book", label: "Books" },
  { icon: "video", label: "Films, shows and videos" },
  { icon: "place", label: "Places" },
  { icon: "podcast", label: "Podcasts" },
];

const PRIVACY = [
  "The garden is private: only its owner can sign in and see it.",
  "People are kept by first name only. No contact details, no profiles.",
  "A friend is named on a public page only with their OK.",
  "Quotes are short: 25 words or fewer. Full conversations stay in Bee.",
  "“Forget” deletes everything about an item, everywhere Earmark put it.",
  "Shared pages carry no conversation text, only the item and a note.",
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} rel="noopener noreferrer" target="_blank">{children}</a>;
}

export default function AboutPage() {
  return (
    <main className="garden about" id="about">
      <header className="garden-head">
        <h1>About Earmark</h1>
        <p>Small moments. A bigger mind.</p>
      </header>

      <p className="about-lede">
        Your Bee wearable already hears your best ideas and your friends’ best tips. Earmark keeps both, the ideas
        you say out loud and the things people tell you to try, in a private garden.
      </p>
      <ul className="about-kinds" aria-label="What a tip can be">
        {KINDS.map((k) => (
          <li key={k.label}>
            <Icon name={k.icon} size={22} />
            {k.label}
          </li>
        ))}
      </ul>

      <section className="zone" aria-labelledby="how-h">
        <h2 id="how-h">How it works</h2>
        <ol className="about-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <span className="about-step-mark"><Icon name={s.icon} size={22} /></span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="zone" aria-labelledby="privacy-h">
        <h2 id="privacy-h">Privacy</h2>
        <ul className="about-list">
          {PRIVACY.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </section>

      <section className="zone" aria-labelledby="credits-h">
        <h2 id="credits-h">Credits and data sources</h2>
        <p className="about-note">Earmark looks things up in these services. Thank you to all of them.</p>
        <ul className="about-credits">
          <li>
            Music identity and credits from <Ext href="https://musicbrainz.org">MusicBrainz</Ext>; album art from
            the <Ext href="https://coverartarchive.org">Cover Art Archive</Ext>.
          </li>
          <li>
            Artwork and song previews from <Ext href="https://music.apple.com">Apple Music</Ext>. Previews provided
            courtesy of iTunes.
          </li>
          <li>
            Data provided by <Ext href="https://www.discogs.com">Discogs</Ext>. This application uses Discogs’ API but
            is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.
          </li>
          <li>
            Maps and place search: <Ext href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</Ext>,
            searched with <Ext href="https://nominatim.org">Nominatim</Ext>. Place details and photos from{" "}
            <Ext href="https://developers.google.com/maps/documentation/places/web-service">Google Places</Ext>.
          </li>
          <li>Books and covers from <Ext href="https://openlibrary.org">Open Library</Ext>.</li>
          <li>
            Short “about” notes from <Ext href="https://www.wikipedia.org">Wikipedia</Ext>, under{" "}
            <Ext href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</Ext>, matched with{" "}
            <Ext href="https://www.wikidata.org">Wikidata</Ext>.
          </li>
          <li>Videos play in <Ext href="https://www.youtube.com">YouTube</Ext>’s own player.</li>
          <li>Podcasts found with <Ext href="https://podcastindex.org">Podcast Index</Ext>.</li>
          <li className="about-tmdb">
            <Ext href="https://www.themoviedb.org">
              {/* TMDB's "Alt short (blue)" logo, unaltered, from themoviedb.org/about/logos-attribution */}
              {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local SVG; next/image adds nothing */}
              <img src="/tmdb-alt-short-blue.svg" alt="The Movie Database (TMDB)" width={154} height={20} />
            </Ext>
            <span>
              Films and shows from TMDB. This website uses TMDB and the TMDB APIs but is not endorsed, certified, or
              otherwise approved by TMDB.
            </span>
          </li>
        </ul>
      </section>

      <section className="zone" aria-labelledby="built-h">
        <h2 id="built-h">Built by</h2>
        <p>
          Built by Tarik Moody for the Bee track of the Build, Ship, Shape Amazon hackathon (2026).
        </p>
        <ul className="about-links">
          <li><Ext href="https://github.com/tmoody1973/earmark">The code, on GitHub</Ext></li>
          <li>
            <Ext href="https://github.com/tmoody1973/earmark/tree/main/docs/decisions">
              How it was built: 40+ decisions, in plain English
            </Ext>
          </li>
        </ul>
      </section>

      <p className="about-foot"><Link href="/sign-in">Owner sign-in</Link></p>
    </main>
  );
}
