-- "Fix this tip", piece 3 (decision 049): a correction Tarik says out loud ("Earmark, that Sun Raw tip should be Sun Ra")
-- is stored here as a proposal, never applied by itself (Bee mishearing is the very problem). Home shows it with Apply /
-- Ignore; Apply goes through applyTipFix (agent/lib/recs/spoken-fix.ts).
-- name/creator/type: the proposed words, only what was said (a null creator or type stays as the tip has it). Where it
--   was said: bee_conversation_id or bee_journal_id. Never what was said (no transcript, no excerpt).
-- status: pending → applied | ignored. rec_id cascades, so forgetting a tip deletes its proposals.
-- Additive only. Idempotent.
create table if not exists tip_fix_proposals (
  id bigserial primary key,
  rec_id bigint not null references recommendations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  creator text check (char_length(creator) <= 120),
  type text check (char_length(type) <= 120),
  bee_conversation_id bigint,
  bee_journal_id text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'ignored')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists tip_fix_proposals_rec_idx on tip_fix_proposals (rec_id);
