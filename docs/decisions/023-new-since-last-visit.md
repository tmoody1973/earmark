# 023 — "New since last time" remembers visits, not page loads, in the existing key-value table

**Decision:** The garden keeps one small record of Tarik's visits: when the visit before this one started, and when the garden last loaded. Loads less than 30 minutes apart count as one visit. The "New since last time" row shows tips Earmark caught and ideas that bloomed after the previous visit. The record lives as one row in `sync_cursors`, the key-value table the Bee sync already uses. No new table or migration.

**Why this came up:** The approved garden brief opens with one question: "What did Earmark catch since I last looked?" To answer it, the server has to remember when he last looked. The obvious version is "update the timestamp on every page load". That breaks in practice. The live bloom re-renders the page every time a mention arrives. Opening an idea and pressing Back reloads the garden too. Each of those would count as a new look and empty the row while he is still reading it.

**Options:**
1. **A timestamp updated on every load.** Cost: the row empties on every live refresh or Back. During the demo, the bloom chip would vanish seconds after it arrived.
2. **Visits, not loads: a 30-minute gap starts a new visit; stored as one JSON row in `sync_cursors`.** Cost: if he looks twice within 30 minutes, the second look still shows the first look's items. The table's name (`sync_cursors`) doesn't describe this row.
3. **The same visit logic in a new `garden_visits` table (migration 021).** Cost: a migration on production and the test branch, for a single row with no queries beyond read-one and write-one.

**What we chose and why:** Option 2 (Claude, within Tarik's ruling to use a migration *or* an existing table, with the reason written down). `sync_cursors` is already a name → text store. The Bee sync keeps a JSON "pending" list in it the same way. Reusing it ships with zero schema change. The visit rule is a pure function (`nextVisit` in `agent/lib/garden/visit.ts`) with unit tests. The record is written only after the page has rendered (Next's `after()`), so a slow write never delays the page.

**Refined in review (fix round 1):** the page only *reads* the record. A look is *written* by the open page itself, when it first appears and whenever Tarik comes back to the tab, through a small owner-only server action (`recordGardenVisit`). The live refresh re-renders on the server, so writing on every render would have counted each refresh as a look. Coming back after the 30-minute gap reloads the page: a new visit gets a new baseline and a fresh order.

**What we gave up:** The table name no longer matches everything in it. Someone reading `sync_cursors` will find a `garden_visit` row that is not a sync cursor. "Last time" also belongs to Tarik, not to each device: looking on his phone counts as having looked on his desktop. With a single owner, that is what we want.

**How we'll know if this was right:** After a day of real use, the row should hold what arrived while he was away, and only that. Nothing he already saw that morning should reappear unless 30 minutes passed with the garden closed. If he says "I already saw these" or "where did that go?", tune `VISIT_GAP_MS`, or move to option 3 if the record needs more fields.

**What actually happened:**
