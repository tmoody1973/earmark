# 033 — A capture upgrades the recommendation Earmark already heard, instead of adding a second

**Decision:** When a photo (and later a song or email) is captured, Earmark first looks for a recommendation already saved from the same Bee conversation with the same name once capitalization, punctuation, a leading "the" and bracketed asides are ignored. If it finds one, it fills in the missing pieces (cover image, links, Apple Music id) on that recommendation. Otherwise it saves a new one.

**Why this came up:** The usual case is that Bee overhears "you have to hear Promises", Earmark saves it from the transcript, and then Tarik photographs the album a minute later. Without a rule, the garden would show Promises twice, once with no picture and once with one, and the second would carry no information about who recommended it. Duplicates quietly make a list of recommendations feel untrustworthy.

**Options:**
1. **Always insert a new recommendation.** Simplest, but produces the duplicate above every time a capture follows a conversation. Real cost: Tarik has to merge or delete by hand.
2. **Upgrade the existing one (chosen).** The conversation id plus the name is a very specific match, so false merges are rare. Real cost: a rule to maintain, and the occasional miss when the two names differ ("Promises" vs "Promises (Floating Points)" is handled by ignoring bracketed text, but "Sam Gendel: Promises" is not).
3. **Let the model decide whether two recommendations are the same.** Handles messier names, but adds a paid model call, a new way to be wrong, and a decision nobody can easily check. Held back until the simple rule demonstrably misses.

**What we chose and why:** Option 2, decided by Claude as a ruling during lane C (the capture channels), because it removes the most common duplicate with no new moving parts. The upgrade keeps the existing recommendation's status and recommender (so a "queued" item stays queued and the person credited from the conversation stays credited) and only fills fields that are empty. It also does not count as another recommendation given by that person. The photo record, the recommendation update and the recommender bookkeeping happen in one database transaction (all-or-nothing), so a failure never leaves a half-saved capture; if the thumbnail was already uploaded when the save fails, the upload is deleted.

**Which conversation counts:** The recommendation is tied to a Bee conversation (and so eligible for this upgrade) only when Earmark's picker found the photographed item being talked about in that conversation. A conversation that merely happened nearby in time and place is not enough: the photo's own record keeps that time-and-place link, because it is still true, but the recommendation does not claim to come from a conversation that never mentioned it.

**Related choices that ship with it:** Thumbnails live in Vercel Blob (file storage) at public-but-unlisted URLs: anyone with the full address can open it, but the address ends in a random suffix so it cannot be guessed, and it is not listed anywhere. The capture endpoints are protected by a bearer token (a long secret sent in a header that the iPhone Shortcut carries), compared in constant time (the comparison takes the same time whether the first or last character is wrong, so guessing cannot be sped up by timing). Rate limiting is not built into the code; the recommended setup is a Vercel firewall rule on `/api/capture/*` at deploy.

**What we gave up:**
- **Exact-name matching only.** Differently worded titles for the same item will still produce two entries.
- **A tiny race.** The look-up happens just before the transaction, so two captures of the same item arriving within a second could both insert. For one owner sharing from one phone this is accepted.
- **Unguessable, not private, thumbnails.** Anyone who is given or finds a thumbnail address can open it; the person-in-frame rule (decision 032) is what limits what could be exposed.
- **An unused upload.** If a capture upgrades a recommendation that already has a picture, the new thumbnail is stored but never used.

**How we'll know if this was right:** Over the first month, run `select canonical_name, bee_conversation_id, count(*) from recommendations group by 1, 2 having count(*) > 1`: it should return nothing that Tarik would call the same item. If it does, the matching rule needs widening. Also check that no capture lost its recommender when it upgraded an ambient save.

**What actually happened:**
