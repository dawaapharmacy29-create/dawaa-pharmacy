-- Restore the same invocation path used by the staff-session-authenticated
-- attendance V2 RPC. Browser requests use Supabase anon role plus an
-- x-dawaa-session-token, validated by dawaa_session_account_id_v1().
-- EXECUTE alone does not authorize access: V3 still requires an active verified
-- staff actor AND per-employee row-scope validation.
-- This is an ACL-only repair; no business data, approval or salary changes.
DO $verify$
DECLARE
  v_definition text;
  v_session_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_cross_branch_biometric_events_v3';
  IF v_definition IS NULL
    OR position('dawaa_current_staff_account_id_strict()' in v_definition)=0
    OR position('dawaa_can_read_staff_attendance_log(r.person_id,r.schedule_branch)' in v_definition)=0
    OR position('coalesce(sa.can_login,false)=true' in v_definition)=0
  THEN
    RAISE EXCEPTION 'cross_branch_v3_staff_and_row_authorization_guards_missing';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_session_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='dawaa_session_account_id_v1';
  IF v_session_definition IS NULL
    OR position('staff_login_sessions' in v_session_definition)=0
    OR position('token_hash' in v_session_definition)=0
    OR position('expires_at > now()' in v_session_definition)=0
    OR position('revoked_at is null' in v_session_definition)=0
  THEN
    RAISE EXCEPTION 'verified_staff_session_token_guard_missing';
  END IF;
END;
$verify$;

GRANT EXECUTE ON FUNCTION public.list_cross_branch_biometric_events_v3(date,date,text,integer) TO anon;

DO $verify$
BEGIN
  IF NOT has_function_privilege('anon','public.list_cross_branch_biometric_events_v3(date,date,text,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.list_cross_branch_biometric_events_v3(date,date,text,integer)','EXECUTE')
  THEN
    RAISE EXCEPTION 'cross_branch_v3_staff_session_acl_not_restored';
  END IF;
END;
$verify$;
