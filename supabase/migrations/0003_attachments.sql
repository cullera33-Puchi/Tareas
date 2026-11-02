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
