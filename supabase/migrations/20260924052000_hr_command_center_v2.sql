-- HR Command Center V2
-- One cycle-level operating read model across HR master data, schedule, Attendance Truth,
-- time-off workflow, overtime provenance, and payroll readiness.

create or replace function public.hr_workforce_cycle_readiness_v2(
  p_month_cycle text default null,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_month text;
  v_start date;
  v_end date;
  v_effective_end date;
  v_truth jsonb;
  v_hr jsonb;
  v_ot jsonb;
  v_payroll jsonb;
  v_can_payroll boolean:=false;
begin
  if p_month_cycle is not null then
    if trim(p_month_cycle) !~ '^\d{4}-\d{2}$' then
      raise exception 'invalid_month_cycle' using errcode='22023';
    end if;
    select cycle_start,cycle_end into v_start,v_end
    from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
    v_month:=p_month_cycle;
  else
    select cycle_start,cycle_end,month_cycle into v_start,v_end,v_month
    from public.dawaa_pay_cycle_bounds_v1(null);
  end if;

  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves','view_staff_accounts','manage_payroll']) then
    raise exception 'not_authorized_for_hr_command_center' using errcode='42501';
  end if;

  v_effective_end:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  if v_effective_end<v_start then v_effective_end:=v_start; end if;

  v_hr:=public.hr_truth_quality_snapshot_v2(v_effective_end,p_branch);
  v_truth:=public.attendance_truth_cycle_v2(v_start,v_effective_end,p_branch);
  v_ot:=public.overtime_truth_status_v2(v_start,v_effective_end,p_branch);
  v_can_payroll:=public.dawaa_current_actor_can(array['manage_payroll']);

  if v_can_payroll then
    begin
      v_payroll:=public.payroll_cycle_finalization_overview_v1(v_month,p_branch,200);
    exception when others then
      v_payroll:=jsonb_build_object('available',false,'reason','payroll_overview_unavailable');
    end;
  else
    v_payroll:=jsonb_build_object('available',false,'reason','payroll_permission_required');
  end if;

  return jsonb_build_object(
    'month_cycle',v_month,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'effective_end',v_effective_end,
    'branch',p_branch,
    'cycle_closed',((now() at time zone 'Africa/Cairo')::date>v_end),
    'hr_truth',v_hr,
    'attendance_truth',v_truth,
    'overtime_truth',v_ot,
    'payroll_readiness',v_payroll,
    'actions',jsonb_build_object(
      'structural_hr_issues',
        coalesce((v_hr->>'active_without_schedule')::int,0)
        +coalesce((v_hr->>'active_schedule_branch_mismatch')::int,0)
        +coalesce((v_hr->>'legacy_shift_drift')::int,0)
        +coalesce((v_hr->>'archived_visible_in_schedule')::int,0),
      'attendance_pending',coalesce((v_truth->'summary'->>'pending_attendance_days')::int,0),
      'corrections_pending',coalesce((v_truth->'summary'->>'pending_corrections')::int,0),
      'timeoff_pending',coalesce((v_truth->'summary'->>'pending_timeoff')::int,0),
      'overtime_pending',coalesce((v_ot->>'pending')::int,0),
      'overtime_stale_approved',coalesce((v_ot->>'approved_stale')::int,0),
      'payroll_blocked_staff',coalesce((v_payroll->>'blocked_count')::int,0)
    ),
    'gates',jsonb_build_object(
      'hr_truth_ready',
        coalesce((v_hr->>'active_without_schedule')::int,0)=0
        and coalesce((v_hr->>'active_schedule_branch_mismatch')::int,0)=0
        and coalesce((v_hr->>'archived_visible_in_schedule')::int,0)=0,
      'attendance_truth_ready',coalesce((v_truth->'summary'->>'ready_for_payroll_truth')::boolean,false),
      'overtime_truth_ready',coalesce((v_ot->>'approved_stale')::int,0)=0,
      'payroll_ready',case when v_can_payroll then coalesce((v_payroll->>'blocked_count')::int,0)=0 else null end
    ),
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.hr_workforce_cycle_readiness_v2(text,text) from public;
grant execute on function public.hr_workforce_cycle_readiness_v2(text,text) to anon,authenticated,service_role;
