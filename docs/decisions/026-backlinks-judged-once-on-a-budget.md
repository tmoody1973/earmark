# 026 — Backlinks are judged once per change, on a fixed hourly budget

**Decision:** An hourly job finds candidate connections with embeddings (a way to find notes that *mean* something similar, not just share words), then asks Jev one literal yes/no question per connection: "are these two ideas related?", "are they the same idea?", "could this tip be material for this idea?". Every answer is stored, the "no"s too, and a connection is asked again only when one side changed since (for example, an idea got a new mention). Each run makes at most **40 model calls**, and asks about any one idea or tip at most **5 times**.

**Why this came up:** FR-38 asks for automatic backlinks. Done naively, every new mention would re-ask about every pair of ideas, and the number of pairs grows with the square of the garden: 31 visible ideas is already 465 pairs. A model bill that grows like that, on a schedule nobody watches, is the kind of cost that surprises you. The other risk is the opposite one: judge once and never again, and an idea that grows into something related to another one is never connected.

**Options:**
1. **Judge every nearby pair on every run.** Always fresh. Cost: calls grow with the square of the garden and repeat answers that cannot have changed.
2. **Judge each pair once, forever** (the original brief). Cheapest. Cost: an old "no" stands even after an idea grows.
3. **Judge once per change, under a fixed budget** (chosen). Cost: a new column (`links.judged_at`), and a backlog drains over a few hours instead of at once.

**What we chose and why:** Option 3, Claude's call within Tarik's ruling ("bounded; skip items already judged unless they changed"). Each idea or tip only meets its 5 nearest neighbours, and only within a distance floor (0.55 between ideas, 0.7 from a tip to an idea; starting knobs in `agent/lib/links/criteria.ts`). Pairs Tarik has accepted or removed are never asked again, changed or not, so his decision always stands. At least 15 of the 40 calls are kept for tips, so a busy week of ideas cannot starve them. Each call gives up after 20 seconds, three failures in a row stop the run (the gateway is down; do not walk the whole list), and a lock (a claimed row that frees itself after 15 minutes) stops two hourly runs from overlapping.

**One recipe for a tip's text (ruling, 2026-10-16):** what a tip's embedding is made from, and what Jev reads about it, is one function with one owner: `recEmbedText` in `agent/lib/recs/embed-text.ts` (type, name, creator and the context summary; never the excerpt or raw text). The refresh uses it to fill missing embeddings; lane A's M3-T5 adopts it as the save-time recipe and clears a tip's embedding when its name or context summary changes, so the refresh re-embeds it and the changed tip is judged again. New tips get their embeddings at the end of a run, as one call, and are judged the next hour. Maybes, dismissed and composted tips (the shelf's hidden statuses) are never embedded, judged or shown. The page shows a related idea or a tip at Jev's 0.7 or above, a "same idea?" offer at 0.8 or above.

**Cost:** one real call on the test branch read 657 input tokens; Jev costs $0.042 per million input tokens. A full run of 40 calls is about 26,000 tokens, about **$0.0011**; hourly, at most about **$0.03 a day**. Most runs find nothing new and cost nothing.

**What we gave up:** After a big change (a backfill, or the first run in production) the links fill in over several hours, not in one go. The distance floors are guesses until real links are reviewed (M4-T11): too tight and real connections are never asked about; too loose and the budget goes to obvious "no"s. A tip whose context summary changes is re-judged, which spends calls on wording changes that rarely matter.

**How we'll know if this was right:** The run logs one line per hour (`[links] run calls=… ideaPairs=… recPairs=… skipped=…`). If `calls` sits at 40 for more than a day, the budget is too small for the garden or the floors are too loose. In M4-T11, look at the suggestions on ten real ideas: if Tarik removes more than half, raise `LINK_MIN`; if he finds obvious connections that never appeared, loosen the distance floors.

**What actually happened:**
