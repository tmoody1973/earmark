# 029 — A tip's actions live behind one quiet "…" on its card, and only move forward

**Decision:** Each tip card on the Shelf, Home and a person's page has one small "…" button. It opens a short list of what makes sense next for that tip: **Try this** (puts it on the try list, status "queued"), **Tried it**, and **Dismiss** while it is untried; once tried, only **Loved it / It was fine / Not for me**. A tip only moves forward: a tried tip never goes back on the try list and can't be dismissed from a card (that would silently take it out of its giver's tried and loved counts, decision 024), and a maybe or a cleared tip can't be changed or rated from anywhere.

**Why this came up:** FR-22 asks for marking tips tried and rating them from the garden. The original plan drew a row of visible buttons under every tip. The as-built shelf is an artwork-led grid of quiet cards (docs/design/shape-rec-cards.md); four or five buttons on every card would turn it into a control panel, and on a phone each card is only about 170 px wide. What was at stake: a busy shelf that stops feeling calm, or actions so hidden nobody uses them.

**Options:**
1. **Visible buttons on every card** (the original plan). Cost: the shelf becomes a wall of buttons; cards grow taller; it reads as a to-do app, not a garden.
2. **Actions only on a tip's own detail page.** Cost: two extra taps for the most common thing (I tried it, I loved it), and no detail page exists yet.
3. **One "…" per card that opens a short list over the card** (chosen). Cost: the actions are one tap away instead of zero, and the list covers the card while it is open.

**What we chose and why:** Option 3, Claude's call within Tarik's direction that cards stay quiet. The list opens over the card instead of pushing it taller, so the masonry columns don't reshuffle under his thumb. Every tap shows at once and is put back, with a spoken message (a screen-reader announcement), if saving fails. Each choice goes through the one status core with a guard on where it may start from (a "from-guard": the move only happens if the tip is still in a status the shelf shows), so a tap on a card that went stale in another tab cannot undo something done elsewhere (Slack, Bee, Notion). The menu is off by default on the card component and switched on only on Tarik's own pages, so a page someone else reads (a Space) never offers it. "Try this" only marks the tip queued; the Bee to-do follows from the reconciler only when Bee writes are switched on.

**What we gave up:** There is no undo for Dismiss; a dismissed tip comes back only through Notion or the database. A tip he tried and regrets keeping can only be rated "Not for me", not cleared, from the garden. Ratings can't be cleared from the card, only changed. A tried tip can't be put back on the try list from the garden. And the action is one tap less discoverable than a visible button.

**How we'll know if this was right:** In the first two weeks of use, count tried and rated tips coming from origin "garden" versus Bee and Notion. If the garden gives fewer than a third of all tried/rated changes, the "…" is too hidden and visible buttons (at least for "Tried it") should come back. If Tarik asks to un-dismiss something even once, add an Undo to the announcement.

**What actually happened:**
