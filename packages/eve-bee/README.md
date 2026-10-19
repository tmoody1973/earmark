# eve-bee

Connect a [Bee](https://docs.bee.computer) wearable to an [eve](https://eve.dev) agent, and sort what you hear with a
decision model. Extracted from [Earmark](https://github.com/tmoody1973/earmark), which uses it to catch the
recommendations people give you out loud. MIT licensed.

## What it is

Bee records your conversations and turns them into transcripts. This package is the plumbing between those
transcripts and an agent:

- **`createBeeClient()`**: a typed client for the Bee REST API (conversations, voice notes, facts, todos, search,
  and the `/v1/changes` feed for catching up on anything you missed).
- **`relay/run.sh` + `relay/forward.ts`**: keeps `bee stream` running on a machine where you ran `bee login`, and
  POSTs every live event to your agent. The secret goes in an `x-earmark-key` header, never the URL. `bee stream`
  exits when its connection drops, so the script restarts it (3 s backoff, doubling to 60 s).
- **`parseBeeEnvelope()`**: checks each event the relay sends and gives you a typed `BeeEvent`.
- **`parseEarmarkTrigger()`**: spots "Earmark that, …" at the start of a voice note, including the ways
  speech-to-text mishears it ("ear mark", "remark"). `detectEarmarkTrigger()` also matches a bare "Earmark that."
- **`triageWindow()`**: one `experimental_decide` call (AI SDK 7) per few lines of transcript. It answers: is this a
  recommendation to you, an idea, a recommendation you gave, or nothing; what kind of thing is it; is it a joke; is
  it an ad or broadcast playing nearby. Each answer comes with a probability. The model is Jev
  (`typesafe-ai/jev-1.13.0`) through the Vercel AI Gateway by default.
- **`skills/triage-bee-windows.md`**: an eve skill with the routing rules (what to accept, what to ask about, what to
  drop). Copy it into your agent's `agent/skills/` folder.

## Install

Not on npm yet (see [Publishing](#publishing)). Until then, build it from this repo and install the folder:

```bash
cd packages/eve-bee && pnpm build
cd /your/agent && pnpm add /path/to/earmark/packages/eve-bee ai@^7.0.142 zod@^4
```

Node 22.18 or newer (the relay's `forward.ts` runs as TypeScript directly).

## Example: triage your latest Bee conversation

```ts
import { createBeeClient, triageWindow } from "eve-bee";

const bee = createBeeClient(); // reads BEE_TOKEN
const { conversations } = await bee.listConversations({ limit: 1 });
const [latest] = conversations;
if (!latest) throw new Error("no conversations yet");

const { conversation } = await bee.getConversation(latest.id);
const lines = conversation.transcriptions.flatMap((t) => t.utterances).map((u) => `${u.speaker}: ${u.text}`);

// Short, overlapping windows (4 lines, step 2): the model reads best when the text is short.
for (let i = 0; i < lines.length; i += 2) {
  const window = lines.slice(i, i + 4).join("\n");
  const t = await triageWindow(window);
  const live = t.broadcastProbability <= 0.5 && t.jokingProbability <= 0.5;
  if (t.kind === "rec_to_user" && live && t.kindProbability > 0.9) {
    console.log(`${t.recType} tip (p=${t.kindProbability.toFixed(2)}):\n${window}`);
  }
  if (i + 4 >= lines.length) break;
}
```

Bee labels every speaker `Unknown`, so the model decides who is recommending what from the words alone.

Switch models per call with `triageWindow(text, { model: "openai/gpt-6-luna-decisions" })`, then re-tune your
thresholds: different decision models are not calibrated against each other.

## Example: the "Earmark that" trigger

```ts
import { parseEarmarkTrigger } from "eve-bee";

parseEarmarkTrigger("Okay, earmark that: the new Lena Quill album.");
// { matched: true, body: "the new Lena Quill album" }
parseEarmarkTrigger("we earmarked that budget last year");
// { matched: false }
```

## Example: receive live events in an eve channel

```ts
// agent/channels/bee.ts
import { createHash, timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import { parseBeeEnvelope } from "eve-bee";

const digest = (s: string) => createHash("sha256").update(s).digest();

export default defineChannel({
  routes: [
    POST("/api/bee/events", async (request, { waitUntil }) => {
      const key = request.headers.get("x-earmark-key") ?? "";
      if (!timingSafeEqual(digest(key), digest(process.env.EARMARK_WEBHOOK_SECRET!))) {
        return new Response("unauthorized", { status: 401 });
      }
      const event = parseBeeEnvelope(await request.json());
      waitUntil(handle(event)); // answer fast: the relay sends events one at a time
      return Response.json({ ok: true });
    }),
  ],
});
```

Then run the relay on the machine where you ran `bee login`:

```bash
EARMARK_RELAY_URL="https://your-app.example/api/bee/events" EARMARK_WEBHOOK_SECRET="…" ./node_modules/eve-bee/relay/run.sh
```

Delivery is at most once: an event that fails to POST is dropped. Poll `bee.changes(cursor)` every few minutes as a
backfill.

## Environment variables

| Variable | Used by | Default |
|---|---|---|
| `BEE_TOKEN` | `createBeeClient()` when you don't pass `{ token }` | none; it throws if missing |
| `BEE_API_BASE` | `createBeeClient()` when you don't pass `{ baseUrl }` | `https://api.developer.bee.amazon.dev` |
| `TRIAGE_MODEL` | `triageWindow()` when you don't pass `{ model }` | `typesafe-ai/jev-1.13.0` |
| `AI_GATEWAY_API_KEY` | the AI SDK, for the model call | not needed on Vercel |
| `EARMARK_RELAY_URL`, `EARMARK_WEBHOOK_SECRET` | the relay | URL defaults to `http://localhost:2000/api/bee/events` |

## What it deliberately leaves out

- **No Earmark data.** No transcripts, tips, people or labels; every example and test sentence is invented.
- **No screens, no database, no storage.** What you do with a triaged window is up to your agent.
- **No routing code.** The thresholds live in the skill file as starting points, because they must be tuned per
  model on your own labeled examples.
- **No webhook handler with logging, no enrichment, no music or place lookups.** Those are Earmark's.

## Caveats

- `experimental_decide` is experimental in AI SDK 7. Pin `ai`.
- A whole-call failure (gateway down, bad key) throws. Keep the conversation for a later retry rather than recording
  "nothing found"; `SystemicTriageError` is exported for that.

## Publishing

Not done yet; it needs the owner's npm account. The steps, from the repo root:

```bash
cd packages/eve-bee
pnpm build && pnpm test
npm publish --access public --dry-run   # check the list: dist/, relay/, skills/, README.md, LICENSE, package.json only
npm publish --access public             # only after the owner says yes
```

## Working on it

The source lives here in `src/`, and Earmark imports it by path, so there is one copy. `relay/` and `LICENSE` are
copies of Earmark's files; CI fails if they drift. Run `pnpm build` and `pnpm test` in this folder.
