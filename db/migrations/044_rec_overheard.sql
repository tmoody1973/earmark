-- "Heard nearby" (decision 052): a tip Earmark overheard with nobody recommending it is saved as 'overheard', a quiet
-- log the owner can keep from or clear (pipeline/save-item.ts recStatusAtSave). Widens the status check from
-- 001_init.sql, whose Postgres-generated name is recommendations_status_check. The new list is a superset, so every
-- existing row passes and nothing is rewritten. Additive only. Idempotent: drop if exists, then add the wider check.
alter table recommendations drop constraint if exists recommendations_status_check;
alter table recommendations add constraint recommendations_status_check
  check (status in ('needs_review','new','queued','tried','thanked','dismissed','composted','overheard'));
