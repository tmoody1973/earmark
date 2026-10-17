-- Add-on (video tips; adapted from bot PR #10, which numbered it 021, in lane B's range): YouTube videos, TikToks and
-- clips get their own rec type instead of falling back to 'other'. Widens the check from 001_init.sql, whose
-- Postgres-generated name is recommendations_type_check (checked on TEST). The new list is a superset, so every
-- existing row passes and nothing is rewritten. Re-runnable: drop if exists, then add the wider check.
alter table recommendations drop constraint if exists recommendations_type_check;
alter table recommendations add constraint recommendations_type_check
  check (type in ('album','artist','song','book','place','podcast','film_tv','video','other'));
