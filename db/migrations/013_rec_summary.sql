-- M3-T5: when the rec lane wrote a tip's "why" (context_summary). Additive only. Idempotent.
-- null = not asked yet. A tip whose conversation gave no reason keeps context_summary null but gets summarized_at, so
-- it is asked once, never again (null, never filler). Summaries already written (seeded, hand-written) count as done.
alter table recommendations add column if not exists summarized_at timestamptz;
update recommendations set summarized_at = now() where context_summary is not null and summarized_at is null;
