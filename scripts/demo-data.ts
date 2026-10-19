import type { IdeaStage, Rating, RecStatus, RecType } from "../agent/lib/types";

// The judge demo's sample garden (decision 053, docs/demo-mode.md), written by scripts/seed-demo.ts.
// INVENTED: the owner (Sam, in Milwaukee), every person (first names only), every quote, why line, idea, draft and
// thank-you note. Nothing here comes from a real conversation. REAL: the works and places, so the art and links work;
// art and links are only ones taken from recorded catalog responses (tests/fixtures/enrich) or stable public pages.
// A card whose image fails to load falls back to its drawn state, so a missing cover never breaks a page.

export const DEMO_OWNER = "Sam";
export const PEOPLE = ["Rosalie", "Teodor", "Imani", "Declan", "Yesenia", "Wendell", "Margit", "Anjali"];
/** People who said their first name may appear on a published Space. */
export const NAME_CONSENT = ["Wendell", "Yesenia"];

export interface DemoCandidate {
  provider: string; canonicalName: string; creator: string | null; yearOrAddress: string | null; detail?: string;
  imageUrl: string | null; links: Record<string, string>; lat?: number; lng?: number;
}
export interface DemoTip {
  type: RecType; name: string; creator?: string; addr?: string; image?: string; why?: string; from?: string;
  /** What was said, as Earmark stores it: at most 25 words (a database check). Invented. */
  excerpt: string;
  status: RecStatus; rating?: Rating; daysAgo: number; source?: "ambient" | "voice" | "email";
  lat?: number; lng?: number; links?: Record<string, string>; about?: { text: string; url: string };
  extras?: Record<string, unknown>;
  /** "Which one?" (decision 048): Earmark wasn't sure which item this is and kept these options. */
  candidates?: DemoCandidate[];
  /** A thank-you sent back as a link (/r/<token>). */
  receipt?: { message: string; token: string };
}
export interface DemoIdea {
  title: string; stage: IdeaStage; pinned?: boolean;
  /** The timeline line for each mention after the first ("first heard" is written for the earliest). */
  mentions: { daysAgo: number; note: string; excerpt: string; status?: "accepted" | "needs_review" | "dismissed" }[];
  draft?: { format: "newsletter_pitch" | "radio_segment" | "product_brief"; md: string };
}
export interface DemoSpace { name: string; rule: string; tips: string[]; publishedToken?: string }

const maps = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const wiki = (title: string) => `https://en.wikipedia.org/wiki/${title}`;
const openLibraryCover = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
/** Share tokens are 43 URL-safe characters; the demo's are readable so its links stay the same across reseeds. */
export const demoToken = (slug: string) => slug.replace(/[^A-Za-z0-9_-]/g, "_").padEnd(43, "0").slice(0, 43);

export const TIPS: DemoTip[] = [
  // ---- music ----
  { type: "album", name: "Promises", creator: "Floating Points, Pharoah Sanders & The London Symphony Orchestra", from: "Rosalie",
    image: "https://coverartarchive.org/release/9f279a47-778f-44fe-a9ff-4ca61dae26c8/28949992190-500.jpg",
    links: { musicbrainz: "https://musicbrainz.org/release-group/970f689d-1778-4953-b3ed-48d057625724" },
    why: "Rosalie says play it start to finish with headphones on. It builds slowly for forty minutes.",
    excerpt: "put on promises tonight, headphones, start to finish, don't skip around, it builds for like forty minutes",
    status: "tried", rating: "loved", daysAgo: 24 },
  { type: "song", name: "Heroes", from: "Declan", why: "Declan heard it on a late drive home and couldn't stop thinking about it.",
    excerpt: "you need to hear heroes again, the slow one, I had to pull over the first time",
    status: "new", daysAgo: 2,
    candidates: [
      { provider: "musicbrainz", canonicalName: "“Heroes”", creator: "David Bowie", yearOrAddress: "1977", detail: "Single", imageUrl: null, links: {} },
      { provider: "musicbrainz", canonicalName: "Heroes", creator: "Peter Gabriel", yearOrAddress: "2010", detail: "From Scratch My Back, with orchestra", imageUrl: null, links: {} },
    ] },
  { type: "artist", name: "Sault", from: "Teodor", why: "Teodor says start with Untitled (Black Is) and keep going.",
    about: { text: "Sault are a British music group that make a mixture of R&B, urban contemporary gospel, house and disco.", url: wiki("Sault_(band)") },
    links: { wikipedia: wiki("Sault_(band)") },
    excerpt: "have you heard sault, nobody knows who they are, just start with the black is record",
    status: "queued", daysAgo: 11 },
  { type: "artist", name: "Khruangbin", from: "Wendell", links: { wikipedia: wiki("Khruangbin") },
    why: "Wendell's pick for a slow Sunday morning.",
    excerpt: "khruangbin is my sunday morning band, coffee and that bass line, trust me",
    status: "tried", rating: "fine", daysAgo: 33 },
  { type: "song", name: "Little Dark Age", creator: "MGMT", from: "Anjali",
    links: { youtube: "https://www.youtube.com/results?search_query=MGMT+Little+Dark+Age" },
    excerpt: "little dark age by mgmt is stuck in my head and now it will be stuck in yours",
    status: "new", daysAgo: 5 },
  { type: "song", name: "Pink + White", creator: "Frank Ocean", from: "Yesenia",
    why: "Yesenia's summer song, for the drive along the lake.",
    excerpt: "pink and white, frank ocean, windows down on lincoln memorial, that's the whole plan",
    status: "queued", daysAgo: 16 },
  // ---- books ----
  { type: "book", name: "The Overstory", creator: "Richard Powers", from: "Margit", image: openLibraryCover(8758252),
    links: { openlibrary: "https://openlibrary.org/works/OL19074847W", wikipedia: wiki("The_Overstory") },
    why: "Margit says it changed how she sees the trees on her own street.",
    excerpt: "read the overstory, it's long but you will never look at a tree the same way",
    status: "thanked", rating: "loved", daysAgo: 41,
    extras: {
      book: { description: "Nine strangers, each drawn to trees in a different way, find their lives bound up with the last old forests.", firstPublished: "2018", pages: 502 },
      wiki: { text: "The Overstory is a 2018 novel by American author Richard Powers. It won the 2019 Pulitzer Prize for Fiction.", url: wiki("The_Overstory") },
    },
    receipt: { message: "Finished The Overstory on the porch last night. I keep looking up at the maples on our block. Thank you, Margit.", token: demoToken("demo_thanks_margit_overstory") } },
  { type: "book", name: "Piranesi", creator: "Susanna Clarke", from: "Rosalie", image: openLibraryCover(10226290),
    why: "Short, strange and kind. Rosalie read it in two sittings.",
    excerpt: "piranesi is short and strange and kind, I read it in two sittings, you'll love the house",
    status: "new", daysAgo: 3 },
  { type: "book", name: "Braiding Sweetgrass", creator: "Robin Wall Kimmerer", from: "Imani",
    image: "https://covers.openlibrary.org/b/isbn/9781571313560-L.jpg?default=false",
    excerpt: "braiding sweetgrass, read one chapter a night, it slows everything down in a good way",
    status: "queued", daysAgo: 19 },
  { type: "book", name: "Station Eleven", creator: "Emily St. John Mandel", from: "Declan",
    why: "Declan says it's hopeful, not grim, whatever the cover suggests.",
    excerpt: "station eleven sounds grim but it's actually hopeful, the traveling orchestra part got me",
    status: "thanked", rating: "loved", daysAgo: 52,
    receipt: { message: "You were right about Station Eleven. Hopeful, not grim. I owe you a coffee, Declan.", token: demoToken("demo_thanks_declan_station_eleven") } },
  // ---- places (Milwaukee) ----
  { type: "place", name: "Milwaukee Public Market", addr: "400 N Water St, Milwaukee", from: "Wendell", lat: 43.0352, lng: -87.9088,
    links: { google_maps: maps("Milwaukee Public Market, 400 N Water St, Milwaukee") },
    why: "Go hungry on a Saturday morning, Wendell says, and get the lobster roll.",
    excerpt: "public market on a saturday morning, go hungry, the lobster roll is worth the line",
    status: "tried", rating: "loved", daysAgo: 28 },
  { type: "place", name: "Lakefront Brewery", addr: "1872 N Commerce St, Milwaukee", from: "Teodor", lat: 43.0544, lng: -87.9053,
    links: { wikipedia: wiki("Lakefront_Brewery"), google_maps: maps("Lakefront Brewery, 1872 N Commerce St, Milwaukee") },
    why: "Teodor says take the tour for the guides, stay for the fish fry.",
    excerpt: "do the lakefront brewery tour, the guides are hilarious, then stay for the friday fish fry",
    status: "queued", daysAgo: 13 },
  { type: "place", name: "Milwaukee Art Museum", addr: "700 N Art Museum Dr, Milwaukee", from: "Margit", lat: 43.04, lng: -87.897,
    links: { url: "https://mam.org", google_maps: maps("Milwaukee Art Museum, 700 N Art Museum Dr, Milwaukee") },
    why: "Margit says be there at noon, when the wings flap.",
    excerpt: "be at the art museum at noon when the wings flap, then walk out by the lake",
    status: "new", daysAgo: 7 },
  { type: "place", name: "Mitchell Park Domes", addr: "524 S Layton Blvd, Milwaukee", from: "Anjali", lat: 43.0255, lng: -87.9455,
    links: { google_maps: maps("Mitchell Park Domes, 524 S Layton Blvd, Milwaukee") },
    excerpt: "the desert dome in january is the best cure for winter in this city",
    status: "new", daysAgo: 9 },
  { type: "place", name: "Anodyne Coffee", addr: "224 W Bruce St, Milwaukee", from: "Yesenia", lat: 43.0249, lng: -87.9135,
    links: { google_maps: maps("Anodyne Coffee, 224 W Bruce St, Milwaukee") },
    excerpt: "anodyne on bruce street, they roast right there, sit by the window",
    status: "tried", rating: "fine", daysAgo: 21 },
  { type: "place", name: "Colectivo", from: "Imani", why: "Imani's favorite place to sit and read on a weekday morning.",
    excerpt: "meet me at colectivo, the one with the good patio, I'm there most mornings with a book",
    status: "new", daysAgo: 1,
    candidates: [
      { provider: "nominatim", canonicalName: "Colectivo Lakefront", creator: null, yearOrAddress: "1701 N Lincoln Memorial Dr, Milwaukee", imageUrl: null, links: {}, lat: 43.053, lng: -87.889 },
      { provider: "nominatim", canonicalName: "Colectivo Bay View", creator: null, yearOrAddress: "2301 S Kinnickinnic Ave, Milwaukee", imageUrl: null, links: {}, lat: 43.0035, lng: -87.9045 },
      { provider: "nominatim", canonicalName: "Colectivo Prospect", creator: null, yearOrAddress: "2211 N Prospect Ave, Milwaukee", imageUrl: null, links: {}, lat: 43.0627, lng: -87.8848 },
    ] },
  // ---- podcasts ----
  { type: "podcast", name: "Song Exploder", creator: "Hrishikesh Hirway", from: "Declan",
    image: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/05/7b/35/057b3588-c74c-0334-d8ef-c6b8166d4afc/mza_12324100546486323942.jpg/{w}x{h}bb.jpg",
    links: { apple_podcasts: "https://podcasts.apple.com/us/podcast/song-exploder/id788236947" },
    why: "Musicians take one song apart, piece by piece. Declan says start with any song you already love.",
    excerpt: "song exploder, pick a song you already love and listen to them take it apart",
    status: "tried", rating: "loved", daysAgo: 36 },
  { type: "podcast", name: "99% Invisible", creator: "Roman Mars", from: "Wendell", links: { url: "https://99percentinvisible.org" },
    why: "Wendell says you'll never see a city the same way.",
    excerpt: "ninety nine percent invisible, it's about design, you'll notice every bus stop after",
    status: "queued", daysAgo: 30 },
  { type: "podcast", name: "Radiolab", creator: "WNYC Studios", from: "Anjali", links: { url: "https://radiolab.org" },
    excerpt: "the radiolab one about colors, listen to that one first, it blew my mind",
    status: "new", daysAgo: 6 },
  // ---- film and TV ----
  { type: "film_tv", name: "Past Lives", creator: "Celine Song", from: "Yesenia", links: { wikipedia: wiki("Past_Lives_(film)") },
    why: "Quiet and devastating, Yesenia says. Watch it with someone.",
    excerpt: "past lives, watch it with someone, it's quiet and it absolutely wrecked me",
    status: "tried", rating: "loved", daysAgo: 26 },
  { type: "film_tv", name: "The Bear", creator: "FX", from: "Teodor", links: { wikipedia: wiki("The_Bear_(TV_series)") },
    excerpt: "the bear, the first season, it's stressful but the kitchen stuff is so real",
    status: "queued", daysAgo: 15 },
  { type: "film_tv", name: "Severance", creator: "Apple TV+", from: "Margit",
    why: "Margit says go in knowing nothing.",
    excerpt: "severance, don't read anything about it, just start it this weekend",
    status: "new", daysAgo: 2 },
  // ---- video ----
  { type: "video", name: "The Art of Code - Dylan Beattie", creator: "NDC Conferences", from: "Declan",
    image: "https://i.ytimg.com/vi/6avJHaC3C2U/hqdefault.jpg", links: { youtube: "https://www.youtube.com/watch?v=6avJHaC3C2U" },
    extras: { videoId: "6avJHaC3C2U" },
    why: "An hour of joy about what code is for, Declan says.",
    excerpt: "the art of code talk, it's an hour but it's pure joy about why people make things",
    status: "new", daysAgo: 4 },
  { type: "video", name: "Veritasium", creator: "Derek Muller", from: "Imani",
    links: { youtube: "https://www.youtube.com/results?search_query=Veritasium" },
    excerpt: "veritasium on youtube, the science videos, I watched four in a row last night",
    status: "queued", daysAgo: 22 },
  // ---- other ----
  { type: "other", name: "Riverwest 24", from: "Wendell", why: "A 24-hour neighborhood bike race. Wendell rides every year.",
    excerpt: "sign up for the riverwest twenty four, you don't have to be fast, it's a party on bikes",
    status: "new", daysAgo: 12 },
  { type: "other", name: "Milwaukee Film Festival", from: "Rosalie", why: "Rosalie says buy the pass and see something you'd never pick.",
    excerpt: "get the festival pass this year and see one thing you would never pick yourself",
    status: "queued", daysAgo: 45 },
  // ---- Maybe? (Earmark wasn't sure these were tips) ----
  { type: "album", name: "Blue Rev", creator: "Alvvays", from: "Anjali", status: "needs_review", daysAgo: 1,
    excerpt: "that alvvays record blue rev was playing at the shop, it sounded really good" },
  { type: "book", name: "Tomorrow, and Tomorrow, and Tomorrow", creator: "Gabrielle Zevin", status: "needs_review", daysAgo: 2,
    excerpt: "someone on the bus was saying tomorrow and tomorrow and tomorrow is about video games" },
  // ---- Heard nearby (no one was recommending these to Sam) ----
  { type: "podcast", name: "Hard Fork", creator: "The New York Times", status: "overheard", daysAgo: 1, source: "ambient",
    excerpt: "this week on hard fork, the tech stories you missed and what they mean for you" },
  { type: "video", name: "Hot Ones", creator: "First We Feast", status: "overheard", daysAgo: 3, source: "ambient",
    excerpt: "hot ones is back, new episode, the wings get hotter and the questions get harder" },
  { type: "film_tv", name: "Slow Horses", creator: "Apple TV+", status: "overheard", daysAgo: 5, source: "ambient",
    excerpt: "slow horses season four, streaming now, only on apple tv plus" },
];

const DRAFT = `Mentioned 3 times

# Record Store Walk

## The segment
A monthly walk between three Milwaukee record stores, a few blocks apart, told by the people behind the counters. Each stop ends with one record they would hand a stranger.

## Why it works
- Every shop has a regular with a story.
- Listeners can do the same walk on a Saturday.
- It gives local musicians a reason to show up.

## Rundown
1. Cold open: the bell on the first shop's door.
2. Three stops, three minutes each.
3. Close on the three records, played back to back.

## Open questions
- Which three shops say yes first?
- Record on a weekday, or in the Saturday rush?`;

export const IDEAS: DemoIdea[] = [
  { title: "A record store walk segment", stage: "drafted", draft: { format: "radio_segment", md: DRAFT }, mentions: [
    { daysAgo: 20, note: "first heard", excerpt: "what if we walked between three record stores and let the owners tell it" },
    { daysAgo: 12, note: "added a record pick to end each stop", excerpt: "end every stop with the one record they'd hand a stranger" },
    { daysAgo: 4, note: "picked Saturday mornings", excerpt: "it has to be saturday morning, that's when the shops are alive" },
  ] },
  { title: "A sound map of Bay View", stage: "ready", mentions: [
    { daysAgo: 18, note: "first heard", excerpt: "a sound map of bay view, the bridge, the bakery, the ferry horn" },
    { daysAgo: 9, note: "added recording at dawn", excerpt: "record it at dawn before the traffic starts" },
    { daysAgo: 3, note: "named the library as a partner", excerpt: "the bay view library might host it on a listening station" },
  ] },
  { title: "Monthly listening party at the library", stage: "sprouting", pinned: true, mentions: [
    { daysAgo: 14, note: "first heard", excerpt: "a listening party at the library once a month, one album, no phones" },
    { daysAgo: 6, note: "suggested people bring a record", excerpt: "everyone brings one record and we vote on what plays next" },
  ] },
  { title: "Ask Public Market regulars for one tip each", stage: "sprouting", mentions: [
    { daysAgo: 10, note: "first heard", excerpt: "ask the regulars at the public market for one thing they'd tell a friend" },
    { daysAgo: 2, note: "thought about a weekly card", excerpt: "maybe a little card by the register every week", status: "needs_review" },
  ] },
  { title: "Patios to catch before they close for the season", stage: "sprouting", mentions: [
    { daysAgo: 8, note: "first heard", excerpt: "make a list of patios before they all close for the winter" },
    { daysAgo: 1, note: "added the lakefront", excerpt: "the lakefront ones first, those close earliest" },
  ] },
  { title: "A zine about the Riverwest 24", stage: "compost", mentions: [
    { daysAgo: 11, note: "first heard", excerpt: "somebody should make a zine about the riverwest twenty four, the checkpoints are wild" },
  ] },
  { title: "The lake in winter, as an episode", stage: "compost", mentions: [
    { daysAgo: 27, note: "first heard", excerpt: "an episode about the lake in winter, the ice shelves, the people who still swim" },
  ] },
  { title: "Neighborhood recipe swap", stage: "compost", mentions: [
    { daysAgo: 34, note: "first heard", excerpt: "a recipe swap on our block, everyone brings the dish their family argues about" },
  ] },
  { title: "One book, one record, one place: a weekly newsletter", stage: "used",
    draft: { format: "newsletter_pitch", md: "Mentioned 3 times\n\n# One, one, one\n\n## The pitch\nEvery Friday: one book, one record and one Milwaukee place a friend told me about, and why." },
    mentions: [
      { daysAgo: 60, note: "first heard", excerpt: "a newsletter with just one book, one record, one place, every friday" },
      { daysAgo: 50, note: "named it", excerpt: "call it one one one, that's it" },
      { daysAgo: 44, note: "sent the first issue", excerpt: "sent the first one one one today, forty people opened it" },
    ] },
  { title: "A kids' radio hour", stage: "dismissed", mentions: [
    { daysAgo: 40, note: "first heard", excerpt: "a radio hour made by kids, they pick everything" },
  ] },
];

export const SPACES: DemoSpace[] = [
  { name: "Milwaukee food and coffee", rule: "Places to eat and drink in Milwaukee that friends told me about",
    tips: ["Milwaukee Public Market", "Lakefront Brewery", "Anodyne Coffee", "Colectivo"],
    publishedToken: demoToken("demo_milwaukee_food_and_coffee") },
  { name: "For a long drive", rule: "Albums, songs and podcasts for a long drive",
    tips: ["Promises", "Pink + White", "Song Exploder", "99% Invisible"] },
];

export const GARDENER = {
  name: "Weekend plan",
  task: "Every Friday, pick three tips I haven't tried yet that fit a free weekend in Milwaukee, and say why each one.",
  schedule: { every: "week", weekday: 5, hourUtc: 14 },
  sources: ["recs"],
  draft: "## This weekend\n\n1. **Lakefront Brewery** — Teodor's tour and fish fry, Friday night.\n2. **Milwaukee Art Museum** — be there at noon on Saturday, when the wings flap, as Margit said.\n3. **Braiding Sweetgrass** — one chapter on Sunday morning, the way Imani reads it.",
};
