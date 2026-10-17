-- Idea compost (M2-T4). Additive only: one function, no table changes.
-- The stage rule used by the save statement when a mention joins a cluster, evaluated on the row's own count so
-- concurrent saves cannot disagree. Mirrors stageFor() in agent/lib/ideas/stage.ts (an integration test keeps them equal):
-- drafted, used and dismissed never move; otherwise 3+ mentions = ready, 2 = sprouting, else compost.
create or replace function idea_stage_for(cur_stage text, n int) returns text
language sql immutable as $$
  select case
    when cur_stage in ('drafted', 'used', 'dismissed') then cur_stage
    when n >= 3 then 'ready'
    when n = 2 then 'sprouting'
    else 'compost'
  end
$$;
