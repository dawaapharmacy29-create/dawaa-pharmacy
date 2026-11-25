-- إصلاح حضور د وائل (2026-11-25): فرعه في جدول staff اتغير لـ «كل الفروع» يوم 2026-09-25، ومحرك الحضور بيشتغل بس على
-- فرع الشامي وفرع شكري والمخزن، فبقى «out_of_scope» ومفيش ولا يوم حضور اتبني له من 26/9 مع إن بصماته واصلة.
-- دلوقتي: لو فرع الموظف مش من التلاتة، الحضور بياخد فرعه من ملف المرتب (employee_compensation_profiles).
-- فرعه نفسه وصلاحياته على «كل الفروع» زي ما هي.

create or replace function public.dawaa_attendance_staff_branch_v1(p_staff_id uuid)
returns text language sql stable security definer
set search_path = public, pg_catalog
as $$
  select case
    when s.branch in ('فرع الشامي','فرع شكري','المخزن') then s.branch
    else coalesce((
      select c.branch from public.employee_compensation_profiles c
      where c.staff_id = s.id::text and coalesce(c.active, true)
        and c.branch in ('فرع الشامي','فرع شكري','المخزن')
      order by c.effective_from desc nulls last, c.updated_at desc nulls last
      limit 1), s.branch)
  end
  from public.staff s where s.id = p_staff_id
$$;

revoke all on function public.dawaa_attendance_staff_branch_v1(uuid) from public;

create or replace function public.dawaa_attendance_engine_route_v1(p_staff_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_catalog
as $function$
declare
  v_flexible boolean;
  v_active boolean;
  v_branch text;
begin
  if p_staff_id is null then
    raise exception 'attendance_route_staff_id_required' using errcode='22023';
  end if;

  select coalesce(s.active,false), public.dawaa_attendance_staff_branch_v1(s.id)
    into v_active, v_branch
  from public.staff s
  where s.id=p_staff_id
  limit 1;

  if not found or v_branch is null or v_branch not in ('فرع الشامي','فرع شكري','المخزن') then
    return jsonb_build_object(
      'staff_id',p_staff_id,
      'in_scope',false,
      'operational_active',coalesce(v_active,false),
      'branch',v_branch,
      'route','out_of_scope',
      'resolution_version',null,
      'flexible',null
    );
  end if;

  v_flexible:=public.dawaa_staff_flexible_attendance_v1(p_staff_id);

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'in_scope',true,
    'operational_active',v_active,
    'branch',v_branch,
    'route',case when v_flexible then 'flexible_v3' else 'standard_v2' end,
    'resolution_version',case when v_flexible then 3 else 2 end,
    'flexible',v_flexible
  );
end;
$function$;

create or replace function public.dawaa_materialize_attendance_range_route_aware_v1(p_start date, p_end date, p_branch text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog
as $function$
declare
  v_d date;
  v_staff record;
  v_route jsonb;
  v_row public.attendance_daily_summary%rowtype;
  v_processed integer:=0;
  v_approved integer:=0;
  v_review integer:=0;
  v_flexible integer:=0;
  v_standard integer:=0;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_route_aware_materialize_invalid_range' using errcode='22023';
  end if;

  for v_d in select generate_series(p_start,p_end,interval '1 day')::date loop
    for v_staff in
      select x.id
      from (select s.id, public.dawaa_attendance_staff_branch_v1(s.id) branch
            from public.staff s where coalesce(s.active,false)=true) x
      where x.branch in ('فرع الشامي','فرع شكري','المخزن')
        and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or x.branch=p_branch)
    loop
      v_route:=public.dawaa_attendance_engine_route_v1(v_staff.id);
      v_row:=public.dawaa_materialize_attendance_day_current_v1(v_staff.id,v_d);

      if v_route->>'route'='flexible_v3' then
        v_flexible:=v_flexible+1;
      else
        v_standard:=v_standard+1;
      end if;

      if v_row.id is not null then
        v_processed:=v_processed+1;
        if v_row.status='approved' then
          v_approved:=v_approved+1;
        elsif v_row.status='pending_review' then
          v_review:=v_review+1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'schema','attendance_route_aware_fast_safety_materializer_v1',
    'start',p_start,
    'end',p_end,
    'branch',p_branch,
    'processed',v_processed,
    'approved',v_approved,
    'pending_review',v_review,
    'flexible_checks',v_flexible,
    'standard_checks',v_standard,
    'generated_at',now()
  );
end;
$function$;

-- بناء الأيام اللي فاتت لد وائل من 27/9 لحد النهارده (الأيام المعتمدة قبل كده مش بتتلمس).
do $$
declare d date;
begin
  for d in select generate_series(date '2026-09-27', (now() at time zone 'Africa/Cairo')::date, interval '1 day')::date loop
    perform public.dawaa_materialize_attendance_day_current_v1('2b034b1e-76dc-42f0-b150-45f4a71fe139'::uuid, d);
  end loop;
end $$;

-- نفس فحص الفرع موجود في طريق البصمات الجديدة (الطابور وإعادة الحساب والمراجعة)، فبنغيّره هو كمان عشان بصمة د وائل
-- الجديدة تتحسب على اليوم بتاعها. الشاشات والتقارير سايبينها زي ما هي.
do $$
declare
  f regprocedure;
  d text;
  v_old constant text := 's.branch in (''فرع الشامي'',''فرع شكري'',''المخزن'')';
  v_new constant text := 'public.dawaa_attendance_staff_branch_v1(s.id) in (''فرع الشامي'',''فرع شكري'',''المخزن'')';
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'dawaa_enqueue_attendance_materialization_v1', 'dawaa_mark_attendance_dirty_from_log_v1',
      'dawaa_mark_attendance_dirty_v1', 'dawaa_materialize_attendance_range_internal_v2',
      'dawaa_reconcile_attendance_dirty_day_v1', 'dawaa_reconcile_attendance_range_route_aware_v1',
      'dawaa_reconcile_attendance_system_review_backlog_v1', 'dawaa_reconcile_flexible_attendance_dirty_day_v1')
  loop
    d := pg_get_functiondef(f);
    if position(v_old in d) > 0 then
      execute replace(d, v_old, v_new);
    end if;
  end loop;
end $$;
