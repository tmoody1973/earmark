# 041 — Top of Mind: five pins, and a pin's Bee fact waits behind the Bee switch

**Decision:** Tarik can pin up to **5** ideas to Top of Mind (FR-35) from the idea page. A pinned idea comes first in the garden. A new mention matches it more easily and is offered to the matching step even when the idea is just outside the 5 closest ones. The garden marks it "New mention" until he opens it. Pinning also queues one **pending** Bee fact ("Developing an idea: …"), but only while the Bee write switch (`BEE_TODO_WRITES`) is on. The weekly fact job posts it to Bee as an *unconfirmed* fact. Nothing in the pin calls Bee.

**Why this came up:** The PRD asks for three things on a pin: a lower match threshold, an immediate flag, and a pending Bee fact. It does not say how many pins, or how a pin reaches Tarik's real Bee account. Bee writes are the riskiest thing Earmark does. Every todo write already sits behind one switch, but the weekly fact job (built in M5) does not check that switch. If a pin queued a fact with no check, a tap in the garden could end up in Bee even after Tarik turned Bee writes off.

**Options:**
1. **Cap at 5; queue the fact only while the switch is on** (chosen). Cost: a fact queued while the switch was on still posts on Monday if the switch is turned off in between. The weekly job itself is still unswitched.
2. **No cap; queue the fact always** (the brief as written). Cost: "top of mind" stops meaning anything once 20 ideas are pinned, and a pin writes to Bee whatever the switch says.
3. **Put the whole weekly fact job behind the switch.** Cost: it changes lane C's shipped job, so taste facts and bloomed-idea facts would also stop whenever todos are switched off. That is a product call for Tarik, not a side effect of this task.

**What we chose and why:** Option 1 (Claude). Five is about what a person can actually hold in mind. At the cap, a sixth pin is refused with "Top of Mind holds 5 ideas. Unpin one to make room.", and nothing changes. The fact is never queued for an idea whose title names Tarik or a recommender (facts describe only Tarik), never for an idea already linked to a Bee fact, and never twice for one idea. That includes a fact Tarik already deleted in Bee: it is not proposed again. Unpinning removes the queued fact, unless the weekly job has already claimed it or posted it. A dismissed idea can't be pinned. No new table or column: `pinned` and `flagged_at` already existed.

**What we gave up:** A queued fact can outlive the switch, as described under option 1. The cap is checked in the same database statement, not with a lock, so two pins tapped at the same instant at 4 could make 6. The flag marks a mention *joining* a pinned idea. It does not say which mention or what was said.

**How we'll know if this was right:** After two weeks, count the pins. If Tarik hits the cap and unpins to make room, five is right. If he never gets past two, the pin is rarely worth the tap. If a pinned idea he mentions is still split into a new idea, the 0.4 threshold or the 0.5 distance is too strict. If he asks for the weekly job to stop when todos are off, build option 3.

**What actually happened:**
