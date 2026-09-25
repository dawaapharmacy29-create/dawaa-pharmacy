-- Canonical current-cycle payroll manual ledger V1.
-- Replaces editable V13 draft fields for current-cycle manual earnings/deductions/adjustments.
-- Legacy V13 rows remain read-only historical compatibility.

create table if not exists public.staff_payroll_manual_entries_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  month_cycle text not null check (month_cycle ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  entry_kind text not null check (entry_kind in ('earning','deduction','adjustment')),
  category text not null check (category in ('attendance','incentive','expiry_shortage','branch_general','individual','deduction','salary','other')),
  amount numeric not null check (amount <> 0 and abs(amount) <= 100000),
  signed_amount numeric not null,
  reason text not null,
  reference_note text null,
  reversal_of uuid null references public.staff_payroll_manual_entries_v1(id),
  created_by uuid not null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists staff_payroll_manual_entries_v1_reversal_uidx
  on public.staff_payroll_manual_entries_v1(reversal_of)
  where reversal_of is not null;

create index if not exists staff_payroll_manual_entries_v1_staff_cycle_idx
  on public.staff_payroll_manual_entries_v1(staff_id,month_cycle,created_at);

alter table public.staff_payroll_manual_entries_v1 enable row level security;
revoke all on table public.staff_payroll_manual_entries_v1 from anon,authenticated;

create or replace function public.dawaa_block_payroll_manual_entry_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  raise exception 'payroll_manual_entries_are_immutable_use_reversal' using errcode='55000';
end;
$function$;

drop trigger if exists trg_block_payroll_manual_entry_mutation_v1 on public.staff_payroll_manual_entries_v1;
create trigger trg_block_payroll_manual_entry_mutation_v1
before update or delete on public.staff_payroll_manual_entries_v1
for each row execute function public.dawaa_block_payroll_manual_entry_mutation_v1();

create or replace function public.create_staff_payroll_manual_entry_v1(
  p_staff_id uuid,
  p_month_cycle text,
  p_entry_kind text,
  p_category text,
  p_amount numeric,
  p_reason text,
  p_reference_note text default null
)
returns public.staff_payroll_manual_entries_v1
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_kind text:=lower(trim(coalesce(p_entry_kind,'')));
  v_category text:=lower(trim(coalesce(p_category,'')));
  v_signed numeric;
  v_row public.staff_payroll_manual_entries_v1%rowtype;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_manual_entry_identity_or_cycle' using errcode='22023';
  end if;
  if v_kind not in ('earning','deduction','adjustment') then
    raise exception 'invalid_payroll_manual_entry_kind' using errcode='22023';
  end if;
  if v_category not in ('attendance','incentive','expiry_shortage','branch_general','individual','deduction','salary','other') then
    raise exception 'invalid_payroll_manual_entry_category' using errcode='22023';
  end if;
  if coalesce(p_amount,0)=0 or abs(p_amount)>100000 then
    raise exception 'invalid_payroll_manual_entry_amount' using errcode='22023';
  end if;
  if length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'payroll_manual_entry_reason_required' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_manual_entry' using errcode='42501';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_manual_entry_list' using errcode='42501';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  if exists(
    select 1 from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=p_staff_id and f.month_cycle=p_month_cycle
  ) then
    raise exception 'finalized_payroll_cycle_is_immutable' using errcode='55000';
  end if;

  v_signed:=case
    when v_kind='earning' then abs(p_amount)
    when v_kind='deduction' then -abs(p_amount)
    else p_amount
  end;

  insert into public.staff_payroll_manual_entries_v1(
    staff_id,month_cycle,entry_kind,category,amount,signed_amount,reason,reference_note,
    created_by,created_by_name,metadata
  ) values(
    p_staff_id,p_month_cycle,v_kind,v_category,abs(p_amount),round(v_signed,2),
    trim(p_reason),nullif(trim(coalesce(p_reference_note,'')),''),
    v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),
    jsonb_build_object('ledger_version',1,'source','current_cycle_manual')
  ) returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.reverse_staff_payroll_manual_entry_v1(
  p_entry_id uuid,
  p_reason text
)
returns public.staff_payroll_manual_entries_v1
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_original public.staff_payroll_manual_entries_v1%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_row public.staff_payroll_manual_entries_v1%rowtype;
begin
  if p_entry_id is null or length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'payroll_manual_entry_reversal_reason_required' using errcode='22023';
  end if;

  select * into v_original
  from public.staff_payroll_manual_entries_v1
  where id=p_entry_id;
  if not found then raise exception 'payroll_manual_entry_not_found' using errcode='22023'; end if;
  if v_original.reversal_of is not null then raise exception 'cannot_reverse_a_reversal' using errcode='55000'; end if;
  if exists(select 1 from public.staff_payroll_manual_entries_v1 x where x.reversal_of=v_original.id) then
    raise exception 'payroll_manual_entry_already_reversed' using errcode='55000';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_manual_entry' using errcode='42501';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=v_original.staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  if exists(
    select 1 from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=v_original.staff_id and f.month_cycle=v_original.month_cycle
  ) then
    raise exception 'finalized_payroll_cycle_is_immutable' using errcode='55000';
  end if;

  insert into public.staff_payroll_manual_entries_v1(
    staff_id,month_cycle,entry_kind,category,amount,signed_amount,reason,reference_note,reversal_of,
    created_by,created_by_name,metadata
  ) values(
    v_original.staff_id,v_original.month_cycle,'adjustment',v_original.category,
    abs(v_original.signed_amount),round(-v_original.signed_amount,2),
    trim(p_reason),'reversal',v_original.id,
    v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),
    jsonb_build_object('ledger_version',1,'source','reversal','reversal_of',v_original.id)
  ) returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.list_staff_payroll_manual_entries_v1(
  p_staff_id uuid,
  p_month_cycle text,
  p_limit integer default 200
)
returns setof public.staff_payroll_manual_entries_v1
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_manual_entry_list_input' using errcode='22023';
  end if;
  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;
  return query
  select e.*
  from public.staff_payroll_manual_entries_v1 e
  where e.staff_id=p_staff_id and e.month_cycle=p_month_cycle
  order by e.created_at desc,e.id desc
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$function$;

revoke execute on function public.create_staff_payroll_manual_entry_v1(uuid,text,text,text,numeric,text,text) from public,anon;
revoke execute on function public.reverse_staff_payroll_manual_entry_v1(uuid,text) from public,anon;
revoke execute on function public.list_staff_payroll_manual_entries_v1(uuid,text,integer) from public,anon;
grant execute on function public.create_staff_payroll_manual_entry_v1(uuid,text,text,text,numeric,text,text) to authenticated,service_role;
grant execute on function public.reverse_staff_payroll_manual_entry_v1(uuid,text) to authenticated,service_role;
grant execute on function public.list_staff_payroll_manual_entries_v1(uuid,text,integer) to authenticated,service_role;

create or replace function public.employee_payroll_financial_composition_v2(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_gate jsonb;
  v_components jsonb;
  v_engine jsonb;
  v_incentives record;
  v_legacy public.staff_payroll_monthly_v13%rowtype;
  v_finalized public.payroll_finalized_snapshots_v2%rowtype;
  v_frozen_financial jsonb:='{}'::jsonb;
  v_base numeric:=0;
  v_list numeric:=0;
  v_automated numeric:=0;
  v_performance numeric:=0;
  v_target numeric:=0;
  v_followup numeric:=0;
  v_customer_request numeric:=0;
  v_branch_star numeric:=0;
  v_overtime numeric:=0;
  v_manual_earnings numeric:=0;
  v_manual_deductions numeric:=0;
  v_expiry_shortage_deduction numeric:=0;
  v_branch_general_deduction numeric:=0;
  v_individual_deduction numeric:=0;
  v_other_deduction numeric:=0;
  v_manual_adjustment numeric:=0;
  v_preview_net numeric:=0;
  v_frozen boolean:=false;
  v_final_net numeric:=null;
  v_entries jsonb:='[]'::jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_financial_composition_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception 'active_staff_actor_required' using errcode='42501'; end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_financial_composition' using errcode='42501';
  end if;

  select * into v_finalized
  from public.payroll_finalized_snapshots_v2 f
  where f.staff_id=p_staff_id and f.month_cycle=p_month_cycle
  limit 1;

  if found and coalesce(v_finalized.payload,'{}'::jsonb) ? 'financial_composition' then
    v_frozen_financial:=coalesce(v_finalized.payload->'financial_composition','{}'::jsonb);
    v_final_net:=coalesce(
      nullif(v_frozen_financial->>'display_net_salary','')::numeric,
      nullif(v_frozen_financial->>'preview_net_salary','')::numeric,
      0
    );
    return v_frozen_financial||jsonb_build_object(
      'schema','employee_payroll_financial_composition_v2',
      'source_mode','finalized_snapshot_v2',
      'ready_for_finalization',true,
      'frozen',true,
      'frozen_net_salary',v_final_net,
      'display_net_salary',v_final_net,
      'final_snapshot_id',v_finalized.id,
      'snapshot_fingerprint',v_finalized.snapshot_fingerprint,
      'finalized_at',v_finalized.finalized_at,
      'generated_at',v_finalized.finalized_at
    );
  end if;

  v_gate:=public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle);
  v_components:=coalesce(v_gate->'payroll_components','{}'::jsonb);
  v_engine:=coalesce(v_gate->'attendance_gate'->'engine','{}'::jsonb);

  select * into v_incentives
  from public.get_payroll_incentive_truth_v2(p_staff_id,p_month_cycle)
  limit 1;

  select * into v_legacy
  from public.staff_payroll_monthly_v13 m
  where m.staff_id=p_staff_id
    and m.payroll_month=to_date(p_month_cycle||'-01','YYYY-MM-DD')
  limit 1;

  v_base:=coalesce((v_components->>'base_salary_component')::numeric,0);
  v_list:=coalesce((v_components->>'list_incentive_component')::numeric,0);
  if v_incentives is not null then
    v_automated:=coalesce(v_incentives.automated_incentives_total_egp,0);
    v_performance:=coalesce(v_incentives.performance_incentive_egp,0);
    v_target:=coalesce(v_incentives.target_bonus_egp,0);
    v_followup:=coalesce(v_incentives.followup_threshold_bonus_egp,0);
    v_customer_request:=coalesce(v_incentives.customer_request_threshold_bonus_egp,0);
    v_branch_star:=coalesce(v_incentives.branch_star_bonus_egp,0);
  end if;
  v_overtime:=coalesce((v_engine->>'approved_overtime_amount')::numeric,0);

  v_frozen:=v_legacy.id is not null and v_legacy.status in ('approved','paid') and v_legacy.net_salary is not null;

  if v_frozen then
    -- Historical compatibility only: preserve already-frozen legacy payroll exactly.
    v_manual_earnings:=coalesce(v_legacy.incentives_total,0);
    v_expiry_shortage_deduction:=coalesce(v_legacy.expiry_shortage_deduction,0);
    v_branch_general_deduction:=coalesce(v_legacy.branch_general_deduction,0);
    v_individual_deduction:=coalesce(v_legacy.individual_deduction,0);
    v_other_deduction:=coalesce(v_legacy.other_deduction,0);
    v_manual_deductions:=v_expiry_shortage_deduction
      +v_branch_general_deduction
      +v_individual_deduction
      +v_other_deduction;
    v_manual_adjustment:=coalesce(v_legacy.manual_adjustment,0);
    v_final_net:=v_legacy.net_salary;
  else
    select
      coalesce(sum(e.signed_amount) filter(where e.entry_kind='earning'),0),
      coalesce(-sum(e.signed_amount) filter(where e.entry_kind='deduction'),0),
      coalesce(-sum(e.signed_amount) filter(where e.entry_kind='deduction' and e.category='expiry_shortage'),0),
      coalesce(-sum(e.signed_amount) filter(where e.entry_kind='deduction' and e.category='branch_general'),0),
      coalesce(-sum(e.signed_amount) filter(where e.entry_kind='deduction' and e.category='individual'),0),
      coalesce(-sum(e.signed_amount) filter(
        where e.entry_kind='deduction'
          and e.category not in ('expiry_shortage','branch_general','individual')
      ),0),
      coalesce(sum(e.signed_amount) filter(where e.entry_kind='adjustment'),0),
      coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]'::jsonb)
    into v_manual_earnings,v_manual_deductions,
         v_expiry_shortage_deduction,v_branch_general_deduction,
         v_individual_deduction,v_other_deduction,
         v_manual_adjustment,v_entries
    from public.staff_payroll_manual_entries_v1 e
    where e.staff_id=p_staff_id and e.month_cycle=p_month_cycle;
  end if;

  v_preview_net:=round(
    v_base+v_automated+v_list+v_overtime+v_manual_earnings+v_manual_adjustment-v_manual_deductions
  ,2);

  return jsonb_build_object(
    'schema','employee_payroll_financial_composition_v2',
    'staff_id',p_staff_id,
    'month_cycle',p_month_cycle,
    'ready_for_finalization',coalesce((v_gate->>'ready')::boolean,false),
    'source_mode',case when v_frozen then 'frozen_legacy_snapshot' else 'canonical_manual_ledger_v1' end,
    'earnings',jsonb_build_object(
      'base_salary',v_base,
      'automated_incentives_total',v_automated,
      'performance_incentive_included_in_automated_total',v_performance,
      'target_bonus_included_in_automated_total',v_target,
      'followup_bonus_included_in_automated_total',v_followup,
      'customer_request_bonus_included_in_automated_total',v_customer_request,
      'branch_star_bonus_included_in_automated_total',v_branch_star,
      'list_incentive',v_list,
      'approved_overtime',v_overtime,
      'manual_other_incentives',v_manual_earnings
    ),
    'adjustments',jsonb_build_object(
      'manual_adjustment',v_manual_adjustment,
      'deductions_total',v_manual_deductions,
      'expiry_shortage_deduction',v_expiry_shortage_deduction,
      'branch_general_deduction',v_branch_general_deduction,
      'individual_deduction',v_individual_deduction,
      'other_deduction',v_other_deduction
    ),
    'manual_ledger',jsonb_build_object(
      'entries',v_entries,
      'earnings_total',v_manual_earnings,
      'deductions_total',v_manual_deductions,
      'adjustments_total',v_manual_adjustment
    ),
    'preview_net_salary',v_preview_net,
    'frozen',v_frozen,
    'frozen_net_salary',v_final_net,
    'display_net_salary',coalesce(v_final_net,v_preview_net),
    'double_count_guard',jsonb_build_object(
      'monthly_incentive_component_reference_only',coalesce((v_components->>'monthly_incentive_component')::numeric,0),
      'rule','performance incentive is included once inside automated_incentives_total'
    ),
    'blockers',coalesce(v_gate->'blockers','[]'::jsonb),
    'warnings',coalesce(v_gate->'warnings','[]'::jsonb),
    'generated_at',now()
  );
end;
$function$;

create or replace function public.employee_payroll_financial_composition_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle);
$function$;

revoke execute on function public.employee_payroll_financial_composition_v1(uuid,text)
  from public,anon,authenticated;
grant execute on function public.employee_payroll_financial_composition_v1(uuid,text)
  to service_role;

revoke execute on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
revoke execute on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
revoke execute on function public.save_staff_payroll_monthly_v16(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
revoke execute on function public.save_staff_payroll_monthly_v17(text,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;

revoke execute on function public.approve_attendance_day_resolution_v1(uuid,date,numeric,text) from public,anon,authenticated;
revoke execute on function public.assign_biometric_staff_mapping_v1(text,text,uuid) from public,anon,authenticated;
revoke execute on function public.assign_biometric_staff_mapping_v2(text,text,uuid) from public,anon,authenticated;

grant execute on function public.employee_payroll_financial_composition_v2(uuid,text) to authenticated,service_role;
