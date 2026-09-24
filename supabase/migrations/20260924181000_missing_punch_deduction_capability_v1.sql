-- Expose missing-punch deduction capability to the UI from the canonical permission contract.
create or replace function public.missing_punch_context_v1(
  p_staff_id uuid,
  p_date date,
  p_missing_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_cycle text;
  v_existing public.attendance_missing_punch_incidents%rowtype;
  v_prior_count integer:=0;
  v_next integer;
  v_can_apply_deduction boolean:=false;
begin
  if p_staff_id is null or p_date is null or p_missing_type not in ('check_in','check_out') then
    raise exception 'invalid_missing_punch_context' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(p_staff_id,v_staff.branch) then
    raise exception 'not_authorized_for_missing_punch_context' using errcode='42501';
  end if;

  v_can_apply_deduction:=public.dawaa_current_actor_can(
    array['create_deduction','manage_points','manage_payroll']
  );

  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(p_date);

  select * into v_existing
  from public.attendance_missing_punch_incidents
  where staff_id=p_staff_id and attendance_date=p_date and missing_type=p_missing_type
  limit 1;

  select count(*)::int into v_prior_count
  from public.attendance_missing_punch_incidents
  where staff_id=p_staff_id
    and month_cycle=v_cycle
    and (attendance_date<p_date or (attendance_date=p_date and missing_type<>p_missing_type));

  v_next:=case when v_existing.id is not null then v_existing.occurrence_no else v_prior_count+1 end;

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'staff_name',v_staff.name,
    'branch',v_staff.branch,
    'attendance_date',p_date,
    'missing_type',p_missing_type,
    'month_cycle',v_cycle,
    'allowance_limit',2,
    'used_before',greatest(v_next-1,0),
    'occurrence_no',v_next,
    'remaining_free_before',greatest(2-(v_next-1),0),
    'penalty_eligible',v_next>2,
    'penalty_amount',50,
    'can_apply_deduction',v_can_apply_deduction,
    'existing_incident_id',v_existing.id,
    'manual_punch_id',v_existing.manual_punch_id,
    'deduction_transaction_id',v_existing.deduction_transaction_id
  );
end;
$$;

revoke execute on function public.missing_punch_context_v1(uuid,date,text) from public;
grant execute on function public.missing_punch_context_v1(uuid,date,text)
  to anon,authenticated,service_role;
