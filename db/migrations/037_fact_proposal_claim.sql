-- Bee fact proposals idempotency (M5-T7 fix). Additive only.
-- write_started_at: when a run last claimed this proposal to post it to Bee (atomic claim; a claim older than 15 minutes
-- may be retaken, after first reconciling against Bee's unconfirmed facts so a post that landed is never repeated).
alter table fact_proposals add column if not exists write_started_at timestamptz;
