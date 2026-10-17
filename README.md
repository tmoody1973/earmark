# Earmark

Your Bee already hears your best ideas and your friends' best tips. Earmark makes sure neither disappears.

Earmark is an [eve](https://eve.dev) agent that listens through a Bee wearable. It keeps an **idea compost** (ideas you say out loud, clustered over weeks, with a one-page draft at the third mention) and a **recommendation inbox** (tips people give you, with who said them), shown in a private web "garden".

Built for the Bee track of the Build, Ship, Shape: Amazon Developer Hackathon (2026).

- Code: https://github.com/tmoody1973/earmark
- Live garden: https://earmark-two.vercel.app (owner sign-in only)

## How it works

1. A small relay on your Mac runs `bee stream --webhook-endpoint` and forwards Bee events to the agent's HTTP channel.
2. Plain TypeScript splits conversations into short windows; Jev (a decision model, via Vercel AI Gateway) decides whether each window holds an idea, a recommendation, or nothing.
3. Claude writes only for windows that pass: the item's name, a ≤25-word excerpt, drafts.
4. Everything lands in Neon Postgres; the garden (Next.js) reads from it.
5. A nightly schedule backfills the last 48 hours from the Bee API, because the live stream is at-most-once.

## Quick start (no secrets)

A fresh clone runs the unit tests with no `.env.local`, no database, and no network calls to Bee or the models:

```sh
git clone https://github.com/tmoody1973/earmark && cd earmark
pnpm install
pnpm test
```

`pnpm typecheck`, `pnpm lint`, and `pnpm build` also run without secrets. CI runs these four checks (see CI below). Use Node 24 and pnpm 10 (Setup step 1). To run the agent, the relay, or the garden, do the full setup.

## Setup

Requirements: Node 24 (`.node-version`), pnpm 10, a Bee with Developer Mode on, the Bee CLI (`npm i -g @beeai/cli`, then `bee login`).

0. Secret scanning (once per clone): `brew install gitleaks` then `git config core.hooksPath .githooks`
1. Use Node 24 (`brew install fnm && fnm install 24`; then in each shell `eval "$(fnm env)" && fnm use`, which reads `.node-version`; add `eval "$(fnm env --use-on-cd --shell zsh)"` to `~/.zshrc` to automate), then `pnpm install`
2. Copy `.env.example` to `.env.local` and fill it in (see Environment variables below and the comments in the file). The Bee token can be copied from the Keychain item the CLI creates: `printf 'BEE_TOKEN=%s\n' "$(security find-generic-password -s bee-cli -a token:prod -w)" >> .env.local`
3. `pnpm migrate`
4. Garden sign-in (Clerk): create a development app, put its two keys and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` in `.env.local`, sign in once, and set `EARMARK_OWNER_CLERK_ID` to your Clerk user id (a signed-in stranger gets a 403 page). With the Clerk CLI: `clerk apps create Earmark`, `clerk link --app <id>`, `clerk env pull`.
   - The dev instance was changed with `clerk config patch`: passwords off (email-code sign-in only), `sign_up_mode=restricted`, Google not enabled. To undo, use Clerk dashboard > User & authentication.
   - A production Clerk instance has different user ids, so set `EARMARK_OWNER_CLERK_ID` separately for each instance (and each Vercel environment).
   - `pnpm test:e2e` also needs `E2E_OWNER_EMAIL` (the owner's Clerk email) in `.env.local`.

CI: every PR and push to `main` runs typecheck, unit tests, lint, build and a gitleaks secret scan (`.github/workflows/ci.yml`, no secrets needed). Making it block merges is a manual GitHub step: Settings → Branches → Add rule → `main` → Require status checks to pass → `CI` (add both the `check` and `gitleaks` jobs).

## Environment variables

Put local values in `.env.local` (git-ignored). `agent/lib/env.ts` (`EnvSchema`) parses the first 13 rows below. `getEnv()` throws when `BEE_TOKEN`, `DATABASE_URL`, or `EARMARK_WEBHOOK_SECRET` is missing or invalid. All other `EnvSchema` vars are optional or have a default.

| Name | Used by | Default or source |
| --- | --- | --- |
| `BEE_TOKEN` | Bee API calls (backfill, change sync, scripts) | Required. Keychain item from `bee login` (Setup step 2) |
| `BEE_API_BASE` | Bee API base URL | `https://api.developer.bee.amazon.dev` |
| `DATABASE_URL` | Agent, garden, `pnpm migrate` | Required. Neon pooled connection string; must start with `postgres` |
| `EARMARK_WEBHOOK_SECRET` | Relay and Bee ingress (`x-earmark-key` header) | Required, 24 characters or more: `openssl rand -hex 32` |
| `AI_GATEWAY_API_KEY` | Model calls through Vercel AI Gateway, local only | Optional. Not needed on Vercel (project OIDC) |
| `TRIAGE_MODEL` | Jev: window triage, idea cluster choice, one-pager decisions | `typesafe-ai/jev-1.13.0` |
| `BENCHMARK_MODEL` | `pnpm eval:triage` only (compared with `TRIAGE_MODEL`) | `openai/gpt-6-luna-decisions` |
| `EXTRACT_MODEL` | Item names, excerpts, idea timeline | `anthropic/claude-haiku-5.5` |
| `WRITE_MODEL` | One-page drafts, `pnpm label` proposals | `anthropic/claude-sonnet-5.5` |
| `EMBED_MODEL` | Idea embeddings for clustering | `openai/text-embedding-3-small` |
| `EARMARK_OWNER_CLERK_ID` | Garden owner gate (web app only) | Your Clerk user id (Setup step 4) |
| `EARMARK_OWNER_FIRST_NAME` | Never credited as a recommender (people say the owner's name in conversation) | Optional |
| `EARMARK_RELAY_URL` | `relay/run.sh` target | `http://localhost:2000/api/bee/events` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Garden sign-in | Clerk development app (Setup step 4) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Garden sign-in page | `/sign-in` |
| `TEST_DATABASE_URL` | `pnpm test:int`, `pnpm migrate:test`, `pnpm e2e` | Neon `test` branch; never production |
| `E2E_OWNER_EMAIL` | `pnpm e2e` | The owner's Clerk email |
| `E2E_PORT` | `pnpm e2e` dev server port | `3100` |
| `E2E_REAL` | `pnpm e2e`: set `1` for a read-only real-data run | Unset |
| `CRON_SECRET` | Vercel Cron Jobs (`Authorization: Bearer`) | Vercel Production only |

`pnpm e2e` sets `EARMARK_E2E` and, with `E2E_REAL=1`, `GARDEN_READ_ONLY` for you (see Run).

## Scripts

| Command | What it does | Needs |
| --- | --- | --- |
| `pnpm test` | Unit tests (Vitest, `tests/**/*.test.ts`) | Nothing |
| `pnpm typecheck` | `next typegen` and `tsc --noEmit` | Nothing |
| `pnpm lint` | ESLint | Nothing |
| `pnpm build` | Next.js production build | Nothing |
| `pnpm start` | Serves the production build | Full `.env.local` |
| `pnpm dev` | Garden on http://localhost:3000 (also starts the agent) | Full `.env.local` |
| `pnpm dev:agent` | Agent only on http://localhost:2000 | Full `.env.local` |
| `pnpm migrate` | Applies new `db/migrations/*.sql` to `DATABASE_URL` | `DATABASE_URL` |
| `pnpm migrate:test` | Same, for `TEST_DATABASE_URL` | `TEST_DATABASE_URL` |
| `pnpm test:int` | Database tests on the Neon `test` branch | `TEST_DATABASE_URL` |
| `pnpm test:e2e` / `pnpm e2e` | Playwright sign-in, owner-gate, and garden checks | Clerk keys, `TEST_DATABASE_URL`, `E2E_OWNER_EMAIL` |
| `pnpm garden:counts` | Prints garden counts and titles (no excerpts) | `DATABASE_URL` |
| `pnpm eval:sample` | Writes real transcript windows for labeling (read-only Bee calls) | `BEE_TOKEN`, `DATABASE_URL` |
| `pnpm label` | Proposes a label per sampled window; you confirm in a CLI | Full `.env.local` (model calls) |
| `pnpm eval:triage` | Jev vs `BENCHMARK_MODEL` accuracy report; dry run until you add `--yes` | Full `.env.local`, 30 or more labels from `pnpm label` |

`./relay/run.sh` is not a pnpm script. It needs the Bee CLI and `EARMARK_WEBHOOK_SECRET` (see Run).

## Run

- Agent (relay target, schedules): `pnpm dev:agent` → http://localhost:2000
- Garden: `pnpm dev` → http://localhost:3000 (`withEve` also starts the agent; run `pnpm dev:agent` separately only if you want it alone)
- Relay (on the Mac where the Bee CLI is logged in): `./relay/run.sh` in a second terminal. It runs `bee stream` and restarts it whenever the connection drops; events sent while it is down are recovered by the nightly backfill. It pipes `bee stream --json` through `relay/forward.ts`, which POSTs each event with `EARMARK_WEBHOOK_SECRET` in an `x-earmark-key` header (the agent checks it) and never prints it. Production runs this as a systemd service on the Hetzner box (`/opt/earmark-relay`; unit documented in `relay/earmark-relay.service`, no secrets). Restarts back off 3 s doubling to 60 s, resetting after a run of 60 s or more. To update the box, copy `run.sh` and `forward.ts` to `/opt/earmark-relay/app/relay/` and `systemctl restart earmark-relay`.
- Stop: Ctrl-C in each terminal. If started in the background: `pkill -f relay/run.sh; lsof -ti :2000 | xargs kill`
- Backfill now: `curl -X POST http://localhost:2000/eve/v1/dev/schedules/nightly-backfill`
- Tests: `pnpm test`; sign-in and owner-gate checks with screenshots: `pnpm test:e2e` (needs the Clerk keys and `pnpm exec playwright install chromium`). Screenshots go to the git-ignored `test-results/screens/`. Never commit real-data screenshots: the three PNGs in `docs/design/screens/` are empty-state captures only.
- e2e never writes production. `pnpm e2e` (same as `pnpm test:e2e`) starts its own dev server on the Neon `test` branch (`DATABASE_URL` = `TEST_DATABASE_URL`, required) and never reuses a running server; pick the port with `E2E_PORT` (default 3100). Real data is opt-in and read-only: `E2E_REAL=1 pnpm e2e e2e/garden.spec.ts` sets `GARDEN_READ_ONLY=1`, which turns garden writes (visit record, idea viewed) into no-ops, and `e2e/bloom.spec.ts` skips. A server started with `EARMARK_E2E=1` refuses to start on any other database unless it is read-only (`instrumentation.ts`).
- Database tests: `pnpm test:int` runs against the Neon `test` branch (`TEST_DATABASE_URL` in `.env.local`), never production; `pnpm migrate:test` migrates that branch.
- Triage eval set (M2-T8): `pnpm eval:sample` writes real transcript windows to `evals/triage/data/unlabeled.jsonl`; `pnpm label` proposes a label per window and you confirm (Enter = accept, `s` skip, `q` quit, or `k= t= j=y|n n=` to override; saved after every answer, rerun to resume). This folder holds real speech: it is git-ignored, lives only on this Mac, and **delete `evals/triage/data` after Oct 23** (`rm -r evals/triage/data`). `pnpm eval:triage` prints the cost plan first and calls the models only with `--yes`; it writes ids, labels, and metrics (no window text) to `evals/triage/reports/`.

## Deploy

Production is the Vercel project `earmark` on the Pro team `tmoody1973s-projects` (sub-daily crons need Pro): https://earmark-two.vercel.app.

1. `vercel link --scope tmoody1973s-projects --project earmark --yes`
2. Env vars (Production only: Preview gets none) are copied from `.env.local` by piping each value to `vercel env add NAME production --sensitive` (never paste a secret into a shell). Not copied: `TEST_DATABASE_URL`, `E2E_OWNER_EMAIL`, `VERCEL_OIDC_TOKEN`, `AI_GATEWAY_API_KEY` (on Vercel the AI Gateway authenticates with project OIDC).
3. `vercel deploy --prod --scope tmoody1973s-projects`. `vercel.json` pins `"framework": "nextjs"`: a project created by `vercel link` has no framework preset, and without it only the eve service is built and every Next.js route 404s. `.vercelignore` keeps `.env*`, `.superpowers/`, test output and design screenshots out of the upload.
4. Relay: set `EARMARK_RELAY_URL=https://earmark-two.vercel.app/api/bee/events` and run `./relay/run.sh` on the machine where `bee login` was done. Production ingress is `app/api/bee/events/route.ts` (`withEve` only routes `/eve/v1/**`); it acks and does the work in `after()`.
5. Schedules (`0 8 * * *` backfill, `*/10 * * * *` Bee changes sync) become Vercel Cron Jobs at an unguessable path: `vercel crons list --scope tmoody1973s-projects`; run one now with `vercel crons run <path>`.

Auth: the Bee route needs the webhook secret in an `x-earmark-key` header (or `Authorization: Bearer`; never the URL); cron needs `CRON_SECRET` (Nitro checks `Authorization: Bearer`); the garden is Clerk, owner only; the eve session API accepts only Vercel OIDC (no browser client). Function limit: eve runs schedules at `maxDuration: "max"`, 800 s on this Pro project (Fluid Compute), under the 15-minute claim lease.

## Privacy and consent

Earmark stores your ideas and, per recommendation, a short excerpt (25 words or fewer) and the recommender's first name only. Earmark keeps only 25-word excerpts; live utterances are held briefly for in-conversation detection (an idea can bloom while you are still talking) and deleted after 6 hours, or sooner once the finished conversation has been processed. It never stores photos of people. People recorded in the demo agreed to be recorded; tell guests and co-hosts when Bee is on. A one-command delete is not built yet.

## License

MIT, see `LICENSE`.
