-- 2026-10-20: enforce explicit anon revocation on an already-created V3 reader.
-- Supabase default function ACL can explicitly grant anon EXECUTE after
-- REVOKE FROM PUBLIC. This migration is idempotent and touches no business data.
REVOKE ALL ON FUNCTION public.list_cross_branch_biometric_events_v3(date,date,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_cross_branch_biometric_events_v3(date,date,text,integer) FROM anon;
DO $verify$
BEGIN
  IF has_function_privilege('anon','public.list_cross_branch_biometric_events_v3(date,date,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'cross_branch_v3_anon_execute_must_be_revoked';
  END IF;
  IF NOT has_function_privilege('authenticated','public.list_cross_branch_biometric_events_v3(date,date,text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'cross_branch_v3_authenticated_execute_missing';
  END IF;
END;
$verify$;
