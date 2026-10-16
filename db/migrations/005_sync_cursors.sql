-- Cursor for the 10-minute Bee /v1/changes sync (M2-T3). Additive only.
create table if not exists sync_cursors (
  name text primary key,
  cursor text not null,
  updated_at timestamptz not null default now()
);
