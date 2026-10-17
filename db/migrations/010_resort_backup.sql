-- Reversible re-sort (M2-T10b, decision 010). Additive only.
-- One row per row the re-sort changed: a recommendation's status, an idea mention's review_status, or an idea
-- cluster's stage (old_status/new_status hold the stage; its count is reversed from the restored mentions).
-- `pnpm resort --undo <run_id>` puts old_status back where the row still holds new_status.
create table if not exists resort_backup (
  run_id text not null,
  table_name text not null check (table_name in ('recommendations', 'idea_mentions', 'idea_clusters')),
  row_id bigint not null,
  old_status text not null,
  new_status text not null,
  confidence real,
  created_at timestamptz not null default now(),
  primary key (run_id, table_name, row_id)
);
