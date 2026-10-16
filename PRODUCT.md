# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive web app (Next.js on Vercel). Phone first; also used on desktop. The demo video is recorded on both.

## Users

- **Primary: Tarik Moody**, a creator-builder who talks for a living and thinks out loud (radio host, newsletter writer, product builder). He wears a Bee wearable all day. His job: keep the ideas he says out loud and the recommendations other people give him, without typing anything, and act on them later.
- **Recommenders** (friends, colleagues, guests) see one surface only: a "thanks for the tip" receipt card opened from a text message. No account, no Bee, nothing else to do.
- **Space page visitors**: listeners or collaborators reading a published, link-only Space (e.g. "Heard at Radio Milwaukee this week"). Read-only.
- **Hackathon judges**: browse a read-only demo garden with invented sample data, and watch a demo video under 3 minutes.

## Product Purpose

Earmark keeps two things people lose every day: the half-formed ideas they say out loud, and the recommendations other people give them. It listens through the Bee wearable, sorts what it hears, and shows it in one private "garden".

- **Idea compost:** an idea grows with each mention and blooms at its third, when Earmark drafts a one-page pitch from every mention. Ideas count whoever said them — Tarik or someone in the conversation with him — because Bee can't tell speakers apart (decision 003).
- **Recommendation inbox:** each tip is saved with what it is, where to get it, and who said it (first name), and music lands in an Earmarked Apple Music playlist.

The idea compost is the lead feature; the recommendation inbox supports it.

Success: Tarik stops losing ideas and tips, and acts on a bloomed idea (a newsletter issue or radio segment). The PRD's measurable targets apply: recommendation detection precision ≥ 85%, idea precision ≥ 75%, ≥ 80% of recs enriched with a valid match, conversation-to-Notion under 2 minutes, 4 of 4 weekly episodes without manual fixes, and under 20% of items dismissed as "not an idea / not a rec".

## Positioning

"Mymind for the things you hear." Bee captures moments; Earmark finds patterns across weeks and finishes the work: the third-mention bloom and draft, and recommendations credited to the person who gave them. Nothing is typed; organizing is automatic.

## Operating Context

- Capture is ambient (Bee records conversations), explicit ("Earmark that, Ann's ramen spot" as a Bee voice note), or by phone share-sheet (photos, Shazam songs).
- The garden is the hero surface. Extensions: the Bee app (todos and facts written back), Apple Music, Notion, Slack approval cards, a weekly audio episode, Alexa+ (web simulator for the demo).
- Typical moments (assumption, not yet confirmed by use): glancing at the phone after a walk or a call; reviewing on desktop; opening a bloomed idea to read its draft; marking a tip tried and rating it.
- Uncertain items arrive as Slack approval cards (keep / fix / dismiss, or "who recommended this?").
- Bee write-back stays tidy: only queued recs become Bee todos, at most 10 open at once, each prefixed "Earmark ·"; Bee facts describe only Tarik and stay pending until he confirms them.

## Capabilities and Constraints

- Speakers in Bee transcripts are always "Unknown"; attribution comes from wording, the "Earmark that" trigger, Bee's summary, or a Slack question. An unattributed item shows no name rather than a guessed one.
- Uncertain items wait for approval (status "needs review") before they count.
- Terminology: **garden** (hero view), **plant / bloom** (idea and its third mention), **compost → sprouting → ready → drafted → used**, or **dismissed** (idea stages), **shelf** (recommendations), **Earmarked** (the playlist), **Space** (a self-filling collection defined by one sentence), **Serendipity**, **Top of Mind**, **receipt**.
- Recommendation types: album, song, artist, book, place, podcast, film/TV, other — each with a type-aware card (FR-33; see Brand Commitments for Tarik's named forms).
- Undecided: the garden's production domain (vercel.app until before the demo).

## Brand Commitments

- **Name:** Earmark. Trigger phrase: "Earmark that". Bee todo prefix: "Earmark ·".
- Standalone personal project by Tarik Moody — not Radio Milwaukee branded; no station logos.
- Voice (from Tarik's brief, binding): warm, editorial, quiet; in the spirit of public radio and record stores. Not a dashboard, not a social feed.
- Named in Tarik's brief (binding concept, form left to design work): ideas appear as plants that grow with each mention and bloom at the third; recommendations sit on a shelf of type-aware cards — square album covers, book spines, mini map cards for places, podcast tiles.
- **Visual direction (Tarik, 2026-10-16, standing):** the category standard played straight — a calm personal-knowledge garden in the mymind tradition: warm off-white ground, near-black type, one orange accent, artwork-led rounded cards, search as a front door. No novelty theme. The craft bar is mymind, Apple Music / Podcasts, Readwise Reader and Things 3: polish lives in spacing, type, artwork and small interactions. Tagline (Tarik-approved): "Small moments. A bigger mind." This replaces the earlier "mymind structure only" note.

## Evidence on Hand

- Real Bee data on Tarik's account since Oct 15, 2026 (read via the Bee API; never committed to the repo).
- No testimonials, user counts, or press exist. Never fabricate them. The judges' demo garden uses clearly invented sample data.

## Product Principles

1. **Private by default.** The garden is Tarik's alone; anything another person sees (receipt, Space page) is chosen and sent by him.
2. **Keep the why, not just the what.** Each item carries who said it, a short context summary of why it mattered, and an excerpt of 25 words or fewer.
3. **Organize nothing.** Structure appears on its own (stages, Spaces, links); the user never files anything.
4. **Calm over complete.** Show less, quietly; the tone words in Brand Commitments are binding.
5. **Never guess about people.** First names only, never invented; no photos of people; facts only about Tarik.

## Accessibility & Inclusion

WCAG 2.2 AA (Tarik, 2026-10-16): text contrast, full keyboard use, screen-reader labels for plants and cards, and respect for reduced-motion preferences in any animation.

## Privacy rules (product constraints)

- Excerpts are 25 words or fewer; live utterances are held briefly (≤ 6 hours) for in-conversation detection and then deleted, so full transcripts are never kept outside Bee.
- Recommenders: first name only; no contact details or inferred facts about other people.
- Receipt cards contain the user's note and the item, never an excerpt of the conversation.
- Everything is deletable everywhere with one command.
- Nothing is sent to other people without Tarik's approval; the agent never messages anyone on its own.
- Receipt and podcast-feed links are unguessable and not indexed. Published Spaces show approved items only and name recommenders only with their consent; search indexing is opt-in.
- Consent practice: guests and co-hosts are told when Bee is on; the README and demo state that people recorded agreed to it.
- No copyrighted audio (no music or previews) anywhere, including the episode and the demo.
