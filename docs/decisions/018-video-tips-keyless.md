# 018: Video tips get their own type, filled in without a YouTube key

**Decision:** A YouTube video, a TikTok or a clip is now its own kind of tip, "video", with its own card. Earmark fills it in with YouTube's free oEmbed address (a public "tell me the title, channel and picture for this link" service) only when the tip carries a video link. A tip known only by its spoken title gets a YouTube search link and no picture. This is an add-on Tarik approved, adapted from the PostHog bot's draft PR #10.

**Why this came up:** Video tips were filed as "other", so the shelf showed a plain note with no picture and no link to the video. The full YouTube search service (the Data API) needs a key and a daily quota. Getting this wrong means either a key to manage for a small feature, or cards that show the wrong video.

**Options:**
1. **Free oEmbed when a link is known, a search link otherwise** (chosen). Cost: a spoken tip never gets a picture, and its link opens a YouTube search, not the video itself.
2. **The YouTube Data API search.** Cost: an API key, a quota of about 100 searches a day, and a language-model check (Jev) to pick the right result, as the other tip types do.
3. **Leave videos as "other".** Cost: nothing to build, but the card stays a plain note and triage keeps mixing videos with films and apps.

**What we chose and why:** Option 1. Tarik ruled that enrichment stays keyless. Claude built it so that a video link names the video exactly, which means no Jev call is needed. A search link identifies nothing, so there is nothing for Jev to confirm. The code marks where a keyed search would go (`youtubeDataApiSearch`, in `agent/lib/enrich/youtube.ts`).

**What we gave up:**
- **Spoken video tips have no picture.** The card shows its designed no-picture state: a screen icon on a tinted ground.
- **A search link counts as "matched".** The rec lane stores it as a finished lookup, so these tips never land in Tarik's review queue as "no match". The stored match confidence is 0, which records that nothing was identified.
- **TikToks get a YouTube search link too.** Only emailed YouTube links are looked up. A TikTok known only by its title opens a YouTube search, which may find nothing.
- **No Wikipedia note for videos.** A channel is rarely on Wikipedia, and a page with the same name is easy to mistake for it (decision 017).
- **Old tips stay "other".** Nothing is re-sorted.

**How we'll know if this was right:**
1. Over the first two weeks, count video tips whose search link Tarik opens and finds the right video near the top. If that is under half, the keyed search (option 2) is worth its key.
2. The triage eval keeps rec-type accuracy for the existing types at its current level. On 2026-10-17 it moved from 75.0% to 70.8%, one run in 24. Re-check on the next labeled set, and add real video examples to it.

**What actually happened:**
