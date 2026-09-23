-- The canonical compensation profile is changed only by a reviewed command.
create table public.hr_compensation_changes_v1 (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.staff(id),
 effective_from date not null,
 proposed jsonb not null,
 previous jsonb,
 reason text not null check(length(trim(reason)) between 5 and 500),
 state text not null default 'pending' check(state in ('pending','approved','rejected')),
 requested_by uuid not null references public.staff_accounts(id),
 requested_at timestamptz not null default now(),
 decided_by uuid references public.staff_accounts(id),
 decided_at timestamptz,
 decision_note text
);
create index hr_compensation_changes_staff_v1 on public.hr_compensation_changes_v1(staff_id,requested_at desc);
create index hr_compensation_changes_pending_v1 on public.hr_compensation_changes_v1(requested_at desc) where state='pending';
alter table public.hr_compensation_changes_v1 enable row level security;
revoke all on public.hr_compensation_changes_v1 from public,anon,authenticated;
-- Remove direct writes; all web clients must request a reviewed change.
revoke insert,update,delete on public.employee_compensation_profiles from anon,authenticated;

create function public.hr_compensation_change_v1(p_action text,p_staff_id uuid default null,p_change_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_change public.hr_compensation_changes_v1%rowtype;
 v_staff public.staff%rowtype; v_profile public.employee_compensation_profiles%rowtype;
 v_id uuid; v_proposal jsonb; v_old jsonb; v_effective date; v_reason text; v_mode text;
begin
 select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
 and coalesce(active,false) and coalesce(can_login,false);
 if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager') then
 raise exception 'compensation_not_authorized' using errcode='42501'; end if;
 if p_action='list' then
   return (select coalesce(jsonb_agg(to_jsonb(c) order by c.requested_at desc,c.id desc),'[]'::jsonb)
   from (select id,staff_id,effective_from,proposed,previous,reason,state,requested_at,requested_by,decided_at,decided_by,decision_note
    from public.hr_compensation_changes_v1 where p_staff_id is null or staff_id=p_staff_id
    order by requested_at desc,id desc limit 100) c);
 end if;
 if p_action='request' then
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  v_reason:=trim(p_payload->>'reason'); v_effective:=(p_payload->>'effective_from')::date;
  v_proposal:=p_payload->'profile'; v_mode:=v_proposal->>'salary_calculation_mode';
  if length(coalesce(v_reason,'')) not between 5 and 500 or v_effective is null
    or v_effective<(now() at time zone 'Africa/Cairo')::date
    or v_mode not in ('legacy_fixed','monthly_hour_unit','attendance_hours_v1')
    or (select count(*) from jsonb_object_keys(coalesce(v_proposal,'{}'::jsonb)))<>7
    or not (v_proposal ?& array['salary_calculation_mode','hourly_rate','monthly_hour_unit_value','contracted_daily_hours','monthly_base_salary','overtime_hour_rate','monthly_incentive_base'])
    or (v_proposal->>'hourly_rate')::numeric < 0
    or (v_proposal->>'monthly_hour_unit_value')::numeric < 0
    or (v_proposal->>'contracted_daily_hours')::numeric < 0
    or (v_proposal->>'monthly_base_salary')::numeric < 0
    or (v_proposal->>'overtime_hour_rate')::numeric < 0
    or (v_proposal->>'monthly_incentive_base')::numeric < 0
    or (v_mode='attendance_hours_v1' and (v_proposal->>'hourly_rate')::numeric<=0)
  then raise exception 'invalid_compensation_request' using errcode='22023'; end if;
  select * into v_profile from public.employee_compensation_profiles where staff_id=p_staff_id::text;
  if found then v_old:=jsonb_build_object('salary_calculation_mode',v_profile.salary_calculation_mode,'hourly_rate',v_profile.hourly_rate,
   'monthly_hour_unit_value',v_profile.monthly_hour_unit_value,'contracted_daily_hours',v_profile.contracted_daily_hours,
   'monthly_base_salary',v_profile.monthly_base_salary,'overtime_hour_rate',v_profile.overtime_hour_rate,
   'monthly_incentive_base',v_profile.monthly_incentive_base); end if;
  insert into public.hr_compensation_changes_v1(staff_id,effective_from,proposed,previous,reason,requested_by)
    values(p_staff_id,v_effective,v_proposal,v_old,v_reason,v_actor.id) returning id into v_id;
  return jsonb_build_object('id',v_id,'state','pending');
 end if;
 if p_action not in ('approve','reject') or v_actor.role<>'general_manager' then
  raise exception 'compensation_approval_not_authorized' using errcode='42501'; end if;
 select * into v_change from public.hr_compensation_changes_v1 where id=p_change_id for update;
 if not found or v_change.state<>'pending' or v_change.requested_by=v_actor.id then
   raise exception 'invalid_compensation_decision' using errcode='22023'; end if;
 if p_action='approve' then
  if v_change.effective_from>(now() at time zone 'Africa/Cairo')::date then
   raise exception 'future_compensation_not_yet_effective' using errcode='22023'; end if;
  select * into v_profile from public.employee_compensation_profiles where staff_id=v_change.staff_id::text for update;
  if found and jsonb_build_object('salary_calculation_mode',v_profile.salary_calculation_mode,'hourly_rate',v_profile.hourly_rate,
   'monthly_hour_unit_value',v_profile.monthly_hour_unit_value,'contracted_daily_hours',v_profile.contracted_daily_hours,
   'monthly_base_salary',v_profile.monthly_base_salary,'overtime_hour_rate',v_profile.overtime_hour_rate,
   'monthly_incentive_base',v_profile.monthly_incentive_base) is distinct from v_change.previous then
   raise exception 'compensation_profile_changed_since_request' using errcode='40001'; end if;
  insert into public.employee_compensation_profiles(staff_id,staff_name,branch,salary_calculation_mode,hourly_rate,
    monthly_hour_unit_value,contracted_daily_hours,monthly_base_salary,overtime_hour_rate,monthly_incentive_base,effective_from,updated_at)
  select v_change.staff_id::text,s.name,s.branch,v_change.proposed->>'salary_calculation_mode',
    (v_change.proposed->>'hourly_rate')::numeric,(v_change.proposed->>'monthly_hour_unit_value')::numeric,
    (v_change.proposed->>'contracted_daily_hours')::numeric,(v_change.proposed->>'monthly_base_salary')::numeric,
    (v_change.proposed->>'overtime_hour_rate')::numeric,(v_change.proposed->>'monthly_incentive_base')::numeric,v_change.effective_from,now()
    from public.staff s where s.id=v_change.staff_id
  on conflict(staff_id) do update set salary_calculation_mode=excluded.salary_calculation_mode,
   hourly_rate=excluded.hourly_rate,monthly_hour_unit_value=excluded.monthly_hour_unit_value,
   contracted_daily_hours=excluded.contracted_daily_hours,monthly_base_salary=excluded.monthly_base_salary,
   overtime_hour_rate=excluded.overtime_hour_rate,monthly_incentive_base=excluded.monthly_incentive_base,
   effective_from=excluded.effective_from,updated_at=now();
 end if;
 update public.hr_compensation_changes_v1 set state=case when p_action='approve' then 'approved' else 'rejected' end,
 decided_by=v_actor.id,decided_at=now(),decision_note=nullif(trim(p_payload->>'note'),'') where id=v_change.id;
 return jsonb_build_object('id',v_change.id,'state',case when p_action='approve' then 'approved' else 'rejected' end);
end $$;
revoke execute on function public.hr_compensation_change_v1(text,uuid,uuid,jsonb) from public;
grant execute on function public.hr_compensation_change_v1(text,uuid,uuid,jsonb) to anon,authenticated,service_role;
