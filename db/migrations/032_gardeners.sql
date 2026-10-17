-- Gardeners (M5-T12, FR-39). Additive only.
-- A gardener is a recurring job described in plain words. A schedule runs the due ones and leaves each result as a
-- draft run for the owner to approve or dismiss. The weekly episode (FR-40) is the first built-in gardener.
create table if not exists gardeners (
  id bigserial primary key,
  name text not null check (length(name) between 1 and 60),
  kind text not null default 'custom' check (kind in ('custom', 'episode')),
  task text not null check (length(task) between 5 and 500),
  schedule jsonb not null, -- {"every":"week","weekday":0-6,"hourUtc":0-23} or {"every":"month","day":1-28,"hourUtc":0-23}
  sources text[] not null check (sources <@ array['ideas','recs','recommenders']::text[] and cardinality(sources) > 0),
  needs_approval boolean not null default true,
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists gardener_runs (
  id bigserial primary key,
  gardener_id bigint not null references gardeners(id) on delete cascade,
  output_md text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'dismissed')),
  episode_id bigint references episodes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists gardener_runs_gardener_idx on gardener_runs (gardener_id, created_at desc);

-- The built-in weekly episode: Sunday 13:00 UTC = 8:00 Central (CDT). Re-running this file adds nothing.
insert into gardeners (name, kind, task, schedule, sources)
select 'Weekly episode', 'episode', 'Write and voice my weekly Earmark recap.', '{"every":"week","weekday":0,"hourUtc":13}', array['ideas','recs','recommenders']
where not exists (select 1 from gardeners where kind = 'episode');
