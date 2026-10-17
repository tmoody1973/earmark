# Product feedback

One section per tool. Filled in as we go; finalized in M6.

## Bee (API, CLI, stream)
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## eve
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Jev (TypeSafe AI, via Vercel AI Gateway)
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## OpenAI Decisions (gpt-6-luna)
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Vercel AI Gateway
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Neon Postgres + pgvector
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Clerk
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Apple Music API + MusicKit JS
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Notion API
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Slack
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**

## Amazon Polly
- **Used for:** Voicing Earmark's weekly 5 to 7 minute recap with the generative engine (voice `Ruth`, `SynthesizeSpeech`, plain text in, MP3 out), called from a Next.js server function with `@aws-sdk/client-polly`.
- **What worked:** The SDK is one client and one command; the response is a stream with `transformToByteArray()`, so there is no polling or job to manage. MP3 output from separate calls can be joined byte for byte, which made chunking trivial. A least-privilege IAM policy needs a single action, `polly:SynthesizeSpeech`, so the access key can do nothing else. Not yet verified with a real run: TODO after first real episode (audio quality, pacing, how Ruth handles names).
- **What needs work:** Not yet measured. Known from the docs: one call takes at most 6,000 characters (3,000 billed), so a script has to be split into sentence-sized chunks before voicing. The generative engine is limited to some regions (we use `us-east-1`) and, as far as I can tell, does not return speech marks, so we cannot sync text to audio. TODO after first real episode: record actual characters billed, cost, listen-through notes on seams between chunks, and any mispronounced first names.
- **Onboarding:** Setup is an IAM user, an inline policy and an access key. One snag found while building: Vercel may reserve the standard `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` names, so the app uses prefixed names and hands the credentials to the client explicitly. TODO after first real episode: time from "no AWS key" to "first MP3".
- **Would build with it again:** TODO after first real episode.

## Vercel Blob
- **Used for:**
- **What worked:**
- **What needs work:**
- **Onboarding:**
- **Would build with it again:**
