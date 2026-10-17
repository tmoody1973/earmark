# 025 — Tips Earmark wasn't sure about wait in a "Maybe?" pile, off the shelf

**Decision:** The shelf shows only tips Earmark is sure of, plus the ones Tarik has confirmed. Tips in the review band (the sorter was 60–90% sure; status "needs review") go to a small "Maybe?" row below the shelf, where Tarik taps **Keep** (the tip joins the shelf) or **Not a tip** (it is cleared). This supersedes decision 021.

**Why this came up:** Decision 021 put unsure tips on the shelf, marked "Unconfirmed", so nothing Earmark heard would be invisible. Then the triage eval (decision 009) measured how often those unsure tips are real: about 1 in 5. So with 021 in place, most unconfirmed cards on the shelf were not tips at all, mostly work talk, and they also counted toward people's numbers on the People page (decision 024). A shelf that is four-fifths noise in its unsure part stops being trustworthy, and the People page's "every number is real" promise breaks with it.

**Options:**
1. **Keep decision 021: unsure tips on the shelf, marked.** Cost: the shelf and the People counts carry tips that are mostly wrong.
2. **Hide unsure tips entirely; review only in Slack.** Cost: real tips (the 1 in 5) can sit unseen, and there is no way to say "yes, that one" from the garden.
3. **A separate "Maybe?" row with Keep and Not a tip** (chosen). Cost: one more small zone on the page, and a pile Tarik has to tend.

**What we chose and why:** Option 3, Tarik's call (2026-10-16). The shelf and the People page now share one visibility rule in code (`HIDDEN_TIP_STATUSES` in `agent/lib/garden/queries.ts`): dismissed, composted and needs-review tips are hidden. The Maybe? row shows the 12 newest unsure tips (Home shows 4 and links to the rest), says "and N more" when there are more, and disappears when the pile is empty. Every tap is saved twice: as the tip's new status, and as Tarik's verdict in a new `user_verdict` column (with the time), so the taps become labels, meaning examples with a known right answer, that can later be used to measure and improve the sorter. A tap only changes a tip that is still unsure, so a tip already handled elsewhere (for example in Slack) is never overwritten.

**What we gave up:** A real tip in the review band stays off the shelf, and out of its giver's count on the People page, until Tarik keeps it. A person whose only tips are maybes has no page yet (it returns "not found"). The unsure tips no longer appear in "New since last time" either. And the pile can grow if he never tends it; past 12 he sees only the newest.

**How we'll know if this was right:** Over the first two weeks, count the verdicts: if roughly 4 in 5 taps are "Not a tip", the row is doing its job of keeping noise off the shelf. If the pile keeps growing (more than about 20 waiting for a week), the row is being ignored and the review band is too wide. If Tarik keeps nearly everything, the sorter is better than the eval said and the auto-accept line (0.9) can come down.

**What actually happened:**
