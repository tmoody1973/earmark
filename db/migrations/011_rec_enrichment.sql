-- M3-T4: the rec lane's bookkeeping (decision 013). Additive only. Idempotent (amended on TEST before prod).
-- enrichment_status: pending (waiting for the sweep) → matched | no_match (done) | failed (gave up).
-- Every new tip starts pending, so capture paths need no extra call; runRecLane(id) only pulls enrich_next_at to now.
-- review_reason: why a tip needs Tarik's eye (reviewReasonFor in agent/lib/recs/lane.ts; M3-T9's Slack cards read it).
-- art_retry_mbid: a matched release group whose Cover Art Archive lookup errored (5xx/timeout); the sweep's tail
-- retries art only, up to 3 tries (art_retries), then clears it.
alter table recommendations
  add column if not exists enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'matched', 'no_match', 'failed')),
  add column if not exists enrich_attempts smallint not null default 0,
  add column if not exists enrich_next_at timestamptz not null default now(),
  -- when the tip (re)entered the queue: the 7-day give-up on 503/429 counts from here, not from created_at, so an old
  -- backlog tip queued today gets its full week. Set again whenever a tip becomes pending (runRecLane, second look).
  add column if not exists pending_since timestamptz not null default now(),
  add column if not exists enriched_at timestamptz,
  add column if not exists review_reason text
    check (review_reason in ('confidence_band', 'no_recommender', 'no_match')),
  add column if not exists art_retry_mbid text,
  add column if not exists art_retries smallint not null default 0;

-- Tips that already carry links (seeded or captured with them) count as enriched; the sweep leaves them alone.
update recommendations set enrichment_status = 'matched' where links <> '{}'::jsonb and enrichment_status = 'pending';

create index if not exists recommendations_enrich_due_idx
  on recommendations (enrich_next_at, id) where enrichment_status = 'pending';
create index if not exists recommendations_art_retry_idx
  on recommendations (id) where art_retry_mbid is not null;
