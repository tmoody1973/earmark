-- Email-in idempotency (M5-T13). Additive only.
-- Resend retries a webhook until it gets a 2xx, so each received email is claimed by its Resend id before it is
-- processed: the second delivery of the same id finds the row and does nothing. Only what idempotency needs is kept:
-- the id, timestamps, what happened, and the rec it became. Never the email body, subject or addresses.
-- 'processing' is a lease: a crashed run's claim can be re-taken after 10 minutes (see email-claims.ts); a failed run
-- deletes its own claim so the retry can succeed.
create table if not exists processed_emails (
  email_id text primary key,
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text not null default 'processing'
    check (outcome in ('processing', 'saved', 'duplicate', 'ignored')),
  recommendation_id bigint references recommendations(id) on delete set null
);
