-- One-pager drafts (M2-T7). Additive only.
-- A bloomed cluster (stage 'ready', no draft) is drafted after its bloom commits, by whichever runner claims it first:
-- the post-bloom kick in the ingest path or the 10-minute bee-changes schedule tail. The claim follows the done-lease
-- pattern (002): draft_claimed_at marks a run in progress; "done" is draft_md set together with stage 'drafted' in one
-- statement; an unfinished claim older than the lease (a crashed run) may be re-taken. draft_attempts bounds retries.
alter table idea_clusters add column if not exists draft_claimed_at timestamptz;
alter table idea_clusters add column if not exists draft_attempts int not null default 0;
