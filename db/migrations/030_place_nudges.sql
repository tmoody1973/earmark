create table place_nudges (
  recommendation_id bigint not null references recommendations(id) on delete cascade,
  nudged_on date not null,          -- local (America/Chicago) date; FR-16: at most one nudge per place per day
  bee_todo_id bigint,
  primary key (recommendation_id, nudged_on)
);
