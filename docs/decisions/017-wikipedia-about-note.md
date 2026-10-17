# 017: A tip's one-line Wikipedia note is looked up once, and left out whenever the page might be the wrong one

**Decision:** After the rec lane matches a tip (decision 013), the same sweep looks up one plain sentence about the tip's subject on Wikipedia and stores it with its source link. The subject is the artist for an album, song or artist, the author for a book, and the thing itself for a place, podcast or film. The card shows the sentence as a quiet line under the "why", with a small "Wikipedia" link. If Earmark can't be sure it found the right page, the card shows nothing.

**Why this came up:** Tarik asked for a short "what is this" line on tips (an add-on to M3, nothing cut). Wikipedia is free and needs no key. The risk is a wrong match. "Sault" is a band, two Canadian and American cities, and a disambiguation page (a Wikipedia page that only lists other pages sharing a name). A card that shows a stranger's biography under a friend's tip is worse than a card with no note.

**Options:**
1. **Ask the summary endpoint (Wikipedia's "give me the short intro of this page" address) for the exact name.** Cost: Wikipedia page titles are case-sensitive, so "SAULT" (how Apple Music spells it) returns 404, and a bare name often lands on the disambiguation page or on a city.
2. **Search first with a hint of the kind of thing ("SAULT music", "Richard Powers writer"), pick only a page that clearly fits, then fetch that page's summary** (chosen). Cost: two requests per tip instead of one, plus a handful of word lists that decide what "fits".
3. **Ask a language model whether the page is the right one.** Cost: a paid model call per tip for something plain rules can mostly decide, and one more thing that can be confidently wrong.

**What we chose and why:** Option 2, built by Claude to the controller's rules (8-second timeout, no model call, nothing when unsure). A first review found that "the title matches and the description fits" still let namesakes through: a restaurant called "Rome" got the city, a band could get a same-named band. So the rules were made stricter. A page is used only when all of these hold:
- its title, minus a qualifier like "(band)", is the subject's name, ignoring case and accents ("Sault (band)" fits "SAULT"; "Sault Ste. Marie" does not);
- its one-line Wikipedia description fits the kind of thing, matched as whole words: "martial artist", "film producer" or "talk show host" never count as music or TV, and for places, podcasts and screen, nothing that reads like a person ("born", "presenter", "politician");
- it is not a disambiguation page, and exactly one search result passes;
- the summary is a normal page with that same title;
- and it is this tip's subject, not a namesake:
  - **music:** Wikidata (the structured database behind Wikipedia) must link the page to the exact MusicBrainz entry the tip was matched to. For an artist that is the MusicBrainz artist id (property P434). For an album or song, the page must be the performer of that MusicBrainz release group or recording (P436 or P4404, with P175 "performer"). This is one free query. A music tip with no MusicBrainz match gets no note and makes no calls;
  - **book:** the author's page (summary or search snippet) must mention the book's title;
  - **film/TV and podcast:** the year or the maker (host, creator) must appear on the page. If we know neither, there is no note;
  - **place:** the description must name a kind of venue (restaurant, bar, café, museum, shop, park…), or the summary must mention the tip's own town from its address.

The stored sentence is the summary's first sentence with bracketed asides (pronunciations, birth dates) removed, cut to 25 words.

**Limits:** at most 10 tips per sweep, 2 requests each (3 for music). A note, or a clear "unsure", is final (`about_at`). A thrown error or timeout counts a try (`about_tries`), and the tip is asked again on a later run, least-tried first. After 3 tries it is done with no note. If Wikipedia or Wikidata answers 503 or 429 ("slow down"), nothing is counted and the step stops for that run. The note lives in columns on the tip's own row (migration 014), so forgetting a tip deletes it too. It shows on Tarik's own views (shelf, People, private Spaces), never on a public shared page.

**What we gave up:** More real matches are missed now. Plenty of albums and songs aren't linked in Wikidata. Many author pages don't name every book. Film and place searches use no hint, so common titles (The Bear) usually come back unsure. Some notes describe the artist rather than the album, which is the spec: the note is about the subject, not the item.

**How we'll know if this was right:** Once the backlog clears, count matched tips that have a note and those that don't, by type. Then read 20 notes against their tips: none should describe a different person, place or show. If music notes are rare, check how many matched release groups have a Wikidata entry before loosening anything.

**What actually happened:**
