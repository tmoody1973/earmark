import { neon } from "@neondatabase/serverless";

// Seeds a SAMPLE shelf covering all eight card variants (with and without artwork) on the Neon `test` branch,
// for design screenshots. Never production: it only ever reads TEST_DATABASE_URL. Re-runnable: it replaces
// its own rows (marked raw_text = 'sample-shelf'). Names and summaries are invented sample data.
// Run: pnpm tsx --env-file=.env.local scripts/seed-sample-shelf.ts
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set");
const sql = neon(url);

type Sample = {
  type: string; name: string; creator?: string; addr?: string; image?: string; why?: string; from?: string;
  status?: string; rating?: string; lat?: number; lng?: number; links?: Record<string, string>;
};

const SAMPLES: Sample[] = [
  { type: "album", name: "Promises", creator: "Floating Points & Pharoah Sanders", from: "Ann", why: "Play it loud, start to finish. It builds for forty minutes.",
    image: "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/af/dc/6b/afdc6b88-b275-de4e-3098-63dff171dffb/680899009720.jpg/{w}x{h}bb.jpg" },
  { type: "song", name: "Little Dark Age", creator: "MGMT", from: "Dana" },
  { type: "artist", name: "Khruangbin", from: "Jordan", status: "tried", rating: "loved" },
  { type: "book", name: "Piranesi", creator: "Susanna Clarke", from: "Priya", why: "Short, strange and kind. Read it in two sittings.",
    image: "https://covers.openlibrary.org/b/id/10226290-L.jpg" },
  // A cover URL that 404s on purpose: the card must fall back to its spine, never show a broken image.
  { type: "book", name: "Range", creator: "David Epstein",
    image: "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/00/00/00/earmark-missing/0.jpg/{w}x{h}bb.jpg" },
  { type: "place", name: "Milwaukee Public Market", addr: "400 N Water St, Milwaukee", from: "Ann", lat: 43.0352, lng: -87.9088,
    why: "Go hungry on a Saturday morning.", links: { url: "https://milwaukeepublicmarket.org" } },
  { type: "place", name: "Kawa Ramen", addr: "Brady St, Milwaukee", from: "Marcus" },
  { type: "podcast", name: "99% Invisible", creator: "Roman Mars", from: "Sam", status: "tried", rating: "fine",
    image: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/79/d0/35/79d035ea-9043-b43e-7380-33cd47bd968b/mza_2606971010425550919.jpg/{w}x{h}bb.jpg" },
  { type: "film_tv", name: "Shōgun", creator: "FX", from: "Lena", why: "Stunning, political, human. Couldn't stop thinking about it." },
  { type: "other", name: "Notion Calendar", from: "Chris" },
];

await sql`delete from recommendations where raw_text = 'sample-shelf'`;
let minute = 0;
for (const s of SAMPLES) {
  const [who] = s.from
    ? await sql`insert into recommenders (first_name) values (${s.from})
        on conflict (first_name_key) do update set first_name = excluded.first_name returning id`
    : [null];
  await sql`insert into recommendations
    (type, raw_text, canonical_name, creator, year_or_address, image_url, links, context_summary, recommender_id,
     excerpt, said_at, lat, lng, source, status, rating, confidence)
    values (${s.type}, 'sample-shelf', ${s.name}, ${s.creator ?? null}, ${s.addr ?? null}, ${s.image ?? null},
     ${JSON.stringify(s.links ?? {})}, ${s.why ?? null}, ${who?.id ?? null}, 'sample excerpt',
     now() - make_interval(mins => ${minute++}), ${s.lat ?? null}, ${s.lng ?? null}, 'ambient', ${s.status ?? "new"},
     ${s.rating ?? null}, 0.9)`;
}
console.log(`seeded ${SAMPLES.length} sample tips on the test branch`);
