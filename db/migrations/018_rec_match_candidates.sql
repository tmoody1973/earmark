-- "Which one?" (decision 048): keep the provider's candidates so the owner can confirm or correct a tip's match.
-- match_candidates: up to 3 (MAX_CANDIDATES) provider candidates as the lane (or the owner's "Search again") last saw
--   them: { provider, canonicalName, creator, yearOrAddress, detail, imageUrl, links, mbid, releaseGroupId, appleMusicId,
--   lat, lng }. Public catalog data only, never what was said. candidates_at: when they were stored.
-- match_source: who settled the match. 'owner' is final: the rec lane never looks it up or overwrites it again.
-- auto_pick: which candidate Jev picked (match.ts describeCandidate), or 'none' when it abstained; owner_pick: which one
--   the owner chose. Together they measure auto-pick accuracy. owner_none_at: the owner said "None of these".
-- Columns on the recommendations row, so forgetting a tip deletes all of it. Additive only. Idempotent.
alter table recommendations
  add column if not exists match_candidates jsonb,
  add column if not exists candidates_at timestamptz,
  add column if not exists match_source text not null default 'auto' check (match_source in ('auto', 'owner')),
  add column if not exists auto_pick text,
  add column if not exists owner_pick text,
  add column if not exists owner_none_at timestamptz;

