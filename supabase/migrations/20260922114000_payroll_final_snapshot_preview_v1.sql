
create or replace function public.payroll_final_snapshot_preview_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_gate jsonb;
  v_components jsonb;
  v_snapshot jsonb;
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
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  select sa.username,
         coalesce(sa.name,sa.staff_name,s.name,sa.username),
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

  v_snapshot:=jsonb_build_object(
    'snapshot_schema','payroll_final_snapshot_v1',
    'snapshot_mode','preview_only',
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
    'blockers',v_gate->'blockers',
    'warnings',v_gate->'warnings',
    'generated_at',now()
  );

  return v_snapshot || jsonb_build_object(
    'snapshot_fingerprint',md5(v_snapshot::text)
  );
end;
$$;

revoke execute on function public.payroll_final_snapshot_preview_v1(uuid,text) from public,anon;
grant execute on function public.payroll_final_snapshot_preview_v1(uuid,text) to authenticated,service_role;
