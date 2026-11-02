-- Tareas, decisions 38 and 39: tasks that repeat, and Ahora.
--
-- What this adds to public.tasks:
--   * repeat: the rule of a task that repeats, as text, null when it does not. The app writes and reads it; the database only keeps it.
--     Format (see js/core.js): '<rule>@<anchor>#<series>', for example 'W2:MO,TH@2026-11-02#k3f9a2c1' (every 2 weeks on Monday and
--     Thursday, counted from 2 November, series k3f9a2c1). The next task of a series is created by the device that completes one.
--   * focus: when the task was put in Ahora, null otherwise. The devices clear it at the start of each day.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps both values on each device and syncs the rest as before.
--
-- Run after 0001_init.sql, 0002_push.sql and 0003_attachments.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists repeat text;
alter table public.tasks add column if not exists focus timestamptz;

comment on column public.tasks.repeat is 'Decision 38: the repeat rule of the task, null when it does not repeat';
comment on column public.tasks.focus is 'Decision 39: when the task was put in Ahora, null otherwise';

-- PostgREST learns the new columns at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
