-- M3-T4b: a one-line Wikipedia note on a tip's subject (the artist, author, place, show), with its source. Additive
-- only. Idempotent. about_at: when the rec lane finished looking (null = not yet): set on a note, on "unsure", or after
-- about_tries reaches 3 failed lookups (errors, timeouts; a 503/429 is not counted) (decision 017).
-- Columns on the recommendations row, so forgetting a tip deletes its note with it.
alter table recommendations
  add column if not exists about text,
  add column if not exists about_url text,
  add column if not exists about_at timestamptz,
  add column if not exists about_tries smallint not null default 0;
