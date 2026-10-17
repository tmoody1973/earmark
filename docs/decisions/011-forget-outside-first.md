# 011 — `pnpm forget` clears the copies in other apps first, then Earmark's own rows

**Decision:** When Tarik forgets an item, the command first deletes the copies in Bee, Notion and Vercel Blob. Only if all of them are gone (or were already gone) does it delete every row Earmark holds about the item, in one database transaction (all of it or none of it). If an outside delete fails, it stops before the database and says which id failed, so running the same command again finishes the job.

**Why this came up:** FR-30 promises one command that deletes a tip or an idea everywhere: the 25-word excerpt, the recommender's first name, the Bee to-do, the Notion page, the photo thumbnail. The only record of which Bee to-do or Notion page belongs to an item lives in Earmark's database. So the order matters most on a bad day: Bee or Notion down at the moment Tarik asks to forget something.

**Options:**
1. **Outside apps first, database last** (chosen). Cost: if Bee is down, Earmark keeps the excerpt and the name until the command is run again, and the item stays visible in Earmark meanwhile.
2. **Database first in one transaction, outside apps after.** Cost: once the database commits, Earmark no longer knows which Bee to-do or Notion page belonged to the item, so a failed outside delete cannot be retried by the command; Tarik has to find and remove it by hand, and a missed one stays in Bee forever.
3. **Database first, plus a queue of pending outside deletes retried later.** Cost: a new table and a retry job, kept forever for a case that has not happened yet.

**What we chose and why:** Option 1. Claude first built option 2, following a controller instruction for this task; the controller then reverted that instruction and Claude switched to option 1 (the plan's original order, also used by the PostHog bot's draft, PR #8). The reason for reverting: with option 2 a single network blip leaves a copy of what someone said in Bee or Notion that nothing points to anymore, which defeats "deleted everywhere". With option 1 every failure is safe to retry. The command keeps the references until the very end, deleting something that is already gone counts as success, and a re-run picks up where it stopped. A delay before Earmark's copy disappears is a smaller harm than an orphaned copy elsewhere.

How it behaves:
- `pnpm forget rec 42` only shows what would go (ids and table counts, never text) inside a read-only transaction; `--yes` deletes.
- A failed outside delete is printed by id and error type (never the error text, which could echo what was said); the command exits with an error and the database is untouched.
- Notion and Blob are not set up yet (no `NOTION_TOKEN` or `BLOB_READ_WRITE_TOKEN`). If an item has a Notion page or a thumbnail and the token is missing, the step is reported as skipped and the command stops before the database the same way. With no such reference, nothing is skipped.
- If the database step itself fails after the outside deletes worked, the transaction rolls back completely; a re-run finds the outside copies already gone and finishes.
- The database step re-reads the item with a lock and refuses to delete if a new outside reference appeared since the outside pass (re-run picks it up).
- The recommender's first name is deleted with their last recommendation (with any links to them); otherwise their counts are recalculated.
- Forgetting a mention also removes its line from the idea's timeline and recalculates the idea's count, dates, stage and "centre" (the average meaning used to match new mentions). Forgetting an idea's last mention forgets the whole idea.
- The rows that record "this Bee conversation was already processed" are kept: they hold only ids, and deleting them would let the nightly pass save the same tip again from the same conversation.
- Other milestones' stores (weekly episodes, gardener drafts) plug in through a list of extra steps (`agent/lib/privacy/forget-hooks.ts`) that run after the database commit.

**What we gave up:** Earmark's own copy can outlive the request while an outside service is down. Also, an idea's title, summary and one-pager draft are written by a model from all its mentions; forgetting one mention does not rewrite them, so words from that mention can survive there until the idea is redrafted or forgotten as a whole.

**How we'll know if this was right:** Count forget runs that stop before the database. If they happen and a second run always finishes, option 1 is working. If an outside service stays down long enough that Tarik needs Earmark's copy gone right away, add a "database only" escape hatch.

**What actually happened:**
