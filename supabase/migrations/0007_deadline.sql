-- Tareas, decision 48a (M2): the deadline of a task (Fecha límite), apart from its work date.
--
-- What this adds to public.tasks:
--   * deadline: the day the task is due (a date, no time), null when it has none. It is not the work date (date): postponing the task,
--     the start of a day (rollOver) or moving it on the calendar never change it. The app shows it on the rows («Entrega jueves»),
--     brings the open task to Hoy from that day on, and moves it with the date when a task of a series creates the next one.
--     It has no notification of its own (the reminder is for that).
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps the deadline on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0006_project_notes.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists deadline date;

comment on column public.tasks.deadline is 'Decision 48a: the deadline of the task (Fecha límite), null when it has none';

-- PostgREST learns the new column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
