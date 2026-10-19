# 050 — Apple Music as the music lookup's fallback

**Decision:** When MusicBrainz has nothing for an album, song or artist (or Jev, the matching model, says none of MusicBrainz's options is the one), Earmark now searches Apple Music's catalog with the same words and lets Jev pick among Apple's options, at the same 0.8 bar. An Apple pick becomes the match, with Apple's cover, Apple Music link and Apple id. "Search again" on a music tip does the same: MusicBrainz first, Apple when MusicBrainz finds nothing.

**Why this came up:** Tarik reported tip 150, the album "MettaSun" by Jimetta Rose, a new independent release. MusicBrainz (the free, community-edited music catalog Earmark uses to name music, decision 012), Discogs and the free iTunes Search API all return nothing for it. Earmark's own Apple Music catalog search (the paid developer account it already uses to add links and covers) returns exactly one result: MettaSun by Jimetta Rose, with a cover and a link. But Apple was only ever asked to decorate a match MusicBrainz had already made, so the tip ended unmatched with no art and nothing to pick in "Which one?" (decision 048). New and independent releases often reach Apple's catalog before anyone adds them to MusicBrainz, so this will keep happening.

**Options:**
1. **Leave it.** Cost: new independent releases, the kind of tip a radio person most wants to act on, stay unmatched; the only fix is typing the details in by hand.
2. **Apple as a fallback when MusicBrainz has no accepted match.** Cost: one more Apple call and up to one more Jev call per such tip; a match found this way has no MusicBrainz id, so it gets no Wikipedia note.
3. **Ask both every time and let Jev choose across them.** Cost: an Apple call and a bigger choice for Jev on every music tip, including the many MusicBrainz already gets right, and two catalogs' near-duplicates competing in one question.

**What we chose and why:** Option 2, jointly: Tarik reported the case, Claude proposed the fallback. MusicBrainz stays first because it is keyless and its ids power the Wikipedia note and the cover-art retry. How it plugs in:
- The background lookup (the lane, decision 013) asks Jev about MusicBrainz's options as before. Only if Jev accepts none (or there were none) and Apple is set up does it search Apple, then asks Jev again with the same tip and the same words. An Apple pick skips the Cover Art Archive step (that needs a MusicBrainz id; Apple's cover is already on it).
- The "Which one?" options keep both lists: Apple's first, then MusicBrainz's, up to the three the page shows. Each option records which service it came from (`provider: "apple"` or `"musicbrainz"`), and picking an Apple option writes its Apple id, link and cover through the same save path as any pick.
- If Apple errors or times out during the fallback, the lane treats it as "no match this time" and logs it (ids and error name only); it never throws away a MusicBrainz result and never counts against the tip. In "Search again", an Apple "slow down" (429/503) shows "try again in a bit", the same as any service's.
- Apple not set up: everything behaves exactly as before.

**What we gave up:**
- A music tip can now cost two Jev calls instead of one, so the lane's cap of 8 Jev calls a run can be passed by one.
- An Apple-only match has no MusicBrainz id, so it gets no Wikipedia note (the note is only written when Wikidata confirms the page is that MusicBrainz artist). The preview and Discogs credits still work: they search by name, artist and Apple id.
- An Apple timeout during the fallback, on a tip MusicBrainz knew nothing about, ends that look as unmatched rather than retrying. Tarik can still use "Search again", or requeue it.
- Apple's catalog search is by words, so Jev's same-item judgment is the only guard against a look-alike; it is the same guard every other lookup has.

**How we'll know if this was right:** Tip 150 (MettaSun) is matched to the Apple album after it is requeued. And over the next month, the tips Apple matched are listable, along with any Tarik later corrected:

```sql
-- Music tips whose options include an Apple one, and whether the match came from Apple.
select id, canonical_name, creator, enrichment_status, match_source, auto_pick, owner_pick
from recommendations
where type in ('album', 'song', 'artist')
  and exists (select 1 from jsonb_array_elements(match_candidates) c where c->>'provider' = 'apple');
```

If more than about one in ten of the automatic Apple picks get corrected by Tarik, the fallback is guessing too loosely.

**What actually happened:**
