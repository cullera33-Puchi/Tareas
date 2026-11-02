-- Tareas, decisions 38, 39 and 41: tasks that repeat, Ahora, and the status Por confirmar.
--
-- What this adds to public.tasks:
--   * repeat: the rule of a task that repeats, as text, null when it does not. The app writes and reads it; the database only keeps it.
--     Format (see js/core.js): '<rule>@<anchor>#<series>', for example 'W2:MO,TH@2026-11-02#k3f9a2c1' (every 2 weeks on Monday and
--     Thursday, counted from 2 November, series k3f9a2c1). The next task of a series is created by the device that completes one.
--   * focus: when the task was put in Ahora, null otherwise. The devices clear it at the start of each day.
--   * status may also be 'waiting' (Por confirmar, between pending and done): the check of 0001_init.sql is replaced by a wider one.
--   * waiting_for: who or what a waiting task waits for (Esperando a), free text, null when not given.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps these values on each device (a waiting task goes up as pending) and syncs the
-- rest as before.
--
-- Run after 0001_init.sql, 0002_push.sql and 0003_attachments.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists repeat text;
alter table public.tasks add column if not exists focus timestamptz;
alter table public.tasks add column if not exists waiting_for text;

-- The status check: 0001 created it unnamed, so PostgreSQL called it tasks_status_check; dropped and made again, so running twice is harmless
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('pending', 'waiting', 'done'));

comment on column public.tasks.repeat is 'Decision 38: the repeat rule of the task, null when it does not repeat';
comment on column public.tasks.focus is 'Decision 39: when the task was put in Ahora, null otherwise';
comment on column public.tasks.waiting_for is 'Decision 41: who or what a task Por confirmar waits for';

-- PostgREST learns the new columns at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
