-- Keep the monthly evaluation save command authenticated-only.
-- The function is SECURITY DEFINER and performs its own actor/branch checks,
-- but anon should not have an executable surface at all.
revoke all on function public.save_staff_monthly_evaluation_v5(uuid,jsonb) from public;
revoke execute on function public.save_staff_monthly_evaluation_v5(uuid,jsonb) from anon;
grant execute on function public.save_staff_monthly_evaluation_v5(uuid,jsonb) to authenticated;
