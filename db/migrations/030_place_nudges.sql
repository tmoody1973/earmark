-- One row per place per local day; each row is its own entity for the nudge's Bee todo (bee_sync entity_id = id),
-- so forgetting a rec can find every day's todo, not just the latest.
create table place_nudges (
  id bigserial primary key,
  recommendation_id bigint not null references recommendations(id) on delete cascade,
  nudged_on date not null,          -- local (America/Chicago) date; FR-16: at most one nudge per place per day
  bee_todo_id bigint,
  unique (recommendation_id, nudged_on)
);
