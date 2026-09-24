-- Annual leave decision bridge from Attendance Resolution Center.
-- Selecting "annual leave" from attendance creates/approves the canonical time-off request,
-- consumes the leave ledger exactly once, then rematerializes attendance truth.

create or replace function public.annual_leave_attendance_preview_v1(
  p_staff_id uuid,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_balance jsonb;
  v_month_start date;
  v_month_end date;
  v_used_month numeric := 0;
  v_existing uuid;
  v_increment numeric := 1;
begin
  if p_staff_id is null or p_date is null then
    raise exception 'annual_leave_preview_identity_or_date_missing' using errcode='22023';
  end if;

  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_annual_leave_preview' using errcode='42501';
  end if;

  v_balance := public.get_annual_leave_balance_v1(p_staff_id, extract(year from p_date)::int);
  v_month_start := date_trunc('month', p_date)::date;
  v_month_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;

  select r.id
  into v_existing
  from public.staff_time_off_requests r
  where r.staff_id = p_staff_id
    and r.request_kind = 'annual_leave'
    and r.status = 'approved'
    and r.start_date <= p_date
    and r.end_date >= p_date
  order by r.decided_at desc nulls last, r.created_at desc
  limit 1;

  if v_existing is not null then
    v_increment := 0;
  end if;

  select coalesce(sum((least(r.end_date, v_month_end) - greatest(r.start_date, v_month_start)) + 1), 0)
  into v_used_month
  from public.staff_time_off_requests r
  where r.staff_id = p_staff_id
    and r.request_kind = 'annual_leave'
    and r.status = 'approved'
    and r.start_date <= v_month_end
    and r.end_date >= v_month_start;

  return jsonb_build_object(
    'staff_id', p_staff_id,
    'date', p_date,
    'year', extract(year from p_date)::int,
    'month', extract(month from p_date)::int,
    'configured', coalesce((v_balance->>'configured')::boolean, false),
    'balance', case when v_balance ? 'balance' then (v_balance->>'balance')::numeric else null end,
    'used_year', coalesce((v_balance->>'used')::numeric, 0),
    'used_month', v_used_month,
    'reserved', coalesce((v_balance->>'reserved')::numeric, 0),
    'existing_approved_request_id', v_existing,
    'already_approved_for_date', v_existing is not null,
    'after_approval_used_year', coalesce((v_balance->>'used')::numeric, 0) + v_increment,
    'after_approval_used_month', v_used_month + v_increment,
    'after_approval_balance',
      case
        when coalesce((v_balance->>'configured')::boolean, false)
          then coalesce((v_balance->>'balance')::numeric, 0) - v_increment
        else null
      end,
    'policy_version', coalesce(v_balance->>'policy_version', 'annual_leave_v1')
  );
end;
$$;

create or replace function public.resolve_annual_leave_from_attendance_v1(
  p_staff_id uuid,
  p_date date,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_request public.staff_time_off_requests%rowtype;
  v_staff public.staff%rowtype;
  v_preview_before jsonb;
  v_preview_after jsonb;
  v_materialized jsonb;
  v_created boolean := false;
  v_reason text := coalesce(
    nullif(trim(coalesce(p_note,'')), ''),
    'اعتماد إجازة سنوية من قرار الحضور'
  );
begin
  if p_staff_id is null or p_date is null then
    raise exception 'annual_leave_attendance_identity_or_date_missing' using errcode='22023';
  end if;

  if not public.dawaa_time_off_can_decide_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_annual_leave_attendance_decision' using errcode='42501';
  end if;

  select *
  into v_staff
  from public.staff
  where id = p_staff_id;

  if not found then
    raise exception 'staff_not_found' using errcode='22023';
  end if;

  v_preview_before := public.annual_leave_attendance_preview_v1(p_staff_id, p_date);

  select *
  into v_request
  from public.staff_time_off_requests r
  where r.staff_id = p_staff_id
    and r.request_kind = 'annual_leave'
    and r.status = 'approved'
    and r.start_date <= p_date
    and r.end_date >= p_date
  order by r.decided_at desc nulls last, r.created_at desc
  limit 1;

  if v_request.id is null then
    select *
    into v_request
    from public.staff_time_off_requests r
    where r.staff_id = p_staff_id
      and r.request_kind = 'annual_leave'
      and r.status = 'pending'
      and r.start_date = p_date
      and r.end_date = p_date
    order by r.created_at desc
    limit 1;

    if v_request.id is null then
      v_request := public.create_staff_time_off_request_v1(
        p_staff_id,
        'annual_leave',
        'إجازة سنوية',
        p_date,
        p_date,
        null,
        null,
        null,
        v_reason
      );
      v_created := true;
    end if;

    v_request := public.decide_staff_time_off_request_v3(
      v_request.id,
      'approved',
      v_reason
    );
  end if;

  -- Rebuild attendance truth only after the canonical leave approval exists.
  v_materialized := public.dawaa_materialize_attendance_range_internal_v2(
    p_date,
    p_date,
    nullif(trim(coalesce(v_staff.branch,'')), '')
  );

  v_preview_after := public.annual_leave_attendance_preview_v1(p_staff_id, p_date);

  return jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'request_status', v_request.status,
    'created_request', v_created,
    'staff_id', p_staff_id,
    'staff_name', v_staff.name,
    'branch', v_staff.branch,
    'date', p_date,
    'preview_before', v_preview_before,
    'summary_after', v_preview_after,
    'attendance_materialization', coalesce(v_materialized, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.annual_leave_attendance_preview_v1(uuid,date) from public;
revoke execute on function public.resolve_annual_leave_from_attendance_v1(uuid,date,text) from public;
grant execute on function public.annual_leave_attendance_preview_v1(uuid,date) to anon,authenticated,service_role;
grant execute on function public.resolve_annual_leave_from_attendance_v1(uuid,date,text) to anon,authenticated,service_role;
