-- M3-T4: the rec lane's bookkeeping (decision 013). Additive only.
-- enrichment_status: pending (waiting for the sweep) → matched | no_match (done) | failed (gave up after N attempts).
-- Every new tip starts pending, so capture paths need no extra call; runRecLane(id) only pulls enrich_next_at to now.
alter table recommendations
  add column if not exists enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'matched', 'no_match', 'failed')),
  add column if not exists enrich_attempts smallint not null default 0,
  add column if not exists enrich_next_at timestamptz not null default now(),
  add column if not exists enriched_at timestamptz;

-- Tips that already carry links (seeded or captured with them) count as enriched; the sweep leaves them alone.
update recommendations set enrichment_status = 'matched' where links <> '{}'::jsonb and enrichment_status = 'pending';

create index if not exists recommendations_enrich_due_idx
  on recommendations (enrich_next_at, id) where enrichment_status = 'pending';
