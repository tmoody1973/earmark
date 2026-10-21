# 061 — Earmark researches an idea by itself when it blooms

**Decision:** When an idea blooms (it has been mentioned a third time, on separate occasions, so the garden marks it "ready"), Earmark asks for the same web research it already does on request (decision 057), without Tarik having to say "include research" or press Research this. The one-page draft is still written immediately; the research arrives a few minutes later and buzzes his wrist once: "'<idea>' bloomed: draft and research ready".

**Why this came up:** Tarik asked for proactive features on Oct 21. A bloom is the moment an idea has proved itself: he has come back to it three times. It is also the moment he is most likely to want to know who already does it, and today he only gets that if he remembers to ask. What is at stake if we get it wrong: a research request on every bloom spends free-but-limited TinyFish reads (12,000 searches and 1,000 page reads a day) and buzzes his wrist, so a duplicate request or a buzz for nothing is a real annoyance.

**Options:**
1. **Request research at the moment of the bloom, run it on the next background pass** (chosen). The draft stays instant (the live moment in the demo video stays fast); research follows within about 10 minutes. Cost: the draft is written without the research, so it has no "what already exists" paragraph.
2. **Wait for the research, then write the draft once, using it.** The draft is better informed. Cost: the bloom moment now takes a minute or more instead of seconds, and a TinyFish outage would delay the draft too.
3. **Write the draft right away and rewrite it when the research lands.** Best of both. Cost: a second model call per bloom, and a draft that changes under Tarik after he has read it. More moving parts than a first version needs.

**What we chose and why:** Option 1. Tarik asked for proactive features; Claude built this and chose the shape. The draft is not rewritten when research lands later; the brief shows under the draft on the idea's page. (This is a change from decision 057, which said a draft written after a brief would use it: that still holds when the owner asked for research before the idea bloomed, but a bloom-triggered request always lands after the draft.) How it works:
- **Where a bloom is caught.** In two places that already draft: the save that blooms the idea (right after its one-page draft), and the 10-minute catch-up that drafts any bloomed idea still without a draft. The second covers blooms the first never sees: an idea that blooms because two ideas were merged, a backfill, or a draft that failed the first time.
- **Once per idea, ever.** Before asking, Earmark checks whether the idea already has a research record, of any kind. If Tarik already asked for research (voice or button), or research ran, finished or is waiting, nothing new is requested. A later mention of an already-bloomed idea is not a bloom, so it never asks. The existing "not within 10 minutes of the last request" rule stays as the second lock.
- **Off without a key.** With no `TINYFISH_API_KEY`, nothing is requested at all, so no waiting requests pile up and then all fire the day a key is added.
- **Never breaks the save.** If the request fails, it is logged (idea id and error name only) and the save carries on.
- **The wrist buzz.** The existing research todo, with its text changed when the idea is at or past bloom: "'<idea>' bloomed: draft and research ready", then the one-line takeaway if the brief has one. It is built from the same derived words as before (the idea's title and the brief's takeaway), never what was said, with the same length limits. It follows the same `BEE_TODO_WRITES` switch and 10-open-todo cap as every Earmark todo.

**What we gave up:**
- The one-page draft does not contain the research. If the research finds that the idea already exists as a product, the draft will not say so until Tarik reads the brief beside it.
- Ideas that bloomed before today get no automatic research (only new blooms ask); he can still press Research this on them.
- A merge that blooms an idea is noticed by the 10-minute catch-up, not instantly, so that research starts up to 10 minutes later than a voice bloom.
- If research already ran before the bloom (an old brief from before the third mention), it is not refreshed at bloom, even if that brief is weeks old. Research again is still manual.
- Every bloom now uses a small share of the daily TinyFish allowance.

**How we'll know if this was right:** The database shows which ideas got research on their own: any idea whose research was requested within a minute of its bloom event.

```sql
select c.id, c.title, e.created_at as bloomed_at, r.requested_at, r.status, r.attempts
from garden_events e
join idea_clusters c on c.id = e.cluster_id
left join idea_research r on r.cluster_id = c.id
where e.kind = 'bloom'
order by e.created_at desc;
```

It is working if every bloom since this shipped has exactly one research row, most end `done` on the first try, and Tarik opens the brief next to the draft. It is wrong if blooms regularly have no row while the key is set, or if the buzz arrives for ideas he does not care about (then ask on bloom only for ideas he pinned or mentioned in the last month).

**What actually happened:**
