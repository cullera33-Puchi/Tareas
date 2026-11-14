-- Tareas, decision 85: Algún día, the place for ideas and tasks without a date that are not to be seen every day.
--
-- What this adds to public.tasks:
--   * someday: the day the task was put in Algún día (a date, no time), null when it is not there. While it is set, the task has no date
--     and is pending, the app keeps it out of Hoy, Todas, Sin fecha, the counts and the suggestions; a date, a reminder, Ahora or
--     Por confirmar take it out again (the app clears the column). A device on a version before it sees such a task as one without a date.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security, the team gate and realtime already cover every
-- column of the table, and a date is never encrypted. Until this runs, the app keeps Algún día on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0014_notice_follow.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists someday date;

comment on column public.tasks.someday is 'Decision 85: the day the task was put in Algún día, null when it is not there';

-- PostgREST learns the new column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
