-- Tareas: todas las migraciones seguidas (0001 a 0010).
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
