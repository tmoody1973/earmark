# 045 — Each tip gets its own page, and its "extras" are fetched once and stored, never on page load

**Decision:** Tapping a tip card on Tarik's own pages opens a new owner-only page, /tips/<id>, with the big artwork, what was said and by whom, its links, its Spaces and ideas, and a few "extras" (a 30-second song preview, a podcast's latest three episodes, a playable video, a book's description, a longer Wikipedia passage). The extras are looked up once by the background enrichment sweep (the "rec lane", which already fills in cover art and the one-line Wikipedia note) and saved on the tip. Opening the page never contacts a third-party service.

**Why this came up:** A card was all a tip had: tapping its title went straight out to Apple Music or Open Library. There was nowhere to see the excerpt, which Spaces and ideas it belongs to, or to sample it before deciding to try it. What was at stake: privacy (every page view telling Apple, YouTube or a podcast host what Tarik is looking at) and speed (a page that waits on four outside services).

**Options:**
1. **Fetch extras live when the page opens.** Cost: every view leaks to third parties, the page is as slow as the slowest service, and rate limits (iTunes allows about 20 calls a minute) become a page-load failure.
2. **Fetch once in the existing sweep and store on the tip** (chosen). Cost: a new column and migration; extras arrive minutes after a tip is matched, not instantly; a preview link that Apple later changes goes stale.
3. **No extras, just the detail page.** Cost: the page has little that the card doesn't, and no way to sample a song or episode without leaving.

**What we chose and why:** Option 2, Tarik's call (approved before build); Claude designed the details. It copies the Wikipedia-note pattern exactly (decision 017): at most 10 tips a run, a "slow down" answer (HTTP 429/503) stops the step without counting against the tip, any other failure counts a try, and after 3 tries the tip is left alone. The extras live on the tip's own row, so forgetting a tip deletes them too. The players load nothing until tapped: audio uses `preload="none"`, and the video shows the already-stored thumbnail with a Play button that only then inserts YouTube's privacy-enhanced (youtube-nocookie.com) player. Apple's Search API terms ask that previews are streamed only, sit next to a link to the store, and are credited "provided courtesy of iTunes"; the page does all three.

**What we gave up:** Extras can be stale (a podcast's "latest" three are the latest as of the sweep, and are never refreshed). Tapping a card on the shelf is now two taps from the external link instead of one. A song or album is matched to its iTunes preview by name and artist, so an unusual spelling gets no preview rather than a wrong one. Shared (public) Space pages keep the old behaviour and never show the page or its extras.

**How we'll know if this was right:** After two weeks, check how many matched tips have non-empty extras (expect most songs, albums and podcasts) and how often the page is opened versus the external link. If Tarik reports a wrong preview even once, tighten the match; if he asks for fresher episodes, add a refresh rule.

**What actually happened:**
