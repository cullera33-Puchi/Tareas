-- Tareas: Siri and the iOS Shortcut (decision pending 1 of section 9, approved by the owner on 4 November).
--
-- A Shortcut cannot reach the installed app: it opens Safari, whose storage is not the app's. So the Shortcut sends the text to the Edge
-- Function add-task with a personal key; the function stores it here, in the inbox; the app turns each inbox row into a task when it syncs
-- (and at once, through realtime, while it is open).
--
-- What this adds:
--   * inbox: one row per phrase sent by the Shortcut. text is what was said or typed (1 to 500 characters), url a link shared with it
--     (the share sheet variant), source 'siri' or 'share', created the moment it arrived, taken the moment a device made the task (null
--     while waiting). Only the function writes rows (service role, which skips row level security); the owner reads them and may set
--     taken, nothing else. The task made from a row has the id 'ib-' plus the row id, so two devices that take the same row make one task.
--   * shortcut_keys: one row per user with the sha-256 (hex) of the Shortcut's key, the space its tasks go to (space_id, a space id of
--     the app) and when it was made or revoked. The key itself is shown once in Ajustes and never stored anywhere. A new key replaces the
--     row (and the old key); revoked set means no key works. Each user sees and writes only their own row.
--
-- Until this runs, the app logs once that the tables are missing, shows the section Atajo de iOS as not available, and syncs the rest.
--
-- Run after 0001_init.sql to 0009_closed_day.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- inbox
-- ---------------------------------------------------------------------------

create table if not exists public.inbox (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid not null references auth.users (id) on delete cascade,
  text      text not null,
  url       text,
  source    text check (source in ('siri', 'share')),
  created   timestamptz not null default now(),
  taken     timestamptz
);

comment on table public.inbox is 'Siri and the iOS Shortcut: phrases waiting to become tasks; taken once a device made the task';

-- The app asks for "my rows not taken yet, oldest first"; the function counts "my rows of the last hour"
create index if not exists inbox_owner_taken on public.inbox (owner_id, taken);
create index if not exists inbox_owner_created on public.inbox (owner_id, created);

alter table public.inbox enable row level security;
drop policy if exists inbox_select_own on public.inbox;
drop policy if exists inbox_update_own on public.inbox;
create policy inbox_select_own on public.inbox for select to authenticated using (owner_id = (select auth.uid()));
create policy inbox_update_own on public.inbox for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Clients read their rows and mark them taken; only the column taken can change, and no client inserts (the function does)
revoke all on public.inbox from anon, authenticated;
grant select on public.inbox to authenticated;
grant update (taken) on public.inbox to authenticated;

-- ---------------------------------------------------------------------------
-- shortcut_keys
-- ---------------------------------------------------------------------------

create table if not exists public.shortcut_keys (
  owner_id  uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  key_hash  text not null,
  space_id  text,
  created   timestamptz default now(),
  revoked   timestamptz
);

comment on table public.shortcut_keys is 'Siri and the iOS Shortcut: the sha-256 of each user''s key and the space its tasks go to';

-- The function finds the owner by the hash of the key it receives
create index if not exists shortcut_keys_hash on public.shortcut_keys (key_hash);

alter table public.shortcut_keys enable row level security;
drop policy if exists shortcut_keys_select_own on public.shortcut_keys;
drop policy if exists shortcut_keys_insert_own on public.shortcut_keys;
drop policy if exists shortcut_keys_update_own on public.shortcut_keys;
create policy shortcut_keys_select_own on public.shortcut_keys for select to authenticated using (owner_id = (select auth.uid()));
create policy shortcut_keys_insert_own on public.shortcut_keys for insert to authenticated with check (owner_id = (select auth.uid()));
create policy shortcut_keys_update_own on public.shortcut_keys for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.shortcut_keys from anon, authenticated;
grant select, insert, update on public.shortcut_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: an open app learns of a new inbox row at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox'
  ) then
    alter publication supabase_realtime add table public.inbox;
  end if;
end;
$$;

-- PostgREST learns the new tables at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
