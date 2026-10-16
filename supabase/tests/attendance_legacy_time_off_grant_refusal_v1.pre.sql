-- Grants on a legacy time-off API changed after review (an extra grantee): the guard must refuse and revoke nothing.
create role reporting;
grant execute on function public.attendance_my_time_off_requests_v1() to reporting;
