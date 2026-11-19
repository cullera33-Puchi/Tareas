-- Tareas, v0.40.1: deleting from the shared tables (19 November, Enric's log).
--
-- The app marks a record deleted with an upsert that carries only id, deleted and modified. PostgreSQL checks NOT NULL on the row to
-- insert before it finds the conflict, so on shared_views, shared_members and shared_comments (task_id, user_id not null) every such mark
-- failed with «null value in column "task_id"», and the whole pass failed with it: nothing synced from that device. Now the trigger that
-- runs before the insert fills those columns from the row that already exists (or, for a view or a member, from its id task:user), so the
-- upsert reaches the conflict and only marks the row deleted, under the usual rules of each table.
--
-- No statement of this file removes an object of the database or a row. Safe to run more than once. Run after 0018_shared_comments.sql.

create or replace function public.tareas_shared_view_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    -- 0019: a deletion mark (id, deleted, modified) takes the columns the row already has; its id is task:user
    if new.task_id is null then
      new.task_id := coalesce((select v.task_id from public.shared_views v where v.id = new.id), split_part(new.id, ':', 1));
    end if;
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
    -- 0019: a deletion mark (id, deleted, modified) takes the columns the row already has; its id is task:user
    if new.task_id is null or new.user_id is null then
      select m.task_id, m.user_id into new.task_id, new.user_id from public.shared_members m where m.id = new.id;
      new.task_id := coalesce(new.task_id, split_part(new.id, ':', 1));
      new.user_id := coalesce(new.user_id, nullif(split_part(new.id, ':', 2), '')::uuid);
    end if;
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
  -- 0017: the service role (send-reminders, auth.uid() null) marks pushed; only a signed-in person other than the owner is held back
  if auth.uid() is not null and auth.uid() is distinct from towner then
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

create or replace function public.tareas_shared_comment_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    -- 0019: a deletion mark (id, deleted, modified) takes the columns the row already has
    if new.task_id is null then
      select c.task_id, c.kind, c.to_user into new.task_id, new.kind, new.to_user from public.shared_comments c where c.id = new.id;
      new.kind := coalesce(new.kind, 'comment');
    end if;
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

notify pgrst, 'reload schema';
