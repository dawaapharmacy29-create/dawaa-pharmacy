-- Close client access to the seven legacy two-stage time-off APIs.
--
-- Production (2026-10-16): attendance_request_time_off_v1, attendance_branch_review_time_off_v1,
-- attendance_gm_review_time_off_v1, attendance_branch_time_off_queue_v1, attendance_gm_time_off_queue_v1,
-- attendance_my_time_off_requests_v1 and attendance_cancel_time_off_request_v1 are SECURITY DEFINER with EXECUTE for
-- PUBLIC/anon/authenticated. They form a parallel write path to staff_time_off_requests that bypasses the current flow
-- (create/cancel_staff_time_off_request_v1, decide_staff_time_off_request_v3, time_off_request_preflight_v3,
-- list_staff_time_off_requests_v1); its branch stage authorizes with a read check that also accepts the requester.
-- No client (main or this branch) calls them (scripts/check-hr-domain-boundary-v1.cjs forbids it), no cron job, view or
-- policy references them, the edge logs show 0 calls in 7 days, and no request was ever created through them
-- (no policy_version 'two_stage_v1' rows). hr_canonical_architecture_health_v1 counts them as legacy_api_exposure.
--
-- This migration only revokes client EXECUTE (service_role keeps it). Definitions, the current time-off flow, table
-- grants/RLS and every row are unchanged; SECURITY DEFINER callers (attendance_unified_approval_decide_v1) run as the
-- owner and are unaffected. Safe to re-run: the guard accepts the reviewed grants before or after this revoke and
-- refuses any other definition or grant state.
--
-- Rollback (grants only):
--   grant execute on function <each of the seven signatures below> to public, anon, authenticated;

do $guard$
declare
  v_fn record;
  v_hash text;
  v_grantees text;
begin
  for v_fn in
    select * from (values
      ('public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text)', '22b5aac65578ee1d8bad8652ba6ae310'),
      ('public.attendance_branch_review_time_off_v1(uuid,text,text)', '80b510255e428d523e24b051cd1b23d1'),
      ('public.attendance_gm_review_time_off_v1(uuid,text,text)', '8a9e4a2125623f2238deb747646e2d51'),
      ('public.attendance_branch_time_off_queue_v1()', 'bba7540f6a1c4d060bfe8b71af12e066'),
      ('public.attendance_gm_time_off_queue_v1()', 'f3504a98f3c3c37a90460d68f4d8182d'),
      ('public.attendance_my_time_off_requests_v1()', '12b2d9177fce570db14caf25e259bca7'),
      ('public.attendance_cancel_time_off_request_v1(uuid)', 'e424cfb2a0b3f6f77e682567ba5d5a69')
    ) as f(signature, reviewed_hash)
  loop
    if to_regprocedure(v_fn.signature) is null then
      raise exception 'legacy time-off API % is missing; regenerate this migration', v_fn.signature;
    end if;
    v_hash := md5(btrim(regexp_replace(pg_get_functiondef(to_regprocedure(v_fn.signature)), '\s+', ' ', 'g')));
    if v_hash <> v_fn.reviewed_hash then
      raise exception 'legacy time-off API % differs from the reviewed definition; regenerate this migration', v_fn.signature;
    end if;
    -- EXECUTE grantees other than the owner: the reviewed Production state, or the state this migration leaves.
    select string_agg(g.name, ',' order by g.name collate "C")
      into v_grantees
    from pg_proc p, aclexplode(p.proacl) a,
      lateral (select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as name) g
    where p.oid = to_regprocedure(v_fn.signature) and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    if v_grantees is distinct from 'PUBLIC,anon,authenticated,service_role' and v_grantees is distinct from 'service_role' then
      raise exception 'legacy time-off API % has unreviewed grants (%); regenerate this migration', v_fn.signature, coalesce(v_grantees, 'none');
    end if;
  end loop;
end;
$guard$;

revoke execute on function public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text) from public, anon, authenticated;
revoke execute on function public.attendance_branch_review_time_off_v1(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.attendance_gm_review_time_off_v1(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.attendance_branch_time_off_queue_v1() from public, anon, authenticated;
revoke execute on function public.attendance_gm_time_off_queue_v1() from public, anon, authenticated;
revoke execute on function public.attendance_my_time_off_requests_v1() from public, anon, authenticated;
revoke execute on function public.attendance_cancel_time_off_request_v1(uuid) from public, anon, authenticated;

grant execute on function public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text) to service_role;
grant execute on function public.attendance_branch_review_time_off_v1(uuid,text,text) to service_role;
grant execute on function public.attendance_gm_review_time_off_v1(uuid,text,text) to service_role;
grant execute on function public.attendance_branch_time_off_queue_v1() to service_role;
grant execute on function public.attendance_gm_time_off_queue_v1() to service_role;
grant execute on function public.attendance_my_time_off_requests_v1() to service_role;
grant execute on function public.attendance_cancel_time_off_request_v1(uuid) to service_role;

notify pgrst, 'reload schema';
