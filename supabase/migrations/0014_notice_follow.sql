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
