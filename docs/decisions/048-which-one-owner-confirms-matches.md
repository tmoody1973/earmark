# 048 — "Which one?": the owner confirms or corrects which real-world item a tip is

**Decision:** Earmark now keeps the few options a lookup service returns for each tip, and lets Tarik settle which one was meant. When Earmark wasn't sure (no confident match), the tip page asks "Which one did Ann mean?" with up to three options, plus "None of these" and "Search again". When Earmark was sure but had other options, a quiet "Not the right one?" lets him swap it. His answer is final: the background lookup never changes it again.

**Why this came up:** To turn "Ann said check out Shōgun" into a real item, Earmark asks a lookup service (MusicBrainz for music, TMDB for film and TV, Google Places for places, and so on; decision 012), gets back up to three candidates, and has Jev (the matching model) pick one or abstain. Until now the candidates it didn't pick were thrown away. Two kinds of tip got stuck. Unmatched tips: four places where Google returned real options but Jev was under its 0.8 bar (decision 046), with no way to resolve them. Wrong confident matches: Shōgun the 2024 series matched as the 1980 one, with no way to correct it. What was at stake: a wrong item on a tip is worse than none (wrong art, wrong links, wrong credits on the page), and a stuck tip is a recommendation Tarik can't act on.

**Options:**
1. **Keep it automatic only.** Cost: the stuck tips stay stuck, and wrong matches stay wrong; the only fix is editing the database by hand.
2. **Ask the owner only when Earmark wasn't sure.** Cost: fixes the stuck tips, but a confident wrong match (the Shōgun case) still can't be corrected.
3. **Ask when unsure, and let the owner override any automatic match.** Cost: the most UI (a question section, a correction disclosure, a card chip), and a stored copy of the candidates on every looked-up tip.

**What we chose and why:** Option 3. Tarik chose to build it (all three behaviors: ask when unsure, correct a wrong guess, Search again). Claude chose how it plugs in:
- The lane (the 10-minute background lookup, decision 013) saves the candidates it already fetched on every lookup that returned any, plus which one Jev picked (or "none"). No extra service calls.
- An owner's pick goes through the very same save code as an automatic match, so the name, maker, year or address, art, links and location are applied the same way. It is then marked `match_source = 'owner'`, which the lane never looks up or overwrites. The tip page's extras (decision 045) and its Wikipedia note are cleared so the lane refills them for the new item. When the pick corrects an earlier match, that match's maker, art, links, year or address and place go with it. A tip that came from a capture (a shared song, a photo, an email) keeps its own Apple Music link, Apple id and picture unless the pick brings its own, and a capture's own web link always stays. The page sends the option's name along with its position, and the pick is refused ("Those options changed") if the stored options were replaced since the page loaded, for example by the lane's second look or a search in another tab. The lane's later steps (the Wikipedia note, the extras, the art retry) check that the tip is still the item they looked up before they write, so a correction mid-sweep can't be overwritten with the old item's details, and the lane never overwrites options the owner searched for.
- "None of these" is final too: the tip stays unmatched and in review, and the question goes away.
- "Search again" runs the tip type's lookup service with Tarik's own words (2–120 characters; what was said is never sent), leaning toward where it was said for places (decision 046), and stores the new options without picking one. It is the one place a lookup service is called from a page rather than the background lane (decision 012 kept MusicBrainz out of request paths to protect its once-a-second limit), so it is limited to one search per tip every 10 seconds, refused when the service isn't set up, and a "slow down" answer (429/503) says "try again in a bit". MusicBrainz's once-a-second rule is per caller, and a page search can coincide with the lane's own request; we accept that a rare collision gets a 429, which the owner sees as "try again in a bit" and which never counts against the tip.
- A one-off script (`pnpm requeue:unmatched`, a dry run unless `--yes`) sends already-unmatched automatic tips back to the lane once, so they get their candidates saved.

**What we gave up:** More UI on the tip page and a chip on cards. Every looked-up tip now stores a copy of up to three public catalog entries (names, makers, years, addresses, image and link URLs, map coordinates), which can go stale; it lives on the tip's own row, so forgetting a tip deletes it with everything else. Search again spends lookup-service calls from a page tap, within the 10-second limit, and a music pick shows its cover a sweep later (the art is fetched by the lane, not by the tap). An owner's answer is final: a mistaken pick can't be undone from the page yet. If the tip is queued ("Try this") and already has a Bee todo, a correction does not rewrite that todo's text: it keeps the old name until the todo is done or the tip leaves the queue. We accepted this because the todo's link opens the tip's own page, which shows the corrected item; rewriting Bee todos would need a new update path in the Bee reconciler.

**How we'll know if this was right:** The four stuck place tips get resolved (picked or "None of these") within a week of the requeue. And the auto-pick agreement rate, how often Jev's pick matches what Tarik chose, is computable from the database at any time:

```sql
-- auto_pick: what Jev chose ('none' = abstained); owner_pick: what Tarik chose; owner_none_at: Tarik said none.
select
  count(*) filter (where owner_pick is not null and owner_pick = auto_pick)                 as agreed,
  count(*) filter (where owner_pick is not null and auto_pick <> 'none' and owner_pick <> auto_pick) as jev_wrong,
  count(*) filter (where owner_pick is not null and auto_pick = 'none')                     as jev_abstained_owner_picked,
  count(*) filter (where owner_none_at is not null)                                         as both_said_none
from recommendations where match_source = 'owner';
```

If "jev_wrong" is more than about one in ten owner answers, the 0.8 bar or the matching instructions need work.

**What actually happened:**
