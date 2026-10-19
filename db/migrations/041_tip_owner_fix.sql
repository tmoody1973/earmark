-- "Fix this tip" (decision 049): who wrote a tip's why line (context_summary). 'auto' = the rec lane's why step (M3-T5);
-- 'owner' = Tarik typed it (agent/lib/recs/fix-tip.ts), and it is final: the why step never writes over it. Clearing the
-- note hands it back ('auto'). Every existing why was the lane's, so the default is right for them.
-- Column on the recommendations row, so forgetting a tip deletes it with it. Additive only. Idempotent.
alter table recommendations
  add column if not exists why_source text not null default 'auto' check (why_source in ('auto', 'owner'));
