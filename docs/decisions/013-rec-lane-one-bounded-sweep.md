# 013 — Tips are looked up by one bounded, non-overlapping sweep; keyless sources first

**Decision:** Every new tip waits in a queue ("pending"), and a scheduled job that runs every 10 minutes (the "sweep") looks up at most 10 of them per run, one at a time, with only one sweep running at once. Keyless sources work today (MusicBrainz for music, Open Library for books, Wikipedia for everything else, Apple's free iTunes search for podcasts). Film/TV, places and the better podcast source switch on by themselves once their keys are added.

**Why this came up:** Enrichment (adding the real title, cover art and a link to a tip Bee heard) calls outside services that limit how fast you may ask. MusicBrainz blocks anyone who asks more than once a second (decision 012), and Jev (the matching model) costs money per call. If every new tip triggered its own lookup the moment it arrived, a busy conversation could fire a burst of calls from several servers at once, get Earmark blocked, and spend without limit. No keys exist yet for TMDB (films), Google Places or Podcast Index.

**Options:**
1. **Look the tip up the moment it is saved** (the original plan). Cost: bursts from parallel servers break MusicBrainz's one-per-second rule; a slow service slows down saving tips; failures need their own retry path anyway.
2. **One scheduled sweep, bounded, holding a database lock** (chosen). Cost: a new tip's art and link appear up to about 10 minutes later.
3. **A job queue service** (a separate system that hands out work items). Cost: a new paid dependency and more moving parts for one person's volume.

**What we chose and why:** Option 2, the controller's binding ruling, with the details filled in by Claude:
- **Queue = a column, not a service.** A tip is pending from the moment it is saved, so nothing that saves tips has to remember to enqueue it. `runRecLane(id)` exists for capture paths that want a tip looked at in the very next sweep; it only moves the tip to the front and never calls a service itself.
- **One sweep at a time.** The sweep holds a Postgres advisory lock (a database-wide "someone is already doing this" flag) for its whole run. The lock lives inside an open transaction on its own connection, so it is released even if the server is killed mid-run. A plain session lock would have leaked through Neon's connection pooler, which hands the same database connection to different clients.
- **Bounds per run:** at most 10 tips, at most 8 Jev calls, and no new tip after 4 minutes. At most 6 runs an hour, so at most 48 Jev calls an hour while there is a backlog, and none once the queue is empty.
- **Retries:** a failed lookup waits 15 minutes, then 1 hour, 4 hours, 16 hours; after 5 failures the tip is marked "failed" and never tried again. A "too busy" answer (HTTP 503 or 429) from any service stops the whole sweep straight away and does not count against the tip.
- **Which tips:** visible tips and "Maybe?" tips (so the Maybe row shows art, decision 025). Never dismissed or composted ones. A tip dismissed while it is being looked up is left alone.
- **What a match changes:** the title and creator become the provider's spelling (fixing Bee's mishearings), and art, year/address and links are added. A photo or link the tip already had is kept.
- **Podcasts without Podcast Index keys use the iTunes Search API** (Apple's free, keyless catalog search). It covers the shows people actually name and gives artwork and an Apple Podcasts link. Podcast Index takes over automatically once both its key and secret are set.
- **Types without keys wait.** Film/TV and place tips stay pending and are not even selected, so they use no attempts. Each sweep logs one line saying which types are waiting. When the key is added, they are looked up on the next runs.

**What we gave up:** Speed: art and links arrive minutes after the tip, not instantly. Coverage: Wikipedia is a weak match for many "other" tips, and iTunes misses some independent podcasts that Podcast Index would find. A tip that fails 5 times stays bare until someone resets it by hand. Wikipedia pictures are requested at a fixed 330px width; a few very small originals will show no picture.

**How we'll know if this was right:** After a week of real tips: count tips by status (matched / no match / failed / still pending). Pending older than an hour means the sweep is stuck or starved. Any "stoppedOn" in the sweep logs more than occasionally means the bounds are too loose. Compare Jev calls per day against the 48-an-hour ceiling.

**What actually happened:**
