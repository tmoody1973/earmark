import { neon } from "@neondatabase/serverless";

// Seeds older SAMPLE tips on the Neon `test` branch so the taste ledger (/people) has history to show: tips spread
// over weeks, some tried, loved or thanked, one dismissed (must not count), one with no name, and one wrongly
// credited to the owner (must never list them). Run after scripts/seed-sample-shelf.ts. Never production: it only
// reads TEST_DATABASE_URL. Re-runnable: it replaces its own rows (raw_text = 'sample-people'). Invented sample data.
// Run: pnpm tsx --env-file=.env.local scripts/seed-sample-people.ts
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set");
const sql = neon(url);
const owner = process.env.EARMARK_OWNER_FIRST_NAME?.trim();

type Sample = { type: string; name: string; creator?: string; from?: string; daysAgo: number; status?: string; rating?: string };

const SAMPLES: Sample[] = [
  { type: "book", name: "The Overstory", creator: "Richard Powers", from: "Ann", daysAgo: 6, status: "tried", rating: "loved" },
  { type: "podcast", name: "Song Exploder", creator: "Hrishikesh Hirway", from: "Ann", daysAgo: 13, status: "thanked" },
  { type: "film_tv", name: "Past Lives", creator: "Celine Song", from: "Priya", daysAgo: 9, status: "tried", rating: "loved" },
  { type: "album", name: "Blue Rev", creator: "Alvvays", from: "Priya", daysAgo: 21, status: "tried", rating: "not_for_me" },
  { type: "place", name: "Anodyne Coffee", from: "Marcus", daysAgo: 3, status: "tried", rating: "fine" },
  { type: "song", name: "Nightcall", creator: "Kavinsky", from: "Dana", daysAgo: 4, status: "dismissed" },
  { type: "book", name: "Braiding Sweetgrass", creator: "Robin Wall Kimmerer", daysAgo: 11 },
  ...(owner ? [{ type: "other", name: "Owner-credited sample", from: owner, daysAgo: 2 }] : []),
];

await sql`delete from recommendations where raw_text = 'sample-people'`;
for (const s of SAMPLES) {
  const [who] = s.from
    ? await sql`insert into recommenders (first_name) values (${s.from})
        on conflict (first_name_key) do update set first_name = excluded.first_name returning id`
    : [null];
  await sql`insert into recommendations
    (type, raw_text, canonical_name, creator, recommender_id, excerpt, said_at, source, status, rating, confidence)
    values (${s.type}, 'sample-people', ${s.name}, ${s.creator ?? null}, ${who?.id ?? null}, 'sample excerpt',
     now() - make_interval(days => ${s.daysAgo}), 'ambient', ${s.status ?? "new"}, ${s.rating ?? null}, 0.9)`;
}
console.log(`seeded ${SAMPLES.length} sample people tips on the test branch`);
