-- Tareas: follow-up of the tasks sent with «Avisar a…» (decision 78, approved by the owner on 6 November).
--
-- The sender only needs to know when the recipient plans to do a task they were sent, and when it is done; nobody edits the other's
-- task. The recipient's task made with «Añadir a mis tareas» keeps the notice's id (its id is 'nt-' and the notice's id), so every device
-- of the recipient knows which notice it answers, with no new field in the task. Those devices write here, on the notice row:
--
--   * planned: the date of the recipient's task (null: no date). Waiting for someone (Por confirmar) counts as open.
--   * done: when the recipient completed it (null: open again, or not done yet).
--   * done_pushed: set by send-reminders when it has told the sender «Víctor ha completado una tarea que le enviaste» (nothing of the
--     task). A completion found more than an hour late is marked without notifying. It goes back to null by itself whenever done goes
--     from null to a value, so a task completed again after being reopened notifies again.
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
alter table public.team_notices add column if not exists done timestamptz;      -- when the recipient completed it, null while open
alter table public.team_notices add column if not exists done_pushed timestamptz; -- the sender was told (send-reminders)

-- What send-reminders looks for every minute: completed and not told yet
create index if not exists team_notices_done_push on public.team_notices (done) where done is not null and done_pushed is null;

-- On insert, the three columns always start empty (the sender cannot claim a task done); on update, planned and done change only by the
-- recipient, a completion never lies in the future, and a new completion (done from null to a value) makes the sender be told again
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
    new.done_pushed := null;
    return new;
  end if;
  if (new.planned is distinct from old.planned or new.done is distinct from old.done)
     and auth.uid() is not null and auth.uid() is distinct from old.recipient_id then
    raise exception 'tareas_notice_follow_recipient_only' using errcode = '42501';
  end if;
  if new.done is not null and new.done > now() + interval '5 minutes' then
    new.done := now();
  end if;
  if old.done is null and new.done is not null then
    new.done_pushed := null;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_notices'::regclass and tgname = 'tareas_notice_follow') then
    create trigger tareas_notice_follow before insert or update on public.team_notices
      for each row execute function public.tareas_notice_follow();
  end if;
end;
$$;

-- The recipient may now also write planned and done (still only on their own rows: the update policy of 0013). The service role already
-- reads and updates the whole table (0013)
grant update (taken, dismissed, planned, done) on public.team_notices to authenticated;
