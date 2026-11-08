-- Tareas: todas las migraciones seguidas (0001 a 0014).
-- Se puede ejecutar entero tantas veces como haga falta: cada parte comprueba lo que ya existe.
-- Generado a partir de supabase/migrations. Si se añade una migración, se regenera este archivo.

-- ========== migrations/0001_init.sql ==========
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

-- ========== migrations/0002_push.sql ==========
-- Tareas, block 9: reminders as Web Push notifications.
--
-- What this adds:
--   * tasks.reminder_sent: a reminder is sent once and marked here. The app clears it when the reminder changes to a future time,
--     and fills it itself when a reminder moves to a time that has already passed (decision 25), so that one never notifies.
--   * push_subscriptions: the devices of each user that receive notifications (one row per browser or installed app).
--   * push_keys: the VAPID key pair of the project. The Edge Function creates it on its first run; nobody but the service role
--     can read it (row level security on, no policies), so the private key never leaves the database and the function.
--   * A pg_cron job that calls the Edge Function "send-reminders" every minute through pg_net.
--
-- The function's address is not written here: the function stores it in push_keys the first time it runs (the app calls it when
-- notifications are turned on), and the job does nothing until then. If it ever needs fixing by hand:
--   update public.push_keys set function_url = 'https://<project ref>.supabase.co/functions/v1/send-reminders' where id = 1;
--
-- Run after 0001_init.sql. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Extensions: the scheduler and HTTP calls from the database
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- tasks.reminder_sent
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'reminder_sent'
  ) then
    alter table public.tasks add column reminder_sent timestamptz;
    -- Reminders already past when this runs were never meant to notify now: mark them once, so the first run sends no backlog
    update public.tasks set reminder_sent = now() where reminder is not null and reminder <= now();
  end if;
end;
$$;

-- The rule the app relies on, kept by the database so a device with an older copy cannot undo it:
--   * the reminder changes: reminder_sent is cleared, unless the same write sets a new value (the app marking a past time as sent);
--   * the reminder stays: a write without reminder_sent (or with null) keeps the stored value, so a sent reminder is never sent again.
-- Runs after tareas_before_write (triggers fire in name order), so a write that the newest-wins rule skips never gets here.
create or replace function public.tareas_reminder_sent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reminder is distinct from old.reminder then
    if new.reminder_sent is not distinct from old.reminder_sent then
      new.reminder_sent := null;
    end if;
  elsif new.reminder_sent is null then
    new.reminder_sent := old.reminder_sent;
  end if;
  return new;
end;
$$;

drop trigger if exists tareas_reminder_sent on public.tasks;
create trigger tareas_reminder_sent before update on public.tasks
  for each row execute function public.tareas_reminder_sent();

-- What the function looks for every minute
create index if not exists tasks_reminder_due on public.tasks (reminder)
  where reminder_sent is null and deleted is null and status = 'pending';

-- ---------------------------------------------------------------------------
-- push_subscriptions: one row per device that receives notifications
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id          text primary key,             -- made by the app on the device
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text not null unique,         -- the push service address of the device
  p256dh      text not null,                -- the device's public key for the payload encryption
  auth        text not null,                -- the device's authentication secret
  device      text,                         -- readable name, shown in Ajustes to revoke it
  created     timestamptz default now(),
  modified    timestamptz not null default now(),
  deleted     timestamptz,                  -- revoked from Ajustes; the function skips it
  server_ts   timestamptz not null default now()
);

-- Same write rules as the other tables: server time, owner kept, newest modified wins
drop trigger if exists tareas_before_write on public.push_subscriptions;
create trigger tareas_before_write before insert or update on public.push_subscriptions
  for each row execute function public.tareas_before_write();

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated using (owner_id = (select auth.uid()));
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;

create index if not exists push_subscriptions_owner on public.push_subscriptions (owner_id) where deleted is null;

-- Saves this device's subscription for the signed-in user. A browser has one endpoint, whoever is signed in: if another account (or an
-- older row of this device) holds it, that row goes first, so the endpoint stays unique and notifications follow the current account.
-- Holding the endpoint proves the caller is that browser, which is why this may remove a row of another owner.
create or replace function public.tareas_push_subscribe(p_id text, p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if coalesce(p_id, '') = '' or coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'incomplete subscription';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and id <> p_id;
  delete from public.push_subscriptions where id = p_id and owner_id <> me;
  -- modified moves past the stored one, so the newest-wins rule never skips this write (a revoke made with a clock ahead of the server's)
  insert into public.push_subscriptions as s (id, owner_id, endpoint, p256dh, auth, device, created, modified, deleted)
  values (p_id, me, p_endpoint, p_p256dh, p_auth, p_device, now(), now(), null)
  on conflict (id) do update
    set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device,
        modified = greatest(excluded.modified, s.modified + interval '1 millisecond'), deleted = null;
  return p_id;
end;
$$;

revoke all on function public.tareas_push_subscribe(text, text, text, text, text) from public, anon;
grant execute on function public.tareas_push_subscribe(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- push_keys: the VAPID key pair (private) and the function's address
-- ---------------------------------------------------------------------------

create table if not exists public.push_keys (
  id            integer primary key check (id = 1),  -- a single row
  public_key    text not null,                       -- base64url, the applicationServerKey of the app
  private_jwk   jsonb not null,                      -- the private key as a JWK; read only by the function (service role)
  function_url  text,                                -- written by the function itself; the cron job calls it
  created       timestamptz not null default now()
);

alter table public.push_keys enable row level security;   -- and no policies: only the service role (which skips them) reads it
revoke all on public.push_keys from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every minute: call the function (it sends the reminders that are due)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tareas-send-reminders') then
    perform cron.unschedule('tareas-send-reminders');
  end if;
  perform cron.schedule(
    'tareas-send-reminders',
    '* * * * *',
    $job$
      select net.http_post(
        url := function_url,
        body := '{}'::jsonb,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 20000
      )
      from public.push_keys
      where id = 1 and function_url is not null
    $job$
  );
end;
$$;

-- ========== migrations/0003_attachments.sql ==========
-- Tareas, decision 29: photos and recorded audio attached to tasks.
--
-- What this adds:
--   * attachments: one row per photo or recording of a task, with the same conventions as the tables of 0001_init.sql (text ids made on
--     the device, owner_id, created, modified, deleted, server_ts, the write trigger "newest modified wins", row level security by owner,
--     realtime). The file itself is not here: path points to it in Storage. The app sends a row only once its file is uploaded.
--   * purged: set by the function send-reminders once it has removed the file from Storage (24 hours after the attachment or its task
--     was deleted, decision 29.4). Never sent by the app.
--   * A private Storage bucket "attachments" with a folder per user: <owner_id>/<task_id>/<id>.<ext>. Each signed-in user can read and
--     write only inside their own folder; the app reads through short-lived signed URLs.
--   * tareas_attachments_to_purge(): what send-reminders removes on each run (service role only).
--
-- Run after 0001_init.sql and 0002_push.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.attachments (
  id           text primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id      text,
  kind         text check (kind in ('photo', 'audio')),
  path         text,                          -- <owner_id>/<task_id>/<id>.<ext> in the bucket "attachments"
  mime         text,                          -- image/jpeg, audio/mp4, audio/webm
  size         bigint,                        -- bytes
  width        integer,                       -- photos: pixels after the reduction to 2048 on the long side
  height       integer,
  duration_ms  integer,                       -- recordings
  created      timestamptz,
  modified     timestamptz not null,
  deleted      timestamptz,
  server_ts    timestamptz not null default now(),
  purged       timestamptz                    -- the file was removed from Storage (send-reminders)
);

-- A table created by an earlier run of this file gets any column added since
alter table public.attachments add column if not exists purged timestamptz;

-- Same write rules as the other tables: server time, owner kept, an older copy never overwrites a newer one
drop trigger if exists tareas_before_write on public.attachments;
create trigger tareas_before_write before insert or update on public.attachments
  for each row execute function public.tareas_before_write();

-- Pull: "my rows changed after the cursor", in (server_ts, id) order
create index if not exists attachments_owner_server_ts on public.attachments (owner_id, server_ts, id);
-- The purge: deleted rows not purged yet, and the attachments of a task
create index if not exists attachments_to_purge on public.attachments (deleted) where purged is null and deleted is not null;
create index if not exists attachments_task on public.attachments (task_id) where purged is null;

-- Row level security: each user reads and writes only their own rows
alter table public.attachments enable row level security;
drop policy if exists attachments_select_own on public.attachments;
drop policy if exists attachments_insert_own on public.attachments;
drop policy if exists attachments_update_own on public.attachments;
drop policy if exists attachments_delete_own on public.attachments;
create policy attachments_select_own on public.attachments for select to authenticated using (owner_id = (select auth.uid()));
create policy attachments_insert_own on public.attachments for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attachments_update_own on public.attachments for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy attachments_delete_own on public.attachments for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.attachments to authenticated;
revoke all on public.attachments from anon;

-- Realtime: the other devices learn of a new or deleted attachment at once
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachments'
  ) then
    alter publication supabase_realtime add table public.attachments;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: the private bucket and its rules
-- ---------------------------------------------------------------------------

-- Private (files only through signed URLs), up to 25 MB a file (a photo reduced to 2048 px is under 2 MB; ten minutes of voice about 4 MB),
-- images and audio only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 26214400, array['image/*', 'audio/*'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A signed-in user works only inside the folder named after their id: the first folder of the object's name.
-- Uploading with upsert needs insert, select and update; delete is for completeness (the app never deletes, the function does)
drop policy if exists tareas_attachments_select_own on storage.objects;
drop policy if exists tareas_attachments_insert_own on storage.objects;
drop policy if exists tareas_attachments_update_own on storage.objects;
drop policy if exists tareas_attachments_delete_own on storage.objects;
create policy tareas_attachments_select_own on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tareas_attachments_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tareas_attachments_update_own on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy tareas_attachments_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- The purge (decision 29.4), run by send-reminders every minute
-- ---------------------------------------------------------------------------

-- Attachments whose file can go: the attachment was deleted more than 24 hours ago, or its task was. Until then Deshacer or a restored
-- copy can bring them back with their file. A few at a time, oldest first; the function removes the files, then sets purged.
create or replace function public.tareas_attachments_to_purge(p_limit integer default 50)
returns table (id text, path text, deleted timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.path, a.deleted
  from public.attachments a
  where a.purged is null
    and (
      a.deleted < now() - interval '24 hours'
      or exists (select 1 from public.tasks t where t.id = a.task_id and t.deleted < now() - interval '24 hours')
    )
  order by coalesce(a.deleted, a.server_ts), a.id
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function public.tareas_attachments_to_purge(integer) from public, anon, authenticated;
grant execute on function public.tareas_attachments_to_purge(integer) to service_role;

-- ========== migrations/0004_repeat_focus.sql ==========
-- Tareas, decisions 38, 39 and 41: tasks that repeat, Ahora, and the status Por confirmar.
--
-- What this adds to public.tasks:
--   * repeat: the rule of a task that repeats, as text, null when it does not. The app writes and reads it; the database only keeps it.
--     Format (see js/core.js): '<rule>@<anchor>#<series>', for example 'W2:MO,TH@2026-11-02#k3f9a2c1' (every 2 weeks on Monday and
--     Thursday, counted from 2 November, series k3f9a2c1). The next task of a series is created by the device that completes one.
--   * focus: when the task was put in Ahora, null otherwise. The devices clear it at the start of each day.
--   * status may also be 'waiting' (Por confirmar, between pending and done): the check of 0001_init.sql is replaced by a wider one.
--   * waiting_for: who or what a waiting task waits for (Esperando a), free text, null when not given.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps these values on each device (a waiting task goes up as pending) and syncs the
-- rest as before.
--
-- Run after 0001_init.sql, 0002_push.sql and 0003_attachments.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists repeat text;
alter table public.tasks add column if not exists focus timestamptz;
alter table public.tasks add column if not exists waiting_for text;

-- The status check: 0001 created it unnamed, so PostgreSQL called it tasks_status_check; dropped and made again, so running twice is harmless
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('pending', 'waiting', 'done'));

comment on column public.tasks.repeat is 'Decision 38: the repeat rule of the task, null when it does not repeat';
comment on column public.tasks.focus is 'Decision 39: when the task was put in Ahora, null otherwise';
comment on column public.tasks.waiting_for is 'Decision 41: who or what a task Por confirmar waits for';

-- PostgREST learns the new columns at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';

-- ========== migrations/0005_subtasks.sql ==========
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

-- ========== migrations/0006_project_notes.sql ==========
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

-- ========== migrations/0007_deadline.sql ==========
-- Tareas, decision 48a (M2): the deadline of a task (Fecha límite), apart from its work date.
--
-- What this adds to public.tasks:
--   * deadline: the day the task is due (a date, no time), null when it has none. It is not the work date (date): postponing the task,
--     the start of a day (rollOver) or moving it on the calendar never change it. The app shows it on the rows («Entrega jueves»),
--     brings the open task to Hoy from that day on, and moves it with the date when a task of a series creates the next one.
--     It has no notification of its own (the reminder is for that).
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps the deadline on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0006_project_notes.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists deadline date;

comment on column public.tasks.deadline is 'Decision 48a: the deadline of the task (Fecha límite), null when it has none';

-- PostgREST learns the new column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';

-- ========== migrations/0008_estimate_postponed.sql ==========
-- Tareas, decision 56: the estimated time of a task and how often it was put off (points 53 and 54 of the design).
--
-- What this adds to public.tasks:
--   * estimate: the time the task takes, in minutes (15, 30, 60 or 240, «medio día»), null when not said. The rows show it in grey and
--     «¿Qué hago ahora?» picks the tasks that fit in the time chosen.
--   * postponed: how many times the open task went to a later day while it was already due (its date was today or earlier): the start
--     of a day, Aplazar, Cerrar el día, the review of the carried tasks, a drag in the calendar, the date pickers. Null (or none) at first.
--   * carried_since: the first day the task was due when it was first counted, null until then. With postponed it marks the tasks that
--     keep being put off («Aplazada 4 veces», «Desde el martes 27»).
--   Completing a task keeps both counters (its history); a new task, a copy and the next one of a series start without them.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. The start of a day counts without touching modified, as it moves the date: equal times are accepted.
-- Until this runs, the app keeps these values on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0007_deadline.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists estimate integer;
alter table public.tasks add column if not exists postponed integer;
alter table public.tasks add column if not exists carried_since date;

comment on column public.tasks.estimate is 'Decision 56: the estimated time of the task in minutes, null when not said';
comment on column public.tasks.postponed is 'Decision 56: how many times the open task went to a later day while it was due, null at first';
comment on column public.tasks.carried_since is 'Decision 56: the first day the task was due when it was first put off, null until then';

-- PostgREST learns the new columns at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';

-- ========== migrations/0009_closed_day.sql ==========
-- Tareas: the day closed on every device (Cerrar el día, owner's decision of 3 November).
--
-- What this adds to public.spaces:
--   * closed_day: the day Cerrar el día was confirmed in that space, null when it is open. The day is closed while closed_day is today
--     (on the device's clock): Hoy then shows tomorrow's tasks on every device, under «Día cerrado» and «Reabrir hoy». A value of a past
--     day means open, so midnight opens the day again without anything to clean up. Setting or clearing it updates the space's modified.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps the closed day on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0008_estimate_postponed.sql, in the SQL Editor. Safe to run more than once.

alter table public.spaces add column if not exists closed_day date;

comment on column public.spaces.closed_day is 'The day Cerrar el día was confirmed in this space, null when open; closed while it is today';

-- PostgREST learns the new column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';

-- ========== migrations/0010_inbox.sql ==========
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

-- ========== migrations/0011_contacts.sql ==========
-- Tareas, decision 48c and the roadmap's list of contacts (approved by the owner on 4 November): Responsable and Contactos.
--
-- What this adds:
--   * tasks.responsible: who does the task when it is not the owner, free text (a name), null when nobody. The rows show it in grey,
--     the lists filter by it and «Enviar recordatorio» writes to that person.
--   * contacts: one row per person of Responsable and Esperando a, with the same conventions as the other tables (text ids made on the
--     device, owner_id, created, modified, deleted, server_ts, the write trigger "newest modified wins", row level security by owner,
--     realtime). name: how the tasks call the person; email and phone: optional, they choose how «Enviar recordatorio» goes (WhatsApp with
--     a phone, mail with an email, the share sheet otherwise). The app makes a contact with just the name the first time a new name is
--     set as Responsable or Esperando a; renaming a contact renames that name in the tasks; deleting one leaves the tasks as they are.
--     name is nullable, like every content column of the other tables: a deletion goes up as a row with only id, deleted and modified,
--     and the app never sends a contact without a name.
--
-- Until this runs, the app keeps the contacts and the responsible of each task on each device (it logs once that the table or the column
-- is missing) and syncs the rest as before.
--
-- Run after 0001_init.sql to 0010_inbox.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- tasks.responsible
-- ---------------------------------------------------------------------------

alter table public.tasks add column if not exists responsible text;

comment on column public.tasks.responsible is 'Decision 48c: who does the task when it is not the owner, free text, null when nobody';

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

create table if not exists public.contacts (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text,
  email       text,
  phone       text,
  created     timestamptz,
  modified    timestamptz not null,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

comment on table public.contacts is 'Decision 48c: the people of Responsable and Esperando a, one row each';

-- Same write rules as the other tables: server time, owner kept, an older copy never overwrites a newer one (0001_init.sql)
drop trigger if exists tareas_before_write on public.contacts;
create trigger tareas_before_write before insert or update on public.contacts
  for each row execute function public.tareas_before_write();

-- Pull: "my rows changed after the cursor", in (server_ts, id) order
create index if not exists contacts_owner_server_ts on public.contacts (owner_id, server_ts, id);

-- ---------------------------------------------------------------------------
-- Row level security: each user reads and writes only their own rows
-- ---------------------------------------------------------------------------

alter table public.contacts enable row level security;
drop policy if exists contacts_select_own on public.contacts;
drop policy if exists contacts_insert_own on public.contacts;
drop policy if exists contacts_update_own on public.contacts;
drop policy if exists contacts_delete_own on public.contacts;
create policy contacts_select_own on public.contacts for select to authenticated using (owner_id = (select auth.uid()));
create policy contacts_insert_own on public.contacts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy contacts_update_own on public.contacts for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy contacts_delete_own on public.contacts for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.contacts to authenticated;
revoke all on public.contacts from anon;

-- ---------------------------------------------------------------------------
-- Realtime: the other devices learn of a contact added, changed or deleted at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
  ) then
    alter publication supabase_realtime add table public.contacts;
  end if;
end;
$$;

-- PostgREST learns the new table and column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';

-- ========== migrations/0012_encryption.sql ==========
-- Tareas: end-to-end encryption (decision 63a, approved by the owner on 4 November).
--
-- The app encrypts on the device what the user writes (task titles and notes, names, steps, project notes, contacts...) before it goes
-- up; this database only holds ciphertext for those columns: text that starts with 'e1:'. Dates, reminders, priority, status, ids,
-- counts and the rest stay plain. Without the password, the server copy cannot be read; there is no recovery code.
--
-- What this adds:
--   * crypto_keys: one row per user with the account's data key, wrapped (AES-KW) by a key derived from the encryption password
--     (PBKDF2-SHA256): kid (the key id, random), salt, iterations and wrapped, all base64url. A device unwraps it with the password
--     and keeps the key; changing the password updates salt and wrapped (the data key, and so the data, stay the same). The row
--     existing means "encryption on" for that user. migrated is set once every row, file and Siri phrase the account held before was
--     encrypted; until then any device with the key goes on with that work (it is idempotent), so a cut or a lost device never leaves it
--     half done. Each user reads, inserts and updates only their own row; nobody deletes it.
--   * tareas_require_cipher(): a trigger on the synced tables. When the row's owner has a crypto_keys row, a value of an encrypted
--     column that is new (an insert, or an update that changes it) must be empty or start with 'e1:'; anything else raises
--     'tareas_plaintext_refused'. This stops a device still on an older version from writing plain text after encryption was turned
--     on (the app shows «Actualiza la app: el cifrado está activado»). A value that does not change passes, so marking a not yet
--     encrypted row as deleted works. The columns of each table are listed inside the function (not as trigger arguments), so a later
--     version can change the list with create or replace, without recreating the triggers.
--   * inbox: the signed-in user may also set text and url, so the app empties a Siri phrase once its task exists (the task goes up
--     encrypted).
--
-- Until this runs, the app works as before and Ajustes, Cifrado says that it cannot be activated.
--
-- Run after 0001_init.sql to 0011_contacts.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- crypto_keys
-- ---------------------------------------------------------------------------

create table if not exists public.crypto_keys (
  owner_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kid         text not null,
  salt        text not null,
  iterations  int not null,
  wrapped     text not null,
  created     timestamptz default now(),
  modified    timestamptz default now(),
  migrated    timestamptz
);

-- A table made by an earlier draft of this file gains the column
alter table public.crypto_keys add column if not exists migrated timestamptz;

comment on table public.crypto_keys is 'Decision 63a: each user''s data key, wrapped by the encryption password; the row means encryption on';

alter table public.crypto_keys enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crypto_keys' and policyname = 'crypto_keys_select_own') then
    create policy crypto_keys_select_own on public.crypto_keys for select to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crypto_keys' and policyname = 'crypto_keys_insert_own') then
    create policy crypto_keys_insert_own on public.crypto_keys for insert to authenticated with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crypto_keys' and policyname = 'crypto_keys_update_own') then
    create policy crypto_keys_update_own on public.crypto_keys for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on public.crypto_keys from anon, authenticated;
grant select, insert, update on public.crypto_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Plain text refused once encryption is on
-- ---------------------------------------------------------------------------

-- Runs after tareas_before_write (triggers of the same kind fire in name order), so owner_id is set and an older copy, which that
-- trigger skips, never gets here. security definer: the check reads crypto_keys whoever writes (the service role too)
create or replace function public.tareas_require_cipher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cols text[];
  col text;
  v text;
  uid uuid;
begin
  cols := case tg_table_name
    when 'tasks' then array['title', 'notes', 'waiting_for', 'responsible']
    when 'projects' then array['name']
    when 'spaces' then array['name']
    when 'subtasks' then array['title']
    when 'project_notes' then array['title', 'body']
    when 'contacts' then array['name', 'email', 'phone']
    when 'voice_notes' then array['text']
    else array[]::text[]
  end;
  uid := coalesce(new.owner_id, auth.uid());
  if uid is null or not exists (select 1 from public.crypto_keys k where k.owner_id = uid) then
    return new;
  end if;
  foreach col in array cols loop
    v := to_jsonb(new) ->> col;
    if v is null or v = '' or left(v, 3) = 'e1:' then
      continue;
    end if;
    if tg_op = 'UPDATE' and (to_jsonb(old) ->> col) is not distinct from v then
      continue;
    end if;
    raise exception 'tareas_plaintext_refused: %.% must be encrypted (update the app)', tg_table_name, col
      using errcode = 'P0001', hint = 'Encryption is on for this account';
  end loop;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['spaces', 'projects', 'tasks', 'voice_notes', 'subtasks', 'project_notes', 'contacts'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'tareas_require_cipher'
    ) then
      execute format(
        'create trigger tareas_require_cipher before insert or update on public.%I '
        'for each row execute function public.tareas_require_cipher()', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- inbox: the app empties a phrase once its task exists
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.inbox') is not null then
    grant update (text, url) on public.inbox to authenticated;
  end if;
end;
$$;

-- PostgREST learns the new table at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';

-- ========== migrations/0013_team.sql ==========
-- Tareas: the team (decision 63 b, c and d; details closed by the owner on 5 November, decision 71).
--
-- Access only by invitation. The owner of the project is the admin: he invites people by their email in Ajustes, Equipo, sees the
-- members (name, email, last access, storage used) and never their data. Each member sees only their own rows, as before; on top of
-- the rules by owner, every table now also asks for an active membership, so removing someone's access blocks their reads and writes
-- at once (no notice to the person). Their data are kept 30 days and then deleted by the function send-reminders.
--
-- What this adds:
--   * team_members: one row per authorized email (name, role admin or member, storage quota in bytes, invited, revoked, last access,
--     and the account's id once the person signs in). Nobody reads or writes it directly: the functions below do, with their checks.
--     The admin is never written here by hand: when no admin exists, the oldest account of the project becomes the admin (that is the
--     owner, who made the project), so no email is kept in the repository.
--   * tareas_team_role(uid) and the gates tareas_team_ok() and tareas_team_write_ok(): a restrictive policy on every table of the app
--     (and on the files of the bucket "attachments") that the permissive rules by owner cannot open. Writing the synced data also needs
--     the encryption key row of a member (decision 71.1: encryption is mandatory for invited members; the admin already has it).
--   * crypto_keys.ecdh_pub and ecdh_priv: each member's ECDH P-256 key pair. The public key (base64url, raw) is read by the other members
--     through the directory; the private key (PKCS #8) is stored encrypted with the member's own data key ('e1:'), so only their devices
--     open it.
--   * team_notices: «Avisar a…», a copy of a task encrypted for one member (ephemeral ECDH and AES-GCM, made on the sender's device).
--     The server allows one notice every 4 hours per task and person (tareas_notice_too_soon). The recipient reads it, and marks it taken
--     or dismissed; send-reminders pushes «<sender> te ha enviado una tarea», nothing of the task.
--   * team_feedback: «Enviar sugerencia o incidencia», encrypted for the admin's public key; only the admin reads it and sets its status
--     (nueva, vista, resuelta); send-reminders pushes «Nueva sugerencia» or «Nueva incidencia».
--   * The storage quota (63c): 50 MB per new member by default, the admin without limit; an upload to the bucket is refused once the
--     files of the member's folder would pass it. Space frees when a deleted attachment is purged (24 hours, 0003_attachments.sql).
--   * tareas_before_user_created(event): an Auth hook that lets new accounts in only with an invited email. The owner turns it on in
--     the dashboard (Authentication, Hooks, Before User Created, Postgres, public.tareas_before_user_created). The policies are the real
--     protection: without the hook a stranger can make an account, and still sees and writes nothing.
--   * tareas_team_to_remove() and tareas_team_remove(member): the removal 30 days after the access was removed, run by send-reminders
--     (it removes the files through the Storage API first); each removal is written to team_log.
--
-- Until this runs, the app works as before (one user) and Ajustes shows no Equipo section.
--
-- No statement of this file removes an object of the database: it only creates, replaces or adds, so it is safe to run more than once.
-- Run after 0001_init.sql to 0012_encryption.sql, in the SQL Editor.

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------

create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  name         text,
  role         text not null default 'member' check (role in ('admin', 'member')),
  quota        bigint default 52428800 check (quota is null or quota >= 0),  -- bytes; null: no limit (the admin)
  invited      timestamptz default now(),
  revoked      timestamptz,                                                   -- access removed: blocked at once, removed after 30 days
  last_access  timestamptz,
  user_id      uuid unique,                                                   -- the account, once the person signs in
  created      timestamptz not null default now()
);

create unique index if not exists team_members_email on public.team_members (lower(email));

comment on table public.team_members is 'Decision 63b: who may use the app; read and written only through the tareas_team_* functions';

alter table public.team_members enable row level security;   -- and no policies: only the functions (security definer) touch it
revoke all on public.team_members from anon, authenticated;

-- The log of the removals after 30 days (and of nothing else): what went, never any content
create table if not exists public.team_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  event   text not null,
  detail  jsonb
);
alter table public.team_log enable row level security;
revoke all on public.team_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- crypto_keys: the member's key pair for «Avisar a…» and the suggestions
-- ---------------------------------------------------------------------------

alter table public.crypto_keys add column if not exists ecdh_pub text;
alter table public.crypto_keys add column if not exists ecdh_priv text;

-- ---------------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------------

-- No admin yet: the oldest account of the project becomes the admin (the owner made the project and signed in first)
create or replace function public.tareas_team_bootstrap()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
begin
  if exists (select 1 from public.team_members m where m.role = 'admin') then
    return;
  end if;
  select a.id, a.email, coalesce(a.raw_user_meta_data ->> 'full_name', a.raw_user_meta_data ->> 'name') as nm
    into u from auth.users a order by a.created_at, a.id limit 1;
  if u.id is null then
    return;
  end if;
  insert into public.team_members (email, name, role, quota, user_id, invited)
  values (coalesce(u.email, u.id::text), u.nm, 'admin', null, u.id, now())
  on conflict do nothing;
  insert into public.team_log (event, detail) values ('admin', jsonb_build_object('user_id', u.id));
end;
$$;

-- The role of an account ('admin', 'member') or null when it has no access. An invitation not yet linked to an account matches the
-- account's confirmed email; a project with no admin at all lets its oldest account in as the admin
create or replace function public.tareas_team_role(p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r text;
  em text;
begin
  if p_uid is null then
    return null;
  end if;
  select m.role into r from public.team_members m where m.user_id = p_uid and m.revoked is null;
  if found then
    return r;
  end if;
  if exists (select 1 from public.team_members m where m.user_id = p_uid) then
    return null;   -- removed
  end if;
  select lower(a.email) into em from auth.users a where a.id = p_uid and a.email_confirmed_at is not null;
  if em is not null then
    select m.role into r from public.team_members m where lower(m.email) = em and m.user_id is null and m.revoked is null;
    if found then
      return r;
    end if;
  end if;
  if not exists (select 1 from public.team_members m where m.role = 'admin')
     and p_uid = (select a.id from auth.users a order by a.created_at, a.id limit 1) then
    return 'admin';
  end if;
  return null;
end;
$$;

-- The gates of the policies: an active member; and, to write the synced data, a member with the encryption key row (or the admin)
create or replace function public.tareas_team_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tareas_team_role(auth.uid()) is not null;
$$;

create or replace function public.tareas_team_write_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r text := public.tareas_team_role(auth.uid());
begin
  if r is null then
    return false;
  end if;
  return r = 'admin' or exists (select 1 from public.crypto_keys k where k.owner_id = auth.uid());
end;
$$;

-- The admin, for the policies of team_feedback
create or replace function public.tareas_team_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tareas_team_role(auth.uid()) = 'admin';
$$;

revoke all on function public.tareas_team_bootstrap() from public, anon, authenticated;
revoke all on function public.tareas_team_role(uuid) from public, anon, authenticated;
grant execute on function public.tareas_team_ok() to authenticated;
grant execute on function public.tareas_team_write_ok() to authenticated;
grant execute on function public.tareas_team_is_admin() to authenticated;
revoke all on function public.tareas_team_ok() from public, anon;
revoke all on function public.tareas_team_write_ok() from public, anon;
revoke all on function public.tareas_team_is_admin() from public, anon;

-- ---------------------------------------------------------------------------
-- The storage quota (63c)
-- ---------------------------------------------------------------------------

-- The bytes of a member's folder in the bucket "attachments" (one object left out: the one an upload replaces)
create or replace function public.tareas_storage_used(p_uid uuid, p_except text default null)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0) into n
  from storage.objects o
  where o.bucket_id = 'attachments' and o.name like p_uid::text || '/%' and (p_except is null or o.name <> p_except);
  return n;
end;
$$;

-- A new or replaced object of the bucket "attachments" fits the caller's quota. o: the row (to_jsonb), whose metadata carries the size
-- once Storage knows it; before that a byte is counted, so a full folder takes nothing more
create or replace function public.tareas_storage_ok(o jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q bigint;
begin
  if (o ->> 'bucket_id') is distinct from 'attachments' then
    return true;
  end if;
  if not public.tareas_team_write_ok() then
    return false;   -- no access, or a member without the encryption key row (a file would go up in clear)
  end if;
  select m.quota into q from public.team_members m where m.user_id = uid and m.revoked is null;
  if not found then
    -- linked on the next tareas_team_me; until then the invitation's quota (the bootstrap admin has none)
    select m.quota into q from public.team_members m join auth.users a on lower(a.email) = lower(m.email)
      where a.id = uid and m.user_id is null and m.revoked is null;
  end if;
  if q is null then
    return true;
  end if;
  return public.tareas_storage_used(uid, o ->> 'name') + greatest(coalesce((o -> 'metadata' ->> 'size')::bigint, 0), 1) <= q;
end;
$$;

revoke all on function public.tareas_storage_used(uuid, text) from public, anon, authenticated;
revoke all on function public.tareas_storage_ok(jsonb) from public, anon;
grant execute on function public.tareas_storage_ok(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The gate on every table of the app (restrictive: the rules by owner still decide which rows)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  chk text;
begin
  foreach t in array array['spaces', 'projects', 'tasks', 'voice_notes', 'attachments', 'subtasks', 'project_notes', 'contacts',
                           'push_subscriptions', 'inbox', 'shortcut_keys', 'crypto_keys'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    -- the synced data need the key row of a member; the account's own settings (devices, Siri key, the key row itself) only access
    chk := case when t in ('push_subscriptions', 'inbox', 'shortcut_keys', 'crypto_keys')
      then '(select public.tareas_team_ok())' else '(select public.tareas_team_write_ok())' end;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_team_gate') then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select public.tareas_team_ok())) with check (%s)',
        t || '_team_gate', t, chk);
    end if;
  end loop;
end;
$$;

-- The files: only an active member reaches the bucket, and an upload must fit the quota
do $$
begin
  if to_regclass('storage.objects') is not null and not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tareas_attachments_team_gate'
  ) then
    create policy tareas_attachments_team_gate on storage.objects as restrictive for all to authenticated
      using (bucket_id <> 'attachments' or (select public.tareas_team_ok()))
      with check (bucket_id <> 'attachments' or public.tareas_storage_ok(to_jsonb(objects.*)));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The app's calls
-- ---------------------------------------------------------------------------

-- The signed-in account: {id, role, name, email, quota, used}, or null without access. Links an invitation to the account on its first
-- call (the confirmed email of the account, the name of its Google profile when the invitation has none) and notes the last access
create or replace function public.tareas_team_me()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.team_members;
  em text;
  nm text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  perform public.tareas_team_bootstrap();
  select * into m from public.team_members t where t.user_id = uid;
  if not found then
    select lower(a.email), coalesce(a.raw_user_meta_data ->> 'full_name', a.raw_user_meta_data ->> 'name') into em, nm
      from auth.users a where a.id = uid and a.email_confirmed_at is not null;
    if em is not null then
      update public.team_members t set user_id = uid, name = coalesce(nullif(t.name, ''), nm)
        where lower(t.email) = em and t.user_id is null and t.revoked is null
        returning * into m;
    end if;
  end if;
  if m.id is null or m.revoked is not null then
    return null;
  end if;
  if m.last_access is null or m.last_access < now() - interval '5 minutes' then
    update public.team_members t set last_access = now() where t.id = m.id;
  end if;
  return jsonb_build_object('id', m.id, 'role', m.role, 'name', m.name, 'email', m.email, 'quota', m.quota,
    'used', public.tareas_storage_used(uid));
end;
$$;

-- The directory: the active members' names and emails (only that), with their public key, for «Avisar a…» and the suggestions
create or replace function public.tareas_team_directory()
returns table (user_id uuid, name text, email text, pub text, admin boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.tareas_team_role(auth.uid()) is null then
    return;
  end if;
  return query
    select m.user_id, m.name, m.email, k.ecdh_pub, m.role = 'admin'
    from public.team_members m left join public.crypto_keys k on k.owner_id = m.user_id
    where m.revoked is null and m.user_id is not null
    order by lower(coalesce(nullif(m.name, ''), m.email));
end;
$$;

-- Admin only: every member, removed ones included, with the storage used (never any of their data)
create or replace function public.tareas_team_list()
returns table (id uuid, email text, name text, role text, quota bigint, used bigint, invited timestamptz, revoked timestamptz,
               last_access timestamptz, joined boolean, has_key boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  return query
    select m.id, m.email, m.name, m.role, m.quota, case when m.user_id is null then 0::bigint else public.tareas_storage_used(m.user_id) end,
      m.invited, m.revoked, m.last_access, m.user_id is not null,
      exists (select 1 from public.crypto_keys k where k.owner_id = m.user_id)
    from public.team_members m
    order by m.role, m.revoked nulls first, lower(coalesce(nullif(m.name, ''), m.email));
end;
$$;

-- Admin only: invites an email (or invites again one whose access was removed and not yet deleted). Returns the member's id
create or replace function public.tareas_team_invite(p_email text, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
  nm text := nullif(left(trim(coalesce(p_name, '')), 80), '');
  rid uuid;
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(em) > 254 then
    raise exception 'tareas_team_bad_email' using errcode = '22023';
  end if;
  -- Removed more than 30 days ago: its data are being deleted (tareas_team_remove); a new invitation once that ends
  if exists (select 1 from public.team_members m where lower(m.email) = em and m.revoked < now() - interval '30 days') then
    raise exception 'tareas_team_removing' using errcode = 'P0001';
  end if;
  update public.team_members m set revoked = null, invited = now(), name = coalesce(nm, m.name)
    where lower(m.email) = em returning m.id into rid;
  if rid is null then
    insert into public.team_members (email, name) values (em, nm) returning id into rid;
  end if;
  return rid;
end;
$$;

-- Admin only: a member's quota in bytes (null: no limit)
create or replace function public.tareas_team_quota(p_id uuid, p_quota bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  if p_quota is not null and p_quota < 0 then
    raise exception 'tareas_team_bad_quota' using errcode = '22023';
  end if;
  update public.team_members set quota = p_quota where id = p_id;
end;
$$;

-- Admin only: removes a member's access at once (never the admin's). Their devices stop receiving notifications and their Siri key stops
create or replace function public.tareas_team_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.team_members;
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  select * into m from public.team_members t where t.id = p_id;
  if not found or m.role = 'admin' or m.user_id = auth.uid() then
    raise exception 'tareas_team_not_removable' using errcode = '42501';
  end if;
  update public.team_members t set revoked = coalesce(t.revoked, now()) where t.id = p_id;
  if m.user_id is not null then
    update public.push_subscriptions s set deleted = now(), modified = greatest(now(), s.modified + interval '1 millisecond')
      where s.owner_id = m.user_id and s.deleted is null;
    -- and their Siri key stops working (the function add-task checks the access too); back with access, they make a new key
    update public.shortcut_keys k set revoked = coalesce(k.revoked, now()) where k.owner_id = m.user_id;
  end if;
end;
$$;

revoke all on function public.tareas_team_me() from public, anon;
revoke all on function public.tareas_team_directory() from public, anon;
revoke all on function public.tareas_team_list() from public, anon;
revoke all on function public.tareas_team_invite(text, text) from public, anon;
revoke all on function public.tareas_team_quota(uuid, bigint) from public, anon;
revoke all on function public.tareas_team_revoke(uuid) from public, anon;
grant execute on function public.tareas_team_me() to authenticated;
grant execute on function public.tareas_team_directory() to authenticated;
grant execute on function public.tareas_team_list() to authenticated;
grant execute on function public.tareas_team_invite(text, text) to authenticated;
grant execute on function public.tareas_team_quota(uuid, bigint) to authenticated;
grant execute on function public.tareas_team_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- push_subscriptions: only an account with access saves a device (the function of 0002_push.sql, now with the gate)
-- ---------------------------------------------------------------------------

create or replace function public.tareas_push_subscribe(p_id text, p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;
  if not public.tareas_team_ok() then
    raise exception 'tareas_team_no_access' using errcode = '42501';
  end if;
  if coalesce(p_id, '') = '' or coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'incomplete subscription';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and id <> p_id;
  delete from public.push_subscriptions where id = p_id and owner_id <> me;
  insert into public.push_subscriptions as s (id, owner_id, endpoint, p256dh, auth, device, created, modified, deleted)
  values (p_id, me, p_endpoint, p_p256dh, p_auth, p_device, now(), now(), null)
  on conflict (id) do update
    set endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device,
        modified = greatest(excluded.modified, s.modified + interval '1 millisecond'), deleted = null;
  return p_id;
end;
$$;

revoke all on function public.tareas_push_subscribe(text, text, text, text, text) from public, anon;
grant execute on function public.tareas_push_subscribe(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- team_notices: «Avisar a…»
-- ---------------------------------------------------------------------------

create table if not exists public.team_notices (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null default auth.uid(),
  recipient_id  uuid not null,
  task_ref      text not null,              -- the sender's task id: only for the limit of one notice every 4 hours per task and person
  payload       text not null check (length(payload) <= 200000),   -- the copy of the task, encrypted for the recipient
  created       timestamptz not null default now(),
  pushed        timestamptz,                -- the notification went (send-reminders)
  taken         timestamptz,                -- «Añadir a mis tareas»
  dismissed     timestamptz                 -- «Descartar»
);

create index if not exists team_notices_recipient on public.team_notices (recipient_id, created) where taken is null and dismissed is null;
create index if not exists team_notices_limit on public.team_notices (sender_id, recipient_id, task_ref, created);
create index if not exists team_notices_push on public.team_notices (created) where pushed is null;

-- What a client sends is checked here: the sender is the caller, the recipient an active member and not the caller, the same task
-- to the same person waits 4 hours, and nobody sends more than 20 an hour. created, pushed, taken and dismissed always start as the server says
create or replace function public.tareas_notice_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last timestamptz;
begin
  if auth.uid() is not null then
    new.sender_id := auth.uid();
  end if;
  new.created := now();
  new.pushed := null;
  new.taken := null;
  new.dismissed := null;
  if new.recipient_id = new.sender_id or public.tareas_team_role(new.recipient_id) is null then
    raise exception 'tareas_notice_bad_recipient' using errcode = '22023';
  end if;
  -- At most 20 notices an hour per sender, whatever the tasks (task_ref comes from the client)
  perform pg_advisory_xact_lock(hashtext('tareas-notices-' || new.sender_id::text));
  if (select count(*) from public.team_notices n where n.sender_id = new.sender_id and n.created > now() - interval '1 hour') >= 20 then
    raise exception 'tareas_notice_too_many' using errcode = 'P0001', hint = 'At most 20 notices an hour';
  end if;
  perform pg_advisory_xact_lock(hashtext(new.sender_id::text || new.recipient_id::text || new.task_ref));
  select max(n.created) into last from public.team_notices n
    where n.sender_id = new.sender_id and n.recipient_id = new.recipient_id and n.task_ref = new.task_ref;
  if last is not null and last > now() - interval '4 hours' then
    raise exception 'tareas_notice_too_soon' using errcode = 'P0001', detail = to_char((last + interval '4 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_notices'::regclass and tgname = 'tareas_notice_before') then
    create trigger tareas_notice_before before insert on public.team_notices
      for each row execute function public.tareas_notice_before();
  end if;
end;
$$;

alter table public.team_notices enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_notices' and policyname = 'team_notices_select_own') then
    create policy team_notices_select_own on public.team_notices for select to authenticated
      using ((recipient_id = (select auth.uid()) or sender_id = (select auth.uid())) and (select public.tareas_team_ok()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_notices' and policyname = 'team_notices_insert_own') then
    create policy team_notices_insert_own on public.team_notices for insert to authenticated
      with check (sender_id = (select auth.uid()) and (select public.tareas_team_ok()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_notices' and policyname = 'team_notices_update_recipient') then
    create policy team_notices_update_recipient on public.team_notices for update to authenticated
      using (recipient_id = (select auth.uid()) and (select public.tareas_team_ok()))
      with check (recipient_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on public.team_notices from anon, authenticated;
grant select, insert on public.team_notices to authenticated;
grant update (taken, dismissed) on public.team_notices to authenticated;
grant select, update on public.team_notices to service_role;

-- ---------------------------------------------------------------------------
-- team_feedback: «Enviar sugerencia o incidencia»
-- ---------------------------------------------------------------------------

create table if not exists public.team_feedback (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null default auth.uid(),
  recipient_id  uuid not null,              -- the admin whose public key encrypted it
  kind          text not null check (kind in ('sugerencia', 'incidencia')),
  payload       text not null check (length(payload) <= 600000),   -- text, version, device and, if the person ticked it, the app's log
  created       timestamptz not null default now(),
  status        text not null default 'nueva' check (status in ('nueva', 'vista', 'resuelta')),
  pushed        timestamptz
);

create index if not exists team_feedback_recipient on public.team_feedback (recipient_id, created);
create index if not exists team_feedback_push on public.team_feedback (created) where pushed is null;

-- The sender is the caller, the recipient the admin, it starts as nueva; at most 20 an hour per person
create or replace function public.tareas_feedback_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.sender_id := auth.uid();
  end if;
  new.created := now();
  new.status := 'nueva';
  new.pushed := null;
  if public.tareas_team_role(new.recipient_id) is distinct from 'admin' then
    raise exception 'tareas_feedback_bad_recipient' using errcode = '22023';
  end if;
  if (select count(*) from public.team_feedback f where f.sender_id = new.sender_id and f.created > now() - interval '1 hour') >= 20 then
    raise exception 'tareas_feedback_too_many' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_feedback'::regclass and tgname = 'tareas_feedback_before') then
    create trigger tareas_feedback_before before insert on public.team_feedback
      for each row execute function public.tareas_feedback_before();
  end if;
end;
$$;

alter table public.team_feedback enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_feedback' and policyname = 'team_feedback_insert_member') then
    create policy team_feedback_insert_member on public.team_feedback for insert to authenticated
      with check (sender_id = (select auth.uid()) and (select public.tareas_team_ok()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_feedback' and policyname = 'team_feedback_select_admin') then
    create policy team_feedback_select_admin on public.team_feedback for select to authenticated
      using (recipient_id = (select auth.uid()) and (select public.tareas_team_is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_feedback' and policyname = 'team_feedback_update_admin') then
    create policy team_feedback_update_admin on public.team_feedback for update to authenticated
      using (recipient_id = (select auth.uid()) and (select public.tareas_team_is_admin()))
      with check (recipient_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on public.team_feedback from anon, authenticated;
grant select, insert on public.team_feedback to authenticated;
grant update (status) on public.team_feedback to authenticated;
grant select, update on public.team_feedback to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: a member learns of a task sent to them at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_notices'
  ) then
    alter publication supabase_realtime add table public.team_notices;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- send-reminders (service role): who may be notified, and the removal after 30 days
-- ---------------------------------------------------------------------------

-- Of the given accounts, those with access (a reminder of an account whose access was removed is not sent)
create or replace function public.tareas_team_allowed(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u from unnest(coalesce(p_ids, '{}'::uuid[])) as u where public.tareas_team_role(u) is not null;
$$;

-- Members (never the admin) whose access was removed more than 30 days ago, with up to 200 of their files still in Storage.
-- The function removes those files and calls tareas_team_remove once a member has none left
create or replace function public.tareas_team_to_remove()
returns table (member_id uuid, user_id uuid, files text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select m.id, m.user_id,
      case when m.user_id is null then '{}'::text[] else coalesce((
        select array_agg(o.name) from (
          select s.name from storage.objects s where s.bucket_id = 'attachments' and s.name like m.user_id::text || '/%' order by s.name limit 200
        ) o), '{}'::text[]) end
    from public.team_members m
    where m.role = 'member' and m.revoked is not null and m.revoked < now() - interval '30 days'
    order by m.revoked
    limit 5;
end;
$$;

-- Deletes everything of one such member: their rows in every table, the notices sent or received, the suggestions they sent, the
-- membership and the account itself. Checks again that the access was removed more than 30 days ago and that it is not an admin.
-- Returns what it removed (counts), also written to team_log
create or replace function public.tareas_team_remove(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.team_members;
  t text;
  n bigint;
  out jsonb := '{}'::jsonb;
begin
  select * into m from public.team_members x where x.id = p_member for update;
  if not found or m.role <> 'member' or m.revoked is null or m.revoked >= now() - interval '30 days' then
    return jsonb_build_object('skipped', true);
  end if;
  if m.user_id is not null then
    if exists (select 1 from public.team_members x where x.user_id = m.user_id and x.id <> m.id) then
      return jsonb_build_object('skipped', true);
    end if;
    foreach t in array array['subtasks', 'attachments', 'voice_notes', 'tasks', 'project_notes', 'projects', 'spaces', 'contacts',
                             'push_subscriptions', 'inbox', 'shortcut_keys', 'crypto_keys'] loop
      if to_regclass('public.' || t) is not null then
        execute format('delete from public.%I where owner_id = $1', t) using m.user_id;
        get diagnostics n = row_count;
        if n > 0 then
          out := out || jsonb_build_object(t, n);
        end if;
      end if;
    end loop;
    delete from public.team_notices x where x.sender_id = m.user_id or x.recipient_id = m.user_id;
    get diagnostics n = row_count;
    if n > 0 then out := out || jsonb_build_object('team_notices', n); end if;
    delete from public.team_feedback x where x.sender_id = m.user_id;
    get diagnostics n = row_count;
    if n > 0 then out := out || jsonb_build_object('team_feedback', n); end if;
    begin
      delete from auth.users a where a.id = m.user_id;
      get diagnostics n = row_count;
      out := out || jsonb_build_object('account', n);
    exception when others then
      out := out || jsonb_build_object('account_kept', sqlerrm);
    end;
  end if;
  delete from public.team_members x where x.id = m.id;
  insert into public.team_log (event, detail)
    values ('removed', jsonb_build_object('member', m.id, 'user_id', m.user_id, 'revoked', m.revoked, 'rows', out));
  return out;
end;
$$;

revoke all on function public.tareas_team_allowed(uuid[]) from public, anon, authenticated;
revoke all on function public.tareas_team_to_remove() from public, anon, authenticated;
revoke all on function public.tareas_team_remove(uuid) from public, anon, authenticated;
grant execute on function public.tareas_team_allowed(uuid[]) to service_role;
grant execute on function public.tareas_team_to_remove() to service_role;
grant execute on function public.tareas_team_remove(uuid) to service_role;
grant select on public.team_members to service_role;

-- ---------------------------------------------------------------------------
-- The Auth hook «Before User Created»: only invited emails make an account
-- ---------------------------------------------------------------------------

-- The owner turns it on in the dashboard: Authentication, Hooks, Before User Created, Postgres, schema public, function
-- tareas_before_user_created. A project with no account and no member yet lets its first account in (it becomes the admin)
create or replace function public.tareas_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if em <> '' and exists (select 1 from public.team_members m where lower(m.email) = em and m.revoked is null) then
    return '{}'::jsonb;
  end if;
  if not exists (select 1 from public.team_members) and not exists (select 1 from auth.users) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Esta cuenta no tiene acceso'));
end;
$$;

revoke all on function public.tareas_before_user_created(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.tareas_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The admin: the oldest account of the project, once (nothing to do when an admin exists or there is no account yet)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'created_at') then
    perform public.tareas_team_bootstrap();
  end if;
end;
$$;

-- PostgREST learns the new tables and functions at once
notify pgrst, 'reload schema';

-- ========== migrations/0014_notice_follow.sql ==========
-- Tareas: follow-up of the tasks sent with «Avisar a…» (decision 78, approved by the owner on 6 November).
--
-- The sender only needs to know when the recipient plans to do a task they were sent, and when it is done; nobody edits the other's
-- task. The recipient's task made with «Añadir a mis tareas» keeps the notice's id (its id is 'nt-' and the notice's id), so every device
-- of the recipient knows which notice it answers, with no new field in the task. Those devices write here, on the notice row:
--
--   * planned: the date of the recipient's task (null: no date). Waiting for someone (Por confirmar) counts as open.
--   * done: when the recipient completed it (null: open again, or not done yet).
--   * done_seen: when the server saw the completion (done going from null to a value), set here and never by a device. done itself comes
--     from the device's clock (a phone offline or asleep may send it hours later), so send-reminders measures lateness on done_seen.
--   * done_pushed: set by send-reminders when it has told the sender «Víctor ha completado una tarea que le enviaste» (nothing of the
--     task). A completion seen more than an hour before is marked without notifying. A task completed again after being reopened notifies
--     again, at most once every 4 hours per notice (as 0013's rule for the notices themselves): done_pushed goes back to null only when
--     it is empty or older than that.
--   * followed: when the recipient's app first wrote planned or done on this notice (even with the values it already had). Set here, never
--     by a device. A notice without it is not followed (a task added before 0.37.0, or by an app that does not follow), so the sender
--     reads «la ha añadido a sus tareas» and not «sin fecha prevista».
--   * dismissed (0013) is also set when the recipient takes the task out of their list; putting it back clears it again.
--
-- Who may change what: only the recipient (the update policy of 0013, team_notices_update_recipient) and only taken, dismissed, planned
-- and done (column grants); the trigger below refuses planned and done from anyone else as well, and the server functions (no user)
-- write done_pushed. The sender reads all of it through team_notices_select_own (0013), never the copy of the task.
--
-- Until this runs, the app works as in 0013: the sender sees «la ha añadido a sus tareas», and nothing is followed.
--
-- No statement of this file takes away an object of the database: it only creates, replaces or adds, so it is safe to run more than once.
-- Run after 0001_init.sql to 0013_team.sql, in the SQL Editor.

alter table public.team_notices add column if not exists planned date;          -- the date of the recipient's task, null without date
alter table public.team_notices add column if not exists done timestamptz;      -- when the recipient completed it (their device's clock), null while open
alter table public.team_notices add column if not exists done_seen timestamptz; -- when the server saw that completion
alter table public.team_notices add column if not exists done_pushed timestamptz; -- the sender was told (send-reminders)
alter table public.team_notices add column if not exists followed timestamptz;  -- the recipient's app follows this notice

-- What send-reminders looks for every minute: completed and not told yet
create index if not exists team_notices_done_push on public.team_notices (done) where done is not null and done_pushed is null;

-- On insert, the columns of the follow-up always start empty (the sender cannot claim a task done or followed). On update: planned and
-- done change only by the recipient (or the server itself, with no user), a completion never lies in the future, done_seen and
-- followed are kept as they were (only the triggers set them), and a new completion (done from null to a value) is seen now and makes
-- the sender be told again, unless they were told less than 4 hours ago
create or replace function public.tareas_notice_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.planned := null;
    new.done := null;
    new.done_seen := null;
    new.done_pushed := null;
    new.followed := null;
    return new;
  end if;
  if (new.planned is distinct from old.planned or new.done is distinct from old.done)
     and auth.uid() is not null and auth.uid() is distinct from old.recipient_id then
    raise exception 'tareas_notice_follow_recipient_only' using errcode = '42501';
  end if;
  new.done_seen := old.done_seen;
  new.followed := old.followed;
  if new.done is not null and new.done > now() + interval '5 minutes' then
    new.done := now();
  end if;
  if old.done is null and new.done is not null then
    new.done_seen := now();
    if old.done_pushed is null or old.done_pushed < now() - interval '4 hours' then
      new.done_pushed := null;
    else
      new.done_pushed := old.done_pushed;
    end if;
  end if;
  return new;
end;
$$;

-- followed: the first update that names planned or done (an UPDATE OF trigger fires even when the values do not change). It runs after
-- tareas_notice_follow (triggers of the same event run by name), which keeps the stored value
create or replace function public.tareas_notice_followed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.followed := coalesce(old.followed, now());
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_notices'::regclass and tgname = 'tareas_notice_follow') then
    create trigger tareas_notice_follow before insert or update on public.team_notices
      for each row execute function public.tareas_notice_follow();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_notices'::regclass and tgname = 'tareas_notice_followed') then
    create trigger tareas_notice_followed before update of planned, done on public.team_notices
      for each row execute function public.tareas_notice_followed();
  end if;
end;
$$;

-- The recipient may now also write planned and done (still only on their own rows: the update policy of 0013). The service role already
-- reads and updates the whole table (0013)
grant update (taken, dismissed, planned, done) on public.team_notices to authenticated;

notify pgrst, 'reload schema';
