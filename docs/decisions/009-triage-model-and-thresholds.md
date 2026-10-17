# 009 — Triage stays on Jev, with work-talk rules and tighter confidence lines

**Decision:** Triage keeps running on Jev 1.13 (`typesafe-ai/jev-1.13.0`). Its instructions now say plainly that naming a tool, company or product while talking about work is not a recommendation. Proposing something to make or air is still an idea, and telling a colleague to try something is still a recommendation. An item is auto-accepted only when Jev is more than 90% sure (was 85%). It is dropped when Jev is under 60% sure (was 50%). Anything in between goes to review; a review-band tip waits in the Maybe? row for Keep / Not a tip (decision 025), and a review-band idea shows in the garden as unconfirmed.

**Why this came up:** Every stretch of conversation Bee records passes through this gate. Too loose, and the garden fills with things nobody recommended. Too strict, and real tips disappear.

The PRD (the product requirements document) set targets of 85% precision for recommendations and 75% for ideas. Precision means: of the things Earmark files as a recommendation, how many really were one.

The first eval ran on 48 of Tarik's real conversation snippets, labeled by hand (2026-10-17). Jev was far below both targets. The biggest single failure was work talk. When colleagues discussed tools, companies or plans, Jev read "naming a thing" as "recommending a thing". On the snippets Tarik labeled as neither a recommendation nor an idea, it was right only 16% of the time: it called 30 runs a recommendation and 22 an idea. Jev's own documentation says it reads instructions literally. So the fix belongs in the wording first, and only then in the numbers.

**Options:**
1. **Fix the wording, keep Jev, tune the lines from the eval.** Add exact conditions and made-up boundary examples to the instructions, re-run the eval, then pick the lines. For example, "we exported the chart from Datawrapper" is neither, while "you should make your charts in Datawrapper" and a colleague's "you have to try the new ramen place" are recommendations. Cost: about 4 cents of model calls per run. Lines picked from 48 snippets can also be wrong for new kinds of conversation.
2. **Switch to OpenAI Decisions** (`openai/gpt-6-luna-decisions`). It is much better at leaving work talk alone: 73% right before the wording change, 86% after. Cost: it is worse at the thing that matters. After the change, it got 5 of 12 idea calls right, against Jev's 15 of 28. Its single recommendation call was right, but it made only one in 144 answers. Each call costs about 2.4 times as much. That is pennies either way, so cost did not decide this.
3. **Keep the PRD's starting lines (85% / 50%) and change nothing.** Cost: there is no measurement behind them. The eval also shows that Jev's recommendation and idea calls under 60% sure were almost all wrong.

**What we chose and why:** Option 1. Claude decided from the eval data; Tarik is informed.

The wording went through two rounds. The second round answered a review.

| Jev, 48 snippets × 3 option orders | Before | Round 1 | Round 2 (shipped) |
|---|---|---|---|
| Overall accuracy | 53.5% | 69.4% | 66.7% |
| Work talk left alone | 16% | 49% | 38% |
| Idea calls right, all confidences | 15 of 37 | 12 of 22 | 15 of 28 |
| Real idea runs Jev called an idea | 15 of 15 | 12 of 15 | 15 of 15 |
| Real idea runs kept (60% sure or more) | – | 11 of 15 | 14 of 15 |
| Real idea runs auto-accepted (over 90% sure) | – | 0 of 15 | 0 of 15 |
| Calibration error (ECE) | 0.18 | 0.09 | 0.12 |

ECE measures how far stated confidence drifts from how often Jev is actually right; 0 is perfect.

Round 1 cut false ideas but lost 3 of the 15 real idea runs. Round 2 got them back by saying that a proposal naming what to make or air is an idea, not work talk. In exchange, more work talk slipped through again (38% left alone instead of 49%).

Decisions does not beat Jev on both recommendation and idea precision, which was the bar for switching. So Jev stays.

The lines:
- **Drop below 0.6.** This is the best-supported number in the eval. Jev's recommendation or idea calls under 60% sure were right 1 time in 14 in round 2, 1 in 21 in round 1, and 0 in 36 before the change. Three runs agree.
- **Auto-accept above 0.9.** Above 0.9, nearly all of Jev's answers are right, but almost all of them are "neither". For real recommendations and ideas, only 2 answers landed above 0.9 in round 2, and 1 of those 2 was right. That is far too few to measure. The tuning helper (`pnpm eval:tune`) found no line that meets both targets, so it fell back to 0.95. We kept 0.9 because nothing in this data separates 0.9 from 0.95. A wrong auto-accept looks confirmed in the garden; a wrong review item waits in the Maybe? row for Keep / Not a tip (decision 025), or, for an idea, is clearly marked as unconfirmed (decision 004).

**What we gave up:**
- **Ideas almost never auto-accept.** In this eval no real idea run scored above 0.9; they mostly scored 0.6 to 0.9. Review-band ideas still count toward a bloom (decision 004), so the garden still grows, but more of it says "unconfirmed".
- **Some real ideas are lost at the drop line.** In round 2, 1 of the 15 real idea runs scored 0.58 and is dropped. The same snippet scored 0.60 and 0.77 on its other two runs.
- **Review-band recommendations are mostly wrong.** Of Jev's recommendation calls at 0.6 or above, only 3 of 14 were right, and all 3 were the same snippet. The review queue will carry many "recommendations" that are really work talk. This is a stated risk.
- **The work-talk gain may be overfitted.** Overfitting means fitting the test so closely that the result won't repeat on new data. The made-up boundary examples were written from the pattern of mistakes in these same 48 snippets. The work-talk improvement therefore needs fresh labels before anyone trusts it.
- **Too few positives to measure precision.** Only one of the 48 snippets is a real recommendation to Tarik, and only five are ideas. The precision figures are anecdotes, not measurements. The lines may not hold for other rooms or other speakers.
- **Option-order flips miss the target.** The flip rate is how often Jev's answer changes when the options are shuffled. It went from 15% to 17% to 12.5% across the three runs, against a 10% target. Each step is a change of one snippet, so it is within noise.
- **"Earmark that…" side effect.** A deliberate earmark (decision 007) is always saved: anything Jev does not call an idea is filed as a recommendation. The new wording says goals and strategy without a specific thing to make are not ideas. So "Earmark that: we need to reach a younger audience" may now file as a recommendation instead of an idea.

**Impact on what is already saved (estimate only, nothing was re-processed):** This estimate re-routes the current production items on their stored confidences alone:
- 7 of 34 recommendations (all now in review) and 17 of 48 idea mentions (all now in review) fall under 0.6 and would be dropped.
- 2 auto-accepted recommendations and 7 auto-accepted idea mentions sit between 0.85 and 0.9 and would move to review.

Re-triaging with the new wording would also change some of the kinds themselves. That cannot be estimated without new model calls on production data, so it was not done. Whether to re-process is Tarik's call.

**How we'll know if this was right:**
1. Label fresh snippets that were not used to write the examples. Re-run `pnpm eval:triage --yes` once there are at least 10 recommendations to Tarik and 10 ideas. The eve gate then grades precision on auto-accepted items only, and needs at least 5 of each before it can pass. Recommendation precision should reach 85% and idea precision 75%. Work talk should stay at 38% left alone or better.
2. Over the first week, fewer than 1 in 5 garden items get dismissed as "not an idea / not a rec" (the PRD success metric).
3. The Slack review queue stays under about 5 items a day. If it is swamped, the 0.9 line is too strict, or work talk is still leaking into the review band.

**What actually happened:**
