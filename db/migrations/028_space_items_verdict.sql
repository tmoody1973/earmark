-- M4-T7, Smart Spaces (FR-32). Additive only (decision 028).
-- space_items.status: Tarik's keep ('accepted') or remove ('removed') on an item Jev put in a Space; 'suggested' until
-- then. A kept or removed item is never re-judged. judged_at: when Jev last judged the pair; a suggestion is asked
-- again only when the item changed after that (its updated_at moved past judged_at).
alter table space_items
  add column if not exists status text not null default 'suggested' check (status in ('suggested','accepted','removed')),
  add column if not exists judged_at timestamptz not null default now();

-- forget deletes space_items by (item_type, item_id); the primary key leads with space_id
create index if not exists space_items_item_idx on space_items (item_type, item_id);
