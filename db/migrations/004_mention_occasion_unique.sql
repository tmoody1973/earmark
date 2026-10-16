-- One mention per occasion (M2-T4 fix round 1). Additive only.
-- An idea cluster gets at most one mention from a given Bee conversation and at most one from a given voice note,
-- so "the third mention" always means a third separate occasion. planIdeaClusters already skips repeats; these
-- indexes make the database refuse one that slips through, failing (and rolling back) the whole save transaction.
-- Checked before applying: no duplicates on prod or the test branch (2026-10-16).
create unique index if not exists idea_mentions_cluster_conversation_uniq
  on idea_mentions (cluster_id, bee_conversation_id) where bee_conversation_id is not null;
create unique index if not exists idea_mentions_cluster_journal_uniq
  on idea_mentions (cluster_id, bee_journal_id) where bee_journal_id is not null;
