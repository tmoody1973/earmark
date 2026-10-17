-- M4-T7 fix round (decision 028): a Jev call that failed leaves a row with no answer (confidence null) and judged_at
-- now, so the pair is retried after a back-off instead of sitting first and burning a call every run. Relaxes a
-- constraint only; every existing row keeps its confidence.
alter table space_items alter column confidence drop not null;
