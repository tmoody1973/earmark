-- M3-T4b: a one-line Wikipedia note on a tip's subject (the artist, author, place, show), with its source. Additive
-- only. Idempotent. about_at: when the rec lane looked (null = not yet); looked once, found or not (decision 017).
-- Columns on the recommendations row, so forgetting a tip deletes its note with it.
alter table recommendations
  add column if not exists about text,
  add column if not exists about_url text,
  add column if not exists about_at timestamptz;
