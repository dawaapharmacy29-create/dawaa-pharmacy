-- Employee Payroll Transparency V1
-- Read-only canonical composition layer for payroll review.
-- Does not recalculate payroll rules; it exposes the existing canonical sources
-- with traceable attendance, time off, missing punch, overtime, transactions,
-- incentives and finalization readiness.

create or replace function public.employee_payroll_transparency_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_name text;
  v_branch text;
  v_start date;
  v_end date;
  v_gate jsonb;
  v_engine jsonb;
  v_components jsonb;
  v_incentives jsonb := '{}'::jsonb;
  v_attendance jsonb := '[]'::jsonb;
  v_time_off jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_overtime jsonb := '[]'::jsonb;
  v_transactions jsonb := '[]'::jsonb;
  v_transaction_rollup jsonb := '[]'::jsonb;
  v_time_off_rollup jsonb := '[]'::jsonb;
  v_attendance_summary jsonb := '{}'::jsonb;
  v_missing_summary jsonb := '{}'::jsonb;
  v_overtime_summary jsonb := '{}'::jsonb;
  v_transaction_summary jsonb := '{}'::jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_transparency_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  select sa.username,
         coalesce(sa.name,sa.staff_name,s.name,sa.username),
         coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),''))
  into v_username,v_name,v_branch
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_transparency' using errcode='42501';
  end if;

  select cycle_start,cycle_end
  into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  v_gate:=public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle);
  v_engine:=coalesce(v_gate->'attendance_gate'->'engine','{}'::jsonb);
  v_components:=coalesce(v_gate->'payroll_components','{}'::jsonb);

  begin
    select to_jsonb(t) into v_incentives
    from public.get_payroll_incentive_truth_v2(p_staff_id,p_month_cycle) t
    limit 1;
  exception when others then
    v_incentives:=jsonb_build_object(
      'available',false,
      'reason','incentive_truth_unavailable'
    );
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,
      'date',a.attendance_date,
      'branch',a.branch,
      'status',a.status,
      'resolution_status',a.resolution_status,
      'resolution_version',a.resolution_version,
      'scheduled_start_at',a.scheduled_start_at,
      'scheduled_end_at',a.scheduled_end_at,
      'first_in',a.first_in,
      'last_out',a.last_out,
      'candidate_hours',coalesce(a.candidate_hours,0),
      'payroll_eligible_hours',a.payroll_eligible_hours,
      'late_minutes',coalesce(a.late_minutes,0),
      'early_leave_minutes',coalesce(a.early_leave_minutes,0),
      'missing_punch',coalesce(a.missing_punch,false),
      'time_off_request_id',a.time_off_request_id,
      'approved_at',a.approved_at,
      'approved_by_name',a.approved_by_name,
      'approval_note',a.approval_note
    ) order by a.attendance_date),'[]'::jsonb)
  into v_attendance
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id
    and a.attendance_date between v_start and v_end;

  select jsonb_build_object(
    'days_total',count(*),
    'approved_days',count(*) filter(where a.status='approved'),
    'pending_review_days',count(*) filter(where a.status='pending_review'),
    'worked_days',count(*) filter(where coalesce(a.candidate_hours,0)>0 and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')),
    'absence_days',count(*) filter(where a.resolution_status='absence_review'),
    'approved_time_off_days',count(*) filter(where a.resolution_status='approved_time_off'),
    'off_days',count(*) filter(where a.resolution_status='off_day'),
    'worked_on_off_days',count(*) filter(where a.resolution_status='worked_on_off'),
    'candidate_hours',round(coalesce(sum(a.candidate_hours),0),2),
    'payroll_eligible_hours',round(coalesce(sum(a.payroll_eligible_hours),0),2),
    'late_minutes',coalesce(sum(a.late_minutes),0),
    'early_leave_minutes',coalesce(sum(a.early_leave_minutes),0),
    'missing_punch_days',count(*) filter(where coalesce(a.missing_punch,false))
  )
  into v_attendance_summary
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id
    and a.attendance_date between v_start and v_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,
      'kind',r.request_kind,
      'label',r.request_label,
      'status',r.status,
      'start_date',r.start_date,
      'end_date',r.end_date,
      'start_time',r.start_time,
      'end_time',r.end_time,
      'duration_minutes',r.duration_minutes,
      'reason',r.reason,
      'decided_at',r.decided_at,
      'decided_by_name',r.decided_by_name,
      'decision_note',r.decision_note,
      'source',r.source
    ) order by r.start_date,r.created_at),'[]'::jsonb)
  into v_time_off
  from public.staff_time_off_requests r
  where r.staff_id=p_staff_id
    and r.end_date>=v_start
    and r.start_date<=v_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind',x.request_kind,
      'status',x.status,
      'requests',x.requests,
      'duration_minutes',x.duration_minutes
    ) order by x.request_kind,x.status),'[]'::jsonb)
  into v_time_off_rollup
  from (
    select r.request_kind,r.status,count(*)::int requests,
           coalesce(sum(r.duration_minutes),0)::bigint duration_minutes
    from public.staff_time_off_requests r
    where r.staff_id=p_staff_id
      and r.end_date>=v_start
      and r.start_date<=v_end
    group by r.request_kind,r.status
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,
      'date',i.attendance_date,
      'missing_type',i.missing_type,
      'occurrence_no',i.occurrence_no,
      'allowance_limit',i.allowance_limit,
      'penalty_eligible',i.penalty_eligible,
      'penalty_amount',i.penalty_amount,
      'deduction_applied',i.deduction_transaction_id is not null,
      'deduction_transaction_id',i.deduction_transaction_id,
      'manual_punch_id',i.manual_punch_id,
      'reason',i.reason,
      'actor_name',i.actor_name
    ) order by i.attendance_date,i.created_at),'[]'::jsonb)
  into v_missing
  from public.attendance_missing_punch_incidents i
  where i.staff_id=p_staff_id
    and i.attendance_date between v_start and v_end;

  select jsonb_build_object(
    'incidents',count(*),
    'free_allowance_used',count(*) filter(where i.occurrence_no<=i.allowance_limit),
    'penalty_eligible_incidents',count(*) filter(where i.penalty_eligible),
    'deductions_applied',count(*) filter(where i.deduction_transaction_id is not null),
    'deduction_amount',round(coalesce(sum(i.penalty_amount) filter(where i.deduction_transaction_id is not null),0),2)
  )
  into v_missing_summary
  from public.attendance_missing_punch_incidents i
  where i.staff_id=p_staff_id
    and i.attendance_date between v_start and v_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,
      'date',o.attendance_date,
      'branch',o.branch,
      'status',o.status,
      'overtime_hours',coalesce(o.overtime_hours,0),
      'hourly_rate',o.hourly_rate,
      'overtime_amount',o.overtime_amount,
      'decided_at',o.decided_at,
      'decided_by_name',o.decided_by_name,
      'decision_note',o.decision_note,
      'evidence_version',o.decision_evidence_version,
      'source_resolution_id',o.source_resolution_id
    ) order by o.attendance_date,o.created_at),'[]'::jsonb)
  into v_overtime
  from public.staff_overtime_approvals o
  where o.staff_id=p_staff_id
    and o.attendance_date between v_start and v_end;

  select jsonb_build_object(
    'detected_cases',count(*),
    'detected_hours',round(coalesce(sum(o.overtime_hours),0),2),
    'approved_cases',count(*) filter(where o.status='approved'),
    'approved_hours',round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2),
    'approved_amount',round(coalesce(sum(o.overtime_amount) filter(where o.status='approved'),0),2),
    'pending_cases',count(*) filter(where o.status='pending'),
    'pending_hours',round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2),
    'rejected_cases',count(*) filter(where o.status='rejected'),
    'rejected_hours',round(coalesce(sum(o.overtime_hours) filter(where o.status='rejected'),0),2)
  )
  into v_overtime_summary
  from public.staff_overtime_approvals o
  where o.staff_id=p_staff_id
    and o.attendance_date between v_start and v_end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',et.id,
      'date',et.transaction_date,
      'type',et.type,
      'status',et.status,
      'source',et.source,
      'source_id',et.source_id,
      'title',et.title,
      'reason',coalesce(et.display_reason,et.clean_reason,et.reason),
      'amount',coalesce(et.amount,0),
      'points',coalesce(et.final_points,et.points_delta,et.points,0),
      'category',et.category,
      'employee_visible',coalesce(et.employee_visible,true),
      'approved_at',et.approved_at,
      'approved_by_name',et.approved_by_name,
      'metadata',coalesce(et.metadata,'{}'::jsonb)
    ) order by et.transaction_date,et.created_at),'[]'::jsonb)
  into v_transactions
  from public.employee_transactions et
  where et.staff_id=p_staff_id
    and et.month_cycle=p_month_cycle;

  select coalesce(jsonb_agg(jsonb_build_object(
      'type',x.type,
      'status',x.status,
      'source',x.source,
      'rows',x.rows,
      'amount',x.amount,
      'points',x.points
    ) order by x.type,x.status,x.source),'[]'::jsonb)
  into v_transaction_rollup
  from (
    select et.type,et.status,et.source,
           count(*)::int rows,
           round(coalesce(sum(et.amount),0),2) amount,
           round(coalesce(sum(coalesce(et.final_points,et.points_delta,et.points,0)),0),2) points
    from public.employee_transactions et
    where et.staff_id=p_staff_id
      and et.month_cycle=p_month_cycle
    group by et.type,et.status,et.source
  ) x;

  select jsonb_build_object(
    'rows',count(*),
    'active_or_approved_rows',count(*) filter(where et.status in ('active','approved')),
    'pending_rows',count(*) filter(where et.status='pending'),
    'cancelled_rows',count(*) filter(where et.status='cancelled'),
    'active_or_approved_amount',round(coalesce(sum(et.amount) filter(where et.status in ('active','approved')),0),2),
    'pending_amount',round(coalesce(sum(et.amount) filter(where et.status='pending'),0),2),
    'active_or_approved_points',round(coalesce(sum(coalesce(et.final_points,et.points_delta,et.points,0)) filter(where et.status in ('active','approved')),0),2),
    'pending_points',round(coalesce(sum(coalesce(et.final_points,et.points_delta,et.points,0)) filter(where et.status='pending'),0),2)
  )
  into v_transaction_summary
  from public.employee_transactions et
  where et.staff_id=p_staff_id
    and et.month_cycle=p_month_cycle;

  return jsonb_build_object(
    'schema','employee_payroll_transparency_v1',
    'staff',jsonb_build_object(
      'id',p_staff_id,
      'username',v_username,
      'name',v_name,
      'branch',v_branch
    ),
    'cycle',jsonb_build_object(
      'month_cycle',p_month_cycle,
      'start',v_start,
      'end',v_end
    ),
    'finalization',jsonb_build_object(
      'ready',coalesce((v_gate->>'ready')::boolean,false),
      'blockers',coalesce(v_gate->'blockers','[]'::jsonb),
      'warnings',coalesce(v_gate->'warnings','[]'::jsonb)
    ),
    'payroll_engine',v_engine,
    'payroll_components',v_components,
    'attendance',jsonb_build_object(
      'summary',coalesce(v_attendance_summary,'{}'::jsonb),
      'days',v_attendance
    ),
    'time_off',jsonb_build_object(
      'rollup',v_time_off_rollup,
      'requests',v_time_off
    ),
    'missing_punch',jsonb_build_object(
      'summary',coalesce(v_missing_summary,'{}'::jsonb),
      'incidents',v_missing
    ),
    'overtime',jsonb_build_object(
      'summary',coalesce(v_overtime_summary,'{}'::jsonb),
      'cases',v_overtime
    ),
    'transactions',jsonb_build_object(
      'summary',coalesce(v_transaction_summary,'{}'::jsonb),
      'rollup',v_transaction_rollup,
      'items',v_transactions
    ),
    'incentives',coalesce(v_incentives,'{}'::jsonb),
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.employee_payroll_transparency_v1(uuid,text) from public,anon;
grant execute on function public.employee_payroll_transparency_v1(uuid,text)
  to authenticated,service_role;
