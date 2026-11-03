-- Tareas: the day closed on every device (Cerrar el día, owner's decision of 3 November).
--
-- What this adds to public.spaces:
--   * closed_day: the day Cerrar el día was confirmed in that space, null when it is open. The day is closed while closed_day is today
--     (on the device's clock): Hoy then shows tomorrow's tasks on every device, under «Día cerrado» and «Reabrir hoy». A value of a past
--     day means open, so midnight opens the day again without anything to clean up. Setting or clearing it updates the space's modified.
--
-- Nothing else changes: the write trigger "newest modified wins", the row level security and realtime of 0001_init.sql already cover
-- every column of the table. Until this runs, the app keeps the closed day on each device and syncs the rest as before.
--
-- Run after 0001_init.sql to 0008_estimate_postponed.sql, in the SQL Editor. Safe to run more than once.

alter table public.spaces add column if not exists closed_day date;

comment on column public.spaces.closed_day is 'The day Cerrar el día was confirmed in this space, null when open; closed while it is today';

-- PostgREST learns the new column at once (otherwise it may take a moment to reload its schema cache)
notify pgrst, 'reload schema';
