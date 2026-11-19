-- Tareas, v0.40.0 (decision 90): comments and in-app reminders in shared tasks, and each person's own review day.
--
--   * shared_comments: a conversation inside a shared task. Each row is a comment (kind 'comment') or a reminder sent through the app
--     (kind 'nudge', to_user the person reminded, group_id the reminders sent together). body is encrypted on the devices with the task's
--     key ('s1:', as the title of shared_tasks), so the server reads nothing. Everyone in the task reads them; each person writes and
--     deletes only their own; the person reminded marks a reminder seen (seen), and nothing else of another's. No notification: the app
--     counts unread comments on the row and shows a reminder as a window when the person opens it.
--   * shared_views.read_at: when this person last read the task's comments (their own part, synced between their devices).
--   * shared_views.review: this person's review day while the task waits for someone (Por confirmar, decision 89); the common date of
--     the task stays as it is for everyone else.
--
-- Team gate as in 0016: an active member; writing needs the key row. No statement of this file removes an object of the database or a
-- row. Safe to run more than once. Run after 0017_shared_fix.sql.

alter table public.shared_views add column if not exists review date;
alter table public.shared_views add column if not exists read_at timestamptz;
comment on column public.shared_views.review is 'v0.40.0: this person''s review day while the task is in Por confirmar';
comment on column public.shared_views.read_at is 'v0.40.0: when this person last read the task''s comments';

create table if not exists public.shared_comments (
  id         text primary key,
  task_id    text not null references public.shared_tasks (id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null default 'comment' check (kind in ('comment', 'nudge')),
  body       text,
  to_user    uuid,
  group_id   text,
  seen       timestamptz,
  created    timestamptz,
  modified   timestamptz not null,
  deleted    timestamptz,
  server_ts  timestamptz not null default now()
);
comment on table public.shared_comments is 'Decision 90: comments and in-app reminders of a shared task; body sealed with the task''s key';

create index if not exists shared_comments_server_ts on public.shared_comments (server_ts, id);
create index if not exists shared_comments_task on public.shared_comments (task_id);

-- Server time; newest modified wins; the author writes the body and deletes; the person reminded only marks it seen
create or replace function public.tareas_shared_comment_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(auth.uid(), new.owner_id);
    new.seen := null;
    if new.kind = 'nudge' then
      if new.to_user is null or new.to_user = new.owner_id then
        raise exception 'tareas_nudge_to: a reminder goes to another person' using errcode = 'P0001';
      end if;
    else
      new.to_user := null;
    end if;
    if new.body is not null and new.body <> '' and left(new.body, 3) <> 's1:' then
      raise exception 'tareas_plaintext_refused: shared_comments.body must be sealed' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.modified < old.modified then
    return null;
  end if;
  new.task_id := old.task_id;
  new.owner_id := old.owner_id;
  new.kind := old.kind;
  new.to_user := old.to_user;
  new.group_id := old.group_id;
  new.created := old.created;
  if auth.uid() is not null and auth.uid() is distinct from old.owner_id then
    new.body := old.body;
    new.deleted := old.deleted;
    if auth.uid() is distinct from old.to_user then
      new.seen := old.seen;
    end if;
  elsif auth.uid() is not null then
    new.seen := old.seen;
  end if;
  if new.body is distinct from old.body and new.body is not null and new.body <> '' and left(new.body, 3) <> 's1:' then
    raise exception 'tareas_plaintext_refused: shared_comments.body must be sealed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.shared_comments'::regclass and tgname = 'tareas_shared_comment_before') then
    create trigger tareas_shared_comment_before before insert or update on public.shared_comments
      for each row execute function public.tareas_shared_comment_before();
  end if;
end;
$$;

alter table public.shared_comments enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_comments' and policyname = 'shared_comments_select_in') then
    create policy shared_comments_select_in on public.shared_comments for select to authenticated
      using (public.tareas_shared_in(task_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_comments' and policyname = 'shared_comments_insert_own') then
    create policy shared_comments_insert_own on public.shared_comments for insert to authenticated
      with check (owner_id = (select auth.uid()) and public.tareas_shared_in(task_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_comments' and policyname = 'shared_comments_update_own') then
    create policy shared_comments_update_own on public.shared_comments for update to authenticated
      using (public.tareas_shared_in(task_id) and (owner_id = (select auth.uid()) or to_user = (select auth.uid())))
      with check (public.tareas_shared_in(task_id) and (owner_id = (select auth.uid()) or to_user = (select auth.uid())));
  end if;
  if to_regprocedure('public.tareas_team_ok()') is not null
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_comments' and policyname = 'shared_comments_team_gate') then
    create policy shared_comments_team_gate on public.shared_comments as restrictive for all to authenticated
      using ((select public.tareas_team_ok())) with check ((select public.tareas_team_write_ok()));
  end if;
end;
$$;

grant select, insert, update on public.shared_comments to authenticated;
revoke all on public.shared_comments from anon;

-- Realtime: everyone in the task hears a new comment (the policies above decide who)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_comments') then
    alter publication supabase_realtime add table public.shared_comments;
  end if;
end;
$$;

notify pgrst, 'reload schema';
