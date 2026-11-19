-- Tareas, v0.39.1: two fixes to the shared tasks of decision 88 (0016_shared.sql), found with the first real use on 19 November.
--
--   * The notification «Enric ha compartido una tarea contigo» never went: the write rule of shared_members kept pushed as it was for
--     anyone but the task's owner, the service role included (auth.uid() null), so send-reminders claimed the row every minute, nothing
--     stayed marked and nothing was sent. Now only a signed-in person other than the owner is held back.
--   * Por confirmar is each person's own (decided by the owner on 19 November): shared_views.waiting says that this person waits for
--     someone; the common status of shared_tasks says pending. The views of the tasks that waited until now (status 'waiting', set by
--     their owner) keep waiting for their owner, with a new modified so every device takes it.
--
-- No statement of this file removes an object of the database or a row. Safe to run more than once. Run after 0016_shared.sql.

alter table public.shared_views add column if not exists waiting boolean not null default false;
comment on column public.shared_views.waiting is 'v0.39.1: this person keeps the task in Por confirmar (the common status says pending)';

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

-- The tasks that waited until now: their owner's view keeps waiting (once: a view already marked is left alone)
update public.shared_views v set waiting = true, modified = now()
  from public.shared_tasks t
  where t.id = v.task_id and t.status = 'waiting' and v.owner_id = t.owner_id and not v.waiting;

-- The people who already added a task they were told nothing about: nothing to tell them now
update public.shared_members m set pushed = now()
  where m.pushed is null and exists (select 1 from public.shared_views v where v.task_id = m.task_id and v.owner_id = m.user_id);

notify pgrst, 'reload schema';
