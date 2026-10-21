# 062 — When Earmark isn't sure which one a tip is, it asks on the wrist

**Decision:** When the background agent leaves a tip asking "Which one?" (it kept options but couldn't choose), it makes one Bee todo, "Is this <first option>? Confirm in Earmark", with a link to the tip. Answering on the tip's page completes the todo.

**Why this came up:** Decision 048 gave Tarik a "Which one?" question on each unsure tip, and decisions 051 and 059 made the agent far better at producing options (the second look, the web find that pinned Diaspora Sports Bar and Lounge by its address). But the question only exists on a page he has to remember to open. On Oct 21 Tarik asked for the agent to be more proactive, and a question that sits unseen is the opposite. If we got it wrong, either unsure tips stay unanswered for weeks, or the wrist gets spammed with questions.

**Options:**
1. **One todo per unsure tip, made by the agent's regular pass, completed when answered** (chosen). Cost: it reuses Bee's shared limit of 10 open Earmark todos, so a busy week can crowd out other todos, and an answer given in the app shows as "done" in Bee up to ten minutes late if the immediate update fails.
2. **A daily digest todo ("3 tips need a look").** Cost: it doesn't say what the question is, so it can't be answered from the wrist, and it adds a second kind of todo to keep in sync.
3. **Leave it on the page, and add a badge there.** Cost: nothing reaches him; he has to come looking, which is the problem we started with.

**What we chose and why:** Option 1. Tarik asked for proactive features; Claude built this one. Reusing the same todo machinery as place nudges and thank-you reminders (its kill switch, its limit of 10, its link back to the tip) meant no new way for Bee todos to go wrong. The words in the todo are the first option's name only, which comes from a catalog or a web page title, never what anyone said and never a person's name. Rules we kept: one todo per tip, ever (if the options change, the same todo's text is updated in place); none when he searched himself (he is already on the page); a full list, a switched-off Bee, or a busy moment just skips it quietly and the tip is untouched.

**What we gave up:** The todo names only the first option, so a tip with three good options looks more certain than it is until he opens the page. If he checks the todo off in Bee without answering, the question stays open on the page and no second todo is made. If he checks the todo off and the options then change, the refresh can't reopen it, so there is a small chance of a second todo for that tip.

**How we'll know if this was right:** Over two weeks, count the "Which one?" todos made versus answered on the page within a day. If fewer than half are answered that fast, the wrist isn't helping and this is noise. Also watch whether the 10-open limit is ever hit while one of these is waiting.

**What actually happened:**
