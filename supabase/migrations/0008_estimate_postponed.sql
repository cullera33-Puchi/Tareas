-- Tareas, decision 56: the estimated time of a task and how often it was put off (points 53 and 54 of the design).
--
-- What this adds to public.tasks:
--   * estimate: the time the task takes, in minutes (15, 30, 60 or 240, «medio día»), null when not said. The rows show it in grey and
--     «¿Qué hago ahora?» picks the tasks that fit in the time chosen.
--   * postponed: how many times the open task went to a later day while it was already due (its date was today or earlier): the start
--     of a day, Aplazar, Cerrar el día, the review of the carried tasks, a drag in the calendar, the date pickers. Null (or none) at first.
--   * carried_since: the first day the task was due when it was first counted, null until then. With postponed it marks the tasks that
--     keep being put off («Aplazada 4 veces», «Desde el martes 27»).
--   Completing a task keeps both counters (its history); a new task, a copy and the next one of a series start without them.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. The start of a day counts without touching modified, as it moves the date: equal times are accepted.
-- Until this runs, the app keeps these values on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0007_deadline.sql, in the SQL Editor. Safe to run more than once.

alter table public.tasks add column if not exists estimate integer;
alter table public.tasks add column if not exists postponed integer;
alter table public.tasks add column if not exists carried_since date;

comment on column public.tasks.estimate is 'Decision 56: the estimated time of the task in minutes, null when not said';
comment on column public.tasks.postponed is 'Decision 56: how many times the open task went to a later day while it was due, null at first';
comment on column public.tasks.carried_since is 'Decision 56: the first day the task was due when it was first put off, null until then';

-- PostgREST learns the new columns at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
