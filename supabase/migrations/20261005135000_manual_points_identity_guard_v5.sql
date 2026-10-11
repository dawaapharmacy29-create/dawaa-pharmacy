-- Manual financial point writes must carry an idempotency identity.
-- Automated source writers keep their own source-specific identities/contracts.

create or replace function public.trg_manual_points_identity_guard_v5()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(new.source,'') in ('manual_admin','penalty_incentive')
     and new.source_id is null
     and coalesce(new.status,'active') in ('active','approved','pending') then
    raise exception 'manual_points_source_identity_required'
      using errcode='23514',
            detail='Manual rewards, deductions, and adjustments require source_id so retries cannot duplicate a financial event.';
  end if;
  return new;
end;
$function$;

drop trigger if exists manual_points_identity_guard_v5 on public.employee_transactions;
create trigger manual_points_identity_guard_v5
before insert or update on public.employee_transactions
for each row execute function public.trg_manual_points_identity_guard_v5();

notify pgrst,'reload schema';
