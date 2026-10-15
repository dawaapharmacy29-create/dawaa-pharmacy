-- After a refused grant migration: no anon EXECUTE was granted on any of the guarded reads.
do $$
begin
  if has_function_privilege('anon', 'public.hr_canonical_architecture_health_v1()', 'execute') then
    raise exception 'refused migration still granted anon EXECUTE on hr_canonical_architecture_health_v1';
  end if;
  if has_function_privilege('anon', 'public.get_doctor_pillar_breakdown(uuid,text)', 'execute') then
    raise exception 'refused migration still granted anon EXECUTE on get_doctor_pillar_breakdown';
  end if;
  if to_regprocedure('public.get_staff_points_manager_summary_v4(text,text)') is not null
     and has_function_privilege('anon', 'public.get_staff_points_manager_summary_v4(text,text)', 'execute') then
    raise exception 'refused migration still granted anon EXECUTE on get_staff_points_manager_summary_v4';
  end if;
end;
$$;
