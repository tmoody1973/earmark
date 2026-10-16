-- M4 garden (lane B): plant flags for the garden view, and a lookup index for backlinks. Additive only.
alter table idea_clusters
  add column if not exists last_surfaced_at timestamptz,
  add column if not exists flagged_at timestamptz,
  add column if not exists last_viewed_at timestamptz;

create index if not exists links_to_idx on links (to_type, to_id);
