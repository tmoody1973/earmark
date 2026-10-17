-- Live bloom (M2-T6). Additive only.

-- One row per idea mention ('mention') or per mention that moved its cluster to 'ready' ('bloom'). Written only by
-- buildSaveQueries, in the same statement as the mention, so an event exists exactly when its mention committed.
-- The garden polls them by time (GET /api/garden/blooms?since=).
create table garden_events (
  id bigserial primary key,
  kind text not null check (kind in ('mention', 'bloom')),
  cluster_id bigint not null references idea_clusters(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index garden_events_created_idx on garden_events (created_at);

-- Occasion identity across the live stream and the completed pass. The stream names a conversation by uuid, REST by
-- numeric id (bee_conversation_map links them). A live mention stores the uuid; the save fills whichever form is
-- missing from the map, and this index (with 004's (cluster_id, bee_conversation_id)) refuses a second mention of the
-- same conversation on one cluster in either form. Existing rows have no uuid, so no duplicates are possible.
alter table idea_mentions add column bee_conversation_uuid text;
create unique index idea_mentions_cluster_uuid_uniq
  on idea_mentions (cluster_id, bee_conversation_uuid) where bee_conversation_uuid is not null;

-- Done-lease claims on buffered utterances (like processed_conversations): claimed_at marks a live window claim in
-- progress; the existing `triaged` column is its done flag, set in the save transaction. An unfinished claim older
-- than the 15-minute lease may be re-taken.
alter table utterance_buffer add column claimed_at timestamptz;
