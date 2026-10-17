-- M4-T6 fix round 2 (decision 027). Additive only.
-- A moved mention that is the same occasion as one the kept idea has (a live and a completed pass of one conversation)
-- moves dismissed, so the occasion counts once. Its prior review_status is kept here ({"<mention id>": "accepted"}) so
-- undo restores it exactly.
alter table idea_merges add column if not exists twin_statuses jsonb not null default '{}'::jsonb;
