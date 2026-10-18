-- The tip page's extras (decision 045): a little more about a matched tip, fetched once by the rec lane and stored here
-- (a 30-second preview URL, a podcast's newest 3 episodes, a YouTube id, a book's description, a longer Wikipedia
-- extract), so the page never fetches anything when it loads. Additive only. Idempotent (numbered 016 to sit beside
-- 014's about note; the migrate script applies any file not yet in schema_migrations, whatever its number).
-- extras_at: when the rec lane finished looking (null = not yet). extras_tries: failed lookups (errors, timeouts; a
-- 503/429 is not counted); the lane stops asking at 3. Columns on the recommendations row, so forgetting a tip deletes
-- its extras with it.
alter table recommendations
  add column if not exists extras jsonb,
  add column if not exists extras_at timestamptz,
  add column if not exists extras_tries int not null default 0;
