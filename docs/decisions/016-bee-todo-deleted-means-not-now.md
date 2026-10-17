# 016 — Deleting a tip's to-do in Bee sends the tip back to "new"; it never dismisses it

**Decision:** When Tarik deletes an Earmark to-do in the Bee app, Earmark treats it as him clearing the to-do and not as a verdict on the tip. The tip leaves "queued" and goes back to "new", its link to the deleted to-do is dropped, and nothing else changes. Checking a to-do off in Bee marks the tip "tried". Unchecking it puts the tip back in the queue. Editing the to-do's words in Bee changes nothing in Earmark.

**Why this came up:** FR-18 makes the Bee to-do list two-way: what Tarik does on his wrist should show up in Earmark. Checking off and unchecking have obvious meanings. Deleting doesn't. If we read a deletion wrongly, either a tip he still wants vanishes from his shelf, or the to-do he just deleted comes straight back because the tip still says "queued" and the reconciler (the job that makes Bee match Earmark, decision 014) recreates it.

**Options:**
1. **Delete means dismiss.** The tip goes to "dismissed". Cost: deleting a to-do is often just tidying the list ("not this week"). Dismissing would hide a tip he still likes, and Bee is not allowed to bring back a dismissed tip, so getting it back takes a trip to the garden.
2. **Delete means "not now": back to "new"** (chosen). Cost: the tip sits in "new" again, so if he really meant "never", he has to dismiss it once in Earmark.
3. **Ignore the deletion and keep the tip queued.** Cost: the reconciler sees a queued tip with no to-do and makes a new one, so the to-do he deleted keeps coming back.

**What we chose and why:** Option 2, ruled by the controller for M3-T8 and built by Claude. A deletion takes the tip out of the queue without destroying anything: it is still on the shelf, and he can queue it again or dismiss it from Earmark. Only the tip's live to-do counts. If he deletes a to-do that was already checked off, the tip stays "tried", because that is tidying up. Status changes from Bee go through the same guarded status change as every other surface, so Bee can never revive a tip he dismissed or composted.

Three rules keep Earmark from reacting to its own writes or overriding his:
- **Echoes are ignored.** Earmark saves what it last wrote to each to-do (its text, and whether it was done). A change from Bee that matches that saved state is Earmark's own write coming back, and nothing happens. For tips, only the done/not-done flag is compared, so a wording change on its own never triggers anything.
- **His wording is kept.** When a tip is re-queued by unchecking its to-do in Bee, Earmark links it back to that same to-do and keeps the text it had stored. The reconciler then has nothing to rewrite, so the words he typed in Bee stay as they are.
- **One writer at a time.** Inbound changes are handled under the same lock as the reconciler, so an incoming change can't land halfway through one of Earmark's own writes and undo its link.

Inbound changes update Earmark's database even when `BEE_TODO_WRITES` is off. Nothing on this path writes to Bee.

**What we gave up:** A deletion can't express "never". That still takes a dismiss in Earmark. If the lock is busy, the change is retried on the next sync instead of applied at once, so it can arrive a few minutes late. A tip that was "thanked" stays "thanked" if its to-do is unchecked in Bee.

**How we'll know if this was right:** With writes switched on, a to-do deleted in Bee never reappears, its tip shows up in "new" on the shelf, and Tarik doesn't find himself dismissing tips by hand right after deleting their to-dos. If he often does, deleting should mean dismiss.

**What actually happened:**
