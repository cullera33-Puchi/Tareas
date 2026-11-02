-- Tareas, block 8: tables, row level security and realtime for the sync.
--
-- The app keeps a full copy of the data on each device (localStorage) and syncs it with these tables.
-- Every row belongs to one owner (auth.users). In phase 2 access will move to "per space" (members);
-- for now each user only sees and writes their own rows.
--
-- Sync rules the database enforces (the app relies on them):
--   * server_ts is set by the server on every insert and update. Devices pull "rows with server_ts after
--     my cursor", so it must never come from the client.
--   * Newest modified wins: an update whose modified is older than the stored one is skipped silently
--     (the trigger returns NULL, the statement still succeeds and RETURNING leaves the row out).
--   * Nothing is hard deleted by the app: a deletion sets deleted (and modified), so other devices learn it.
--   * owner_id never changes once set.
--
-- Ids are text: the app creates them with crypto.randomUUID() on the device, offline.
-- Every column except id, owner_id and modified is nullable, so a partial row never fails.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.spaces (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text,
  sort_order  integer,
  members     uuid[] default '{}',          -- reserved for phase 2 (shared spaces)
  created     timestamptz,
  modified    timestamptz not null,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

create table if not exists public.projects (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space_id    text,
  name        text,
  color       text,
  sort_order  integer,
  archived    boolean,
  created     timestamptz,
  modified    timestamptz not null,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

create table if not exists public.tasks (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space_id    text,
  project_id  text,
  title       text,
  date        date,                         -- day only, no time
  reminder    timestamptz,
  priority    text check (priority in ('high', 'mid', 'none')),
  status      text check (status in ('pending', 'done')),
  notes       text,
  carried     boolean,                      -- moved to today from a past date (decision 5)
  assignees   uuid[] default '{}',          -- reserved for phase 2
  created     timestamptz,
  modified    timestamptz not null,
  completed   timestamptz,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

create table if not exists public.voice_notes (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id     text,
  text        text,
  created     timestamptz,
  modified    timestamptz not null,         -- the app sends created when the note was never edited
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

-- No foreign keys between the four tables on purpose: devices push in any order, rows may be partial,
-- and a deletion is a mark, not a row removal.

-- ---------------------------------------------------------------------------
-- Write trigger: server time, owner kept, newest modified wins
-- ---------------------------------------------------------------------------

create or replace function public.tareas_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    if new.owner_id is null then
      new.owner_id := auth.uid();
    end if;
  elsif tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    -- An older copy never overwrites a newer one. Equal times are accepted (same edit sent again,
    -- or a change that does not touch modified, such as moving a pending task to today).
    if new.modified < old.modified then
      return null;
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['spaces', 'projects', 'tasks', 'voice_notes'] loop
    execute format('drop trigger if exists tareas_before_write on public.%I', t);
    execute format(
      'create trigger tareas_before_write before insert or update on public.%I '
      'for each row execute function public.tareas_before_write()', t);

    -- Pull: "my rows changed after the cursor", in (server_ts, id) order
    execute format('create index if not exists %I on public.%I (owner_id, server_ts, id)', t || '_owner_server_ts', t);

    -- Row level security: each user reads and writes only their own rows
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t || '_delete_own', t);

    -- The signed-in role works through these policies; the anonymous role gets nothing
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: devices subscribe to changes of the four tables (filtered by the same policies)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['spaces', 'projects', 'tasks', 'voice_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
