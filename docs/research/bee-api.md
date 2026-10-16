# Bee developer platform: research for Earmark

Researched 2026-10-16. Conventions: "DOCS" = docs.bee.computer page; "SRC" = file in https://github.com/bee-computer/bee-cli (main, v0.8.0, head commit 2026-10-13); "ISSUE" = GitHub issue. Anything not found is marked NOT DOCUMENTED with where I looked. Local `bee` CLI is NOT installed on this machine (`which bee` -> not found), so no local `--help` output exists; flags below come from DOCS + SRC.

Read: /docs, /docs/api, /docs/proxy (identical to /docs/api, byte-for-byte), /docs/realtime, /docs/agentic-now, /docs/agentic-sync, /docs/cli, /docs/search, /docs/sync, /docs/mcp, /docs/skill, /docs/developer-mode, repo README, and SRC for stream/sync/conversations/journals/facts/todos/photos/search/locations. There are no standalone docs pages for facts, todos, journals, photos, speakers or threads; they live inside /docs/cli and /docs/api.

## 1. Auth, base URL, rate limits

- Base URL confirmed: `https://api.developer.bee.amazon.dev` (public CA cert, "default, recommended for experiments"). All endpoints under `/v1/*`. [https://docs.bee.computer/docs/api]
- Alternate hosts: raw TLS `https://app-api-developer.ce.bee.amazon.dev` (private CA, needs `--cacert`), local proxy `http://127.0.0.1:8787` via `bee proxy` (unauthenticated, local dev only; only `/v1/*` forwarded). [https://docs.bee.computer/docs/api]
- Header: `Authorization: Bearer $BEE_TOKEN`. Example: `curl -H "Authorization: Bearer $BEE_TOKEN" "https://api.developer.bee.amazon.dev/v1/me"`. [https://docs.bee.computer/docs/api]
- How to get a token: NOT DOCUMENTED as a raw "developer token" flow. Documented path: unlock Developer Mode in the Bee iOS app (tap Version 5 times), install CLI (`npm install -g @beeai/cli`), run `bee login` (prints an auth link, polls up to ~5 min; `--no-wait` for agents; `bee login --token <t>` / `--token-stdin` accept an existing token). [https://docs.bee.computer/docs/developer-mode, https://docs.bee.computer/docs/cli] Token is stored in OS keychain or file fallback `~/.bee/token-<env>`. [SRC sources/secureStore.ts] Docs never say where to copy the token from to set `$BEE_TOKEN`. Practical route: `bee login`, then read `~/.bee/token-prod` if keychain fell back to file, or run `bee proxy` and call localhost without a token. (Inference from SRC; not stated in docs.)
- Android: ISSUE #13 "Android Developer Mode" is closed; docs only say the iOS app. [https://docs.bee.computer/docs/developer-mode, https://github.com/bee-computer/bee-cli/issues/13]
- Rate limits: NOT DOCUMENTED. Looked in /docs/api, /docs/cli, /docs/mcp; grep of SRC for rate limit / 429 / retry-after finds nothing.
- Related open issues: #5 public-CA vs private-CA cert (reports the `app-api-developer.ce...` host fails standard TLS; the docs now offer `api.developer.bee.amazon.dev` as the fix). #9 `bee login` completes in browser but token never written on macOS (open). [https://github.com/bee-computer/bee-cli/issues/5, /issues/9]

## 2. REST endpoints

Docs list is "a representative subset, not exhaustive". The docs give NO response JSON for REST endpoints, NO query-param tables, NO general pagination description. Response shapes below are taken from the CLI source types (SRC), which is the best evidence; treat as observed-by-client, not contractual. [https://docs.bee.computer/docs/api]

Pagination convention (SRC, conversations/journals/facts/todos/photos): `?limit=N&cursor=<opaque>`; response has `next_cursor` (string or null) plus a list key and `timezone`. Cursors look like `v1-<epochMs>`. [SRC sources/resources/conversations/index.ts; ISSUE #14 shows `cursor=v1-1759379239528-6300413`]. Timestamps in responses are epoch ms numbers.

### Conversations
- `GET /v1/conversations?limit=&cursor=` (MCP clamps limit to 1-20). Response `{conversations:[{id:number, start_time, end_time|null, created_at, summary|null, state}], next_cursor, timezone}`. [SRC conversations/index.ts]
- `GET /v1/conversations/:id` (id is a positive integer). Response `{conversation:{id, start_time, end_time|null, device_type, summary|null, short_summary|null, state, created_at, updated_at, transcriptions:[{id, realtime:bool, utterances:[{id, realtime, start|null, end|null, spoken_at|null, text, speaker:string, created_at}]}], suggested_links:[{url, created_at}], primary_location:{address|null, latitude, longitude, created_at}|null}, timezone}`. [SRC conversations/index.ts]
  - Multiple `transcriptions` per conversation: CLI prefers the first with `realtime:false`, else index 0. [SRC pickTranscription]
  - States seen: `CAPTURING`, `COMPLETED` (docs example), stream shows `processing`/`processed` lowercase. Full enum NOT DOCUMENTED. [https://docs.bee.computer/docs/agentic-now; SRC]
- `GET /v1/conversations/:id/related` -> `{conversations:[...]}`. [SRC]
- No transcript-only endpoint: `bee conversations transcript <id> --since <epochMs>` fetches the whole conversation and filters client-side by `spoken_at ?? start`. [SRC conversations/index.ts]
- `bee now` (agentic) JSON: `{since, until, timezone, conversations:[{id, start_time, end_time, state, short_summary, utterances:[{speaker, text}]}]}`. [https://docs.bee.computer/docs/agentic-now]

### Search
- Keyword (BM25): `POST /v1/search/conversations` body `{query, limit (1-100, default 20), cursor, filter: conversations|daily|facts|all, sortBy: relevance|mostRecent, since?, until? (epoch ms)}`. [https://docs.bee.computer/docs/search, SRC search/index.ts, facts/index.ts]
- Neural/semantic: `POST /v1/search/conversations/neural` body `{query, limit?, since?, until?}`; conversations only; filter/sort do not apply. [https://docs.bee.computer/docs/search, SRC]
- Response shape: only `{results:[...]}` (optionally `total`) visible from test mocks; item shape NOT DOCUMENTED. [SRC search/index.test.ts]
- Journals search: `POST /v1/search/journals` body `{query, limit}` (not in the API docs page; only in SRC). [SRC journals/index.ts]

### Facts
- `GET /v1/facts?limit=&cursor=&confirmed=true|false`. CLI always sends `confirmed`; `--unconfirmed` -> `confirmed=false` ("Pending Facts"). Response `{facts:[{id:number, text, tags:string[], created_at, confirmed:bool}], next_cursor, timezone}`. [SRC facts/index.ts; https://docs.bee.computer/docs/cli]
- `GET /v1/facts/:id`.
- `POST /v1/facts` body `{"text": "..."}` (text 1-2000 chars per MCP schema). [https://docs.bee.computer/docs/api; SRC]
- `PUT /v1/facts/:id` body `{"text"?, "confirmed"?}`. CLI/MCP fetch existing text first if omitted, so whether the raw API accepts a text-less PUT is UNVERIFIED (PR #11 says "the underlying API ... never imposed" the text requirement). [SRC facts/index.ts; PR #11]
- `DELETE /v1/facts/:id`.
- Pending vs confirmed: YES, there is a state. CLI doc example for `bee facts create` prints `confirmed: false`, so POST creates an UNCONFIRMED (pending) fact. [https://docs.bee.computer/docs/cli ("bee facts create" example output)] The `confirmed` flag is not accepted on create in any documented/SRC call (only `text` is sent), so you cannot create pre-confirmed in one call; create then `PUT {confirmed:true}`.
- Bee also auto-generates pending facts from conversations (changed/sync show "Pending Facts"). [https://docs.bee.computer/docs/cli, /docs/sync]

### Todos
- `GET /v1/todos?limit=&cursor=` returns raw server response incl. completed todos; `{todos:[{id:number, text, alarm_at: epochMs|null, completed:bool, created_at}], next_cursor, timezone}`. [SRC todos/index.ts]
- `GET /v1/todos/:id`; `POST /v1/todos` `{text, alarm_at?}`; `PUT /v1/todos/:id` `{text?, completed?, alarm_at? (null clears)}`; `DELETE /v1/todos/:id`. `alarm_at` input is ISO 8601 (e.g. `2026-02-11T09:00:00Z`), output is epoch ms. [https://docs.bee.computer/docs/api]
- CONTRADICTION: the stream payload names it `alarmAt` (camelCase), REST uses `alarm_at`. [https://docs.bee.computer/docs/realtime vs /docs/api]
- Bee-suggested todos: `bee todos suggestions` (`todoSuggestions` endpoint mentioned in API docs, path/shape NOT DOCUMENTED beyond CLI text "pending Bee-suggested todos... not yet accepted or dismissed"). [https://docs.bee.computer/docs/cli, /docs/api]
- ISSUE #14 (Oct 2026): `GET /v1/todos` returned HTTP 500 on first request for that user. Treat todos list as flaky. [https://github.com/bee-computer/bee-cli/issues/14]

### Journals (voice notes)
- `GET /v1/journals?limit=&cursor=` -> `{journals:[{id: STRING, text|null, state: "PREPARING"|"ANALYZING"|"READY", created_at, updated_at}], next_cursor, timezone}`. `GET /v1/journals/:id` returns the journal object at top level (plus `timezone`). [SRC journals/index.ts]
- Voice-note vs other journal entries: NOT DOCUMENTED. SRC header says "journals domain (= voice notes)" and MCP tools are named `bee_list_voice_notes` / `bee_get_voice_note` described as "voice notes or journal-style entries". The REST schema has no `type`/`source`/`kind` field. Look: /docs/api, /docs/cli, /docs/mcp, SRC journals/index.ts, types. Conclusion: no reliable discriminator; Bee treats all journals as voice notes.
- Type mismatch: REST journal `id` is a string; stream payload `journal.id` and `journalId` are numbers (55). [SRC vs https://docs.bee.computer/docs/realtime]
- Stream journal payload has `aiResponse:{message, cleanedUpText, followUp, todos[]}`; the REST list schema exposes only `text`. [https://docs.bee.computer/docs/realtime]

### Locations
- `GET /v1/locations/clusters?limit=&min_visits=&include_visits=`, `GET /v1/locations/recent?from=&to=&limit=`, `GET /v1/locations/current`. Response shapes NOT DOCUMENTED (SRC passes through). [SRC locations/index.ts; https://docs.bee.computer/docs/cli]
- Per-conversation location is in `conversation.primary_location` (lat/long/address). See Conversations.

### Photos
- `GET /v1/photos?limit=&cursor=&start_date=YYYY-MM-DD&end_date=` (end exclusive), returns `{photos:[...]}` with items like `{id, captured_at, conversation_id|null}` (test fixture). `GET /v1/photos/:id` returns the image bytes (content-type from server). Also photos attached to a daily summary under `daily_summary.photos`. [SRC photos/index.ts, photos/index.test.ts, http.ts fetchPhoto]
- What it IS: "photos synced from your photo gallery... imported from your phone's photo library, not captured by the device." So Bee hardware does not take photos. [https://docs.bee.computer/docs/cli (Photos section)]

### Other
- `GET /v1/me`; `GET /v1/changes[?cursor]` (id lists since cursor; exact shape below); `GET /v1/daily`, `/v1/daily/:id` (daily summaries); `GET /v1/stream` SSE. [https://docs.bee.computer/docs/api; SRC changed/index.ts]
- **`GET /v1/changes` shape (observed live on Tarik's account, 2026-10-16; fixture `tests/fixtures/bee-changes.json`):** `{facts:[], conversations:[11331219], dailies:[], journals:[], todos:[], next_cursor:"v1-<epochMs>", since:<epochMs>, until:<epochMs>, updated:bool, timezone:"America/Chicago"}`. The cursor fields are TOP level (there is no `meta` wrapper) and the list key for daily summaries is `dailies`. Items are bare numeric ids (conversation ids are numbers like the stream; REST journal ids are strings, so a journal item may be a string or number and is stringified). A non-empty `journals`, `todos` or `facts` list has not been seen yet (none existed that day); the parser also accepts `{id}` objects. Without a cursor the feed bootstraps a 24 h window (`until - since` = 86 400 000 ms). `next_cursor` equals `until`. [verified live]
- **`/v1/changes` re-listing and in-progress conversations (checked live 2026-10-16, structure only):** an item is listed whenever it changed after the cursor. Conversation 11331219 was listed from a cursor of `v1-1792171000000`, was NOT listed from `v1-1792171595000` (no change since), and `getConversation` showed `state: CAPTURING`, `end_time: null`, with the utterance count growing between calls (218 then 220). So a conversation is listed while still capturing, and it is unknown whether the move to COMPLETED produces another listing; Earmark therefore keeps not-ready items on a pending list instead of relying on a re-listing.
- Threads (preview, test users only; others get `403 {"error":"test_user_required"}`): `GET/POST /v1/threads`, `POST /v1/threads/:id/messages`, `GET /v1/threads/:id/wait?after=&wait_ms=`, `GET /v1/threads/:id/messages`, `POST /v1/threads/:id/abort`, `POST /v1/threads/attachments` (multipart, 25 MB). Body `{text<=100000, file_ids<=20, wait_ms 0-120000 default 30000, client_message_id}`; 200 `{status:"completed",thread_id,message_id,text,messages}` or 202 `{status:"pending"|"stalled",...}`; list returns `{threads:[{thread_id,name,state:idle|running,created_at,updated_at}]}`. Full detail in [https://docs.bee.computer/docs/api]. Earmark should NOT depend on this.
- "Speakers": no endpoint or doc page; see section 4.

## 3. `bee stream`

- Transport: `GET /v1/stream[?types=a,b]` Server-Sent Events, `Accept: text/event-stream`, Bearer auth. CLI omits `types` param when `--types all`. [SRC commands/stream/index.ts; https://docs.bee.computer/docs/api]
- Flags: `--types <comma list|all>`, `--json`, `--agent`, `--webhook-endpoint <url>` (requires `--webhook-body`), `--webhook-body <handlebars template>` (requires `--webhook-endpoint`). Error text confirms each requires the other. [https://docs.bee.computer/docs/realtime; SRC]
- Example from docs: `bee stream --types new-utterance,new-conversation --webhook-endpoint https://example.com/hooks/agent --webhook-body '{"message":"{{message}}"}'`
- Event types (13 + connected): `connected`, `new-utterance`, `new-conversation`, `update-conversation`, `update-conversation-summary`, `delete-conversation`, `update-location`, `todo-created`, `todo-updated`, `todo-deleted`, `journal-created`, `journal-updated`, `journal-deleted`, `journal-text`. NOTE: no `conversation-ended`/`conversation-completed` event; completion is only inferable from `update-conversation` with `state:"processed"`. [https://docs.bee.computer/docs/realtime; SRC SUPPORTED_EVENT_TYPES]
- `--types` also gates the webhook. `connected` is not in SUPPORTED_EVENT_TYPES but is sent when types is empty/all.
- Raw payloads (what `--json` prints and what `{{raw}}` holds). THERE IS NO `event` FIELD in raw payloads. [https://docs.bee.computer/docs/realtime]
  - new-utterance: `{"utterance":{"text":"Hello there","speaker":"speaker_1"},"conversation_uuid":"uuid-string"}` (no timestamp, no utterance id; `conversation_uuid` is a UUID while REST uses numeric conversation ids).
    **Observed live 2026-10-16 (CLI `--json`, structure only):** `{"type":"new-utterance","conversation_uuid":"<uuid>","utterance":{"id":3766760407,"sample_id":"<uuid>","start":680.16,"end":691.36,"text":"…","spoken_at":"2026-10-16T18:05:13.000Z"}}` — it DOES carry an utterance id and `spoken_at`, and has NO `speaker`. The id equals the REST utterance id in the capturing conversation's `realtime: true` transcription (3/3 matched). REST conversations have no `uuid` field. Completed conversations keep only the final (`realtime: false`) transcription. [verified live; friction F-14]
  - new-conversation: `{"conversation":{"id":123,"uuid":"uuid-string","state":"processing","title":"Optional title"}}`
  - update-conversation: `{"conversation":{"id":123,"state":"processed","title":"...","short_summary":"..."}}`
  - update-conversation-summary: `{"conversation_id":123,"short_summary":"Summary text"}`
  - delete-conversation: `{"conversation":{"id":123,"title":"..."}}`
  - update-location: `{"conversation_id":123,"location":{"latitude":37.77,"longitude":-122.41,"name":"..."}}`
  - todo-created / todo-updated: `{"todo":{"id":10,"text":"Call dentist","completed":false,"alarmAt":1700000000000}}`
  - todo-deleted: `{"todo":{"id":10,"text":"..."}}`
  - journal-created / journal-updated: `{"journal":{"id":55,"state":"processed","text":"...","aiResponse":{"message":"...","cleanedUpText":"...","followUp":"...","todos":["..."]}}}`
  - journal-deleted: `{"journalId":55,"reason":"..."}`; journal-text: `{"journalId":55,"text":"..."}` ("raw journal text streamed in, e.g. as a voice note is transcribed").
- Webhook mechanics (SRC is authoritative; docs silent on most):
  - Method POST, header only `Content-Type: application/json`. NO signing, NO HMAC, NO auth header, no custom headers (cannot be added). [SRC sendWebhook]
  - Body = your Handlebars template rendered with `noEscape:true`. Variables: `{{message}}`/`{{agentMessage}}` (one-line "Event type: ..." text), `{{event}}` (type name), `{{timestamp}}` (ISO time the CLI RECEIVED the event, not event time), `{{raw}}` (raw JSON string), `{{data.*}}` (parsed payload). [https://docs.bee.computer/docs/realtime; SRC]
  - The only way to get a full structured body: `--webhook-body '{"event":"{{event}}","ts":"{{timestamp}}","data":{{raw}}}'`. Because escaping is off, `{{message}}` or `{{data.utterance.text}}` inside quotes will produce INVALID JSON when text contains `"` or newlines; use `{{raw}}` unquoted.
  - Retry: NONE. A non-2xx or network error is logged to stderr and the event is dropped; requests are sent serially with `await` (a slow endpoint stalls the stream loop). Template errors drop the event. [SRC]
  - Delivery semantics: docs state "does not guarantee delivery (at-most-once)"; events during disconnection are lost; "prefer a full `bee sync` snapshot" for completeness. [https://docs.bee.computer/docs/realtime]
  - Batching: none, one POST per event.
  - Reconnect: NONE in main; when the SSE connection ends the CLI prints "Stream ended." and exits. PR #16 (open, harshpuri84) adds reconnect with backoff. [SRC processSSEStream; https://github.com/bee-computer/bee-cli/pull/16] You must supervise the process (systemd/pm2) or poll `/v1/changes` as backfill.
  - SSE parser keeps only the last `data:` line per event (multi-line data would be truncated). [SRC parseSSEBuffer] Minor.
  - Alternative to a CLI-managed webhook: consume `GET /v1/stream` directly in your own server with Bearer token (documented endpoint) and keep the whole thing in-process. Stream filter param is `?types=`.

## 4. Speaker labels

- Documented values: stream example `"speaker": "speaker_1"`; `--agent` example `[speaker_1]`; `bee now` doc example and real API output `"speaker": "Unknown"`; /docs/sync example "Speaker 1:" / "Speaker 2:" (markdown rendering). [https://docs.bee.computer/docs/realtime, /docs/agentic-now, /docs/sync]
- Reality: ISSUE #19 (open, Oct 2026): every one of 15,578 utterances across 133 conversations is `"Unknown"`, even with voice enrolled and even for final (`realtime:false`) transcriptions; the README promise of speaker identification does not materialize. The device owner is NEVER identified in the API (no `is_user`/`is_wearer`). A community proposal (`is_wearer`, `diarized`) exists but no maintainer response/PR. [https://github.com/bee-computer/bee-cli/issues/19]
- Implication: do not build features that depend on distinguishing wearer vs others via the API. Realtime stream may emit `speaker_N`; unverified for real accounts.
- Related: ISSUE #21 (open): a conversation can stay `CAPTURING` for 20+ h and later recordings are appended; no documented end condition. ISSUE #3: duplicated utterances in `bee now`. [https://github.com/bee-computer/bee-cli/issues/21, /issues/3]

## 5. Issue #14

- Title: "bee sync fails: /v1/todos and /v1/daily return 500 immediately; /v1/facts 500s mid-pagination". Opened by tylerbroome09-cloud, CLI 0.7.3, Windows. State OPEN, 0 comments. [https://github.com/bee-computer/bee-cli/issues/14]
- Primary problem is SERVER-side: `GET /v1/todos?limit=5` and `GET /v1/daily?limit=3` -> 500 immediately; `GET /v1/facts?limit=100` fine for 5 pages, 500 on page 6 (cursor `v1-1759379239528-6300413`, ~2025-10-02).
- Secondary (CLI) bug: `--recent-days` / `--since` / `--full` are ignored for `facts` and `todos` targets; `syncFacts`/`syncTodos` take no options and call `fetchAllFacts`/`fetchAllTodos`, which always walk from the first page with no `from`. Confirmed still true on current main: `syncFacts(context, outputDir, task)` and `syncTodos(context, outputDir, task)` have no options parameter. Docs even state "facts and todos are always re-fetched in full." So it is partly documented behavior, partly a gap. [SRC sources/commands/sync/index.ts lines ~959-985, ~1251-1305; https://docs.bee.computer/docs/sync]
- Files involved: `sources/commands/sync/index.ts` (syncFacts, syncTodos, fetchAllFacts, fetchAllTodos, option plumbing at ~L166, L700-731), `sources/commands/sync/index.test.ts`.
- Existing PR: none found. Searched all PRs (open/closed) for "sync facts todos" and body mentions of #14: no matches. Open PRs: #20 (conversations list --all), #18 (login abort retry), #17 (usage to stderr), #16 (stream reconnect), #8 (agent opt + TUI), #2 (now start_time). Merged: #12, #11, #7, #6.
- Build/test: Bun runtime (CI pins bun 1.4.3), TypeScript strict. `bun install`, `bun run typecheck` (tsc --noEmit), `bun run build` (bun build --compile -> dist/bee), `bun test` (302 tests per PR #11), `bun run dev` runs `sources/main.ts`. Path alias `@/` -> `sources/`. Only CI workflow is release.yml (on tag `v*`); no PR CI. [SRC AGENTS.md, package.json, .github/workflows/release.yml, PR #11]
- Contribution guidelines: no CONTRIBUTING.md. AGENTS.md says: Angular-style conventional commits, commit after each successful step, before any commit run `bun install`, `bun run typecheck`, `bun run build`. Issue #10 (closed): fresh `bun install` once 401'd because bun.lock pointed at a private registry (closed; verify it works). PRs from outside contributors have been merged (#11, #12 by quinnypig). MIT license.
- Caution for a fix PR: because the server 500s on todos/daily/facts-deep-pages, a CLI-side `--recent-days` for facts/todos only helps if the API supports a date bound on those lists; the facts/todos list endpoints show no `from`/`since` param in SRC. A client-side stop-early (stop paging once `created_at` < cutoff, lists appear newest-first) is possible but unverified ordering.

## 6. Friction-log candidates

1. No developer-token story: docs say "Authorization: Bearer $BEE_TOKEN" but never say how to obtain `$BEE_TOKEN`; only `bee login` (keychain/file), and #9 says token not written on macOS. [/docs/api, #9]
2. REST docs list paths only: no response JSON, no query params, no pagination, no error table (except threads), no rate limits. Had to read CLI source. [/docs/api]
3. Docs say API list is "a representative subset"; photos, locations, insights, todoSuggestions, journals/search named without shapes.
4. `/docs/proxy` is the same page as `/docs/api` (duplicate, byte-identical).
5. Stream JSON has no `event` field; the webhook `{{event}}` is only available via template. Easy trap (docs warn explicitly because jq `.event` silently matches nothing).
6. Stream payload casing differs from REST: `alarmAt` vs `alarm_at`; journal id number vs string; conversation `uuid` (stream) vs numeric id (REST); new-utterance carries `conversation_uuid` only, with no numeric id, no timestamp, no utterance id, which makes joining stream events to REST conversations awkward.
7. State vocabulary inconsistent: stream `processing`/`processed`; REST `CAPTURING`/`COMPLETED`; journals `PREPARING/ANALYZING/READY`; stream journal `processed`. No enum documented.
8. No conversation-ended event; #21 conversations stay CAPTURING for 20+ h.
9. Webhook has no signing, no custom headers, no retry, unescaped Handlebars produce invalid JSON on quotes/newlines, serial blocking delivery, no reconnect on stream drop (PR #16 pending). Docs say "at-most-once" but not that failed webhooks are dropped.
10. `--webhook-body` required whenever `--webhook-endpoint` set; no default "send full event" body.
11. Speaker: docs/README promise `speaker_1` identification, API returns `"Unknown"` always (#19); wearer not identifiable.
12. "Photos" are phone-gallery imports, not device captures; easy to assume otherwise from the name.
13. Voice notes vs journals: MCP calls them voice notes, REST calls them journals, no type field; docs never define the relationship.
14. Fact creation yields `confirmed:false` but this is only visible in a CLI example output, never stated in prose; `PUT` text-optionality unspecified for raw API.
15. `/v1/todos`, `/v1/daily` return 500 for at least one account; deep `/v1/facts` pagination 500 (#14). `bee sync` ignores `--recent-days` for facts/todos.
16. TLS: two hosts, one with private CA (#5); public host documented only recently.
17. Docs claim `bee version` while CLI help/`bee --version` unverified locally (CLI not installed here); install package is `@beeai/cli` while repo is `bee-cli`.
18. Hackathon-specific: Android Developer Mode (#13 closed), conversation duplicates in `bee now` (#3), arm64 Linux binary missing (#1) matter if running the stream on a Hetzner/ARM box (Hetzner box is x86 per setup, fine).
19. (Observed 2026-10-16, conversation 11338188, M2-T14.) `GET /v1/conversations/:id` returns utterances NOT in spoken order (108 of 311 neighbouring pairs out of order); sort by `spoken_at` (ids are also increasing in time). Diarization can split one word across two utterances with different speakers in the same second ("Earm" | "ark that."). A voice note said while the wearer is in a conversation is captured twice: as a journal AND inside the conversation transcript (same words, a few seconds apart). The stream's `journal-*` payload has no `created_at`; REST `GET /v1/journals/:id` has it.

## 7. Search result shapes (verified live on Tarik's account, 2026-10-16 05:19 CDT)

Source: `bee search --json` (CLI 0.8.0) against the real account; doc https://docs.bee.computer/docs/search.
- Keyword (BM25, default; scope conversations + daily + facts; `filter`, `sortBy` apply): `{results:[{id: string, type: string, score: number, summary: string, snippet: string, title_snippet: string, created_at: number(ms), corrections: []}], next_cursor: string, search_mode: string, timezone: string}`. Fast.
- Neural (`--neural`, conversations only; `since`/`until` apply, filter/sort do not): `{results:[{id: number, started_at: number(ms), stopped_at: number(ms), link: string, locations: string[], short_summary: string, detailed_summary: string}], total: number, timezone: string}`. ~2.9 s for limit 2.
- Note the id type differs between modes (string vs number). `--cursor` not supported by search; page by `since`/`until`.
- Implications: never block a user-visible moment (bloom) on neural search; use keyword search with `filter: "facts"` to fetch only relevant facts for a draft.
