-- Tareas, v0.40.1: marking a reminder seen (19 November, Jorge's log).
--
-- The app sends every change as an upsert. PostgreSQL runs the trigger before insert on the proposed row even when the id already
-- exists and the upsert ends as an update. On shared_comments that trigger set owner_id to the person writing and checked that a
-- reminder goes to another person: when the person reminded marked it seen, owner_id and to_user were both theirs, the check refused
-- it («tareas_nudge_to») and the whole pass failed with it: nothing synced from that device. It also emptied seen in the proposed row,
-- so the mark would have been lost. Now, when the row already exists, the trigger before insert leaves the proposed row as it comes:
-- the upsert reaches the conflict and the trigger before update applies its rules (author, person reminded, encryption, newest wins).
-- A plain insert with an id that exists still fails on the primary key.
--
-- No statement of this file removes an object of the database or a row. Safe to run more than once. Run after 0019_shared_delete_fix.sql.

create or replace function public.tareas_shared_comment_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_ts := now();
  if tg_op = 'INSERT' then
    -- 0020: the row exists, so this upsert ends as an update: its rules are those of the update below
    if exists (select 1 from public.shared_comments c where c.id = new.id) then
      if new.task_id is null then
        select c.task_id, c.kind into new.task_id, new.kind from public.shared_comments c where c.id = new.id;
      end if;
      new.owner_id := coalesce(auth.uid(), new.owner_id);
      return new;
    end if;
    -- 0019: a deletion mark (id, deleted, modified) of a row this database never had takes what it can
    if new.task_id is null then
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
