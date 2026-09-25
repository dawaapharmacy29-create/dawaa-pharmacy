-- Canonical employee payroll statement + deterministic final snapshot payload.
-- Finalized statements are replayed from the frozen snapshot.

create or replace function public.employee_payroll_statement_v1(
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
  v_finalized public.payroll_finalized_snapshots_v2%rowtype;
  v_frozen_statement jsonb:='{}'::jsonb;
  v_frozen_financial jsonb:='{}'::jsonb;
  v_final_net numeric:=0;
  v_transparency jsonb;
  v_financial jsonb;
  v_kpi jsonb;
  v_start date;
  v_end date;
  v_start_leave jsonb;
  v_end_leave jsonb;
  v_leave jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_employee_payroll_statement_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_employee_payroll_statement' using errcode='42501';
  end if;

  select * into v_finalized
  from public.payroll_finalized_snapshots_v2 f
  where f.staff_id=p_staff_id and f.month_cycle=p_month_cycle
  limit 1;

  if found and coalesce(v_finalized.payload,'{}'::jsonb) ? 'employee_statement' then
    v_frozen_statement:=coalesce(v_finalized.payload->'employee_statement','{}'::jsonb);
    v_frozen_financial:=coalesce(v_frozen_statement->'financial','{}'::jsonb);
    v_final_net:=coalesce(
      nullif(v_frozen_financial->>'display_net_salary','')::numeric,
      nullif(v_frozen_financial->>'preview_net_salary','')::numeric,
      0
    );

    v_frozen_financial:=v_frozen_financial||jsonb_build_object(
      'schema','employee_payroll_financial_composition_v2',
      'source_mode','finalized_snapshot_v2',
      'frozen',true,
      'frozen_net_salary',v_final_net,
      'display_net_salary',v_final_net,
      'final_snapshot_id',v_finalized.id,
      'snapshot_fingerprint',v_finalized.snapshot_fingerprint,
      'finalized_at',v_finalized.finalized_at
    );

    v_frozen_statement:=jsonb_set(v_frozen_statement,'{financial}',v_frozen_financial,true);
    v_frozen_statement:=jsonb_set(
      v_frozen_statement,
      '{finalization}',
      jsonb_build_object(
        'ready',true,
        'finalized',true,
        'snapshot_id',v_finalized.id,
        'snapshot_fingerprint',v_finalized.snapshot_fingerprint,
        'finalized_at',v_finalized.finalized_at,
        'blockers','[]'::jsonb,
        'warnings','[]'::jsonb
      ),
      true
    );

    return v_frozen_statement||jsonb_build_object(
      'schema','employee_payroll_statement_v1',
      'statement_mode','finalized_snapshot_v2',
      'generated_at',v_finalized.finalized_at
    );
  end if;

  v_transparency:=public.employee_payroll_transparency_v1(p_staff_id,p_month_cycle);
  v_financial:=public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle);
  v_kpi:=public.employee_payroll_kpi_context_v1(p_staff_id,p_month_cycle);

  select cycle_start,cycle_end
  into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  begin
    v_start_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_start)::integer);
  exception when others then
    v_start_leave:=jsonb_build_object(
      'year',extract(year from v_start)::integer,
      'configured',false,
      'available',false,
      'reason','annual_leave_balance_unavailable'
    );
  end;

  if extract(year from v_end)::integer=extract(year from v_start)::integer then
    v_leave:=jsonb_build_object(
      'cycle_spans_years',false,
      'balances',jsonb_build_array(v_start_leave)
    );
  else
    begin
      v_end_leave:=public.get_annual_leave_balance_v1(p_staff_id,extract(year from v_end)::integer);
    exception when others then
      v_end_leave:=jsonb_build_object(
        'year',extract(year from v_end)::integer,
        'configured',false,
        'available',false,
        'reason','annual_leave_balance_unavailable'
      );
    end;
    v_leave:=jsonb_build_object(
      'cycle_spans_years',true,
      'balances',jsonb_build_array(v_start_leave,v_end_leave)
    );
  end if;

  return jsonb_build_object(
    'schema','employee_payroll_statement_v1',
    'statement_mode','live_preview',
    'staff',v_transparency->'staff',
    'cycle',v_transparency->'cycle',
    'finalization',v_transparency->'finalization',
    'payroll_engine',v_transparency->'payroll_engine',
    'payroll_components',v_transparency->'payroll_components',
    'attendance',v_transparency->'attendance',
    'time_off',v_transparency->'time_off',
    'annual_leave',v_leave,
    'missing_punch',v_transparency->'missing_punch',
    'overtime',v_transparency->'overtime',
    'transactions',v_transparency->'transactions',
    'incentives',v_transparency->'incentives',
    'financial',v_financial,
    'kpi',v_kpi,
    'statement_rules',jsonb_build_object(
      'attendance','approved Attendance Truth only',
      'overtime','approved overtime only; pending/rejected are disclosed but not paid',
      'performance','KPI context is non-financial unless Incentive Truth converts it to a payable amount',
      'missing_punch','only an applied deduction transaction affects pay',
      'annual_leave','balance is informational and comes from the annual leave ledger',
      'net_salary','financial.display_net_salary',
      'finalization','after finalization this exact statement is replayed from payroll_finalized_snapshots_v2'
    ),
    'generated_at',now()
  );
end;
$function$;

revoke execute on function public.employee_payroll_statement_v1(uuid,text) from public,anon;
grant execute on function public.employee_payroll_statement_v1(uuid,text)
  to authenticated,service_role;

create or replace function public.dawaa_jsonb_strip_generated_at_v1(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to 'public','pg_catalog'
as $function$
declare
  v_type text;
  v_result jsonb;
begin
  if p_value is null then return null; end if;
  v_type:=jsonb_typeof(p_value);

  if v_type='object' then
    select coalesce(
      jsonb_object_agg(e.key,public.dawaa_jsonb_strip_generated_at_v1(e.value)),
      '{}'::jsonb
    )
    into v_result
    from jsonb_each(p_value) e
    where e.key<>'generated_at';
    return v_result;
  elsif v_type='array' then
    select coalesce(
      jsonb_agg(public.dawaa_jsonb_strip_generated_at_v1(a.value) order by a.ord),
      '[]'::jsonb
    )
    into v_result
    from jsonb_array_elements(p_value) with ordinality a(value,ord);
    return v_result;
  end if;

  return p_value;
end;
$function$;

revoke all on function public.dawaa_jsonb_strip_generated_at_v1(jsonb)
  from public,anon,authenticated;
grant execute on function public.dawaa_jsonb_strip_generated_at_v1(jsonb)
  to service_role;

create or replace function public.payroll_final_snapshot_preview_v1(
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
  v_gate jsonb;
  v_components jsonb;
  v_financial jsonb;
  v_statement jsonb;
  v_snapshot jsonb;
  v_fingerprint_payload jsonb;
  v_username text;
  v_name text;
  v_branch text;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_snapshot_preview_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;
  if not found then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  select sa.username,coalesce(sa.name,sa.staff_name,s.name,sa.username),
         coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),''))
  into v_username,v_name,v_branch
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_snapshot_preview' using errcode='42501';
  end if;

  v_gate:=public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle);
  v_components:=public.get_payroll_components_v17(p_staff_id,p_month_cycle);
  v_financial:=public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle);
  v_statement:=public.employee_payroll_statement_v1(p_staff_id,p_month_cycle);

  v_snapshot:=jsonb_build_object(
    'snapshot_schema','payroll_final_snapshot_v3',
    'snapshot_mode','preview_only',
    'fingerprint_schema','deterministic_without_generated_at_v1',
    'staff_id',p_staff_id,
    'staff_username',v_username,
    'staff_name',v_name,
    'branch',v_branch,
    'month_cycle',p_month_cycle,
    'cycle_start',v_gate->>'cycle_start',
    'cycle_end',v_gate->>'cycle_end',
    'finalization_ready',coalesce((v_gate->>'ready')::boolean,false),
    'attendance_truth',v_gate->'attendance_gate',
    'policy_validation',v_gate->'policy_validation',
    'payroll_components',v_components,
    'financial_composition',v_financial,
    'employee_statement',v_statement,
    'blockers',v_gate->'blockers',
    'warnings',v_gate->'warnings',
    'generated_at',now()
  );

  v_fingerprint_payload:=public.dawaa_jsonb_strip_generated_at_v1(v_snapshot);

  return v_snapshot||jsonb_build_object(
    'snapshot_fingerprint',md5(v_fingerprint_payload::text)
  );
end;
$function$;

revoke execute on function public.payroll_final_snapshot_preview_v1(uuid,text)
  from public,anon;
grant execute on function public.payroll_final_snapshot_preview_v1(uuid,text)
  to authenticated,service_role;
