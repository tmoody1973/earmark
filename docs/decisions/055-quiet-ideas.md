# 055 — An idea overheard once stays quiet until it comes up again, and any idea can be dismissed

**Decision:** An idea Earmark picked up by listening (not "Earmark that", not a Bee voice note) that has been mentioned only once no longer shows anywhere ideas are listed: Home's garden, the Garden page, Serendipity, search, Spaces, links between ideas and tips, the gardeners and the weekly episode. It is still saved, still grouped with similar ideas, and still counts. The second time it comes up, on a separate occasion, it sprouts and appears on its own, and the third time it blooms exactly as before. The quiet ones wait on a page called Heard once (`/heard-once`), reached by one plain text link on the Garden page and one beside Heard nearby on Home, with no badge and no count. Each has Keep (show it now) and Dismiss. Any idea can also be dismissed from its own page, with no confirmation and an Undo for an hour.

**Why this came up:** Tarik asked to get TV-born ideas out of his garden and to be able to dismiss an idea. Production had 70 ideas, every one mentioned once (counts and titles only; no transcripts were opened), and recent titles read like television: "Speculating about Freddie Mercury appearing afterward", "Trump cornered and considering finishing off Iran". If we got this wrong in one direction, the garden stays mostly noise and stops being worth opening. In the other, a real idea he said once in passing disappears from view.

Decision 052 fixed the same problem for tips with a quiet log, following the research in `docs/research/2026-10-19-ambient-capture-noise-ux.md`: always-listening products people trust keep overheard things in a quiet layer and only put in front of the owner what he asked for or what proved itself. Tips had a test for "proved itself" (a person recommending it). Ideas have no recommender, so that test doesn't apply. The garden already has its own: an idea grows by being mentioned again.

**Options:**
1. **Quiet until it recurs.** A single overheard mention is hidden; a second occasion shows it. Cost: an idea Tarik really did say once, in passing, waits in Heard once until he looks there or says it again.
2. **Drop single overheard ideas entirely.** Cost: nothing to come back to, and the second mention would have nothing to join, so a real idea could never grow from ambient listening alone.
3. **Leave ideas alone and rely on the broadcast filter** (the yes/no question asked of every overheard window: is this an ad or a show playing from a speaker?). Cost: by decision 052's own measurement the filter catches only about a quarter of the noise, so most TV ideas would still land in the garden.

**What we chose and why:** Option 1, chosen jointly: Tarik asked to remove TV-born ideas and to dismiss ideas; Claude proposed "quiet until it recurs" because it uses the garden's own rule instead of inventing a new one. How it works:
- The rule lives in one place, a database function `idea_is_quiet` (migration 045). An idea is quiet when it is still compost (the first stage), has at most one mention, is not pinned or kept, and every mention it has was overheard. An idea with no mention records at all is not quiet: there is no evidence it was overheard. Every query that lists ideas adds `not idea_is_quiet(c.id)`; the audit list is in the work report.
- There is no new stage. Mentions 1, 2 and 3 still count exactly as before, so the live bloom (the plant opening on Home as the third mention arrives) is unchanged; an integration test drives a quiet idea through all three mentions on the real save path.
- Grouping is unchanged: a quiet idea is still offered when a new mention looks for the idea it belongs to. That is how it recurs.
- Keep sets a new column, `kept_at`. Pinning was the obvious existing tool, but pins are capped at 5 (Top of Mind) and each pin proposes a Bee fact, so Keep would have failed or done too much.
- Ideas Tarik already accepted into a Space, or whose link he accepted, are marked kept by the migration, so nothing he chose disappears.
- Dismiss moves the idea to the existing `dismissed` stage; a dismissed idea that is mentioned again stays dismissed, as before. Undo works for an hour, puts a drafted or used idea back as it was, and recounts a growing one from its mentions, so a mention that arrived in between still counts. It never undoes a merge's dismissal; the merge's own Undo does that.
- The background judges that look for links and Space members skip quiet ideas, so a TV idea costs no model calls until it recurs.

**What we gave up:**
- Real ideas said once, ambiently, are now quieter. For someone who thinks out loud this may be common. Heard once is the safety net only if he looks at it.
- The rule trusts how a mention was captured, not what was said. An idea said once to a friend, without "Earmark that", waits like a TV line does.
- Links and Space suggestions involving a quiet idea are hidden too, including "same idea? Merge here" suggestions that might have rescued it.
- A migration that production needs before the code ships: without the function, every garden page errors.
- Heard once shows 14 days. Older quiet ideas stay in the database, findable by their own page link but not listed.
- The judge demo's seed ideas were marked as voice notes so the demo garden looks as it did, which means the demo's Heard once page is empty.

**How we'll know if this was right:** Over the 7 days after launch:
- Fewer than **1 in 10** Heard once ideas get kept. More than that means the rule hides too much.
- Of the ideas that do reach the garden, Tarik dismisses fewer than **1 in 4**.

```sql
-- Ideas created since launch: how many stayed quiet, how many grew out of it, how many were kept.
select count(*) as created,
  count(*) filter (where idea_is_quiet(id)) as still_quiet,
  count(*) filter (where kept_at is not null) as kept,
  count(*) filter (where mention_count >= 2) as recurred
from idea_clusters where created_at >= '<launch date>';

-- Ideas that reached the garden since launch, and how many he dismissed.
select count(*) as reached, count(*) filter (where stage = 'dismissed') as dismissed
from idea_clusters
where created_at >= '<launch date>' and (mention_count >= 2 or kept_at is not null or pinned
  or exists (select 1 from idea_mentions m where m.cluster_id = idea_clusters.id
    and (m.source <> 'ambient' or m.deliberate_key is not null or m.bee_journal_id is not null)));
```

**What actually happened:**
