# 053 — A read-only demo with invented data, for judges

**Decision:** Judges get their own URL running the same Earmark code in demo mode: a separate database filled with
invented sample data (an owner called Sam, in Milwaukee, and eight made-up friends), no sign-in, and every write
refused. The demo video still shows Tarik's real garden.

**Why this came up:** The hackathon judges need to explore the app, but the real Earmark is locked to one person and
holds real conversations: other people's words, said near a microphone they may not have noticed. Letting a judge in
would show them that. Locking judges out leaves them a video and a README. If we got this wrong in one direction, real
speech leaks to strangers. In the other, the judges never touch the thing they are judging.

**Options:**
1. **Let judges sign in to the real app, read-only.** Least work. Cost: they see real conversations and real names.
   No amount of read-only fixes that.
2. **A copy of the real data with names and quotes scrubbed.** Looks most real. Cost: scrubbing speech reliably is
   hard (a quote can name a person, a place or a health detail), and one miss is a leak. It also needs re-scrubbing
   every time the data changes.
3. **A read-only demo on invented data, at its own URL.** Cost: a second deployment and database to keep alive, sample
   data to write, and a demo that is only as convincing as that sample data.

**What we chose and why:** Option 3, jointly. Tarik chose it on October 16 (the plan's "Resolved … (c)"): real data
never leaves the private app, and judges still click through every screen. Claude chose how it is built:
- **One switch, `EARMARK_DEMO=1`**, checked in a few places rather than in each of the ~60 server actions. The main
  check sits in the proxy (the code that runs before every request): any request that would change something (in web
  terms, anything but a read) is refused there with "This is a read-only demo.", before the app's own code runs. The
  owner check lets everyone in. The schedules (sync, lookups, gardeners, nightly backfill) do nothing.
- **The database is the real lock.** The demo app connects as a Postgres role that is only allowed to read. The switch
  is for a friendly message; the role is what makes a missed write impossible.
- **It can't switch on by accident.** Demo mode also needs a second setting (`EARMARK_DEMO_DB_OK=1`), and refuses to run
  against the production database's host when that host is named. A refused demo stays off and the server won't start.
- **The sample data is invented, the works are real.** People, quotes, ideas and notes are made up; the albums,
  books, podcasts and Milwaukee places are real, so the cover art, maps and links work. A seed script refuses to write
  to production or TEST, and refuses any database that has tips but was never seeded as the demo.

**What we gave up:**
- A second Vercel project and a second database to keep running and in step with `main`.
- The sample garden doesn't change unless someone reseeds it. Its dates are relative to the day it was seeded, so the
  "Heard nearby" page (two weeks) empties if nobody reseeds before judging.
- Nothing a judge does sticks. Taps show "This is a read-only demo." and the card goes back, so judges see the
  controls but not what happens next (a tip moving to "Tried", a bloom).
- The demo still needs Clerk keys and a placeholder Bee token, because the app's startup checks expect them.
- Invented data can look neater than real life: no half-heard titles, no wrong matches beyond the two "Which one?"
  examples we wrote on purpose.

**How we'll know if this was right:** After judging:
- No judge reports having seen a real name or quote. The demo database holds only `scripts/demo-data.ts`, so a check is
  a diff between that file and the database.
- The demo app's logs show no database permission errors (that would mean a write path the switch missed) and no
  calls to Bee or the providers.
- Judges' questions are about the product, not about getting in.

**What actually happened:**
