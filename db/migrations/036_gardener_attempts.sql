-- Gardeners hardening (M5-T12 fix round). Additive only.
-- last_attempt_at: when a run last claimed the gardener (atomic claim; also the retry backoff clock).
-- fail_count: failed attempts in the current period; reset on success. Pausing uses the existing `enabled` column (032).
alter table gardeners add column if not exists last_attempt_at timestamptz;
alter table gardeners add column if not exists fail_count int not null default 0;
