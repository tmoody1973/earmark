# 024 — The taste ledger counts exactly the tips the shelf shows

> **Update (decision 025, 2026-10-16):** the shelf no longer shows unsure ("needs review") tips, so the ledger no longer counts them either; same rule, one constant (`HIDDEN_TIP_STATUSES`). A person whose only tips are unsure has no page until one is kept.

**Decision:** The People page and each person's page count a person's tips live from the tips themselves, using the same set the shelf shows: every tip that is not dismissed or composted, unconfirmed ones included. "Tried" means marked tried or thanked, or rated at all. "Loved" means rated "Loved it". Tips with no name, and tips wrongly credited to Tarik himself, are one "From someone, not sure who" count, never a person.

**Why this came up:** The ledger's summary line ("4 tips · 2 tried · loved 1") is a claim about real people. If it disagrees with the cards right below it, it reads as made up, and the page's whole promise is that every name and number is real. Three choices had to be made: which tips count, where the numbers come from, and what to do with tips that have no trustworthy name.

**Options:**
1. **Count only confirmed tips; show unconfirmed cards below.** Cost: "3 tips" above four cards. The difference is explainable, but only by reading the cards closely.
2. **Count what the shelf shows (unconfirmed included, marked on the card), computed live.** Cost: a false-positive tip that triage was unsure about inflates someone's count until Tarik dismisses it.
3. **Read the `recommenders.recs_given / recs_tried / recs_loved` counter columns.** Cost: they are written in a different place from the tips, so they can drift from the truth; nothing keeps them current today.

**What we chose and why:** Option 2 (Claude, within Tarik's ruling: real data only, first names only, owner never listed). The count equals the cards on the person's page, which the end-to-end test checks. It also matches decision 021, where unconfirmed tips stay on the shelf, marked. Thanked counts as tried because a thank-you comes after trying the thing; the card now shows "Tried" for thanked tips too, so the line and the cards agree. The owner rule reuses the existing read-time guard in `toRecCard`: a tip credited to Tarik shows no name on the shelf, so here it counts as "not sure who".

**What we gave up:** An unsure tip counts before Tarik confirms it. The ledger also loads every visible tip to count them (no SQL grouping). That is fine into the low thousands; past that, the counting moves into the query.

**How we'll know if this was right:** After a week of real use, each person's line should match their cards, and Tarik should never see a count he can't account for. If unsure tips make counts feel wrong, switch to option 1 with an explicit "1 unconfirmed" in the line.

**What actually happened:**
