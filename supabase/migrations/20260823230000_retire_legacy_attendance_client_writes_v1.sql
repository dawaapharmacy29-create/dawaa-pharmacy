-- Retire client writes to the legacy attendance table.
-- Modern attendance capture writes to public.staff_attendance_logs.
-- Keep legacy SELECT policies temporarily while report consumers are migrated.

drop policy if exists "attendance_auth_insert" on public.attendance;
drop policy if exists "attendance_insert_app" on public.attendance;
drop policy if exists "attendance_auth_update" on public.attendance;
drop policy if exists "attendance_update_app" on public.attendance;
