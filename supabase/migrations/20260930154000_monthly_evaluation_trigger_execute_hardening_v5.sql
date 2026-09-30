-- Harden trigger helper exposure for Monthly Evaluation V5.
-- Trigger functions are internal-only and must not be callable through PostgREST RPC.

revoke all on function public.trg_monthly_evaluation_audit_immutable_v5()
  from public, anon, authenticated;

grant execute on function public.trg_monthly_evaluation_audit_immutable_v5()
  to service_role;

notify pgrst,'reload schema';
