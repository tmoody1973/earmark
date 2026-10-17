# 028 — Smart Spaces: every item judged once per change, on a fixed hourly budget

**Decision:** A Space is one sentence ("Books to give my dad"). Earmark asks Jev one literal yes/no question per item and Space: "does this item belong in the collection described as: '…'?". One call asks about one item against up to **8 Spaces** at once. Every answer is stored in `space_items` (the "no"s too) and is asked again only when the item changes. A run makes at most **40 calls**, and any one Space takes part in at most **30** of them. An item shows in a Space when Jev is at least 0.7 sure (`SPACE_MIN`), or when Tarik kept it. Tarik can keep or remove each item, rename a Space, and delete it (the page asks first).

**Why this came up:** FR-32 asks for collections that fill themselves. Spaces multiply: every Space has to be checked against every idea and tip, so 5 Spaces and 120 items is 600 questions. Ask them all at once and a new Space spends minutes and money in one go; ask them on every run and the bill repeats for answers that cannot have changed.

**Options:**
1. **Embeddings only** (a way to find items that *mean* something similar to the sentence, not just share words). Cheap and instant. Cost: a sentence like "things to try this winter" has no meaning-neighbours that line up with "belongs"; it would fill with near-misses.
2. **Ask Jev about every pair, every run.** Always fresh. Cost: the same answers, paid for hourly.
3. **Ask once per change, batched by item, under a fixed budget** (chosen). Cost: two new columns, and a big new Space fills over a couple of hours instead of at once.

**What we chose and why:** Option 3, Claude's call within Tarik's ruling ("bounded; skip pairs already judged unless one side changed"). Batching by item means one call per item no matter how many Spaces are waiting (up to 8), so adding a Space adds questions, not calls. A new Space starts filling right after it is created, bounded to one Space's share (30 calls); the hourly run at :37 picks up the rest. The per-Space share stops one new Space from starving the others. Like the backlinks (decision 026): each call gives up after 20 seconds, three failures in a row stop the run, and a lock (a claimed row that frees itself after 15 minutes) stops the hourly run and a new Space's fill from overlapping. Maybes, dismissed and composted tips, and dismissed ideas are never judged or shown.

**Renaming changes the name only.** What fills a Space stays the sentence it was created with, shown under the name ("Fills from '…'"). Re-describing a Space would mean re-asking every item; for now, delete it and describe a new one.

**Tarik's keep and remove always stand.** A kept item is never re-judged, even if it changes; a removed item never comes back. Deleting a Space deletes Jev's answers for it; the ideas and tips themselves stay. Forget (decision 011) already deletes an item's `space_items` rows, and nothing new holds item text, so forget needed no change.

**Cost:** one real call on the test branch, 3 Spaces in one question set, read 788 input tokens (about 250 per Space plus the item). Jev costs $0.042 per million input tokens: that call cost about $0.00003. A full run at the worst case (40 calls × 8 Spaces ≈ 2,000 tokens each) is about 80,000 tokens, about **$0.0034**; hourly, at most about **$0.08 a day**. With two or three Spaces a full run is about $0.0013, and most hours judge only the few items that changed.

**What we gave up:** A Space with a big backlog fills over a few hourly runs (30 items per Space per run). "Still sorting N items" on the page says so honestly. The 0.7 floor is a guess until Tarik looks at real Spaces (M4-T11). A tip whose context summary changes is re-asked, which spends calls on wording changes that rarely matter. The Spaces tab is a fifth tab on a shell Tarik approved with four.

**How we'll know if this was right:** The run logs one line per hour (`[spaces] run calls=… pairs=… skipped=…`). If `skipped` stays above zero for a day, the per-Space share is too small. In M4-T11, create "This Bites episode ideas" and two other Spaces: if Tarik removes more than a third of what lands, raise `SPACE_MIN`; if he finds obvious misses, lower it or sharpen the question's examples.

**What actually happened:**
