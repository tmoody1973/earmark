# 001 · Add three small bookkeeping tables to the data model

- **Decision** — Add `utterance_buffer`, `bee_conversation_map` and `processed_journals` to the PRD's data model, plus a "needs review" state for items.
- **Why this came up** — Bee's live stream sends one sentence at a time, labelled only with a conversation code that does not match the numbers the rest of Bee's API uses. Each request to Earmark runs in a fresh serverless function (a short-lived process that forgets everything when it finishes), so nothing remembers the last few sentences or which code matches which conversation. Without somewhere to keep that, live "bloom" (M2) can't see a whole thought, and the same voice note could be saved twice.
- **Options**
  1. *Add three small tables* — a few rows per conversation; costs one migration and a bit of cleanup later.
  2. *Keep it in memory* — free, but lost on every request; does not work on serverless.
  3. *Wait for the conversation to finish and only use Bee's REST API* — simplest, but no live bloom, and conversations can stay "capturing" for 20+ hours.
- **What we chose and why** — Option 1 (Claude, accepted by Tarik with the plan). It is the only option that keeps live bloom possible and makes double delivery harmless.
- **What we gave up** — More schema to explain and to include in the delete-everything command. The utterance buffer briefly holds raw sentences, which the PRD otherwise avoids; it must be trimmed (M2 deletes rows older than 24 hours).
- **How we'll know if this was right** — No duplicate items after the stream and the nightly backfill both deliver the same conversation (checked in M1-T17), and live bloom works in M2.
- **What actually happened** —
