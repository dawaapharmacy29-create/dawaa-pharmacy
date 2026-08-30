-- Payroll V14: canonical command boundary + immutable approved/paid snapshots.

alter table public.staff_payroll_monthly_v13
  add column if not exists staff_id uuid references public.staff(id) on delete set null,
  add column if not exists cycle_start date,
  add column if not exists cycle_end date,
  add column if not exists approval_snapshot jsonb,
  add column if not exists freeze_version integer,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists approved_by_name text,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by text,
  add column if not exists paid_by_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.staff_payroll_monthly_v13'::regclass
      and conname='staff_payroll_monthly_v13_status_check_v14'
  ) then
    alter table public.staff_payroll_monthly_v13
      add constraint staff_payroll_monthly_v13_status_check_v14
      check (coalesce(status,'draft') in ('draft','review','approved','paid'));
  end if;
end
$$;

create index if not exists staff_payroll_monthly_v13_staff_id_month_idx
  on public.staff_payroll_monthly_v13(staff_id,payroll_month desc);

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
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_status text := lower(trim(coalesce(p_status,'draft')));
  v_existing public.staff_payroll_monthly_v13%rowtype;
  v_saved public.staff_payroll_monthly_v13%rowtype;
  v_profile public.staff_payroll_profiles_v13%rowtype;
  v_staff_id uuid;
  v_staff_name text;
  v_staff_role text;
  v_staff_branch text;
  v_cycle text;
  v_cycle_start date;
  v_cycle_end date;
  v_truth record;
  v_automated numeric := 0;
  v_target numeric := 0;
  v_net numeric := 0;
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_name text;
  v_now timestamptz := now();
begin
  if coalesce(trim(p_staff_username),'')='' or p_payroll_month is null then
    raise exception 'invalid_payroll_input' using errcode='22023';
  end if;
  if v_status not in ('draft','review','approved','paid') then
    raise exception 'invalid_payroll_status' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_v1(p_staff_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  select s.id,s.name,s.role,s.branch
    into v_staff_id,v_staff_name,v_staff_role,v_staff_branch
  from public.staff_accounts sa
  join public.staff s on s.id::text=sa.staff_id::text
  where sa.username=p_staff_username
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_staff_id is null then
    raise exception 'payroll_staff_identity_missing' using errcode='22023';
  end if;

  select * into v_profile
  from public.staff_payroll_profiles_v13
  where staff_username=p_staff_username
  limit 1;
  if not found then
    raise exception 'payroll_profile_missing' using errcode='22023';
  end if;

  v_cycle := to_char(p_payroll_month,'YYYY-MM');
  v_cycle_start := public.dawaa_points_cycle_start_for_label_v1(v_cycle);
  v_cycle_end := public.dawaa_points_cycle_end_for_label_v1(v_cycle);

  select * into v_truth
  from public.get_payroll_incentive_truth_v2(v_staff_id,v_cycle)
  limit 1;
  v_automated := coalesce(v_truth.automated_incentives_total_egp,0);
  v_target := coalesce(v_truth.target_bonus_egp,0);

  v_net := round(
      coalesce(v_profile.base_salary,0)
    + coalesce(p_worked_hours,0)*coalesce(v_profile.hourly_rate,0)
    + coalesce(p_overtime_hours,0)*coalesce(v_profile.hourly_rate,0)
    + coalesce(p_quarterly_bonus,0)
    + coalesce(p_incentives_total,0)
    + v_automated
    + coalesce(p_manual_adjustment,0)
    - coalesce(p_deductions_total,0)
  ,2);

  select * into v_existing
  from public.staff_payroll_monthly_v13
  where staff_username=p_staff_username and payroll_month=p_payroll_month
  for update;

  select coalesce(sa.name,sa.staff_name,sa.username)
    into v_actor_name
  from public.staff_accounts sa
  where sa.id::text=v_actor_id
  limit 1;

  if found and coalesce(v_existing.status,'draft')='paid' then
    if v_status='paid' then return v_existing; end if;
    raise exception 'paid_payroll_is_immutable' using errcode='55000';
  end if;

  if found and coalesce(v_existing.status,'draft')='approved' then
    if v_status='approved' then return v_existing; end if;
    if v_status<>'paid' then
      raise exception 'approved_payroll_is_frozen' using errcode='55000';
    end if;
    update public.staff_payroll_monthly_v13
    set status='paid',paid_at=v_now,paid_by=v_actor_id,paid_by_name=v_actor_name,updated_at=v_now
    where id=v_existing.id
    returning * into v_saved;
    return v_saved;
  end if;

  if v_status='paid' then
    raise exception 'payroll_must_be_approved_before_paid' using errcode='55000';
  end if;

  insert into public.staff_payroll_monthly_v13(
    staff_username,staff_id,payroll_month,cycle_start,cycle_end,
    worked_hours,overtime_hours,target_bonus,quarterly_bonus,incentives_total,deductions_total,manual_adjustment,
    net_salary,status,notes,approval_snapshot,freeze_version,approved_at,approved_by,approved_by_name,updated_at
  ) values (
    p_staff_username,v_staff_id,p_payroll_month,v_cycle_start,v_cycle_end,
    coalesce(p_worked_hours,0),coalesce(p_overtime_hours,0),v_target,coalesce(p_quarterly_bonus,0),coalesce(p_incentives_total,0),coalesce(p_deductions_total,0),coalesce(p_manual_adjustment,0),
    v_net,v_status,nullif(trim(coalesce(p_notes,'')),''),
    case when v_status='approved' then jsonb_build_object(
      'engine_version',14,
      'staff_id',v_staff_id,'staff_username',p_staff_username,'staff_name',v_staff_name,'staff_role',v_staff_role,'branch',v_staff_branch,
      'month_cycle',v_cycle,'cycle_start',v_cycle_start,'cycle_end',v_cycle_end,
      'profile',jsonb_build_object('base_salary',coalesce(v_profile.base_salary,0),'hourly_rate',coalesce(v_profile.hourly_rate,0)),
      'hours',jsonb_build_object('worked_hours',coalesce(p_worked_hours,0),'overtime_hours',coalesce(p_overtime_hours,0)),
      'manual_components',jsonb_build_object('quarterly_bonus',coalesce(p_quarterly_bonus,0),'manual_incentives',coalesce(p_incentives_total,0),'deductions',coalesce(p_deductions_total,0),'manual_adjustment',coalesce(p_manual_adjustment,0)),
      'automated_incentives',jsonb_build_object(
        'profile_configured',coalesce(v_truth.profile_configured,false),
        'performance_source',coalesce(v_truth.performance_source,'none'),
        'points_incentive_egp',coalesce(v_truth.points_incentive_egp,0),
        'competition_bonus_egp',coalesce(v_truth.competition_bonus_egp,0),
        'manager_evaluation_incentive_egp',coalesce(v_truth.manager_evaluation_incentive_egp,0),
        'performance_incentive_egp',coalesce(v_truth.performance_incentive_egp,0),
        'target_bonus_egp',coalesce(v_truth.target_bonus_egp,0),
        'followup_threshold_bonus_egp',coalesce(v_truth.followup_threshold_bonus_egp,0),
        'customer_request_threshold_bonus_egp',coalesce(v_truth.customer_request_threshold_bonus_egp,0),
        'branch_star_bonus_egp',coalesce(v_truth.branch_star_bonus_egp,0),
        'automated_total_egp',v_automated
      ),
      'net_salary',v_net,'approved_at',v_now,'approved_by',v_actor_id,'approved_by_name',v_actor_name
    ) else null end,
    case when v_status='approved' then 14 else null end,
    case when v_status='approved' then v_now else null end,
    case when v_status='approved' then v_actor_id else null end,
    case when v_status='approved' then v_actor_name else null end,
    v_now
  )
  on conflict(staff_username,payroll_month) do update
  set staff_id=excluded.staff_id,cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,
      worked_hours=excluded.worked_hours,overtime_hours=excluded.overtime_hours,target_bonus=excluded.target_bonus,
      quarterly_bonus=excluded.quarterly_bonus,incentives_total=excluded.incentives_total,deductions_total=excluded.deductions_total,
      manual_adjustment=excluded.manual_adjustment,net_salary=excluded.net_salary,status=excluded.status,notes=excluded.notes,
      approval_snapshot=excluded.approval_snapshot,freeze_version=excluded.freeze_version,
      approved_at=excluded.approved_at,approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
      updated_at=v_now
  returning * into v_saved;

  return v_saved;
end;
$function$;

revoke all on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public;
grant execute on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;

revoke insert,update,delete on table public.staff_payroll_monthly_v13 from anon,authenticated;
grant select on table public.staff_payroll_monthly_v13 to anon,authenticated;

comment on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) is
  'Canonical payroll command. Draft/review are editable; approved freezes a complete incentive/profile snapshot; paid is immutable. Direct client writes are revoked.';
