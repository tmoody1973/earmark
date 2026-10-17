-- M4-T6, automatic backlinks (FR-38). Additive only.
-- links.judged_at: when Jev last judged this pair. A pair is asked again only when one side changed after that
-- (its updated_at moved past judged_at) and Tarik has not accepted or removed the link (decision 026).
alter table links add column if not exists judged_at timestamptz;

-- One row per merge of two ideas, so a merge can be undone exactly (decision 027): which mentions moved, and what
-- both ideas looked like before. `token` keys the statements of one merge transaction together.
create table if not exists idea_merges (
  id bigserial primary key,
  token uuid not null unique,
  keep_id bigint not null references idea_clusters(id) on delete cascade,
  merged_id bigint not null references idea_clusters(id) on delete cascade,
  mention_ids bigint[] not null,
  keep_before jsonb not null,
  merged_before jsonb not null,
  merged_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists idea_merges_keep_idx on idea_merges (keep_id) where undone_at is null;
create index if not exists idea_merges_merged_idx on idea_merges (merged_id) where undone_at is null;
