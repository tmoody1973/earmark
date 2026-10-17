# 022 — The idea page shows unconfirmed mentions and dismissed ideas

**Decision:** An idea's page lists every mention that helped it grow, including the ones Earmark was only moderately sure about. Those are marked "Unconfirmed". A dismissed idea still has its page, shown greyed out. A dismissed *mention* never appears: not its line, not its excerpt.

**Why this came up:** The task plan was written before decision 004. Its draft query showed only *accepted* mentions and returned "not found" for dismissed ideas. Since 004, review-band mentions (Jev's confidence between 0.5 and 0.85) count toward an idea blooming. On Tarik's real data, 31 of 37 mentions are in that band. With the plan's query, most idea pages would say "3 mentions" and then show one, or none. The approved design brief also asks for dismissed ideas to stay visible and restorable.

**Options:**
1. **Accepted mentions only** (the plan as written). Cost: the count in the header and the timeline under it disagree on most real ideas, so the page looks broken. Unconfirmed ideas get an empty "How it grew".
2. **Every mention that counts, unconfirmed ones marked; dismissed mentions hidden.** Cost: an excerpt from a stretch of audio Jev wasn't sure about can appear on the page. It is still capped at 25 words and labelled.
3. **Show every mention, including dismissed ones.** Cost: it shows text Tarik explicitly threw away, which breaks the privacy rule.

**What we chose and why:** Option 2 (Claude, following decision 004 and the approved idea-detail brief). The timeline then matches the count, and "Unconfirmed" stays honest about what nobody has checked. The query never selects a dismissed mention's excerpt (`case when review_status = 'dismissed' then null`), so a dismissed excerpt can't reach the page by accident.

**What we gave up:** Now and then, an unconfirmed excerpt that was really radio chatter shows on an idea page until Tarik dismisses it. The greyed dismissed page has no Restore button yet. No restore action exists, and the page doesn't show controls that do nothing.

**How we'll know if this was right:** In the first week, look for idea pages where the header count and the number of timeline lines differ. There should be none, apart from mentions Tarik dismissed. If unconfirmed excerpts embarrass on screen during the demo, switch to option 1 for excerpts only and keep the lines.

**What actually happened:**
