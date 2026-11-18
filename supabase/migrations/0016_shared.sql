-- Tareas, decision 88 (design point 43, closed again with the owner on 18 November): tasks shared between members of the team.
--
-- A shared task is one task for everyone in it: its content is common and any participant edits and completes it; how each person
-- organises it is their own. «Compartir con…» replaces «Avisar a…» (team_notices stays for the notices already sent).
--
--   * shared_tasks: the common part. owner_id is who shared it (only they add or remove people and only they delete it for everyone);
--     title, notes and steps (a JSON list) are encrypted on the devices with a key of the task ('s1:', AES-GCM), never with an account's key,
--     so every participant opens them and the server reads nothing. Plain columns: date, deadline, priority, estimate, status, completed,
--     the Aplazada mark and its counters. Newest modified wins, as in every table.
--   * shared_members: one row per person and task, the owner's included. key: the task's key sealed for that person ('t1:', the ECDH of
--     «Avisar a…»). The owner adds and removes (removed); the person leaves (left_at). Each participant reads the rows of their tasks; a
--     person always reads their own row, so a device learns that it was removed. pushed: the notification «Enric ha compartido una tarea
--     contigo» was sent.
--   * shared_views: each person's own way of keeping the task (space, project, Ahora, reminder, responsible and Esperando a). Only its
--     owner reads it; responsible and waiting_for are encrypted with the person's own key ('e1:').
--   * shared_events: completed or postponed by a participant (a write that changes modified: the start of a day moving a task never does).
--     send-reminders tells the other participants, nothing of the task. Only the service role reads it.
--
-- Team gate: every table asks for an active member (0013_team.sql); writing needs the key row. The member being added must be an active
-- member of the team.
--
-- No statement of this file removes an object of the database or a row: it only creates, replaces or adds, so it is safe to run more than
-- once. Run after 0001_init.sql to 0015_someday.sql, in the SQL Editor.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.shared_tasks (
  id            text primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text,
  notes         text,
  steps         text,
  date          date,
  deadline      date,
  priority      text,
  estimate      int,
  status        text,
  completed     timestamptz,
  carried       boolean,
  postponed     int,
  carried_since date,
  created       timestamptz,
  modified      timestamptz not null,
  deleted       timestamptz,
  server_ts     timestamptz not null default now()
);

create table if not exists public.shared_members (
  id         text primary key,
  task_id    text not null references public.shared_tasks (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text,
  left_at    timestamptz,
  removed    timestamptz,
  pushed     timestamptz,
  created    timestamptz,
  modified   timestamptz not null,
  deleted    timestamptz,
  server_ts  timestamptz not null default now()
);

create table if not exists public.shared_views (
  id             text primary key,
  task_id        text not null,
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  space_id       text,
  project_id     text,
  focus          timestamptz,
  reminder       timestamptz,
  reminder_sent  timestamptz,
  responsible    text,
  waiting_for    text,
  created        timestamptz,
  modified       timestamptz not null,
  deleted        timestamptz,
  server_ts      timestamptz not null default now()
);

create table if not exists public.shared_events (
  id         bigint generated always as identity primary key,
  task_id    text not null,
  actor_id   uuid,
  kind       text not null,
  created    timestamptz not null default now(),
  pushed     timestamptz
);

comment on table public.shared_tasks is 'Decision 88: the common part of a task shared between members of the team';
comment on table public.shared_members is 'Decision 88: who is in a shared task, with the task key sealed for each person';
comment on table public.shared_views is 'Decision 88: each person''s own way of keeping a shared task (space, project, Ahora, reminder)';
comment on table public.shared_events is 'Decision 88: a shared task completed or postponed, for send-reminders to tell the others';

create index if not exists shared_tasks_server_ts on public.shared_tasks (server_ts, id);
create index if not exists shared_members_task on public.shared_members (task_id);
create index if not exists shared_members_user on public.shared_members (user_id, server_ts);
create index if not exists shared_views_owner_server_ts on public.shared_views (owner_id, server_ts, id);
create index if not exists shared_views_reminder_due on public.shared_views (reminder) where reminder_sent is null and deleted is null;
create index if not exists shared_events_pending on public.shared_events (id) where pushed is null;

-- ---------------------------------------------------------------------------
-- Who is in a task (the policies call these; security definer so they see past the rules)
-- ---------------------------------------------------------------------------

create or replace function public.tareas_shared_owner(p_task text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.owner_id from public.shared_tasks t where t.id = p_task;
$$;

-- An active participant of the task: their row, neither left nor removed. The owner always is
create or replace function public.tareas_shared_in(p_task text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.shared_tasks t where t.id = p_task and t.owner_id = auth.uid())
      or exists (select 1 from public.shared_members m where m.task_id = p_task and m.user_id = auth.uid()
                   and m.left_at is null and m.removed is null and m.deleted is null);
$$;

-- A person who can be added: an active member of the team
create or replace function public.tareas_shared_can_add(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tareas_team_role(p_user) is not null;
$$;

revoke all on function public.tareas_shared_owner(text) from public, anon;
revoke all on function public.tareas_shared_in(text) from public, anon;
revoke all on function public.tareas_shared_can_add(uuid) from public, anon;
grant execute on function public.tareas_shared_owner(text) to authenticated;
grant execute on function public.tareas_shared_in(text) to authenticated;
grant execute on function public.tareas_shared_can_add(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Write triggers
-- ---------------------------------------------------------------------------

-- shared_tasks: server time; the owner never changes; newest modified wins; only the owner deletes it for everyone; the texts always
-- encrypted with the task's key (an unchanged value passes, as in tareas_require_cipher)
create or replace function public.tareas_shared_task_before()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  v text;
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
  else
    new.owner_id := old.owner_id;
    if new.modified < old.modified then
      return null;
    end if;
    if new.deleted is distinct from old.deleted and auth.uid() is distinct from old.owner_id then
      new.deleted := old.deleted;
    end if;
  end if;
  foreach col in array array['title', 'notes', 'steps'] loop
    v := to_jsonb(new) ->> col;
    if v is null or v = '' or left(v, 3) = 's1:' then
      continue;
    end if;
    if tg_op = 'UPDATE' and (to_jsonb(old) ->> col) is not distinct from v then
      continue;
    end if;
    raise exception 'tareas_plaintext_refused: shared_tasks.% must be encrypted with the task key', col using errcode = 'P0001';
  end loop;
  return new;
end;
$$;

-- What the others are told: completed, or moved to a later day, by a write that changed modified (the start of a day keeps it)
create or replace function public.tareas_shared_task_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.modified <= old.modified or new.deleted is not null then
    return null;
  end if;
  if new.status = 'done' and old.status is distinct from 'done' then
    insert into public.shared_events (task_id, actor_id, kind) values (new.id, auth.uid(), 'done');
  elsif new.status is distinct from 'done' and new.date is not null and old.date is not null and new.date > old.date then
    insert into public.shared_events (task_id, actor_id, kind) values (new.id, auth.uid(), 'later');
  end if;
  return null;
end;
$$;

-- shared_members: server time; newest modified wins; the owner of the task writes key, removed and who; the person only left_at
create or replace function public.tareas_shared_member_before()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  towner uuid := public.tareas_shared_owner(coalesce(new.task_id, old.task_id));
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
    if new.key is not null and new.key <> '' and left(new.key, 3) <> 't1:' then
      raise exception 'tareas_plaintext_refused: shared_members.key must be sealed' using errcode = 'P0001';
    end if;
    if new.user_id = towner then
      new.pushed := coalesce(new.pushed, now());
    end if;
    return new;
  end if;
  if new.modified < old.modified then
    return null;
  end if;
  new.task_id := old.task_id;
  new.user_id := old.user_id;
  new.owner_id := old.owner_id;
  if auth.uid() is distinct from towner then
    new.key := old.key;
    new.removed := old.removed;
    new.deleted := old.deleted;
    new.pushed := old.pushed;
  end if;
  -- the person leaves (left_at); the owner may only add them again (clear it)
  if auth.uid() is distinct from old.user_id and not (auth.uid() is not distinct from towner and new.left_at is null) then
    new.left_at := old.left_at;
  end if;
  -- added again after being removed (or after leaving): told again
  if (old.removed is not null and new.removed is null) or (old.left_at is not null and new.left_at is null) then
    new.pushed := null;
  end if;
  return new;
end;
$$;

-- A person added (or added again) gets the task on their next pull: its row is touched, so its server time is after their cursor
create or replace function public.tareas_shared_member_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (old.removed is not null and new.removed is null) or (old.left_at is not null and new.left_at is null) then
    update public.shared_tasks t set server_ts = now() where t.id = new.task_id;
  end if;
  return null;
end;
$$;

-- shared_views: as the tables of 0001 (owner kept, newest wins), the reminder's mark as in 0002, and the texts with the person's own key
create or replace function public.tareas_shared_view_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
  else
    new.owner_id := old.owner_id;
    if new.modified < old.modified then
      return null;
    end if;
    if new.reminder is distinct from old.reminder then
      if new.reminder_sent is not distinct from old.reminder_sent then
        new.reminder_sent := null;
      end if;
    elsif new.reminder_sent is null then
      new.reminder_sent := old.reminder_sent;
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.shared_tasks'::regclass and tgname = 'tareas_shared_task_before') then
    create trigger tareas_shared_task_before before insert or update on public.shared_tasks
      for each row execute function public.tareas_shared_task_before();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.shared_tasks'::regclass and tgname = 'tareas_shared_task_after') then
    create trigger tareas_shared_task_after after update on public.shared_tasks
      for each row execute function public.tareas_shared_task_after();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.shared_members'::regclass and tgname = 'tareas_shared_member_before') then
    create trigger tareas_shared_member_before before insert or update on public.shared_members
      for each row execute function public.tareas_shared_member_before();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.shared_members'::regclass and tgname = 'tareas_shared_member_after') then
    create trigger tareas_shared_member_after after insert or update on public.shared_members
      for each row execute function public.tareas_shared_member_after();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.shared_views'::regclass and tgname = 'tareas_shared_view_before') then
    create trigger tareas_shared_view_before before insert or update on public.shared_views
      for each row execute function public.tareas_shared_view_before();
  end if;
  -- responsible and waiting_for with the person's own key, when encryption is on (0012)
  if to_regprocedure('public.tareas_require_cipher()') is not null
     and not exists (select 1 from pg_trigger where tgrelid = 'public.shared_views'::regclass and tgname = 'tareas_require_cipher') then
    create trigger tareas_require_cipher before insert or update on public.shared_views
      for each row execute function public.tareas_require_cipher();
  end if;
end;
$$;

-- tareas_require_cipher (0012) learns the columns of shared_views; the other tables keep theirs
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
    when 'shared_views' then array['responsible', 'waiting_for']
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

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.shared_tasks enable row level security;
alter table public.shared_members enable row level security;
alter table public.shared_views enable row level security;
alter table public.shared_events enable row level security;

do $$
begin
  -- shared_tasks: its participants read and write it; only the owner creates it
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_tasks' and policyname = 'shared_tasks_select_in') then
    create policy shared_tasks_select_in on public.shared_tasks for select to authenticated
      using (owner_id = (select auth.uid()) or public.tareas_shared_in(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_tasks' and policyname = 'shared_tasks_insert_own') then
    create policy shared_tasks_insert_own on public.shared_tasks for insert to authenticated
      with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_tasks' and policyname = 'shared_tasks_update_in') then
    create policy shared_tasks_update_in on public.shared_tasks for update to authenticated
      using (owner_id = (select auth.uid()) or public.tareas_shared_in(id))
      with check (owner_id = (select auth.uid()) or public.tareas_shared_in(id));
  end if;

  -- shared_members: a person's own row always; the rows of the tasks they are in; the owner adds members of the team
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_members' and policyname = 'shared_members_select_in') then
    create policy shared_members_select_in on public.shared_members for select to authenticated
      using (user_id = (select auth.uid()) or public.tareas_shared_in(task_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_members' and policyname = 'shared_members_insert_owner') then
    create policy shared_members_insert_owner on public.shared_members for insert to authenticated
      with check (public.tareas_shared_owner(task_id) = (select auth.uid()) and public.tareas_shared_can_add(user_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_members' and policyname = 'shared_members_update_in') then
    create policy shared_members_update_in on public.shared_members for update to authenticated
      using (user_id = (select auth.uid()) or public.tareas_shared_owner(task_id) = (select auth.uid()))
      with check (user_id = (select auth.uid()) or public.tareas_shared_owner(task_id) = (select auth.uid()));
  end if;

  -- shared_views: each person's own rows, as the tables of 0001
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_views' and policyname = 'shared_views_select_own') then
    create policy shared_views_select_own on public.shared_views for select to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_views' and policyname = 'shared_views_insert_own') then
    create policy shared_views_insert_own on public.shared_views for insert to authenticated with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_views' and policyname = 'shared_views_update_own') then
    create policy shared_views_update_own on public.shared_views for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;

  -- The team's gate (0013): an active member; writing needs the key row
  if to_regprocedure('public.tareas_team_ok()') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_tasks' and policyname = 'shared_tasks_team_gate') then
      create policy shared_tasks_team_gate on public.shared_tasks as restrictive for all to authenticated
        using ((select public.tareas_team_ok())) with check ((select public.tareas_team_write_ok()));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_members' and policyname = 'shared_members_team_gate') then
      create policy shared_members_team_gate on public.shared_members as restrictive for all to authenticated
        using ((select public.tareas_team_ok())) with check ((select public.tareas_team_write_ok()));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_views' and policyname = 'shared_views_team_gate') then
      create policy shared_views_team_gate on public.shared_views as restrictive for all to authenticated
        using ((select public.tareas_team_ok())) with check ((select public.tareas_team_write_ok()));
    end if;
  end if;
end;
$$;

grant select, insert, update on public.shared_tasks to authenticated;
grant select, insert, update on public.shared_members to authenticated;
grant select, insert, update on public.shared_views to authenticated;
revoke all on public.shared_tasks from anon;
revoke all on public.shared_members from anon;
revoke all on public.shared_views from anon;
revoke all on public.shared_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the participants' devices hear the changes (the policies above decide who)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['shared_tasks', 'shared_members', 'shared_views'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- PostgREST learns the new tables at once
notify pgrst, 'reload schema';
