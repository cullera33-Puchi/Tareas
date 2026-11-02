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
