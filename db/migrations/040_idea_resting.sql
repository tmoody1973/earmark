-- M4-T8 fix round (decision 029, Tarik's "Rest it"): Serendipity's "Not now" rests an idea instead of dismissing it.
-- The idea stays in the garden and keeps growing on new mentions; Serendipity skips it until resting_until.
-- Additive only: one nullable column, no backfill.
alter table idea_clusters add column if not exists resting_until timestamptz;
