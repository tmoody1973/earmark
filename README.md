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

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill it in (see comments in the file). The Bee token can be copied from the Keychain item the CLI creates: `printf 'BEE_TOKEN=%s\n' "$(security find-generic-password -s bee-cli -a token:prod -w)" >> .env.local`
3. `pnpm migrate`

## Run

- Agent (relay target, schedules): `pnpm dev:agent` → http://localhost:2000
- Garden: `pnpm dev` → http://localhost:3000
- Relay: `./relay/run.sh`
- Backfill now: `curl -X POST http://localhost:2000/eve/v1/dev/schedules/nightly-backfill`
- Tests: `pnpm test`

## Privacy and consent

Earmark stores your ideas and, per recommendation, a short excerpt (25 words or fewer) and the recommender's first name only. It never stores full transcripts or photos of people. People recorded in the demo agreed to be recorded; tell guests and co-hosts when Bee is on. Everything can be deleted everywhere with one command (`pnpm forget`, added in M3).

## License

MIT, see `LICENSE`.
