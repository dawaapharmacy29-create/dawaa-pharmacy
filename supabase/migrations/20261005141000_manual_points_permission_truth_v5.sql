-- Manual points are a financial authority, not a generic operational-manager privilege.
-- Require the canonical permission truth for manual rewards/deductions/adjustments.

create or replace function public.trg_manual_points_permission_truth_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(new.source,'') in ('manual_admin','penalty_incentive')
     and coalesce(new.status,'active') in ('active','approved','pending')
     and not public.dawaa_current_actor_can(array['manage_points','manage_payroll']) then
    raise exception 'not_authorized_for_manual_points'
      using errcode='42501',
            detail='Manual rewards, deductions, and adjustments require manage_points or manage_payroll permission.';
  end if;
  return new;
end;
$function$;

drop trigger if exists manual_points_permission_truth_v5 on public.employee_transactions;
create trigger manual_points_permission_truth_v5
before insert or update on public.employee_transactions
for each row execute function public.trg_manual_points_permission_truth_v5();

revoke all on function public.trg_manual_points_permission_truth_v5() from public,anon,authenticated;
grant execute on function public.trg_manual_points_permission_truth_v5() to service_role;

notify pgrst,'reload schema';
