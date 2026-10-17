# 017: A tip's one-line Wikipedia note is looked up once, and left out whenever the page might be the wrong one

**Decision:** After the rec lane matches a tip (decision 013), the same sweep looks up one plain sentence about the tip's subject on Wikipedia and stores it with its source link. The subject is the artist for an album, song or artist, the author for a book, and the thing itself for a place, podcast or film. The card shows the sentence as a quiet line under the "why", with a small "Wikipedia" link. If Earmark can't be sure it found the right page, the card shows nothing.

**Why this came up:** Tarik asked for a short "what is this" line on tips (an add-on to M3, nothing cut). Wikipedia is free and needs no key. The risk is a wrong match. "Sault" is a band, two Canadian and American cities, and a disambiguation page (a Wikipedia page that only lists other pages sharing a name). A card that shows a stranger's biography under a friend's tip is worse than a card with no note.

**Options:**
1. **Ask the summary endpoint (Wikipedia's "give me the short intro of this page" address) for the exact name.** Cost: Wikipedia page titles are case-sensitive, so "SAULT" (how Apple Music spells it) returns 404, and a bare name often lands on the disambiguation page or on a city.
2. **Search first with a hint of the kind of thing ("SAULT music", "Richard Powers writer"), pick only a page that clearly fits, then fetch that page's summary** (chosen). Cost: two requests per tip instead of one, plus a handful of word lists that decide what "fits".
3. **Ask a language model whether the page is the right one.** Cost: a paid model call per tip for something plain rules can mostly decide, and one more thing that can be confidently wrong.

**What we chose and why:** Option 2, built by Claude to the controller's rules (one try, an 8-second timeout, no model call, nothing when unsure). A page is used only when all of these hold:
- its title, minus a qualifier like "(band)", is the subject's name, ignoring case and accents ("Sault (band)" fits "SAULT"; "Sault Ste. Marie" does not);
- its one-line Wikipedia description fits the kind of thing: a music word for music tips, a writing word for authors, "podcast" for podcasts, a screen word for film and TV, and nothing that reads like a person (a birth year, "singer", "politician") for places;
- it is not a disambiguation page, and exactly one page passes (two plausible bands called "Low" → no note);
- the summary that comes back is a normal page with that same title.

The stored sentence is the summary's first sentence with bracketed asides (pronunciations, birth dates) removed, cut to 25 words.

**Limits:** at most 10 tips per sweep, 2 requests each. Each tip is looked up once (`about_at`), whether it found a note, found nothing, or failed. If Wikipedia answers 503 or 429 ("slow down"), the step stops for that run. The note lives in columns on the tip's own row (migration 014), so forgetting a tip deletes it too.

**What we gave up:** A timeout or a Wikipedia hiccup means that tip never gets a note (one try, by design). The word lists will miss some real matches. A band whose description says only "American rock outfit", or a TV show without a "film" or "series" word, gets no note. Film and place searches use no hint, so common titles will often come back unsure. Some notes describe the artist rather than the album itself. That is the spec: the note is about the subject, not the item.

**How we'll know if this was right:** Once the backlog clears, count matched tips that have a note and those that don't. Then read 20 notes against their tips: none should describe a different person, place or show. If fewer than about a third of music and book tips get a note, look at which descriptions failed the word lists and widen them.

**What actually happened:**
