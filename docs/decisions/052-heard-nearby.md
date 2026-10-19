# 052 — Overheard tips nobody recommended go to a quiet "Heard nearby" log

**Decision:** When Earmark overhears a tip (Bee was just listening; nobody said "Earmark that") and no person in the conversation is recommending it to Tarik, the tip is no longer put on the shelf or in Maybe?. It is saved with a new status, `overheard`, and appears only on a quiet page, Heard nearby (`/heard`). There is no badge and no count anywhere. Home has one plain text link to it. Each item there has two buttons: Keep (it joins the shelf as a normal tip) and Clear. Deliberate captures and overheard tips that name a person behave exactly as before.

**Why this came up:** Production counts (counts only; no transcripts were opened):

| Kind of tip | Saved | Tarik cleared | Tarik used | Untouched |
|---|---|---|---|---|
| Overheard, **no** person recommending it | 51 | 42 | 0 | 9 |
| Overheard, with a person | 1 | — | — (kept) | — |
| Deliberate ("Earmark that", Bee voice notes) | 9 | 0 | 3 | — |

The names of the person-less ones read like ads and YouTube. A recommender is only ever recorded when a first name is actually said (`agent/lib/pipeline/attribution.ts`), never the owner, so an ad saying "you should try…" gets no person. If we got this wrong in one direction, Tarik keeps spending his attention clearing ads (42 manual clears so far), and the shelf stops being trustworthy. In the other direction, a real tip he would have wanted disappears from view.

The research behind this is in `docs/research/2026-10-19-ambient-capture-noise-ux.md`. In short: the always-listening products people trust keep overheard things in a quiet layer and put only what the owner asked for in front of them (Pixel "Now Playing" history, Omi's hidden "discarded conversations"). The ones that get panned push overheard media at the owner as if it were theirs (Bee's to-dos from TV shows, the Friend pendant). Extra suggestions are tolerated only when ignoring one costs nothing. Omi users thought hidden items had vanished because nothing said where they went, which is why Home keeps one link.

**Options:**
1. **A tip needs a person; person-less overheard tips are dropped.** Cost: real tips said by a radio host or podcast with no named person are lost with no way back.
2. **Keep everything, but cap Maybe? at 3 a day.** Cost: at roughly 18% precision for these tips (9 of 51 not cleared), that is about 2.5 ads and half a real tip a day for Tarik to judge. Alert fatigue (people learn to skip a list that is mostly noise) would train him to skip the row, real tips included.
3. **Only deliberate captures make tips.** Cost: turns off the part of Earmark that works without being asked, and ads still reach ideas.

**What we chose and why:** Option 1 with a quiet log instead of dropping, chosen jointly: Tarik chose it after reading the research ("go heard nearby"); Claude built it. How it works:
- The rule lives in one place, `recStatusAtSave` in `agent/lib/pipeline/save-item.ts`, which decides every tip's first status. Overheard means source `ambient`, no `deliberate_key` (not "Earmark that"), no `bee_journal_id` (not a voice note). Overheard with no recommender → `overheard`, whichever confidence band Jev gave it. Everything else is unchanged.
- `overheard` joins the one hidden list (`HIDDEN_TIP_STATUSES`), so it is off the Shelf, Home, Maybe?, People, Spaces, backlinks, Serendipity, place nudges and similar-tip links. Search, the weekly episode, gardeners and the MCP tools had their own written-out lists; each now names it too. The rec lane (the background job that looks tips up in catalogs) skips it, so an overheard tip costs no lookups, web searches or model calls.
- Keep moves it to `new`, so its lookup then runs normally. Clear moves it to `dismissed`. Both record Tarik's verdict (`user_verdict`), the same column the Maybe? row uses. Forget still finds and deletes it.
- Migration 044 widens the status check. A backfill script (`pnpm move:heard`, a dry run unless given `--yes`) moves existing person-less overheard tips that are still `new` or `needs_review`; it never touches anything Tarik queued, tried, rated, cleared or composted.
- The page shows the last 14 days, newest first, at most 50, each with the time it was heard (Chicago) and the stored quote (25 words at most) so an ad is obvious at a glance.

**What we gave up:**
- Some real tips will be quieter. A DJ or podcast host recommending an album Tarik does want lands in the log, not the shelf. For someone who works in radio that may be common. The log is the safety net only if he looks at it.
- The person check makes its own mistakes. Ads that name a person ("Ann says…") still pass as person tips, and a friend mentioning something without saying their own name fails.
- The evidence for the person rule is thin: it rests on one kept person tip. It fits the rule; it does not prove it.
- More to build than option 3: a new page, actions, a migration and a backfill.
- Ideas are untouched. Ambient ideas can also come from ads; that is a known follow-up, not part of this change.
- The 7-day auto-expiry the research suggested is not built. The page simply shows 14 days; older overheard tips stay in the database as `overheard` until forgotten.
- Re-sorting (`pnpm resort`) does not apply the person rule: it only moves `new`/`needs_review`, and never touches `overheard`. A tip re-sorted later stays where the re-sort puts it.

**How we'll know if this was right:** Over the 7 days after launch:
- The cleared rate for overheard tips that reach the shelf or Maybe? falls from **82% to 25% or less**.
- Fewer than **1 in 10** Heard nearby items get kept. More than that means the person rule is too strict.

```sql
-- Overheard tips that reached the shelf or Maybe? since launch, and how many Tarik cleared.
select count(*) as reached, count(*) filter (where status = 'dismissed') as cleared
from recommendations
where source = 'ambient' and deliberate_key is null and bee_journal_id is null
  and recommender_id is not null and created_at >= '<launch date>';

-- Heard nearby items since launch, and how many Tarik kept.
select count(*) as heard, count(*) filter (where user_verdict = 'kept') as kept
from recommendations
where source = 'ambient' and deliberate_key is null and bee_journal_id is null
  and recommender_id is null and created_at >= '<launch date>';
```

**The broadcast filter, tightened the same day.** The filter (a yes/no question Jev answers for every overheard window: is this an ad or a broadcast playing from a speaker?) named ads, station IDs and scripted radio/TV/podcast segments, but not online video. It now also names YouTube, TikTok, Instagram, livestreams, audiobooks and song lyrics, and the tells of one voice talking to an audience ("welcome back to the channel", "link in the description"). Measured by Claude on the stored quotes (25 words or fewer each, counts only, no text printed), with Earmark's real triage call: the tips Tarik cleared that the filter catches went from 6 of 42 to 9 and then 10 of 42 on two runs, while the overheard tips he kept stayed at 1 of 10 flagged and deliberate captures at 1 of 9. The labeled eval (48 windows, which scores tip/idea sorting, not the broadcast question) did not get worse: accuracy 66.0% → 66.7%, tip precision 10.7% → 11.5%, idea precision 53.6% unchanged. *What we gave up:* a 25-word quote is less context than the real window, so the real effect may differ; the filter still misses most person-less ads, which is why the person rule, not the filter, does the heavy lifting.

**What actually happened:**
