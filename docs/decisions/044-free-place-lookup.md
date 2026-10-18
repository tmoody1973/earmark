# 044 — Place tips get their map location from OpenStreetMap, no key needed; Google wins if a key is ever added

**Decision:** When a tip is a place, Earmark looks it up on OpenStreetMap's free search service (Nominatim, a public "type a name, get a map point" lookup) by default. If a Google Places key is ever set, Google is used instead, automatically. Either way, the result's coordinates are saved on the tip once and never asked for again.

**Why this came up:** None of the 5 place tips saved so far had coordinates. The only place lookup we had was Google Places, which needs a paid-account key that was never set, so place tips were skipped entirely: no map picture on the card (decision 020) and, more importantly, step 6 of the plan, the "you are walking past a place you were told about" nudge, could never fire, because a nudge needs to know where the place is. Every other tip type already had a free fallback (MusicBrainz, Open Library, iTunes, Wikipedia, YouTube); places were the one gap. What was at stake: a headline feature (the walk-past nudge) that silently never works.

**Options:**
1. **OpenStreetMap Nominatim only (free).** Cost: coverage of small or brand-new businesses is patchier than Google's; the service has a strict policy (identify ourselves, at most 1 request per second, save results) that it can change; no key means no support if it breaks.
2. **Google Places only (needs a key).** Cost: a Google Cloud account with billing, a key to guard and restrict, and a per-request price after the free allowance, for a few lookups a day. Better data for small businesses.
3. **Both: Nominatim by default, Google when its key is present** (chosen). Cost: two code paths to keep working, and the same place could get slightly different coordinates depending on which one was active when it was looked up.

**What we chose and why:** Option 3. Tarik chose "Both." It unblocks places today at no cost and no account, and keeps the better source one environment variable away if the free one proves too thin. Claude built it. We follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): every request names Earmark in a User-Agent header (and may carry an optional contact email), requests are spaced at least 1.1 seconds apart, and only the place name plus its address or area goes in the query, never the conversation excerpt or a person's name. Results are saved on the tip once (coordinates, address, an OpenStreetMap link), so a matched place is never looked up again; the policy asks for exactly this.

**What we gave up:** Nominatim finds fewer small, new or oddly named businesses than Google, so some place tips will come back "no match" and have no map. The policy can change or tighten at any time, and a free public service has no promise of uptime. The 1-request-per-second limit is enforced per running server instance, not across the whole app (fine for a few lookups a day, since only one sweep runs at a time; if that ever grows, the fix is to store the last-call time in the database). The card must keep showing "© OpenStreetMap contributors" wherever map data is shown (it already does on the map tile).

**How we'll know if this was right:** The 5 existing place tips, and every new one, end up with coordinates and a map tile on their card (count place tips with lat/lng set versus total). And a real walk-past nudge fires for a saved place. If more than about a third of place tips come back with no match after two weeks, add the Google key.

**What actually happened:**
