-- Tareas: the team (decision 63 b, c and d; details closed by the owner on 5 November, decision 71).
--
-- Access only by invitation. The owner of the project is the admin: he invites people by their email in Ajustes, Equipo, sees the
-- members (name, email, last access, storage used) and never their data. Each member sees only their own rows, as before; on top of
-- the rules by owner, every table now also asks for an active membership, so removing someone's access blocks their reads and writes
-- at once (no notice to the person). Their data are kept 30 days and then deleted by the function send-reminders.
--
-- What this adds:
--   * team_members: one row per authorized email (name, role admin or member, storage quota in bytes, invited, revoked, last access,
--     and the account's id once the person signs in). Nobody reads or writes it directly: the functions below do, with their checks.
--     The admin is never written here by hand: when no admin exists, the oldest account of the project becomes the admin (that is the
--     owner, who made the project), so no email is kept in the repository.
--   * tareas_team_role(uid) and the gates tareas_team_ok() and tareas_team_write_ok(): a restrictive policy on every table of the app
--     (and on the files of the bucket "attachments") that the permissive rules by owner cannot open. Writing the synced data also needs
--     the encryption key row of a member (decision 71.1: encryption is mandatory for invited members; the admin already has it).
--   * crypto_keys.ecdh_pub and ecdh_priv: each member's ECDH P-256 key pair. The public key (base64url, raw) is read by the other members
--     through the directory; the private key (PKCS #8) is stored encrypted with the member's own data key ('e1:'), so only their devices
--     open it.
--   * team_notices: «Avisar a…», a copy of a task encrypted for one member (ephemeral ECDH and AES-GCM, made on the sender's device).
--     The server allows one notice every 4 hours per task and person (tareas_notice_too_soon). The recipient reads it, and marks it taken
--     or dismissed; send-reminders pushes «<sender> te ha enviado una tarea», nothing of the task.
--   * team_feedback: «Enviar sugerencia o incidencia», encrypted for the admin's public key; only the admin reads it and sets its status
--     (nueva, vista, resuelta); send-reminders pushes «Nueva sugerencia» or «Nueva incidencia».
--   * The storage quota (63c): 50 MB per new member by default, the admin without limit; an upload to the bucket is refused once the
--     files of the member's folder would pass it. Space frees when a deleted attachment is purged (24 hours, 0003_attachments.sql).
--   * tareas_before_user_created(event): an Auth hook that lets new accounts in only with an invited email. The owner turns it on in
--     the dashboard (Authentication, Hooks, Before User Created, Postgres, public.tareas_before_user_created). The policies are the real
--     protection: without the hook a stranger can make an account, and still sees and writes nothing.
--   * tareas_team_to_remove() and tareas_team_remove(member): the removal 30 days after the access was removed, run by send-reminders
--     (it removes the files through the Storage API first); each removal is written to team_log.
--
-- Until this runs, the app works as before (one user) and Ajustes shows no Equipo section.
--
-- No statement of this file removes an object of the database: it only creates, replaces or adds, so it is safe to run more than once.
-- Run after 0001_init.sql to 0012_encryption.sql, in the SQL Editor.

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------

create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  name         text,
  role         text not null default 'member' check (role in ('admin', 'member')),
  quota        bigint default 52428800 check (quota is null or quota >= 0),  -- bytes; null: no limit (the admin)
  invited      timestamptz default now(),
  revoked      timestamptz,                                                   -- access removed: blocked at once, removed after 30 days
  last_access  timestamptz,
  user_id      uuid unique,                                                   -- the account, once the person signs in
  created      timestamptz not null default now()
);

create unique index if not exists team_members_email on public.team_members (lower(email));

comment on table public.team_members is 'Decision 63b: who may use the app; read and written only through the tareas_team_* functions';

alter table public.team_members enable row level security;   -- and no policies: only the functions (security definer) touch it
revoke all on public.team_members from anon, authenticated;

-- The log of the removals after 30 days (and of nothing else): what went, never any content
create table if not exists public.team_log (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  event   text not null,
  detail  jsonb
);
alter table public.team_log enable row level security;
revoke all on public.team_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- crypto_keys: the member's key pair for «Avisar a…» and the suggestions
-- ---------------------------------------------------------------------------

alter table public.crypto_keys add column if not exists ecdh_pub text;
alter table public.crypto_keys add column if not exists ecdh_priv text;

-- ---------------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------------

-- No admin yet: the oldest account of the project becomes the admin (the owner made the project and signed in first)
create or replace function public.tareas_team_bootstrap()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
begin
  if exists (select 1 from public.team_members m where m.role = 'admin') then
    return;
  end if;
  select a.id, a.email, coalesce(a.raw_user_meta_data ->> 'full_name', a.raw_user_meta_data ->> 'name') as nm
    into u from auth.users a order by a.created_at, a.id limit 1;
  if u.id is null then
    return;
  end if;
  insert into public.team_members (email, name, role, quota, user_id, invited)
  values (coalesce(u.email, u.id::text), u.nm, 'admin', null, u.id, now())
  on conflict do nothing;
  insert into public.team_log (event, detail) values ('admin', jsonb_build_object('user_id', u.id));
end;
$$;

-- The role of an account ('admin', 'member') or null when it has no access. An invitation not yet linked to an account matches the
-- account's confirmed email; a project with no admin at all lets its oldest account in as the admin
create or replace function public.tareas_team_role(p_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r text;
  em text;
begin
  if p_uid is null then
    return null;
  end if;
  select m.role into r from public.team_members m where m.user_id = p_uid and m.revoked is null;
  if found then
    return r;
  end if;
  if exists (select 1 from public.team_members m where m.user_id = p_uid) then
    return null;   -- removed
  end if;
  select lower(a.email) into em from auth.users a where a.id = p_uid and a.email_confirmed_at is not null;
  if em is not null then
    select m.role into r from public.team_members m where lower(m.email) = em and m.user_id is null and m.revoked is null;
    if found then
      return r;
    end if;
  end if;
  if not exists (select 1 from public.team_members m where m.role = 'admin')
     and p_uid = (select a.id from auth.users a order by a.created_at, a.id limit 1) then
    return 'admin';
  end if;
  return null;
end;
$$;

-- The gates of the policies: an active member; and, to write the synced data, a member with the encryption key row (or the admin)
create or replace function public.tareas_team_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tareas_team_role(auth.uid()) is not null;
$$;

create or replace function public.tareas_team_write_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r text := public.tareas_team_role(auth.uid());
begin
  if r is null then
    return false;
  end if;
  return r = 'admin' or exists (select 1 from public.crypto_keys k where k.owner_id = auth.uid());
end;
$$;

-- The admin, for the policies of team_feedback
create or replace function public.tareas_team_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tareas_team_role(auth.uid()) = 'admin';
$$;

revoke all on function public.tareas_team_bootstrap() from public, anon, authenticated;
revoke all on function public.tareas_team_role(uuid) from public, anon, authenticated;
grant execute on function public.tareas_team_ok() to authenticated;
grant execute on function public.tareas_team_write_ok() to authenticated;
grant execute on function public.tareas_team_is_admin() to authenticated;
revoke all on function public.tareas_team_ok() from public, anon;
revoke all on function public.tareas_team_write_ok() from public, anon;
revoke all on function public.tareas_team_is_admin() from public, anon;

-- ---------------------------------------------------------------------------
-- The storage quota (63c)
-- ---------------------------------------------------------------------------

-- The bytes of a member's folder in the bucket "attachments" (one object left out: the one an upload replaces)
create or replace function public.tareas_storage_used(p_uid uuid, p_except text default null)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0) into n
  from storage.objects o
  where o.bucket_id = 'attachments' and o.name like p_uid::text || '/%' and (p_except is null or o.name <> p_except);
  return n;
end;
$$;

-- A new or replaced object of the bucket "attachments" fits the caller's quota. o: the row (to_jsonb), whose metadata carries the size
-- once Storage knows it; before that a byte is counted, so a full folder takes nothing more
create or replace function public.tareas_storage_ok(o jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q bigint;
begin
  if (o ->> 'bucket_id') is distinct from 'attachments' then
    return true;
  end if;
  if not public.tareas_team_write_ok() then
    return false;   -- no access, or a member without the encryption key row (a file would go up in clear)
  end if;
  select m.quota into q from public.team_members m where m.user_id = uid and m.revoked is null;
  if not found then
    -- linked on the next tareas_team_me; until then the invitation's quota (the bootstrap admin has none)
    select m.quota into q from public.team_members m join auth.users a on lower(a.email) = lower(m.email)
      where a.id = uid and m.user_id is null and m.revoked is null;
  end if;
  if q is null then
    return true;
  end if;
  return public.tareas_storage_used(uid, o ->> 'name') + greatest(coalesce((o -> 'metadata' ->> 'size')::bigint, 0), 1) <= q;
end;
$$;

revoke all on function public.tareas_storage_used(uuid, text) from public, anon, authenticated;
revoke all on function public.tareas_storage_ok(jsonb) from public, anon;
grant execute on function public.tareas_storage_ok(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The gate on every table of the app (restrictive: the rules by owner still decide which rows)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  chk text;
begin
  foreach t in array array['spaces', 'projects', 'tasks', 'voice_notes', 'attachments', 'subtasks', 'project_notes', 'contacts',
                           'push_subscriptions', 'inbox', 'shortcut_keys', 'crypto_keys'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    -- the synced data need the key row of a member; the account's own settings (devices, Siri key, the key row itself) only access
    chk := case when t in ('push_subscriptions', 'inbox', 'shortcut_keys', 'crypto_keys')
      then '(select public.tareas_team_ok())' else '(select public.tareas_team_write_ok())' end;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_team_gate') then
      execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select public.tareas_team_ok())) with check (%s)',
        t || '_team_gate', t, chk);
    end if;
  end loop;
end;
$$;

-- The files: only an active member reaches the bucket, and an upload must fit the quota
do $$
begin
  if to_regclass('storage.objects') is not null and not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tareas_attachments_team_gate'
  ) then
    create policy tareas_attachments_team_gate on storage.objects as restrictive for all to authenticated
      using (bucket_id <> 'attachments' or (select public.tareas_team_ok()))
      with check (bucket_id <> 'attachments' or public.tareas_storage_ok(to_jsonb(objects.*)));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The app's calls
-- ---------------------------------------------------------------------------

-- The signed-in account: {id, role, name, email, quota, used}, or null without access. Links an invitation to the account on its first
-- call (the confirmed email of the account, the name of its Google profile when the invitation has none) and notes the last access
create or replace function public.tareas_team_me()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.team_members;
  em text;
  nm text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  perform public.tareas_team_bootstrap();
  select * into m from public.team_members t where t.user_id = uid;
  if not found then
    select lower(a.email), coalesce(a.raw_user_meta_data ->> 'full_name', a.raw_user_meta_data ->> 'name') into em, nm
      from auth.users a where a.id = uid and a.email_confirmed_at is not null;
    if em is not null then
      update public.team_members t set user_id = uid, name = coalesce(nullif(t.name, ''), nm)
        where lower(t.email) = em and t.user_id is null and t.revoked is null
        returning * into m;
    end if;
  end if;
  if m.id is null or m.revoked is not null then
    return null;
  end if;
  if m.last_access is null or m.last_access < now() - interval '5 minutes' then
    update public.team_members t set last_access = now() where t.id = m.id;
  end if;
  return jsonb_build_object('id', m.id, 'role', m.role, 'name', m.name, 'email', m.email, 'quota', m.quota,
    'used', public.tareas_storage_used(uid));
end;
$$;

-- The directory: the active members' names and emails (only that), with their public key, for «Avisar a…» and the suggestions
create or replace function public.tareas_team_directory()
returns table (user_id uuid, name text, email text, pub text, admin boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.tareas_team_role(auth.uid()) is null then
    return;
  end if;
  return query
    select m.user_id, m.name, m.email, k.ecdh_pub, m.role = 'admin'
    from public.team_members m left join public.crypto_keys k on k.owner_id = m.user_id
    where m.revoked is null and m.user_id is not null
    order by lower(coalesce(nullif(m.name, ''), m.email));
end;
$$;

-- Admin only: every member, removed ones included, with the storage used (never any of their data)
create or replace function public.tareas_team_list()
returns table (id uuid, email text, name text, role text, quota bigint, used bigint, invited timestamptz, revoked timestamptz,
               last_access timestamptz, joined boolean, has_key boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  return query
    select m.id, m.email, m.name, m.role, m.quota, case when m.user_id is null then 0::bigint else public.tareas_storage_used(m.user_id) end,
      m.invited, m.revoked, m.last_access, m.user_id is not null,
      exists (select 1 from public.crypto_keys k where k.owner_id = m.user_id)
    from public.team_members m
    order by m.role, m.revoked nulls first, lower(coalesce(nullif(m.name, ''), m.email));
end;
$$;

-- Admin only: invites an email (or invites again one whose access was removed and not yet deleted). Returns the member's id
create or replace function public.tareas_team_invite(p_email text, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(trim(coalesce(p_email, '')));
  nm text := nullif(left(trim(coalesce(p_name, '')), 80), '');
  rid uuid;
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  if em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(em) > 254 then
    raise exception 'tareas_team_bad_email' using errcode = '22023';
  end if;
  update public.team_members m set revoked = null, invited = now(), name = coalesce(nm, m.name)
    where lower(m.email) = em returning m.id into rid;
  if rid is null then
    insert into public.team_members (email, name) values (em, nm) returning id into rid;
  end if;
  return rid;
end;
$$;

-- Admin only: a member's quota in bytes (null: no limit)
create or replace function public.tareas_team_quota(p_id uuid, p_quota bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  if p_quota is not null and p_quota < 0 then
    raise exception 'tareas_team_bad_quota' using errcode = '22023';
  end if;
  update public.team_members set quota = p_quota where id = p_id;
end;
$$;

-- Admin only: removes a member's access at once (never the admin's). Their devices stop receiving notifications
create or replace function public.tareas_team_revoke(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.team_members;
begin
  if public.tareas_team_role(auth.uid()) is distinct from 'admin' then
    raise exception 'tareas_team_admin_only' using errcode = '42501';
  end if;
  select * into m from public.team_members t where t.id = p_id;
  if not found or m.role = 'admin' or m.user_id = auth.uid() then
    raise exception 'tareas_team_not_removable' using errcode = '42501';
  end if;
  update public.team_members t set revoked = coalesce(t.revoked, now()) where t.id = p_id;
  if m.user_id is not null then
    update public.push_subscriptions s set deleted = now(), modified = greatest(now(), s.modified + interval '1 millisecond')
      where s.owner_id = m.user_id and s.deleted is null;
  end if;
end;
$$;

revoke all on function public.tareas_team_me() from public, anon;
revoke all on function public.tareas_team_directory() from public, anon;
revoke all on function public.tareas_team_list() from public, anon;
revoke all on function public.tareas_team_invite(text, text) from public, anon;
revoke all on function public.tareas_team_quota(uuid, bigint) from public, anon;
revoke all on function public.tareas_team_revoke(uuid) from public, anon;
grant execute on function public.tareas_team_me() to authenticated;
grant execute on function public.tareas_team_directory() to authenticated;
grant execute on function public.tareas_team_list() to authenticated;
grant execute on function public.tareas_team_invite(text, text) to authenticated;
grant execute on function public.tareas_team_quota(uuid, bigint) to authenticated;
grant execute on function public.tareas_team_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- team_notices: «Avisar a…»
-- ---------------------------------------------------------------------------

create table if not exists public.team_notices (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null default auth.uid(),
  recipient_id  uuid not null,
  task_ref      text not null,              -- the sender's task id: only for the limit of one notice every 4 hours per task and person
  payload       text not null check (length(payload) <= 200000),   -- the copy of the task, encrypted for the recipient
  created       timestamptz not null default now(),
  pushed        timestamptz,                -- the notification went (send-reminders)
  taken         timestamptz,                -- «Añadir a mis tareas»
  dismissed     timestamptz                 -- «Descartar»
);

create index if not exists team_notices_recipient on public.team_notices (recipient_id, created) where taken is null and dismissed is null;
create index if not exists team_notices_limit on public.team_notices (sender_id, recipient_id, task_ref, created);
create index if not exists team_notices_push on public.team_notices (created) where pushed is null;

-- What a client sends is checked here: the sender is the caller, the recipient an active member and not the caller, and the same task
-- to the same person waits 4 hours. created, pushed, taken and dismissed always start as the server says
create or replace function public.tareas_notice_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last timestamptz;
begin
  if auth.uid() is not null then
    new.sender_id := auth.uid();
  end if;
  new.created := now();
  new.pushed := null;
  new.taken := null;
  new.dismissed := null;
  if new.recipient_id = new.sender_id or public.tareas_team_role(new.recipient_id) is null then
    raise exception 'tareas_notice_bad_recipient' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(new.sender_id::text || new.recipient_id::text || new.task_ref));
  select max(n.created) into last from public.team_notices n
    where n.sender_id = new.sender_id and n.recipient_id = new.recipient_id and n.task_ref = new.task_ref;
  if last is not null and last > now() - interval '4 hours' then
    raise exception 'tareas_notice_too_soon' using errcode = 'P0001', detail = to_char((last + interval '4 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_notices'::regclass and tgname = 'tareas_notice_before') then
    create trigger tareas_notice_before before insert on public.team_notices
      for each row execute function public.tareas_notice_before();
  end if;
end;
$$;

alter table public.team_notices enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_notices' and policyname = 'team_notices_select_own') then
    create policy team_notices_select_own on public.team_notices for select to authenticated
      using ((recipient_id = (select auth.uid()) or sender_id = (select auth.uid())) and (select public.tareas_team_ok()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_notices' and policyname = 'team_notices_insert_own') then
    create policy team_notices_insert_own on public.team_notices for insert to authenticated
      with check (sender_id = (select auth.uid()) and (select public.tareas_team_ok()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_notices' and policyname = 'team_notices_update_recipient') then
    create policy team_notices_update_recipient on public.team_notices for update to authenticated
      using (recipient_id = (select auth.uid()) and (select public.tareas_team_ok()))
      with check (recipient_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on public.team_notices from anon, authenticated;
grant select, insert on public.team_notices to authenticated;
grant update (taken, dismissed) on public.team_notices to authenticated;
grant select, update on public.team_notices to service_role;

-- ---------------------------------------------------------------------------
-- team_feedback: «Enviar sugerencia o incidencia»
-- ---------------------------------------------------------------------------

create table if not exists public.team_feedback (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null default auth.uid(),
  recipient_id  uuid not null,              -- the admin whose public key encrypted it
  kind          text not null check (kind in ('sugerencia', 'incidencia')),
  payload       text not null check (length(payload) <= 600000),   -- text, version, device and, if the person ticked it, the app's log
  created       timestamptz not null default now(),
  status        text not null default 'nueva' check (status in ('nueva', 'vista', 'resuelta')),
  pushed        timestamptz
);

create index if not exists team_feedback_recipient on public.team_feedback (recipient_id, created);
create index if not exists team_feedback_push on public.team_feedback (created) where pushed is null;

-- The sender is the caller, the recipient the admin, it starts as nueva; at most 20 an hour per person
create or replace function public.tareas_feedback_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.sender_id := auth.uid();
  end if;
  new.created := now();
  new.status := 'nueva';
  new.pushed := null;
  if public.tareas_team_role(new.recipient_id) is distinct from 'admin' then
    raise exception 'tareas_feedback_bad_recipient' using errcode = '22023';
  end if;
  if (select count(*) from public.team_feedback f where f.sender_id = new.sender_id and f.created > now() - interval '1 hour') >= 20 then
    raise exception 'tareas_feedback_too_many' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.team_feedback'::regclass and tgname = 'tareas_feedback_before') then
    create trigger tareas_feedback_before before insert on public.team_feedback
      for each row execute function public.tareas_feedback_before();
  end if;
end;
$$;

alter table public.team_feedback enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_feedback' and policyname = 'team_feedback_insert_member') then
    create policy team_feedback_insert_member on public.team_feedback for insert to authenticated
      with check (sender_id = (select auth.uid()) and (select public.tareas_team_ok()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_feedback' and policyname = 'team_feedback_select_admin') then
    create policy team_feedback_select_admin on public.team_feedback for select to authenticated
      using (recipient_id = (select auth.uid()) and (select public.tareas_team_is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_feedback' and policyname = 'team_feedback_update_admin') then
    create policy team_feedback_update_admin on public.team_feedback for update to authenticated
      using (recipient_id = (select auth.uid()) and (select public.tareas_team_is_admin()))
      with check (recipient_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on public.team_feedback from anon, authenticated;
grant select, insert on public.team_feedback to authenticated;
grant update (status) on public.team_feedback to authenticated;
grant select, update on public.team_feedback to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: a member learns of a task sent to them at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_notices'
  ) then
    alter publication supabase_realtime add table public.team_notices;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- send-reminders (service role): who may be notified, and the removal after 30 days
-- ---------------------------------------------------------------------------

-- Of the given accounts, those with access (a reminder of an account whose access was removed is not sent)
create or replace function public.tareas_team_allowed(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u from unnest(coalesce(p_ids, '{}'::uuid[])) as u where public.tareas_team_role(u) is not null;
$$;

-- Members (never the admin) whose access was removed more than 30 days ago, with up to 200 of their files still in Storage.
-- The function removes those files and calls tareas_team_remove once a member has none left
create or replace function public.tareas_team_to_remove()
returns table (member_id uuid, user_id uuid, files text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select m.id, m.user_id,
      case when m.user_id is null then '{}'::text[] else coalesce((
        select array_agg(o.name) from (
          select s.name from storage.objects s where s.bucket_id = 'attachments' and s.name like m.user_id::text || '/%' order by s.name limit 200
        ) o), '{}'::text[]) end
    from public.team_members m
    where m.role = 'member' and m.revoked is not null and m.revoked < now() - interval '30 days'
    order by m.revoked
    limit 5;
end;
$$;

-- Deletes everything of one such member: their rows in every table, the notices sent or received, the suggestions they sent, the
-- membership and the account itself. Checks again that the access was removed more than 30 days ago and that it is not an admin.
-- Returns what it removed (counts), also written to team_log
create or replace function public.tareas_team_remove(p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.team_members;
  t text;
  n bigint;
  out jsonb := '{}'::jsonb;
begin
  select * into m from public.team_members x where x.id = p_member for update;
  if not found or m.role <> 'member' or m.revoked is null or m.revoked >= now() - interval '30 days' then
    return jsonb_build_object('skipped', true);
  end if;
  if m.user_id is not null then
    if exists (select 1 from public.team_members x where x.user_id = m.user_id and x.id <> m.id) then
      return jsonb_build_object('skipped', true);
    end if;
    foreach t in array array['subtasks', 'attachments', 'voice_notes', 'tasks', 'project_notes', 'projects', 'spaces', 'contacts',
                             'push_subscriptions', 'inbox', 'shortcut_keys', 'crypto_keys'] loop
      if to_regclass('public.' || t) is not null then
        execute format('delete from public.%I where owner_id = $1', t) using m.user_id;
        get diagnostics n = row_count;
        if n > 0 then
          out := out || jsonb_build_object(t, n);
        end if;
      end if;
    end loop;
    delete from public.team_notices x where x.sender_id = m.user_id or x.recipient_id = m.user_id;
    get diagnostics n = row_count;
    if n > 0 then out := out || jsonb_build_object('team_notices', n); end if;
    delete from public.team_feedback x where x.sender_id = m.user_id;
    get diagnostics n = row_count;
    if n > 0 then out := out || jsonb_build_object('team_feedback', n); end if;
    begin
      delete from auth.users a where a.id = m.user_id;
      get diagnostics n = row_count;
      out := out || jsonb_build_object('account', n);
    exception when others then
      out := out || jsonb_build_object('account_kept', sqlerrm);
    end;
  end if;
  delete from public.team_members x where x.id = m.id;
  insert into public.team_log (event, detail)
    values ('removed', jsonb_build_object('member', m.id, 'user_id', m.user_id, 'revoked', m.revoked, 'rows', out));
  return out;
end;
$$;

revoke all on function public.tareas_team_allowed(uuid[]) from public, anon, authenticated;
revoke all on function public.tareas_team_to_remove() from public, anon, authenticated;
revoke all on function public.tareas_team_remove(uuid) from public, anon, authenticated;
grant execute on function public.tareas_team_allowed(uuid[]) to service_role;
grant execute on function public.tareas_team_to_remove() to service_role;
grant execute on function public.tareas_team_remove(uuid) to service_role;
grant select on public.team_members to service_role;

-- ---------------------------------------------------------------------------
-- The Auth hook «Before User Created»: only invited emails make an account
-- ---------------------------------------------------------------------------

-- The owner turns it on in the dashboard: Authentication, Hooks, Before User Created, Postgres, schema public, function
-- tareas_before_user_created. A project with no account and no member yet lets its first account in (it becomes the admin)
create or replace function public.tareas_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if em <> '' and exists (select 1 from public.team_members m where lower(m.email) = em and m.revoked is null) then
    return '{}'::jsonb;
  end if;
  if not exists (select 1 from public.team_members) and not exists (select 1 from auth.users) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Esta cuenta no tiene acceso'));
end;
$$;

revoke all on function public.tareas_before_user_created(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.tareas_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The admin: the oldest account of the project, once (nothing to do when an admin exists or there is no account yet)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'created_at') then
    perform public.tareas_team_bootstrap();
  end if;
end;
$$;

-- PostgREST learns the new tables and functions at once
notify pgrst, 'reload schema';
