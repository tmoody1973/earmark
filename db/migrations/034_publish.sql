-- FR-42 (M5-T14): publish a Space as a link-only page. Additive.
alter table spaces add column if not exists indexable boolean not null default false;      -- search indexing is opt-in
alter table spaces add column if not exists published_at timestamptz;
alter table recommenders add column if not exists public_name_consent_at timestamptz;      -- named publicly only with their OK
