# Earmark

Your Bee already hears your best ideas and your friends' best tips. Earmark makes sure neither disappears.

Earmark is an [eve](https://eve.dev) agent that listens through a Bee wearable. It keeps an **idea compost** (ideas you say out loud, clustered over weeks, with a one-page draft at the third mention) and a **recommendation inbox** (tips people give you, with who said them), shown in a private web "garden".

Built for the Bee track of the Build, Ship, Shape: Amazon Developer Hackathon (2026).

## How it works

1. A small relay on your Mac runs `bee stream --webhook-endpoint` and forwards Bee events to the agent's HTTP channel.
2. Plain TypeScript splits conversations into short windows; Jev (a decision model, via Vercel AI Gateway) decides whether each window holds an idea, a recommendation, or nothing.
3. Claude writes only for windows that pass: the item's name, a ≤25-word excerpt, drafts.
4. Everything lands in Neon Postgres; the garden (Next.js) reads from it.
5. A nightly schedule backfills the last 48 hours from the Bee API, because the live stream is at-most-once.

## Setup

Requirements: Node 24 (`.node-version`), pnpm 10, a Bee with Developer Mode on, the Bee CLI (`npm i -g @beeai/cli`, then `bee login`).

0. Secret scanning (once per clone): `brew install gitleaks` then `git config core.hooksPath .githooks`
1. Use Node 24 (`brew install fnm && fnm install 24`; then in each shell `eval "$(fnm env)" && fnm use`, which reads `.node-version`; add `eval "$(fnm env --use-on-cd --shell zsh)"` to `~/.zshrc` to automate), then `pnpm install`
2. Copy `.env.example` to `.env.local` and fill it in (see comments in the file). The Bee token can be copied from the Keychain item the CLI creates: `printf 'BEE_TOKEN=%s\n' "$(security find-generic-password -s bee-cli -a token:prod -w)" >> .env.local`
3. `pnpm migrate`
4. Garden sign-in (Clerk): create a development app, put its two keys and `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` in `.env.local`, sign in once, and set `EARMARK_OWNER_CLERK_ID` to your Clerk user id (a signed-in stranger gets a 403 page). With the Clerk CLI: `clerk apps create Earmark`, `clerk link --app <id>`, `clerk env pull`.
   - The dev instance was changed with `clerk config patch`: passwords off (email-code sign-in only), `sign_up_mode=restricted`, Google not enabled. To undo, use Clerk dashboard > User & authentication.
   - A production Clerk instance has different user ids, so set `EARMARK_OWNER_CLERK_ID` separately for each instance (and each Vercel environment).
   - `pnpm test:e2e` also needs `E2E_OWNER_EMAIL` (the owner's Clerk email) in `.env.local`.

CI: every PR and push to `main` runs typecheck, unit tests, lint, build and a gitleaks secret scan (`.github/workflows/ci.yml`, no secrets needed). Making it block merges is a manual GitHub step: Settings → Branches → Add rule → `main` → Require status checks to pass → `CI` (add both the `check` and `gitleaks` jobs).

## Run

- Agent (relay target, schedules): `pnpm dev:agent` → http://localhost:2000
- Garden: `pnpm dev` → http://localhost:3000 (`withEve` also starts the agent; run `pnpm dev:agent` separately only if you want it alone)
- Relay (on the Mac where the Bee CLI is logged in): `./relay/run.sh` in a second terminal. It runs `bee stream` and restarts it whenever the connection drops; events sent while it is down are recovered by the nightly backfill. It appends `EARMARK_WEBHOOK_SECRET` as `?key=` (the agent checks it) and never prints it.
- Stop: Ctrl-C in each terminal. If started in the background: `pkill -f relay/run.sh; lsof -ti :2000 | xargs kill`
- Backfill now: `curl -X POST http://localhost:2000/eve/v1/dev/schedules/nightly-backfill`
- Tests: `pnpm test`; sign-in and owner-gate checks with screenshots: `pnpm test:e2e` (needs the Clerk keys and `pnpm exec playwright install chromium`). Screenshots go to the git-ignored `test-results/screens/`. Never commit real-data screenshots: the three PNGs in `docs/design/screens/` are empty-state captures only.
- Database tests: `pnpm test:int` runs against the Neon `test` branch (`TEST_DATABASE_URL` in `.env.local`), never production; `pnpm migrate:test` migrates that branch.

## Privacy and consent

Earmark stores your ideas and, per recommendation, a short excerpt (25 words or fewer) and the recommender's first name only. Earmark keeps only 25-word excerpts; live utterances are held briefly (≤ 6 hours) for in-conversation detection and then deleted. It never stores photos of people. People recorded in the demo agreed to be recorded; tell guests and co-hosts when Bee is on. Everything can be deleted everywhere with one command (`pnpm forget`, added in M3).

## License

MIT, see `LICENSE`.
