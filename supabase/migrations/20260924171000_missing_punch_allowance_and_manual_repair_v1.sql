-- Missing punch allowance + manual repair ledger V1.
-- Policy: first 2 forgotten punches per 26->25 pay cycle are allowed.
-- From occurrence 3 onward, a manager may execute a fixed EGP 50 penalty.
-- The attendance repair and financial penalty remain separately auditable.

create table if not exists public.attendance_missing_punch_incidents (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_name text not null,
  branch text,
  attendance_date date not null,
  missing_type text not null check (missing_type in ('check_in','check_out')),
  month_cycle text not null,
  occurrence_no integer not null check (occurrence_no > 0),
  allowance_limit integer not null default 2 check (allowance_limit >= 0),
  penalty_eligible boolean not null default false,
  penalty_amount numeric not null default 50 check (penalty_amount >= 0),
  manual_punch_id uuid references public.staff_attendance_logs(id) on delete set null,
  deduction_transaction_id uuid references public.employee_transactions(id) on delete set null,
  reason text,
  actor_id text,
  actor_name text,
  actor_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id,attendance_date,missing_type)
);

create index if not exists idx_missing_punch_incidents_cycle_staff
  on public.attendance_missing_punch_incidents(month_cycle,staff_id,occurrence_no);

alter table public.attendance_missing_punch_incidents enable row level security;
revoke all on public.attendance_missing_punch_incidents from public,anon,authenticated;
grant all on public.attendance_missing_punch_incidents to service_role;

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
begin
  if p_staff_id is null or p_date is null or p_missing_type not in ('check_in','check_out') then
    raise exception 'invalid_missing_punch_context' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(p_staff_id,v_staff.branch) then
    raise exception 'not_authorized_for_missing_punch_context' using errcode='42501';
  end if;

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
    'existing_incident_id',v_existing.id,
    'manual_punch_id',v_existing.manual_punch_id,
    'deduction_transaction_id',v_existing.deduction_transaction_id
  );
end;
$$;

create or replace function public.resolve_missing_punch_incident_v1(
  p_staff_id uuid,
  p_date date,
  p_missing_type text,
  p_recorded_at timestamptz default null,
  p_reason text default null,
  p_apply_deduction boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_cycle text;
  v_incident public.attendance_missing_punch_incidents%rowtype;
  v_occurrence integer;
  v_manual_id uuid;
  v_tx_id uuid;
  v_reason text:=coalesce(nullif(trim(coalesce(p_reason,'')),''),'نسيان بصمة — معالجة من صندوق مراجعة الحضور');
  v_local_date date;
begin
  if p_staff_id is null or p_date is null or p_missing_type not in ('check_in','check_out') then
    raise exception 'invalid_missing_punch_resolution' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,false)=true;
  if not found then raise exception 'staff_not_found_or_inactive' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch) then
    raise exception 'not_authorized_for_missing_punch_resolution' using errcode='42501';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict();

  if v_actor.id is null then
    raise exception 'attendance_actor_not_resolved' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_staff_id::text||':'||p_date::text||':'||p_missing_type,0
  ));

  v_cycle:=public.dawaa_points_cycle_label_for_date_v3(p_date);

  select * into v_incident
  from public.attendance_missing_punch_incidents
  where staff_id=p_staff_id and attendance_date=p_date and missing_type=p_missing_type
  for update;

  if v_incident.id is null then
    select count(*)::int+1 into v_occurrence
    from public.attendance_missing_punch_incidents
    where staff_id=p_staff_id and month_cycle=v_cycle;

    insert into public.attendance_missing_punch_incidents(
      staff_id,staff_name,branch,attendance_date,missing_type,month_cycle,
      occurrence_no,allowance_limit,penalty_eligible,penalty_amount,
      reason,actor_id,actor_name,actor_role
    ) values (
      v_staff.id,v_staff.name,v_staff.branch,p_date,p_missing_type,v_cycle,
      v_occurrence,2,v_occurrence>2,50,
      v_reason,v_actor.id::text,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
    ) returning * into v_incident;
  end if;

  if p_recorded_at is not null and v_incident.manual_punch_id is null then
    if p_recorded_at>now()+interval '5 minutes' then
      raise exception 'manual_punch_time_in_future' using errcode='22023';
    end if;

    v_local_date:=(p_recorded_at at time zone 'Africa/Cairo')::date;
    if v_local_date not in (p_date,p_date+1) then
      raise exception 'manual_punch_time_outside_attendance_day_window' using errcode='22023';
    end if;

    insert into public.staff_attendance_logs(
      staff_id,staff_name,role,branch_name,attendance_type,recorded_at,
      shift_date,biometric_verified,biometric_method,status,rejection_reason
    ) values (
      v_staff.id,v_staff.name,v_staff.role,v_staff.branch,p_missing_type,p_recorded_at,
      p_date,false,'manual_admin_entry','accepted',null
    ) returning id into v_manual_id;

    update public.attendance_missing_punch_incidents
    set manual_punch_id=v_manual_id,reason=v_reason,updated_at=now()
    where id=v_incident.id
    returning * into v_incident;

    insert into public.attendance_manual_actions_audit(
      action_type,staff_id,target_id,old_value,new_value,reason,
      actor_account_id,actor_name,actor_role
    ) values (
      'missing_punch_manual_entry',v_staff.id,v_manual_id,null,
      jsonb_build_object(
        'attendance_type',p_missing_type,
        'recorded_at',p_recorded_at,
        'attendance_date',p_date,
        'incident_id',v_incident.id,
        'occurrence_no',v_incident.occurrence_no
      ),
      v_reason,v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
    );
  end if;

  if p_apply_deduction and v_incident.deduction_transaction_id is null then
    if v_incident.occurrence_no<=v_incident.allowance_limit then
      raise exception 'missing_punch_allowance_not_exhausted' using errcode='55000';
    end if;

    insert into public.employee_transactions(
      staff_id,employee_name,branch,type,title,reason,description,amount,points,points_delta,
      source,source_id,transaction_date,month_cycle,status,employee_visible,created_by,
      approved_by,approved_at,category,metadata
    ) values (
      v_staff.id,v_staff.name,v_staff.branch,'penalty','خصم نسيان بصمة',
      'نسيان بصمة بعد استهلاك مرات السماح',
      format('خصم 50 ج.م — نسيان %s رقم %s في دورة %s. أول مرتين سماح.',
        case when p_missing_type='check_in' then 'بصمة الدخول' else 'بصمة الخروج' end,
        v_incident.occurrence_no,v_cycle),
      50,0,0,
      'attendance_missing_punch_v1',v_incident.id,p_date,v_cycle,'active',true,
      v_actor.id::text,v_actor.id::text,now(),'attendance',
      jsonb_build_object(
        'missing_punch_incident_id',v_incident.id,
        'missing_type',p_missing_type,
        'occurrence_no',v_incident.occurrence_no,
        'allowance_limit',v_incident.allowance_limit,
        'fixed_penalty_egp',50
      )
    ) returning id into v_tx_id;

    update public.attendance_missing_punch_incidents
    set deduction_transaction_id=v_tx_id,updated_at=now()
    where id=v_incident.id
    returning * into v_incident;

    insert into public.attendance_manual_actions_audit(
      action_type,staff_id,target_id,old_value,new_value,reason,
      actor_account_id,actor_name,actor_role
    ) values (
      'missing_punch_fixed_penalty',v_staff.id,v_tx_id,null,
      jsonb_build_object('amount',50,'incident_id',v_incident.id,'occurrence_no',v_incident.occurrence_no),
      v_reason,v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
    );
  end if;

  if v_incident.manual_punch_id is not null then
    perform public.dawaa_materialize_attendance_day_internal_v2(v_staff.id,p_date);
  end if;

  return jsonb_build_object(
    'success',true,
    'incident_id',v_incident.id,
    'staff_id',v_staff.id,
    'staff_name',v_staff.name,
    'attendance_date',p_date,
    'missing_type',p_missing_type,
    'month_cycle',v_incident.month_cycle,
    'occurrence_no',v_incident.occurrence_no,
    'allowance_limit',v_incident.allowance_limit,
    'penalty_eligible',v_incident.penalty_eligible,
    'penalty_amount',v_incident.penalty_amount,
    'manual_punch_id',v_incident.manual_punch_id,
    'deduction_transaction_id',v_incident.deduction_transaction_id
  );
end;
$$;

create or replace function public.list_staff_missing_punch_history_v1(
  p_staff_id uuid,
  p_limit integer default 50
)
returns table(
  id uuid,
  attendance_date date,
  missing_type text,
  month_cycle text,
  occurrence_no integer,
  penalty_eligible boolean,
  penalty_amount numeric,
  manual_punch_id uuid,
  deduction_transaction_id uuid,
  reason text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  select
    i.id,i.attendance_date,i.missing_type,i.month_cycle,i.occurrence_no,
    i.penalty_eligible,i.penalty_amount,i.manual_punch_id,i.deduction_transaction_id,
    i.reason,i.created_at
  from public.attendance_missing_punch_incidents i
  join public.staff s on s.id=i.staff_id
  where i.staff_id=p_staff_id
    and public.dawaa_can_read_staff_attendance_log(i.staff_id,s.branch)
  order by i.attendance_date desc,i.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),200));
$$;

revoke execute on function public.missing_punch_context_v1(uuid,date,text) from public;
revoke execute on function public.resolve_missing_punch_incident_v1(uuid,date,text,timestamptz,text,boolean) from public;
revoke execute on function public.list_staff_missing_punch_history_v1(uuid,integer) from public;

grant execute on function public.missing_punch_context_v1(uuid,date,text) to anon,authenticated,service_role;
grant execute on function public.resolve_missing_punch_incident_v1(uuid,date,text,timestamptz,text,boolean) to anon,authenticated,service_role;
grant execute on function public.list_staff_missing_punch_history_v1(uuid,integer) to anon,authenticated,service_role;
