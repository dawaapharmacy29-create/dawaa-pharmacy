-- After a refused run of 20261016150000 nothing was installed.
do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_overtime_approval_freshness_guard_v1', 'trg_block_stale_overtime_payroll_finalization_v1'))
     or to_regprocedure('public.dawaa_stale_approved_overtime_count_v1(uuid,date,date)') is not null
     or (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_hr_invalidate_overtime_on_attendance_change_v1') like '%policy_version%' then
    raise exception 'refused overtime freshness migration still installed objects';
  end if;
end;
$$;
