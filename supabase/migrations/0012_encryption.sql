-- Tareas: end-to-end encryption (decision 63a, approved by the owner on 4 November).
--
-- The app encrypts on the device what the user writes (task titles and notes, names, steps, project notes, contacts...) before it goes
-- up; this database only holds ciphertext for those columns: text that starts with 'e1:'. Dates, reminders, priority, status, ids,
-- counts and the rest stay plain. Without the password, the server copy cannot be read; there is no recovery code.
--
-- What this adds:
--   * crypto_keys: one row per user with the account's data key, wrapped (AES-KW) by a key derived from the encryption password
--     (PBKDF2-SHA256): kid (the key id, random), salt, iterations and wrapped, all base64url. A device unwraps it with the password
--     and keeps the key; changing the password updates salt and wrapped (the data key, and so the data, stay the same). The row
--     existing means "encryption on" for that user. Each user reads, inserts and updates only their own row; nobody deletes it.
--   * tareas_require_cipher(): a trigger on the synced tables. When the row's owner has a crypto_keys row, a value of an encrypted
--     column that is new (an insert, or an update that changes it) must be empty or start with 'e1:'; anything else raises
--     'tareas_plaintext_refused'. This stops a device still on an older version from writing plain text after encryption was turned
--     on (the app shows «Actualiza la app: el cifrado está activado»). A value that does not change passes, so marking a not yet
--     encrypted row as deleted works. The columns of each table are listed inside the function (not as trigger arguments), so a later
--     version can change the list with create or replace, without recreating the triggers.
--   * inbox: the signed-in user may also set text and url, so the app empties a Siri phrase once its task exists (the task goes up
--     encrypted).
--
-- Until this runs, the app works as before and Ajustes, Cifrado says that it cannot be activated.
--
-- Run after 0001_init.sql to 0011_contacts.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- crypto_keys
-- ---------------------------------------------------------------------------

create table if not exists public.crypto_keys (
  owner_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kid         text not null,
  salt        text not null,
  iterations  int not null,
  wrapped     text not null,
  created     timestamptz default now(),
  modified    timestamptz default now()
);

comment on table public.crypto_keys is 'Decision 63a: each user''s data key, wrapped by the encryption password; the row means encryption on';

alter table public.crypto_keys enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crypto_keys' and policyname = 'crypto_keys_select_own') then
    create policy crypto_keys_select_own on public.crypto_keys for select to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crypto_keys' and policyname = 'crypto_keys_insert_own') then
    create policy crypto_keys_insert_own on public.crypto_keys for insert to authenticated with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crypto_keys' and policyname = 'crypto_keys_update_own') then
    create policy crypto_keys_update_own on public.crypto_keys for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on public.crypto_keys from anon, authenticated;
grant select, insert, update on public.crypto_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Plain text refused once encryption is on
-- ---------------------------------------------------------------------------

-- Runs after tareas_before_write (triggers of the same kind fire in name order), so owner_id is set and an older copy, which that
-- trigger skips, never gets here. security definer: the check reads crypto_keys whoever writes (the service role too)
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

do $$
declare
  t text;
begin
  foreach t in array array['spaces', 'projects', 'tasks', 'voice_notes', 'subtasks', 'project_notes', 'contacts'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = 'tareas_require_cipher'
    ) then
      execute format(
        'create trigger tareas_require_cipher before insert or update on public.%I '
        'for each row execute function public.tareas_require_cipher()', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- inbox: the app empties a phrase once its task exists
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.inbox') is not null then
    grant update (text, url) on public.inbox to authenticated;
  end if;
end;
$$;

-- PostgREST learns the new table at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
