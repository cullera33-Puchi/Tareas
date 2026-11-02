-- Tareas, decision 47: project notes. Notes inside each project, next to its tasks (first phase: text only, no photos or audio).
--
-- What this adds:
--   * project_notes: one row per note of a project, with the same conventions as the other tables (text ids made on the device,
--     owner_id, created, modified, deleted, server_ts, the write trigger "newest modified wins", row level security by owner, realtime).
--   * project_id: the project the note belongs to (no foreign key, as between the other tables: devices push in any order and a deletion
--     is a mark). A project deleted on a device (with its space) takes its notes with it: the device marks them deleted too. Archiving a
--     project keeps them; a project moved to another space keeps them, since a note only names its project.
--   * title: the note's title (may be empty). body: its text, plain: lines that start with "- " read as a list and lines that start with
--     "[ ]" or "[x]" as boxes; the app draws them, the database keeps the text as it is. pinned: shown above the others.
--
-- Until this runs, the app keeps the notes on each device (it logs once that the table is missing) and syncs the rest as before.
--
-- Run after 0001_init.sql to 0005_subtasks.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.project_notes (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id  text,
  title       text,
  body        text,
  pinned      boolean,
  created     timestamptz,
  modified    timestamptz not null,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

comment on table public.project_notes is 'Decision 47: the notes of a project, one row each';

-- Same write rules as the other tables: server time, owner kept, an older copy never overwrites a newer one (0001_init.sql)
drop trigger if exists tareas_before_write on public.project_notes;
create trigger tareas_before_write before insert or update on public.project_notes
  for each row execute function public.tareas_before_write();

-- Pull: "my rows changed after the cursor", in (server_ts, id) order; and the notes of a project
create index if not exists project_notes_owner_server_ts on public.project_notes (owner_id, server_ts, id);
create index if not exists project_notes_project on public.project_notes (project_id);

-- ---------------------------------------------------------------------------
-- Row level security: each user reads and writes only their own rows
-- ---------------------------------------------------------------------------

alter table public.project_notes enable row level security;
drop policy if exists project_notes_select_own on public.project_notes;
drop policy if exists project_notes_insert_own on public.project_notes;
drop policy if exists project_notes_update_own on public.project_notes;
drop policy if exists project_notes_delete_own on public.project_notes;
create policy project_notes_select_own on public.project_notes for select to authenticated using (owner_id = (select auth.uid()));
create policy project_notes_insert_own on public.project_notes for insert to authenticated with check (owner_id = (select auth.uid()));
create policy project_notes_update_own on public.project_notes for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy project_notes_delete_own on public.project_notes for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.project_notes to authenticated;
revoke all on public.project_notes from anon;

-- ---------------------------------------------------------------------------
-- Realtime: the other devices learn of a note written, pinned or deleted at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_notes'
  ) then
    alter publication supabase_realtime add table public.project_notes;
  end if;
end;
$$;

-- PostgREST learns the new table at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
