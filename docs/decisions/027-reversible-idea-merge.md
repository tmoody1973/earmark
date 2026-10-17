# 027 — Merging two ideas asks first and can be undone

**Decision:** When Jev thinks two ideas are the same idea, the idea page offers "Same idea?" with **Merge here** and **Not the same**. Merge asks once, inline ("Move its 2 mentions here? You can undo it."), then moves the other idea's mentions into this one. Every merge is recorded, and **Undo merge** puts both ideas back exactly as they were. Nothing is deleted.

**Why this came up:** A merge rewrites two ideas at once: their mention counts, their stage (a merge can make an idea bloom), their timelines, their pins. Tarik's ruling: merging is destructive-ish, so it must be reversible, or at least confirm first and keep the merged idea's mentions. Getting this wrong means a mis-tap silently loses the history of an idea, which is the one thing Earmark exists to keep.

**Options:**
1. **Merge without a record; confirm only.** Simplest. Cost: a wrong merge can only be fixed by hand in the database.
2. **Never move anything; just link the two ideas as "same".** Safe. Cost: the idea never gets its combined count, so it never blooms from the merge, which is the point of merging.
3. **Confirm, merge, and record enough to undo** (chosen). Cost: a new table (`idea_merges`) and a more careful set of database statements.

**What we chose and why:** Option 3, Claude's call within Tarik's ruling. The merge is one database transaction (all of it happens or none of it does). It first writes a record of which mentions move and what both ideas looked like (stage, count, pin, timeline), and only then moves anything; if either idea was already dismissed or merged, the record is not written and nothing changes, so a double tap is harmless. The merged idea is kept, greyed, and its page says "Merged into …" with an Undo button; the kept idea lists it under "Merged in", also with Undo. A mention from the same conversation as one the kept idea already has stays with the merged idea, because Earmark counts at most one mention per conversation per idea. A merge that brings an idea to its third mention blooms it, exactly as a third mention would, and the one-pager is drafted. Undo also marks the "same idea?" suggestion removed, so it is not offered again.

**What we gave up:** Undo restores the kept idea's stage from the counts, but a stage the idea reached on its own stays: if the one-pager was drafted between the merge and the undo, the idea stays drafted. If the kept idea was itself merged into a third idea afterwards, that later merge has to be undone first (Undo refuses until then). The Notion copy of the merged idea follows on the next sync, not instantly.

**How we'll know if this was right:** Count merges and undos in `idea_merges` over the first two weeks. Undos above about one in five mean the "same idea" question (or `MERGE_MIN`, 0.8) is too loose. No merges at all while Tarik keeps seeing duplicate ideas in the garden means it is too strict, or the offer is too easy to miss on the page.

**What actually happened:**
