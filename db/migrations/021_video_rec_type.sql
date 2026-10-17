-- Video tips: YouTube videos and channels get their own rec type instead of falling back to `other`. Additive only:
-- the check from 001_init.sql is replaced by a wider one, so every existing row still passes.
alter table recommendations drop constraint recommendations_type_check;
alter table recommendations add constraint recommendations_type_check
  check (type in ('album','artist','song','book','place','podcast','film_tv','video','other'));
