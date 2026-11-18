-- Leave and permission rules agreed with management (18/11/2026):
--   * permissions: 2 per pay cycle and 4 hours in total, paid (the day counts the whole shift, as before);
--     one permission may now take up to the 4 hours. Beyond that stays a top-management exception, as before.
--   * annual leave: 12 days a year, 18 for عم محمد سالم، احمد وجيه، د اميرة، د دنيا، ا عبد الحميد; the full
--     balance renews every January (no monthly accrual, no carry-over), and at most 7 days in one calendar month.
-- The yearly entitlement used to be written once from the policy (12 for everyone) on the first approved day; it now
-- comes from dawaa_annual_leave_entitlement_days_v1 and a year already written below it is topped up.

-- 1. Who gets more than the policy days.
create table if not exists public.annual_leave_entitlement_overrides (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  days numeric not null check (days > 0 and days <= 60),
  note text,
  created_at timestamptz not null default now()
);
alter table public.annual_leave_entitlement_overrides enable row level security;
revoke all on public.annual_leave_entitlement_overrides from public, anon, authenticated;

insert into public.annual_leave_entitlement_overrides(staff_id, days, note) values
  ('373dac85-6215-4e6b-8f93-23a9d4f49716', 18, 'عم محمد سالم'),
  ('558fc1a1-bd32-41e7-b7dc-7b23a6be9182', 18, 'احمد وجيه'),
  ('84669fc6-1e8a-4ece-940d-adbf405c731e', 18, 'د اميرة'),
  ('0afe27ce-bc26-4b14-9e1b-c37d9040631e', 18, 'د دنيا'),
  ('8a926517-39ba-4162-8832-a877dfd44456', 18, 'ا عبد الحميد')
on conflict (staff_id) do update set days = excluded.days, note = excluded.note;

-- 2. The policy itself.
update public.attendance_policy_versions
set permission_max_minutes = 240,
    permission_limit_per_cycle = 2,
    annual_leave_entitlement_days = 12,
    notes = 'Canonical attendance policy. Annual leave: 12 days/year (18 for the staff in annual_leave_entitlement_overrides), full balance every January, no carry-over, no cash payout, at most 7 days in one calendar month by prior agreement. Permissions: 2 per pay cycle, 4 hours in total, paid.',
    updated_at = now()
where policy_code = 'attendance_policy_v1';

create or replace function public.dawaa_annual_leave_entitlement_days_v1(p_staff_id uuid, p_year integer)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select o.days from public.annual_leave_entitlement_overrides o where o.staff_id = p_staff_id),
    nullif(public.get_attendance_policy_v1(make_date(p_year, 12, 31))->>'annual_leave_entitlement_days', '')::numeric
  )
$function$;
revoke all on function public.dawaa_annual_leave_entitlement_days_v1(uuid, integer) from public, anon, authenticated;

-- 3. Balance: the entitlement of the year, or what the ledger already gave if that is more.
create or replace function public.get_annual_leave_balance_v1(p_staff_id uuid, p_year integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_target numeric;
  v_negative numeric;
  v_used numeric;
  v_reserved numeric;
  v_positive numeric;
begin
  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then raise exception 'not_authorized_for_leave_balance' using errcode='42501'; end if;
  v_target := public.dawaa_annual_leave_entitlement_days_v1(p_staff_id, p_year);
  select coalesce(sum(days_delta) filter (where days_delta < 0), 0),
         coalesce(-sum(days_delta) filter (where entry_type = 'consumed'), 0),
         coalesce(-sum(days_delta) filter (where entry_type = 'reserved'), 0),
         coalesce(sum(days_delta) filter (where entry_type in ('opening','entitlement','accrual','carry_forward','adjustment') and days_delta > 0), 0)
  into v_negative, v_used, v_reserved, v_positive
  from public.staff_leave_ledger where staff_id = p_staff_id and leave_year = p_year and leave_type = 'annual_leave';
  v_positive := greatest(v_positive, coalesce(v_target, 0));
  return jsonb_build_object('staff_id', p_staff_id, 'year', p_year, 'configured', v_positive > 0,
    'balance', case when v_positive > 0 then v_positive + v_negative else null end,
    'entitlement_days', v_positive, 'used', coalesce(v_used, 0), 'reserved', coalesce(v_reserved, 0),
    'policy_version', 'annual_leave_v2');
end;
$function$;

-- 4. Preview on the attendance day: the same balance, the entitlement and the monthly cap.
create or replace function public.attendance_annual_leave_preview_v1(p_staff_id uuid, p_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_balance jsonb;
  v_policy jsonb;
  v_month_start date;
  v_month_end date;
  v_cycle_start date;
  v_cycle_end date;
  v_month_used integer;
  v_cycle_used integer;
  v_existing public.staff_time_off_requests%rowtype;
begin
  if p_staff_id is null or p_date is null then raise exception 'annual_leave_identity_or_date_missing' using errcode='22023'; end if;
  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then raise exception 'not_authorized_for_annual_leave_preview' using errcode='42501'; end if;
  v_balance:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from p_date)::integer);
  v_policy:=public.get_attendance_policy_v1(p_date);
  v_month_start:=date_trunc('month',p_date)::date;
  v_month_end:=(v_month_start+interval '1 month - 1 day')::date;
  v_cycle_start:=case when extract(day from p_date)>=26 then (date_trunc('month',p_date)::date+25) else (date_trunc('month',p_date)::date-interval '1 month')::date+25 end;
  v_cycle_end:=(v_cycle_start+interval '1 month - 1 day')::date;
  select coalesce(sum(least(r.end_date,v_month_end)-greatest(r.start_date,v_month_start)+1),0)::integer into v_month_used
  from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.request_kind='annual_leave' and r.status='approved'
    and r.start_date<=v_month_end and r.end_date>=v_month_start;
  select coalesce(sum(least(r.end_date,v_cycle_end)-greatest(r.start_date,v_cycle_start)+1),0)::integer into v_cycle_used
  from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.request_kind='annual_leave' and r.status='approved'
    and r.start_date<=v_cycle_end and r.end_date>=v_cycle_start;
  select * into v_existing from public.staff_time_off_requests r
  where r.staff_id=p_staff_id and r.request_kind='annual_leave' and r.status in ('approved','pending')
    and r.start_date<=p_date and r.end_date>=p_date
  order by (r.status='approved') desc,r.created_at desc limit 1;
  return jsonb_build_object(
    'staff_id',p_staff_id,'date',p_date,'year_used',coalesce((v_balance->>'used')::numeric,0),
    'year_balance',v_balance->'balance',
    'balance_configured',coalesce((v_balance->>'configured')::boolean,false),
    'policy_entitlement_days',nullif(v_policy->>'annual_leave_entitlement_days','')::numeric,
    'entitlement_days',v_balance->'entitlement_days',
    'monthly_cap_days',7,
    'calendar_month_used',v_month_used,'cycle_used',v_cycle_used,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,
    'existing_request_id',v_existing.id,'existing_request_status',v_existing.status
  );
end;
$function$;

-- 5. Permissions: the 4 hours in total next to the count.
create or replace function public.get_permission_policy_status_v2(p_staff_id uuid, p_cycle_start date, p_cycle_end date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_count integer;
  v_minutes integer;
  v_over integer;
  v_policy jsonb:=public.get_attendance_policy_v1(p_cycle_end);
  v_limit integer:=coalesce((v_policy->>'permission_limit_per_cycle')::int,2);
  v_max integer:=coalesce((v_policy->>'permission_max_minutes')::int,240);
  v_total integer:=coalesce((v_policy->>'permission_max_total_minutes')::int,240);
begin
  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then raise exception 'not_authorized_for_permission_status' using errcode='42501'; end if;
  select count(*),coalesce(sum(duration_minutes),0),count(*) filter(where duration_minutes>v_max)
  into v_count,v_minutes,v_over
  from public.staff_time_off_requests
  where staff_id=p_staff_id and request_kind='permission' and status='approved' and start_date between p_cycle_start and p_cycle_end;
  return jsonb_build_object('staff_id',p_staff_id,'approved_permissions',v_count,'allowance',v_limit,'remaining',greatest(0,v_limit-v_count),
    'exceeded_count',greatest(0,v_count-v_limit),'total_minutes',v_minutes,'total_minutes_limit',v_total,
    'remaining_minutes',greatest(0,v_total-v_minutes),'max_minutes_per_permission',v_max,'over_duration_count',v_over,
    'requires_manager_review',(v_count>v_limit or v_over>0 or v_minutes>v_total),'paid',true,
    'policy_version',coalesce(v_policy->>'policy_code','attendance_policy_v1'));
end;
$function$;

-- 6. The decision itself.
create or replace function public.decide_staff_time_off_request_v1(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
returns staff_time_off_requests
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_before public.staff_time_off_requests%rowtype;
  v_after public.staff_time_off_requests%rowtype;
  v_actor text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text:=public.employee_operating_actor_role();
  v_days numeric;
  v_policy jsonb;
  v_permission_limit integer;
  v_permission_max integer;
  v_permission_total integer;
  v_prior_permissions integer;
  v_prior_minutes integer;
  v_is_top boolean:=public.dawaa_time_off_scope_all_v1();
  v_cycle_label text;
  v_cycle_start date;
  v_cycle_end date;
  v_year integer;
  v_target numeric;
  v_negative_allowed boolean;
  v_leave_balance numeric;
  v_positive numeric;
  v_month date;
  v_month_used numeric;
  v_month_days numeric;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_time_off_decision' using errcode='22023'; end if;
  select * into v_before from public.staff_time_off_requests where id=p_request_id for update;
  if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if;
  if not public.dawaa_time_off_can_decide_staff_v1(v_before.staff_id) then raise exception 'not_authorized_for_time_off_decision' using errcode='42501'; end if;
  if v_before.status<>'pending' then return v_before; end if;
  if p_decision='rejected' and nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'time_off_rejection_reason_required' using errcode='22023'; end if;

  if p_decision='approved' then
    v_policy:=public.get_attendance_policy_v1(v_before.start_date);

    if v_before.request_kind='permission' then
      v_permission_limit:=coalesce((v_policy->>'permission_limit_per_cycle')::int,2);
      v_permission_max:=coalesce((v_policy->>'permission_max_minutes')::int,240);
      v_permission_total:=coalesce((v_policy->>'permission_max_total_minutes')::int,240);
      v_cycle_label:=public.dawaa_points_cycle_label_for_date_v3(v_before.start_date);
      v_cycle_start:=public.dawaa_points_cycle_start_for_label_v1(v_cycle_label);
      v_cycle_end:=public.dawaa_points_cycle_end_for_label_v1(v_cycle_label);
      select count(*),coalesce(sum(r.duration_minutes),0) into v_prior_permissions,v_prior_minutes
      from public.staff_time_off_requests r
      where r.staff_id=v_before.staff_id and r.request_kind='permission' and r.status='approved'
        and r.start_date between v_cycle_start and v_cycle_end;
      if (coalesce(v_before.duration_minutes,0)>v_permission_max
          or v_prior_permissions>=v_permission_limit
          or v_prior_minutes+coalesce(v_before.duration_minutes,0)>v_permission_total) and not v_is_top then
        raise exception 'permission_policy_exception_requires_top_management' using errcode='42501';
      end if;
    end if;

    if v_before.request_kind='annual_leave' then
      v_year:=extract(year from v_before.start_date)::int;
      if extract(year from v_before.end_date)::int<>v_year then
        raise exception 'annual_leave_cross_year' using errcode='22023';
      end if;
      v_target:=public.dawaa_annual_leave_entitlement_days_v1(v_before.staff_id,v_year);
      v_negative_allowed:=coalesce((v_policy->>'annual_leave_negative_balance_allowed')::boolean,false);
      select coalesce(sum(days_delta) filter(where entry_type in ('opening','entitlement','accrual','carry_forward','adjustment') and days_delta>0),0)
      into v_positive
      from public.staff_leave_ledger
      where staff_id=v_before.staff_id and leave_year=v_year and leave_type='annual_leave';
      if v_target is null and v_positive<=0 then
        raise exception 'annual_leave_policy_not_configured' using errcode='22023';
      end if;
      -- The year's entitlement in the ledger, topped up when it was written lower than it is now.
      if v_target is not null and v_positive<v_target then
        insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,policy_version,reason,actor_id,actor_name,idempotency_key,metadata)
        values(v_before.staff_id,v_year,'annual_leave',case when v_positive>0 then 'adjustment' else 'entitlement' end,v_target-v_positive,
          'annual_leave_v2','Annual leave entitlement for the year',v_actor,null,
          'annual_leave_entitlement_target:'||v_before.staff_id::text||':'||v_year::text||':'||v_target::text,
          jsonb_build_object('target_days',v_target,'previous_days',v_positive))
        on conflict(idempotency_key) do nothing;
      end if;
      select coalesce(sum(days_delta),0) into v_leave_balance
      from public.staff_leave_ledger
      where staff_id=v_before.staff_id and leave_year=v_year and leave_type='annual_leave';
      v_days:=(v_before.end_date-v_before.start_date)+1;
      if not v_negative_allowed and v_leave_balance<v_days then
        raise exception 'annual_leave_insufficient_balance' using errcode='22023';
      end if;
      -- At most 7 days in one calendar month, counting the approved ones already in it.
      for v_month in
        select generate_series(date_trunc('month',v_before.start_date),date_trunc('month',v_before.end_date),interval '1 month')::date
      loop
        select coalesce(sum(least(r.end_date,(v_month+interval '1 month - 1 day')::date)-greatest(r.start_date,v_month)+1),0)
        into v_month_used
        from public.staff_time_off_requests r
        where r.staff_id=v_before.staff_id and r.id<>v_before.id and r.request_kind='annual_leave' and r.status='approved'
          and r.start_date<=(v_month+interval '1 month - 1 day')::date and r.end_date>=v_month;
        v_month_days:=least(v_before.end_date,(v_month+interval '1 month - 1 day')::date)-greatest(v_before.start_date,v_month)+1;
        if v_month_used+v_month_days>7 then
          raise exception 'annual_leave_monthly_cap_exceeded' using errcode='22023';
        end if;
      end loop;
    end if;
  end if;

  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  update public.staff_time_off_requests
  set status=p_decision,decided_by=v_actor,decided_by_name=v_actor_name,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now()
  where id=p_request_id returning * into v_after;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,before_state,after_state,reason)
  values(v_after.id,v_after.staff_id,p_decision,v_actor,v_actor_name,v_actor_role,to_jsonb(v_before),to_jsonb(v_after),p_note);

  if v_after.request_kind='annual_leave' and p_decision='approved' then
    v_days:=(v_after.end_date-v_after.start_date)+1;
    insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,request_id,policy_version,reason,actor_id,actor_name,idempotency_key)
    values(v_after.staff_id,extract(year from v_after.start_date)::int,'annual_leave','consumed',-v_days,v_after.id,'annual_leave_v2',coalesce(p_note,v_after.reason),v_actor,v_actor_name,'annual_leave_consumed:'||v_after.id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return v_after;
end;
$function$;

-- 7. The request preflight says the same before anyone decides.
create or replace function public.time_off_request_preflight_v3(p_request_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_request public.staff_time_off_requests%rowtype; v_policy jsonb;
  v_blockers jsonb:='[]'::jsonb; v_warnings jsonb:='[]'::jsonb; v_days numeric:=0;
  v_balance jsonb; v_permission jsonb; v_overlap integer:=0; v_permission_overlap integer:=0; v_schedule record;
  v_month date; v_month_used numeric;
begin
  select * into v_request from public.staff_time_off_requests where id=p_request_id;
  if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if;
  if not public.dawaa_time_off_can_access_staff_v1(v_request.staff_id) then
    raise exception 'not_authorized_for_time_off_preflight' using errcode='42501';
  end if;
  v_policy:=public.get_attendance_policy_v1(v_request.start_date);
  if v_request.status<>'pending' then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object('code','request_not_pending','label','الطلب لم يعد قيد المراجعة','status',v_request.status));
  end if;

  if v_request.request_kind='annual_leave' then
    if extract(year from v_request.start_date)<>extract(year from v_request.end_date) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','annual_leave_cross_year','label','الإجازة السنوية لا تُعتمد عبر سنتين في طلب واحد؛ قسمها إلى طلبين حتى يُسجّل الرصيد في السنة الصحيحة'));
    else
      v_days:=(v_request.end_date-v_request.start_date)+1;
      v_balance:=public.get_annual_leave_balance_v1(v_request.staff_id,extract(year from v_request.start_date)::int);
      if coalesce((v_balance->>'configured')::boolean,false) is not true then
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object('code','annual_leave_not_configured','label','استحقاق الإجازة السنوية غير مفعّل لهذا الموظف'));
      elsif coalesce((v_policy->>'annual_leave_negative_balance_allowed')::boolean,false) is not true
        and coalesce((v_balance->>'balance')::numeric,0)<v_days then
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
          'code','annual_leave_insufficient_balance','label','رصيد الإجازة السنوية لا يكفي',
          'requested_days',v_days,'available_days',coalesce((v_balance->>'balance')::numeric,0)));
      end if;
      for v_month in
        select generate_series(date_trunc('month',v_request.start_date),date_trunc('month',v_request.end_date),interval '1 month')::date
      loop
        select coalesce(sum(least(r.end_date,(v_month+interval '1 month - 1 day')::date)-greatest(r.start_date,v_month)+1),0)
        into v_month_used
        from public.staff_time_off_requests r
        where r.staff_id=v_request.staff_id and r.id<>v_request.id and r.request_kind='annual_leave' and r.status='approved'
          and r.start_date<=(v_month+interval '1 month - 1 day')::date and r.end_date>=v_month;
        if v_month_used+(least(v_request.end_date,(v_month+interval '1 month - 1 day')::date)-greatest(v_request.start_date,v_month)+1)>7 then
          v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
            'code','annual_leave_monthly_cap_exceeded','label','الإجازة السنوية بحد أقصى 7 أيام في الشهر الواحد',
            'month',v_month,'already_used',v_month_used));
        end if;
      end loop;
    end if;
  end if;

  if v_request.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence') then
    select count(*)::int into v_overlap
    from public.staff_time_off_requests r
    where r.staff_id=v_request.staff_id and r.id<>v_request.id and r.status='approved'
      and r.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence')
      and r.start_date<=v_request.end_date and r.end_date>=v_request.start_date;
    if v_overlap>0 then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','overlapping_approved_full_day_timeoff','label','يوجد طلب إجازة/غياب معتمد متداخل مع نفس الفترة','count',v_overlap));
    end if;
  end if;

  if v_request.request_kind='permission' then
    v_permission:=public.get_permission_policy_status_v2(
      v_request.staff_id,
      public.dawaa_points_cycle_start_for_label_v1(public.dawaa_points_cycle_label_for_date_v3(v_request.start_date)),
      public.dawaa_points_cycle_end_for_label_v1(public.dawaa_points_cycle_label_for_date_v3(v_request.start_date))
    );
    if coalesce(v_request.duration_minutes,0)>coalesce((v_permission->>'max_minutes_per_permission')::int,240) then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','permission_over_single_limit','label','مدة الإذن تتجاوز الحد المعتاد وتحتاج صلاحية الإدارة العليا',
        'duration_minutes',v_request.duration_minutes,'limit_minutes',(v_permission->>'max_minutes_per_permission')::int));
    end if;
    if coalesce((v_permission->>'remaining')::int,0)<=0 then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','permission_cycle_allowance_exhausted','label','تم استهلاك عدد الأذونات المسموح به في الدورة؛ الاعتماد يحتاج إدارة عليا'));
    end if;
    if coalesce(v_request.duration_minutes,0)>coalesce((v_permission->>'remaining_minutes')::int,240) then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','permission_cycle_minutes_exhausted','label','الأذونات بحد أقصى 4 ساعات في الشهر؛ الباقي لا يكفي والاعتماد يحتاج إدارة عليا',
        'remaining_minutes',(v_permission->>'remaining_minutes')::int));
    end if;
    if v_request.start_time is not null and v_request.end_time is not null then
      select count(*)::int into v_permission_overlap
      from public.staff_time_off_requests r
      where r.staff_id=v_request.staff_id and r.id<>v_request.id and r.status='approved'
        and r.request_kind='permission' and r.start_date=v_request.start_date
        and r.start_time is not null and r.end_time is not null
        and ((v_request.start_time<v_request.end_time and r.start_time<r.end_time
              and v_request.start_time<r.end_time and r.start_time<v_request.end_time)
             or v_request.start_time>=v_request.end_time or r.start_time>=r.end_time);
      if v_permission_overlap>0 then
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
          'code','overlapping_approved_permission','label','يوجد إذن معتمد متداخل زمنيًا في نفس اليوم','count',v_permission_overlap));
      end if;
    end if;
  end if;

  if v_request.request_kind='shift_swap' then
    select * into v_schedule from public.attendance_schedule_for_date_v1(v_request.staff_id,v_request.start_date) limit 1;
    if v_schedule.schedule_id is null or coalesce(v_schedule.source_kind,'')<>'date_override' then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','shift_swap_schedule_override_missing','label','تبديل الشيفت يحتاج Date Override في الجدول قبل أن يصبح Attendance Truth قابلاً للإغلاق'));
    end if;
  end if;

  return jsonb_build_object(
    'request_id',v_request.id,'staff_id',v_request.staff_id,'staff_name',v_request.staff_name_snapshot,
    'request_kind',v_request.request_kind,'status',v_request.status,'start_date',v_request.start_date,'end_date',v_request.end_date,
    'allowed',jsonb_array_length(v_blockers)=0,'blockers',v_blockers,'warnings',v_warnings,
    'policy_version',coalesce(v_policy->>'policy_code','unconfigured'),
    'annual_leave_balance',v_balance,'permission_policy',v_permission,'generated_at',now());
end; $function$;
