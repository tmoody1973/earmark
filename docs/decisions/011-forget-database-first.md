# 011 — `pnpm forget` clears Earmark's own copy first, then the copies in other apps

**Decision:** When Tarik forgets an item, every row Earmark itself holds about it is deleted in one database transaction (all of it or none of it), and only after that commits does the command delete the copies in Bee, Notion and Vercel Blob. Anything that fails out there is listed by id and the command ends with an error.

**Why this came up:** FR-30 promises one command that deletes a tip or an idea everywhere: the 25-word excerpt, the recommender's first name, the Bee to-do, the Notion page, the photo thumbnail. The plan's first draft (and the PostHog bot's draft, PR #8) did it the other way round: outside apps first, and if any failed, the database was left untouched so the same command could simply be run again. The controller's binding rule for this task reversed that order. What is at stake is what happens when Bee or Notion is down at the moment Tarik asks to forget something.

**Options:**
1. **Outside apps first, database last** (the plan's draft). Cost: if Bee is down, Earmark keeps the excerpt and the name until Bee comes back, and the item stays fully visible in Earmark although Tarik asked for it to be gone.
2. **Database first in one transaction, outside apps after** (chosen). Cost: once the database has committed, Earmark no longer knows which Bee to-do or Notion page belonged to the item, so re-running the command cannot retry a failed outside delete; Tarik has to remove the listed ids by hand.
3. **Database first, plus a queue of pending outside deletes that is retried later.** Cost: a new table and a retry job, kept forever for a case that has not happened yet.

**What we chose and why:** Option 2 (the controller's binding rule; Claude implemented it). Earmark's own copy is the one Tarik controls and the one the web app shows, so it goes first and goes completely: a half-deleted item is never left behind. Outside failures are not swallowed: each one is printed with its id and the error's type (never the error text, which could echo what was said), and the command exits with an error. A 404 ("not found") counts as already gone. Notion and Blob are not set up yet (no `NOTION_TOKEN` or `BLOB_READ_WRITE_TOKEN`); if an item ever has a Notion page or a thumbnail without those, the step is skipped, said so, and counted as not done.

Other rules decided with it:
- `pnpm forget rec 42` only shows what would go (ids and table counts) inside a read-only transaction; `--yes` deletes.
- The recommender's first name is deleted with their last recommendation (with any links to them); otherwise their counts are recalculated.
- Forgetting a mention also removes its line from the idea's timeline and recalculates the idea's count, dates, stage and "centre" (the average meaning used to match new mentions). Forgetting an idea's last mention forgets the whole idea.
- The rows that record "this Bee conversation was already processed" are kept: they hold only ids, and deleting them would let the nightly pass save the same tip again from the same conversation.
- Other milestones' stores (weekly episodes, gardener drafts) plug in through a list of extra steps (`agent/lib/privacy/forget-hooks.ts`) that run after the commit and report the same way.

**What we gave up:** Automatic retry of a failed outside delete (option 3). Also, an idea's title, summary and one-pager draft are written by a model from all its mentions; forgetting one mention does not rewrite them, so words from that mention can survive there until the idea is redrafted or forgotten as a whole.

**How we'll know if this was right:** Count the forget runs that end with "not done" lines. If any happen in practice (Bee or Notion down, or an id deleted by hand that turns out to be wrong), build option 3. If none happen by the end of M6, option 2 was enough.

**What actually happened:**
