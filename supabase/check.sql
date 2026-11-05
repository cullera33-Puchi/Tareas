-- Tareas: comprobación de que Supabase tiene todo lo necesario.
-- Pegar en SQL Editor y pulsar Run. Cada fila dice OK o FALTA; si alguna dice FALTA, ejecutar all.sql y volver a comprobar.
with checks(orden, pieza, ok) as (
  select 1,  'Tabla spaces', to_regclass('public.spaces') is not null
  union all select 2,  'Tabla projects', to_regclass('public.projects') is not null
  union all select 3,  'Tabla tasks', to_regclass('public.tasks') is not null
  union all select 4,  'Tabla voice_notes', to_regclass('public.voice_notes') is not null
  union all select 5,  'Reglas de acceso activas en las tablas', not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','push_subscriptions','push_keys','inbox','shortcut_keys','contacts','crypto_keys','team_members','team_notices','team_feedback','team_log') and not c.relrowsecurity)
  union all select 6,  'Notificaciones: tabla push_subscriptions (0002)', to_regclass('public.push_subscriptions') is not null
  union all select 7,  'Notificaciones: tabla privada push_keys (0002)', to_regclass('public.push_keys') is not null
  union all select 8,  'Notificaciones: columna tasks.reminder_sent (0002)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='reminder_sent')
  union all select 9,  'Notificaciones: tarea programada cada minuto (0002)', exists (select 1 from cron.job where jobname='tareas-send-reminders')
  union all select 10, 'Adjuntos: tabla attachments (0003)', to_regclass('public.attachments') is not null
  union all select 11, 'Adjuntos: carpeta privada de archivos (0003)', exists (select 1 from storage.buckets where id='attachments' and not public)
  union all select 12, 'Adjuntos: función de borrado a las 24 horas (0003)', exists (select 1 from pg_proc where proname='tareas_attachments_to_purge')
  union all select 13, 'Repetir: columna tasks.repeat (0004)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='repeat')
  union all select 14, 'Ahora: columna tasks.focus (0004)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='focus')
  union all select 15, 'Por confirmar: columna tasks.waiting_for (0004)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='waiting_for')
  union all select 16, 'Por confirmar: estado waiting admitido (0004)', exists (select 1 from pg_constraint where conname='tasks_status_check' and pg_get_constraintdef(oid) like '%waiting%')
  union all select 17, 'Pasos: tabla subtasks (0005)', to_regclass('public.subtasks') is not null
  union all select 18, 'Notas de proyecto: tabla project_notes (0006)', to_regclass('public.project_notes') is not null
  union all select 19, 'Fecha límite: columna tasks.deadline (0007)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='deadline')
  union all select 20, 'Tiempo estimado: columna tasks.estimate (0008)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='estimate')
  union all select 21, 'Aplazamientos: columna tasks.postponed (0008)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='postponed')
  union all select 22, 'Aplazamientos: columna tasks.carried_since (0008)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='carried_since')
  union all select 23, 'Día cerrado: columna spaces.closed_day (0009)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='spaces' and column_name='closed_day')
  union all select 24, 'Tiempo real: tablas publicadas', (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes')) = 7
  union all select 25, 'Siri y Atajo: tabla inbox (0010)', to_regclass('public.inbox') is not null
  union all select 26, 'Siri y Atajo: tabla shortcut_keys (0010)', to_regclass('public.shortcut_keys') is not null
  union all select 27, 'Siri y Atajo: inbox en tiempo real (0010)', exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inbox')
  union all select 28, 'Responsable: columna tasks.responsible (0011)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='responsible')
  union all select 29, 'Contactos: tabla contacts (0011)', to_regclass('public.contacts') is not null
  union all select 30, 'Contactos: contacts en tiempo real (0011)', exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='contacts')
  union all select 31, 'Cifrado: tabla crypto_keys (0012)', to_regclass('public.crypto_keys') is not null
  union all select 32, 'Cifrado: regla que rechaza texto sin cifrar en las siete tablas (0012)', (select count(*) from pg_trigger where tgname='tareas_require_cipher' and not tgisinternal) = 7
  union all select 33, 'Cifrado: la app puede vaciar las frases de Siri (0012)', to_regclass('public.inbox') is not null and has_column_privilege('authenticated', 'public.inbox', 'text', 'UPDATE')
  union all select 34, 'Cifrado: columna crypto_keys.migrated (0012)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_keys' and column_name='migrated')
  union all select 35, 'Equipo: tabla team_members (0013)', to_regclass('public.team_members') is not null
  union all select 36, 'Equipo: hay un administrador (0013)', case when to_regclass('public.team_members') is null then false else query_to_xml('select 1 as n from public.team_members where role = ''admin'' and revoked is null', false, true, '')::text like '%<n>%' or not exists (select 1 from auth.users) end
  union all select 37, 'Equipo: acceso solo para miembros en todas las tablas (0013)', (select count(*) from pg_policies where policyname like '%team_gate' and permissive='RESTRICTIVE') >= 13
  union all select 38, 'Equipo: claves para Avisar a (0013)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='crypto_keys' and column_name='ecdh_pub')
  union all select 39, 'Equipo: Avisar a, tabla team_notices (0013)', to_regclass('public.team_notices') is not null
  union all select 40, 'Equipo: sugerencias e incidencias, tabla team_feedback (0013)', to_regclass('public.team_feedback') is not null
  union all select 41, 'Equipo: cupo de almacenamiento (0013)', exists (select 1 from pg_proc where proname='tareas_storage_ok')
  union all select 42, 'Equipo: filtro de altas por invitación (0013)', exists (select 1 from pg_proc where proname='tareas_before_user_created')
  union all select 43, 'Equipo: borrado a los 30 días (0013)', exists (select 1 from pg_proc where proname='tareas_team_remove')
)
select orden as "N.º", pieza as "Pieza", case when ok then 'OK' else 'FALTA' end as "Estado"
from checks order by orden;
