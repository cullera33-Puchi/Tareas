-- Tareas, decision 46: steps (subtasks) inside a task, only a title and a check box, as in Recordatorios.
--
-- What this adds:
--   * subtasks: one row per step of a task, with the same conventions as voice_notes in 0001_init.sql (text ids made on the device,
--     owner_id, created, modified, deleted, server_ts, the write trigger "newest modified wins", row level security by owner, realtime).
--     One row per step, not a field of the task: two devices that change different steps of the same task never overwrite each other.
--   * task_id: the task the step belongs to (no foreign key, as between the other tables: devices push in any order and a deletion is a
--     mark). A task deleted on a device takes its steps with it: the device marks them deleted too.
--   * title: the step's text. done: checked or not. sort_order: its place among the task's steps (integers with room between them; equal
--     values fall back on created and id, so every device shows the same order).
--
-- Until this runs, the app keeps the steps on each device (it logs once that the table is missing) and syncs the rest as before.
--
-- Run after 0001_init.sql to 0004_repeat_focus.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.subtasks (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id     text,
  title       text,
  done        boolean,
  sort_order  integer,
  created     timestamptz,
  modified    timestamptz not null,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

comment on table public.subtasks is 'Decision 46: the steps of a task, one row each';

-- Same write rules as the other tables: server time, owner kept, an older copy never overwrites a newer one (0001_init.sql)
drop trigger if exists tareas_before_write on public.subtasks;
create trigger tareas_before_write before insert or update on public.subtasks
  for each row execute function public.tareas_before_write();

-- Pull: "my rows changed after the cursor", in (server_ts, id) order; and the steps of a task
create index if not exists subtasks_owner_server_ts on public.subtasks (owner_id, server_ts, id);
create index if not exists subtasks_task on public.subtasks (task_id);

-- ---------------------------------------------------------------------------
-- Row level security: each user reads and writes only their own rows
-- ---------------------------------------------------------------------------

alter table public.subtasks enable row level security;
drop policy if exists subtasks_select_own on public.subtasks;
drop policy if exists subtasks_insert_own on public.subtasks;
drop policy if exists subtasks_update_own on public.subtasks;
drop policy if exists subtasks_delete_own on public.subtasks;
create policy subtasks_select_own on public.subtasks for select to authenticated using (owner_id = (select auth.uid()));
create policy subtasks_insert_own on public.subtasks for insert to authenticated with check (owner_id = (select auth.uid()));
create policy subtasks_update_own on public.subtasks for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy subtasks_delete_own on public.subtasks for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.subtasks to authenticated;
revoke all on public.subtasks from anon;

-- ---------------------------------------------------------------------------
-- Realtime: the other devices learn of a step added, checked, moved or deleted at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subtasks'
  ) then
    alter publication supabase_realtime add table public.subtasks;
  end if;
end;
$$;

-- PostgREST learns the new table at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
