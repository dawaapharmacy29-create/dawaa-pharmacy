do $$ begin
  if to_regprocedure('public.save_staff_payroll_monthly_v14_core(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text)') is null then
    alter function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text)
      rename to save_staff_payroll_monthly_v14_core;
  end if;
end $$;

create or replace function public.save_staff_payroll_monthly_v15(
  p_staff_username text,
  p_payroll_month date,
  p_worked_hours numeric default 0,
  p_overtime_hours numeric default 0,
  p_quarterly_bonus numeric default 0,
  p_incentives_total numeric default 0,
  p_deductions_total numeric default 0,
  p_manual_adjustment numeric default 0,
  p_notes text default null,
  p_status text default 'draft'
)
returns public.staff_payroll_monthly_v13
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_status text:=lower(trim(coalesce(p_status,'draft')));
  v_staff_id uuid;
  v_mode text:='manual';
  v_cycle text;
  v_elig jsonb;
  v_effective_hours numeric:=coalesce(p_worked_hours,0);
  v_saved public.staff_payroll_monthly_v13%rowtype;
begin
  select s.id,coalesce(pp.attendance_hours_mode,'manual')
    into v_staff_id,v_mode
  from public.staff_accounts sa
  join public.staff s on s.id::text=sa.staff_id::text
  left join public.staff_payroll_profiles_v13 pp on pp.staff_username=sa.username
  where sa.username=p_staff_username
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_staff_id is null then raise exception 'payroll_staff_identity_missing' using errcode='22023'; end if;

  v_cycle:=to_char(p_payroll_month,'YYYY-MM');
  if v_status='approved' and v_mode='resolved' then
    v_elig:=public.get_payroll_attendance_eligibility_v1(v_staff_id,v_cycle);
    if not coalesce((v_elig->>'ready_for_payroll')::boolean,false) then
      raise exception 'attendance_resolution_not_ready_for_payroll: %',coalesce(v_elig->>'status','not_ready') using errcode='55000';
    end if;
    v_effective_hours:=coalesce((v_elig->>'approved_payroll_hours')::numeric,0);
  end if;

  v_saved:=public.save_staff_payroll_monthly_v14_core(
    p_staff_username,p_payroll_month,v_effective_hours,p_overtime_hours,p_quarterly_bonus,p_incentives_total,
    p_deductions_total,p_manual_adjustment,p_notes,v_status
  );

  if v_status='approved' and v_mode='resolved' and v_saved.id is not null then
    update public.staff_payroll_monthly_v13
    set approval_snapshot=coalesce(approval_snapshot,'{}'::jsonb)||jsonb_build_object(
          'attendance_hours_source','resolved_daily_snapshots_v1',
          'attendance_eligibility',v_elig
        ),
        freeze_version=15,
        updated_at=now()
    where id=v_saved.id and status='approved'
    returning * into v_saved;
  end if;

  return v_saved;
end;
$function$;

create or replace function public.save_staff_payroll_monthly_v14(
  p_staff_username text,
  p_payroll_month date,
  p_worked_hours numeric default 0,
  p_overtime_hours numeric default 0,
  p_quarterly_bonus numeric default 0,
  p_incentives_total numeric default 0,
  p_deductions_total numeric default 0,
  p_manual_adjustment numeric default 0,
  p_notes text default null,
  p_status text default 'draft'
)
returns public.staff_payroll_monthly_v13
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.save_staff_payroll_monthly_v15(
    p_staff_username,p_payroll_month,p_worked_hours,p_overtime_hours,p_quarterly_bonus,p_incentives_total,
    p_deductions_total,p_manual_adjustment,p_notes,p_status
  );
$function$;

revoke all on function public.save_staff_payroll_monthly_v14_core(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.save_staff_payroll_monthly_v14_core(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to service_role;
revoke all on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public;
grant execute on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;
revoke all on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public;
grant execute on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;
