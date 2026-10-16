create extension if not exists vector;

create or replace function word_count(t text) returns int
language sql immutable as $$
  select coalesce(array_length(regexp_split_to_array(btrim(t), '\s+'), 1), 0)
$$;

create table recommenders (
  id bigserial primary key,
  first_name text not null,
  first_name_key text generated always as (lower(first_name)) stored unique,
  recs_given int not null default 0,
  recs_tried int not null default 0,
  recs_loved int not null default 0,
  created_at timestamptz not null default now()
);

create table idea_clusters (
  id bigserial primary key,
  title text not null,
  summary text,
  timeline jsonb not null default '[]'::jsonb,
  centroid vector(1536),
  stage text not null default 'compost'
    check (stage in ('compost','sprouting','ready','drafted','used','dismissed')),
  pinned boolean not null default false,
  mention_count int not null default 0,
  first_mentioned_at timestamptz,
  last_mentioned_at timestamptz,
  draft_md text,
  draft_format text check (draft_format in ('newsletter_pitch','radio_segment','product_brief')),
  bee_fact_id bigint,
  notion_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idea_clusters_centroid_idx on idea_clusters using hnsw (centroid vector_cosine_ops);

create table idea_mentions (
  id bigserial primary key,
  cluster_id bigint not null references idea_clusters(id) on delete cascade,
  bee_conversation_id bigint,
  bee_journal_id text,
  excerpt text not null check (word_count(excerpt) <= 25),
  embedding vector(1536),
  spoken_at timestamptz not null,
  confidence real not null,
  review_status text not null default 'accepted'
    check (review_status in ('accepted','needs_review','dismissed')),
  source text not null check (source in ('ambient','voice','photo','song','email')),
  created_at timestamptz not null default now()
);
create index idea_mentions_cluster_idx on idea_mentions (cluster_id);

create table recommendations (
  id bigserial primary key,
  type text not null check (type in ('album','artist','song','book','place','podcast','film_tv','other')),
  raw_text text not null,
  canonical_name text not null,
  creator text,
  year_or_address text,
  image_url text,
  links jsonb not null default '{}'::jsonb,
  context_summary text,
  apple_music_id text,
  added_to_playlist_at timestamptz,
  recommender_id bigint references recommenders(id) on delete set null,
  attribution_source text not null default 'none'
    check (attribution_source in ('voice_trigger','second_person','summary','slack','email','none')),
  excerpt text not null check (word_count(excerpt) <= 25),
  bee_conversation_id bigint,
  bee_journal_id text,
  bee_todo_id bigint,
  said_at timestamptz not null,
  lat double precision,
  lng double precision,
  source text not null check (source in ('ambient','voice','photo','song','email')),
  status text not null default 'new'
    check (status in ('needs_review','new','queued','tried','thanked','dismissed','composted')),
  rating text check (rating in ('loved','fine','not_for_me')),
  last_surfaced_at timestamptz,
  confidence real not null,
  embedding vector(1536),
  notion_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recommendations_status_idx on recommendations (status);
create index recommendations_embedding_idx on recommendations using hnsw (embedding vector_cosine_ops);

create table photos (
  id bigserial primary key,
  recommendation_id bigint references recommendations(id) on delete cascade,
  taken_at timestamptz not null,
  lat double precision,
  lng double precision,
  linked_bee_conversation_id bigint,
  thumbnail_url text,
  deleted_at timestamptz
);

create table spaces (
  id bigserial primary key,
  name text not null,
  rule_sentence text not null,
  published_token text unique,
  created_at timestamptz not null default now()
);

create table space_items (
  space_id bigint not null references spaces(id) on delete cascade,
  item_type text not null check (item_type in ('idea','rec')),
  item_id bigint not null,
  confidence real not null,
  primary key (space_id, item_type, item_id)
);

create table links (
  from_type text not null check (from_type in ('idea','rec','recommender','moment')),
  from_id text not null,
  to_type text not null check (to_type in ('idea','rec','recommender','moment')),
  to_id text not null,
  kind text not null check (kind in ('related','fits','merge_suggestion','source')),
  confidence real not null,
  status text not null default 'suggested' check (status in ('suggested','accepted','removed')),
  primary key (from_type, from_id, to_type, to_id, kind)
);

create table rec_receipts (
  id bigserial primary key,
  recommendation_id bigint not null references recommendations(id) on delete cascade,
  message text not null,
  share_token text not null unique,
  approved_at timestamptz,
  sent_via text check (sent_via in ('text','link')),
  bee_todo_id bigint,
  alarm_at timestamptz
);

create table fact_proposals (
  id bigserial primary key,
  text text not null,
  kind text not null check (kind in ('taste','idea')),
  evidence_ids jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  bee_fact_id bigint
);

create table bee_sync (
  entity_type text not null,
  entity_id bigint not null,
  bee_object text not null check (bee_object in ('todo','fact')),
  bee_id bigint not null,
  last_written_state jsonb,
  last_synced_at timestamptz not null default now(),
  primary key (entity_type, entity_id, bee_object),
  unique (bee_object, bee_id)
);

create table music_auth (
  id smallint primary key default 1 check (id = 1),
  user_token_enc text not null,
  playlist_id text,
  updated_at timestamptz not null default now()
);

create table episodes (
  id bigserial primary key,
  week_of date not null unique,
  script_md text not null,
  audio_url text,
  duration_sec int,
  published_at timestamptz
);

create table processed_conversations (
  bee_conversation_id bigint primary key,
  processed_at timestamptz not null default now(),
  idea_count int not null default 0,
  rec_count int not null default 0
);

create table processed_journals (
  bee_journal_id text primary key,
  processed_at timestamptz not null default now(),
  item_type text not null check (item_type in ('idea','rec','none')),
  item_id bigint
);

create table bee_conversation_map (
  conversation_uuid text primary key,
  bee_conversation_id bigint not null unique,
  seen_at timestamptz not null default now()
);

create table utterance_buffer (
  id bigserial primary key,
  conversation_uuid text not null,
  speaker text not null,
  text text not null,
  received_at timestamptz not null default now(),
  triaged boolean not null default false
);
create index utterance_buffer_conv_idx on utterance_buffer (conversation_uuid, id);

create table schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
