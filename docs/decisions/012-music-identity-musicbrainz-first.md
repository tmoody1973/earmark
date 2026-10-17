# 012 — Music tips are identified by MusicBrainz first; Jev picks the match or says "none fits"

**Decision:** When a tip is an album, song or artist, Earmark looks it up in MusicBrainz (a free, open music encyclopedia that needs no key), lets Jev choose which of the top three results is the thing that was said or answer "none fits", then adds cover art from the Cover Art Archive (MusicBrainz's free image store) and, once Apple keys exist, an Apple Music link.

**Why this came up:** The plan built music enrichment on the Apple Music catalog, but no Apple keys exist yet, and Bee often mishears names. Tarik ruled the order: MusicBrainz for identity, Cover Art Archive for art, Apple Music as an extra that is skipped while unconfigured, Discogs later. The task also had to settle how Jev chooses, because a wrong match puts the wrong album cover and link on a card Tarik trusts.

**Options:**
1. **One Jev question with every candidate as an option plus "none fits", options shuffled** (chosen). Cost: Jev leans toward whichever option comes first, so the order is shuffled every time; one call per tip.
2. **One yes/no Jev question per candidate, keep the best yes.** Cost: up to three calls per tip, and no explicit way to say "none of these"; it only falls out when every answer is low.
3. **Take MusicBrainz's top result with no model.** Cost: the search score ranks spelling, not meaning; a remix or a tribute album with the same title would win.

**What we chose and why:** Option 1, Claude's call, following the controller's ruling (shuffle the candidates, allow abstaining) and the existing idea-matching pattern (`chooseCluster`). A match needs Jev's probability of at least 0.8; anything less is "no match" and goes to review rather than guessing.

Two details came from running it read-only on the three real music tips in production:
- **The artist is a hint, not a requirement.** Bee heard "Salt" for the band SAULT. A search that required the artist found three wrong albums and Jev rightly said "none fits". The search now ranks the exact title first, then title words, then the artist spelled approximately (up to two letters off, only for words of 4+ letters), so the right album comes back and Jev accepted it (0.86).
- **A song's cover comes from an original release only.** A song's first listed release is often a compilation ("Viral TikTok Hits") or a DJ mix with someone else's cover. No original release means no picture, which the card already handles.

Apple Music, when configured, only adds a link to a match MusicBrainz and Jev already settled, and only when Apple's result has the same title and artist (no second Jev call).

**What we gave up:** Approximate artist spelling can surface a different real band with a similar name; Jev's same-item check is the only guard, so a near-miss artist is the most likely wrong match. MusicBrainz allows one request per second per server address; Earmark spaces requests inside one process, but two serverless instances at once could exceed it and get refused (logged as status 503; the tip is retried later, never in a loop). Songs with no original release show no art.

**How we'll know if this was right:** After M3-T4 runs the lane on real tips, count music tips that end matched, no match, and later corrected by Tarik. Wrong matches cluster on near-miss artists → tighten the fuzzy rule. Repeated 503s in logs → move the one-per-second spacing into the database.

**What actually happened:**
