-- "Find it on the web" (decision 051): when the rec lane last asked the web (TinyFish Search) what a tip the catalogs
-- couldn't match is. Set once the tip has had its one look, whatever was found; null = not asked yet, or a refusal
-- (429/503/402) left it to the next run. An owner's fix with new words clears it (agent/lib/recs/fix-tip.ts).
-- Column on the recommendations row, so forgetting a tip deletes it with it. Additive only. Idempotent.
alter table recommendations
  add column if not exists web_looked_at timestamptz;
