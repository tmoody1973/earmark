# 006 — A live mention and the later full pass of the same conversation count once

**Decision:** While Tarik is still talking, Earmark checks his words in small groups of four utterances and can add an idea mention right away. When the conversation finishes and is processed in full, that same conversation never adds a second mention. Bee names a live conversation by a long random code (a uuid) and a finished one by a number, so Earmark stores both on each mention, links them when it can, and otherwise recognises the conversation by when it happened.

**Why this came up:** The demo's opening moment is an idea blooming on its third mention while Tarik speaks. Each idea's count must mean "said on N separate occasions". The live stream and the finished-conversation pass see the same words twice. If they were counted separately, one conversation could add two mentions and fake a bloom, which is exactly the thing the demo claims not to do. Bee's docs gave no way to connect the live code to the number except one start-of-conversation event, which is lost whenever the relay on Tarik's Mac was off at that moment.

**Options:**
1. **Only count ideas after the conversation finishes.** Safe and simple, but no live bloom: the moment the demo is built around disappears.
2. **Count live, keyed on the live code only.** Fast, but the finished pass (keyed on the number) would count the same conversation again whenever the start-of-conversation event was missed.
3. **Count live, store both forms, look the number up when it is missing, and fall back to time.** A 25-second look at the real stream showed each live utterance carries an id that also appears in the conversation Bee is currently recording, so Earmark can ask Bee which recording holds it and remember the pair. If that still fails, the finished pass treats a live mention with only the code as its own when it was spoken between the conversation's start and end (plus a minute either side).

**What we chose and why:** Option 3. Claude designed it under the M2-T6 ruling (a live mention and the completed pass must count as one occasion); the reviewer added the time-span fallback and Tarik's cost ruling set the window size. The save fills in whichever form is missing from the remembered pairs, and the database refuses a second mention of one conversation on one idea in either form. A "triage call" (one request to the Jev model asking whether a short stretch of speech holds an idea, a recommendation or neither) runs only once four new utterances are waiting, never per utterance, and the four are claimed so two deliveries never check the same words twice.

**What we gave up:**
- **Cost.** Live checking adds about 50% to triage spend on ambient conversations: the full pass makes one triage call per 2 utterances (overlapping windows of 4), live adds one per 4 (non-overlapping). An idea that straddles two live windows may be missed live; the full pass still finds it.
- **Lookup calls.** While a conversation's code is unmapped, every claim makes 1 list plus up to 5 gets to Bee (read-only) until it is mapped.
- **When the code stays unmapped:** the relay was off when the conversation started (missed start event) AND either the stream sent no utterance id, Bee's API errored, the utterance was not yet visible in Bee's API, or the recording was not among the 5 newest conversations. Those mentions are then matched only by time.
- **The time fallback assumes one conversation at a time.** Bee is one wearable and records one conversation at a time, so two conversations never overlap; if that ever changed, an unmapped live mention could be wrongly matched to a neighbouring conversation (an under-count, not a fake bloom).
- Recommendations are still only taken from finished conversations; a found idea holds the relay about 5 seconds while it is saved.

**How we'll know if this was right:**
- After a week of live use, no idea has two mentions from the same conversation: `select cluster_id, bee_conversation_id, count(*) from idea_mentions where bee_conversation_id is not null group by 1, 2 having count(*) > 1` returns nothing.
- Exposure to the time fallback: `select count(*) from idea_mentions m where bee_conversation_id is null and bee_conversation_uuid is not null and not exists (select 1 from bee_conversation_map b where b.conversation_uuid = m.bee_conversation_uuid)` stays near 0. Those rows are the ones only the span check protects.
- The first live bloom Tarik triggers on purpose shows up in the garden within about 15 seconds.

**What actually happened:**
