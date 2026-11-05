-- Tareas, decision 48c and the roadmap's list of contacts (approved by the owner on 4 November): Responsable and Contactos.
--
-- What this adds:
--   * tasks.responsible: who does the task when it is not the owner, free text (a name), null when nobody. The rows show it in grey,
--     the lists filter by it and «Enviar recordatorio» writes to that person.
--   * contacts: one row per person of Responsable and Esperando a, with the same conventions as the other tables (text ids made on the
--     device, owner_id, created, modified, deleted, server_ts, the write trigger "newest modified wins", row level security by owner,
--     realtime). name: how the tasks call the person; email and phone: optional, they choose how «Enviar recordatorio» goes (WhatsApp with
--     a phone, mail with an email, the share sheet otherwise). The app makes a contact with just the name the first time a new name is
--     set as Responsable or Esperando a; renaming a contact renames that name in the tasks; deleting one leaves the tasks as they are.
--     name is nullable, like every content column of the other tables: a deletion goes up as a row with only id, deleted and modified,
--     and the app never sends a contact without a name.
--
-- Until this runs, the app keeps the contacts and the responsible of each task on each device (it logs once that the table or the column
-- is missing) and syncs the rest as before.
--
-- Run after 0001_init.sql to 0010_inbox.sql, in the SQL Editor. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- tasks.responsible
-- ---------------------------------------------------------------------------

alter table public.tasks add column if not exists responsible text;

comment on column public.tasks.responsible is 'Decision 48c: who does the task when it is not the owner, free text, null when nobody';

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

create table if not exists public.contacts (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text,
  email       text,
  phone       text,
  created     timestamptz,
  modified    timestamptz not null,
  deleted     timestamptz,
  server_ts   timestamptz not null default now()
);

comment on table public.contacts is 'Decision 48c: the people of Responsable and Esperando a, one row each';

-- Same write rules as the other tables: server time, owner kept, an older copy never overwrites a newer one (0001_init.sql)
drop trigger if exists tareas_before_write on public.contacts;
create trigger tareas_before_write before insert or update on public.contacts
  for each row execute function public.tareas_before_write();

-- Pull: "my rows changed after the cursor", in (server_ts, id) order
create index if not exists contacts_owner_server_ts on public.contacts (owner_id, server_ts, id);

-- ---------------------------------------------------------------------------
-- Row level security: each user reads and writes only their own rows
-- ---------------------------------------------------------------------------

alter table public.contacts enable row level security;
drop policy if exists contacts_select_own on public.contacts;
drop policy if exists contacts_insert_own on public.contacts;
drop policy if exists contacts_update_own on public.contacts;
drop policy if exists contacts_delete_own on public.contacts;
create policy contacts_select_own on public.contacts for select to authenticated using (owner_id = (select auth.uid()));
create policy contacts_insert_own on public.contacts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy contacts_update_own on public.contacts for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy contacts_delete_own on public.contacts for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.contacts to authenticated;
revoke all on public.contacts from anon;

-- ---------------------------------------------------------------------------
-- Realtime: the other devices learn of a contact added, changed or deleted at once
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
  ) then
    alter publication supabase_realtime add table public.contacts;
  end if;
end;
$$;

-- PostgREST learns the new table and column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
