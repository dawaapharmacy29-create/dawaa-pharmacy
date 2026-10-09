create or replace function public.payroll_cycle_preflight_v3(
  p_month_cycle text,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_cycle_preflight_input' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_cycle_preflight' using errcode='42501';
  end if;

  select cycle_start,cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  with scoped as materialized (
    select
      s.id staff_id,
      s.name staff_name,
      s.role,
      s.branch,
      public.dawaa_staff_uses_delivery_finance_v1(s.id) is_delivery
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
      and (
        p_branch is null or trim(p_branch)='' or p_branch='الكل'
        or trim(coalesce(s.branch,''))=trim(p_branch)
      )
  ),
  account_state as materialized (
    select sc.staff_id,
      exists(
        select 1 from public.staff_accounts sa
        where sa.staff_id=sc.staff_id::text
          and coalesce(sa.active,false)
          and coalesce(sa.can_login,false)
      ) has_active_login
    from scoped sc
  ),
  profile_state as materialized (
    select sc.staff_id,
      exists(
        select 1 from public.employee_compensation_profiles cp
        where cp.staff_id=sc.staff_id::text and coalesce(cp.active,true)
      ) has_profile
    from scoped sc
  ),
  attendance_state as materialized (
    select a.staff_id,
      count(*) filter(
        where coalesce(a.status,'')='pending_review'
           or coalesce(a.review_required,false)
      )::int pending_days,
      count(*) filter(
        where coalesce(a.resolution_version,0)>=3
          and coalesce(a.status,'')<>'approved'
      )::int v3_pending_days
    from public.attendance_daily_summary a
    join scoped sc on sc.staff_id=a.staff_id
    where a.attendance_date between v_start and v_end
    group by a.staff_id
  ),
  overtime_state as materialized (
    select o.staff_id,
      count(*) filter(where o.status='pending')::int pending_ot_cases
    from public.staff_overtime_approvals o
    join scoped sc on sc.staff_id=o.staff_id
    where o.attendance_date between v_start and v_end
    group by o.staff_id
  ),
  delivery_map as materialized (
    select distinct on (m.staff_id)
      m.staff_id,m.rider_id,m.confidence,m.identity_warning
    from public.delivery_payroll_identity_map_v1 m
    join scoped sc on sc.staff_id=m.staff_id and sc.is_delivery
    where m.active=true and m.mapping_status='approved'
      and m.effective_from<=v_end
      and (m.effective_to is null or m.effective_to>=v_start)
    order by m.staff_id,m.effective_from desc,m.created_at desc
  ),
  delivery_snapshot as materialized (
    select distinct on (d.staff_id)
      d.staff_id,d.rider_id,d.synced_at,d.orders_pending,d.trips_pending,
      d.app_attendance_open_shifts,d.app_attendance_review_shifts,d.ready_for_final
    from public.delivery_payroll_activity_snapshots_v1 d
    join scoped sc on sc.staff_id=d.staff_id and sc.is_delivery
    where d.month_cycle=p_month_cycle
    order by d.staff_id,d.synced_at desc nulls last,d.updated_at desc nulls last
  ),
  evaluated as materialized (
    select
      sc.*,
      coalesce(ac.has_active_login,false) has_active_login,
      coalesce(ps.has_profile,false) has_profile,
      coalesce(at.pending_days,0) pending_attendance_days,
      coalesce(at.v3_pending_days,0) v3_pending_days,
      coalesce(ot.pending_ot_cases,0) pending_ot_cases,
      dm.rider_id mapped_rider_id,
      dm.confidence mapping_confidence,
      dm.identity_warning mapping_warning,
      ds.synced_at delivery_synced_at,
      coalesce(ds.orders_pending,0) orders_pending,
      coalesce(ds.trips_pending,0) trips_pending,
      coalesce(ds.app_attendance_open_shifts,0) app_open_shifts,
      coalesce(ds.app_attendance_review_shifts,0) app_review_shifts,
      case
        when sc.is_delivery then (
          dm.rider_id is not null
          and ds.staff_id is not null
          and ds.synced_at >= now()-interval '90 minutes'
          and coalesce(ds.orders_pending,0)=0
          and coalesce(ds.trips_pending,0)=0
          and coalesce(ds.app_attendance_open_shifts,0)=0
          and coalesce(ds.app_attendance_review_shifts,0)=0
          and coalesce(at.pending_days,0)=0
          and coalesce(at.v3_pending_days,0)=0
          and coalesce(ot.pending_ot_cases,0)=0
        )
        else (
          coalesce(ac.has_active_login,false)
          and coalesce(ps.has_profile,false)
          and coalesce(at.pending_days,0)=0
          and coalesce(at.v3_pending_days,0)=0
          and coalesce(ot.pending_ot_cases,0)=0
        )
      end preflight_clear
    from scoped sc
    left join account_state ac on ac.staff_id=sc.staff_id
    left join profile_state ps on ps.staff_id=sc.staff_id
    left join attendance_state at on at.staff_id=sc.staff_id
    left join overtime_state ot on ot.staff_id=sc.staff_id
    left join delivery_map dm on dm.staff_id=sc.staff_id
    left join delivery_snapshot ds on ds.staff_id=sc.staff_id
  ),
  issue_rows as (
    select staff_id,'missing_active_payroll_identity' code,'هوية Payroll فعالة مفقودة' label from evaluated where not is_delivery and not has_active_login
    union all select staff_id,'missing_compensation_profile','ملف التعويضات مفقود' from evaluated where not is_delivery and not has_profile
    union all select staff_id,'pending_attendance','حضور يحتاج مراجعة' from evaluated where pending_attendance_days>0
    union all select staff_id,'v3_pending_attendance','أيام V3 غير معتمدة' from evaluated where v3_pending_days>0
    union all select staff_id,'pending_overtime','Overtime معلق' from evaluated where pending_ot_cases>0
    union all select staff_id,'delivery_missing_mapping','ربط Rider/Staff مفقود' from evaluated where is_delivery and mapped_rider_id is null
    union all select staff_id,'delivery_missing_snapshot','Snapshot الدليفري مفقودة' from evaluated where is_delivery and mapped_rider_id is not null and delivery_synced_at is null
    union all select staff_id,'delivery_stale_snapshot','Snapshot الدليفري قديمة' from evaluated where is_delivery and delivery_synced_at is not null and delivery_synced_at < now()-interval '90 minutes'
    union all select staff_id,'delivery_orders_pending','أوردرات دليفري معلقة' from evaluated where is_delivery and orders_pending>0
    union all select staff_id,'delivery_trips_pending','مشاوير دليفري معلقة' from evaluated where is_delivery and trips_pending>0
    union all select staff_id,'delivery_app_attendance_review','حضور تطبيق الدليفري يحتاج مراجعة' from evaluated where is_delivery and (app_open_shifts>0 or app_review_shifts>0)
    union all select staff_id,'delivery_identity_warning','تحذير ربط هوية الدليفري' from evaluated where is_delivery and mapping_warning is not null
  ),
  issues as (
    select code,label,count(distinct staff_id)::int affected_staff
    from issue_rows
    group by code,label
  )
  select jsonb_build_object(
    'schema','payroll_cycle_preflight_v3',
    'month_cycle',p_month_cycle,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'branch',nullif(trim(coalesce(p_branch,'')),''),
    'scope_staff_count',(select count(*) from evaluated),
    'standard_staff_count',(select count(*) from evaluated where not is_delivery),
    'delivery_staff_count',(select count(*) from evaluated where is_delivery),
    'preflight_clear_count',(select count(*) from evaluated where preflight_clear),
    'preflight_attention_count',(select count(*) from evaluated where not preflight_clear),
    'standard_preflight_clear_count',(select count(*) from evaluated where not is_delivery and preflight_clear),
    'delivery_preflight_clear_count',(select count(*) from evaluated where is_delivery and preflight_clear),
    'delivery_mapped_count',(select count(*) from evaluated where is_delivery and mapped_rider_id is not null),
    'delivery_snapshot_covered_count',(select count(*) from evaluated where is_delivery and delivery_synced_at is not null),
    'delivery_stale_snapshot_count',(select count(*) from evaluated where is_delivery and delivery_synced_at is not null and delivery_synced_at < now()-interval '90 minutes'),
    'top_issues',coalesce((select jsonb_agg(jsonb_build_object('code',code,'label',label,'affected_staff',affected_staff) order by affected_staff desc,code) from issues),'[]'::jsonb),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',e.staff_id,
        'staff_name',e.staff_name,
        'role',e.role,
        'branch',e.branch,
        'route',case when e.is_delivery then 'delivery' else 'standard' end,
        'preflight_clear',e.preflight_clear,
        'pending_attendance_days',e.pending_attendance_days,
        'v3_pending_days',e.v3_pending_days,
        'pending_ot_cases',e.pending_ot_cases,
        'has_active_login',e.has_active_login,
        'has_profile',e.has_profile,
        'delivery_mapped',e.mapped_rider_id is not null,
        'delivery_snapshot_at',e.delivery_synced_at,
        'orders_pending',e.orders_pending,
        'trips_pending',e.trips_pending,
        'mapping_warning',e.mapping_warning,
        'issue_codes',coalesce((select jsonb_agg(ir.code order by ir.code) from issue_rows ir where ir.staff_id=e.staff_id),'[]'::jsonb)
      ) order by e.is_delivery desc,e.branch,e.staff_name)
      from evaluated e
    ),'[]'::jsonb),
    'finalization_rule','Preflight is a lightweight operational screen only. Final payroll approval always requires the employee full finalization gate and immutable snapshot review.',
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.payroll_cycle_preflight_v3(text,text) from public;
grant execute on function public.payroll_cycle_preflight_v3(text,text) to anon,authenticated,service_role;