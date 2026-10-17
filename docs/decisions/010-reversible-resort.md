# 010 — Re-sort the existing garden by the new thresholds, with an undo

**Decision:** Everything Earmark saved before the thresholds were tuned (decision 009) is sorted again by the new rules, once, by a script that writes down every change it makes so a single command can put it all back.

**Why this came up:** Decision 009 moved the lines Jev's confidence is judged against: above 0.9 is kept outright, 0.6 to 0.9 goes to review, below 0.6 is thrown away. (Jev is the model that reads a stretch of conversation and says how sure it is that it heard a tip or an idea.) New items follow the new lines. But the garden already held items sorted by the old, looser lines (0.85 / 0.5), and the eval showed that below 0.6 Jev was almost never right. Left alone, the garden would keep showing exactly the noise the tuning was meant to remove. Changing saved rows in production is the risky part: if the new lines are wrong, real tips disappear from Tarik's shelf.

**Options:**
1. **Leave old items as they are.** Cost: the garden mixes two sorting rules forever, and the known noise stays in it.
2. **Re-sort in place, no record.** Cost: if the thresholds turn out to be wrong, there is no way back short of restoring a database copy, which would also undo everything saved since.
3. **Re-sort with a backup of every change and an undo command** (chosen). Cost: one extra table and a little more code.

**What we chose and why:** Option 3. Tarik chose to re-sort only if it could be undone ("Yes, reversibly", 2026-10-16); Claude designed how. The rules:
- Only items that came from background listening are re-sorted. Anything Tarik asked for on purpose (a voice note, "Earmark that" in a conversation) is never touched; those are told apart by how they were captured, not by guessing.
- Only states the sorting itself set can change. A tip Tarik queued, tried, thanked or dismissed, a composted tip, and an idea mention already dismissed stay exactly as they are.
- Below 0.6 → dismissed. 0.6 to 0.9 → review. Above 0.9 → kept (a tip waiting in review moves up; one already kept stays kept). Exactly 0.9 counts as review, exactly 0.6 as review. A missing confidence changes nothing.
- An idea's mention count is its mentions that are not dismissed (review-band mentions still count, decision 004), so an idea loses a count only when one of its mentions is dismissed, and its stage follows the same stage rule as everywhere else (a drafted or used idea never moves).
- `pnpm resort` only reports what would change (ids and counts, never what was said) inside a read-only transaction. `--apply` does everything in one transaction and prints a run id. `--undo <run id>` puts back each row that still holds what the re-sort wrote; anything changed since (Tarik acting on a tip) is left alone and counted.

The read-only preview on production (2026-10-16) matches the earlier estimate: 7 tips dismissed and 2 moved to review; 17 idea mentions dismissed and 7 moved to review. The 17 dismissed mentions were each the only mention of their idea, so those 17 ideas drop to zero mentions and leave the garden view.

**What we gave up:** Some code and a table that exists for one job. The undo cannot bring back a row that has changed since; it reports it instead. An idea's "centre" (the average meaning used to match new mentions to it) is not recalculated, so a dismissed mention still shapes matching until that idea's next mention recalculates it. Also, an idea with zero mentions can still be matched by a new mention and come back as a one-mention idea; that matches decision 004's behaviour for dismissed mentions.

**How we'll know if this was right:** Over the next week, count how many of the dismissed tips and ideas Tarik goes looking for, or says he misses. Any real case means running the undo and revisiting the 0.6 line. Separately, count how many of the 9 items moved into review he keeps: if he keeps nearly all of them, the 0.9 line is too strict.

**What actually happened:**
