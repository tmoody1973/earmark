# Demo mode: read-only Earmark for judges

Earmark is private to one person, and its database is full of real conversations. Judges still need to click through
the real app. Demo mode runs the same code at its own URL, on a separate database filled with **invented sample
data**, and refuses every write. The decision is [053](decisions/053-judge-demo-mode.md).

What a visitor sees: the whole owner app (Home, Garden, Shelf, People, Spaces, tip pages, Heard nearby, Look back,
gardeners) for an invented owner, **Sam**, in Milwaukee. There is no sign-in. A thin banner on every page says
"Demo · sample data · read-only. Earmark's real garden is private." Tapping anything that would change something
(Keep, Clear, Try this, a rating, a pin, a new Space…) leaves the page as it was and the banner says
"This is a read-only demo."

## How it works

One switch, `EARMARK_DEMO=1`, read by `agent/lib/demo.ts`. It is checked in a handful of places:

| Where | What demo mode does |
|---|---|
| `proxy.ts` (`demoWriteRefusal`) | Refuses every request that is not GET, HEAD or OPTIONS, with a 403 and the JSON `{"error":"This is a read-only demo."}`, before any server action or route runs. Server actions are POST requests, so all of them stop here. That covers ~60 actions and every write route (Bee webhook, email-in, capture, MCP, OAuth) without touching them one by one. |
| `agent/lib/owner.ts` (`isOwner`, `gate`) | Everyone counts as the viewer of the owner pages; nobody is sent to sign in. |
| `agent/lib/e2e-guard.ts` (`gardenReadOnly`) | The garden's render-time writes (marking an idea viewed) become no-ops, as in a read-only e2e run. |
| `app/layout.tsx` + `app/DemoBanner.tsx` | The banner. It watches responses for the proxy's `x-earmark-demo: read-only` mark and shows the read-only line. |
| `app/error.tsx` | Forms that throw on a refused write (new Space, gardeners, a thank-you, publishing) land on a calm "Something didn't work" page that says it may be the read-only demo, instead of Next's default. |
| `app/page.tsx` → `GardenLive` | Home stops recording "visits" (a write). |
| `app/search/page.tsx` | Look back searches only the saved words; it never calls Bee (the demo has no Bee account). |
| `agent/schedules/*.ts` (`skipInDemo`) | Every schedule (Bee sync, rec lane, backlinks, Spaces, gardeners, facts, nightly backfill) returns at once and logs `[name] skipped: read-only demo`. |

Public pages (`/about`, `/s/…`, `/r/…`) behave as normal.

**The real guarantee is the database role.** The demo app connects as a role that can only `SELECT`. Even a write the
switch missed is refused by Postgres. The switch is there for a friendly message and quiet logs.

### Never on by accident

Demo mode opens the owner pages to everyone, so it must never switch on in production. `EARMARK_DEMO=1` alone is not
enough:

- It also needs `EARMARK_DEMO_DB_OK=1`, a second, deliberate setting.
- It also needs `EARMARK_PROD_DB_HOST`, the production database's host. Without it, demo mode is refused, so the
  production check can never be skipped by leaving it out.
- If `DATABASE_URL` points at that host (pooled or direct), demo mode is refused.
- A refused demo stays **off** (the normal owner gate applies), and the server refuses to start:
  `instrumentation.ts` throws `demo mode refused: …`.

`EARMARK_PROD_DB_HOST` is **required** in the demo project. Setting it in the production project too costs nothing,
and means that `EARMARK_DEMO=1` and `EARMARK_DEMO_DB_OK=1` pasted there by mistake are still refused.

## Deploying it (the controller does this, with Tarik's OK)

### 1. A separate database

Create a separate Neon project (or a branch that is **not** the production branch, created from an empty parent) for
the demo. Never the production branch, and never TEST.

Migrate it with the normal migrations, as its owner role. Run this **without** `.env.local`, so a missing URL fails
instead of falling back to production:

```sh
DATABASE_URL='<demo database owner URL>' pnpm exec tsx scripts/migrate.ts
```

### 2. A SELECT-only role for the app

Run this as the demo database's owner (the role that ran the migrations), in the Neon SQL editor or `psql`. Neon
requires a strong password for roles made in SQL: use a long random one.

```sql
create role demo_reader login password '<long random password>';
grant connect on database neondb to demo_reader;
grant usage on schema public to demo_reader;
grant select on all tables in schema public to demo_reader;
-- tables a later migration adds are readable too (applies to tables the owner role creates)
alter default privileges in schema public grant select on tables to demo_reader;
```

Check it: connected as `demo_reader`, `insert into sync_cursors (name, cursor) values ('x', 'x')` must fail with
`permission denied`.

### 3. Seed it

As the **owner** role (the reader cannot write):

```sh
EARMARK_DEMO_SEED_URL='<demo database owner URL>' pnpm seed:demo
```

The script wipes the demo database's app tables and writes the sample garden in one transaction. It refuses to run
when:

- `EARMARK_DEMO_SEED_URL` is not set;
- its host is the host of `DATABASE_URL` or `TEST_DATABASE_URL` (from `.env.local` or the shell), or
  `EARMARK_PROD_DB_HOST`;
- the database has tips but no demo marker (`sync_cursors` row `demo_seed`): that is someone's real garden or TEST.
  A freshly migrated, empty database is the first seed; after that the marker lets it reseed.

Reseeding is the same command; it is idempotent. Dates are relative to the moment of seeding (Heard nearby shows only
the last two weeks), so **reseed shortly before judging** if a few weeks have passed.

The sample data lives in `scripts/demo-data.ts`. The people (eight first names), quotes, ideas, drafts and thank-you
notes are invented. The works and places are real, so the art and links work.

Fixed links (the same after every reseed):

- Published Space: `/s/demo_milwaukee_food_and_coffee0000000000000`
- Thank-you notes: `/r/demo_thanks_margit_overstory000000000000000`, `/r/demo_thanks_declan_station_eleven0000000000`

### 4. A separate Vercel project

A new Vercel project (e.g. `earmark-demo`) built from the same repo and branch. Production environment variables:

| Variable | Value |
|---|---|
| `EARMARK_DEMO` | `1` |
| `EARMARK_DEMO_DB_OK` | `1` |
| `EARMARK_PROD_DB_HOST` | **required**: the **production** database host, e.g. `ep-…-pooler.….aws.neon.tech`. Without it the demo refuses to start. |
| `DATABASE_URL` | the demo database, as `demo_reader` (pooled URL) |
| `EARMARK_OWNER_FIRST_NAME` | `Sam` (the owner is never credited as a recommender) |
| `EARMARK_OWNER_DISPLAY_NAME` | `Sam` ("Collected by Sam" on the published Space) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | keys of a Clerk application (a free development app is fine). Nobody signs in, but Clerk's middleware and provider need keys to load. |
| `BEE_TOKEN` | any placeholder, e.g. `demo-unused`. The env schema requires it; nothing calls Bee. |
| `EARMARK_WEBHOOK_SECRET` | a random 32+ character string. Required by the env schema; unused. |

Leave everything else **unset**: no `EARMARK_OWNER_CLERK_ID`, `BEE_TODO_WRITES`, TinyFish, Google, Apple, TMDB or
Discogs keys, Resend, Polly (`EARMARK_POLLY_*`), `EARMARK_CAPTURE_TOKEN`, `EARMARK_MCP_*`, or `AI_GATEWAY_API_KEY`.
Don't add crons. If the build registers the eve schedules anyway, each run logs `skipped: read-only demo` and returns.

Then open the demo URL in a private window: Home loads without a sign-in, the banner shows, and tapping Keep on
Heard nearby says "This is a read-only demo."

## Testing it

- Unit: `tests/lib/demo.test.ts` (switch, startup refusal, write guard, owner gate), `tests/schedules/demo.test.ts`
  (every schedule is a no-op), `tests/scripts/seed-demo.test.ts` (seed target guard, the data's shape).
- Integration: `tests/integration/demo-seed.int.test.ts` runs the seed builder on TEST inside a transaction that is
  rolled back.
- End to end: `E2E_DEMO=1 pnpm exec playwright test --project=phone`. Seeds the sample garden on TEST for the run,
  browses it with no sign-in, taps Keep, then removes exactly what it seeded. Requests to other hosts are blocked.
