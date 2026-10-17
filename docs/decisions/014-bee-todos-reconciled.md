# 014 — Bee to-dos are brought in line with Earmark on a timer, not pushed at the moment a tip changes

**Decision:** When Tarik queues a tip ("I want to try this"), Earmark does not write the Bee to-do in the same moment. A reconciler (a job that compares what Bee has with what Earmark says should be there, and fixes only the differences) runs with the Bee catch-up schedule and again right after any tip enters or leaves "queued". It makes the missing to-dos, completes the ones for tips he tried, deletes the ones for tips he dropped, and never lets more than 10 open Earmark to-dos sit in Bee. It writes nothing unless `BEE_TODO_WRITES=on`.

**Why this came up:** FR-17 puts queued tips on Bee's to-do list and FR-20 caps that list at 10 so it stays useful. The plan's first draft wrote to Bee straight from the status change and saved the Bee id only sometimes before, sometimes after Bee answered. On a bad day (Bee slow, a crash halfway) that either duplicates a to-do on Tarik's wrist or loses track of one, and Earmark's own count of open to-dos drifts from what Bee really shows.

**Options:**
1. **Write to Bee inside the status change.** Cost: a crash between Bee's answer and the database save leaves a to-do Earmark doesn't know about; a retry makes a second one. The garden tap also waits on Bee.
2. **A reconciler that compares and repairs** (chosen). Cost: a to-do can appear up to one schedule tick late if the immediate nudge fails, and every run reads Bee's whole to-do list (8 to-dos today, one request).
3. **A queue table of pending Bee writes.** Cost: a new table and a retry job for the same guarantees option 2 gets from data Earmark already has.

**What we chose and why:** Option 2, set by the controller (binding note for M3-T7) and built by Claude. Each run reads Bee's real list, so the cap counts what Tarik actually sees (his own to-dos don't count, only ones starting "Earmark · "). Bee is written first and Earmark saves the id only after Bee said yes; if the run dies in between, the next run finds a to-do with exactly the text it was about to write and adopts it instead of making a twin. A to-do already gone from Bee (404) counts as done. Writes per run are capped at 10, and the first real Bee error stops the run. The to-do text is the title, creator, who and when, and a link to the tip's card on the Shelf; never anything Tarik's friend actually said.

**What we gave up:** Up to one tick of delay when the nudge is skipped (another run holds the lock). If a run crashes after creating a to-do and the tip's text changes before the next run, that to-do is not adopted and holds one of the 10 slots until Tarik clears it in Bee; Earmark never deletes Bee to-dos it has no record of. Re-queueing a tried tip reopens its old to-do, so its history in Bee is reused rather than kept separate.

**How we'll know if this was right:** After `BEE_TODO_WRITES=on` in production, the Bee app never shows two identical "Earmark · " to-dos and never more than 10 open ones, and `[bee-todos] ... failed` log lines are followed by a clean run on the next tick.

**What actually happened:**
