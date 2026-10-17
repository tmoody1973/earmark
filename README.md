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
- Relay (on the Mac where the Bee CLI is logged in): `./relay/run.sh` in a second terminal. It runs `bee stream` and restarts it whenever the connection drops; events sent while it is down are recovered by the nightly backfill. It pipes `bee stream --json` through `relay/forward.ts`, which POSTs each event with `EARMARK_WEBHOOK_SECRET` in an `x-earmark-key` header (the agent checks it) and never prints it. Production runs this as a systemd service on the Hetzner box (`/opt/earmark-relay`; unit documented in `relay/earmark-relay.service`, no secrets). Restarts back off 3 s doubling to 60 s, resetting after a run of 60 s or more. To update the box, copy `run.sh` and `forward.ts` to `/opt/earmark-relay/app/relay/` and `systemctl restart earmark-relay`.
- Stop: Ctrl-C in each terminal. If started in the background: `pkill -f relay/run.sh; lsof -ti :2000 | xargs kill`
- Backfill now: `curl -X POST http://localhost:2000/eve/v1/dev/schedules/nightly-backfill`
- Fact proposals now (FR-19, weekly on Mondays): `curl -X POST http://localhost:2000/eve/v1/dev/schedules/fact-proposals`. This writes new taste and idea guesses to Bee as unconfirmed facts. Confirm or delete them in the Bee app; the 10-minute changes sync sets `fact_proposals.status` to `confirmed` or `rejected`.
- Backlinks now: `pnpm links:refresh [--max-calls N]` runs one refresh on the Neon test branch; `--prod` targets production (Tarik's call).
- Threshold check: `pnpm thresholds:check` reads the `DATABASE_URL` garden in one read-only transaction (always rolled back) and prints, as ids and numbers only, the backlink and Space confidences and distances, how many ideas and tips each knob admits, and the M4 sign-off counts (stages, People vs SQL, pins, merges).
- Tests: `pnpm test`; sign-in and owner-gate checks with screenshots: `pnpm test:e2e` (needs the Clerk keys and `pnpm exec playwright install chromium`). Screenshots go to the git-ignored `test-results/screens/`. Never commit real-data screenshots: the three PNGs in `docs/design/screens/` are empty-state captures only.
- e2e never writes production. `pnpm e2e` (same as `pnpm test:e2e`) starts its own dev server on the Neon `test` branch (`DATABASE_URL` = `TEST_DATABASE_URL`, required) and never reuses a running server; pick the port with `E2E_PORT` (default 3100). Real-data runs (`E2E_REAL`) are disabled until they can use a database role that cannot write; `playwright.config.ts` refuses to start with it set (decision 042). A server started with `EARMARK_E2E=1` refuses to start on any database but the test branch (`instrumentation.ts`).
- Database tests: `pnpm test:int` runs against the Neon `test` branch (`TEST_DATABASE_URL` in `.env.local`), never production; `pnpm migrate:test` migrates that branch.
- Triage eval set (M2-T8): `pnpm eval:sample` writes real transcript windows to `evals/triage/data/unlabeled.jsonl`; `pnpm label` proposes a label per window and you confirm (Enter = accept, `s` skip, `q` quit, or `k= t= j=y|n n=` to override; saved after every answer, rerun to resume). This folder holds real speech: it is git-ignored, lives only on this Mac, and **delete `evals/triage/data` after Oct 23** (`rm -r evals/triage/data`).

## Deploy

Production is the Vercel project `earmark` on the Pro team `tmoody1973s-projects` (sub-daily crons need Pro): https://earmark-two.vercel.app.

1. `vercel link --scope tmoody1973s-projects --project earmark --yes`
2. Env vars (Production only: Preview gets none) are copied from `.env.local` by piping each value to `vercel env add NAME production --sensitive` (never paste a secret into a shell). Not copied: `TEST_DATABASE_URL`, `E2E_OWNER_EMAIL`, `VERCEL_OIDC_TOKEN`, `AI_GATEWAY_API_KEY` (on Vercel the AI Gateway authenticates with project OIDC).
3. `vercel deploy --prod --scope tmoody1973s-projects`. `vercel.json` pins `"framework": "nextjs"`: a project created by `vercel link` has no framework preset, and without it only the eve service is built and every Next.js route 404s. `.vercelignore` keeps `.env*`, `.superpowers/`, test output and design screenshots out of the upload.
4. Relay: set `EARMARK_RELAY_URL=https://earmark-two.vercel.app/api/bee/events` and run `./relay/run.sh` on the machine where `bee login` was done. Production ingress is `app/api/bee/events/route.ts` (`withEve` only routes `/eve/v1/**`); it acks and does the work in `after()`.
5. Schedules (`0 8 * * *` backfill, `*/10 * * * *` Bee changes sync, `7 * * * *` backlink refresh, at most 40 model calls a run, decision 026) become Vercel Cron Jobs at an unguessable path: `vercel crons list --scope tmoody1973s-projects`; run one now with `vercel crons run <path>`.

Auth: the Bee route needs the webhook secret in an `x-earmark-key` header (or `Authorization: Bearer`; never the URL); cron needs `CRON_SECRET` (Nitro checks `Authorization: Bearer`); the garden is Clerk, owner only; the eve session API accepts only Vercel OIDC (no browser client). Function limit: eve runs schedules at `maxDuration: "max"`, 800 s on this Pro project (Fluid Compute), under the 15-minute claim lease.

## Capture a photo

Share a photo of an album, book, sign or menu from your iPhone and Earmark saves it, links it to the Bee conversation it came from (within 10 minutes, within 500 m) and credits whoever recommended it. Photos with any chance of a person in them keep the recommendation but never the image.

Set `EARMARK_CAPTURE_TOKEN` (at least 32 characters: `openssl rand -base64 32`) in `.env.local` and in the Vercel project, and create a public Vercel Blob store (it adds `BLOB_READ_WRITE_TOKEN`). Then build the "Earmark this" Shortcut (Shortcuts app, + , name it "Earmark this"):

1. Details (i): turn on **Show in Share Sheet**; accepted types: **Images** only.
2. **Receive** Images from Share Sheet; if there is no input, **Ask For** Photos.
3. **Get Details of Images**, *Date Taken*, then **Format Date** (ISO 8601, include time) and call it `TakenAt`.
4. **Get Details of Images**, *Location*. If it has a value: **Get Details of Locations** for *Latitude* (`Lat`) and *Longitude* (`Lng`). Otherwise: **Get Current Location** and take its Latitude and Longitude into `Lat` and `Lng`.
5. **Convert** the input **to JPEG** (Preserve Metadata off), **Resize Image** to width 1024, call it `Image1024`.
6. **Resize Image** `Image1024` to width 256, call it `Thumb`.
7. **Get Contents of URL** `https://<production-host>/api/capture/photo`: method **POST**, header `Authorization: Bearer <EARMARK_CAPTURE_TOKEN>`, body **Form** with `image` (File) = `Image1024`, `thumb` (File) = `Thumb`, `taken_at` (Text) = `TakenAt`, `lat` (Text) = `Lat`, `lng` (Text) = `Lng`.
8. **Get Dictionary Value** for `message`, then **Show Notification**.

Probe first: add `?dry=1` to the URL and run it on any photo. The response lists each field it received (name, type, size) without processing anything, so a mis-named Shortcut field shows up immediately. Remove `?dry=1` afterwards. Images must be JPEG or PNG and under 4 MB. Recommended at deploy: a Vercel firewall rate-limit rule on `/api/capture/*`.

## Capture a song

Press your iPhone Action button while a song plays. Shazam names it, and Earmark saves it as a song recommendation, links it to the Bee conversation you were in (the picker must find the song being talked about in a nearby stretch of that conversation), and credits whoever mentioned it. Pressing twice within 10 minutes saves once. If your iOS version does not offer the Apple Music URL field, the song still saves (just without an Apple Music id), and it still saves, unlinked, if Bee or the model is down.

Uses the same `EARMARK_CAPTURE_TOKEN` as photos. Build the "Earmark this song" Shortcut (assign it to the Action button in Settings, Action Button, Shortcut):

1. **Recognize Music** (Shazam).
2. **Get Details of Shazam Media** for *Title* (`Title`), *Artist* (`Artist`) and *Apple Music URL* (`AMURL`). If your iOS version does not offer the URL, leave `apple_music_url` out in step 4; Earmark then saves the song without an Apple Music id.
3. **Current Date**, **Format Date** (ISO 8601, include time) as `At`. **Get Current Location**, then *Latitude* (`Lat`) and *Longitude* (`Lng`).
4. **Get Contents of URL** `https://<production-host>/api/capture/song`: method **POST**, header `Authorization: Bearer <EARMARK_CAPTURE_TOKEN>`, body **JSON** with `title` (Text) = `Title`, `artist` (Text) = `Artist`, `apple_music_url` (Text) = `AMURL`, `captured_at` (Text) = `At`, `lat` (Text) = `Lat`, `lng` (Text) = `Lng`. Only `title` is required.
5. **Get Dictionary Value** for `message`, then **Show Notification**.

Only https `music.apple.com` links are accepted. A bad field returns 400 with the reason in `error`; a non-JSON body returns 415.

## Capture an email

Forward an email in which a friend recommends something to your Earmark address, `earmark@<your-id>.resend.app` (Resend dashboard, Emails, Receiving, the Receiving address menu). Resend calls `POST /api/email/inbound`; Earmark checks the Resend signature, fetches the email, saves the recommendation as source `email` and credits the friend named in the forwarded header (first name only). Only forwards sent **from your own address** are accepted; anything else is ignored. A forward the triage model doubts is saved as "needs review", not dropped. Resend retries are safe: each email id is processed once.

Setup: in Resend, Webhooks, add an endpoint `https://<production-host>/api/email/inbound` for the `email.received` event and copy its signing secret; create an API key. Then set these in `.env.local` and in the Vercel project (the route refuses everything while any is blank): `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EARMARK_OWNER_EMAIL` (your own address). The From address can be forged, so keep the receiving address private (decision 030).

## Weekly episode

Once a week Earmark writes a short spoken recap (about 5 to 7 minutes: what is growing, ready to harvest, new in the crate, what to remember, thank-yous owed), voices it with Amazon Polly (generative voice, `Ruth` by default), stores the MP3 in Vercel Blob and lists it in a private podcast feed. The recap describes things only: no music, previews or clips. It uses first names and excerpts of 25 words or fewer, never the owner's name.

Setup: create an IAM user whose only permission is `polly:SynthesizeSpeech`, make an access key, and set these in `.env.local` and in the Vercel project (the plain `AWS_*` names are avoided on purpose: Vercel may reserve them on Functions, so the keys are passed to Polly explicitly):

- `EARMARK_AWS_ACCESS_KEY_ID`, `EARMARK_AWS_SECRET_ACCESS_KEY`, `EARMARK_AWS_REGION` (`us-east-1`; generative voices are not in every region)
- `POLLY_VOICE` (default `Ruth`)
- `EARMARK_FEED_TOKEN`: the secret in the feed address. Make one with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` (min 32 characters). The feed route returns 404 while it is unset.

Feed address to add in a podcast app (Follow a Show by URL): `https://<production-host>/feed/<EARMARK_FEED_TOKEN>`. It lists only approved episodes, newest first. Anyone with the address can listen, so treat it like a password (decision 035); rotate by changing the token and re-subscribing.

Approval: a new episode is saved unpublished. Once the gardeners screen lands (M5-T12) the episode appears there as a pending run; approving it sets `published_at` and it shows up in the feed. Until then nothing reaches the feed. Follow-up: FR-30 wiring is pending. `forgetPersonInEpisodes` (agent/lib/privacy/forget-m5.ts) deletes a person's episodes and audio but no forget script calls it yet. One episode per Chicago week: running it again for the same week does nothing and costs nothing.

## Earmark MCP server

Lets an AI client (Claude Code, Claude Desktop, later Alexa+) ask Earmark questions over MCP (Model Context Protocol) at `POST /api/mcp`. Access uses service-level OAuth (decision 031): trade the client id and secret for a one-hour pass, then send it as a bearer token.

```bash
# 1. Get a pass (HTTP Basic client auth, client_credentials grant)
curl -s -u "$EARMARK_MCP_CLIENT_ID:$EARMARK_MCP_CLIENT_SECRET" -d grant_type=client_credentials \
  -d resource=$EARMARK_PUBLIC_BASE_URL/api/mcp $EARMARK_PUBLIC_BASE_URL/api/oauth/token
# or locally: pnpm exec tsx --env-file=.env.local scripts/mcp-token.ts
# 2. Add the server to Claude Code (passes last 1 hour; mint a new one after)
claude mcp add --transport http earmark $EARMARK_PUBLIC_BASE_URL/api/mcp --header "Authorization: Bearer <token>"
```

Tools: `what_did_they_recommend` (person, period), `ready_ideas`, `search_earmarks` (who, where, when, query), `add_to_earmarked_playlist` (item), `latest_episode`. Answers are short spoken sentences, and search skips Bee neural search to stay fast for Alexa+ (target under 500 ms). Set `EARMARK_PUBLIC_BASE_URL`, `EARMARK_MCP_CLIENT_ID`, `EARMARK_MCP_CLIENT_SECRET` and `EARMARK_MCP_JWT_SECRET` (see `.env.example`); without all four the MCP routes answer 503. Metadata lives at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.

## Alexa+ simulator

Hackathon entrants do not get Alexa+ developer access, so `/alexa` (owner-only, linked from the Ideas page) simulates the Alexa+ experience (decision 036). Press the mic (Chrome or Safari) or type a question; `POST /api/alexa-sim` mints a service token server-side, connects to Earmark's own `/api/mcp` as a real MCP client (`@ai-sdk/mcp`, Streamable HTTP), lets a fast model call the tools, and returns a one-to-three sentence answer, the tools it used, and Polly "Ruth" audio (browser voice if Polly is not configured). Nothing is stored; logs carry tool names and counts only. The client offers 2026-07-28 and the session settles on **2025-11-25** (the server's latest) (supported: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05). Source: `agent/lib/alexa/sim.ts`, `app/alexa/`, `app/api/alexa-sim/route.ts`.

## Privacy and consent

Earmark stores your ideas and, per recommendation, a short excerpt (25 words or fewer) and the recommender's first name only. Earmark keeps only 25-word excerpts; live utterances are held briefly for in-conversation detection (an idea can bloom while you are still talking) and deleted after 6 hours, or sooner once the finished conversation has been processed. It never stores photos of people. People recorded in the demo agreed to be recorded; tell guests and co-hosts when Bee is on. Everything can be deleted everywhere with one command (`pnpm forget`, below).

### Forget an item

`pnpm forget <rec|idea|mention> <id>` shows what would be removed: ids and table counts only, nothing is touched. Add `--yes` to delete. The outside copies go first, then the database rows in one transaction (all or nothing):

- **`rec <id>`** (a recommendation). Outside: its Bee to-do(s) (its own and its thank-you receipts'), any Bee fact synced for it or for a taste fact proposal built from it, its Notion page (moved to Trash), its photo thumbnails in Vercel Blob. Database: the recommendation, its receipts and photo records, its links and Space entries, its Bee-sync and re-sort records, every taste fact proposal that used it as evidence, and the recommender's first name (with their links) when no other recommendation names them; otherwise the recommender's counts are recalculated.
- **`idea <id>`**. Outside: the idea's Bee fact(s) (its own and its fact proposals'), its Notion page. Database: the idea with its title, summary, timeline and draft, all its mentions (dismissed ones too) with their excerpts, its garden events, links, Space entries, Bee-sync and re-sort records, and its fact proposals.
- **`mention <id>`** (one mention of an idea). Database: the mention and its excerpt, its re-sort record, and its line in the idea's timeline. Everything written from all the idea's mentions is removed too: the summary and the one-pager draft text (a drafted idea goes back to compost or growing, by its remaining count, and is redrafted once it blooms again; a "used" idea stays used but its draft text is cleared), the idea's fact proposals and Bee-sync records; outside, the idea's Bee fact, its fact proposals' Bee facts and its Notion page (Earmark recreates those later). The idea's count, dates, stage and matching centre are recalculated. While a one-pager draft is being written for the idea, the command refuses and asks you to retry in a few minutes; a draft started before the forget can never be saved after it. The dry run cannot check the mention's timeline line; if it is missing, `--yes` stops without deleting anything. If the idea's title came from this mention, the dry run says so and the title becomes "Untitled idea" (titles are not stored per mention), so forgetting the whole idea may be the better choice. If no other non-dismissed mention would be left, the whole idea is forgotten instead.

Other lanes' stores (weekly episodes, gardener drafts) join the same transaction through `agent/lib/privacy/forget-hooks.ts`. Records that a Bee conversation was already processed are kept: they hold only ids, and removing them would let the nightly pass save the same item again.

If Bee, Notion or Blob fails (anything but "not found", which counts as already gone), the command stops before the database, says which id failed and exits with an error; nothing in the database is removed, so run the same command again. The same goes for a failure inside the database transaction (it rolls back whole). A Notion page already in Trash counts as done. A Notion page needs `NOTION_TOKEN` and a thumbnail needs `BLOB_READ_WRITE_TOKEN` in `.env.local`; when an item has one and the token is missing, the step is reported as skipped and the command stops the same way. Apple Music offers no way to remove a song from a library playlist, so a song can remain in "Earmarked"; no excerpt or recommender name is stored there.

## License

MIT, see `LICENSE`.
