# 005 — Catch missed Bee events with a 10-minute "what changed" sync

**Decision:** Every 10 minutes Earmark asks Bee "what changed since last time?" (`/v1/changes`, which returns lists of changed ids plus a bookmark called a cursor) and processes anything the live stream missed.

**Why this came up:** The live stream drops events whenever the relay on Tarik's Mac is off, asleep or disconnected, and Bee never resends them. With only a nightly backfill, a voice note said at 9 am could not show up until the next morning, and the demo depends on items landing in minutes. A second question had to be settled: what should one item that keeps failing do to the bookmark?

**Options:**
1. **Nightly backfill only.** Simplest, but up to a day of delay.
2. **Poll every conversation and voice note every few minutes.** Catches everything, but reads far more data and leans on Bee endpoints that already error on deep pages (bee-cli issue #14).
3. **Ask `/v1/changes` every 10 minutes with a saved cursor.** Small responses, only what changed, and it also reports todo and fact changes that later milestones need. Costs a Vercel Pro team (sub-daily crons) and one small table (`sync_cursors`). Within this option, a failing item can either hold the bookmark back (nothing after it is ever marked done, so one bad item freezes the feed) or let the bookmark move on (the item is left unclaimed and the nightly backfill, which re-reads the last 48 hours, retries it).

**What we chose and why:** Option 3, alongside the nightly backfill and the live stream. Decided by Claude; Tarik had approved the default "/v1/changes cursor sync" at plan time. The bookmark moves forward when the run finished its list, even if individual items failed, because a failed item is released (unclaimed) and the backfill picks it up; holding the bookmark for one bad item would block every later voice note behind it. The bookmark does NOT move when the feed fetch fails, the response does not match the expected shape, a systemic model outage is detected (triage down), anything unexpected is thrown out of the loop, or the run ran out of time before finishing its list (it is replayed next run; every step skips what it already saved).

**What we gave up:** Up to 10 minutes of delay when the relay is down. An item that keeps failing for more than 48 hours falls out of automatic retry (the backfill window), so it would need a manual re-run. The shape of non-empty voice-note, todo and fact lists is unconfirmed: only conversation ids have been seen live, so the parser accepts a bare id or an object with an `id`.

**How we'll know if this was right:** With the relay stopped for an hour, every voice note from that hour still appears in the garden within 10 minutes, exactly once. And `failed` in the `[bee-changes] done` log line stays at or near 0 across a week.

**What actually happened:**
