# 035 — The weekly episode's audio is unguessable, not locked, and the feed is protected by a secret link

**Decision:** The weekly episode MP3 is stored in Vercel Blob (file storage) at a public-but-unlisted address that ends in a random suffix, and the private podcast feed (`/feed/<token>`) is protected only by a long secret token in its address. Nothing else guards either one.

**Why this came up:** Each episode is a spoken script about Tarik's week. By design it contains first names of the people who recommended things and short excerpts (25 words or fewer) of what they said. If the audio or the feed leaked, a stranger could hear friends' names next to their recommendations. At the same time, a podcast app has to be able to fetch the feed and the audio without Tarik signing in to anything, and the apps do that fetching from their own servers, not from his phone.

**Options:**
1. **Public-but-unlisted audio plus a secret-token feed (chosen).** The audio address has a random suffix (about the strength of a long password) and is never shown anywhere except inside the feed. The feed address contains a 32+ character random token; a wrong token gets a plain "not found" so the route does not even confirm it exists. Real cost: anyone who is handed the full feed or audio address can open it, forever, until we rotate the token or delete the file. There is no per-listener login and no way to revoke one person.
2. **Private storage with short-lived signed audio links.** The feed would hand out audio links that expire. Real cost: podcast apps download episodes on their own schedule and keep the link they saw in the feed, so expired links break playback and downloads, and some apps refuse feeds whose links change. Much more moving parts for one listener.
3. **Feed behind a real login (username and password / Clerk).** Strongest on paper. Real cost: Apple Podcasts and most apps can only pass a basic username and password, which would mean a second credential system, and the fetch still comes from the app's servers, not from Tarik's signed-in browser.

**What we chose and why:** Option 1, decided by Claude as a ruling during lane M5, with Tarik's brief asking for a "private RSS feed he can follow in a podcast app". It is the same trade already accepted for photo thumbnails (decision 033). It works in every podcast app, adds no new accounts, and the privacy of the content is limited further by the script rules: first names only, excerpts of 25 words or fewer, the owner's own name never credited, and nothing is published until Tarik approves the episode.

**What we gave up:**
- **No real access control.** Possession of the address is the only key. If the feed address is pasted into the wrong place (a screenshot, a chat, a shared podcast-app subscription) anyone with it can listen.
- **Podcast apps see everything.** Apps fetch the feed and the audio from their own servers, so the app's company can read the names and hear the audio. Tarik should only subscribe with an app he is comfortable with.
- **Old audio stays reachable.** An episode's audio address keeps working even after the episode is removed from the feed, until the file itself is deleted. "Forget a person" therefore deletes the Blob file as well as the database row (`agent/lib/privacy/forget-m5.ts`).
- **Rotation is manual.** Changing `EARMARK_FEED_TOKEN` stops the old feed address immediately, but Tarik has to re-subscribe in his podcast app.

**How we'll know if this was right:** After the first approved episode, request the feed with a wrong token (expect a 404 with no body detail), check that the feed XML contains no names beyond first names, and search the web for the Blob host with the episode filename to confirm nothing indexes it. After a month, check that the feed address has not been seen anywhere outside Tarik's podcast app. If either fails, rotate the token and move to option 2.

**What actually happened:**
