# Earmark triage models: research (2026-10-16)

Method: raw `.md` docs fetched with curl, plus the real `ai@7.0.142`, `@ai-sdk/gateway`, `@ai-sdk/openai`, `@ai-sdk/typesafe-ai@3.0.20` packages installed and read (type declarations and compiled JS). Sample code in section 1 was type-checked with `tsc --strict` against those versions (TSC_OK).

## 0. Headline corrections to the brief

1. **`experimental_evaluate` is now a deprecated alias of `experimental_decide`.** `ai@7.0.142` d.ts: `/** @deprecated Use experimental_decide instead. */ export declare const experimental_evaluate: typeof decide;` Use `experimental_decide`. (Source: `node_modules/ai/dist/index.d.ts` line ~8418; https://ai-sdk.dev/docs/ai-sdk-core/decisions; https://vercel.com/ai-gateway/models/jev.md shows `import { experimental_decide as decide } from 'ai'`.)
2. **Yes/no question type is `boolean`, not `noul`**, in the AI SDK. Jev's own HTTP API and `@typesafe-ai/sdk` still call it `noul`. The AI SDK adapter maps `noul` to `{type:'boolean', probability}` (`@ai-sdk/typesafe-ai/dist/index.js` lines ~199-205). (Source: https://ai-sdk.dev/docs/ai-sdk-core/decisions "Question types" table.)
3. **Choice `criteria` is an object map** `{ optionName: description }`, not an array. Score `criteria` is an array. (Source: `@ai-sdk/provider` `DecisionModelV4Question`; https://ai-sdk.dev/docs/ai-sdk-core/decisions)
4. **Jev takes text and JSON state only through the AI SDK**; OpenAI Decisions takes images. (Source: https://ai-sdk.dev/docs/ai-sdk-core/decisions "Multimodal state")
5. **Gateway swap works with one string change**: `typesafe-ai/jev` -> `openai/gpt-6-luna-decisions`. Same `questions` schema. (Source: `GatewayDecisionModelId` in `@ai-sdk/gateway/dist/index.d.ts`; https://vercel.com/ai-gateway/models/gpt-6-luna-decisions.md)

## 1. `experimental_decide` (AI SDK)

### Version and import
- Needs **`ai` v7**. `ai@6.0.308` (the `ai-v6` tag) has neither symbol (grep count 0). Verified by diffing published tarballs: `ai@7.0.110` has `experimental_evaluate` only; `ai@7.0.130` through `7.0.142` have `experimental_decide` (+ deprecated `experimental_evaluate`). Rename landed between 7.0.111 and 7.0.130 (released 2026-09-22 .. 2026-10-07). Current `latest` = 7.0.142 (2026-10-15). (Source: `npm view ai dist-tags`, `npm view ai time`.)
- `ai@7` engines: node >=22; peer `zod ^3.25.76 || ^4.1.8`. (Source: `npm view ai@7.0.142 peerDependencies engines`.)
- Import: `import { experimental_decide } from 'ai'`. Types: `Experimental_DecisionModel`, `Experimental_DecisionQuestion`, `Experimental_DecisionState`, `Experimental_DecisionResult`, `Experimental_DecisionRefusalError`, `Experimental_DecisionUnsupportedQuestionTypeError`. Mock: `Experimental_DecisionMockModelV4` from `ai/test`. (Source: https://ai-sdk.dev/docs/ai-sdk-core/decisions)
- Doc status: "This API and the decision model specification are experimental and may change in patch releases." (same page)

### Signature (from `ai@7.0.142` `dist/index.d.ts`)
```ts
declare function decide<
  const QUESTIONS extends Record<string, Experimental_DecisionModelV4Question>,
  RUNTIME_CONTEXT extends Context = Context
>(opts: {
  model: DecisionModel;            // string (Gateway id) | Experimental_DecisionModelV4 instance
  state: DecisionState;            // string | JSONObject | readonly DecisionStatePart[]
  questions: QUESTIONS;
  maxRetries?: number;             // default 2
  abortSignal?: AbortSignal;
  headers?: Record<string, string>;
  providerOptions?: ProviderOptions;
  telemetry?: TelemetryOptions<RUNTIME_CONTEXT>;
  runtimeContext?: RUNTIME_CONTEXT;
  onStart?: Callback<DecideStartEvent<RUNTIME_CONTEXT>>;
  onEnd?: Callback<DecideEndEvent<RUNTIME_CONTEXT>>;
}): Promise<DecisionResult<QUESTIONS>>;

type DecisionStatePart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; data: Uint8Array | string | URL /* SDK file conventions */ }
  | { type: 'json'; value: JSONValue };

type DecisionAnswer<Q> =
  | { type: 'choice'; choice: keyof Q['criteria']; probabilities?: Record<option, number> }
  | { type: 'score';  score: number;               probabilities?: Record<string /* "0","1",.. */, number> }
  | { type: 'boolean'; probability: number };      // P(true)

type DecisionResult<Q> = {
  readonly answers: { [ID in keyof Q]: DecisionAnswer<Q[ID]> };
  readonly usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  readonly warnings: SharedV4Warning[];
  readonly rounding: { probabilityDecimals?: number; scoreDecimals?: number } | undefined;
  readonly providerMetadata: SharedV4ProviderMetadata | undefined;
  readonly response: { id?; timestamp: Date; modelId: string; headers?; body? };
};
```
Question types: `choice` (criteria = map option -> description|null), `score` (criteria = array of >=2 ordered levels), `boolean` (criteria optional `{true?, false?}`), plus `box` documented in the doc table but NOT in `DecisionModelV4Question` in the installed provider types (only choice/score/boolean). Instructions/descriptions may be string, JSON object, or JSON array. (Sources: d.ts above; https://ai-sdk.dev/docs/ai-sdk-core/decisions "Question types")

### Behavior facts
- String `model` resolves through Vercel AI Gateway unless a default provider with `decisionModel` is configured (`globalThis.AI_SDK_DEFAULT_PROVIDER`). Gateway auth: `AI_GATEWAY_API_KEY` or Vercel OIDC. (https://ai-sdk.dev/docs/ai-sdk-core/decisions "Default-provider strings")
- Direct providers: `typeSafeAi.decisionModel('jev-latest')` from `@ai-sdk/typesafe-ai` (3.0.20); `openai.decisionModel('gpt-6-luna')` from `@ai-sdk/openai`; `gateway.decisionModel(id)`. `evaluationModel(...)` kept as deprecated aliases. (same page; d.ts)
- Each question is evaluated independently. One complete result per call: no streaming, no multilabel, no batching of unrelated states. (same page "Scope and examples")
- Validation: distributions must sum to 1 (tol 1e-6, widened by declared `rounding`); invalid -> `InvalidResponseDataError`, never silently normalized. Any refusal -> `Experimental_DecisionRefusalError` with refused question ids, not retried. Unsupported question type fails the whole call. Transient failures retry (`maxRetries` 2). (same page "Errors and cancellation")
- Gateway conditional fallbacks: `providerOptions.gateway.models` (same page "Scope and examples"). Shape NOT DOCUMENTED on that page; not investigated.

### Confidence and probabilities returned
- Choice/Score: `answer.probabilities` is optional (Jev and OpenAI native both supply it). Selected-option probability: `answer.probabilities?.[answer.choice]`. (https://ai-sdk.dev/docs/ai-sdk-core/decisions "Probabilities and confidence")
- Boolean: `answer.probability` = P(true), required. "It is not confidence in either outcome." (same)
- Provider "confidence" scalar (Choice/Score only) is in `providerMetadata`:
  - Jev direct: `result.providerMetadata?.typesafe?.confidence[questionId]` (same page; `@ai-sdk/typesafe-ai/dist/index.js` line ~199-228). Boolean has none.
  - OpenAI direct: `result.providerMetadata?.openai?.confidence[questionId]` (choice/score only) (`@ai-sdk/openai/dist/index.js` line ~239). NOT in docs, read from source.
  - Via Gateway: `providerMetadata` is passed through from the Gateway response (`@ai-sdk/gateway/dist/index.js` line ~1870). Which key it carries (`typesafe` vs `gateway`) is NOT DOCUMENTED and not verified by a live call. Plan: log `providerMetadata` on the first real call, and fall back to computing confidence from `probabilities`.
- "The SDK does not promise calibration across providers." Do not reuse thresholds across Jev and OpenAI. (same page)

### Minimal correct call (type-checked): 4-option Choice + yes/no
```ts
import { experimental_decide as decide } from 'ai';

export async function triage(window: string, model = 'typesafe-ai/jev') {
  const result = await decide({
    model, // Gateway string id; needs AI_GATEWAY_API_KEY or Vercel OIDC
    state: { window },
    questions: {
      kind: {
        type: 'choice',
        instructions: 'Who is recommending what to whom in `window`?',
        criteria: {
          idea_by_user: 'The user proposes an idea',
          rec_to_user: 'Someone recommends something to the user',
          rec_by_user: 'The user recommends something to others',
          neither: 'None of the above',
        },
      },
      joking: {
        type: 'boolean',
        instructions: 'Is the suggestion in `window` clearly a joke or a hypothetical?',
      },
    },
  });
  const k = result.answers.kind;
  return {
    kind: k.choice,
    p: k.probabilities?.[k.choice],
    jevConfidence: result.providerMetadata?.typesafe?.confidence, // shape via Gateway unverified
    joking: result.answers.joking.probability,
  };
}
```
Multiple questions in one call: just add keys to `questions`; they run in parallel against the same state (https://docs.typesafe.ai/models.md "Context length": "no separate limit on the number of questions"; cookbook claims batching 13 questions is 12.2x cheaper, 10x faster: https://docs.typesafe.ai/cookbooks/parallel_questions).

## 2. Jev

### Access and ids
- Gateway id `typesafe-ai/jev`; also `typesafe-ai/jev-1.13.0`, `typesafe-ai/jev-1.14.0` (Gateway listing https://ai-gateway.vercel.sh/v1/models; `GatewayDecisionModelId`). Providers per Gateway page: typesafe-ai, digitalocean. (https://vercel.com/ai-gateway/models/jev.md)
- Which version `typesafe-ai/jev` points to is NOT DOCUMENTED. TypeSafe aliases: `jev-latest` -> `jev-1.13.0`, `jev-preview` -> `jev-1.14.0`; Jev 1.14 available from 2026-10-14. **Pin `typesafe-ai/jev-1.13.0`** (the only version with a jaggedness page) so thresholds don't move under us. (https://docs.typesafe.ai/models.md)
- Early access: unofficial awesome-jev says direct access is via waitlist at typesafe.ai, while Gateway needs no waitlist (https://github.com/kraayenjon/awesome-jev README lines 102-103). Official quickstart only says "Get an API key from the TypeSafe console" (https://docs.typesafe.ai/introduction/quickstart.md); no waitlist wording found in official docs. For the hackathon, use Gateway.

### Limits and pricing
- Price: $42 per billion input tokens = **$0.042 per 1M input tokens**; output free. Gateway shows `$0.042/1M input` (https://docs.typesafe.ai/models.md; https://vercel.com/ai-gateway/models/jev.md).
- Context: **64k tokens per request** (state + all questions) and **32k per question** (state + one question). Gateway lists `context_window 32000`. Optional long context via header `TypeSafe-Danger-Zone-Long-Context: true` -> 262k both, slower/less accurate (https://docs.typesafe.ai/models.md). Whether Gateway forwards that header: NOT DOCUMENTED.
- No cap on number of questions beyond the context limits. Choice: max 255 options. Score: max 10 levels. Body max 32 MiB. (https://docs.typesafe.ai/api.md "Request rules", "Choice", "Score")
- Rate limits: per organization, tokens/sec and requests/sec, values only in the console (https://console.typesafe.ai/rate-limits). Numbers NOT DOCUMENTED publicly; 429 on breach (https://docs.typesafe.ai/models.md "Rate limits"). Gateway-side limits: NOT DOCUMENTED (looked at the Gateway model page and models JSON).
- Input: text, or JSON object/array of text values. No audio/video. (https://docs.typesafe.ai/models.md). Images: a separate doc page says images and Box work behind header `TypeSafe-Danger-Zone-Images: true` and are "not yet up to our standards for production" (https://docs.typesafe.ai/images.md). The AI SDK says "TypeSafe AI accepts text and JSON state only" (decisions page). Treat Jev as text-only for Earmark.
- Language: English best, others "handled but not equally well" (https://docs.typesafe.ai/models.md "Language support").
- Data: not trained on customer data; ZDR for enterprise (same page). Gateway shows `zdr: "some"` for `typesafe-ai/jev`, `"all"` for the versioned ids.

### Jaggedness rules for jev-1.13 (last reviewed 2026-10-02), summarized from https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
1. Literal reading: answers the question as written; scoping words, negations, implied conditions read at face value. Fix: exact condition in `instructions`, boundary cases in criteria; if you catch yourself explaining what you meant, that explanation is the missing half of the instruction; split unavoidable interpretation into two literal questions and combine in code.
2. Math and numbers: "not a calculator". Counting (characters, occurrences, list items) unreliable and gets worse with size: iterate in code, one question per item, sum yourself. Numeric representations (hex/RGB, assembly/binary) underperform semantic ones: convert to named buckets.
3. Score outputs: do not interpolate between levels to recover a number; threshold on the expectation only ("score levels are weak in numerical calibration").
4. Dates/times: read as text; ordering, durations, window membership unreliable (worse with mixed formats, relative references, quarters). Extract parts as Choices (month/day/year with a "not stated" option), compute in code.
5. Indirection: double negatives and multi-hop reasoning cost accuracy; be direct, name the state field.
6. Large state full of irrelevant detail: accuracy falls as unrelated content grows ("context rot"); filter in code or with a Noul first. State counts once against each context limit.
7. Adversarial content: state is data but Jev does not treat it as hostile; injected instructions or self-arguing text can move answers. Be explicit in criteria; test edge cases.
8. Contradictory instructions/criteria: e.g. a Noul where true maps to no performs worse; align instruction and criteria, aim for wording an average person reads easily.
9. Choice option order: "leans toward the option that comes first". Fix: reorder options and check the answer stays consistent.
10. Generation: not trained to generate text; chaining Choices to fake it is slow and poor. Extract candidates by regex or a generative model, let Jev pick.
- Closing "avoid" list: asking things code can compute; hiding several judgments in one question; System Two (multi-layer indirection) tasks; more `state` than the question needs.
- "Short windows" is not a separate rule in the page; it follows from #6 and the context-rot warning. No jev-1.14 jaggedness page found in `llms.txt`.

## 3. OpenAI Decisions API (`gpt-6-luna`)

Source: https://developers.openai.com/api/docs/guides/decisions.md (fetched 2026-10-16).
- Status: public beta, "we expect to GA in the coming weeks". `gpt-6-luna` is the only model. Endpoint `POST /v1/decisions`. SDK minimums for direct use: JS 7.30.0, Python 3.26.0.
- Native request: `{ model: "gpt-6-luna", input: string | [{role:"user", content:[{type:"input_text",text},{type:"input_image",image_url:"data:image/png;base64,..."}]}], questions: [...] }`. `questions` is an **array** with a unique `name` each.
  - `predicate`: `{type, name, instructions}` -> answer `{type:"predicate", name, probability}`.
  - `choice`: `{type, name, instructions, choices:[{value, description}]}` -> `{choice, probabilities:[{value, probability}], confidence}`.
  - `score`: `{type, name, instructions, levels:[{label, description}]}` -> `{score, probabilities:[{value,label,probability}], confidence}`.
  - Any answer can be `{type:"refusal", name}`.
- **Images: inline base64 data URLs only.** Hosted http(s) URLs and `file_id` are not supported by the endpoint. Through the AI SDK, a `file` state part with a URL is downloaded by the SDK first ("URLs are downloaded before the model call"), so SDK callers can pass URLs/bytes. (guide above; https://ai-sdk.dev/docs/ai-sdk-core/decisions)
- Confidence: choice and score carry a separate `confidence` field; predicate has only `probability`. Guide: "Use labeled examples from your application to set thresholds ... based on the cost of false positives and false negatives."
- Through the AI SDK: yes, same `experimental_decide` schema. Gateway id `openai/gpt-6-luna-decisions` (Gateway listing `released: 1791244800` = 2026-10-06), or `openai.decisionModel('gpt-6-luna')` direct. Adapter maps `predicate` -> `boolean`, `choices` array -> `criteria` map, `probabilities` array -> record; rounds to 2 decimals (`rounding: {probabilityDecimals:2, scoreDecimals:2}`); supports `choice | score | boolean`; accepts `providerOptions.openai.safetyIdentifier` only, anything else produces a warning; reasoning options not accepted. (`@ai-sdk/openai/dist/index.js` lines ~84-245; decisions page "Provider models")
- **What to change to swap Jev for OpenAI:** only the `model` string: `'typesafe-ai/jev'` -> `'openai/gpt-6-luna-decisions'`. Questions, state and result access unchanged. Then: (a) read confidence from `providerMetadata.openai.confidence` (direct) or log what Gateway returns; (b) Boolean thresholds must be re-tuned (no cross-provider calibration promise); (c) you may now add `{type:'file', mediaType:'image/png', data: bytes}` parts to `state` (Jev cannot); (d) probabilities come rounded to 2 decimals.
- Pricing: **$0.10 per 1M input tokens**, no output/cache charges; regional-processing premiums and long-context multipliers apply (guide "Pricing and availability"). Gateway shows `$0.10/1M` (https://vercel.com/ai-gateway/models/gpt-6-luna-decisions.md). That is 2.4x Jev's $0.042.
- Context window: Gateway lists 1,050,000 for the decisions id. The `gpt-6-luna` model page says prompts over 272K input tokens price at 2x. Decisions-specific per-question or per-request caps: NOT DOCUMENTED (looked at the guide, the model page, and the API reference URL, which returned only a stub).
- Rate limits: the gpt-6-luna model page lists default tiers Build 5,000 RPM / 2M TPM, Launch 10,000 / 10M, Grow 30,000 / 180M (https://developers.openai.com/api/docs/models/gpt-6-luna.md). Whether `/v1/decisions` shares them: NOT DOCUMENTED.
- ZDR and HIPAA supported for eligible customers; data residency US and EEA+CH (guide). Gateway listing says `zdr: "none"` for this id (Gateway models JSON). Conflicts with the OpenAI page; verify before sending sensitive audio transcripts.
- Image caveat on Gateway: the models JSON lists `modalities.input: ["text"]` for `openai/gpt-6-luna-decisions` even though its own description says text and image, and the AI SDK page says "Gateway forwards image files to the routed decision model". Unverified by a live call.

## 4. Calibration and eval guidance in the docs
- NOT DOCUMENTED: no page in docs.typesafe.ai (searched llms.txt-listed pages: models, confidence, primer, system-one, jaggedness, consistency cookbooks, confidence-routing) names ECE, reliability bins/diagrams, or Brier score. grep for `brier|ECE|reliability diagram|expected calibration` returned nothing in official pages. OpenAI's guide also gives none.
- What they do say:
  - Calibration definition: across many predictions, outcomes given 0.2 happen ~20% of the time, 0.8 ~80%; "describe groups of predictions, not a guarantee about any single answer" (https://docs.typesafe.ai/introduction/machine-learning-primer.md "RLCD and calibrated decisions"; https://docs.typesafe.ai/concepts/system-one.md).
  - Thresholds are yours: "Start with conservative thresholds, test with your own data, and adjust" and "thresholds scale with risk" (https://docs.typesafe.ai/confidence.md).
  - Jev `confidence` (Choice/Score) is a fixed summary of the distribution; docs suggest also trying top probability `p_max` (threshold per question, because meaning depends on option count) and top-to-second ratio (same page). Noul has no confidence: threshold on the probability itself; near 0.5 = unsure.
  - Option-order bias: "reorder the options to double check that the answer stays consistent" (jaggedness #9).
  - Self-consistency cookbooks exist (repeat the same question and compare agreement): https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md , https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md
- Implication for Earmark (our own design, not from docs): compute ECE with ~10 equal-width bins on the selected-option probability, plus Brier score and a reliability table, ourselves from labeled windows. Evaluate each window under N random option orders (build the `criteria` object with shuffled keys; use non-integer-like key names, because JS orders integer-like keys numerically and would defeat the shuffle) and report flip rate.

## 5. Embeddings via AI Gateway
- AI SDK: `embed({ model, value, dimensions?, providerOptions?, maxRetries?, abortSignal?, headers?, ... })` returns `{ value, embedding: number[], usage: { tokens }, warnings, response? }`. `embedMany({ model, values: string[], dimensions?, maxParallelCalls?, ... })` returns `{ embeddings: number[][], usage, ... }`. `model` may be a Gateway string such as `'openai/text-embedding-3-small'`. `dimensions` must be a positive integer; the SDK forwards it and does not truncate; Gateway forwards `dimensions` and `providerOptions` to the provider. (`ai@7.0.142` d.ts lines ~7668, ~7822; https://ai-sdk.dev/docs/ai-sdk-core/embeddings.md ; https://ai-sdk.dev/docs/reference/ai-sdk-core/embed-many.md)
- Gateway embedding ids (from https://ai-gateway.vercel.sh/v1/models, `type: "embedding"`; prices per input token): `openai/text-embedding-3-small` ($0.02/M), `openai/text-embedding-3-large` ($0.13/M), `openai/text-embedding-ada-002` ($0.10/M), `google/gemini-embedding-001` ($0.15/M), `google/gemini-embedding-2` (multimodal), `google/text-embedding-005`, `google/text-multilingual-embedding-002`, `cohere/embed-v4.0`, `cohere/embed-v5.0-fast`, `cohere/embed-v5.0-pro`, `mistral/mistral-embed`, `mistral/codestral-embed`, `amazon/titan-embed-text-v2`, `alibaba/qwen3-embedding-{0.6b,4b,8b}`, `perplexity/pplx-embed-v1-{0.6b,4b}`, `voyage/voyage-{3-large,3.5,3.5-lite,4,4-large,4-lite,code-2,code-3,finance-2,law-2}`. The Gateway listing does not report dimensions.
- Dimensions (OpenAI docs): `text-embedding-3-small` = **1536**, `text-embedding-3-large` = 3072, both shortenable with `dimensions`; 8192 max input tokens (https://developers.openai.com/api/docs/guides/embeddings.md). AI SDK table agrees; also gemini-embedding-001 = 3072, mistral-embed = 1024 (https://ai-sdk.dev/docs/ai-sdk-core/embeddings.md "Embedding Providers & Models"). Dimensions for cohere v5, voyage 4, qwen3, pplx: NOT DOCUMENTED in the sources I read.
- pgvector: `vector` columns index (HNSW/IVFFlat) up to 2,000 dimensions; `halfvec` up to 4,000 (https://github.com/pgvector/pgvector README "Indexing" sections).
- **Recommendation: `openai/text-embedding-3-small`, `vector(1536)`**, cosine ops, HNSW. Cheapest of the OpenAI pair, 1536 < 2000 so it indexes without halfvec, good enough for "find 5 nearest idea clusters" on short transcript snippets, and Jev then does the final Choice. If we ever want 3-large quality, request `dimensions: 1536` so the column stays the same. Pin the dimension in a constant; changing embedding model means re-embedding every row.

```ts
import { embed, embedMany } from 'ai';
const { embedding } = await embed({ model: 'openai/text-embedding-3-small', value: text }); // number[1536]
const { embeddings } = await embedMany({ model: 'openai/text-embedding-3-small', values: texts });
```

## 6. Friction-log candidates
1. **Rename under our feet**: awesome-jev README, and the brief, say `experimental_evaluate`; docs and current package say `experimental_decide`; `ai@7.0.110` -> `7.0.130` changed it in about two weeks. Docs for the deprecated symbol are gone. Pin `ai` version.
2. **Two vocabularies for the same thing**: Jev HTTP/`@typesafe-ai/sdk` says `noul`, `criteria` for Choice is a map, response has `legend`; AI SDK says `boolean`; OpenAI says `predicate`, `choices[]`, `levels[]`, `name`. The AI SDK hides it, but Jev docs examples cannot be pasted into AI SDK code.
3. **Image support is contradictory**: Jev models page "Input: Text"; Jev images page says images work behind `TypeSafe-Danger-Zone-Images`; AI SDK says text/JSON only; Gateway lists OpenAI decisions id as text-input only while describing images.
4. **Confidence is not portable and its location is undocumented**: Jev `providerMetadata.typesafe.confidence`, OpenAI `providerMetadata.openai.confidence` (only found by reading source), Boolean has none for either, Gateway key unknown. The SDK doc says it does not promise cross-provider calibration, so a model swap invalidates thresholds.
5. **Alias ambiguity**: Gateway `typesafe-ai/jev` vs TypeSafe `jev-latest` (-> 1.13.0) vs `jev-preview` (1.14.0, released 2026-10-14). No statement which one the Gateway alias tracks; jaggedness page exists only for 1.13.
6. **Context numbers disagree**: Gateway `context_window 32000` vs docs "64k per-request / 32k per-question"; long-context header support through Gateway undocumented.
7. **Rate limits not public**: Jev limits only in the console, per organization; Gateway and OpenAI-decisions-specific limits not stated.
8. **Calibration tooling gap**: both vendors sell "calibrated" but publish no ECE/Brier/reliability procedure or numbers for a given model; we must build the measurement ourselves (and the 4.0 PRD already plans to).
9. **Gateway ZDR mismatch**: OpenAI page says Decisions supports ZDR for eligible customers, Gateway lists `zdr: "none"` for `openai/gpt-6-luna-decisions` and `"some"` for `typesafe-ai/jev`.
10. **Option shuffling gotcha**: Choice `criteria` is a JS object, so order is key insertion order, except integer-like keys, which JS sorts. Shuffle tests with numeric keys silently do nothing.
11. **Rounded OpenAI probabilities** (2 decimals via SDK `rounding`) coarsen ECE bins relative to Jev's full precision; compare like with like.
12. **Beta/experimental stack**: OpenAI Decisions public beta since 2026-10-06 (GA "in the coming weeks"), AI SDK API "may change in patch releases", Jev launched in early access 2026-09-15 per the unofficial list. Wrap the call in one function and keep a mock (`Experimental_DecisionMockModelV4`) for tests.

## 7. Not read / not verified
- Vercel KB guide https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk and the form-router template: not opened.
- https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai: not opened (read the installed package instead).
- Jev cookbooks other than skimming titles; Box question type; `@typesafe-ai/sdk` source.
- No live API call was made (no keys in this session), so Gateway response shape for `providerMetadata` and image forwarding are unverified.
- Local skill read: `~/.claude/plugins/cache/typesafe-ai/typesafe/0.5.7/skills/typesafe-ai/SKILL.md` (directs to live docs; says Noul has no confidence, thresholds must be validated per domain; ask independent questions in one call). The Vercel `ai-gateway` skill (0.50.0) has no decide/Jev content.
