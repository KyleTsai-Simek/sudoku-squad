-- ============================================================================
-- 0018_mutable_usernames.sql
--
-- Reshape `issued_usernames` from "issued once, globally-unique full name"
-- ([DECISIONS.md #0027]) into a MUTABLE current-username table with
-- Discord-style `base#discriminator` handles ([DECISIONS.md #0043]).
--
-- New uniqueness model: a `base` may repeat across players; the
-- (lower(base), discriminator) pair is what's unique. `discriminator` NULL
-- means a bare base (no `#`), and only one player may hold the bare base.
--
-- `username` becomes a GENERATED display string so it can never drift from
-- base/discriminator. Writes still flow through Edge Functions (service-role):
--   - claim-username: anon default (generated adj-noun base, NULL discriminator)
--   - set-username:   signed-in renames (picks a free bare base or a #NNNN)
-- Renaming updates this row in place; the old (base, discriminator) tuple is
-- freed for reuse automatically.
-- ============================================================================

alter table public.issued_usernames
  add column if not exists base          text,
  add column if not exists discriminator integer;

-- Backfill: existing full names become the base with no discriminator.
update public.issued_usernames
  set base = username
  where base is null;

alter table public.issued_usernames
  alter column base set not null;

-- A discriminator, when present, is at least 4 digits (matches the allocator).
alter table public.issued_usernames
  add constraint issued_usernames_discriminator_range
  check (discriminator is null or discriminator >= 1000);

-- Drop the old full-name uniqueness + lookup index; the new model supersedes it.
alter table public.issued_usernames
  drop constraint if exists issued_usernames_username_key;
drop index if exists public.issued_usernames_username_idx;

-- Make `username` a generated display string (drop + re-add: the column already
-- holds data, which we've copied into `base`).
alter table public.issued_usernames drop column username;
alter table public.issued_usernames
  add column username text
  generated always as (
    base || case when discriminator is null then '' else '#' || discriminator::text end
  ) stored;

-- New uniqueness: base may repeat, but (lower(base), discriminator) is unique.
-- coalesce maps the bare-base NULL to 0 so exactly one bare base can exist.
create unique index issued_usernames_base_disc_key
  on public.issued_usernames (lower(base), coalesce(discriminator, 0));

comment on table public.issued_usernames is
  'Current username per auth.uid(). Mutable (renames via set-username Edge Function). base is shared across players; (lower(base), coalesce(discriminator,0)) is unique; discriminator NULL = bare base. username is a generated display string. #0027 + #0043.';
