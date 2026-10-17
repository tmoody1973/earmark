# 021 — The shelf shows unconfirmed tips, marked, instead of hiding them

> **Superseded by [025](025-maybe-pile.md) (2026-10-16):** unsure tips now wait in a "Maybe?" row with Keep / Not a tip, off the shelf.

**Decision:** Tips waiting for review ("needs review") appear on the shelf as quieter outline cards labelled "Unconfirmed", with Keep and Dismiss buttons. Only dismissed and composted tips are hidden.

**Why this came up:** The build plan, written before the design was chosen, hid unreviewed tips from the shelf entirely. The approved designs (Tarik, 2026-10-16) say the opposite: "unsure items are visibly unconfirmed" and "needs-review tips marked like unconfirmed ideas". On 2026-10-16, 22 of the garden's 37 tips were waiting for review. Hiding them would leave most of what Earmark heard invisible, with no way to say "yes, keep that" from the garden.

**Options:**
1. **Hide unreviewed tips until approved elsewhere** (the plan). Cost: most real tips disappear; review happens only in Slack.
2. **Show them, marked and quieter, with keep / dismiss on the card** (chosen). Cost: the shelf is busier while the review pile is large.
3. **A separate "to review" row above the shelf.** Cost: a new zone the approved layout does not have.

**What we chose and why:** Option 2 — follows the approved design (Tarik's call); Claude applied it to the shelf query. The Keep and Dismiss buttons are drawn but switched off until the tip actions arrive in task M3-T10 (`app/actions/recs.ts`); nothing pretends to work before then. Related call made at the same time: artist cards never show a photo, even when enrichment finds one, because the product rule is no photos of people; the artist's name, set large, is the artwork.

**What we gave up:** Until M3-T10 lands, the buttons are visible but inert, which can read as broken. While the review pile is large, unconfirmed cards crowd out confirmed ones on the home page's first six.

**How we'll know if this was right:** After M3-T10 wires the buttons, the review pile shrinks from the garden itself (not only from Slack), and Tarik does not ask to hide unconfirmed tips. If they crowd the home page, sort confirmed tips first there and keep unconfirmed ones on the Shelf tab.

**What actually happened:**
