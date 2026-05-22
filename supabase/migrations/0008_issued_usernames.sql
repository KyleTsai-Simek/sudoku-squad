-- ============================================================================
-- 0008_issued_usernames.sql
--
-- Per [DECISIONS.md #0027](../../docs/DECISIONS.md), usernames are now globally
-- unique. The `claim-username` Edge Function picks a random adj+noun from the
-- bundled wordlist and inserts here. The unique constraint on `username` is
-- the safety net for collisions across concurrent claims.
--
-- One row per player. A re-call from the same `auth.uid()` returns their
-- existing name (the function does ON CONFLICT (player_id) DO NOTHING then
-- selects).
-- ============================================================================

create table if not exists public.issued_usernames (
  player_id   uuid primary key,
  username    text not null,
  issued_at   timestamptz not null default now(),
  unique (username)
);

create index if not exists issued_usernames_username_idx on public.issued_usernames (username);

alter table public.issued_usernames enable row level security;

-- Anon can read their own row (so the client can resync on a fresh device that
-- still has the same auth session). Insert flows through the Edge Function
-- using service_role; no client insert policy.
create policy "issued_usernames_read_self"
  on public.issued_usernames for select
  to anon, authenticated
  using (player_id = auth.uid());

comment on table public.issued_usernames is
  'Server-issued, globally-unique usernames. One per auth.uid(). Populated by claim-username Edge Function.';
