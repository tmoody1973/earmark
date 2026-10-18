# 046 — Place lookups lean toward where the tip was heard, or Milwaukee if Bee doesn't know

**Decision:** When Earmark looks up a place tip ("Kawa Ramen", "Diaspora"), it tells the map service roughly where to look: the area where the conversation happened (taken from Bee's location for that conversation), or, if Bee had none, a home default of Milwaukee. The location is blurred to about 11 km before it leaves Earmark.

**Why this came up:** Place tips never matched. The lookup was already built to lean toward a location, but for a tip heard in conversation there was no location to lean toward: Earmark never saved where the conversation happened, even though Bee reports it. So the search ran across the whole country. For names like "Diaspora" or "Kawa Ramen" that returns many unrelated businesses, and Jev (the AI that checks whether a search result really is the thing mentioned) correctly refused to pick any of them: it looked at 5 tips, took a second look at 5, and matched 0. What was at stake: the place tips stay map-less, and the walk-past nudge (which needs to know where a place is) never fires.

**Options:**
1. **Milwaukee default only.** Simple, no new data stored. Cost: wrong whenever a tip was heard elsewhere (a trip, a conference), and it can quietly push the search toward a wrong Milwaukee namesake.
2. **Bee's conversation location only.** Accurate when it exists. Cost: Bee does not always have a location, and then we are back to searching the whole country.
3. **Both: Bee's location when known, else Milwaukee** (chosen). Cost: one more column to store (and keep private), and a second rule to explain.

**What we chose and why:** Option 3. Tarik chose "Both." The order is: where the conversation happened, then the tip's own location if it somehow has one, then the home default (set with `EARMARK_HOME_LAT` / `EARMARK_HOME_LNG`; if unset, no lean at all, as before). Claude built it. The conversation's location is saved on the tip in two new columns (`said_lat`, `said_lng`: "where it was said"), kept separate from `lat`/`lng` ("where the place is"), because the walk-past nudge depends on the second meaning. Both map services only ever receive a rounded location (one decimal place, about 11 km). The search area is about 20 km wide, so more precision would not help the search; it would only tell a third party where Tarik was.

**What we gave up:** The rounded location is less precise than Bee's real one, so in a dense area a very local name can still be ambiguous. Travel tips with no Bee location lean toward Milwaukee, which can mislead the search toward a Milwaukee business with a similar name. Google (if its key is ever set) and OpenStreetMap still see an area about 11 km across for each place lookup. And the location of each conversation is now stored in our database, which is more personal data to guard (forgetting a tip deletes it with the tip).

**How we'll know if this was right:** After the one-time backfill and re-queue, the 5 real place tips that matched nothing now match (count place tips with `lat` set before and after). New place tips heard in conversation match without help. If a tip matches the wrong business, look at whether it had a Bee location or fell back to Milwaukee.

**What actually happened:**
