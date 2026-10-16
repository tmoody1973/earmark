# 008 — The one-page draft is written right after a bloom, with a 10-minute safety net

**Decision:** When an idea blooms (its third separate mention), Earmark writes its one-page draft straight after the save that caused the bloom has finished, in the same background work that handled the incoming Bee event. Every 10 minutes the existing Bee catch-up job also drafts any bloomed idea that still has no draft. Whichever gets there first "claims" the idea (marks it as being worked on), so it is never drafted twice. Saving the draft and moving the idea from "bloomed" to "drafted" happen in one database statement.

**Why this came up:** The milestone's promise is that while Tarik is still talking, the garden shows the bloom and the idea already holds a draft. Writing a draft takes 10–30 seconds (a Bee search for related conversations, a Jev call to pick the format, then Claude writing about 500 words). If that work sat inside the save itself, one slow or failed model call could undo the bloom or hold up everything else from that conversation. If it only ran on a timer, the draft could arrive up to 10 minutes late, after the demo moment has passed.

**Options:**
1. **Draft inside the save.** Simplest to reason about, but a model outage would block or roll back the bloom, and a database transaction would stay open for half a minute. Ruled out by the M2-T7 ruling.
2. **Draft only on the 10-minute timer.** One trigger, nothing new in the request path, automatic retries. Cost: up to 10 minutes before the draft appears, so the live demo shows a bloom with an empty draft.
3. **Draft right after the bloom, plus the 10-minute timer as a safety net.** The draft usually appears within about 15 seconds of the bloom; the timer picks up anything the first try missed (a failed model call, a crashed function, blooms that came from the nightly backfill). Cost: a second trigger to keep correct, made safe by the claim.

**What we chose and why:** Option 3 (Claude, within the M2-T7 ruling that the draft runs after the save commits, asynchronously and exactly once). It is the smallest design that meets both the "while he is still talking" promise and the "a failed draft is retried later" rule. The claim uses the same pattern as conversation processing: a claim older than 15 minutes is assumed abandoned and can be re-taken. A failed draft gives its claim back at once so the next timer run retries it; after 3 failed attempts the idea is left bloomed without a draft and the failure stays in the logs.

**What we gave up:**
- **The live request does more work.** The draft runs inside the same background window as the Bee event (60-second limit on the ingress route). A slow draft that hits the limit is cut off; its claim then waits out the 15-minute lease before the timer retries, so that draft can arrive about 15–25 minutes late.
- **"Bloomed with a draft" and "drafted" are now the same state.** The idea page brief lists them separately; with this ruling, an idea with a draft is always "drafted", and "used" is still Tarik's call.
- **After 3 failures nothing retries automatically.** Someone has to reset `draft_attempts` on that idea.
- **A draft for an unconfirmed idea** (every mention still awaiting review, decision 004) is written anyway, so a false bloom costs one draft's worth of model spend.

**How we'll know if this was right:** On the live demo, the idea's draft is present when the garden is opened right after the bloom (within a minute). And across a week, no idea sits at "bloomed" without a draft for more than 20 minutes unless the logs show three `[draft] ... failed` lines for it.

**What actually happened:**
