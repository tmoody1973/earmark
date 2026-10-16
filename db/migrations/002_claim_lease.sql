-- Claim lease (M1 final review): a claim row is "in progress" until the item saves commit with done = true.
-- An unfinished claim older than 15 minutes (crashed or timed-out run) can be re-taken; a done claim never can.
alter table processed_conversations add column done boolean not null default false;
alter table processed_journals add column done boolean not null default false;

-- Rows written before this migration belong to finished runs.
update processed_conversations set done = true;
update processed_journals set done = true;
