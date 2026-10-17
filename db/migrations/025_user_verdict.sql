-- M4-T5b, the Maybe? pile (decision 025): Tarik's own Keep / Not a tip on a review-band tip. Additive only.
-- Each verdict is also a label the sorter can learn from later.
alter table recommendations
  add column if not exists user_verdict text check (user_verdict in ('kept','not_a_tip')),
  add column if not exists user_verdict_at timestamptz;
