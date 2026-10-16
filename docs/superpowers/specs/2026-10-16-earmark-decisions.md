# Earmark — Decisions resolving PRD open questions (2026-10-16)

Spec: `docs/Earmark — PRD-2.md` (approved). This file records answers to the PRD's
"Open questions" plus facts from doc research that change how the PRD is built.
Research notes with sources: `docs/research/{bee-api,eve,triage-models,integrations}.md`.

## Decided by Tarik (2026-10-16)

| # | Question | Decision |
|---|---|---|
| D1 | Final name | **Earmark.** Voice trigger "Earmark that". Bee todo prefix "Earmark ·". |
| D2 | Repo home | **Public at `github.com/tmoody1973/earmark` from the first push**, MIT license in commit one, license visible in the About section. |
| D3 | Bee developer access | Not set up yet → enabling Developer Mode, installing bee-cli and logging in is M1 Task 1. |
| D4 | Real Bee history | Tarik wore Bee Oct 6–14 (11 real conversations; not worn Oct 15 or the morning of Oct 16) → the first backfill pulls those on day one. |
| D5 | Design process | Impeccable for all Earmark UI: `teach`/`init` before any UI code (M1), `shape` before each M4 view, `critique` + `polish` after M4, `detect` before M6. |

## Resolved by documentation (no question needed)

| # | PRD open question | Answer | Source |
|---|---|---|---|
| R1 | Can voice notes be told apart from other journal entries? | Every Bee journal **is** a voice note; the API has no type field (fields: `id`, `text`, `state`, `created_at`, `updated_at`). The trigger phrase at the start of `text` is the discriminator. Matching tolerates ASR variants: "earmark that", "ear mark that", "earmark this", leading filler and punctuation. | bee-api.md §2 |
| R2 | Does `POST /v1/facts` create facts as pending? | **Yes** — create returns `confirmed: false`; confirming is `PUT /v1/facts/:id {confirmed:true}`. Earmark writes proposals to Bee as unconfirmed facts and the user confirms in the Bee app. No stream event exists for facts, so confirmations/deletions are mirrored by polling `GET /v1/facts`. | bee-api.md §2 |
| R3 | Could Bee's `photos` endpoint replace the share-sheet Shortcut? | **No, complement at most.** `GET /v1/photos` lists gallery photos imported into the Bee app (`id, captured_at, conversation_id|null`), bytes via `GET /v1/photos/:id`. Not device-captured. Keep the Shortcut (P1, M5); revisit using `conversation_id` for linking. | bee-api.md §2 |

## Defaults for non-blocking open questions (revisit at the named milestone)

| # | Question | Default | Revisit |
|---|---|---|---|
| N1 | Threads access for weekly visual card | Ask at office hours Mon Oct 19, 11:00 CT. P2; no work planned. | Oct 19 |
| N2 | Photos: keep thumbnail or discard | Keep a ≤256px thumbnail of the **item** only when the vision read finds no person; otherwise discard. | M5 |
| N3 | Polly voice, one host or two | One host, `Ruth` (generative, en-US) — confirm voice list at M5. | M5 |
| N4 | Receipt delivery | Copied link + iOS share sheet via Web Share API (one button, both paths). | M5 |
| N5 | Garden domain | `*.vercel.app` + Clerk development instance through M4; decide domain before demo recording. | M6 |
| N6 | Echo playback vs separate Alexa+ entry | Earmark MCP server stays read-only + playlist add; demo shows queries only, playback is one shot. | M5 |

## Proposed during planning (confirm at plan review)

- **P1 — Incremental Bee sync via `GET /v1/changes?cursor=`** (docs: https://docs.bee.computer/docs/agentic-sync). Every 10 min a deterministic eve schedule fetches what changed since the stored cursor and routes conversation/journal ids to the existing (deduping) processors, todo ids to `handleTodoChange`, fact ids to `handleFactChange`. Used as code, not as an LLM "reason over changes" loop. Replaces the separate todo poll (M3) and fact poll (M5); keeps the nightly 48 h backfill as the safety net; the Mac relay stays the only seconds-latency path (live bloom). Response shape verified live (`meta.next_cursor`, five lists); non-empty item shape still to verify in M2.

## Facts from research that change the build (not in the PRD)

- **Speakers are always `"Unknown"`** in the real API (bee-cli issue #19), not `speaker_1`. Attribution relies entirely on FR-04's chain: voice trigger → second-person cues → Bee summary → Slack question.
- **`new-utterance` carries only `{utterance:{text,speaker}, conversation_uuid}`** — no timestamp. Earmark stamps `received_at` on arrival and keeps a rolling buffer in Postgres (`utterance_buffer`, new table; see `docs/decisions/001-utterance-buffer-table.md`).
- **Webhook template:** `bee stream --webhook-endpoint <url> --webhook-body '{"event":"{{event}}","data":{{raw}}}'`. No signing → Earmark requires a shared-secret query parameter on the relay URL. At-most-once, no retry → nightly backfill is mandatory.
- **No conversation-ended event**; conversations can sit in `CAPTURING` 20+ hours. Finished-conversation triage triggers on `update-conversation-summary`; backfill processes `COMPLETED` conversations.
- **Bee `/v1/todos` may return 500** (bee-cli issue #14 is partly server-side). M1 Task 1 smoke-tests it read-only on Tarik's account; if it fails, escalate at office hours and log friction before M3.
- **eve 0.80.0** (pinned; Node 24+): one repo, one Vercel project, Next.js wrapped with `withEve`. Custom HTTP routes are plain handlers — the LLM runs only when called explicitly. Cron never fires in `eve dev`; trigger with `POST /eve/v1/dev/schedules/<name>`.
- **Slack approvals:** eve's built-in buttons are approve/cancel only. "Edit" needs a custom renderer + modal (M3 decides between that and edit-in-Notion).
- **Jev via Vercel AI Gateway:** `experimental_decide` from `ai@7` (renamed from `experimental_evaluate`); pin model `typesafe-ai/jev-1.13.0`; Choice `criteria` is an object map; booleans return `.probability`. OpenAI Decisions is the same call with `openai/gpt-6-luna-decisions`; thresholds tuned per model.
- **Embeddings:** `openai/text-embedding-3-small`, `vector(1536)`.
- **Apple Music:** playlists accept songs only — an album rec is expanded to its tracks before adding (all tracks; FR-15). Music User Token lifetime is undocumented → treat 401/403 as "re-authorize", flag in Slack.
- **Notion:** API version `2026-03-11`, data-source model (`initial_data_source`, `POST /v1/data_sources/{id}/query`, page parent `{type:"data_source_id"}`). ~3 req/s.
- **Clerk single user:** allowlist is paid in production → `proxy.ts` (Next.js 16) rejects any signed-in user whose ID ≠ `EARMARK_OWNER_CLERK_ID`.
- **Store access:** `@neondatabase/serverless` `neon()` + numbered plain-SQL migrations; no ORM.
- **Impeccable 4.x:** `teach` = `init` and writes `PRODUCT.md` only; `DESIGN.md` comes from `/impeccable document`. `shape` writes nothing (brief only) → each brief is saved by hand to `docs/design/shape-<view>.md`.
