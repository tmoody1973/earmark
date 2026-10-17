# 004 — Review-band ideas count toward the bloom; dismissed stays dismissed

**Decision:** An idea Jev is only moderately sure about (the "review band" — confidence between 0.5 and 0.85) still counts toward that idea blooming. It shows in the garden as **unconfirmed** until Tarik approves one of its mentions. An idea Tarik has dismissed stays dismissed, even when it comes up again.

**Why this came up:** Earmark files every idea it hears into a "compost": a pile where the same idea, mentioned on separate occasions, grows one entry. On the third separate mention it "blooms" (becomes ready for a one-pager). Each mention carries Jev's confidence (Jev is the model that decides whether a stretch of conversation contains an idea). Confident mentions were accepted. The rest waited in a review queue and did not count until Tarik approved them in Slack. On Tarik's real recordings, 27 of 34 ideas landed in that review band. So almost nothing could ever reach three counted mentions, and the lead feature would rarely fire. The second question: when a dismissed idea comes up again, should it start over as a new idea?

**Options:**
1. **Only accepted mentions count** (the old rule). Cost: with real ambient audio, most ideas never bloom unless Tarik works through a review queue first. That breaks "organize nothing".
2. **Review-band mentions count, and the idea is marked unconfirmed until one mention is accepted.** Cost: now and then something that was not really an idea (radio chatter, a half-sentence) helps an idea bloom, a false bloom.
3. **Lower the accept threshold** so more mentions are accepted outright. Cost: the same noise gets in, but it looks confirmed. The garden loses the one signal that says "check this".

For dismissed ideas:
- **(a) A new mention starts the idea fresh.** Cost: an idea Tarik threw away comes back and can bloom again.
- **(b) A new mention attaches to the dismissed idea, which stays dismissed.** Cost: if Tarik dismissed something too early, it cannot come back on its own.

**What we chose and why:** Option 2 and option (b). Tarik's call (2026-10-16), after Claude reported the 27-of-34 figure from the real backfill. Counting review-band mentions keeps the compost doing its job with real, noisy audio. The "unconfirmed" label keeps it honest about which ideas no one has checked. "Unconfirmed" is worked out from the mentions (a cluster is confirmed once any of its mentions is accepted), so no new database column is needed. Dismissed is Tarik's explicit "no", so a repeat should not undo it.

**What we gave up:** Occasional false blooms from ambient noise; Tarik dismisses those. And a dismissed-too-early idea cannot come back on its own; it needs Tarik to un-dismiss it.

**How we'll know if this was right:** Over the first week of use, count blooms that Tarik dismisses as noise. If more than 1 in 5 blooms built only from unconfirmed mentions get dismissed, require one accepted mention before an idea can bloom. Separately, count how often Tarik un-dismisses an idea; any real case means option (b) needs a "this came back" nudge.

**What actually happened:**
