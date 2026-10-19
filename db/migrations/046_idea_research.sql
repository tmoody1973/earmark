-- "Include research" (decision 057): Earmark researches an idea when the owner asks ("…include research" said with
-- "Earmark that", or Research this on the idea page). One row per idea: requested → running (a 15-min lease on
-- started_at) → done | failed; attempts counts the runs that tried it (3, then failed). brief_md is the sourced brief the
-- write model wrote from fetched web pages; sources is [{url, title, site}]. Built from the idea's title and summary only,
-- never what was said. cluster_id cascades, so forgetting an idea deletes its research.
-- Additive only. Idempotent.
create table if not exists idea_research (
  cluster_id bigint primary key references idea_clusters(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'running', 'done', 'failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz,
  attempts int not null default 0,
  brief_md text,
  sources jsonb
);
create index if not exists idea_research_due_idx on idea_research (requested_at) where status in ('requested', 'running');
