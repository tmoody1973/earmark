# 050 — Apple Music searched alongside MusicBrainz

**Decision:** Every album, song and artist lookup now searches MusicBrainz and Apple Music's catalog at the same time, with the same words. When both return the same release, Earmark keeps it as one option carrying both identities (the MusicBrainz id and the Apple id, link and cover). Jev, the matching model, then picks once from the combined list, at the same 0.8 bar. "Search again" on a music tip does the same search.

**Why this came up:** Tarik reported tip 150, the album "MettaSun" by Jimetta Rose, a new independent release. MusicBrainz is the free, community-edited music catalog Earmark uses to name music (decision 012). It has no MettaSun, only three of Jimetta Rose's other albums. Discogs and the free iTunes Search API have nothing either. Earmark's own Apple Music catalog search (the paid developer account it already uses to add links and covers) returns exactly one result: MettaSun by Jimetta Rose, with a cover and a link. But Apple was only asked to decorate a match MusicBrainz had already made, so the tip ended unmatched, with no art and nothing to pick in "Which one?" (decision 048). New and independent releases often reach Apple's catalog before anyone adds them to MusicBrainz, so this will keep happening.

**Options:**
1. **Search both every time and merge the results.** Cost: one extra Apple call on every music lookup, plus the work of recognising the same release in both lists.
2. **Apple first, MusicBrainz only when Apple has nothing.** Cost: loses the MusicBrainz id on most matches, which the Wikipedia note and the cover-art retry depend on.
3. **MusicBrainz first, Apple as a fallback** only when Jev accepts nothing from MusicBrainz. Cost: a tip like MettaSun reaches Apple only if Jev correctly turns down all three wrong Jimetta Rose albums first, and Jev never sees both catalogs side by side.

**What we chose and why:** Option 1, chosen by Tarik. Claude first built option 3, then Tarik chose to search both every time, accepting the extra Apple call per music tip so that Jev always sees the best of both. Claude chose how it plugs in:
- The two searches run together. When the same release is in both (same name and artist, ignoring accents, case and punctuation), it becomes one option with both identities; its cover is Apple's when MusicBrainz has none, which is always at search time.
- Jev sees at most three options: merged ones first, then MusicBrainz and Apple alternating. The same three are saved for "Which one?", each recording where it came from (`musicbrainz`, `apple`, or `musicbrainz+apple`). Picking an Apple option writes its Apple id, link and cover through the same save path as any pick.
- After the pick, the Cover Art Archive step still runs for a MusicBrainz release with no cover. The separate Apple step that looks for a release's Apple twin now runs only for a pick that has no Apple id yet.
- If one search fails, the other's results are still used and the failure is logged (ids and error name only). A failure counts as a failure only when nothing was found at all, so the lane's existing retry and back-off rules apply exactly as they do for MusicBrainz today. "Search again" then says "try again in a bit".
- Apple not set up: everything behaves exactly as before.

**What we gave up:**
- One extra Apple call per music lookup, and a second one when Jev picks a MusicBrainz-only release (the twin search by the matched name).
- A release found in both catalogs now shows Apple's cover rather than the Cover Art Archive's, because Apple's arrives with the search and Cover Art only fills a gap.
- A match found only on Apple has no MusicBrainz id, so it gets no Wikipedia note (the note is written only when Wikidata confirms the page is that MusicBrainz artist). The preview and the Discogs credits still work, because they search by name, artist and Apple id.
- If MusicBrainz is overloaded (it answers "slow down") but Apple returns results, the tip is still matched from Apple's list. The lane then keeps going rather than pausing for MusicBrainz, so the next music tips in the same run ask MusicBrainz again.
- "Same release" means the same name and artist. A deluxe edition or a differently punctuated title shows up as two options, and Jev decides between them.

**How we'll know if this was right:** Tip 150 (MettaSun) is matched to the Apple album after it is requeued. And over the next month, the tips whose options include Apple's are listable, along with any Tarik later corrected:

```sql
-- Music tips whose options include an Apple one (alone or merged), and what was picked.
select id, canonical_name, creator, enrichment_status, match_source, auto_pick, owner_pick
from recommendations
where type in ('album', 'song', 'artist')
  and exists (select 1 from jsonb_array_elements(match_candidates) c where c->>'provider' in ('apple', 'musicbrainz+apple'));
```

If more than about one in ten automatic picks of an Apple-only option get corrected by Tarik, Apple's results are leading Jev astray.

**What actually happened:**
