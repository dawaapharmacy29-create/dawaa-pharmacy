-- Custom staff login uses the anon Data API role. The RPC still validates
-- the active manager and manage_payroll permission before approving a day.
grant execute on function public.approve_attendance_day_resolution_v2(uuid,date,numeric,text) to anon;
