-- Retire duplicated legacy two-stage time-off workflow.
-- Canonical time-off domain is staff_time_off_requests through:
-- create_staff_time_off_request_v1 -> time_off_request_preflight_v3 -> decide_staff_time_off_request_v3.
-- Historical rows remain untouched.

revoke execute on function public.attendance_request_time_off_v1(text,date,date,time,time,text)
  from public,anon,authenticated;
revoke execute on function public.attendance_branch_review_time_off_v1(uuid,text,text)
  from public,anon,authenticated;
revoke execute on function public.attendance_gm_review_time_off_v1(uuid,text,text)
  from public,anon,authenticated;
revoke execute on function public.attendance_branch_time_off_queue_v1()
  from public,anon,authenticated;
revoke execute on function public.attendance_gm_time_off_queue_v1()
  from public,anon,authenticated;
revoke execute on function public.attendance_my_time_off_requests_v1()
  from public,anon,authenticated;
revoke execute on function public.attendance_cancel_time_off_request_v1(uuid)
  from public,anon,authenticated;

comment on function public.attendance_request_time_off_v1(text,date,date,time,time,text)
  is 'LEGACY RETIRED: use create_staff_time_off_request_v1 via canonical time-off service.';
comment on function public.attendance_branch_review_time_off_v1(uuid,text,text)
  is 'LEGACY RETIRED: use decide_staff_time_off_request_v3.';
comment on function public.attendance_gm_review_time_off_v1(uuid,text,text)
  is 'LEGACY RETIRED: use decide_staff_time_off_request_v3.';
