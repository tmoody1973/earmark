-- Quiet ideas (decision 055): an idea Earmark overheard only once stays out of every list of ideas until it recurs.
-- It is still saved, clustered and counted; its second occasion makes it sprout and show. Heard once (/heard-once)
-- lists the quiet ones; Keep sets kept_at so one shows now. Additive only: one nullable column, one function.

alter table idea_clusters add column if not exists kept_at timestamptz;

-- Ideas the owner already chose (accepted into a Space, or an accepted link) stay visible: they count as kept.
-- Idempotent: only rows still unkept, and only compost ones (kept_at matters nowhere else).
update idea_clusters c set kept_at = now()
where c.kept_at is null and c.stage = 'compost'
  and (exists (select 1 from space_items si where si.item_type = 'idea' and si.item_id = c.id and si.status = 'accepted')
    or exists (select 1 from links l where l.status = 'accepted'
      and ((l.from_type = 'idea' and l.from_id = c.id::text) or (l.to_type = 'idea' and l.to_id = c.id::text))));

-- The one visibility rule, called by every query that lists ideas (`and not idea_is_quiet(c.id)`). Quiet = still
-- compost with at most one mention, never pinned or kept, and heard only ambiently: at least one mention, and none
-- that was deliberate ("Earmark that": deliberate_key), a voice note (bee_journal_id) or another source. A cluster
-- with no mention rows is not quiet (there is no evidence it was overheard). Dismissed ideas are not quiet; the
-- garden's own `stage <> 'dismissed'` hides them.
create or replace function idea_is_quiet(cid bigint) returns boolean
language sql stable as $$
  select exists (
    select 1 from idea_clusters c
    where c.id = cid and c.stage = 'compost' and c.mention_count <= 1 and not c.pinned and c.kept_at is null
      and exists (select 1 from idea_mentions m where m.cluster_id = c.id)
      and not exists (select 1 from idea_mentions m where m.cluster_id = c.id
        and (m.source <> 'ambient' or m.deliberate_key is not null or m.bee_journal_id is not null)))
$$;
