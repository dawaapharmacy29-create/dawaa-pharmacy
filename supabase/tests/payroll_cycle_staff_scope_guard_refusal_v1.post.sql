-- After the refused 20261016100000: nothing was created or replaced.
do $$
begin
  if position('changed_after_review' in pg_get_functiondef('public.payroll_cycle_finalization_overview_v2(text,text,integer)'::regprocedure)) = 0 then
    raise exception 'refused migration still replaced payroll_cycle_finalization_overview_v2';
  end if;
  if position('payroll_cycle_finalization_overview_v2' in pg_get_functiondef('public.hr_canonical_architecture_health_v1()'::regprocedure)) = 0 then
    raise exception 'refused migration still replaced hr_canonical_architecture_health_v1';
  end if;
  if to_regprocedure('public.payroll_cycle_staff_scope_v1(text,text)') is not null
     or to_regprocedure('public.payroll_cycle_configuration_counts_v1(text,text)') is not null then
    raise exception 'refused migration still created the payroll scope readers';
  end if;
end;
$$;
