-- "Earmark that" anywhere (M2-T12, MOO-887). Additive only.
-- A deliberate earmark said inside a conversation is identified by its triggered utterance within that conversation
-- (Bee's utterance id, else its position: "u123" / "i4"). Stored on the saved item, with a unique index, so
-- re-processing a conversation (a released claim, a retry) can never save the same earmark twice.
alter table recommendations add column if not exists deliberate_key text;
alter table idea_mentions add column if not exists deliberate_key text;
create unique index if not exists recommendations_deliberate_uniq
  on recommendations (bee_conversation_id, deliberate_key) where deliberate_key is not null;
create unique index if not exists idea_mentions_deliberate_uniq
  on idea_mentions (bee_conversation_id, deliberate_key) where deliberate_key is not null;
