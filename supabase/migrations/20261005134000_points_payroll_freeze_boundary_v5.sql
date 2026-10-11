-- Points V5 safety boundary: finalized payroll cycles are immutable at the central
-- points command boundary, not only in individual source writers.

create or replace function public.trg_employee_transactions_payroll_freeze_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff_id uuid;
  v_cycle text;
begin
  v_staff_id := coalesce(new.staff_id, old.staff_id);
  v_cycle := coalesce(nullif(trim(coalesce(new.month_cycle,'')),''), nullif(trim(coalesce(old.month_cycle,'')),''));

  if v_staff_id is not null and v_cycle is not null and exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id = v_staff_id
      and f.month_cycle = v_cycle
  ) then
    raise exception 'finalized_payroll_cycle_is_immutable'
      using errcode='55000',
            detail='Points events cannot be inserted, updated, or deleted after payroll finalization. Use the explicit payroll reopen/adjustment workflow.';
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$function$;

drop trigger if exists employee_transactions_payroll_freeze_v5
  on public.employee_transactions;

create trigger employee_transactions_payroll_freeze_v5
before insert or update or delete
on public.employee_transactions
for each row
execute function public.trg_employee_transactions_payroll_freeze_v5();

-- Defense in depth: the canonical commands fail before attempting a mutation.
create or replace function public.dawaa_assert_points_cycle_mutable_v5(
  p_staff_id uuid,
  p_month_cycle text
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=p_staff_id
      and f.month_cycle=p_month_cycle
  ) then
    raise exception 'finalized_payroll_cycle_is_immutable' using errcode='55000';
  end if;
end;
$function$;

revoke all on function public.dawaa_assert_points_cycle_mutable_v5(uuid,text) from public,anon,authenticated;
grant execute on function public.dawaa_assert_points_cycle_mutable_v5(uuid,text) to service_role;

notify pgrst,'reload schema';
