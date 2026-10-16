# Friction log

One entry per real slowdown. Fields: task · steps · expected vs actual · severity (low/med/high) · workaround · suggestion.

## F-01 · Bee: speaker labels are always "Unknown"
- **Task:** attribute recommendations to the person who gave them (M1).
- **Steps:** read Bee docs (`/docs/realtime`, `/docs/agentic-now`), bee-cli issue #19.
- **Expected vs actual:** docs and README show `speaker_1`/`speaker_2`; issue #19 reports all 15,578 utterances on one account as `"Unknown"`, and the wearer is never identified.
- **Severity:** high — attribution is a core feature.
- **Workaround:** voice trigger ("Earmark that, Ann's …") → second-person cues → Bee summary → Slack question.
- **Suggestion:** an `is_wearer` flag per utterance, or document that diarization is not exposed.

## F-02 · Bee: no documented way to get a developer token; CLI uses a different host than the docs recommend
- **Task:** call the REST API from Earmark (M1-T1).
- **Steps:** `/docs/api` says `Authorization: Bearer $BEE_TOKEN` but never says where the token comes from; read bee-cli `sources/secureStore.ts`.
- **Expected vs actual:** expected a "copy your token" step. Actual: the token exists only in the macOS Keychain (service `bee-cli`, account `token:prod`). The CLI talks to the private-CA host `app-api-developer.ce.bee.amazon.dev` while the docs recommend the public `api.developer.bee.amazon.dev`.
- **Severity:** medium.
- **Workaround:** `security find-generic-password -s bee-cli -a token:prod -w`, then call the public host. Issue #14 check on 2026-10-16: `/v1/todos?limit=3` → 200.
- **Suggestion:** `bee token print` and one sentence in `/docs/api`.

## F-03 · Bee: `bee stream --webhook-endpoint` has no signing, retry, reconnect or default body
- **Task:** forward live events to the agent (M1-T5, M1-T14).
- **Steps:** read `/docs/realtime` and bee-cli `sources/commands/stream`.
- **Expected vs actual:** expected a signed, retried webhook. Actual: no signature header, no retry (failed POSTs are dropped), serial delivery (a slow endpoint stalls the stream), the CLI exits when the SSE stream ends, `--webhook-body` is mandatory and Handlebars escaping is off, so quoted fields break JSON. The Realtime Sync doc's own example `--webhook-body '{"message":"{{message}}"}'` produces invalid JSON as soon as someone says a word in quotes. Raw payloads have no `event` field. Omitting `--types` means all events (Earmark passes an explicit list anyway).
- **Severity:** high.
- **Workaround:** body `{"event":"{{event}}","ts":"{{timestamp}}","data":{{raw}}}`, shared secret in the URL, 200 within 1 s and process in the background, supervise with a restart loop, nightly backfill.
- **Suggestion:** HMAC header, retries with backoff, a default JSON envelope, auto-reconnect (PR #16).

## F-04 · Bee: stream and REST shapes disagree
- **Task:** join stream events to REST conversations (M1-T5).
- **Expected vs actual:** stream `new-utterance` has `conversation_uuid` only (no numeric id, no timestamp, no utterance id); REST uses numeric ids. Todos: `alarmAt` (stream) vs `alarm_at` (REST). Journal id: number (stream) vs string (REST). States: `processing/processed` vs `CAPTURING/COMPLETED`.
- **Severity:** medium.
- **Workaround:** `bee_conversation_map` table from `new-conversation`, stamp `received_at` on arrival, normalize ids to strings.
- **Suggestion:** one schema for both, or a published mapping.

## F-05 · eve: third-party snippets are stale
- **Task:** scaffold the agent (M1-T2).
- **Expected vs actual:** the flaviocopes article uses `needsApproval` and `autoModel`; eve 0.80.0 uses `approval` and `auto` from `eve/models`. The migration note is only in CHANGELOG.
- **Severity:** low.
- **Workaround:** read the docs bundled in `node_modules/eve/docs`.
- **Suggestion:** a "renamed APIs" page.

## F-06 · eve: custom channel routes are not reachable through `withEve`
- **Task:** expose the Bee webhook route (M1-T5).
- **Expected vs actual:** expected `agent/channels/bee.ts` routes to be served on the Next.js origin like `/eve/v1/**`. Actual: `withEve` rewrites only `/eve/v1/**`, and in dev it starts the agent on a random port (`--port 0`). Production needs an explicit route to the eve service.
- **Severity:** medium.
- **Workaround:** run the agent standalone on port 2000 in dev (`pnpm dev:agent`); route explicitly in production (M2).
- **Suggestion:** a `withEve({ publicRoutes: [...] })` option.

## F-07 · AI SDK: renamed decision and instruction APIs
- **Task:** call Jev (M1-T8) and Claude (M1-T10).
- **Expected vs actual:** the brief and awesome-jev say `experimental_evaluate`; `ai@7.0.142` deprecates it for `experimental_decide`. `generateText({ system })` and `generateObject` are deprecated for `instructions` and `output: Output.object(...)`.
- **Severity:** low.
- **Workaround:** pin `ai@7.0.142`, use the new names.
- **Suggestion:** codemods or a deprecation table on the decisions page.

## F-08 · Jev on AI Gateway: version alias and limits undocumented
- **Task:** pin the triage model (M1-T8).
- **Expected vs actual:** `typesafe-ai/jev` does not say which Jev version it tracks (1.13.0 vs 1.14.0, released 2026-10-14); Gateway lists a 32k context window while TypeSafe documents 64k per request; rate limits are not public; which `providerMetadata` key carries confidence through the Gateway is undocumented.
- **Severity:** medium.
- **Steps:** ran `scripts/triage-live.ts` (5 hand-written windows) through the Gateway with `typesafe-ai/jev-1.13.0`.
- **Result:** `providerMetadata` keys are `typesafe` (confidence per question) and `gateway` (routing only). Choice probabilities are present and finite. Probabilities are rounded and saturate at 1.
- **Workaround:** pin `typesafe-ai/jev-1.13.0`; read confidence from `providerMetadata.typesafe.confidence`; routing uses `probabilities`.
- **Suggestion:** document alias targets and the metadata key.

## F-09 · Bee: every speaker is "Unknown", so recommendation direction is undecidable
- **Task:** M1-T8 (Jev criteria).
- **Expected vs actual:** expected a speaker_1/wearer label per the docs; actual transcripts label every line "Unknown", so whether the wearer or a friend made a one-to-one recommendation cannot be read from the text.
- **Severity:** medium.
- **Workaround:** criteria decide from wording cues; uncertain items go to Slack review; "Earmark that" voice trigger.
- **Suggestion:** Bee should expose an `is_wearer` flag on utterances.

## F-10 · Bee: broadcast and ad audio is recorded with no signal separating it from live speech
- **Task:** backfilling Tarik's 11 real conversations (M1).
- **Expected vs actual:** expected the transcript to contain mostly people talking to each other. Actual: Bee records whatever plays in the room, so most of the first 32 saved recommendations were podcast sponsor reads, radio spots and Radio Milwaukee's own station ID. Nothing in the transcript (every line is "Unknown", see F-09) marks a line as media audio, and Jev read "you should try X" in ad copy as a real recommendation.
- **Severity:** high (more than half the garden was noise).
- **Workaround:** a fourth Jev question, "is this advertising or broadcast media?", asked in the same call; ambient windows above 0.5 are dropped before extraction. Voice notes skip the check. After the re-run, 32 recommendations became 18; one station-ID item ("88.9") still got through.
- **Suggestion:** Bee flags utterances that come from a speaker or device rather than a person in the room, or exposes speaker diarization so media audio becomes its own speaker.
