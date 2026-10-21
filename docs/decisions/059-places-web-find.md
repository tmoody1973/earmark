# 059 — Places OpenStreetMap doesn't know are found on the web and pinned by their street address

**Decision:** When OpenStreetMap has no entry for a place tip, Earmark searches the web for it (the same "find it on the web" step music and books already had, decision 051), reads the place's name and street address from the results, and asks OpenStreetMap to pin that address. The result is offered under "Which one?" with its map pin and web page; it is never picked automatically. Map searches also drop anything more than 150 km from where the tip was said.

**Why this came up:** On Oct 21 tip 130 (Diaspora, a Milwaukee bar) offered only places named Diaspora in Mexico and Kosovo. Two causes. OpenStreetMap has no Diaspora in Milwaukee, and Earmark's location hint only leaned the search toward Milwaukee, so the far-away matches came through. And the web search skipped places on purpose, because Google Places used to take free text; decision 058 removed Google the day before, which left places with no fallback. The demo video shows a place tip, and a bar in Kosovo is not a good look.

**Options:**
1. **Web search for places, address pinned by OpenStreetMap** (chosen). Cost: one free TinyFish search, one model call and up to 7 OpenStreetMap lookups per tip (about 8 seconds at its one-per-second limit); the web's address can be wrong, so the owner must confirm it.
2. **Only drop far-away results.** Cost: Diaspora would show nothing at all; the owner pastes a link every time a small business is missing.
3. **Write the missing place into OpenStreetMap automatically.** Cost: OpenStreetMap's rules for automated edits require a separate bot account and community sign-off, and data copied from websites or AI reading is not acceptable there. Unverified edits would also degrade a map other people rely on. Not pursued; a hand edit by Tarik, under his own account, is fine and is the way a missing place gets fixed for everyone.

**What we chose and why:** Option 1, plus the 150 km cut. Tarik chose "do 2" (this option) on Oct 21. Claude built it. The search adds the city around the location hint ("Milwaukee, Wisconsin", from one OpenStreetMap reverse lookup of the already-rounded hint) so a common name finds the local place. If OpenStreetMap has an entry with the web's exact name, that entry is the option (it carries hours and details, decision 058). Otherwise OpenStreetMap geocodes the street address, which it can do for nearly any building even when it doesn't know the business. A dry run on tip 130 found "Diaspora MKE Sports Bar & Lounge" at 735 E. Center St. and pinned it in Riverwest.

**What we gave up:** A place pinned this way has no "The place" details (hours, phone), because OpenStreetMap has no entry for the business itself. The 150 km cut also drops a far-away place heard about at home (a trip tip); the owner pastes its link instead. The city name is sent to the web search along with the place's name and the why note (never the excerpt or anyone's name).

**How we'll know if this was right:** Over the next two weeks, count place tips that ended with no options at all, and web-pinned options the owner picked versus turned down. If the owner turns down more than half, the address reading needs work.

**What actually happened:**
