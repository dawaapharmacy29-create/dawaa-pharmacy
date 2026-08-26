-- Employee Workspace V3
-- One fast snapshot for the employee: canonical points truth + actions + latest point events.

create or replace function public.get_employee_workspace_dashboard_v3(
  p_staff_id uuid,
  p_user_id text default null,
  p_staff_name text default null,
  p_role text default null,
  p_branch text default null,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_self text := public.dawaa_current_staff_id_v1();
  v_actor_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_target_branch text;
  v_global boolean := v_actor_role in ('general_manager','admin','executive_manager','branches_manager');
  v_points jsonb;
  v_actions jsonb := '{}'::jsonb;
  v_recent jsonb := '[]'::jsonb;
begin
  select nullif(trim(coalesce(s.branch,'')), '')
    into v_target_branch
  from public.staff s
  where s.id = p_staff_id;

  if not (
    p_staff_id::text = coalesce(v_self,'')
    or v_global
    or (v_actor_role = 'branch_manager' and coalesce(v_target_branch,'') = coalesce(v_actor_branch,''))
  ) then
    raise exception 'not_authorized';
  end if;

  v_points := public.get_staff_points_dashboard_v3(p_staff_id, p_month_cycle);
  if coalesce(v_points->>'error','') <> '' then
    return v_points;
  end if;

  begin
    v_actions := public.get_staff_dashboard_actions_v1(
      p_staff_id::text,
      p_user_id,
      p_staff_name,
      p_role,
      p_branch
    );
  exception when others then
    -- Actions are supportive UI data. Points truth must remain available even if a legacy action source is unavailable.
    v_actions := jsonb_build_object(
      'unread_notifications', 0,
      'urgent_actions', 0,
      'open_tasks', 0,
      'open_followups', 0,
      'latest_notifications', '[]'::jsonb,
      'actions_warning', 'actions_unavailable'
    );
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'source_id', x.source_id,
    'source', x.source,
    'reason', x.reason,
    'signed_points', x.signed_points,
    'status', x.status,
    'created_at', x.created_at
  ) order by x.created_at desc), '[]'::jsonb)
  into v_recent
  from (
    select
      et.id,
      et.source_id,
      coalesce(nullif(et.source,''),'employee_transactions') as source,
      coalesce(nullif(et.display_reason,''), nullif(et.clean_reason,''), nullif(et.reason,''), nullif(et.description,''), 'تعديل نقاط') as reason,
      case
        when et.points_delta is not null then et.points_delta
        when et.final_points is not null then et.final_points
        when lower(coalesce(et.type,'')) in ('penalty','deduction') then -abs(coalesce(et.points,0))
        else abs(coalesce(et.points,0))
      end as signed_points,
      coalesce(et.status,'active') as status,
      coalesce(et.updated_at, et.created_at, et.transaction_date::timestamptz) as created_at
    from public.employee_transactions et
    where et.staff_id = p_staff_id
      and et.month_cycle = coalesce(nullif(trim(coalesce(p_month_cycle,'')),''), v_points->>'month_cycle')
      and coalesce(et.status,'active') in ('active','approved')
    order by coalesce(et.updated_at, et.created_at, et.transaction_date::timestamptz) desc
    limit 8
  ) x;

  return jsonb_build_object(
    'engine_version', 3,
    'points', v_points,
    'actions', v_actions,
    'recent_point_events', v_recent,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_employee_workspace_dashboard_v3(uuid,text,text,text,text,text) from public;
grant execute on function public.get_employee_workspace_dashboard_v3(uuid,text,text,text,text,text) to anon, authenticated;

comment on function public.get_employee_workspace_dashboard_v3(uuid,text,text,text,text,text) is
  'Single employee workspace read model: canonical points/incentive truth, actionable work and latest point events in one request.';
