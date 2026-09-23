-- Overtime financial bridge V2.
-- Uses only approved overtime rows whose Attendance Truth provenance is still valid.
-- Additive only: existing cron remains on V1 until an explicit cutover.

create or replace function public.overtime_reward_preview_v2(p_month_cycle text default null)
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
  v_result jsonb;
begin
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_overtime_reward_preview' using errcode='42501';
  end if;

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

  with approved as (
    select
      o.staff_id,
      s.name staff_name,
      s.branch,
      o.id overtime_id,
      o.attendance_date,
      o.overtime_hours,
      o.source_resolution_id,
      o.source_resolution_fingerprint,
      a.status attendance_status,
      case
        when o.source_resolution_id is null then 'unlinked'
        when a.id is null then 'source_missing'
        when a.status<>'approved' then 'attendance_reopened'
        when public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint then 'attendance_changed'
        else 'valid'
      end truth_state
    from public.staff_overtime_approvals o
    join public.staff s on s.id=o.staff_id
    left join public.attendance_daily_summary a on a.id=o.source_resolution_id
    where o.status='approved'
      and o.attendance_date between v_start and v_end
  ),
  valid_rows as (
    select * from approved where truth_state='valid'
  ),
  grouped as (
    select
      v.staff_id,
      max(v.staff_name) staff_name,
      max(v.branch) branch,
      round(sum(v.overtime_hours),2) hours,
      count(*)::int days,
      jsonb_agg(jsonb_build_object(
        'overtime_id',v.overtime_id,
        'attendance_date',v.attendance_date,
        'hours',v.overtime_hours,
        'source_resolution_id',v.source_resolution_id
      ) order by v.attendance_date) evidence
    from valid_rows v
    group by v.staff_id
  ),
  calculated as (
    select
      g.*,
      cp.hourly_rate monthly_reference_rate,
      cp.monthly_incentive_base,
      cp.point_value,
      case when coalesce(cp.hourly_rate,0)>0 then round(cp.hourly_rate/26.0,4) else null end true_hourly_rate
    from grouped g
    left join lateral (
      select p.*
      from public.employee_compensation_profiles p
      where p.staff_id=g.staff_id::text
        and coalesce(p.active,true)
        and (p.effective_from is null or p.effective_from<=v_end)
      order by p.effective_from desc nulls last,p.updated_at desc nulls last,p.created_at desc nulls last
      limit 1
    ) cp on true
  )
  select jsonb_build_object(
    'month_cycle',v_month,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'approved_rows',(select count(*) from approved),
    'valid_rows',(select count(*) from approved where truth_state='valid'),
    'blocked_rows',(select count(*) from approved where truth_state<>'valid'),
    'blocked',coalesce((
      select jsonb_agg(jsonb_build_object(
        'overtime_id',overtime_id,'staff_id',staff_id,'staff_name',staff_name,'branch',branch,
        'attendance_date',attendance_date,'hours',overtime_hours,'truth_state',truth_state
      ) order by attendance_date desc,staff_name)
      from approved where truth_state<>'valid'
    ),'[]'::jsonb),
    'staff',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,'staff_name',staff_name,'branch',branch,'days',days,'hours',hours,
        'monthly_reference_rate',monthly_reference_rate,'true_hourly_rate',true_hourly_rate,
        'eligible',coalesce(monthly_reference_rate,0)>0 and coalesce(monthly_incentive_base,0)>0,
        'reward_amount',case when coalesce(true_hourly_rate,0)>0 then round(hours*true_hourly_rate*1.5,2) else null end,
        'point_rate',case when coalesce(point_value,0)>0 then point_value else 3 end,
        'evidence',evidence
      ) order by branch,staff_name)
      from calculated
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.dawaa_sync_attendance_overtime_reward_v2(p_month_cycle text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_month text;
  v_start date;
  v_end date;
  v_s record;
  v_comp public.employee_compensation_profiles%rowtype;
  v_point_rate numeric;
  v_egp numeric;
  v_points numeric;
  v_true_hourly_rate numeric;
  v_updated integer:=0;
  v_blocked integer:=0;
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

  select count(*)::int into v_blocked
  from public.staff_overtime_approvals o
  left join public.attendance_daily_summary a on a.id=o.source_resolution_id
  where o.status='approved'
    and o.attendance_date between v_start and v_end
    and (
      o.source_resolution_id is null
      or a.id is null
      or a.status<>'approved'
      or public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint
    );

  if v_blocked>0 then
    return jsonb_build_object(
      'success',false,
      'reason','approved_overtime_truth_not_stable',
      'blocked_rows',v_blocked,
      'month_cycle',v_month,
      'cycle_start',v_start,
      'cycle_end',v_end,
      'staff_updated',0
    );
  end if;

  for v_s in
    select
      o.staff_id,
      s.name,
      s.branch,
      round(sum(o.overtime_hours),2) hours,
      jsonb_agg(jsonb_build_object(
        'overtime_id',o.id,
        'attendance_date',o.attendance_date,
        'hours',o.overtime_hours,
        'source_resolution_id',o.source_resolution_id,
        'source_resolution_fingerprint',o.source_resolution_fingerprint
      ) order by o.attendance_date) evidence
    from public.staff_overtime_approvals o
    join public.staff s on s.id=o.staff_id
    join public.attendance_daily_summary a
      on a.id=o.source_resolution_id
     and a.status='approved'
     and public.attendance_resolution_fingerprint_v2(a.id)=o.source_resolution_fingerprint
    where o.status='approved'
      and o.attendance_date between v_start and v_end
    group by o.staff_id,s.name,s.branch
  loop
    select * into v_comp
    from public.employee_compensation_profiles p
    where p.staff_id=v_s.staff_id::text
      and coalesce(p.active,true)
      and (p.effective_from is null or p.effective_from<=v_end)
    order by p.effective_from desc nulls last,p.updated_at desc nulls last,p.created_at desc nulls last
    limit 1;

    if not found or coalesce(v_comp.hourly_rate,0)<=0 or coalesce(v_comp.monthly_incentive_base,0)<=0 then
      continue;
    end if;

    v_true_hourly_rate:=round(v_comp.hourly_rate/26.0,4);
    v_egp:=round(v_s.hours*v_true_hourly_rate*1.5,2);
    if v_egp<=0 then continue; end if;

    v_point_rate:=case when coalesce(v_comp.point_value,0)>0 then v_comp.point_value else 3 end;
    v_points:=round(v_egp/v_point_rate,2);

    delete from public.employee_transactions
    where staff_id=v_s.staff_id
      and month_cycle=v_month
      and source in ('attendance_overtime_v1','attendance_overtime_v2');

    insert into public.employee_transactions(
      staff_id,employee_name,branch,type,reason,description,amount,points,points_delta,
      base_points,final_points,source,transaction_date,month_cycle,status,employee_visible,created_by
    ) values(
      v_s.staff_id,v_s.name,v_s.branch,'reward',
      'مكافأة أوفر تايم معتمد من Attendance Truth',
      format('%s ساعة أوفر تايم مرتبطة بأيام حضور معتمدة وثابتة × 1.5 السعر الحقيقي (%s ج.م = %s÷26) = %s ج.م — دورة %s إلى %s',
        round(v_s.hours,2),v_true_hourly_rate,v_comp.hourly_rate,v_egp,v_start,v_end),
      v_egp,v_points,v_points,v_points,v_points,'attendance_overtime_v2',v_end,v_month,'approved',true,'system_attendance_truth_v2'
    );

    v_updated:=v_updated+1;
  end loop;

  return jsonb_build_object(
    'success',true,
    'month_cycle',v_month,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'staff_updated',v_updated,
    'blocked_rows',0,
    'source','attendance_truth_v2'
  );
end;
$$;

revoke execute on function public.overtime_reward_preview_v2(text) from public;
revoke execute on function public.dawaa_sync_attendance_overtime_reward_v2(text) from public,anon,authenticated;
grant execute on function public.overtime_reward_preview_v2(text) to authenticated,service_role;
grant execute on function public.dawaa_sync_attendance_overtime_reward_v2(text) to service_role;
