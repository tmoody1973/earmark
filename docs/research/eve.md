# Vercel eve: research for Earmark (2026-10-16)

## Source note (read first)
- Primary source: docs bundled inside npm package `eve@0.80.0` (`node_modules/eve/docs/**`, 124 files; the plugin skill at `~/.claude/plugins/cache/temp_git_*/skills/eve/SKILL.md` says these match the installed version exactly). Every `eve.dev/docs/<path>` URL below is the web twin of a bundled file; I read the bundled copy. Only https://eve.dev/docs (Getting Started) was fetched over HTTP. Other eve.dev pages: not individually fetched.
- Also read: `npm view eve`, GitHub repo vercel/eve via `gh`, CHANGELOG.md in the package, https://flaviocopes.com/vercel-eve/, the New Stack URL (body truncated by fetch: NOT DOCUMENTED there).
- I ran the real scaffold in /private/tmp/claude-502/eve-probe/scaffold/probe-agent (left in place). I also executed `defineTool(...).execute(...)` in node (see Q2).

## 0. Version / status
- Latest: `eve@0.80.0`, published 2026-10-15 (GitHub release tag `eve@0.80.0`, 2026-10-15T20:44:32Z). dist-tags: latest 0.80.0, beta 0.6.0-beta.20. 253 versions. Apache-2.0. Node >=24 required. Source: `npm view eve`; https://github.com/vercel/eve/releases
- Preview: "eve is in preview; the framework, APIs, documentation, and behavior may change before general availability." https://eve.dev/docs (bundled README.md, "Legal and safeguards")
- Pin: `"eve": "0.80.0"` (exact, not `^`). Scaffold ships `"eve": "^0.80.0"`, `ai ^7.0.137`, `zod 4.5.4`, `typescript 7.0.2`, `@vercel/connect 2.5.2`, `engines.node 24.x`. Source: scaffold package.json (probe-agent).
- Release cadence is ~daily/weekly (211 changelog sections); minor versions carry breaking changes. https://github.com/vercel/eve/blob/main/packages/eve/CHANGELOG.md (bundled CHANGELOG.md)
- Breaking changes seen (relevant to old tutorials): 
  - 0.76.0: `load_skill` removed -> `eve__skill`; `eve` and `eve__*` names reserved (a tool/skill/connection named `eve` fails build); `task_wait` -> `eve__task_wait`; connection approvals keyed `<connection>__<tool>`.
  - 0.72.0: `evaluate` -> `decide` (eve/ai); AI SDK "evaluation model" -> "decision model" (`ai@7.0.128`).
  - Earlier (entry ~0.6x-0.7x): `autoModel` import removed; replaced by `auto` from `eve/models` (see Q5).
  - 0.66.0: `ctx.getSkill()` removed.
- Repo: https://github.com/vercel/eve (5,576 stars, pushed 2026-10-16). There is NO top-level `examples/` folder. Examples are in `apps/templates/` (eve-chat-template, eve-llm-council-template, eve-slack-agent-template, eve-voice-template, personal-agent-template) and `apps/fixtures/` (weather-agent, agent-tui-client, datadog-eval-reporter). Source: `gh api repos/vercel/eve/contents/apps/templates`. Slack template has agent/{agent.ts,channels,instructions.md,skills,tools} (tools/get_weather.ts); no schedules dir.

## 1. `npx eve@latest init`
Command: `npx eve@latest init my-agent` (creates project, installs deps, `git init`, opens TUI). `-n/--non-interactive` returns after scaffolding. `--model <provider/model>` `--reasoning <effort>` `--channel-web-nextjs`. There is NO `--no-install` flag (I tried; "unknown option"). In an existing project with package.json: `npx eve@latest init .` adds `agent/` plus missing `eve`, `ai`, `zod`. Sources: https://eve.dev/docs (getting started); bundled reference/cli.md `eve init` section.

Actual scaffold (ran `init probe-agent -n`, eve v0.80.0, 23s):
```
probe-agent/
  package.json  tsconfig.json  .gitignore  .vercelignore  README.md  AGENTS.md  CLAUDE.md  package-lock.json
  agent/
    agent.ts            # defineAgent({ model: "openai/gpt-6-luna-fast", reasoning: "high" })
    instructions.md     # "You are a general-purpose AI agent powered by eve..."
    channels/eve.ts     # eveChannel({ auth: [vercelOidc(), localDev(), placeholderAuth()] })
```
scripts: build=`eve build`, deploy=`eve deploy`, dev=`eve dev`, eval=`eve eval`, start=`eve start`, typecheck=`tsc`. `package.json#imports`: `"#*": "./agent/*"`, `"#evals/*": "./evals/*"`. No tools/skills/schedules/connections dirs are created; you add them.

Folder names (confirmed) under `agent/`: `agent.ts, instructions.md|ts|instructions/, instrumentation/, channels/, connections/, extensions/, hooks/, skills/, lib/, memory/, sandbox/, tools/, schedules/, subagents/`. Evals live OUTSIDE `agent/`, in `evals/` beside it. Names derive from file path (`agent/tools/get_weather.ts` -> tool `get_weather`). `*.test.*`/`*.spec.*`/`__tests__/` are ignored by discovery. Source: bundled reference/agent-files.md (https://eve.dev/docs/reference/agent-files). A flat layout (agent.ts, tools/ at app root, no `agent/`) is also supported.

### Tool signature
```ts
// agent/tools/get_weather.ts
import { defineTool } from "eve/tools";
import { z } from "zod";
export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().min(1) }),   // Zod / Standard Schema / JSON Schema; REQUIRED (z.object({}) for none)
  async execute({ city }, ctx) { return { city, condition: "Sunny", temperatureF: 72 }; },
});
```
Optional: `outputSchema`, `approval`, `toModelOutput`, `label`, `endsTurn`, `deferred`, `availableInSubagents`. `execute` may be sync/async/async generator. Tools run in the app runtime with full `process.env`, NOT in the sandbox. Output must be JSON-serializable. Source: bundled tools/overview.mdx (https://eve.dev/docs/tools). Note: eve does not auto-retry a throwing tool; step interrupted mid-execution re-runs, so side effects must be idempotent (same page).

### Schedule signature (cron)
```ts
// agent/schedules/heartbeat.ts
import { defineSchedule } from "eve/schedules";
export default defineSchedule({ cron: "*/5 * * * *", markdown: "Pull open Linear issues and POST a summary." });
```
or handler form:
```ts
import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack";
export default defineSchedule({
  cron: "0 9 * * 1-5",                         // 5-field, minute granularity, UTC on Vercel
  async run({ to, waitUntil, appAuth }) {      // arbitrary TS; the LLM runs only if you call .send()
    waitUntil(to(slack, { channelId: "C0123ABC" }).send("Summarize.", { auth: appAuth }));
  },
});
```
Exactly one of `markdown` or `run`. Also a plain `agent/schedules/x.md` with `cron:` frontmatter. Each fire = new session. `eve dev` NEVER fires schedules on cron; trigger with `curl -X POST http://localhost:2000/eve/v1/dev/schedules/<name>`. On Vercel each becomes a Vercel Cron Job (needs Vercel CLI >= 56.4.0 for local `vercel build`). Markdown-form session that calls an approval-gated tool FAILS (no channel to ask). Source: bundled schedules.mdx (https://eve.dev/docs/schedules).

### HTTP channel (custom) signature
```ts
// agent/channels/intake.ts   (file stem = channel id)
import { defineChannel, POST } from "eve/channels";
export default defineChannel({
  routes: [
    POST("/intake/events", async (request, { from, to, params, waitUntil, attachSession, invokeTool, describe }) => {
      const body = await request.json();               // you own parsing/verification
      // pure deterministic code here, no LLM:
      return Response.json({ ok: true });
      // OR hand to agent: await from(body.threadId).send(body.message, { auth: null });
    }),
  ],
  events: { "message.completed"(event, channel, ctx) { /* observe */ } },
});
```
- Route `path` is the literal app URL (NOT prefixed by channel name); do not use `/eve/v1/*`. Methods: `GET, POST, WS`. `cors` is opt-in.
- YES, a custom channel route can run deterministic code with no LLM: the handler is just `(Request, args) => Response`; the LLM only runs if you call `from(addr).send(...)`, `to(channel,target).send(...)`. Source: bundled channels/custom.mdx (https://eve.dev/docs/channels/custom).
- `invokeTool(name, input, { auth, key })` runs a compiled tool directly "outside any conversation: no model, turn, or workflow run" and resolves to `completed | invalid-input | denied | failed | approval-required | authorization-required`. Same page.
- Security: you must verify signatures and dedupe yourself ("`send(...)` does not deduplicate"). `send` needs `auth` (use `null` or a principal object `{authenticator, principalType, principalId, attributes}`). Same page.
- The DEFAULT channel (`agent/channels/eve.ts`, `eveChannel({auth})`) is the built-in HTTP API; every message there goes to the LLM. Routes: `GET /eve/v1/health`, `GET /eve/v1/info`, `POST /eve/v1/session` (body `{message, operationId?}` -> `{ok, sessionId, status:"accepted"}`), `POST /eve/v1/session/:id` (`{message}` or `{inputResponses:[{requestId, optionId}]}`), `/cancel /clear /compact /reset`, `GET /eve/v1/session/:id/stream` (NDJSON). Source: bundled channels/eve.mdx (https://eve.dev/docs/channels/eve).

### Slack channel + approve/edit/dismiss
```ts
// agent/channels/slack.ts  (created by `eve add channel/slack`)
import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";
export default slackChannel({ credentials: connectSlackCredentials("slack/my-agent") });
```
Portable alternative: env `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`; scopes `app_mentions:read, chat:write, im:history, files:read, files:write`. Events route to `/eve/v1/slack`. Source: bundled channels/slack.mdx (https://eve.dev/docs/channels/slack).
- Built-in HITL for tool approval = Slack buttons with option ids `approve` and `cancel` (Cancel = dismiss). Approval card retires after the click. NO built-in "edit" button. Edit must be custom: add a `renderers: [...]` entry (or `renderInputRequestBlocks`) and handle the click in `onInteraction(action, ctx)` (opens modal via `ctx.slack.request("views.open", {trigger_id, view})`; trigger_id valid ~3s). `onInputResponse(ctx, submission)` gates who may answer. Same page, sections "Human-in-the-loop (HITL)" and `onInteraction`.
- `approvalChannel: (request) => "direct-message" | "thread"` picks where cards go.
- Approval policy on a tool (`eve/tools/approval`: `always() | once() | never() | auto()` or a function `({session, toolInput}) => "user-approval" | "not-applicable" | "approved" | "denied" | {type, reason}`); `approval: { request, prompt: ({input}) => string, response: ({request, response}) => ({status:"allowed"}|{status:"rejected", reason}) }`. Default when omitted = `never()` (runs without approval). Only the requester can approve by default. Source: bundled tools/human-in-the-loop.md (https://eve.dev/docs/human-in-the-loop).
- Proactive post: `to(slack, { channelId, threadTs?, initialMessage? }).send(msg, {auth})` from a schedule or custom channel. Posting WITHOUT an agent turn: `ctx.thread.post(...)` in a handler, or `callSlackApi(...)` outside one. Same slack.mdx, "Proactive sessions".
- Approvals can be answered over plain HTTP too: `{"inputResponses":[{"requestId":"req_A","optionId":"approve"}]}`; a deny note: `{requestId, optionId:"cancel", text:"..."}` (human-in-the-loop.md).

## 2. Plain TS from channel/schedule; tools as functions
- Schedule `run` and channel route handlers are ordinary async TS; call any module (`import { x } from "../lib/x"`). `agent/lib/` = "Import-only shared authored helper code". Sources: schedules.mdx, custom.mdx, reference/agent-files.md.
- Tools as plain functions: VERIFIED at runtime in the probe: `defineTool({...}).execute({a:1}, {})` returns the value (`typeof t.execute === "function"`, result 2). Types (`dist/src/tools/definition.d.ts`) keep `execute` on the returned object. Caveat: `ctx` (sandbox, session) won't exist if you pass `{}`; keep deterministic logic in `agent/lib/*.ts` and have the tool be a thin wrapper. Alternatively `invokeTool` from a channel (above), which runs the tool through eve (validation, approval policy).
- Recommended for "models only decide": pipeline in `agent/lib/pipeline.ts`; schedule `run` and channel route call it directly; tools wrap individual steps; call `.send()` only for the decision step.
- Channel->schedule handoff is `to(...)`; channel->channel from route is `to(channel, target)`. (custom.mdx "Cross-channel hand-off")

## 3. Evals
- Layout: `evals/evals.config.ts` (exactly one, REQUIRED, `defineEvalConfig({})` minimum) + `evals/**/*.eval.ts`; id = file path (`evals/weather/brooklyn-forecast.eval.ts` -> `weather/brooklyn-forecast`). A file may default-export an ARRAY to fan out over a dataset. Source: bundled evals/overview.mdx, cases.mdx (https://eve.dev/docs/evals/overview).
```ts
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
export default defineEval({
  description: "...",
  async test(t) {
    const turn = await t.send("What is the weather in Brooklyn?");
    t.succeeded(); t.calledTool("get_weather"); t.check(turn.message, includes("Sunny"));
  },
});
```
- Optional fields: `description, judge, tags, metadata, timeoutMs, reporters`. Assertions: scoped (`succeeded, parked, calledTool, notCalledTool, toolOrder, usedNoTools, maxToolCalls, noFailedActions, calledSubagent, loadedSkill, event, eventOrder, eventsSatisfy`), value (`t.check(value, includes|equals|matches(zod)|similarity|satisfies)`; `similarity` is soft 0-1 Levenshtein, others gate), LLM judge `t.judge(criteria)` with boolean/score/choice, `.atLeast(x)` soft, `.gate(x)` hard (default judge model `typesafe-ai/jev`). Tool stubs available (evals/tool-stubs.mdx). Sources: assertions.mdx, judge.mdx.
- Run: `eve eval [ids] [--tag --exclude-tag --strict --timeout --max-concurrency(8) --junit path --json --list --verbose --url <remote> --skip-report]`. Exit 0 pass / 1 fail / 2 config error. Soft misses fail only under `--strict`. Evals use a LIVE model (need credentials in CI). Source: evals/running.mdx.
- Reported: per-eval pass/fail/skipped/"scored", failed assertion messages, judge scores, captured event streams; artifacts in `.eve/evals/<timestamp>/{summary.json,results.jsonl,...}`; reporters `Braintrust`, Datadog, JUnit XML. Token/cost/latency metrics as built-in reported fields: NOT DOCUMENTED in evals pages I read (reporters.mdx lines 1-40, judge.mdx, running.mdx); you can assert on them yourself via `satisfies`. Looked in: bundled docs/evals/*.

## 4. Local dev, exposure, deploy
- `npm run dev` = `eve dev` -> dev server + terminal UI. Default port `$PORT`, then **2000**; `--port`, `--host`, `--no-ui` (headless; use this for scripts). Health: `GET /eve/v1/health`. Source: bundled reference/cli.md `eve dev` (https://eve.dev/docs/reference/cli). `eve start` (production) defaults port `$PORT` then 3000.
- Exposing local server to Slack/webhooks (ngrok/cloudflared, etc.): NOT DOCUMENTED in the pages I read (searched channels/slack.mdx, guides/dev-tui.md, cli.md). Note Slack preview deploys need Deployment Protection exception (slack.mdx troubleshooting). Practical: deploy a preview, or tunnel yourself.
- Deploy: `eve link` (link/create Vercel project, pull env) then `eve deploy` (runs `vercel deploy --prod --logs`), or git push to a connected Vercel project. Hosted build writes `.vercel/output`. Uses Vercel Workflow (durability), Cron, Sandbox, AI Gateway. Source: bundled guides/deployment/vercel.mdx (https://eve.dev/docs/guides/deployment/vercel).
- Function limits: eve sets `maxDuration: "max"` on its workflow function routes (dist/src/internal/nitro/host/vercel-build-output-config.js). Actual numeric Vercel plan limits: NOT DOCUMENTED in eve docs (looked in guides/deployment/*, agent-config.md). Only stated: Vercel Functions request body 4.5 MB (channels/eve.mdx "Send files").
- Durability: session = durable Vercel Workflow run; crash/timeout/redeploy resumes from last completed step; completed steps never re-run; interrupted step re-runs. Default session timeout 30 days (`sessionTimeoutMs`). No automatic tool retry. Sources: concepts/execution-model-and-durability.mdx, tools/overview.mdx, agent-config.md.
- **Coexisting with Next.js (answer):** one repo, ONE Vercel project. Easiest: eve agent in `agent/` at the Next.js project root, `next.config.ts`:
```ts
import { withEve } from "eve/next";
export default withEve({} /* nextConfig */);   // mounts agent at /eve/v1/*, proxies in dev, adds Vercel service + cron
```
  Browser: `useEveAgent()` from `eve/react` (same origin, cookies sent; configure channel auth). Peer layout: `apps/web` + root agent, `withEve(nextConfig, { eveRoot: "../.." })`, or compose via root `vercel.ts` with `withEve` from `eve/vercel` (services: `web` nextjs root `apps/web`). Both deploy agent + web together in one Vercel project (not independent releases). Local `npm run dev` runs both. Generated option: `eve add channel/web`. Sources: bundled guides/frontend/nextjs.mdx; concepts/project-structure.mdx; guides/deployment/vercel.mdx.
- Custom channel endpoints (your own webhook routes) are NOT public automatically on the `eve/vercel` composition; add an explicit route to the generated service (vercel.mdx "Custom agent channel endpoints"). Within `withEve` (Next) topology, custom route reachability: NOT DOCUMENTED (nextjs.mdx mentions only `/eve/v1/**` rewrite) - verify with a test deploy.

## 5. Env vars, AI Gateway, models, auto
- String model id => Vercel AI Gateway. On Vercel: project OIDC, no key needed. Elsewhere: `AI_GATEWAY_API_KEY`. Direct providers: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` via `openai()` / `anthropic()` from `eve/models/openai|anthropic`, or any AI SDK `LanguageModel`. Sources: guides/deployment/overview.md (Configure credentials), self-hosting.md, agent-config.md.
- Local: `.env.local` (git-ignored via `.env*`); `eve link` pulls the Vercel project's env vars. TUI `/login` stores a model connection (Vercel account, AI Gateway key, OpenAI/Anthropic key, or ChatGPT subscription; the ChatGPT one cannot run in deployment). Sources: getting-started.mdx, scaffold .gitignore, agent-config.md, vercel.mdx. Tools get full `process.env` (tools/overview.mdx). Env-var schema/validation feature: NOT DOCUMENTED.
- Model ids appearing in bundled docs/scaffold: `openai/gpt-6-luna-fast` (default, reasoning "high"), `openai/gpt-6-luna`, `openai/gpt-6-sol`, `anthropic/claude-opus-5.5`, `anthropic()` default `claude-sonnet-5`, `typesafe-ai/jev` (decision/judge model). The flaviocopes post uses `anthropic/claude-sonnet-4.6` (stale). Check the live AI Gateway list before choosing. `agent/agent.ts` requires `model` when present. `eve set model <id>` edits the file.
- **`autoModel` NO LONGER EXISTS.** CHANGELOG: "Move automatic model selection to `auto` from `eve/models` ... The former `autoModel` ... imports are no longer available." Current:
```ts
import { defineAgent } from "eve"; import { auto } from "eve/models";
export default defineAgent({ model: auto({ options: { "openai/gpt-6-sol": "Difficult reasoning", "openai/gpt-6-luna": "Routine, fast" }, fallback: "openai/gpt-6-luna" }) });
```
  Decider defaults to `typesafe-ai/jev` via Gateway; AI SDK decision API "experimental and can change in patch releases". Source: bundled guides/decide.md (https://eve.dev/docs/guides/decide); CHANGELOG.md.
- Instructions: `agent/instructions.md` (flat md, always-on system prompt) or `.ts`/dir. Skills: `agent/skills/x.md` or `x/SKILL.md` with `description` frontmatter; loaded via `eve__skill`. Connections: `agent/connections/<name>.ts` with `defineMcpClientConnection` / `defineOpenAPIConnection` (from `eve/connections`); model never sees URL/creds. Sources: skills.mdx, instructions.mdx, connections/overview.mdx.

## 6. Pinning & caveats
- Pin `eve@0.80.0`, `ai@7.0.137`-ish, Node 24. Read `node_modules/eve/docs` after install (AGENTS.md in the scaffold tells agents to do this).
- Defaults are permissive: omitted `approval` = runs without approval; sandbox egress not deny-all; `placeholderAuth()` rejects production browser requests until replaced (README.md, channels/eve.mdx).
- Heavy Vercel coupling (Workflow, Sandbox, Cron, Gateway, Connect). Self-hosting exists (`eve build && eve start`, Nitro) but requires own workflow storage/sandbox (guides/deployment/self-hosting.md).
- CLI telemetry on by default; `eve telemetry disable` or `EVE_TELEMETRY_DISABLED=1` (cli.md).

## 7. Friction-log candidates
1. flaviocopes article shows `needsApproval: ({ toolInput }) => ...`; 0.80.0 docs/types use `approval` (+ `auto/always/once/never` or policy fn). Third-party snippets are stale.
2. Same article: `anthropic/claude-sonnet-4.6`; docs use gpt-6-luna/claude-opus-5.5/sonnet-5. Prior-art `autoModel` mentions are dead; `auto` is current. No migration note in docs pages, only in CHANGELOG.
3. User brief said "examples folder"; repo has none. Templates are in `apps/templates`, undiscoverable from README.
4. `eve init --non-interactive` still installs dependencies; no `--no-install` (cost: 23s + node_modules in any dir).
5. `eve init` output when run non-interactively prints a long coding-agent prompt ("Build this eve agent with the user") to stdout, which pollutes scripted use.
6. Docs say Slack HITL is approve/cancel only; "edit" needs custom renderer + modal; no worked example for an edit-then-approve flow.
7. No documented way to tunnel `eve dev` for Slack/webhook testing; no documented Vercel plan limits for eve functions (only `maxDuration: "max"` in code).
8. Docs state `eve dev` never fires cron; dev trigger route is the workaround (documented, but easy to miss).
9. Custom channel routes are not auto-public in the `eve/vercel` service composition; the `eve/next` page is silent on it.
10. Markdown-form schedule + approval-gated tool = session fails silently (no channel). Need handler-form or `approval: not-applicable` for `appAuth`.
11. Evals page lists no token/latency/cost metrics even though sessions track usage.
12. eve.dev/docs page navigation absent in fetch (links only in body); the New Stack article body truncated in fetch.
